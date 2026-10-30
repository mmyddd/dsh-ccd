// Harness: the Host half's note writer — reasoning-off negotiation and the two-attempt
// prompt ladder. Loads index.js source, cuts the note-writer region out of it, and runs
// that region against a stub `llm` service. No network, no Harness.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import z from '@deepseek-ai/schemastery'

const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const start = src.indexOf('const NOTE_EFFORT')
const end = src.indexOf('// ── settings write-through')
assert.ok(start > 0 && end > start, 'could not locate the note-writer region in index.js')

const body = src.slice(start, end).replace(/^import .*$/gm, '').replace(/^export /gm, '')
// `settingsOf` normalises the quantisation name through a helper and the pinned table that
// live at module scope in `index.js`, outside the region above; both are injected here.
const local = await import('../local.js')
const quantName = (value) => local.quantFor(value).name
const api = new Function(
  'z',
  'quantName',
  `${body}\nreturn { collectText, isUnsupportedEffort, describeFailure, effortChoice, forgetEffort, writeNote, acceptNote, promptSet, settingsOf };`,
)(z, quantName)

const settings = api.settingsOf({
  enabled: true,
  provider: '',
  model: '',
  maxTokens: 400,
  temperature: 0.5,
  language: 'en',
})
const set = api.promptSet('en', '')
const request = { prompt: '<thinking_excerpt>\nsome thought\n</thinking_excerpt>', timeoutMs: 5000 }

/** A stub `llm` service that records every call it is asked to make. */
function harness(info, behaviour) {
  const calls = []
  const ctx = {
    get(name) {
      if (name === 'llm') {
        return {
          resolveModelInfo: async () => info,
          stream(options) {
            calls.push({
              effort: options.reasoningEffort,
              maxTokens: options.maxTokens,
              strict: options.system.includes('Reminder'),
            })
            return behaviour(options, calls.length)
          },
        }
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
      return undefined
    },
  }
  return { ctx, calls }
}

const OFF_ONLY = { reasoning: { efforts: [{ id: 'off', name: 'Off' }], defaultEffort: 'off' } }
const THINKING_ONLY = { reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }
const NO_METADATA = {}

const unsupported = () => {
  const error = new Error('p/m does not support reasoning effort off')
  error.code = 'UNSUPPORTED_REASONING_EFFORT'
  return error
}

// ── collectText ───────────────────────────────────────────────────────────
{
  async function* plain() {
    yield { type: 'text-delta', text: 'hello' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const result = await api.collectText(plain())
  assert.deepEqual(result, { text: 'hello', terminal: { kind: 'stop' }, thought: false })
}

{
  // A route that thought anyway is not an error — the caller needs the fact, not a throw.
  async function* thought() {
    yield { type: 'reasoning-delta', text: 'thinking' }
    yield { type: 'text-delta', text: 'checking' }
    yield { type: 'finish', reason: { kind: 'max-tokens' } }
  }
  const result = await api.collectText(thought())
  assert.equal(result.text, 'checking')
  assert.equal(result.thought, true)
  assert.equal(result.terminal.kind, 'max-tokens')
}

{
  // An adapter failure arrives as a finish chunk, never as a throw, and its code must survive.
  async function* failed() {
    yield { type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'UNSUPPORTED_REASONING_EFFORT' } } }
  }
  await assert.rejects(() => api.collectText(failed()), (error) => {
    assert.equal(error.code, 'UNSUPPORTED_REASONING_EFFORT')
    assert.equal(api.isUnsupportedEffort(error), true)
    return true
  })
}

{
  async function* tool() {
    yield { type: 'tool-call-delta', index: 0 }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  await assert.rejects(() => api.collectText(tool()), /tried to call a tool/)
}

// ── effortChoice: ask the route before spending a call ────────────────────
{
  const lookup = (info) => ({
    get: (name) => (name === 'llm'
      ? { resolveModelInfo: async () => { if (info instanceof Error) throw info; return info } }
      : undefined),
  })
  assert.equal(await api.effortChoice(lookup(OFF_ONLY), { provider: 'p', model: 'r1' }, undefined), 'off')
  assert.equal(await api.effortChoice(lookup(THINKING_ONLY), { provider: 'p', model: 'r2' }, undefined), 'omit')
  assert.equal(await api.effortChoice(lookup(NO_METADATA), { provider: 'p', model: 'r3' }, undefined), 'omit')
  assert.equal(await api.effortChoice(lookup(new Error('lookup failed')), { provider: 'p', model: 'r4' }, undefined), 'off')
}

// ── writeNote: a runtime refusal is cached, not paid for again ────────────
{
  async function* refuseThenWrite(_options, call) {
    if (call === 1) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'p/m does not support reasoning effort off', code: 'UNSUPPORTED_REASONING_EFFORT' } } }
      return
    }
    yield { type: 'text-delta', text: 'I am checking where the refresh call lives in auth.py.' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const { ctx, calls } = harness(OFF_ONLY, refuseThenWrite)
  const note = await api.writeNote(ctx, settings, set, request)
  assert.match(note, /auth\.py/)
  assert.equal(calls.length, 2)
  // The retry dropped the field and did NOT spend the strict-prompt attempt.
  assert.equal(calls[0].effort, 'off')
  assert.equal(calls[1].effort, undefined)
  assert.equal(calls[1].strict, false)
  // The refusal is remembered for the next segment.
  assert.equal(await api.effortChoice(ctx, { provider: 'p', model: 'm' }, undefined), 'omit')
}

// ── writeNote: a route that thinks anyway gets one wider budget ───────────
{
  async function* thinksAndTruncates(_options, call) {
    yield { type: 'reasoning-delta', text: 'much thinking' }
    yield { type: 'text-delta', text: 'I am checking the retry branch.' }
    yield { type: 'finish', reason: { kind: call === 1 ? 'max-tokens' : 'stop' } }
  }
  const { ctx, calls } = harness(OFF_ONLY, thinksAndTruncates)
  const note = await api.writeNote(ctx, settings, set, request)
  assert.match(note, /retry branch/)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].maxTokens, 400)
  assert.equal(calls[1].maxTokens, 800)
  assert.equal(calls[1].strict, false, 'widening is not a prompt attempt')
}

// ── writeNote: a route with no `off` is never told to turn thinking off ───
{
  async function* writes() {
    yield { type: 'text-delta', text: 'Checking the cache invalidation path first.' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const { ctx, calls } = harness(THINKING_ONLY, writes)
  await api.writeNote(ctx, settings, set, request)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].effort, undefined, 'a route without off must not receive one')
}

// ── writeNote: output that breaks the rules retries once with the strict prompt ──
{
  async function* writes(_options, call) {
    yield { type: 'text-delta', text: call === 1 ? 'The user asked me to look at this.' : 'I am looking at the cache path first.' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const { ctx, calls } = harness(OFF_ONLY, writes)
  const note = await api.writeNote(ctx, settings, set, request)
  assert.match(note, /cache path/)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].strict, true)
}

// ── writeNote: two rejected attempts surface a failure ────────────────────
{
  async function* refuses() {
    yield { type: 'text-delta', text: 'The user wants me to keep looking.' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const { ctx, calls } = harness(OFF_ONLY, refuses)
  await assert.rejects(() => api.writeNote(ctx, settings, set, request), /rejected/)
  assert.equal(calls.length, 2)
}

// ── describeFailure: the row gets the route's words, not a shrug ──────────
// "Some notes were dropped" hid the one fact worth showing: whether the provider was
// unreachable, the key was rejected, or the model name was wrong. These assertions pin
// that the text reaching the row is the real one, bounded and single-line.
{
  const plain = new Error('Connection error.')
  assert.equal(api.describeFailure(plain), 'Connection error.')
  const coded = new Error('upstream refused the request')
  coded.code = 'MALFORMED_RESPONSE'
  assert.equal(api.describeFailure(coded), 'MALFORMED_RESPONSE: upstream refused the request')
  // Whitespace collapses: an HTML error body must not become a paragraph in the bar.
  assert.equal(
    api.describeFailure(new Error('  connect\n\n  ECONNREFUSED\tagain  ')),
    'connect ECONNREFUSED again',
  )
  // Bounded, because a stack trace in the status line would push the row around.
  const long = api.describeFailure(new Error('x'.repeat(500)))
  assert.equal(long.length, 240)
  assert.ok(long.endsWith('…'))
  // Anything thrown at all still produces words, never an empty string.
  assert.equal(api.describeFailure(undefined), 'unknown error')
  assert.equal(api.describeFailure('plain string'), 'plain string')
}

console.log('notes.mjs: all assertions passed')
