// dsh-ccd — local note writer (optional).
//
// The note writer normally asks a configured provider. This half makes it possible to
// ask a model running on the same machine instead: a pinned llama.cpp build plus one
// small GGUF, both downloaded on demand from a source the reader picks.
//
// The shape is lifted from `@deepseek-ai/dsh-experimental-speech-to-text-sensevoice`:
// pinned assets (name/url/bytes/sha256), origin probing before the download, a streaming
// download that verifies while it writes and publishes by rename, and a preparation
// object the client half can render step by step. What differs is only what is being
// prepared: a chat runtime rather than a speech model.
//
// Everything here is best-effort. A missing runtime is not an error the plugin reports
// as broken — the note writer falls back to the provider route it already had.

import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, readlink, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { basename, dirname, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'

/** llama.cpp build this plugin's manifest pins. */
const LLAMA_TAG = 'b12015'
const LLAMA_BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}`

/** The model: a 2B Qwen-lineage build, in the quantisation and fine-tune the reader picks. */
const MODEL_FAMILY = 'MiniCPM5-2B'

/**
 * Two repositories, holding two different fine-tunes of the same base.
 *
 * `heretic` is the abliterated one: same size, looser refusals. `sharp` is the plain
 * MiniCPM5 quantised with an importance matrix (`MiniCPM5-2B-cyber.imatrix.gguf` sits next
 * to the quants), which buys accuracy at the same bit count.
 *
 * The default and the top end come from `heretic`; the ladder in between comes from
 * `sharp`. That is a deliberate split rather than an accident of availability: the two
 * ends are the rungs a reader actually settles on, and the middle rungs benefit most from
 * the calibration. Each entry names its own repository and exact file, because the two
 * repositories use different naming schemes and a derived URL is a 404 the reader has to
 * interpret.
 */
const REPO_HERETIC = 'Abiray/MiniCPM5-2B-heretic-abliterated-GGUF'
const REPO_SHARP = 'peculiar-ragdoll/Sharp-MiniCPM5-2B-GGUF'

/**
 * Every quantisation offered, smallest first.
 *
 * `bytes`/`sha256` are the values the repository reports for each file, so a download is
 * verified against the exact artifact rather than against "some GGUF". `name` is the
 * suffix the file uses and the value stored in the profile, so a saved choice stays
 * readable in `cordis.patch.yml`.
 *
 * `bits` is the bits per weight, computed from the real tensor count (2 516 756 480
 * weights) rather than guessed from the label — used only to explain the trade-off, never
 * to compute anything, because the real size is the pinned `bytes`.
 *
 * `imatrix` says whether the file was quantised against an importance matrix; the card
 * marks those rows, because two files of nearly the same size are not the same model.
 * `variant` records which fine-tune a row is — tests assert the split, the UI does not
 * show it: a reader picking by number does not need a name for the repository.
 */
export const QUANTS = [
  { name: 'Q4_K_S', repo: REPO_SHARP, file: `Sharp-${MODEL_FAMILY}-Q4_K_S.gguf`, bytes: 1516390912, sha256: '3b28cb65323bb877543b30eb5980af5876c56b4ab5982d07d21f0e037c8d7d7f', bits: 4.82, imatrix: true, variant: 'sharp' },
  { name: 'Q4_K_M', repo: REPO_HERETIC, file: `${MODEL_FAMILY}-heretic-abliterated-Q4_K_M.gguf`, bytes: 1561320352, sha256: '2a035020ac0a9c8b2cdd738180da957ffc87e8527b275ae542a2b9945927980b', bits: 4.96, imatrix: false, variant: 'heretic' },
  { name: 'Q4_K_XL', repo: REPO_SHARP, file: `Sharp-${MODEL_FAMILY}-Q4_K_XL.gguf`, bytes: 1595722240, sha256: 'e75a70e0f4ccb8661461498f94759cfebb2ace1df14beac02b2a80538449c568', bits: 5.07, imatrix: true, variant: 'sharp' },
  { name: 'Q5_K_XL', repo: REPO_SHARP, file: `Sharp-${MODEL_FAMILY}-Q5_K_XL.gguf`, bytes: 1886145024, sha256: 'e990faf2ff0ff5024ec96d90a772fcb092d48be7de903847dd2c680eeaca4d97', bits: 6.0, imatrix: true, variant: 'sharp' },
  { name: 'Q6_K_XL', repo: REPO_SHARP, file: `Sharp-${MODEL_FAMILY}-Q6_K_XL.gguf`, bytes: 2198473216, sha256: '0722928b41fae86210ee2a78f1ba49c6eb682cd4d65ae5433d976e255ff336ca', bits: 6.99, imatrix: true, variant: 'sharp' },
  { name: 'Q8_0', repo: REPO_HERETIC, file: `${MODEL_FAMILY}-heretic-abliterated-Q8_0.gguf`, bytes: 2679712672, sha256: '2bd4589f27e7f1f7efe0220d5348c39775744973efcbd909989e31f82d7f8efd', bits: 8.52, imatrix: false, variant: 'heretic' },
]

/** The one every install starts on: the size/quality knee, and the abliterated tune. */
export const DEFAULT_QUANT = 'Q4_K_M'

/** Resolve a quant name to its entry, falling back to the default for anything unknown. */
export function quantFor(name) {
  const wanted = typeof name === 'string' ? name.trim() : ''
  return QUANTS.find((quant) => quant.name === wanted) ?? QUANTS.find((quant) => quant.name === DEFAULT_QUANT)
}

/** The GGUF's file name for one quantisation. */
export function modelFile(name) {
  return quantFor(name).file
}

/** The quantisation a file name belongs to, or undefined for a GGUF that is not ours. */
export function quantOfFile(name) {
  const wanted = typeof name === 'string' ? name : ''
  return QUANTS.find((quant) => quant.file === wanted)?.name
}


/**
 * Platform table for the runtime.
 *
 * Only the build actually verified on this machine is pinned. A platform without an
 * entry reports `unsupported` rather than downloading something that will not start:
 * a wrong binary is worse than a clear message.
 */
const RUNTIMES = {
  'win32-x64': {
    file: `llama-${LLAMA_TAG}-bin-win-cpu-x64.zip`,
    bytes: 24574585,
    sha256: 'f3a0097934526c7c937fbe33b8352ee305aa6605cceef1744427a84686edbc48',
    exe: 'llama-server.exe',
  },
}

/** Sources offered for the model file; the first reachable one wins. */
export const MODEL_ORIGINS = ['https://hf-mirror.com', 'https://huggingface.co']

/** How much room the download needs beyond the bytes themselves (temp parts, unzip). */
const DISK_SLACK = 1.15

export function runtimeFor(platform = process.platform, arch = process.arch) {
  return RUNTIMES[`${platform}-${arch}`]
}

/**
 * The two things that have to be on disk, in the order they are fetched.
 * @returns a list of `{kind, name, bytes, sha256, url, originScoped}`.
 */
export function assetsFor(config, platform, arch) {
  const runtime = runtimeFor(platform, arch)
  const list = []
  if (runtime !== undefined) {
    list.push({
      kind: 'runtime',
      name: runtime.file,
      bytes: runtime.bytes,
      sha256: runtime.sha256,
      url: `${LLAMA_BASE}/${runtime.file}`,
      originScoped: false,
    })
  }
  list.push({
    kind: 'model',
    name: modelFile(config?.quant),
    bytes: quantFor(config?.quant).bytes,
    sha256: quantFor(config?.quant).sha256,
    url: `/${quantFor(config?.quant).repo}/resolve/main/${modelFile(config?.quant)}`,
    originScoped: true,
  })
  return list
}

/** What the reader is told before pressing the button. Derived, never guessed. */
export function setupEstimate(config, platform, arch) {
  const assets = assetsFor(config, platform, arch)
  const bytes = assets.reduce((sum, asset) => sum + asset.bytes, 0)
  const quant = quantFor(config?.quant)
  return {
    recommendedDiskBytes: Math.round((bytes * DISK_SLACK) / 1e8) * 1e8,
    // The weights plus a KV cache for the context the server is started with. The cache
    // does not grow with the quantisation, so only the weight half follows `bytes`.
    expectedMemoryBytes: Math.round((quant.bytes * 1.35 + 4.5e8) / 1e8) * 1e8,
    minimumMinutes: 1,
    maximumMinutes: 10,
  }
}

/** Map a download failure onto a reason the client half can translate. */
export function classifyDownloadFailure(failure) {
  const code = typeof failure?.code === 'string' ? failure.code : ''
  const message = typeof failure?.message === 'string' ? failure.message : String(failure ?? '')
  if (code === 'ENOSPC') return { reason: 'storage', code }
  if (code === 'EACCES' || code === 'EPERM') return { reason: 'storage', code }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { reason: 'dns', code }
  if (code === 'INTEGRITY') return { reason: 'integrity', code }
  if (code === 'ETIMEDOUT' || /timed out/i.test(message)) return { reason: 'timeout', code }
  if (/certificate|CERT_|self-signed/i.test(message)) return { reason: 'certificate', code }
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || /socket|network/i.test(message)) {
    return { reason: 'network', code }
  }
  return { reason: 'unknown', code }
}

/**
 * Order the model origins so the fastest to answer is tried first.
 *
 * A HEAD on the asset through each origin; the first to resolve leads, the rest stay as
 * fallbacks. `Promise.any` keeps this one round trip instead of a sequential probe.
 */
export async function orderSources(assetUrl, origins, timeoutMs, signal) {
  if (origins.length <= 1) return origins.slice()
  const probes = origins.map(async (origin) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('probe timed out')), timeoutMs)
    const relay = () => controller.abort(new Error('cancelled'))
    signal?.addEventListener('abort', relay, { once: true })
    try {
      const response = await fetch(new URL(assetUrl, origin), {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`probe status ${response.status}`)
      return origin
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', relay)
    }
  })
  const first = await Promise.any(probes).catch(() => undefined)
  if (first === undefined) return origins.slice()
  return [first, ...origins.filter((origin) => origin !== first)]
}

/** Whether a file already on disk is exactly the pinned asset. */
async function matchesAsset(path, asset, signal) {
  let info
  try {
    info = await stat(path)
  } catch {
    return false
  }
  if (!info.isFile() || info.size !== asset.bytes) return false
  const digest = await hashFile(path, signal)
  return digest === asset.sha256
}

async function hashFile(path, signal) {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw signal.reason ?? new Error('cancelled')
      hash.update(chunk)
    }
  } finally {
    stream.destroy()
  }
  return hash.digest('hex')
}

/**
 * Fetch one asset unless an identical copy is already present.
 *
 * The bytes are hashed as they arrive and published with a rename only after both the
 * length and the digest agree with the manifest, so a half-download can never be mistaken
 * for a usable model on the next start.
 */
export async function downloadAsset(asset, destination, url, signal, report) {
  if (destination !== undefined && (await matchesAsset(destination, asset, signal))) {
    report({ phase: 'ready', receivedBytes: asset.bytes, totalBytes: asset.bytes })
    return destination
  }
  await mkdir(dirname(destination), { recursive: true })
  const partial = `${destination}.${randomUUID()}.part`
  const hash = createHash('sha256')
  let received = 0
  const response = await fetch(url, { redirect: 'follow', signal })
  if (!response.ok || response.body === null) {
    throw Object.assign(new Error(`download failed with status ${response.status}`), {
      code: `HTTP_${response.status}`,
    })
  }
  const sink = createWriteStream(partial, { flags: 'wx', mode: 0o600 })
  try {
    for await (const chunk of response.body) {
      if (signal?.aborted) throw signal.reason ?? new Error('cancelled')
      received += chunk.length
      if (received > asset.bytes) {
        throw Object.assign(new Error('downloaded more bytes than the manifest declares'), { code: 'INTEGRITY' })
      }
      hash.update(chunk)
      if (!sink.write(chunk)) await new Promise((resolve) => sink.once('drain', resolve))
      report({ phase: 'downloading', receivedBytes: received, totalBytes: asset.bytes })
    }
    await new Promise((resolve, reject) => {
      sink.end(() => resolve())
      sink.once('error', reject)
    })
    if (received !== asset.bytes || hash.digest('hex') !== asset.sha256) {
      throw Object.assign(new Error('downloaded bytes do not match the manifest'), { code: 'INTEGRITY' })
    }
    await rename(partial, destination)
    report({ phase: 'ready', receivedBytes: asset.bytes, totalBytes: asset.bytes })
    return destination
  } finally {
    sink.destroy()
    await rm(partial, { force: true })
  }
}

/**
 * Extract a zip into a directory.
 *
 * Written by hand because a zip is the shape llama.cpp publishes and Node ships no
 * unzipper; every entry in this build is stored deflate, which is all this handles.
 * Entries are written by their base name only, so an archive cannot escape the directory.
 */
export async function unzip(buffer, destination) {
  await mkdir(destination, { recursive: true })
  const end = findEndOfCentralDirectory(buffer)
  if (end < 0) throw new Error('archive has no central directory')
  const count = buffer.readUInt16LE(end + 10)
  let cursor = buffer.readUInt32LE(end + 16)
  const written = []
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break
    const method = buffer.readUInt16LE(cursor + 10)
    const compressed = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
    cursor += 46 + nameLength + extraLength + commentLength
    const base = name.split(/[/\\]/).pop() ?? ''
    if (base === '' || base.startsWith('.')) continue
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) continue
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(start, start + compressed)
    const bytes = method === 0 ? raw : inflateRawSync(raw)
    await new Promise((resolve, reject) => {
      const sink = createWriteStream(join(destination, base), { mode: 0o700 })
      sink.once('error', reject)
      sink.end(bytes, () => resolve())
    })
    written.push(base)
  }
  return written
}

function findEndOfCentralDirectory(buffer) {
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) return index
  }
  return -1
}

/**
 * Where the pieces live.
 *
 * The model's file name carries the quantisation, because switching quantisation is a
 * different download rather than a different setting on the same bytes. `quant` defaults
 * to the pinned default so callers that only care about the runtime half still work.
 */
export function layoutOf(dataRoot, quant) {
  return {
    root: dataRoot,
    runtimeZip: join(dataRoot, 'runtime', 'llama.zip'),
    runtimeDir: join(dataRoot, 'runtime', 'bin'),
    modelsDir: join(dataRoot, 'models'),
    model: join(dataRoot, 'models', modelFile(quant)),
    // Written while a server is up, so the next host — or a delete after a crash — can find
    // a process its own `child` handle never knew about.
    pidFile: join(dataRoot, 'runtime', 'server.pid'),
  }
}

/**
 * Read-only look at what is already prepared. Never downloads and never starts anything.
 * @returns `{phase, missing}` where phase is `ready` or `unprepared`.
 */
export async function inspectRuntime(dataRoot, platform, arch, quant) {
  const layout = layoutOf(dataRoot, quant)
  const runtime = runtimeFor(platform, arch)
  if (runtime === undefined) return { phase: 'unsupported', missing: [`${platform}-${arch}`] }
  const wanted = quantFor(quant)
  const missing = []
  try {
    const info = await stat(join(layout.runtimeDir, runtime.exe))
    if (!info.isFile() || info.size === 0) missing.push('runtime')
  } catch {
    missing.push('runtime')
  }
  try {
    const info = await stat(layout.model)
    if (!info.isFile() || info.size !== wanted.bytes) missing.push('model')
  } catch {
    missing.push('model')
  }
  return { phase: missing.length === 0 ? 'ready' : 'unprepared', missing }
}

/**
 * Models this plugin used to ship and no longer lists.
 *
 * `QUANTS` is the current offer, so a file it does not name is a file the plugin did not
 * download — except that it did, one release ago. Those names are kept here so the old
 * gigabyte still counts as ours: without this, switching to the new table would turn the
 * previous default into an invisible orphan that neither the inventory reports nor
 * "delete files" removes.
 */
const RETIRED = new Set([
  'Bellatrix-Tiny-1.5B-R1.i1-Q2_K.gguf',
  'Bellatrix-Tiny-1.5B-R1.i1-Q3_K_S.gguf',
  'Bellatrix-Tiny-1.5B-R1.i1-IQ4_XS.gguf',
  'Bellatrix-Tiny-1.5B-R1.i1-Q4_K_S.gguf',
  'Bellatrix-Tiny-1.5B-R1.i1-Q4_K_M.gguf',
  'Bellatrix-Tiny-1.5B-R1.Q5_K_M.gguf',
  'Bellatrix-Tiny-1.5B-R1.Q8_0.gguf',
])

/** The file names this plugin itself downloads, for telling its own files apart. */
const OURS = new Set([...QUANTS.map((quant) => quant.file), ...RETIRED])

/** Whether a name in the models directory is a file this plugin put there. */
export function isOwnModelFile(name) {
  return OURS.has(name)
}

/**
 * Every GGUF this plugin downloaded that is sitting in the models directory.
 *
 * Several can be present at once, because switching quantisation keeps the previous file
 * for comparison: the card reports them so a reader can see what the space went to and
 * clear it in one press.
 * A reader's own GGUF is not listed — this is an inventory of what the plugin spent space
 * on, not of what the directory contains. Retired models are listed: they are still ours,
 * and the point of the list is to make taking the space back possible.
 */
export async function modelsOnDisk(dataRoot) {
  const names = await readdir(join(dataRoot, 'models')).catch(() => [])
  return names.filter(isOwnModelFile)
}

/**
 * Fetch and unpack everything, reporting each step as it goes.
 * @returns the layout, once both the runtime and the model verify.
 */
export async function prepareRuntime(config, signal, report) {
  const layout = layoutOf(config.dataRoot, config.quant)
  const runtime = runtimeFor(config.platform, config.arch)
  if (runtime === undefined) throw Object.assign(new Error(`${config.platform}-${config.arch} has no pinned runtime`), { code: 'UNSUPPORTED' })

  report({ phase: 'checking', step: 'runtime', startedAt: Date.now() })
  const zipUrl = `${LLAMA_BASE}/${runtime.file}`
  const haveRuntime = await stat(join(layout.runtimeDir, runtime.exe)).then((info) => info.isFile() && info.size > 0).catch(() => false)
  if (!haveRuntime) {
    const zipAsset = { name: runtime.file, bytes: runtime.bytes, sha256: runtime.sha256 }
    await downloadAsset(zipAsset, layout.runtimeZip, zipUrl, signal, (progress) => {
      report({ phase: progress.phase, step: 'runtime', resource: runtime.file, receivedBytes: progress.receivedBytes, totalBytes: progress.totalBytes })
    })
    report({ phase: 'checking', step: 'runtime', detail: 'unpack' })
    await unzip(await readFile(layout.runtimeZip), layout.runtimeDir)
    await rm(layout.runtimeZip, { force: true })
  }

  report({ phase: 'checking', step: 'model', startedAt: Date.now() })
  const wanted = quantFor(config.quant)
  const fileName = modelFile(wanted.name)
  const modelAsset = { name: fileName, bytes: wanted.bytes, sha256: wanted.sha256 }
  // Other quantisations already on disk are kept, not replaced: switching is how a reader
  // compares two of them, and deleting the previous one would make every comparison a
  // re-download. Space is given back explicitly — "delete files" removes all of ours.
  const remote = `/${wanted.repo}/resolve/main/${fileName}`
  const origins = await orderSources(remote, config.origins, config.probeTimeoutMs, signal)
  let lastFailure
  let placed = false
  for (const origin of origins) {
    try {
      await downloadAsset(modelAsset, layout.model, new URL(remote, origin).href, signal, (progress) => {
        report({ phase: progress.phase, step: 'model', resource: fileName, source: origin, receivedBytes: progress.receivedBytes, totalBytes: progress.totalBytes })
      })
      placed = true
      break
    } catch (error) {
      if (signal?.aborted) throw error
      lastFailure = error
      const classified = classifyDownloadFailure(error)
      report({ phase: 'failed', step: 'model', source: origin, failure: { ...classified, status: 0, resource: fileName } })
      if (classified.reason === 'storage') throw error
    }
  }
  if (!placed) throw lastFailure ?? new Error('every model source failed')

  const verdict = await inspectRuntime(config.dataRoot, config.platform, config.arch, wanted.name)
  if (verdict.phase !== 'ready') {
    throw Object.assign(new Error(`local runtime is incomplete: ${verdict.missing.join(', ')}`), { code: 'INTEGRITY' })
  }
  return layout
}

/**
 * Delete what `prepareRuntime` downloaded.
 *
 * Only the two directories this plugin owns are touched, and only the files it put there:
 * a reader who pointed `localDataRoot` at an existing directory keeps everything else. The
 * data root itself stays, because recreating it later is the reader's business and an empty
 * directory is a clearer "nothing is prepared" than a missing path.
 *
 * @returns the layout, so the caller can tell what was (and was not) there.
 */
export async function removeRuntime(dataRoot) {
  const layout = layoutOf(dataRoot)
  // A server this host never started — one left behind by a crash — is still holding these
  // files. Its pid was written while it loaded, and killing it here means the delete does
  // not depend on the caller having remembered to stop something it has no handle for.
  await stopOrphan(dataRoot).catch(() => {})
  // A file still mapped by a process that is a moment from exiting is `EBUSY` on Windows,
  // and `force: true` does not cover that: it only forgives a missing path. Retrying is
  // what makes "delete files" work on the first press instead of the second.
  await rmRetrying(join(dataRoot, 'runtime'), { recursive: true, force: true })
  // Every quantisation of ours, not only the currently chosen one: switching keeps the
  // previous file so two can be compared, and "delete files" is what a reader presses when
  // they want that space back. A reader's own GGUF is not ours to delete. A locked weight
  // file is retried rather than skipped: silently leaving a gigabyte behind while claiming
  // the space was freed is worse than an error the reader can act on.
  const ours = await modelsOnDisk(dataRoot)
  for (const name of ours) await rmRetrying(join(layout.modelsDir, name), { force: true })
  // Any `.part` of an interrupted download of ours. `downloadAsset` already removes its
  // own, but a killed process leaves one, and it is a gigabyte of nothing.
  const rest = await readdir(layout.modelsDir).catch(() => [])
  for (const name of rest) {
    if (!isOwnModelFile(name.split('.gguf.')[0] + '.gguf')) continue
    await rmRetrying(join(layout.modelsDir, name), { force: true })
  }
  // `rmdir`, not `rm`: `rm` on a directory without `recursive` rejects with `EISDIR` on
  // every platform, so the old `rm(...).catch(() => {})` here never removed anything and
  // every delete left an empty shell behind. `rmdir` succeeds only when empty, which is
  // exactly the guarantee wanted: a reader's own file keeps the directory alive.
  await rmdir(layout.modelsDir).catch(() => {})
  return layout
}

/**
 * `rm` with a few attempts spaced out for the exclusive-open window.
 *
 * Windows refuses to unlink a file that any process still has mapped, and a `llama-server`
 * killed a tick ago is exactly that. `EBUSY`/`EPERM`/`ENOTEMPTY` are therefore treated as
 * "not yet" rather than "no": everything else is rethrown, because a permission error on a
 * path we own is a real problem and swallowing it would report a clean delete that never
 * happened.
 */
async function rmRetrying(path, options) {
  let last
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rm(path, options)
      return
    } catch (error) {
      last = error
      const code = error?.code
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY' && code !== 'EACCES') throw error
      await new Promise((resolve) => {
        setTimeout(resolve, 120 * (attempt + 1))
      })
    }
  }
  throw last
}

/** Ask the OS for a port nothing is listening on, so the server never collides. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))))
    })
  })
}

/**
 * The image name of a running process, or undefined when there is none.
 *
 * Used before killing an orphan: a pid from a file written before a crash can be reused by
 * an unrelated process, and "delete files" must never shoot a stranger. `tasklist` is part
 * of Windows and needs no native dependency; elsewhere `/proc` answers the same question.
 */
async function imageNameOf(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  if (process.platform === 'win32') {
    const out = await new Promise((resolve) => {
      execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (error, stdout) => {
        resolve(error === null ? String(stdout) : '')
      })
    })
    // `"llama-server.exe","1234","Console","1","12,345 K"`, or an INFO line when the pid is gone.
    const row = out.split(String.fromCharCode(10)).map((line) => line.trim()).find((line) => line.indexOf(String.fromCharCode(34)) === 0)
    if (row === undefined) return undefined
    const close = row.indexOf(String.fromCharCode(34), 1)
    return close > 1 ? row.slice(1, close) : undefined
  }
  // A symlink, so it must be resolved rather than read — reading would slurp the binary.
  const target = await readlink(`/proc/${pid}/exe`).catch(() => '')
  const trimmed = target.trim()
  return trimmed === '' ? undefined : basename(trimmed)
}

/**
 * Kill a server this plugin started in an earlier life.
 *
 * A host that died without running its teardown leaves `llama-server` holding its exe and
 * its weights, and the next "delete files" then fails with `EBUSY` on a directory the
 * reader believes is theirs alone. The pid file is the only handle across a restart, so it
 * is checked against the live image name before anything is signalled.
 *
 * @returns whether a process was actually killed.
 */
export async function stopOrphan(dataRoot) {
  const layout = layoutOf(dataRoot)
  const raw = await readFile(layout.pidFile, 'utf8').catch(() => '')
  const pid = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(pid) || pid <= 0) return false
  if (pid === process.pid) return false
  const image = await imageNameOf(pid)
  if (image === undefined) return false
  if (!image.toLowerCase().startsWith('llama-server')) return false
  try {
    process.kill(pid)
  } catch {
    return false
  }
  return true
}

/**
 * How long to wait for a killed server to release its files.
 *
 * TerminateProcess is immediate but the loader unmaps the image a moment later; a delete
 * that starts in the same tick sees `EBUSY`. Half a second covers it without stalling the
 * button when the process is already gone.
 */
const STOP_GRACE_MS = 500

/** Split a chat template's rendered prompt back out — llama-server does it itself. */
export class LocalRuntime {
  constructor(config) {
    this.config = config
    this.child = undefined
    this.port = 0
    this.ready = false
    this.starting = undefined
    this.failure = undefined
    this.gone = undefined
    this.log = []
  }

  /** Where the server is, or undefined when it is not up. */
  get origin() {
    return this.port === 0 ? undefined : `http://127.0.0.1:${this.port}`
  }

  status() {
    return { running: this.ready, port: this.port, log: this.log.slice(-20) }
  }

  /**
   * Start the server if it is not up.
   *
   * Two callers racing here share one promise: the note writer fires segments in
   * parallel and starting a second copy would fight over the same weights.
   */
  async ensure(signal) {
    if (this.ready) return
    if (this.starting !== undefined) {
      await this.starting
      return
    }
    this.starting = this.start(signal).finally(() => {
      this.starting = undefined
    })
    await this.starting
  }

  async start(signal) {
    const layout = layoutOf(this.config.dataRoot, this.config.quant)
    const runtime = runtimeFor(this.config.platform, this.config.arch)
    if (runtime === undefined) throw new Error('no pinned runtime for this platform')
    // Checked before spawning because the alternative is a process that never starts and a
    // reader staring at "preparing" forever. The files can already be gone: the card offers
    // a delete button, and the profile keeps `writer: local` across it.
    const exe = join(layout.runtimeDir, runtime.exe)
    const present = await stat(exe).then((info) => info.isFile() && info.size > 0).catch(() => false)
    if (!present) {
      throw Object.assign(new Error(`the local runtime is not prepared: ${exe} is missing`), { code: 'NOT_PREPARED' })
    }
    const weights = await stat(layout.model).then((info) => info.isFile() && info.size > 0).catch(() => false)
    if (!weights) {
      throw Object.assign(new Error(`the local model is not prepared: ${layout.model} is missing`), { code: 'NOT_PREPARED' })
    }
    this.port = await freePort()
    const args = [
      '-m', layout.model,
      '--port', String(this.port),
      '--host', '127.0.0.1',
      '-c', String(this.config.contextSize),
      '-t', String(this.config.threads),
      '--no-webui',
      '--no-warmup',
    ]
    // A server left behind by a crash still holds its exe and its weights, so the delete
    // button would meet `EBUSY` on files the reader asked to be gone. The pid file is the
    // only handle that survives a restart, and it is written the moment the handle exists.
    await stopOrphan(this.config.dataRoot)
    const child = spawn(exe, args, {
      cwd: layout.runtimeDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    // Written even before the health check: a process that hangs while loading also blocks
    // the delete, and a hang is exactly the case where nothing else can be asked.
    if (child.pid !== undefined) {
      await writeFile(layout.pidFile, String(child.pid), 'utf8').catch(() => {})
    }
    this.log = []
    const remember = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim() === '') continue
        this.log.push(line)
        if (this.log.length > 200) this.log.shift()
      }
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', remember)
    child.stderr.on('data', remember)
    // `spawn` reports a missing executable asynchronously, through an `error` event rather
    // than a throw. An unheard `error` on a ChildProcess is an uncaught exception, which in
    // this host means the whole process dies — a plugin bug must not take the app with it.
    child.once('error', (error) => {
      this.failure = error
      this.ready = false
      if (this.child === child) this.child = undefined
      this.port = 0
      this.log.push(`llama-server failed to start: ${error.message}`)
    })
    child.once('exit', (code) => {
      this.ready = false
      if (this.child === child) this.child = undefined
      this.port = 0
      this.log.push(`llama-server exited with code ${String(code)}`)
      // Best effort: if the host is dying too, the file is what the next start cleans up.
      void rm(layout.pidFile, { force: true }).catch(() => {})
    })
    try {
      await this.waitForHealth(signal)
      this.ready = true
    } catch (error) {
      this.stop()
      throw error
    }
  }

  /** Poll `/health` until the weights are loaded. Loading is the slow part. */
  async waitForHealth(signal) {
    const origin = this.origin
    if (origin === undefined) throw new Error('server has no port')
    const deadline = Date.now() + this.config.startTimeoutMs
    for (;;) {
      if (signal?.aborted) throw signal.reason ?? new Error('cancelled')
      if (this.failure !== undefined) {
        // A spawn failure is the interesting case, so it is reported as itself instead of
        // being flattened into "exited before it was ready".
        const failure = this.failure
        this.failure = undefined
        throw Object.assign(new Error(`llama-server could not start: ${failure.message}`), { code: failure.code ?? 'SPAWN' })
      }
      if (this.child === undefined) {
        throw new Error(`llama-server exited before it was ready: ${this.log.slice(-3).join(' | ')}`)
      }
      try {
        const response = await fetch(`${origin}/health`, { signal })
        if (response.ok) return
      } catch {
        // Not listening yet; the loop below decides when to give up.
      }
      if (Date.now() > deadline) throw new Error('llama-server did not become ready in time')
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  }

  /**
   * One non-streaming completion.
   *
   * `chat_template_kwargs.enable_thinking: false` asks the Qwen2 template not to open a
   * reasoning block; the note writer wants words, not deliberation. A model whose
   * template ignores it simply answers anyway, which is fine.
   */
  async complete({ system, prompt, maxTokens, temperature, timeoutMs }, signal) {
    const origin = this.origin
    if (origin === undefined || !this.ready) throw new Error('local model is not running')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('local model timed out')), timeoutMs)
    const relay = () => controller.abort(signal?.reason ?? new Error('cancelled'))
    signal?.addEventListener('abort', relay, { once: true })
    try {
      const response = await fetch(`${origin}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          max_tokens: maxTokens,
          temperature: temperature ?? 0.5,
          stream: false,
          chat_template_kwargs: { enable_thinking: false },
        }),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw Object.assign(new Error(`local model returned ${response.status}${text === '' ? '' : `: ${text.slice(0, 200)}`}`), { code: `HTTP_${response.status}` })
      }
      const payload = await response.json()
      const text = payload?.choices?.[0]?.message?.content
      if (typeof text !== 'string') throw new Error('local model returned no text')
      const finish = payload?.choices?.[0]?.finish_reason
      return {
        text,
        thought: false,
        terminal: { kind: finish === 'length' ? 'max-tokens' : 'stop' },
      }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', relay)
    }
  }

  /**
   * Ask the server to go away.
   *
   * Fire and forget, because callers like the idle timer only want it gone eventually.
   * `kill` on Windows is TerminateProcess: it returns before the process has actually
   * released its handles, and until it does the exe's directory cannot be removed. That is
   * why `whenStopped` exists and why deleting files goes through it.
   */
  stop() {
    const child = this.child
    this.child = undefined
    this.ready = false
    this.port = 0
    this.gone = undefined
    if (child === undefined) return
    // `exit` fires when the process is reaped. `close` fires after its stdio is drained,
    // which is later still; Windows keeps the image mapped until the process object is
    // released, so waiting on `exit` plus a short grace is the part that matters.
    this.gone = new Promise((resolve) => {
      const done = () => resolve()
      child.once('exit', done)
      setTimeout(done, STOP_GRACE_MS).unref?.()
    })
    try {
      child.kill()
    } catch {
      // A process that already exited is not a failure to report.
    }
  }

  /** Stop, then wait until the process is gone (or the grace period runs out). */
  async whenStopped() {
    this.stop()
    await this.gone
  }
}
