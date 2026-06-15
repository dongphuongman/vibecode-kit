#!/usr/bin/env node
/**
 * compute-sync-plan.mjs
 * Pure deterministic computation of the sync plan between a kit and a target project.
 * No side effects — reads files, never writes.
 *
 * Usage (CLI):
 *   node compute-sync-plan.mjs --root <projectRoot> --kit-root <kitRoot> [--json]
 *
 * Exports:
 *   default: computeSyncPlan(opts) → { toAdd, toModify, toDelete, toPreserve, staleWarnings }
 *   isKitOwned(filePath) → boolean
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Returns true when a relative file path falls within the kit-owned namespace.
 * Only kit-owned files may be deleted during stale removal.
 */
export function isKitOwned(filePath) {
  return (
    filePath.startsWith('.claude/skills/vc-') ||
    filePath.startsWith('.claude/agents/vc-') ||
    filePath.startsWith('.claude/hooks/') ||
    filePath.startsWith('.codex/') ||
    filePath.startsWith('process/development-protocols/') ||
    filePath.startsWith('process/context/planning/') ||
    filePath.startsWith('process/_seeds/') ||
    filePath === 'process/context/generated-skills-catalog.json' ||
    filePath === 'CLAUDE.md' ||
    filePath === 'AGENTS.md' ||
    filePath === '.vc-installed-files' ||
    filePath === '.vc-version' ||
    filePath.startsWith('.agents/')
  );
}

/**
 * Compute a surgical sync plan between a kit and a target project.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot       — absolute path to the user's project
 * @param {string} opts.kitRoot           — absolute path to the cloned kit (tmpdir)
 * @param {string[]} opts.ownedPaths      — from resolve-manifest --json .ownedPaths
 * @param {string[]} opts.managedFiles    — from resolve-manifest --json .files
 * @param {string[]} opts.mergeFiles      — from resolve-manifest --json .merge
 * @param {string[]} opts.copyIfMissing   — from resolve-manifest --json .copyIfMissing
 * @param {string[]} opts.legacyDeletions — from resolve-manifest --json .legacyDeletions
 * @returns {{ toAdd: string[], toModify: string[], toDelete: string[], toPreserve: string[], staleWarnings: string[] }}
 */
export default function computeSyncPlan(opts) {
  const {
    projectRoot,
    kitRoot,
    ownedPaths = [],
    managedFiles = [],
    mergeFiles = [],
    copyIfMissing = [],
    legacyDeletions = [],
    missingDeclared = [],
  } = opts;

  // 1. Read prior .vc-installed-files snapshot
  const snapshotPath = path.join(projectRoot, '.vc-installed-files');
  let priorSnapshot = [];
  try {
    const raw = fs.readFileSync(snapshotPath, 'utf8');
    priorSnapshot = [...new Set(raw.split('\n').map(l => l.trim()).filter(Boolean))];
  } catch {
    // No prior snapshot — first install or pre-snapshot install
  }

  const priorSet = new Set(priorSnapshot);
  const ownedSet = new Set(ownedPaths);
  const mergeSet = new Set(mergeFiles);
  const copyIfMissingSet = new Set(copyIfMissing);

  const toAdd = [];
  const toModify = [];
  const toDelete = [];
  const toPreserve = [];
  const staleWarnings = [];

  // 2. toAdd / toModify: classify managed files
  for (const rel of managedFiles) {
    const projectFile = path.join(projectRoot, rel);
    const kitFile = path.join(kitRoot, rel);

    // Skip merge files that already exist (never overwrite merge-category files)
    if (mergeSet.has(rel)) {
      const exists = fileExists(projectFile);
      if (exists) {
        toPreserve.push(rel);
      } else {
        toAdd.push(rel);
      }
      continue;
    }

    // Skip copyIfMissing files that already exist
    if (copyIfMissingSet.has(rel)) {
      if (fileExists(projectFile)) {
        toPreserve.push(rel);
      } else {
        toAdd.push(rel);
      }
      continue;
    }

    const existsOnDisk = fileExists(projectFile);
    const inPrior = priorSet.has(rel);

    if (!existsOnDisk) {
      // Not on disk at all — add
      toAdd.push(rel);
    } else if (inPrior) {
      // Was previously installed — check if content differs
      if (contentDiffers(projectFile, kitFile)) {
        toModify.push(rel);
      } else {
        toPreserve.push(rel);
      }
    } else {
      // On disk but not in prior snapshot — treat as user-owned; preserve
      toPreserve.push(rel);
    }
  }

  // 3. toDelete: stale removal — files in prior snapshot NOT in ownedPaths
  //    Safety guard: if ownedPaths is empty but the prior snapshot is large,
  //    a full mass-deletion would silently destroy the user's project. Hard-abort.
  const OWNED_EMPTY_THRESHOLD = 5;
  if (ownedPaths.length === 0 && priorSnapshot.length > OWNED_EMPTY_THRESHOLD && !opts.forceEmptyOwned) {
    const msg =
      `ABORT: ownedPaths is empty but prior snapshot has ${priorSnapshot.length} files — ` +
      `refusing to mass-delete (likely a stale/incomplete kit clone, e.g. missing ` +
      `resolve-manifest ownedPaths or untracked compute-sync-plan). ` +
      `Re-clone a complete kit or pass --force-empty-owned to override.`;
    staleWarnings.push(msg);
    return { toAdd, toModify, toDelete, toPreserve, staleWarnings, aborted: true, abortReason: msg };
  }

  // Kit-integrity guard: warn about declared kit files that were absent at resolution time.
  // These are paths the manifest DECLARED as exact entries but that were missing on disk
  // (partial/corrupt kit clone). Guard with || [] for backward-compat with older resolver output.
  const missingDeclaredSet = new Set(missingDeclared || []);
  if (missingDeclaredSet.size > 0) {
    process.stderr.write(
      `\nWARNING: Kit integrity check failed — the following declared kit files were not found on disk.\n` +
      `The kit clone may be partial or corrupt. Re-clone the kit before updating.\n` +
      `Missing declared kit files:\n` +
      [...missingDeclaredSet].sort().map((p) => `  ${p}`).join('\n') + '\n\n'
    );
  }

  for (const rel of priorSnapshot) {
    if (ownedSet.has(rel)) {
      // Still in current ownedPaths — not stale
      continue;
    }

    const projectFile = path.join(projectRoot, rel);
    if (!fileExists(projectFile)) {
      // Already gone — skip
      continue;
    }

    // Kit-integrity guard: if this deletion candidate matches a declared kit file
    // that was absent on disk at resolution time, preserve it instead of deleting.
    // The kit clone is likely incomplete; deleting the project copy would be data loss.
    if (missingDeclaredSet.has(rel)) {
      staleWarnings.push(
        `PRESERVED (kit integrity): '${rel}' was scheduled for deletion but is declared in the kit manifest and missing from the kit clone — preserved to avoid data loss. Re-clone the kit to get the correct version. Original is recoverable from .vibecode-backup/ if a backup was made.`
      );
      toPreserve.push(rel);
      continue;
    }

    if (isKitOwned(rel)) {
      toDelete.push(rel);
    } else {
      staleWarnings.push(
        `'${rel}' in prior snapshot but not in kit namespace — preserved (verify manually)`
      );
      toPreserve.push(rel);
    }
  }

  // 4. legacyDeletions: add entries that exist on disk and pass namespace guard
  for (const rel of legacyDeletions) {
    if (toDelete.includes(rel)) continue; // already scheduled
    const projectFile = path.join(projectRoot, rel);
    const existsAsFile = fileExists(projectFile);
    const existsAsDir = !existsAsFile && dirExists(projectFile);
    if ((existsAsFile || existsAsDir) && isKitOwned(rel)) {
      toDelete.push(rel);
    }
  }

  // 5. Warn about suspicious deletes: isKitOwned but not in known ownedPaths or legacyDeletions
  const legacySet = new Set(legacyDeletions);
  for (const rel of toDelete) {
    if (!ownedSet.has(rel) && !legacySet.has(rel)) {
      staleWarnings.push(
        `WARNING: ${rel} will be removed (matches vc- namespace) but is not a known kit file — if this is YOUR custom skill, rename it without the vc- prefix to protect it.`
      );
    }
  }

  return { toAdd, toModify, toDelete, toPreserve, staleWarnings };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fileExists(absPath) {
  try {
    return fs.statSync(absPath).isFile();
  } catch {
    return false;
  }
}

function dirExists(absPath) {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function contentDiffers(absA, absB) {
  try {
    const a = fs.readFileSync(absA);
    const b = fs.readFileSync(absB);
    return !a.equals(b);
  } catch {
    // If kit file doesn't exist, treat as no-differ (skip modification)
    return false;
  }
}

// ── Apply mode ────────────────────────────────────────────────────────────────

/**
 * Execute the computed sync plan against projectRoot.
 * Called when --apply is passed on the CLI.
 *
 * @param {{ toAdd: string[], toModify: string[], toDelete: string[], toPreserve: string[], staleWarnings: string[] }} plan
 * @param {string} projectRoot   — absolute path to the user's project
 * @param {string} kitRoot       — absolute path to the cloned kit
 * @param {string[]} ownedPaths  — full ownedPaths from the resolved manifest (used for stale-removal)
 * @param {string} version       — manifest version string (written to .vc-version)
 * @param {string[]} managedFiles — managed files only (written to .vc-installed-files snapshot)
 */
function applyPlan(plan, projectRoot, kitRoot, ownedPaths, version, managedFiles) {
  // Fall back to ownedPaths if managedFiles not supplied (backward-compat)
  const snapshotFiles = managedFiles || ownedPaths;
  const { toAdd, toModify, toDelete, staleWarnings } = plan;

  // 1. Print stale warnings to stderr (never act on them)
  for (const w of staleWarnings) {
    process.stderr.write(`staleWarning: ${w}\n`);
  }

  // 2. Copy additions (toAdd)
  for (const rel of toAdd) {
    const src = path.join(kitRoot, rel);
    const dst = path.join(projectRoot, rel);
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      console.log(`  added: ${rel}`);
    } catch (err) {
      process.stderr.write(
        `  ERROR: failed to add '${rel}': ${err.message} — skipping (original recoverable from .vibecode-backup/ if a backup was made)\n`
      );
    }
  }

  // 3. Copy modifications (toModify)
  for (const rel of toModify) {
    const src = path.join(kitRoot, rel);
    const dst = path.join(projectRoot, rel);
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      console.log(`  modified: ${rel}`);
    } catch (err) {
      process.stderr.write(
        `  ERROR: failed to modify '${rel}': ${err.message} — skipping (original recoverable from .vibecode-backup/ if a backup was made)\n`
      );
    }
  }

  // 4. Remove stale entries (toDelete) — directories get rm -rf, files get rm
  const deletedParents = new Set();
  for (const rel of toDelete) {
    const target = path.join(projectRoot, rel);
    let stat;
    try { stat = fs.statSync(target); } catch { continue; /* already gone */ }

    if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`  removed dir: ${rel}`);
    } else {
      fs.rmSync(target, { force: true });
      console.log(`  removed: ${rel}`);
    }

    // Collect all ancestor dirs for empty-parent sweep
    let parent = path.dirname(target);
    while (parent !== projectRoot && parent !== path.dirname(parent)) {
      deletedParents.add(parent);
      parent = path.dirname(parent);
    }
  }

  // 5. Empty-parent cleanup — deepest-first (longest path first)
  // Also collect any subdirectories that still exist under deleted ancestor dirs
  // (e.g. empty references/, scripts/, templates/ left behind when their parent
  //  skill dir had files deleted but the empty subdirs were never in the snapshot).
  const allDirsToTry = new Set(deletedParents);
  for (const dir of deletedParents) {
    // Walk any surviving child directories under this dir and add them deepest-first
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const child = path.join(dir, entry.name);
          allDirsToTry.add(child);
          // One more level (e.g. references/sub/)
          try {
            const subEntries = fs.readdirSync(child, { withFileTypes: true });
            for (const sub of subEntries) {
              if (sub.isDirectory()) allDirsToTry.add(path.join(child, sub.name));
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* dir may already be gone */ }
  }

  const sortedParents = [...allDirsToTry].sort((a, b) => b.length - a.length);
  for (const dir of sortedParents) {
    try {
      fs.rmdirSync(dir); // throws ENOTEMPTY or ENOENT — both are fine
    } catch {
      // ENOTEMPTY = still has contents; ENOENT = already gone; both are expected
    }
  }

  // 6. Write snapshot — sorted managed files only (not legacyDeletions phantoms),
  //    one per line. This matches install.sh which writes FILES (= managedFiles).
  //    legacyDeletions are re-derived from the manifest each run and do not need
  //    to be persisted in the snapshot.
  const snapshotPath = path.join(projectRoot, '.vc-installed-files');
  const snapshotContent = [...snapshotFiles].sort().join('\n') + '\n';
  fs.writeFileSync(snapshotPath, snapshotContent, 'utf8');
  console.log(`  snapshot written: .vc-installed-files`);

  // 7. Write version (matches install.sh line ~342)
  const versionPath = path.join(projectRoot, '.vc-version');
  fs.writeFileSync(versionPath, version + '\n', 'utf8');
  console.log(`  version written: .vc-version (${version})`);

  // 8. Ensure .gitignore excludes .vibecode-backup*/ (additive — never overwrites user content)
  try {
    const gitignorePath = path.join(projectRoot, '.gitignore');
    const backupPattern = '.vibecode-backup*/';
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, backupPattern + '\n', 'utf8');
      console.log(`  Added ${backupPattern} to .gitignore (created)`);
    } else {
      const existing = fs.readFileSync(gitignorePath, 'utf8');
      const alreadyPresent = existing.split('\n').some(line => line.trim().includes('.vibecode-backup'));
      if (!alreadyPresent) {
        const withNewline = existing.endsWith('\n') ? existing : existing + '\n';
        fs.writeFileSync(gitignorePath, withNewline + backupPattern + '\n', 'utf8');
        console.log(`  Added ${backupPattern} to .gitignore`);
      }
    }
  } catch (err) {
    process.stderr.write(`  Warning: could not update .gitignore: ${err.message}\n`);
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────────

const isCli = process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
if (isCli) {
  const args = process.argv.slice(2);

  const getFlag = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };
  const hasFlag = (flag) => args.includes(flag);

  const projectRoot = getFlag('--root');
  const kitRoot = getFlag('--kit-root');
  const resolverOverride = getFlag('--resolver');
  const jsonMode = hasFlag('--json');
  const applyMode = hasFlag('--apply');
  const forceEmptyOwned = hasFlag('--force-empty-owned');

  if (!projectRoot || !kitRoot) {
    console.error('Usage: node compute-sync-plan.mjs --root <projectRoot> --kit-root <kitRoot> [--json] [--apply] [--resolver <resolverPath>]');
    process.exit(1);
  }

  if (applyMode && !projectRoot) {
    console.error('--apply requires --root to be specified');
    process.exit(1);
  }

  // Load manifest from kit root
  const manifestPath = path.join(kitRoot, 'vc-manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    console.error(`Failed to read vc-manifest.json from ${kitRoot}: ${e.message}`);
    process.exit(1);
  }

  // Run resolve-manifest from kitRoot to get ownedPaths + managedFiles.
  // Uses top-level await (ESM) so stdout flushes synchronously before exit.
  // --resolver overrides the default path (useful for vc-publish dev→kit direction).
  const { execFileSync } = await import('node:child_process');
  const resolverScript = resolverOverride
    ? path.resolve(resolverOverride)
    : path.join(kitRoot, 'resolve-manifest.mjs');
  let resolvedJson;
  try {
    const out = execFileSync(
      process.execPath,
      [resolverScript, '--root', kitRoot, '--json'],
      { encoding: 'utf8' }
    );
    resolvedJson = JSON.parse(out);
  } catch (e) {
    console.error(`Failed to run resolve-manifest.mjs: ${e.message}`);
    process.exit(1);
  }

  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedKitRoot = path.resolve(kitRoot);

  const result = computeSyncPlan({
    projectRoot: resolvedProjectRoot,
    kitRoot: resolvedKitRoot,
    ownedPaths: resolvedJson.ownedPaths || [],
    managedFiles: resolvedJson.files || [],
    mergeFiles: resolvedJson.merge || [],
    copyIfMissing: resolvedJson.copyIfMissing || [],
    legacyDeletions: resolvedJson.legacyDeletions || [],
    missingDeclared: resolvedJson.missingDeclared || [],
    forceEmptyOwned,
  });

  if (result.aborted) {
    process.stderr.write(`\n${result.abortReason}\n`);
    process.exit(1);
  }

  if (applyMode) {
    applyPlan(
      result,
      resolvedProjectRoot,
      resolvedKitRoot,
      resolvedJson.ownedPaths || [],
      manifest.version || '0.0.0',
      resolvedJson.files || []
    );
  } else if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`toAdd (${result.toAdd.length}): ${result.toAdd.join(', ') || '(none)'}`);
    console.log(`toModify (${result.toModify.length}): ${result.toModify.join(', ') || '(none)'}`);
    console.log(`toDelete (${result.toDelete.length}): ${result.toDelete.join(', ') || '(none)'}`);
    console.log(`toPreserve (${result.toPreserve.length}): ${result.toPreserve.join(', ') || '(none)'}`);
    if (result.staleWarnings.length) {
      console.warn('staleWarnings:');
      for (const w of result.staleWarnings) console.warn(' ', w);
    }
  }
}
