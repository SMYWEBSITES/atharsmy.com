/*
 * Optional live market-rate fetch — runs entirely in the browser via fetch().
 *
 * The app still works 100% offline; this module only reaches the internet when
 * the user explicitly clicks "Fetch live rates". It mirrors the server's spot
 * path (app/rate_fetcher.py): metal USD/oz from gold-api.com, converted to
 * INR/gram using a live USD->INR rate. Diamond has no free public API, so the
 * current/manual value is kept (same behaviour as the server).
 *
 * Only CORS-enabled, key-free endpoints are used so they work from a static page.
 */
(function (global) {
  "use strict";

  const ZK = global.ZK;
  const TROY_OZ_GRAMS = 31.1034768;
  const HTTP_TIMEOUT_MS = 12000;

  const GOLD_API = "https://api.gold-api.com/price"; // /XAU /XAG /XPT  -> USD per troy oz
  const FX_PRIMARY = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR";
  const FX_FALLBACK = "https://open.er-api.com/v6/latest/USD";

  const SYMBOLS = {
    gold_inr_per_gram: "XAU",
    silver_inr_per_gram: "XAG",
    platinum_inr_per_gram: "XPT",
  };

  // Plausibility bounds (INR/gram) to reject obviously-bad or poisoned data.
  const SANITY = {
    gold_inr_per_gram: [1000, 100000],
    silver_inr_per_gram: [10, 5000],
    platinum_inr_per_gram: [500, 50000],
  };
  // USD/INR plausibility band.
  const FX_BOUNDS = [40, 200];

  function inRange(v, range) {
    return typeof v === "number" && isFinite(v) && v >= range[0] && v <= range[1];
  }

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

  function fetchUsdInr() {
    return fetchJson(FX_PRIMARY)
      .then((d) => {
        const v = d && d.rates && Number(d.rates.INR);
        if (inRange(v, FX_BOUNDS)) return v;
        throw new Error("implausible INR in response");
      })
      .catch(() =>
        fetchJson(FX_FALLBACK).then((d) => {
          const v = d && d.rates && Number(d.rates.INR);
          if (inRange(v, FX_BOUNDS)) return v;
          throw new Error("USD/INR unavailable");
        })
      );
  }

  function fetchSpotUsdOz(symbol) {
    return fetchJson(GOLD_API + "/" + symbol).then((d) => {
      const v = Number(d && d.price);
      if (v && v > 0) return v;
      throw new Error("no price for " + symbol);
    });
  }

  /*
   * Resolve live metal rates. Returns:
   *   { rates: {gold_inr_per_gram, silver_inr_per_gram, platinum_inr_per_gram, diamond_inr_per_carat},
   *     sources: {key: label}, warnings: [..], usd_inr, fetched_at, ok }
   * Diamond is carried over from currentDiamond (manual value).
   */
  function fetchLiveRates(currentDiamond) {
    const fetchedAt = new Date();
    const label = fetchedAt.toLocaleString();
    const warnings = [];
    const sources = {};
    const values = {};

    return fetchUsdInr()
      .then((usdInr) => {
        const jobs = Object.keys(SYMBOLS).map((key) => {
          const symbol = SYMBOLS[key];
          return fetchSpotUsdOz(symbol)
            .then((usdPerOz) => {
              const perGram = (usdPerOz * usdInr) / TROY_OZ_GRAMS;
              if (!inRange(perGram, SANITY[key])) {
                warnings.push("Ignored an out-of-range " + symbol + " price (\u20b9" + perGram.toFixed(0) + "/g).");
                return;
              }
              values[key] = perGram;
              sources[key] = "Spot " + symbol + " ($" + usdPerOz.toFixed(2) + "/oz \u00d7 \u20b9" + usdInr.toFixed(2) + "/USD) \u00b7 " + label;
            })
            .catch((e) => {
              warnings.push("Could not fetch " + symbol + " spot price (" + e.message + ").");
            });
        });
        return Promise.all(jobs).then(() => usdInr);
      })
      .then((usdInr) => {
        const diamond = ZK.num(currentDiamond);
        const rates = {
          gold_inr_per_gram: values.gold_inr_per_gram,
          silver_inr_per_gram: values.silver_inr_per_gram,
          platinum_inr_per_gram: values.platinum_inr_per_gram,
          diamond_inr_per_carat: diamond,
        };
        sources.diamond_inr_per_carat = "Manual / unchanged (no public diamond API) \u00b7 checked " + label;
        const ok = ["gold_inr_per_gram", "silver_inr_per_gram", "platinum_inr_per_gram"].every(
          (k) => values[k] && values[k] > 0
        );
        return { rates, sources, warnings, usd_inr: usdInr, fetched_at: fetchedAt, ok };
      });
  }

  global.ZKRates = { fetchLiveRates };
})(window);
