// Run with: node tests/visualizer-smoke.cjs
// Executes the real corner visualizer against a recording 2D context and checks all three rings paint.
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
let chords = sandbox.answerChords(sandbox.harmonyPhrases(config, riff, { placement: .3, answer: .6 }, false), events, duration, unit);
chords = sandbox.addStabs(chords, events, duration, unit, () => 0, 1);
sandbox.window.raagViz.bars.push({ start: 0, duration, config, events, chords, triad: [0], drums: [] });
sandbox.window.raagViz.setPlaying(true);
sandbox.window.raagViz.setTime(chords[0].offset + .01);
sandbox.window.raagViz.setPlaying(true);
const colors = new Set(fills);
for (const [name, color] of [['melody', '#70c8d8'], ['beats', '#e6ad67'], ['harmony', '#b494e6']]) {
  if (!colors.has(color)) throw new Error(name + ' ring did not paint');
}
if (!strokes.includes('#b494e6')) throw new Error('pad chord arc did not paint');
console.log('VISUALIZER OK: melody, harmony and beat rings painted;', fills.filter(c => c === '#b494e6').length, 'harmony dots');
