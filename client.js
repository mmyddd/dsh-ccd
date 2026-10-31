// dsh-ccd — Client half.
//
// The whole point lives here: the Session keeps the model's original reasoning, the
// model keeps reading it next turn, and only what the reader sees is replaced with
// short first-person notes. Nothing is rewritten, stored or restored, because the
// Session log is already the single source of truth.
//
// Seats taken:
//   conversation.chat.reasoning.body  priority 50, replaces the shipped body at 100
//   sidebar.panellist                 glyph, opens the settings page
//   main                              key 'dsh-ccd', the settings page itself
//   plugins.bundle.config             key 'dsh-ccd', the same form inline
//
// Written as hand-rolled CJS inside the ModuleLoader wrapper: no build step and no
// value import from any @deepseek-ai package, so a linked directory installs as-is.
// Styles ride along as a `<style>` node, as the community plugins do; nothing is
// appended to <head>.
window.__ModuleLoader__.load({
  id: 'dsh-ccd',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-ccd'
    const CONFIG_ROUTE = '/dsh-ccd/config'
    /**
     * The settings page's preview button.
     *
     * Reasoning bodies never call this: translation happens on the Host so that a
     * collapsed row is summarized too. The route stays for the form, where the reader
     * wants to see one note under the settings they are about to save.
     */
    const NOTES_ROUTE = '/dsh-ccd/notes'
    const MODELS_ROUTE = '/dsh-ccd/models'
    const WARM_ROUTE = '/dsh-ccd/warm'
    const LOCALE_ROUTE = '/dsh-ccd/locale'
    /** The shipped reasoning body sits at 100; a smaller value wins the single slot. */
    const REPLACING_PRIORITY = 50

    const TEXT = {
      en: {
        notes: 'Notes',
        original: 'Show original',
        pending: 'Writing notes…',
        dropped: 'Some notes were dropped',
        failed: 'Note writer failed',
        retry: 'Retry',
        copy: 'Copy',
        copied: 'Copied',
        codeTitle: 'Code',
        wrap: 'Wrap',
        unwrap: 'Unwrap',
        footnotes: 'Footnotes',
        pageTitle: 'Working notes',
        pageSubtitle: 'The model reads the full reasoning; you read one-sentence working notes.',
        pageBadge: 'ccd',
        sectionBasic: 'Basics',
        sectionWriter: 'Note writer',
        sectionSegments: 'Segmentation',
        sectionGate: 'Output gate',
        sectionStore: 'Storage',
        sectionLocal: 'Local model',
        writer: 'Note writer source',
        writerHint: 'A provider call, or a model running on this machine.',
        writerProvider: 'Configured provider',
        writerLocal: 'Local model',
        localName: 'MiniCPM5 2B',
        localThreads: 'Threads',
        localThreadsHint: 'CPU threads the local server may use.',
        localContext: 'Context size',
        localContextHint: 'Tokens the local server keeps in flight.',
        localIdleSec: 'Unload after',
        localIdleSecHint: 'Seconds idle before the weights are released. 0 keeps them loaded.',
        localDataRoot: 'Data directory',
        localDataRootHint: 'Where the runtime and model are downloaded. Empty uses the plugin data folder.',
        setupLocal: 'Downloads a small local model onto the machine running DSH. Nothing else has to be installed.',
        setupDisk: 'Disk',
        setupDiskValue: 'About {gb} GB, including the runtime and the download cache',
        setupMemory: 'Memory',
        setupMemoryValue: 'About {gb} GB once the model is loaded',
        setupTime: 'First setup',
        setupTimeValue: 'Roughly {min}-{max} minutes, depending on the network',
        setupNote: 'An estimate. A slow network takes longer; anything already downloaded is reused.',
        prepSteps: 'Preparation steps',
        prepUnprepared: 'Not downloaded yet',
        prepReady: 'Ready',
        prepFailed: 'Preparation failed',
        prepCancelled: 'Cancelled',
        prepUnsupported: 'Not available on this platform',
        unsupportedHint: 'Only local notes are unavailable here. Every other setting, and the provider route, still work.',
        step_runtime: 'Runtime',
        step_model: 'Model',
        why_dns: 'Could not resolve the host — check the network or the DNS.',
        why_timeout: 'Timed out; the source may be slow or blocked.',
        why_network: 'Connection dropped mid-download; another source may work.',
        why_certificate: 'Certificate rejected; a proxy or an intercepting filter is likely.',
        why_storage: 'No room on disk, or the directory is not writable.',
        why_integrity: 'The file arrived, but its digest does not match.',
        why_unknown: 'This source did not work; trying the next one.',
        working: 'Working…',
        localQuant: 'Quantisation',
        localQuantHint: 'Smaller downloads and less memory, at some cost in wording.',
        localQuantPicked: '{file} on disk, about {bits} bits per weight.',
        quantSwap: 'Already on disk: {name}. Switching adds the chosen file and keeps both, so you can compare them.',
        quantImatrix: 'imatrix',
        localSpeed: 'Speed',
        localSpeedValue: '{tps} tokens/s',
        localSpeedHint: 'Decode rate of the last note on this machine, prompt excluded.',
        localSpeedNever: 'No note written yet — the rate appears after the first one.',
        sourceChoice: 'Model download source',
        sourceAuto: 'Automatic (recommended)',
        sourceAutoHelp: 'Uses whichever source answers first, and falls back to the others.',
        sourceManualHelp: 'Only this source is tried.',
        prepare: 'Download and prepare',
        retryPrepare: 'Download again',
        cancelPrepare: 'Cancel',
        stopLocal: 'Unload model',
        removeLocal: 'Delete files',
        localRunning: 'Loaded on port {port}',
        sectionTry: 'Preview',
        enabled: 'Show notes',
        enabledHint: 'Off shows the raw reasoning everywhere.',
        language: 'Note language',
        languageHint: 'Follow browser picks between Chinese and English.',
        langAuto: 'Follow browser',
        langZh: 'Chinese',
        langEn: 'English',
        langCustom: 'Custom',
        customLanguage: 'Custom language',
        customLanguageHint: 'Only used when the language is custom. Max 40 characters.',
        provider: 'Provider',
        providerHint: 'Empty uses the session default model.',
        model: 'Model',
        modelHint: 'Empty uses the session default model.',
        modelNeedsProvider: 'Pick a provider first',
        maxTokens: 'Max tokens',
        maxTokensHint: 'Output cap for one note request.',
        temperature: 'Temperature',
        temperatureHint: '0 leaves the parameter unset.',
        first: 'First segment',
        firstHint: 'Target length of segment 0, in runes.',
        step: 'Growth per segment',
        stepHint: 'Added to the target for each further segment.',
        max: 'Segment ceiling',
        maxHint: 'Hard cap for any one segment.',
        maxSummaries: 'Max notes per reply',
        maxSummariesHint: '0 means unlimited.',
        minTail: 'Tail floor',
        minTailHint: 'A shorter leftover tail is dropped. 0 uses the language default.',
        maxRunes: 'Note length cap',
        maxRunesHint: '0 uses the language default: 200 Chinese, 420 otherwise.',
        retainDays: 'Keep notes for (days)',
        retainDaysHint: 'Notes older than this are deleted so the space is reused. 0 keeps them until the row cap.',
        parallel: 'Parallel notes',
        parallelHint: 'How many segments convert at once.',
        timeoutSec: 'Segment timeout',
        timeoutSecHint: 'Seconds. A timed-out segment falls back to the raw text.',
        prefix: 'Required opening',
        prefixHint: 'A note not starting with this is rejected and retried.',
        blockedRegex: 'Blocked pattern',
        blockedRegexHint: 'Case-insensitive regex. A match drops the whole note.',
        avoidPrefixes: 'Banned openings',
        avoidPrefixesHint: 'Comma separated. Only enforced on the first attempt.',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        saveFailed: 'Save failed',
        reload: 'Reload',
        test: 'Write a note',
        testing: 'Writing…',
        testFailed: 'The note writer failed',
        testEmpty: 'Paste a paragraph of reasoning first.',
        sampleHint: 'One paragraph of reasoning, converted with the settings above.',
        none: 'Not set',
        unlimited: 'Unlimited',
        loading: 'Loading…',
        seconds: 's',
      },
      zh: {
        notes: '笔记',
        original: '查看原文',
        pending: '正在写笔记…',
        dropped: '有笔记没写出来',
        failed: '转述失败',
        retry: '重试',
        copy: '复制',
        copied: '已复制',
        codeTitle: '代码',
        wrap: '换行',
        unwrap: '不换行',
        footnotes: '脚注',
        pageTitle: '思考笔记',
        pageSubtitle: '模型读到的是完整推理，你读到的是一两句话的工作笔记。',
        pageBadge: 'ccd',
        sectionBasic: '基础',
        sectionWriter: '转述模型',
        sectionSegments: '切段',
        sectionGate: '输出闸门',
        sectionStore: '存储',
        sectionLocal: '本地模型',
        writer: '转述来源',
        writerHint: '走已配置的供应商，或者跑在这台机器上的模型。',
        writerProvider: '已配置的供应商',
        writerLocal: '本地模型',
        localName: 'MiniCPM5 2B',
        localThreads: '线程数',
        localThreadsHint: '本地服务最多用几个 CPU 线程。',
        localContext: '上下文长度',
        localContextHint: '本地服务保留多少 token 的上下文。',
        localIdleSec: '闲置卸载',
        localIdleSecHint: '闲置这么多秒后释放模型内存。0 表示一直留着。',
        localDataRoot: '数据目录',
        localDataRootHint: '运行时和模型下载到哪里。留空用插件自己的数据目录。',
        setupLocal: '会在运行 DSH 的机器上下载一个小模型，不需要另装别的东西。',
        setupDisk: '硬盘空间',
        setupDiskValue: '建议预留约 {gb} GB，含运行时和下载缓存',
        setupMemory: '运行内存',
        setupMemoryValue: '模型加载后约 {gb} GB',
        setupTime: '首次准备',
        setupTimeValue: '参考 {min}–{max} 分钟，取决于网络',
        setupNote: '以上是估算；网络慢会更久。已经下好的部分会复用。',
        prepSteps: '准备步骤',
        prepUnprepared: '还没下载',
        prepReady: '已就绪',
        prepFailed: '准备失败',
        prepCancelled: '已取消',
        prepUnsupported: '这个平台没有可用的运行时',
        unsupportedHint: '只有本地转述在这一平台不可用；其余设置与供应商转述照常工作。',
        step_runtime: '运行时',
        step_model: '模型',
        why_dns: '域名解析失败，先看看网络和 DNS。',
        why_timeout: '超时了，这个源可能太慢，或者被挡了。',
        why_network: '下载中途断了，换一个源可能就好了。',
        why_certificate: '证书没通过，多半是代理或过滤设备在中间。',
        why_storage: '磁盘不够，或者那个目录写不进去。',
        why_integrity: '文件下全了，但摘要对不上。',
        why_unknown: '这个源没成，正在试下一个。',
        working: '进行中…',
        localQuant: '量化精度',
        localQuantHint: '越小下载越省、内存越少，措辞质量相应下降。',
        localQuantPicked: '磁盘上 {file}，约每权重 {bits} 位。',
        quantSwap: '盘上已经有 {name}。换档只是把选中的那份也下下来，两份都留着，可以对比。',
        quantImatrix: 'imatrix',
        localSpeed: '速度',
        localSpeedValue: '{tps} token/秒',
        localSpeedHint: '这台机器上一次写笔记的解码速度，不含读 prompt 的时间。',
        localSpeedNever: '还没写过笔记，写完第一条就会显示速度。',
        sourceChoice: '模型下载源',
        sourceAuto: '自动选择（推荐）',
        sourceAutoHelp: '先用响应最快的源，失败时自动换别的。',
        sourceManualHelp: '只试这一个源。',
        prepare: '下载并准备',
        retryPrepare: '重新下载',
        cancelPrepare: '取消',
        stopLocal: '卸载模型',
        removeLocal: '删除文件',
        localRunning: '已加载，端口 {port}',
        sectionTry: '预览',
        enabled: '显示笔记',
        enabledHint: '关掉以后到处都直接显示原文。',
        language: '笔记语言',
        languageHint: '跟随浏览器时按语言在中文和英文之间选。',
        langAuto: '跟随浏览器',
        langZh: '中文',
        langEn: 'English',
        langCustom: '自定义',
        customLanguage: '自定义语言',
        customLanguageHint: '只在语言选自定义时生效，最多 40 字。',
        provider: '供应商',
        providerHint: '留空用会话默认模型。',
        model: '模型',
        modelHint: '留空用会话默认模型。',
        modelNeedsProvider: '先选供应商',
        maxTokens: '输出上限',
        maxTokensHint: '单次转述请求的 token 上限。',
        temperature: '温度',
        temperatureHint: '0 表示不传这个参数。',
        first: '首段目标字数',
        firstHint: '第 0 段的目标长度。',
        step: '每段递增',
        stepHint: '往后每段在目标长度上增加多少字。',
        max: '单段上限',
        maxHint: '任何一段的硬上限。',
        maxSummaries: '每轮最多几段',
        maxSummariesHint: '0 表示不限。',
        minTail: '尾巴丢弃阈值',
        minTailHint: '剩下的字少于此值就不转述了。0 用语言默认值。',
        maxRunes: '笔记字数上限',
        maxRunesHint: '0 用语言默认值：中文 200，其它 420。',
        retainDays: '笔记保留天数',
        retainDaysHint: '超过这么多天的笔记会被删掉，空间好回收。0 表示只受条数上限约束。',
        parallel: '并发转述数',
        parallelHint: '同时转述几段。',
        timeoutSec: '单段超时',
        timeoutSecHint: '单位秒。超时的这一段回落成原文。',
        prefix: '强制开头',
        prefixHint: '不以它开头的笔记会被丢弃并重试。',
        blockedRegex: '敏感词正则',
        blockedRegexHint: '不区分大小写。命中就整段作废。',
        avoidPrefixes: '禁用开头',
        avoidPrefixesHint: '英文逗号分隔。只对首次尝试生效。',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        saveFailed: '保存失败',
        reload: '重新读取',
        test: '试写一条',
        testing: '正在写…',
        testFailed: '转述失败',
        testEmpty: '先贴一段推理进来。',
        sampleHint: '贴一段推理，用上面的设置转述一次。',
        none: '未设置',
        unlimited: '不限',
        loading: '读取中…',
        seconds: '秒',
      },
    }

    // ── config ─────────────────────────────────────────────────────────────

    let configTask
    /** The last config this page received, so a later row needs no round trip to decide. */
    let configValue

    function loadConfig() {
      configTask ??= fetch(CONFIG_ROUTE, { headers: { accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() : undefined))
        .then((value) => {
          if (value !== undefined) configValue = value
          return value
        })
        .catch(() => undefined)
      return configTask
    }

    /** A saved form must reach the reasoning body without a page reload. */
    function invalidateConfig() {
      configTask = undefined
    }

    /**
     * The browser's own language, so `auto` can follow it. Sent on every note request:
     * the Host ignores it unless the language setting is `auto`, because an explicit
     * zh/en/custom choice must survive a user whose UI runs in another language.
     */
    function browserLocale() {
      const nav = typeof navigator === 'undefined' ? undefined : navigator
      const list = nav?.languages
      if (Array.isArray(list) && typeof list[0] === 'string' && list[0] !== '') return list[0]
      return typeof nav?.language === 'string' ? nav.language : ''
    }

    /**
     * Report this page's locale to the Host once.
     *
     * A warm note is written before the reasoning row mounts, so nothing on the Host
     * can ask the browser which language the reader wants at that moment. The page is
     * up long before any row is, so it tells the Host here once and `auto` keeps
     * working for notes no component asked for.
     */
    let localeReported = false

    function reportLocale() {
      if (localeReported) return
      const locale = browserLocale()
      if (locale === '') return
      localeReported = true
      void fetch(LOCALE_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      }).catch(() => { localeReported = false })
    }

    // ── Host notes ─────────────────────────────────────────────────────────
    // Translation lives on the Host, not here. The Host sees the reasoning stream whether
    // or not this row is open, so a block's notes are already being written while the row
    // is still collapsed and collapsing never interrupts them. This half only asks and
    // displays — which is also what removes the frame of raw text that used to appear
    // before the first note landed.

    /** How long the body may stay blank waiting for its first answer. */
    const SETTLE_MS = 3000

    /** How often a row asks again while its block is still being summarized. */
    const POLL_MS = 400

    /** The last answer per session, so a later row renders notes on its very first frame. */
    const warmCache = new Map()

    /** Ask the Host which reasoning blocks of this session it has noted so far. */
    function loadWarm(sessionId) {
      return fetch(`${WARM_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: { accept: 'application/json' },
      })
        .then((response) => (response.ok ? response.json() : undefined))
        .then(readWarm)
        .catch(() => undefined)
    }

    /**
     * Ask the Host to summarize reasoning it never saw stream.
     *
     * A session opened from history replays its reasoning out of the Session log, so no
     * `assistant-stream` frame ever carried it and nothing was noted. Posting the text the
     * row is showing gets it noted now — and stored, so the next visit needs no model call.
     */
    function fillWarm(sessionId, text, retry) {
      return fetch(WARM_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sessionId, text, retry: retry === true }),
      })
        .then((response) => (response.ok ? response.json() : undefined))
        .then(readWarm)
        .catch(() => undefined)
    }

    /** Normalise one `warm` response into the rows this half reasons about. */
    function readWarm(value) {
      if (value === undefined || value === null) return undefined
      const blocks = Array.isArray(value.blocks) ? value.blocks : []
      const picked = []
      for (const block of blocks) {
        if (block === null || typeof block !== 'object') continue
        picked.push({
          notes: Array.isArray(block.notes) ? block.notes.filter((note) => typeof note === 'string' && note !== '') : [],
          language: typeof block.language === 'string' ? block.language : '',
          // The reasoning those notes were derived from. A row recognises itself by
          // checking that its own text starts with this.
          consumed: typeof block.consumed === 'string' ? block.consumed : '',
          cut: typeof block.cut === 'number' ? block.cut : 0,
          busy: block.busy === true,
          stopped: block.stopped === true,
          // Why the writer failed, in the provider's own words. Empty when healthy.
          error: typeof block.error === 'string' ? block.error : '',
        })
      }
      return { sessionId: value.sessionId ?? '', blocks: picked }
    }

    /**
     * The block whose notes describe this row.
     *
     * A session has many reasoning blocks — several steps per turn, several turns — and
     * they all stream through the same Host pipeline in order. A row therefore owns the
     * block whose consumed reasoning is a prefix of the text it is showing, and the longest
     * such prefix wins, because that is the one that has got furthest through this text.
     */
    function warmForRow(blocks, rawText) {
      if (!Array.isArray(blocks) || rawText === '') return undefined
      let best
      for (const block of blocks) {
        if (block.consumed === '') continue
        if (!rawText.startsWith(block.consumed) && !block.consumed.startsWith(rawText)) continue
        if (best === undefined || block.consumed.length > best.consumed.length) best = block
      }
      return best
    }

    /**
     * The language the Host would pick for `language: auto` right now.
     *
     * Mirrors `resolveLanguage` in `index.js`. A note written under a setting the reader
     * has since changed is worse than none: showing English to a Chinese reader looks
     * like the setting was ignored.
     */
    function expectedLanguage(config) {
      const configured = config?.language ?? 'auto'
      if (configured === 'zh' || configured === 'en' || configured === 'custom') return configured
      return /^zh/i.test(browserLocale()) ? 'zh' : 'en'
    }

    /**
     * Strip the signature wrapper some routes put around reasoning.
     *
     * Mirrors `reasoningText` in the shipped chat UI, and the Host's own unwrapping: the
     * notes describe the thinking, so matching and displaying both have to happen in the
     * same space as `consumed`, which never contains the wrapper.
     */
    function bareThought(text) {
      if (typeof text !== 'string' || text === '') return ''
      if (text[0] !== '<') return text
      const opening = '<signature>'
      if (opening.startsWith(text)) return ''
      if (!text.startsWith(opening)) return text
      const close = text.indexOf('</signature>')
      if (close < 0) return ''
      return text.slice(close + 12).replace(/^\r?\n/, '')
    }

    /**
     * Whether this row should wait instead of showing the reasoning it already has.
     *
     * Three situations have a note on the way, and showing the raw text in any of them
     * produces the same one-frame flash — the text appears, then is replaced:
     *
     * - the Host has not been asked yet (`heard` false), or has not answered in time;
     * - the block is claimed but its first note is still being written (`busy`);
     * - the block is claimed, nothing is in flight, and the segment has not been cut yet
     *   (`cut === 0`) while the turn still streams.
     *
     * A block that was cut and then lost its note is *not* waited for: `cut > 0` with no
     * note and nothing in flight means the writer failed, and ccd's answer to that is to
     * leave the gap and show the reasoning rather than a blank.
     *
     * @param state - the row's matching block, its query state, and whether it streams.
     * @returns true when a placeholder should hold the body's place.
     */
    function awaitingNote(state) {
      const { match, heard, gaveUp, running } = state
      // `gaveUp` is the only escape hatch for the unmatched case: a Host that never answered
      // must not leave the body blank for the whole turn, so the backstop wins over streaming.
      if (match === undefined) return !gaveUp && (running || !heard)
      // A failure is an answer. Waiting past it would blank the row while the writer is
      // known to be down, which is worse than showing the reasoning the reader came for.
      if (match.error !== '' && match.error !== undefined) return false
      if (match.stopped) return false
      if (match.notes.length > 0) return false
      return match.busy || (running && match.cut === 0)
    }

    function ReasoningNotes(props) {
      const { rawText, text: displayText, running, renderFactorySlot, t, sessionId } = props
      // `rawText` is the untouched model output; `text` is what the transcript would show.
      // Matching has to use the same form the Host recorded as `consumed`, and both of them
      // may carry a signature wrapper that neither side keeps.
      const shown = typeof displayText === 'string' && displayText !== '' ? displayText : rawText
      const own = bareThought(shown)
      const [config, setConfig] = React.useState(configValue)
      const [original, setOriginal] = React.useState(false)
      const [blocks, setBlocks] = React.useState(() => warmCache.get(sessionId) ?? [])
      // False until this mount has heard from the Host once. Whether the cache spares us that
      // wait depends on the row, not the session: it only helps when it already holds a block
      // whose consumed text is *this* row's. A block that started streaming after the last
      // poll is not in it, and rendering raw reasoning while the first request flies is
      // exactly the one-frame flash.
      const [heard, setHeard] = React.useState(
        () => warmForRow(warmCache.get(sessionId) ?? [], own) !== undefined,
      )
      // Waiting is not free either: a Host that never maps this row (no session id, a key it
      // does not know) would leave the body blank for the whole turn. After this long the row
      // gives up and shows the reasoning, which is what ccd does with a segment it cannot
      // summarize.
      const [gaveUp, setGaveUp] = React.useState(false)
      // Bumped by the retry button. It re-runs the query effect with a flag the Host reads
      // as "throw away what failed and cut this block again", which is the only way a gap
      // gets filled without reloading the page.
      const [attempt, setAttempt] = React.useState(0)
      // The newest values, for the polling loop: it outlives any single render.
      const latestText = React.useRef(own)
      const latestRunning = React.useRef(running)
      latestText.current = own
      latestRunning.current = running

      React.useEffect(() => {
        let live = true
        loadConfig().then((value) => {
          if (live) setConfig(value)
        })
        return () => {
          live = false
        }
      }, [])

      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') {
          setHeard(true)
          setGaveUp(true)
          return undefined
        }
        let live = true
        let timer
        // A retry press is spent on the first question of this effect run: it re-sends the
        // row's text so the Host can re-cut the block, and everything after it polls as usual.
        let armed = attempt > 0
        const clear = () => {
          if (timer === undefined) return
          clearTimeout(timer)
          timer = undefined
        }
        const apply = (value) => {
          if (value !== undefined) {
            warmCache.set(sessionId, value.blocks)
            setBlocks(value.blocks)
          }
          setHeard(true)
          return value === undefined ? undefined : warmForRow(value.blocks, latestText.current)
        }
        // The first question is a POST carrying this row's text. For a live turn that is the
        // same answer a GET would give; for a row opened from history it is the only way the
        // Host ever learns the reasoning — nothing streamed it, so nothing had noted it.
        // Either way it is one round trip, not a probe followed by a fill.
        const ask = (first) => {
          const text = latestText.current
          // Only the first question and the retry press send the text: a plain GET keeps
          // the row current afterwards without asking the Host to re-cut anything.
          const retry = armed
          const post = retry || (first && text !== '')
          armed = false
          const request = post ? fillWarm(sessionId, text, retry) : loadWarm(sessionId)
          request.then((value) => {
            if (!live) return
            const match = apply(value)
            // A retry wiped the block, so its first note is being written again.
            if (retry) setGaveUp(false)
            // On a back-filled row the Host answered with the block, but its first note is
            // still being written; keep asking until it lands.
            if (post && value !== undefined && match !== undefined && match.notes.length === 0) {
              timer = setTimeout(() => run(false), POLL_MS)
              timer?.unref?.()
              return
            }
            // Keep asking while the turn still streams, and while the block this row owns
            // is still being summarized after the turn ended.
            if (!latestRunning.current && (match === undefined || !match.busy)) return
            timer = setTimeout(() => run(false), POLL_MS)
            timer?.unref?.()
          })
        }
        const run = (first) => {
          clear()
          ask(first)
        }
        run(true)
        // A hung request, or a Host that never learned this row, must not leave it blank.
        const fallback = setTimeout(() => {
          if (live) setGaveUp(true)
        }, SETTLE_MS)
        fallback?.unref?.()
        return () => {
          live = false
          clear()
          clearTimeout(fallback)
        }
      }, [sessionId, attempt])

      const match = warmForRow(blocks, own)
      const wrongLanguage = match !== undefined
        && match.language !== ''
        && match.language !== expectedLanguage(config)
      const noteText = match === undefined || wrongLanguage ? '' : match.notes.join('\n\n')
      const busy = match !== undefined && match.busy
      // A gap means one segment's translation failed and the Host left its slot empty; it
      // is reported rather than hidden, and never discards the notes around it.
      const dropped = match === undefined || busy || wrongLanguage ? 0 : Math.max(0, match.cut - match.notes.length)
      // The provider's own words when the writer failed. This is what tells the reader the
      // difference between "still writing" and "the model route is down".
      const failure = match === undefined || wrongLanguage ? '' : match.error
      const pending = noteText === '' && own !== '' && failure === ''
      const awaiting = awaitingNote({ match, heard, gaveUp, running })
      const disabled = config?.enabled === false
      // ccd's rule, kept exactly: notes once they exist, raw reasoning before the first one
      // is written and whenever the reader asks for it.
      const showOriginal = disabled || original || noteText === ''

      const labels = React.useMemo(() => ({
        code: {
          copyLabel: t('copy'),
          copiedLabel: t('copied'),
          toolbarLabels: {
            codeLabel: t('codeTitle'),
            wrapLabel: t('wrap'),
            unwrapLabel: t('unwrap'),
          },
        },
        footnotes: t('footnotes'),
      }), [t])

      if (disabled) {
        return h('div', { 'data-ccd': 'reasoning', 'data-ccd-view': 'off' },
          renderFactorySlot('conversation.chat.reasoning.content', { text: rawText, running, labels }))
      }

      // The row's bar is present from the first frame, waiting or not: rendering it only once
      // the note lands pushes the body down by its own height, which is the same visible jump
      // as swapping the text. While waiting it carries only the status text, in the same
      // 18px line box, so the bar does not change size when the note arrives.
      const bar = (children) => h('div', { key: 'toolbar', className: 'dccd-bar' }, children)
      // A failure is reported in the writer's own words rather than as "some notes were
      // dropped": the reader has to be able to tell a dead provider from a slow one, and
      // that is the whole reason the raw reasoning is still on screen behind it.
      const status = failure !== ''
        ? h('span', {
          key: 'status',
          className: 'dccd-note dccd-bad dccd-trim',
          role: 'status',
          title: `${t('failed')}: ${failure}`,
        }, `${t('failed')}: ${failure}`)
        : dropped > 0
          ? h('span', { key: 'status', className: 'dccd-note dccd-bad', role: 'status' }, t('dropped'))
          : pending
            ? h('span', { key: 'status', className: 'dccd-note', role: 'status' }, t('pending'))
            : null

      if (awaiting) {
        return h('div', {
          className: 'dccd-reasoning',
          'data-ccd': 'reasoning',
          'data-ccd-state': 'settling',
          'data-ccd-view': 'none',
          'aria-busy': true,
        }, [
          h('style', { key: 'css' }, CSS),
          bar([h('span', { key: 'status', className: 'dccd-note', role: 'status' }, t('pending'))]),
          h('div', { key: 'body', className: 'dccd-settling' }),
        ])
      }

      const toolbar = bar([
        h('button', {
          key: 'toggle',
          type: 'button',
          className: 'dccd-link',
          disabled: noteText === '',
          onClick: () => setOriginal((value) => !value),
          'data-ccd-action': showOriginal ? 'notes' : 'original',
        }, showOriginal ? t('notes') : t('original')),
        status,
        // Offered only when there is something to redo: a provider that came back should
        // not cost a page reload, and the gap it left is otherwise permanent.
        failure !== '' && own !== ''
          ? h('button', {
            key: 'retry',
            type: 'button',
            className: 'dccd-link dccd-retry',
            onClick: () => setAttempt((value) => value + 1),
            'data-ccd-action': 'retry',
          }, t('retry'))
          : null,
      ])

      return h('div', {
        className: 'dccd-reasoning',
        'data-ccd': 'reasoning',
        'data-ccd-state': failure !== '' ? 'failed' : pending ? 'pending' : 'ready',
        'data-ccd-view': showOriginal ? 'original' : 'notes',
      }, [
        h('style', { key: 'css' }, CSS),
        toolbar,
        h('div', {
          key: 'body',
          'data-ccd-body': true,
        }, renderFactorySlot('conversation.chat.reasoning.content', {
          text: showOriginal ? rawText : noteText,
          running: showOriginal ? running : false,
          labels,
        })),
      ])
    }

    // ── styling ────────────────────────────────────────────────────────────
    // Copied from the shipped settings rows and the plugin-manager form: half-pixel
    // strokes, layer-3 field fills, 16px row rhythm, 14/12 type pair. Class names are
    // prefixed so nothing can collide with harness styles.

    const CSS = `
.dccd-reasoning{margin:2px 0 4px}
.dccd-bar{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dccd-link{border:0;background:0 0;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer;text-align:left}
.dccd-link:hover:not(:disabled){color:var(--dsw-alias-label-secondary)}
.dccd-link:disabled{cursor:default;opacity:.6}
.dccd-note{color:var(--dsw-alias-label-tertiary)}
.dccd-bad{color:var(--dsw-alias-state-error-primary)}
.dccd-settling{min-height:18px}
.dccd-trim{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dccd-retry{flex:none;text-decoration:underline;text-underline-offset:2px;color:var(--dsw-alias-label-secondary)}

.dccd-page{box-sizing:border-box;height:100%;overflow:auto;background:var(--dsw-alias-bg-base);padding:0 clamp(20px,4vw,48px) 48px}
.dccd-wrap{max-width:760px;margin:0 auto;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.dccd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:28px 0 8px}
.dccd-head-main{min-width:0}
.dccd-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.dccd-sub{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dccd-badge{flex:none;margin-top:2px;padding:0 7px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px}

.dccd-section{padding-top:20px}
.dccd-section-title{margin:0;padding:0 0 2px;font-size:14px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}
.dccd-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dccd-section>.dccd-row:last-child{border-bottom:0}
.dccd-label{min-width:0}
.dccd-label b{display:block;font-weight:400;font-size:14px;line-height:20px}
.dccd-label span{display:block;margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dccd-ctl{flex:none;display:flex;align-items:center;gap:8px}

.dccd-input{box-sizing:border-box;height:32px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:0 10px;outline:none;appearance:auto}
.dccd-input:hover:not(:disabled){border-color:var(--dsw-alias-border-l3)}
.dccd-input:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-business-primary)}
.dccd-input:disabled{opacity:.55;cursor:not-allowed}
.dccd-num{width:92px;text-align:right;font-variant-numeric:tabular-nums}
.dccd-text{width:220px}
.dccd-sel{width:220px;padding-right:6px;cursor:pointer}
.dccd-box{width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}

.dccd-area{box-sizing:border-box;width:100%;min-height:88px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:8px 10px;outline:none;resize:vertical}
.dccd-area:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-business-primary)}
.dccd-block{padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dccd-out{margin:10px 0 0;padding:10px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);font-size:13px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
.dccd-out-bad{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}

.dccd-foot{display:flex;align-items:center;gap:8px;padding:20px 0 0;margin-top:8px;border-top:.5px solid var(--dsw-alias-border-l2)}
.dccd-btn{box-sizing:border-box;height:32px;padding:0 12px;border-radius:var(--dsw-radius-md);border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer}
.dccd-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dccd-btn:disabled{opacity:.5;cursor:default}
.dccd-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.dccd-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill))}
.dccd-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dccd-danger:hover:not(:disabled){background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground)}
.dccd-status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin-left:4px}
.dccd-ok{color:var(--dsw-alias-state-success-primary)}
.dccd-err{color:var(--dsw-alias-state-error-primary)}
.dccd-empty{padding:16px 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}

.dccd-prep{display:flex;flex-direction:column;gap:10px;margin:12px 0;padding:14px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);font-size:13px;line-height:20px}
.dccd-prep p{margin:0}
.dccd-prep-name{font-weight:500;color:var(--dsw-alias-label-primary)}
.dccd-estimate{display:grid;gap:10px;padding:12px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);line-height:1.6}
.dccd-estimate dl{display:grid;gap:6px;margin:0}
.dccd-estimate dl>div{display:grid;grid-template-columns:72px minmax(0,1fr);gap:10px}
.dccd-estimate dt{color:var(--dsw-alias-label-tertiary)}
.dccd-estimate dd{margin:0}
.dccd-estimate small{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dccd-prep-head{display:flex;align-items:center;gap:8px;min-height:28px;cursor:pointer}
.dccd-prep-head[data-expandable=false]{cursor:default}
.dccd-prep-title{flex:1;min-width:0}
.dccd-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.dccd-dot[data-state=running]{background:var(--dsw-alias-state-business-primary)}
.dccd-dot[data-state=complete]{background:var(--dsw-alias-state-success-primary)}
.dccd-dot[data-state=failed]{background:var(--dsw-alias-state-error-primary)}
.dccd-chev{flex:none;width:8px;height:8px;margin-right:2px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);transition:transform .12s ease}
.dccd-chev[data-open=true]{transform:rotate(-135deg)}
.dccd-steps{display:flex;flex-direction:column;gap:14px;margin:0;padding:16px 0 2px;list-style:none}
.dccd-step{display:flex;align-items:flex-start;gap:10px;line-height:18px}
.dccd-step[data-step-state=pending]{color:var(--dsw-alias-label-tertiary)}
.dccd-step-body{flex:1;min-width:0}
.dccd-step-prog{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.dccd-step-res{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.dccd-step-why{font-size:11px;color:var(--dsw-alias-state-warn-primary);overflow-wrap:anywhere}
.dccd-metric{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dccd-bar-track{width:100%;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.dccd-bar-fill{height:100%;background:var(--dsw-alias-state-business-primary);transition:width .2s ease}
.dccd-quant{display:grid;gap:6px}
.dccd-quant label{display:grid;grid-template-columns:100px minmax(120px,280px);align-items:center;gap:12px}
/* A read-only row: the value column keeps the same track as the pickers so the numbers line up. */
.dccd-quant label>span:last-child{justify-self:start;font-variant-numeric:tabular-nums}
.dccd-quant select{padding:6px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:0 0;color:inherit;font:inherit}
.dccd-swap{color:var(--dsw-alias-state-warn-primary)}
.dccd-source{display:grid;gap:6px}
.dccd-source label{display:grid;grid-template-columns:100px minmax(120px,280px);align-items:center;gap:12px}
.dccd-source select{padding:6px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:0 0;color:inherit;font:inherit}
.dccd-prep-actions{display:flex;gap:8px}
.dccd-prep-actions:empty{display:none}
.dccd-prep-error{font-size:12px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere}
.dccd-prep-note{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dccd-prep-root{overflow-wrap:anywhere}
@media (width<=480px){.dccd-estimate dl>div,.dccd-source label,.dccd-quant label{grid-template-columns:minmax(0,1fr);gap:6px}}
`

    // ── settings form ──────────────────────────────────────────────────────

    /** Field name → [section, min, max, step]. Order here is the order shown. */
    const NUMBERS = [
      ['maxTokens', 'writer', 1, 8192, 1],
      ['temperature', 'writer', 0, 2, 0.05],
      ['first', 'segments', 40, 4000, 1],
      ['step', 'segments', 0, 4000, 1],
      ['max', 'segments', 200, 20000, 1],
      ['maxSummaries', 'segments', 0, 200, 1],
      ['minTail', 'segments', 0, 2000, 1],
      ['maxRunes', 'segments', 0, 2000, 1],
      ['parallel', 'segments', 1, 16, 1],
      ['timeoutSec', 'segments', 3, 300, 1],
      ['retainDays', 'store', 0, 3650, 1],
      ['localThreads', 'local', 1, 64, 1],
      ['localContext', 'local', 2048, 65536, 256],
      ['localIdleSec', 'local', 0, 3600, 10],
    ]

    const KEYS = [
      'enabled', 'provider', 'model', 'maxTokens', 'temperature',
      'language', 'customLanguage', 'parallel', 'timeoutSec', 'maxSummaries', 'minTail',
      'maxRunes', 'retainDays', 'first', 'step', 'max', 'prefix', 'blockedRegex', 'avoidPrefixes',
      'writer', 'localDataRoot', 'localQuant', 'localThreads', 'localContext', 'localIdleSec',
    ]

    function draftOf(snapshot) {
      const draft = {}
      for (const key of KEYS) {
        const value = snapshot?.[key]
        if (Array.isArray(value)) draft[key] = value.slice()
        else if (value === undefined || value === null) draft[key] = ''
        else draft[key] = value
      }
      return draft
    }

    function Row(props) {
      return h('div', { className: 'dccd-row' }, [
        h('div', { key: 'label', className: 'dccd-label' }, [
          h('b', { key: 'name' }, props.label),
          props.hint === undefined ? null : h('span', { key: 'hint' }, props.hint),
        ]),
        h('div', { key: 'ctl', className: 'dccd-ctl' }, props.children),
      ])
    }

    function Section(props) {
      return h('section', { className: 'dccd-section' }, [
        h('h3', { key: 'title', className: 'dccd-section-title' }, props.title),
        ...props.children,
      ])
    }

    /**
     * A dropdown over known options, a typed field when they are not known yet.
     * `as` forces one or the other so the control cannot silently change shape.
     */
    function Picker(props) {
      const options = props.options ?? []
      const value = props.value ?? ''
      if (props.as === 'text' || options.length === 0) {
        return h('input', {
          className: 'dccd-input dccd-text',
          type: 'text',
          value,
          placeholder: props.placeholder ?? '',
          disabled: props.disabled === true,
          onChange: (event) => props.onChange(event.target.value),
          'aria-label': props.label,
        })
      }
      const seen = new Set(options.map((option) => option.value))
      const all = value !== '' && !seen.has(value)
        ? options.concat([{ value, label: value }])
        : options
      return h('select', {
        className: 'dccd-input dccd-sel',
        value,
        disabled: props.disabled === true,
        onChange: (event) => props.onChange(event.target.value),
        'aria-label': props.label,
      }, all.map((option) => h('option', { key: option.value, value: option.value }, option.label)))
    }

    function Num(props) {
      return h('input', {
        className: 'dccd-input dccd-num',
        type: 'number',
        value: props.value === '' || props.value === undefined ? '' : String(props.value),
        min: props.min,
        max: props.max,
        step: props.step,
        disabled: props.disabled === true,
        onChange: (event) => props.onChange(event.target.value),
        'aria-label': props.label,
      })
    }

    // ── local model preparation ────────────────────────────────────────────
    // The card is modelled on the shipped speech-to-text preparation panel: an estimate
    // before anything is downloaded, a disclosure row that shows what is happening, a
    // bar while bytes arrive, and a source chooser when more than one is offered. It is
    // drawn with this plugin's own classes rather than the shipped primitives, so the
    // package keeps installing as a plain linked directory.

    const LOCAL_ROUTE = '/dsh-ccd/local'
    const LOCAL_POLL_MS = 600
    const LOCAL_IDLE_POLL_MS = 5000

    function loadLocal() {
      return fetch(LOCAL_ROUTE, { headers: { accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() : undefined))
        .catch(() => undefined)
    }

    /**
     * One action on the local writer.
     *
     * A refusal has to arrive as data, not as `undefined`: the difference between "the Host
     * said no" and "nothing happened" is the whole difference between a reader trying again
     * and a reader concluding the button is broken.
     */
    function actLocal(action, extra) {
      return fetch(LOCAL_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...(extra ?? {}) }),
      })
        .then((response) => (response.ok ? response.json() : response.json().then(
          (body) => ({ failed: typeof body?.message === 'string' && body.message !== '' ? body.message : `HTTP ${response.status}` }),
          () => ({ failed: `HTTP ${response.status}` }),
        )))
        .catch((error) => ({ failed: error instanceof Error ? error.message : String(error) }))
    }

    /** `unprepared` / `cancelled` / `failed` are the states a press can start from. */
    function canPrepare(phase) {
      return phase === 'unprepared' || phase === 'cancelled' || phase === 'failed'
    }

    function isPreparing(phase) {
      return phase === 'checking' || phase === 'downloading'
    }

    function gigabytes(bytes) {
      const value = Number(bytes)
      if (!Number.isFinite(value) || value <= 0) return '?'
      return String(Math.round((value / 1e9) * 10) / 10)
    }

    function megabytes(bytes) {
      const value = Number(bytes)
      if (!Number.isFinite(value) || value <= 0) return '0'
      return String(Math.round((value / 1e6) * 10) / 10)
    }

    /** A dot that carries the step's state; the colour comes from the CSS, not from props. */
    function StateDot(props) {
      return h('span', {
        className: 'dccd-dot',
        'data-state': props.state ?? 'pending',
        'aria-hidden': true,
      })
    }

    /**
     * One prepared resource: the runtime, then the model.
     *
     * @param props - `step`, the phase the whole job is in, and the labels.
     */
    function PrepStep(props) {
      const { step, phase, t } = props
      const status = step.status ?? 'pending'
      const running = status === 'running'
      const percent = step.totalBytes > 0 ? Math.min(100, (step.receivedBytes / step.totalBytes) * 100) : 0
      // A source that failed while another is being tried is not the step failing. It is
      // worth a line — the reader wants to know why the mirror was abandoned — but the
      // status dot should keep saying "running".
      const note = step.failure === undefined ? '' : t('why_' + (step.failure.reason ?? 'unknown'))
      return h('li', {
        className: 'dccd-step',
        'data-step': step.kind,
        'data-step-state': status,
        'aria-label': t('step_' + step.kind),
      }, [
        h(StateDot, { key: 'dot', state: status }),
        h('div', { key: 'body', className: 'dccd-step-body' }, [
          h('span', { key: 'label', className: 'dccd-step-label' }, t('step_' + step.kind)),
          running
            ? h('div', { key: 'prog', className: 'dccd-step-prog' }, [
              h('span', {
                key: 'metric',
                className: 'dccd-metric',
                role: 'status',
              }, step.totalBytes > 0
                ? `${megabytes(step.receivedBytes)} / ${megabytes(step.totalBytes)} MB`
                : t('working')),
              h('div', { key: 'bar', className: 'dccd-bar-track' }, [
                h('div', {
                  key: 'fill',
                  className: 'dccd-bar-fill',
                  style: { width: `${percent}%` },
                }),
              ]),
              phase === 'downloading' && step.resource !== undefined && step.resource !== ''
                ? h('small', { key: 'res', className: 'dccd-step-res' }, step.resource)
                : null,
            ])
            : null,
          note !== ''
            ? h('small', { key: 'why', className: 'dccd-step-why' }, note)
            : null,
        ]),
      ])
    }

    /**
     * The measured decode rate, as a read-only row.
     *
     * It says "no note written yet" rather than "0" or a dash with no explanation: this is
     * measured, not configured, so the only honest empty state is naming why it is empty.
     */
    function SpeedRow(props) {
      const { t, speed } = props
      const rate = Number(speed?.tokensPerSecond)
      const known = Number.isFinite(rate) && rate > 0
      return h('div', { className: 'dccd-quant' }, [
        h('label', { key: 'label' }, [
          h('span', { key: 'name' }, t('localSpeed')),
          h('span', {
            key: 'value',
            className: 'dccd-metric',
            'data-ccd-speed': known ? String(rate) : undefined,
          }, known ? t('localSpeedValue', { tps: String(rate) }) : '—'),
        ]),
        h('small', { key: 'help', className: 'dccd-metric' }, known ? t('localSpeedHint') : t('localSpeedNever')),
      ])
    }

    /**
     * One quantisation, as a row in the chooser.
     *
     * The size is the artifact's real byte count, not a label: the point of choosing here
     * is knowing what the download costs before pressing the button.
     */
    function QuantPicker(props) {
      const { t, quants, value, disabled, onChange, installed } = props
      const list = Array.isArray(quants) ? quants : []
      if (list.length === 0) return null
      const chosen = list.find((quant) => quant.name === value) ?? list[0]
      const saved = Array.isArray(installed) ? installed : []
      // Switching keeps the previous file, so several can be on disk at once and naming
      // them is the point: it is how a reader knows two files are already there to compare
      // without downloading again.
      const others = saved.filter((name) => name !== chosen?.name)
      return h('div', { className: 'dccd-quant' }, [
        h('label', { key: 'label' }, [
          h('span', { key: 'name' }, t('localQuant')),
          h('select', {
            key: 'select',
            className: 'dccd-input dccd-sel',
            value: chosen?.name ?? '',
            disabled: disabled === true,
            onChange: (event) => onChange(event.target.value),
            'aria-label': t('localQuant'),
          }, list.map((quant) => h('option', { key: quant.name, value: quant.name },
            `${quant.name} · ${gigabytes(quant.bytes)} GB${quant.imatrix === true ? ` · ${t('quantImatrix')}` : ''}`))),
        ]),
        h('small', { key: 'help', className: 'dccd-metric' },
          chosen === undefined
            ? t('localQuantHint')
            : t('localQuantPicked', { file: chosen.file ?? chosen.name, bits: String(chosen.bits) })),
        others.length > 0
          ? h('small', { key: 'swap', className: 'dccd-metric dccd-swap' }, t('quantSwap', { name: others.join('、') }))
          : null,
      ])
    }

    /**
     * The whole local-writer panel.
     *
     * Host-owned state is polled rather than driven locally: preparation keeps running
     * while the page is closed, so a local `useState` would lie after any reload.
     */
    function LocalCard(props) {
      const { t, connected, quant, onQuant } = props
      const [view, setView] = React.useState(undefined)
      const [open, setOpen] = React.useState(false)
      const [source, setSource] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [actionError, setActionError] = React.useState('')

      // Preparation runs on the Host, so the page cannot own the state: it polls. The
      // interval follows what it last saw — fast while bytes are moving, slow when idle.
      const moving = isPreparing(view?.preparation?.phase)
      React.useEffect(() => {
        let live = true
        const tick = () => {
          loadLocal().then((value) => {
            if (!live || value === undefined) return
            setView(value)
            // A poll that works means whatever the last action complained about is over.
            setActionError('')
          })
        }
        tick()
        const timer = setInterval(tick, moving ? LOCAL_POLL_MS : LOCAL_IDLE_POLL_MS)
        return () => {
          live = false
          clearInterval(timer)
        }
      }, [moving])

      const preparation = view?.preparation
      const phase = preparation?.phase ?? 'unprepared'
      const steps = Array.isArray(preparation?.steps) ? preparation.steps : []
      const estimate = view?.estimate
      const preparing = isPreparing(phase)
      const startable = canPrepare(phase)
      const ready = view?.ready === true
      // What is on disk, as the Host read it: `missing` is what `inspectRuntime` could not
      // find. Fewer than two entries means something was downloaded and can be removed,
      // even when the server is not running and no job is left to report steps.
      const missing = Array.isArray(view?.missing) ? view.missing : []
      // `unsupported` means there is no build for this platform at all, so there is never
      // anything of ours on disk: offering a delete button would be an empty gesture.
      const unsupported = view !== undefined ? view.supported === false : phase === 'unsupported'
      const onDisk = !unsupported && view !== undefined && (ready || missing.length < 2 || steps.length > 0)
      const sources = Array.isArray(view?.downloadSources) ? view.downloadSources : []
      const current = steps.find((step) => step.status === 'running') ?? steps.find((step) => step.status === 'failed')
      // The job carries its own target, and that is what the header names while it runs: a
      // reload resets the form to the saved profile, so the picker below could disagree
      // with the file actually arriving. The job cannot be wrong about what it is fetching.
      const target = preparing ? view?.target : undefined
      const targetLabel = target === undefined || target.quant === undefined ? '' : ` · ${target.quant}`
      const summary = preparing && current !== undefined
        ? `${t('step_' + current.kind)}${targetLabel} · ${current.totalBytes > 0 ? `${megabytes(current.receivedBytes)} / ${megabytes(current.totalBytes)} MB` : t('working')}`
        : t(phase === 'ready' ? 'prepReady' : phase === 'failed' ? 'prepFailed' : phase === 'cancelled' ? 'prepCancelled' : phase === 'unsupported' ? 'prepUnsupported' : 'prepUnprepared')

      const run = (action, extra) => {
        setBusy(true)
        setActionError('')
        actLocal(action, extra)
          .then((value) => {
            if (value?.failed !== undefined) {
              setActionError(value.failed)
              return
            }
            if (value !== undefined) setView(value)
          })
          .finally(() => setBusy(false))
      }

      const estimateBlock = startable && !unsupported && estimate !== undefined
        ? h('div', { key: 'estimate', className: 'dccd-estimate' }, [
          h('p', { key: 'lead' }, t('setupLocal')),
          h('dl', { key: 'dl' }, [
            h('div', { key: 'disk' }, [
              h('dt', { key: 'dt' }, t('setupDisk')),
              h('dd', { key: 'dd' }, t('setupDiskValue', { gb: gigabytes(estimate.recommendedDiskBytes) })),
            ]),
            h('div', { key: 'memory' }, [
              h('dt', { key: 'dt' }, t('setupMemory')),
              h('dd', { key: 'dd' }, t('setupMemoryValue', { gb: gigabytes(estimate.expectedMemoryBytes) })),
            ]),
            h('div', { key: 'time' }, [
              h('dt', { key: 'dt' }, t('setupTime')),
              h('dd', { key: 'dd' }, t('setupTimeValue', {
                min: String(estimate.minimumMinutes ?? 1),
                max: String(estimate.maximumMinutes ?? 10),
              })),
            ]),
          ]),
          h('small', { key: 'note' }, t('setupNote')),
        ])
        : null

      const header = h('div', {
        key: 'header',
        className: 'dccd-prep-head',
        'data-disclosure-row': true,
        'data-expandable': steps.length > 0 ? 'true' : 'false',
        role: 'button',
        tabIndex: 0,
        'aria-expanded': open,
        onClick: () => {
          if (steps.length > 0) setOpen((value) => !value)
        },
        onKeyDown: (event) => {
          if (steps.length === 0) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          setOpen((value) => !value)
        },
      }, [
        h(StateDot, { key: 'dot', state: preparing ? 'running' : phase === 'ready' ? 'complete' : phase === 'failed' ? 'failed' : phase === 'unsupported' ? 'failed' : 'pending' }),
        h('span', { key: 'title', className: 'dccd-prep-title' }, open ? t('prepSteps') : summary),
        steps.length > 0 ? h('span', { key: 'chev', className: 'dccd-chev', 'data-open': open, 'aria-hidden': true }) : null,
      ])

      const body = open && steps.length > 0
        ? h('ol', { key: 'steps', className: 'dccd-steps' },
          steps.map((step) => h(PrepStep, { key: step.kind, step, phase, t })))
        : null

      const sourceField = startable && sources.length > 0
        ? h('div', { key: 'source', className: 'dccd-source' }, [
          h('label', { key: 'label' }, [
            h('span', { key: 'name' }, t('sourceChoice')),
            h('select', {
              key: 'select',
              className: 'dccd-input dccd-sel',
              value: source,
              disabled: !connected || busy || sources.length === 1,
              onChange: (event) => setSource(event.target.value),
              'aria-label': t('sourceChoice'),
            }, [
              sources.length > 1 ? h('option', { key: '', value: '' }, t('sourceAuto')) : null,
              ...sources.map((origin) => h('option', { key: origin, value: origin }, origin)),
            ]),
          ]),
          h('small', { key: 'help', className: 'dccd-metric' }, t(source === '' ? 'sourceAutoHelp' : 'sourceManualHelp')),
        ])
        : null

      // Nothing here can run without a pinned build, so the buttons that would download,
      // cancel, stop or delete are left out entirely rather than shown disabled: a disabled
      // button invites a reader to look for the reason it is greyed out, and the reason is
      // one sentence that belongs above.
      const actions = unsupported
        ? null
        : h('div', { key: 'actions', className: 'dccd-prep-actions' }, [
        startable
          ? h('button', {
            key: 'prepare',
            type: 'button',
            className: 'dccd-btn dccd-primary',
            disabled: !connected || busy,
            onClick: () => run('prepare', quant === '' ? undefined : { quant }),
          }, t(phase === 'unprepared' ? 'prepare' : 'retryPrepare'))
          : null,
        preparing && !cancellingNow(preparation)
          ? h('button', {
            key: 'cancel',
            type: 'button',
            className: 'dccd-btn',
            disabled: !connected || busy,
            onClick: () => run('cancel'),
          }, t('cancelPrepare'))
          : null,
        view?.ready === true
          ? h('button', {
            key: 'stop',
            type: 'button',
            className: 'dccd-btn',
            disabled: !connected || busy,
            onClick: () => run('stop'),
          }, t('stopLocal'))
          : null,
        // Offered whenever anything is on disk, not only when the server is up: a half
        // download is the case where a reader most wants the gigabyte back.
        onDisk
          ? h('button', {
            key: 'remove',
            type: 'button',
            className: 'dccd-btn dccd-danger',
            disabled: !connected || busy || preparing,
            onClick: () => run('remove'),
          }, t('removeLocal'))
          : null,
      ])

      return h('section', { className: 'dccd-prep', 'data-ccd-local': phase }, [
        h('div', { key: 'name', className: 'dccd-prep-name' }, t('localName')),
        estimateBlock,
        header,
        body,
        !open && preparing && current !== undefined && current.totalBytes > 0
          ? h('div', { key: 'bar', className: 'dccd-bar-track' }, [
            h('div', {
              key: 'fill',
              className: 'dccd-bar-fill',
              style: { width: `${Math.min(100, (current.receivedBytes / current.totalBytes) * 100)}%` },
            }),
          ])
          : null,
        // One sentence where the controls would be, because there is nothing to control.
        unsupported
          ? h('p', { key: 'unsupported', className: 'dccd-prep-note' }, t('unsupportedHint'))
          : null,
        // A speed row would promise "it shows up after the first note" to a reader who will
        // never write one on this machine.
        unsupported ? null : h(SpeedRow, { key: 'speed', t, speed: view?.speed }),
        // The choice is a setting, not an action: the form owns it and the save button
        // writes it, exactly like every other field. The files on disk come from the Host,
        // because only it can stat them. With no build to download, it would be a setting
        // that can only disappoint.
        unsupported ? null : h(QuantPicker, {
          key: 'quant',
          t,
          quants: view?.quants,
          value: quant ?? '',
          installed: view?.installed,
          phase,
          disabled: !connected || busy,
          onChange: (value) => {
            if (onQuant !== undefined) onQuant(value)
          },
        }),
        sourceField,
        actions,
        view?.ready === true
          ? h('small', { key: 'ready', className: 'dccd-metric' }, t('localRunning', { port: String(view.port ?? 0) }))
          : null,
        phase === 'failed' && (preparation?.error ?? '') !== ''
          ? h('p', { key: 'err', className: 'dccd-prep-error', role: 'alert' }, preparation.error)
          : null,
        actionError !== ''
          ? h('p', { key: 'action-err', className: 'dccd-prep-error', role: 'alert' }, actionError)
          : null,
        h('small', { key: 'root', className: 'dccd-metric dccd-prep-root' }, view?.dataRoot ?? ''),
      ])
    }

    /** Whether a cancel is already in flight; the shipped card hides its button then too. */
    function cancellingNow(preparation) {
      return preparation?.phase === 'cancelling'
    }

    /**
     * The whole editable surface, shared by the panel page and the inline plugin form.
     * @param props - `t`, and `compact` to drop the page header.
     */
    function CcdForm(props) {
      const { t } = props
      const [snapshot, setSnapshot] = React.useState(undefined)
      const [draft, setDraft] = React.useState(undefined)
      const [providers, setProviders] = React.useState([])
      const [providersKnown, setProvidersKnown] = React.useState(false)
      const [models, setModels] = React.useState([])
      const [status, setStatus] = React.useState('idle')
      const [message, setMessage] = React.useState('')
      const [sample, setSample] = React.useState('')
      const [testOut, setTestOut] = React.useState('')
      const [testState, setTestState] = React.useState('idle')

      const pullConfig = React.useCallback(() => {
        fetch(CONFIG_ROUTE, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : undefined))
          .then((value) => {
            if (value === undefined) return
            setSnapshot(value)
            setDraft(draftOf(value))
          })
          .catch(() => {})
      }, [])

      React.useEffect(() => {
        pullConfig()
        fetch(MODELS_ROUTE, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : undefined))
          .then((value) => {
            const list = Array.isArray(value?.providers) ? value.providers : []
            setProviders(list)
            setProvidersKnown(list.length > 0)
          })
          .catch(() => {})
      }, [pullConfig])

      const chosenProvider = draft?.provider ?? ''
      React.useEffect(() => {
        if (chosenProvider === '') {
          setModels([])
          return undefined
        }
        let live = true
        fetch(MODELS_ROUTE + '?provider=' + encodeURIComponent(chosenProvider), { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : undefined))
          .then((value) => {
            if (live) setModels(Array.isArray(value?.models) ? value.models : [])
          })
          .catch(() => {
            if (live) setModels([])
          })
        return () => {
          live = false
        }
      }, [chosenProvider])

      const set = (key) => (value) => {
        setDraft((current) => ({ ...current, [key]: value }))
        setStatus('idle')
        setMessage('')
      }

      const save = () => {
        if (draft === undefined) return
        setStatus('saving')
        setMessage('')
        fetch(CONFIG_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(draft),
        })
          .then(async (response) => {
            const payload = await response.json().catch(() => undefined)
            if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? 'save failed')
            return payload
          })
          .then((value) => {
            invalidateConfig()
            if (value !== undefined) {
              setSnapshot(value)
              setDraft(draftOf(value))
            }
            setStatus('saved')
          })
          .catch((error) => {
            setStatus('error')
            setMessage(error instanceof Error ? error.message : String(error))
          })
      }

      const reload = () => {
        invalidateConfig()
        setStatus('idle')
        setMessage('')
        pullConfig()
      }

      const test = () => {
        const text = sample.trim()
        if (text === '') {
          setTestState('failed')
          setTestOut(t('testEmpty'))
          return
        }
        setTestState('running')
        setTestOut('')
        fetch(NOTES_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, index: 0, seed: Math.floor(Math.random() * 0xffffffff) >>> 0 }),
        })
          .then(async (response) => {
            const payload = await response.json().catch(() => undefined)
            if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? 'failed')
            return String(payload?.note ?? '')
          })
          .then((note) => {
            setTestOut(note)
            setTestState('done')
          })
          .catch((error) => {
            setTestOut(error instanceof Error ? error.message : String(error))
            setTestState('failed')
          })
      }

      if (draft === undefined) {
        return h('div', { className: 'dccd-wrap' }, [
          h('style', { key: 'css' }, CSS),
          h('p', { key: 'load', className: 'dccd-empty' }, t('loading')),
        ])
      }

      const number = (key, section) => {
        const spec = NUMBERS.find((row) => row[0] === key)
        if (spec === undefined || spec[1] !== section) return null
        return h(Row, { key, label: t(key), hint: t(key + 'Hint') },
          Num({
            value: draft[key],
            min: spec[2],
            max: spec[3],
            step: spec[4],
            label: t(key),
            onChange: (value) => set(key)(value === '' ? '' : Number(value)),
          }))
      }

      const providerOptions = [{ value: '', label: t('none') }].concat(
        providers.map((provider) => ({ value: provider.id, label: provider.name ?? provider.id })),
      )
      const modelOptions = [{ value: '', label: t('none') }].concat(
        models.map((model) => ({ value: model.id, label: model.name ?? model.id })),
      )
      const languageOptions = [
        { value: 'auto', label: t('langAuto') },
        { value: 'zh', label: t('langZh') },
        { value: 'en', label: t('langEn') },
        { value: 'custom', label: t('langCustom') },
      ]

      const saving = status === 'saving'
      const statusText = status === 'saving' ? t('saving') : status === 'saved' ? t('saved') : ''

      return h('div', { className: 'dccd-wrap', 'data-ccd': 'settings' }, [
        h('style', { key: 'css' }, CSS),
        props.compact === true ? null : h('header', { key: 'head', className: 'dccd-head' }, [
          h('div', { key: 'main', className: 'dccd-head-main' }, [
            h('h2', { key: 'title', className: 'dccd-title' }, t('pageTitle')),
            h('p', { key: 'sub', className: 'dccd-sub' }, t('pageSubtitle')),
          ]),
          h('span', { key: 'badge', className: 'dccd-badge' }, t('pageBadge')),
        ]),

        h(Section, { key: 'basic', title: t('sectionBasic') }, [
          h(Row, { key: 'enabled', label: t('enabled'), hint: t('enabledHint') },
            h('input', {
              className: 'dccd-box',
              type: 'checkbox',
              checked: draft.enabled !== false,
              onChange: (event) => set('enabled')(event.target.checked),
              'aria-label': t('enabled'),
            })),
          h(Row, { key: 'language', label: t('language'), hint: t('languageHint') },
            Picker({ value: draft.language, options: languageOptions, label: t('language'), onChange: set('language') })),
          draft.language === 'custom'
            ? h(Row, { key: 'customLanguage', label: t('customLanguage'), hint: t('customLanguageHint') },
              h('input', {
                className: 'dccd-input dccd-text',
                type: 'text',
                value: draft.customLanguage ?? '',
                maxLength: 40,
                onChange: (event) => set('customLanguage')(event.target.value),
                'aria-label': t('customLanguage'),
              }))
            : null,
        ]),

        h(Section, { key: 'writer', title: t('sectionWriter') }, [
          h(Row, { key: 'writer', label: t('writer'), hint: t('writerHint') },
            Picker({
              value: draft.writer ?? 'provider',
              options: [
                { value: 'provider', label: t('writerProvider') },
                { value: 'local', label: t('writerLocal') },
              ],
              as: 'select',
              label: t('writer'),
              onChange: set('writer'),
            })),
          (draft.writer ?? 'provider') === 'provider' ? h(Row, { key: 'provider', label: t('provider'), hint: t('providerHint') },
            Picker({
              value: draft.provider,
              options: providerOptions,
              as: providersKnown ? 'select' : 'text',
              placeholder: 'deepseek',
              label: t('provider'),
              onChange: (value) => {
                set('provider')(value)
                if (value !== draft.provider) set('model')('')
              },
            })) : null,
          (draft.writer ?? 'provider') === 'provider' ? h(Row, { key: 'model', label: t('model'), hint: t('modelHint') },
            Picker({
              value: draft.model,
              options: modelOptions,
              as: models.length > 0 ? 'select' : 'text',
              placeholder: chosenProvider === '' ? t('modelNeedsProvider') : 'model-id',
              label: t('model'),
              onChange: set('model'),
            })) : null,
          number('maxTokens', 'writer'),
          number('temperature', 'writer'),
        ]),

        // The local section is not a preference that sits next to the provider choice: it
        // is a different note writer. Showing a download button, a thread count and a data
        // directory under a reader who is asking a provider is a wall of settings that
        // cannot affect anything they do — so this section appears only when it is chosen.
        (draft.writer ?? 'provider') === 'local' ? h(Section, { key: 'local', title: t('sectionLocal') }, [
          h(LocalCard, {
            key: 'card',
            t,
            connected: true,
            quant: draft.localQuant ?? '',
            onQuant: (value) => set('localQuant')(value),
          }),
          number('localThreads', 'local'),
          number('localContext', 'local'),
          number('localIdleSec', 'local'),
          h(Row, { key: 'root', label: t('localDataRoot'), hint: t('localDataRootHint') },
            h('input', {
              className: 'dccd-input dccd-text',
              type: 'text',
              value: draft.localDataRoot ?? '',
              onChange: (event) => set('localDataRoot')(event.target.value),
              'aria-label': t('localDataRoot'),
            })),
        ]) : null,

        h(Section, { key: 'segments', title: t('sectionSegments') }, [
          number('first', 'segments'),
          number('step', 'segments'),
          number('max', 'segments'),
          number('maxSummaries', 'segments'),
          number('minTail', 'segments'),
          number('maxRunes', 'segments'),
          number('parallel', 'segments'),
          number('timeoutSec', 'segments'),
        ]),

        h(Section, { key: 'store', title: t('sectionStore') }, [
          number('retainDays', 'store'),
        ]),

        h(Section, { key: 'gate', title: t('sectionGate') }, [
          h(Row, { key: 'prefix', label: t('prefix'), hint: t('prefixHint') },
            h('input', {
              className: 'dccd-input dccd-text',
              type: 'text',
              value: draft.prefix ?? '',
              onChange: (event) => set('prefix')(event.target.value),
              'aria-label': t('prefix'),
            })),
          h(Row, { key: 'blocked', label: t('blockedRegex'), hint: t('blockedRegexHint') },
            h('input', {
              className: 'dccd-input dccd-text',
              type: 'text',
              value: draft.blockedRegex ?? '',
              onChange: (event) => set('blockedRegex')(event.target.value),
              'aria-label': t('blockedRegex'),
            })),
          h(Row, { key: 'avoid', label: t('avoidPrefixes'), hint: t('avoidPrefixesHint') },
            h('input', {
              className: 'dccd-input dccd-text',
              type: 'text',
              value: Array.isArray(draft.avoidPrefixes) ? draft.avoidPrefixes.join(', ') : '',
              onChange: (event) => set('avoidPrefixes')(
                event.target.value.split(',').map((item) => item.trim()).filter((item) => item !== ''),
              ),
              'aria-label': t('avoidPrefixes'),
            })),
        ]),

        h(Section, { key: 'try', title: t('sectionTry') }, [
          h('div', { key: 'block', className: 'dccd-block' }, [
            h('textarea', {
              key: 'area',
              className: 'dccd-area',
              value: sample,
              placeholder: t('sampleHint'),
              onChange: (event) => setSample(event.target.value),
              'aria-label': t('sampleHint'),
            }),
            h('div', { key: 'row', className: 'dccd-ctl', style: { marginTop: '10px' } }, [
              h('button', {
                key: 'go',
                type: 'button',
                className: 'dccd-btn',
                disabled: testState === 'running',
                onClick: test,
              }, testState === 'running' ? t('testing') : t('test')),
            ]),
            testOut === ''
              ? null
              : h('div', {
                key: 'out',
                className: 'dccd-out' + (testState === 'failed' ? ' dccd-out-bad' : ''),
                'data-ccd': 'preview',
                'data-ccd-state': testState,
              }, testOut),
          ]),
        ]),

        h('div', { key: 'foot', className: 'dccd-foot' }, [
          h('button', {
            key: 'save',
            type: 'button',
            className: 'dccd-btn dccd-primary',
            disabled: saving,
            onClick: save,
          }, saving ? t('saving') : t('save')),
          h('button', { key: 'reload', type: 'button', className: 'dccd-btn', disabled: saving, onClick: reload }, t('reload')),
          statusText === ''
            ? null
            : h('span', {
              key: 'status',
              className: 'dccd-status ' + (status === 'saved' ? 'dccd-ok' : ''),
              role: 'status',
            }, statusText),
          status === 'error' && message !== ''
            ? h('span', { key: 'err', className: 'dccd-status dccd-err', role: 'alert' }, message)
            : null,
        ]),
      ])
    }

    /** Sidebar glyph: the speech bubble the package icon carries. */
    function CcdGlyphIcon(props) {
      const size = props?.size ?? 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, [
        h('path', { key: 'bubble', d: 'M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5z' }),
        h('path', { key: 'l1', d: 'M8.5 9h7' }),
        h('path', { key: 'l2', d: 'M8.5 12h4.5' }),
      ])
    }

    /** The standalone panel. */
    function CcdPage(props) {
      const t = props?.t ?? ((key) => key)
      return h('div', { className: 'dccd-page', 'data-ccd': 'page' }, [h(CcdForm, { key: 'form', t })])
    }

    /** The inline form on the plugin's own page. */
    function CcdSettings(props) {
      const t = props?.t ?? ((key) => key)
      if (props?.view === 'summary') {
        return h('span', { className: 'dccd-status' }, t('pageSubtitle'))
      }
      return h(CcdForm, { key: 'form', t, compact: true })
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, TEXT))
        // Report the locale at boot, not at first row mount: the Host writes the opening
        // note while the row is still collapsed and nothing of ours is mounted, so a
        // mount-time report always arrives after the note it was supposed to inform.
        reportLocale()
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('conversation.chat.reasoning.body', () => ctx.slots.register({
          name: 'conversation.chat.reasoning.body',
          priority: REPLACING_PRIORITY,
          locale: NS,
        }, ReasoningNotes))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'dsh-ccd',
          order: 31,
          // The panel's title is this label, so it reads as the page name rather than
          // the package id. Resolved through `locale` so it follows the UI language.
          label: () => t('pageTitle'),
          locale: NS,
        }, CcdGlyphIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'dsh-ccd',
          inject: () => ({ t }),
        }, CcdPage))
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-ccd',
          inject: () => ({ t }),
        }, CcdSettings))
      },
    }
  },
})
