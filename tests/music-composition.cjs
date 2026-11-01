// Run with: node tests/music-composition.cjs
// Exercise the browser's actual composer without a DOM or audio device.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
for (const script of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (!script[1].includes('application/ld+json')) new Function(script[2]);
}
const composer = html.slice(html.indexOf('  function phraseRandom('), html.indexOf('  // Inner ring:'));
function seeded(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function context(seed, choices = []) {
  const random = seeded(seed), math = Object.create(Math);
  math.random = () => choices.length ? choices.shift() : random();
  const ctx = { Math: math };
  vm.createContext(ctx);
  vm.runInContext(composer, ctx);
  return ctx;
}
const engine = context(42), random = seeded(1234);
const groupings = new Set(), riffs = new Set(), melodies = new Set();
let delayed = 0, dotted = 0;
for (let trial = 0; trial < 2000; trial++) {
  const groups = engine.pulseGroups(11, random);
  assert.equal(groups.reduce((a, b) => a + b, 0), 11);
  assert(groups.every(n => n >= 2 && n <= 4));
  groupings.add(groups.join(','));
  const config = engine.chooseSession(null);
  const riff = engine.makeRiff(config, random);
  assert(riff.attacks.length >= 2);
  assert(riff.attacks.every((h, i) => h.tick < riff.period && (!i || h.tick > riff.attacks[i - 1].tick)));
  riffs.add(JSON.stringify(riff.attacks));
  const bar = engine.composeCycle(config, trial);
  melodies.add(JSON.stringify(bar.events.map(e => e.offset)));
  if (bar.events[0].offset > 0) delayed++;
  const unit = config.quarterBeat / 4;
  for (let i = 1; i < bar.events.length; i++) {
    const ticks = (bar.events[i].offset - bar.events[i - 1].offset) / unit;
    if ([3, 6, 12].some(n => Math.abs(n - ticks) < 1e-8)) dotted++;
  }
}
assert(groupings.size > 8, 'Groups must extend beyond the old short catalog');
assert(riffs.size > 1500 && melodies.size > 400, 'Generate many distinct motifs');
assert(delayed > 1400 && dotted > 500, 'Retain offbeat/dotted preferences');

let bars = 0;
for (let scale = 0; scale < 12; scale++) for (let meter = 0; meter < 18; meter++) {
  const roll = meter < 9 ? .8 * (meter + .1) / 9 : .8 + .2 * (meter - 9 + .1) / 9;
  const c = context(17 + scale * 18 + meter, [(scale + .1) / 12, roll]);
  const config = c.raagSession, duration = config.b * config.beat;
  const riff = c.makeRiff(config, random);
  assert.equal(config.rhythm.groups.reduce((a, b) => a + b, 0), config.b);
  for (let cycle = 0; cycle < 16; cycle++) {
    const melody = c.composeCycle(config, cycle);
    assert(melody.events.length > 0);
    for (const note of melody.events) {
      assert(config.raga.notes.includes(note.note % 12));
      assert(note.gate > 0 && note.offset >= 0 && note.offset + note.gate <= duration + 1e-8);
    }
    const pattern = { placement: random(), answer: random(), sharp: random() < .55 };
    const chords = c.harmonyPhrases(config, riff, pattern);
    assert.equal(JSON.stringify(chords), JSON.stringify(c.harmonyPhrases(config, riff, pattern)), 'Remember a chord phrase');
    assert(chords.length <= 3);
    chords.forEach((h, i) => assert(h.gate > 0 && h.offset + h.gate < (chords[i + 1]?.offset ?? duration)));
    for (const style of ['groove', 'half-time', 'ride', 'blast']) {
      const hits = c.composeDrums(config, cycle, random, riff, false, style);
      hits.forEach(h => assert(h.offset >= 0 && h.offset < duration && h.strength > 0 && h.strength <= 1));
      if (config.rhythm.kind === 'poly') {
        for (const [lane, count] of [['A', config.a], ['B', config.b]]) {
          const pulses = hits.filter(h => h.lane === lane);
          assert.equal(pulses.length, count);
          pulses.forEach((h, i) => assert(Math.abs(h.offset - i * duration / count) < 1e-8));
        }
      }
    }
    bars++;
  }
  if (config.rhythm.kind === 'poly') {
    const original = JSON.stringify(riff.drumPlans);
    c.composeDrums(config, 99, random, riff, false, 'groove');
    assert.equal(JSON.stringify(riff.drumPlans), original, 'Keep drum orchestration until phrase mutation');
  }
}
console.log(`PASS: ${bars} bars across 216 scale/meter combinations; exact A:B timing and bounded notes.`);
console.log(`PASS: ${groupings.size} generated 11-pulse groupings, ${riffs.size} distinct riffs, ${melodies.size} melodic rhythms; phrase memory and dotted/offbeat preferences.`);
