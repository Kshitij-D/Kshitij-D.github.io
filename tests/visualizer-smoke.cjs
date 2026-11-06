// Run with: node tests/visualizer-smoke.cjs
// Executes the real corner visualizer against a recording 2D context and checks all four rings paint.
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(m => !m[1].includes('ld+json') && m[2].includes('function chooseSession'))[2];
const composer = script.slice(script.indexOf('  function phraseRandom('), script.indexOf('  // Inner ring:'));
const start = script.indexOf('  // Inner ring:'), viz = script.slice(start, script.indexOf('\n  (function () {', start + 40) > 0 ? script.indexOf('\n  (function () {', script.indexOf('(function () {', start) + 20) : undefined);
let clock = 0;
const fills = [], strokes = [], arcs = [];
const ctx = new Proxy({}, {
  get: (t, k) => k === 'clearRect' || k === 'save' || k === 'restore' || k === 'scale' || k === 'beginPath' || k === 'stroke' || k === 'fill' || k === 'fillText' || k === 'moveTo' || k === 'lineTo'
    ? () => { if (k === 'fill') fills.push(t.fillStyle); if (k === 'stroke') strokes.push(t.strokeStyle); }
    : k === 'arc' ? (...a) => arcs.push(a) : k === 'measureText' ? text => ({ width: String(text).length * 4 }) : t[k],
  set: (t, k, v) => { t[k] = v; return true; }
});
const element = () => new Proxy(function () {}, {
  get: (t, k) => k === 'getContext' ? () => ctx : k === 'width' ? 176 : k === 'style' ? { setProperty() {} } : k === 'textContent' ? '' : k === 'classList' ? { add() {}, remove() {} } : k === 'appendChild' || k === 'addEventListener' ? () => {} : k === 'hidden' ? false : element(),
  set: () => true, apply: () => element()
});
const sandbox = {
  Math, console, Array, Object, Set, Map, JSON, Date, Uint32Array, Float32Array, Uint8Array,
  performance: { now: () => (clock += 100) }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  getComputedStyle: () => ({ getPropertyValue: () => '#222' }),
  document: { getElementById: () => element(), createElement: () => element(), documentElement: element() },
  matchMedia: () => ({ matches: false, addEventListener() {} }), setTimeout: () => 0, clearTimeout() {}, devicePixelRatio: 1
};
sandbox.window = sandbox; vm.createContext(sandbox);
vm.runInContext(composer + '\n' + viz, sandbox);
const config = sandbox.raagSession, riff = sandbox.makeRiff(config, Math.random);
const duration = config.b * config.beat, unit = config.quarterBeat / 4;
const events = sandbox.composeCycle(config, 3).events;
config.character = Object.assign({}, config.character, { gestures: { hold: 1, pump: 0, arp: 0, swell: 0, chop: 0, push: 0 } });   // sustained pad chords, so their arcs paint
let chords = sandbox.answerChords(sandbox.harmonyPhrases(config, riff, { placement: .3, answer: .6 }, false), events, duration, unit);
chords = sandbox.addStabs(chords, events, duration, unit, () => 0, 1);
const bass = [{ offset: 0, gate: duration / 4, note: 0, strength: .8 }, { offset: duration / 2, gate: duration / 4, note: -5, strength: .7 }];
const drums = [
  { voice: 'kick', offset: 0, strength: 1 }, { voice: 'tom', offset: duration * .1, strength: .6 }, { voice: 'snare', offset: duration * .25, strength: .9 },
  { voice: 'hat', offset: duration * .4, strength: .5 }, { voice: 'hat', offset: duration * .5, strength: .8, open: true }, { voice: 'ride', offset: duration * .6, strength: .4 }
];
fills.length = strokes.length = arcs.length = 0;      // forget the idle frame drawn at load: only the playing bar counts below
sandbox.window.raagViz.bars.push({ start: 0, duration, config, events, chords, triad: [0], drums, bass });
sandbox.window.raagViz.setPlaying(true);
sandbox.window.raagViz.setTime(chords[0].offset + .01);
sandbox.window.raagViz.setPlaying(true);
const colors = new Set(fills);
for (const [name, color] of [['melody', '#70c8d8'], ['harmony', '#b494e6'], ['bass', '#e07a8f']]) {
  if (!colors.has(color)) throw new Error(name + ' ring did not paint');
}
// Every drum has its own mark: kick = filled amber dot, snare = filled diamond in the text colour, tom = orange ring, hat = grey tick,
// open hat = grey ring on the outer lane, ride = gold cross; the beat grid is a row of small grey dots.
for (const [name, list, color] of [['kick', fills, '#e6ad67'], ['snare', fills, '#f2f0ea'], ['beat grid', fills, '#9aa5ad'], ['tom', strokes, '#e8895a'], ['hat', strokes, '#8d9aa5'], ['ride', strokes, '#d4a72c']])
  if (!list.includes(color)) throw new Error(name + ' mark did not paint');
if (!arcs.some(a => Math.abs(Math.hypot(a[0] - 130, a[1] - 130) - 108) < 1e-6)) throw new Error('the open hat ring did not paint on the outer lane');
if (!arcs.some(a => Math.abs(Math.hypot(a[0] - 130, a[1] - 130) - 76) < 1e-6)) throw new Error('the kick did not paint on the inner drum lane');
const bassDots = arcs.filter(a => Math.abs(Math.hypot(a[0] - 130, a[1] - 130) - 28) < 1e-6);
if (bassDots.length < bass.length) throw new Error('expected a bass dot per bass note on the inner ring, saw ' + bassDots.length);
for (const a of arcs) if (Math.hypot(a[0] - 130, a[1] - 130) + a[2] > 130) throw new Error('a dot leaves the canvas: ' + a.join());
console.log('VISUALIZER OK: bass, melody, harmony and beat rings painted;', fills.filter(c => c === '#b494e6').length, 'harmony dots');
