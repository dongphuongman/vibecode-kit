---
name: vc:publish
description: Push agent harness improvements from the current development repo to the remote kit repository. Diffs managed files, shows what changed, bumps version, and pushes.
metadata:
  author: vibecode
  version: "1.0.0"
---

# vc-publish

Push harness improvements from the current development repo to the remote kit repository (`vibecode-pro-max-kit`). This is the **maintainer** counterpart to `vc-update`.

- `vc-update` = **user** pulls latest harness INTO their project FROM the remote
- `vc-publish` = **maintainer** pushes improvements FROM the development repo TO the remote kit repo

## Prerequisites

- Local checkout of the kit repo (`git clone git@github.com:withkynam/vibecode-pro-max-kit.git`)
- `.vc-publish-config` file in the current repo root (see Configuration below)
- Git push access to the remote kit repo

## Configuration

Create `.vc-publish-config` in the repo root:

```json
{"kitRepoPath": "/path/to/vibecode-pro-max-kit"}
```

If this file is missing, ask the user for the kit repo checkout path and offer to create it.

## Workflow

### Step 1: Load Configuration

1. Read `.vc-publish-config` from the current repo root.
2. If missing, ask the user for the kit repo local checkout path.
3. Verify the path exists and contains `vc-manifest.json`.
4. Verify the kit repo worktree is clean (`git -C <kitRepoPath> status --porcelain`). If dirty, warn and ask whether to proceed or abort.

### Step 2: Read Manifest

5. Read `vc-manifest.json` from the kit repo checkout.
6. Extract current version, `managed` array, `managedDirs` array, `seedsDir`, `symlinks`, and `deletions`.

### Step 3: Diff Managed Files

7. For each file in the `managed` array:
   - If file exists in both repos: diff current repo copy vs kit repo copy. Classify as **modified** or **unchanged**.
   - If file exists in current repo but NOT in kit repo: classify as **new**.
   - If file exists in kit repo but NOT in current repo: classify as **removed**.

### Step 4: Diff Managed Directories

8. For each directory in `managedDirs`:
   - List files in both current repo and kit repo versions.
   - Compare file lists and content.
   - Classify each file as **added**, **removed**, **modified**, or **unchanged**.

### Step 5: Diff Seeds

9. Compare `process/_seeds/` in the current repo against `process/_seeds/` in the kit repo.
   - Classify each seed file as **modified**, **unchanged**, **new**, or **removed**.

### Step 6: Print Diff Summary

10. Print a summary table:

```
vc-publish diff: current repo -> kit repo (v1.2.3)
================================================

Managed files:
  Modified:  5
  New:       1
  Removed:   0
  Unchanged: 38

Managed directories:
  .claude/skills/scout        2 modified, 1 added
  .claude/skills/vc-setup     unchanged
  ...

Seeds (process/_seeds/):
  Modified:  2
  New:       0
  Removed:   0
  Unchanged: 12

Total changes: 8 files across 3 categories
```

### Step 7: STOP -- Confirm Publish

11. **STOP** and ask the user:
    - Confirm they want to publish these changes.
    - Specify version bump type: **patch**, **minor**, or **major**.
    - Or abort.

Version bump semantics:
- **Patch** (1.2.3 -> 1.2.4): hook fixes, skill doc updates, minor agent prompt tweaks
- **Minor** (1.2.3 -> 1.3.0): new skills, new agents, new development protocols
- **Major** (1.2.3 -> 2.0.0): CLAUDE.md structure changes, manifest schema changes, breaking workflow changes

### Step 8: Apply Changes

12. On confirm:
    - Copy all **modified** and **new** managed files from current repo to kit repo checkout.
    - For CLAUDE.md and AGENTS.md: use the kit repo's existing harness-only versions as base. Apply only methodology/structural changes. Do NOT copy the current repo's project-specific versions directly. See the reference doc for content stripping rules.
    - Sync each `managedDirs` directory: rsync-style replace (delete files in kit dir not present in current repo dir, copy all files from current repo dir).
    - Sync `process/_seeds/` from current repo to kit repo (overwrite entirely).
    - Handle **removed** managed files: if a file was removed from the managed list, add its path to the `deletions` array and delete from kit repo.
    - Update `vc-manifest.json`:
      - Bump `version` field per the chosen bump type.
      - Update `managed` array if files were added or removed.
      - Update `managedDirs` array if directories were added or removed.
      - Update `deletions` array with any newly removed paths.
    - Create symlinks if missing (`.agents/skills -> ../.claude/skills`, `.codex/hooks -> ../.claude/hooks`).

### Step 9: Leak Detection

13. Verify no project-specific content leaked into the kit repo:

```bash
# Must return empty -- any matches indicate leaked content
grep -ri "flowser\|tRPC\|Prisma\|Supabase\|CloakBrowser\|OpenClaw" CLAUDE.md AGENTS.md

# Must return empty -- no absolute paths
grep -r "/Users/" .
```

14. If leak detection fails:
    - Print the offending lines.
    - Revert the changes in the kit repo (`git -C <kitRepoPath> checkout .`).
    - STOP and report the leak. Do NOT commit or push.

### Step 10: Commit and Tag

15. In the kit repo:

```bash
cd <kitRepoPath>
git add -A
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
```

### Step 11: Push

16. Push to remote:

```bash
git push origin main && git push --tags
```

17. If push fails (e.g., rejected, auth error), report the error. The commit and tag are preserved locally for retry.

### Step 12: Print Summary

18. Print publish summary:

```
vc-publish complete
===================
Version:     v1.3.0 (was v1.2.3)
Files changed: 8
Remote:      git@github.com:withkynam/vibecode-pro-max-kit.git
Tag:         v1.3.0
```

## Rules

- **NEVER** copy project-specific files: `process/context/all-context.md` (with real content), `process/features/*`, `process/general-plans/*` (with real plans)
- **ALWAYS** verify no project-specific content leaked before committing (Step 9)
- **ALWAYS** show the diff summary before publishing (Step 6-7)
- CLAUDE.md and AGENTS.md require special handling -- never copy the development repo's project-specific versions directly
- Kit repo checkout path is stored in `.vc-publish-config` (add to `.gitignore`)
- The `vc-manifest.json` in the kit repo is the source of truth for what files are managed

## Reference

See `references/vc-publish.md` for the detailed algorithm, CLAUDE.md/AGENTS.md stripping rules, error handling, and example outputs.
