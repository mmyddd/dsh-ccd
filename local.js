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

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'

/** llama.cpp build this plugin's manifest pins. */
const LLAMA_TAG = 'b12015'
const LLAMA_BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}`

/** The model: a 1.5B Qwen2 reasoning distil, in the quantisation the reader picks. */
const MODEL_STEM = 'Bellatrix-Tiny-1.5B-R1'

/**
 * Two repositories, because the small quants deserve an importance matrix.
 *
 * At 2–4 bits the choice of which weights to protect matters more than the bit count, so
 * everything up to 4 bits comes from the `i1` (imatrix) build and everything above it comes
 * from the plain one — that is where the calibration stops paying for itself. Each entry
 * carries its own repository and exact file name rather than deriving them from the quant
 * name, because the `i1` files are named differently and a wrong URL is a 404 the reader
 * has to interpret.
 */
const MODEL_REPO = 'mradermacher/Bellatrix-Tiny-1.5B-R1-GGUF'
const MODEL_REPO_I1 = 'mradermacher/Bellatrix-Tiny-1.5B-R1-i1-GGUF'

/**
 * Every quantisation offered, smallest first.
 *
 * `bytes`/`sha256` are the values the repository reports for each file, so a download is
 * verified against the exact artifact rather than against "some GGUF". `name` is the
 * suffix the file uses and the value stored in the profile, so a saved choice stays
 * readable in `cordis.patch.yml`.
 *
 * `bits` is the approximate bits per weight — used only to explain the trade-off, never to
 * compute anything, because the real size is the pinned `bytes`.
 */
export const QUANTS = [
  { name: 'Q2_K', repo: MODEL_REPO_I1, file: `${MODEL_STEM}.i1-Q2_K.gguf`, bytes: 676305600, sha256: '3b5a3e572097712195ca9490df0eb643b505174c4ef0bc2527f5abbb8bad0b62', bits: 2.6 },
  { name: 'Q3_K_S', repo: MODEL_REPO_I1, file: `${MODEL_STEM}.i1-Q3_K_S.gguf`, bytes: 760945344, sha256: '6a28cf9a2e3f2d62ad2402dabb1e676aed8bca83729e929094588d6348917d56', bits: 3.4 },
  { name: 'IQ4_XS', repo: MODEL_REPO_I1, file: `${MODEL_STEM}.i1-IQ4_XS.gguf`, bytes: 895732416, sha256: '3c9244a3d4cfc80388f4214331c2701c89c7b6d4f37d42a0b60cf39156f10dd5', bits: 4.2 },
  { name: 'Q4_K_S', repo: MODEL_REPO_I1, file: `${MODEL_STEM}.i1-Q4_K_S.gguf`, bytes: 940313280, sha256: 'b8b86c3f34b2c65687596ec9e2e12a9d4fb46af14fd0c47a79b3a68d5549aa69', bits: 4.5 },
  { name: 'Q4_K_M', repo: MODEL_REPO_I1, file: `${MODEL_STEM}.i1-Q4_K_M.gguf`, bytes: 986049216, sha256: '57a4bc209178d4f149daec0cf049c03302c65999fe2aabdd9f2d0561f600a8a4', bits: 4.8 },
  { name: 'Q5_K_M', repo: MODEL_REPO, file: `${MODEL_STEM}.Q5_K_M.gguf`, bytes: 1125050816, sha256: '438f0c4de27e150e5ebc5e0a98421d7c6e04fc40930911e8fb8294a40ef213df', bits: 5.5 },
  { name: 'Q8_0', repo: MODEL_REPO, file: `${MODEL_STEM}.Q8_0.gguf`, bytes: 1646573504, sha256: '84b3687a0ad5de0cb2f91794810467cc5c6af65d9b9f2500a03196e14c327861', bits: 8.5 },
]

/** The one every install starts on: the size/quality knee for a 1.5B. */
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

/** The file names this plugin itself downloads, for telling its own files apart. */
const OURS = new Set(QUANTS.map((quant) => quant.file))

/** Whether a name in the models directory is a file this plugin put there. */
export function isOwnModelFile(name) {
  return OURS.has(name)
}

/**
 * Every GGUF this plugin downloaded that is sitting in the models directory.
 *
 * Switching quantisation leaves the previous file behind, and it is most of a gigabyte:
 * the card reports these so it can offer to remove them instead of silently keeping them.
 * A reader's own GGUF is not listed — this is an inventory of what the plugin spent space
 * on, not of what the directory contains.
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
  // Switching quantisation must not leave the previous file behind: it is most of a
  // gigabyte, and the next read of `modelsOnDisk` would report it as junk to clean up.
  // Only this plugin's own file names, so a reader's own GGUF next to it is untouched.
  await Promise.all(
    (await modelsOnDisk(config.dataRoot))
      .filter((name) => name !== fileName)
      .map((name) => rm(join(layout.modelsDir, name), { force: true }).catch(() => {})),
  )
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
  // The whole runtime directory, not just the exe: the zip is removed after unpacking, but
  // a cancelled download leaves a `.part` behind and an older build leaves stale DLLs.
  await rm(join(dataRoot, 'runtime'), { recursive: true, force: true })
  // Every quantisation of ours, not only the currently chosen one: a reader who switched
  // has two, and "delete files" is what they press when they want the space back. A
  // reader's own GGUF is not ours to delete.
  await Promise.all(
    (await modelsOnDisk(dataRoot)).map((name) => rm(join(layout.modelsDir, name), { force: true }).catch(() => {})),
  )
  // Any `.part` of an interrupted download of ours. `downloadAsset` already removes its
  // own, but a killed process leaves one, and it is a gigabyte of nothing.
  const rest = await readdir(layout.modelsDir).catch(() => [])
  await Promise.all(
    rest
      .filter((name) => isOwnModelFile(name.split('.gguf.')[0] + '.gguf'))
      .map((name) => rm(join(layout.modelsDir, name), { force: true }).catch(() => {})),
  )
  // Removing the directory only when it is empty keeps a reader's own files next to it safe
  // while still clearing the empty shell we created.
  await rm(layout.modelsDir, { recursive: false, force: true }).catch(() => {})
  return layout
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

/** Split a chat template's rendered prompt back out — llama-server does it itself. */
export class LocalRuntime {
  constructor(config) {
    this.config = config
    this.child = undefined
    this.port = 0
    this.ready = false
    this.starting = undefined
    this.failure = undefined
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
    const child = spawn(exe, args, {
      cwd: layout.runtimeDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
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

  stop() {
    const child = this.child
    this.child = undefined
    this.ready = false
    this.port = 0
    if (child === undefined) return
    try {
      child.kill()
    } catch {
      // A process that already exited is not a failure to report.
    }
  }
}
