'use strict';
// Core-rule numbers and procedures the simulator uses, in one place so they can be corrected easily.
// CONFIRMED: taken from HH3 rule texts in the repo (BSData and the codex sources); see sim/README.md.
// ASSUMPTION: the HH3 rulebook isn't in the repo and nothing in it settles this, so it's a best guess.

const { num, xOf, has } = require('./rules.cjs');

module.exports = {
  // ---------- battle ----------
  BATTLE_TURNS: 5, // ASSUMPTION
  // Reaction Allotment per enemy Player Turn: a base plus bonus points from the Battle Points Limit.
  // CONFIRMED shape (Tides of Change), ASSUMPTION numbers: 1 + 1 per 1000 points.
  reactionAllotment: (pointsLimit) => 1 + Math.floor((pointsLimit || 3000) / 1000),

  // ---------- statuses ----------
  // CONFIRMED: any Tactical Status stops a unit controlling or contesting objectives; Routed units Fall Back in
  // the Rout Sub-Phase; statuses are tested off in the Statuses Sub-Phase (Cool for Pinned, Suppressed and
  // Stunned, Leadership for Routed), one check per status; vehicles make a Repair Test (6+, or X+ with Auto-Repair).
  // ASSUMPTION: what each status stops, beyond that:
  status: {
    anyFightsAtI1: true, // from the repo author's notes (reviews)
    Pinned: { noMove: true, noCharge: true },
    Suppressed: { snapShotsOnly: true },
    Stunned: { noShoot: true, noReactions: true },
    Routed: { noShoot: true, noCharge: true, noReactions: true, fallsBack: true },
  },
  // Fall Back distance: CONFIRMED I + 2D6 for Cavalry; ASSUMPTION I + D6 for everything else
  fallBackDistance: (unit, dice) => {
    const m = unit.models.find((x) => x.wounds > 0);
    const I = num(m?.p.I, 3);
    return /Cavalry/.test(unit.unitType) ? I + dice.d6() + dice.d6() : I + dice.d6();
  },
  // a failed Charge Roll forces a Cool Check (CONFIRMED); the status gained is an ASSUMPTION
  failedChargeStatus: 'Pinned',
  // ASSUMPTION: losing a quarter of the unit's models to one Shooting Attack forces a Panic Check
  panicCasualtyFraction: 0.25,

  // ---------- shooting ----------
  TEMPLATE_RANGE: 8, // CONFIRMED: "Template" counts as 8"
  // CONFIRMED: Walkers fire every weapon; ASSUMPTION: so do Vehicles
  weaponsPerModel: (model) => (model.vehicle || /Walker/.test(model.unitType) ? Infinity : 1),
  // ASSUMPTION: Snap Shots hit only on a 6 (as in HH2)
  SNAP_HIT: 6,
  // CONFIRMED: terrain gives a Cover Save (Barricades 5+); ASSUMPTION: every cover piece gives 5+
  coverSave: (unit) => (/Cavalry/.test(unit.unitType) ? null : 5),
  // ASSUMPTION: Vehicles answer Return Fire and Overwatch with weapons of Strength 6 or less (their "Defensive" ones)
  isDefensive: (w) => num(w.RS, 10) <= 6,
  // CONFIRMED: Glancing Hits roll on the Vehicle Damage Table (Super-Heavy and Flyer lose 1 HP instead).
  // ASSUMPTION: the table hands out a status
  vehicleDamage: (dice) => ['Pinned', 'Pinned', 'Suppressed', 'Suppressed', 'Stunned', 'Stunned'][dice.d6() - 1],

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
  CHARGE_DECLARE_RANGE: 12, // ASSUMPTION (forced-charge rules all trigger "within 12")
  // CONFIRMED: Set-up Move depends on M + I (Heavy: M only), capped at 6"; ASSUMPTION: half of that, rounded up
  setupMove: (unit) => {
    const m = unit.models.find((x) => x.wounds > 0);
    const M = num(m?.p.M, 6), I = num(m?.p.I, 3);
    const base = /Heavy/.test(unit.unitType) ? M : M + I;
    return Math.min(6, Math.ceil(base / 2));
  },
  // CONFIRMED: the Charge Roll is 2D6 keeping the highest, plus Fast (X)
  chargeRoll: (unit, dice) => Math.max(dice.d6(), dice.d6()) + Math.min(...unit.models.filter((m) => m.wounds > 0).map((m) => xOf(m.rules, 'Fast') || 0)),

  // ---------- combat resolution ----------
  // ASSUMPTION: Combat Resolution Points are wounds (and Hull Points) inflicted, plus 1 for the side with more
  // models left; the loser's Panic Check takes the difference off its Leadership
  outnumberBonus: 1,
  // ASSUMPTION: a Pursue that equals or beats the Fall Back distance catches the unit and destroys it ("Massacred")
  pursueDistance: (unit, dice) => num(unit.models.find((x) => x.wounds > 0)?.p.I, 3) + dice.d6(),

  // ---------- missions ----------
  CONTROL_RANGE: 3, // INFERRED from Vanguard and Chosen Ground
  // CONFIRMED: Line (X) adds X to a model's Tactical Strength; ASSUMPTION: every model has a base of 1
  tacticalStrength: (model) => 1 + (xOf(model.rules, 'Line') || 0),
  // ASSUMPTION: vehicles can't control or contest objectives
  canHoldObjectives: (unit) => !unit.vehicle && !has(unit.rules, 'Heedless') && !/Automata|Fortification/.test(unit.unitType) && (!/Cavalry/.test(unit.unitType) || has(unit.rules, 'Strike and Fade')),
  SCORE_FROM_TURN: 2, // ASSUMPTION
  // secondary objectives: names CONFIRMED, values ASSUMPTION
  secondaries: { slayTheWarlord: 3, firstStrike: 1, giantKiller: 2, lastManStanding: 1 },

  // ---------- reserves ----------
  RESERVES_FROM_TURN: 2, // CONFIRMED for Deep Strike ("not in the first Battle Turn")
  RESERVES_TEST: 3, // ASSUMPTION: a D6 roll of 3+; everything arrives by turn 4
  DEEP_STRIKES_PER_TURN: 1, // CONFIRMED

  // ---------- psychic ----------
  // CONFIRMED: Force (X): pass a Willpower Check to double X; any double is Perils of the Warp.
  // ASSUMPTION: Perils of the Warp table — 1-3 Aetheric Feedback (D3 wounds, no saves), 4-6 Warp Rupture (Stunned)
  perils: (dice) => (dice.d6() <= 3 ? { result: 'Aetheric Feedback', wounds: dice.d3() } : { result: 'Warp Rupture', status: 'Stunned' }),
};
