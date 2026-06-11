document.addEventListener("DOMContentLoaded", function () {
  document.body.classList.add("page-enter");

  var topbar = document.querySelector(".topbar");
  if (topbar) {
    var onScroll = function () {
      topbar.classList.toggle("scrolled", window.scrollY > 24);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  var path = window.location.pathname;
  var current = path.split("/").pop() || "index.html";
  document.querySelectorAll(".topnav a, .footer-links a").forEach(function (link) {
    var href = link.getAttribute("href");
    var isActive =
      href === current ||
      (current === "" && href === "index.html") ||
      (href === "zakaat/" && path.indexOf("/zakaat") !== -1);
    if (isActive) {
      link.classList.add("active");
    }
  });

  var navToggle = document.querySelector(".nav-toggle");
  var siteNav = document.getElementById("site-nav");
  if (navToggle && siteNav) {
    navToggle.addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    siteNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        document.body.classList.remove("nav-open");
        navToggle.setAttribute("aria-expanded", "false");
        navToggle.setAttribute("aria-label", "Open menu");
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        document.body.classList.remove("nav-open");
        navToggle.setAttribute("aria-expanded", "false");
        navToggle.setAttribute("aria-label", "Open menu");
      }
    });
  }

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    document.querySelectorAll(".reveal").forEach(function (el) {
      observer.observe(el);
    });
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) {
      el.classList.add("visible");
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener("click", function (e) {
      var target = document.querySelector(anchor.getAttribute("href"));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
});
