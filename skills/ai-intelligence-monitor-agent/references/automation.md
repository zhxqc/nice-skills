# Automation configuration

Recommended schedule:

```yaml
schedule: "15 9 * * *"
timezone: "Asia/Shanghai"
```

Recommended automation prompt:

```text
使用 $ai-intelligence-monitor-agent 生成今天的《AI 智能监控日报》。联网核查自上次成功运行以来、最多过去24小时的真实新变化；首次运行检查过去24小时。保存 GitHub Stars 快照并与上次快照比较；仅在完整日报成功生成后更新 last_success。输出中文，附原始来源，不展示搜索过程。
```

The scheduler should pass its current trigger time to the agent. Store state in a durable workspace rather than a temporary directory. If a run fails, retry according to the host's normal policy without moving the successful cutoff forward.
