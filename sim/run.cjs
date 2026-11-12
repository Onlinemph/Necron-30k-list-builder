#!/usr/bin/env node
'use strict';
// Play two army lists against each other.
//   node sim/run.cjs <list A> <list B> [--battles 200] [--seed 1] [--mission standard] [--log] [--out result.json]
// A list is a saved list from the builder (JSON file), or a share link from it. Each battle gets a fresh table;
// the two armies swap deployment zones and who goes first every other battle, so neither gets the better start.
const fs = require('fs');
const { runBattle } = require('./lib/battle.cjs');
const { readList } = require('./lib/army.cjs');

function parse(argv) {
  const opts = { battles: 200, seed: 1, mission: 'standard', log: false, out: null, lists: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--battles') opts.battles = +argv[++i];
    else if (a === '--seed') opts.seed = +argv[++i];
    else if (a === '--mission') opts.mission = argv[++i];
    else if (a === '--log') opts.log = true;
    else if (a === '--out') opts.out = argv[++i];
    else opts.lists.push(a);
  }
  if (opts.lists.length !== 2) throw new Error('usage: node sim/run.cjs <list A> <list B> [--battles N] [--seed S] [--log] [--out file]');
  return opts;
}

function summarise(results, names) {
  const n = results.length;
  const wins = [0, 0], vp = [0, 0], ptsKilled = [0, 0], byUnit = [new Map(), new Map()], reacts = [{}, {}];
  let draws = 0, firstWins = 0;
  for (const r of results) {
    if (r.winner === null) draws++; else wins[r.winner]++;
    if (r.winner !== null && r.winner === r.first) firstWins++;
    for (const s of [0, 1]) for (const [k, v] of Object.entries(r.reactions?.[s] || {})) reacts[s][k] = (reacts[s][k] || 0) + v;
    for (const s of [0, 1]) {
      vp[s] += r.vp[s]; ptsKilled[s] += r.pointsKilled[s];
      for (const u of r.units[s]) {
        const cur = byUnit[s].get(u.name) || { name: u.name, pts: u.pts, n: 0, killed: 0, lost: 0, survived: 0 };
        cur.n++; cur.killed += u.pointsKilled; cur.lost += u.pointsLost; cur.survived += u.survived ? 1 : 0;
        byUnit[s].set(u.name, cur);
      }
    }
  }
  return {
    battles: n, names, wins, draws, winRate: wins.map((w) => w / n), firstTurnWinRate: firstWins / Math.max(1, n - draws),
    reactionsPerBattle: reacts.map((m) => Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / n).toFixed(2)]))), avgVP: vp.map((v) => v / n), avgPointsKilled: ptsKilled.map((p) => p / n),
    units: byUnit.map((m) => [...m.values()].map((u) => ({ name: u.name, pts: u.pts, avgPointsKilled: u.killed / u.n, avgPointsLost: u.lost / u.n, survived: u.survived / u.n }))
      .sort((a, b) => b.avgPointsKilled - a.avgPointsKilled)),
  };
}

function main() {
  const opts = parse(process.argv.slice(2));
  const lists = opts.lists.map(readList);
  const names = lists.map((l, i) => l.name || `${l.faction} (${i ? 'B' : 'A'})`);
  const results = [];
  for (let b = 0; b < opts.battles; b++) {
    // alternate who deploys at the bottom edge and who takes the first turn
    const swap = b % 2 === 1;
    const r = runBattle(swap ? lists[1] : lists[0], swap ? lists[0] : lists[1], { seed: opts.seed + b, mission: opts.mission, log: opts.log && b === 0 });
    const flip = (x) => (swap ? [x[1], x[0]] : x);
    results.push({ winner: r.winner === null ? null : swap ? 1 - r.winner : r.winner, first: swap ? 1 - r.first : r.first, vp: flip(r.vp), pointsKilled: flip(r.pointsKilled), units: flip(r.units), reactions: flip(r.reactions) });
    if (opts.log && b === 0) process.stderr.write(r.log.join('\n') + '\n\n');
  }
  const s = summarise(results, names);
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(s, null, 1));
  const pct = (x) => `${(100 * x).toFixed(0)}%`;
  console.log(`${names[0]} vs ${names[1]}: ${s.battles} battles`);
  console.log(`  wins ${pct(s.winRate[0])} / ${pct(s.winRate[1])}, draws ${pct(s.draws / s.battles)}`);
  console.log(`  average VP ${s.avgVP[0].toFixed(1)} / ${s.avgVP[1].toFixed(1)}, points destroyed ${s.avgPointsKilled[0].toFixed(0)} / ${s.avgPointsKilled[1].toFixed(0)}`);
  console.log(`  the side taking the first turn won ${pct(s.firstTurnWinRate)} of decided battles`);
  for (const side of [0, 1]) console.log(`  ${names[side]} reactions per battle: ${Object.entries(s.reactionsPerBattle[side]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  for (const side of [0, 1]) {
    console.log(`  ${names[side]}: top units by points destroyed`);
    for (const u of s.units[side].slice(0, 5)) console.log(`    ${u.name.padEnd(30)} ${String(u.pts).padStart(4)} pts  killed ${u.avgPointsKilled.toFixed(0).padStart(4)}  lost ${u.avgPointsLost.toFixed(0).padStart(4)}  survived ${pct(u.survived)}`);
  }
}

if (require.main === module) main();
module.exports = { summarise };
