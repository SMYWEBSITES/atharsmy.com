/*
 * GA4 gtag bootstrap (external file for CSP-compliant pages).
 * Queues calls on dataLayer until gtag.js loads; config runs in analytics.js.
 */
(function (global) {
  "use strict";

  global.GA_ID = global.GA_ID || "G-3DFSY795RJ";
  if (global.GA_SECTION === undefined && location.pathname.indexOf("/zakaat") !== -1) {
    global.GA_SECTION = "zakat";
  }

  global.dataLayer = global.dataLayer || [];
  function gtag() {
    global.dataLayer.push(arguments);
  }
  global.gtag = gtag;
  gtag("js", new Date());
})(window);
