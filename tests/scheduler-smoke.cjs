// Run with: node tests/scheduler-smoke.cjs   (executes the real scheduler against stub DOM/audio for ~400 steps)
// Run the real page script against stub DOM/audio, stepping the scheduler through many bars.
// Also run it once per drum kit and style, pinned the way index.html#kit=...&style=... pins them.
if (!process.env.DRUM_HASH && !process.argv[2]) {
  for (const hash of ['#kit=boombap&style=boombap', '#kit=bonham&style=half-time', '#kit=electro&style=djent', '#kit=bonham&style=djent', '#kit=electro&style=ride'])
    require('child_process').execFileSync(process.execPath, [__filename], { env: { ...process.env, DRUM_HASH: hash }, stdio: 'inherit' });
}
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m => !m[1].includes('ld+json') && !m[1].includes('src=')).map(m => m[2]);
const music = scripts.find(s => s.includes('function chooseSession'));
const clickers = [], intervals = [];
function stub(name) {
  const f = function () {};
  return new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'addEventListener') return (ev, fn) => { if (ev === 'click') clickers.push(fn); };
      if (k === 'getChannelData') return () => new Float32Array(4096);
      if (k === 'getByteTimeDomainData') return a => a.fill(128);
      if (k === 'style') return new Proxy({}, { get: (t, k2) => k2 === 'setProperty' ? () => {} : '', set: () => true });
      if (k === 'length') return 0;
      if (k === 'then') return undefined;
      if (k in t) return t[k];
      return stub(name + '.' + String(k));
    },
    set() { return true; }, apply() { return stub(name + '()'); }, construct() { return stub('new ' + name); }
  });
}
let now = 0;
class Ctx { constructor() { return new Proxy(this, { get: (t, k) => k === 'currentTime' ? now : k === 'sampleRate' ? 8000 : k === 'state' ? 'running' : k in t ? t[k] : stub('ac.' + String(k)), set: () => true }); } }
const errors = [];
const sandbox = {
  window: stub('window'), document: stub('document'), console, Math, Date, Uint8Array, Float32Array, Uint32Array, Array, Object, Set, Map, JSON, Promise,
  performance: { now: () => now * 1000 }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  setInterval: (fn) => { intervals.push(fn); return intervals.length; }, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  getComputedStyle: () => ({ getPropertyValue: () => '' }), navigator: {}, localStorage: {}, location: { hash: process.env.DRUM_HASH || '' }, fetch: () => Promise.reject(new Error('x')),
  AudioContext: Ctx, webkitAudioContext: Ctx, matchMedia: () => ({ matches: false, addEventListener() {} }), Image: function () {}, devicePixelRatio: 1,
};
sandbox.window = new Proxy(sandbox, { get: (t, k) => k === 'AudioContext' ? Ctx : k === 'crypto' ? undefined : k in t ? t[k] : stub('window.' + String(k)), set: (t, k, v) => { t[k] = v; return true; } });
sandbox.window.crypto = undefined;
vm.createContext(sandbox);
// Only the music IIFE needs to run; pull it from the "Instrument call-and-response" marker.
const start = music.indexOf('  // Instrument call-and-response');
const prelude = music.slice(music.indexOf('  function phraseRandom('), music.indexOf('  // Inner ring:'));
const end = music.lastIndexOf('  })();') + '  })();'.length;  // the music block; boot()'s closing lines come after it
vm.runInContext(prelude + '\n' + music.slice(start, end), sandbox);
const toggle = clickers.at(-1);
if (!toggle) throw new Error('no click handler');
toggle();
for (let step = 0; step < 400; step++) { now += 1.5; intervals.forEach(fn => fn()); }
console.log('SMOKE OK: scheduled', 'through t=' + now.toFixed(0) + 's', process.env.DRUM_HASH ? '(' + process.env.DRUM_HASH + ')' : '');
