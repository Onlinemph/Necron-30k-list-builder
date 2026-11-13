'use strict';
// Rule-text helpers and the HH3 tables the simulator rolls against.

const num = (v, d = 0) => { const n = parseInt(String(v), 10); return Number.isNaN(n) ? d : n; };
/** "3+" -> 3; anything without a target number -> 7 (no save). */
const save = (v) => { const m = String(v ?? '').match(/(\d)\+/); return m ? +m[1] : 7; };
// Rule lookups run millions of times in a battle, so the patterns are compiled once and the answers are
// remembered per rule list (rule lists are shared, never edited, so this is safe).
const patterns = new Map();
const pattern = (kind, name) => {
  const k = kind + name;
  let re = patterns.get(k);
  if (!re) {
    // the data writes some rule names with a curly apostrophe (Duellist’s Edge): match either
    name = name.replace(/['’]/g, "['’]");
    re = kind === 'x' ? new RegExp(`^${name}\\s*\\((\\d+)\\+?"?\\)`, 'i') : kind === 'a' ? new RegExp(`^${name}\\s*\\(([^)]*)\\)`, 'i') : new RegExp(`^${name}(\\b|\\s|\\(|$)`, 'i');
    patterns.set(k, re);
  }
  return re;
};
const memo = new WeakMap();
function lookup(rules, kind, name, compute) {
  if (!rules) return compute();
  let m = memo.get(rules);
  if (!m) { m = new Map(); memo.set(rules, m); }
  const k = kind + name;
  if (m.has(k)) return m.get(k);
  const v = compute();
  m.set(k, v);
  return v;
}
/** The X of a rule like "Pinning (2)" or "Breaching (5+)" in a list of rule strings, or null. */
const xOf = (rules, name) => lookup(rules, 'x', name, () => {
  const re = pattern('x', name);
  for (const r of rules || []) { const m = String(r).match(re); if (m) return +m[1]; }
  return null;
});
/** The raw X text ("Stunned", "T", "AM"), for rules whose value isn't a number. */
const argOf = (rules, name) => lookup(rules, 'a', name, () => {
  const re = pattern('a', name);
  for (const r of rules || []) { const m = String(r).match(re); if (m) return m[1].trim(); }
  return null;
});
const has = (rules, name) => lookup(rules, 'h', name, () => { const re = pattern('h', name); return (rules || []).some((r) => re.test(String(r))); });

// relative characteristics on weapons: "I", "A", "S" mean the model's own value, "+1"/"-2" modify it
const rel = (v, base) => {
  const s = String(v ?? '');
  if (s === 'I' || s === 'A' || s === 'S' || s === '') return base;
  if (/^[+-]\d+$/.test(s)) return base + +s;
  return num(v, base);
};

// Hit Test target numbers
const hitNeedBS = (bs) => (bs >= 6 ? 2 : bs <= 0 ? 7 : 7 - bs);
// HH3 melee chart: 2+ against half your WS or less, 3+ against lower, 4+ equal, 5+ higher, 6+ double or more
const hitNeedWS = (ws, def) => (ws >= 2 * def ? 2 : ws > def ? 3 : ws === def ? 4 : 2 * ws <= def ? 6 : 5);
// Wound Test target numbers (7 = can't wound)
const woundNeed = (s, t) => { const d = s - t; return d >= 2 ? 2 : d === 1 ? 3 : d === 0 ? 4 : d === -1 ? 5 : d >= -3 ? 6 : 7; };
/** Chance that 2d6 rolls at or under a target. */
const p2d6AtMost = (t) => { let n = 0; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b <= t) n++; return n / 36; };

module.exports = { num, save, xOf, argOf, has, rel, hitNeedBS, hitNeedWS, woundNeed, p2d6AtMost };
