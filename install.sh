#!/usr/bin/env bash
set -euo pipefail

# vibecode-pro-max-kit installer
# Clean install with backup for both new and existing projects.
# Replaces .claude/, .codex/, .agents/, CLAUDE.md, AGENTS.md with kit versions.
# Preserves: process/ (user content). Merges .claude/settings.json (not replaced if present).
# After this script, run Claude Code and say "Run vc-setup" to
# auto-detect your project, scaffold process/, and populate context.

REPO="https://github.com/withkynam/vibecode-pro-max-kit.git"
# VC_KIT_SOURCE overrides the default remote.
# Accepts: a local filesystem path OR an alternate git URL.
# - Local directory: working tree is copied as-is (uncommitted changes included).
# - URL (or default remote): git clone --depth 1 is used.
REPO="${VC_KIT_SOURCE:-$REPO}"
# Fix M6: renamed from TMPDIR (shadows POSIX reserved env var) to VC_INSTALL_TMPDIR
VC_INSTALL_TMPDIR="${TMPDIR:-/tmp}/vc-kit-install-$$"
BACKUP_DIR=".vibecode-backup"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

cleanup() { rm -rf "$VC_INSTALL_TMPDIR" 2>/dev/null; }
trap cleanup EXIT

echo ""
echo "  vibecode-pro-max-kit installer"
echo "  ─────────────────────────────────"
echo ""

# Fix M5: Windows/WSL detection notice (early)
if [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* ]]; then
  echo "  Note: Windows detected (OSTYPE=$OSTYPE). Enable Developer Mode for true symlink support."
elif grep -qEi microsoft /proc/version 2>/dev/null; then
  echo "  Note: WSL detected. Enable Developer Mode for true symlink support."
  echo "  See: https://docs.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development"
fi

# ══════════════════════════════════════════════════════
# Preflight: Node.js required
# ══════════════════════════════════════════════════════
if ! command -v node &>/dev/null; then
  echo "  Error: Node.js is required but not found in PATH."
  echo "  Install Node.js >= 22 and try again."
  exit 1
fi

# Fix: Node.js major version gate (Node 22+ required for fs.globSync used in resolve-manifest.mjs)
NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "  Error: Node.js >= 22 required (found $(node --version))."
  echo "  resolve-manifest.mjs uses fs.globSync which requires Node.js 22+."
  exit 1
fi

# Clone or copy kit to temp
echo "  Fetching kit..."
if [ -d "$REPO" ]; then
  # Local directory: copy working tree as-is (uncommitted changes are included)
  mkdir -p "$VC_INSTALL_TMPDIR"
  ( cd "$REPO" && tar --exclude=.git --exclude=node_modules -cf - . ) | ( cd "$VC_INSTALL_TMPDIR" && tar -xf - )
else
  # Remote URL: shallow clone — verify git is available first
  if ! command -v git &>/dev/null; then
    echo "  Error: git is required to fetch from a remote URL but was not found in PATH."
    echo "  Install git and try again, or set VC_KIT_SOURCE to a local directory."
    exit 1
  fi
  git clone --depth 1 --quiet "$REPO" "$VC_INSTALL_TMPDIR"
fi

# Read version from manifest
VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$VC_INSTALL_TMPDIR/vc-manifest.json','utf8')).version)" 2>/dev/null || echo "unknown")
echo "  Kit version: $VERSION"
echo ""

# ══════════════════════════════════════════════════════
# Resolve manifest to get file list + metadata
# ══════════════════════════════════════════════════════
# Fix M7: capture stderr to a temp file so we can surface it on failure
_MANIFEST_ERR_FILE="$VC_INSTALL_TMPDIR/_manifest_stderr.txt"
MANIFEST_JSON=""
set +e
MANIFEST_JSON=$(node "$VC_INSTALL_TMPDIR/resolve-manifest.mjs" --root "$VC_INSTALL_TMPDIR" --json 2>"$_MANIFEST_ERR_FILE")
_MANIFEST_EXIT=$?
set -e
if [ -z "$MANIFEST_JSON" ] || [ "$_MANIFEST_EXIT" -ne 0 ]; then
  echo "  Error: Failed to resolve manifest (exit code $_MANIFEST_EXIT)."
  if [ -s "$_MANIFEST_ERR_FILE" ]; then
    echo "  Node error output:"
    sed 's/^/    /' "$_MANIFEST_ERR_FILE"
  fi
  echo "  Check: Node.js >= 22 is installed, and vc-manifest.json exists in the kit."
  exit 1
fi

# Extract file list, merge list, copyIfMissing list, and symlinks from JSON
FILES=$(echo "$MANIFEST_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  d.files.forEach(f => console.log(f));
")
MERGE_FILES=$(echo "$MANIFEST_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  d.merge.forEach(f => console.log(f));
")
COPY_IF_MISSING=$(echo "$MANIFEST_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  d.copyIfMissing.forEach(f => console.log(f));
")
SYMLINKS_JSON=$(echo "$MANIFEST_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  for (const [k,v] of Object.entries(d.symlinks)) console.log(k + '|' + v);
")
LEGACY_DELETIONS=$(echo "$MANIFEST_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  (d.legacyDeletions || []).forEach(f => console.log(f));
")
OWNED_PATHS=$(echo "$MANIFEST_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  (d.ownedPaths || []).forEach(f => console.log(f));
")
MISSING_DECLARED=$(echo "$MANIFEST_JSON" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  (d.missingDeclared || []).forEach(f => console.log(f));
")

# ── Kit-integrity guard: warn when manifest-declared files are absent from source ──
if [ -n "$MISSING_DECLARED" ]; then
  echo -e "  ${YELLOW}⚠ WARNING: Kit integrity check failed — the following declared kit files were not found on disk.${NC}" >&2
  while IFS= read -r mdf; do
    [ -z "$mdf" ] && continue
    echo -e "    ${YELLOW}missing:${NC} $mdf" >&2
  done <<< "$MISSING_DECLARED"
  echo -e "  ${YELLOW}  → The kit clone may be partial or corrupt. Re-clone the kit before updating.${NC}" >&2
  echo "" >&2
fi

# ══════════════════════════════════════════════════════
# Read prior installed-files snapshot (before backup)
# ══════════════════════════════════════════════════════
PRIOR_SNAPSHOT=""
if [ -f ".vc-installed-files" ]; then
  PRIOR_SNAPSHOT=$(cat .vc-installed-files)
fi

# ══════════════════════════════════════════════════════
# Backup existing setup (if any)
# ══════════════════════════════════════════════════════
HAS_EXISTING=false
if [ -d ".claude" ] || [ -d ".codex" ] || [ -d ".agents" ] || [ -f "CLAUDE.md" ] || [ -f "AGENTS.md" ]; then
  HAS_EXISTING=true
  echo -e "  ${YELLOW}Existing setup detected.${NC} Backing up..."
  # Rotate any prior backup so re-runs never silently overwrite it
  if [ -d "$BACKUP_DIR" ] && [ -n "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]; then
    ROTATED_DIR="${BACKUP_DIR}-$(date +%s)"
    mv "$BACKUP_DIR" "$ROTATED_DIR"
    echo -e "  ${YELLOW}Existing backup rotated to ${CYAN}${ROTATED_DIR}/${NC}"
  fi
  mkdir -p "$BACKUP_DIR"
  # Fix M7 (backup): use cp -f so re-runs overwrite read-only files from a prior backup
  chmod -R u+w "$BACKUP_DIR" 2>/dev/null || true

  # Back up directories
  [ -d ".claude" ] && cp -Rf .claude "$BACKUP_DIR/.claude" && echo -e "    ${YELLOW}Backed up${NC} .claude/"
  [ -d ".codex" ] && cp -Rf .codex "$BACKUP_DIR/.codex" && echo -e "    ${YELLOW}Backed up${NC} .codex/"
  [ -d ".agents" ] && cp -Rf .agents "$BACKUP_DIR/.agents" && echo -e "    ${YELLOW}Backed up${NC} .agents/"

  # Back up root protocol files
  [ -f "CLAUDE.md" ] && cp -f CLAUDE.md "$BACKUP_DIR/CLAUDE.md" && echo -e "    ${YELLOW}Backed up${NC} CLAUDE.md"
  [ -f "AGENTS.md" ] && cp -f AGENTS.md "$BACKUP_DIR/AGENTS.md" && echo -e "    ${YELLOW}Backed up${NC} AGENTS.md"
  [ -f "GUIDE.md" ] && cp -f GUIDE.md "$BACKUP_DIR/GUIDE.md" && echo -e "    ${YELLOW}Backed up${NC} GUIDE.md"

  echo -e "    Backup at: ${CYAN}$BACKUP_DIR/${NC}"
  echo ""
fi

# ══════════════════════════════════════════════════════
# Install kit — resolver-driven copy
# ══════════════════════════════════════════════════════
INSTALLED_COUNT=0
SKIPPED_MERGE=0
SKIPPED_COPY_IF_MISSING=0

echo "  Installing files..."

while IFS= read -r file; do
  [ -z "$file" ] && continue

  # Check if this file is in the merge list AND exists locally
  IS_MERGE=false
  while IFS= read -r mf; do
    [ "$file" = "$mf" ] && IS_MERGE=true && break
  done <<< "$MERGE_FILES"

  if [ "$IS_MERGE" = true ] && [ -f "$file" ]; then
    SKIPPED_MERGE=$((SKIPPED_MERGE + 1))
    continue
  fi

  # Check if this file is in the copyIfMissing list AND exists locally
  IS_COPY_IF_MISSING=false
  while IFS= read -r cim; do
    [ "$file" = "$cim" ] && IS_COPY_IF_MISSING=true && break
  done <<< "$COPY_IF_MISSING"

  if [ "$IS_COPY_IF_MISSING" = true ] && [ -f "$file" ]; then
    SKIPPED_COPY_IF_MISSING=$((SKIPPED_COPY_IF_MISSING + 1))
    continue
  fi

  # Create parent directory and copy
  mkdir -p "$(dirname "$file")"
  cp "$VC_INSTALL_TMPDIR/$file" "$file"
  INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
done <<< "$FILES"

# ══════════════════════════════════════════════════════
# Stale removal — remove kit-owned files that are no
# longer in the new manifest (snapshot-diff approach).
# NEVER removes user-owned files.
# ══════════════════════════════════════════════════════
if [ -n "$PRIOR_SNAPSHOT" ]; then
  echo "  Checking for stale kit files..."
  STALE_COUNT=0
  while IFS= read -r prior_file; do
    [ -z "$prior_file" ] && continue

    # Is this file still in the new ownedPaths?
    STILL_OWNED=false
    while IFS= read -r owned; do
      [ "$prior_file" = "$owned" ] && STILL_OWNED=true && break
    done <<< "$OWNED_PATHS"

    if [ "$STILL_OWNED" = false ] && [ -f "$prior_file" ]; then
      # Kit-owned namespace guard: only delete if it matches the kit namespace
      IS_KIT_NAMESPACE=false
      case "$prior_file" in
        .claude/skills/vc-*|.claude/agents/vc-*|.claude/hooks/*|.codex/*|\
        process/development-protocols/*|process/context/planning/*|\
        process/context/generated-skills-catalog.json|\
        process/_seeds/*|CLAUDE.md|AGENTS.md|\
        .vc-installed-files|.vc-version|.agents/*)
          IS_KIT_NAMESPACE=true
          ;;
      esac

      if [ "$IS_KIT_NAMESPACE" = true ]; then
        # Fix M4: warn when a vc-* prefixed path is about to be removed as stale
        # (it matched kit namespace but is NOT in the new manifest — warn before delete)
        case "$prior_file" in
          .claude/skills/vc-*|.claude/agents/vc-*)
            echo -e "    ${YELLOW}WARNING${NC}: removing vc-* prefixed path '$prior_file' as stale kit file."
            echo "    If this is a custom skill/agent you added, restore it from $BACKUP_DIR/."
            ;;
        esac
        rm -f "$prior_file"
        STALE_COUNT=$((STALE_COUNT + 1))
        echo "    removed stale: $prior_file"
      else
        echo -e "    ${YELLOW}WARN${NC}: '$prior_file' in old snapshot but not kit-namespace — preserved (check manually)"
      fi
    fi
  done <<< "$PRIOR_SNAPSHOT"

  # Clean empty parent directories (deepest-first)
  while IFS= read -r prior_file; do
    [ -z "$prior_file" ] && continue
    parent=$(dirname "$prior_file")
    while [ "$parent" != "." ] && [ "$parent" != "/" ]; do
      [ -d "$parent" ] && rmdir "$parent" 2>/dev/null || true
      parent=$(dirname "$parent")
    done
  done <<< "$PRIOR_SNAPSHOT"

  if [ "$STALE_COUNT" -gt 0 ]; then
    echo "    $STALE_COUNT stale kit file(s) removed."
  else
    echo "    No stale kit files."
  fi
elif [ -n "$LEGACY_DELETIONS" ]; then
  # No prior snapshot (first install or pre-snapshot install).
  # Print the pre-snapshot fallback caveat.
  echo ""
  echo -e "  ${YELLOW}Note:${NC} No prior .vc-installed-files snapshot found."
  echo "  Stale removal will rely on legacyDeletions only."
  echo "  If you have custom skills/agents whose names begin with 'vc-',"
  echo "  verify they were not removed in the legacyDeletions step below."
fi

# ══════════════════════════════════════════════════════
# Symlinks
# ══════════════════════════════════════════════════════
echo "  Setting up symlinks..."
while IFS= read -r line; do
  [ -z "$line" ] && continue
  LINK_PATH="${line%%|*}"
  LINK_TARGET="${line##*|}"
  mkdir -p "$(dirname "$LINK_PATH")"
  # Idempotent symlink setup with backup for displaced real paths.
  if [ -L "$LINK_PATH" ]; then
    # Already a symlink — check if it points to the correct target.
    CURRENT_TARGET=$(readlink "$LINK_PATH")
    if [ "$CURRENT_TARGET" = "$LINK_TARGET" ]; then
      # Already correct — leave it alone (no churn).
      continue
    else
      # Wrong symlink target — remove and recreate.
      rm -f "$LINK_PATH"
    fi
  elif [ -e "$LINK_PATH" ]; then
    # Real file or real directory — back it up before displacing.
    mkdir -p "$BACKUP_DIR/$(dirname "$LINK_PATH")"
    cp -r "$LINK_PATH" "$BACKUP_DIR/$LINK_PATH"
    rm -rf "$LINK_PATH"
    echo "  ⚠ replaced existing $LINK_PATH (backed up to $BACKUP_DIR/$LINK_PATH)"
  fi
  # Fix M1: symlink with fallback copy on failure (e.g. Windows without Developer Mode)
  if ln -sf "$LINK_TARGET" "$LINK_PATH" 2>/dev/null; then
    : # symlink created successfully
  else
    # Fallback: copy the target contents to the link path
    # LINK_TARGET is relative (e.g. ../.claude/skills); resolve from LINK_PATH's parent dir
    _LINK_PARENT_DIR="$(cd "$(dirname "$LINK_PATH")" && pwd)"
    _LINK_TARGET_ABS="$_LINK_PARENT_DIR/$LINK_TARGET"
    rm -rf "$LINK_PATH" 2>/dev/null || true
    if cp -r "$_LINK_TARGET_ABS" "$LINK_PATH" 2>/dev/null; then
      echo "  ⚠ ln -sf failed (Windows without Developer Mode?). Copied skills to $LINK_PATH; Codex discovery works but won't auto-reflect vc-update changes. Enable Developer Mode for true symlinks."
    else
      echo "  ⚠ WARNING: could not create $LINK_PATH (symlink and copy both failed)."
    fi
  fi
done <<< "$SYMLINKS_JSON"

# ══════════════════════════════════════════════════════
# Apply legacyDeletions — remove deprecated skill dirs + protocol files
# ══════════════════════════════════════════════════════
if [ -n "$LEGACY_DELETIONS" ]; then
  echo "  Removing deprecated paths (legacyDeletions)..."
  DELETED_DIRS=()
  DEFERRED_LAYOUT=()
  while IFS= read -r legacy_path; do
    [ -z "$legacy_path" ] && continue
    if [ -d "$legacy_path" ]; then
      # ── Content-safety guard ──────────────────────────────────────────────
      # install.sh is deterministic (no agent) and cannot run the adaptive
      # safe-migration that vc-update Part D performs. A process-layout content
      # dir (reports/ or references/ under process/) may hold real user files
      # (plans, reports, references). NEVER rm -rf such a dir when it is
      # non-empty — defer it to vc-update, which migrates the contents into
      # task folders BEFORE removing the empty dir. Deprecated harness dirs
      # (e.g. .claude/skills/vc-*) carry no user content and are still removed.
      base=$(basename "$legacy_path")
      case "$legacy_path" in
        process/*)
          if { [ "$base" = "reports" ] || [ "$base" = "references" ]; } \
             && [ -n "$(find "$legacy_path" -type f -print -quit 2>/dev/null)" ]; then
            echo "    deferred (has content — vc-update will migrate then remove): $legacy_path"
            DEFERRED_LAYOUT+=("$legacy_path")
            continue
          fi
          ;;
      esac
      rm -rf "$legacy_path"
      echo "    removed dir: $legacy_path"
      DELETED_DIRS+=("$legacy_path")
    elif [ -f "$legacy_path" ]; then
      rm -f "$legacy_path"
      echo "    removed file: $legacy_path"
      DELETED_DIRS+=("$(dirname "$legacy_path")")
    fi
  done <<< "$LEGACY_DELETIONS"
  # Clean empty parent directories deepest-first
  for dir in "${DELETED_DIRS[@]+"${DELETED_DIRS[@]}"}"; do
    parent="$dir"
    while [ "$parent" != "." ] && [ "$parent" != "/" ]; do
      parent=$(dirname "$parent")
      [ -d "$parent" ] && rmdir "$parent" 2>/dev/null || true
    done
  done
  if [ "${#DEFERRED_LAYOUT[@]}" -gt 0 ]; then
    echo "  ${#DEFERRED_LAYOUT[@]} legacy content dir(s) preserved (have files) — run vc-update to migrate them into task folders."
  fi
fi

# ══════════════════════════════════════════════════════
# Write snapshot + version
# ══════════════════════════════════════════════════════
echo "$FILES" | sort > .vc-installed-files
echo "$VERSION" > .vc-version

# Ensure .gitignore excludes .vibecode-backup*/ (additive — never overwrites user content)
BACKUP_PATTERN=".vibecode-backup*/"
if [ ! -f ".gitignore" ]; then
  echo "$BACKUP_PATTERN" > .gitignore
  echo "  Added $BACKUP_PATTERN to .gitignore (created)"
elif ! grep -q '\.vibecode-backup\*' .gitignore 2>/dev/null; then
  # Ensure trailing newline before appending
  if [ -s ".gitignore" ] && [ "$(tail -c1 .gitignore | wc -c)" -gt 0 ] && [ "$(tail -c1 .gitignore | od -An -tx1 | tr -d ' ')" != "0a" ]; then
    echo "" >> .gitignore
  fi
  echo "$BACKUP_PATTERN" >> .gitignore
  echo "  Added $BACKUP_PATTERN to .gitignore"
fi

cleanup

# ══════════════════════════════════════════════════════
# Post-install self-check: verify discover-skills works
# ══════════════════════════════════════════════════════
if node .claude/skills/vc-context-discovery/scripts/discover-skills.mjs >/dev/null 2>&1; then
  echo "  install.sh: discover-skills OK"
else
  echo "  Warning: discover-skills.mjs returned non-zero exit. Run manually to diagnose."
fi

# ══════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════
AGENT_COUNT=$(find .claude/agents -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
SKILL_COUNT=$(find .claude/skills -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
HOOK_COUNT=$(find .claude/hooks -maxdepth 1 \( -name '*.cjs' -o -name '*.mjs' \) 2>/dev/null | wc -l | tr -d ' ')

echo ""
echo -e "  ${GREEN}Install complete.${NC} (v$VERSION)"
echo ""
echo -e "    ${CYAN}Agents${NC}:     $AGENT_COUNT (Claude Code + Codex)"
echo -e "    ${CYAN}Skills${NC}:     $SKILL_COUNT"
echo -e "    ${CYAN}Hooks${NC}:      $HOOK_COUNT"
echo -e "    ${CYAN}Files${NC}:      $INSTALLED_COUNT installed"
if [ "$SKIPPED_MERGE" -gt 0 ]; then
  echo -e "    ${CYAN}Merge${NC}:      $SKIPPED_MERGE preserved (user config)"
fi
if [ "$SKIPPED_COPY_IF_MISSING" -gt 0 ]; then
  echo -e "    ${CYAN}Existing${NC}:   $SKIPPED_COPY_IF_MISSING skipped (already present)"
fi

if [ "$HAS_EXISTING" = true ]; then
  echo ""
  echo -e "  ${YELLOW}Previous setup backed up to ${CYAN}$BACKUP_DIR/${NC}"
  echo -e "  ${YELLOW}Your process/ directory was preserved (plans, context, features).${NC}"
fi

if [ "$HAS_EXISTING" = true ] && [ -z "$PRIOR_SNAPSHOT" ]; then
  echo ""
  echo -e "  ${YELLOW}Note:${NC} No prior snapshot found. Custom vc-prefixed skills/agents"
  echo "  (if any) may have been treated as kit-owned during legacyDeletions."
  echo "  Run: ls .claude/skills/ .claude/agents/ to verify your custom files."
fi

echo ""
if [ "$HAS_EXISTING" = true ]; then
  # Upgrade path: existing harness detected before install — route to vc-update
  echo "  Next (upgrade detected):"
  echo "    1. Run: claude"
  echo '    2. Say: "Run vc-update"'
  echo ""
  echo "  vc-update will sync the new version and, if it finds old-format plans,"
  echo "  context docs, or folders, hand you a ready-to-paste prompt to finish"
  echo "  the migration."
else
  # Fresh install path: no prior harness — route to vc-setup
  echo "  Next:"
  echo "    1. Run: claude"
  echo '    2. Say: "Run vc-setup"'
  echo ""
  echo "  vc-setup will auto-detect your project, scaffold the process/"
  echo "  directory, deep-scan your codebase, and populate context with"
  echo "  your real architecture, patterns, test commands, and conventions."
fi
echo ""
