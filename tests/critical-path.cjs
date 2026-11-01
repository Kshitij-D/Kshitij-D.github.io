// Run with: node tests/critical-path.cjs
// The profile must reach the screen without waiting for any of the music, visualizer or backdrop.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body>'));

// 1. The profile text is plain HTML, not injected by a script.
const staticBody = body.replace(/<script[\s\S]*?<\/script>/g, '');
for (const text of ['Kshitij Dubey', 'University of Utah']) assert(staticBody.includes(text), text + ' is in the static HTML');
assert(/<img class="photo" src="images\/profile.jpg"[^>]*width="600" height="600"/.test(body), 'profile photo reserves its size');

// Each listed paper links to its arXiv page (identifiers checked against arxiv.org when they were added).
const papers = { 'Equivalence Checking of ML GPU Kernels': '2511.12638', 'RE-IMAGINE: Symbolic Benchmark Synthesis for Reasoning Evaluation': '2506.15455', 'DeDuCE: Deductive Consistency for Windowed, Step-wise Reasoning': '2504.07080' };
for (const [title, id] of Object.entries(papers)) {
  const block = staticBody.slice(staticBody.indexOf(title), staticBody.indexOf('</div>\n    </div>', staticBody.indexOf(title)));
  assert(block.includes('href="https://arxiv.org/abs/' + id + '"'), title + ' links to arXiv ' + id);
}

// 2. Nothing in the head blocks rendering: no external stylesheet without the non-blocking trick, no sync external script.
// (The <noscript> fallback only applies when JavaScript is off.)
for (const link of head.replace(/<noscript>[\s\S]*?<\/noscript>/g, '').match(/<link[^>]*>/g) || []) {
  if (/rel="stylesheet"/.test(link) && /href="https?:/.test(link)) assert(false, 'render-blocking stylesheet: ' + link);
}
assert(/rel="preload" as="style"[^>]*onload=/.test(head), 'web fonts load without blocking');
assert(!/<script[^>]*\ssrc=/.test(head), 'no external script in the head');
for (const tag of html.match(/<script[^>]*\ssrc=[^>]*>/g) || []) assert(/\b(async|defer)\b/.test(tag), 'external script must be async or defer: ' + tag);

// 3. The big artwork is not requested by the initial HTML or CSS.
const initial = head + staticBody;
assert(!/<img[^>]*\ssrc="images\/mandala/.test(initial), 'centre art is not fetched at parse time');
assert(/<img id="gaze-current" data-src="images\/mandala-center.svg"/.test(initial), 'centre art waits in data-src');
const cssBase = head.slice(head.indexOf('<style>'), head.indexOf('</style>'));
assert(/body\.art-ready::before\s*\{\s*background-image:\s*url\("images\/mandala-tapestry.svg"\)/.test(cssBase), 'tapestry is applied only after load');
assert(!/body::before\s*\{[^}]*mandala-tapestry/.test(cssBase), 'base style does not request the tapestry');

// 4. The experience starts after first paint, and the WebGL scene later still.
const script = html.slice(html.lastIndexOf('<script>'));
const at = text => { const i = script.indexOf(text); assert(i >= 0, 'missing: ' + text); return i; };
assert(at('function boot()') < at('var raagSession = chooseSession(null)'), 'session creation happens inside boot');
assert(at('function startScene()') < at("getContext('webgl'"), 'WebGL context is created inside startScene');
assert(at('requestAnimationFrame(function () { setTimeout(bootOnce, 0); })') > at('function boot()'), 'boot is scheduled after a frame');
assert(at('setTimeout(bootOnce, 1000)') > 0, 'hidden tabs still boot');
assert(at('function later()') > at('function startScene()') && at('revealArt(); startScene();') > 0, 'scene starts from the idle task');
assert(/if \(window\.requestIdleCallback\) requestIdleCallback\(task/.test(script), 'idle scheduling is used');
// The only work before boot is the tiny expand/collapse control and the visit counter.
const beforeBoot = script.slice(0, at('function boot()'));
assert(!/AudioContext|getContext|chooseSession|new Image|createShader/.test(beforeBoot), 'no heavy work before boot');
// The visualizer keeps its full-size panel on tablets, laptops and big screens; only phones and very short windows get the bar.
const css = head.slice(head.indexOf('<style>'), head.indexOf('</style>'));
assert(/@media \(max-width: 699px\), \(max-height: 420px\) \{\s*\.raag-visualizer \{/.test(css), 'compact bar is for phones and very short windows only');
assert(!/@media \(max-width: 1100px\), \(max-height: 650px\)/.test(css), 'laptops and tablets no longer fall into the compact bar');
assert(/@media \(min-width: 700px\) and \(max-width: 1307px\) and \(min-height: 421px\) \{\s*main \{[^}]*margin: 3rem 1rem 380px 244px/.test(css), 'the page card makes room for the full panel on tablets and small laptops');
assert(/\.raag-visualizer \{[^}]*width: clamp\(216px, min\(13\.5vw, 30vh\), 300px\)/.test(css), 'the panel grows a little on big screens');
// 244px = panel (up to 216px) + its 16px margin + a gutter; a centred 820px card clears that from 1308px up.
assert((1308 - 820) / 2 >= 244, 'centred card clears the panel at the breakpoint');
console.log('CRITICAL PATH OK: profile is static HTML, nothing blocks first paint, artwork and scene start late.');
