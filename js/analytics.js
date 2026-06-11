/*
 * Shared GA4 helpers for atharsmy.com (Profile Site + Zakat Calculator).
 * Privacy: no personal information is sent except the public family name "Athar".
 * Requires gtag bootstrap in each HTML page (async gtag.js + dataLayer).
 */
(function (global) {
  "use strict";

  var ID = global.GA_ID || "G-3DFSY795RJ";
  var FAMILY_NAME = "Athar";

  var PATH_ALIASES = {
    "": "/",
    "index.html": "/",
    "/index.html": "/",
    "familyHistory.html": "/family-history",
    "/familyHistory.html": "/family-history",
    "privacy.html": "/privacy",
    "/privacy.html": "/privacy",
  };

  function enabled() {
    var host = location.hostname;
    return host !== "localhost" && host !== "127.0.0.1" && typeof global.gtag === "function";
  }

  function isZakatApp() {
    return global.GA_SECTION === "zakat" || location.pathname.indexOf("/zakaat") !== -1;
  }

  function contentGroup() {
    return isZakatApp() ? "Zakat Calculator" : "Profile Site";
  }

  function normalizePath() {
    var path = location.pathname || "/";
    if (path.indexOf("/zakaat") === 0) {
      if (path === "/zakaat" || path === "/zakaat/" || path === "/zakaat/index.html") return "/zakaat/";
      return path.replace(/\/index\.html$/, "/");
    }
    var file = path.split("/").pop() || "";
    return PATH_ALIASES[file] || PATH_ALIASES[path] || path;
  }

  function anonymizedTitle(path) {
    path = path || normalizePath();
    if (path === "/") return "Home";
    if (path === "/family-history") return "Family History";
    if (path === "/privacy") return "Privacy Policy";
    if (path.indexOf("/zakaat/") === 0) {
      var tab = path.replace("/zakaat/", "").replace(/\/$/, "") || "dashboard";
      var labels = {
        dashboard: "Dashboard",
        analytics: "Analytics",
        yearly: "Yearly Review",
        rates: "Market Rates",
        backup: "Backup",
        guide: "About",
      };
      return "Zakat Calculator — " + (labels[tab] || tab);
    }
    if (path.indexOf("/zakaat") === 0) return "Zakat Calculator";
    return "Profile Site";
  }

  function outboundDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "external";
    }
  }

  function sanitizeParams(name, params) {
    var clean = { send_to: ID };
    var src = params || {};
    var key;

    for (key in src) {
      if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
      if (key === "link_text" || key === "file" || key === "link_url" || key === "send_to") continue;
      clean[key] = src[key];
    }

    if (name === "family_name_view" || (name === "section_view" && src.section_id === "family-name")) {
      clean.family_name = FAMILY_NAME;
    }

    if (name === "outbound_click" && src.link_url) {
      clean.link_domain = outboundDomain(src.link_url);
      clean.outbound = true;
    }

    if (!clean.site_section) clean.site_section = contentGroup();
    return clean;
  }

  function trackPageView(opts) {
    if (!enabled()) return;
    opts = opts || {};
    var pagePath = opts.path || normalizePath();
    var pageParams = sanitizeParams("page_view", {
      page_location: location.origin + pagePath,
      page_path: pagePath,
      site_section: opts.section || contentGroup(),
    });
    pageParams.page_title = anonymizedTitle(pagePath);
    global.gtag("event", "page_view", pageParams);
  }

  function trackEvent(name, params) {
    if (!enabled()) return;
    if (!name || !String(name).trim()) return;
    global.gtag("event", String(name).trim(), sanitizeParams(name, params));
  }

  function initConfig() {
    if (!enabled()) return;
    var zakat = isZakatApp();
    var pagePath = normalizePath();
    global.gtag("config", ID, {
      send_page_view: !zakat,
      page_path: pagePath,
      page_title: anonymizedTitle(pagePath),
      content_group: contentGroup(),
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
  }

  function initMainSiteEngagement() {
    if (isZakatApp()) return;

    document.addEventListener("click", function (e) {
      var link = e.target.closest("a[href]");
      if (!link) return;
      var href = link.getAttribute("href") || "";

      if (href.indexOf("mailto:") === 0) {
        trackEvent("contact_click", { method: "email" });
        return;
      }
      if (href.indexOf("http") === 0 && href.indexOf(location.hostname) === -1) {
        trackEvent("outbound_click", { link_url: href });
        return;
      }
      if (href.indexOf("zakaat") !== -1) {
        trackEvent("nav_click", { destination: "zakaat_calculator" });
      } else if (href.indexOf("familyHistory") !== -1) {
        trackEvent("nav_click", { destination: "family_history" });
      } else if (href.indexOf("privacy") !== -1) {
        trackEvent("nav_click", { destination: "privacy" });
      } else if (href.indexOf("index.html") !== -1 || href === "/") {
        trackEvent("nav_click", { destination: "home" });
      } else if (href.charAt(0) === "#") {
        trackEvent("section_nav", { section_id: href.slice(1) });
        if (href === "#family-name") {
          trackEvent("family_name_nav", { destination: "family_name" });
        }
      }
    });

    if ("IntersectionObserver" in global) {
      var seenSections = {};
      var seenFamilyName = false;
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var el = entry.target;
            var id = el.id;
            if (!id || seenSections[id]) return;
            seenSections[id] = true;
            trackEvent("section_view", {
              section_id: id,
              section_name: el.getAttribute("data-analytics-name") || id,
            });
            if (id === "family-name" && !seenFamilyName) {
              seenFamilyName = true;
              trackEvent("family_name_view", { section_id: id, section_name: "Family Name" });
            }
            observer.unobserve(el);
          });
        },
        { threshold: 0.35, rootMargin: "0px 0px -10% 0px" }
      );
      document.querySelectorAll("section[id], [data-analytics-section]").forEach(function (el) {
        if (el.id) observer.observe(el);
      });
    }
  }

  function initEngagement() {
    initMainSiteEngagement();
  }

  global.SiteAnalytics = {
    enabled: enabled,
    trackPageView: trackPageView,
    trackEvent: trackEvent,
    contentGroup: contentGroup,
    normalizePath: normalizePath,
    anonymizedTitle: anonymizedTitle,
  };

  // Configure GA as soon as this script loads (do not wait for DOMContentLoaded).
  initConfig();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initEngagement);
  } else {
    initEngagement();
  }
})(window);
