/*
 * Local persistence layer (localStorage). Mirrors the server's data model:
 * household -> members -> (assets, payments); plus per-year rates, session rates, madhab.
 * All data stays in the browser. No network.
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "zakat_local_v1";

  const ZK = global.ZK;

  function _now() { return new Date().toISOString(); }

  function blankState() {
    return {
      madhab: ZK.DEFAULT_MADHAB,
      family_name: "",
      currency: "", // display/FX currency; "" = not chosen yet (detect on first run)
      auto_rates: true, // fetch live market rates on load by default (opt-out)
      session_rates: Object.assign({}, ZK.DEFAULTS),
      settings_updated_at: new Date(0).toISOString(), // tracks top-level setting changes for merge
      seq: { member: 0, asset: 0, payment: 0 },
      members: [], // { id, name, relationship, dob, updated_at, assets:[], zakat_payments:[] }
      yearly_rates: [], // { year, ..., updated_at }
      tombstones: [],   // { type:"member"|"asset"|"payment", id, member_id?, deleted_at }
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

  // Backfill missing updated_at on existing records loaded from older snapshots.
  function _backfillTimestamps() {
    const epoch = new Date(0).toISOString();
    (state.members || []).forEach(function (m) {
      if (!m.updated_at) m.updated_at = m.created_at || epoch;
      (m.assets || []).forEach(function (a) { if (!a.updated_at) a.updated_at = a.created_at || epoch; });
      (m.zakat_payments || []).forEach(function (p) { if (!p.updated_at) p.updated_at = epoch; });
    });
    (state.yearly_rates || []).forEach(function (r) { if (!r.updated_at) r.updated_at = epoch; });
    if (!state.tombstones) state.tombstones = [];
    if (!state.settings_updated_at) state.settings_updated_at = epoch;
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
        state.tombstones = parsed.tombstones || [];
        _backfillTimestamps();
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

  function _touchSettings() { state.settings_updated_at = _now(); }

  function getMadhab() { return state.madhab || ZK.DEFAULT_MADHAB; }
  function setMadhab(m) { state.madhab = m; _touchSettings(); save(); }

  function getFamilyName() { return normalizeFamilyName(state.family_name); }
  function setFamilyName(name) {
    state.family_name = normalizeFamilyName(name);
    _touchSettings();
    save();
    return state.family_name;
  }

  // Default ON: only false when the user explicitly opts out.
  function getAutoRates() { return state.auto_rates !== false; }
  function setAutoRates(v) { state.auto_rates = !!v; _touchSettings(); save(); }

  // "" means never chosen (fresh install) — the UI detects and saves one.
  function getCurrency() { return state.currency || ""; }
  function setCurrency(code) {
    state.currency = String(code || "").toUpperCase();
    _touchSettings();
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
    _touchSettings();
    save();
  }

  function members() { return state.members; }
  function getMember(id) { return state.members.find((m) => m.id === id) || null; }

  function addMember(name, relationship, dob) {
    const id = ++state.seq.member;
    const ts = _now();
    const m = { id, name: String(name || "").trim(), relationship: String(relationship || "Family").trim(), dob: dob || null, updated_at: ts, assets: [], zakat_payments: [] };
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
    m.updated_at = _now();
    save();
    return m;
  }

  function deleteMember(id) {
    const i = state.members.findIndex((m) => m.id === id);
    if (i >= 0) {
      state.tombstones.push({ type: "member", id: id, deleted_at: _now() });
      state.members.splice(i, 1);
      save();
    }
  }

  function addAsset(memberId, data) {
    const m = getMember(memberId);
    if (!m) return null;
    const id = ++state.seq.asset;
    const ts = _now();
    const asset = Object.assign({
      id, member_id: memberId, category: "Cash", description: "",
      valuation_inr: 0, weight_grams: null, gem_carats: null, purity_value: null,
      image: null, image_filename: null,
      created_at: ts, updated_at: ts,
      acquired_year: null, hawl_start_date: null,
      is_personal_jewelry: false, asset_subtype: null, quantity_count: null,
      balance_as_of_date: null, monthly_contribution_employee: null,
      monthly_contribution_employer: null, annual_interest_rate: null,
      snapshots: [], // [{ year, category, valuation_inr, weight_grams, gem_carats, purity_value, is_backfill, recorded_at }]
    }, data, { id, member_id: memberId, updated_at: ts });
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
    Object.assign(a, data, { id: assetId, member_id: memberId, updated_at: _now() });
    save();
    return a;
  }

  function deleteAsset(memberId, assetId) {
    const m = getMember(memberId);
    if (!m) return;
    const i = (m.assets || []).findIndex((a) => a.id === assetId);
    if (i >= 0) {
      state.tombstones.push({ type: "asset", member_id: memberId, id: assetId, deleted_at: _now() });
      m.assets.splice(i, 1);
      save();
    }
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
    const p = { id, member_id: memberId, given_to: String(givenTo || "").trim(), amount_inr: ZK.num(amount), updated_at: _now() };
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
    p.updated_at = _now();
    save();
    return p;
  }

  function deletePayment(memberId, paymentId) {
    const m = getMember(memberId);
    if (!m) return;
    const i = (m.zakat_payments || []).findIndex((p) => p.id === paymentId);
    if (i >= 0) {
      state.tombstones.push({ type: "payment", member_id: memberId, id: paymentId, deleted_at: _now() });
      m.zakat_payments.splice(i, 1);
      save();
    }
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
    row.updated_at = _now();
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

  // ── Auto-merge (multi-session conflict resolution) ────────────────────────
  // mergeWith(remote) produces a merged state from the current local state and
  // a remote state snapshot (downloaded from Drive). Strategy: field-level
  // last-write-wins using updated_at timestamps; union of records from both
  // sides; tombstones (deletions) win over records not modified after deletion.
  function _ts(val) { return new Date(val || 0).getTime(); }

  function _mergeChildArr(localItems, remoteItems, tombstones, type, memberId) {
    var byId = {};
    (localItems || []).forEach(function (item) { byId[item.id] = item; });
    (remoteItems || []).forEach(function (rItem) {
      var lItem = byId[rItem.id];
      if (!lItem) {
        byId[rItem.id] = rItem; // new record from remote
      } else {
        // LWW: take whichever side has the newer updated_at
        var lTs = _ts(lItem.updated_at || lItem.created_at);
        var rTs = _ts(rItem.updated_at || rItem.created_at);
        byId[rItem.id] = rTs > lTs ? rItem : lItem;
      }
    });
    // Apply tombstones: deletion wins unless the record was updated after deletion
    return Object.values(byId).filter(function (item) {
      var tomb = tombstones.find(function (t) {
        return t.type === type && t.member_id === memberId && t.id === item.id;
      });
      if (!tomb) return true;
      return _ts(item.updated_at || item.created_at) > _ts(tomb.deleted_at);
    });
  }

  function mergeWith(remote) {
    var local = exportState();

    // ── Tombstones: union, keep latest deleted_at per key ──
    var tombMap = {};
    function addTomb(t) {
      var key = t.type + ":" + (t.member_id != null ? t.member_id + ":" : "") + t.id;
      if (!tombMap[key] || _ts(t.deleted_at) > _ts(tombMap[key].deleted_at)) tombMap[key] = t;
    }
    (local.tombstones || []).forEach(addTomb);
    (remote.tombstones || []).forEach(addTomb);
    var mergedTombstones = Object.values(tombMap);

    // ── Settings: last-write-wins by settings_updated_at ──
    var useRemote = _ts(remote.settings_updated_at) > _ts(local.settings_updated_at);

    // ── Members: union by id, LWW top-level fields, always merge children ──
    var membersById = {};
    (local.members || []).forEach(function (m) { membersById[m.id] = m; });
    (remote.members || []).forEach(function (rm) {
      var lm = membersById[rm.id];
      if (!lm) {
        membersById[rm.id] = rm;
      } else {
        // LWW for top-level member fields; always union children
        var baseM = _ts(rm.updated_at) > _ts(lm.updated_at) ? rm : lm;
        membersById[rm.id] = Object.assign({}, baseM, {
          assets: _mergeChildArr(lm.assets, rm.assets, mergedTombstones, "asset", rm.id),
          zakat_payments: _mergeChildArr(lm.zakat_payments, rm.zakat_payments, mergedTombstones, "payment", rm.id),
        });
      }
    });
    // Apply member tombstones
    var mergedMembers = Object.values(membersById).filter(function (m) {
      var tomb = mergedTombstones.find(function (t) { return t.type === "member" && t.id === m.id; });
      if (!tomb) return true;
      return _ts(m.updated_at) > _ts(tomb.deleted_at);
    });

    // ── Yearly rates: union by year, LWW ──
    var ratesByYear = {};
    [(local.yearly_rates || []), (remote.yearly_rates || [])].forEach(function (arr) {
      arr.forEach(function (r) {
        var ex = ratesByYear[r.year];
        if (!ex || _ts(r.updated_at) > _ts(ex.updated_at)) ratesByYear[r.year] = r;
      });
    });

    // ── Compose merged state ──
    var baseSettings = useRemote ? remote : local;
    return Object.assign({}, local, {
      madhab: baseSettings.madhab,
      family_name: baseSettings.family_name,
      currency: baseSettings.currency,
      auto_rates: baseSettings.auto_rates,
      session_rates: baseSettings.session_rates,
      settings_updated_at: baseSettings.settings_updated_at,
      seq: {
        member: Math.max((local.seq && local.seq.member) || 0, (remote.seq && remote.seq.member) || 0),
        asset: Math.max((local.seq && local.seq.asset) || 0, (remote.seq && remote.seq.asset) || 0),
        payment: Math.max((local.seq && local.seq.payment) || 0, (remote.seq && remote.seq.payment) || 0),
      },
      members: mergedMembers,
      yearly_rates: Object.values(ratesByYear).sort(function (a, b) { return a.year - b.year; }),
      tombstones: mergedTombstones,
    });
  }

  // Apply a merged state object: set as current state, persist, fire a
  // DOM event so the UI can refresh without going through the Drive save loop.
  function applyMerged(merged) {
    var s = sanitize(merged);
    state = Object.assign(blankState(), s);
    state.seq = Object.assign({ member: 0, asset: 0, payment: 0 }, s.seq || {});
    state.session_rates = Object.assign({}, ZK.DEFAULTS, s.session_rates || {});
    state.members = Array.isArray(s.members) ? s.members : [];
    state.yearly_rates = Array.isArray(s.yearly_rates) ? s.yearly_rates : [];
    state.tombstones = Array.isArray(s.tombstones) ? s.tombstones : [];
    state.settings_updated_at = s.settings_updated_at || new Date(0).toISOString();
    if (!s.currency) state.currency = "INR";
    _reseed();
    suppressListeners = true;
    try { save(); } finally { suppressListeners = false; }
    try { document.dispatchEvent(new CustomEvent("zk:drive-merge")); } catch (e) { /* ignore in non-browser env */ }
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
    mergeWith, applyMerged,
  };
})(window);
