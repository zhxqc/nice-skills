# Primary-source registry

Use these as starting points, then link to the specific announcement, paper, release or repository page in the report.

## Model and product organizations

- OpenAI: <https://openai.com/news/>
- Anthropic: <https://www.anthropic.com/news>
- Google AI: <https://blog.google/technology/ai/>
- Google DeepMind: <https://deepmind.google/discover/blog/>
- Microsoft Research: <https://www.microsoft.com/en-us/research/blog/>
- Meta AI: <https://ai.meta.com/blog/>
- NVIDIA AI: <https://blogs.nvidia.com/blog/category/deep-learning/>
- Qwen: <https://qwen.ai/blog>
- Mistral AI: <https://mistral.ai/news>
- Hugging Face: <https://huggingface.co/blog>

For model facts, prefer the model card, system card, API documentation, GitHub release and license file over a marketing post.

## 聚合发现源（AI 新闻候选）

- AIHOT 匿名只读 API v1（无需 token，建议 60s+ 轮询，支持 ETag 条件请求）：
  - 过去 24 小时精选：`GET https://aihot.virxact.com/api/v1/items?mode=selected&window=24h&limit=20`
  - 热点榜：`GET https://aihot.virxact.com/api/v1/hot-topics`（当前热点与事件排名）
  - 日报：`GET https://aihot.virxact.com/api/v1/dailies/latest`（每天 08:00 北京时间）
  - RSS 精选：`https://aihot.virxact.com/feed.xml`（30 分钟以上轮询）
  - 分类：ai-models / ai-products / industry / paper / tip
  - 用途：AI 新闻候选的聚合发现层（覆盖官方博客 RSS、公众号、Hacker News 等中文与英文源），标题/摘要是 AI 生成，仅用于发现；重要数字、政策与原文引用必须回 `links.original` 原文核对，站内阅读页链接为 `links.aihot`
  - 边界：个人非商业与组织内部使用免费；对外商业产品、数据转售、批量再分发需书面授权；不输出正文

## Research

- arXiv AI new submissions: <https://arxiv.org/list/cs.AI/new>
- arXiv computation and language: <https://arxiv.org/list/cs.CL/new>
- arXiv machine learning: <https://arxiv.org/list/cs.LG/new>
- arXiv computer vision: <https://arxiv.org/list/cs.CV/new>
- OpenReview: <https://openreview.net/>
- Papers with Code: <https://paperswithcode.com/> — discovery aid; verify against the paper and repository.

Check relevant conference sites when acceptance, award or final-version status matters.

## GitHub

- Trending discovery: <https://github.com/trending>
- Repository metadata: `https://api.github.com/repos/{owner}/{repo}`
- Commits: `https://github.com/{owner}/{repo}/commits`
- Releases: `https://github.com/{owner}/{repo}/releases`
- Pull requests: `https://github.com/{owner}/{repo}/pulls`
- Issues: `https://github.com/{owner}/{repo}/issues`

Prefer authenticated GitHub APIs or an installed GitHub connector when available, but retain capture timestamps and do not expose credentials in state or reports.

## CoSER fixed watchlist

- Repository: <https://github.com/Neph0s/CoSER>
- Commits: <https://github.com/Neph0s/CoSER/commits/main>
- Releases: <https://github.com/Neph0s/CoSER/releases>
- Pull requests: <https://github.com/Neph0s/CoSER/pulls>
- Issues: <https://github.com/Neph0s/CoSER/issues>
- Dataset: <https://huggingface.co/datasets/Neph0s/CoSER>
- Organization/model search: <https://huggingface.co/Neph0s>
