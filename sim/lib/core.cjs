'use strict';
// Core-rule numbers the simulator uses. Each is either confirmed by HH3 rule text in the repo or marked as an
// assumption, so it can be corrected in one place. See sim/README.md for the sources.

module.exports = {
  // a Flame Template is about 8" long
  TEMPLATE_RANGE: 8,
  // ASSUMPTION until confirmed: a vehicle fires every weapon it carries in a Shooting Attack
  VEHICLE_WEAPONS_PER_ATTACK: (model) => model.ranged.length,
  // ASSUMPTION until confirmed: cover gives a 5+ save that can be used instead of armour
  COVER_SAVE: 5,
};
