/**
 * Stored notes: the SQLite table, its compression, and its cap.
 *
 * The tests exercise the real functions out of `index.js` against a real database file in
 * a temp directory, rather than a stub: the whole point of moving to SQLite was the real
 * engine's behaviour (upsert, ordering, limits), so faking it would test nothing.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Normalised: the marker below contains a newline, and this checkout is CRLF on
// Windows and LF elsewhere. Matching the raw file makes one commit pass on one
// runner and fail on the other.
const CR = String.fromCharCode(13)
const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8').split(CR).join('')
const start = source.indexOf('const NOTES_SCHEMA_VERSION')
const end = source.indexOf('/**\n * Blocks being back-filled right now')
if (start < 0 || end < 0) throw new Error('stored-notes section not found in index.js')
const body = source
  .slice(start, end)
  .replace(/^import .*$/gm, '')
  .replace(/^export .*$/gm, '')

const root = mkdtempSync(join(tmpdir(), 'dsh-ccd-notes-'))
process.env.DSH_HOME = root

// The reader's resolved note language. The real `resolveLanguage` turns `auto` into a
// concrete `zh`/`en` from the reported locale, so the stub stands in for that resolution
// and not for the raw setting.
let sessionLanguage = 'zh'
const warmStore = new Map()

const api = new Function(
  'DatabaseSync',
  'mkdirSync',
  'homedir',
  'dirname',
  'join',
  'zstdCompressSync',
  'zstdDecompressSync',
  'process',
  'warmSession',
  'settingsOf',
  'resolveLanguage',
  'liveConfig',
  'readerLocale',
  'DEFAULTS',
  `${body}
return {
  NOTES_SCHEMA_VERSION, NOTE_ROWS_MAX, NOTE_PRUNE_AFTER, DAY_MS,
  notesPath, openNotes, persistBlock, pruneNotes, hydrateSession,
  packNote, unpackNote, hydrated,
  open: () => { noteDb = openNotes(); return noteDb },
  close: () => { noteDb?.close?.(); noteDb = undefined },
  state: () => ({ rows: noteRows, writes: noteWrites }),
  resetCounters: () => { noteRows = 0; noteWrites = 0 },
  setRows: (n) => { noteRows = n },
};`,
)(
  (await import('node:sqlite')).DatabaseSync,
  (await import('node:fs')).mkdirSync,
  (await import('node:os')).homedir,
  (await import('node:path')).dirname,
  (await import('node:path')).join,
  (await import('node:zlib')).zstdCompressSync,
  (await import('node:zlib')).zstdDecompressSync,
  process,
  (sessionId) => {
    let blocks = warmStore.get(sessionId)
    if (blocks === undefined) {
      blocks = new Map()
      warmStore.set(sessionId, blocks)
    }
    return blocks
  },
  () => ({ language: sessionLanguage }),
  () => sessionLanguage,
  {},
  '',
  { retainDays: 14 },
)

const entry = (over = {}) => ({
  sessionId: 'session-abc',
  key: '1:0:0',
  notes: ['第一个笔记', '第二个笔记'],
  cut: 2,
  consumed: 'A'.repeat(4000),
  lang: 'zh',
  stopped: false,
  error: '',
  ...over,
})

// ── the file is one database, in its own folder under storages/ ──────────────
assert.equal(api.notesPath(), join(root, 'storages', 'dsh_ccd_notes', 'notes.db'))
assert.ok(api.notesPath().startsWith(root), 'DSH_HOME decides where it lives')

const db = api.open()
assert.ok(db !== undefined, 'the database opens')
assert.ok(statSync(api.notesPath()).isFile(), 'it is one file on disk')

// ── compression actually shrinks the bulk, and survives the round trip ────────
const bulk = '这台机器在跑测试，笔记里的 consumed 是占用最大的一块。'.repeat(120)
assert.ok(api.unpackNote(api.packNote(bulk)) === bulk, 'a packed payload unpacks to itself')
assert.ok(api.packNote(bulk).length < Buffer.byteLength(bulk) / 2, 'repetitive text at least halves')
// The unpacker has to serve the fallback too: a plain UTF-8 payload is what `packNote`
// stores when zstd is missing, and it must not be mistaken for a zstd frame.
const plain = Buffer.from('{"notes":[]}', 'utf8')
assert.equal(api.unpackNote(plain), '{"notes":[]}')

// ── a settled note is durable and readable per session ───────────────────────
api.persistBlock(entry())
api.persistBlock(entry({ key: '1:1:0', consumed: 'B'.repeat(100), notes: ['另一个'] }))
api.persistBlock(entry({ sessionId: 'session-xyz', key: '1:0:0', notes: ['别的会话'] }))
assert.equal(api.state().rows, 3, 'three rows, two sessions')

api.hydrated.clear()
api.hydrateSession('session-abc')
const blocks = warmStore.get('session-abc')
assert.equal(blocks.size, 2, 'only this session comes back')
assert.equal(blocks.get('1:0:0').notes.length, 2)
assert.equal(blocks.get('1:0:0').cut, 2)
assert.equal(blocks.get('1:0:0').consumed.length, 4000)
assert.equal(blocks.get('1:0:0').closing, true, 'nothing is in flight for a stored block')
assert.equal(warmStore.get('session-xyz'), undefined, 'another session is never even read')

// ── one row per block, not one per settle ────────────────────────────────────
api.persistBlock(entry({ notes: ['改过', '第二个笔记', '第三个'], cut: 3 }))
assert.equal(api.state().rows, 3, 'a second settle replaces rather than appends')
api.hydrated.clear()
warmStore.get('session-abc').clear()
api.hydrateSession('session-abc')
assert.equal(warmStore.get('session-abc').get('1:0:0').cut, 3, 'the newer state wins')

// ── a row written under another language is not served back ──────────────────
sessionLanguage = 'en'
api.hydrated.clear()
warmStore.get('session-abc').clear()
api.hydrateSession('session-abc')
assert.equal(warmStore.get('session-abc').size, 0, 'a zh row is skipped for an en reader')
sessionLanguage = 'zh'
api.hydrated.clear()
api.persistBlock(entry({ key: '2:0:0', lang: '' }))
warmStore.get('session-abc').clear()
api.hydrateSession('session-abc')
assert.equal(warmStore.get('session-abc').has('2:0:0'), true, 'an unstamped row is served to anyone')

// ── a failure survives the reload that brings the reader back ────────────────
// The reason a note is missing is part of the row's state: without it a reload turns a
// dead provider into a row that looks like it is still thinking.
api.hydrated.clear()
api.persistBlock(entry({ key: '3:0:0', notes: [], cut: 1, error: 'Connection error.' }))
warmStore.get('session-abc').clear()
api.hydrateSession('session-abc')
assert.equal(
  warmStore.get('session-abc').get('3:0:0').error,
  'Connection error.',
  'the provider failure is stored with the block',
)
// And a healthy block carries none, so a row never shows a stale reason.
assert.equal(warmStore.get('session-abc').get('1:0:0').error, '')

// ── the cap is soft and amortised ────────────────────────────────────────────
api.close()
const capped = api.open()
api.resetCounters()
// Build the rows directly: going through persistBlock 8 000 times would be slow and is
// not what this case is about — the prune's arithmetic is. The timestamps are recent, so
// only the row cap can act here and the age sweep stays out of the way.
const recent = Date.now()
const insert = capped.prepare('INSERT INTO notes (session, key, payload, at) VALUES (?, ?, ?, ?)')
for (let i = 0; i < api.NOTE_ROWS_MAX + 5; i += 1) {
  insert.run('session-bulk', `k${i}`, api.packNote('{}'), recent - i)
}
api.setRows(api.NOTE_ROWS_MAX + 5)

assert.equal(api.pruneNotes(capped, { retainDays: 14 }), 0, 'one write does not pay for a full sort')
assert.equal(api.state().rows, api.NOTE_ROWS_MAX + 5, 'the cap is soft between passes')
// A batch of writes brings it back down. The band is the invariant, not an exact size:
// the prune lands somewhere inside a batch.
let carried = 0
for (let i = 0; i < api.NOTE_PRUNE_AFTER * 3; i += 1) {
  api.persistBlock(entry({ sessionId: 'session-bulk', key: `fresh${i}`, consumed: 'C' }))
  carried = api.state().rows
}
assert.ok(
  carried >= api.NOTE_ROWS_MAX && carried < api.NOTE_ROWS_MAX + api.NOTE_PRUNE_AFTER * 3,
  `the table stays inside its band, got ${carried}`,
)
const survivors = capped.prepare("SELECT count(*) AS n FROM notes WHERE key LIKE 'fresh%'").get()
assert.equal(Number(survivors.n), api.NOTE_PRUNE_AFTER * 3, 'every fresh row survived the prune')
const bulkLeft = capped.prepare("SELECT count(*) AS n FROM notes WHERE key LIKE 'k%'").get()
assert.ok(Number(bulkLeft.n) < api.NOTE_ROWS_MAX + 5, 'the oldest bulk rows were the ones dropped')
api.close()

// ── a row past the retention window is deleted, not kept at the cap ─────────
// Notes are a cache, not history: once a row is older than `retainDays` it can never be
// useful again, and dropping it is what lets SQLite reuse the page instead of growing.
{
  api.close()
  const aged = api.open()
  api.resetCounters()
  aged.prepare('DELETE FROM notes').run()
  api.setRows(0)
  const now = Date.now()
  const put = aged.prepare('INSERT INTO notes (session, key, payload, at) VALUES (?, ?, ?, ?)')
  put.run('session-old', 'stale', api.packNote('{"notes":["旧"]}'), now - 20 * api.DAY_MS)
  put.run('session-old', 'fresh', api.packNote('{"notes":["新"]}'), now - 1 * api.DAY_MS)
  api.setRows(2)

  // Amortised like the row cap: one write does not pay for the sweep.
  assert.equal(api.pruneNotes(aged, { retainDays: 14 }), 0, 'the age sweep is amortised too')
  assert.equal(api.state().rows, 2, 'nothing is dropped between passes')
  for (let i = 0; i < api.NOTE_PRUNE_AFTER; i += 1) api.pruneNotes(aged, { retainDays: 14 })
  assert.equal(api.state().rows, 1, 'the expired row is gone, the fresh one stays')
  assert.equal(aged.prepare("SELECT key FROM notes").get().key, 'fresh')

  // `0` disables the window: only the row cap applies from then on.
  put.run('session-old', 'stale', api.packNote('{}'), now - 900 * api.DAY_MS)
  api.setRows(2)
  for (let i = 0; i < api.NOTE_PRUNE_AFTER; i += 1) api.pruneNotes(aged, { retainDays: 0 })
  assert.equal(api.state().rows, 2, 'retainDays 0 keeps everything under the cap')

  // A wider window keeps a row a narrow one would drop — the setting is the only input.
  for (let i = 0; i < api.NOTE_PRUNE_AFTER; i += 1) api.pruneNotes(aged, { retainDays: 1000 })
  assert.equal(api.state().rows, 2, '1000 days covers a 900-day-old row')
  api.close()
}

// ── opening the database is the one sweep that cannot wait for a write ──────
// A page closed for a month has no write to trigger the amortised sweep, and the reader
// should get the space back before the next settle, not after 32 of them.
{
  const live = api.open()
  live.prepare('DELETE FROM notes').run()
  api.resetCounters()
  const stale = Date.now() - 30 * api.DAY_MS
  live.prepare('INSERT INTO notes (session, key, payload, at) VALUES (?, ?, ?, ?)')
    .run('session-old', 'ancient', api.packNote('{"notes":["旧"]}'), stale)
  api.setRows(1)
  api.close()
  // Reopening sweeps once, without any write having happened in between.
  api.open()
  assert.equal(api.state().rows, 0, 'a month-old row is gone the moment the database opens')
  api.close()
}

// ── no database is not an error ──────────────────────────────────────────────
api.resetCounters()
api.hydrated.clear()
api.persistBlock(entry())
api.hydrateSession('session-abc')
assert.deepEqual(api.state(), { rows: 0, writes: 0 }, 'with no database every path is a no-op')

rmSync(root, { recursive: true, force: true })
console.log('store.mjs: all assertions passed')
