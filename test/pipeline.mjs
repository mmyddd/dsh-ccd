// Harness: the client half reads the Host's notes and shows them, nothing more.
//
// The browser no longer translates and no longer cuts segments — the Host streams notes
// while the reasoning arrives, even for a collapsed row. What is left to test here is the
// matching rule (which block belongs to which row), the joining of settled notes, and the
// conditions under which a row keeps asking.
//
// Cuts the display region out of client.js and runs it against a stub `fetch`.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = src.indexOf('const SETTLE_MS')
const end = src.indexOf('function ReasoningNotes(props)')
assert.ok(start > 0 && end > start, 'could not locate the display region in client.js')

const prelude = [
  "const WARM_ROUTE = '/dsh-ccd/warm'",
  "const LOCALE_ROUTE = '/dsh-ccd/locale'",
  // `browserLocale` and `expectedLanguage` sit above the region; the latter is what a row
  // uses to reject a note written under a setting the reader has since changed.
  "const navigator = { languages: ['zh-CN'], language: 'zh-CN' }",
  'function browserLocale() { return navigator.languages[0] }',
].join('\n')

const body = `${prelude}\n${src.slice(start, end)}`
const api = new Function(
  'fetch',
  `${body}\nreturn { loadWarm, fillWarm, readWarm, warmForRow, awaitingNote, bareThought, warmCache, SETTLE_MS, POLL_MS };`,
)(stubFetch)

/** Recorded note requests; the preview button is the only caller left. */
const calls = []
/** What the Host reports for the current session's reasoning blocks. */
let blocks = []
let warmReads = 0
/** Requests that carried a row's text to the Host for a back-fill. */
const fills = []

function stubFetch(url, init) {
  if (init?.method !== 'POST') {
    warmReads += 1
    return Promise.resolve({
      ok: true,
      json: async () => ({ sessionId: 'sess-1', blocks }),
    })
  }
  const payload = JSON.parse(init.body)
  if (payload.sessionId !== undefined) {
    // The back-fill route answers with the same block list a GET would.
    fills.push(payload)
    return Promise.resolve({
      ok: true,
      json: async () => ({ sessionId: payload.sessionId, blocks }),
    })
  }
  calls.push(payload)
  return Promise.resolve({ ok: true, json: async () => ({ note: 'preview note' }) })
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

// ── the Host payload is normalised, missing fields do not crash a row ─────
{
  blocks = [
    { notes: ['one', 'two'], language: 'zh', consumed: 'thinking one', cut: 2, busy: false, stopped: true },
    { notes: ['three', ''], language: 'zh', consumed: 'thinking two', cut: 2, busy: true, stopped: false },
    null,
    'garbage',
  ]
  const value = await api.loadWarm('sess-1')
  assert.equal(value.sessionId, 'sess-1')
  assert.equal(value.blocks.length, 2, 'non-object entries are skipped')
  assert.deepEqual(value.blocks[0].notes, ['one', 'two'])
  assert.equal(value.blocks[0].busy, false)
  assert.equal(value.blocks[0].stopped, true)
  // An empty slot is a dropped segment, not a note: it must not reach the body as a blank.
  assert.deepEqual(value.blocks[1].notes, ['three'])
  assert.equal(value.blocks[1].busy, true)
}

// ── a row owns the block whose consumed reasoning prefixes its own text ───
{
  blocks = [
    { notes: ['a'], language: 'zh', consumed: 'AAAA', cut: 1, busy: false, stopped: false },
    { notes: ['b'], language: 'zh', consumed: 'AAAABBBB', cut: 1, busy: false, stopped: false },
    { notes: ['c'], language: 'zh', consumed: 'ZZZZ', cut: 1, busy: false, stopped: false },
  ]
  const value = await api.loadWarm('sess-1')
  // Two blocks match a prefix of this text; the one that consumed more of it is the row's.
  const match = api.warmForRow(value.blocks, 'AAAABBBBCCCC')
  assert.equal(match.notes[0], 'b', 'the longest matching prefix wins')
  // The row may also be behind the Host; prefix agreement works in both directions, and
  // the further-along block still owns it because it consumed more of the same text.
  assert.equal(api.warmForRow(value.blocks, 'AAAAB').notes[0], 'b')
  // No block consumed anything: nothing to show, so the row keeps the raw text.
  assert.equal(api.warmForRow(value.blocks, 'QQQQ'), undefined)
  // A row with no text yet cannot be matched, and must not adopt a stranger's note.
  assert.equal(api.warmForRow(value.blocks, ''), undefined)
  // A block that has consumed nothing is not yet a candidate.
  assert.equal(api.warmForRow([{ notes: ['x'], consumed: '', cut: 1 }], 'hello'), undefined)
}

// ── settled notes join in order; a gap stops the visible text there ───────
{
  blocks = [
    { notes: ['第一段', '第二段'], language: 'zh', consumed: 'P1P2', cut: 2, busy: false, stopped: true },
  ]
  const value = await api.loadWarm('sess-1')
  const match = api.warmForRow(value.blocks, 'P1P2P3')
  assert.equal(match.notes.join('\n\n'), '第一段\n\n第二段')
  // The Host truncates its list at the first gap, so what arrives is already contiguous;
  // the count still tells the row that a segment was dropped.
  const dropped = Math.max(0, match.cut - match.notes.length)
  assert.equal(dropped, 0)
  blocks = [
    { notes: ['only'], language: 'zh', consumed: 'P1', cut: 3, busy: false, stopped: true },
  ]
  const partial = api.warmForRow((await api.loadWarm('sess-1')).blocks, 'P1P2P3')
  assert.equal(Math.max(0, partial.cut - partial.notes.length), 2, 'two segments were dropped')
}

// ── a row waits exactly when a note is on its way ─────────────────────────
// Every "wait" here used to be a frame of raw reasoning that got replaced a moment
// later. Every "do not wait" is a case where nothing is coming, so waiting would leave
// the body blank for good.
{
  const state = (match, extra = {}) => ({ match, heard: true, gaveUp: false, running: true, ...extra })
  // Nothing matched yet: the Host may still be cutting this row's first segment.
  assert.equal(api.awaitingNote(state(undefined, { heard: false })), true, 'first answer not in')
  assert.equal(api.awaitingNote(state(undefined)), true, 'turn still streaming, no block yet')
  assert.equal(
    api.awaitingNote(state(undefined, { gaveUp: true })),
    false,
    'a Host that never answers must not blank the body forever',
  )
  // Claimed but empty: the Host cut the segment, the writer has not answered.
  assert.equal(api.awaitingNote(state({ notes: [], busy: true, cut: 1, stopped: false })), true, 'note in flight')
  assert.equal(
    api.awaitingNote(state({ notes: [], busy: false, cut: 0, stopped: false })),
    true,
    'segment not cut yet while the turn streams',
  )
  // Cut and lost: the writer failed, so the gap is real and the text is the answer.
  assert.equal(
    api.awaitingNote(state({ notes: [], busy: false, cut: 2, stopped: false })),
    false,
    'a dropped segment falls back to the reasoning',
  )
  assert.equal(api.awaitingNote(state({ notes: [], busy: false, cut: 0, stopped: true })), false, 'block gave up')
  // A reported failure is an answer too: the writer is known to be down, so waiting would
  // blank a row for a note that is never coming.
  assert.equal(
    api.awaitingNote(state({ notes: [], busy: true, cut: 1, stopped: false, error: 'Connection error.' })),
    false,
    'a failed writer stops the wait',
  )
  // A note already exists: render it, never the text.
  assert.equal(api.awaitingNote(state({ notes: ['n'], busy: true, cut: 1, stopped: false })), false, 'note ready')
}

// ── matching happens in the same text space as the Host's `consumed` ──────
// Some routes wrap reasoning in `<signature>`; the Host strips it before recording
// `consumed`, so a row that matched on the wrapper would never find its own block.
{
  const wrapped = '<signature>abc</signature>\nreal thinking continues'
  assert.equal(api.bareThought(wrapped), 'real thinking continues')
  assert.equal(api.bareThought('plain thinking'), 'plain thinking')
  // A wrapper still arriving: nothing to match, and nothing to show.
  assert.equal(api.bareThought('<signat'), '')
  assert.equal(api.bareThought('<signature>abc'), '')
  assert.equal(api.bareThought(''), '')
  // Matching therefore succeeds on the stripped form and fails on the wrapped one.
  blocks = [{ notes: ['n'], language: 'zh', consumed: 'real thinking', cut: 1, busy: false, stopped: false }]
  const value = await api.loadWarm('sess-1')
  assert.equal(api.warmForRow(value.blocks, api.bareThought(wrapped)).notes[0], 'n')
  assert.equal(api.warmForRow(value.blocks, wrapped), undefined)
}

// ── the cache is what lets a later row render notes on its first frame ────
{
  blocks = [{ notes: ['cached'], language: 'zh', consumed: 'XYZ', cut: 1, busy: false, stopped: false }]
  await api.loadWarm('sess-2')
  assert.equal(api.warmCache.has('sess-2'), false, 'loadWarm alone must not write the cache')
  api.warmCache.set('sess-2', blocks)
  assert.equal(api.warmCache.get('sess-2')[0].notes[0], 'cached')
  api.warmCache.clear()
}

// ── the polling bounds are real numbers, not placeholders ─────────────────
{
  assert.ok(api.POLL_MS > 0 && api.POLL_MS <= 2000, 'a poll interval a reader can tolerate')
  assert.ok(api.SETTLE_MS >= api.POLL_MS, 'the blank-row backstop must outlast one poll')
  assert.equal(calls.length, 0, 'the reasoning body never asks the Host to translate')
  assert.ok(warmReads > 0, 'it asks the Host what it has already noted')
}

// ── a row opened from history asks the Host to note it ────────────────────
// Reasoning replayed out of the Session log never passed through the Host's stream
// listener, so nothing was ever cut or translated. The row carries its own text once,
// and the Host answers with the block it is now writing.
{
  fills.length = 0
  blocks = [{ notes: ['回填笔记'], language: 'zh', consumed: 'history thinking', cut: 1, busy: false, stopped: true }]
  const value = await api.fillWarm('sess-9', 'history thinking continues')
  assert.equal(fills.length, 1, 'one request carries the text')
  assert.equal(fills[0].sessionId, 'sess-9')
  assert.equal(fills[0].text, 'history thinking continues')
  assert.equal(value.sessionId, 'sess-9')
  assert.equal(api.warmForRow(value.blocks, 'history thinking continues').notes[0], '回填笔记')
  // A retry is the same request with a flag, never a second route.
  await api.fillWarm('sess-9', 'history thinking continues', true)
  assert.equal(fills[1].retry, true)
  await api.fillWarm('sess-9', 'history thinking continues')
  assert.equal(fills[2].retry, false, 'an ordinary ask must never re-cut the block')

  // A failed round trip is not an error the row can act on: it falls back to the text.
  const failFetch = () => Promise.reject(new Error('offline'))
  const offline = new Function(
    'fetch',
    `${body}\nreturn { fillWarm };`,
  )(failFetch)
  assert.equal(await offline.fillWarm('sess-9', 'text'), undefined)
}

// ── one shared normaliser serves both routes ──────────────────────────────
{
  const parsed = api.readWarm({
    sessionId: 's',
    blocks: [{ notes: ['a', ''], cut: 2, error: 'Connection error.' }],
  })
  assert.equal(parsed.sessionId, 's')
  assert.deepEqual(parsed.blocks[0].notes, ['a'], 'a gap is not a note')
  assert.equal(parsed.blocks[0].cut, 2)
  // The provider's own words survive normalisation, because the row shows them verbatim.
  assert.equal(parsed.blocks[0].error, 'Connection error.')
  assert.equal(api.readWarm({ blocks: [{}] }).blocks[0].error, '', 'a healthy block has no error')
  assert.equal(api.readWarm(undefined), undefined)
  assert.deepEqual(api.readWarm({}).blocks, [])
}

await settle()
console.log('pipeline.mjs: all assertions passed')
