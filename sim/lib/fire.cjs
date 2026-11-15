'use strict';
// Choosing what to shoot with. HH3: a model attacks with one Ranged Weapon in a Shooting Attack, two if both have
// the Pistol rule, or as many as its Firing Protocols (X) allow. Weapons are picked for expected value.
const { num, xOf, argOf, has } = require('./rules.cjs');
const { rangedGroup, expectedGroup, statsOf } = require('./attack.cjs');
const { gap, lineOfSight, inCover } = require('./table.cjs');
const core = require('./core.cjs');
const legions = require('./legions.cjs');

const rangeOf = (w, m) => {
  if (has(w.specialRules, 'Template') || String(w.R).toLowerCase() === 'template') return core.TEMPLATE_RANGE;
  // Burning Sky war-moon: Rangda weapons reach 6" further (Unlimited and Template ranges unchanged)
  const bonus = m && m.traits && m.traits.includes('Burning Sky') && m.traits.includes('Rangda') ? 6 : 0;
  return num(w.R, 0) + bonus;
};
/** The weapon's range in this attack: Ordnance (R) doubles it when the unit stayed Stationary (CONFIRMED). */
const reachOf = (w, m, stationary) => {
  const r = rangeOf(w, m), ord = stationary && argOf(w.specialRules, 'Ordnance');
  return ord && statsOf(ord).includes('R') ? 2 * r : r;
};

// Super-Heavy and Stable models always count as Stationary for their Shooting Attacks, unless they Rushed in the
// preceding Movement Phase; a unit with a Tactical Status never does (CONFIRMED, rulebook). ASSUMPTION: in the enemy's
// turn, whether the unit Rushed in its own last Movement Phase isn't recorded, so it counts as not having Rushed
const STEADY = /Super-?heavy|Stable/i;
const steady = (state, u) => STEADY.test(u.unitType || '') && !u.statuses.size && !core.still(state || {}, u).rushed;

// ---------- vehicle firing arcs and weapon mounts ----------
// CONFIRMED (rulebook): each vehicle weapon attacks only targets in its arc. Hull (Arc) Mounted: the Front, Rear,
// Left or Right quarter (Side is both), split by lines through the hull's corners; Turret and Pintle Mounted: any;
// Centreline Mounted: the strip ahead of the hull, as wide as it (or behind it, if named); Sponson Mounted: the half
// of the table on its own side of the line through the hull from front to rear, one sponson each side unless the
// profile says otherwise; Co-axial (X) Mounted: X's arcs, and only at X's target.
// The mount comes from the item's name ("Hull (Front) Mounted ..."), else from the option it was chosen from or that
// exchanges it ("Turret (exchanges the Predator cannon)", "Hull (Front) Weapon", "Legion Sponson Weapons").
// ASSUMPTIONS: a weapon with no mount named fires in any arc, as a Turret would; "Hull Mounted" without an arc is
// Front; Knight and Titan mounts (Arm, Carapace and the like) aren't in the rulebook's list and fire in any arc. The
// vehicle is its circle (table.cjs): the hull quarters are 90 degrees about its facing, the Centreline strip is 0.6 of
// its radius each side, and a target is in an arc if any part of its circle is. Left is to the left of the facing
// with the table's y axis pointing down.
const MOUNT_RE = /(Co-axial\s*\(([^)]*)\))|(Turret)|(Pintle)|(Hull\s*\(([^)]*)\))|(Sponson\s*\((left|right)\))|(Sponson)|(Cent(?:re|er|r)line(?:\s*\(([^)]*)\))?)|(\bHull\b)|(\bFront\b)|(\bRear\b)/i;
const ANY = { kind: 'any' };
const hullArcs = (s) => {
  const a = new Set();
  for (const p of String(s).toLowerCase().split(/\s*,\s*|\s+and\s+/)) { if (p === 'side') a.add('left').add('right'); else if (/^(front|rear|left|right)$/.test(p)) a.add(p); }
  return a.size ? { kind: 'hull', arcs: [...a] } : ANY;
};
/** The mount a text names (the first one it mentions), or null. */
function parseMount(text) {
  const m = String(text || '').match(MOUNT_RE);
  if (!m) return null;
  if (m[1]) return { kind: 'coaxial', link: m[2].trim().toLowerCase() };
  if (m[3] || m[4]) return ANY;
  if (m[5]) return hullArcs(m[6]);
  if (m[7]) return { kind: 'sponson', arcs: [m[8].toLowerCase()], single: true };
  if (m[9]) return { kind: 'sponson', arcs: ['left', 'right'] };
  if (m[10]) {
    const ends = m[11] ? [...new Set(m[11].toLowerCase().split(/\s*,\s*/).filter((x) => x === 'front' || x === 'rear'))] : [];
    return { kind: 'centreline', arcs: ends.length ? ends : ['front'] };
  }
  if (m[12] || m[13]) return { kind: 'hull', arcs: ['front'] };
  return { kind: 'hull', arcs: ['rear'] };
}
const mountMemo = new WeakMap();
/** Each of a vehicle model's ranged weapons with its mount (null: none named), worked out once per profile row. */
function mountsOf(unit, m) {
  let mm = mountMemo.get(m.ranged);
  if (mm) return mm;
  mm = new Map();
  mountMemo.set(m.ranged, mm);
  const army = require('./army.cjs');
  let data;
  try { data = army.loadArmyData(unit.armyId); } catch (e) { return mm; }
  const options = ((data.D.units || []).find((x) => x.id === unit.id) || {}).options || [];
  const fromOption = (item) => {
    for (const o of options) {
      if (!(o.replaces || []).includes(item) && !(o.choices || []).some((c) => c.name === item)) continue;
      const p = parseMount(String(o.text || '').replace(/^[^:]*:\s*/, ''));
      if (p) return p;
    }
    return null;
  };
  // army.cjs builds a row's weapons item by item, in order, so each weapon is matched to the item it came from
  let i = 0;
  for (const item of m.items || []) {
    const found = army.resolveItem(data.weapons, item).ranged;
    if (!found.length) continue;
    const mount = parseMount(item) || fromOption(item);
    for (const f of found) { const w = m.ranged[i]; if (!w || w.base !== f.base) break; mm.set(w, mount); i++; }
  }
  return mm;
}
/**
 * Where a target unit lies from a vehicle: along and across its facing, its bearing and how wide it looks. A stand-in
 * of no size (ai.shootTable's range-band estimates) is taken to face its target, as a vehicle pivots to its nearest
 * enemy at the end of its move.
 */
function arcGeometry(v, t) {
  const dx = t.x - v.x, dy = t.y - v.y, D = Math.hypot(dx, dy);
  const f = !v.r ? Math.atan2(dy, dx) : v.facing ?? (v.side === 0 ? Math.PI / 2 : -Math.PI / 2);
  const c = Math.cos(f), s = Math.sin(f);
  const along = dx * c + dy * s, lat = dx * s - dy * c;
  return { along, lat, ang: Math.atan2(lat, along), half: D > t.r ? Math.asin(t.r / D) : Math.PI, R: t.r, hw: 0.6 * v.r };
}
const HULL_BEARING = { front: 0, left: Math.PI / 2, rear: Math.PI, right: -Math.PI / 2 };
const angleBetween = (a, b) => { let d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
/**
 * How many of a vehicle weapon's mounts can attack the target (0 to its count; a pair of sponsons both if the target
 * spans the line between them). An item that names no number of sponsons is a pair, one each side (CONFIRMED: the
 * rule's default), and "Two Sponson Mounted ..." is one each side too.
 */
function arcCount(mount, w, geo, ctx, depth = 0) {
  const n = w.count || 1;
  if (!mount || mount.kind === 'any') return n;
  if (mount.kind === 'hull') return mount.arcs.some((a) => angleBetween(geo.ang, HULL_BEARING[a]) <= Math.PI / 4 + geo.half) ? n : 0;
  if (mount.kind === 'centreline') {
    if (Math.abs(geo.lat) > geo.hw + geo.R) return 0;
    return mount.arcs.some((a) => (a === 'rear' ? geo.along - geo.R <= 0 : geo.along + geo.R >= 0)) ? n : 0;
  }
  if (mount.kind === 'sponson') {
    const sides = mount.arcs.filter((a) => (a === 'left' ? geo.lat >= -geo.R : geo.lat <= geo.R)).length;
    return mount.single ? (sides ? n : 0) : Math.max(1, Math.ceil(n / 2)) * sides;
  }
  // Co-axial (X): only alongside X, at X's target
  const link = depth ? null : ctx.model.ranged.find((x) => x !== w && String(x.base || x.name).toLowerCase().includes(mount.link));
  if (!link) return n;
  return ctx.dist <= reachOf(link, ctx.model, ctx.stationary) && arcCount(ctx.mounts.get(link), link, geo, ctx, 1) ? n : 0;
}
const countMemo = new WeakMap();
/** The weapon with `n` of its mounts firing (a shared copy, so Fire Groups and rule lookups still match). */
function withCount(w, n) {
  let m = countMemo.get(w);
  if (!m) { m = new Map(); countMemo.set(w, m); }
  let c = m.get(n);
  if (!c) { c = Object.assign({}, w, { count: n, copyOf: w }); m.set(n, c); }
  return c;
}

const GUNS_OF_THE_CONQUEROR = /^Guns of the Conquer/i;

/** How many weapons a model may fire in one Shooting Attack. */
function fireLimit(model) {
  const fp = xOf(model.rules, 'Firing Protocols');
  if (fp) return fp;
  return core.weaponsPerModel(model);
}

/** Value of a point of damage on a unit: its points spread over its wounds, so killing elite models is worth more. */
const valuePerWound = (u) => {
  const total = u.models.reduce((t, m) => t + m.maxWounds, 0);
  return total ? u.pts / total : 0;
};

/**
 * The best weapons for each model in `shooter` against `target`, with the expected damage and points removed.
 * opts: { stationary, snap, bsMod, coverSave, losOK, reaction, exclude }. A vehicle model fires only the weapons whose
 * arcs reach the target (a copy with fewer mounts where only some can).
 */
function planVolley(shooter, target, state, opts = {}) {
  // Lies and Obfuscation (Alpha Legion): they count as 2" further away
  const d = gap(shooter, target) + legions.rangePenalty(target);
  const los = opts.losOK ?? lineOfSight(state.table, shooter, target);
  // what rangedGroup needs to know about the attack: a Flyer target (Skyfire), the shooter's statuses, a Super-Heavy
  // or Stable shooter counting as Stationary, and a Barrage fired out of sight (no Hit Test, Side Armour)
  const vsFlyer = /Flyer/.test(target.unitType || ''), still = !opts.stationary && steady(state, shooter);
  if (vsFlyer || still || !los) opts = Object.assign({}, opts, { vsFlyer, statused: shooter.statuses.size > 0, indirect: !los }, still ? { stationary: true } : null);
  // Ferrum Occularis (Iron Havocs): no Cover Saves against them after they stayed Stationary (CONFIRMED)
  const ferrum = has(shooter.rules, 'Ferrum Occularis') && shooter.turn?.stationary;
  const coverSave = opts.coverSave !== undefined ? opts.coverSave : (!opts.ignoreCover && !ferrum ? core.coverSave(target, inCover(state.table, shooter, target)) : null);
  // Fatal Strike (Mor Deythan): +2 Ballistic Skill for the phase it's used in
  if (shooter.turn?.fatalStrike) opts = Object.assign({}, opts, { bsMod: (opts.bsMod || 0) + 2 });
  const picks = [];
  let exp = 0;
  for (const m of shooter.models) {
    if (m.wounds <= 0 || !m.ranged.length) continue;
    // a vehicle's weapons fire only into their arcs
    const geo = m.vehicle && target !== shooter ? arcGeometry(shooter, target) : null;
    const arc = geo && { model: m, mounts: mountsOf(shooter, m), dist: d, stationary: opts.stationary };
    const usable = [];
    for (const w of m.ranged) {
      // Guns of the Conqueror (Lotara Sarrin): the profile is only fired through its Advanced Reaction (reactions.cjs)
      if (GUNS_OF_THE_CONQUEROR.test(w.name) && !opts.conqueror) continue;
      if (d > reachOf(w, m, opts.stationary)) continue;
      // out of sight only Barrage weapons may fire, and never in a Reaction's Shooting Attack (CONFIRMED)
      if (!los && (opts.reaction || !has(w.specialRules, 'Barrage'))) continue;
      if (has(w.specialRules, 'Limited') && (shooter.limitedUsed?.[w.name] || 0) >= xOf(w.specialRules, 'Limited')) continue;
      if (opts.exclude && opts.exclude(w)) continue;
      if (!geo) { usable.push(w); continue; }
      const n = arcCount(arc.mounts.get(w), w, geo, arc);
      if (n) usable.push(n === (w.count || 1) ? w : withCount(w, n));
    }
    if (!usable.length) continue;
    // modes of one weapon are alternatives: keep each weapon's best mode
    const byBase = new Map();
    for (const w of usable) {
      const g = rangedGroup(m, w, target, opts);
      const e = expectedGroup(g, target, { coverSave });
      const cur = byBase.get(w.base || w.name);
      if (!cur || e > cur.e) byBase.set(w.base || w.name, { w, e });
    }
    let options = [...byBase.values()].sort((a, b) => b.e - a.e);
    let limit = fireLimit(m);
    // two Pistols may be fired together
    const pistols = options.filter((o) => has(o.w.specialRules, 'Pistol'));
    if (limit === 1 && pistols.length >= 2 && pistols[0].e + pistols[1].e > options[0].e) options = pistols, limit = 2;
    for (const o of options.slice(0, limit)) {
      picks.push({ model: m, weapon: o.w, e: o.e });
      exp += o.e;
    }
  }
  return { picks, expectedDamage: exp, expectedPts: exp * valuePerWound(target), coverSave, los, range: d };
}

module.exports = { planVolley, fireLimit, rangeOf, reachOf, steady, STEADY, valuePerWound, GUNS_OF_THE_CONQUEROR, parseMount, mountsOf, arcGeometry, arcCount };
