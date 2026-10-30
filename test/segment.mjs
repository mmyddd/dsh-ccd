// Harness: the Host half's segmenter must match ccd's own cutting rule.
//
// `test/golden-segments.json` was frozen from the JavaScript copy that was differential-
// tested run-for-run against `C:\Git\ccd`'s `internal/thinkhide/segment.go` (402 cases,
// zero differences). That copy lived in `client.js` while the browser did its own
// translating; translation now happens only on the Host, so the fixture is what keeps the
// surviving copy honest against the Go original.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')

const src = read('../index.js')
const start = src.indexOf('const MIN_SEG_RUNES = 30')
const end = src.indexOf('// ── prompts')
assert.ok(start >= 0 && end > start, 'could not locate the segmenter in index.js')
const host = new Function(
  `${src.slice(start, end)}\nreturn { isSentenceEnd, paraBreakEnd, targetOf, takeSegments, MIN_SEG_RUNES };`,
)()

const golden = JSON.parse(read('./golden-segments.json'))
assert.ok(Array.isArray(golden) && golden.length > 0, 'golden-segments.json is empty')

let cases = 0
for (const entry of golden) {
  const { text, limit, already, pol, segments, rest, restText, targets } = entry
  const buf = Array.from(text)
  for (let k = 0; k < limit; k += 1) {
    assert.equal(
      host.targetOf(pol, already + k),
      targets[k],
      `targetOf diverged for ${JSON.stringify(pol)} at ${already + k}`,
    )
  }
  const mine = host.takeSegments(buf, limit, already, pol)
  assert.deepEqual(mine.segments, segments, `segments diverged: ${JSON.stringify(text).slice(0, 200)}`)
  assert.equal(mine.rest.length, rest, `rest length diverged: ${JSON.stringify(text).slice(0, 200)}`)
  assert.equal(mine.rest.join(''), restText, `rest text diverged: ${JSON.stringify(text).slice(0, 200)}`)
  cases += 1
}

assert.equal(host.MIN_SEG_RUNES, 30, 'the floor below which no segment is cut')

console.log(`segment.mjs: ${cases} golden cases agree`)
