'use strict';
// Core-rule numbers and procedures the simulator uses, in one place so they can be corrected easily.
// CONFIRMED: taken from HH3 rule texts in the repo (BSData and the codex sources); see sim/README.md.
// SHEET: from the "How to Play – Horus Heresy 3rd Edition" quick reference (The Bearded Swede), which cites the
//   rulebook's pages; a summary, so wording-level details can still be off.
// ASSUMPTION: nothing available settles this, so it's a best guess.

const { num, xOf, has } = require('./rules.cjs');
const legions = require('./legions.cjs');

module.exports = {
  // ---------- battle ----------
  BATTLE_TURNS: 5, // MISSION: five Battle Turns, a sixth if the first player rolls a 4+
  // Reaction Allotment per enemy Player Turn (SHEET): 1, +1 above 1500 points or +2 above 3500, +1 for a
  // Master of the Legion (ASSUMPTION: while it's on the battlefield)
  reactionAllotment: (pointsLimit, master) => 1 + ((pointsLimit || 3000) > 3500 ? 2 : (pointsLimit || 3000) > 1500 ? 1 : 0) + (master ? 1 : 0),
  // Seize the Initiative (SHEET): before the first turn the player going second may roll a D6 and go first on a 6
  SEIZE_ON: 6,

  // ---------- statuses ----------
  // CONFIRMED: any Tactical Status stops a unit controlling or contesting objectives; Routed units Fall Back in
  // the Rout Sub-Phase; statuses are tested off in the Statuses Sub-Phase (Cool for Pinned, Suppressed and
  // Stunned, Leadership for Routed), one check per status; vehicles make a Repair Test (6+, or X+ with Auto-Repair).
  // SHEET: every status makes the unit's charges Disordered, sets Combat Initiative to 1, stops it holding
  // objectives and denies it the Stationary bonus. Pinned: no move, Rush, charge, Pursue or Disengage.
  // Suppressed: all shooting as Snap Shots. Stunned: no reactions. Routed: must Fall Back, and suffers all of
  // the other penalties. Disgraced: the model's WS and LD are halved and its unit's Initiative is 1.
  status: {
    anyFightsAtI1: true,
    Pinned: { noMove: true, noCharge: true, noPursue: true },
    Suppressed: { snapShotsOnly: true },
    Stunned: { noReactions: true },
    Routed: { noMove: true, noCharge: true, noReactions: true, snapShotsOnly: true, fallsBack: true, noPursue: true },
  },
  snapOnly: (u) => u.statuses.has('Suppressed') || u.statuses.has('Routed'),
  // Fall Back distance: CONFIRMED I + 2D6 for Cavalry; SHEET I + D6 for everything else
  fallBackDistance: (unit, dice) => {
    const m = unit.models.find((x) => x.wounds > 0);
    const I = num(m?.p.I, 3);
    return /Cavalry/.test(unit.unitType) ? I + dice.d6() + dice.d6() : I + dice.d6();
  },
  // a failed charge forces a Cool Check (CONFIRMED); failing it gives Stunned (SHEET)
  failedChargeStatus: 'Stunned',
  // SHEET: losing 25% or more of the unit in a Shooting Attack forces a Leadership check (Routed on a fail)
  panicCasualtyFraction: 0.25,

  // ---------- shooting ----------
  TEMPLATE_RANGE: 8, // CONFIRMED: "Template" counts as 8"
  // CONFIRMED: Walkers fire every weapon; ASSUMPTION: so do Vehicles
  weaponsPerModel: (model) => (model.vehicle || /Walker/.test(model.unitType) ? Infinity : 1),
  // SHEET: Snap Shots by Ballistic Skill (10+: 2+, 9: 3+, 6-8: 4+, 4-5: 5+, 2-3: 6+, 1: can't hit)
  snapHit: (bs) => (bs >= 10 ? 2 : bs === 9 ? 3 : bs >= 6 ? 4 : bs >= 4 ? 5 : bs >= 2 ? 6 : 7),
  // SHEET: BS 6-9 hits on 2+ and scores a Critical Hit on 12 - BS or more; BS 10+ hits automatically, always
  // critically. A Critical Hit wounds automatically and has +1 Damage (CONFIRMED in the Critical Hit rule)
  bsCrit: (bs) => (bs >= 10 ? 1 : bs >= 6 ? 12 - bs : null),
  // SHEET: Light terrain 6+, Medium 5+, Heavy 4+; ASSUMPTION: Cavalry can't claim cover
  coverSave: (unit, value) => (!value || /Cavalry/.test(unit.unitType) ? null : value),
  // SHEET: a Vehicle making an Intercept fires its Defensive weapons; ASSUMPTION: those are Strength 6 or less
  isDefensive: (w) => num(w.RS, 10) <= 6,
  // CONFIRMED: Glancing Hits roll on the Vehicle Damage Table (Super-Heavy and Flyer lose 1 HP instead).
  // SHEET: 1-2 Stunned, 3-4 Pinned, 5-6 Suppressed; a result the vehicle already has costs a Hull Point instead
  vehicleDamage: (dice) => ['Stunned', 'Stunned', 'Pinned', 'Pinned', 'Suppressed', 'Suppressed'][dice.d6() - 1],

  // ---------- movement ----------
  DIFFICULT_PENALTY: 2, // CONFIRMED: difficult terrain takes 2" off the move
  // CONFIRMED: Rush moves M + I (Light +2 I, Rapid +6" instead of I, Fast (X) +X); Heavy can't Rush; no shooting
  // (Light and Rapid may Snap Shot) or charging after a Rush
  rushBonus: (unit) => {
    if (/Heavy/.test(unit.unitType) && !/Vehicle/.test(unit.unitType)) return null;
    const m = unit.models.find((x) => x.wounds > 0);
    if (/Rapid/.test(unit.unitType)) return 6;
    if (m?.p.I == null) return null;
    return num(m.p.I, 0) + (/Light/.test(unit.unitType) ? 2 : 0);
  },

  // ---------- charges ----------
  CHARGE_DECLARE_RANGE: 12, // SHEET: a charge needs Line of Sight and a target within 12"
  // SHEET: Set-up Move by I + M (1-6: 1", 7-9: 2", 10-11: 3", 12-13: 4", 14-19: 5", 20+: 6"); CONFIRMED: Heavy uses M
  setupMove: (unit) => {
    // each model adds its Initiative to its Movement (Heavy: Movement only); the unit goes as far as its slowest
    const ms = unit.models.filter((x) => x.wounds > 0);
    const v = ms.length ? Math.min(...ms.map((m) => num(m.p.M, 6) + (/Heavy/.test(m.unitType) ? 0 : num(m.p.I, 3)))) : 6;
    const s = v >= 20 ? 6 : v >= 14 ? 5 : v >= 12 ? 4 : v >= 10 ? 3 : v >= 7 ? 2 : 1;
    // The Hunter's Strike (Space Wolves): +2", to a maximum of 6"
    return legions.is(unit, 'Space Wolves') ? Math.min(6, s + 2) : s;
  },
  // CONFIRMED: the Charge Roll is 2D6 keeping the highest, plus Fast (X)
  chargeRoll: (unit, dice) => Math.max(dice.d6(), dice.d6()) + Math.min(...unit.models.filter((m) => m.wounds > 0).map((m) => xOf(m.rules, 'Fast') || 0)),

  // ---------- combat resolution ----------
  // SHEET: Combat Resolution is +1 per enemy model removed, Glory Points from the challenge, +1 for outnumbering,
  // and standards (CONFIRMED: vexilla +1, Legion standard +2 per unit); the loser tests Leadership minus the
  // difference and Falls Back Routed on a fail
  outnumberBonus: 1,
  // SHEET: Pursue moves D6 + I towards the unit falling back; reaching it is a successful charge (locked again)
  pursueDistance: (unit, dice) => num(unit.models.find((x) => x.wounds > 0)?.p.I, 3) + dice.d6(),
  // SHEET: Focus Roll = D6 + Combat Initiative - wounds lost, -1 Heavy, +1 Light, +1 Shield or Company Standard,
  // +1 per 5 friendly models in the unit (CONFIRMED: a Legion standard counts as 6 more models)
  focusSupport: (models) => Math.floor(models / 5),

  // ---------- missions ----------
  // Objective control, Tactical Strength, Sectors, Kill Points, secondaries and their values come from the Core
  // Mission Pack: Imperium at War (mission.cjs, scoring.cjs).

  // ---------- reserves ----------
  RESERVES_FROM_TURN: 2, // CONFIRMED for Deep Strike ("not in the first Battle Turn")
  RESERVES_TEST: 3, // SHEET: a unit arrives on a 3+
  RESERVES_AUTO_TURN: 4, // MISSION: Reserves Tests pass automatically from Battle Turn 4
  DEEP_STRIKES_PER_TURN: 1, // CONFIRMED

  // ---------- psychic ----------
  // CONFIRMED: Force (X): pass a Willpower Check to double X; any double is Perils of the Warp.
  // SHEET: Perils table, a D6 — 1 or 6: suffer 13 minus WP wounds, Invulnerable Saves only; 2-5: Stunned.
  // ASSUMPTION: the names (Ætheric Feedback for the wounds, Warp Rupture for Stunned, as Psy-Shock forces it)
  perils: (dice, wp) => {
    const r = dice.d6();
    return r === 1 || r === 6 ? { result: 'Ætheric Feedback', wounds: Math.max(0, 13 - wp), invulnOnly: true } : { result: 'Warp Rupture', status: 'Stunned' };
  },
};
