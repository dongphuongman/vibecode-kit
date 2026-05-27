---
name: vc:setup
description: Set up the complete agent harness in any project. Handles everything automatically — clones the kit, installs files safely (merges with existing configs), studies your codebase, populates context, and validates.
metadata:
  author: vibecode
  version: "3.1.0"
---

# VibeCo Agent Harness Setup

Set up the complete agent development harness in any project. Works on fresh projects and existing projects with pre-existing `.claude/` configs.

The skill handles everything: fetch the harness, install files safely, detect the project, scaffold process directories, study the codebase to populate context with real content, and validate the result.

CLAUDE.md and AGENTS.md are managed protocol files (orchestrator, RIPER-5 methodology, routing). They contain zero project-specific content and should NOT be adapted. Project-specific information lives in `process/context/all-context.md`, which is populated during the STUDY phase.

## Prerequisites

- The target repo should have a `package.json` (or equivalent project manifest).
- That's it. The skill handles the rest.

## Workflow

Read `references/vc-setup.md` for detailed phase instructions, detection heuristics, parallel subagent delegation strategy, and validation checks.

### Phase 0: BOOTSTRAP (handled by install.sh)

The `install.sh` script handles fetching and installing harness files before vc-setup runs. For existing projects, it backs up old `.claude/`, `.codex/`, `.agents/` to `.vibecode-backup/`, then does a clean install of all kit files. User's `.claude/settings.json` is restored after install. The `process/` directory is never touched by install.sh — layout migration happens in vc-setup's SCAFFOLD phase.

**If harness files are already present** (`.claude/agents/` and `.claude/skills/` exist with 12+ agents and 20+ skills), skip Phase 0 and proceed directly to Phase 1 DETECT.

**If harness files are NOT present**, tell the user to run the installer first:
```
curl -fsSL https://raw.githubusercontent.com/withkynam/vibecode-pro-max-kit/main/install.sh | bash
```

Then re-run vc-setup.

### Phase 1: DETECT

Gather information about the target project before making any changes.

1. Read `package.json` to detect the package manager (`packageManager` field, lockfile presence), framework (dependencies), and test commands (scripts).
2. Detect monorepo structure: `workspaces` in `package.json`, `pnpm-workspace.yaml`, `apps/`, `packages/` directories.
3. Scan for existing `process/`, `docs/`, `.github/` directories and any context files.
4. Present a detection summary to the user and wait for confirmation before proceeding.

### Phase 2: SCAFFOLD

Create the `process/` directory with seed files and instructional content.

1. Determine the scaffold mode:
   - **Fresh**: no existing `process/` directory -- create everything from `process/_seeds/`.
   - **Merge**: existing `process/` with a different layout -- preserve content, migrate old layout, add missing directories, seed empty folders.
   - **Refresh**: existing harness `process/` -- update protocol docs, seed missing files, preserve user-created content.

**Merge mode includes automatic layout migration.** Before creating new directories, detect and migrate old layouts:

| Old Layout | Migration Action |
|------------|-----------------|
| `process/plans/` exists, `process/general-plans/` does not | Move `process/plans/*` → `process/general-plans/active/`, then remove empty `process/plans/` |
| `process/reports/` exists at top level | Move `process/reports/*` → `process/general-plans/reports/`, then remove empty `process/reports/` |
| `process/skills/` exists at top level | Move `process/skills/*` → `process/general-plans/references/`, then remove empty `process/skills/` |
| `process/context/example-*.md` (PRDs outside planning/) | Move to `process/context/planning/` |
| `process/context/backlog.md` at top of context/ | Move to `process/general-plans/backlog/` |

**Migration rules:**
- Never overwrite existing files at the destination. If a file with the same name exists, keep both (rename the migrated copy with a `-migrated` suffix).
- Print every move action to the user so they can verify.
- After all moves, remove empty source directories.
- If `process/plans/` contains files matching date-based patterns (e.g., `2026-05-22-*.md`, `*_PLAN_*.md`), classify completed plans (look for "COMPLETE" or "DONE" in the file) and move them to `completed/` instead of `active/`.
2. Seeds live in `process/_seeds/` (read-only during setup -- never modified by the scaffold process):
   - Files with `.seed` extension: copy with `.seed` removed, replace `{{project_name}}` with the detected project name.
   - Files without `.seed` extension: copy verbatim.
   - Context group seed folders use `-seed` suffix (e.g., `tests-seed/`, `planning-seed/`). When copying to real locations, drop the `-seed` suffix.
3. Copy development protocol docs from `process/development-protocols/` (these are managed system files, not seeds — they live in the real directory, not `_seeds/`).
4. Place `_GUIDE.md` files in empty process folders to explain what goes there.
5. Retain `.seed` originals alongside populated files: after copying and filling seed files, also copy the original `.seed` files to the target `process/` directory as structural reference companions. These `.seed` files serve as reference for what sections are expected, and future `vc-update` can diff against them to detect structural drift.
6. Use `_all-group-template.md.seed` as the base when creating new context group entrypoints during the STUDY phase.
7. Use `_feature-template/_GUIDE.md.seed` as the base when creating new feature folder guides during the STUDY phase. The `_feature-template/` now includes all 5 subdirectories (`active/`, `completed/`, `backlog/`, `reports/`, `references/`) with their own `_GUIDE.md` files.
8. See `references/vc-setup.md` for the full target directory tree and placeholder list.

### Phase 3: STUDY

Perform deep codebase analysis and populate context files with real, researched content.

This is the core value of v3 -- instead of leaving placeholder text, the STUDY phase actively reads the codebase and writes ready-to-use context.

1. **Architecture and stack analysis**: Scan source directories, detect frameworks with versions, map import aliases, catalog environment variables, identify key patterns and conventions.
2. **Test setup analysis**: Identify test runners, config files, test directories, and test commands per package/workspace.
3. **Context group detection**: Scan for project signals (database, auth, CI/CD, containers, UI systems, workflows) and create context groups where the project has substantial content.
4. **Feature area detection**: Identify major product areas from route groups, packages, and existing docs. Create feature folders for areas meeting the threshold (3+ source files, distinct product area).
5. **Populate all-context.md**: Write real repository structure, technology stack details, key patterns, environment configuration, and routing tables -- not placeholders.
6. **Populate all-tests.md**: Write actual test runner names, real test commands, and per-package breakdowns.
7. **Migration intelligence** (when existing process/ content is found): Read existing content, identify gaps vs fresh scan, fill only gaps while preserving user-written content.

See `references/vc-setup.md` for the full STUDY phase checklist, parallel subagent delegation strategy, context group detection table, and feature detection heuristics.

### Phase 4: VALIDATE

Verify the setup is complete, correct, and populated with real content.

1. Check all expected directories exist under `process/`.
2. Verify agent parity: agent names in `.claude/agents/` should match `.codex/agents/`.
3. Check that `.agents/skills` symlink exists and resolves.
4. Verify STUDY phase output quality:
   - `all-context.md` has no remaining `{{placeholder}}` text (except `{{project_name}}` if seed was just created)
   - `all-context.md` has a populated Repository Structure section with real directory tree
   - `all-context.md` has a populated Technology Stack section with specific versions
   - `all-tests.md` has actual test commands (not placeholder text)
   - Context groups created have corresponding entries in the routing tables
   - Feature folders created have `_GUIDE.md` files with real scope descriptions
5. Report any issues found.
6. Suggest running validation scripts if they exist in the target repo:
   - `node .claude/skills/generate-context/scripts/validate-all-context.mjs`
   - `node .claude/skills/audit-context/scripts/validate-context-discovery.mjs`

## Rules

- CLAUDE.md and AGENTS.md are managed protocol files. Do NOT adapt or modify them.
- Do not modify RIPER-5 methodology sections, phase transition rules, or key principles.
- Do not modify tool restriction lists in agent prompts.
- Do not modify the status reporting format (DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT).
- Always wait for user confirmation after the DETECT phase before making changes.
- In Merge mode, never overwrite existing user content.
- Project-specific information (tech stack, features, conventions) belongs in `process/context/all-context.md`, not in CLAUDE.md.
- In STUDY phase, write real researched content, not placeholder text. Every section should contain actual project-specific information discovered by scanning the codebase.
- For large repos (monorepos, 5+ source directories), spawn parallel subagents to maximize throughput and avoid context window exhaustion -- see reference doc for delegation strategy.
