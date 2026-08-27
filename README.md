# nice-skills

个人维护的开源 Agent Skills 集合仓库。每个 Skill 都独立放在 `skills/<skill-name>/`，可以单独安装和使用。

## Skills

- `skill-observer`：按需、只读检查本机可发现的 Codex Skills，输出直观的分段式 Markdown 报告，包含常用/不常用 Skill、结构体检、问题解释、重复关系和静态上下文占用。
- `neat-freak`：在开发或发布收尾时，对齐代码、运行证据、项目文档、Agent 规则、获准维护的记忆和工作区残留，并按风险区分已验证、待决和范围外事项。
- `ai-intelligence-monitor-agent`：每日生成中文《AI 智能监控日报》，覆盖 AI 新闻、最新论文、GitHub 增星加速项目和 `Neph0s/CoSER` 定向监控；证据导向、附原始来源，支持定时运行与快照差分。

后续 Skill 会继续以独立目录加入此列表；不会为尚未实现的 Skill 创建空目录。

## 安装

从 GitHub 安装单个 Codex Skill：

```bash
npx skills add zhxqc/nice-skills \
  --skill skill-observer \
  -g \
  -a codex
```

将 `--skill` 替换为 `neat-freak` 或 `ai-intelligence-monitor-agent` 即可安装对应 Skill。通用 Agent Skills 宿主也可以手动复制对应目录：

```bash
cp -R skills/neat-freak ~/.agents/skills/
cp -R skills/ai-intelligence-monitor-agent ~/.agents/skills/
```

`ai-intelligence-monitor-agent` 的运行时状态（上次成功时间、事件去重、GitHub Stars 快照）保存在工作区 `.ai-monitor/`，已加入 `.gitignore`，不入库。

Skill 默认在本地运行，不需要 `npm install`；仓库脚本只使用 Node.js 20+ 标准库。

## 隐私与边界

本项目是 Skills 集合，不是独立软件、后台服务、采集器、数据库、MCP Server、Plugin 或多 Agent 平台。`skill-observer` 默认只读，不持续监听调用，也不自动启用、禁用、移动或删除 Skill。

常规扫描只读取可发现 Skill 的 `SKILL.md`、文件名和目录结构，不读取脚本、引用或资源文件的内容，也不收集或上传用户提示词、源代码、聊天内容和凭证。内容哈希仅覆盖 `SKILL.md`，不会把描述相似直接判定为重复。

调用统计是显式开启的：添加 `--with-codex-history` 后，工具只在本地 Codex JSONL 用户消息中匹配明确写出的 `$skill-name`，报告仅输出次数和最近调用时间，不输出聊天正文。它不会把安装、发现或元数据加载误算为调用，也无法统计 Codex 的自动触发，因此结果会明确标成“显式调用”。未开启历史读取时显示“未统计”。启用状态无法可靠判断时显示 `unknown`。`doctor` 在成功完成检查后返回退出码 `0`，即使报告中存在问题。

## 开发

```bash
npm test
node skills/skill-observer/scripts/observatory.mjs --help
node skills/skill-observer/scripts/observatory.mjs report
node skills/skill-observer/scripts/observatory.mjs report --format markdown --with-codex-history
```

## License

MIT
