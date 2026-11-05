# 更新日志

本文件记录「LivingMemory 桌宠直连扩展 (cortico-world-astrbot-livingmemory)」的版本变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0-dev.9] - 2026-11-05

### 优化
- 面板改为两级：「连接」3 项 +「高级（默认即推荐）」5 项。全部配置项都在面板可见——之前精简过头，像 `captureMinLength` 这种有默认值的项被藏起来，用户不知道它存在。分组展示保留「默认不用改」的引导，又不失去知情权。

## [0.1.0-dev.8] - 2026-11-05

### 优化
- 配置面板精简到 3 项（桥地址 / 鉴权令牌 / 会话），其余项（超时、捕获频率、最短长度、人格标签）改用默认值，不再让用户改。
- 说明文案改短，只讲「要不要改」与「改了会怎样」。

## [0.1.0-dev.7] - 2026-11-05

### 新增
- 三组配置面板（桥接连接 / 记忆身份 / 对话捕获）：地址、令牌、超时、会话、人格标签、捕获开关、周期、最短长度都能在面板里改，不用手改 config.json。

### 优化
- 开源脱敏：默认值不再带任何真实账号与人名；`sessionId` / `personaId` 默认留空，自动使用桥端配置，装完即可用。
- 环境提示词去掉具体称呼，改为「用对话里实际出现的称呼、第三人称陈述」，任何用户都能直接用。
- README 重写为开源向：安装步骤、配对要求、配置表、五个常见问题（查不到记忆 / 人物分裂 / 401 / 记忆不生成 / 延迟）；去掉「极速」等形容，链接不写死仓库地址。
- LICENSE、package.json 描述与作者统一为 HirannU。

## [0.1.0-dev.6] - 2026-11-05

### 新增
- 环境提示词 `src/ENV_PROMPT.md`：告诉模型何时检索（具体话题而非「以前的事」）、何时记录（明确要求/约定/偏好，不记寒暄与调试）、`topics` 怎么给、以及称谓纪律（用对话里的具体称呼、第三人称陈述、不用泛称与代词）。
- 面板提示词文档：`webUi().promptDocs` 把该模板作为 `role=envPrompt` 交给宿主渲染，可在面板里直接编辑。
- 配置 `authToken` 正式启用：与桥的 `auth_token` 同值，请求自动带 `Authorization: Bearer`。

## [0.1.0-dev.5] - 2026-11-05

### 修复
- `stop()` 改为 async：宿主会 `await` 返回值，同步返回 undefined 时卸载会报「Cannot read properties of undefined (reading 'then')」。
- `start()` 同步改为 async，与宿主契约一致。

## [0.1.0-dev.4] - 2026-11-05

### 修复
- 扩展加载失败（`mod.envPromptVars is not a function`）：补齐 World 接口要求的 `envPromptVars()`（本 World 无环境模板，返回 null 省略环境段）。

## [0.1.0-dev.3] - 2026-11-05

### 新增
- 配置 `authToken`：桥开启 token 校验时填同一个值，请求自动带 `Authorization: Bearer`。

### 优化
- 对话捕获最小长度默认从 2 提到 6，避免「嗯」「哦」这类附和变成噪声记忆。
- 请求超时从 3 秒放宽到 5 秒（桥在触发记忆总结后要回执，偶尔会慢一点）。

> 记忆蒸馏已由桥侧接管：`/api/memory/chat` 写入后桥会自动按 LivingMemory 的阈值判定并调度总结任务，桌宠对话可直接长成长期记忆，无需本插件额外操作。

## [0.1.0-dev.2] - 2026-11-05

### 修复
- 对话流推送失败时不再推进游标：原先先进游标再推送，桥短暂不可用就会永久丢掉那批对话；现在失败保留游标下轮重试，连续失败 5 次才跳过并记警告。
- `mem_record` 支持可选 `topics`：传入主题词后由桥写进知识图谱，检索相关话题时更容易召回这条记忆。

## [0.1.0-dev.1] - 2026-11-05

### 新增
- 初始正式版本发布：作为 Coopanion 桌面宠物端的独立 World 扩展（基于 Cortico World API 6 规范）。
- 极速 HTTP 桥接适配器：提供对 AstrBot 端 `astrbot_plugin_livingmemory_bridge` 本地 REST 服务（默认 `127.0.0.1:6198`）的高速调用，内置超时与优雅降级熔断。
- 注册检索工具 `mem_search`：供大模型在对话决策时按需触发 LivingMemory 混合向量、BM25 全文及实体图谱召回。
- 注册记录工具 `mem_record`：供大模型沉淀关键事实、生活偏好与重要设定。
- 对话流事件捕获器：周期性从宿主事件流中增量提取用户与桌宠对话轮次，自动推送至 AstrBot 端 `ConversationManager`，打通记忆统一蒸馏。

### 修复
- 修正 `defaults` 声明为工厂函数 `() => ({ ...LIVINGMEMORY_DEFAULTS })`，对齐 Cortico World API 6 校验契约。
- 修正 `tools()` 返回结构为 `ToolDef[]` 数组，解决 WebUI 与模型调度器工具解析异常。
