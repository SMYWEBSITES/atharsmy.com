/*
 * Optional live market-rate fetch — runs entirely in the browser via fetch().
 *
 * The app still works 100% offline; this module only reaches the internet when
 * the user explicitly clicks "Fetch live rates" (or has auto-fetch on). It
 * mirrors the server's spot path (app/rate_fetcher.py): metal USD/oz from
 * gold-api.com, converted to the user's currency per gram using a live
 * USD->{currency} rate. Diamond has no free public API, so the current/manual
 * value is kept (same behaviour as the server).
 *
 * Only CORS-enabled, key-free endpoints are used so they work from a static page.
 */
(function (global) {
  "use strict";

  const ZK = global.ZK;
  const TROY_OZ_GRAMS = 31.1034768;
  const HTTP_TIMEOUT_MS = 12000;

  const GOLD_API = "https://api.gold-api.com/price"; // /XAU /XAG /XPT  -> USD per troy oz
  const FX_PRIMARY = "https://api.frankfurter.dev/v1/latest?base=USD&symbols={CUR}";
  const FX_FALLBACK = "https://open.er-api.com/v6/latest/USD";

  const SYMBOLS = {
    gold_inr_per_gram: "XAU",
    silver_inr_per_gram: "XAG",
    platinum_inr_per_gram: "XPT",
  };

  // Plausibility bounds in USD per troy oz — currency-independent, so they
  // reject obviously-bad or poisoned data no matter what the FX target is.
  const SANITY_USD_OZ = {
    gold_inr_per_gram: [500, 20000],
    silver_inr_per_gram: [2, 1000],
    platinum_inr_per_gram: [100, 20000],
  };
  // USD->{currency} plausibility: positive, finite, not absurd.
  const FX_BOUNDS = [1e-4, 1e6];

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

  function fetchUsdFx(currency) {
    if (currency === "USD") return Promise.resolve(1);
    return fetchJson(FX_PRIMARY.replace("{CUR}", currency))
      .then((d) => {
        const v = d && d.rates && Number(d.rates[currency]);
        if (inRange(v, FX_BOUNDS)) return v;
        throw new Error("implausible " + currency + " in response");
      })
      .catch(() =>
        fetchJson(FX_FALLBACK).then((d) => {
          const v = d && d.rates && Number(d.rates[currency]);
          if (inRange(v, FX_BOUNDS)) return v;
          throw new Error("USD/" + currency + " unavailable");
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
   * Resolve live metal rates in the given currency (default INR). Returns:
   *   { rates: {gold_inr_per_gram, silver_inr_per_gram, platinum_inr_per_gram, diamond_inr_per_carat},
   *     sources: {key: label}, warnings: [..], usd_inr, currency, fetched_at, ok }
   * (The *_inr field names are historical — values are in `currency`.)
   * Diamond is carried over from currentDiamond (manual value).
   */
  function fetchLiveRates(currentDiamond, currency) {
    currency = String(currency || "INR").toUpperCase();
    const fetchedAt = new Date();
    const label = fetchedAt.toLocaleString();
    const warnings = [];
    const sources = {};
    const values = {};

    return fetchUsdFx(currency)
      .then((fx) => {
        const jobs = Object.keys(SYMBOLS).map((key) => {
          const symbol = SYMBOLS[key];
          return fetchSpotUsdOz(symbol)
            .then((usdPerOz) => {
              if (!inRange(usdPerOz, SANITY_USD_OZ[key])) {
                warnings.push("Ignored an out-of-range " + symbol + " quote ($" + usdPerOz.toFixed(2) + "/oz).");
                return;
              }
              values[key] = (usdPerOz * fx) / TROY_OZ_GRAMS;
              sources[key] = "Spot " + symbol + " ($" + usdPerOz.toFixed(2) + "/oz"
                + (currency === "USD" ? "" : " × " + fx.toFixed(2) + " " + currency + "/USD")
                + ") · " + label;
            })
            .catch((e) => {
              warnings.push("Could not fetch " + symbol + " spot price (" + e.message + ").");
            });
        });
        return Promise.all(jobs).then(() => fx);
      })
      .then((fx) => {
        const diamond = ZK.num(currentDiamond);
        const rates = {
          gold_inr_per_gram: values.gold_inr_per_gram,
          silver_inr_per_gram: values.silver_inr_per_gram,
          platinum_inr_per_gram: values.platinum_inr_per_gram,
          diamond_inr_per_carat: diamond,
        };
        sources.diamond_inr_per_carat = "Manual / unchanged (no public diamond API) · checked " + label;
        const ok = ["gold_inr_per_gram", "silver_inr_per_gram", "platinum_inr_per_gram"].every(
          (k) => values[k] && values[k] > 0
        );
        return { rates, sources, warnings, usd_inr: fx, currency, fetched_at: fetchedAt, ok };
      });
  }

  /*
   * Location lookup for first-run defaults (currency + help language).
   * Uses free, key-less, CORS-enabled geo-IP endpoints; only the response's
   * country/currency is used and nothing is stored beyond the user's choice.
   * Returns { country, countryName, currency } or rejects when offline/blocked.
   */
  const GEO_PRIMARY = "https://ipapi.co/json/";
  const GEO_FALLBACK = "https://ipwho.is/";

  function detectLocation() {
    return fetchJson(GEO_PRIMARY)
      .then((d) => {
        if (!d || !d.country_code) throw new Error("no location in response");
        return {
          country: String(d.country_code).toUpperCase(),
          countryName: d.country_name || "",
          currency: d.currency ? String(d.currency).toUpperCase() : "",
        };
      })
      .catch(() =>
        fetchJson(GEO_FALLBACK).then((d) => {
          if (!d || d.success === false || !d.country_code) throw new Error("location unavailable");
          return {
            country: String(d.country_code).toUpperCase(),
            countryName: d.country || "",
            currency: d.currency && d.currency.code ? String(d.currency.code).toUpperCase() : "",
          };
        })
      );
  }

  global.ZKRates = { fetchLiveRates, detectLocation };
})(window);
