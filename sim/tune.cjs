#!/usr/bin/env node
'use strict';
// Play the AI against itself with one change to its weights, to see whether the change plays better.
//   node sim/tune.cjs --try risk=0.25 --try "chargeFail=20,chargeBar=5" [--pairs 100] [--workers 4] [--seed 1]
//                     [--lists a.json b.json ...] [--json out.json]
// Each pair of battles uses two lists drawn from the field (the strength lists and the Iron Wall unless --lists
// says otherwise) and one seed: in the first battle the changed AI commands side 0, in the second side 1, with the
// same mission, table and dice. The changed AI's score (a draw counts half) is 50% if the change makes no
// difference; the report gives it with two standard errors, and the VP margin per battle. The weights and their
// defaults are ai.cjs's DEFAULTS.
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

function playPair({ a, b, seed, variant }) {
  const { runBattle } = require('./lib/battle.cjs');
  const out = { score: 0, margin: 0, games: 0 };
  for (const side of [0, 1]) {
    const ai = side === 0 ? [variant, null] : [null, variant];
    const r = runBattle(a, b, { seed, ai });
    out.games++;
    out.score += r.winner === null ? 0.5 : r.winner === side ? 1 : 0;
    out.margin += r.vp[side] - r.vp[1 - side];
  }
  return out;
}

if (process.argv[2] === '--worker') {
  process.on('message', (job) => process.send({ id: job.id, result: playPair(job) }));
  return;
}

const argv = process.argv.slice(2);
let pairs = 100, workers = 4, seed = 1, json = null; const tries = [], lists = [];
for (let i = 0; i < argv.length; i++) {
  const x = argv[i];
  if (x === '--try') tries.push(argv[++i]);
  else if (x === '--pairs') pairs = +argv[++i];
  else if (x === '--workers') workers = +argv[++i];
  else if (x === '--seed') seed = +argv[++i];
  else if (x === '--json') json = argv[++i];
  else if (x === '--lists') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) lists.push(path.resolve(argv[++i])); }
}
if (!tries.length) { console.error('usage: node sim/tune.cjs --try key=value[,key=value] [--try ...] [--pairs N]'); process.exit(1); }
if (!lists.length) {
  const dir = path.join(__dirname, 'lists', 'strong');
  lists.push(...fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)), path.join(__dirname, 'lists', 'rangdan-iron-wall.json'));
}
const { DEFAULTS } = require('./lib/ai.cjs');
const parse = (t) => Object.fromEntries(t.split(',').map((kv) => {
  const [k, v] = kv.split('=');
  if (!(k in DEFAULTS)) { console.error(`unknown weight ${k}; the weights are ${Object.keys(DEFAULTS).join(', ')}`); process.exit(1); }
  return [k, +v];
}));
const variants = tries.map(parse);
// the same list pairings and seeds for every variant, so variants compare on equal terms
const { createDice } = require('./lib/dice.cjs');
const d = createDice(seed);
const draws = Array.from({ length: pairs }, (_, k) => {
  const i = Math.floor(d.rnd() * lists.length);
  let j = Math.floor(d.rnd() * (lists.length - 1)); if (j >= i) j++;
  return { a: lists[i], b: lists[j], seed: seed * 100000 + k };
});
const jobs = [];
variants.forEach((variant, v) => draws.forEach((x) => jobs.push({ id: jobs.length, v, variant, ...x })));
const res = variants.map(() => []);
let next = 0, done = 0;
const t0 = Date.now();
const ws = Array.from({ length: Math.min(workers, jobs.length) }, () => fork(__filename, ['--worker']));
const feed = (w) => { if (next < jobs.length) w.send(jobs[next++]); else w.kill(); };
for (const w of ws) {
  w.on('message', ({ id, result }) => {
    res[jobs[id].v].push(result); done++;
    if (done % 25 === 0) process.stderr.write(`${done}/${jobs.length} pairs (eta ${(((Date.now() - t0) / done) * (jobs.length - done) / 60000).toFixed(1)} min)\n`);
    feed(w);
  });
  feed(w);
}
process.on('exit', () => {
  const rows = variants.map((v, k) => {
    const r = res[k], n = r.length;
    const ps = r.map((x) => x.score / x.games), mean = ps.reduce((t, x) => t + x, 0) / Math.max(1, n);
    const se = Math.sqrt(ps.reduce((t, x) => t + (x - mean) ** 2, 0) / Math.max(1, n - 1) / Math.max(1, n));
    const margin = r.reduce((t, x) => t + x.margin, 0) / Math.max(1, r.reduce((t, x) => t + x.games, 0));
    return { change: tries[k], pairs: n, score: mean, se, margin };
  });
  for (const r of rows) console.log(`${r.change.padEnd(32)} ${(100 * r.score).toFixed(1).padStart(5)}% ± ${(200 * r.se).toFixed(1)}  VP margin ${r.margin >= 0 ? '+' : ''}${r.margin.toFixed(2)}  (${r.pairs} pairs)`);
  if (json) fs.writeFileSync(json, JSON.stringify({ seed, pairs, lists, rows }, null, 1));
});
