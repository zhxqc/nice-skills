# Monitoring specification

## 1. Time window and state

Maintain durable state outside the skill folder, preferably under `.ai-monitor/` in the automation workspace:

```text
.ai-monitor/
├── last-success.json
├── reported-events.json
└── github-star-snapshot.json
```

- `last-success.json`: successful cutoff time in ISO 8601 with timezone.
- `reported-events.json`: canonical event key, first reported time, source URL and last material version.
- `github-star-snapshot.json`: capture time and current repository metadata.
- Start time is `max(last successful cutoff, current time - 24 hours)`. First run uses exactly the previous 24 hours.
- Use Beijing time in the report but preserve source timestamps and timezones internally.
- Update state atomically after the report is complete. Do not replace a valid baseline with a partial crawl.

## 2. Event identity and deduplication

Create a stable event key such as:

```text
organization/product/event-type/version
paper/arxiv-id/version
repository/owner/name/commit-or-release
```

Treat these as material updates worth reporting again:

- a new release, checkpoint, API availability tier or license;
- a changed system card, benchmark result or reproducibility artifact;
- a confirmed security finding, exploit scope or remediation;
- a new dataset/model version, substantive commit, release, PR merge or issue resolution.

Do not repeat unchanged launch posts, syndications, commentary, funding rumors or old benchmark tables.

## 3. AI news selection

Score each candidate from 0 to 3 on:

- capability or research impact;
- practical adoption impact;
- ecosystem or security impact;
- evidence quality and reproducibility.

Rank by total score, then recency. Normally select 4–8 items; select fewer when the window is quiet.

Each item must contain:

1. one-sentence conclusion;
2. event time and, when different, publication time;
3. why it matters;
4. key numbers or changes, attributed when self-reported;
5. original source link;
6. access, scale, context and license fields for model releases.

Vendor benchmarks are evidence about the vendor's claim, not independent validation. Say `官方测试` or `厂商披露` where appropriate.

## 4. Paper selection

Use arXiv/OpenReview/conference metadata to identify whether the item is a first submission or revision. For revisions, inspect the version notes or paper diff and include only substantive changes.

Prefer papers with one or more of:

- a clear methodological difference from prior work;
- strong, interpretable experimental evidence;
- code, data, raw trajectories or verification artifacts;
- direct relevance to Agents, evaluation, inference efficiency or safety.

Normally select 3–6. For each paper report:

- core contribution;
- difference from existing methods;
- headline experiment result with dataset/metric context;
- code/data status: open, promised, partial, or not disclosed;
- first-submission or revision time and original link.

Do not infer statistical significance, generality or reproducibility beyond the evidence provided.

## 5. GitHub star acceleration

### Candidate discovery

Use GitHub Trending, topic/search pages, release feeds and prior watchlists to discover candidates. Discovery rank is not the growth metric.

Exclude obvious mirrors, empty repositories, suspected star manipulation, marketing shells, stale repositories and unlicensed projects unless the risk itself is explicitly reported.

### Exact snapshot calculation

Given previous stars `P` and current stars `C`:

```text
added_stars = C - P
growth_rate = (C - P) / P × 100%
```

Call the result an exact snapshot delta only when both star counts came from GitHub and the capture times are known. Call it an exact **24-hour** delta only when the elapsed window is approximately 24 hours; otherwise state the actual hours.

If there is no previous baseline, use `无基线` for exact delta. A Trending daily count may be reported only as `估算（GitHub Trending 窗口）`.

Save at least:

```json
{
  "captured_at": "2026-08-27T09:15:00+08:00",
  "repositories": {
    "owner/repo": {
      "stars": 1234,
      "created_at": "2026-01-01T00:00:00Z",
      "pushed_at": "2026-08-27T00:30:00Z",
      "license": "Apache-2.0"
    }
  }
}
```

Select 5–10 repositories by absolute star additions, using growth rate and project substance as tie-breakers. Explain what each project does, why attention may be rising, recent substantive activity and maturity/security/license risk.

## 6. CoSER inspection

Always inspect all of these surfaces:

- repository default branch and recent commits;
- releases/tags;
- opened, merged and closed pull requests;
- newly opened, updated or closed issues;
- README/news changes;
- Hugging Face dataset card/files;
- published model cards/files.

Stars alone are not a substantive CoSER update. If nothing material changed during the window, use the required sentence without padding.

## 7. Quality gate

Before publishing, confirm:

- every item is inside the window or clearly labeled as a new disclosure about an older event;
- every factual claim has a nearby original link;
- event date and publication date are not conflated;
- star deltas are classified as exact, actual-window, estimated or unavailable;
- vendor measurements are labeled;
- no unchanged prior item is repeated;
- the closing actions are concrete and tied to the day's evidence.
