#!/usr/bin/env node
'use strict';
// Summarise a tournament.json from sim/tournament.cjs: standings, a rating that accounts for who each list played,
// results by mission Archetype, the most lopsided matchups, and which units earned their points.
//   node sim/report.cjs tournament.json [--json summary.json]
const fs = require('fs');

function summarise(t) {
  const n = t.names.length;
  const M = Array.from({ length: n }, () => Array.from({ length: n }, () => ({ w: 0, l: 0, d: 0, vp: 0, vpAgainst: 0 })));
  const arch = Array.from({ length: n }, () => ({}));
  const units = Array.from({ length: n }, () => ({}));
  let firstWins = 0, decided = 0, battles = 0;
  for (const p of t.pairings) {
    const { i, j } = p;
    M[i][j].w += p.wins[0]; M[i][j].l += p.wins[1]; M[i][j].d += p.draws; M[i][j].vp += p.vp[0]; M[i][j].vpAgainst += p.vp[1];
    M[j][i].w += p.wins[1]; M[j][i].l += p.wins[0]; M[j][i].d += p.draws; M[j][i].vp += p.vp[1]; M[j][i].vpAgainst += p.vp[0];
    firstWins += p.firstWins; decided += p.decided; battles += p.wins[0] + p.wins[1] + p.draws;
    for (const [a, r] of Object.entries(p.byArch)) for (const [s, idx] of [[0, i], [1, j]]) {
      const x = arch[idx][a] = arch[idx][a] || { battles: 0, wins: 0 };
      x.battles += r.battles; x.wins += r.wins[s];
    }
    for (const [s, idx] of [[0, i], [1, j]]) for (const [name, u] of Object.entries(p.units[s])) {
      const x = units[idx][name] = units[idx][name] || { pts: u.pts, n: 0, killed: 0, lost: 0, survived: 0 };
      x.n += u.n; x.killed += u.killed; x.lost += u.lost; x.survived += u.survived;
    }
  }
  const rows = t.names.map((name, i) => {
    let w = 0, l = 0, d = 0, vp = 0, va = 0;
    for (let j = 0; j < n; j++) if (j !== i) { w += M[i][j].w; l += M[i][j].l; d += M[i][j].d; vp += M[i][j].vp; va += M[i][j].vpAgainst; }
    const g = w + l + d;
    return { i, name, games: g, wins: w, losses: l, draws: d, score: (w + d / 2) / g, vpFor: vp / g, vpAgainst: va / g };
  });
  // Bradley-Terry ratings (on an Elo-like scale), so a list isn't flattered by an easy schedule
  const r = new Array(n).fill(1);
  for (let it = 0; it < 500; it++) {
    for (let i = 0; i < n; i++) {
      let num = 0, den = 0;
      for (let j = 0; j < n; j++) if (j !== i) {
        const games = M[i][j].w + M[i][j].l + M[i][j].d;
        if (!games) continue;
        num += M[i][j].w + M[i][j].d / 2;
        den += games / (r[i] + r[j]);
      }
      r[i] = Math.max(1e-6, num / den);
    }
    const mean = Math.exp(r.reduce((t, x) => t + Math.log(x), 0) / n);
    for (let i = 0; i < n; i++) r[i] /= mean;
  }
  for (const row of rows) row.rating = Math.round(1500 + 400 * Math.log10(r[row.i]));
  rows.sort((a, b) => b.rating - a.rating);
  const matchups = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const m = M[i][j], g = m.w + m.l + m.d;
    if (g) matchups.push({ a: t.names[i], b: t.names[j], score: (m.w + m.d / 2) / g, games: g });
  }
  matchups.sort((x, y) => Math.abs(y.score - 0.5) - Math.abs(x.score - 0.5));
  const unitRows = [];
  for (let i = 0; i < n; i++) for (const [name, u] of Object.entries(units[i])) {
    unitRows.push({ list: t.names[i], name, pts: u.pts, appearances: u.n, killedPerGame: u.killed / u.n, lostPerGame: u.lost / u.n, efficiency: u.killed / u.n / u.pts, survived: u.survived / u.n });
  }
  unitRows.sort((a, b) => b.efficiency - a.efficiency);
  return { names: t.names, battles, battlesPerPairing: t.battles, firstTurnWinRate: firstWins / Math.max(1, decided), standings: rows, matrix: M, byArchetype: arch, matchups, units: unitRows };
}

function main() {
  const [file, ...rest] = process.argv.slice(2);
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  const s = summarise(t);
  const jsonAt = rest.indexOf('--json');
  if (jsonAt >= 0) fs.writeFileSync(rest[jsonAt + 1], JSON.stringify(s, null, 1));
  const pct = (x) => `${(100 * x).toFixed(0)}%`;
  console.log(`${s.battles} battles, ${s.battlesPerPairing} per pairing; the first player won ${pct(s.firstTurnWinRate)} of decided battles\n`);
  console.log('Rating  Score   W-L-D        VP for/against  Resupply Annihil. Conquest  List');
  for (const r of s.standings) {
    const a = s.byArchetype[r.i];
    const ar = (k) => (a[k] ? pct(a[k].wins / a[k].battles).padStart(8) : '       -');
    console.log(`${String(r.rating).padStart(6)}  ${pct(r.score).padStart(5)}  ${`${r.wins}-${r.losses}-${r.draws}`.padEnd(12)} ${r.vpFor.toFixed(1).padStart(6)} / ${r.vpAgainst.toFixed(1).padEnd(6)} ${ar('Resupply')} ${ar('Annihilation')} ${ar('Conquest')}  ${r.name}`);
  }
  console.log('\nMost one-sided matchups');
  for (const m of s.matchups.slice(0, 10)) console.log(`  ${m.a} ${pct(m.score)} vs ${m.b} (${m.games} games)`);
  console.log('\nUnits that earned their points (points destroyed per game per point)');
  for (const u of s.units.filter((x) => x.appearances >= 50).slice(0, 15)) console.log(`  ${u.efficiency.toFixed(2)}  ${u.name.padEnd(34)} ${String(u.pts).padStart(4)} pts  survived ${pct(u.survived)}  (${u.list})`);
  console.log('\n... and the ones that didn\'t');
  for (const u of s.units.filter((x) => x.appearances >= 50).slice(-12).reverse()) console.log(`  ${u.efficiency.toFixed(2)}  ${u.name.padEnd(34)} ${String(u.pts).padStart(4)} pts  survived ${pct(u.survived)}  (${u.list})`);
}

if (require.main === module) main();
module.exports = { summarise };
