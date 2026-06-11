/*
 * Google Analytics 4 — loads only on production (not localhost).
 * Set your Measurement ID from GA4 → Admin → Data streams → Web.
 */
(function () {
  "use strict";

  var MEASUREMENT_ID = "G-3DFSY795RJ";

  if (!MEASUREMENT_ID || MEASUREMENT_ID.indexOf("G-") !== 0 || /X/i.test(MEASUREMENT_ID)) {
    return;
  }

  var host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID);

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(MEASUREMENT_ID);
  document.head.appendChild(s);
})();
