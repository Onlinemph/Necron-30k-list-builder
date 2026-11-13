// Default weapons for BSData units. The importer takes a model's default wargear from a group's default selection, but
// many BSData entries give a model its weapon only through an option ("Varagyr: May exchange frost axe with ...",
// "Every Model in this Unit may have its shrapnel cannon replaced with ..."), so those models came through carrying
// nothing. This step, run by build-data.mjs on every BSData army:
//
//  1. gives a model the weapon an exchange option names, when the model doesn't already have it, and marks the
//     option as replacing it, so picking another choice swaps the default out;
//  2. where a model still has no weapon at all, makes its weapon groups ("Options (choose 2)", "(up to 2)") a
//     required pick, and lets each model take as many as the group allows (perModelPicks).
//
// The units' points are unchanged: a default weapon is part of the model's cost.

const EXCHANGE = [
  /have (?:its|their)\s+(.+?)\s+(?:replaced|exchanged)\b/i,
  /(?:exchange|replace)\s+(?:their\s+|its\s+|the\s+|a\s+)?(.+?)\s+(?:for|with)\b/i,
];

export function fillDefaultWeapons(out, common, wkey) {
  const weapons = new Map();
  for (const w of [...out.weapons.ranged, ...out.weapons.melee, ...common.weapons.ranged, ...common.weapons.melee]) {
    for (const k of [wkey(w.name), wkey(w.name.replace(/\s*\(.*\)\s*$/, ''))]) if (!weapons.has(k)) weapons.set(k, w);
  }
  const weaponName = (name) => {
    const w = weapons.get(wkey(name)) || weapons.get(wkey(name).replace(/^twin(-linked)? /, ''));
    return w ? w : null;
  };
  // grenades and bombs alone don't arm a model
  const isWeapon = (name) => { const w = weaponName(name); return !!w && !/grenade|bomb/i.test(name); };
  const isVehicle = (m) => m.profile && (m.profile.FRONT != null || m.profile.HP != null);
  const report = { defaults: 0, required: 0, units: new Set() };
  for (const u of out.units) {
    const optionsFor = (m) => (u.options || []).filter((o) => o.model === m.name || (!o.model && !o.models));
    // 1. defaults named by exchange options
    for (const m of u.models || []) {
      m.wargear = m.wargear || [];
      for (const o of optionsFor(m)) {
        if ((o.replaces || []).length) continue;
        const t = String(o.text || '');
        const hit = EXCHANGE.map((re) => t.match(re)).find(Boolean);
        if (!hit) continue;
        // "both Bolt pistol and Chainsword", "combi-bolter and power weapon": each named weapon in turn
        const parts = hit[1].trim().replace(/^(?:both|either|the|their|its|a)\s+/i, '').split(/\s+and\s+|,\s*/i).map((x) => x.trim()).filter(Boolean);
        const named = [];
        for (const said of parts) {
          // the option's own spelling of the weapon, else the weapon profile's
          const choice = (o.choices || []).find((c) => c.name.toLowerCase() === said.toLowerCase());
          const name = choice ? choice.name : weaponName(said) && weaponName(said).name.replace(/\s*\((Primary|Secondary)\)\s*$/, '');
          if (!name || !isWeapon(name)) continue;
          named.push(name);
          if (!m.wargear.some((w) => wkey(w) === wkey(name))) { m.wargear.push(name); report.defaults++; report.units.add(u.id); }
        }
        if (named.length) o.replaces = named;
      }
    }
    // a per-model group of several picks ("Options (choose 2)") lets each model take that many
    for (const o of u.options || []) {
      const n = +((String(o.text || '').match(/\((?:choose|up to)\s+(\d+)\)/i) || [])[1] || 1);
      if (o.kind === 'perModel' && n > 1 && !o.perModelPicks && !(o.max && o.max.fixed != null)) {
        o.perModelPicks = n;
        // a required "choose 2" group is two weapons for every model
        if (o.required && o.required.count === 'all' && /\(choose\s+\d+\)/i.test(o.text)) o.required = Object.assign({}, o.required, { picks: n });
      }
    }
    // 2. infantry and the like still unarmed: their free-choice weapon groups become a required pick. A vehicle's
    // guns, or a model that already has a required weapon pick, are left as the data has them
    for (const m of u.models || []) {
      if (m.wargear.some(isWeapon) || isVehicle(m)) continue;
      const own = optionsFor(m);
      if (own.some((o) => o.required && (o.choices || []).some((c) => isWeapon(c.name)))) continue;
      for (const o of own) {
        if ((o.replaces || []).length || o.required) continue;
        const t = String(o.text || '');
        if (!/choose|up to/i.test(t)) continue;
        // a weapon group offers weapons, at least one of them at no extra cost
        if (!(o.choices || []).some((c) => isWeapon(c.name) && !c.points)) continue;
        const n = +((t.match(/(?:choose|up to)\s+(\d+)/i) || [])[1] || 1);
        if (o.kind === 'perModel') {
          // "choose 2" is two weapons for every model, "up to 2" at least one
          o.required = /choose\s+\d+/i.test(t) && n > 1 ? { count: 'all', picks: n } : { count: 'all' };
          if (n > 1) o.perModelPicks = n;
        } else if (o.kind === 'any') o.required = { count: /choose\s+\d+/i.test(t) ? n : 1 };
        else o.required = {};
        report.required++; report.units.add(u.id);
      }
    }
  }
  return report;
}
