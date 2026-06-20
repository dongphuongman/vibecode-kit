# Changelog

All notable changes to vibecode-pro-max-kit are documented in this file.

## [3.2.4] - 2026-06-20

### Fixed

- **Data-loss fix in `install.sh`:** the legacyDeletions pass `rm -rf`'d every listed directory unconditionally, including process-layout content dirs (`process/general-plans/reports`, `process/general-plans/references`, and the `_seeds` equivalents). Because `install.sh` is deterministic (no agent) it cannot run the adaptive safe-migration that `vc-update` Part D performs — so on the documented `curl install.sh | bash` upgrade path, a project with real reports/references content under those dirs would have that content **permanently destroyed** before `vc-update` ever ran. `install.sh` now guards process-layout content dirs: any non-empty `reports/` or `references/` directory under `process/` is **deferred** (preserved, not deleted) with a notice to run `vc-update`, which migrates the contents into task folders before removing the now-empty dir. Deprecated harness dirs (e.g. `.claude/skills/vc-*`) and dead files carry no user content and are still removed. Verified against a real v2.4.1 project: 15 real report/reference files preserved, 0 user-content loss, deprecated harness still cleaned up.

## [3.2.3] - 2026-06-20

### Fixed

- `vc-update` no longer skips the adaptive content migration when the installed version already matches the remote. Previously, version equality (`Step 5: Compare Versions`) stopped the run immediately — but the deterministic `install.sh` writes `.vc-version` to the new version *without* being able to run the adaptive legacy-layout migration (it has no agent). The documented upgrade flow is "run `curl install.sh | bash`, then run `vc-update` to finish migrating old folders" — yet `vc-update` would bail with "Already up to date. No changes applied," stranding legacy `reports/`/`references/` dirs and flat plans un-migrated. Now version equality runs a legacy-artifact scan first: if legacy-format dirs/plans exist, `vc-update` continues to the apply path and Part D migrates them into task folders (file diff stays empty, version unchanged); only when no legacy artifacts remain does it report up-to-date and stop. Fixed in both the skill body and the `references/vc-update.md` deep reference.

## [3.2.2] - 2026-06-20

### Fixed

- `legacyDeletions` self-contradiction removed: the ledger carried both the bare directory `process/development-protocols/references` AND the live, shipped file `process/development-protocols/references/program-goal-charter-template.md` underneath it. On `vc-update`/install the bare-dir deletion would recursively wipe the directory — destroying the charter template that `all-development-protocols.md` references. The bare-dir entry is dropped (ledger 23→22); the two genuinely-dead PRD files under that path remain individually listed, so the template survives an upgrade while the dead files are still cleaned up.
- Shipped the missing `validate-agent-frontmatter.mjs` validator. The agent-frontmatter behavior validator existed in the development harness and is referenced by the audit suite, but a prior publish never copied it into the kit — so no install or `vc-update` could ever run it. It is now part of the kit's `.claude/skills/vc-audit-vc/scripts/` set.

## [3.2.1] - 2026-06-20

### Fixed

- `legacyDeletions` ledger now actually shipped: the kit was stranded at 16 entries while v3.2.0's changelog advertised 23. The 7 deprecated `reports/`/`references/` stale-dir paths (`process/general-plans/reports`, `process/general-plans/references`, `process/development-protocols/references`, and 4 `_seeds` reports/references paths) are now present, so a downstream `vc-update` will clean them up as intended.
- `AGENTS.md` task-folder convention propagated: the kit's `AGENTS.md` still taught the deprecated `reports/`/`references/` sibling-dir layout (instructing agents to *create* those dirs). It now describes the task-folder convention and safe legacy-dir migration, matching the seed guides and `vc-setup`/`vc-update`.

### Changed

- `vc-publish` no longer silently drops non-version manifest fields. The publish flow now reconciles `vc-manifest.json` explicitly: `version` is bumped, `legacyDeletions` (the deprecation ledger — a literal path array, not a glob) is auto-synced dev→kit every publish, and all other fields run through a field-level drift report so packaging deltas (test-file excludes, kit-only tooling) are reconciled consciously instead of silently desyncing. This is the root-cause fix for the two misses above.

## [3.2.0] - 2026-06-20

### Added

- Seed `_GUIDE` templates rewritten for the task-folder structure — deprecated `reports/` and `references/` sibling-dir guidance removed from all 6 seed guides.
- `vc-setup` Merge Mode: detects an already-installed harness, auto-migrates stale `reports/`/`references/` folders into the task-folder layout, with a conservative pre-create safe-inference fallback and dual-file (`SKILL.md` + `references/`) sync.
- `vc-update` safe-migration-before-deletion sequencing and 5-class orphan detection with a `.vc-orphaned-dirs.log` audit trail.
- `legacyDeletions` expanded from 16 to 23 entries (7 new literal stale-dir paths).
- Autopilot Mode protocol additions and phase-program / plan-lifecycle protocol refinements.

### Changed

- 52 managed files updated across Claude agents, Codex mirror, `vc-setup`/`vc-update`/`vc-autopilot` skills, seed guides, and development protocols.

## [3.1.0] - 2026-06-15

### Added

- Frontmatter-driven keyword routing with a drift-proof generated skills catalog/index — skills are discovered from `trigger_keywords` frontmatter instead of a hand-maintained table.
- `vc-setup` now delegates context-group authoring to `vc-generate-context` rather than scaffolding groups inline.

## [3.0.0] - 2026-06-14

### Breaking Changes

- Removed 11 deprecated skills: `vc-docs`, `vc-repomix`, `vc-xia`, `vc-chrome-devtools`, `vc-tech-graph`, `vc-watzup`, `vc-mcp-management`, `vc-context-engineering`, `vc-preview`, `vc-team`, `vc-merge-worktree`
- `vc-update` now applies `legacyDeletions` automatically — these dirs will be removed from your project on next upgrade
- PRD example references moved from `process/development-protocols/references/` to `.claude/skills/vc-generate-plan/references/`
- `parallel-fan-out.md` and `intent-clarification.md` removed — content merged into `orchestration.md`
- `vc-manifest.json` merge field now covers `.claude/settings.json` only (CLAUDE.md and AGENTS.md are no longer auto-merged by vc-update; they are updated by vc-update's normal file-copy logic)

### Added

**Agents (3 new — 15 total)**
- `vc-spec-agent` — SPEC phase: product-discovery requirements doc before INNOVATE
- `vc-validate-agent` — VALIDATE phase: convert plan to executable contract (V1–V7 gates) before EXECUTE
- `vc-quick-fix-agent` — QUICK FIX lane: lightweight lane for small low-risk changes, no plan/validate required

**Skills (13 new — 33 total)**
- `vc-agent-browser` — AI browser automation with Playwright
- `vc-agent-strategy-compare` — Execution strategy recommendation at every phase boundary
- `vc-autopilot` — Autopilot Mode: one trigger phrase → fully autonomous RIPER-5 run
- `vc-autoresearch` — Autonomous iterative optimization loop (gap-find → fix → repeat)
- `vc-feasibility-test` — Empirical feasibility probes before implementing
- `vc-generate-closeout` — Phase closeout packet and EVL handoff summary
- `vc-generate-spec` — Product-discovery requirements doc generator
- `vc-intent-clarify` — Ambiguity scoring and structured clarification round
- `vc-plan-discovery` — Active-plan discovery across feature folders
- `vc-review-situation` — Situation review and plan orientation for inner-loop agents
- `vc-risk-evidence-pack` — Evidence pack for high-risk work (auth/billing/schema)
- `vc-security` — STRIDE + OWASP-based security audit with auto-fix suggestions
- `vc-web-testing` — Playwright/Vitest/k6 test automation

**Protocols**
- `autopilot.md` — Autopilot Mode trigger phrases, consolidated clarification, provisional goal block format
- `communication-standards.md` — Answer-first (BLUF) + plain language communication standard for all agents
- `vc-autoresearch-spec.md` — Deep design reference for the autoresearch gap-loop primitive
- `vc-system-behavior/` (12-file split) — Each RIPER-5 phase has a machine-checkable behavior spec

**Validators (14 total — 10 D1 + 4 D2)**
- All 14 CI-enforced behavior validators now shipped with the kit
- `validate-protocol-discovery.mjs` — Enforces YAML frontmatter on all protocol files
- `validate-skill-keywords.mjs` — Asserts every SKILL.md has trigger_keywords + valid layer
- `validate-skill-invocation-wiring.mjs` — Catches naming regressions in skill invocations

**Other**
- `generated-skills-catalog.json` — Enables `discover-skills.mjs` (Routing Step 0) on fresh installs
- `CHANGELOG.md` and `MIGRATION.md` — Release documentation
- Autopilot Mode: one trigger phrase runs full R→SPEC→I→P→V→E→UP autonomously
- vc-publish now includes catalog-regen step, README badge check, and post-publish remote verify
- vc-update sub-case B: applies legacyDeletions even when no `.vc-installed-files` snapshot exists
- install.sh: applies legacyDeletions and runs post-install discover-skills self-check

### Changed

- All 15 agents and 33 skills updated to latest vc-system-behavior spec
- RIPER-5 flow extended: R→SPEC→I→P→V→E→UP (SPEC and VALIDATE are now full phases with dedicated agents)
- README.md: full rewrite with correct counts (15 agents, 33 skills, 8 non-router protocol root files, 10 hooks) and new selling points
- All 9 i18n README files updated with correct counts and new features
- vc-setup: added catalog generate-on-install safety check
- vc-publish: added skip-bump branch for "already at target version" case

### Migration

Run `vc-update` from your project to upgrade from v2.x. See [MIGRATION.md](MIGRATION.md) for step-by-step instructions.
