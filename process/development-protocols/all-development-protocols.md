# Development Protocols

Canonical shared workflow rules for this repository live here.

Use this folder for durable, repo-specific operating instructions that must stay aligned across Claude, Codex, and future agent systems. Keep tool-specific bootstrapping in `AGENTS.md` and `CLAUDE.md`, but keep the actual shared protocol content here.

## Read Order

1. `orchestration.md`
2. `implementation-standards.md`
3. `plan-lifecycle.md`
4. `phase-programs.md`
5. `context-maintenance.md`

## File Roles

- `orchestration.md`
  Delegation rules, subagent status protocol, context isolation, feature-scope routing, and research-first rules for service-shaped work.
- `implementation-standards.md`
  Durable implementation standards, file-size guidance, error-handling preferences, quality gates, and commit hygiene.
- `plan-lifecycle.md`
  How plans are named, where they live, when to use feature folders, how EXECUTE handoff works, and how mixed legacy plan shapes should be treated.
- `phase-programs.md`
  How to run large multi-phase programs: umbrella plan, per-phase plan split, required research -> execute -> validate -> durable-report loop, blocker handling, and foundation-vs-expansion boundaries.
- `context-maintenance.md`
  How `process/context/` is organized, when to create or split groups, how to keep `all-context.md` accurate, and how long-lived knowledge differs from feature plans.

## Maintenance Rules

- Update these files first when shared workflow behavior changes.
- When `AGENTS.md`, `CLAUDE.md`, agent prompts, hook reminders, or skill guides describe shared repo workflow, they should point here instead of duplicating large blocks.
- After changing protocol files, re-run the relevant validators and any hook tests that resolve rule paths.
