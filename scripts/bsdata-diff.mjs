#!/usr/bin/env node
// Summarises what a BSData re-import changed against the last commit: units added or removed and
// points changes, per army. Used as the body of the weekly refresh pull request.
//   node scripts/bsdata-diff.mjs [git-ref]   (default HEAD)
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2] || 'HEAD';
const old = (path) => { try { return execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (e) { return null; } };
const index = JSON.parse(readFileSync(join(root, 'data/bsdata/armies.json'), 'utf8'));
const before = JSON.parse(old('data/bsdata/armies.json') || '{"armies":[]}');
const lines = [`BSData game system revision ${before.gameSystemRevision ?? '?'} → ${index.gameSystemRevision}${index.sourceCommit ? ` (BSData ${index.sourceCommit})` : ''}.`, ''];
let changed = 0;
for (const a of index.armies) {
  const path = `data/bsdata/${a.id}/parts/units.json`;
  const now = JSON.parse(readFileSync(join(root, path), 'utf8')).units;
  const prevText = old(path);
  if (!prevText) { lines.push(`### ${a.name}`, `New army: ${now.length} units.`, ''); changed++; continue; }
  const prev = JSON.parse(prevText).units;
  const byId = (list) => new Map(list.map((u) => [u.id, u]));
  const p = byId(prev), n = byId(now);
  const out = [];
  for (const [id, u] of n) if (!p.has(id)) out.push(`- Added ${u.name} (${u.basePoints} pts)`);
  for (const [id, u] of p) if (!n.has(id)) out.push(`- Removed ${u.name}`);
  for (const [id, u] of n) {
    const o = p.get(id);
    if (!o) continue;
    if (o.basePoints !== u.basePoints) out.push(`- ${u.name}: ${o.basePoints} → ${u.basePoints} pts`);
    else if (JSON.stringify(o) !== JSON.stringify(u)) out.push(`- ${u.name}: options, wargear or rules changed`);
  }
  if (!out.length) continue;
  changed++;
  lines.push(`### ${a.name}`, ...out.slice(0, 40), ...(out.length > 40 ? [`- …and ${out.length - 40} more`] : []), '');
}
for (const a of before.armies) if (!index.armies.some((x) => x.id === a.id)) { lines.push(`### ${a.name}`, 'Army no longer in BSData.', ''); changed++; }
if (!changed) lines.push('No unit or points changes; only shared rules text or data layout changed.');
console.log(lines.join('\n'));
