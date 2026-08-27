---
name: ai-intelligence-monitor-agent
description: Generate evidence-backed Chinese AI monitoring reports for a rolling 24-hour window, covering AI news, new papers, GitHub star acceleration, and the Neph0s/CoSER project. Use for daily AI briefings, scheduled AI intelligence monitoring, or requests to compare repository growth between saved snapshots.
---

# AI Intelligence Monitor Agent

Produce a concise Chinese report about genuinely new AI developments. Browse the internet on every run; do not rely on model memory for current facts.

## Run the monitor

1. Determine the window from the last successful run. Use `max(last_success, now - 24 hours)` as the start; on the first run use the previous 24 hours. Show the window and Beijing cutoff time in the report.
2. Read [references/monitoring-spec.md](references/monitoring-spec.md) before gathering or ranking items. Use [references/source-registry.md](references/source-registry.md) as the primary-source checklist.
3. Gather four tracks independently:
   - AI news: model releases, Agents, multimodal and edge AI, open source, evaluations, products/APIs, research and major industry changes.
   - Papers: new submissions or substantive revisions in LLMs, Agents, evaluation, reasoning, multimodal learning, training/alignment, efficiency, edge AI and safety.
   - GitHub acceleration: identify AI repositories with fast star growth and compare current stars with the saved snapshot.
   - CoSER: inspect commits, releases, pull requests, issues, datasets and model pages for `Neph0s/CoSER`.
4. Use `scripts/github_star_diff.py` for deterministic snapshot differences when two snapshots are available. Never describe GitHub Trending counts or cumulative stars as exact 24-hour growth.
5. Write the report with [references/report-template.md](references/report-template.md). Select by importance rather than filling quotas.
6. Only after a complete report succeeds, persist the current repository snapshot and update the last-success timestamp. A failed or partial run must not advance `last_success`.

## Non-negotiable rules

- Prefer official announcements, papers, model cards, system cards, GitHub/Hugging Face pages and regulator or company notices. Use secondary reporting only for discovery or clearly attributed context.
- Distinguish the event date from the article publication date. An old event republished today is not new.
- Do not repeat a previously reported item unless it has a material new release, benchmark, incident finding, license change or other decision-relevant development.
- Label unverified claims `传闻/待确认`. Do not turn inference into fact.
- For every model, report institution, model name, access method, important capabilities, disclosed context/parameter scale, license and original link. Say `官方未披露` when a field is unavailable.
- For every paper, distinguish first submission from revision and state the code/data availability. Do not claim reproducibility merely because a PDF exists.
- For every repository, include added stars, current stars, growth rate, approximate age, last substantive commit, license and a maturity or integrity risk.
- If exact star deltas are unavailable, label the number `估算`, state the measurement window and basis, and avoid false precision.
- If CoSER has no material change, write exactly: `CoSER 今日无实质更新`.
- Output Chinese, keep it quickly scannable, attach clickable original sources, and omit the search process and tool names.

## Scheduled use

The intended schedule is every day at 09:15 in `Asia/Shanghai`. Read [references/automation.md](references/automation.md) when configuring or transferring the automation.
