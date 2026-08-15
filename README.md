# meow-notify — DSH 消息推送插件（双端版 v9）

把 DSH（DeepSeek Harness）的关键事件推送到手机（MeoW App），并支持在 **Web 设置页的「插件配置」卡片**里直接修改配置：

- **agent 一轮运行完成** → 推送「✅ 会话标题」
- **需要人员介入 / 授权** → 推送「⚠️ 会话标题」（优先级最高，不受节流限制）
- **GUI 配置卡片** → 设置 → 插件 → 插件配置 → 「MeoW 推送」卡片，保存即热生效

推送内容带**会话标题 / 工作目录名**，多个任务并行时一眼分清是哪个会话。

---

## 目录

1. [工作原理](#1-工作原理)
2. [前置条件](#2-前置条件)
3. [安装](#3-安装)
   - [方式 A：Windows 源码一键安装（install.bat）](#方式-a-windows-源码一键安装installbat)
   - [方式 B：手动安装](#方式-b-手动安装)
4. [验证安装](#4-验证安装)
5. [可调节的配置项](#5-可调节的配置项)
6. [日常使用](#6-日常使用)
7. [更新插件代码](#7-更新插件代码)
8. [禁用与卸载](#8-禁用与卸载)
9. [常见问题排查](#9-常见问题排查)
10. [目录结构与开发](#10-目录结构与开发)

---

## 1. 工作原理

```
┌─────────────┐   session/event    ┌──────────────┐   HTTPS GET    ┌───────────┐
│  DSH 进程    │ ─────────────────▶ │ meow-notify  │ ─────────────▶ │ MeoW 服务器 │
│ (dsh web等) │  turn/end          │ (Cordis插件) │  base/nick/…  │           │
│             │  approval/asked    │              │                └─────┬─────┘
└─────────────┘                    └──────┬───────┘                      │
      ▲                                  │ appendFileSync               ▼
      │  settings 域（GUI 卡片读写）       ▼                        📱 手机收到推送
┌─────┴──────────┐               notify.log（证据日志）
│ settings.yaml  │
└────────────────┘
```

- 插件以 **Cordis 双端插件**形式加载进 DSH 进程：
  - **host 端**（`index.js`）：监听框架级 `session/event` 事件流，注册 settings namespace。
  - **client 端**（`client.js`）：在浏览器注册「设置 → 插件 → 插件配置」卡片。
- 这是**框架级钩子**，不依赖模型自觉——即使 agent 忘了做什么，事件照常触发推送。
- 通过 `$DSH_HOME/cordis.patch.yml`（home 级补丁）注册，**对所有 profile 生效**，**重启后持久**。
- 配置三层合并：**schema 默认值 ← patch config（base）← settings.yaml（user，GUI 写入）**。GUI 保存只改 user 层，patch 文件保持不动。

**推送格式：**

| 事件 | 推送标题 | 推送正文 |
|---|---|---|
| 插件加载 | `meow-notify` | 插件已加载 v9 · <昵称> |
| 任务完成 | `✅ <会话标题或目录名>` | 第 N 轮 · <原因> · <目录名> |
| 任务异常结束 | `⚠️ <会话标题或目录名>` | 第 N 轮 · aborted/blocked/interrupted · <目录名> |
| **任务出错** | `❌ <会话标题或目录名>` | 第 N 轮出错：<错误信息> · <目录名>（**不节流**） |
| 需要介入 | `⚠️ <会话标题或目录名>` | <工具名> 等待批准 · <目录名> |
| 子代理会话 | 上述标题加 `[子] ` 前缀 | 同上 |

**会话标签的来源**（优先级从高到低）：
1. 会话标题（DSH 根据首条提问自动生成，也可在 Web UI 侧栏手动改名）
2. 工作目录的最后一段（如 `E:\proj\app-server` → `app-server`）

---

## 2. 前置条件

| 条件 | 说明 |
|---|---|
| DSH 已安装 | 能运行 `dsh web`（DeepSeek Harness CLI） |
| Node.js ≥ 18 | 插件用全局 `fetch`；DSH 本身跑在 Node 上 |
| MeoW App | 手机安装 [MeoW](https://www.chuckfang.com/MeoW/api_doc.html)（鸿蒙消息提醒应用），**注册并记下你的接收昵称（nickname）** |
| 网络 | 运行 DSH 的电脑能访问 `https://api.chuckfang.com` |

> **MeoW 昵称是什么？** 打开 MeoW App，在"我的"页面看到的用户名/昵称就是 API 路径里的 `nickname`，推送会发给这个名字对应的设备。

---

## 3. 安装

### 方式 A：Windows 源码一键安装（install.bat）

适用于**下载源码包/离线分发**的场景：

1. 下载并解压源码包（含 `install.bat`、`install.mjs`、`index.js`、`client.js` 等文件）
2. **双击 `install.bat`**，在菜单里输入 `1` 回车
3. 按提示输入 MeoW 昵称，回车
4. 等待自动完成：部署文件 → 平台补丁 → 注册配置
5. 重启 DSH：`dsh web`

也支持命令行方式（便于脚本化）：
```bat
install.bat install --nickname=你的昵称     :: 一键安装
install.bat uninstall                        :: 卸载
```

**注意事项：**
- 需要先安装 Node.js 18+ 和 DSH（`dsh web` 至少运行过一次）。
- 若提示文件写入失败，右键 `install.bat` →「以管理员身份运行」。

---

### 方式 B：手动安装

共 3 步：放包 → 注册 → 重启。**插件以包形态安装**（放在 `profiles/node_modules` 下），这样才能同时加载 host 端（推送）和 client 端（GUI 卡片）。

### 第 1 步：放置插件包

把整个 `meow-notify` 目录（含 `index.js`、`client.js`、`package.json`）放到 **profile 的 node_modules 下**：

- Windows：`C:\Users\<你的用户名>\.dsh\profiles\node_modules\meow-notify\`
- macOS / Linux：`~/.dsh/profiles/node_modules/meow-notify/`

> `$DSH_HOME/profiles/node_modules` 是 DSH 的 flat fallback 依赖目录，所有 profile 都能从它解析包。目录名必须叫 `meow-notify`（与 package.json 的 `name` 一致）。

### 第 2 步：注册到 DSH 全局配置

编辑 **`$DSH_HOME/cordis.patch.yml`**（默认 `~/.dsh/cordis.patch.yml`；**不存在就新建**）：

```yaml
# DSH 全局补丁层：对所有 profile 生效，运行中修改会被热加载。
- insert:
    - id: meow-notify
      name: 'meow-notify'        # 包名：host 端从 index.js 加载，client 端自动被发现
      config:
        enabled: true
        nickname: "你的MeoW昵称"  # ← 必填：MeoW App 里注册的接收昵称
        base: "https://api.chuckfang.com"
        # turnEndMinIntervalMs: 25000   # 可选：完成推送最小间隔(毫秒)
        # includeChildren: false        # 可选：不通知子代理会话
```

**注意：**
- 顶层必须是 YAML 数组（`- insert:` 开头）。
- `name` 必须是**包名** `meow-notify`（不能是路径），这是 client 端被发现的前提：DSH 会用 `require.resolve('meow-notify/package.json')` 找到它，读取 `dsh.client` 声明和 `exports["./client"]`。
- 如果文件里已有其他条目，把 `- id: meow-notify ...` 这段追加到数组末尾即可。

### 第 3 步：给 DSH 打平台补丁（仅首次安装需要）

> **为什么需要？** DSH 的 host-apiproxy 硬编码了一个 Web 设置允许列表
> `WEB_SETTINGS_NAMESPACES`，只有列表里的 settings namespace 才会被浏览器端
> `settings.describe` 返回、才能被 GUI 配置卡片读写。当前 DSH 版本（0.1.0-rc.x）
> **第三方插件无法自行暴露配置**（官方注释称此为 "deferred work"），
> 必须把 `meow-notify` 加入这个列表，否则卡片不会显示。

运行插件自带的补丁脚本（自动定位 DSH 安装位置并打补丁，幂等可重复执行）：

```powershell
node setup.mjs
```

若脚本找不到 DSH 安装位置（npx 缓存/全局安装路径特殊），显式指定：
```powershell
node setup.mjs "C:\Users\<你>\AppData\Local\npm-cache\_npx\<hash>"   # Windows 示例
```

或者手动编辑 `<DSH安装>/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js`，
在 `WEB_SETTINGS_NAMESPACES` 数组里加上 `"meow-notify"`：
```js
const WEB_SETTINGS_NAMESPACES = [
	"agent-loop",
	"shell",
	"locale",
	"permission",
	"ui-conversation",
	"ui-theme",
	"web-search-deepseek",
	"meow-notify"        // ← 加上这一行
];
```

> **注意**：DSH 升级后补丁会丢失（安装目录被替换），重新运行 `node setup.mjs` 即可。

### 第 4 步：重启 DSH

```powershell
dsh web
```

重启后 1~2 秒内，手机应收到 **「meow-notify / 插件已加载 v9 · 你的昵称」**——收到即安装成功。

### 第 5 步：打开 GUI 卡片

浏览器打开 DSH Web（`http://127.0.0.1:3080`）→ **设置 → 插件 → 插件配置**，应能看到 **「MeoW 推送」** 卡片：

- 展开可编辑：MeoW 昵称、推送 API 地址、完成推送最小间隔、是否通知子代理会话
- 改完点**保存**：写入 `$DSH_HOME/settings.yaml` 的 `meow-notify` 段，**1~2 秒热生效**（手机收到一条「插件已加载 v9」确认）
- 字段旁的「已覆盖」徽标表示该字段被 user 层覆盖（相对 patch config / 默认值），可点恢复默认

> 如果看不到卡片：确认 `name` 是包名、包在 `profiles/node_modules/meow-notify/`、**已运行 `node setup.mjs` 打平台补丁并重启 DSH**，然后刷新浏览器页面（卡片由前端启动时加载，改包后需要刷新或重启）。

---

## 4. 验证安装

三步验证，全部满足即工作正常：

1. **加载验证**：启动 DSH 后手机收到「插件已加载」推送。
2. **GUI 验证**：设置 → 插件 → 插件配置 → 出现「MeoW 推送」卡片，能保存配置。
3. **日志验证**：查看插件目录下的 `notify.log`（在 `profiles/node_modules/meow-notify/` 下，首次推送后自动生成），应有：
   ```
   2026-08-14T14:17:07.025Z LOADED v9 nickname=xxx base=https://api.chuckfang.com interval=25000ms includeChildren=true node=v24.14.0
   2026-08-14T14:17:07.2xxZ PUSH-OK [meow-notify] 插件已加载 v9 · xxx :: {"status":200,"data":true,"msg":"发送成功"}
   ```
4. **事件验证**：随便让 agent 干个活（或发条消息），这轮结束时手机收到「✅ …」；触发一次需要授权的操作（比如让 agent 写工作区外的文件），收到「⚠️ …」。

`notify.log` 每行的含义：

| 前缀 | 含义 |
|---|---|
| `LOADED …` | 插件已加载（含生效配置） |
| `EVENT turn/end turn=N reason=… label=…` | 捕获到一轮结束事件 |
| `EVENT approval/asked tool=… label=…` | 捕获到审批请求事件 |
| `PUSH-OK [标题] 正文 :: 响应` | 已成功提交给 MeoW |
| `SKIP-THROTTLE [标题] gap=…` | 被节流拦截（间隔不足） |
| `PUSH-FAIL [标题] 错误码` | 网络请求失败 |
| `HANDLER-ERROR …` | 事件处理异常（不应出现） |

---

## 5. 可调节的配置项

### 5.1 通过 GUI 卡片（推荐）

设置 → 插件 → 插件配置 → 「MeoW 推送」卡片，改完点保存，1~2 秒热生效。

### 5.2 通过 settings.yaml

GUI 保存的内容写入 `$DSH_HOME/settings.yaml`：

```yaml
meow-notify:
  nickname: "<nickname>"
  turnEndMinIntervalMs: 60000
```

### 5.3 通过 cordis.patch.yml（base 层）

```yaml
      config:
        nickname: "你的MeoW昵称"
        base: "https://api.chuckfang.com"
        turnEndMinIntervalMs: 25000
        includeChildren: true
```

| 配置项 | 类型 | 默认值 | 作用 |
|---|---|---|---|
| `nickname` | string | **无（必填）** | MeoW 接收昵称。推送给谁的手机。 |
| `base` | string | `https://api.chuckfang.com` | 推送 API 根地址。一般不用动。 |
| `enabled` | bool | `true` | 总开关。`false` = 不推送。 |
| `turnEndMinIntervalMs` | number | `25000` | 「任务完成」推送的全局最小间隔（毫秒）。两条完成推送间隔不足此值时，后一条被跳过（记 `SKIP-THROTTLE`）。调大=更安静，调小=更即时但可能触发 MeoW 限流。 |
| `includeChildren` | bool | `true` | 是否通知**子代理 / workflow** 会话。子会话标题带 `[子]` 前缀。 |

### 节流机制说明（为什么有 `turnEndMinIntervalMs`）

MeoW 服务端有**约每分钟 3 条**的静默限流：超量请求 HTTP 仍返回「发送成功」，但手机实际收不到。因此插件内置客户端节流：

- `approval/asked`（需要介入）**永不节流**——人工介入最紧急，且这类事件本身稀少；它的发送也**不占用**完成推送的节流额度。
- `turn/end` 且 reason 为 `error`（任务出错）**永不节流**——错误必须及时知道，推送带错误信息。
- `turn/end` 其他（完成/异常/超限）维护自己的节流时间戳：距上一次完成推送不足 `turnEndMinIntervalMs` 就跳过，保证完成推送 ≤ 约 2.4 条/分钟，把额度让给介入和错误通知。
- 节流是**跨所有会话全局**的（多会话叠加也不会超限）。

---

## 6. 日常使用

- **什么都不用做**。插件在后台随 DSH 自动加载，事件触发自动推送。
- 手机上的推送点开后是纯文本；MeoW 支持点按通知打开 App 查看全文。
- 想看插件在干什么：翻 `notify.log`（在 `profiles/node_modules/meow-notify/` 下，自动增长，可随时删除，删后下次推送会重建）。
- 多任务并行时，靠推送标题的**会话名**区分（见第 1 节推送格式）。想让标题更好认：在 DSH Web UI 侧栏给会话手动改名，改名后的推送立即使用新标题。

---

## 7. 更新插件代码

改了 `index.js` / `client.js` 之后，由于 Node ESM 模块缓存，运行中的 DSH 可能仍用旧代码。两种办法：

**办法 A（推荐，简单）：重启 DSH**
```powershell
# 停掉 dsh web 再启动
dsh web
```

**办法 B（不重启，热加载）：给 name 加/递增缓存戳**
```yaml
      name: 'meow-notify?v=2'   # 原来 ?v=2 就改成 ?v=3
```
保存 `cordis.patch.yml` 后约 1~2 秒热加载，手机会收到新版「插件已加载」确认。

> **注意**：`?v=` 会改变 client-modules 的包名解析吗？不会——`require.resolve('meow-notify?v=2/package.json')` 会失败！所以带 `?v=` 时 client 端可能不再被发现。**升级代码最稳的方式是办法 A（重启）**；办法 B 只适合改 host 端推送逻辑、不需要动 GUI 卡片的场景。

---

## 8. 禁用与卸载

**临时禁用（保留文件，随时恢复）：**
```yaml
      config:
        enabled: false
```
或直接在 insert 行加 `disabled: true`：
```yaml
    - id: meow-notify
      name: 'meow-notify'
      disabled: true
```

**只保留「需要介入」通知（静音完成推送）：**
```yaml
      config:
        nickname: "你的昵称"
        turnEndMinIntervalMs: 2147483647   # 24.8 天，等效永久静音完成推送
```

**彻底卸载：**
1. 删掉 `cordis.patch.yml` 里 `- id: meow-notify` 那一整段。
2. 删除 `$DSH_HOME/profiles/node_modules/meow-notify/` 目录。
3. （可选）删掉 `settings.yaml` 里的 `meow-notify:` 段。
4. 下次启动 DSH 即完全恢复原状。

---

## 9. 常见问题排查

**Q1：启动后没收到「插件已加载」**
1. 查 `notify.log`（在 `profiles/node_modules/meow-notify/` 下）是否生成：
   - 没有文件 → 插件根本没被加载。检查 `cordis.patch.yml` 的 `name` 是否为包名 `meow-notify`、包是否在 `profiles/node_modules/meow-notify/`、YAML 格式（顶层必须是数组）。
   - 有 `NOT-ENABLED` → `enabled` 写成 false 或 nickname 空了。
   - 有 `PUSH-FAIL … ENOTFOUND/ETIMEDOUT` → 电脑访问不了 `api.chuckfang.com`（代理/防火墙）。
2. `PUSH-OK` 但手机没收到 → nickname 写错（MeoW App 里核对），或 MeoW 服务端限流（刚连发过几条，返回「发送太快」或「IP限制」）。
3. 都没有 → 重启 DSH 看启动日志有无 loader 报错。

**Q2：GUI 卡片不显示**
1. 确认 `name` 是**包名** `meow-notify`（不是路径/URL）。
2. 确认包在 `$DSH_HOME/profiles/node_modules/meow-notify/`，且含 `package.json`（带 `dsh.client` 声明和 `exports["./client"]`）。
3. **确认已打平台补丁**：运行 `node setup.mjs` 后重启 DSH——`settings.describe` 必须返回 `meow-notify` namespace。可手动验证：POST `/api/settings.describe`（body `{"type":"client-request","rpcId":"<uuid>","method":"settings.describe","payload":{}}`），看 namespaces 里有没有 `meow-notify`。
4. 刷新浏览器页面（卡片在前端启动时加载）；还不行就重启 DSH。
5. 验证发现链路：浏览器打开 `http://127.0.0.1:3080/plugins/meow-notify/client.js` 应返回 200（内容是 JS 而不是 404）。

**Q3：推送时有时无**
大概率是 MeoW 每分钟 3 条限流（`PUSH-OK` 但手机没收到属正常现象）。处理：调大 `turnEndMinIntervalMs`；或 `includeChildren: false` 减少来源。

**Q4：自动连跑（goal）时只收到第一条**
这正是节流在工作：每 25 秒最多 1 条完成推送，其余记 `SKIP-THROTTLE`。嫌少调小间隔，嫌吵调大。

**Q5：改了 nickname/配置没生效**
GUI 保存后等 1~2 秒（热生效），手机会收到一条新「插件已加载」。没收到就重启 DSH。注意：GUI 写的值进 `settings.yaml`（user 层），优先级高于 `cordis.patch.yml` 的 config（base 层）。

**Q6：`approval/asked` 什么时候触发？**
任何 DSH 弹出授权确认的时刻：文件写入工作区之外、命令需要更高权限、危险操作确认等。这是最不该错过的通知，所以它不被节流。

**Q7：能在不开 MeoW App 的情况下用吗？**
不能。MeoW 是推送的接收端（设备以 nickname 注册）。换用其他推送渠道（如 Server酱、Bark）只需改 `base` 并按其 API 格式改 `index.js` 里的 `push()` 函数。

---

## 10. 目录结构与开发

```
meow-notify/
├── index.js        ← host 端（v9）：settings 注册 + 推送逻辑
├── client.js       ← client 端：GUI 配置卡片（__ModuleLoader__.load 格式）
├── install.mjs     ← 一键安装/卸载脚本（被 install.bat 调用）
├── install.bat     ← Windows 一键安装入口（双击即用）
├── setup.mjs       ← 平台补丁独立工具（把 meow-notify 加入 DSH 的 Web 设置允许列表）
├── package.json    ← 双端声明（exports["./client"] + dsh.client 元数据）
└── README.md       ← 本文档
```

**双端机制速览**（给想改代码的人）：

| 文件 | 运行环境 | 职责 |
|---|---|---|
| `index.js` | Node（DSH 进程） | `apply(ctx, config)`：注册 settings namespace「meow-notify」+ 监听 `session/event` 推送 |
| `client.js` | 浏览器 | `apply(ctx)`：注册 `settings.plugin.item` 卡片，绑定 `settingsScope` |
| `install.bat` / `install.mjs` | 命令行 | 一键安装/卸载（bat 为 Windows 双击入口，mjs 为核心逻辑） |
| `setup.mjs` | 命令行 | 仅平台补丁（安装脚本已内含，单独提供作兜底） |

**关键约定：**
- `package.json` 的 `exports["./client"]` 指向浏览器 bundle（`client.js`），`dsh.client.platform` 必须为 `"web"`，`dsh.client.inject` 列出 client 端依赖的服务模块（`@deepseek-ai/dsh-client-connection` 等）。
- client 端 bundle 以 `window.__ModuleLoader__.load({ id, factory })` 格式编写，`factory` 的 `require` 只能使用 web 前端的静态模块表（react、`@deepseek-ai/dsh-client-runtime` 等）与 `dsh.client.inject` 注入的模块，**不能** import 其他 npm 包。
- host 端用 `installSettingsSection(ctx, NS, Config, config, hooks)`（来自 `@deepseek-ai/dsh-settings`）把配置挂到 settings 域；`Config` 是 schemastery schema，GUI 卡片与配置校验共用同一份定义。
- 配置合并顺序：schema 默认值 ← patch config（base）← settings.yaml（user）。GUI 只写 user 层。
