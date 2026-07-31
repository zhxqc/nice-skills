# nice-skills

个人维护的开源 Agent Skills 集合仓库。每个 Skill 都独立放在 `skills/<skill-name>/`，可以单独安装和使用。

## Skills

- `skill-observer`：按需、只读检查本机可发现的 Codex Skills，输出直观的分段式 Markdown 报告，包含常用/不常用 Skill、结构体检、问题解释、重复关系和静态上下文占用。

后续 Skill 会继续以独立目录加入此列表；不会为尚未实现的 Skill 创建空目录。

## 安装

从 GitHub 安装单个 Skill：

```bash
npx skills add zhxqc/nice-skills \
  --skill skill-observer \
  -g \
  -a codex
```

也可以手动复制 `skills/skill-observer/` 目录到 Codex 可发现的 Skill 目录中。Skill 默认在本地运行，不需要 `npm install`；脚本只使用 Node.js 20+ 标准库。

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
