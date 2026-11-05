# cortico-world-astrbot-livingmemory

> **Cortico World 扩展**：为 [Coopanion](https://github.com/Pal-AI-Lab/Coopanion) 桌面宠物接入 [AstrBot](https://github.com/AstrBotDevs/AstrBot) 的 [LivingMemory](https://github.com/lxfight-s-Astrbot-Plugins/astrbot_plugin_livingmemory) 长期记忆与知识图谱系统。

桌宠和 QQ 智能体共用同一套记忆库与知识图谱——QQ 上聊过的事桌宠记得，桌宠这儿说过的约定 QQ 那边也知道。

> ⚠️ **配套说明**：
> - 本扩展**运行在 Coopanion 桌面宠物**侧；
> - AstrBot 端必须成对安装配套桥接插件：[`astrbot_plugin_coopanion_livingmemory`](https://github.com/HirannU-OVO/astrbot_plugin_coopanion_livingmemory)；
> - 两者通过本地 HTTP 协议对接，**必须成对安装运行**。

---

## 架构与分工

```
Coopanion（桌面宠物）
  │  本扩展：向模型暴露 mem_search / mem_record + 对话流自动捕获
  ▼
cortico-world-astrbot-livingmemory（本扩展，TypeScript）
  │  本地 HTTP（默认 127.0.0.1:6198）
  ▼
astrbot_plugin_coopanion_livingmemory（AstrBot 端桥接插件，Python）
  │  直接调用 LivingMemory 内部引擎与反思服务
  ▼
astrbot_plugin_livingmemory（记忆库 + 知识图谱 + 会话蒸馏）
```

成对安装的好处：桌宠端无需在本地重复加载一份 Embedding 向量模型与图数据库，实现两端真正无缝共享同一套长期记忆。

---

## 配套插件

本扩展必须与配套的 AstrBot 端桥接插件成对安装：

- **[astrbot_plugin_coopanion_livingmemory](https://github.com/HirannU-OVO/astrbot_plugin_coopanion_livingmemory)**：运行在 AstrBot 侧的桥接插件，负责把请求转接给 `astrbot_plugin_livingmemory` 引擎。

两者通过本地 HTTP 接口对接（默认 `127.0.0.1:6198`），接口协议一致、缺一不可。

---

## 安装与快速上手

### 1. AstrBot 侧准备
1. 确保已安装上游 [astrbot_plugin_livingmemory](https://github.com/lxfight-s-Astrbot-Plugins/astrbot_plugin_livingmemory)；
2. 安装并启用配套桥接插件 [`astrbot_plugin_coopanion_livingmemory`](https://github.com/HirannU-OVO/astrbot_plugin_coopanion_livingmemory)；
3. 在桥插件配置页配置好 `default_session_id` 与 `bot_identity`。

### 2. 桌宠侧安装
将本扩展目录放置于桌宠本地扩展目录：
```
%COOPANION_DIR%/data/extensions/local/cortico-world-astrbot-livingmemory/
```
在 Coopanion 的扩展管理中启用本扩展。

---

## 工具列表

本扩展向大语言模型注册了两个记忆交互工具：

| 工具名 | 作用与机制 |
| :--- | :--- |
| `mem_search(query, limit?)` | 检索长期记忆（由底层 LivingMemory 执行语义向量 + BM25 + 知识图谱三路融合排序） |
| `mem_record(content, importance?, topics?)` | 显式沉淀一条关键事实或偏好；`topics` 会参与图谱建边，提高后续关联检索精度 |

环境提示词已内置记忆管理规范，指导模型在合适时机检索与沉淀重要事实，避免把琐碎寒暄写入长期库。

---

## 配置参数速查

在桌宠「World 配置 -> 长期记忆」面板中可直接调整，或修改 `config.json` 的 `worlds.livingmemory` 字段：

| 配置键 | 类型 | 默认值 | 说明 |
| :--- | :---: | :--- | :--- |
| `bridgeUrl` | string | `http://127.0.0.1:6198` | AstrBot 侧桥插件的监听地址 |
| `authToken` | string | `""` | 可选安全令牌，需与桥端 `auth_token` 保持一致 |
| `timeoutMs` | number | `5000` | HTTP 请求超时时间（毫秒） |
| `sessionId` | string | `""` | 指定会话 umo（留空则默认继承桥端会话） |
| `personaId` | string | `""` | 指定人格 ID（留空则默认继承桥端人格） |
| `autoCapture` | boolean | `true` | 是否自动将桌宠对话流批量推送到桥端进行后台反思蒸馏 |
| `captureIntervalMs` | number | `30000` | 对话流捕获推送周期（毫秒） |
| `captureMinLength` | number | `6` | 过滤短于该字数的发言，避免噪声干扰记忆提炼 |

---

## 常见排障

1. **查不到已有记忆**：
   - 检查 `sessionId` 配置是否为空或与 AstrBot 侧会话 umo 不一致。
2. **请求报错 401**：
   - 检查桥端是否开启了 `auth_token`，若开启需在桌宠侧「鉴权令牌」中填入相同值。
3. **对话没有即时生成记忆**：
   - 正常现象。记忆总结由后台按轮次批量蒸馏，重要事实应直接使用 `mem_record` 显式写入。

---

## 参考与致谢

本项目为原创实现。下表列明所依赖/参考的项目、参考内容及其边界：

| 项目 | 许可 | 关系与参考内容 |
| :--- | :--- | :--- |
| [astrbot_plugin_livingmemory](https://github.com/lxfight-s-Astrbot-Plugins/astrbot_plugin_livingmemory) | 见上游仓库 | 记忆库/图谱引擎：本扩展经桥间接调用其检索与写入能力，未复制其代码 |

> **边界声明**：本仓库不包含任何第三方项目的源代码；与上游的交互均通过公开接口或本地 HTTP 协议完成。若权利人认为有不妥之处，欢迎提 issue 沟通处理。

---

## 许可证

[MIT License](LICENSE) © 2026 HirannU
