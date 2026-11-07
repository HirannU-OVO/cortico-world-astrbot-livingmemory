# cortico-world-astrbot-livingmemory

> **Cortico World 扩展**：给 Coopanion 桌面宠物接入 AstrBot 的 LivingMemory 长期记忆与知识图谱。

桌宠和 QQ 智能体共用同一套记忆库与知识图谱——QQ 上聊过的事桌宠记得，桌宠这儿说过的约定 QQ 那边也知道。

> ⚠️ **配套说明**
> - 本扩展运行在 **Coopanion 桌宠**侧；
> - AstrBot 端必须成对安装配套桥接插件：[astrbot_plugin_coopanion_livingmemory](https://github.com/HirannU-OVO/astrbot_plugin_coopanion_livingmemory)；
> - 两者通过本地 HTTP 接口对接，**必须成对安装运行**。

---

## 架构与分工

```
Coopanion 桌宠
  │  本扩展：向模型提供记忆检索 / 记录，并推送对话流
  ▼
cortico-world-astrbot-livingmemory（本扩展）
  │  本地 HTTP（默认 127.0.0.1:6198）
  ▼
astrbot_plugin_coopanion_livingmemory（AstrBot 端桥接插件）
  │  转接给 AstrBot 的记忆插件
  ▼
astrbot_plugin_livingmemory（记忆库 + 知识图谱 + 会话蒸馏）
```

---

## 相关项目

| 项目 | 位置 | 作用 |
| :--- | :--- | :--- |
| [Cortico 桥](https://github.com/as124da1231/astrbot_plugin_cortico_bridge) | AstrBot 插件 | 管「对话」：让 Cortico/桌宠人格直接在 QQ 里说话，AstrBot 只当手脚和账号 |
| [cortico-world-astrbot](https://github.com/as124da1231/cortico-world-astrbot) | 桌宠扩展 | 和上一行成对，把桌宠人格接到 QQ |
| [桥接插件](https://github.com/HirannU-OVO/astrbot_plugin_coopanion_livingmemory) + [本扩展](https://github.com/HirannU-OVO/cortico-world-astrbot-livingmemory) | AstrBot 插件 + 本仓库 | 管「记忆」：把桌宠和 QQ 的记忆并到同一套 LivingMemory |

上面两项是一对，负责「对话」；本扩展和配套的桥接插件是另一对，负责「记忆」。两者功能不重叠，**可以同时装**：装了 Cortico 桥，QQ 那头的回答由桌宠人格来出，记忆照样走本扩展。

本扩展不依赖 Cortico 桥和 cortico-world-astrbot；只有想让桌宠人格在 QQ 里说话时才需要装它们。

---

## 安装与快速上手

### 1. 安装前置插件

先在 AstrBot 中安装并启用上游记忆插件：

- [astrbot_plugin_livingmemory](https://github.com/lxfight-s-Astrbot-Plugins/astrbot_plugin_livingmemory)

装好后请按[上游 README](https://github.com/lxfight-s-Astrbot-Plugins/astrbot_plugin_livingmemory)确认嵌入模型和向量索引配置正确。配置不对时，最典型的现象是桌宠什么都记不住。

### 2. 安装本扩展

**面板安装（推荐）**：World扩展 → 扩展市场 → 安装

**手动安装（可选）**：把本扩展目录放到桌宠的扩展目录：

```text
%COOPANION_DIR%/data/extensions/local/cortico-world-astrbot-livingmemory/
```

然后在 Coopanion 的扩展管理里启用本扩展。

### 3. 安装 AstrBot 侧桥接插件

安装配套的桥接插件：[astrbot_plugin_coopanion_livingmemory](https://github.com/HirannU-OVO/astrbot_plugin_coopanion_livingmemory)。

**面板安装（推荐）**：AstrBot 管理面板 → 插件 → 安装

**命令行安装（可选）**：

```bash
git clone https://github.com/HirannU-OVO/astrbot_plugin_coopanion_livingmemory.git data/plugins/astrbot_plugin_coopanion_livingmemory
```

装好之后重启一次 AstrBot，并确认它在运行（默认监听 `127.0.0.1:6198`）。

### 4. 首次配置

两边各填一遍，把它们对上：

1. 「AstrBot 的地址」默认就是 `http://127.0.0.1:6198`，没改过端口就不用动；
2. 如果 AstrBot 侧开了「校验 token」，把它填到桌宠的「校验 token」里，两边保持一致；
3. 桥接插件首次连接后，会自动填好这几项：桌宠的 QQ 号、你的称呼、记忆存到哪个会话、记忆存给哪个人格；确认无误保存即可，你手动改过的项之后不会再被自动识别结果覆盖；
4. 桥接插件那边保存后立即生效；桌宠这边的配置改完要重载扩展（或重开桌宠）才读取新值。

### 5. 装完怎么确认成功

1. 在桌宠里说一句「查一下记忆通不通」，它会调 `mem_status` 报出桥接状态：上游记忆库显示「已连接」、使用场景和你的实际用法一致，就说明通了；
2. 接了 QQ 的话，也可以在 QQ 里直接对机器人发 `/lmbridge`，桥接插件面板里能看到同一份状态；纯桌宠没有平台，这一步跳过；
3. 在桌宠里正常聊天，等上游完成一次记忆总结（默认约 10 轮对话触发）后，再去问它记不记得。只聊一句不会立刻写进记忆，这是正常的。

---

## 工具 / 接口列表

本扩展给大模型提供了三个记忆工具：

| 工具 | 作用 |
| :--- | :--- |
| `mem_search(query, limit?)` | 检索长期记忆；支持语义、关键词和知识图谱混合排序，默认返回 5 条 |
| `mem_record(content, importance?, topics?)` | 主动记下重要事实或偏好；`topics` 会帮助以后按话题检索到这条记忆 |
| `mem_status()` | 自检桥接状态：上游记忆库连没连上、当前是接入 QQ 还是纯桌宠、挂在哪个会话与人格 |

在桌宠里说一句「查一下记忆通不通」，它就会调 `mem_status` 把状态说出来；纯桌宠、不接任何平台时也能用，不必打命令行。

插件内置的环境提示词会告诉模型：什么时候该检索、哪些内容值得长期记住、怎么称呼双方。日常寒暄不会被当成重要记忆。

---

## 配置参数速查

| 面板显示名 | 说明 |
| :--- | :--- |
| AstrBot 的地址 | 桥接插件地址，如 `http://127.0.0.1:6198` |
| 校验 token | 和桥接插件一致，如 `123456789` |
| 自动收集桌宠对话 | 自动把桌宠对话送去整理成记忆 |
| 最短记录字数 | 少于该字数的发言不推送 |
| 多久同步一次 | 对话推送周期，单位毫秒 |
| 等待超时 | 单次请求超时，单位毫秒 |
| 记忆存到哪个会话 | 桌宠的对话存进哪个会话；留空就跟着 AstrBot 那边，平时不用填 |

人格在 AstrBot 侧的桥接插件里设置，本扩展不再单独指定。

纯桌宠（不接任何平台）时，图谱里的人物节点名取自「你的称呼」和「桌宠的称呼」，不用账号映射。

纯桌宠模式下，接 QQ 才用的项会被隐藏，隐藏期间不生效，值保留。

### 常见误解

- **「记忆存到哪个会话」只影响桌宠那份记忆。** QQ 群聊和私聊仍按上游自己的会话规则走。
- **桥接面板下拉里出现多个候选是历史会话，不是重复项。** 它们包括改名前的旧适配器名和机器人自己的号；通常留空最稳。
- **「谁是谁」在桥接插件的面板里，桌宠这边不用填。** 那一项的第一段是显示名，后面都是别名。
- **桥接插件的「消息从哪个平台进来」只在接入第二个适配器并启用互通时才需要填。** 单适配器留空即可。

## 常见排障

### 1. 桌宠查不到 QQ 里聊过的记忆？

先确认三件事：

1. AstrBot 侧桥接插件正在运行；
2. 桌宠「桥地址」和 AstrBot 侧端口一致；
3. 两边「校验 token」一致（或都没填）。

当前支持范围是 QQ 私聊 + 桌宠本地通道；其他平台暂未支持。

### 2. 改了桌宠面板配置没生效？

桌宠扩展的配置改完后需要重载扩展（或重开桌宠）才会读取新值。AstrBot 侧插件面板保存则会立即生效。

### 3. 聊完天没有马上多出新记忆？

正常现象。记忆由后台按轮次批量总结，不会每句话立刻生成；重要事实可以让桌宠直接调用 `mem_record` 显式记下来。

### 4. 连接报 401 / 未授权？

AstrBot 侧桥接插件开启了「校验 token」。在桌宠的「校验 token」里填入与 AstrBot 插件相同的一串即可。

---

## 依赖与参考

| 上游项目 | 用途 | 许可 |
| :--- | :--- | :--- |
| [astrbot_plugin_livingmemory](https://github.com/lxfight-s-Astrbot-Plugins/astrbot_plugin_livingmemory) | 记忆库、知识图谱与会话蒸馏引擎；本扩展通过桥接插件调用其检索和写入能力 | 见上游仓库 |

## 许可证

[MIT License](LICENSE) © 2026 HirannU
