# dsh-ccd — 思考笔记

把模型原始的思维链换成**第一人称短工作笔记**给用户看；模型下一轮读到的仍是完整推理。

这是 [ccd](https://github.com/Sisyphbaous-DT-Project/ccd) 的 DSH 形态。ccd 原来跑在 new-api 前面，用磁盘存档 + 字节偏移的 JSON 局部替换，把客户端手里的笔记换回原文 —— 那整套机制存在的唯一理由是**客户端是哑的**。DSH 的 Session log 本身就是唯一真相源，reasoning 原文全量落盘、客户端渲染它、模型下一轮也用它，所以「模型看长的」天然成立、零代码；这个插件只负责让用户看短的。

因此 `store.go`、`jsonsplice.go`、`chatEnvelope`、`prepareChat` 的还原逻辑在这里**整段不存在**。真正搬过来的只有三件事：切段、并发转述、按段序推出。

## 效果

- 展开一次思考 → 看到的是「我在核对…」「接下来我要…」这种一两句的笔记，不是几千字原始推理。展开的那一刻笔记就已经在，不会先闪一下原文。
- 思维链还在流、你还没展开的时候，笔记也在跟着一段一段往外写。
- 点「查看原文」随时切回完整思维链。
- 刷新页面、重启 DSH、重新打开历史会话，笔记都还在 —— 它落盘了。
- 折叠状态下那一行摘要仍是原文首行（见下面「已知边界」）。

## 安装

在 DSH 的**插件**页按右上角「添加插件」，把仓库地址贴进去就完事：

```
https://github.com/mmyddd/dsh-ccd
```

那个框认三种写法 —— 包名、GitHub 仓库地址、本地目录路径 —— 贴 GitHub 地址就是从这里装，不需要 build，也不需要先 clone。想钉死某个版本就在末尾加 `#<commit>`。

仓库本身走 `git` 克隆，DSH 会先 `git ls-remote` 探一次连通性 —— 连不上就直接说连不上，不会走进 pnpm 里绕一圈再报一个看不懂的错。克隆之后 pnpm 还要拉那个唯一的运行时依赖 `@deepseek-ai/schemastery`，那是从 npm 源取的：国内网络卡在这一步时，把下方「安装源」切到「中国大陆镜像源」即可（这个下拉只影响 npm 那一段，不影响 git 克隆）。

改代码时直接填本地目录（`C:/Git/dsh-ccd`）更顺手，装出来的东西等价，只是不经过拷贝、改完刷新即见。

同一条路也有工具入口，写脚本或不方便点按钮时用：

```
plugin_manager action=install_bundle target="github:mmyddd/dsh-ccd"
```

插件管理器认 `github:owner/repo` 简写、`https://github.com/owner/repo` 和 `owner/repo#<commit>`，三种等价。

装完重启 DSH 生效 —— 只改 `client.js` 之后靠 client HMR 热更，不用重启；`index.js` 的改动必须重启。`dsh-app-boot` 用裸 `await import()` 加载 Host 半，没有 cache-bust。

`package.json` 的 `files` 是**白名单**：从 git 或 npm 装时只有列进去的文件会进包。新增一个顶层模块（比如 `local.js`）忘了登记，本地 link 装看不出问题，远程装会在第一次 `import` 就崩 —— 这类漏登记只能靠真装一次来查。

## 配置

插件导出了完整的 schemastery `Config`，**所有字段都是 `.volatile()`**，所以 DSH 的插件页会按 schema 自动生成表单，改完即时生效并写进 profile patch（跨 DSH 升级保留）。

ccd 的每一项可调能力都在这里：

| 字段 | 默认 | 说明 | ccd 对应 |
| --- | --- | --- | --- |
| `enabled` | `true` | 关掉就直接显示原文 | 规则的 `enabled` |
| `provider` / `model` | 空 | 转述模型；留空用会话默认模型 | 规则的 `TranslatorGroup` / `TranslatorModel` |
| `maxTokens` | `400` | 转述请求输出上限 | `promptSet.MaxTokens` |
| `temperature` | `0.5` | 转述温度；0 表示不传 | `relay.go` 里固定的 0.5 |
| `language` | `auto` | `auto`/`zh`/`en`/`custom` | 规则的 `lang` |
| `customLanguage` | 空 | `language: custom` 时的目标语言，≤40 字 | `lang_custom` |
| `parallel` | `3` | 每轮并发转述数 | `advanced.parallel` |
| `timeoutSec` | `20` | 单段超时 | `advanced.timeout` |
| `maxSummaries` | `0` | 一轮最多几段；0 不限 | `Config.MaxSummaries` |
| `minTail` | `0` | 尾巴短于此值丢弃；0 用语言默认（中文 60 / 其它 120） | `Config.MinTail` |
| `maxRunes` | `0` | 单条笔记字数上限；0 用语言默认（中文 200 / 其它 420） | `Config.MaxRunes` |
| `streamFirst` | `100` | 第 0 段目标字数 | `advanced.stream_first` |
| `streamStep` | `200` | 每段递增 | `advanced.stream_step` |
| `streamMax` | `1800` | 单段上限 | `advanced.stream_max` |
| `prefix` | 空 | 笔记必须以它开头，否则丢弃重试 | `Config.Prefix` |
| `blockedRegex` | 空 | 命中即整段作废（大小写不敏感） | `Config.Blocked` |
| `avoidPrefixes` | `[]` | 禁用的开头，只对首次尝试生效 | `Config.AvoidPrefixes` |
| `writer` | `provider` | `provider` 走已配置的供应商；`local` 走本机模型 | 无，新能力 |
| `localQuant` | `Q4_K_M` | 量化精度，六档可选（`Q4_K_S`…`Q8_0`）；换档等于重新下载 | 无 |
| `localDataRoot` | 空 | 运行时与模型的下载目录；空则用 `<DSH_HOME>/storages/dsh_ccd_local` | 无 |
| `localThreads` | `4` | 本地服务的 CPU 线程数 | 无 |
| `localContext` | `8192` | 本地服务的上下文长度 | 无 |
| `localIdleSec` | `300` | 闲置这么多秒后卸载模型；0 表示常驻 | 无 |

`language: auto` 跟随浏览器语言：页面把 `navigator.language` 报给 Host，Host 再用请求头兜底。想要固定语言就显式写 `zh` / `en` / `custom`，那样不受界面语言影响。

思考固定关闭，没有开关：ccd 的注释写得很清楚 —— 只认 `thinking.type` 的上游若只收到 `off`，会偷偷思考吃掉 `max_tokens`，摘要写到一半就被截断。DSH 的 `reasoningEffort` 走的是协议字段，所以这里的加固分三层：

1. **先问再发。** 每次新路由先用 `llm.resolveModelInfo` 查这个模型支不支持 `off`；没有 reasoning 元数据、或元数据里没有 `off` 的模型，直接不传这个字段 —— 它反正永远思考，传了只是自欺。
2. **被拒就记住。** 路由运行时拒绝（`UNSUPPORTED_REASONING_EFFORT`）时把结论缓存进 `Map`，之后同一路由不再白付一次调用；重试不再带 effort，也**不消耗** prompt 的 strict 次数。
3. **思考了也认。** 若路由无视 `off` 真思考、并因预算耗尽被截断（`finish.reason.kind === 'max-tokens'`），把那一段的预算翻倍（上限 4096）重试一次，而不是把半句话当成笔记。ccd 那套「双写 `reasoning_effort` + `thinking.type`」防的就是这个，只是 DSH 只有一个字段可用，补救点只能放在这里。

也可以直接写进 bundle 行：

```yaml
- id: dsh-ccd
  name: 'dsh-ccd'
  config:
    language: zh
    parallel: 3
    temperature: 0.5
```

## 本地模型

这段配置只在 `writer: local` 时出现：转述来源选了供应商，页面上就没有下载按钮、没有线程数、没有数据目录 —— 那些项都影响不到供应商那一路。

`writer: local` 让转述在一台没有装任何推理栈的机器上也能跑：插件自己下发一个 pinned 的 llama.cpp 构建和一个 2B 的 GGUF（`MiniCPM5-2B`，131k 上下文），下载、校验、解压、起进程全在 Host 侧，页面只负责显示进度。

**量化精度可选**（`localQuant`，默认 `Q4_K_M`），而六档来自**两个不同的微调**，这件事比位宽更要紧：

| 档位 | 体积 | 位宽 | imatrix |
| --- | --- | --- | --- |
| `Q4_K_S` | 1.52 GB | 4.82 | 是 |
| `Q4_K_M` | 1.56 GB | 4.96 | 否 |
| `Q4_K_XL` | 1.60 GB | 5.07 | 是 |
| `Q5_K_XL` | 1.89 GB | 6.00 | 是 |
| `Q6_K_XL` | 2.20 GB | 6.99 | 是 |
| `Q8_0` | 2.68 GB | 8.52 | 否 |

默认的 `Q4_K_M` 与顶配 `Q8_0` 取自 `Abiray/MiniCPM5-2B-heretic-abliterated-GGUF`，中间四档取自 `peculiar-ragdoll/Sharp-MiniCPM5-2B-GGUF`。后者带 `MiniCPM5-2B-cyber.imatrix.gguf`、按重要性矩阵校准，所以这几档在下拉里标一个 `imatrix`；前者是普通量化，不标。

位宽是按真实张量数（2 516 756 480 个权重）算出来的，不是按名字猜的。

**切换不删旧档**：每档是一个独立文件，换档只是把选中的那份也下下来，旧的那份留着 —— 这样同一个会话里可以来回换着比对哪一档措辞更好，不必为了比一次重下一次。代价是磁盘上可能同时躺着几份（`Q4_K_S` 与 `Q4_K_M` 就差了 1.5 GB），所以卡片会列出盘上还有哪些档，想要空间回来按「删除文件」一次清空（那按钮只删本插件下过的，你自己的 GGUF 不动）。

准备卡片的形状照抄官方 `dsh-experimental-client-ui-voice-input` 的那一块：什么都没下之前先给一份估算（硬盘/内存/首次耗时），按下按钮后行首变成一个可展开的步骤列表，每步带状态点和进度条，失败时原样显示原因；有多个下载源时给一个下拉框。数据都在 Host，页面 600 ms 轮一次、空闲时降到 5 s，所以关掉页面再回来进度不会丢。

**按下那一刻的选择说了算**：按钮只发「我要哪个精度」，不重新读一遍配置。理由是表单里的选择和档案里的选择在下一次保存前不是一回事，而刷新页面会把表单重置回档案 —— 于是「按了 Q8_0，下的是 Q4_K_M」正是重新读档案造成的。Host 收到按下的那个档，先把它写回配置再开始下载（写不进去就 409 拒绝，一个没有任何设置指向的文件等于一个 GB 的摆设），同时把这次下载的档记在任务自己身上，所以中途改了配置、头部显示的仍是真正在下的那个文件。

几处刻意的选择：

- **资产是打死的**，`local.js` 里的 `bytes` 与 `sha256` 是实测值。下载边算边写 `.part`，长度和摘要都对上才 rename 发布，所以半个文件永远不会被下一次启动当成可用模型。
- **pin 的是实测过的平台**：`win32-x64`、`linux-x64`、`linux-arm64` 三家都钉了字节数与摘要。没测过的（macOS、Windows ARM64）报 `unsupported` 而不是下一个起不来的二进制 —— 一个错的二进制比一句清楚的话糟糕得多。三个平台的归档格式不一样：Windows 是 `.zip`，Linux 是 `.tar.gz` 且里面带符号链接（`libllama.so.0 -> libllama.so.0.8.0`）和可执行位，所以解包器是两条路而不是一条 —— zip 那张表会同时丢掉链接和权限，而缺了其中任何一样的 `llama-server` 都跑不起来。
- **平台缺口只影响本地模型那一块**。没有 pinned 运行时的平台（现在的 macOS、Windows ARM64）里，卡片只说一句「这个平台没有可用的运行时」，不画估算、不给下载/取消/卸载按钮 —— 给一个禁用按钮会让人去找灰掉的原因，而原因就是那一句话。`prepare` 路由在这种平台上回 `409 unsupported-platform`，不假装 `started: true` 让页面去等永远不会出现的步骤。其余一切照常：供应商转述、切段、笔记持久化、设置页都不碰运行时，换个平台装上去仍然可用。
- **端口是现取的**：`net.createServer().listen(0)` 拿一个空闲端口再交给 `llama-server`，不写死 `8080`。
- **模型闲置会卸载**（`localIdleSec`）。一个 GB 的权重常驻没有道理。
- **能删干净，也只删自己的**。卡片上的「删除文件」会停掉进程、丢掉任务、删掉 `runtime/` 与所有自己下过的 GGUF，然后按磁盘重新判定一次状态。判据是文件名白名单（`QUANTS` 里那些），不是 `.gguf` 后缀：`localDataRoot` 指向一个已有目录时，你自己放进去的 GGUF 既不会被列进「盘上有哪些量化」，也不会被删。
- **删除要等进程真的走开**。Windows 上 `child.kill()` 就是 `TerminateProcess`：它返回时镜像还没 unmap，紧接着删目录必得 `EBUSY`，而 `rm(..., {force:true})` 只饶过「路径不存在」，不饶过「被占用」。「删除文件」因此先 `await whenStopped()`（等 `exit`，最多 500 ms），再进删除；`removeRuntime` 自己也会对 `EBUSY`/`EPERM`/`ENOTEMPTY`/`EACCES` 退避重试 6 次，其它错误照旧往上抛 —— 权限问题是真的问题，吞掉只会报告一次没发生的干净删除。
- **跨重启的遗留进程要能找回来**。宿主崩掉时 teardown 不会跑，`llama-server` 继续占着自己的 exe 和权重，下一次「删除文件」就会撞在别人手里。起进程时把 pid 写进 `runtime/server.pid`，删之前先用 `tasklist` 确认那个 pid 现在的镜像名确实以 `llama-server` 开头再 kill（pid 会被复用，绝不误杀陌生人）；`exit` 时清掉这个文件。
- **路由出错不能带走宿主**。六条路由的异步体统一走 `guardRoute`：异常变成 `500 {"error":"route-failed", message}`，已经发过响应头就 `destroy`，绝不留一个 unhandled rejection —— 在这个宿主里那就是 `fatal load failure`，读者会连会话一起丢掉。页面对应的 `actLocal` 不再把失败吞成 `undefined`，卡片会把宿主给的 `message` 显示出来。
- **起不来要吵架，不能沉默**。文件被删掉而 `writer` 还是 `local` 时，`spawn` 找不到 exe —— 那是一个异步 `error` 事件，没人听就是未捕获异常，整个宿主会跟着退出（`crash-*-host.log` 里记着 `spawn ... llama-server.exe ENOENT` 然后 `fatal uncaught exception`）。所以起进程前先 stat 一次 exe 与权重（缺了抛 `NOT_PREPARED`，页面显示「转述失败: the local runtime is not prepared…」），并且无论是否预检都挂上 `error` 监听器把失败记进 `this.failure`，由 `waitForHealth` 当成启动失败抛出去。
- **本地不做关思考协商**：那条协商是给会拒 `reasoningEffort` 的 API 用的，本地模型走 `chat_template_kwargs.enable_thinking: false`，被模板忽略也就正常回答了。
- **速度是量出来的，不是配出来的**。卡片上那一行读的是 `llama-server` 响应的 `timings`：`predicted_n / predicted_ms`，只算生成、不含读 prompt。用客户端墙钟会连等槽位、读 prompt、宿主忙一起算进去，那样的数字跟着无关负载走，就不再是关于这个模型的测量了。没写过笔记时它说「写完第一条就会显示」而不是画一个 `0`：这是测量值，唯一诚实的空状态是讲清为什么空。它只在内存里，因为它描述的是这个进程在这台机器上。

实测（i5 一类的 CPU、4 线程、8k 上下文）：模型加载约 1.3 s，一段 1500 字的推理出笔记约 2.5–5 s，质量能过输出闸门 —— 第一人称、抓要点、不重复上文。

## 已知边界

**折叠行改不了。** `conversation.chat.reasoning.body` 只覆盖展开后的正文；折叠时那行摘要由 `ReasoningRow` 直接从 reasoning 原文取首行（`firstLine` / `latestCompletedParagraphFirstLine`），不经过任何 slot。要改它只能整替 keyed `assistant-step`，也就是重写整个 assistant 渲染 —— 跟 DSH 升级一起碎，不值。

**换模型就重来。** 笔记按段序号缓存，一旦 reasoning 前缀断裂（分叉、重放、切模型）就整轮重置重新转述。这是 ccd 原本就没有的能力，不是退化。

**折叠不重来。** 折叠会让 DSH 卸载 reasoning 正文（`ReasoningRow` 只在展开时渲染 body slot）。转述因此完全不在浏览器里跑：它在 Host 上独立于组件存活，折叠、展开、再折叠都不影响它，已出的笔记和已切的段全部保留，一次都不重来。

**单段失败不废整轮。** 一段转述失败只留一个空位（`dropped` 计数会在工具栏提示「有笔记没写出来」），后面的段照常进行，成功一次就把连败计数清零。连续失败 2 次才判定转述器不健康、跳过本轮剩余的段 —— 和 ccd `thinker.go` 的 `failStreak` 语义一致。

**失败要说真话。** 「有笔记没写出来」把最该看的一件事藏了：到底是线路不通、key 被拒，还是模型名写错。所以每块都带一个 `error` 字段，写失败时存进 provider 自己的原话（`error.code` 加 message，空白压成单行、超过 240 字符截断），工具栏于是显示 `转述失败: Connection error.` 而不是一句含糊的「没写出来」，后面跟一个**重试**按钮。点它会把这一块已经切过的段全部作废、按记录下来的原文重新切一遍（`POST /dsh-ccd/warm` 带 `retry: true`），所以 provider 挂一分钟不需要刷新页面 —— 段一旦切出去就没了，只有重切才能补上缺口。`error` 会随块一起落盘，刷新之后失败原因还在，不会变成一个「看起来还在写」的行。

**展开不闪原文。** Host 在切出那一段的**当下**就登记了这一块（`consumed` 已写、`busy` 为真），笔记要等模型回来才填进 `notes[0]`。所以「块已认领但笔记还在路上」是一种真实状态，按 `noteText === ''` 就显示原文同样会闪一帧。现在的规则是**只要笔记在路上就等**：还没问到 Host、笔记在途、这一轮还在流但段还没切出来 —— 三种都不显示原文，只占一个等高位置（`dccd-settling`），笔记到了直接换。工具栏也从第一帧就在，否则它出现时会把正文往下推一格。反过来，段切了却拿不到笔记（写失败）就按 ccd 的做法显示原文，不空着等 —— 判定逻辑是 `awaitingNote`，`test/pipeline.mjs` 逐种状态断言。

**笔记随时在写，不等展开。** 折叠的 reasoning 行根本不渲染正文，所以那一轮开始时页面上没有任何组件。插件把转述搬到 Host：`agent/assistant-stream` 是全局事件，不管界面显示什么都在推每一块 chunk（`{ global: true }` 必须显式给，否则 cordis 会按 fiber 作用域把它过滤掉，一个事件都收不到）。Host 自己累积 reasoning、每来一个 delta 就试着切段、切得出来就立刻并发转述，所以在思维链还没流完、你还没展开的时候，笔记已经一段一段写出来了。**每一个 reasoning 块各存一份**（一个会话里有很多块，每块是独立的一行，笔记不能串台），按 `turn:step:index` 索引，每会话最多记 24 块、最多 32 个会话。你展开任意一行时，客户端用 `GET /dsh-ccd/warm?sessionId=` 取回该会话所有块的笔记，**用 `consumed` 前缀认领属于这一行的那一条**（`consumed` 是那些笔记覆盖到的原文，含空白，最长前缀胜出；比较前两边都先按 `bareThought` 剥掉 `<signature>` 包裹，与 Host 记录时的口径一致），然后把 `notes` 按段序拼起来直接显示。语言同理：`language: auto` 时 Host 无从得知你的浏览器语言，所以页面**在插件加载时**就把 locale 报一次（`POST /dsh-ccd/locale`）；语言设置保存或 locale 变更会让已写的笔记整批作废，不会拿旧语言的笔记糊弄你。

**笔记不进 Session log。** Session log 照旧只有原文 —— 笔记是派生文本，写进去会污染压缩、分叉、重放的语义。但笔记会**落盘**（见下节），所以刷新、重启、重开历史会话都还在。

**流式闸门简化。** ccd 的 `Gate` 会扣住转述流末尾几个字再放行，好让敏感词在第一个字出去之前就被匹配到。这里一条笔记是整条生成、整条检查、整条放出的，严格性更强，所以只保留了拒绝规则（prefix / avoid / blocked）和按句读截断。

## 持久化

笔记写进一个 SQLite 文件：`%DSH_HOME%/storages/dsh_ccd_notes/notes.db`（Windows 上是 `C:\Users\<you>\.dsh\storages\dsh_ccd_notes\notes.db`，或用 `$DSH_HOME` 覆盖）。单独一个目录，WAL 的 `-wal`/`-shm` 兄弟文件也落在里面，不会在 `storages/` 根上撒文件。一张表：

```sql
CREATE TABLE notes (
  session TEXT NOT NULL,   -- 会话 id，索引在这里
  key     TEXT NOT NULL,   -- 思考块的 turn:step:index
  payload BLOB NOT NULL,   -- zstd 压缩过的 JSON
  at      INTEGER NOT NULL,
  PRIMARY KEY (session, key)
) STRICT;
```

`payload` 解压后是这一块的 `notes`、`cut`、`consumed`、`language`、`stopped`、`error`。一条记录就是一个块的全部状态，所以每次 settle 是 upsert 覆盖，不是追加。`error` 也在里面，所以刷新之后「为什么没有笔记」这个问题的答案不会跟着内存一起消失。

**为什么用 SQLite 而不是 storage service。** storage 的两种布局都不适合这个形状：`per-record` 是几千个小文件，每个带一层 `{version, record}` 包装、每次写一次原子 rename；`single` 是整份文档重写。8000 行派生文本要的是索引和页缓存。`node:sqlite` 是内置模块，和 `node:zlib` 一样零依赖 —— 这个插件除了 schemastery 之外仍然不引入任何东西。

**为什么压缩。** 一行里的大头是 `consumed`（这些笔记覆盖到的原文，用来让页面认领自己的块），它是自然语言、重复率高，zstd 通常能压到三分之一以下。整个 payload 一起压，不按字段拆列 —— 拆了反而要存两份元数据。运行时若没有 zstd（老 Node），`packNote` 退回存纯 UTF-8，`unpackNote` 靠 zstd 的魔数 `28 B5 2F FD` 区分，所以两种格式共存不会读错。

**为什么落在这里而不是 Session log。** `practices.md` 明令插件自有数据走自己的存储，不用 `appendPluginRecord`，也不许 append 新 type 的 session 事件 —— 后者会让 Session 拒绝重开。笔记是派生文本，写进 Session log 会污染压缩、分叉、重放的语义。

**回填。** 刷新页面后历史行的 reasoning 是 Session log 里的旧数据，不会重放 `agent/assistant-stream`，Host 里既没有缓存也没有触发路径。所以客户端开一行时**先 POST 一次** `/dsh-ccd/warm`（带 `sessionId` 和原文），一次往返同时完成「按需转述」和「读回」；GET 只负责后续轮询。对没存过的历史块，Host 当场切段转述并写盘；对已经存过的，直接读回。

**不复活旧语言。** 读回时跳过 `language` 与当前设置不一致的行 —— 拿旧语言的笔记糊弄比不显示更糟，跳过才能让同一块重新转述并覆盖。语言设置保存或 locale 变更会整批作废（`forgetWarm`），下一次读回就走新语言。

**有上限，且摊销。** 两道闸：先按**年龄**（`retainDays`，默认 14 天，`0` 关掉年龄这道闸），再按**条数**（最多 8000 行，超了按 `at` 淘汰最旧的）。年龄这道闸是「超过就作废」，因为笔记是缓存不是历史 —— 一个月前没人会再读的那一行，删掉的空间可以直接给新笔记用，文件不会只增不减。

裁剪不是每次写都做：每 32 次写才检查一次、且只在真的越界时才 `DELETE`，所以一次 settle 的代价就是一次 upsert。**唯一例外是打开数据库时**：页面关了一个月再开，中间没有任何写去触发摊销的清扫，所以 `openNotes` 收尾时直接扫一遍 —— 读者在第一次落盘之前就把空间拿回来了，而不是等 32 次 settle。`at` 每次 settle 都重写，所以仍在用的块会不断给自己续期，不会在活的会话底下过期。读一个会话是 `WHERE session = ?` 走主键索引，不扫全表。删掉的行留在文件的空闲页里，SQLite 会复用；不排期 `VACUUM`，那会在对话中途重写整个数据库。

**数据库不可用就退回内存。** 打不开只 `warn` 一行，笔记照旧在进程里工作，只是刷新后没了 —— 派生文本坏掉不该挡住对话。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 半。提示词全文、`Config` schema、输出闸门、两条转述路线（供应商 / 本地）、切段与随流并发转述（`agent/assistant-stream`）、笔记持久化（SQLite + zstd）、历史回填、七条 HTTP 路由 |
| `local.js` | 本地转述的运行时装了一半：pinned 资产表、源探测、边下边校验的下载、手写解压、`llama-server` 的起停与一次补全 |
| `client.js` | Client 半。向 Host 取笔记、按 `consumed` 前缀认领归属、按段序显示、本地模型的准备卡片、四个座位：reasoning body、侧栏入口、主面板页、插件页配置区 |
| `test/notes.mjs` | Host 半断言测试：`collectText`、`effortChoice`、`writeNote` 的拒绝缓存与预算翻倍、`describeFailure` 的失败文案 |
| `test/pipeline.mjs` | Client 半断言测试：warm 响应归一化、`consumed` 前缀归属、`notes` 拼接与丢段计数、轮询边界、历史行回填、重试参数 |
| `test/segment.mjs` | 切段器一致性：`index.js` 的 `takeSegments`/`targetOf` 必须与 `test/golden-segments.json` 的 163 个基准用例完全一致 |
| `test/store.mjs` | 持久化断言测试：记录契约、zstd 往返与压缩率、双会话隔离、替换非追加、软上限与摊销裁剪、年龄窗口与开库时的一次清扫、读回只取本会话且不复活旧语言、失败原因跨刷新保留 |
| `test/local.mjs` | 本地运行时断言测试：三个平台的资产表与平台缺口、估算覆盖、手写解压（zip 与 tar.gz，含目录穿越与逃逸符号链接）、失败分类、`.part` 不残留、正确文件免联网复用、源探测全失败时保持原序、删除只删自己放的文件 |
| `test/settings.mjs` | 设置往返：`first`/`step`/`max` 与 `streamFirst`/`streamStep`/`streamMax` 的别名、空数字框不会被存成最小值、表单真实的每个键都能存下来再读回来 |
| `test/golden-segments.json` | 切段基准。冻结自当年与 ccd `internal/thinkhide/segment.go` 逐例对齐（402 例零差异）的那份 JS 实现，所以它替 Go 版当基准 |
| `cordis.patch.yml` | 只 insert 一行 |
| `locale/{en,zh}.json` | 插件页标题与描述 |

测试直接跑源码，不需要 build 也不需要 Harness：

```
node test/notes.mjs
node test/pipeline.mjs
node test/segment.mjs
node test/store.mjs
node test/local.mjs
node test/settings.mjs
```

这几个脚本把 `index.js` / `client.js` 里的对应区段切出来、注入 stub 的 `llm` / `fetch` / storage table，所以测的是真代码而不是副本。`test/local.mjs` 更直接：它建真 zip、写真文件、算真摘要，因为要测的正是碰盘的那些部分。

路由：

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/dsh-ccd/config` | GET | 当前配置快照 |
| `/dsh-ccd/config` | POST | 白名单+夹取后写 `settings.update` |
| `/dsh-ccd/models` | GET | 列 provider；`?provider=X` 列模型 |
| `/dsh-ccd/notes` | POST | 按当前设置生成一条笔记（设置页的「试写一条」用；reasoning 正文不调用它） |
| `/dsh-ccd/warm` | GET | `?sessionId=` 取该会话每个思考块的笔记：`notes`（按段序）、`consumed`（这些笔记覆盖的原文，用于认领归属）、`cut`（已切段数，用于算丢段）、`language`、`busy`、`stopped`、`error`（写失败时 provider 的原话） |
| `/dsh-ccd/warm` | POST | `{sessionId, text, retry?}`：交上某一行历史思考的原文，Host 当场切段转述并写盘（没存过时），然后连同该会话已有的笔记一起返回。`retry: true` 表示这一块点过重试：丢弃已切段、按原文重切 |
| `/dsh-ccd/locale` | POST | 页面启动时上报浏览器语言，供 `language: auto` 的随流转述使用 |
| `/dsh-ccd/local` | GET | 本地模型的准备状态：阶段、步骤列表、字节进度、失败原因、估算是多少、数据目录在哪。纯读，页面随便轮 |
| `/dsh-ccd/local` | POST | `{action}`：`prepare` 开始下载、`cancel` 取消（已下好的保留）、`stop` 卸载权重、`remove` 先等进程退出再删掉已下载的文件（含跨重启遗留的 `llama-server`） |

`remove` 之后不必刷新：响应里的 `ready`/`missing` 是按磁盘重新判定的，所以删除按钮当场消失。`missing` 是 `inspectRuntime` 的结果（`runtime`/`model` 各一项），卡片用它判断"盘上还有东西可以删"——一个失败后留下的 `runtime/` 目录也算，那正是最想回收空间的时候。

Host 与 Client 之间走 `ctx.webServer.register` + `fetch`，不走 Typert remote —— 真 bundle 的 client 半在普通页面作用域里 `fetch` 可用（`dsh-experimental-inspector` 与社区 `dsh-element-lens` 都这么用）。

## 许可

MIT。dsh-ccd 自己写的 Host / Client / 本地模型管线都是 MIT；它形式上源自 ccd（那个 Go 项目），但 ccd 的还原机制在这里整段不存在，搬过来的只有切段、并发转述与提示词，这些也一并按 MIT 重写了。
