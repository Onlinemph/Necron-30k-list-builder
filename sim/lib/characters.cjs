'use strict';
// Characters joining units. CONFIRMED (data/bsdata/common.json): models with the Command or Specialist Sub-Type may
// join and leave Units; a Paragon may join a Unit that includes Infantry; nothing joins a Flyer or a Fortification;
// Malefic models only join, or are joined by, Malefic models; a model with Lone Killer can't be joined; a joined
// character is part of its unit, embarking with it. MISSION: characters join their unit before it is deployed.
//
// The AI attaches each character before deployment and keeps it there (ASSUMPTION: characters don't leave units
// during the battle; one character per unit). On the table the character is one more model of its unit: it moves
// with it at the slowest model's pace, lends its Leadership, can be singled out by Precision hits and can fight
// challenges. For scoring it stays its own unit: when it falls its Kill Points, Slay the Warlord and First Strike
// count as for any destroyed unit.
const { num, has } = require('./rules.cjs');
const { alive } = require('./checks.cjs');
const ai = require('./ai.cjs');

const kind = (m) => (/Cavalry/.test(m.unitType) ? 'Cavalry' : /Walker/.test(m.unitType) ? 'Walker' : /Paragon/.test(m.unitType) ? 'Paragon' : /Infantry/.test(m.unitType) ? 'Infantry' : 'Other');
const isCharacter = (u) => u.models.length === 1 && !u.vehicle && /Command|Specialist|Paragon/.test(u.models[0].unitType) && !/Flyer/.test(u.models[0].unitType);
// rules that only work if every model in the unit has them, so a character can't take a unit into them alone
const ALL_OR_NOTHING = ['Deep Strike', 'Outflank', 'Infiltrate'];

function canJoin(c, h) {
  if (h === c || h.side !== c.side || h.vehicle || h.joined?.length || h.models.length < 2) return false;
  const cm = c.models[0], hm = h.models;
  if (hm.some((m) => /Flyer|Fortification/.test(m.unitType) || m.vehicle)) return false;
  if (hm.some((m) => has(m.rules, 'Lone Killer')) || has(cm.rules, 'Lone Killer')) return false;
  const malefic = (m) => /Malefic/.test(m.unitType);
  if (malefic(cm) !== hm.every(malefic)) return false;
  // a Paragon joins Infantry; anyone else joins models that move as they do
  if (kind(cm) === 'Paragon') { if (!hm.some((m) => /Infantry/.test(m.unitType))) return false; }
  else if (!hm.some((m) => kind(m) === kind(cm))) return false;
  if (ALL_OR_NOTHING.some((r) => has(h.rules, r) && !has(cm.rules, r))) return false;
  // Bitter Duty: only with others that have it; Ravening Madmen: joined only by models that have it (CONFIRMED)
  if (has(h.rules, 'Bitter Duty') !== has(cm.rules, 'Bitter Duty')) return false;
  if (has(h.rules, 'Ravening Madmen') && !has(cm.rules, 'Ravening Madmen')) return false;
  return true;
}

/** How much the AI likes putting character c with host h. */
function hostValue(state, c, h, foes) {
  const cm = c.models[0];
  let v = 0;
  if (/Retinue/.test(h.role)) v += 60;
  // Neural Collars only work in a unit made entirely of collared models
  if (alive(h).every((m) => has(m.rules, 'Neural Collars')) && !has(cm.rules, 'Neural Collars')) v -= 1000;
  // a fighter goes with fighters, and adds to their charge
  const cMelee = ai.meleeValue(state, c, foes), hMelee = ai.meleeValue(state, h, foes);
  v += Math.min(cMelee, 80) * (hMelee > ai.shootValue(state, h, foes) ? 0.8 : 0.3) + hMelee * 0.1;
  // lending Leadership and Cool to a big unit
  const ld = (u) => Math.max(...alive(u).map((m) => num(m.p.LD, 7)));
  v += Math.max(0, num(cm.p.LD, 7) - ld(h)) * 4 * Math.min(10, alive(h).length) / 5;
  // scoring units keep their objectives longer with a leader
  if (alive(h).some((m) => /Line/.test((m.rules || []).join()))) v += 8;
  // don't slow a fast unit down
  if (num(cm.p.M, 6) < Math.min(...alive(h).map((m) => num(m.p.M, 6)))) v -= 15;
  return v;
}

/** Attach characters to units for both sides, before deployment. Returns the joins made. */
function joinCharacters(state) {
  const joins = [];
  for (const side of [0, 1]) {
    const mine = state.units.filter((u) => u.side === side);
    const foes = state.units.filter((u) => u.side !== side);
    const chars = mine.filter(isCharacter).sort((a, b) => b.pts - a.pts);
    for (const c of chars) {
      let best = null;
      for (const h of mine) {
        if (isCharacter(h) || !canJoin(c, h)) continue;
        const v = hostValue(state, c, h, foes);
        if (v > -100 && (!best || v > best.v)) best = { h, v };
      }
      if (!best) continue;
      attach(state, c, best.h);
      joins.push({ character: c.name, unit: best.h.name });
    }
  }
  return joins;
}

/** Make character c one more model of host h; c stops being a unit on the table but is remembered for scoring. */
function attach(state, c, h) {
  const m = c.models[0];
  const info = { name: c.name, role: c.role, pts: c.pts, side: c.side, uid: c.uid, primeStats: c.primeStats, warlord: c.warlord, models: [m], dead: false };
  m.joinedFrom = info;
  h.models.push(m);
  h.joined = (h.joined || []).concat(info);
  h.kpPts = h.kpPts ?? h.pts;
  h.pts += c.pts;
  h.psyker = h.psyker || c.psyker;
  h.rules = [...new Set([...h.rules, ...m.rules.filter((r) => !ALL_OR_NOTHING.some((x) => r.startsWith(x)))])];
  h.traits = [...new Set([...h.traits, ...(m.traits || [])])];
  state.units = state.units.filter((u) => u !== c);
  for (const a of state.armies) a.units = a.units.filter((u) => u !== c);
  state.log(`${c.name} joins ${h.name}`);
}

module.exports = { joinCharacters, canJoin, isCharacter, attach };
