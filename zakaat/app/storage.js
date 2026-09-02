/*
 * Local persistence layer (localStorage). Mirrors the server's data model:
 * household -> members -> (assets, payments); plus per-year rates, session rates, madhab.
 * All data stays in the browser. No network.
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "zakat_local_v1";

  const ZK = global.ZK;

  function blankState() {
    return {
      madhab: ZK.DEFAULT_MADHAB,
      family_name: "",
      currency: "", // display/FX currency; "" = not chosen yet (detect on first run)
      auto_rates: true, // fetch live market rates on load by default (opt-out)
      session_rates: Object.assign({}, ZK.DEFAULTS),
      seq: { member: 0, asset: 0, payment: 0 },
      members: [], // { id, name, relationship, assets:[], zakat_payments:[] }
      yearly_rates: [], // { year, gold_inr_per_gram, silver_inr_per_gram, platinum_inr_per_gram, diamond_inr_per_carat, is_estimated, is_user_override, rate_source }
    };
  }

  function normalizeFamilyName(name) {
    return String(name || "").trim().replace(/\s+/g, " ").slice(0, 64);
  }

  let state = blankState();
  const saveListeners = [];
  let suppressListeners = false;

  const DANGEROUS_KEYS = { __proto__: 1, constructor: 1, prototype: 1 };

  // Defensive deep-clone that drops keys which could pollute prototypes.
  // Used on anything parsed from an imported file / cloud snapshot.
  function sanitize(value) {
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === "object") {
      const out = {};
      for (const k of Object.keys(value)) {
        if (Object.prototype.hasOwnProperty.call(DANGEROUS_KEYS, k)) continue;
        out[k] = sanitize(value[k]);
      }
      return out;
    }
    return value;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = Object.assign(blankState(), parsed);
        // Data saved before currency support is in INR — pin it so a locale
        // detection can't silently relabel existing amounts.
        if (!parsed.currency) state.currency = "INR";
        state.seq = Object.assign({ member: 0, asset: 0, payment: 0 }, parsed.seq || {});
        state.session_rates = Object.assign({}, ZK.DEFAULTS, parsed.session_rates || {});
        state.members = parsed.members || [];
        state.yearly_rates = parsed.yearly_rates || [];
        _reseed();
      }
    } catch (e) {
      console.error("Failed to load saved data; starting fresh.", e);
      state = blankState();
    }
    return state;
  }

  function _reseed() {
    let maxM = 0, maxA = 0, maxP = 0;
    for (const m of state.members) {
      maxM = Math.max(maxM, m.id || 0);
      for (const a of m.assets || []) maxA = Math.max(maxA, a.id || 0);
      for (const p of m.zakat_payments || []) maxP = Math.max(maxP, p.id || 0);
    }
    state.seq.member = Math.max(state.seq.member, maxM);
    state.seq.asset = Math.max(state.seq.asset, maxA);
    state.seq.payment = Math.max(state.seq.payment, maxP);
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (!suppressListeners) {
      for (const cb of saveListeners) {
        try { cb(); } catch (e) { /* ignore listener errors */ }
      }
    }
  }

  // Subscribe to local saves (used by optional cloud auto-sync).
  function onSave(cb) { if (typeof cb === "function") saveListeners.push(cb); }

  function getState() { return state; }
  function setState(next) { state = next; save(); }

  function getMadhab() { return state.madhab || ZK.DEFAULT_MADHAB; }
  function setMadhab(m) { state.madhab = m; save(); }

  function getFamilyName() { return normalizeFamilyName(state.family_name); }
  function setFamilyName(name) {
    state.family_name = normalizeFamilyName(name);
    save();
    return state.family_name;
  }

  // Default ON: only false when the user explicitly opts out.
  function getAutoRates() { return state.auto_rates !== false; }
  function setAutoRates(v) { state.auto_rates = !!v; save(); }

  // "" means never chosen (fresh install) — the UI detects and saves one.
  function getCurrency() { return state.currency || ""; }
  function setCurrency(code) {
    state.currency = String(code || "").toUpperCase();
    save();
  }

  function getRates() { return Object.assign({}, ZK.DEFAULTS, state.session_rates); }
  function setRates(r) {
    state.session_rates = {
      gold_inr_per_gram: ZK.num(r.gold_inr_per_gram),
      silver_inr_per_gram: ZK.num(r.silver_inr_per_gram),
      platinum_inr_per_gram: ZK.num(r.platinum_inr_per_gram),
      diamond_inr_per_carat: ZK.num(r.diamond_inr_per_carat),
    };
    save();
  }

  function members() { return state.members; }
  function getMember(id) { return state.members.find((m) => m.id === id) || null; }

  function addMember(name, relationship, dob) {
    const id = ++state.seq.member;
    const m = { id, name: String(name || "").trim(), relationship: String(relationship || "Family").trim(), dob: dob || null, assets: [], zakat_payments: [] };
    state.members.push(m);
    save();
    return m;
  }

  function updateMember(id, name, relationship, dob) {
    const m = getMember(id);
    if (!m) return null;
    m.name = String(name || "").trim();
    m.relationship = String(relationship || "Family").trim();
    m.dob = dob !== undefined ? (dob || null) : (m.dob || null);
    save();
    return m;
  }

  function deleteMember(id) {
    const i = state.members.findIndex((m) => m.id === id);
    if (i >= 0) { state.members.splice(i, 1); save(); }
  }

  function addAsset(memberId, data) {
    const m = getMember(memberId);
    if (!m) return null;
    const id = ++state.seq.asset;
    const asset = Object.assign({
      id, member_id: memberId, category: "Cash", description: "",
      valuation_inr: 0, weight_grams: null, gem_carats: null, purity_value: null,
      image: null, image_filename: null,
      created_at: new Date().toISOString(), acquired_year: null, hawl_start_date: null,
      is_personal_jewelry: false, asset_subtype: null, quantity_count: null,
      balance_as_of_date: null, monthly_contribution_employee: null,
      monthly_contribution_employer: null, annual_interest_rate: null,
      snapshots: [], // [{ year, category, valuation_inr, weight_grams, gem_carats, purity_value, is_backfill, recorded_at }]
    }, data, { id, member_id: memberId });
    if (!Array.isArray(asset.snapshots)) asset.snapshots = [];
    m.assets.push(asset);
    save();
    return asset;
  }

  function getAsset(memberId, assetId) {
    const m = getMember(memberId);
    if (!m) return null;
    return (m.assets || []).find((a) => a.id === assetId) || null;
  }

  function updateAsset(memberId, assetId, data) {
    const a = getAsset(memberId, assetId);
    if (!a) return null;
    Object.assign(a, data, { id: assetId, member_id: memberId });
    save();
    return a;
  }

  function deleteAsset(memberId, assetId) {
    const m = getMember(memberId);
    if (!m) return;
    const i = (m.assets || []).findIndex((a) => a.id === assetId);
    if (i >= 0) { m.assets.splice(i, 1); save(); }
  }

  // --- Asset value snapshots (per calendar year) ---
  // Mirrors the server's AssetValueSnapshot table: snapshots live on each asset.
  function assetSnapshots(asset) {
    return (asset && Array.isArray(asset.snapshots)) ? asset.snapshots : [];
  }

  // Upsert a non-backfill snapshot for a given year. `state` carries the
  // valuation/weight/category captured at that year.
  function setSnapshot(memberId, assetId, year, state, opts) {
    const a = getAsset(memberId, assetId);
    if (!a) return null;
    if (!Array.isArray(a.snapshots)) a.snapshots = [];
    opts = opts || {};
    const isBackfill = !!opts.is_backfill;
    let row = a.snapshots.find((s) => s.year === year && !!s.is_backfill === isBackfill);
    if (!row) { row = { year: year, is_backfill: isBackfill }; a.snapshots.push(row); }
    else if (isBackfill) { return row; } // never overwrite a backfill row (server parity)
    row.category = state.category || a.category;
    row.valuation_inr = state.valuation_inr != null ? ZK.num(state.valuation_inr) : null;
    row.weight_grams = state.weight_grams != null && state.weight_grams !== "" ? ZK.num(state.weight_grams) : null;
    row.gem_carats = state.gem_carats != null && state.gem_carats !== "" ? ZK.num(state.gem_carats) : null;
    row.purity_value = state.purity_value != null ? state.purity_value : (a.purity_value || null);
    row.recorded_at = new Date().toISOString();
    a.snapshots.sort((x, y) => x.year - y.year);
    save();
    return row;
  }

  function deleteSnapshot(memberId, assetId, year) {
    const a = getAsset(memberId, assetId);
    if (!a || !Array.isArray(a.snapshots)) return;
    const before = a.snapshots.length;
    a.snapshots = a.snapshots.filter((s) => !(s.year === year && !s.is_backfill));
    if (a.snapshots.length !== before) save();
  }

  function addPayment(memberId, givenTo, amount) {
    const m = getMember(memberId);
    if (!m) return null;
    const id = ++state.seq.payment;
    const p = { id, member_id: memberId, given_to: String(givenTo || "").trim(), amount_inr: ZK.num(amount) };
    m.zakat_payments.push(p);
    save();
    return p;
  }

  function updatePayment(memberId, paymentId, givenTo, amount) {
    const m = getMember(memberId);
    if (!m) return null;
    const p = (m.zakat_payments || []).find((x) => x.id === paymentId);
    if (!p) return null;
    p.given_to = String(givenTo || "").trim();
    p.amount_inr = ZK.num(amount);
    save();
    return p;
  }

  function deletePayment(memberId, paymentId) {
    const m = getMember(memberId);
    if (!m) return;
    const i = (m.zakat_payments || []).findIndex((p) => p.id === paymentId);
    if (i >= 0) { m.zakat_payments.splice(i, 1); save(); }
  }

  function yearlyRates() { return state.yearly_rates; }
  function setYearlyRate(year, rates, opts) {
    opts = opts || {};
    let row = state.yearly_rates.find((r) => r.year === year);
    if (!row) { row = { year }; state.yearly_rates.push(row); }
    row.gold_inr_per_gram = ZK.num(rates.gold_inr_per_gram);
    row.silver_inr_per_gram = ZK.num(rates.silver_inr_per_gram);
    row.platinum_inr_per_gram = ZK.num(rates.platinum_inr_per_gram);
    row.diamond_inr_per_carat = ZK.num(rates.diamond_inr_per_carat);
    row.is_estimated = !!opts.is_estimated;
    row.is_user_override = opts.is_user_override !== undefined ? !!opts.is_user_override : true;
    row.rate_source = opts.rate_source || "manual";
    state.yearly_rates.sort((a, b) => a.year - b.year);
    save();
    return row;
  }
  function deleteYearlyRate(year) {
    const i = state.yearly_rates.findIndex((r) => r.year === year);
    if (i >= 0) { state.yearly_rates.splice(i, 1); save(); }
  }

  function clearAll() {
    state = blankState();
    save();
  }

  // Lossless JSON snapshot/restore of the entire local state (used for cloud sync).
  function exportState() {
    return JSON.parse(JSON.stringify(state));
  }

  function importState(rawParsed) {
    if (!rawParsed || typeof rawParsed !== "object") throw new Error("Invalid state");
    const parsed = sanitize(rawParsed);
    const next = Object.assign(blankState(), parsed);
    next.seq = Object.assign({ member: 0, asset: 0, payment: 0 }, parsed.seq || {});
    next.session_rates = Object.assign({}, ZK.DEFAULTS, parsed.session_rates || {});
    next.members = Array.isArray(parsed.members) ? parsed.members : [];
    next.yearly_rates = Array.isArray(parsed.yearly_rates) ? parsed.yearly_rates : [];
    next.madhab = parsed.madhab || ZK.DEFAULT_MADHAB;
    next.family_name = normalizeFamilyName(parsed.family_name);
    if (!parsed.currency) next.currency = "INR"; // pre-currency snapshots are INR
    state = next;
    _reseed();
    suppressListeners = true;
    try { save(); } finally { suppressListeners = false; }
    return state;
  }

  function replaceFromBackup(rawParsed) {
    const parsed = sanitize(rawParsed || {});
    const next = blankState();
    next.madhab = parsed.madhab || ZK.DEFAULT_MADHAB;
    next.family_name = normalizeFamilyName(parsed.family_name);
    next.currency = parsed.currency || state.currency || "INR"; // Excel backups don't carry currency
    if (parsed.session_rates) next.session_rates = Object.assign({}, ZK.DEFAULTS, parsed.session_rates);

    const memberByRef = {};
    let counts = { members: 0, assets: 0, images: 0, payments: 0, yearly_rates: 0 };

    for (const row of parsed.members || []) {
      const id = ++next.seq.member;
      const m = { id, name: row.name, relationship: row.relationship || "Family", assets: [], zakat_payments: [] };
      next.members.push(m);
      memberByRef[row.member_ref] = m;
      counts.members++;
    }

    const assetByRef = {};
    for (const row of parsed.assets || []) {
      const m = memberByRef[row.member_ref];
      if (!m) continue;
      const id = ++next.seq.asset;
      const img = (parsed.images || {})[row.asset_ref];
      const assetRefKey = row.asset_ref;
      const asset = {
        id, member_id: m.id, category: row.category, description: row.description || "",
        valuation_inr: ZK.num(row.valuation_inr),
        weight_grams: row.weight_grams !== "" && row.weight_grams != null ? ZK.num(row.weight_grams) : null,
        gem_carats: row.gem_carats !== "" && row.gem_carats != null ? ZK.num(row.gem_carats) : null,
        purity_value: row.purity_value || null,
        image: img ? img.dataUrl : null,
        image_filename: img ? img.filename : null,
        created_at: row.created_at || new Date().toISOString(),
        acquired_year: row.acquired_year ? parseInt(row.acquired_year, 10) : null,
        hawl_start_date: row.hawl_start_date || null,
        is_personal_jewelry: parseBool(row.is_personal_jewelry),
        asset_subtype: row.asset_subtype || null,
        quantity_count: row.quantity_count ? parseInt(row.quantity_count, 10) : null,
        balance_as_of_date: row.balance_as_of_date || null,
        monthly_contribution_employee: row.monthly_contribution_employee !== "" && row.monthly_contribution_employee != null ? ZK.num(row.monthly_contribution_employee) : null,
        monthly_contribution_employer: row.monthly_contribution_employer !== "" && row.monthly_contribution_employer != null ? ZK.num(row.monthly_contribution_employer) : null,
        annual_interest_rate: row.annual_interest_rate !== "" && row.annual_interest_rate != null ? ZK.num(row.annual_interest_rate) : null,
        snapshots: [],
      };
      m.assets.push(asset);
      assetByRef[assetRefKey] = asset;
      counts.assets++;
      if (img) counts.images++;
    }

    counts.snapshots = 0;
    for (const row of parsed.snapshots || []) {
      const a = assetByRef[row.asset_ref];
      if (!a) continue;
      const year = parseInt(row.year, 10);
      if (!year) continue;
      a.snapshots.push({
        year: year,
        category: row.category || a.category,
        valuation_inr: row.valuation_inr !== "" && row.valuation_inr != null ? ZK.num(row.valuation_inr) : null,
        weight_grams: row.weight_grams !== "" && row.weight_grams != null ? ZK.num(row.weight_grams) : null,
        gem_carats: row.gem_carats !== "" && row.gem_carats != null ? ZK.num(row.gem_carats) : null,
        purity_value: row.purity_value || null,
        is_backfill: parseBool(row.is_backfill),
        recorded_at: row.recorded_at || null,
      });
      counts.snapshots++;
    }
    for (const m of next.members) {
      for (const a of m.assets) a.snapshots.sort((x, y) => x.year - y.year);
    }

    for (const row of parsed.payments || []) {
      const m = memberByRef[row.member_ref];
      if (!m) continue;
      const amount = ZK.num(row.amount_inr);
      if (!row.given_to || amount <= 0) continue;
      const id = ++next.seq.payment;
      m.zakat_payments.push({ id, member_id: m.id, given_to: String(row.given_to).trim(), amount_inr: amount });
      counts.payments++;
    }

    for (const row of parsed.yearly_rates || []) {
      const year = parseInt(row.year, 10);
      if (!year) continue;
      next.yearly_rates.push({
        year,
        gold_inr_per_gram: ZK.num(row.gold_inr_per_gram),
        silver_inr_per_gram: ZK.num(row.silver_inr_per_gram),
        platinum_inr_per_gram: ZK.num(row.platinum_inr_per_gram),
        diamond_inr_per_carat: ZK.num(row.diamond_inr_per_carat),
        is_estimated: parseBool(row.is_estimated),
        is_user_override: parseBool(row.is_user_override),
        rate_source: row.rate_source || null,
      });
      counts.yearly_rates++;
    }
    next.yearly_rates.sort((a, b) => a.year - b.year);

    state = next;
    save();
    return counts;
  }

  function parseBool(v) {
    if (typeof v === "boolean") return v;
    if (v === null || v === undefined) return false;
    return ["1", "true", "yes", "y"].includes(String(v).trim().toLowerCase());
  }

  global.ZKStore = {
    load, save, getState, setState, clearAll, replaceFromBackup, exportState, importState, onSave,
    getMadhab, setMadhab, getFamilyName, setFamilyName, getAutoRates, setAutoRates,
    getCurrency, setCurrency, getRates, setRates,
    members, getMember, addMember, updateMember, deleteMember,
    addAsset, getAsset, updateAsset, deleteAsset,
    assetSnapshots, setSnapshot, deleteSnapshot,
    addPayment, updatePayment, deletePayment,
    yearlyRates, setYearlyRate, deleteYearlyRate,
  };
})(window);
