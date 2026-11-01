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
  assert(riff.attacks.length === 3 || riff.attacks.length === 4);
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
  const c = context(17 + scale * 18 + meter, [(scale + .1) / 12, roll, .99, .99]);
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
    assert(chords.length >= 1 && chords.length <= 6, 'A handful of hits at most');
    chords.forEach((h, i) => {
      assert(['sustained', 'swell'].includes(h.articulation) && h.strum >= 0 && h.gate > 0 && h.offset + h.gate <= duration + 1e-9);
      assert(['pad', 'answer', 'arp'].includes(h.role) && ['hold', 'pump', 'arp', 'swell'].includes(h.gesture));
      assert(!i || h.offset - chords[i - 1].offset >= config.quarterBeat * .75 - 1e-9, 'Hits stay a dotted eighth apart');
      if (!h.bed) assert(h.gate >= ((chords[i + 1]?.offset ?? duration) - h.offset) * .95 - .0201, 'Pad hits are long');
      else assert(h.strength <= .8 + 1e-9, 'Beds sit under the lead');
    });
    const harmonyChoice = c.chooseHarmony(config, null, null, random);
    assert(harmonyChoice.notes.length === 3 || harmonyChoice.notes.length === 4, 'Chords are three or four notes');
    chords.forEach((h, i) => assert(h.gate > 0 && (h.bed || h.offset + h.gate < (chords[i + 1]?.offset ?? duration))));
    for (const style of c.drumStyles) {
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
// Thinned bars stay playable: at least three onsets (when available) and both halves sounding.
{
  const duration = 4, source = Array.from({ length: 8 }, (_, i) => ({ offset: i * .5, gate: .3 }));
  for (let trial = 0; trial < 500; trial++) {
    const thin = source.filter(() => random() < .15).slice(0, 1);
    const balanced = engine.balanceMelody(thin, source, duration, 3);
    assert(balanced.length >= 3);
    assert(balanced.some(e => e.offset < 2) && balanced.some(e => e.offset >= 2));
    assert(balanced.every((e, i) => !i || e.offset > balanced[i - 1].offset));
  }
}
// Melody slips off drum hits: far fewer onsets land exactly on an attack after the opening.
{
  let plain = 0, shifted = 0;
  for (let trial = 0; trial < 400; trial++) {
    const config = engine.chooseSession(null), riff = engine.makeRiff(config, random);
    const attacks = engine.riffBar(config, trial, riff).map(a => a.offset);
    const unit = config.beat / (config.rhythm.denominator === 8 ? 2 : 4);
    const hits = bar => bar.events.filter(e => !e.chain).slice(1).filter(e => attacks.some(a => Math.abs(a - e.offset) < unit * .5)).length;
    plain += hits(engine.composeCycle(config, trial));
    shifted += hits(engine.composeCycle(config, trial, attacks));
    const bar = engine.composeCycle(config, trial, attacks);
    bar.events.forEach((e, i) => assert(e.gate > 0 && (!i || e.offset > bar.events[i - 1].offset)));
  }
  assert(shifted < plain * .75, `syncopation should reduce downbeat collisions (${shifted} vs ${plain})`);
}
// Chords answer the lead: sam keeps its chord, other entrances sit in gaps or drop out; replies use a new shape.
{
  let differs = 0, replies = 0, shapes = new Set();
  for (let trial = 0; trial < 800; trial++) {
    const config = engine.chooseSession(null), riff = engine.makeRiff(config, random);
    const duration = config.b * config.beat, unit = config.quarterBeat / 4;
    const bar = engine.composeCycle(config, trial, engine.riffBar(config, trial, riff));
    const pattern = { placement: random(), answer: random() };
    const call = engine.harmonyPhrases(config, riff, pattern, false), reply = engine.harmonyPhrases(config, riff, pattern, true);
    assert.equal(JSON.stringify(reply), JSON.stringify(engine.harmonyPhrases(config, riff, pattern, true)), 'A reply is remembered too');
    replies++; if (JSON.stringify(call.map(h => [h.offset, h.gesture])) !== JSON.stringify(reply.map(h => [h.offset, h.gesture]))) differs++;
    shapes.add(call.map(h => Math.round(h.offset / unit)).join());
    for (const chords of [call, reply]) {
      const answered = engine.answerChords(chords, bar.events, duration, unit);
      assert(answered.length >= 1 && answered.length <= chords.length);
      answered.forEach((h, i) => {
        assert(h.gate > 0 && h.offset + h.gate <= duration + 1e-8 && (!i || h.offset - answered[i - 1].offset >= unit * 3 - 1e-8));
        const tick = Math.round(h.offset / unit);
        if (tick > 0 && !h.bed) assert(bar.events.every(e => Math.abs(Math.round(e.offset / unit) - tick) > 1), 'Entrances avoid melody onsets');
      });
    }
    let lean = 0;
    for (let i = 0; i < 40; i++) { lean = engine.nextLean(lean, random); assert(lean >= -.014 && lean <= .022); }
    const moved = engine.pushPull(bar.events[0], lean + .008, duration);
    assert(moved.offset >= 0 && moved.gate > 0 && moved.offset + moved.gate <= duration);
  }
  assert(differs > replies * .85, `replies should take a different shape (${differs}/${replies})`);
  assert(shapes.size >= 6, 'Comping rhythms vary: ' + [...shapes].length);
}
// The lead lands: sam gets the chord root, strong beats get chord tones, cadences resolve.
{
  let samHits = 0, beatHits = 0, beatTotal = 0, cadences = 0;
  for (let trial = 0; trial < 600; trial++) {
    const config = engine.chooseSession(null);
    const harmony = engine.chooseHarmony(config, null, null, random);
    const chord = engine.chordPitchClasses(harmony, config, config);
    const bar = engine.composeCycle(config, trial);
    const landed = engine.landOnTargets(config, bar.events, chord, { sam: true, cadence: 'tonic' }, random);
    assert.equal(landed.length, bar.events.length);
    assert.equal(landed[0].offset, 0, 'Sam entrance');
    if (landed.length === 1 || landed[0].note % 12 === chord.root || !config.raga.notes.includes(chord.root)) samHits++;
    const last = landed[landed.length - 1];
    if (last.note % 12 === 0) cadences++;
    landed.forEach((e, i) => {
      assert(e.gate > 0 && (!i || e.offset > landed[i - 1].offset));
      const pos = e.offset / config.beat;
      if (i && i < landed.length - 1 && Math.abs(pos - Math.round(pos)) < .05) { beatTotal++; if (chord.classes.includes(e.note % 12)) beatHits++; }
    });
  }
  assert.equal(samHits, 600);
  assert.equal(cadences, 600);
  assert(beatHits > beatTotal * .6, `strong beats mostly carry chord tones (${beatHits}/${beatTotal})`);
}
// Lead continuity: bars that start from the previous degree begin closer to it.
{
  let free = 0, tied = 0;
  for (let trial = 0; trial < 500; trial++) {
    const config = engine.chooseSession(null), n = config.raga.notes.length, start = Math.floor(random() * n * 2);
    const degreeOf = note => engine.noteDegree(config, note);
    free += Math.abs(degreeOf(engine.composeCycle(config, trial).events[0].note) - start);
    tied += Math.abs(degreeOf(engine.composeCycle(config, trial, null, false, start).events[0].note) - start);
  }
  assert(tied < free * .5, `bars should open near the previous degree (${tied} vs ${free})`);
}
// Dense bars after sparse ones carry more onsets than the default composition.
{
  let normal = 0, dense = 0;
  for (let trial = 0; trial < 400; trial++) {
    const config = engine.chooseSession(null);
    normal += engine.composeCycle(config, trial).events.length / (config.b * config.beat / config.quarterBeat);
    dense += engine.composeCycle(config, trial, null, true).events.length / (config.b * config.beat / config.quarterBeat);
  }
  assert(dense > normal * 1.2, `dense should raise note density (${dense} vs ${normal})`);
}
// Bass triplets: some bars roll three clipped notes a third of a beat apart.
{
  let rolled = 0;
  for (let trial = 0; trial < 400; trial++) {
    const config = engine.chooseSession(null), riff = engine.makeRiff(config, random);
    if (config.rhythm.kind === 'poly') continue;
    const harmony = engine.chooseHarmony(config, null, null, random);
    const bass = engine.composeGrooveBass(config, harmony, engine.riffBar(config, trial, riff), [], trial, false, false, 0);
    const third = config.beat / 3;
    if (bass.some((e, i) => i + 2 < bass.length && Math.abs(bass[i + 1].offset - e.offset - third) < 1e-6 && Math.abs(bass[i + 2].offset - bass[i + 1].offset - third) < 1e-6)) rolled++;
    bass.forEach(e => assert(e.gate > 0));
  }
  assert(rolled > 40, `bass should sometimes play triplets (${rolled})`);
}
// A change touches exactly one dimension, never the one that just changed; every dimension gets its turn.
{
  const seen = {};
  let recent = [];
  for (let trial = 0; trial < 4000; trial++) {
    const set = engine.chooseChangeSet(random, recent);
    assert.equal(set.length, 1);
    assert(!recent.includes(set[0]), 'No immediate repeats');
    seen[set[0]] = (seen[set[0]] || 0) + 1;
    recent = [set[0], ...recent].slice(0, 2);
  }
  assert.deepEqual(Object.keys(seen).sort(), ['drums', 'harmony', 'key', 'melody', 'meter', 'scale', 'tempo', 'voices']);
}
// Character: tendencies drawn in range; a change re-draws a few traits of one group and nothing else.
{
  const base = engine.chooseCharacter(random);
  for (const [name, [lo, hi]] of Object.entries(engine.traitRanges)) assert(base[name] >= lo && base[name] <= hi, name);
  for (const name of Object.keys(engine.tableKeys)) Object.values(base[name]).forEach(v => assert(v > .25 && v < 4));
  for (const group of Object.keys(engine.traitGroups)) {
    let changedTotal = 0;
    for (let trial = 0; trial < 200; trial++) {
      const next = engine.rerollCharacter(base, group, random);
      const changed = Object.keys(base).filter(k => JSON.stringify(base[k]) !== JSON.stringify(next[k]));
      assert(changed.length >= 1 && changed.length <= 3 && changed.every(k => engine.traitGroups[group].includes(k)), group + ' reroll stays in its group');
      changedTotal += changed.length;
    }
    assert(changedTotal > 200, group + ' rerolls actually change things');
  }
  const mid = engine.trait({}, 'dotted');
  assert.equal(mid, 6, 'Defaults keep the original behaviour');
}
// Improvised scales hold the tonic and a fourth/fifth, avoid wide gaps and semitone clusters, and vary a lot.
{
  const seen = new Set();
  for (let trial = 0; trial < 3000; trial++) {
    const raga = engine.generateRaga(random);
    assert(raga, 'a scale is always found');
    const n = raga.notes;
    assert(n.length >= 5 && n.length <= 7 && n[0] === 0 && new Set(n).size === n.length);
    assert(n.every((v, i) => !i || v > n[i - 1]) && n.every(v => v >= 0 && v < 12));
    assert(n.includes(7) || n.includes(5));
    n.forEach((v, i) => assert((n[i + 1] ?? 12) - v <= 4 && !(n.includes(v + 1) && n.includes(v + 2))));
    seen.add(n.join());
  }
  assert(seen.size > 100, `improvised scales are varied (${seen.size})`);
}
// Improvised meters and polyrhythms stay well-formed; tempo and pitch sit in a playable range.
{
  const labels = new Set();
  for (let trial = 0; trial < 3000; trial++) {
    const meter = engine.generateRhythm('meter', random);
    assert(meter.b >= 3 && meter.b <= 15 && (meter.denominator === 4 || meter.denominator === 8) && meter.kind === 'meter');
    labels.add(meter.label);
    const poly = engine.generateRhythm('poly', random);
    let x = poly.a, y = poly.b; while (y) { const t = x % y; x = y; y = t; }
    assert(poly.a !== poly.b && x === 1 && poly.b >= 2 && poly.b <= 5 && poly.a >= 3 && poly.a <= 11 && poly.kind === 'poly');
    const config = engine.chooseSession(null);
    assert(config.quarterBeat >= engine.quarterRange[0] - 1e-9 && config.quarterBeat <= engine.quarterRange[1] + 1e-9);
    assert(config.tonic >= 110 && config.tonic <= 330, 'tonic ' + config.tonic);
    assert.equal(config.rhythm.groups.reduce((a, b) => a + b, 0), config.rhythm.kind === 'poly' ? config.b : config.b);
    assert(config.character && config.character.sam > 0);
  }
  assert(labels.size > 12, 'many meters');
}
// Drum styles differ from one another, yet every stroke stays inside the bar.
{
  const signatures = {};
  for (let trial = 0; trial < 300; trial++) {
    const config = engine.chooseSession(null);
    if (config.rhythm.kind === 'poly') continue;
    const riff = engine.makeRiff(config, random);
    for (const style of engine.drumStyles) {
      const hits = engine.composeDrums(config, trial, random, riff, false, style);
      assert(hits.length > 0 && hits.every(h => h.offset >= 0 && h.offset < config.b * config.beat && h.strength > 0 && h.strength <= 1));
      (signatures[style] ||= new Set()).add(hits.map(h => h.voice + Math.round(h.offset * 1000)).join());
    }
  }
  assert(engine.drumStyles.length >= 7 && engine.drumStyles.includes('ride'));
  for (const style of engine.drumStyles) assert(signatures[style].size > 50, style + ' should vary');
}
// Stab pairs: exactly two short sharp hits in a gap, late in the bar, with the pad easing off first.
{
  let added = 0, trials = 0;
  for (let trial = 0; trial < 1200; trial++) {
    const config = engine.chooseSession(null), riff = engine.makeRiff(config, random);
    const duration = config.b * config.beat, unit = config.quarterBeat / 4;
    const bar = engine.composeCycle(config, trial, engine.riffBar(config, trial, riff));
    const pad = engine.answerChords(engine.harmonyPhrases(config, riff, { placement: random(), answer: random() }, false), bar.events, duration, unit);
    const out = engine.addStabPair(pad, bar.events, duration, unit, random, .7);
    trials++;
    if (out === pad) continue;
    added++;
    const stabs = out.filter(h => h.articulation === 'sharp');
    assert.equal(stabs.length, 2); assert.equal(out.length, pad.length + 2);
    const gap = Math.round((stabs[1].offset - stabs[0].offset) / unit);
    assert(gap >= 2 && gap <= 4);
    stabs.forEach(h => {
      const tick = Math.round(h.offset / unit);
      assert(h.gate > 0 && h.offset + h.gate < duration && tick >= total(duration, unit) * .3 - 1);
      assert(bar.events.every(e => Math.abs(Math.round(e.offset / unit) - tick) > 1), 'Stabs sit in gaps');
    });
    out.slice(0, pad.length).forEach(h => assert(h.offset + h.gate <= stabs[0].offset + 1e-9, 'Pad eases off before the stabs'));
  }
  function total(d, u) { return Math.round(d / u); }
  assert(added > trials * .12 && added < trials * .4, `stab pairs are occasional (${added}/${trials})`);
}
// The ride is a rare, two-bar style, and only the ride style rings the bell.
{
  let picks = 0, rides = 0, previous = null;
  for (let trial = 0; trial < 6000; trial++) {
    const pick = engine.chooseDrumStyle(previous, random);
    assert(pick.style !== previous);
    assert(pick.style === 'ride' ? pick.bars === 2 : pick.bars >= 8 && pick.bars <= 14);
    picks++; if (pick.style === 'ride') rides++;
    previous = pick.style;
  }
  assert(rides > picks * .04 && rides < picks * .15, `ride should be rare (${rides}/${picks})`);
  for (let trial = 0; trial < 300; trial++) {
    const config = engine.chooseSession(null);
    if (config.rhythm.kind === 'poly') continue;
    const riff = engine.makeRiff(config, random);
    for (const style of engine.drumStyles) {
      const bells = engine.composeDrums(config, trial, random, riff, false, style).filter(h => h.voice === 'ride').length;
      assert(style === 'ride' ? bells >= config.b : bells === 0, style + ' bell count ' + bells);
    }
  }
}
// Grooves mix inside a bar: blended bars differ from either pure style, keep sam, and stay bounded.
{
  let mixed = 0, total = 0;
  for (let trial = 0; trial < 500; trial++) {
    const config = engine.chooseSession(null);
    if (config.rhythm.kind === 'poly') continue;
    const riff = engine.makeRiff(config, random), duration = config.b * config.beat;
    const styles = engine.drumStyles.filter(s => s !== 'ride');
    const a = styles[Math.floor(random() * styles.length)], b = styles.filter(s => s !== a)[Math.floor(random() * (styles.length - 1))];
    const hits = engine.composeDrums(config, trial, random, riff, false, a, b);
    assert(hits.every((h, i) => h.offset >= 0 && h.offset < duration && h.strength > 0 && h.strength <= 1 && (!i || h.offset >= hits[i - 1].offset)));
    assert(hits.some(h => h.voice === 'kick' && h.offset === 0), 'Sam keeps its kick');
    total++;
    const key = list => list.map(h => h.voice + Math.round(h.offset * 1000)).join();
    const pure = key(engine.composeDrums(config, trial, seeded(trial), riff, false, a)), blended = key(hits);
    if (blended !== pure) mixed++;
  }
  assert(mixed > total * .9, `blends should differ from the main groove (${mixed}/${total})`);
}
// Harmony colours: every chord is 3-4 notes built from the raga's own degrees, with real variety.
{
  const config = engine.raagSession, scale = config.raga.notes, seen = {};
  let previous = null, sam = 0;
  for (let trial = 0; trial < 3000; trial++) {
    const h = engine.chooseHarmony(config, previous, null, random);
    const shape = engine.chordColours[h.colour];
    assert(shape && h.notes.length === shape.length && (shape.length === 3 || shape.length === 4));
    const allowed = new Set(shape.map(o => scale[(h.rootIndex + o) % scale.length]));
    assert(h.notes.every(n => allowed.has(((n % 12) + 12) % 12)), 'Chord tones come from the raga');
    seen[h.colour] = (seen[h.colour] || 0) + 1; previous = h;
  }
  assert(Object.keys(seen).length === Object.keys(engine.chordColours).length, 'Every colour is used');
  assert(seen.triad < 3000 * .45, 'Not just plain triads');
  for (let trial = 0; trial < 1000; trial++) {
    const config2 = engine.chooseSession(null), riff = engine.makeRiff(config2, random);
    const chords = engine.harmonyPhrases(config2, riff, { placement: random(), answer: random() }, false);
    if (chords[0].offset === 0) sam++;
  }
  assert(sam < 1000 * .75, `chords should not always enter on one (${sam}/1000)`);
}
// Shader precompute: the per-frame layer constants and hue matrix equal the original per-pixel GLSL maths.
{
  const mix = (a, b, t) => a * (1 - t) + b * t, fract = v => v - Math.floor(v);
  const smoothstep = (lo, hi, v) => { const u = Math.min(1, Math.max(0, (v - lo) / (hi - lo))); return u * u * (3 - 2 * u); };
  const glMod = (v, m) => v - m * Math.floor(v / m);
  const A = new Float32Array(24), B = new Float32Array(24), M = new Float32Array(9);
  const close = (a, b, tolerance, label) => assert(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${label}: ${a} vs ${b}`);
  for (let trial = 0; trial < 500; trial++) {
    const t = random() * 5000, h = random() * 2000;
    engine.layerUniforms(t, h, A, B);
    for (let layer = 0; layer < 6; layer++) {
      const slot = 5 - layer, travel = t * 0.004, phase = (slot + fract(travel)) / 6, identity = glMod(slot - Math.floor(travel), 6);
      const scale = Math.pow(2, mix(2.4, -1.1, phase)), visibility = smoothstep(0, .13, phase) * (1 - smoothstep(.8, 1, phase));
      const drift = mix(.003, .025, phase);
      close(A[layer * 4], scale, 1e-5, 'scale'); close(A[layer * 4 + 1], visibility, 1e-5, 'visibility');
      close(B[layer * 4], identity, 1e-5, 'identity'); close(B[layer * 4 + 3], phase, 1e-5, 'phase');
      close(B[layer * 4 + 1], 17.3 * identity + t * drift, 1e-5, 'offset x'); close(B[layer * 4 + 2], 9.1 * identity + h * drift, 1e-5, 'offset y');
    }
    // The original per-pixel hue(): rotate chroma in YIQ by `a` radians.
    const angle = (random() - .5) * 8, colour = [random(), random(), random()];
    const y = [.299 * colour[0] + .587 * colour[1] + .114 * colour[2], .596 * colour[0] - .274 * colour[1] - .322 * colour[2], .211 * colour[0] - .523 * colour[1] + .312 * colour[2]];
    const hh = Math.atan2(y[2], y[1]) + angle, ch = Math.hypot(y[1], y[2]), v = [y[0], ch * Math.cos(hh), ch * Math.sin(hh)];
    const expected = [v[0] + .956 * v[1] + .621 * v[2], v[0] - .272 * v[1] - .647 * v[2], v[0] - 1.106 * v[1] + 1.703 * v[2]];
    engine.hueMatrix(angle, M);
    for (let row = 0; row < 3; row++) close(M[row] * colour[0] + M[3 + row] * colour[1] + M[6 + row] * colour[2], expected[row], 1e-5, 'hue');
  }
}
// Comping gestures: all four appear, beds are quiet and unstabby, arps pick real chord tones, replies often change gesture.
{
  const seen = {}, modes = new Set();
  let changed = 0, replies = 0;
  for (let trial = 0; trial < 4000; trial++) {
    const config = engine.chooseSession(null), riff = engine.makeRiff(config, random);
    const pattern = { placement: random(), answer: random() };
    const call = engine.harmonyPhrases(config, riff, pattern, false), reply = engine.harmonyPhrases(config, riff, pattern, true);
    seen[call[0].gesture] = (seen[call[0].gesture] || 0) + 1;
    replies++; if (reply[0].gesture !== call[0].gesture) changed++;
    for (const h of call) if (h.role === 'arp') {
      modes.add(h.arpMode);
      for (let len = 3; len <= 4; len++) { const index = engine.arpIndex(h.tone, len, h.arpMode); assert(Number.isInteger(index) && index >= 0 && index < len); }
    }
  }
  assert.deepEqual(Object.keys(seen).sort(), ['arp', 'hold', 'pump', 'swell']);
  assert.deepEqual([...modes].sort(), ['down', 'up', 'updown']);
  assert(changed > replies * .3, `replies often change gesture (${changed}/${replies})`);
  for (const mode of ['up', 'down', 'updown']) {
    const walk = Array.from({ length: 8 }, (_, step) => engine.arpIndex(step, 4, mode));
    assert(new Set(walk).size === 4, mode + ' visits every chord tone');
  }
}
// Bass noodling: stays on the chord's scale and in range, keeps sam on a chord tone, and sometimes adds fills and ghosts.
{
  let bars = 0, noodled = 0, ghosts = 0;
  for (let trial = 0; trial < 1500; trial++) {
    const config = engine.chooseSession(null), riff = engine.makeRiff(config, random);
    if (config.rhythm.kind === 'poly') continue;
    const harmony = engine.chooseHarmony(config, null, null, random);
    const attacks = engine.riffBar(config, trial, riff);
    const bass = engine.composeGrooveBass(config, harmony, attacks, [], trial, false, false, config.root + config.raga.notes[harmony.rootIndex]);
    bars++;
    const duration = config.b * config.beat;
    bass.forEach((e, i) => {
      assert(e.gate > 0 && e.strength > 0 && e.strength <= 1 && e.offset >= 0 && e.offset < duration && (!i || e.offset > bass[i - 1].offset));
      assert(config.raga.notes.includes(((e.note % 12) + 12) % 12) || harmony.notes.some(n => (((n - e.note) % 12) + 12) % 12 === 0), 'Bass pitch classes come from the raga');
      const hz = config.tonic * Math.pow(2, e.note / 12); assert(hz >= 40 && hz <= 150, 'bass in range ' + hz);
      if (e.ghost) { ghosts++; assert(e.gate <= .0701); }
    });
    const extras = bass.filter(e => e.ghost || e.slideFrom !== undefined || e.strength === .55).length;
    if (extras) noodled++;
  }
  assert(noodled > bars * .15 && noodled < bars * .85, `some bars noodle, not all (${noodled}/${bars})`);
  assert(ghosts > 20, 'ghost notes appear');
}
// Repetition: wilder sessions come back to their motif more; variations stay in the scale and keep the rhythm.
{
  const calm = engine.chooseSession(null);
  const wild = Object.assign({}, calm, { raga: { name: 'Improvised 0-1-4-7-8', label: 'Improvised', notes: [0, 1, 4, 7, 8] }, rhythm: { kind: 'poly', a: 7, b: 4, denominator: 4, groups: [4] }, b: 4 });
  const tame = Object.assign({}, calm, { raga: { name: 'Bhoopali', label: 'x', notes: [0, 2, 4, 7, 9] }, rhythm: { kind: 'meter', a: 4, b: 4, denominator: 4, groups: [4] }, b: 4 });
  const base = { ...engine.chooseCharacter(random), leap: 1, dotted: 5, slip: .6, gaps: .2, recall: .3 };
  wild.character = tame.character = base;
  assert(engine.craziness(wild) > engine.craziness(tame) + .4, 'improvised poly is crazier');
  assert(engine.repeatChance(wild) > engine.repeatChance(tame) + .1, 'wilder sessions repeat more');
  for (let trial = 0; trial < 500; trial++) {
    const config = engine.chooseSession(null);
    assert(engine.repeatChance(config) >= .15 && engine.repeatChance(config) <= .85);
    const events = engine.composeCycle(config, trial).events;
    const varied = engine.varyRepeat(config, events, random);
    assert.equal(varied.length, events.length);
    varied.forEach((e, i) => { assert.equal(e.offset, events[i].offset); assert.equal(e.gate, events[i].gate); assert(e.note >= 0 && e.note <= 23); assert(config.raga.notes.includes(e.note % 12)); });
    const up = engine.transposeInScale(config, events, 1);
    up.forEach(e => assert(config.raga.notes.includes(e.note % 12)));
  }
  let exact = 0, trials = 0;
  const config = engine.chooseSession(null);
  for (let trial = 0; trial < 1000; trial++) { const events = engine.composeCycle(config, trial).events; trials++; if (JSON.stringify(engine.varyRepeat(config, events, random).map(e => e.note)) === JSON.stringify(events.map(e => e.note))) exact++; }
  assert(exact > trials * .5 && exact < trials * .8, `most returns are exact, some vary (${exact}/${trials})`);
}
// Voice separation: instruments stop piling onto one pitch on one beat, yet chords keep 3+ notes and sam keeps its bass root.
{
  const pcOf = n => ((n % 12) + 12) % 12;
  let before = 0, afterTight = 0, afterLoose = 0, changedAtFull = 0, bassMoved = 0, thinned = 0;
  for (let trial = 0; trial < 1500; trial++) {
    const config = engine.chooseSession(null), riff = engine.makeRiff(config, random);
    if (config.rhythm.kind === 'poly') continue;
    const duration = config.b * config.beat, unit = config.quarterBeat / 4;
    const harmony = engine.chooseHarmony(config, null, null, random);
    const chord = engine.chordPitchClasses(harmony, config, config);
    const melody = engine.landOnTargets(config, engine.composeCycle(config, trial, engine.riffBar(config, trial, riff)).events, chord, { sam: true, cadence: null }, random);
    const hits = engine.harmonyPhrases(config, riff, { placement: random(), answer: random() }, trial % 2 === 0);
    const makePlans = () => hits.map(h => {
      const plan = { offset: h.offset, gate: h.gate, bed: !!h.bed, notes: harmony.notes.slice(), arp: null };
      if (h.tone !== undefined) { plan.arp = { tone: h.tone, mode: h.arpMode, chord: harmony.notes.slice() }; plan.notes = [plan.arp.chord[engine.arpIndex(h.tone, harmony.notes.length, h.arpMode)]]; }
      return plan;
    });
    const makeBass = () => engine.composeGrooveBass(config, harmony, engine.riffBar(config, trial, riff), [], trial, false, false, config.root + config.raga.notes[harmony.rootIndex]);
    const count = (plans, bass) => {
      let n = 0;
      for (const m of melody) {
        const tone = pcOf(m.note);
        for (const p of plans) if (Math.abs(p.offset - m.offset) <= unit && p.notes.some(v => pcOf(v) === tone)) n++;
        for (const b of bass) if (Math.abs(b.offset - m.offset) <= unit && b.offset !== 0 && !b.ghost && pcOf(b.note) === tone) n++;
      }
      for (const b of bass) for (const p of plans) if (!p.arp && Math.abs(p.offset - b.offset) <= unit && p.notes.some(v => pcOf(v) === pcOf(b.note))) n++;
      return n;
    };
    const chordAt = () => harmony.notes;
    let plans = makePlans(), bass = makeBass();
    before += count(plans, bass);
    const samBass = bass.find(b => b.offset === 0)?.note;
    engine.separateVoices(config, config, melody, plans, bass, chordAt, unit, random, 0);
    afterTight += count(plans, bass);
    plans.forEach((p, i) => {
      assert(p.gate > 0 && p.offset + p.gate <= duration + 1e-9, 'shifted hits stay inside the bar');
      assert(!plans[i + 1] || plans[i + 1].offset - p.offset >= unit * 3 - 1e-9, 'hits stay a dotted eighth apart');
      assert(p.arp ? p.notes.length === 1 : p.notes.length >= 3, 'chords keep 3+ notes, arps stay single');
      assert(p.notes.every(v => harmony.notes.includes(v)), 'only chord tones are played');
    });
    for (const b of bass) { const hz = config.tonic * Math.pow(2, b.note / 12); assert(hz >= 40 && hz <= 150 && b.gate > 0); }
    if (samBass !== undefined) assert.equal(bass.find(b => b.offset === 0)?.note, samBass, 'sam keeps the bass root');
    plans = makePlans(); bass = makeBass();
    const loose = JSON.stringify([plans, bass]);
    engine.separateVoices(config, config, melody, plans, bass, chordAt, unit, random, 1);
    if (JSON.stringify([plans, bass]) !== loose) changedAtFull++;
    plans = makePlans(); bass = makeBass(); engine.separateVoices(config, config, melody, plans, bass, chordAt, unit, random, .25);
    afterLoose += count(plans, bass);
  }
  assert.equal(changedAtFull, 0, 'share 1 allows every doubling to stand');
  assert(afterTight < before * .45, `doublings drop sharply (${before} -> ${afterTight})`);
  assert(afterLoose > afterTight && afterLoose < before, `a share of doublings is allowed to stand (${afterTight} < ${afterLoose} < ${before})`);
}
// Fast figures: chains of eighths, sixteenths and the odd thirty-second tacked onto held notes, in melody and bass.
{
  const count = { melody: { bars: 0, chained: 0, quarterHeads: 0, steps: { 1: 0, 2: 0, 4: 0 } }, bass: { bars: 0, chained: 0, steps: { 1: 0, 2: 0, 4: 0 } } };
  const onGrid = (v, u32) => Math.abs(v / u32 - Math.round(v / u32)) < 1e-6;
  function inspect(events, u32, duration, record, isBass, config) {
    events.forEach((e, i) => {
      assert(e.gate > 0 && e.offset >= 0 && e.offset + e.gate <= duration + 1e-6, 'chains stay inside the bar');
      assert(!i || e.offset > events[i - 1].offset, 'onsets strictly increase');
      if (e.chain) {
        assert(onGrid(e.offset, u32), 'chain notes sit on the thirty-second grid');
        assert(i > 0 && (events[i - 1].chain || events[i - 1].chainHead), 'a chain follows its head');
        const step = Math.round((e.offset - events[i - 1].offset) / u32);
        if (events[i - 1].chain) { assert([1, 2, 4].includes(step), 'chain steps are 32nds, 16ths or 8ths (got ' + step + ')'); record.steps[step]++; }
        else { assert(step >= 4, 'the head is at least an eighth'); if (!isBass && step === 8) record.quarterHeads++; }
        if (!isBass) assert(config.raga.notes.includes(e.note % 12), 'chain notes are in the scale');
      }
    });
    record.bars++; if (events.some(e => e.chain)) record.chained++;
  }
  for (let trial = 0; trial < 2500; trial++) {
    const config = engine.chooseSession(null), riff = engine.makeRiff(config, random);
    const duration = config.b * config.beat, u32 = config.quarterBeat / 8;
    const melody = engine.composeCycle(config, trial, engine.riffBar(config, trial, riff)).events;
    const base = melody.filter(e => !e.chain);
    assert(base.every(e => !e.chain) && melody.length >= base.length);
    inspect(melody, u32, duration, count.melody, false, config);
    if (config.rhythm.kind === 'poly') continue;
    const harmony = engine.chooseHarmony(config, null, null, random);
    const bass = engine.composeGrooveBass(config, harmony, engine.riffBar(config, trial, riff), [], trial, false, false, config.root + config.raga.notes[harmony.rootIndex]);
    bass.forEach(e => { if (e.chain) { const hz = config.tonic * Math.pow(2, e.note / 12); assert(hz >= 40 && hz <= 150, 'bass chain in range'); assert(config.raga.notes.includes(((e.note % 12) + 12) % 12) || harmony.notes.some(n => ((n - e.note) % 12 + 12) % 12 === 0)); } });
    inspect(bass.filter(e => e.offset < duration), u32, duration, count.bass, true, config);
  }
  for (const [name, c] of Object.entries(count)) {
    const total = c.steps[1] + c.steps[2] + c.steps[4];
    assert(c.chained > c.bars * .1 && c.chained < c.bars * .7, `${name}: some bars chain, not all (${c.chained}/${c.bars})`);
    assert(c.steps[2] > c.steps[1] && c.steps[1] > 0 && c.steps[1] < total * .3, `${name}: 16ths common, 32nds present but rare (${JSON.stringify(c.steps)})`);
    assert(c.steps[4] > 0, name + ' also chains eighths');
  }
  assert(count.melody.quarterHeads > 30, 'a quarter note is followed by a chain');
}
console.log(`PASS: ${bars} bars across 216 scale/meter combinations; exact A:B timing and bounded notes.`);
console.log(`PASS: ${groupings.size} generated 11-pulse groupings, ${riffs.size} distinct riffs, ${melodies.size} melodic rhythms; phrase memory and dotted/offbeat preferences.`);
