/*
 * Optional historical (per-year) market-rate fetch — runs entirely in the browser.
 *
 * Mirrors the server's app/historical_rates.py, but limited to CORS-friendly,
 * key-free sources so it works from a static page:
 *   - Gold USD/oz per year: freegoldapi.com (no key, CORS *)
 *   - USD/INR per year:      api.frankfurter.dev range endpoint (CORS *)
 *
 * Silver and platinum history have no free CORS API (the server uses Yahoo
 * Finance, which blocks cross-origin browser requests). So, exactly like the
 * server's documented fallback, silver is estimated from gold via a fixed oz
 * ratio and platinum uses your current session rate. These are flagged as
 * estimates so you can override any year by hand.
 *
 * Only runs when the user clicks "Fetch". Nothing is sent about the user.
 */
(function (global) {
  "use strict";

  const ZK = global.ZK;
  const TROY_OZ_GRAMS = 31.1034768;
  const HTTP_TIMEOUT_MS = 30000;
  const SILVER_GOLD_OZ_RATIO_FALLBACK = 70.0;

  const FREE_GOLD_JSON = "https://freegoldapi.com/data/latest.json";
  const FRANKFURTER_RANGE = "https://api.frankfurter.dev/v1/{start}..{end}?base=USD&symbols=INR";

  function fetchJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
    return fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .finally(() => clearTimeout(timer));
  }

  function goldUsdOzByYear(list, startYear, endYear) {
    if (!Array.isArray(list)) return {};
    const buckets = {};
    for (const row of list) {
      const year = parseInt(String(row && row.date).slice(0, 4), 10);
      const price = Number(row && row.price);
      if (year >= startYear && year <= endYear && price > 0) {
        (buckets[year] = buckets[year] || []).push(price);
      }
    }
    const out = {};
    for (const y of Object.keys(buckets)) {
      const a = buckets[y];
      out[y] = a.reduce((s, v) => s + v, 0) / a.length;
    }
    return out;
  }

  function usdInrByYear(payload, startYear, endYear) {
    const rates = (payload && payload.rates) || {};
    const byYear = {};
    for (const date of Object.keys(rates)) {
      const year = parseInt(date.slice(0, 4), 10);
      const inr = rates[date] && Number(rates[date].INR);
      if (inr > 0 && year >= startYear && year <= endYear) {
        (byYear[year] = byYear[year] || []).push([date, inr]);
      }
    }
    const out = {};
    for (const y of Object.keys(byYear)) {
      byYear[y].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      out[y] = byYear[y][byYear[y].length - 1][1]; // last reading in the year
    }
    return out;
  }

  // Nearest-year fallback, matching the server's _value_for_year.
  function valueForYear(year, map) {
    const keys = Object.keys(map).map(Number);
    if (map[year] != null) return map[year];
    const prior = keys.filter((k) => k < year);
    if (prior.length) return map[Math.max.apply(null, prior)];
    const future = keys.filter((k) => k > year);
    if (future.length) return map[Math.min.apply(null, future)];
    return null;
  }

  /*
   * fetchHistoricalRates(startYear, endYear, anchor)
   *   anchor: current session rates (used for platinum + diamond per year).
   * Resolves: { ratesByYear: {year: {gold,silver,platinum,diamond}},
   *             warnings: [...], estimated: true }
   */
  function fetchHistoricalRates(startYear, endYear, anchor) {
    startYear = parseInt(startYear, 10);
    endYear = parseInt(endYear, 10);
    if (!(startYear >= 1900) || !(endYear >= startYear)) {
      return Promise.reject(new Error("Enter a valid year range."));
    }
    const rangeUrl = FRANKFURTER_RANGE
      .replace("{start}", startYear + "-01-01")
      .replace("{end}", endYear + "-12-31");

    const warnings = [];
    return Promise.all([
      fetchJson(FREE_GOLD_JSON).catch(() => null),
      fetchJson(rangeUrl).catch(() => null),
    ]).then(([goldList, fxPayload]) => {
      const goldOz = goldUsdOzByYear(goldList, startYear, endYear);
      const usdInr = usdInrByYear(fxPayload, startYear, endYear);

      if (!Object.keys(goldOz).length) warnings.push("Could not load historical gold prices (freegoldapi.com).");
      if (!Object.keys(usdInr).length) warnings.push("Could not load historical USD/INR (Frankfurter).");

      const anchorPlat = ZK.num(anchor && anchor.platinum_inr_per_gram);
      const anchorDia = ZK.num(anchor && anchor.diamond_inr_per_carat);

      const ratesByYear = {};
      const missing = [];
      for (let y = startYear; y <= endYear; y++) {
        const fx = valueForYear(y, usdInr);
        const gOz = valueForYear(y, goldOz);
        if (!fx || !gOz) { missing.push(y); continue; }
        const sOz = gOz / SILVER_GOLD_OZ_RATIO_FALLBACK;
        ratesByYear[y] = {
          gold_inr_per_gram: (gOz * fx) / TROY_OZ_GRAMS,
          silver_inr_per_gram: (sOz * fx) / TROY_OZ_GRAMS,
          platinum_inr_per_gram: anchorPlat > 0 ? anchorPlat : 0,
          diamond_inr_per_carat: anchorDia,
        };
      }

      if (Object.keys(ratesByYear).length) {
        warnings.push(
          "Silver history estimated from gold (" + SILVER_GOLD_OZ_RATIO_FALLBACK +
          ":1 oz ratio); platinum uses your current session rate. A browser can't reach " +
          "Yahoo Finance for silver/platinum history \u2014 edit any year to override."
        );
      }
      if (missing.length) {
        warnings.push("No market data for " + missing.length + " year(s): " + missing.join(", ") + ".");
      }
      return { ratesByYear: ratesByYear, warnings: warnings, estimated: true };
    });
  }

  global.ZKHistory = { fetchHistoricalRates };
})(window);
