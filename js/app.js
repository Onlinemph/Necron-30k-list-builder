/* 30k list builder UI. Vanilla JS, no build step. One army's data is loaded per page load. */
(function () {
  'use strict';

  // js/armies.js lists every army; only the chosen army's data file (and the shared one) is loaded.
  const ARMIES = Object.fromEntries((window.ARMY_INDEX || []).map((a) => [a.id, a]));
  const STORE_LAST = 'necron30k.lastArmy';
  // A share link carries its army; otherwise ?army=, then the last army used.
  const FACTION = (() => {
    const listed = (id) => ARMIES[id] && ARMIES[id].units && ARMIES[id].ready !== false;
    const pick = (id) => (id && ARMIES[id] && ARMIES[id].units ? id : null);
    let fromLink = null;
    try { const m = location.hash.match(/#a=(.+)$/); if (m) fromLink = JSON.parse(decodeURIComponent(escape(atob(m[1])))).faction || 'necrons'; } catch (e) { /* bad link */ }
    let last = null;
    try { last = JSON.parse(localStorage.getItem(STORE_LAST)); } catch (e) { /* no storage */ }
    // ?army= reaches an unfinished army for testing; the picker and "last used" only offer finished ones
    return pick(fromLink) || pick(new URLSearchParams(location.search).get('army')) || (listed(last) ? last : null) || 'necrons';
  })();
  const loadScript = (src) => new Promise((ok, fail) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = ok;
    el.onerror = () => fail(new Error(`Couldn't load ${src}`));
    document.head.append(el);
  });
  Promise.all([loadScript('js/data-common.js'), loadScript(`js/data-${FACTION}.js`)]).then(main, (err) => {
    document.querySelector('#editor').textContent = `${err.message}. Try reloading the page.`;
  });

  function main() {
  const DATA = window.ARMY_DATA[FACTION];
  // BSData armies share one weapons/wargear/rules file; every army gets its rules text for core rules
  const COMMON = window.ARMY_COMMON || { weapons: { ranged: [], melee: [] }, wargear: [], rules: {} };
  if (DATA.meta.shared === 'bsdata') {
    DATA.weapons = { ranged: DATA.weapons.ranged.concat(COMMON.weapons.ranged), melee: DATA.weapons.melee.concat(COMMON.weapons.melee) };
    DATA.wargear = DATA.wargear.concat(COMMON.wargear);
  }
  const E = window.NecronEngine.createEngine(DATA);
  // Necron lists keep their original storage key so nothing saved earlier is lost.
  const STORE_CUR = FACTION === 'necrons' ? 'necron30k.current' : `necron30k.current.${FACTION}`;
  const STORE_SAVED = 'necron30k.saved';
  const STORE_FOC = 'necron30k.primarySlots.v2'; // v1 held the pre-rulebook guess

  const $ = (sel, el) => (el || document).querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  // ---------- storage (never trust it to exist) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  // ---------- lookups ----------
  const { norm, wkey } = window.NecronEngine;
  const ruleIndex = new Map();
  function addRule(r, src) {
    if (!r || !r.name || !r.text) return;
    const k = norm(r.name);
    if (!ruleIndex.has(k)) ruleIndex.set(k, { name: r.name, text: r.text, page: r.page, src, core: !!r.core });
  }
  const R = DATA.rules || {};
  for (const key of ['specialRules', 'reactions', 'gambits', 'primeAdvantages', 'traits', 'unitTypes', 'powersOfTheCtan']) {
    for (const r of R[key] || []) addRule(r, key);
  }
  for (const w of DATA.wargear || []) addRule(w, 'wargear');
  for (const r of (DATA.sequelaEffects && DATA.sequelaEffects.rules) || []) addRule(r, 'sequela');
  for (const a of DATA.arkana || []) {
    addRule(a.harbinger, 'arkana');
    for (const w of a.wargear || []) addRule(w, 'arkana');
  }
  for (const u of DATA.units) for (const r of u.unitRules || []) addRule(Object.assign({ page: u.page }, r), 'unit');
  // core rules text from BSData fills in rules the codexes only name (Bulky, Deep Strike…)
  for (const key of ['specialRules', 'traits', 'reactions', 'gambits']) for (const r of (COMMON.rules || {})[key] || []) addRule(Object.assign({ core: true }, r), 'core');
  for (const w of COMMON.wargear || []) addRule(w, 'core');
  function findRule(name) {
    const k = norm(name);
    if (ruleIndex.has(k)) return ruleIndex.get(k);
    // "Implacable Advance" vs "Implacable Advance (Destroyers)" etc.
    for (const [key, r] of ruleIndex) if (key.startsWith(k) || k.startsWith(key)) return r;
    return null;
  }

  const weaponIndex = { ranged: new Map(), melee: new Map() };
  const W = DATA.weapons || { ranged: [], melee: [] };
  for (const kind of ['ranged', 'melee']) for (const w of W[kind] || []) weaponIndex[kind].set(wkey(w.name), w);
  const CORE = DATA.coreRules || { rules: [], undefinedInCodex: [] };
  const aliases = new Map(Object.entries(CORE.weaponAliases || {}).map(([k, v]) => [wkey(k), wkey(v)]));
  const coreNames = new Set((CORE.rules || []).map(norm));
  const undefinedNames = new Map((CORE.undefinedInCodex || []).flatMap((x) => [[norm(x.name), x.note], [wkey(x.name), x.note]]));
  function findWeapons(name) {
    const k = aliases.get(wkey(name)) || wkey(name);
    const r = { ranged: weaponIndex.ranged.get(k), melee: weaponIndex.melee.get(k) };
    if (!r.ranged && !r.melee && /^twin(-linked)? /.test(k)) return findWeapons(k.replace(/^twin(-linked)? /, ''));
    return r;
  }

  // ---------- army state ----------
  function defaultPrimarySlots() {
    return store.get(STORE_FOC, null) || (DATA.forceorg && DATA.forceorg.primary.slots) || [];
  }
  function expandSlots(defs) {
    const out = [];
    for (const d of defs) {
      const n = d.count ?? 1;
      for (let i = 0; i < n; i++) out.push({ role: d.role, prime: i < (d.prime || 0) });
    }
    return out;
  }
  function newArmy() {
    const primary = E.makeDetachment('primary', (DATA.forceorg && DATA.forceorg.primary.name) || 'Crusade Primary Detachment', expandSlots(defaultPrimarySlots()));
    return { version: 2, faction: FACTION, name: '', pointsLimit: 3000, sequelae: [], config: {}, detachments: [primary] };
  }

  let army = fromHash() || loadCurrent() || newArmy();
  let active = null; // slot uid

  function loadCurrent() {
    try { return sanitize(store.get(STORE_CUR, null)); } catch (e) { return null; }
  }

  function fromHash() {
    const m = location.hash.match(/#a=(.+)$/);
    if (!m) return null;
    try {
      const a = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      history.replaceState(null, '', location.pathname);
      return sanitize(a);
    } catch (e) { return null; }
  }

  function sanitize(a) {
    if (!a || !Array.isArray(a.detachments)) throw new Error('Not a list file');
    for (const d of a.detachments) {
      d.uid = d.uid || E.uid('d');
      for (const s of d.slots) {
        s.uid = s.uid || E.uid('s');
        if (s.unit && !E.unit(s.unit.unitId)) s.unit = null;
        if (s.unit) { s.unit.uid = s.unit.uid || E.uid('u'); s.unit.options = s.unit.options || {}; s.unit.counts = s.unit.counts || {}; }
      }
    }
    a.sequelae = a.sequelae || [];
    a.config = a.config && typeof a.config === 'object' ? a.config : {};
    a.faction = a.faction || 'necrons';
    if (a.faction !== FACTION) throw new Error(`That list is for ${ARMIES[a.faction] ? ARMIES[a.faction].name : a.faction}.`);
    if ((a.version || 1) < 2) migrateV1(a);
    return a;
  }

  /** v1 lists used a guessed primary layout; move them onto the real Crusade chart. */
  function migrateV1(a) {
    a.version = 2;
    const primary = a.detachments.find((d) => d.kind === 'primary');
    if (!primary) return;
    const orphans = rebuildSlots(primary, expandSlots(DATA.forceorg.primary.slots));
    if (orphans.length) a.detachments.push(orphanDetachment(orphans));
  }
  function orphanDetachment(orphans) {
    const d = E.makeDetachment('custom', 'Unplaced units', orphans.map((s) => ({ role: s.role, prime: s.prime })));
    d.slots.forEach((slot, i) => { slot.unit = orphans[i].unit; });
    return d;
  }

  function save() { store.set(STORE_CUR, army); }

  function findSlot(uid) {
    for (const d of army.detachments) for (const s of d.slots) if (s.uid === uid) return { det: d, slot: s };
    return null;
  }

  // ---------- render: header ----------
  function renderHeader() {
    const total = E.armyPoints(army);
    const limit = Number(army.pointsLimit) || 0;
    $('#points-total').textContent = total;
    $('#points-limit-label').textContent = limit || '∞';
    $('#points-bar').style.width = limit ? Math.min(100, (total / limit) * 100) + '%' : '0';
    $('#points-box').classList.toggle('over', !!limit && total > limit);
    $('#army-name').value = army.name || '';
    $('#points-limit').value = army.pointsLimit;
    const meta = DATA.meta || {};
    $('#data-version').textContent = `${meta.source || ''} · ${/^\d/.test(meta.version || '') ? 'v' : ''}${meta.version || '?'}`;
  }

  // ---------- render: sequelae ----------
  function renderSequelae() {
    const hasSeq = ((DATA.sequelae && DATA.sequelae.sequelae) || []).length > 0;
    $('#sequelae').closest('.panel').hidden = !hasSeq;
    if (!hasSeq) return;
    const allow = E.sequelaAllowance(army);
    $('#seq-allow').textContent = `${army.sequelae.length}/${allow}`;
    const list = (DATA.sequelae && DATA.sequelae.sequelae) || [];
    const wrap = h('<div class="seq-grid"></div>');
    for (const s of list) {
      const on = army.sequelae.includes(s.name);
      const el = h(`<label><input type="checkbox" ${on ? 'checked' : ''}> ${esc(s.name)} <button type="button" class="link info small" title="Rules">?</button></label>`);
      $('input', el).addEventListener('change', (e) => {
        if (e.target.checked) army.sequelae.push(s.name); else army.sequelae = army.sequelae.filter((n) => n !== s.name);
        refresh();
      });
      $('button', el).addEventListener('click', (e) => { e.preventDefault(); showText(s.name, s.text, s.page, s.restrictions); });
      wrap.append(el);
    }
    const box = $('#sequelae');
    box.replaceChildren(wrap);
    if (DATA.sequelae && DATA.sequelae.intro) {
      const more = h('<button type="button" class="link small">How Sequelae work</button>');
      more.addEventListener('click', () => showText('Aeonic Sequelae', DATA.sequelae.intro, 93));
      box.append(more);
    }
  }

  // ---------- render: army configuration (Legion Tactica, Rites of War, Cohort Doctrines…) ----------
  function renderConfig() {
    const cfg = DATA.armyConfig;
    const panel = $('#config-panel');
    panel.hidden = !cfg || (!cfg.fixed.length && !cfg.groups.length);
    if (panel.hidden) return;
    const box = $('#armyconfig');
    box.replaceChildren();
    if (cfg.fixed.length) {
      const chips = h('<div class="cfg-rules"></div>');
      for (const r of cfg.fixed) {
        if ((r.when || r.unless) && !E.available(r)) continue;
        const b = h(`<button type="button" class="chip rule" title="${esc(r.source || '')}">${esc(r.name)}</button>`);
        b.addEventListener('click', () => showText(r.name, r.text, null, r.source ? [r.source] : null));
        chips.append(b);
      }
      box.append(chips);
    }
    for (const g of cfg.groups) {
      // a choice that only comes with another (Panoply of Old → which Legion)
      if (g.when && !E.available(g)) { if ((army.config[g.id] || []).length) { army.config[g.id] = []; } continue; }
      const picked = (army.config[g.id] = army.config[g.id] || []);
      const gmax = E.configMax(g);
      const how = (g.min === gmax ? `choose ${gmax}` : g.min ? `choose ${g.min}–${gmax}` : `up to ${gmax}`) + ((g.maxWhen || []).length && gmax === g.max ? ` (${g.maxWhen.map((x) => `${x.max} with ${E.condText(x.when)}`).join(', ')})` : '');
      const fs = h(`<fieldset class="cfg-group"><legend>${esc(g.name)} <small class="muted">${how}</small></legend><div class="seq-grid"></div></fieldset>`);
      for (const c of g.choices) {
        const radio = gmax === 1;
        const blocked = c.unless && !picked.includes(c.name) && c.unless.find((k) => E.condOk(k));
        const el = h(`<label${blocked ? ` class="muted" title="Not with ${esc(E.condText(blocked))}"` : ''}><input type="${radio ? 'radio' : 'checkbox'}" name="cfg-${esc(g.id)}" ${picked.includes(c.name) ? 'checked' : ''} ${blocked ? 'disabled' : ''}> ${esc(c.name)} <button type="button" class="link info small" title="Rules">?</button></label>`);
        $('input', el).addEventListener('click', (e) => {
          if (radio) army.config[g.id] = picked.includes(c.name) && g.min === 0 ? [] : [c.name];
          else army.config[g.id] = e.target.checked ? picked.concat(c.name) : picked.filter((n) => n !== c.name);
          refresh();
        });
        $('button', el).addEventListener('click', (e) => { e.preventDefault(); showText(c.name, c.text); });
        $('.seq-grid', fs).append(el);
      }
      box.append(fs);
    }
  }
  function configLines() {
    const cfg = DATA.armyConfig;
    if (!cfg) return [];
    return cfg.groups.filter((g) => (army.config[g.id] || []).length).map((g) => `${g.name}: ${army.config[g.id].join(', ')}`);
  }

  // ---------- render: detachments ----------
  function renderDetachments() {
    const box = $('#detachments');
    box.replaceChildren();
    for (const d of army.detachments) {
      const def = d.defId ? (DATA.detachments || []).find((x) => x.id === d.defId) : null;
      const pts = d.slots.reduce((a, s) => a + (s.unit ? E.unitPoints(s.unit) : 0), 0);
      const el = h(`<div class="det">
        <div class="det-head"><span class="tag">${esc(d.kind)}</span><h3>${esc(d.name)}</h3><span class="pts muted">${pts} pts</span></div>
      </div>`);
      if (def && (def.unlock || (def.restrictions || []).length || (def.rules || []).length)) {
        const notes = h('<div class="det-notes"></div>');
        if (def.unlock) notes.append(h(`<div>${esc(def.unlock)}</div>`));
        if ((def.restrictions || []).length || (def.rules || []).length) {
          const ul = h('<ul></ul>');
          for (const r of def.restrictions || []) ul.append(h(`<li>${esc(r)}</li>`));
          for (const r of def.rules || []) ul.append(h(`<li><strong>${esc(r.name)}:</strong> ${esc(r.text)}</li>`));
          notes.append(ul);
        }
        el.append(notes);
      }
      const ul = h('<ul class="slots"></ul>');
      for (const s of d.slots) if (!d.hideEmpty || s.unit || s.uid === active) ul.append(slotRow(d, s));
      el.append(ul);
      const foot = h('<div class="det-foot"></div>');
      const empty = d.slots.filter((s) => !s.unit).length;
      const tog = h(`<button type="button" class="small">${d.hideEmpty ? `Show ${empty} empty slot${empty === 1 ? '' : 's'}` : 'Hide empty slots'}</button>`);
      tog.addEventListener('click', () => { d.hideEmpty = !d.hideEmpty; refresh(); });
      if (empty) foot.append(tog);
      if (d.kind === 'primary') {
        const b = h('<button type="button" class="small">Edit slots</button>');
        b.addEventListener('click', () => editPrimarySlots(d));
        foot.append(b);
      } else {
        if (d.kind === 'custom') {
          const b = h('<button type="button" class="small">Edit slots</button>');
          b.addEventListener('click', () => editCustomSlots(d));
          foot.append(b);
        }
        const rm = h('<button type="button" class="small danger">Remove detachment</button>');
        rm.addEventListener('click', () => {
          if (d.slots.some((s) => s.unit) && !confirm(`Remove ${d.name} and its units?`)) return;
          army.detachments = army.detachments.filter((x) => x !== d);
          refresh();
        });
        foot.append(rm);
      }
      el.append(foot);
      box.append(el);
    }
  }

  function slotRow(det, s) {
    const u = s.unit ? E.unit(s.unit.unitId) : null;
    const bad = s.unit && E.unitIssues(s.unit).some((i) => i.level === 'error');
    const label = s.advisor ? 'Advisor' : s.flexible ? 'Flexible' : s.logisticOf ? `${s.role} (Logistical)` : s.onlyLabel ? `${s.role} (${s.onlyLabel.replace(/\s+only$/i, '')})` : s.role;
    const el = h(`<li class="slot ${active === s.uid ? 'active' : ''}">
      <span class="role">${s.prime ? '<span class="prime" title="Prime slot">★</span>' : ''}${s.flexible ? '<span class="flex">◇</span>' : ''}${esc(label)}</span>
      <span class="name ${u ? '' : 'empty'}">${u ? esc(u.name) + (bad ? ' <span class="bad" title="Has problems">⚠</span>' : '') + (s.unit.primeAdvantage ? ` <small>· ${esc(s.unit.primeAdvantage)}</small>` : '') : '+ add unit'}</span>
      <span class="pts">${u ? E.unitPoints(s.unit) : ''}</span>
    </li>`);
    el.addEventListener('click', () => {
      if (u) { active = s.uid; refresh(); revealEditor(); } else pickUnit(det, s);
    });
    return el;
  }

  function addDetachmentMenu() {
    const sel = $('#add-det');
    sel.replaceChildren(h('<option value="">Choose…</option>'));
    const order = [
      ['Auxiliary', 'core', 'Auxiliary (core rules)'], ['Auxiliary', 'codex', `Auxiliary (${DATA.meta.name})`],
      ['Apex', 'core', 'Apex (core rules)'], ['Apex', 'codex', `Apex (${DATA.meta.name}${(DATA.sequelae && DATA.sequelae.sequelae || []).length ? ', via Aeonic Sequelae' : ''})`],
      ['Additional', 'codex', `Additional (${DATA.meta.name})`],
      ['Warlord', 'core', 'Warlord'], ['Lord of War', 'core', 'Lord of War'],
    ];
    for (const [type, src, label] of order) {
      const list = (DATA.detachments || []).filter((d) => d.type === type && (d.source === 'core') === (src === 'core'));
      if (!list.length) continue;
      const og = document.createElement('optgroup');
      og.label = label;
      for (const d of list) og.append(new Option(d.name + (d.unlockedBy && d.unlockedBy.sequela ? ` (${d.unlockedBy.sequela})` : '') + (d.when ? ` (with ${d.when.map(E.condText).join(' or ')})` : ''), d.id));
      sel.append(og);
    }
    const og = document.createElement('optgroup');
    og.label = 'Other';
    og.append(new Option('Custom detachment…', '__custom'));
    sel.append(og);
  }

  /** On narrow screens the editor sits below the army; bring it into view. */
  function revealEditor() {
    if (window.matchMedia('(max-width: 900px)').matches) $('#editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- pickers ----------
  function pickUnit(det, slot) {
    const units = E.unitsForSlot(slot, det).slice().sort((a, b) => (a.unique - b.unique) || a.name.localeCompare(b.name));
    const body = h(`<div><h2>${esc(slot.flexible ? 'Flexible slot' : slot.role)} <small>${esc(det.name)}</small></h2><div class="picker"></div></div>`);
    const list = $('.picker', body);
    if (!units.length) list.append(h('<p class="muted">No units fill this slot.</p>'));
    let lastRole = null;
    for (const u of units) {
      if (slot.flexible && u.role !== lastRole) { list.append(h(`<h4 class="muted">${esc(u.role)}</h4>`)); lastRole = u.role; }
      const taken = u.unique && E.allSelections(army).some((x) => x.sel.unitId === u.id);
      const alt = !slot.flexible && !slot.advisor && u.role !== slot.role ? ` <small class="muted">(${esc(u.role)}, via Sequela)</small>` : '';
      const b = h(`<button type="button" ${taken ? 'disabled' : ''}><span>${esc(u.name)}${alt}${u.unique ? ' <small class="muted">(character)</small>' : ''}${u.limit ? ` <small class="muted">${esc(u.limit)}</small>` : ''}</span><span class="muted">${u.basePoints} pts${u.page ? ` · ${esc(pageLabel(u))}` : ''}</span></button>`);
      b.addEventListener('click', () => {
        slot.unit = E.newSelection(u.id);
        // a detachment that only takes one Partisan / Clan presets the unit's choice
        const def = det.defId && (DATA.detachments || []).find((x) => x.id === det.defId);
        const forced = def && (def.slotRules || []).map((r) => r.trait && r.trait.replace(/[[\]]/g, '')).find((t) => t && E.ARKANA.includes(t));
        if (forced && slot.unit.arkana === null) slot.unit.arkana = forced;
        active = slot.uid;
        closeDialog();
        refresh();
        revealEditor();
      });
      list.append(b);
    }
    openDialog(body);
  }

  function editPrimarySlots(det) {
    const current = {};
    for (const s of det.slots) {
      if (s.advisor || s.logisticOf) continue;
      current[s.role] = current[s.role] || { count: 0, prime: 0 };
      current[s.role].count++;
      if (s.prime) current[s.role].prime++;
    }
    const body = h(`<div><h2>Primary Detachment slots</h2>
      <p class="muted">The Crusade chart is 1 High Command, 3 Command (1 Prime), 4 Troops (1 Prime) and 4 Transport. Only change it if another rule adds or converts slots. Dynastic Advisors and Logistical Benefit slots are added automatically.</p>
      <div class="table-wrap"><table class="stats"><thead><tr><th>Role</th><th>Slots</th><th>of which Prime</th></tr></thead><tbody></tbody></table></div></div>`);
    const tb = $('tbody', body);
    for (const role of E.ROLES) {
      const c = current[role] || { count: 0, prime: 0 };
      tb.append(h(`<tr><td>${esc(role)}</td><td><input type="number" min="0" max="12" data-role="${esc(role)}" data-k="count" value="${c.count}"></td><td><input type="number" min="0" max="12" data-role="${esc(role)}" data-k="prime" value="${c.prime}"></td></tr>`));
    }
    const apply = (defs) => {
      store.set(STORE_FOC, defs);
      placeOrphans(rebuildSlots(det, expandSlots(defs)));
      refresh();
    };
    openDialog(body, [
      ['Reset to Crusade chart', () => { try { localStorage.removeItem(STORE_FOC); } catch (e) { /* ignore */ } placeOrphans(rebuildSlots(det, expandSlots(DATA.forceorg.primary.slots))); refresh(); }],
      ['Apply', () => {
        const defs = [];
        for (const role of E.ROLES) {
          const count = +$(`input[data-role="${role}"][data-k=count]`, body).value || 0;
          const prime = Math.min(count, +$(`input[data-role="${role}"][data-k=prime]`, body).value || 0);
          if (count) defs.push({ role, count, prime });
        }
        apply(defs);
      }],
    ]);
  }

  /** Replace a detachment's slots, keeping units in slots of the same role where possible. Returns units that no longer fit. */
  function rebuildSlots(det, defs) {
    const extra = det.slots.filter((s) => s.advisor || s.logisticOf);
    const filled = det.slots.filter((s) => s.unit && !s.advisor && !s.logisticOf);
    const fresh = E.makeDetachment(det.kind, det.name, defs).slots;
    const orphans = [];
    for (const s of filled) {
      const target = fresh.find((f) => !f.unit && (f.role === s.role || f.flexible) && f.prime === s.prime) || fresh.find((f) => !f.unit && (f.role === s.role || f.flexible));
      if (target) target.unit = s.unit; else orphans.push(s);
    }
    det.slots = fresh.concat(extra);
    E.syncAdvisorSlots(det);
    return orphans;
  }

  /** Units that lost their slot go to a custom detachment instead of being deleted. */
  function placeOrphans(orphans) {
    if (!orphans.length) return;
    army.detachments.push(orphanDetachment(orphans));
    alert(`${orphans.length} unit(s) didn't fit the new slots and were moved to "Unplaced units": ${orphans.map((s) => E.unit(s.unit.unitId).name).join(', ')}. Move them into a detachment with a free slot, or remove them.`);
  }

  function editCustomSlots(det) {
    const body = h(`<div><h2>${esc(det.name)}</h2>
      <label>Name <input type="text" id="cd-name" value="${esc(det.name)}"></label>
      <p class="muted">One role per line. Prefix with * for a Prime slot, or write "Flexible".</p>
      <textarea id="cd-slots">${esc(det.slots.filter((s) => !s.advisor).map((s) => (s.prime ? '*' : '') + (s.flexible ? 'Flexible' : s.role)).join('\n'))}</textarea></div>`);
    openDialog(body, [['Apply', () => {
      det.name = $('#cd-name', body).value || 'Custom Detachment';
      placeOrphans(rebuildSlots(det, parseSlotLines($('#cd-slots', body).value)));
      refresh();
    }]]);
  }

  function parseSlotLines(txt) {
    const out = [];
    for (let line of txt.split('\n')) {
      line = line.trim();
      if (!line) continue;
      const prime = line.startsWith('*');
      const name = line.replace(/^\*/, '').trim();
      if (/^flex/i.test(name)) { out.push({ role: 'Flexible', flexible: true, prime, exclude: ['Command', 'High Command'] }); continue; }
      const role = E.ROLES.find((r) => r.toLowerCase() === name.toLowerCase());
      if (role) out.push({ role, prime });
    }
    return out;
  }

  // ---------- editor ----------
  function renderEditor() {
    const box = $('#editor');
    const found = active && findSlot(active);
    if (!found || !found.slot.unit) {
      box.className = 'panel empty';
      box.innerHTML = '<p>Pick a slot on the left to add a unit, or click a unit to edit it.</p>';
      return;
    }
    const { det, slot } = found;
    const sel = slot.unit;
    const u = E.unit(sel.unitId);
    box.className = 'panel';
    box.replaceChildren();

    box.append(h(`<div class="ed-head"><h2>${esc(u.name)}</h2><span class="pts">${E.unitPoints(sel)} pts</span></div>`));
    box.append(h(`<p class="ed-sub">${esc(u.role)} · ${esc(det.name)} · ${esc(u.composition || '')} · base ${u.basePoints} pts${u.page ? ` · ${esc(pageLabel(u))}` : ''}${u.unique ? ' · Dramatis Personae' : ''}</p>`));

    const issues = E.unitIssues(sel);
    if (issues.length) {
      const ul = h('<ul class="issues"></ul>');
      for (const i of issues) ul.append(h(`<li class="${i.level}">${esc(i.msg)}</li>`));
      box.append(ul);
    }

    // size
    const sizable = E.sizableModels(u);
    if (sizable.length) {
      const sec = section('Unit size');
      for (const m of sizable) {
        const n = sel.counts[m.name] ?? m.min;
        const max = E.modelMax(u, m);
        const row = h(`<div class="row"><span>${esc(m.name)}</span>${counter(n, m.min, Math.max(n, max))}<small class="muted">${m.min}–${max} · +${m.costPerExtra} pts each</small></div>`);
        bindCounter(row, (v) => { sel.counts[m.name] = v; clampOptions(sel); refresh(); });
        sec.append(row);
      }
      box.append(sec);
    }

    // arkana
    if (u.cryptoArkana && !u.fixedArkana) {
      const sec = section(E.choiceLabel);
      const s = h(`<select><option value="">Choose…</option>${E.ARKANA.map((a) => `<option ${sel.arkana === a ? 'selected' : ''}>${a}</option>`).join('')}</select>`);
      s.addEventListener('change', () => { sel.arkana = s.value || null; clampOptions(sel); refresh(); });
      const row = h('<div class="row"></div>');
      row.append(s);
      const ark = (DATA.arkana || []).find((a) => a.name === sel.arkana);
      if (ark && ark.harbinger) {
        const b = h(`<button type="button" class="link small">${esc(ark.harbinger.name)}</button>`);
        b.addEventListener('click', () => showText(ark.harbinger.name, ark.harbinger.text, ark.page));
        row.append(b);
      }
      sec.append(row);
      box.append(sec);
    } else if (u.fixedArkana) {
      box.append(h(`<p class="muted">${esc(E.choiceLabel)}: ${esc(u.fixedArkana)}</p>`));
    }

    // options
    const opts = E.optionsOf(sel);
    if (opts.length) {
      const sec = section('Options');
      for (const o of opts) sec.append(optionEl(u, sel, o));
      box.append(sec);
    }

    // prime
    if (slot.prime || sel.primeAdvantage) {
      const sec = section('Prime Advantage');
      const advs = primeAdvantages(u, det, sel, slot);
      const s = h(`<select><option value="">None</option>${advs.map((a) => `<option value="${esc(a.name)}" ${sel.primeAdvantage === a.name ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select>`);
      s.addEventListener('change', () => { sel.primeAdvantage = s.value || null; E.syncAdvisorSlots(det); refresh(); });
      const row = h('<div class="row"></div>');
      row.append(s);
      const cur = advs.find((a) => a.name === sel.primeAdvantage);
      if (cur && cur.text) row.append(h(`<small class="muted">${esc(cur.text)}</small>`));
      sec.append(row);
      const adder = E.slotAdder(sel.primeAdvantage);
      if (sel.primeAdvantage === 'Logistical Benefit' || (adder && adder.chooseRole)) {
        const roles = adder && adder.roles ? adder.roles : E.ROLES.filter((r) => !['High Command', 'Command', 'Warlord', 'Lord of War'].includes(r));
        const rs = h(`<label class="row">Extra slot <select><option value="">Choose a role…</option>${roles.map((r) => `<option ${sel.logisticalRole === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>`);
        $('select', rs).addEventListener('change', (e) => { sel.logisticalRole = e.target.value || null; E.syncAdvisorSlots(det); refresh(); });
        sec.append(rs);
      }
      box.append(sec);
    }

    renderUnitReference(box, u, sel, slot);

    const acts = h('<div class="row ed-section"></div>');
    const dup = h('<button type="button">Duplicate</button>');
    dup.addEventListener('click', () => {
      const target = det.slots.find((s) => !s.unit && (s.role === slot.role || s.flexible)) || army.detachments.flatMap((d) => d.slots).find((s) => !s.unit && s.role === slot.role);
      if (!target) return alert('No empty ' + slot.role + ' slot left.');
      target.unit = JSON.parse(JSON.stringify(sel));
      target.unit.uid = E.uid('u');
      target.unit.primeAdvantage = null;
      active = target.uid;
      refresh();
    });
    const rm = h('<button type="button" class="danger">Remove unit</button>');
    rm.addEventListener('click', () => { slot.unit = null; active = null; E.syncAdvisorSlots(det); refresh(); });
    acts.append(dup, rm);
    box.append(acts);
  }

  function primeAdvantages(u, det, sel, slot) {
    return E.primeAdvantagesFor(sel, army, slot).map((a) => Object.assign({}, a, { name: a.name, label: a.grantedBy ? `${a.name} (${a.grantedBy})` : a.name }));
  }

  function section(title) {
    const el = h(`<div class="ed-section"><h4>${esc(title)}</h4></div>`);
    return el;
  }

  function counter(v, min, max) {
    return `<span class="counter" data-min="${min}" data-max="${max}"><button type="button" data-d="-1" ${v <= min ? 'disabled' : ''}>−</button><output>${v}</output><button type="button" data-d="1" ${v >= max ? 'disabled' : ''}>+</button></span>`;
  }
  function bindCounter(root, cb) {
    for (const c of root.querySelectorAll('.counter')) {
      const min = +c.dataset.min, max = +c.dataset.max;
      for (const b of c.querySelectorAll('button')) {
        b.addEventListener('click', () => {
          const v = Math.max(min, Math.min(max, +$('output', c).value + +b.dataset.d));
          cb(v);
        });
      }
    }
  }

  function optionEl(u, sel, o) {
    const choices = E.choicesFor(o, sel);
    const val = sel.options[o.id];
    const el = h(`<div class="opt"><div class="txt">${esc(o.text)}</div><div class="choices"></div></div>`);
    const list = $('.choices', el);
    const cost = (p, c) => (c && c.pointsUnknown ? '+? (not printed)' : p ? `+${p}` : 'free');
    const name = `o-${sel.uid}-${o.id}`;
    const blocked = (o.excludes || []).some((id) => isTaken(sel.options[id]));
    const locked = (o.requires && !E.requirementMet(o, sel)) || (blocked && !isTaken(sel.options[o.id]));
    if (locked) el.append(h(`<div class="cap">${blocked ? 'Not available with another option you took.' : `Needs ${esc(o.requiresChoice || 'the option above')} first.`}</div>`));
    if (!choices.length && (o.kind === 'one' || o.kind === 'any' || o.kind === 'perModel')) {
      list.append(h(`<div class="cap">${u.cryptoArkana && !sel.arkana ? `Choose a ${esc(E.choiceLabel)} first.` : 'No choices available.'}</div>`));
    }
    switch (o.kind) {
      case 'one': {
        const keep = o.replaces && o.replaces.length ? 'Keep ' + o.replaces.join(' & ') : 'None';
        list.append(radio(name, '', !val, keep, ''));
        for (const c of choices) list.append(radio(name, c.name, val === c.name, c.name, cost(c.points, c)));
        if (locked) list.querySelectorAll('input').forEach((i) => { i.disabled = true; });
        list.addEventListener('change', (e) => { sel.options[o.id] = e.target.value || null; refresh(); });
        break;
      }
      case 'any': {
        const cur = Array.isArray(val) ? val : [];
        for (const c of choices) {
          const r = h(`<label class="choice"><input type="checkbox" ${cur.includes(c.name) ? 'checked' : ''} ${locked ? 'disabled' : ''}> ${esc(c.name)}<span class="cost">${cost(c.points)}</span></label>`);
          $('input', r).addEventListener('change', (e) => {
            const s = new Set(Array.isArray(sel.options[o.id]) ? sel.options[o.id] : []);
            if (e.target.checked) s.add(c.name); else s.delete(c.name);
            sel.options[o.id] = [...s];
            refresh();
          });
          list.append(r);
        }
        break;
      }
      case 'upgrade': {
        const c = choices[0] || { name: o.text, points: 0 };
        const r = h(`<label class="choice"><input type="checkbox" ${val ? 'checked' : ''} ${locked ? 'disabled' : ''}> ${esc(c.name)}<span class="cost">${cost(c.points)}</span></label>`);
        $('input', r).addEventListener('change', (e) => { sel.options[o.id] = e.target.checked; refresh(); });
        list.append(r);
        break;
      }
      case 'perModel': {
        const cur = val && typeof val === 'object' ? val : {};
        const max = E.optionMax(o, sel);
        const used = E.perModelUsed(cur);
        const noun = o.perWeapon ? 'weapon' : 'model';
        el.append(h(`<div class="cap">${used}/${max} ${noun}${max === 1 ? '' : 's'}</div>`));
        if (used > max) el.classList.add('bad');
        for (const c of choices) {
          const n = cur[c.name] || 0;
          const r = h(`<div class="choice">${counter(n, 0, locked ? n : n + Math.max(0, max - used))} ${esc(c.name)}<span class="cost">${cost(c.points)} each</span></div>`);
          bindCounter(r, (v) => { sel.options[o.id] = Object.assign({}, sel.options[o.id], { [c.name]: v }); refresh(); });
          list.append(r);
        }
        break;
      }
      case 'swapModel': {
        const n = Number(val) || 0;
        const max = E.optionMax(o, sel);
        const c = choices[0] || { name: '?', points: 0 };
        const r = h(`<div class="choice">${counter(n, 0, Math.max(n, max))} → ${esc(c.name)}<span class="cost">${cost(c.points)} each</span></div>`);
        bindCounter(r, (v) => { sel.options[o.id] = v; clampOptions(sel); refresh(); });
        list.append(r);
        break;
      }
      default:
        list.append(h(`<div class="cap">Unsupported option type “${esc(o.kind)}”.</div>`));
    }
    if (E.unitIssues(sel).some((i) => i.msg.includes(o.text.slice(0, 40)))) el.classList.add('bad');
    return el;
  }

  function radio(name, value, checked, label, cost) {
    return h(`<label class="choice"><input type="radio" name="${esc(name)}" value="${esc(value)}" ${checked ? 'checked' : ''}> ${esc(label)}<span class="cost">${esc(cost)}</span></label>`);
  }

  function isTaken(v) {
    if (v == null || v === false || v === '' || v === 0) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.values(v).some((n) => n > 0);
    return true;
  }

  /** After a size or arkana change, trim option picks that no longer fit. */
  function clampOptions(sel) {
    const u = E.unit(sel.unitId);
    for (const o of E.optionsOf(sel)) {
      const v = sel.options[o.id];
      if (v == null) continue;
      if (o.requires && !E.requirementMet(o, sel)) { sel.options[o.id] = null; continue; }
      const names = new Set(E.choicesFor(o, sel).map((c) => c.name));
      if (o.kind === 'one' && v && !names.has(v)) sel.options[o.id] = null;
      if (o.kind === 'any' && Array.isArray(v)) sel.options[o.id] = v.filter((n) => names.has(n));
      if (o.kind === 'swapModel') sel.options[o.id] = Math.min(Number(v) || 0, E.optionMax(o, sel));
      if (o.kind === 'perModel' && typeof v === 'object') {
        const max = E.optionMax(o, sel);
        let left = max;
        const out = {};
        for (const [n, c] of Object.entries(v)) {
          if (!names.has(n)) continue;
          out[n] = Math.min(c, left);
          left -= out[n];
        }
        sel.options[o.id] = out;
      }
    }
  }

  // ---------- unit reference (profiles, weapons, rules) ----------
  /** Statlines after battlefield modifiers; changed values are highlighted, originals in the tooltip. */
  function profileTable(u, sel, slot) {
    const rows = E.effectiveModels(sel, slot);
    if (!rows.length) return '';
    const groups = {};
    let html = '';
    for (const r of rows) {
      const vals = Object.values(r.profile || {});
      // Super-heavy walkers (e.g. the Stompa) print one line per location: { HEAD: {...}, LEGS: {...} }
      if (vals.length && vals.every((v) => v && typeof v === 'object')) {
        const cols = Object.keys(vals[0]);
        html += `<div class="table-wrap"><table class="stats"><thead><tr><th>${r.count}× ${esc(r.name)}</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>`;
        for (const [loc, v] of Object.entries(r.profile)) html += `<tr><td>${esc(loc.charAt(0) + loc.slice(1).toLowerCase())}</td>${cols.map((c) => `<td>${esc(v[c])}</td>`).join('')}</tr>`;
        html += '</tbody></table></div>';
        continue;
      }
      const keys = Object.keys(r.profile || {}).join(',');
      (groups[keys] = groups[keys] || []).push(r);
    }
    for (const [keys, rs] of Object.entries(groups)) {
      const cols = keys ? keys.split(',') : [];
      html += `<div class="table-wrap"><table class="stats"><thead><tr><th>Model</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>`;
      for (const r of rs) {
        html += `<tr><td>${r.count}× ${esc(r.name)}</td>${cols.map((c) => r.changed[c]
          ? `<td class="mod" title="Base ${esc(r.baseProfile[c] ?? '–')}">${esc(r.profile[c])}</td>`
          : `<td>${esc(r.profile[c])}</td>`).join('')}</tr>`;
      }
      html += '</tbody></table></div>';
    }
    return html;
  }

  function weaponNamesFor(u, sel) {
    const names = [];
    const add = (n) => { if (n && !names.includes(n)) names.push(n); };
    const rows = sel ? E.loadout(sel) : u.models.map((m) => ({ base: m.wargear || [], changes: [] }));
    for (const r of rows) {
      const replaced = new Set(r.changes.filter((c) => c.replaces && c.count >= (r.count || 1)).flatMap((c) => c.replaces.split(' & ')));
      for (const w of r.base) if (!replaced.has(w)) add(w);
      for (const c of r.changes) add(c.name);
    }
    return names;
  }

  function weaponTable(names) {
    const ranged = [], melee = [], other = [];
    for (const n of names) {
      const f = findWeapons(n);
      if (f.ranged) ranged.push(f.ranged);
      if (f.melee) melee.push(f.melee);
      if (!f.ranged && !f.melee) other.push(n);
    }
    const sr = (w) => [...(w.specialRules || [])].join(', ');
    const tr = (w) => [...(w.traits || [])].join(', ');
    let html = '';
    if (ranged.length) {
      html += '<div class="table-wrap"><table class="stats"><thead><tr><th>Ranged</th><th>R</th><th>FP</th><th>RS</th><th>AP</th><th>D</th><th>Special rules</th><th>Traits</th></tr></thead><tbody>';
      for (const w of ranged) {
        if (w.modes && w.modes.length) {
          html += `<tr><td colspan="6"><strong>${esc(w.name)}</strong></td><td>${esc(sr(w))}</td><td>${esc(tr(w))}</td></tr>`;
          for (const m of w.modes) html += `<tr><td>– ${esc(m.name)}</td><td>${esc(m.R)}</td><td>${esc(m.FP)}</td><td>${esc(m.RS)}</td><td>${esc(m.AP)}</td><td>${esc(m.D)}</td><td>${esc(sr(m))}</td><td>${esc(tr(m))}</td></tr>`;
        } else html += `<tr><td>${esc(w.name)}</td><td>${esc(w.R)}</td><td>${esc(w.FP)}</td><td>${esc(w.RS)}</td><td>${esc(w.AP)}</td><td>${esc(w.D)}</td><td>${esc(sr(w))}</td><td>${esc(tr(w))}</td></tr>`;
      }
      html += '</tbody></table></div>';
    }
    if (melee.length) {
      html += '<div class="table-wrap"><table class="stats"><thead><tr><th>Melee</th><th>IM</th><th>AM</th><th>SM</th><th>AP</th><th>D</th><th>Special rules</th><th>Traits</th></tr></thead><tbody>';
      for (const w of melee) {
        const rows = w.modes && w.modes.length ? w.modes.map((m) => Object.assign({}, m, { name: w.name + ' – ' + m.name })) : [w];
        for (const m of rows) html += `<tr><td>${esc(m.name)}</td><td>${esc(m.IM)}</td><td>${esc(m.AM)}</td><td>${esc(m.SM)}</td><td>${esc(m.AP)}</td><td>${esc(m.D)}</td><td>${esc(sr(m))}</td><td>${esc(tr(m))}</td></tr>`;
      }
      html += '</tbody></table></div>';
    }
    return { html, other };
  }

  /** Rule names for the unit after modifiers: {names, added:Set, removed:[]}. */
  function unitRules(u, sel, slot) {
    const names = [];
    const added = new Set();
    const removed = [];
    const add = (n) => { if (n && !names.includes(n)) names.push(n); };
    for (const r of E.effectiveModels(sel, slot)) {
      for (const n of r.rules) add(n);
      for (const n of r.added) added.add(n);
      for (const n of r.removed) if (!removed.includes(n)) removed.push(n);
    }
    for (const r of u.unitRules || []) if (!removed.some((x) => norm(x) === norm(r.name))) add(r.name);
    const ark = E.arkanaOf(sel);
    const a = ark && (DATA.arkana || []).find((x) => x.name === ark);
    if (a && a.harbinger) add(a.harbinger.name);
    return { names, added, removed };
  }
  function unitRuleNames(u, sel, slot) { return unitRules(u, sel, slot).names; }

  function reminders(sel, slot) {
    const seen = new Set();
    const out = [];
    for (const r of E.effectiveModels(sel, slot)) for (const x of r.reminders) if (!seen.has(x.text)) { seen.add(x.text); out.push(x); }
    return out;
  }

  function renderUnitReference(box, u, sel, slot) {
    const sec = section('Profile');
    sec.insertAdjacentHTML('beforeend', profileTable(u, sel, slot));
    const eff = E.effectiveModels(sel, slot);
    const types = [...new Set(eff.map((m) => m.unitType).filter(Boolean))];
    const traits = [...new Set(eff.flatMap((m) => m.traits))];
    const addedTraits = new Set(eff.flatMap((m) => m.addedTraits));
    sec.insertAdjacentHTML('beforeend', `<p class="muted">Type: ${esc(types.join('; '))}${traits.length ? ' · Traits: ' + traits.map((t) => addedTraits.has(t) ? `<span class="gained">${esc(t)}</span>` : esc(t)).join(', ') : ''}</p>`);
    if (eff.some((m) => Object.keys(m.changed).length)) sec.insertAdjacentHTML('beforeend', '<p class="muted small-note">Highlighted values are modified by wargear, arkana or Sequelae; hover for the base value.</p>');
    box.append(sec);

    const lo = section('Wargear');
    const ul = h('<ul class="loadout"></ul>');
    for (const r of E.loadout(sel)) {
      const chg = r.changes.map((c) => `<span class="chg">${c.count > 1 ? c.count + '× ' : ''}${esc(c.name)}${c.replaces ? ` <small>(for ${esc(c.replaces)})</small>` : ''}</span>`);
      ul.append(h(`<li><strong>${r.count}× ${esc(r.model)}</strong>: ${esc(r.base.join(', ') || '—')}${chg.length ? ' · ' + chg.join(', ') : ''}</li>`));
    }
    lo.append(ul);
    const wt = weaponTable(weaponNamesFor(u, sel));
    lo.insertAdjacentHTML('beforeend', wt.html);
    if (wt.other.length) lo.append(chips(wt.other));
    box.append(lo);

    const rs = section('Special rules');
    const ur = unitRules(u, sel, slot);
    rs.append(chips(ur.names, ur.added));
    if (ur.removed.length) rs.append(h(`<p class="muted">Lost: ${ur.removed.map((r) => `<s>${esc(r)}</s>`).join(', ')}</p>`));
    const rem = reminders(sel, slot);
    if (rem.length) {
      const ul = h('<ul class="reminders"></ul>');
      for (const r of rem) ul.append(h(`<li><strong>${esc(r.source.name)}</strong> <small>(${esc(r.condition)})</small>: ${esc(r.text)}</li>`));
      const box2 = section('Situational effects');
      box2.append(ul);
      box.append(rs);
      box.append(box2);
      if (u.note) box2.append(h(`<p class="muted">Note: ${esc(u.note)}</p>`));
      return;
    }
    if (u.note) rs.append(h(`<p class="muted">Note: ${esc(u.note)}</p>`));
    box.append(rs);
  }

  function chips(names, gained) {
    const wrap = h('<div class="chips"></div>');
    for (const n of names) {
      const r = findRule(n);
      const k = undefinedNames.has(norm(n)) || coreNames.has(norm(n)) ? norm(n) : undefinedNames.has(wkey(n)) ? wkey(n) : norm(n);
      const tip = r ? 'Show rule' : coreNames.has(k) ? 'Core rule: see the Horus Heresy 3rd edition rulebook' : undefinedNames.has(k) ? 'Not printed in the codex: ' + undefinedNames.get(k) : 'No rules text found';
      const c = h(`<span class="chip ${gained && gained.has(n) ? 'gained ' : ''}${r ? 'rule' : coreNames.has(k) ? 'core' : 'missing'}" title="${esc(tip)}">${esc(n)}${coreNames.has(k) && !r ? ' <small>core</small>' : ''}</span>`);
      if (r) c.addEventListener('click', () => showText(n, r.text, r.page ? pageLabel(r) : null));
      wrap.append(c);
    }
    return wrap;
  }

  // ---------- issues ----------
  function renderIssues() {
    const issues = E.armyIssues(army);
    const ul = $('#issues');
    ul.replaceChildren();
    const errs = issues.filter((i) => i.level === 'error').length;
    $('#issue-count').textContent = issues.length ? `${errs} error${errs === 1 ? '' : 's'}, ${issues.length - errs} warning${issues.length - errs === 1 ? '' : 's'}` : '';
    if (!issues.length) ul.append(h('<li class="ok">No problems found.</li>'));
    const seen = new Set();
    for (const i of issues) {
      if (seen.has(i.msg)) continue;
      seen.add(i.msg);
      ul.append(h(`<li class="${i.level}">${esc(i.msg)}</li>`));
    }
  }

  // ---------- dialogs ----------
  function openDialog(bodyEl, actions) {
    const dlg = $('#dlg');
    $('#dlg-body').replaceChildren(bodyEl);
    const acts = $('#dlg-actions');
    acts.replaceChildren();
    for (const [label, fn] of actions || []) {
      const b = h(`<button type="button" class="primary">${esc(label)}</button>`);
      b.addEventListener('click', () => { if (fn() !== false) closeDialog(); });
      acts.append(b);
    }
    acts.append(h('<button value="close">Close</button>'));
    if (!dlg.open) dlg.showModal();
  }
  function closeDialog() { const d = $('#dlg'); if (d.open) d.close(); }

  /** "Liber Astartes p.112", or "p.14" when the book isn't known */
  function pageLabel(x) { return `${x.book ? x.book + ' ' : ''}p.${x.page}`; }

  function showText(title, text, page, extra) {
    const pl = page == null || page === '' ? '' : /^\d/.test(String(page)) ? `p.${page}` : String(page);
    const body = h(`<div><h2>${esc(title)}${pl ? ` <small>${esc(pl)}</small>` : ''}</h2><div class="dlg-body-scroll"><p class="rule-text">${esc(text || 'No text.')}</p></div></div>`);
    if (extra && extra.length) {
      const ul = h('<ul></ul>');
      for (const x of extra) ul.append(h(`<li>${esc(x)}</li>`));
      $('.dlg-body-scroll', body).append(ul);
    }
    openDialog(body);
  }

  // ---------- export / import ----------
  function textExport() {
    const lines = [];
    const total = E.armyPoints(army);
    lines.push(`${army.name || 'Unnamed army'} — ${total}/${army.pointsLimit} pts`);
    lines.push(`${DATA.meta.name} (${DATA.meta.source} ${DATA.meta.version})`);
    if (army.sequelae.length) lines.push('Aeonic Sequelae: ' + army.sequelae.join(', '));
    lines.push(...configLines());
    for (const d of army.detachments) {
      const units = d.slots.filter((s) => s.unit);
      if (!units.length) continue;
      lines.push('', `== ${d.name} ==`);
      for (const s of units) {
        const u = E.unit(s.unit.unitId);
        const extras = [];
        if (s.prime) extras.push('Prime' + (s.unit.primeAdvantage ? ': ' + s.unit.primeAdvantage : ''));
        const ark = E.arkanaOf(s.unit);
        if (ark) extras.push(ark);
        lines.push(`[${s.advisor ? 'Command (Advisor)' : s.flexible ? 'Flexible' : s.role}] ${u.name}${extras.length ? ' (' + extras.join(', ') + ')' : ''} — ${E.unitPoints(s.unit)} pts`);
        for (const r of E.loadout(s.unit)) {
          const chg = r.changes.map((c) => `${c.count > 1 ? c.count + 'x ' : ''}${c.name}${c.replaces ? ' (for ' + c.replaces + ')' : ''}`);
          lines.push(`    ${r.count}x ${r.model}: ${r.base.join(', ')}${chg.length ? '; ' + chg.join(', ') : ''}`);
        }
      }
    }
    return lines.join('\n');
  }

  function shareLink() {
    const json = JSON.stringify(army);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return location.origin + location.pathname + '#a=' + b64;
  }

  function doExport() {
    const body = h(`<div><h2>Export</h2>
      <div class="row"><button type="button" data-f="text" class="primary">Text</button><button type="button" data-f="json">JSON</button><button type="button" data-f="link">Share link</button></div>
      <textarea readonly></textarea></div>`);
    const ta = $('textarea', body);
    const set = (f) => { ta.value = f === 'json' ? JSON.stringify(army, null, 2) : f === 'link' ? shareLink() : textExport(); };
    body.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => set(b.dataset.f)));
    set('text');
    openDialog(body, [
      ['Copy', () => { ta.select(); try { navigator.clipboard.writeText(ta.value); } catch (e) { document.execCommand('copy'); } return false; }],
      ['Download JSON', () => {
        const blob = new Blob([JSON.stringify(army, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (army.name || 'necron-army').replace(/[^\w-]+/g, '_') + '.json';
        a.click();
        return false;
      }],
    ]);
  }

  function doImport() {
    const body = h(`<div><h2>Import</h2><p class="muted">Paste list JSON or a share link, or choose a file.</p><input type="file" accept=".json,application/json"><textarea></textarea></div>`);
    $('input', body).addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) $('textarea', body).value = await f.text(); });
    openDialog(body, [['Import', () => {
      let txt = $('textarea', body).value.trim();
      try {
        const m = txt.match(/#a=(.+)$/);
        if (m) txt = decodeURIComponent(escape(atob(m[1])));
        const parsed = JSON.parse(txt);
        if ((parsed.faction || 'necrons') !== FACTION) { switchArmy(parsed.faction || 'necrons', parsed); return; }
        army = sanitize(parsed);
        active = null;
        refresh();
      } catch (e) { alert('Could not read that list: ' + e.message); return false; }
    }]]);
  }

  function doSave() {
    const name = prompt('Save list as:', army.name || `My ${DATA.meta.name}`);
    if (!name) return;
    const saved = store.get(STORE_SAVED, {});
    saved[name] = Object.assign({}, army, { savedAt: new Date().toISOString() });
    store.set(STORE_SAVED, saved);
  }

  function doLoad() {
    const saved = store.get(STORE_SAVED, {});
    const names = Object.keys(saved).sort();
    const body = h('<div><h2>Saved lists</h2><div class="picker"></div></div>');
    const list = $('.picker', body);
    if (!names.length) list.append(h('<p class="muted">Nothing saved in this browser yet.</p>'));
    for (const n of names) {
      const a = saved[n];
      const fac = a.faction || 'necrons';
      const other = fac !== FACTION;
      const facName = ARMIES[fac] ? ARMIES[fac].name : fac;
      const row = h(`<div class="row"><button type="button" style="flex:1"><span>${esc(n)}</span><span class="muted">${esc(facName)} · ${other ? '' : E.armyPoints(a) + ' pts · '}${esc((a.savedAt || '').slice(0, 10))}</span></button><button type="button" class="small danger">Delete</button></div>`);
      row.children[0].addEventListener('click', () => {
        if (other) { switchArmy(fac, JSON.parse(JSON.stringify(a))); return; }
        army = sanitize(JSON.parse(JSON.stringify(a))); active = null; closeDialog(); refresh();
      });
      row.children[1].addEventListener('click', () => { if (!confirm('Delete ' + n + '?')) return; delete saved[n]; store.set(STORE_SAVED, saved); row.remove(); });
      list.append(row);
    }
    openDialog(body);
  }

  // ---------- roster ----------
  function renderRoster() {
    const el = $('#roster');
    const total = E.armyPoints(army);
    const issues = E.armyIssues(army);
    let html = `<div class="r-bar"><button type="button" id="r-print">Print</button><button type="button" id="r-close">Close</button></div>`;
    html += `<h1>${esc(army.name || 'Unnamed army')} <span class="muted">— ${total}/${esc(army.pointsLimit)} pts</span></h1>`;
    html += `<p class="muted">${esc((DATA.meta && DATA.meta.source) || '')} v${esc((DATA.meta && DATA.meta.version) || '')}${army.sequelae.length ? ' · Aeonic Sequelae: ' + esc(army.sequelae.join(', ')) : ''}</p>`;
    const cl = configLines();
    if (cl.length) html += `<p>${cl.map(esc).join('<br>')}</p>`;
    if (issues.some((i) => i.level === 'error')) html += `<p style="color:#b00">This list has ${issues.filter((i) => i.level === 'error').length} rules problem(s).</p>`;
    const glossary = new Map();
    const cfg = DATA.armyConfig;
    if (cfg) {
      for (const r of cfg.fixed) glossary.set(r.name, { name: r.name, text: r.text });
      for (const g of cfg.groups) for (const c of g.choices) if ((army.config[g.id] || []).includes(c.name) && c.text) glossary.set(c.name, { name: c.name, text: c.text });
    }
    for (const d of army.detachments) {
      const units = d.slots.filter((s) => s.unit);
      if (!units.length) continue;
      html += `<h2>${esc(d.name)}</h2>`;
      for (const s of units) {
        const u = E.unit(s.unit.unitId);
        const ark = E.arkanaOf(s.unit);
        html += `<div class="r-unit"><h3><span>${esc(u.name)} <small class="muted">${esc(s.flexible ? 'Flexible' : s.role)}${s.prime ? ' · Prime' + (s.unit.primeAdvantage ? ': ' + esc(s.unit.primeAdvantage) : '') : ''}${ark ? ' · ' + esc(ark) : ''}</small></span><span>${E.unitPoints(s.unit)} pts</span></h3>`;
        html += profileTable(u, s.unit, s);
        html += '<ul class="loadout">';
        for (const r of E.loadout(s.unit)) {
          const chg = r.changes.map((c) => `${c.count > 1 ? c.count + '× ' : ''}${esc(c.name)}${c.replaces ? ' (for ' + esc(c.replaces) + ')' : ''}`);
          html += `<li><strong>${r.count}× ${esc(r.model)}</strong>: ${esc(r.base.join(', '))}${chg.length ? '; ' + chg.join(', ') : ''}</li>`;
        }
        html += '</ul>';
        const wt = weaponTable(weaponNamesFor(u, s.unit));
        html += wt.html;
        const rules = unitRuleNames(u, s.unit, s).concat(wt.other);
        const rem = reminders(s.unit, s);
        html += `<div class="r-rules"><strong>Rules:</strong> ${esc(rules.join(', '))}</div>`;
        if (rem.length) html += `<div class="r-rules"><strong>Situational:</strong> ${rem.map((r) => `${esc(r.source.name)} (${esc(r.condition)})`).join('; ')}</div>`;
        for (const r of rules) { const f = findRule(r); if (f) glossary.set(f.name, f); }
        html += '</div>';
      }
    }
    if (glossary.size) {
      html += '<h2>Rules reference</h2><dl class="r-glossary">';
      for (const r of [...glossary.values()].sort((a, b) => a.name.localeCompare(b.name))) html += `<dt>${esc(r.name)}${r.page ? ` <span class="muted">${esc(pageLabel(r))}</span>` : ''}</dt><dd>${esc(r.text)}</dd>`;
      html += '</dl>';
    }
    el.innerHTML = html;
    el.hidden = false;
    $('#r-close', el).addEventListener('click', () => { el.hidden = true; });
    $('#r-print', el).addEventListener('click', () => window.print());
  }

  // ---------- wiring ----------
  function refresh() {
    E.setArmy(army);
    for (const x of E.allSelections(army)) clampOptions(x.sel);
    save();
    renderHeader();
    renderSequelae();
    renderConfig();
    renderDetachments();
    renderIssues();
    renderEditor();
  }

  $('#army-name').addEventListener('input', (e) => { army.name = e.target.value; save(); });
  $('#points-limit').addEventListener('change', (e) => { army.pointsLimit = Math.max(0, +e.target.value || 0); refresh(); });
  $('#btn-new').addEventListener('click', () => { if (confirm('Start a new list? Unsaved changes to this one are lost.')) { army = newArmy(); active = null; refresh(); } });
  $('#btn-save').addEventListener('click', doSave);
  $('#btn-load').addEventListener('click', doLoad);
  $('#btn-export').addEventListener('click', doExport);
  $('#btn-import').addEventListener('click', doImport);
  $('#btn-roster').addEventListener('click', renderRoster);
  $('#add-det').addEventListener('change', (e) => {
    const v = e.target.value;
    e.target.value = '';
    if (!v) return;
    if (v === '__custom') {
      const d = E.makeDetachment('custom', 'Custom Detachment', []);
      army.detachments.push(d);
      refresh();
      editCustomSlots(d);
      return;
    }
    army.detachments.push(E.detachmentFromDef(v));
    refresh();
  });

  /** Armies load one per page: stash the list for the other army, then reload with it. */
  function switchArmy(id, list) {
    if (!ARMIES[id]) { alert(`This builder doesn't have the ${id} army.`); return; }
    save();
    if (list) store.set(id === 'necrons' ? 'necron30k.current' : `necron30k.current.${id}`, list);
    store.set(STORE_LAST, id);
    location.href = location.pathname + '?army=' + encodeURIComponent(id);
  }

  const armySel = $('#army-select');
  const groups = {};
  for (const a of window.ARMY_INDEX || []) {
    if (!((a.units && a.ready !== false) || a.id === FACTION)) continue;
    if (!groups[a.group]) { groups[a.group] = document.createElement('optgroup'); groups[a.group].label = a.group; armySel.append(groups[a.group]); }
    groups[a.group].append(new Option(a.name, a.id, a.id === FACTION, a.id === FACTION));
  }
  armySel.addEventListener('change', () => switchArmy(armySel.value));
  store.set(STORE_LAST, FACTION);
  document.title = `${DATA.meta.name} · 30k List Builder`;
  $('#army-title').textContent = `${DATA.meta.name} 30k List Builder`;

  addDetachmentMenu();
  refresh();
  }
})();
