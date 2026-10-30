// Harness: the settings round trip.
//
// The settings page posts one flat object built from `snapshot()`'s own key names. The
// Host whitelists that object through `sanitizePatch()`, and the profile spells some of
// those fields differently from the snapshot (`first` vs `streamFirst`, because ccd kept
// its stream and sync policies apart). A name the whitelist does not recognise is not an
// error — it is silently dropped, the save returns 200, and the box snaps back to the old
// value on the next read. That is exactly how `first`/`step`/`max` stayed unsavable for a
// whole release, so the guard here is the client's real `KEYS` list: every key the form
// can send must survive a save.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const src = read('index.js')
const clientSrc = read('client.js')

/** Cut one region out of index.js and strip the module-only syntax. */
function region(from, to) {
  const start = src.indexOf(from)
  const end = src.indexOf(to)
  assert.ok(start > 0, `could not find "${from}" in index.js`)
  assert.ok(end > start, `could not find "${to}" after "${from}" in index.js`)
  return src.slice(start, end).replace(/^import .*$/gm, '').replace(/^export /gm, '')
}

const source = [
  region('const DEFAULTS = Object.freeze({', 'const Config = z.object({'),
  // A download press resolves through this before a byte moves, so it is checked with the
  // rest of the name normalising rather than in the download test.
  region('function prepareTarget', 'function startPreparation'),
  'const MIN_SEG_RUNES = 30',
  region('function val(node, fallback)', '// ── model call'),
  region('/** Whitelist + clamp a form submission', '// ── HTTP surface'),
  region('function snapshot(settings, entryId)', '// ── warm notes'),
].join('\n')

// The sliced regions call helpers that live at module scope in `index.js`: the
// quantisation normaliser, the pinned table, and the projection both the form and the
// local-model route serialise.
const local = await import('../local.js')
const quantName = (value) => local.quantFor(value).name
const quantView = (quant) => ({
  name: quant.name,
  file: quant.file,
  bytes: quant.bytes,
  bits: quant.bits,
  imatrix: quant.imatrix === true,
})
const api = new Function(
  'quantName',
  'QUANTS',
  'quantView',
  `${source}\nreturn { DEFAULTS, sanitizePatch, settingsOf, snapshot, prepareTarget };`,
)(quantName, local.QUANTS, quantView)
const empty = api.settingsOf({})

/** What the settings page sends: `draftOf(snapshot)` over the client's own key list. */
function draftOf(snapshot) {
  const match = /const KEYS = \[([\s\S]*?)\]/.exec(clientSrc)
  assert.ok(match !== null, 'could not find the client KEYS list in client.js')
  const keys = match[1]
    .split(',')
    .map((part) => part.trim())
    .map((part) => /^'([^']*)'$/.exec(part))
    .filter((hit) => hit !== null)
    .map((hit) => hit[1])
  assert.ok(keys.length >= 20, `expected the whole form, found ${keys.length} keys`)
  const draft = {}
  for (const key of keys) {
    const value = snapshot?.[key]
    if (Array.isArray(value)) draft[key] = value.slice()
    else if (value === undefined || value === null) draft[key] = ''
    else draft[key] = value
  }
  return { keys, draft }
}

// ── the aliases ───────────────────────────────────────────────────────────

{
  // The three segment-policy boxes post `first`/`step`/`max`.
  const patch = api.sanitizePatch({ first: 777, step: 333, max: 9999 })
  assert.deepEqual(patch, { streamFirst: 777, streamStep: 333, streamMax: 9999 })
}

{
  // The profile names still work, for a hand-written patch and for the older form.
  const patch = api.sanitizePatch({ streamFirst: 500, streamStep: 250, streamMax: 4000 })
  assert.deepEqual(patch, { streamFirst: 500, streamStep: 250, streamMax: 4000 })
}

{
  // A full form carries both names. The canonical one wins; the alias only fills a gap.
  const patch = api.sanitizePatch({ first: 111, streamFirst: 222 })
  assert.equal(patch.streamFirst, 222)
  const aliasOnly = api.sanitizePatch({ first: 111, streamFirst: '' })
  assert.equal(aliasOnly.streamFirst, 111)
}

{
  // Out of range is still clamped, whichever name it arrived under.
  const patch = api.sanitizePatch({ first: 1, step: -5, max: 999999 })
  assert.equal(patch.streamFirst, 40)
  assert.equal(patch.streamStep, 0)
  assert.equal(patch.streamMax, 20000)
}

// ── emptied boxes ─────────────────────────────────────────────────────────

{
  // `Number('')` is 0, so a cleared number box must be absent from the patch rather than
  // saved as the minimum: the profile would then disagree with the box the reader sees.
  const patch = api.sanitizePatch({ localThreads: '', parallel: '', first: '' })
  assert.ok(!('localThreads' in patch), 'an emptied localThreads saved anyway')
  assert.ok(!('parallel' in patch), 'an emptied parallel saved anyway')
  assert.ok(!('streamFirst' in patch), 'an emptied first saved anyway')
}

{
  // Zero is a real value for the fields that allow it, so it must survive.
  const patch = api.sanitizePatch({ streamStep: 0, maxSummaries: 0, localIdleSec: 0, retainDays: 0 })
  assert.equal(patch.streamStep, 0)
  assert.equal(patch.maxSummaries, 0)
  assert.equal(patch.localIdleSec, 0)
  assert.equal(patch.retainDays, 0)
}

// ── the guard: every key the form can send survives a save ─────────────────

{
  const { keys, draft } = draftOf(api.snapshot(empty, 'dsh-ccd'))
  // Change every value so a silently-dropped field cannot look saved.
  const wanted = {
    enabled: false,
    provider: 'probe-provider',
    model: 'probe-model',
    maxTokens: 401,
    temperature: 0.55,
    language: 'custom',
    customLanguage: 'Japanese',
    parallel: 4,
    timeoutSec: 21,
    maxSummaries: 7,
    minTail: 8,
    maxRunes: 9,
    retainDays: 15,
    first: 111,
    step: 222,
    max: 1999,
    prefix: 'probe',
    blockedRegex: 'probe-rx',
    avoidPrefixes: ['probe-avoid'],
    writer: 'local',
    localDataRoot: 'C:/probe/root',
    // Deliberately not the default: a field saved as its default would round-trip even if
    // the whitelist dropped it.
    localQuant: 'Q8_0',
    localThreads: 7,
    localContext: 10240,
    localIdleSec: 420,
  }
  for (const key of keys) {
    assert.ok(key in wanted, `the form has a key this test does not change: ${key}`)
    draft[key] = Array.isArray(wanted[key]) ? wanted[key].slice() : wanted[key]
  }

  const patch = api.sanitizePatch(draft)
  const saved = api.snapshot(api.settingsOf({ ...api.DEFAULTS, ...patch }), 'dsh-ccd')

  const lost = []
  for (const key of keys) {
    const before = draft[key]
    const after = saved[key]
    const same = Array.isArray(before) ? JSON.stringify(before) === JSON.stringify(after) : before === after
    if (!same) lost.push(`${key}: sent ${JSON.stringify(before)}, read back ${JSON.stringify(after)}`)
  }
  assert.deepEqual(lost, [], `these fields did not survive a save:\n${lost.join('\n')}`)
}

// ── the reverse direction: nothing extra leaks into the profile ────────────

{
  // `snapshot` adds `minSegRunes` and `entryId` for display. They are not settings, so a
  // form that posts them back must not write them into the profile patch.
  const patch = api.sanitizePatch({ minSegRunes: 99, entryId: 'not-a-setting', unknown: 5 })
  assert.deepEqual(patch, {})
}

{
  // Non-object input is a no-op rather than a throw: the route answers 400 for a body it
  // could not parse, and this function sits after that check.
  assert.deepEqual(api.sanitizePatch({}), {})
}

// ── a download press means what was on screen ─────────────────────────────

{
  const base = api.settingsOf({ localQuant: 'Q4_K_M' })

  // The press wins over the saved profile: the form may not have been saved yet, and a
  // reload resets it to the profile, so trusting the profile here is what once fetched the
  // wrong file.
  assert.equal(api.prepareTarget(base, { quant: 'Q8_0' }).localQuant, 'Q8_0')

  // No payload means no opinion: the profile's rung stands.
  assert.equal(api.prepareTarget(base, {}).localQuant, 'Q4_K_M')
  assert.equal(api.prepareTarget(base, undefined).localQuant, 'Q4_K_M')
  assert.equal(api.prepareTarget(base, { quant: '' }).localQuant, 'Q4_K_M')

  // A name the table does not know is not obeyed and does not leak through: it resolves to
  // the default rung, so the download can never ask for a file that has no hash pinned.
  assert.equal(api.prepareTarget(base, { quant: 'Q9_K_XL' }).localQuant, api.DEFAULTS.localQuant)

  // Everything else is carried through untouched — this function answers one question.
  const carried = api.prepareTarget(base, { quant: 'Q4_K_S' })
  assert.equal(carried.localThreads, base.localThreads)
  assert.equal(carried.parallel, base.parallel)
  assert.equal(carried.writer, base.writer)
}

console.log('settings.mjs: all assertions passed')
