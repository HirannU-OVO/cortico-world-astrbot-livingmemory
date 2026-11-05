# 更新日志

本文件记录「LivingMemory 桌宠直连扩展 (cortico-world-astrbot-livingmemory)」的版本变化。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-05

> 首个正式版：桌宠侧接入 AstrBot 的 LivingMemory，与 QQ 端共用同一套记忆库与知识图谱。

### 新增

- **记忆工具**：`mem_search`（混合向量 / BM25 / 图谱召回）与 `mem_record`（沉淀关键事实，支持 `topics` 参与建边）。
- **环境提示词**：`src/ENV_PROMPT.md` 规定何时检索（具体话题而非「以前的事」）、何时记录（明确要求 / 约定 / 偏好，不记寒暄）、`topics` 怎么给、称谓纪律；通过 `webUi().promptDocs` 在面板直接编辑。
- **对话流捕获**：按周期从宿主事件流增量提取对话轮次并推送到桥端，统一纳入 LivingMemory 的反思蒸馏（`captureIntervalMs` / `captureMinLength` / `autoCapture` 可配）。
- **鉴权**：`authToken` 与桥端 `auth_token` 同值，请求自动带 `Authorization: Bearer`。

### 修复

- 扩展加载失败（`mod.envPromptVars is not a function`）：补齐 World 接口要求的 `envPromptVars()`。
- `start()` / `stop()` 改为 async，与宿主契约一致（同步返回导致卸载时报 `reading 'then'`）。
- 对话流推送失败时不再推进游标：失败保留游标下轮重试，连续失败 5 次才跳过并记警告，避免桥短暂不可用就永久丢对话。
- `defaults` 改为工厂函数、`tools()` 返回 `ToolDef[]`，对齐 World API 6 契约。

### 优化

- 面板分两级：「连接」3 项 + 「高级（默认即推荐）」5 项，全部配置项可见，不再藏起有默认值的项。
- 请求超时 3s → 5s（桥触发总结后回执偶尔偏慢）；对话捕获最短长度默认 2 → 6，避免「嗯」「哦」变成噪声记忆。
- 开源脱敏：默认值不含真实账号与人名，`sessionId` / `personaId` 默认留空自动继承桥端配置。
- README 重写为开源向：安装、配对要求、配置表与常见排障（查不到记忆 / 人物分裂 / 401 / 记忆不生成 / 延迟）。
