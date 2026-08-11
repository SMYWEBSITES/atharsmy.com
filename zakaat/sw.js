/*
 * Zakat Calculator — Service Worker
 * Provides offline-first app shell caching.
 *
 * Strategy:
 *   - App shell files (HTML, CSS, JS, images): cache-first, updated in background
 *   - External APIs (metal rates, FX): network-only (stale rates are worse than no rates)
 *   - Fonts (Google Fonts): cache-first with network fallback
 *
 * Bump CACHE_VERSION when deploying breaking changes so old caches are evicted.
 */

const CACHE_VERSION = "zakat-v5";
const FONT_CACHE    = "zakat-fonts-v1";

// App shell — everything the app needs to boot offline
const APP_SHELL = [
  "/zakaat/",
  "/zakaat/index.html",
  "/zakaat/styles.css",
  "/zakaat/manifest.json",
  "/zakaat/app/zakat.js",
  "/zakaat/app/storage.js",
  "/zakaat/app/rates.js",
  "/zakaat/app/rates_history.js",
  "/zakaat/app/help.js",
  "/zakaat/app/ui.js",
  "/zakaat/app/excel.js",
  "/zakaat/app/gdrive.js",
  "/zakaat/assets/logo.svg",
  "/zakaat/assets/logo.png",
  "/zakaat/assets/icon-192.png",
  "/zakaat/assets/icon-512.png",
  "/zakaat/assets/kaaba-hero.jpg",
  "/zakaat/vendor/xlsx.full.min.js",
  "/js/analytics.js",
  "/js/gtag-bootstrap.js",
];

// External origins that must always go to the network (live data)
const NETWORK_ONLY_ORIGINS = [
  "api.gold-api.com",
  "api.frankfurter.dev",
  "open.er-api.com",
  "ipapi.co",
  "ipwho.is",
  "accounts.google.com",
  "www.googleapis.com",
  "www.googletagmanager.com",
  "www.google-analytics.com",
  "region1.google-analytics.com",
  "region2.google-analytics.com",
  "analytics.google.com",
];

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(APP_SHELL).catch((err) => {
        // Don't fail the install if one non-critical resource 404s
        console.warn("[SW] Pre-cache partially failed:", err);
      })
    )
  );
  self.skipWaiting(); // Activate immediately (don't wait for old tabs to close)
});

// ── Activate: evict stale caches ─────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION && k !== FONT_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim(); // Take control of all open tabs immediately
});

// ── Fetch: route requests ─────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests
  if (req.method !== "GET") return;

  // Network-only: live API calls
  if (NETWORK_ONLY_ORIGINS.includes(url.hostname)) {
    event.respondWith(fetch(req));
    return;
  }

  // Font files: cache-first, long-lived
  if (url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com") {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((response) => {
            if (response.ok) cache.put(req, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // App shell: cache-first, stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        // Kick off a background refresh
        const networkFetch = fetch(req)
          .then((response) => {
            if (response.ok && req.url.startsWith(self.location.origin)) {
              cache.put(req, response.clone());
            }
            return response;
          })
          .catch(() => null);

        // Serve cache immediately if available, otherwise wait for network
        return cached || networkFetch;
      })
    )
  );
});
