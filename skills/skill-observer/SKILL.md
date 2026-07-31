---
name: skill-observer
description: Inspect, audit, and report on locally available Codex Skills with human-readable health findings and optional explicit-invocation statistics. Use when the user asks what Skills are installed, which are common or unused, wants to check Skill health, duplicates, broken references, context size, scope, source, or requests a complete local Skill inventory.
---

# Skill Observer

Use the bundled [observatory script](scripts/observatory.mjs) for a read-only inventory of discoverable Codex Skills.

1. Identify whether the user wants a scan, a health check, or a complete report. Run `scan`, `doctor`, or `report` accordingly; default to `report` when the request is broad.
2. Run the bundled script from this Skill directory and use its rendered output as the report's source of truth. For a broad Markdown report, run `node scripts/observatory.mjs report --format markdown`. Do not replace it with a handcrafted inventory.
3. When the user asks for calling frequency, common Skills, uncommon Skills, or historical usage, **must** add `--with-codex-history`. Example: `node scripts/observatory.mjs report --format markdown --with-codex-history`. This opt-in mode counts explicit `$skill-name` mentions in local user messages. It never outputs chat text. Do not describe the result as complete usage because automatic Skill triggering has no stable local counter.
4. Add `--extra-root <path>` only for a user-specified Skill root. Do not silently merge the current task's Skill catalog, plugin metadata, or unscanned directories into the script's totals. Read [Codex Skill Locations](references/codex-skill-locations.md) only when location discovery or coverage needs explanation.
5. Preserve the report order: summary, common Skills, uncommon Skills, health dashboard, Skills needing attention, duplicates, context estimates, and coverage.
6. State exactly which filesystem locations and usage-history roots were scanned, missing, inaccessible, or outside reliable coverage. Treat current Codex metadata as supplementary information only when it is actually available; never invent paths.
7. Keep usage as `not-collected` unless history access was requested. Do not infer use from installation, enablement, discovery, metadata loading, or scan results.
8. Never surface a raw issue code such as `skill-md-too-large` as the primary human explanation. Preserve the script's Chinese title, impact, severity, and suggested action. Keep raw codes only in JSON or collapsed technical details.
9. Treat description similarity as a manual-review hint, separate structural health issues from relationship findings, and do not claim whole-bundle equality from a `SKILL.md` hash.
10. For requests to disable or delete Skills, report candidates and likely impact only. Do not perform those mutations.
11. Never disable, delete, or modify `skill-observer` itself.

The filesystem scan reads each discovered `SKILL.md` plus local file names and structure. It does not read resource-file contents or upload/report Skill bodies, prompts, source contents, or credentials. Opt-in usage analysis reads only local JSONL user-message records to match explicit `$skill-name` tokens; it outputs counts and timestamps, never message text. Exit code `0` means inspection completed even when findings exist; exit code `2` means a CLI or runtime error.
