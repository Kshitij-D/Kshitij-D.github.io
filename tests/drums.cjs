// Run with: node tests/drums.cjs
// The drum kits and the two polymetric/hip-hop styles: what each voice is made of, and what each pattern guarantees.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const seeded = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

// ---------- Patterns ----------
const composer = html.slice(html.indexOf('  function phraseRandom('), html.indexOf('  // Inner ring:'));
const ctx = { Math: Object.create(Math) };
const rnd = seeded(7);
ctx.Math.random = rnd;
vm.createContext(ctx);
vm.runInContext(composer, ctx);
const random = seeded(99);
const meters = [];
while (meters.length < 150) { const c = ctx.chooseSession(null); if (c.rhythm.kind !== 'poly') meters.push(c); }

for (const style of ['boombap', 'djent']) assert(ctx.drumStyles.includes(style), style + ' is a drum style');
for (const config of meters) {
  const riff = ctx.makeRiff(config, random), beat = config.beat, beats = config.b;
  for (const style of ctx.drumStyles) {
    const hits = ctx.composeDrums(config, 3, random, riff, false, style);
    assert(hits.every(h => ['kick', 'snare', 'tom', 'hat', 'ride'].includes(h.voice)), 'only known voices');
    assert(hits.every(h => !h.open || h.voice === 'hat'), 'only hats are marked open');
  }
  // The hat clock accents the first beat of every group, so the grouping can be heard.
  const groove = ctx.composeDrums(config, 3, random, riff, false, 'groove');
  const hatAt = pos => groove.find(h => h.voice === 'hat' && Math.abs(h.offset - pos * beat) < 1e-9);
  const starts = [];
  config.rhythm.groups.reduce((at, length) => { starts.push(at); return at + length; }, 0);
  const inside = [...Array(beats).keys()].filter(i => !starts.includes(i)).map(hatAt).filter(Boolean);
  starts.map(hatAt).filter(Boolean).forEach(first => inside.forEach(h => assert(first.strength > h.strength, 'a group start is louder than the beats inside the group')));

  // Djent: the backbone runs across bar lines, kicks keep sam and may burst, nothing else is played.
  for (let cycle = 0; cycle < 6; cycle++) {
    const hits = ctx.composeDrums(config, cycle, random, riff, false, 'djent');
    assert(hits.some(h => h.voice === 'kick' && h.offset === 0), 'djent keeps the kick on sam');
    assert(hits.every(h => ['kick', 'hat', 'snare'].includes(h.voice)), 'djent is kick, hat and snare');
    for (let i = 0; i < beats; i++) {
      const phase = (cycle * beats + i) % 4, pos = i * beat;
      const snare = hits.filter(h => h.voice === 'snare' && Math.abs(h.offset - pos) < 1e-9);
      const clock = hits.find(h => h.voice === 'hat' && Math.abs(h.offset - pos) < 1e-9);
      assert(clock, 'a hat on every beat');
      assert.equal(!!clock.open, phase === 0, 'the backbone downbeat is the open hat');
      assert.equal(snare.length, phase === 2 ? 1 : 0, 'the snare sits on beat three of the running four-count');
    }
    assert(hits.filter(h => h.voice === 'snare').length === hits.filter(h => h.voice === 'snare' && Math.abs(h.offset / beat - Math.round(h.offset / beat)) < 1e-9).length, 'no ghost snares');
  }

  // Boom-bap: swung offbeat hats (quarter-note meters), no toms, the bar closes on a hat.
  if (config.rhythm.denominator === 4) {
    const hits = ctx.composeDrums(config, 3, random, riff, false, 'boombap');
    assert(!hits.some(h => h.voice === 'tom'));
    for (let i = 0; i < beats; i++) {
      assert(!hits.some(h => h.voice === 'hat' && Math.abs(h.offset - (i + .5) * beat) < 1e-9), 'offbeat hats are late, not straight');
      assert(hits.some(h => h.voice === 'hat' && h.offset > (i + .5) * beat && h.offset < (i + .75) * beat) || i === beats - 1, 'a swung hat follows each beat');
    }
    assert(hits.some(h => h.voice === 'kick' && h.offset === 0), 'boom-bap keeps the kick on sam');
  }
}
console.log('PATTERNS OK:', meters.length, 'meters x', ctx.drumStyles.length, 'styles');

// ---------- Kits ----------
const start = html.indexOf('    // Drum kits, tuned to the drone'), end = html.indexOf("    // The lead's call and reply voices");
assert(start > 0 && end > start, 'kit code found');
const nodes = [];
function param() { const events = []; return { value: 0, events, setValueAtTime(v, t) { events.push([v, t]); }, exponentialRampToValueAtTime(v, t) { events.push([v, t]); }, linearRampToValueAtTime(v, t) { events.push([v, t]); } }; }
function make(kind) {
  const n = { kind, targets: [], disconnected: false, type: '', frequency: param(), gain: param(), Q: param(), detune: param() };
  n.connect = t => { n.targets.push(t); return t; };
  n.disconnect = () => { n.disconnected = true; };
  n.start = (when, offset) => { n.startAt = when; };
  n.stop = when => { n.stopAt = when; };
  nodes.push(n); return n;
}
const bus = { kind: 'bus' }, send = { kind: 'send' };
const kitCtx = {
  Math, drumBus: bus, drumSend: send, drumNoise: { noise: true },
  ac: { createGain: () => make('gain'), createOscillator: () => make('osc'), createBiquadFilter: () => make('filter'), createBufferSource: () => make('noise') }
};
vm.createContext(kitCtx);
vm.runInContext(html.slice(start, end) + '\nthis.kits = kits; this.drum = drum;', kitCtx);
const { kits, drum } = kitCtx;
assert.deepEqual(Object.keys(kits).sort(), ['bonham', 'boombap', 'electro']);

function play(kit, voice, strength = .9, open) {
  nodes.length = 0;
  drum(voice, 1, strength, 150, kit, open);
  const made = nodes.slice();
  made.forEach(n => n.onended && n.onended());          // every voice must free its nodes when it ends
  return made;
}
const sweep = osc => osc.frequency.events[0][0] / osc.frequency.events[osc.frequency.events.length - 1][0];
const decayOf = nodes => Math.max(...nodes.filter(n => n.stopAt).map(n => n.stopAt - 1));
for (const kit of Object.keys(kits)) {
  for (const voice of ['kick', 'snare', 'tom', 'hat', 'ride']) {
    const made = play(kit, voice);
    assert(made.length > 0, kit + ' ' + voice + ' makes sound');
    made.forEach(n => assert(n.disconnected, kit + ' ' + voice + ' frees its ' + n.kind));
    made.filter(n => n.kind === 'gain' || n.kind === 'filter').forEach(() => {});
  }
  const kick = play(kit, 'kick'), snare = play(kit, 'snare'), hat = play(kit, 'hat'), tom = play(kit, 'tom');
  // A kick is a pitch sweep with a click; a hat is noise only; a snare is a tuned body plus noise; they are not one recipe.
  assert(kick.filter(n => n.kind === 'osc').every(o => sweep(o) > 1.5), kit + ' kick sweeps down');
  assert(kick.some(n => n.kind === 'noise'), kit + ' kick has a click');
  assert(hat.every(n => n.kind !== 'osc') && hat.filter(n => n.kind === 'noise').length === 2, kit + ' hat is noise only');
  assert(snare.some(n => n.kind === 'osc') && snare.filter(n => n.kind === 'noise').length >= 2, kit + ' snare is body plus noise');
  assert(tom.every(n => n.kind !== 'osc' || n.frequency.events[n.frequency.events.length - 1][0] > 150 * .8 - 1), kit + ' tom is tuned above the kick');
  const kickLow = Math.min(...kick.filter(n => n.kind === 'osc').map(o => o.frequency.events[o.frequency.events.length - 1][0]));
  const tomLow = Math.min(...tom.filter(n => n.kind === 'osc').map(o => o.frequency.events[o.frequency.events.length - 1][0]));
  assert(tomLow > kickLow * 1.4, kit + ' tom sits clearly above the kick');
  // Open hats ring, closed hats tick.
  assert(decayOf(play(kit, 'hat', .9, true)) > decayOf(play(kit, 'hat', .9, false)) * 2, kit + ' open hat rings longer');
}
// The kits are different from one another: room size, kick length, clap.
const roomOf = (kit, voice) => { const made = play(kit, voice); const s = made.find(n => n.targets.includes(send)); return s ? s.gain.value : 0; };
assert(roomOf('bonham', 'snare') > roomOf('boombap', 'snare') && roomOf('boombap', 'snare') > roomOf('electro', 'snare'), 'room: bonham > boom-bap > electro');
assert(decayOf(play('bonham', 'kick')) > decayOf(play('boombap', 'kick')) && decayOf(play('boombap', 'kick')) > decayOf(play('electro', 'kick')), 'kick length: bonham > boom-bap > electro');
assert(play('electro', 'snare').filter(n => n.kind === 'noise').length > play('boombap', 'snare').filter(n => n.kind === 'noise').length, 'electro snare is a clap');
assert(Math.max(...play('electro', 'kick').filter(n => n.kind === 'osc').map(sweep)) > Math.max(...play('bonham', 'kick').filter(n => n.kind === 'osc').map(sweep)), 'electro kick sweeps further and faster');
console.log('KITS OK: each voice is its own recipe, frees its nodes, and the three kits differ.');
