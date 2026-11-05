# cortico-world-livingmemory

给 [Coopanion](https://github.com/Pal-AI-Lab/Cortico) 桌面宠物接入 [AstrBot](https://github.com/AstrBotDevs/AstrBot) 的 **LivingMemory** 长期记忆。

桌宠和 QQ 智能体共用同一套记忆库与知识图谱——QQ 上聊过的事，桌宠记得；桌宠这儿说过的约定，QQ 那边也知道。

---

## 它怎么工作

```
Coopanion（桌宠）
  │  本扩展：mem_search / mem_record + 对话流捕获
  ▼
cortico-world-livingmemory（本包，TypeScript）
  │  本地 HTTP（默认 127.0.0.1:6198）
  ▼
astrbot_plugin_livingmemory_bridge（AstrBot 侧，Python）   ← 必须同时安装
  │  直接调用插件内部 API
  ▼
astrbot_plugin_livingmemory（记忆库 + 知识图谱 + 会话蒸馏）
```

**两个包要成对安装**：本扩展只负责「问」与「说」，记忆的存储、向量检索、图谱与总结都在 AstrBot 侧。

这样分工的好处：桌宠侧不必再加载一份 Embedding 模型与向量库；QQ 与桌宠读写同一份记忆。

---

## 安装

### 1. AstrBot 侧

1. 装好 `astrbot_plugin_livingmemory`（本扩展不包含它）
2. 把配套的 `astrbot_plugin_livingmemory_bridge`（AstrBot 侧插件）放进 AstrBot 的 `data/plugins/`，重启
3. 在桥的配置页填两项（**必须填对，否则桌宠查不到已有记忆**）：

| 配置 | 填什么 | 例 |
| :--- | :--- | :--- |
| `default_session_id` | 你的会话 umo（AstrBot 的统一消息来源标识） | `persona名:FriendMessage:你的QQ号` |
| `bot_identity` | 桌宠账号身份（`id` 用 QQ 号、`name` 用称呼） | `{"id":"10000","name":"小助手"}` |

4. 可选：`user_display_names` 填对方称呼（`{"10001":"小明"}`），记忆里就会写名字而不是数字 ID

### 2. 桌宠侧

1. 在市场装本扩展，或在扩展目录执行 `corepack pnpm add cortico-world-livingmemory`
2. 打开世界面板 →「桥接连接」确认地址是 `http://127.0.0.1:6198`（桥换过端口才需要改）
3. 桥开了 `auth_token` 的话，把同一个值填进「鉴权令牌」

装完即可用：`sessionId` / `personaId` 留空时自动使用桥端的默认值，不用先搞懂 umo 格式。

---

## 给模型的两个工具

| 工具 | 用途 |
| :--- | :--- |
| `mem_search(query, limit)` | 检索长期记忆（语义向量 + BM25 + 知识图谱三路融合） |
| `mem_record(content, importance, topics)` | 显式沉淀一条记忆；`topics` 是 1~3 个话题词，会参与图谱建边，以后更容易被一起检索到 |

环境提示词（`src/ENV_PROMPT.md`，可在面板里直接编辑）已写好使用纪律：什么时候该查、什么时候该记、不记寒暄与调试过程、称谓用具体名字而非「用户」。

---

## 配置项

在面板的「桥接连接 / 记忆身份 / 对话捕获」三组里改，或直接写 `config.json` 的 `worlds.livingmemory`。

| 键 | 类型 | 默认 | 说明 |
| :--- | :--- | :--- | :--- |
| `bridgeUrl` | string | `http://127.0.0.1:6198` | 桥的地址 |
| `authToken` | string | 空 | 与桥的 `auth_token` 一致；桥留空则这里也留空 |
| `timeoutMs` | number | `5000` | 单次请求超时（毫秒） |
| `sessionId` | string | 空 | 留空用桥端默认；要分离记忆（如私聊与群各存一份）时填具体 umo |
| `personaId` | string | 空 | 留空用桥端默认；AstrBot 未配人格时仅作分类标签 |
| `autoCapture` | boolean | `true` | 是否把桌宠对话增量推给桥 |
| `captureIntervalMs` | number | `30000` | 捕获周期（毫秒） |
| `captureMinLength` | number | `6` | 短于这个字数不入库，避免「嗯」「哦」变噪声 |

> 改完地址、令牌、会话或人格需要**重载扩展**才生效。

---

## 常见问题

**查不到以前的记忆**
多半是 `sessionId` 与 AstrBot 侧不一致。桥按会话隔离记忆，两边的 umo 必须完全相同。

**同一个人在图谱里变成两个节点**
`bot_identity` 的 `id` 必须是 QQ 号、`name` 是称呼，其他叫法放进 `aliases`。把名字当 id 用会生成两个人物节点。

**请求返回 401**
桥配了 `auth_token`，本扩展的「鉴权令牌」没填或填错。

**桌宠的对话没有变成记忆**
记忆不是每句都存：桥按 `reflection_engine.summary_trigger_rounds`（默认 10 轮）触发一次总结，达标才产生新记忆。想立刻记下来，就让模型调 `mem_record`。

**聊完很久才出现新记忆**
这是设计如此——总结由 LLM 按轮次批量执行，避免把闲聊逐句灌进库。

---

## 许可

[MIT License](LICENSE) © 2026 HirannU
