// Targeted spot-check for pickup-ui6 round-6 changes (Edward/QA).
// Verifies source SYMBOLS/BEHAVIOR without touching existing assertions.
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS', m); } else { fail++; console.log('  FAIL', m); } };

// --- Change 1: voice bubble SVG icon (buildVoiceBubble) ---
const svgBlock = html.match(/wx-voice-play[\s\S]*?<svg[\s\S]*?<\/svg>/);
ok(!!svgBlock, 'C1: buildVoiceBubble contains <svg> inside wx-voice-play');
ok(/viewBox="0 0 1024 1024"/.test(html), 'C1: SVG viewBox 0 0 1024 1024 present');
ok(/fill="#333333"/.test(html), 'C1: SVG fill #333333 present (whole-file)');
ok(/M636\.16512 957\.44l-70\.80448/.test(html), 'C1: outer arc subpath M636.16512 present');
ok(/M445\.08672 766\.35648l-72\.93952/.test(html), 'C1: inner speaker subpath M445.08672 present');
ok(/M253\.96736 591\.18592c-39\.5776/.test(html), 'C1: speaker dot subpath M253.96736 present');

// --- Change 2: canvas long-image export draws same icon (prepareMessage voice branch) ---
const path2d = html.match(/new Path2D\('([^']+)'\)/);
ok(!!path2d, 'C2: prepareMessage voice branch uses new Path2D(...)');
const pd = path2d ? path2d[1] : '';
// The 3 subpaths must appear in the SAME order as the SVG (consistency check)
const iA = pd.indexOf('M636.16512 957.44l-70.80448');
const iB = pd.indexOf('M445.08672 766.35648l-72.93952');
const iC = pd.indexOf('M253.96736 591.18592c-39.5776');
ok(iA >= 0 && iB > iA && iC > iB, 'C2: canvas Path2D contains the 3 subpaths in SVG order (arc→speaker→dot)');
ok(/translate\(px - 10, py - 10\)/.test(html), 'C2: ctx.translate(px-10, py-10) present');
ok(/scale\(20 \/ 1024, 20 \/ 1024\)/.test(html), 'C2: ctx.scale(20/1024, 20/1024) present');
ok(/fillStyle = '#333333'/.test(html), 'C2: ctx.fillStyle = #333333 present');
ok(/ctx\.fill\(voiceIcon\)/.test(html), 'C2: ctx.fill(voiceIcon) present');
ok(!/wx-old-speaker/.test(html) && !/旧喇叭/.test(html), 'C2: old speaker+waveform drawing removed (no legacy marker)');

// --- Change 3: voice duration modal button spacing = 20px, isolated to this modal ---
const rowMatch = html.match(/openVoiceDurationPrompt[\s\S]*?modal-row modal-actions[^)]*\)/);
ok(/openVoiceDurationPrompt[\s\S]*?margin-top:20px/.test(html), 'C3: openVoiceDurationPrompt button row has margin-top:20px');
// ui7 requirement: editVoiceTranscript (语音转文字) save button also moved down 20px.
// So exactly 2 modal-actions rows carry margin-top:20px: 1903 voice-duration + 1966 editVoiceTranscript.
const allActions = [...html.matchAll(/modal-row modal-actions[^)]*\)/g)].map(m => m[0]);
const with20 = allActions.filter(s => /margin-top:20px/.test(s)).length;
ok(with20 === 2, `C3: exactly 2 modal-actions rows use margin-top:20px (voice-duration 1903 + editVoiceTranscript 1966), found ${with20}`);
// Negative: editTimestamp (编辑时间戳) must NOT carry the 20px spacing (user never required it)
const tsMatch = html.match(/function editTimestamp[\s\S]*?modal-row modal-actions[^)]*\)/);
ok(tsMatch && !/margin-top:20px/.test(tsMatch[0]), 'C3: editTimestamp (编辑时间戳) button row does NOT use margin-top:20px');

console.log(`\n===== Round-6 spot-check: ${pass} pass / ${fail} fail =====`);
process.exit(fail ? 1 : 0);
