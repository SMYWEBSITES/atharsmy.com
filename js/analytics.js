/*
 * Shared GA4 helpers for atharsmy.com (Profile Site + Zakat Calculator).
 * Requires gtag bootstrap in each HTML page (async gtag.js + dataLayer).
 */
(function (global) {
  "use strict";

  var ID = global.GA_ID || "G-3DFSY795RJ";

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

  function trackPageView(opts) {
    if (!enabled()) return;
    opts = opts || {};
    var pagePath = opts.path || normalizePath();
    var title = opts.title || document.title;
    global.gtag("event", "page_view", {
      page_title: title,
      page_location: location.origin + pagePath,
      page_path: pagePath,
      site_section: opts.section || contentGroup(),
    });
  }

  function trackEvent(name, params) {
    if (!enabled()) return;
    params = params || {};
    if (!params.site_section) params.site_section = contentGroup();
    global.gtag("event", name, params);
  }

  function initConfig() {
    if (!enabled()) return;
    var zakat = isZakatApp();
    global.gtag("config", ID, {
      send_page_view: !zakat,
      page_path: normalizePath(),
      page_title: document.title,
      content_group: contentGroup(),
    });
  }

  function initMainSiteEngagement() {
    if (isZakatApp()) return;

    document.addEventListener("click", function (e) {
      var link = e.target.closest("a[href]");
      if (!link) return;
      var href = link.getAttribute("href") || "";
      var text = (link.textContent || "").trim().slice(0, 80);

      if (href.indexOf("mailto:") === 0) {
        trackEvent("contact_click", { method: "email" });
        return;
      }
      if (href.indexOf("http") === 0 && href.indexOf(location.hostname) === -1) {
        trackEvent("click", {
          link_url: href,
          link_text: text,
          outbound: true,
        });
        return;
      }
      if (href.indexOf("zakaat") !== -1) {
        trackEvent("nav_click", { destination: "zakaat_calculator", link_text: text });
      } else if (href.indexOf("familyHistory") !== -1) {
        trackEvent("nav_click", { destination: "family_history", link_text: text });
      } else if (href.indexOf("privacy") !== -1) {
        trackEvent("nav_click", { destination: "privacy", link_text: text });
      } else if (href.indexOf("index.html") !== -1 || href === "/") {
        trackEvent("nav_click", { destination: "home", link_text: text });
      } else if (href.charAt(0) === "#") {
        trackEvent("section_nav", { section_id: href.slice(1), link_text: text });
      }
    });

    if ("IntersectionObserver" in global) {
      var seen = {};
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var el = entry.target;
            var id = el.id;
            if (!id || seen[id]) return;
            seen[id] = true;
            trackEvent("section_view", {
              section_id: id,
              section_name: el.getAttribute("data-analytics-name") || id,
            });
            observer.unobserve(el);
          });
        },
        { threshold: 0.35, rootMargin: "0px 0px -10% 0px" }
      );
      document.querySelectorAll("section[id], [data-analytics-section]").forEach(function (el) {
        observer.observe(el);
      });
    }
  }

  function init() {
    initConfig();
    initMainSiteEngagement();
  }

  global.SiteAnalytics = {
    enabled: enabled,
    trackPageView: trackPageView,
    trackEvent: trackEvent,
    contentGroup: contentGroup,
    normalizePath: normalizePath,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
