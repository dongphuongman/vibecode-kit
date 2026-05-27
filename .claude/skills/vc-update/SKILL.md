---
name: vc:update
description: Pull latest agent harness improvements from the remote kit repository. Shows a dry-run diff summary, waits for confirmation, then applies updates.
metadata:
  author: vibecode
  version: "1.0.0"
---

# vc-update

Pull the latest agent harness improvements from the remote vibecode-pro-max-kit repository into the current project.

## When to Use

- After being told a new harness version is available
- Periodically to check for updates
- After bootstrapping a project with `vc-setup` and wanting the latest improvements

## Workflow

Follow these steps exactly. Do NOT skip the dry-run or confirmation step.

### Step 1: Check Worktree Status

Run `git status --porcelain` in the project root.

- If output is non-empty: **warn** the user that they have uncommitted changes and suggest `git stash` or committing first. **Do not block** -- continue after warning.
- If output is empty: proceed silently.

### Step 2: Read Current Version

Read the file `.vc-version` in the project root.

- If it exists: store its contents as `currentVersion` (a semver string like `1.0.0`).
- If it does not exist: set `currentVersion` to `"0.0.0"` (treat as first update).

### Step 3: Clone Remote Repository

```bash
TMPDIR="/tmp/vc-update-$(date +%s)"
git clone --depth 1 https://github.com/withkynam/vibecode-pro-max-kit.git "$TMPDIR"
```

If the clone fails (network error, auth error, repo not found):
- Print the error message.
- Clean up the temp directory if it was partially created.
- **Stop.** Do not proceed.

### Step 4: Read Remote Manifest

Read and parse `vc-manifest.json` from the cloned repo at `$TMPDIR/vc-manifest.json`.

If the file is missing or contains invalid JSON:
- Print a parse error message.
- Remove `$TMPDIR`.
- **Stop.** Do not proceed.

Extract these fields:
- `version` (string) -- the remote version
- `managed` (array of strings) -- individual managed file paths
- `managedDirs` (array of strings) -- managed directory paths
- `seedsDir` (string) -- path to seeds directory (typically `process/_seeds/`)
- `symlinks` (object) -- symlink path -> target mappings
- `deletions` (array of strings) -- files to delete

### Step 5: Compare Versions

Compare `version` from the manifest against `currentVersion`.

- If they are equal: report **"Already up to date (vX.Y.Z)"** and clean up `$TMPDIR`. **Stop.**
- If remote is newer (or currentVersion is `0.0.0`): continue to diff.

### Step 6: Diff Managed Files

For each path in the `managed` array:

1. Check if the file exists locally at `{projectRoot}/{path}`.
2. If it exists: run `diff` between `$TMPDIR/{path}` and `{projectRoot}/{path}`.
   - If identical: mark as **unchanged**.
   - If different: mark as **modified**. Note the number of lines changed.
3. If it does not exist locally: mark as **new**.

Collect results into a summary list.

### Step 7: Diff Managed Directories

For each directory path in the `managedDirs` array:

1. List all files recursively in `$TMPDIR/{dirPath}/`.
2. List all files recursively in `{projectRoot}/{dirPath}/` (if it exists).
3. Compare the two file lists:
   - Files in remote but not local: mark as **added**.
   - Files in local but not remote: mark as **will remove** (rsync-style sync removes extras).
   - Files in both: diff content. Mark as **modified** or **unchanged**.

Collect results into a summary list.

### Step 8: Diff Seeds Directory

Compare the `process/_seeds/` directory between remote and local:

1. List all files recursively in `$TMPDIR/process/_seeds/`.
2. List all files recursively in `{projectRoot}/process/_seeds/` (if it exists).
3. Compare:
   - Files in remote but not local: mark as **added**.
   - Files in local but not remote: mark as **will remove**.
   - Files in both: diff content. Mark as **modified** or **unchanged**.

Seeds are **managed reference material** -- they are overwritten entirely on update. Real working files outside `_seeds/` (such as `process/context/`, `process/features/`, `process/general-plans/`) are **NEVER touched**.

### Step 9: Check Deletions

For each path in the `deletions` array:

- If the file exists locally: mark as **will delete**.
- If the file does not exist: mark as **already removed**.

### Step 10: Check Symlinks

For each entry in the `symlinks` object (key = symlink path, value = target):

- If the symlink exists and points to the correct target: mark as **ok**.
- If the symlink is missing or points to a different target: mark as **will fix**.
- If a real directory exists at the symlink path (not a symlink): mark as **will replace dir with symlink**.

### Step 11: Print Dry-Run Summary

Print a summary table with all collected results. Format:

```
vc-update dry run: v{currentVersion} -> v{remoteVersion}

MANAGED FILES:
  [modified]  .claude/agents/execute-agent.md  (+12 -3)
  [new]       .claude/hooks/lib/new-util.cjs
  [unchanged] .claude/agents/debugger.md
  ...

MANAGED DIRECTORIES:
  .claude/skills/scout/
    [modified]  SKILL.md  (+5 -2)
    [added]     references/new-ref.md
  .claude/skills/vc-update/
    [unchanged] (no changes)
  ...

SEEDS (process/_seeds/):
  [modified]  context/all-context.md.seed  (+8 -1)
  [added]     features/_new-template/_GUIDE.md.seed
  ...

DELETIONS:
  [will delete]    .claude/skills/deprecated-skill/SKILL.md
  [already removed] .old-config

SYMLINKS:
  [ok]        .agents/skills -> ../.claude/skills
  [will fix]  .codex/hooks -> ../.claude/hooks

Summary: 5 modified, 2 new, 1 deletion, 1 symlink fix, 45 unchanged
```

### Step 12: Wait for Confirmation

**STOP HERE.** Tell the user:

> "This is a dry-run summary. Type **apply** to proceed with the update, or **abort** to cancel. The temp clone will be cleaned up either way."

Do NOT proceed until the user explicitly says "apply" (or a clear affirmative like "yes", "go", "do it").

If the user aborts:
- Remove `$TMPDIR`.
- Print "Update cancelled. No changes made."
- **Stop.**

### Step 13: Apply Changes

On user confirmation, apply in this order:

1. **Managed files**: For each file in `managed` array, copy from `$TMPDIR/{path}` to `{projectRoot}/{path}`. Create parent directories as needed. Overwrite existing files.

2. **Managed directories**: For each dir in `managedDirs` array:
   - Delete the local directory entirely: `rm -rf {projectRoot}/{dirPath}`
   - Copy the remote directory: `cp -R $TMPDIR/{dirPath} {projectRoot}/{dirPath}`
   - This is rsync-style: remote is the source of truth.

3. **Seeds**: Overwrite the entire local `process/_seeds/` directory:
   - `rm -rf {projectRoot}/process/_seeds/`
   - `cp -R $TMPDIR/process/_seeds/ {projectRoot}/process/_seeds/`

4. **Deletions**: For each path in `deletions` array:
   - If the file exists locally: delete it.
   - If it is a directory: `rm -rf`.

5. **Symlinks**: For each entry in `symlinks`:
   - If a real directory exists at the path: `rm -rf` it first.
   - If a wrong symlink exists: `rm` it first.
   - Create the symlink: `ln -s {target} {path}`

6. **Write version**: Write the manifest version string to `.vc-version` in the project root.

7. **Clean up**: Remove `$TMPDIR`.

If any copy/delete fails with a permission error:
- Print which file failed and the error.
- Suggest running `chmod` on the affected path or checking file ownership.
- Continue with remaining files (do not abort the entire update).

### Step 14: Print Applied Changes Summary

```
vc-update complete: v{currentVersion} -> v{remoteVersion}

Applied:
  5 files modified
  2 files added
  1 file deleted
  1 symlink fixed
  Seeds directory updated

Version written to .vc-version: {remoteVersion}
```

## Rules

- `process/_seeds/` is managed reference -- overwrite entirely on update.
- Real working files outside `_seeds/` (`process/context/`, `process/features/`, `process/general-plans/`) are **NEVER** touched by vc-update.
- Always show the dry-run diff before applying. Never apply without user confirmation.
- Clean up the temp clone directory even on error or abort.
- If `.vc-version` is missing, treat as version `0.0.0` (first update, apply everything).
- Managed directories use rsync-style sync: the remote version completely replaces the local version.
- Individual managed files are overwritten in place.

## Reference

For detailed algorithm, error handling matrix, and edge cases, see `references/vc-update.md`.
