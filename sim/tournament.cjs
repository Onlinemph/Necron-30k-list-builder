#!/usr/bin/env node
'use strict';
// Round robin: every list plays every other list, N battles per pairing, on random Core Missions.
//   node sim/tournament.cjs <list> <list> ... [--battles 24] [--seed 1] [--workers 4] [--out results.json]
//                            [--only "<list name>"] [--merge earlier.json]
// --only plays just the pairings with that list; --merge starts from an earlier result and replaces those pairings.
// Pairings run in parallel worker processes. The output JSON has, for each pairing, wins, draws and VP; for each
// list, results by Archetype and per-unit points destroyed and lost.
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

const ARCH = { 'crucial-supplies': 'Resupply', 'hidden-caches': 'Resupply', 'unknown-munitions': 'Resupply', 'no-quarter': 'Annihilation', 'cut-off-the-head': 'Annihilation', 'thin-the-ranks': 'Annihilation', 'high-ground': 'Conquest', 'shattered-earth': 'Conquest', 'secure-the-highway': 'Conquest' };

// ---------- worker: plays one pairing ----------
function playPairing({ a, b, battles, seed }) {
  const { runBattle } = require('./lib/battle.cjs');
  const out = { wins: [0, 0], draws: 0, vp: [0, 0], firstWins: 0, decided: 0, byArch: {}, units: [{}, {}], ms: 0 };
  const t0 = Date.now();
  for (let k = 0; k < battles; k++) {
    // alternate which list sits on side 0 (and so the roll-offs) every other battle
    const swap = k % 2 === 1;
    const r = runBattle(swap ? b : a, swap ? a : b, { seed: seed + k });
    const flip = (x) => (swap ? [x[1], x[0]] : x);
    const winner = r.winner === null ? null : swap ? 1 - r.winner : r.winner;
    const first = swap ? 1 - r.first : r.first;
    if (winner === null) out.draws++; else { out.wins[winner]++; out.decided++; if (winner === first) out.firstWins++; }
    const vp = flip(r.vp); out.vp[0] += vp[0]; out.vp[1] += vp[1];
    const arch = ARCH[r.mission];
    const ba = out.byArch[arch] = out.byArch[arch] || { battles: 0, wins: [0, 0] };
    ba.battles++; if (winner !== null) ba.wins[winner]++;
    const units = flip(r.units);
    for (const s of [0, 1]) for (const u of units[s]) {
      const cur = out.units[s][u.name] = out.units[s][u.name] || { pts: u.pts, n: 0, killed: 0, lost: 0, survived: 0 };
      if (u.joined) cur.joined = u.joined; // a character that joined a unit: its kills count with that unit
      cur.n++; cur.killed += u.pointsKilled; cur.lost += u.pointsLost; cur.survived += u.survived ? 1 : 0;
    }
  }
  out.ms = Date.now() - t0;
  return out;
}
if (process.argv[2] === '--worker') {
  process.on('message', (job) => process.send({ id: job.id, result: playPairing(job) }));
  return;
}

// ---------- main: hands pairings to workers and collects the results ----------
function parse(argv) {
  const o = { battles: 24, seed: 1, workers: 4, out: 'tournament.json', lists: [], only: null, merge: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--battles') o.battles = +argv[++i];
    else if (x === '--seed') o.seed = +argv[++i];
    else if (x === '--workers') o.workers = +argv[++i];
    else if (x === '--out') o.out = argv[++i];
    else if (x === '--only') o.only = argv[++i];
    else if (x === '--merge') o.merge = argv[++i];
    else o.lists.push(path.resolve(x));
  }
  return o;
}
function main() {
  const o = parse(process.argv.slice(2));
  const names = o.lists.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')).name || path.basename(f, '.json'));
  const jobs = [];
  let k = 0;
  for (let i = 0; i < o.lists.length; i++) for (let j = i + 1; j < o.lists.length; j++, k++) {
    if (o.only && names[i] !== o.only && names[j] !== o.only) continue;
    jobs.push({ id: jobs.length, i, j, a: o.lists[i], b: o.lists[j], battles: o.battles, seed: o.seed + 1000 * k });
  }
  const results = [];
  if (o.merge) {
    const old = JSON.parse(fs.readFileSync(o.merge, 'utf8'));
    for (const p of old.pairings) if (!jobs.some((jb) => jb.i === p.i && jb.j === p.j)) results.push(p);
  }
  let next = 0, done = 0;
  const t0 = Date.now();
  const save = () => fs.writeFileSync(o.out, JSON.stringify({ names, lists: o.lists, battles: o.battles, pairings: results }, null, 1));
  const workers = Array.from({ length: Math.min(o.workers, jobs.length) }, () => fork(__filename, ['--worker']));
  const feed = (w) => { if (next < jobs.length) w.send(jobs[next++]); else w.kill(); };
  for (const w of workers) {
    w.on('message', ({ id, result }) => {
      const job = jobs[id];
      results.push(Object.assign({ i: job.i, j: job.j }, result));
      done++;
      const eta = ((Date.now() - t0) / done) * (jobs.length - done) / 60000;
      process.stderr.write(`${done}/${jobs.length} ${names[job.i]} ${result.wins[0]}-${result.wins[1]}${result.draws ? `-${result.draws}` : ''} ${names[job.j]}  (eta ${eta.toFixed(1)} min)\n`);
      if (done % 10 === 0) save();
      feed(w);
    });
    feed(w);
  }
  process.on('exit', () => save());
}
main();
