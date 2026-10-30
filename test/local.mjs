// Assertion tests for the local note writer's runtime half.
//
// Everything here runs against real files — a real zip, real hashes, a real spooled
// directory — because the parts worth testing are the ones that touch the disk: whether
// a ".part" can be mistaken for a model, whether an archive can escape its directory,
// and whether a missing platform says so instead of downloading a wrong binary.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import * as L from '../local.js'

const root = mkdtempSync(join(tmpdir(), 'dsh-ccd-local-'))

// ── platform table ────────────────────────────────────────────────────────

assert.equal(L.runtimeFor('win32', 'x64').exe, 'llama-server.exe')
assert.equal(L.runtimeFor('linux', 'x64'), undefined, 'an unpinned platform has no runtime')
assert.equal(L.runtimeFor('darwin', 'arm64'), undefined)

const assets = L.assetsFor({}, 'win32', 'x64')
assert.equal(assets.length, 2)
assert.deepEqual(assets.map((asset) => asset.kind), ['runtime', 'model'])
for (const asset of assets) {
  assert.ok(asset.bytes > 0, `${asset.kind} is pinned by size`)
  assert.match(asset.sha256, /^[0-9a-f]{64}$/)
}
// A platform with no runtime still offers the model: the model is platform-independent,
// and hiding it would only postpone the news to start time.
assert.deepEqual(L.assetsFor({}, 'linux', 'arm64').map((asset) => asset.kind), ['model'])

// ── estimate ──────────────────────────────────────────────────────────────

const estimate = L.setupEstimate({}, 'win32', 'x64')
const total = assets.reduce((sum, asset) => sum + asset.bytes, 0)
assert.ok(estimate.recommendedDiskBytes >= total, 'the estimate covers the assets themselves')
assert.ok(estimate.recommendedDiskBytes < total * 2, 'and is not padded into nonsense')
assert.ok(estimate.expectedMemoryBytes > 0)
assert.ok(estimate.minimumMinutes <= estimate.maximumMinutes)

// ── unzip ─────────────────────────────────────────────────────────────────
// The archive is built here rather than checked in: a zip this file can construct is a
// zip this file can also explain when it fails.

function buildZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content] of entries) {
    const raw = Buffer.from(content)
    const packed = deflateRawSync(raw)
    const nameBytes = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, packed)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + packed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

const archive = buildZip([
  ['llama-server.exe', 'binary content here'],
  ['nested/ggml-base.dll', 'a dll that lives in a subdirectory'],
])
const unzipped = join(root, 'unzip')
const written = await L.unzip(archive, unzipped)
// Entries land under their base name: an archive is untrusted input, and a nested path
// is exactly how a zip escapes the directory it is unpacked into.
assert.deepEqual(written.sort(), ['ggml-base.dll', 'llama-server.exe'])
assert.equal(readFileSync(join(unzipped, 'llama-server.exe'), 'utf8'), 'binary content here')
assert.equal(existsSync(join(unzipped, 'nested')), false)

const escaping = buildZip([['../../escaped.txt', 'should not be here']])
await L.unzip(escaping, join(root, 'escape'))
assert.equal(existsSync(join(root, 'escaped.txt')), false, 'a traversal name stays inside the target')
assert.equal(existsSync(join(unzipped, 'escaped.txt')), false)

await assert.rejects(() => L.unzip(Buffer.from('not a zip at all'), join(root, 'junk')), /central directory/)

// ── classifyDownloadFailure ───────────────────────────────────────────────
// The reader gets a sentence, not an errno.

assert.equal(L.classifyDownloadFailure({ code: 'ENOSPC' }).reason, 'storage')
assert.equal(L.classifyDownloadFailure({ code: 'EACCES' }).reason, 'storage')
assert.equal(L.classifyDownloadFailure({ code: 'ENOTFOUND' }).reason, 'dns')
assert.equal(L.classifyDownloadFailure({ code: 'ETIMEDOUT' }).reason, 'timeout')
assert.equal(L.classifyDownloadFailure(new Error('socket hang up')).reason, 'network')
assert.equal(L.classifyDownloadFailure(new Error('certificate has expired')).reason, 'certificate')
assert.equal(L.classifyDownloadFailure({ code: 'INTEGRITY' }).reason, 'integrity')
assert.equal(L.classifyDownloadFailure(new Error('who knows')).reason, 'unknown')
assert.equal(L.classifyDownloadFailure(undefined).reason, 'unknown')

// ── inspectRuntime ────────────────────────────────────────────────────────

const empty = await L.inspectRuntime(join(root, 'nothing-yet'), 'win32', 'x64')
assert.equal(empty.phase, 'unprepared')
assert.deepEqual(empty.missing, ['runtime', 'model'])
assert.equal((await L.inspectRuntime(root, 'linux', 'x64')).phase, 'unsupported')

const layout = L.layoutOf(join(root, 'prepared'))
mkdirSync(layout.runtimeDir, { recursive: true })
mkdirSync(join(layout.root, 'models'), { recursive: true })
writeFileSync(join(layout.runtimeDir, L.runtimeFor('win32', 'x64').exe), 'x')
assert.deepEqual((await L.inspectRuntime(layout.root, 'win32', 'x64')).missing, ['model'])
// A model of the wrong size is not "probably fine": it is a different file.
writeFileSync(layout.model, 'too small')
assert.deepEqual((await L.inspectRuntime(layout.root, 'win32', 'x64')).missing, ['model'])
const modelAsset = assets[1]
writeFileSync(layout.model, Buffer.alloc(modelAsset.bytes))
assert.equal((await L.inspectRuntime(layout.root, 'win32', 'x64')).phase, 'ready')

// ── downloadAsset ─────────────────────────────────────────────────────────

// An already-correct file is reused with no network at all: the URL below cannot
// resolve, so reaching the assertion proves the short circuit ran first.
const reuse = join(root, 'reuse.bin')
writeFileSync(reuse, 'exact bytes')
const reuseAsset = {
  kind: 'model',
  name: 'reuse.bin',
  bytes: Buffer.byteLength('exact bytes'),
  sha256: createHash('sha256').update('exact bytes').digest('hex'),
}
const events = []
const kept = await L.downloadAsset(reuseAsset, reuse, 'http://127.0.0.1:1/nope', new AbortController().signal, (event) => events.push(event.phase))
assert.equal(kept, reuse)
assert.deepEqual(events, ['ready'])

// A file of the right size with the wrong content is not reused either.
const wrong = join(root, 'wrong.bin')
writeFileSync(wrong, 'exact bytes')
await assert.rejects(
  () => L.downloadAsset({ ...reuseAsset, sha256: 'f'.repeat(64) }, wrong, 'http://127.0.0.1:1/nope', new AbortController().signal, () => {}),
  // The download is attempted, and the unreachable URL is what fails it.
  (error) => error !== undefined,
)
// No ".part" survives a failed attempt: a half file must never be resumable by accident.
assert.deepEqual(readdirSync(root).filter((name) => name.endsWith('.part')), [])

// ── orderSources ──────────────────────────────────────────────────────────

assert.deepEqual(await L.orderSources('/x', ['https://only.example'], 1000, undefined), ['https://only.example'])
// Every probe fails here, and the original order comes back — a bad network never
// empties the source list.
const dead = await L.orderSources('/x', ['https://a.example', 'https://b.example'], 50, undefined)
assert.deepEqual(dead.sort(), ['https://a.example', 'https://b.example'])

// ── layout ────────────────────────────────────────────────────────────────

const fixed = L.layoutOf('/data')
assert.equal(fixed.runtimeZip, join('/data', 'runtime', 'llama.zip'))
assert.equal(fixed.runtimeDir, join('/data', 'runtime', 'bin'))
assert.ok(fixed.model.startsWith(join('/data', 'models')))
assert.ok(fixed.model.endsWith('.gguf'))

// ── removeRuntime ─────────────────────────────────────────────────────────

{
  // A prepared root: the unpacked runtime, plus the model.
  const prepared = join(root, 'remove-prepared')
  mkdirSync(join(prepared, 'runtime', 'bin'), { recursive: true })
  mkdirSync(join(prepared, 'models'), { recursive: true })
  writeFileSync(join(prepared, 'runtime', 'bin', 'llama-server.exe'), 'MZ')
  writeFileSync(join(prepared, 'runtime', 'llama.zip'), 'zip')
  writeFileSync(join(prepared, 'models', L.modelFile('Q4_K_M')), 'gguf')
  // Something the reader put there, which this plugin must not touch.
  writeFileSync(join(prepared, 'notes.txt'), 'mine')

  await L.removeRuntime(prepared)

  assert.equal(existsSync(join(prepared, 'runtime')), false, 'the runtime directory survived')
  assert.equal(existsSync(join(prepared, 'models', L.modelFile('Q4_K_M'))), false, 'the model survived')
  assert.equal(existsSync(join(prepared, 'notes.txt')), true, 'a reader file was deleted too')
  assert.equal(existsSync(prepared), true, 'the data root itself was deleted')
  const verdict = await L.inspectRuntime(prepared, 'win32', 'x64')
  assert.equal(verdict.phase, 'unprepared')
}

{
  // A reader's own GGUF sitting next to ours: the models directory stays, because it is
  // not empty and this plugin did not create what is in it.
  const shared = join(root, 'remove-shared')
  mkdirSync(join(shared, 'models'), { recursive: true })
  writeFileSync(join(shared, 'models', 'someone-elses.gguf'), 'gguf')
  await L.removeRuntime(shared)
  assert.equal(existsSync(join(shared, 'models', 'someone-elses.gguf')), true)
}

{
  // Nothing there at all: removing is a no-op, not a throw. The button stays visible on a
  // half-downloaded root, so a reader can press it twice.
  const empty = join(root, 'remove-empty')
  await L.removeRuntime(empty)
  await L.removeRuntime(empty)
  assert.equal(existsSync(empty), false)
}

// ── quantisations ─────────────────────────────────────────────────────────

{
  // Every name in the table must resolve to a file name, a size and a digest. Two tunes of
  // the same base are on offer, so the table is checked against that split rather than
  // against "the small ones are imatrix": sizes overlap between the two fine-tunes.
  assert.ok(L.QUANTS.length >= 5, 'the quantisation table is suspiciously short')
  const HERETIC = 2
  const SHARP = 4
  assert.equal(L.QUANTS.filter((quant) => quant.variant === 'heretic').length, HERETIC)
  assert.equal(L.QUANTS.filter((quant) => quant.variant === 'sharp').length, SHARP)
  for (const quant of L.QUANTS) {
    assert.match(quant.name, /^[A-Za-z0-9_]+$/, `${quant.name} is not a plain quant name`)
    assert.equal(L.modelFile(quant.name), quant.file, `${quant.name} does not resolve to its own file`)
    assert.equal(L.quantFor(quant.name).sha256, quant.sha256)
    assert.ok(quant.bytes > 1e8, `${quant.name} has no plausible size`)
    assert.ok(quant.bits > 2 && quant.bits < 12, `${quant.name} has an implausible bit count`)
    assert.ok(quant.file.endsWith('.gguf'), `${quant.name} does not point at a GGUF`)
    // The two ends are the abliterated tune, the ladder in between is the sharp one.
    assert.ok(['heretic', 'sharp'].includes(quant.variant), `${quant.name} has no variant`)
    assert.equal(quant.imatrix, quant.variant === 'sharp', `${quant.name} disagrees with its repository about imatrix`)
  }
  // The two tunes must not collide on a file name, or the inventory would conflate them.
  assert.equal(new Set(L.QUANTS.map((quant) => quant.file)).size, L.QUANTS.length)
  // The default and the top end come from the abliterated repository.
  assert.equal(L.quantFor(L.DEFAULT_QUANT).variant, 'heretic')
  assert.equal(L.quantFor(L.QUANTS.at(-1).name).variant, 'heretic')
  // Sizes increase with bits: a table where they do not is one where a name got swapped.
  const sizes = L.QUANTS.map((quant) => quant.bytes)
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b), 'the quantisations are out of order')

  // An unknown name is the default, not a crash: the profile may have been written by an
  // older build that offered something this one does not.
  assert.equal(L.quantFor('nope'), L.quantFor(L.DEFAULT_QUANT))
  assert.equal(L.modelFile('nope'), L.modelFile(L.DEFAULT_QUANT))
  assert.equal(L.quantFor(undefined).name, L.DEFAULT_QUANT)

  // File name → quant name, used to report what is already on disk.
  assert.equal(L.quantOfFile(L.modelFile(L.QUANTS[0].name)), L.QUANTS[0].name)
  assert.equal(L.quantOfFile('someone-elses.gguf'), undefined)

  // The estimate follows the chosen quantisation, because the download does.
  const small = L.setupEstimate({ quant: L.QUANTS[0].name }, 'win32', 'x64')
  const large = L.setupEstimate({ quant: 'Q8_0' }, 'win32', 'x64')
  assert.ok(large.recommendedDiskBytes > small.recommendedDiskBytes, 'the estimate ignores the quantisation')

  // Only this plugin's own files are reported, so a delete never takes a reader's file.
  const mixed = join(root, 'quant-mixed')
  mkdirSync(join(mixed, 'models'), { recursive: true })
  writeFileSync(join(mixed, 'models', L.modelFile('Q4_K_M')), 'ours')
  writeFileSync(join(mixed, 'models', 'someone-elses.gguf'), 'theirs')
  const ours = await L.modelsOnDisk(mixed)
  assert.deepEqual(ours, [L.modelFile('Q4_K_M')], 'the inventory is not exactly the files this plugin wrote')

  // "Delete files" clears every quantisation of ours and nothing else. Several can be
  // sitting there at once, because switching is how a reader compares two: keeping them is
  // the feature, so the only thing that removes them is this explicit press.
  const swap = join(root, 'quant-swap')
  mkdirSync(join(swap, 'models'), { recursive: true })
  writeFileSync(join(swap, 'models', L.modelFile('Q4_K_M')), 'one')
  writeFileSync(join(swap, 'models', L.modelFile('Q8_0')), 'two')
  writeFileSync(join(swap, 'models', 'someone-elses.gguf'), 'theirs')
  assert.equal((await L.modelsOnDisk(swap)).length, 2, 'both quantisations should be inventoried')
  await L.removeRuntime(swap)
  assert.equal(existsSync(join(swap, 'models', L.modelFile('Q4_K_M'))), false, 'a quantisation survived the delete')
  assert.equal(existsSync(join(swap, 'models', L.modelFile('Q8_0'))), false, 'a quantisation survived the delete')
  assert.equal(existsSync(join(swap, 'models', 'someone-elses.gguf')), true, 'a reader file was deleted')

  // A model this build no longer offers is still this plugin's file. Changing the table
  // without this would strand the previous default on disk: not reported by the
  // inventory, and therefore not deleted by "delete files" either.
  const RETIRED_FILE = 'Bellatrix-Tiny-1.5B-R1.i1-Q4_K_M.gguf'
  assert.equal(L.isOwnModelFile(RETIRED_FILE), true, 'a retired model is not recognised as ours')
  const stale = join(root, 'quant-stale')
  mkdirSync(join(stale, 'models'), { recursive: true })
  writeFileSync(join(stale, 'models', RETIRED_FILE), 'stale')
  assert.deepEqual(await L.modelsOnDisk(stale), [RETIRED_FILE], 'a retired model is invisible to the inventory')
  await L.removeRuntime(stale)
  assert.equal(existsSync(join(stale, 'models', RETIRED_FILE)), false, 'the retired model was left behind')
  // No current file name may collide with a retired one, or one release would delete the
  // model another release just downloaded.
  for (const quant of L.QUANTS) assert.notEqual(quant.file, RETIRED_FILE)
}

// ── a runtime that cannot start ───────────────────────────────────────────

{
  // The failure that took the host down: `writer: local` with the files deleted. `spawn`
  // reports it through an `error` event, and an unheard `error` on a ChildProcess is an
  // uncaught exception — which in this host means the whole app. Both shapes are covered:
  // nothing there at all, and a file that exists but is not an executable.
  const gone = join(root, 'spawn-gone')
  const absent = new L.LocalRuntime({ dataRoot: gone, platform: process.platform, arch: process.arch, quant: 'Q4_K_M', threads: 2, contextSize: 2048 })
  await assert.rejects(() => absent.ensure(), (error) => error.code === 'NOT_PREPARED')
  assert.equal(absent.status().running, false)

  const broken = join(root, 'spawn-broken')
  mkdirSync(join(broken, 'runtime', 'bin'), { recursive: true })
  mkdirSync(join(broken, 'models'), { recursive: true })
  writeFileSync(join(broken, 'runtime', 'bin', 'llama-server.exe'), 'not a program')
  writeFileSync(join(broken, 'models', L.modelFile('Q4_K_M')), 'not weights')
  const runtime = new L.LocalRuntime({ dataRoot: broken, platform: process.platform, arch: process.arch, quant: 'Q4_K_M', threads: 2, contextSize: 2048, startTimeoutMs: 4000 })
  // The assertion that matters is that this settles at all: before the `error` listener it
  // killed the process, so reaching the next line is the test.
  await assert.rejects(() => runtime.ensure())
  assert.equal(runtime.status().running, false)
}

console.log('local.mjs: all assertions passed')
