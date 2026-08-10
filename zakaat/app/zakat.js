/*
 * Zakat calculation engine — faithful JavaScript port of the Python app
 * (app/zakat_engine.py, sharia_rules.py, metal_purity.py, asset_valuation.py,
 *  livestock_zakat.py, agriculture_zakat.py, pf_projection.py, zakat_calendar.py).
 *
 * Runs entirely in the browser. No network, no server.
 */
(function (global) {
  "use strict";

  // --- Constants (config.py) ---
  const ZAKAT_RATE = 0.025;
  const NISAB_GOLD_GRAMS = 87.48;
  const NISAB_SILVER_GRAMS = 612.36;
  const RIKAZ_RATE = 0.2;
  const LUNAR_YEAR_DAYS = 354;

  const DEFAULTS = {
    gold_inr_per_gram: 7450,
    silver_inr_per_gram: 96.5,
    platinum_inr_per_gram: 3200,
    diamond_inr_per_carat: 150000,
  };

  const DEFAULT_GOLD_KARAT = 22;
  const DEFAULT_SILVER_FINENESS = 925;
  const DEFAULT_PLATINUM_FINENESS = 950;
  const DEFAULT_PF_ANNUAL_RATE_PCT = 8.25;

  // Preset purity/fineness options (mirrors templates/partials/purity_select_options.html).
  const PURITY_OPTIONS = {
    Gold: [
      { v: "24", l: "24K \u2014 pure (99.9%)" },
      { v: "22", l: "22K \u2014 91.7% gold" },
      { v: "18", l: "18K \u2014 75% gold" },
      { v: "14", l: "14K \u2014 58.3% gold" },
      { v: "__custom__", l: "Custom purity\u2026" },
    ],
    Silver: [
      { v: "999", l: "999 fine silver" },
      { v: "925", l: "925 sterling" },
      { v: "900", l: "900 coin silver" },
      { v: "__custom__", l: "Custom fineness\u2026" },
    ],
    Platinum: [
      { v: "999", l: "999 platinum" },
      { v: "950", l: "950 platinum" },
      { v: "900", l: "900 platinum" },
      { v: "__custom__", l: "Custom fineness\u2026" },
    ],
  };
  const PURITY_PRESETS = {
    Gold: ["24", "22", "18", "14"],
    Silver: ["999", "925", "900"],
    Platinum: ["999", "950", "900"],
  };
  const DEFAULT_PURITY_BY_METAL = { Gold: "22", Silver: "925", Platinum: "950" };

  const CATEGORIES = [
    "Gold", "Silver", "Platinum", "Diamond", "Cash", "PF", "Stocks",
    "Business", "Livestock", "Agriculture", "Property", "Partnership",
    "Rikaz", "Liabilities",
  ];

  const CATEGORY_GROUPS = [
    ["Metals", ["Gold", "Silver", "Platinum", "Diamond"]],
    ["Livestock & harvest", ["Livestock", "Agriculture"]],
    ["Wealth (INR)", ["Cash", "PF", "Stocks", "Business", "Property", "Partnership", "Rikaz"]],
    ["Deductions", ["Liabilities"]],
  ];

  const METAL_CATEGORIES = new Set(["Gold", "Silver", "Platinum", "Diamond"]);
  const JEWELRY_CATEGORIES = new Set(["Gold", "Silver", "Diamond"]);
  const PF_SUBTYPES = new Set(["pf", "epf", "provident", "provident_fund", "pf_epf"]);

  const MADHAB_RULES = {
    hanafi: { label: "Hanafi", nisab_basis: "silver", jewelry_exempt: false, debt_deduction: "full", silver_deduction_rate: 0.0 },
    shafi: { label: "Shafi'i", nisab_basis: "gold", jewelry_exempt: true, debt_deduction: "none", silver_deduction_rate: 0.0 },
    maliki: { label: "Maliki", nisab_basis: "gold", jewelry_exempt: true, debt_deduction: "cash_only", silver_deduction_rate: 0.0 },
    hanbali: { label: "Hanbali", nisab_basis: "gold", jewelry_exempt: true, debt_deduction: "full", silver_deduction_rate: 0.0 },
  };
  const DEFAULT_MADHAB = "hanafi";

  const COMPONENT_LABELS = {
    gold: "Gold", silver: "Silver", platinum: "Platinum", diamond: "Diamond",
    cash: "Cash", investments: "Investments \u2212 loans", pf: "PF / EPF (projected)",
    property: "Property (for sale)", property_exempt: "Property (home, rental)",
    partnership: "Partnership", agriculture: "Agriculture (harvest)",
    livestock: "Livestock (Sunnah tiers)", rikaz: "Rikaz / treasure (20%)",
    total: "Total Zakat amount",
  };

  const CHART_KEY_ORDER = [
    "gold", "silver", "platinum", "diamond", "cash", "investments", "pf",
    "property", "property_exempt", "partnership", "agriculture", "livestock", "rikaz",
  ];

  const WEALTH_COMPONENT_LABELS = {
    gold: "Gold (market value)", silver: "Silver (market value)", platinum: "Platinum (market value)",
    diamond: "Diamond (market value)", cash: "Cash & bank", investments: "Investments \u2212 loans",
    pf: "PF / EPF (projected balance)", property: "Property (for sale)", property_exempt: "Property (home, rental)",
    partnership: "Partnership", agriculture: "Agriculture (harvest value)", livestock: "Livestock (herd value)",
    rikaz: "Rikaz / treasure", total: "Total wealth (after liabilities)",
  };

  // --- Helpers ---
  function num(v) {
    if (v === null || v === undefined || v === "") return 0.0;
    const n = parseFloat(v);
    return isNaN(n) ? 0.0 : n;
  }

  function getRules(madhab) {
    return MADHAB_RULES[madhab] || MADHAB_RULES[DEFAULT_MADHAB];
  }

  function parseISODate(s) {
    if (!s) return null;
    const str = String(s).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }

  function todayUTC() {
    const d = new Date();
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  }

  function daysBetween(a, b) {
    // a - b in whole days
    return Math.round((a.getTime() - b.getTime()) / 86400000);
  }

  // --- Purity UI helpers (metal_purity.py + purity_select_options.html) ---
  function normalizePurityToken(v) {
    return String(v || "").trim().toUpperCase().replace(/K/g, "").replace(/%/g, "");
  }

  function isPresetPurity(category, value) {
    const presets = PURITY_PRESETS[category];
    if (!presets || value == null || value === "") return false;
    const token = normalizePurityToken(value);
    return presets.some((p) => normalizePurityToken(p) === token);
  }

  function purityFieldLabel(category) {
    if (category === "Gold") return "Karat (purity)";
    if (category === "Silver" || category === "Platinum") return "Fineness";
    return "Purity";
  }

  function populatePuritySelect(selectEl, category, currentValue) {
    if (!selectEl) return;
    while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);
    const opts = PURITY_OPTIONS[category] || [];
    const token = normalizePurityToken(currentValue);
    const useCustom = Boolean(currentValue && !isPresetPurity(category, currentValue));
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = category === "Gold" ? "Select karat\u2026" : "Select fineness\u2026";
    placeholder.disabled = true;
    if (!useCustom && !token) placeholder.selected = true;
    selectEl.appendChild(placeholder);
    opts.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.v;
      opt.textContent = o.l;
      if (!useCustom && token && normalizePurityToken(o.v) === token) opt.selected = true;
      selectEl.appendChild(opt);
    });
    if (useCustom) selectEl.value = "__custom__";
    else if (!token && DEFAULT_PURITY_BY_METAL[category]) selectEl.value = DEFAULT_PURITY_BY_METAL[category];
  }

  function resolvePurityValue(selectVal, customVal) {
    if (selectVal && selectVal !== "__custom__") return String(selectVal);
    if (selectVal === "__custom__") {
      const custom = String(customVal || "").trim();
      return custom || null;
    }
    return null;
  }

  // --- Purity (metal_purity.py) ---
  function parsePurityFactor(raw, category) {
    if (raw === null || raw === undefined) return null;
    let text = String(raw).trim().toUpperCase().replace(/K/g, "").replace(/%/g, "").trim();
    if (!text) return null;
    const value = parseFloat(text);
    if (isNaN(value)) return null;

    if (category === "Gold") {
      if (value <= 1.0) return Math.min(1.0, Math.max(0.0, value));
      if (value <= 24.0) return Math.min(1.0, value / 24.0);
      if (value <= 100.0) return Math.min(1.0, value / 100.0);
      return Math.min(1.0, value / 1000.0);
    }
    if (value <= 1.0) return Math.min(1.0, Math.max(0.0, value));
    if (value <= 100.0) return Math.min(1.0, value / 100.0);
    return Math.min(1.0, value / 1000.0);
  }

  function defaultPurityFactor(category) {
    if (category === "Gold") return DEFAULT_GOLD_KARAT / 24.0;
    if (category === "Platinum") return DEFAULT_PLATINUM_FINENESS / 1000.0;
    return DEFAULT_SILVER_FINENESS / 1000.0;
  }

  function purityFactorForAsset(asset) {
    const parsed = parsePurityFactor(asset.purity_value, asset.category);
    return parsed !== null ? parsed : defaultPurityFactor(asset.category);
  }

  function grams(asset) {
    return asset.weight_grams ? num(asset.weight_grams) : 0.0;
  }

  function goldPureGrams(g, asset) { return g * purityFactorForAsset(asset); }
  function platinumPureGrams(g, asset) { return g * purityFactorForAsset(asset); }
  function silverZakatableGrams(g, asset, deductionRate) {
    return g * purityFactorForAsset(asset) * (1.0 - deductionRate);
  }
  function diamondCarats(asset) {
    return asset.gem_carats ? num(asset.gem_carats) : 0.0;
  }
  function diamondMarketInr(asset, perCarat) {
    const manual = num(asset.valuation_inr);
    const c = diamondCarats(asset);
    if (manual > 0 && c <= 0) return manual;
    if (c > 0) return c * perCarat;
    return manual;
  }

  function purityLabel(asset) {
    const raw = (asset.purity_value || "").trim();
    if (asset.category === "Gold") {
      if (raw) {
        const token = raw.toUpperCase().replace(/K/g, "").replace(/%/g, "").trim();
        const k = parseFloat(token);
        if (!isNaN(k) && k > 0 && k <= 24) return fmtGrams(k) + "K";
        const f = purityFactorForAsset(asset);
        return (f * 100).toFixed(2) + "% Au";
      }
      return DEFAULT_GOLD_KARAT + "K";
    }
    if (asset.category === "Silver") return raw ? raw + " fine" : DEFAULT_SILVER_FINENESS + " fine";
    if (asset.category === "Platinum") return raw ? "Pt " + raw : "Pt " + DEFAULT_PLATINUM_FINENESS;
    if (asset.category === "Diamond" && asset.gem_carats) return fmtGrams(asset.gem_carats) + " ct";
    return "";
  }

  // --- PF projection (pf_projection.py) ---
  function isPfAsset(asset) {
    if (asset.category === "PF") return true;
    if (asset.category === "Stocks" || asset.category === "Business") {
      const sub = (asset.asset_subtype || "").trim().toLowerCase();
      return PF_SUBTYPES.has(sub);
    }
    return false;
  }

  function pfAnnualRate(asset) {
    const raw = num(asset.annual_interest_rate);
    if (!raw || raw <= 0) return DEFAULT_PF_ANNUAL_RATE_PCT / 100.0;
    return raw > 1 ? raw / 100.0 : raw;
  }

  function pfBalanceAsOfDate(asset) {
    if (asset.balance_as_of_date) return parseISODate(asset.balance_as_of_date);
    if (asset.hawl_start_date) return parseISODate(asset.hawl_start_date);
    if (asset.acquired_year) return new Date(Date.UTC(+asset.acquired_year, 0, 1));
    if (asset.created_at) {
      const d = new Date(asset.created_at);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    return todayUTC();
  }

  function addMonths(d, months) {
    const monthIndex = d.getUTCMonth() + months;
    const year = d.getUTCFullYear() + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay)));
  }

  function projectPfBalance(balance, asOf, target, annualRate, monthlyAdd) {
    if (target <= asOf) return balance;
    let current = balance;
    let cursor = asOf;
    let monthsUntilInterest = 0;
    while (cursor < target) {
      const nextMonth = addMonths(cursor, 1);
      if (nextMonth > target) break;
      current += monthlyAdd;
      monthsUntilInterest += 1;
      if (monthsUntilInterest >= 12) {
        current *= 1.0 + annualRate;
        monthsUntilInterest = 0;
      }
      cursor = nextMonth;
    }
    return current;
  }

  function projectedPfInr(asset, target) {
    if (!isPfAsset(asset)) return num(asset.valuation_inr);
    const asOf = pfBalanceAsOfDate(asset);
    const tgt = target || todayUTC();
    const balance = num(asset.valuation_inr);
    if (balance <= 0) return 0.0;
    const monthlyAdd = num(asset.monthly_contribution_employee) + num(asset.monthly_contribution_employer);
    const projected = projectPfBalance(balance, asOf, tgt, pfAnnualRate(asset), monthlyAdd);
    return Math.round(projected * 100) / 100;
  }

  // --- Effective valuation (asset_valuation.py) ---
  function effectiveValuationInr(asset, rates, asOf) {
    if (isPfAsset(asset)) return projectedPfInr(asset, asOf);
    const g = grams(asset);
    if (asset.category === "Gold" && g > 0) return goldPureGrams(g, asset) * rates.gold_inr_per_gram;
    if (asset.category === "Silver" && g > 0) return silverZakatableGrams(g, asset, 0.0) * rates.silver_inr_per_gram;
    if (asset.category === "Platinum" && g > 0) return platinumPureGrams(g, asset) * rates.platinum_inr_per_gram;
    if (asset.category === "Diamond") return diamondMarketInr(asset, rates.diamond_inr_per_carat);
    return num(asset.valuation_inr);
  }

  // --- Yearly value snapshots (asset_history.py) ---
  // Categories whose stored INR balance only counts in a trend year when a
  // snapshot exists for that year (otherwise we don't know the past balance).
  const INR_RECORDED_CATEGORIES = new Set(["Cash", "PF", "Stocks", "Business", "Liabilities"]);
  // Categories whose snapshots drive the trend line.
  const TRACKED_CATEGORIES = new Set([
    "Cash", "PF", "Stocks", "Business", "Liabilities", "Gold", "Silver", "Platinum", "Diamond",
  ]);

  function effectiveAcquiredYear(asset) {
    if (asset.acquired_year) return parseInt(asset.acquired_year, 10);
    if (asset.created_at) { const y = new Date(asset.created_at).getUTCFullYear(); if (y) return y; }
    return todayUTC().getUTCFullYear();
  }

  // Pick the snapshot to use for a year: exact match (preferring a real,
  // non-backfill row), else the latest snapshot at or before the year.
  function pickSnapshot(snapshots, year) {
    if (!snapshots || !snapshots.length) return null;
    const exact = snapshots.filter((s) => s.year === year);
    if (exact.length) return exact.find((s) => !s.is_backfill) || exact[0];
    const atOrBefore = snapshots.filter((s) => s.year <= year);
    if (!atOrBefore.length) return null;
    let best = atOrBefore[0];
    for (const s of atOrBefore) {
      if (s.year > best.year || (s.year === best.year && !s.is_backfill)) best = s;
    }
    return best;
  }

  // Reconstruct an asset's state for a calendar year, or null if it shouldn't
  // count that year. Mirrors asset_history.asset_as_of.
  function assetAsOf(asset, year, snapshots) {
    if (year < effectiveAcquiredYear(asset)) return null;
    const snap = pickSnapshot(snapshots, year);
    if (snap) {
      const clone = Object.assign({}, asset);
      clone.category = snap.category || asset.category;
      clone.valuation_inr = snap.valuation_inr;
      clone.weight_grams = snap.weight_grams;
      clone.gem_carats = snap.gem_carats;
      clone.purity_value = snap.purity_value != null ? snap.purity_value : asset.purity_value;
      return clone;
    }
    if (isPfAsset(asset) && num(asset.valuation_inr) > 0) {
      const target = new Date(Date.UTC(year, 11, 31));
      if (target < pfBalanceAsOfDate(asset)) return null;
      const clone = Object.assign({}, asset);
      clone.valuation_inr = projectedPfInr(asset, target);
      return clone;
    }
    if (INR_RECORDED_CATEGORIES.has(asset.category)) return null;
    return Object.assign({}, asset); // metals revalue at year rates; others held
  }

  function assetsAsOfYear(assets, year) {
    const out = [];
    for (const a of assets || []) {
      const clone = assetAsOf(a, year, a.snapshots || []);
      if (clone) out.push(clone);
    }
    return out;
  }

  // Capture the value/weight to persist as a snapshot for a year.
  function snapshotState(asset, year) {
    const yr = year || todayUTC().getUTCFullYear();
    let val = num(asset.valuation_inr);
    if (isPfAsset(asset)) {
      const today = todayUTC();
      const yearEnd = new Date(Date.UTC(yr, 11, 31));
      const target = yearEnd < today ? yearEnd : today;
      if (target >= pfBalanceAsOfDate(asset)) val = projectedPfInr(asset, target);
    }
    return {
      category: asset.category,
      valuation_inr: val,
      weight_grams: asset.weight_grams != null ? asset.weight_grams : null,
      gem_carats: asset.gem_carats != null ? asset.gem_carats : null,
      purity_value: asset.purity_value || null,
    };
  }

  function displayValueInr(asset, rates) {
    if (isPfAsset(asset)) return projectedPfInr(asset, todayUTC());
    return num(asset.valuation_inr);
  }

  // Year-over-year balance changes for cash/PF/stocks/loans that have real
  // snapshots in both years (asset_history.valuation_change_notes).
  function valuationChangeNotes(assets, priorYear, currentYear) {
    const notes = [];
    for (const a of assets || []) {
      if (!INR_RECORDED_CATEGORIES.has(a.category)) continue;
      const snaps = a.snapshots || [];
      if (!snaps.some((s) => s.year === priorYear)) continue;
      if (!snaps.some((s) => s.year === currentYear)) continue;
      const prior = assetAsOf(a, priorYear, snaps);
      const current = assetAsOf(a, currentYear, snaps);
      if (!prior || !current) continue;
      const pv = displayValueInr(prior), cv = displayValueInr(current);
      if (Math.abs(pv - cv) < 0.01) continue;
      notes.push({
        asset_id: a.id, description: a.description || a.category, category: a.category,
        prior_year: priorYear, current_year: currentYear,
        prior_value_inr: pv, current_value_inr: cv,
        change_inr: cv - pv, change_pct: pv ? ((cv - pv) / pv) * 100 : null,
      });
    }
    return notes.sort((x, y) => Math.abs(y.change_inr) - Math.abs(x.change_inr));
  }

  // --- Sharia rules (sharia_rules.py) ---
  function categoryRequiresHawl(category) {
    return category !== "Agriculture" && category !== "Rikaz";
  }

  function effectiveHawlStart(asset) {
    if (asset.hawl_start_date) return parseISODate(asset.hawl_start_date);
    if (asset.acquired_year) return new Date(Date.UTC(+asset.acquired_year, 0, 1));
    if (asset.created_at) {
      const d = new Date(asset.created_at);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    return todayUTC();
  }

  function hawlComplete(asset, asOf) {
    if (!categoryRequiresHawl(asset.category)) return true;
    const ref = asOf || todayUTC();
    const start = effectiveHawlStart(asset);
    if (!start) return true;
    return daysBetween(ref, start) >= LUNAR_YEAR_DAYS;
  }

  function hawlDaysRemaining(asset, asOf) {
    const ref = asOf || todayUTC();
    const start = effectiveHawlStart(asset);
    if (!start) return 0;
    return Math.max(0, LUNAR_YEAR_DAYS - daysBetween(ref, start));
  }

  function isPersonalJewelryExempt(asset, rules) {
    if (!rules.jewelry_exempt) return false;
    if (!JEWELRY_CATEGORIES.has(asset.category)) return false;
    return !!asset.is_personal_jewelry;
  }

  function resolveNisabThresholdInr(rules, rates, goldWealth, silverWealth) {
    const goldThr = NISAB_GOLD_GRAMS * rates.gold_inr_per_gram;
    const silverThr = NISAB_SILVER_GRAMS * rates.silver_inr_per_gram;
    if (rules.nisab_basis === "silver") return [silverThr, "silver"];
    if (goldWealth > 0) return [goldThr, "gold"];
    if (silverWealth > 0) return [silverThr, "silver"];
    return [goldThr, "gold"];
  }

  // --- Livestock (livestock_zakat.py) ---
  function normalizeLivestockKind(subtype) {
    const s = (subtype || "sheep").trim().toLowerCase();
    if (["cattle", "cow", "bovine", "cows"].includes(s)) return "cattle";
    if (["camel", "camels"].includes(s)) return "camel";
    return "sheep";
  }
  function sheepDue(c) {
    if (c < 40) return [0, "Below nisab (40 sheep/goats)"];
    if (c <= 120) return [1, "1 sheep (or goat of equal value)"];
    if (c <= 200) return [2, "2 sheep"];
    if (c <= 399) return [3, "3 sheep"];
    const due = Math.floor(c / 100);
    return [due, due + " sheep (1 per 100 head)"];
  }
  function cattleDue(c) {
    if (c < 30) return [0, "Below nisab (30 cattle)"];
    if (c <= 39) return [1, "1 calf (tabi')"];
    if (c <= 59) return [1, "1 two-year-old cow (musinnah)"];
    if (c <= 69) return [2, "2 cows"];
    if (c <= 79) return [3, "3 cows"];
    const due = Math.floor(c / 40);
    return [due, due + " cows (1 per 40 head)"];
  }
  function camelDue(c) {
    if (c < 5) return [0, "Below nisab (5 camels)"];
    if (c <= 9) return [1, "1 sheep (or equivalent)"];
    if (c <= 14) return [2, "2 sheep"];
    if (c <= 19) return [3, "3 sheep"];
    if (c <= 24) return [4, "4 sheep"];
    if (c <= 35) return [1, "1 one-year-old she-camel (bint labun)"];
    if (c <= 45) return [1, "1 two-year-old she-camel (hiqqah)"];
    if (c <= 60) return [1, "1 three-year-old she-camel (jadha'ah)"];
    if (c <= 75) return [2, "2 jadha'ah"];
    if (c <= 90) return [2, "2 hiqqah"];
    if (c <= 120) return [3, "3 bint labun"];
    const due = Math.max(1, Math.floor((c - 120) / 40) + 3);
    return [due, due + " camel(s) per bracket (120+ herd)"];
  }
  function computeLivestockZakat(headCount, subtype, valuePerAnimal) {
    const kind = normalizeLivestockKind(subtype);
    const count = Math.max(0, Math.floor(headCount));
    let res;
    if (kind === "cattle") res = cattleDue(count);
    else if (kind === "camel") res = camelDue(count);
    else res = sheepDue(count);
    const due = res[0];
    const below = due === 0;
    const zakat = below ? 0.0 : due * Math.max(0.0, valuePerAnimal);
    return { kind, head_count: count, animals_due: due, description: res[1], zakat_inr: zakat, below_nisab: below };
  }

  // --- Agriculture (agriculture_zakat.py) ---
  const AGRI_RATES = { rain: 0.10, irrigated: 0.05, mixed: 0.075 };
  const AGRI_LABELS = { rain: "Rain-fed / natural (10%)", irrigated: "Irrigated / costly watering (5%)", mixed: "Mixed (7.5%)" };
  function normalizeIrrigation(subtype) {
    const s = (subtype || "rain").trim().toLowerCase();
    if (["irrigated", "irrigation", "artificial", "pump"].includes(s)) return "irrigated";
    if (["mixed", "both", "partial"].includes(s)) return "mixed";
    return "rain";
  }
  function agricultureZakatInr(harvest, subtype) {
    const key = normalizeIrrigation(subtype);
    const rate = AGRI_RATES[key];
    const value = Math.max(0.0, num(harvest));
    return [value * rate, rate, AGRI_LABELS[key]];
  }

  // --- Property helpers ---
  function propertySubtype(asset) { return (asset.asset_subtype || "personal").trim().toLowerCase(); }
  function propertyIsExemptSubtype(s) {
    return ["personal", "residence", "home", "rental", "rent"].includes(s);
  }
  function propertyZakatableInr(asset, asOf) {
    const s = propertySubtype(asset);
    if (propertyIsExemptSubtype(s)) return 0.0;
    if (["trade", "sale", "for_sale", "inventory"].includes(s)) {
      if (hawlComplete(asset, asOf)) return num(asset.valuation_inr);
    }
    return 0.0;
  }
  function propertyExemptMarketInr(asset) {
    const s = propertySubtype(asset);
    const amount = num(asset.valuation_inr);
    if (amount <= 0) return 0.0;
    if (propertyIsExemptSubtype(s)) return amount;
    if (!["trade", "sale", "for_sale", "inventory"].includes(s)) return amount;
    return 0.0;
  }

  function quantity(asset) {
    const q = asset.quantity_count;
    return q && q > 0 ? Math.floor(q) : 0;
  }

  function metalMarketValue(asset, rates, silverDeduction) {
    const g = grams(asset);
    if (asset.category === "Gold") return g > 0 ? goldPureGrams(g, asset) * rates.gold_inr_per_gram : num(asset.valuation_inr);
    if (asset.category === "Silver") return g > 0 ? silverZakatableGrams(g, asset, silverDeduction) * rates.silver_inr_per_gram : num(asset.valuation_inr);
    if (asset.category === "Platinum") return g > 0 ? platinumPureGrams(g, asset) * rates.platinum_inr_per_gram : num(asset.valuation_inr);
    if (asset.category === "Diamond") return diamondMarketInr(asset, rates.diamond_inr_per_carat);
    return 0.0;
  }

  function assetCountsTowardZakat(asset, rules, asOf) {
    if (!hawlComplete(asset, asOf)) return false;
    if (isPersonalJewelryExempt(asset, rules)) return false;
    return true;
  }

  // --- Core member calculation (zakat_engine.compute_member_zakat) ---
  function computeMemberZakat(member, assets, payments, rates, madhab, asOf) {
    const rules = getRules(madhab);
    const jewelryExempt = rules.jewelry_exempt;
    const debtMode = rules.debt_deduction;
    const silverDeduction = rules.silver_deduction_rate;
    const ref = asOf || todayUTC();

    let goldValue = 0, silverValue = 0, platinumValue = 0, diamondValue = 0;
    let cashValue = 0, investmentsWealth = 0, pfWealth = 0;
    let propertyValue = 0, propertyExemptWealth = 0, partnershipValue = 0;
    let livestockZakat = 0, agricultureZakat = 0, rikazZakat = 0;
    let livestockWealth = 0, agricultureWealth = 0, rikazWealth = 0;
    let deductions = 0, hawlPendingWealth = 0, assetsPendingHawl = 0;

    let totalGoldGrams = 0, totalSilverGrams = 0, totalPlatinumGrams = 0, totalDiamondCarats = 0;
    let zakatableSilverGrams = 0;

    for (const a of assets) {
      if (a.category === "Gold") totalGoldGrams += grams(a);
      else if (a.category === "Silver") totalSilverGrams += grams(a);
      else if (a.category === "Platinum") totalPlatinumGrams += grams(a);
      else if (a.category === "Diamond") totalDiamondCarats += diamondCarats(a);
      if (a.category === "Silver" && grams(a) > 0) {
        zakatableSilverGrams += silverZakatableGrams(grams(a), a, silverDeduction);
      }
    }

    for (const a of assets) {
      const cat = a.category;

      if (cat === "Livestock") {
        const heads = quantity(a);
        const perHead = num(a.valuation_inr);
        const herdValue = heads > 0 ? heads * perHead : 0.0;
        if (heads > 0 && hawlComplete(a, ref)) {
          const r = computeLivestockZakat(heads, a.asset_subtype, perHead);
          livestockZakat += r.zakat_inr;
          livestockWealth += herdValue;
        } else if (heads > 0 && !hawlComplete(a, ref)) {
          hawlPendingWealth += herdValue;
          assetsPendingHawl += 1;
        }
        continue;
      }

      if (cat === "Agriculture") {
        const harvest = num(a.valuation_inr);
        if (harvest > 0) {
          const [z] = agricultureZakatInr(harvest, a.asset_subtype);
          agricultureZakat += z;
          agricultureWealth += harvest;
        }
        continue;
      }

      if (cat === "Rikaz") {
        const treasure = num(a.valuation_inr);
        if (treasure > 0) {
          rikazZakat += treasure * RIKAZ_RATE;
          rikazWealth += treasure;
        }
        continue;
      }

      if (METAL_CATEGORIES.has(cat)) {
        const v = metalMarketValue(a, rates, silverDeduction);
        if (!assetCountsTowardZakat(a, rules, ref)) {
          if (!hawlComplete(a, ref)) { hawlPendingWealth += v; assetsPendingHawl += 1; }
          continue;
        }
        if (cat === "Gold") goldValue += v;
        else if (cat === "Silver") silverValue += v;
        else if (cat === "Platinum") platinumValue += v;
        else if (cat === "Diamond") diamondValue += v;
        continue;
      }

      const amount = effectiveValuationInr(a, rates, ref);

      if (cat === "Property") {
        const pv = propertyZakatableInr(a, ref);
        const exemptVal = propertyExemptMarketInr(a);
        propertyExemptWealth += exemptVal;
        if (pv <= 0 && amount > 0 && !hawlComplete(a, ref) && exemptVal <= 0) {
          hawlPendingWealth += amount; assetsPendingHawl += 1;
        }
        propertyValue += pv;
        continue;
      }

      if (cat === "Partnership") {
        if (assetCountsTowardZakat(a, rules, ref)) partnershipValue += amount;
        else if (amount > 0 && !hawlComplete(a, ref)) { hawlPendingWealth += amount; assetsPendingHawl += 1; }
        continue;
      }

      if (!assetCountsTowardZakat(a, rules, ref)) {
        if (!hawlComplete(a, ref)) { hawlPendingWealth += amount; assetsPendingHawl += 1; }
        continue;
      }

      if (cat === "Cash") cashValue += amount;
      else if (cat === "PF") pfWealth += amount;
      else if (cat === "Stocks" || cat === "Business") investmentsWealth += amount;
      else if (cat === "Liabilities") deductions += amount;
    }

    let investmentsNet, cashForNisab, cashZakatable;
    if (debtMode === "none") {
      investmentsNet = investmentsWealth; cashForNisab = cashValue; cashZakatable = cashValue;
    } else if (debtMode === "cash_only") {
      cashZakatable = Math.max(0.0, cashValue - deductions);
      investmentsNet = investmentsWealth; cashForNisab = cashZakatable;
    } else {
      investmentsNet = Math.max(0.0, investmentsWealth - deductions);
      cashForNisab = cashValue; cashZakatable = cashValue;
    }

    const nisabWealth = goldValue + silverValue + platinumValue + diamondValue +
      cashForNisab + investmentsNet + pfWealth + propertyValue + partnershipValue;

    const [nisabThreshold, nisabBasis] = resolveNisabThresholdInr(rules, rates, goldValue, silverValue);
    const isEligible = nisabWealth >= nisabThreshold;

    let monetaryZakat = 0, goldZakat = 0, silverZakat = 0, platinumZakat = 0, diamondZakat = 0;
    let cashZakat = 0, investmentsZakat = 0, pfZakat = 0, propertyZakat = 0, partnershipZakat = 0;
    if (isEligible && nisabWealth > 0) {
      monetaryZakat = nisabWealth * ZAKAT_RATE;
      goldZakat = goldValue * ZAKAT_RATE;
      silverZakat = silverValue * ZAKAT_RATE;
      platinumZakat = platinumValue * ZAKAT_RATE;
      diamondZakat = diamondValue * ZAKAT_RATE;
      cashZakat = cashZakatable * ZAKAT_RATE;
      investmentsZakat = investmentsNet * ZAKAT_RATE;
      pfZakat = pfWealth * ZAKAT_RATE;
      propertyZakat = propertyValue * ZAKAT_RATE;
      partnershipZakat = partnershipValue * ZAKAT_RATE;
    }

    const zakatDue = monetaryZakat + livestockZakat + agricultureZakat + rikazZakat;
    const totalPaid = payments.reduce((s, p) => s + num(p.amount_inr), 0);
    const remaining = zakatDue - totalPaid;

    const grossWealth = goldValue + silverValue + platinumValue + diamondValue + cashValue +
      investmentsWealth + pfWealth + propertyValue + propertyExemptWealth + partnershipValue +
      livestockWealth + agricultureWealth + rikazWealth;
    const netWealth = Math.max(0.0, grossWealth - deductions);
    const totalWealth = nisabWealth + propertyExemptWealth + livestockWealth + agricultureWealth + rikazWealth;

    return {
      member_id: member ? member.id : 0,
      member_name: member ? member.name : "",
      total_gold_grams: totalGoldGrams, total_silver_grams: totalSilverGrams,
      zakatable_silver_grams: zakatableSilverGrams, total_platinum_grams: totalPlatinumGrams,
      total_diamond_carats: totalDiamondCarats,
      gold_zakat_inr: goldZakat, silver_zakat_inr: silverZakat, platinum_zakat_inr: platinumZakat,
      diamond_zakat_inr: diamondZakat, cash_zakat_inr: cashZakat, investments_zakat_inr: investmentsZakat,
      pf_zakat_inr: pfZakat, property_zakat_inr: propertyZakat, partnership_zakat_inr: partnershipZakat,
      agriculture_zakat_inr: agricultureZakat, livestock_zakat_inr: livestockZakat, rikaz_zakat_inr: rikazZakat,
      monetary_zakat_inr: monetaryZakat,
      nisab_wealth_inr: nisabWealth, nisab_threshold_inr: nisabThreshold, nisab_basis: nisabBasis,
      is_eligible: isEligible, zakat_due_inr: zakatDue, total_paid_inr: totalPaid, remaining_inr: remaining,
      jewelry_exempt: jewelryExempt, hawl_pending_wealth_inr: hawlPendingWealth, assets_pending_hawl: assetsPendingHawl,
      gold_wealth_inr: goldValue, silver_wealth_inr: silverValue, platinum_wealth_inr: platinumValue,
      diamond_wealth_inr: diamondValue, cash_wealth_inr: cashForNisab, investments_wealth_inr: investmentsNet,
      pf_wealth_inr: pfWealth, property_wealth_inr: propertyValue, property_exempt_wealth_inr: propertyExemptWealth,
      partnership_wealth_inr: partnershipValue, agriculture_wealth_inr: agricultureWealth,
      livestock_wealth_inr: livestockWealth, rikaz_wealth_inr: rikazWealth, liabilities_wealth_inr: deductions,
      net_wealth_inr: netWealth, total_wealth_inr: totalWealth,
    };
  }

  function componentZakatValues(s) {
    return {
      gold: s.gold_zakat_inr, silver: s.silver_zakat_inr, platinum: s.platinum_zakat_inr,
      diamond: s.diamond_zakat_inr, cash: s.cash_zakat_inr, investments: s.investments_zakat_inr,
      pf: s.pf_zakat_inr, property: s.property_zakat_inr, partnership: s.partnership_zakat_inr,
      agriculture: s.agriculture_zakat_inr, livestock: s.livestock_zakat_inr, rikaz: s.rikaz_zakat_inr,
      total: s.zakat_due_inr,
    };
  }

  function componentWealthValues(s, netTotal) {
    const total = netTotal ? s.net_wealth_inr : s.total_wealth_inr;
    return {
      gold: s.gold_wealth_inr, silver: s.silver_wealth_inr, platinum: s.platinum_wealth_inr,
      diamond: s.diamond_wealth_inr, cash: s.cash_wealth_inr, investments: s.investments_wealth_inr,
      pf: s.pf_wealth_inr, property: s.property_wealth_inr, property_exempt: s.property_exempt_wealth_inr,
      partnership: s.partnership_wealth_inr, agriculture: s.agriculture_wealth_inr,
      livestock: s.livestock_wealth_inr, rikaz: s.rikaz_wealth_inr, total: total,
    };
  }

  function computeHousehold(members, rates, madhab, asOf) {
    const ref = asOf || zakatAsOf();
    const summaries = members.map((m) =>
      computeMemberZakat(m, m.assets || [], m.zakat_payments || [], rates, madhab, ref)
    );
    return {
      rates, members: summaries, madhab,
      total_zakat_inr: summaries.reduce((s, x) => s + x.zakat_due_inr, 0),
      total_paid_inr: summaries.reduce((s, x) => s + x.total_paid_inr, 0),
      total_remaining_inr: summaries.reduce((s, x) => s + x.remaining_inr, 0),
      zakat_baseline_date: ref,
    };
  }

  // --- Hijri Zakat calendar (zakat_calendar.py) via Intl Umm al-Qura ---
  let _hijriFmt = null;
  function hijriParts(d) {
    if (!_hijriFmt) {
      _hijriFmt = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
        day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC",
      });
    }
    const parts = _hijriFmt.formatToParts(d);
    let y = 0, m = 0, day = 0;
    for (const p of parts) {
      if (p.type === "year") y = parseInt(p.value.replace(/[^0-9]/g, ""), 10);
      else if (p.type === "month") m = parseInt(p.value, 10);
      else if (p.type === "day") day = parseInt(p.value, 10);
    }
    return { year: y, month: m, day };
  }

  function gregorianOfRamadan1(hijriYear) {
    // Estimate gregorian year then scan for 1 Ramadan (hijri month 9, day 1).
    const approxGregYear = Math.floor(hijriYear * 0.970229 + 621.5643);
    let cursor = new Date(Date.UTC(approxGregYear - 1, 0, 1));
    for (let i = 0; i < 900; i++) {
      const h = hijriParts(cursor);
      if (h.year === hijriYear && h.month === 9 && h.day === 1) return cursor;
      cursor = new Date(cursor.getTime() + 86400000);
    }
    return null;
  }

  function firstFridayOfRamadan(hijriYear) {
    const start = gregorianOfRamadan1(hijriYear);
    if (!start) return null;
    // JS getUTCDay: Sunday=0..Saturday=6; Friday=5. Python Friday weekday=4 (Mon=0).
    const daysUntilFriday = (5 - start.getUTCDay() + 7) % 7;
    return new Date(start.getTime() + daysUntilFriday * 86400000);
  }

  function currentZakatBaselineDate(today) {
    const t = today || todayUTC();
    const hy = hijriParts(t).year;
    const candidates = [];
    for (const year of [hy, hy - 1]) {
      const ff = firstFridayOfRamadan(year);
      if (ff && ff <= t) candidates.push(ff);
    }
    if (candidates.length) return new Date(Math.max(...candidates.map((d) => d.getTime())));
    return firstFridayOfRamadan(hy - 1);
  }

  function nextZakatBaselineDate(today) {
    const t = today || todayUTC();
    const hy = hijriParts(t).year;
    for (let year = hy; year < hy + 3; year++) {
      const ff = firstFridayOfRamadan(year);
      if (ff && ff > t) return ff;
    }
    return firstFridayOfRamadan(hy + 2);
  }

  function zakatAsOf(today) { return currentZakatBaselineDate(today); }

  function formatHijriDate(d) {
    const monthFmt = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    });
    return monthFmt.format(d) + " AH";
  }

  // --- Currency (display + FX target for live rates) ---
  const CURRENCIES = [
    ["INR", "Indian Rupee"], ["USD", "US Dollar"], ["EUR", "Euro"], ["GBP", "British Pound"],
    ["AED", "UAE Dirham"], ["SAR", "Saudi Riyal"], ["QAR", "Qatari Riyal"], ["KWD", "Kuwaiti Dinar"],
    ["BHD", "Bahraini Dinar"], ["OMR", "Omani Rial"], ["PKR", "Pakistani Rupee"], ["BDT", "Bangladeshi Taka"],
    ["LKR", "Sri Lankan Rupee"], ["NPR", "Nepalese Rupee"], ["MYR", "Malaysian Ringgit"], ["IDR", "Indonesian Rupiah"],
    ["SGD", "Singapore Dollar"], ["BND", "Brunei Dollar"], ["TRY", "Turkish Lira"], ["EGP", "Egyptian Pound"],
    ["MAD", "Moroccan Dirham"], ["DZD", "Algerian Dinar"], ["TND", "Tunisian Dinar"], ["JOD", "Jordanian Dinar"],
    ["NGN", "Nigerian Naira"], ["GHS", "Ghanaian Cedi"], ["XOF", "West African CFA Franc"],
    ["XAF", "Central African CFA Franc"], ["ETB", "Ethiopian Birr"], ["TZS", "Tanzanian Shilling"],
    ["KES", "Kenyan Shilling"], ["ZAR", "South African Rand"],
    ["IQD", "Iraqi Dinar"], ["LYD", "Libyan Dinar"], ["SYP", "Syrian Pound"],
    ["KZT", "Kazakhstani Tenge"], ["AZN", "Azerbaijani Manat"], ["UZS", "Uzbekistani Som"],
    ["CAD", "Canadian Dollar"], ["AUD", "Australian Dollar"], ["NZD", "New Zealand Dollar"],
    ["JPY", "Japanese Yen"], ["CNY", "Chinese Yuan"], ["CHF", "Swiss Franc"],
    ["SEK", "Swedish Krona"], ["NOK", "Norwegian Krone"], ["DKK", "Danish Krone"],
    ["RUB", "Russian Ruble"], ["BRL", "Brazilian Real"], ["MXN", "Mexican Peso"],
  ];

  const REGION_CURRENCY = {
    IN: "INR", US: "USD", GB: "GBP", AE: "AED", SA: "SAR", QA: "QAR", KW: "KWD",
    BH: "BHD", OM: "OMR", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", MY: "MYR",
    ID: "IDR", SG: "SGD", BN: "BND", TR: "TRY", EG: "EGP", MA: "MAD", DZ: "DZD",
    TN: "TND", JO: "JOD",
    NG: "NGN", GH: "GHS", SN: "XOF", ML: "XOF", BF: "XOF", CI: "XOF", NE: "XOF", TG: "XOF",
    BJ: "XOF", CM: "XAF", CG: "XAF", CD: "XAF", TD: "XAF", CF: "XAF", GQ: "XAF", GA: "XAF",
    ET: "ETB", TZ: "TZS", KE: "KES", ZA: "ZAR",
    IQ: "IQD", LY: "LYD", SY: "SYP",
    KZ: "KZT", AZ: "AZN", UZ: "UZS",
    CA: "CAD", AU: "AUD",
    NZ: "NZD", JP: "JPY", CN: "CNY", CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK",
    RU: "RUB", BR: "BRL", MX: "MXN",
  };
  "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" ")
    .forEach((r) => { REGION_CURRENCY[r] = "EUR"; });

  const TZ_CURRENCY = {
    "Asia/Kolkata": "INR", "Asia/Calcutta": "INR", "Asia/Karachi": "PKR", "Asia/Dhaka": "BDT",
    "Asia/Dubai": "AED", "Asia/Riyadh": "SAR", "Asia/Qatar": "QAR", "Asia/Kuwait": "KWD",
    "Asia/Bahrain": "BHD", "Asia/Muscat": "OMR", "Asia/Colombo": "LKR", "Asia/Kathmandu": "NPR",
    "Asia/Kuala_Lumpur": "MYR", "Asia/Jakarta": "IDR", "Asia/Singapore": "SGD", "Asia/Brunei": "BND",
    "Europe/Istanbul": "TRY", "Africa/Cairo": "EGP", "Africa/Casablanca": "MAD", "Africa/Lagos": "NGN",
    "Africa/Nairobi": "KES", "Africa/Johannesburg": "ZAR", "Europe/London": "GBP",
    "Australia/Sydney": "AUD", "Pacific/Auckland": "NZD", "Asia/Tokyo": "JPY", "Asia/Shanghai": "CNY",
  };

  const KNOWN_CURRENCY = {};
  CURRENCIES.forEach((c) => { KNOWN_CURRENCY[c[0]] = true; });

  // Best-effort local-currency guess from the browser's locale/timezone.
  // No network call and nothing about the user leaves the device.
  function detectCurrency() {
    try {
      const locales = (navigator.languages && navigator.languages.length)
        ? navigator.languages : [navigator.language || ""];
      for (const loc of locales) {
        const m = String(loc).match(/[-_]([A-Za-z]{2})(?:\b|$)/);
        if (m) {
          const cur = REGION_CURRENCY[m[1].toUpperCase()];
          if (cur) return cur;
        }
      }
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      if (TZ_CURRENCY[tz]) return TZ_CURRENCY[tz];
      if (/^America\//.test(tz)) return "USD";
      if (/^Europe\//.test(tz)) return "EUR";
    } catch (e) { /* fall through */ }
    return "INR";
  }

  // Map an ISO country code to a supported currency ("" when unknown).
  function currencyForRegion(region) {
    return REGION_CURRENCY[String(region || "").toUpperCase()] || "";
  }

  function isKnownCurrency(code) {
    return !!KNOWN_CURRENCY[String(code || "").toUpperCase()];
  }

  let displayCurrency = "INR";
  let moneyFmt = null;

  function setDisplayCurrency(code) {
    code = String(code || "INR").toUpperCase();
    if (!KNOWN_CURRENCY[code]) code = "INR";
    displayCurrency = code;
    try {
      moneyFmt = new Intl.NumberFormat(code === "INR" ? "en-IN" : "en", {
        style: "currency", currency: code, currencyDisplay: "narrowSymbol",
      });
    } catch (e) { moneyFmt = null; }
  }

  function getDisplayCurrency() { return displayCurrency; }

  function currencySymbol(code) {
    code = String(code || displayCurrency).toUpperCase();
    try {
      const parts = new Intl.NumberFormat("en", {
        style: "currency", currency: code, currencyDisplay: "narrowSymbol",
      }).formatToParts(1);
      const p = parts.find((x) => x.type === "currency");
      return p ? p.value : code;
    } catch (e) { return code; }
  }

  setDisplayCurrency("INR");

  // --- Formatting ---
  // Historically INR-only (hence the name); now formats in the selected display currency.
  function fmtINR(amount) {
    const n = num(amount);
    if (moneyFmt) return moneyFmt.format(n);
    return "\u20B9" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtGrams(value) {
    if (value === null || value === undefined || value === "") return "";
    const g = num(value);
    let text = g.toFixed(3);
    text = text.replace(/0+$/, "").replace(/\.$/, "");
    return text;
  }
  function fmtDate(d) {
    if (!d) return "";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  }

  global.ZK = global.ZK || {};
  Object.assign(global.ZK, {
    // constants
    ZAKAT_RATE, NISAB_GOLD_GRAMS, NISAB_SILVER_GRAMS, DEFAULTS, CATEGORIES, CATEGORY_GROUPS,
    MADHAB_RULES, DEFAULT_MADHAB, COMPONENT_LABELS, WEALTH_COMPONENT_LABELS, CHART_KEY_ORDER, METAL_CATEGORIES, JEWELRY_CATEGORIES,
    PURITY_OPTIONS, PURITY_PRESETS, DEFAULT_PURITY_BY_METAL,
    // calc
    computeMemberZakat, computeHousehold, componentZakatValues, componentWealthValues,
    effectiveValuationInr, metalMarketValue, purityLabel, purityFactorForAsset, parsePurityFactor,
    populatePuritySelect, resolvePurityValue, isPresetPurity, purityFieldLabel,
    isPfAsset, projectedPfInr, hawlComplete, hawlDaysRemaining, computeLivestockZakat, agricultureZakatInr,
    // snapshots / trends
    INR_RECORDED_CATEGORIES, TRACKED_CATEGORIES, effectiveAcquiredYear, pickSnapshot, assetAsOf,
    assetsAsOfYear, snapshotState, valuationChangeNotes, displayValueInr,
    // calendar
    zakatAsOf, currentZakatBaselineDate, nextZakatBaselineDate, formatHijriDate, hijriParts, todayUTC,
    // currency
    CURRENCIES, detectCurrency, currencyForRegion, isKnownCurrency, setDisplayCurrency, getDisplayCurrency, currencySymbol,
    // format
    fmtINR, fmtGrams, fmtDate, num,
  });
})(window);
