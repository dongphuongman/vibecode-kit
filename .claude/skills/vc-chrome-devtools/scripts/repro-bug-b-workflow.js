#!/usr/bin/env node
/**
 * Reproduce Bug B: send a prompt that triggers a long-running workflow tool,
 * wait until the tool is actively streaming, then reload the page and capture
 * all [plan-b] console logs + tRPC + WS frames for analysis.
 *
 * Stages:
 *   A. Connect + start listener
 *   B. Type prompt + submit
 *   C. Wait for workflow tool start (first [WS tool] or system message)
 *   D. Reload
 *   E. Capture logs for N seconds
 *   F. Save everything to a JSON report
 */
import puppeteer from "puppeteer";
import fs from "fs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      const key = k.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) { out[key] = "true"; }
      else { out[key] = next; i++; }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browserUrl = args["browser-url"] || "http://localhost:9222";
  const prompt = args.prompt || "get me 20 linkedin posts from my feed";
  const targetUrl = args["target-url"] || "linkedin-brand/chat";
  const preReloadWaitMs = parseInt(args["pre-reload-wait"] || "15000", 10);
  const postReloadCaptureMs = parseInt(args["post-reload-capture"] || "20000", 10);
  const out = args.out || `/Users/knamnguyen/Documents/0-Programming/flowser-turborepo/.claude/chrome-devtools/logs/repro-${Date.now()}.json`;

  const browser = await puppeteer.connect({
    browserURL: browserUrl,
    defaultViewport: null,
  });

  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes(targetUrl)) ?? pages[0];
  if (!page) { console.error("no page"); process.exit(1); }

  process.stderr.write(`[repro] target: ${page.url().slice(0, 120)}\n`);

  const events = [];
  const tag = (phase, kind, data) => events.push({ ts: Date.now(), phase, kind, data });

  // ───── Console listener with JSHandle resolution ─────
  page.on("console", async (msg) => {
    let txt = msg.text();
    try {
      const parts = await Promise.all(
        msg.args().map(async (h) => {
          try {
            return await h.evaluate((v) => {
              if (v === undefined) return "undefined";
              if (v === null) return "null";
              if (typeof v === "object") { try { return JSON.stringify(v); } catch { return String(v); } }
              return String(v);
            });
          } catch { return "<unres>"; }
        }),
      );
      txt = parts.join(" ");
    } catch {}
    tag(currentPhase, "console", { type: msg.type(), text: txt });
  });

  page.on("pageerror", (err) => {
    tag(currentPhase, "pageerror", { text: err.message });
  });

  // ───── CDP for WS + network ─────
  const cdp = await page.target().createCDPSession();
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketFrameReceived", (e) => {
    const payload = String(e.response?.payloadData || "").slice(0, 500);
    if (payload.length === 0) return;
    tag(currentPhase, "ws-recv", { payload });
  });
  cdp.on("Network.webSocketFrameSent", (e) => {
    const payload = String(e.response?.payloadData || "").slice(0, 500);
    if (payload.length === 0) return;
    tag(currentPhase, "ws-send", { payload });
  });

  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("getActiveRun") || u.includes("chat.abort")) {
      tag(currentPhase, "http-req", { method: req.method(), url: u.slice(0, 200) });
    }
  });
  page.on("response", async (resp) => {
    const u = resp.url();
    if (u.includes("getActiveRun")) {
      let body = null;
      try { body = await resp.text(); } catch {}
      tag(currentPhase, "http-resp", { status: resp.status(), url: u.slice(0, 200), body: body?.slice(0, 800) });
    }
  });

  // ───── B: type + submit prompt ─────
  let currentPhase = "B-send";
  process.stderr.write(`[repro] B: sending prompt: "${prompt}"\n`);

  await page.focus("textarea[placeholder='Message the agent...']");
  await page.evaluate(() => {
    const t = document.querySelector("textarea[placeholder='Message the agent...']");
    if (t) t.value = "";
  });
  await page.type("textarea[placeholder='Message the agent...']", prompt, { delay: 15 });
  await new Promise((r) => setTimeout(r, 400));
  await page.keyboard.press("Enter");

  // ───── C: wait for workflow to start streaming ─────
  currentPhase = "C-waiting";
  process.stderr.write(`[repro] C: waiting ${preReloadWaitMs}ms for workflow to start streaming...\n`);
  await new Promise((r) => setTimeout(r, preReloadWaitMs));

  // Snapshot the UI state right before reload
  const preReloadUi = await page.evaluate(() => {
    const msgs = Array.from(document.querySelectorAll("[data-testid], [role='listitem']")).slice(-10).map(el => ({
      tag: el.tagName,
      text: (el.innerText || "").slice(0, 200),
    }));
    const active = document.title;
    return { msgCount: msgs.length, sampleMsgs: msgs.slice(-3), title: active };
  });
  tag("C-waiting", "ui-snapshot", preReloadUi);
  process.stderr.write(`[repro] pre-reload UI snapshot: ${JSON.stringify(preReloadUi).slice(0, 200)}\n`);

  // ───── D: reload ─────
  currentPhase = "D-reload";
  process.stderr.write(`[repro] D: reloading page\n`);
  tag("D-reload", "reload", { at: Date.now() });
  await page.reload({ waitUntil: "domcontentloaded" });

  // ───── E: capture after reload ─────
  currentPhase = "E-post-reload";
  process.stderr.write(`[repro] E: capturing ${postReloadCaptureMs}ms post-reload...\n`);
  await new Promise((r) => setTimeout(r, postReloadCaptureMs));

  // Snapshot the UI state after capture window
  const postReloadUi = await page.evaluate(() => {
    const msgs = Array.from(document.querySelectorAll("[data-testid], [role='listitem']")).slice(-10).map(el => ({
      tag: el.tagName,
      text: (el.innerText || "").slice(0, 200),
    }));
    return { msgCount: msgs.length, sampleMsgs: msgs.slice(-3) };
  });
  tag("E-post-reload", "ui-snapshot", postReloadUi);

  // ───── F: save report ─────
  const planBLogs = events.filter(e => e.kind === "console" && e.data.text.includes("[plan-b]"));
  const wsLogs = events.filter(e => e.kind === "console" && (e.data.text.includes("[WS ") || e.data.text.includes("[thinking-poll]")));
  const reconcileTriggers = events.filter(e => e.data?.text?.includes("reconcile trigger"));
  const reconcileResults = events.filter(e => e.data?.text?.includes("reconcile result") || e.data?.text?.includes("applyResult"));
  const dropLogs = events.filter(e => e.data?.text?.includes("DROP "));
  const getActiveRunCalls = events.filter(e => e.data?.url?.includes("getActiveRun"));

  const report = {
    ok: true,
    pageUrl: page.url(),
    prompt,
    summary: {
      totalEvents: events.length,
      planBCount: planBLogs.length,
      wsLogCount: wsLogs.length,
      reconcileTriggers: reconcileTriggers.length,
      reconcileResults: reconcileResults.length,
      dropEvents: dropLogs.length,
      getActiveRunCalls: getActiveRunCalls.length,
    },
    phases: {
      send: events.filter(e => e.phase === "B-send"),
      waiting: events.filter(e => e.phase === "C-waiting"),
      reload: events.filter(e => e.phase === "D-reload"),
      postReload: events.filter(e => e.phase === "E-post-reload"),
    },
  };
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  process.stderr.write(`[repro] F: wrote ${out}\n`);
  console.log(JSON.stringify({ ok: true, file: out, summary: report.summary }));

  await browser.disconnect();
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String(e), stack: e.stack }));
  process.exit(1);
});
