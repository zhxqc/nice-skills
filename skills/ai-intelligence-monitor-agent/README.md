# AI 智能监控 Agent

这是一个可分享、可安装的 Codex Skill Agent，用于每天生成中文《AI 智能监控日报》。默认监控 AI 新闻、最新论文、GitHub 增星加速项目和 `Neph0s/CoSER`，建议每天北京时间 09:15 运行。

## 使用

1. 将整个 `ai-intelligence-monitor-agent` 文件夹放入 Codex Skills 目录。
2. 使用 `$ai-intelligence-monitor-agent` 调用。
3. 定时任务使用 `references/automation.md` 中的时间和提示词。
4. 将运行状态保存在工作区 `.ai-monitor/`，不要放进临时目录。

包内不包含账号、令牌或历史监控数据。GitHub Stars 的精确增量由 `scripts/github_star_diff.py` 对连续快照计算。
