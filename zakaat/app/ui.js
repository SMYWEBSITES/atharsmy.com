/*
 * UI controller for the offline Zakat Calculator. Vanilla DOM, no framework.
 */
(function (global) {
  "use strict";

  const ZK = global.ZK;
  const Store = global.ZKStore;
  const Excel = global.ZKExcel;
  const Rates = global.ZKRates;
  const History = global.ZKHistory;
  const Drive = global.ZKDrive;
  const Help = global.ZKHelp;
  let baseline = null;
  let yearlySelected = null; // selected calendar year on the Yearly Review tab


  // --- DOM helpers ---
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      }
      // Direction is applied only by bind() for explicitly translated nodes.
      // Auto-applying RTL here would right-align English-language elements
      // (headings, labels) whenever Urdu/Arabic is selected.
    }
    if (children) (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function toast(msg, kind) {
    const root = document.getElementById("toast-root");
    const t = el("div", { class: "toast " + (kind || "") , text: msg });
    root.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 250); }, 3200);
  }

  // Keep --app-vvh equal to the *visible* viewport height while a modal is
  // open, so the sheet (and its Save footer) shrinks above the on-screen
  // keyboard instead of being covered by it. Android resizes the layout
  // viewport via the interactive-widget meta; iOS Safari only updates
  // window.visualViewport, which is what we mirror here.
  let vvCleanup = null;
  function watchViewportForModal() {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      document.documentElement.style.setProperty("--app-vvh", vv.height + "px");
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    vvCleanup = () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty("--app-vvh");
      vvCleanup = null;
    };
  }

  function openModal(title, bodyNode, footButtons, opts) {
    opts = opts || {};
    const root = document.getElementById("modal-root");
    clear(root);
    const headChildren = [el("h3", { text: title })];
    if (opts.dismissible !== false) {
      headChildren.push(el("button", { class: "modal-close", text: "\u00d7", onclick: closeModal }));
    }
    const head = el("div", { class: "modal-head" }, headChildren);
    const body = el("div", { class: "modal-body" }, bodyNode);
    // After the keyboard animates in, bring the focused field into the
    // scrollable body so it isn't hidden under the head/foot or keyboard.
    body.addEventListener("focusin", (e) => {
      const t = e.target;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) {
        setTimeout(() => {
          try { t.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (err) { /* older browsers */ }
        }, 300);
      }
    });
    const foot = el("div", { class: "modal-foot" }, footButtons || []);
    const modal = el("div", { class: "modal" + (opts.wide ? " modal-wide" : "") }, [head, body, foot]);
    const overlay = el("div", { class: "modal-overlay" });
    if (opts.dismissible !== false) {
      overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    }
    overlay.appendChild(modal);
    root.appendChild(overlay);
    if (!vvCleanup) watchViewportForModal();
  }
  function closeModal() {
    clear(document.getElementById("modal-root"));
    if (vvCleanup) vvCleanup();
  }

  function hasHouseholdData() {
    return Store.members().length > 0;
  }

  function curCode() { return Store.getCurrency() || "INR"; }

  function drivePopupHelpPanel(open) {
    const details = el("details", { class: "setup-details popup-help" });
    if (open) details.open = true;
    details.appendChild(el("summary", { text: "Pop-up blocked? Enable Google Drive sign-in" }));
    details.appendChild(el("div", {
      class: "setup-body",
      html: Drive ? Drive.popupBlockedHelpHtml() : "Allow pop-ups for this site and try again.",
    }));
    return details;
  }

  function revealDrivePopupHelp(host, open) {
    if (!host) return;
    let panel = host.querySelector(".popup-help");
    if (!panel) {
      panel = drivePopupHelpPanel(!!open);
      host.appendChild(panel);
    } else if (open) {
      panel.open = true;
    }
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // Get/set the button's primary label, falling back to full textContent for
  // simple (non-backup-action-btn) buttons.
  function _btnGetLabel(btn) {
    const t = btn.querySelector(".backup-btn-title");
    return t ? t.textContent : btn.textContent;
  }
  function _btnSetLabel(btn, label) {
    const t = btn.querySelector(".backup-btn-title");
    if (t) t.textContent = label;
    else btn.textContent = label;
  }

  function resetDriveConnectButtons() {
    document.querySelectorAll("[data-drive-connect]").forEach((btn) => {
      btn.disabled = false;
      if (Drive && Drive.isConnected()) {
        if (btn.dataset.connectLabel === "Connect Google Drive") {
          _btnSetLabel(btn, "Reconnect Google Drive");
        }
        return;
      }
      if (btn.dataset.connectLabel) _btnSetLabel(btn, btn.dataset.connectLabel);
    });
  }

  function markDriveConnectButton(btn, busyLabel) {
    if (!btn.dataset.connectLabel) btn.dataset.connectLabel = _btnGetLabel(btn);
    btn.dataset.driveConnect = "1";
    btn.disabled = true;
    _btnSetLabel(btn, busyLabel);
  }

  function connectDriveInteractive(opts) {
    opts = opts || {};
    if (!Drive) return Promise.reject(new Error("Drive module not loaded."));
    if (opts.button) markDriveConnectButton(opts.button, opts.busyLabel || "Connecting\u2026");
    return Drive.connect({ interactive: true })
      .then((res) => {
        return typeof opts.onSuccess === "function" ? opts.onSuccess(res) : res;
      })
      .catch((e) => {
        if (Drive.isPopupBlockedError(e)) {
          revealDrivePopupHelp(opts.helpHost, true);
          toast("Sign-in did not finish — see steps below (close any blank tab first)", "warn");
        }
        throw e;
      })
      .finally(() => resetDriveConnectButtons());
  }

  function setupDriveConnectResume() {
    if (!Drive) return;
    Drive.onConnectChange((connected) => {
      resetDriveConnectButtons();
      if (connected) {
        document.dispatchEvent(new CustomEvent("zk-drive-connected"));
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      Drive.resumeAfterOAuthTab().then((ok) => {
        if (ok) resetDriveConnectButtons();
      });
    });
    window.addEventListener("focus", () => {
      Drive.resumeAfterOAuthTab().then((ok) => {
        if (ok) resetDriveConnectButtons();
      });
    });
  }

  function importBackupFile(file, done) {
    if (!file) { toast("Choose a backup file first", "err"); return; }
    Excel.importBackupFromFile(file)
      .then((counts) => {
        closeModal();
        if (typeof done === "function") done();
        refreshAll();
        toast(
          "Opened " + counts.members + " member(s), " + counts.assets + " asset(s) from " + file.name,
          "ok"
        );
      })
      .catch((err) => toast("Could not open backup: " + err.message, "err"));
  }

  function replaceFromExcelFile() {
    const input = el("input", { type: "file", accept: ".xlsx", style: "display:none" });
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      confirmDialog(
        "Replace all data",
        "This replaces everything in this browser with " + file.name + ". Continue?",
        () => importBackupFile(file),
        "Replace & open",
        true
      );
    });
    document.body.appendChild(input);
    input.click();
    input.remove();
  }

  function replaceFromDriveBackup() {
    if (!Drive) { toast("Drive module not loaded", "err"); return; }
    const driveSelect = el("select");
    driveSelect.appendChild(el("option", { value: "", text: "Loading backups\u2026" }));
    const status = el("div", { class: "notice compact warn", text: "" });
    const signInBtn = el("button", { class: "btn block", text: "Sign in with Google" });

    function loadList() {
      return Drive.listBackups()
        .then((files) => {
          driveSelect.innerHTML = "";
          if (!files.length) {
            driveSelect.appendChild(el("option", { value: "", text: "No backups on Drive" }));
            status.textContent = "No files in " + Drive.folderPathLabel();
            return;
          }
          files.forEach((f) => {
            const isJson = /\.json$/i.test(f.name);
            const label = (isJson ? "\ud83d\udccb JSON snapshot: " : "\ud83d\udcca Excel: ") +
              f.name + (f.modifiedTime ? " \u2014 " + new Date(f.modifiedTime).toLocaleString() : "");
            driveSelect.appendChild(el("option", { value: f.name, text: label }));
          });
          status.className = "notice compact ok";
          status.textContent = "Choose a backup to replace your current data. JSON snapshots restore faster; Excel backups are the full archive.";
        })
        .catch((e) => {
          status.className = "notice compact err";
          status.textContent = e.message || "Could not list backups.";
        });
    }

    const replaceHelpHost = el("div", { class: "drive-help-host" });
    replaceHelpHost.appendChild(drivePopupHelpPanel(false));

    signInBtn.addEventListener("click", () => {
      connectDriveInteractive({
        button: signInBtn,
        busyLabel: "Signing in\u2026",
        helpHost: replaceHelpHost,
        onSuccess: () => { signInBtn.style.display = "none"; return loadList(); },
      })
        .catch((e) => { if (!Drive.isPopupBlockedError(e)) toast(e.message || String(e), "err"); });
    });

    const replaceBtn = el("button", {
      class: "btn danger",
      text: "Replace from Drive",
      onclick: () => {
        const fileName = driveSelect.value;
        if (!fileName) { toast("Choose a backup file", "err"); return; }
        const isJson = /\.json$/i.test(fileName);
        confirmDialog(
          "Replace all data",
          "This replaces everything in this browser with " + fileName + " from Google Drive. Continue?",
          () => {
            const restoreOp = isJson
              ? Drive.restoreFromStateJson(fileName).then((res) => {
                  closeModal(); refreshAll();
                  toast("Restored from JSON snapshot: " + res.fileName, "ok");
                })
              : Drive.restore(fileName).then((res) => {
                  closeModal(); refreshAll();
                  toast("Replaced with " + res.counts.members + " member(s) from " + res.fileName, "ok");
                });
            restoreOp.catch((e) => toast(e.message || String(e), "err"));
          },
          "Replace & open",
          true
        );
      },
    });
    const cancelBtn = el("button", { class: "btn secondary", text: "Cancel", onclick: closeModal });

    const body = el("div", null, [
      status,
      signInBtn,
      field("Backup file", driveSelect, Drive.folderPathLabel()),
      replaceHelpHost,
    ]);
    openModal("Replace from Google Drive", body, [cancelBtn, replaceBtn]);

    if (Drive.isConnected()) {
      signInBtn.style.display = "none";
      loadList();
    }
  }

  function confirmDialog(title, message, onConfirm, confirmLabel, danger) {
    const body = el("p", { text: message, class: "muted" });
    const yes = el("button", { class: "btn " + (danger ? "danger" : ""), text: confirmLabel || "Confirm", onclick: () => { closeModal(); onConfirm(); } });
    const no = el("button", { class: "btn secondary", text: "Cancel", onclick: closeModal });
    openModal(title, body, [no, yes]);
  }

  // --- Analytics (GA4) ---
  const TAB_PAGE_TITLES = {
    dashboard: "Dashboard",
    analytics: "Analytics",
    yearly: "Yearly Review",
    rates: "Market Rates",
    backup: "Backup",
    guide: "About",
  };

  function saveFamilyName(raw) {
    const next = Store.setFamilyName(raw);
    renderFamilyNameMeta();
    return next;
  }

  function renderFamilyNameMeta() {
    const node = document.getElementById("family-name-meta");
    if (!node) return;
    const name = Store.getFamilyName();
    node.textContent = name ? name + " family" : "";
  }

  // --- Getting Started card (always visible; checks update as the user progresses) ---
  function renderGettingStartedCard(panel) {
    const members = Store.members();
    const hasFamily  = !!Store.getFamilyName();
    const hasMembers = members.length > 0;
    const hasAssets  = members.some((m) => (m.assets || []).length > 0);

    const steps = [
      {
        label: Help.t("gs_step1"),
        done: hasFamily,
        click: () => {
          const inp = document.getElementById("family-name-input");
          if (inp) { inp.scrollIntoView({ block: "center", behavior: "smooth" }); setTimeout(() => inp.focus(), 350); }
        },
      },
      {
        label: Help.t("gs_step2"),
        note: Help.t("gs_step2_note"),
        done: true, // always reachable
      },
      {
        label: Help.t("gs_step3"),
        done: hasMembers,
        click: hasFamily ? () => memberForm() : null,
      },
      {
        label: Help.t("gs_step4"),
        done: hasAssets,
        click: hasMembers ? () => {
          // Open the checklist for the first member that has no assets yet,
          // or for the first member if everyone already has some.
          const target = members.find((m) => !(m.assets || []).length) || members[0];
          showAssetChecklist(target.id);
        } : null,
      },
      {
        label: Help.t("gs_step5"),
        note: Help.t("gs_step5_note"),
        done: hasAssets,
      },
    ];

    const stepEls = steps.map((s, i) => {
      const icon = el("span", { class: "gs-icon " + (s.done ? "gs-done" : "gs-todo"), text: s.done ? "✓" : String(i + 1) });
      const textWrap = el("div", { class: "gs-text" }, [el("span", { text: s.label })]);
      if (s.note) textWrap.appendChild(el("span", { class: "gs-note", text: s.note }));
      const row = el("div", { class: "gs-step" + (s.done ? " gs-step-done" : "") }, [icon, textWrap]);
      if (s.click && !s.done) {
        row.setAttribute("data-clickable", "1");
        row.addEventListener("click", s.click);
      }
      return row;
    });

    const card = el("div", { class: "panel getting-started" });
    card.appendChild(el("h2", { text: Help.t("gs_title") }));
    card.appendChild(el("p", { class: "sub", text: Help.t("gs_sub") }));
    card.appendChild(el("div", { class: "gs-steps" }, stepEls));
    panel.appendChild(card);
  }

  // --- Nisab gauge --- shows zakatable wealth vs threshold as a progress bar ---
  function renderNisabGauge(container, household) {
    if (!household.members.length) return;
    const totalZakatable = household.members.reduce((s, m) => s + m.nisab_wealth_inr, 0);
    const threshold      = household.members[0].nisab_threshold_inr;
    const basis          = household.members[0].nisab_basis;
    if (threshold <= 0) return;

    const pct     = Math.min(100, (totalZakatable / threshold) * 100);
    const eligible = pct >= 100;

    const gauge = el("div", { class: "nisab-gauge" });
    gauge.appendChild(el("div", { class: "nisab-gauge-header" }, [
      el("span", { class: "nisab-gauge-title", text: "Zakatable wealth vs nisab (" + basis + " basis)" }),
      el("span", { class: "nisab-gauge-vals", text: ZK.fmtINR(totalZakatable) + " of " + ZK.fmtINR(threshold) }),
    ]));
    gauge.appendChild(el("div", { class: "nisab-track" },
      el("div", { class: "nisab-fill " + (eligible ? "nisab-fill-over" : "nisab-fill-under"), style: "width:" + pct.toFixed(1) + "%" })
    ));
    gauge.appendChild(el("div", {
      class: "nisab-gauge-note " + (eligible ? "nisab-note-over" : "nisab-note-under"),
      text: eligible
        ? "✓ Above nisab — Zakat is due at 2.5% on your zakatable wealth"
        : "Below nisab — no Zakat due yet (" + Math.ceil(100 - pct) + "% of threshold to go)",
    }));
    container.appendChild(gauge);
  }

  // --- Asset category icons ---
  const CATEGORY_ICONS = {
    Cash:        "💰",
    Gold:        "🥇",
    Silver:      "🥈",
    Platinum:    "🔘",
    Diamond:     "💎",
    Stocks:      "📈",
    PF:          "🏦",
    Business:    "💼",
    Partnership: "🤝",
    Property:    "🏠",
    Agriculture: "🌾",
    Livestock:   "🐄",
    Rikaz:       "⚱️",
    Liabilities: "💳",
  };

  // --- Asset discovery checklist ---
  const ASSET_CHECKLIST = [
    { label: "Bank savings, fixed deposits, or cash at home",   hint: "All savings accounts, current accounts, FDs, digital wallets, cash in hand.", category: "Cash" },
    { label: "Gold — jewelry, coins, or bars",                  hint: "Any gold you own. Personal jewelry may be exempt in Shafiʿi / Maliki / Hanbali.", category: "Gold" },
    { label: "Silver — jewelry, coins, or utensils",            hint: "Silver cutlery, coins, jewelry.", category: "Silver" },
    { label: "Platinum — jewelry or bars",                      hint: "Platinum jewelry, bullion, or coins at current market value.", category: "Platinum" },
    { label: "Diamond or gemstones",                            hint: "Diamonds and precious stones held as wealth or jewelry.", category: "Diamond" },
    { label: "Stocks, mutual funds, or shares",                 hint: "Any equity investments. Enter today’s total portfolio value.", category: "Stocks" },
    { label: "Provident fund / EPF / PPF",                      hint: "Enter the balance from your last PF statement — the app projects it to today.", category: "PF" },
    { label: "Business goods or inventory",                     hint: "Stock you keep for sale, and business cash. Not the shop building or machines.", category: "Business" },
    { label: "Your share in a joint business or partnership",   hint: "The current value of your stake.", category: "Partnership" },
    { label: "Property you are planning to sell",               hint: "Only ‘for sale’ property counts. Your home and rental buildings are exempt.", category: "Property", subtype: "trade" },
    { label: "Crops or agricultural harvest",                   hint: "Value of your harvest. Rain-fed crops: 10% Zakat; irrigated: 5%. No nisab or hawl required.", category: "Agriculture" },
    { label: "Livestock — sheep, cattle, or camels",            hint: "Zakatable animal herds based on Sunnah tiers. No hawl on the full herd value.", category: "Livestock" },
    { label: "Rikaz — buried treasure or found wealth",         hint: "Wealth your scholar rules as rikaz (e.g. buried find). Zakat is 20% once, not 2.5% yearly. No nisab required.", category: "Rikaz" },
    { label: "Loans or debts you owe to others",                hint: "Reduces your zakatable wealth (degree depends on your school).", category: "Liabilities" },
  ];

  function showAssetChecklist(memberId) {
    const rows = ASSET_CHECKLIST.map((item) => {
      const icon = CATEGORY_ICONS[item.category] || "";
      const row = el("div", { class: "checklist-row" }, [
        el("div", { class: "checklist-icon", text: icon }),
        el("div", { class: "checklist-info" }, [
          el("div", { class: "checklist-label", text: item.label }),
          el("div", { class: "checklist-hint", text: item.hint }),
        ]),
        el("button", {
          class: "btn sm",
          text: "Add this",
          onclick: () => {
            closeModal();
            assetForm(memberId, null, item.category, item.subtype);
          },
        }),
      ]);
      return row;
    });
    openModal("What do I own?", el("div", { class: "checklist-body" }, rows), [
      el("button", { class: "btn secondary", text: "Close", onclick: closeModal }),
    ], { wide: true });
  }

  function renderFamilyNamePanel(panel) {
    const nameInput = el("input", {
      type: "text",
      id: "family-name-input",
      value: Store.getFamilyName(),
      placeholder: Help.t("ph_family_name"),
      maxlength: "64",
      autocomplete: "family-name",
    });
    Help.bindPh(nameInput, "ph_family_name");
    const householdPanel = el("div", { class: "panel household-panel" });
    householdPanel.appendChild(el("h2", { text: Help.t("household_title") }));
    householdPanel.appendChild(el("p", {
      class: "sub",
      text: Help.t("household_desc"),
    }));
    householdPanel.appendChild(field(Help.t("family_name_field_label"), nameInput, Help.t("family_name_help")));
    householdPanel.appendChild(el("div", { class: "btn-row" }, [
      el("button", {
        class: "btn",
        text: Help.t("save_family_name_btn"),
        onclick: () => {
          const saved = saveFamilyName(nameInput.value, "dashboard");
          toast(saved ? Help.t("toast_family_saved") : Help.t("toast_family_enter"), saved ? "ok" : "err");
        },
      }),
    ]));
    panel.appendChild(householdPanel);
  }

  // Currency, school (madhhab) and form-help language, surfaced on the
  // Dashboard so they don't require a trip to the Rates tab or welcome screen.
  function renderPreferencesPanel(panel) {
    const prefCur = currencySelectNode();
    const prefMadhab = madhabSelectNode();
    const prefLangWrap = el("span", { class: "pref-lang-wrap" });

    function renderPrefLang() {
      clear(prefLangWrap);
      const sel = helpLangSelectNode();
      if (sel) prefLangWrap.appendChild(sel);
    }
    renderPrefLang();

    prefCur.addEventListener("change", () => { applyCurrencyChange(prefCur.value); renderPrefLang(); });
    prefMadhab.addEventListener("change", () => { Store.setMadhab(prefMadhab.value); toast(Help.t("toast_school_updated"), "ok"); refreshAll(); });

    const prefsPanel = el("div", { class: "panel welcome-prefs" }, [
      el("div", { class: "welcome-prefs-title", text: Help.t("prefs_title") }),
      el("div", { class: "field-row3" }, [
        field(Help.t("currency_label"), prefCur),
        el("div", { class: "field" }, [el("label", { text: Help.t("lang_field_label") }), prefLangWrap]),
        field(Help.t("school_field_label"), prefMadhab),
      ]),
    ]);
    panel.appendChild(prefsPanel);
  }

  function trackTabView(tab) {
    const section = TAB_PAGE_TITLES[tab] || tab;
    const title = "Zakat Calculator — " + section;
    const path = "/zakaat/" + tab;
    document.title = title + " | S M Y ATHAR";
    if (global.SiteAnalytics) {
      global.SiteAnalytics.trackPageView({ title: title, path: path, section: "Zakat Calculator" });
    }
  }

  // --- Tabs ---
  function setupTabs() {
    document.getElementById("tabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab-btn");
      if (!btn) return;
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
      document.getElementById("tab-" + tab).classList.remove("hidden");
      renderTab(tab);
      trackTabView(tab);
    });
  }

  function renderTab(tab) {
    if (tab === "dashboard") renderDashboard();
    else if (tab === "analytics") renderAnalytics();
    else if (tab === "yearly") renderYearly();
    else if (tab === "rates") renderRates();
    else if (tab === "backup") renderBackup();
    else if (tab === "guide") renderGuide();
  }

  function refreshAll() {
    baseline = ZK.zakatAsOf();
    renderBaselineMeta();
    renderFamilyNameMeta();
    const active = document.querySelector(".tab-btn.active");
    renderTab(active ? active.dataset.tab : "dashboard");
  }

  function renderBaselineMeta() {
    const meta = document.getElementById("baseline-meta");
    const today = ZK.todayUTC();
    const todayLabel = (Help && Help.t("today_label")) || "Today";
    const baselineLabel = (Help && Help.t("baseline_label")) || "Zakat baseline";
    let html = "<div>" + todayLabel + ": <strong>" + ZK.fmtDate(today) + "</strong></div>";
    try {
      html += "<div>" + baselineLabel + ": <strong>" + ZK.fmtDate(baseline) + "</strong></div>";
      html += "<div>" + ZK.formatHijriDate(baseline) + "</div>";
    } catch (e) { /* Intl islamic calendar unavailable */ }
    meta.innerHTML = html;
  }

  // --- Dashboard ---
  function renderDashboard() {
    const panel = document.getElementById("tab-dashboard");
    clear(panel);

    const hero = el("div", { class: "hero" }, [
      el("img", { class: "hero-img", src: "assets/kaaba-hero.jpg", alt: "The Kaaba, Masjid al-Haram", loading: "lazy" }),
      el("div", { class: "hero-overlay" }, [
        el("div", { class: "hero-title", text: Help.t("app_title") }),
        el("div", { class: "hero-sub", text: Help.t("hero_sub") }),
      ]),
    ]);
    panel.appendChild(hero);
    renderGettingStartedCard(panel);
    renderFamilyNamePanel(panel);
    renderPreferencesPanel(panel);

    const rates = Store.getRates();
    const madhab = Store.getMadhab();
    const members = Store.members();
    const household = ZK.computeHousehold(members, rates, madhab, baseline);

    const rules = ZK.MADHAB_RULES[madhab];

    const summaryPanel = el("div", { class: "panel" });
    summaryPanel.appendChild(el("h2", { text: Help.t("summary_title") }));
    summaryPanel.appendChild(el("p", { class: "sub", text: Help.t("summary_sub_a") + " " + rules.label + " " + Help.t("summary_sub_b") }));

    const totalWealth     = household.members.reduce((s, m) => s + m.total_wealth_inr, 0);
    const totalZakatable  = household.members.reduce((s, m) => s + m.nisab_wealth_inr, 0);
    const cards = el("div", { class: "cards" }, [
      card(Help.t("card_total_wealth"), ZK.fmtINR(totalWealth)),
      card(Help.t("card_zakat_amount"), ZK.fmtINR(household.total_zakat_inr), "accent"),
      card(Help.t("card_paid"), ZK.fmtINR(household.total_paid_inr)),
      card(Help.t("card_remaining"), ZK.fmtINR(Math.max(0, household.total_remaining_inr)), household.total_remaining_inr > 0.005 ? "warn" : ""),
    ]);
    summaryPanel.appendChild(cards);
    renderNisabGauge(summaryPanel, household);
    panel.appendChild(summaryPanel);

    // Track dashboard view with financial summary — debounced and deduplicated
    // so rapid refreshAll() calls (every asset/member save) don't multiply the
    // Baseline projections and the per-member table live on Analytics;
    // the dashboard stays focused on totals + family & asset management.
    buildFamily(panel);
  }

  // Household wealth split by component as horizontal bars (moved here from
  // the dashboard; the dashboard stays focused on totals + family management).
  function renderComponentBarsPanel(summaries) {
    const wealth = {};
    ZK.CHART_KEY_ORDER.forEach((k) => { wealth[k] = 0; });
    summaries.forEach((s) => {
      const wv = ZK.componentWealthValues(s);
      ZK.CHART_KEY_ORDER.forEach((k) => { wealth[k] += wv[k] || 0; });
    });
    const maxVal = Math.max(1, ...ZK.CHART_KEY_ORDER.map((k) => wealth[k]));
    const barRows = ZK.CHART_KEY_ORDER.filter((k) => wealth[k] > 0.005).map((k) => el("div", { class: "bar-row" }, [
      el("div", { text: ZK.COMPONENT_LABELS[k] || k }),
      el("div", { class: "bar-track" }, el("div", { class: "bar-fill", style: "width:" + (wealth[k] / maxVal * 100).toFixed(1) + "%" })),
      el("div", { class: "bar-val num", text: ZK.fmtINR(wealth[k]) }),
    ]));
    if (!barRows.length) return null;
    const bp = el("div", { class: "panel" });
    bp.appendChild(el("h2", { text: "Wealth by component" }));
    bp.appendChild(el("div", { class: "bars" }, barRows));
    return bp;
  }

  // --- Analytics ---
  function renderAnalytics() {
    const panel = document.getElementById("tab-analytics");
    clear(panel);
    const rates = Store.getRates();
    const madhab = Store.getMadhab();
    const members = Store.members();
    const summaries = members.map((m) => ZK.computeMemberZakat(m, m.assets || [], m.zakat_payments || [], rates, madhab, baseline));

    // Totals
    const totalWealthNet = summaries.reduce((s, m) => s + m.net_wealth_inr, 0);
    const totalWealthGross = summaries.reduce((s, m) => s + m.total_wealth_inr, 0);
    const totalLiab = summaries.reduce((s, m) => s + m.liabilities_wealth_inr, 0);
    const totalZakatable = summaries.reduce((s, m) => s + m.nisab_wealth_inr, 0);
    const totalZakat = summaries.reduce((s, m) => s + m.zakat_due_inr, 0);

    const head = el("div", { class: "panel" });
    head.appendChild(el("h2", { text: "Wealth analytics" }));
    head.appendChild(el("p", { class: "sub", text: "Current household wealth by component (" + ZK.MADHAB_RULES[madhab].label + ")." }));
    head.appendChild(el("div", { class: "cards" }, [
      card("Total wealth (net of loans)", ZK.fmtINR(totalWealthNet), "accent"),
      card("Gross wealth", ZK.fmtINR(totalWealthGross)),
      card("Liabilities", ZK.fmtINR(totalLiab)),
      card("Zakatable wealth", ZK.fmtINR(totalZakatable)),
      card("Zakat amount", ZK.fmtINR(totalZakat), "warn"),
    ]));
    panel.appendChild(head);

    if (!members.length) {
      panel.appendChild(el("div", { class: "panel" }, el("div", { class: "empty", html: "No data yet. Add members and assets on the <strong>Dashboard</strong>." })));
      return;
    }

    // Projected Zakat across previous / current / next baselines
    panel.appendChild(renderProjectionPanel(members, madhab));

    // Multi-year wealth & Zakat trend (older-app analytics logic, fully in-browser)
    panel.appendChild(renderTrendPanel(members, madhab));

    // Rates over time graph
    panel.appendChild(renderRatesGraphPanel());

    // Household wealth split by component (bars)
    const barsPanel = renderComponentBarsPanel(summaries);
    if (barsPanel) panel.appendChild(barsPanel);

    // Active component columns (those with any value across the household)
    const totals = {}; ZK.CHART_KEY_ORDER.forEach((k) => { totals[k] = 0; });
    summaries.forEach((s) => {
      const wv = ZK.componentWealthValues(s, true);
      ZK.CHART_KEY_ORDER.forEach((k) => { totals[k] += wv[k] || 0; });
    });
    const cols = ZK.CHART_KEY_ORDER.filter((k) => totals[k] > 0.01);

    // Wealth table: components as ROWS (fewer columns → no horizontal scroll),
    // members as columns, plus a household total with an inline share bar.
    const tablePanel = el("div", { class: "panel" });
    tablePanel.appendChild(el("h2", { text: "Wealth by component — per member" }));
    const memberWv = summaries.map((s) => ({ name: s.member_name, wv: ZK.componentWealthValues(s, true) }));
    const householdMax = Math.max(1, ...cols.map((k) => totals[k]));
    const headRow = el("tr", null, [th("Component")]
      .concat(memberWv.map((m) => th(m.name, true)))
      .concat([th("Household", true), th("Share")]));
    const bodyRows = cols.map((k) => {
      const pct = (totals[k] / householdMax) * 100;
      return el("tr", null, [el("td", { text: ZK.WEALTH_COMPONENT_LABELS[k] || k })]
        .concat(memberWv.map((m) => el("td", { class: "num", text: m.wv[k] > 0.005 ? ZK.fmtINR(m.wv[k]) : "\u2014" })))
        .concat([
          el("td", { class: "num" }, el("strong", { text: ZK.fmtINR(totals[k]) })),
          el("td", { class: "share-cell" }, el("div", { class: "share-track" }, el("div", { class: "share-fill", style: "width:" + pct.toFixed(1) + "%" }))),
        ]));
    });
    const totalRow = el("tr", { class: "total-row" }, [el("td", null, el("strong", { text: "Total (net)" }))]
      .concat(memberWv.map((m) => el("td", { class: "num" }, el("strong", { text: ZK.fmtINR(m.wv.total) }))))
      .concat([el("td", { class: "num" }, el("strong", { text: ZK.fmtINR(totalWealthNet) })), el("td")]));
    bodyRows.push(totalRow);
    const shareColIdx = 1 + memberWv.length + 1; // Component + members + Household, then Share
    tablePanel.appendChild(el("div", { class: "table-wrap" }, sortable(el("table", null, [el("thead", null, headRow), el("tbody", null, bodyRows)]), { skip: [shareColIdx] })));
    panel.appendChild(tablePanel);

    // Per-member zakat eligibility summary
    const zp = el("div", { class: "panel" });
    zp.appendChild(el("h2", { text: "By family member" }));
    const zRows = summaries.map((s) => el("tr", null, [
      el("td", { text: s.member_name }),
      el("td", null, el("span", { class: "pill " + (s.is_eligible ? "green" : "gray"), text: s.is_eligible ? "Eligible" : "Below nisab" })),
      el("td", { class: "num", text: ZK.fmtINR(s.total_wealth_inr) }),
      el("td", { class: "num", text: ZK.fmtINR(s.nisab_threshold_inr) }),
      el("td", { class: "num", text: ZK.fmtINR(s.zakat_due_inr) }),
      el("td", { class: "num", text: ZK.fmtINR(s.total_paid_inr) }),
      el("td", { class: "num", text: ZK.fmtINR(Math.max(0, s.remaining_inr)) }),
    ]));
    zp.appendChild(el("div", { class: "table-wrap" }, sortable(el("table", null, [
      el("thead", null, el("tr", null, [th("Member"), th("Status"), th("Wealth", true), th("Nisab", true), th("Zakat amount", true), th("Paid", true), th("Remaining", true)])),
      el("tbody", null, zRows),
    ]))));
    panel.appendChild(zp);

    // Recorded balance changes (year-over-year snapshot diffs)
    const changePanel = renderBalanceChangesPanel(members);
    if (changePanel) panel.appendChild(changePanel);

    // Per-member analytics (trend + breakdown), one collapsible per member
    if (members.length > 1) {
      const mp = el("div", { class: "panel" });
      mp.appendChild(el("h2", { text: "Per-member analytics" }));
      members.forEach((m) => {
        const s = ZK.computeMemberZakat(m, m.assets || [], m.zakat_payments || [], rates, madhab, baseline);
        const sectionBody = [];
        sectionBody.push(memberBreakdownNode(s));
        sectionBody.push(renderTrendPanel([m], madhab, { bare: true }));
        mp.appendChild(collapsible(m.name + " \u2014 Wealth " + ZK.fmtINR(s.total_wealth_inr) + " \u00b7 Zakat " + ZK.fmtINR(s.zakat_due_inr), sectionBody, false));
      });
      panel.appendChild(mp);
    }
  }

  // YoY balance changes for cash/PF/stocks/loans that have snapshots in both
  // the previous and current year (asset_history.valuation_change_notes).
  function renderBalanceChangesPanel(members) {
    const cy = ZK.todayUTC().getUTCFullYear();
    const prior = cy - 1;
    const allNotes = [];
    members.forEach((m) => {
      ZK.valuationChangeNotes(m.assets || [], prior, cy).forEach((n) => {
        allNotes.push(Object.assign({ member_name: m.name }, n));
      });
    });
    if (!allNotes.length) return null;
    allNotes.sort((a, b) => Math.abs(b.change_inr) - Math.abs(a.change_inr));
    const panel = el("div", { class: "panel" });
    panel.appendChild(el("h2", { text: "Recorded balance changes (" + prior + " \u2192 " + cy + ")" }));
    panel.appendChild(el("p", { class: "sub", text: "Assets with recorded balances in both years. Add or edit balances in Yearly Review." }));
    const rows = allNotes.map((n) => el("tr", null, [
      el("td", { text: n.member_name }),
      el("td", { text: n.description + " (" + n.category + ")" }),
      el("td", { class: "num", text: ZK.fmtINR(n.prior_value_inr) }),
      el("td", { class: "num", text: ZK.fmtINR(n.current_value_inr) }),
      el("td", { class: "num " + (n.change_inr >= 0 ? "pos" : "neg"), text: (n.change_inr >= 0 ? "+" : "\u2212") + ZK.fmtINR(Math.abs(n.change_inr)) }),
      el("td", { class: "num", text: n.change_pct != null ? (n.change_pct >= 0 ? "+" : "\u2212") + Math.abs(n.change_pct).toFixed(1) + "%" : "\u2014" }),
    ]));
    panel.appendChild(el("div", { class: "table-wrap" }, sortable(el("table", null, [
      el("thead", null, el("tr", null, [th("Member"), th("Asset"), th(String(prior), true), th(String(cy), true), th("Change", true), th("%", true)])),
      el("tbody", null, rows),
    ]))));
    return panel;
  }

  // --- Yearly Review (ported from yearly_review.py) ---
  function yearlyRange(members) {
    const cy = ZK.todayUTC().getUTCFullYear();
    const years = [];
    members.forEach((m) => (m.assets || []).forEach((a) => {
      const y = ZK.effectiveAcquiredYear(a); if (y) years.push(y);
    }));
    let start = years.length ? Math.min.apply(null, years) : cy;
    if (start > cy) start = cy;
    if (cy - start > 30) start = cy - 30;
    return [start, cy];
  }

  function yearlyInputMode(category) {
    if (ZK.METAL_CATEGORIES.has(category)) return "metal";
    return "inr";
  }

  // Port of yearly_review._chart_value_inr
  function yearlyChartValue(asset, year, yearRates) {
    if (year < ZK.effectiveAcquiredYear(asset)) return { value: null, status: "Not held yet" };
    const snaps = asset.snapshots || [];
    const snap = ZK.pickSnapshot(snaps, year);
    const clone = ZK.assetAsOf(asset, year, snaps);
    if (!clone) {
      if (["Cash", "Stocks", "Business", "Partnership", "Liabilities"].includes(asset.category)) {
        return { value: null, status: "Missing balance" };
      }
      return { value: null, status: "No data" };
    }
    const asOf = new Date(Date.UTC(year, 11, 31));
    const val = ZK.effectiveValuationInr(clone, yearRates, asOf);
    if (snap) return { value: val, status: "Recorded" };
    if (ZK.isPfAsset(asset)) return { value: val, status: "Projected" };
    if (ZK.METAL_CATEGORIES.has(asset.category)) return { value: val, status: "Weight \u00d7 year rate" };
    return { value: val, status: "Estimated" };
  }

  function renderYearly() {
    const panel = document.getElementById("tab-yearly");
    clear(panel);
    const members = Store.members();
    const rates = Store.getRates();
    const [startYear, endYear] = yearlyRange(members);

    if (yearlySelected == null || yearlySelected < startYear || yearlySelected > endYear) {
      yearlySelected = endYear;
    }
    const year = yearlySelected;

    const rmap = {};
    Store.yearlyRates().forEach((r) => { rmap[r.year] = r; });
    const yearRates = rateForYear(year, rmap, rates);

    // Header + year selector
    const head = el("div", { class: "panel" });
    head.appendChild(el("h2", { text: "Yearly review" }));
    head.appendChild(el("p", { class: "sub", html: "Record what each asset was actually worth at the end of a past year. These snapshots make the <strong>Analytics</strong> trends accurate for cash, PF and investments (metals are revalued automatically from yearly rates)." }));
    const yearSel = el("select", null, [].concat(rangeDesc(startYear, endYear).map((y) =>
      el("option", { value: y, selected: y === year ? "selected" : null, text: String(y) }))));
    yearSel.addEventListener("change", () => { yearlySelected = parseInt(yearSel.value, 10); renderYearly(); });
    head.appendChild(field("Year", yearSel));
    panel.appendChild(head);

    if (!members.length) {
      panel.appendChild(el("div", { class: "panel" }, el("div", { class: "empty", html: "No data yet. Add members and assets on the <strong>Dashboard</strong>." })));
      return;
    }

    // Build rows + stats
    const allRows = [];
    members.forEach((m) => {
      (m.assets || []).slice().sort((a, b) => (a.category + (a.description || "")).localeCompare(b.category + (b.description || ""))).forEach((a) => {
        const cv = yearlyChartValue(a, year, yearRates);
        const snap = ZK.pickSnapshot(a.snapshots || [], year);
        const hasSnapshot = !!(snap && snap.year === year && !snap.is_backfill);
        allRows.push({ member: m, asset: a, mode: yearlyInputMode(a.category), value: cv.value, status: cv.status, hasSnapshot: hasSnapshot, snap: snap });
      });
    });
    const totalAssets = allRows.length;
    const recorded = allRows.filter((r) => r.hasSnapshot).length;
    const missing = allRows.filter((r) => !r.hasSnapshot && r.status === "Missing balance").length;

    const stats = el("div", { class: "panel" });
    stats.appendChild(el("div", { class: "cards" }, [
      card("Assets", String(totalAssets)),
      card("Recorded for " + year, String(recorded), recorded ? "accent" : ""),
      card("Missing balances", String(missing), missing ? "warn" : ""),
    ]));
    const fillBtn = el("button", { class: "btn", text: "Record all computable values for " + year, onclick: () => {
      let n = 0;
      allRows.forEach((r) => {
        if (r.hasSnapshot) return;
        const clone = ZK.assetAsOf(r.asset, year, r.asset.snapshots || []);
        if (!clone) return;
        const asOf = new Date(Date.UTC(year, 11, 31));
        const state = ZK.snapshotState(r.asset, year);
        state.valuation_inr = ZK.effectiveValuationInr(clone, yearRates, asOf);
        if (clone.weight_grams != null) state.weight_grams = clone.weight_grams;
        if (clone.gem_carats != null) state.gem_carats = clone.gem_carats;
        Store.setSnapshot(r.member.id, r.asset.id, year, state);
        n++;
      });
      toast(n ? "Recorded " + n + " value(s) for " + year : "Nothing to record", n ? "ok" : "");
      refreshAll();
    } });
    stats.appendChild(el("div", { class: "btn-row" }, fillBtn));
    panel.appendChild(stats);

    // Rates for the selected year
    panel.appendChild(yearlyRatesForYear(year, yearRates, rmap));

    // Per-member asset tables (collapsed by default)
    members.forEach((m) => {
      const memberRows = allRows.filter((r) => r.member.id === m.id);
      if (!memberRows.length) return;
      const payTotal = (m.zakat_payments || []).reduce((s, p) => s + ZK.num(p.amount_inr), 0);
      const sectionBody = [
        el("p", { class: "sub", text: (m.relationship || "Family") + " \u00b7 all-time payments recorded: " + ZK.fmtINR(payTotal) }),
      ];
      const rows = memberRows.map((r) => yearlyAssetRow(r, year));
      const thead = el("thead", null, el("tr", null, [
        th("Category"), th("Description"), th(year + " value", true), th("Status"), th("Record balance"), th("", true),
      ]));
      sectionBody.push(el("div", { class: "table-wrap" }, el("table", null, [thead, el("tbody", null, rows)])));
      panel.appendChild(collapsible(m.name + " \u2014 " + memberRows.length + " asset(s)", sectionBody, false));
    });
  }

  function rangeDesc(start, end) {
    const out = [];
    for (let y = end; y >= start; y--) out.push(y);
    return out;
  }

  function yearlyAssetRow(r, year) {
    const a = r.asset;
    const isMetal = r.mode === "metal";
    const isDiamond = a.category === "Diamond";
    let editInr = "", editWeight = "";
    if (r.snap && r.hasSnapshot) {
      if (r.snap.valuation_inr != null) editInr = r.snap.valuation_inr;
      if (r.snap.weight_grams != null) editWeight = r.snap.weight_grams;
      else if (r.snap.gem_carats != null) editWeight = r.snap.gem_carats;
    } else if (r.mode === "inr") {
      if (ZK.isPfAsset(a) && r.value != null) editInr = (Math.round(r.value * 100) / 100);
      else if (ZK.num(a.valuation_inr) > 0) editInr = ZK.num(a.valuation_inr);
    } else if (isMetal) {
      if (a.weight_grams != null) editWeight = a.weight_grams;
      else if (a.gem_carats != null) editWeight = a.gem_carats;
    }

    const inp = isMetal
      ? el("input", { type: "number", step: "0.001", value: editWeight, placeholder: Help.t(isDiamond ? "ph_carats" : "ph_grams"), style: "max-width:130px" })
      : el("input", { type: "number", step: "0.01", value: editInr, placeholder: curCode(), style: "max-width:140px" });

    const saveBtn = el("button", { class: "link", text: "Save", onclick: () => {
      const state = ZK.snapshotState(a, year);
      if (isMetal) {
        if (inp.value === "") { toast("Enter a value first", "err"); return; }
        if (isDiamond) { state.gem_carats = ZK.num(inp.value); state.weight_grams = null; }
        else { state.weight_grams = ZK.num(inp.value); }
        // value derived from weight × that year's rate at display time
        const rmap = {}; Store.yearlyRates().forEach((x) => { rmap[x.year] = x; });
        const yr = rateForYear(year, rmap, Store.getRates());
        const clone = Object.assign({}, a, { weight_grams: state.weight_grams, gem_carats: state.gem_carats });
        state.valuation_inr = ZK.effectiveValuationInr(clone, yr, new Date(Date.UTC(year, 11, 31)));
      } else {
        if (inp.value === "") { toast("Enter a value first", "err"); return; }
        state.valuation_inr = ZK.num(inp.value);
      }
      Store.setSnapshot(r.member.id, a.id, year, state);
      toast("Recorded " + a.category + " for " + year, "ok");
      refreshAll();
    } });

    const clearBtn = r.hasSnapshot
      ? el("button", { class: "link", style: "color:#dc2626", text: "Clear", onclick: () => { Store.deleteSnapshot(r.member.id, a.id, year); toast("Cleared " + year); refreshAll(); } })
      : null;

    const statusPill = el("span", { class: "pill " + yearlyStatusClass(r.status), text: r.status });
    return el("tr", null, [
      el("td", null, el("span", { class: "pill gray", text: a.category })),
      el("td", { text: a.description || "\u2014" }),
      el("td", { class: "num", text: r.value != null ? ZK.fmtINR(r.value) : "\u2014" }),
      el("td", null, statusPill),
      el("td", null, r.mode === "readonly" ? el("span", { class: "muted", text: "\u2014" }) : inp),
      el("td", { class: "num" }, r.mode === "readonly" ? null : [saveBtn, clearBtn ? document.createTextNode("  ") : null, clearBtn]),
    ]);
  }

  function yearlyStatusClass(status) {
    if (status === "Recorded") return "green";
    if (status === "Missing balance") return "amber";
    return "gray";
  }

  function yearlyRatesForYear(year, yearRates, rmap) {
    const panel = el("div", { class: "subpanel" });
    panel.appendChild(el("div", { class: "member-section-title", text: "Market rates for " + year }));
    const existing = rmap[year];
    panel.appendChild(el("p", { class: "help", text: existing
      ? (existing.is_user_override ? "Saved manually for this year." : "Estimated/fetched for this year \u2014 edit to override.")
      : "No stored rates for this year; values below are the nearest available. Save to pin them." }));
    const g = el("input", { type: "number", step: "0.01", value: ZK.num(yearRates.gold_inr_per_gram), style: "max-width:120px" });
    const s = el("input", { type: "number", step: "0.01", value: ZK.num(yearRates.silver_inr_per_gram), style: "max-width:110px" });
    const p = el("input", { type: "number", step: "0.01", value: ZK.num(yearRates.platinum_inr_per_gram), style: "max-width:120px" });
    const d = el("input", { type: "number", step: "0.01", value: ZK.num(yearRates.diamond_inr_per_carat), style: "max-width:130px" });
    panel.appendChild(el("div", { class: "field-row" }, [field("Gold /g", g), field("Silver /g", s)]));
    panel.appendChild(el("div", { class: "field-row" }, [field("Platinum /g", p), field("Diamond /ct", d)]));
    panel.appendChild(el("div", { class: "btn-row" }, el("button", { class: "btn secondary", text: "Save rates for " + year, onclick: () => {
      Store.setYearlyRate(year, { gold_inr_per_gram: g.value, silver_inr_per_gram: s.value, platinum_inr_per_gram: p.value, diamond_inr_per_carat: d.value }, { is_estimated: false, is_user_override: true, rate_source: "manual" });
      toast("Saved rates for " + year, "ok"); renderYearly();
    } })));
    return panel;
  }

  function card(label, value, cls) {
    return el("div", { class: "card " + (cls || "") }, [
      el("div", { class: "label", text: label }),
      el("div", { class: "value", text: value }),
    ]);
  }
  function th(label, num) { return el("th", { class: num ? "num" : "", text: label }); }

  // --- Generic client-side table sorting ---
  function cellSortValue(cell) {
    if (!cell) return { isNum: false, num: 0, str: "" };
    const input = cell.querySelector("input");
    let raw = input ? input.value : cell.textContent;
    raw = (raw || "").trim();
    const cleaned = raw.replace(/[^0-9.\-]/g, "");
    const num = parseFloat(cleaned);
    const isNum = raw !== "" && raw !== "\u2014" && cleaned !== "" && !isNaN(num) && /[0-9]/.test(raw);
    return { isNum: isNum, num: isNum ? num : 0, str: raw.toLowerCase() };
  }

  function sortTableByColumn(table, idx, dir) {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const rows = Array.prototype.slice.call(tbody.rows);
    const pinned = rows.filter((r) => r.classList.contains("total-row"));
    const movable = rows.filter((r) => !r.classList.contains("total-row"));
    movable.sort((a, b) => {
      const av = cellSortValue(a.cells[idx]), bv = cellSortValue(b.cells[idx]);
      let cmp;
      if (av.isNum && bv.isNum) cmp = av.num - bv.num;
      else cmp = av.str < bv.str ? -1 : (av.str > bv.str ? 1 : 0);
      return cmp * dir;
    });
    movable.concat(pinned).forEach((r) => tbody.appendChild(r));
  }

  // Wire click-to-sort on a table's header cells. opts.skip = [colIndexes to ignore].
  function sortable(table, opts) {
    opts = opts || {};
    const skip = opts.skip || [];
    const thead = table.tHead || table.querySelector("thead");
    if (!thead || !thead.rows.length) return table;
    const ths = Array.prototype.slice.call(thead.rows[0].cells);
    const state = {};
    ths.forEach((thEl, idx) => {
      if (skip.indexOf(idx) >= 0 || !thEl.textContent.trim()) return;
      thEl.classList.add("sortable");
      thEl.addEventListener("click", () => {
        const dir = state[idx] === 1 ? -1 : 1;
        state[idx] = dir;
        ths.forEach((o) => o.classList.remove("sort-asc", "sort-desc"));
        thEl.classList.add(dir === 1 ? "sort-asc" : "sort-desc");
        sortTableByColumn(table, idx, dir);
      });
    });
    return table;
  }

  // --- Zakat across baselines: previous Ramadan, today (live), next Ramadan (projected) ---
  function baselineProjections(members, madhab) {
    const today = ZK.todayUTC();
    const current = ZK.currentZakatBaselineDate(today);
    const prev = ZK.currentZakatBaselineDate(new Date(current.getTime() - 86400000));
    const next = ZK.nextZakatBaselineDate(today);

    const rmap = {};
    Store.yearlyRates().forEach((r) => { rmap[r.year] = r; });
    const live = Store.getRates();

    function totalsAt(date, rates) {
      let wealth = 0, zakat = 0;
      members.forEach((m) => {
        const s = ZK.computeMemberZakat(m, m.assets || [], m.zakat_payments || [], rates, madhab, date);
        wealth += s.net_wealth_inr; zakat += s.zakat_due_inr;
      });
      return { wealth: wealth, zakat: zakat };
    }

    return [
      Object.assign({ label: "Previous Ramadan", date: prev, cls: "" }, totalsAt(prev, rateForYear(prev.getUTCFullYear(), rmap, live))),
      Object.assign({ label: "Today (current rates)", date: today, cls: "accent" }, totalsAt(today, live)),
      Object.assign({ label: "Next Ramadan (projected)", date: next, cls: "warn" }, totalsAt(next, live)),
    ];
  }

  function renderProjectionPanel(members, madhab) {
    const panel = el("div", { class: "panel" });
    panel.appendChild(el("h2", { text: "Zakat across baselines" }));
    panel.appendChild(el("p", { class: "sub", text: "Your wealth and Zakat at the previous Zakat baseline, today's live rates, and the projected next Zakat baseline (1st Friday of Ramadan)." }));
    const proj = baselineProjections(members, madhab);
    panel.appendChild(el("div", { class: "cards" }, proj.map((p) =>
      el("div", { class: "card " + p.cls }, [
        el("div", { class: "label", text: p.label }),
        el("div", { class: "value", text: ZK.fmtINR(p.zakat) }),
        el("div", { class: "card-meta", text: ZK.fmtDate(p.date) + " \u00b7 wealth " + ZK.fmtINR(p.wealth) }),
      ])
    )));
    return panel;
  }

  // --- Rates over time (line graph per metal) ---
  function sparkline(points, color) {
    const W = 560, H = 72, padX = 5, padY = 9;
    const vals = points.map((p) => p.value);
    const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    const range = (max - min) || 1;
    const n = points.length;
    const x = (i) => padX + (n <= 1 ? 0 : (i / (n - 1)) * (W - 2 * padX));
    const y = (v) => padY + (1 - (v - min) / range) * (H - 2 * padY);
    const line = points.map((p, i) => x(i) + "," + y(p.value)).join(" ");
    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "spark-svg", preserveAspectRatio: "none" });
    svg.appendChild(svgEl("polyline", { points: line, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round" }));
    points.forEach((p, i) => svg.appendChild(svgEl("circle", { cx: x(i), cy: y(p.value), r: 2.5, fill: color }, svgEl("title", null, p.year + ": " + ZK.fmtINR(p.value) + "/g"))));
    return svg;
  }

  function renderRatesGraphPanel() {
    const panel = el("div", { class: "panel" });
    panel.appendChild(el("h2", { text: "Market rates over time" }));
    panel.appendChild(el("p", { class: "sub", html: "Per-year metal rates (" + curCode() + "/gram). Fetch a range on the <strong>Market Rates</strong> tab to populate history. Each line is scaled to its own range." }));

    const rows = Store.yearlyRates().slice().sort((a, b) => a.year - b.year);
    const metals = [
      ["gold_inr_per_gram", "Gold", "#d97706"],
      ["silver_inr_per_gram", "Silver", "#64748b"],
      ["platinum_inr_per_gram", "Platinum", "#2563eb"],
    ];
    let any = false;
    metals.forEach((mt) => {
      const pts = rows.map((r) => ({ year: r.year, value: ZK.num(r[mt[0]]) })).filter((p) => p.value > 0);
      if (pts.length < 2) return;
      any = true;
      const cur = pts[pts.length - 1];
      panel.appendChild(el("div", { class: "spark-row" }, [
        el("div", { class: "spark-label" }, [
          el("span", { class: "spark-name", text: mt[1] }),
          el("span", { class: "spark-cur", text: ZK.fmtINR(cur.value) + "/g (" + cur.year + ")" }),
        ]),
        el("div", { class: "spark-wrap" }, sparkline(pts, mt[2])),
      ]));
    });
    if (!any) panel.appendChild(el("div", { class: "empty", text: "Need at least two years of rates. Fetch a range on the Market Rates tab." }));
    return panel;
  }

  // --- Multi-year trend (ported from the server's zakat_trends logic, in-browser) ---
  function svgEl(tag, attrs, children) {
    const NS = "http://www.w3.org/2000/svg";
    const node = document.createElementNS(NS, tag);
    if (attrs) for (const k of Object.keys(attrs)) { if (attrs[k] != null) node.setAttribute(k, attrs[k]); }
    if (children) (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function effectiveAcquiredYear(a) {
    if (a.acquired_year) return parseInt(a.acquired_year, 10);
    if (a.hawl_start_date) { const y = parseInt(String(a.hawl_start_date).slice(0, 4), 10); if (y) return y; }
    return null;
  }

  // Pick the stored yearly rate for a year, falling back to nearest stored year, then current session.
  function rateForYear(year, rmap, fallback) {
    if (rmap[year]) return rmap[year];
    const keys = Object.keys(rmap).map(Number);
    const prior = keys.filter((y) => y < year);
    if (prior.length) return rmap[Math.max.apply(null, prior)];
    const future = keys.filter((y) => y > year);
    if (future.length) return rmap[Math.min.apply(null, future)];
    return fallback;
  }

  // Assets that existed by a given year (by acquired/hawl year; undated assets count in all years).
  function assetsAsOfYear(assets, year) {
    return (assets || []).filter((a) => { const ay = effectiveAcquiredYear(a); return ay == null || ay <= year; });
  }

  function baselineForYear(year, currentYear, today) {
    const asOf = year < currentYear ? new Date(Date.UTC(year, 11, 31)) : today;
    return ZK.zakatAsOf(asOf);
  }

  function buildHouseholdTrend(members, madhab) {
    const today = ZK.todayUTC();
    const currentYear = today.getUTCFullYear();
    const fallback = Store.getRates();
    const rmap = {};
    Store.yearlyRates().forEach((r) => { rmap[r.year] = r; });

    const starts = [];
    members.forEach((m) => (m.assets || []).forEach((a) => { const ay = effectiveAcquiredYear(a); if (ay) starts.push(ay); }));
    let startYear = starts.length ? Math.min.apply(null, starts) : currentYear - 5;
    if (currentYear - startYear > 20) startYear = currentYear - 20; // cap span
    if (startYear > currentYear) startYear = currentYear;

    const points = [];
    for (let y = startYear; y <= currentYear; y++) {
      const yr = rateForYear(y, rmap, fallback);
      const asOf = baselineForYear(y, currentYear, today);
      let wealth = 0, zakat = 0;
      members.forEach((m) => {
        const ya = ZK.assetsAsOfYear(m.assets || [], y);
        const s = ZK.computeMemberZakat(m, ya, m.zakat_payments || [], yr, madhab, asOf);
        wealth += s.net_wealth_inr;
        zakat += s.zakat_due_inr;
      });
      points.push({ year: y, wealth: wealth, zakat: zakat, estimated: rmap[y] ? !!rmap[y].is_estimated : true, hasRate: !!rmap[y] });
    }
    return { years: points.map((p) => p.year), points: points };
  }

  function renderTrendPanel(members, madhab, opts) {
    opts = opts || {};
    const panel = el("div", { class: opts.bare ? "" : "panel" });
    if (!opts.bare) {
      panel.appendChild(el("h2", { text: opts.title || "Wealth & Zakat over time" }));
      panel.appendChild(el("p", { class: "sub", html: "Each year your assets are revalued at that year's market rates (metals by weight; other balances held as recorded) and Zakat is computed on that year's baseline. Use <strong>Yearly Review</strong> to record past cash/PF/investment balances." }));
    }

    const trend = buildHouseholdTrend(members, madhab);
    if (trend.points.length < 1) { panel.appendChild(el("div", { class: "empty", text: "Add assets to see a trend." })); return panel; }

    // Legend
    panel.appendChild(el("div", { class: "trend-legend" }, [
      el("span", null, [el("span", { class: "swatch", style: "background:#10b981" }), document.createTextNode(" Net wealth")]),
      el("span", null, [el("span", { class: "swatch", style: "background:#f59e0b" }), document.createTextNode(" Zakat amount")]),
    ]));

    // SVG chart: wealth bars (left scale) + zakat line (right scale)
    const W = 760, H = 260, padL = 6, padR = 6, padT = 16, padB = 26;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const n = trend.points.length;
    const maxW = Math.max(1, ...trend.points.map((p) => p.wealth));
    const maxZ = Math.max(1, ...trend.points.map((p) => p.zakat));
    const bw = innerW / n;
    const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "trend-svg", preserveAspectRatio: "none" });
    trend.points.forEach((p, i) => {
      const h = (p.wealth / maxW) * innerH;
      const x = padL + i * bw + bw * 0.2, y = padT + innerH - h, w = bw * 0.6;
      svg.appendChild(svgEl("rect", { x: x, y: y, width: w, height: Math.max(0, h), rx: 3, fill: p.estimated ? "#6ee7b7" : "#10b981" },
        svgEl("title", null, p.year + ": net wealth " + ZK.fmtINR(p.wealth) + (p.estimated ? " (estimated rates)" : ""))));
      svg.appendChild(svgEl("text", { x: padL + i * bw + bw / 2, y: H - 8, "text-anchor": "middle", class: "trend-axis" }, String(p.year)));
    });
    const linePts = trend.points.map((p, i) => (padL + i * bw + bw / 2) + "," + (padT + innerH - (p.zakat / maxZ) * innerH)).join(" ");
    svg.appendChild(svgEl("polyline", { points: linePts, fill: "none", stroke: "#f59e0b", "stroke-width": 2 }));
    trend.points.forEach((p, i) => {
      const cx = padL + i * bw + bw / 2, cy = padT + innerH - (p.zakat / maxZ) * innerH;
      svg.appendChild(svgEl("circle", { cx: cx, cy: cy, r: 3, fill: "#f59e0b" }, svgEl("title", null, p.year + ": Zakat " + ZK.fmtINR(p.zakat))));
    });
    panel.appendChild(el("div", { class: "trend-chart" }, svg));

    // Detail table
    const rows = trend.points.slice().reverse().map((p) => el("tr", null, [
      el("td", null, el("strong", { text: String(p.year) })),
      el("td", { class: "num", text: ZK.fmtINR(p.wealth) }),
      el("td", { class: "num", text: ZK.fmtINR(p.zakat) }),
      el("td", null, el("span", { class: "pill " + (p.hasRate && !p.estimated ? "green" : "gray"), text: p.hasRate ? (p.estimated ? "estimated" : "actual") : "current rates" })),
    ]));
    panel.appendChild(el("div", { class: "table-wrap" }, sortable(el("table", null, [
      el("thead", null, el("tr", null, [th("Year"), th("Net wealth", true), th("Zakat amount", true), th("Rates")])),
      el("tbody", null, rows),
    ]))));
    return panel;
  }

  // --- Family & Assets (built into the dashboard landing page) ---
  function buildFamily(panel) {
    const rates = Store.getRates();
    const madhab = Store.getMadhab();

    const head = el("div", { class: "panel" });
    head.appendChild(el("h2", { text: Help.t("family_section_title") }));
    head.appendChild(el("p", { class: "sub", text: Help.t("family_section_desc") }));
    head.appendChild(el("button", { class: "btn", text: Help.t("add_member_btn"), onclick: () => {
      // Family name is mandatory before any members/assets are recorded.
      if (!Store.getFamilyName()) {
        toast(Help.t("toast_add_family_first"), "err");
        const inp = document.getElementById("family-name-input");
        if (inp) {
          inp.scrollIntoView({ block: "center", behavior: "smooth" });
          setTimeout(() => inp.focus(), 350);
        }
        return;
      }
      memberForm();
    } }));
    panel.appendChild(head);

    const members = Store.members();
    if (!members.length) {
      const hint = Store.getFamilyName()
        ? Help.t("family_empty_no_members")
        : Help.t("family_empty_state");
      panel.appendChild(el("div", { class: "panel" }, el("div", { class: "empty", text: hint })));
      return;
    }

    members.forEach((m) => {
      const summary = ZK.computeMemberZakat(m, m.assets || [], m.zakat_payments || [], rates, madhab, baseline);
      const block = el("div", { class: "member-block", "data-collapsed": "true" });

      const headToggle = el("button", { type: "button", class: "member-head-toggle" }, [
        el("span", { class: "member-chevron", text: "\u25BE" }),
        el("div", null, [
          el("div", { class: "name", text: m.name }),
          el("div", { class: "muted", style: "font-size:12px", text: m.relationship + (isMinorMember(m) ? " \u00b7 Minor" : "") + " \u00b7 Wealth: " + ZK.fmtINR(summary.total_wealth_inr) + " \u00b7 Zakat: " + ZK.fmtINR(summary.zakat_due_inr) }),
        ]),
      ]);
      headToggle.addEventListener("click", () => {
        const collapsed = block.dataset.collapsed === "true";
        block.dataset.collapsed = collapsed ? "false" : "true";
      });

      const head = el("div", { class: "member-head" }, [
        headToggle,
        el("div", { class: "member-actions" }, [
          el("div", { class: "member-actions-primary" }, [
            el("button", { class: "btn sm", text: "✦ What do I own?", onclick: () => showAssetChecklist(m.id) }),
            el("button", { class: "btn sm secondary", text: "Zakat given", onclick: () => paymentForm(m.id) }),
          ]),
          el("div", { class: "member-actions-util" }, [
            el("button", { class: "btn-ghost sm", text: "Edit", onclick: () => memberForm(m) }),
            el("button", {
              class: "btn-ghost sm danger-text",
              text: "Delete",
              onclick: () => confirmDialog(
                "Delete member",
                "Delete " + m.name + " and all their assets and payments?",
                () => { Store.deleteMember(m.id); refreshAll(); toast("Member deleted"); },
                "Delete",
                true
              ),
            }),
          ]),
        ]),
      ]);
      block.appendChild(head);

      const body = el("div", { class: "member-body" });

      // Zakat breakdown (component-level, nisab, hawl pending) — ported from
      // member_zakat_breakdown.html.
      body.appendChild(memberBreakdownNode(summary));

      // Assets
      body.appendChild(el("div", { class: "member-section-title", text: "Assets" }));
      if (!(m.assets || []).length) {
        body.appendChild(el("div", { class: "muted", style: "font-size:13px;margin-top:6px", text: Help.t("no_assets_yet") }));
      } else {
        const rows = m.assets.map((a) => {
          const val = ZK.effectiveValuationInr(a, rates, baseline);
          const detail = assetDetail(a);
          const thumb = a.image ? el("img", { class: "asset-thumb", src: a.image, alt: "" }) : null;

          // Hawl badge — only for categories that require hawl (not Agriculture / Rikaz)
          const needsHawl = a.category !== "Agriculture" && a.category !== "Rikaz";
          let hawlBadge = null;
          if (needsHawl) {
            const complete = ZK.hawlComplete(a, baseline);
            const daysLeft = complete ? 0 : ZK.hawlDaysRemaining(a, baseline);
            hawlBadge = el("span", {
              class: "pill " + (complete ? "green" : "amber") + " hawl-badge",
              text: complete ? "✓ Hawl" : daysLeft + "d to hawl",
              title: complete ? "Hawl complete — this asset is eligible" : daysLeft + " days until this asset completes one lunar year",
            });
          }
          // Combined info cell: category pill + description + detail line + hawl badge
          const infoCell = el("td", { class: "asset-info-cell" });
          const topRow = el("div", { class: "asset-top" });
          topRow.appendChild(el("span", { class: "pill gray asset-cat-pill", text: (CATEGORY_ICONS[a.category] ? CATEGORY_ICONS[a.category] + " " : "") + a.category }));
          if (thumb) topRow.appendChild(thumb);
          topRow.appendChild(document.createTextNode(" " + (a.description || a.category)));
          infoCell.appendChild(topRow);
          if (detail || hawlBadge) {
            const subRow = el("div", { class: "asset-sub" });
            if (detail) subRow.appendChild(document.createTextNode(detail));
            if (hawlBadge) subRow.appendChild(hawlBadge);
            infoCell.appendChild(subRow);
          }
          infoCell.addEventListener("click", () => assetForm(m.id, a));

          // Value cell — tap to edit inline.
          // For weight-based metals (Gold/Silver/Platinum) and PF, the displayed
          // value is computed rather than stored directly, so tap opens the full
          // modal instead (where the real input — grams / balance — lives).
          const isComputedVal = (
            ((a.category === "Gold" || a.category === "Silver" || a.category === "Platinum") && ZK.num(a.weight_grams) > 0) ||
            (a.category === "Diamond" && ZK.num(a.gem_carats) > 0) ||
            a.category === "PF"
          );
          const valCell = el("td", { class: "num" });
          const valBtn = el("button", {
            class: "val-tap",
            text: ZK.fmtINR(val),
            title: isComputedVal ? "Tap to edit" : "Tap to edit value",
          });
          valBtn.addEventListener("click", () => {
            if (isComputedVal) { assetForm(m.id, a); return; }
            // Inline edit: replace button with input + Save/Cancel
            clear(valCell);
            const rawVal = ZK.num(a.valuation_inr);
            const inp = el("input", {
              type: "text",
              inputmode: "decimal",
              class: "inline-val-inp",
              value: rawVal > 0 ? String(rawVal) : "",
              placeholder: "0",
            });
            const saveBtn = el("button", { class: "btn sm", text: "Save" });
            const cancelBtn = el("button", { class: "btn-ghost sm", text: "Cancel" });
            function doSave() {
              const newVal = ZK.num(inp.value);
              Store.updateAsset(m.id, a.id, { valuation_inr: newVal });
              if (ZK.TRACKED_CATEGORIES.has(a.category)) {
                const cy = ZK.todayUTC().getUTCFullYear();
                const saved = Store.getAsset(m.id, a.id);
                if (saved) Store.setSnapshot(m.id, a.id, cy, ZK.snapshotState(saved, cy));
              }
              refreshAll(); toast("Saved", "ok");
            }
            function doCancel() { refreshAll(); }
            inp.addEventListener("keydown", (e) => {
              if (e.key === "Enter") { e.preventDefault(); doSave(); }
              if (e.key === "Escape") doCancel();
            });
            saveBtn.addEventListener("click", doSave);
            cancelBtn.addEventListener("click", doCancel);
            valCell.appendChild(el("div", { class: "inline-edit-wrap" }, [
              inp,
              el("div", { class: "inline-edit-btns" }, [cancelBtn, saveBtn]),
            ]));
            inp.focus(); inp.select();
          });
          valCell.appendChild(valBtn);

          return el("tr", null, [infoCell, valCell]);
        });
        const thead = el("thead", null, el("tr", null, [th("Asset"), th("Value", true)]));
        body.appendChild(el("div", { class: "table-wrap" }, sortable(el("table", null, [thead, el("tbody", null, rows)]))));
      }

      // Payments
      body.appendChild(el("div", { class: "member-section-title", text: "Zakat payments" }));
      if (!(m.zakat_payments || []).length) {
        body.appendChild(el("div", { class: "muted", style: "font-size:13px", text: "No payments recorded." }));
      } else {
        const rows = m.zakat_payments.map((p) => {
          // Given-to cell — tap to open full edit modal
          const givenCell = el("td", { class: "desc-tap", title: "Tap to edit", text: p.given_to });
          givenCell.addEventListener("click", () => paymentForm(m.id, p));
          // Amount cell — tap to edit inline
          const amtCell = el("td", { class: "num" });
          const amtBtn = el("button", { class: "val-tap", text: ZK.fmtINR(p.amount_inr), title: "Tap to edit amount" });
          amtBtn.addEventListener("click", () => {
            clear(amtCell);
            const rawAmt = ZK.num(p.amount_inr);
            const inp = el("input", {
              type: "text",
              inputmode: "decimal",
              class: "inline-val-inp",
              value: rawAmt > 0 ? String(rawAmt) : "",
              placeholder: "0",
            });
            const saveBtn = el("button", { class: "btn sm", text: "Save" });
            const cancelBtn = el("button", { class: "btn-ghost sm", text: "Cancel" });
            function doSave() {
              const newAmt = ZK.num(inp.value);
              if (newAmt <= 0) { toast("Enter a valid amount", "err"); return; }
              Store.updatePayment(m.id, p.id, p.given_to, inp.value);
              refreshAll(); toast("Saved", "ok");
            }
            function doCancel() { refreshAll(); }
            inp.addEventListener("keydown", (e) => {
              if (e.key === "Enter") { e.preventDefault(); doSave(); }
              if (e.key === "Escape") doCancel();
            });
            saveBtn.addEventListener("click", doSave);
            cancelBtn.addEventListener("click", doCancel);
            amtCell.appendChild(el("div", { class: "inline-edit-wrap" }, [
              inp,
              el("div", { class: "inline-edit-btns" }, [cancelBtn, saveBtn]),
            ]));
            inp.focus(); inp.select();
          });
          amtCell.appendChild(amtBtn);
          return el("tr", null, [givenCell, amtCell]);
        });
        const thead = el("thead", null, el("tr", null, [th("Given to"), th("Amount", true)]));
        body.appendChild(el("div", { class: "table-wrap" }, sortable(el("table", null, [thead, el("tbody", null, rows)]))));
      }

      block.appendChild(body);
      panel.appendChild(block);
    });
  }

  // Returns true if member's age is below Islamic majority (~15 years).
  function isMinorMember(m) {
    if (!m || !m.dob) return false;
    return (Date.now() - new Date(m.dob).getTime()) / (365.25 * 24 * 3600 * 1000) < 15;
  }

  // Per-member Zakat breakdown card (component zakat, nisab, hawl-pending).
  function memberBreakdownNode(s) {
    // Minor detection: look up member DOB from store
    const memberData = Store.getMember(s.member_id);
    const dobStr = memberData ? memberData.dob : null;
    let isMinor = false;
    let zakatDueDate = null;
    if (dobStr) {
      const birth = new Date(dobStr);
      const ageYears = (Date.now() - birth.getTime()) / (365.25 * 24 * 3600 * 1000);
      isMinor = ageYears < 15;
      if (isMinor) {
        const due = new Date(birth);
        due.setFullYear(due.getFullYear() + 15);
        zakatDueDate = due.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
      }
    }

    const items = [];
    function add(text) { items.push(el("div", { class: "bd-item", text: text })); }
    if (s.gold_zakat_inr || s.total_gold_grams) add("Gold " + ZK.fmtGrams(s.total_gold_grams) + "g \u2192 " + ZK.fmtINR(s.gold_zakat_inr));
    if (s.silver_zakat_inr || s.total_silver_grams) add("Silver " + ZK.fmtGrams(s.total_silver_grams) + "g (zakatable " + s.zakatable_silver_grams.toFixed(2) + "g) \u2192 " + ZK.fmtINR(s.silver_zakat_inr));
    if (s.platinum_zakat_inr || s.total_platinum_grams) add("Platinum " + ZK.fmtGrams(s.total_platinum_grams) + "g \u2192 " + ZK.fmtINR(s.platinum_zakat_inr));
    if (s.diamond_zakat_inr || s.total_diamond_carats) add("Diamond " + s.total_diamond_carats.toFixed(2) + " ct \u2192 " + ZK.fmtINR(s.diamond_zakat_inr));
    if (s.cash_zakat_inr) add("Cash \u2192 " + ZK.fmtINR(s.cash_zakat_inr));
    if (s.investments_zakat_inr) add("Investments \u2212 loans \u2192 " + ZK.fmtINR(s.investments_zakat_inr));
    if (s.pf_zakat_inr) add("PF / EPF \u2192 " + ZK.fmtINR(s.pf_zakat_inr));
    if (s.livestock_zakat_inr) add("Livestock (Sunnah tiers) \u2192 " + ZK.fmtINR(s.livestock_zakat_inr));
    if (s.agriculture_zakat_inr) add("Agriculture (harvest) \u2192 " + ZK.fmtINR(s.agriculture_zakat_inr));
    if (s.property_exempt_wealth_inr) items.push(el("div", { class: "bd-item" }, [el("span", { class: "wealth-col-exempt", text: "Property (home, rental)" }), document.createTextNode(" \u2192 " + ZK.fmtINR(s.property_exempt_wealth_inr) + " (not in Zakat)")]));
    if (s.property_zakat_inr || s.property_wealth_inr) items.push(el("div", { class: "bd-item" }, [el("span", { class: "wealth-col-trade", text: "Property (for sale)" }), document.createTextNode(" \u2192 " + ZK.fmtINR(s.property_zakat_inr))]));
    if (s.partnership_zakat_inr) add("Partnership \u2192 " + ZK.fmtINR(s.partnership_zakat_inr));
    if (s.rikaz_zakat_inr) add("Rikaz (20%) \u2192 " + ZK.fmtINR(s.rikaz_zakat_inr));

    const wrap = el("div", { class: "breakdown" });
    wrap.appendChild(el("div", { class: "bd-head" }, [
      document.createTextNode(s.member_name + " "),
      isMinor
        ? el("span", { class: "pill amber", text: "Minor" })
        : el("span", { class: "pill " + (s.is_eligible ? "green" : "gray"), text: s.is_eligible ? "Eligible" : "Not eligible" }),
    ]));
    if (isMinor) {
      wrap.appendChild(el("div", { class: "bd-note warn", html:
        "<strong>Minor \u2014 Zakat not obligatory yet.</strong> Age of maturity (bul\u016bgh) is approximately 15 lunar years." +
        (zakatDueDate ? " Zakat becomes due from <strong>" + zakatDueDate + "</strong>." : "") +
        "<br><small>Hanafi: fully exempt until bul\u016bgh. M\u0101lik\u012b / Sh\u0101fi\u02bfi\u012b / \u1e24anbal\u012b: guardian may pay zakat from the minor\u2019s wealth.</small>",
      }));
    }
    if (items.length) wrap.appendChild(el("div", { class: "bd-grid" }, items));
    wrap.appendChild(el("div", { class: "bd-total", text:
      "Wealth " + ZK.fmtINR(s.total_wealth_inr) +
      " \u00b7 Nisab (" + s.nisab_basis + ") " + ZK.fmtINR(s.nisab_threshold_inr) +
      " \u00b7 Due " + ZK.fmtINR(s.zakat_due_inr) + " \u00b7 Paid " + ZK.fmtINR(s.total_paid_inr) +
      " \u00b7 Remaining " + ZK.fmtINR(Math.max(0, s.remaining_inr)) }));
    if (!isMinor && s.hawl_pending_wealth_inr > 0) {
      wrap.appendChild(el("div", { class: "bd-note warn", text: s.assets_pending_hawl + " asset(s) awaiting hawl (~354 lunar days): " + ZK.fmtINR(s.hawl_pending_wealth_inr) + " not included yet." }));
    }
    if (!isMinor && s.jewelry_exempt) {
      wrap.appendChild(el("div", { class: "bd-note", text: "Tip: mark personal adornment on gold/silver/diamond assets to apply your school's jewelry exemption." }));
    }
    return wrap;
  }

  function assetDetail(a) {
    const bits = [];
    if (ZK.METAL_CATEGORIES.has(a.category) && a.category !== "Diamond" && a.weight_grams) {
      bits.push(ZK.fmtGrams(a.weight_grams) + " g");
      const pl = ZK.purityLabel(a);
      if (pl) bits.push(pl);
    }
    if (a.category === "Diamond" && a.gem_carats) bits.push(ZK.fmtGrams(a.gem_carats) + " ct");
    if (a.category === "Livestock") { if (a.quantity_count) bits.push(a.quantity_count + " head"); if (a.asset_subtype) bits.push(a.asset_subtype); }
    if (a.category === "Agriculture" && a.asset_subtype) bits.push(a.asset_subtype);
    if (a.category === "Property" && a.asset_subtype) bits.push(a.asset_subtype);
    if (a.is_personal_jewelry) bits.push("personal jewelry");
    if (a.acquired_year) bits.push("since " + a.acquired_year);
    if (a.hawl_start_date) bits.push("hawl " + a.hawl_start_date);
    return bits.join(" \u00b7 ");
  }

  // --- Member form ---
  // --- Inline help (plain-language, translatable) ---
  // helpNode(key) -> a div bound to a ZKHelp string; ZKHelp.refresh() re-translates
  // every bound node in place, so switching language never loses typed values.
  function helpNode(key, cls) {
    const d = el("div", { class: cls || "help" });
    if (Help) Help.bind(d, key);
    return d;
  }

  // field() + a translated help line under the input.
  function fieldK(label, inputNode, helpKey) {
    const f = field(label, inputNode);
    if (Help) f.appendChild(helpNode(helpKey));
    return f;
  }

  // Language pills for the help text (English + languages matching the selected
  // currency, e.g. INR -> Urdu/Hindi). Hidden when only English applies.
  function helpLangBar() {
    if (!Help) return null;
    const langs = Help.availableLangs();
    if (langs.length < 2) return null;
    const bar = el("div", { class: "help-lang" });
    function renderPills() {
      clear(bar);
      bar.appendChild(el("span", { class: "help-lang-label", text: "Help language:" }));
      langs.forEach((code) => {
        bar.appendChild(el("button", {
          type: "button",
          class: "help-lang-pill" + (Help.effectiveLang() === code ? " active" : ""),
          text: Help.LANG_LABELS[code],
          onclick: () => { Help.setLang(code); Help.refresh(); renderPills(); },
        }));
      });
    }
    renderPills();
    return bar;
  }

  function memberForm(existing) {
    const allMembers = Store.members();
    const name = el("input", { type: "text", value: existing ? existing.name : "", placeholder: Help.t("ph_member_name") });
    const rel = el("input", { type: "text", value: existing ? existing.relationship : "", placeholder: Help.t("ph_member_rel") });
    const dob = el("input", { type: "date", value: existing && existing.dob ? existing.dob : "" });

    // "Copy from existing" — only shown when adding a new member and others exist
    const formItems = [helpLangBar(), helpNode("member_intro", "form-intro")];
    if (!existing && allMembers.length) {
      const copySelect = el("select");
      copySelect.appendChild(el("option", { value: "", text: "— choose a member —" }));
      allMembers.forEach((m) => copySelect.appendChild(el("option", { value: String(m.id), text: m.name + (m.relationship ? " (" + m.relationship + ")" : "") })));
      copySelect.addEventListener("change", () => {
        const src = allMembers.find((m) => String(m.id) === copySelect.value);
        if (src) { name.value = src.name; rel.value = src.relationship || ""; dob.value = src.dob || ""; }
      });
      formItems.push(field("Copy from existing", copySelect));
    }
    formItems.push(
      fieldK("Name", name, "member_name"),
      fieldK("Relationship", rel, "member_rel"),
      field("Date of birth (optional)", dob),
    );

    const body = el("form", null, formItems);
    const save = el("button", { class: "btn", text: existing ? "Save" : "Add member", onclick: (e) => {
      e.preventDefault();
      if (!name.value.trim()) { toast("Name is required", "err"); return; }
      if (existing) Store.updateMember(existing.id, name.value, rel.value, dob.value || null);
      else Store.addMember(name.value, rel.value, dob.value || null);
      closeModal(); refreshAll(); toast("Saved", "ok");
    } });
    openModal(existing ? "Edit member" : "Add family member", body, [
      el("button", { class: "btn secondary", text: "Cancel", onclick: closeModal }), save,
    ]);
  }

  // --- Asset form ---
  function assetForm(memberId, existing, preCategory, preSubtype) {
    const rates = Store.getRates();
    const cat = el("select");
    ZK.CATEGORY_GROUPS.forEach((grp) => {
      const og = el("optgroup", { label: grp[0] });
      grp[1].forEach((c) => og.appendChild(el("option", { value: c, selected: existing && existing.category === c ? "selected" : null, text: c })));
      cat.appendChild(og);
    });
    if (!existing) cat.value = preCategory || "Cash";
    else if (existing.category) cat.value = existing.category;

    const desc = el("input", { type: "text", value: existing ? existing.description || "" : "", placeholder: Help.t("ph_asset_desc") });
    const valuation = el("input", { type: "number", step: "0.01", value: existing && existing.valuation_inr != null ? existing.valuation_inr : "" });
    const weight = el("input", { type: "number", step: "0.001", value: existing && existing.weight_grams != null ? existing.weight_grams : "" });
    const puritySelect = el("select");
    const purityCustom = el("input", { type: "text", placeholder: Help.t("ph_purity_gold") });
    if (existing && existing.purity_value && !ZK.isPresetPurity(existing.category, existing.purity_value)) {
      purityCustom.value = existing.purity_value;
    }
    const carats = el("input", { type: "number", step: "0.001", value: existing && existing.gem_carats != null ? existing.gem_carats : "" });
    const subtype = el("select");
    const quantity = el("input", { type: "number", step: "1", value: existing && existing.quantity_count != null ? existing.quantity_count : "" });
    const acquiredYear = el("input", { type: "number", step: "1", value: existing && existing.acquired_year != null ? existing.acquired_year : "", placeholder: Help.t("ph_acquired_year") });
    const hawlStart = el("input", { type: "date", value: existing ? existing.hawl_start_date || "" : "" });
    const jewelry = el("input", { type: "checkbox" });
    if (existing && existing.is_personal_jewelry) jewelry.checked = true;
    const balanceAsOf = el("input", { type: "date", value: existing ? existing.balance_as_of_date || "" : "" });
    const empMonthly = el("input", { type: "number", step: "0.01", value: existing && existing.monthly_contribution_employee != null ? existing.monthly_contribution_employee : "" });
    const erMonthly = el("input", { type: "number", step: "0.01", value: existing && existing.monthly_contribution_employer != null ? existing.monthly_contribution_employer : "" });
    const annualRate = el("input", { type: "number", step: "0.01", value: existing && existing.annual_interest_rate != null ? existing.annual_interest_rate : "", placeholder: "8.25" });
    // Hidden file inputs — one for camera, one for gallery
    const cameraInput = el("input", { type: "file", accept: "image/*", capture: "environment", style: "display:none" });
    const galleryInput = el("input", { type: "file", accept: "image/*", style: "display:none" });
    let imageData = existing ? existing.image : null;
    let imageName = existing ? existing.image_filename : null;
    const imagePreview = el("div");
    function renderImagePreview() {
      clear(imagePreview);
      if (imageData) {
        imagePreview.appendChild(el("img", { class: "asset-thumb", style: "width:60px;height:60px;object-fit:cover;border-radius:6px", src: imageData, alt: "" }));
        imagePreview.appendChild(el("button", { class: "link", style: "margin-left:10px;color:#dc2626", text: "Remove", onclick: (e) => { e.preventDefault(); imageData = null; imageName = null; renderImagePreview(); } }));
      }
    }
    function readImageFile(f) {
      if (!f) return;
      const reader = new FileReader();
      reader.onload = (e) => { imageData = e.target.result; imageName = f.name; renderImagePreview(); };
      reader.readAsDataURL(f);
    }
    cameraInput.addEventListener("change", () => readImageFile(cameraInput.files[0]));
    galleryInput.addEventListener("change", () => readImageFile(galleryInput.files[0]));

    // Photo button — shows camera/gallery choice on mobile, single picker on desktop
    const isCapacitorNative = typeof window.Capacitor !== "undefined" && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || isCapacitorNative;
    const photoBtn = el("button", {
      class: "btn secondary",
      type: "button",
      text: "📷 Add Photo",
      onclick: (e) => {
        e.preventDefault();
        if (!isMobile) { galleryInput.click(); return; }
        // Show inline choice: camera or gallery
        const menu = el("div", { style: "display:flex;gap:8px;margin-top:6px;flex-wrap:wrap" }, [
          el("button", { class: "btn secondary", type: "button", text: "📷 Camera", onclick: (ev) => { ev.preventDefault(); menu.remove(); cameraInput.click(); } }),
          el("button", { class: "btn secondary", type: "button", text: "🖼️ Gallery", onclick: (ev) => { ev.preventDefault(); menu.remove(); galleryInput.click(); } }),
          el("button", { class: "btn", type: "button", text: "Cancel", onclick: (ev) => { ev.preventDefault(); menu.remove(); } }),
        ]);
        photoBtn.insertAdjacentElement("afterend", menu);
      },
    });
    const imageInput = el("div", { style: "display:flex;align-items:center;gap:8px;flex-wrap:wrap" }, [photoBtn, cameraInput, galleryInput]);
    renderImagePreview();

    const preview = el("div", { class: "preview" });

    // Field containers
    const valueHelp = helpNode("asset_value");
    const fValuation = field("Value (" + curCode() + ")", valuation);
    fValuation.appendChild(valueHelp);
    const fWeight = fieldK("Gross weight (grams)", weight, "asset_weight");
    const fPurity = fieldK("Karat (purity)", puritySelect, "asset_purity");
    const fPurityCustom = fieldK("Custom purity", purityCustom, "asset_purity_custom");
    const fCarats = fieldK("Carats", carats, "asset_carats");
    const subtypeHelp = helpNode("asset_subtype_property");
    const fSubtype = field("Type", subtype);
    fSubtype.appendChild(subtypeHelp);
    const fQuantity = fieldK("Head count", quantity, "asset_quantity");
    const fJewelry = el("div", { class: "field" }, el("label", { class: "checkbox-field" }, [jewelry, el("span", { text: " Personal jewelry (exempt in Shafi'i/Maliki/Hanbali)" })]));
    if (Help) fJewelry.appendChild(helpNode("asset_jewelry"));
    const fBalanceAsOf = fieldK("Balance as of date", balanceAsOf, "asset_pf_asof");
    const fEmp = fieldK("Employee monthly (" + curCode() + ")", empMonthly, "asset_pf_monthly");
    const fEr = fieldK("Employer monthly (" + curCode() + ")", erMonthly, "asset_pf_monthly");
    const fRate = fieldK("Annual interest rate (%)", annualRate, "asset_pf_rate");
    const fHawl = fieldK("Hawl start date", hawlStart, "asset_hawl");
    const fAcq = fieldK("Acquired year", acquiredYear, "asset_acquired");
    // Plain-words explainer for the selected category, updated on change.
    const catExplainer = el("div", { class: "cat-explainer" });
    const grpMetal = el("div", { class: "field-group field-metal" }, [fWeight, fPurity, fPurityCustom]);
    const grpDiamond = el("div", { class: "field-group field-diamond" }, [fCarats]);
    const grpSubtype = el("div", { class: "field-group field-subtype" }, [fSubtype]);
    const grpQuantity = el("div", { class: "field-group field-quantity" }, [fQuantity]);
    const grpPf = el("div", { class: "field-group field-pf" }, [fBalanceAsOf, fEmp, fEr, fRate]);
    const grpHawl = el("div", { class: "field-group field-hawl" }, el("div", { class: "field-row" }, [fAcq, fHawl]));

    function setSubtypeOptions(category) {
      const opts = category === "Property" ? ["personal", "rental", "trade"]
        : category === "Agriculture" ? ["rain", "irrigated", "mixed"]
        : category === "Livestock" ? ["sheep", "cattle", "camel"] : [];
      clear(subtype);
      opts.forEach((o) => subtype.appendChild(el("option", { value: o, selected: existing && (existing.asset_subtype || "") === o ? "selected" : null, text: o })));
    }

    function syncPurityFields(category) {
      const purityLabel = fPurity.querySelector("label");
      if (purityLabel) purityLabel.textContent = ZK.purityFieldLabel(category);
      const saved = (existing && (existing.category === category) && existing.purity_value) ? existing.purity_value : null;
      ZK.populatePuritySelect(puritySelect, category, saved);
      const isCustom = puritySelect.value === "__custom__";
      show(fPurityCustom, isCustom);
      if (isCustom && saved) purityCustom.value = saved;
      else if (!isCustom) purityCustom.value = "";
      purityCustom.placeholder = Help.t(category === "Gold" ? "ph_purity_gold" : "ph_purity_silver");
    }

    function currentPurityValue() {
      return ZK.resolvePurityValue(puritySelect.value, purityCustom.value);
    }

    function updateVisibility() {
      const c = cat.value;
      const isMetalWeight = (c === "Gold" || c === "Silver" || c === "Platinum");
      const isDiamond = c === "Diamond";
      const isPF = c === "PF";
      const isLivestock = c === "Livestock";
      const isJewelryCat = ZK.JEWELRY_CATEGORIES.has(c);
      const hasSubtype = (c === "Property" || c === "Agriculture" || c === "Livestock");
      const isHawlCat = (c !== "Agriculture" && c !== "Rikaz");

      show(grpMetal, isMetalWeight);
      show(grpDiamond, isDiamond);
      show(grpSubtype, hasSubtype);
      show(grpQuantity, isLivestock);
      show(grpPf, isPF);
      show(grpHawl, isHawlCat);
      show(fJewelry, isJewelryCat);
      // value field label
      const valLabel = fValuation.querySelector("label");
      if (valLabel) {
        if (isLivestock) valLabel.textContent = "Value per head (" + curCode() + ")";
        else if (isPF) valLabel.textContent = "Current PF balance (" + curCode() + ")";
        else if (isDiamond) valLabel.textContent = "Value (" + curCode() + ", optional if carats set)";
        else valLabel.textContent = "Value (" + curCode() + ")";
      }
      // hide manual value for metal-by-weight (computed)
      show(fValuation, !isMetalWeight);
      if (isMetalWeight) syncPurityFields(c);
      if (hasSubtype) setSubtypeOptions(c);
      // Swap the plain-language guidance to match the category.
      if (Help) {
        Help.bind(catExplainer, "cat_" + c);
        Help.bind(valueHelp, isPF ? "asset_pf_balance" : "asset_value");
        if (hasSubtype) {
          Help.bind(subtypeHelp, c === "Property" ? "asset_subtype_property"
            : c === "Agriculture" ? "asset_subtype_agri" : "asset_subtype_livestock");
        }
      }
      updatePreview();
    }

    function updatePreview() {
      const c = cat.value;
      if (c === "Gold" || c === "Silver" || c === "Platinum") {
        const stub = { category: c, weight_grams: ZK.num(weight.value), purity_value: currentPurityValue(), valuation_inr: 0 };
        if (ZK.num(weight.value) > 0) {
          const v = ZK.metalMarketValue(stub, rates, 0);
          preview.textContent = "Market value: " + ZK.fmtINR(v) + " (" + ZK.purityLabel(stub) + ")";
        } else preview.textContent = "";
      } else if (c === "Diamond") {
        const stub = { category: c, gem_carats: ZK.num(carats.value), valuation_inr: ZK.num(valuation.value) };
        preview.textContent = "Market value: " + ZK.fmtINR(ZK.metalMarketValue(stub, rates, 0));
      } else if (c === "Livestock") {
        const r = ZK.computeLivestockZakat(ZK.num(quantity.value), subtype.value, ZK.num(valuation.value));
        preview.textContent = r.below_nisab ? r.description : "Due: " + r.description + " \u2248 " + ZK.fmtINR(r.zakat_inr);
      } else if (c === "Agriculture") {
        const res = ZK.agricultureZakatInr(ZK.num(valuation.value), subtype.value);
        preview.textContent = "Zakat: " + ZK.fmtINR(res[0]) + " (" + res[2] + ")";
      } else preview.textContent = "";
    }

    [weight, purityCustom, carats, valuation, quantity].forEach((inp) => inp.addEventListener("input", updatePreview));
    puritySelect.addEventListener("change", () => {
      show(fPurityCustom, puritySelect.value === "__custom__");
      if (puritySelect.value !== "__custom__") purityCustom.value = "";
      updatePreview();
    });
    subtype.addEventListener("change", updatePreview);
    cat.addEventListener("change", updateVisibility);

    const body = el("form", null, [
      helpLangBar(),
      helpNode("intro_zakat", "form-intro"),
      fieldK("Category", cat, "asset_category"),
      catExplainer,
      fieldK("Description", desc, "asset_desc"),
      fValuation,
      grpMetal, grpDiamond, grpSubtype, grpQuantity, grpPf, grpHawl,
      fJewelry,
      fieldK("Photo (optional)", imageInput, "asset_photo"),
      imagePreview,
      preview,
    ]);

    setSubtypeOptions(cat.value);
    updateVisibility();
    // Apply checklist pre-selection (e.g. Property → trade subtype).
    if (!existing && preSubtype && subtype.querySelector("option[value='" + preSubtype + "']")) {
      subtype.value = preSubtype;
      updatePreview();
    }

    const save = el("button", { class: "btn", text: existing ? "Save asset" : "Add asset", onclick: (e) => {
      e.preventDefault();
      const c = cat.value;
      const data = {
        category: c,
        description: desc.value.trim(),
        valuation_inr: ZK.num(valuation.value),
        weight_grams: (c === "Gold" || c === "Silver" || c === "Platinum") && weight.value !== "" ? ZK.num(weight.value) : null,
        gem_carats: c === "Diamond" && carats.value !== "" ? ZK.num(carats.value) : null,
        purity_value: (c === "Gold" || c === "Silver" || c === "Platinum") ? currentPurityValue() : null,
        asset_subtype: (c === "Property" || c === "Agriculture" || c === "Livestock") ? subtype.value : null,
        quantity_count: c === "Livestock" && quantity.value !== "" ? parseInt(quantity.value, 10) : null,
        acquired_year: acquiredYear.value !== "" ? parseInt(acquiredYear.value, 10) : null,
        hawl_start_date: hawlStart.value || null,
        is_personal_jewelry: ZK.JEWELRY_CATEGORIES.has(c) ? jewelry.checked : false,
        balance_as_of_date: c === "PF" ? (balanceAsOf.value || null) : null,
        monthly_contribution_employee: c === "PF" && empMonthly.value !== "" ? ZK.num(empMonthly.value) : null,
        monthly_contribution_employer: c === "PF" && erMonthly.value !== "" ? ZK.num(erMonthly.value) : null,
        annual_interest_rate: c === "PF" && annualRate.value !== "" ? ZK.num(annualRate.value) : null,
        image: imageData || null,
        image_filename: imageData ? (imageName || "image.png") : null,
      };
      const saved = existing ? Store.updateAsset(memberId, existing.id, data) : Store.addAsset(memberId, data);
      // Record a current-year value snapshot for tracked categories so trends &
      // yearly review reflect this balance (mirrors the server's on-create/update hook).
      if (saved && ZK.TRACKED_CATEGORIES.has(saved.category)) {
        const cy = ZK.todayUTC().getUTCFullYear();
        Store.setSnapshot(memberId, saved.id, cy, ZK.snapshotState(saved, cy));
      }
      closeModal(); refreshAll(); toast("Asset saved", "ok");
    } });

    openModal(existing ? "Edit asset" : "Add asset", body, [
      existing ? el("button", { class: "btn-ghost danger-text", text: "Delete", onclick: () => {
        closeModal();
        confirmDialog(
          "Delete asset",
          "Delete " + (existing.description || existing.category) + "?",
          () => { Store.deleteAsset(memberId, existing.id); refreshAll(); toast("Asset deleted"); },
          "Delete", true
        );
      } }) : null,
      el("button", { class: "btn secondary", text: "Cancel", onclick: closeModal }), save,
    ].filter(Boolean));
  }

  // Show/hide form field blocks (class-based so grid/layout cannot override).
  function show(node, visible) {
    if (!node) return;
    node.classList.toggle("field-hidden", !visible);
    node.querySelectorAll("input, select, textarea").forEach((inp) => { inp.disabled = !visible; });
  }

  function setPanelCollapsed(toggle, body, collapsed) {
    if (!toggle || !body) return;
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    body.dataset.collapsed = collapsed ? "true" : "false";
  }

  function setAllPanelsCollapsed(root, collapsed) {
    if (!root) return;
    root.querySelectorAll(".panel-collapse-toggle").forEach((toggle) => {
      const id = toggle.getAttribute("aria-controls");
      const body = id ? root.querySelector("#" + id) : toggle.nextElementSibling;
      if (body && body.classList.contains("panel-collapse-body")) {
        setPanelCollapsed(toggle, body, collapsed);
      }
    });
  }

  // --- Payment form ---
  function paymentForm(memberId, existing) {
    const given = el("input", { type: "text", value: existing ? existing.given_to || "" : "", placeholder: Help.t("ph_pay_given") });
    const amount = el("input", { type: "number", step: "0.01", value: existing && existing.amount_inr != null ? existing.amount_inr : "", placeholder: Help.t("ph_amount") });
    const body = el("form", null, [
      helpLangBar(),
      helpNode("pay_intro", "form-intro"),
      fieldK("Given to", given, "pay_given"),
      fieldK("Amount (" + curCode() + ")", amount, "pay_amount"),
    ]);
    const save = el("button", { class: "btn", text: existing ? "Save payment" : "Add payment", onclick: (e) => {
      e.preventDefault();
      if (!given.value.trim() || ZK.num(amount.value) <= 0) { toast("Enter recipient and amount", "err"); return; }
      if (existing) Store.updatePayment(memberId, existing.id, given.value, amount.value);
      else Store.addPayment(memberId, given.value, amount.value);
      closeModal(); refreshAll(); toast(existing ? "Payment updated" : "Payment added", "ok");
    } });
    openModal(existing ? "Edit Zakat payment" : "Record Zakat payment", body, [
      existing ? el("button", { class: "btn-ghost danger-text", text: "Delete", onclick: () => {
        closeModal();
        Store.deletePayment(memberId, existing.id);
        refreshAll(); toast("Payment deleted");
      } }) : null,
      el("button", { class: "btn secondary", text: "Cancel", onclick: closeModal }), save,
    ].filter(Boolean));
  }

  // --- Currency / language / school choosers (shared by welcome + Rates tab) ---

  // Apply a currency choice everywhere: store it, switch the money formatter,
  // re-render, and refetch metal rates in the new currency so the old
  // currency's numbers don't linger.
  function applyCurrencyChange(newCur) {
    Store.setCurrency(newCur);
    ZK.setDisplayCurrency(newCur);
    refreshAll();
    if (Rates) {
      toast("Currency set to " + newCur + " — updating metal rates…", "ok");
      Rates.fetchLiveRates(Store.getRates().diamond_inr_per_carat, newCur)
        .then((res) => {
          // Apply all-or-nothing: gold/silver/platinum must switch to the new
          // currency together, otherwise a metal that failed to fetch would keep
          // its old-currency number while being treated as the new currency —
          // silently corrupting nisab for whichever school/holding relies on it.
          if (res.ok) {
            const merged = Store.getRates();
            ["gold_inr_per_gram", "silver_inr_per_gram", "platinum_inr_per_gram"].forEach((k) => {
              merged[k] = Math.round(res.rates[k] * 100) / 100;
            });
            Store.setRates(merged);
            toast("Metal rates updated in " + newCur + " — verify against today's local rates", "ok");
          } else {
            toast("Couldn't fetch all metal rates in " + newCur + " — rates are still in the old currency; update gold, silver and platinum manually on Market Rates before trusting Nisab/eligibility", "err");
          }
          refreshAll();
        })
        .catch(() => {
          toast("Couldn't fetch rates in " + newCur + " — rates are still in the old currency; update gold, silver and platinum manually on Market Rates before trusting Nisab/eligibility", "err");
        });
    } else {
      toast("Currency set to " + newCur + " — update the metal rates manually", "ok");
    }
  }

  function currencySelectNode() {
    const cur = curCode();
    return el("select", null, ZK.CURRENCIES.map((c) =>
      el("option", { value: c[0], selected: c[0] === cur ? "selected" : null, text: c[0] + " — " + c[1] })));
  }

  function madhabSelectNode() {
    const madhab = Store.getMadhab();
    return el("select", null, Object.keys(ZK.MADHAB_RULES).map((k) =>
      el("option", { value: k, selected: k === madhab ? "selected" : null, text: ZK.MADHAB_RULES[k].label })));
  }

  // Sitewide language select — independent of currency. `afterChange` lets a
  // caller whose own markup lives outside the tab panels (e.g. the welcome
  // modal) re-translate its static labels too, since applyLanguageChange's
  // refreshAll() only rebuilds the active tab panel, not modal content.
  function helpLangSelectNode(afterChange) {
    if (!Help) return null;
    const langs = Help.availableLangs();
    const sel = el("select", null, langs.map((code) =>
      el("option", { value: code, selected: code === Help.effectiveLang() ? "selected" : null, text: Help.LANG_LABELS[code] })));
    sel.addEventListener("change", () => { applyLanguageChange(sel.value); if (afterChange) afterChange(); });
    return sel;
  }

  // Switch the sitewide language: persist it, re-translate the header/nav
  // chrome, and fully re-render the active tab so every visible string
  // (not just nodes bound via Help.bind) picks up the new language.
  function applyLanguageChange(code) {
    Help.setLang(code);
    renderChrome();
    refreshAll();
  }

  const NAV_LANG_KEYS = {
    dashboard: "nav_dashboard", analytics: "nav_analytics", yearly: "nav_yearly",
    rates: "nav_rates", backup: "nav_backup", guide: "nav_about",
  };

  // Re-translate the header chrome that lives outside the tab panels (page
  // title, nav labels) and isn't touched by refreshAll()'s tab re-render.
  function renderChrome() {
    if (!Help) return;
    const h1 = document.querySelector(".app-header h1");
    if (h1) h1.textContent = Help.t("app_title") || "Household Zakat Calculator";
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      const key = NAV_LANG_KEYS[btn.dataset.tab];
      if (key) btn.textContent = Help.t(key) || TAB_PAGE_TITLES[btn.dataset.tab] || btn.dataset.tab;
    });
    renderHeaderLangSelector();
  }

  // Persistent language picker mounted in the header — visible on every tab.
  function renderHeaderLangSelector() {
    const host = document.getElementById("header-lang");
    if (!host || !Help) return;
    clear(host);
    const sel = el("select", { class: "lang-select", "aria-label": Help.t("lang_field_label") || "Language" },
      Help.availableLangs().map((code) =>
        el("option", { value: code, selected: code === Help.effectiveLang() ? "selected" : null, text: Help.LANG_LABELS[code] })));
    sel.addEventListener("change", () => applyLanguageChange(sel.value));
    host.appendChild(sel);
  }

  // Resolve a supported currency from a geo-IP result ("" when none).
  function currencyFromLocation(loc) {
    if (loc.currency && ZK.isKnownCurrency(loc.currency)) return loc.currency;
    return ZK.currencyForRegion(loc.country);
  }

  // --- Rates ---
  function renderRates() {
    const panel = document.getElementById("tab-rates");
    clear(panel);
    const rates = Store.getRates();
    const madhab = Store.getMadhab();

    const mp = el("div", { class: "panel" });
    mp.appendChild(el("h2", { text: Help.t("school_panel_title") }));
    mp.appendChild(el("p", { class: "sub", text: Help.t("school_panel_sub") }));
    const madhabSel = el("select", null, Object.keys(ZK.MADHAB_RULES).map((k) => el("option", { value: k, selected: k === madhab ? "selected" : null, text: ZK.MADHAB_RULES[k].label })));
    madhabSel.addEventListener("change", () => { Store.setMadhab(madhabSel.value); toast(Help.t("toast_school_updated"), "ok"); refreshAll(); });
    mp.appendChild(field(Help.t("school_field_label"), madhabSel));
    const rateLangSel = helpLangSelectNode();
    if (rateLangSel) {
      mp.appendChild(field(Help.t("lang_field_label"), rateLangSel, Help.t("lang_field_help")));
    }
    panel.appendChild(mp);

    const rp = el("div", { class: "panel" });
    rp.appendChild(el("h2", { text: "Market rates" }));
    rp.appendChild(el("p", { class: "sub", html: "Enter rates manually, or fetch live spot prices from the internet. The app stays in your browser \u2014 fetching is optional and only happens when you click below." }));

    const cur = curCode();
    const curSel = currencySelectNode();
    curSel.addEventListener("change", () => applyCurrencyChange(curSel.value));
    rp.appendChild(field(Help.t("currency_label"), curSel));
    rp.appendChild(el("div", { class: "help", text: "Detected from your device's locale/location on first use \u2014 change it here if that guess is wrong. Changing it refetches today's metal rates in the new currency; asset values and diamond rates you entered are not converted." }));
    if (Rates && Rates.detectLocation) {
      const detectBtn = el("button", { class: "link", text: "Detect currency from my location" });
      detectBtn.addEventListener("click", (e) => {
        e.preventDefault();
        detectBtn.textContent = "Checking your location\u2026";
        detectBtn.disabled = true;
        Rates.detectLocation()
          .then((loc) => {
            const found = currencyFromLocation(loc);
            if (!found) { toast("Couldn't map " + (loc.countryName || loc.country || "your location") + " to a supported currency", "err"); return; }
            if (found === curCode()) { toast("Already using " + found + (loc.countryName ? " (" + loc.countryName + ")" : ""), "ok"); return; }
            applyCurrencyChange(found);
            toast("Location: " + (loc.countryName || loc.country) + " \u2014 currency set to " + found, "ok");
          })
          .catch(() => toast("Couldn't check your location \u2014 pick the currency manually", "err"))
          .finally(() => { detectBtn.textContent = "Detect currency from my location"; detectBtn.disabled = false; renderRates(); });
      });
      rp.appendChild(el("div", { class: "btn-row" }, detectBtn));
    }

    rp.appendChild(el("div", { class: "notice warn", text: "Live rates are wholesale spot prices converted from USD markets. They can differ from your local jeweller's or bank's rate for the day \u2014 please check today's metal prices in your area and update the values below if needed." }));

    const gold = el("input", { type: "number", step: "0.01", value: rates.gold_inr_per_gram });
    const silver = el("input", { type: "number", step: "0.01", value: rates.silver_inr_per_gram });
    const plat = el("input", { type: "number", step: "0.01", value: rates.platinum_inr_per_gram });
    const dia = el("input", { type: "number", step: "0.01", value: rates.diamond_inr_per_carat });
    const formNode = el("form", null, [
      el("div", { class: "field-row" }, [field("Gold (" + cur + "/gram, 24K)", gold), field("Silver (" + cur + "/gram)", silver)]),
      el("div", { class: "field-row" }, [field("Platinum (" + cur + "/gram)", plat), field("Diamond (" + cur + "/carat)", dia)]),
    ]);
    rp.appendChild(formNode);

    const sourceBox = el("div", { class: "rate-sources" });

    const fetchBtn = el("button", { class: "btn secondary", text: "Fetch live rates" });
    fetchBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!Rates) { toast("Live fetch unavailable", "err"); return; }
      const prev = fetchBtn.textContent;
      fetchBtn.disabled = true;
      fetchBtn.textContent = "Fetching\u2026";
      clear(sourceBox);
      Rates.fetchLiveRates(dia.value, curCode())
        .then((res) => {
          if (res.rates.gold_inr_per_gram > 0) gold.value = res.rates.gold_inr_per_gram.toFixed(2);
          if (res.rates.silver_inr_per_gram > 0) silver.value = res.rates.silver_inr_per_gram.toFixed(2);
          if (res.rates.platinum_inr_per_gram > 0) plat.value = res.rates.platinum_inr_per_gram.toFixed(2);
          renderRateSources(sourceBox, res);
          toast(res.ok ? "Live rates fetched \u2014 verify against today's local rates, then Save" : "Some rates couldn't be fetched", res.ok ? "ok" : "err");
        })
        .catch((err) => {
          clear(sourceBox);
          sourceBox.appendChild(el("div", { class: "notice warn", text: "Could not fetch live rates: " + err.message + ". Check your internet connection, or enter rates manually." }));
          toast("Live fetch failed", "err");
        })
        .finally(() => { fetchBtn.disabled = false; fetchBtn.textContent = prev; });
    });

    rp.appendChild(el("div", { class: "btn-row" }, [
      el("button", { class: "btn", text: "Save rates", onclick: (e) => {
        e.preventDefault();
        Store.setRates({ gold_inr_per_gram: gold.value, silver_inr_per_gram: silver.value, platinum_inr_per_gram: plat.value, diamond_inr_per_carat: dia.value });
        toast("Rates saved", "ok"); refreshAll();
      } }),
      fetchBtn,
    ]));

    const autoWrap = el("div", { class: "subpanel" });
    const autoChk = el("input", { type: "checkbox" });
    autoChk.checked = Store.getAutoRates();
    autoChk.addEventListener("change", () => {
      Store.setAutoRates(autoChk.checked);
      toast(autoChk.checked ? "Auto-fetch on load enabled" : "Auto-fetch on load disabled", "ok");
    });
    autoWrap.appendChild(el("label", { class: "checkbox-field" }, [autoChk, el("span", { text: " Automatically fetch today's live metal rates each time the app loads" })]));
    autoWrap.appendChild(el("div", { class: "help", text: "On by default. Only today's gold/silver/platinum spot rates refresh on startup (diamond stays manual). Historical yearly rates are never touched on load — they update only when you click “Update historical rates” below. Turn off to stay fully offline." }));
    rp.appendChild(autoWrap);

    rp.appendChild(sourceBox);
    panel.appendChild(rp);

    panel.appendChild(renderYearlyRatesPanel());
    panel.appendChild(renderRatesGraphPanel());
  }

  // --- Historical / yearly rates ---
  function renderYearlyRatesPanel() {
    const panel = el("div", { class: "panel" });
    panel.appendChild(el("h2", { text: "Historical / yearly rates" }));
    panel.appendChild(el("p", { class: "sub", html: "Per-year metal rates for year-by-year valuation. Gold &amp; the USD exchange rate are fetched from the internet; silver/platinum are estimated in-browser (edit to override). Used when an asset is valued as of a past year. <strong>These update only when you click the button below — never on page load.</strong>" }));

    const now = ZK.todayUTC().getUTCFullYear();
    const startIn = el("input", { type: "number", step: "1", value: now - 5 });
    const endIn = el("input", { type: "number", step: "1", value: now });
    const histBox = el("div", { class: "rate-sources", id: "hist-warnings" });

    const fetchBtn = el("button", { class: "btn secondary", text: "Update historical rates" });
    fetchBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!History) { toast("Historical fetch unavailable", "err"); return; }
      const prev = fetchBtn.textContent;
      fetchBtn.disabled = true; fetchBtn.textContent = "Fetching\u2026";
      clear(histBox);
      History.fetchHistoricalRates(startIn.value, endIn.value, Store.getRates(), curCode())
        .then((res) => {
          const existing = {};
          Store.yearlyRates().forEach((r) => { existing[r.year] = r; });
          let updated = 0, kept = 0;
          Object.keys(res.ratesByYear).forEach((y) => {
            const yr = parseInt(y, 10);
            if (existing[yr] && existing[yr].is_user_override) { kept++; return; } // never clobber manual years
            Store.setYearlyRate(yr, res.ratesByYear[y], { is_estimated: true, is_user_override: false, rate_source: "internet" });
            updated++;
          });
          toast(updated
            ? "Updated " + updated + " year(s)" + (kept ? " \u00b7 kept " + kept + " manual override(s)" : "")
            : (kept ? "All " + kept + " year(s) are manual overrides \u2014 nothing changed" : "No years fetched"),
            updated || kept ? "ok" : "err");
          renderRates();
          // renderRates() rebuilt the panel \u2014 attach warnings to the fresh box
          const freshBox = document.getElementById("hist-warnings") || histBox;
          (res.warnings || []).forEach((w) => freshBox.appendChild(el("div", { class: "notice warn", text: w })));
        })
        .catch((err) => { histBox.appendChild(el("div", { class: "notice warn", text: "Fetch failed: " + err.message })); toast("Historical fetch failed", "err"); })
        .finally(() => { fetchBtn.disabled = false; fetchBtn.textContent = prev; });
    });

    panel.appendChild(el("div", { class: "field-row" }, [field("From year", startIn), field("To year", endIn)]));
    panel.appendChild(el("div", { class: "btn-row" }, fetchBtn));
    panel.appendChild(histBox);

    // Existing yearly rows
    const rows = Store.yearlyRates().slice().sort((a, b) => b.year - a.year);
    if (rows.length) {
      const trs = rows.map((r) => {
        const g = el("input", { type: "number", step: "0.01", value: r.gold_inr_per_gram, style: "max-width:110px" });
        const s = el("input", { type: "number", step: "0.01", value: r.silver_inr_per_gram, style: "max-width:100px" });
        const p = el("input", { type: "number", step: "0.01", value: r.platinum_inr_per_gram, style: "max-width:110px" });
        const d = el("input", { type: "number", step: "0.01", value: r.diamond_inr_per_carat, style: "max-width:120px" });
        const srcPill = el("span", { class: "pill " + (r.is_user_override ? "green" : "gray"), text: r.is_user_override ? "manual" : (r.is_estimated ? "estimated" : (r.rate_source || "internet")) });
        const saveBtn = el("button", { class: "link", text: "Save", onclick: () => {
          Store.setYearlyRate(r.year, { gold_inr_per_gram: g.value, silver_inr_per_gram: s.value, platinum_inr_per_gram: p.value, diamond_inr_per_carat: d.value }, { is_estimated: false, is_user_override: true, rate_source: "manual" });
          toast("Saved " + r.year, "ok"); renderRates();
        } });
        const delBtn = el("button", { class: "link", style: "color:#dc2626", text: "Delete", onclick: () => { Store.deleteYearlyRate(r.year); toast("Deleted " + r.year); renderRates(); } });
        return el("tr", null, [
          el("td", null, el("strong", { text: String(r.year) })),
          el("td", { class: "num" }, g), el("td", { class: "num" }, s),
          el("td", { class: "num" }, p), el("td", { class: "num" }, d),
          el("td", null, srcPill),
          el("td", { class: "num" }, [saveBtn, document.createTextNode("  "), delBtn]),
        ]);
      });
      const thead = el("thead", null, el("tr", null, [th("Year"), th("Gold /g", true), th("Silver /g", true), th("Platinum /g", true), th("Diamond /ct", true), th("Source"), th("", true)]));
      panel.appendChild(el("div", { class: "table-wrap" }, sortable(el("table", null, [thead, el("tbody", null, trs)]))));
    } else {
      panel.appendChild(el("div", { class: "empty", text: "No yearly rates yet. Fetch a range above, or add a year manually below." }));
    }

    // Manual add-year row
    const yIn = el("input", { type: "number", step: "1", value: now });
    const yg = Help.bindPh(el("input", { type: "number", step: "0.01" }), "ph_rate_gold");
    const ys = Help.bindPh(el("input", { type: "number", step: "0.01" }), "ph_rate_silver");
    const yp = Help.bindPh(el("input", { type: "number", step: "0.01" }), "ph_rate_platinum");
    const yd = Help.bindPh(el("input", { type: "number", step: "0.01" }), "ph_rate_diamond");
    const addBtn = el("button", { class: "btn secondary", text: "Add / update year", onclick: (e) => {
      e.preventDefault();
      const yr = parseInt(yIn.value, 10);
      if (!yr) { toast("Enter a year", "err"); return; }
      Store.setYearlyRate(yr, { gold_inr_per_gram: yg.value, silver_inr_per_gram: ys.value, platinum_inr_per_gram: yp.value, diamond_inr_per_carat: yd.value }, { is_estimated: false, is_user_override: true, rate_source: "manual" });
      toast("Saved " + yr, "ok"); renderRates();
    } });
    const addWrap = el("div", { class: "subpanel" });
    addWrap.appendChild(el("div", { class: "member-section-title", text: "Add a year manually" }));
    addWrap.appendChild(el("div", { class: "field-row" }, [field("Year", yIn), field("Gold /g", yg), field("Silver /g", ys)]));
    addWrap.appendChild(el("div", { class: "field-row" }, [field("Platinum /g", yp), field("Diamond /ct", yd)]));
    addWrap.appendChild(el("div", { class: "btn-row" }, addBtn));
    panel.appendChild(addWrap);

    return panel;
  }

  function renderRateSources(box, res) {
    clear(box);
    box.appendChild(el("p", { class: "sub", text: "Fetched " + res.fetched_at.toLocaleString() + (res.usd_inr && res.currency !== "USD" ? " \u00b7 USD/" + (res.currency || "INR") + " " + res.usd_inr.toFixed(2) : "") + ". Click Save rates to apply." }));
    const order = ["gold_inr_per_gram", "silver_inr_per_gram", "platinum_inr_per_gram", "diamond_inr_per_carat"];
    const ul = el("ul", { class: "source-list" });
    order.forEach((k) => {
      if (res.sources[k]) ul.appendChild(el("li", { text: res.sources[k] }));
    });
    box.appendChild(ul);
    (res.warnings || []).forEach((w) => box.appendChild(el("div", { class: "notice warn", text: w })));
  }

  function welcomeBenefits(items) {
    const ul = el("ul", { class: "welcome-benefits" });
    items.forEach((t) => ul.appendChild(el("li", { text: t })));
    return ul;
  }

  function welcomeChoiceCard(value, title, benefits) {
    const card = el("button", {
      type: "button",
      class: "welcome-choice",
      "data-choice": value,
    }, [
      el("span", { class: "welcome-choice-title", text: title }),
      welcomeBenefits(benefits),
    ]);
    return card;
  }

  // --- Welcome: pick one data source (no Drive auth until user chooses Drive) ---
  function showWelcomeModal(onDone) {
    let selected = null;
    const drivePath = Drive ? Drive.folderPathLabel() + "zakaat_&lt;mon&gt;_&lt;year&gt;.xlsx" : "MY_FAMILY/ZAKAAT/";

    const actionPanel = el("div", { class: "welcome-action hidden" });
    const fileInput = el("input", { type: "file", accept: ".xlsx", style: "display:none" });
    fileInput.addEventListener("change", () => {
      if (fileInput.files[0]) importBackupFile(fileInput.files[0], onDone);
    });

    const driveStatus = el("div", { class: "notice compact warn", text: "Google will ask you to sign in once so this app can read your backup folder only — not your entire Drive." });
    const driveSelect = el("select");
    driveSelect.appendChild(el("option", { value: "", text: "Sign in to see backups" }));
    driveSelect.disabled = true;
    const driveSignInBtn = el("button", { class: "btn block", text: "Sign in with Google" });
    const driveOpenBtn = el("button", { class: "btn block", text: "Open selected backup", disabled: "disabled" });
    const welcomeDriveHelp = el("div", { class: "drive-help-host" });

    function loadDriveBackups() {
      if (!Drive) return Promise.resolve();
      driveSelect.innerHTML = "";
      driveSelect.disabled = true;
      driveOpenBtn.disabled = true;
      driveSelect.appendChild(el("option", { value: "", text: "Loading backups\u2026" }));
      return Drive.listBackups()
        .then((files) => {
          driveSelect.innerHTML = "";
          if (!files.length) {
            driveSelect.appendChild(el("option", { value: "", text: "No backups found on Drive" }));
            driveStatus.className = "notice compact warn";
            driveStatus.textContent = "No backups in " + Drive.folderPathLabel() + " yet. Start fresh and upload from the Backup tab.";
            return;
          }
          files.forEach((f) => {
            const label = f.name + (f.modifiedTime ? " \u2014 " + new Date(f.modifiedTime).toLocaleString() : "");
            driveSelect.appendChild(el("option", { value: f.name, text: label }));
          });
          driveSelect.disabled = false;
          driveOpenBtn.disabled = false;
          driveStatus.className = "notice compact ok";
          driveStatus.textContent = "Signed in. Only files this app created in " + Drive.folderPathLabel() + " are shown.";
        })
        .catch((e) => {
          driveSelect.innerHTML = "";
          driveSelect.appendChild(el("option", { value: "", text: "Could not list backups" }));
          driveStatus.className = "notice compact err";
          driveStatus.textContent = e.message || "Could not reach Google Drive.";
        });
    }

    driveSignInBtn.addEventListener("click", () => {
      if (!Drive) { toast("Drive module not loaded", "err"); return; }
      connectDriveInteractive({
        button: driveSignInBtn,
        busyLabel: "Signing in\u2026",
        helpHost: welcomeDriveHelp,
        onSuccess: () => {
          driveSignInBtn.style.display = "none";
          return loadDriveBackups();
        },
      })
        .catch((e) => { if (!Drive.isPopupBlockedError(e)) toast(e.message || String(e), "err"); });
    });
    document.addEventListener("zk-drive-connected", () => {
      if (Drive && Drive.isConnected()) driveSignInBtn.style.display = "none";
    }, { once: false });

    driveOpenBtn.addEventListener("click", () => {
      const fileName = driveSelect.value;
      if (!fileName) { toast("Choose a backup file", "err"); return; }
      const isJson = /\.json$/i.test(fileName);
      driveOpenBtn.disabled = true;
      const openOp = isJson
        ? Drive.restoreFromStateJson(fileName).then((res) => {
            closeModal();
            if (typeof onDone === "function") onDone();
            refreshAll();
            toast("Restored from JSON snapshot: " + res.fileName, "ok");
          })
        : Drive.restore(fileName).then((res) => {
            closeModal();
            if (typeof onDone === "function") onDone();
            refreshAll();
            toast("Opened " + res.counts.members + " member(s) from " + res.fileName, "ok");
          });
      openOp
        .catch((e) => toast(e.message || String(e), "err"))
        .finally(() => { driveOpenBtn.disabled = !driveSelect.value; });
    });

    const choices = el("div", { class: "welcome-choices" }, [
      welcomeChoiceCard("local", "Open Excel from this device", [
        "Works offline — no Google account needed.",
        "You keep the file wherever you save it (Downloads, USB, email).",
        "Fastest if you already exported a .xlsx backup.",
      ]),
      welcomeChoiceCard("drive", "Open from Google Drive", [
        "Same household data on phone, tablet, and desktop.",
        "Optional auto-save after each edit — nothing stored on our servers.",
        "Monthly files in your folder at " + (Drive ? Drive.folderPathLabel() : "MY_FAMILY/ZAKAAT/") + " — only files this app creates.",
      ]),
      welcomeChoiceCard("fresh", "Start a new household", [
        "Add family members and assets from scratch.",
        "Export or connect Drive later from the Backup tab.",
        "Good if this is your first time tracking Zakat here.",
      ]),
    ]);

    function renderAction() {
      clear(actionPanel);
      actionPanel.classList.remove("hidden");
      if (selected === "local") {
        actionPanel.appendChild(el("p", { class: "help", text: "Choose a .xlsx backup from this app or the server version." }));
        actionPanel.appendChild(fileInput);
        actionPanel.appendChild(el("button", {
          class: "btn block",
          text: "Choose Excel file",
          onclick: () => fileInput.click(),
        }));
      } else if (selected === "drive") {
        actionPanel.appendChild(el("p", { class: "help", html: "Backups live at <code>" + drivePath + "</code>. Sign in only when you pick this option." }));
        actionPanel.appendChild(driveStatus);
        actionPanel.appendChild(driveSignInBtn);
        actionPanel.appendChild(field("Backup file", driveSelect));
        actionPanel.appendChild(driveOpenBtn);
        welcomeDriveHelp.innerHTML = "";
        welcomeDriveHelp.appendChild(drivePopupHelpPanel(false));
        actionPanel.appendChild(welcomeDriveHelp);
      } else if (selected === "fresh") {
        const familyInput = el("input", {
          type: "text",
          placeholder: Help.t("ph_family_name"),
          maxlength: "64",
          autocomplete: "family-name",
        });
        actionPanel.appendChild(el("p", { class: "help", text: "Add your family name to begin — it labels this household on screen, in backups, and in reports." }));
        actionPanel.appendChild(field("Family name (required)", familyInput, "Family or surname only — for example SMY FAMILY."));
        actionPanel.appendChild(el("button", {
          class: "btn block",
          text: "Start with empty household",
          onclick: () => {
            const saved = saveFamilyName(familyInput.value, "welcome");
            if (!saved) { toast("Enter your family name to continue", "err"); familyInput.focus(); return; }
            closeModal();
            if (typeof onDone === "function") onDone();
          },
        }));
      }
    }

    choices.querySelectorAll(".welcome-choice").forEach((card) => {
      card.addEventListener("click", () => {
        selected = card.dataset.choice;
        choices.querySelectorAll(".welcome-choice").forEach((c) => {
          c.classList.toggle("selected", c === card);
        });
        renderAction();
      });
    });

    // --- Region & preferences: shown on the very first screen so newcomers
    // pick currency, help language and school without hunting for the Rates
    // tab (the same controls stay available there too). ---
    const prefCur = currencySelectNode();
    const prefLangWrap = el("span", { class: "pref-lang-wrap" });
    const prefMadhab = madhabSelectNode();
    let curTouched = false;

    const prefsTitle = el("div", { class: "welcome-prefs-title", text: Help.t("prefs_title") });
    const curField = field(Help.t("currency_label"), prefCur);
    const langLabelNode = el("label", { text: Help.t("lang_field_label") });
    const schoolField = field(Help.t("school_field_label"), prefMadhab);

    // This modal isn't part of a tab panel, so applyLanguageChange's
    // refreshAll() won't touch it — re-translate its own labels here.
    function refreshWelcomePrefsChrome() {
      prefsTitle.textContent = Help.t("prefs_title");
      const curLabel = curField.querySelector("label");
      if (curLabel) curLabel.textContent = Help.t("currency_label");
      langLabelNode.textContent = Help.t("lang_field_label");
      const schoolLabel = schoolField.querySelector("label");
      if (schoolLabel) schoolLabel.textContent = Help.t("school_field_label");
    }

    function renderPrefLang() {
      clear(prefLangWrap);
      const sel = helpLangSelectNode(refreshWelcomePrefsChrome);
      if (sel) prefLangWrap.appendChild(sel);
    }
    renderPrefLang();

    prefCur.addEventListener("change", () => {
      curTouched = true;
      applyCurrencyChange(prefCur.value);
      renderPrefLang();
    });
    prefMadhab.addEventListener("change", () => { Store.setMadhab(prefMadhab.value); refreshAll(); });

    const detectNote = el("div", { class: "help", text: "Guessed from your device — checking your location…" });
    const prefsPanel = el("div", { class: "welcome-prefs" }, [
      prefsTitle,
      el("div", { class: "field-row3" }, [
        curField,
        el("div", { class: "field" }, [langLabelNode, prefLangWrap]),
        schoolField,
      ]),
      detectNote,
    ]);

    if (Rates && Rates.detectLocation) {
      Rates.detectLocation()
        .then((loc) => {
          const found = currencyFromLocation(loc);
          const where = loc.countryName || loc.country || "your location";
          if (!found) { detectNote.textContent = "Location: " + where + " — keeping " + curCode() + ". Change it above if needed."; return; }
          if (!curTouched && found !== curCode()) {
            prefCur.value = found;
            applyCurrencyChange(found);
            renderPrefLang();
          }
          detectNote.textContent = "Detected from your location: " + where + " → " + found + ". Change it above if that's wrong.";
        })
        .catch(() => { detectNote.textContent = "Couldn't check your location — pick your currency above."; });
    } else {
      detectNote.textContent = "Guessed from your device's locale — change it above if that's wrong.";
    }

    const body = el("div", { class: "welcome-body" }, [
      el("p", {
        class: "sub",
        text: "Your Zakat data stays in this browser until you choose to open or back up a file. Pick how you would like to begin — Google Drive is only used if you select that option.",
      }),
      prefsPanel,
      choices,
      actionPanel,
    ]);

    openModal("How would you like to start?", body, [], { dismissible: false, wide: true });
  }

  // --- Backup tab (export, sync, replace) ---
  function renderBackup() {
    // Pre-warm SheetJS so it's ready before the user clicks Download.
    if (Excel && Excel.loadXlsx) Excel.loadXlsx();
    const panel = document.getElementById("tab-backup");
    clear(panel);

    // Full-width action button with icon + title
    function aBtn(cls, icon, title, onclick) {
      return el("button", { class: "btn block backup-action-btn " + cls, onclick: onclick }, [
        el("span", { class: "backup-btn-icon", text: icon }),
        el("span", { class: "backup-btn-body" }, [
          el("span", { class: "backup-btn-title", text: title }),
        ]),
      ]);
    }

    // ── 1. Backup panel (local + Drive in one card) ──────────────────────────────────────────
    const savePanel = el("div", { class: "panel" });
    savePanel.appendChild(el("h2", { text: Help.t("bkp_title") }));
    savePanel.appendChild(el("div", { class: "backup-btn-stack" }, [
      aBtn("", "\ud83d\udce5", Help.t("bkp_download_device"), () => {
        Excel.exportBackup().then(() => { toast("Backup downloaded", "ok"); }).catch((e) => toast("Export failed: " + e.message, "err"));
      }),
      aBtn("secondary", "\ud83d\udcc4", Help.t("bkp_download_report"), () => {
        Excel.exportReport().then(() => { toast("Report downloaded", "ok"); }).catch((e) => toast("Export failed: " + e.message, "err"));
      }),
    ]));
    savePanel.appendChild(renderDriveSection());
    panel.appendChild(savePanel);

    // ── 2. Restore panel ──────────────────────────────────────────────────────────
    const restorePanel = el("div", { class: "panel" });
    restorePanel.appendChild(el("h2", { text: Help.t("bkp_restore_title") }));
    restorePanel.appendChild(el("div", { class: "backup-btn-stack" }, [
      aBtn("", "\ud83d\udcc2", Help.t("bkp_from_excel"), replaceFromExcelFile),
      aBtn("secondary", "\u2601\ufe0f", Help.t("bkp_from_drive"), replaceFromDriveBackup),
    ]));
    panel.appendChild(restorePanel);

    // ── 3. Clear — subtle ghost link, no full panel ──────────────────────────────────────────
    const dangerRow = el("div", { class: "backup-danger-row" });
    dangerRow.appendChild(el("button", {
      class: "btn-ghost sm danger-text",
      text: Help.t("bkp_clear"),
      onclick: () => confirmDialog("Clear all data", "Permanently deletes all members, assets, payments and rates. Continue?", () => {
        Store.clearAll(); refreshAll(); toast("All data cleared"); showWelcomeModal(() => refreshAll());
      }, "Clear everything", true),
    }));
    panel.appendChild(dangerRow);
  }

  // --- Google Drive section (embedded inside the Backup panel) ---
  function renderDriveSection() {
    const section = el("div", { class: "subpanel" });

    if (!Drive) {
      section.appendChild(el("div", { class: "notice err", text: "Drive module not loaded." }));
      return section;
    }

    const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

    // Compact header row: label on left, status dot + text on right
    const statusDot = el("span", { class: "drive-status-dot warn" });
    const statusLabel = el("span", { class: "drive-status-label" });

    function setStatus() {
      const connected = Drive.isConnected();
      const lastFile = Drive.getLastFileName();
      const last = Drive.getLastSync();
      statusDot.className = "drive-status-dot " + (connected ? "ok" : "warn");
      statusLabel.textContent = connected
        ? (lastFile ? lastFile + (last ? " · " + new Date(last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "") : "Connected")
        : Help.t("bkp_not_connected");
    }

    section.appendChild(el("div", { class: "drive-section-header" }, [
      el("span", { class: "drive-section-title", text: Help.t("bkp_drive_label") }),
      el("div", { class: "drive-status-line" }, [statusDot, statusLabel]),
    ]));

    // Buttons
    // driveHelpHost starts empty — revealDrivePopupHelp() appends the panel
    // lazily only when a popup-blocked error actually occurs.
    const driveHelpHost = el("div", { class: "drive-help-host" });

    const connectBtn = el("button", { class: "btn block backup-action-btn" }, [
      el("span", { class: "backup-btn-icon", text: "\ud83d\udd17" }),
      el("span", { class: "backup-btn-body" }, [el("span", { class: "backup-btn-title", text: Help.t("bkp_connect") })]),
    ]);
    const uploadBtn = el("button", { class: "btn secondary block backup-action-btn" }, [
      el("span", { class: "backup-btn-icon", text: "\u2601\ufe0f" }),
      el("span", { class: "backup-btn-body" }, [el("span", { class: "backup-btn-title", text: Help.t("bkp_upload_now") })]),
    ]);
    const disconnectBtn = el("button", { class: "btn-ghost sm danger-text", text: Help.t("bkp_disconnect") });

    // Auto-save toggle + disconnect on one compact row
    const autoChk = el("input", { type: "checkbox" });
    autoChk.checked = Drive.getAutoSync();
    autoChk.addEventListener("change", () => {
      Drive.setAutoSync(autoChk.checked);
      toast(autoChk.checked ? "Auto-save enabled" : "Auto-save disabled", "ok");
    });
    const autoRow = el("div", { class: "drive-auto-row" }, [
      el("label", { class: "drive-auto-label" }, [autoChk, el("span", { text: " " + Help.t("bkp_auto_save") })]),
      disconnectBtn,
    ]);

    function refreshButtons() {
      const connected = Drive.isConnected();
      const titleEl = connectBtn.querySelector(".backup-btn-title");
      if (titleEl) titleEl.textContent = connected ? Help.t("bkp_reconnect") : Help.t("bkp_connect");
      uploadBtn.style.display = connected ? "" : "none";
      autoRow.style.display = connected ? "" : "none";
    }

    function busy(btn, label, fn) {
      const titleEl = btn.querySelector(".backup-btn-title");
      const prev = titleEl ? titleEl.textContent : btn.textContent;
      btn.disabled = true;
      if (titleEl) titleEl.textContent = label;
      else btn.textContent = label;
      return Promise.resolve().then(fn)
        .catch((e) => toast(e.message || String(e), "err"))
        .finally(() => {
          btn.disabled = false;
          if (titleEl) titleEl.textContent = prev;
          else btn.textContent = prev;
          setStatus(); refreshButtons();
        });
    }

    connectBtn.addEventListener("click", () =>
      connectDriveInteractive({
        button: connectBtn, busyLabel: "Connecting\u2026", helpHost: driveHelpHost,
        onSuccess: () => Drive.maybeSyncMonthRollover().catch(() => false).then(() => {
          setStatus(); refreshButtons(); toast("Connected to Google Drive", "ok");
        }),
      }).catch((e) => { if (!Drive.isPopupBlockedError(e)) toast(e.message || String(e), "err"); })
    );
    uploadBtn.addEventListener("click", () =>
      busy(uploadBtn, "Uploading\u2026", () =>
        Drive.backup().then((res) => { toast("Backed up to " + res.path, "ok"); })
      )
    );
    disconnectBtn.addEventListener("click", () => { Drive.disconnect(); toast("Disconnected"); setStatus(); refreshButtons(); });

    const btnStack = el("div", { class: "backup-btn-stack" });
    btnStack.appendChild(connectBtn);
    btnStack.appendChild(uploadBtn);
    section.appendChild(btnStack);
    section.appendChild(autoRow);
    section.appendChild(driveHelpHost);

    // Web-only: setup help accordion for local dev
    if (!isNative) {
      const setupHtml = "1. <em>Credentials \u2192 Web client \u2192 Authorized JavaScript origins</em>: <code>" + Drive.getPageOrigin() + "</code><br>" +
        "2. <em>OAuth consent screen \u2192 Test users</em> \u2192 add each Gmail.";
      section.appendChild(el("details", { class: "setup-details" }, [
        el("summary", { text: Help.t("bkp_drive_setup") }),
        el("div", { class: "setup-body", html: setupHtml }),
      ]));
    }

    setStatus(); refreshButtons();
    return section;
  }

  // Legacy wrapper kept for any callers outside renderBackup
  function renderDrivePanel() {
    const p = el("div", { class: "panel" });
    p.appendChild(el("h2", { text: "Google Drive sync" }));
    p.appendChild(renderDriveSection());
    return p;
  }

    // --- Guide & FAQ (ported from zakat_guide.html / zakat_faq.html) ---
  let guideView = "guide"; // "guide" | "faq"

  // Body text per language for each guide section and FAQ answers.
  // Sections with dynamic values receive them via function arguments.
  // Falls back to "en" for any unregistered language.
  const GUIDE_CONTENT = {
    en: {
      app_p1: "Household Zakat calculator for families: add <strong>family members</strong>, record <strong>assets</strong> in your currency, set <strong>market rates</strong>, and see <strong>due, paid, and remaining</strong> on the dashboard. On first open, choose an Excel backup from your computer or Google Drive. The <strong>Backup</strong> tab handles export and Drive sync. Everything runs in your browser; data stays on your device.",
      app_ul: "<li><strong>Not a fatwa</strong> — confirm with your scholar.</li><li><strong>2.5%</strong> on zakatable wealth at/above nisab; madhhab rules for jewelry and debts.</li><li><strong>Zakat baseline:</strong> first Friday of Ramadan (shown in the header).</li>",
      what_p1: "<strong>Zakat</strong> is the obligatory annual charity on surplus wealth held for one lunar year — the third pillar of Islam. Unlike voluntary <em>sadaqah</em>, it is a fixed right of the poor once wealth reaches <em>nisab</em> (نصاب).",
      what_p2: "Recipients are named in the Qur’an (9:60): poor, needy, collectors, those whose hearts are reconciled, captives, debtors, in Allah’s cause, and stranded travellers.",
      when_ul: function(nisabLine, jewelryLine, debtLine, rulesLabel) {
        return "<li><strong>Hawl:</strong> ~354 lunar days of possession — set <strong>Hawl start</strong> on each asset.</li>" +
          "<li><strong>Rate:</strong> <strong>2.5%</strong> (one-fortieth) when total zakatable wealth ≥ nisab.</li>" +
          "<li><strong>Nisab (" + rulesLabel + "):</strong> " + nisabLine + ". Change school on the Market Rates tab.</li>" +
          "<li><strong>Jewelry:</strong> " + jewelryLine + "</li>" +
          "<li><strong>Yearly, not monthly:</strong> enter <strong>total cash</strong> on your Zakat date — not 2.5% on each salary or rent cheque.</li>" +
          "<li><strong>Zakat al-Fitr</strong> is separate and not calculated here.</li>";
      },
      calc_sub: "Per-member assets → values at baseline date → nisab check → rates → minus payments.",
      calc_th: ["Type", "In this app"],
      calc_rows: function(debtLine) { return [
        ["Gold / silver / platinum / diamond", "Grams or market value → share of <strong>2.5%</strong> when above nisab"],
        ["Cash / PF / stocks / business", "<strong>2.5% yearly</strong> on balances (PF projected from statement + contributions)"],
        ["Property", "Home/rental building exempt; <strong>for sale</strong> → 2.5% on market value; rent → <strong>Cash</strong>"],
        ["Livestock / agriculture / rikaz", "Sunnah tiers / harvest % / <strong>20% once</strong> for rikaz"],
        ["Liabilities", debtLine],
        ["Remaining", "Due − payments"],
      ]; },
      calc_rate_note: function(g, s) { return "Session rates until you fetch: gold " + g + "/g, silver " + s + "/g."; },
      schools_sub: function(label) { return "Current: <strong>" + label + "</strong> (change on the Market Rates tab)."; },
      schools_th: ["Rule", ""],
      schools_r_nisab: "Nisab", schools_r_jewelry: "Worn jewelry", schools_r_debts: "Debts",
      schools_v_silver: "Silver", schools_v_gold: "Gold",
      schools_v_exempt: "Can exempt", schools_v_allgold: "All gold/silver",
      schools_v_none: "None", schools_v_cash: "Cash only", schools_v_full: "Full",
      using_ol: "<li><strong>Dashboard</strong> — rates summary, household totals, members &amp; assets.</li><li><strong>Analytics</strong> — wealth/Zakat over time and per-component breakdown.</li><li><strong>Yearly Review</strong> — record what each asset was worth in past years.</li><li><strong>Market Rates</strong> — school selector, manual/live rates, yearly history.</li><li><strong>Backup &amp; Restore</strong> — Excel export/report, Google Drive auto-save, and replace from file or Drive.</li>",
      disclaimer_p: "Educational tool only. Confirm amounts and recipients with a <strong>qualified scholar</strong>. Market rates are indicative.",
      faq_a: function(rules, debtAns, jewelryAns) { return [
        "<strong>No.</strong> It is a household calculator with scholar-reviewed defaults. Confirm with a qualified scholar before paying.",
        "The minimum zakatable wealth before Zakat is due. This app uses gold or silver weights × rates per your <strong>" + rules.label + "</strong> setting.",
        "Usually: below <strong>nisab</strong>; still in <strong>hawl</strong>; property is <strong>personal/rental</strong>; jewelry marked <strong>personal adornment</strong> (where exempt); or values not entered yet.",
        "<strong>Today’s market value</strong> for cash, shares, trade property, and metals. Zakat is on what wealth is worth at your Zakat date, not original cost.",
        "<strong>No</strong> on the building — <strong>Property → Personal residence</strong>. It may show on Analytics for records but is excluded from Zakat.",
        "Two <strong>Property</strong> assets: <strong>Personal residence</strong> for your home, <strong>Rental</strong> or <strong>For sale / trade</strong> for the other. Rent received → <strong>Cash</strong>.",
        "Use <strong>current market value</strong>, subtype <strong>trade</strong>, hawl from purchase. Bought ₹1L, now ₹7L → enter <strong>₹7L</strong>; Zakat ≈ 2.5% of ₹7L if above nisab — not 2.5% of “profit” only.",
        "~<strong>354 lunar days</strong> of owning zakatable wealth. Set <strong>Hawl start</strong> when you received or bought the asset. Wealth still in hawl is excluded until the year completes.",
        "Many families use <strong>Ramadan</strong>. This app’s baseline is the <strong>first Friday of Ramadan</strong> (Umm al-Qura); the header shows today and that baseline.",
        "<strong>Yearly</strong> — once per lunar year, not monthly. Cash: total you still hold on your Zakat date × 2.5% if above nisab. Rent: building exempt; rent you keep → <strong>Cash</strong>.",
        jewelryAns,
        "<strong>Rikaz (ركاز)</strong> is buried treasure or wealth your scholar rules as rikaz — not salary, FD, or shares. This app: <strong>20% once</strong>, not 2.5% yearly. Use category <strong>Rikaz</strong>.",
        "<strong>Zakat</strong> — fixed right on surplus wealth. <strong>Sadaqah</strong> — voluntary. <strong>Zakat al-Fitr</strong> — end of Ramadan per person; <strong>not</strong> in this calculator.",
        "Add <strong>Liabilities</strong>. With <strong>" + rules.label + "</strong>: " + debtAns + " Home loans are not auto-linked to property — ask your scholar.",
        "<strong>What remains in the bank</strong> on your Zakat date. Salary already spent on living costs is not zakatable.",
        "<strong>PF / EPF:</strong> category <strong>PF</strong> — statement balance, as-of date, monthly contributions, projected balance (default 8.25% p.a.). <strong>Funds / shares:</strong> <strong>Stocks</strong> with current total value.",
        "The dashboard shows the <strong>current year</strong>. Use <strong>Yearly Review</strong> to record past-year balances so Analytics reflects them, and calculate any owed back-Zakat with your scholar.",
        "Per member → <strong>+ Payment</strong>: recipient and amount. <strong>Remaining</strong> = due − paid.",
        "Qur’an 9:60: poor, needy, collectors, hearts reconciled, captives, debtors, in Allah’s cause, stranded travellers. Your scholar can guide eligible recipients.",
        "Many calculators use gold nisab only. <strong>Hanafi</strong> often compares <strong>all combined wealth</strong> to <strong>silver nisab</strong> (lower bar). This app follows that when Hanafi is selected.",
        "On first visit, pick a backup from your computer or Google Drive. Later, use the <strong>Backup &amp; Restore</strong> tab to download Excel, auto-save to <strong>MY_FAMILY/ZAKAAT/zakaat_&lt;mon&gt;_&lt;year&gt;.xlsx</strong>, or replace from another file.",
        "Set <strong>Acquired year</strong> and record balances over time in <strong>Yearly Review</strong>; metals use yearly rates.",
        "<strong>Yes.</strong> Add multiple <strong>Family members</strong>; Zakat is computed per person and summed on the dashboard.",
      ]; },
    },

    ur: {
      app_p1: "گھرانے کا زکات کیلکولیٹر: <strong>خاندان کے افراد</strong> شامل کریں، اپنی کرنسی میں <strong>اثاثے</strong> ریکارڈ کریں، <strong>مارکیٹ ریٹ</strong> مقرر کریں، اور ڈیش بورڈ پر <strong>واجب، ادا شدہ، اور باقی</strong> رقم دیکھیں۔ پہلی بار کھولنے پر کمپیوٹر یا گوگل ڈرائیو سے بیک اپ منتخب کریں۔ <strong>بیک اپ</strong> ٹیب ایکسپورٹ اور ڈرائیو سنک کا انتظام کرتا ہے۔ سب کچھ آپ کے براؤزر میں چلتا ہے؛ ڈیٹا آپ کے ڈیوائس پر محفوظ رہتا ہے۔",
      app_ul: "<li><strong>فتویٰ نہیں</strong> — اپنے عالم سے تصدیق کریں۔</li><li>نصاب پر یا اس سے زیادہ زکات کے قابل دولت پر <strong>2.5%</strong> واجب؛ زیورات اور قرض کے مذہبی احکام۔</li><li><strong>زکات بیس لائن:</strong> رمضان کی پہلی جمعہ (ہیڈر میں دکھائی جاتی ہے)۔</li>",
      what_p1: "<strong>زکات</strong> اسلام کا تیسرا رکن ہے — ایک قمری سال رکھی گئی اضافی دولت پر واجب سالانہ عبادت۔ رضاکارانہ <em>صدقے</em> کے برخلاف، یہ نصاب (نِصاب) تک پہنچنے پر غرباء کا ایک مقررہ حق ہے۔",
      what_p2: "قرآن (9:60) میں ذکر شدہ مستحقین: فقیر، مسکین، عاملین، مؤلفة القلوب، غلام، مقروض، فی سبیل اللہ، اور مسافر۔",
      when_ul: function(nisabLine, jewelryLine, debtLine, rulesLabel) {
        return "<li><strong>حول:</strong> ~354 قمری دن کی ملکیت — ہر اثاثے پر <strong>حول آغاز</strong> مقرر کریں۔</li>" +
          "<li><strong>شرح:</strong> <strong>2.5%</strong> (چالیسواں حصہ) جب کل زکات کے قابل دولت نصاب سے زیادہ ہو۔</li>" +
          "<li><strong>نصاب (" + rulesLabel + "):</strong> " + nisabLine + "۔ مذہب مارکیٹ ریٹس ٹیب پر تبدیل کریں۔</li>" +
          "<li><strong>زیورات:</strong> " + jewelryLine + "</li>" +
          "<li><strong>سالانہ، ماہانہ نہیں:</strong> اپنی زکات تاریخ پر <strong>کل نقدی</strong> درج کریں — ہر تنخواہ یا کرایے پر 2.5% نہیں۔</li>" +
          "<li><strong>زکات الفطر</strong> الگ ہے اور یہاں حساب نہیں ہوتی۔</li>";
      },
      calc_sub: "فی رکن اثاثے ← بیس لائن تاریخ پر قدریں ← نصاب جانچ ← ریٹس ← منہا ادائیگیاں۔",
      calc_th: ["قسم", "اس ایپ میں"],
      calc_rows: function(debtLine) { return [
        ["سونا / چاندی / پلاٹینم / ہیرا", "گرام یا مارکیٹ قیمت ← نصاب سے اوپر <strong>2.5%</strong> کا حصہ"],
        ["نقدی / PF / اسٹاکس / کاروبار", "بیلنس پر <strong>سالانہ 2.5%</strong> (PF بیان و شراکت سے متوقع)"],
        ["جائیداد", "گھر/کرایہ چھوٹ؛ <strong>فروخت کے لیے</strong> ← مارکیٹ قیمت پر 2.5%؛ کرایہ ← <strong>نقدی</strong>"],
        ["مویشی / زراعت / رکاز", "سنت کے درجات / فصل % / رکاز پر <strong>ایک بار 20%</strong>"],
        ["ذمہ داریاں", debtLine],
        ["باقی", "واجب − ادائیگیاں"],
      ]; },
      calc_rate_note: function(g, s) { return "موجودہ ریٹس: سونا " + g + "/گرام، چاندی " + s + "/گرام۔"; },
      schools_sub: function(label) { return "موجودہ: <strong>" + label + "</strong> (مارکیٹ ریٹس ٹیب پر تبدیل کریں)۔"; },
      schools_th: ["حکم", ""],
      schools_r_nisab: "نصاب", schools_r_jewelry: "پہنے ہوئے زیورات", schools_r_debts: "قرضہ",
      schools_v_silver: "چاندی", schools_v_gold: "سونا",
      schools_v_exempt: "چھوٹ دے سکتے ہیں", schools_v_allgold: "تمام سونا/چاندی",
      schools_v_none: "کوئی نہیں", schools_v_cash: "صرف نقدی", schools_v_full: "مکمل",
      using_ol: "<li><strong>ڈیش بورڈ</strong> — ریٹس خلاصہ، گھرانے کی کل رقم، افراد اور اثاثے۔</li><li><strong>اینالیٹکس</strong> — وقت کے ساتھ دولت اور زکات کا تجزیہ۔</li><li><strong>سالانہ جائزہ</strong> — ماضی کے سالوں کی اثاثہ قدریں ریکارڈ کریں۔</li><li><strong>مارکیٹ ریٹس</strong> — فقہی مذہب، دستی یا لائیو ریٹس، سالانہ تاریخ۔</li><li><strong>بیک اپ و بحالی</strong> — ایکسل ایکسپورٹ، گوگل ڈرائیو آٹو سیو، اور فائل یا ڈرائیو سے بحالی۔</li>",
      disclaimer_p: "صرف تعلیمی آلہ۔ ادا کرنے سے پہلے رقم اور مستحقین کی تصدیق کسی <strong>اہل عالم</strong> سے کریں۔ مارکیٹ ریٹس اشارتی ہیں۔",
      faq_a: function(rules, debtAns, jewelryAns) { return [
        "<strong>نہیں۔</strong> یہ عالم کے مراجعت شدہ ڈیفالٹس کے ساتھ ایک گھریلو کیلکولیٹر ہے۔ ادا کرنے سے پہلے کسی اہل عالم سے تصدیق کریں۔",
        "زکات واجب ہونے سے پہلے کم از کم زکات کے قابل دولت۔ یہ ایپ آپ کی <strong>" + rules.label + "</strong> ترتیب کے مطابق سونے یا چاندی کے وزن × ریٹس استعمال کرتی ہے۔",
        "عام طور پر: <strong>نصاب</strong> سے کم؛ ابھی <strong>حول</strong> میں؛ جائیداد <strong>ذاتی/کرایہ</strong> ہے؛ زیورات <strong>ذاتی استعمال</strong> میں نشان زد (جہاں چھوٹ ہو)؛ یا قدریں ابھی درج نہیں کی گئیں۔",
        "نقدی، اسٹاکس، تجارتی جائیداد، اور دھاتوں کے لیے <strong>آج کی مارکیٹ قیمت</strong>۔ زکات آپ کی زکات تاریخ پر دولت کی قیمت پر ہے، خرید قیمت پر نہیں۔",
        "عمارت پر <strong>نہیں</strong> — <strong>جائیداد ← ذاتی رہائش</strong>۔ یہ اینالیٹکس میں ریکارڈ کے لیے دکھ سکتی ہے لیکن زکات سے مستثنیٰ ہے۔",
        "دو <strong>جائیداد</strong> اثاثے: اپنے گھر کے لیے <strong>ذاتی رہائش</strong>، دوسرے کے لیے <strong>کرایہ</strong> یا <strong>فروخت / تجارت</strong>۔ کرایہ وصولی ← <strong>نقدی</strong>۔",
        "<strong>موجودہ مارکیٹ قیمت</strong> استعمال کریں، ذیلی قسم <strong>تجارت</strong>، حول خریداری سے۔ خریدا ₹1L، اب ₹7L ← <strong>₹7L</strong> درج کریں؛ زکات ≈ ₹7L کا 2.5% اگر نصاب سے اوپر — صرف 'منافع' کا 2.5% نہیں۔",
        "زکات کے قابل دولت کی ~<strong>354 قمری دن</strong> کی ملکیت۔ اثاثہ ملنے یا خریدنے پر <strong>حول آغاز</strong> مقرر کریں۔ حول میں موجود دولت سال مکمل ہونے تک مستثنیٰ ہے۔",
        "بہت سے خاندان <strong>رمضان</strong> استعمال کرتے ہیں۔ اس ایپ کی بیس لائن <strong>رمضان کی پہلی جمعہ</strong> (ام القریٰ) ہے؛ ہیڈر آج اور وہ بیس لائن دکھاتا ہے۔",
        "<strong>سالانہ</strong> — قمری سال میں ایک بار، ماہانہ نہیں۔ نقدی: آپ کی زکات تاریخ پر جو ابھی ہے × 2.5% اگر نصاب سے اوپر۔ کرایہ: عمارت مستثنیٰ؛ وصول شدہ کرایہ ← <strong>نقدی</strong>۔",
        jewelryAns,
        "<strong>رکاز (رِکاز)</strong> دفینہ خزانہ یا وہ دولت ہے جسے آپ کا عالم رکاز قرار دے — تنخواہ، FD، یا اسٹاکس نہیں۔ یہ ایپ: <strong>ایک بار 20%</strong>، سالانہ 2.5% نہیں۔ زمرہ <strong>رکاز</strong> استعمال کریں۔",
        "<strong>زکات</strong> — اضافی دولت پر مقررہ حق۔ <strong>صدقہ</strong> — رضاکارانہ۔ <strong>زکات الفطر</strong> — رمضان کے آخر میں فی فرد؛ اس کیلکولیٹر میں <strong>نہیں</strong> ہے۔",
        "<strong>ذمہ داریاں</strong> شامل کریں۔ <strong>" + rules.label + "</strong> کے ساتھ: " + debtAns + " گھر کے قرضے خودبخود جائیداد سے منسلک نہیں — اپنے عالم سے پوچھیں۔",
        "<strong>جو بینک میں باقی ہے</strong> آپ کی زکات تاریخ پر۔ زندگی کے اخراجات پر خرچ کی گئی تنخواہ زکات کے قابل نہیں۔",
        "<strong>PF / EPF:</strong> زمرہ <strong>PF</strong> — بیان بیلنس، تاریخ، ماہانہ شراکت، متوقع بیلنس (ڈیفالٹ 8.25% سالانہ)۔ <strong>فنڈز / اسٹاکس:</strong> موجودہ کل قیمت کے ساتھ <strong>اسٹاکس</strong>۔",
        "ڈیش بورڈ <strong>موجودہ سال</strong> دکھاتا ہے۔ <strong>سالانہ جائزہ</strong> استعمال کریں تاکہ پچھلے سالوں کے بیلنس ریکارڈ ہوں اور اینالیٹکس میں آئیں، اور اپنے عالم کے ساتھ بقایا زکات حساب کریں۔",
        "فی رکن ← <strong>+ ادائیگی</strong>: وصول کنندہ اور رقم۔ <strong>باقی</strong> = واجب − ادا شدہ۔",
        "قرآن 9:60: فقیر، مسکین، عاملین، مؤلفة القلوب، غلام، مقروض، فی سبیل اللہ، مسافر۔ آپ کا عالم اہل وصول کنندگان کی رہنمائی کر سکتا ہے۔",
        "بہت سے کیلکولیٹر صرف سونے کا نصاب استعمال کرتے ہیں۔ <strong>حنفی</strong> اکثر <strong>تمام مجموعی دولت</strong> کا موازنہ <strong>چاندی کے نصاب</strong> (کم حد) سے کرتے ہیں۔ حنفی منتخب ہونے پر یہ ایپ اسی کی پیروی کرتی ہے۔",
        "پہلی بار، اپنے کمپیوٹر یا گوگل ڈرائیو سے بیک اپ منتخب کریں۔ بعد میں، <strong>بیک اپ و بحالی</strong> ٹیب استعمال کریں۔",
        "<strong>حاصل کردہ سال</strong> مقرر کریں اور <strong>سالانہ جائزہ</strong> میں وقت کے ساتھ بیلنس ریکارڈ کریں؛ دھاتیں سالانہ ریٹس استعمال کرتی ہیں۔",
        "<strong>ہاں۔</strong> متعدد <strong>خاندان کے افراد</strong> شامل کریں؛ زکات فی فرد حساب ہوتی ہے اور ڈیش بورڈ پر جمع ہوتی ہے۔",
      ]; },
    },

    ar: {
      app_p1: "آلة حساب زكاة الأسرة: أضف <strong>أفراد الأسرة</strong>، سجّل <strong>الأصول</strong> بعملتك، حدّد <strong>أسعار السوق</strong>، واطّلع على <strong>المستحق والمدفوع والمتبقي</strong> في لوحة التحكم. عند الفتح الأول، اختر نسخة Excel من حاسوبك أو Google Drive. تتولى علامة تبويب <strong>النسخ الاحتياطي</strong> التصدير والمزامنة. كل شيء يعمل في متصفحك؛ تبقى البيانات على جهازك.",
      app_ul: "<li><strong>ليست فتوى</strong> — تأكّد مع عالِمك.</li><li><strong>2.5%</strong> على الثروة الزكوية عند النصاب أو ما فوقه؛ أحكام المذهب للمجوهرات والديون.</li><li><strong>تاريخ احتساب الزكاة:</strong> أول جمعة من رمضان (يظهر في الرأس).</li>",
      what_p1: "<strong>الزكاة</strong> هي الصدقة السنوية الواجبة على الثروة الفائضة المحتفظ بها لحول قمري — الركن الثالث من أركان الإسلام. على خلاف <em>الصدقة</em> الطوعية، هي حق مقرر للفقراء حين تبلغ الثروة النصاب.",
      what_p2: "المستحقون في القرآن الكريم (9:60): الفقراء، والمساكين، والعاملون عليها، والمؤلَّفة قلوبهم، والرقاب، والغارمون، وفي سبيل الله، وابن السبيل.",
      when_ul: function(nisabLine, jewelryLine, debtLine, rulesLabel) {
        return "<li><strong>الحول:</strong> ~354 يومًا قمريًا من الامتلاك — حدّد <strong>بداية الحول</strong> لكل أصل.</li>" +
          "<li><strong>النسبة:</strong> <strong>2.5%</strong> (ربع العشر) حين تبلغ الثروة الزكوية النصاب.</li>" +
          "<li><strong>النصاب (" + rulesLabel + "):</strong> " + nisabLine + ". غيّر المذهب من علامة تبويب أسعار السوق.</li>" +
          "<li><strong>المجوهرات:</strong> " + jewelryLine + "</li>" +
          "<li><strong>سنويًا لا شهريًا:</strong> أدخل <strong>إجمالي النقد</strong> في تاريخ زكاتك — لا 2.5% على كل راتب أو إيجار.</li>" +
          "<li><strong>زكاة الفطر</strong> منفصلة ولا تُحسب هنا.</li>";
      },
      calc_sub: "أصول كل فرد ← قيم في تاريخ الاحتساب ← التحقق من النصاب ← الأسعار ← طرح المدفوعات.",
      calc_th: ["النوع", "في هذا التطبيق"],
      calc_rows: function(debtLine) { return [
        ["الذهب / الفضة / البلاتين / الماس", "غرامات أو قيمة السوق ← حصة <strong>2.5%</strong> عند تجاوز النصاب"],
        ["النقد / صندوق التوفير / الأسهم / التجارة", "<strong>2.5% سنويًا</strong> على الأرصدة (صندوق التوفير متوقع من البيان + المساهمات)"],
        ["العقارات", "المنزل/الإيجار معفى؛ <strong>للبيع</strong> ← 2.5% من قيمة السوق؛ الإيجار ← <strong>نقد</strong>"],
        ["الماشية / الزراعة / الركاز", "الحدود الشرعية / نسبة الحصاد / <strong>20% مرة واحدة</strong> للركاز"],
        ["الالتزامات", debtLine],
        ["المتبقي", "المستحق − المدفوعات"],
      ]; },
      calc_rate_note: function(g, s) { return "الأسعار الحالية: ذهب " + g + "/غ، فضة " + s + "/غ."; },
      schools_sub: function(label) { return "الحالي: <strong>" + label + "</strong> (غيّر من علامة تبويب الأسعار)."; },
      schools_th: ["الحكم", ""],
      schools_r_nisab: "النصاب", schools_r_jewelry: "المجوهرات المُلبَسة", schools_r_debts: "الديون",
      schools_v_silver: "فضة", schools_v_gold: "ذهب",
      schools_v_exempt: "يمكن الإعفاء", schools_v_allgold: "كل الذهب/الفضة",
      schools_v_none: "لا شيء", schools_v_cash: "النقد فقط", schools_v_full: "كاملة",
      using_ol: "<li><strong>لوحة التحكم</strong> — ملخص الأسعار، مجاميع الأسرة، الأعضاء والأصول.</li><li><strong>التحليلات</strong> — الثروة والزكاة عبر الزمن.</li><li><strong>المراجعة السنوية</strong> — سجّل قيم الأصول في السنوات الماضية.</li><li><strong>أسعار السوق</strong> — اختيار المذهب، أسعار يدوية أو مباشرة.</li><li><strong>النسخ الاحتياطي والاستعادة</strong> — تصدير Excel، حفظ تلقائي على Google Drive.</li>",
      disclaimer_p: "أداة تعليمية فحسب. تأكّد من المبالغ والمستحقين مع <strong>عالِم مؤهَّل</strong> قبل الدفع. أسعار السوق استرشادية.",
      faq_a: function(rules, debtAns, jewelryAns) { return [
        "<strong>لا.</strong> هي آلة حساب للأسرة بإعدادات راجعها علماء. تأكّد مع عالِم مؤهَّل قبل الدفع.",
        "الحد الأدنى للثروة الزكوية قبل وجوب الزكاة. يستخدم هذا التطبيق أوزان الذهب أو الفضة × الأسعار وفق إعداد <strong>" + rules.label + "</strong>.",
        "عادةً: دون <strong>النصاب</strong>؛ لا يزال في <strong>الحول</strong>؛ العقار <strong>سكني/إيجاري</strong>؛ المجوهرات موسومة بـ<strong>الاستخدام الشخصي</strong>؛ أو لم تُدخَل القيم بعد.",
        "<strong>قيمة السوق اليوم</strong> للنقد والأسهم والعقارات التجارية والمعادن. الزكاة على ما تساويه الثروة في تاريخ زكاتك، لا على سعر الشراء.",
        "<strong>لا</strong> على المبنى — <strong>العقارات ← السكن الشخصي</strong>. قد يظهر في التحليلات للسجلات لكنه مستثنى من الزكاة.",
        "أصلان من نوع <strong>العقارات</strong>: <strong>السكن الشخصي</strong> لمنزلك، <strong>الإيجار</strong> أو <strong>للبيع/التجارة</strong> للآخر. الإيجار المحصَّل ← <strong>نقد</strong>.",
        "استخدم <strong>قيمة السوق الحالية</strong>، النوع الفرعي <strong>تجارة</strong>، الحول من تاريخ الشراء.",
        "~<strong>354 يومًا قمريًا</strong> من امتلاك الثروة الزكوية. حدّد <strong>بداية الحول</strong> حين استلمت الأصل أو اشتريته.",
        "تستخدم كثير من الأسر <strong>رمضان</strong>. تاريخ احتساب هذا التطبيق هو <strong>أول جمعة من رمضان</strong> (أم القرى).",
        "<strong>سنويًا</strong> — مرة واحدة في العام القمري. النقد: ما تملكه في تاريخ زكاتك × 2.5% إن بلغ النصاب.",
        jewelryAns,
        "<strong>الركاز</strong> هو الكنز المدفون أو ما يحكم عالِمك بأنه ركاز — لا الراتب أو الودائع أو الأسهم. هذا التطبيق: <strong>20% مرة واحدة</strong>.",
        "<strong>الزكاة</strong> — حق مقرر على الثروة الفائضة. <strong>الصدقة</strong> — طوعية. <strong>زكاة الفطر</strong> — في نهاية رمضان لكل فرد؛ <strong>غير</strong> مشمولة هنا.",
        "أضف <strong>الالتزامات</strong>. مع <strong>" + rules.label + "</strong>: " + debtAns + " القروض العقارية غير مرتبطة تلقائيًا بالعقار — استشر عالِمك.",
        "<strong>ما تبقّى في البنك</strong> في تاريخ زكاتك. الراتب المنفَق على نفقات المعيشة غير زكوي.",
        "<strong>صندوق التوفير:</strong> فئة <strong>PF</strong> — رصيد البيان، تاريخه، المساهمات الشهرية. <strong>الصناديق/الأسهم:</strong> القيمة الإجمالية الحالية.",
        "تعرض لوحة التحكم <strong>السنة الحالية</strong>. استخدم <strong>المراجعة السنوية</strong> لتسجيل أرصدة السنوات الماضية.",
        "لكل فرد ← <strong>+ دفعة</strong>: المستلم والمبلغ. <strong>المتبقي</strong> = المستحق − المدفوع.",
        "القرآن 9:60: الفقراء، المساكين، العاملون، المؤلَّفة قلوبهم، الرقاب، الغارمون، في سبيل الله، ابن السبيل.",
        "تستخدم كثير من الآلات نصاب الذهب فقط. <strong>الحنفية</strong> غالبًا يقارنون <strong>مجموع الثروة</strong> بنصاب الفضة (الحد الأدنى). يتّبع هذا التطبيق ذلك عند اختيار الحنفية.",
        "في الزيارة الأولى، اختر نسخة احتياطية من حاسوبك أو Google Drive. لاحقًا، استخدم علامة تبويب <strong>النسخ الاحتياطي والاستعادة</strong>.",
        "حدّد <strong>سنة الاقتناء</strong> وسجّل الأرصدة في <strong>المراجعة السنوية</strong>.",
        "<strong>نعم.</strong> أضف عدة <strong>أفراد من الأسرة</strong>؛ تُحسب الزكاة لكل فرد وتُجمَع في لوحة التحكم.",
      ]; },
    },

    hi: {
      app_p1: "परिवार के लिए घरेलू ज़कात कैलकुलेटर: <strong>परिवार के सदस्य</strong> जोड़ें, अपनी करेंसी में <strong>संपत्ति</strong> दर्ज करें, <strong>बाज़ार दर</strong> सेट करें, और डैशबोर्ड पर <strong>देय, भुगतान, और शेष</strong> देखें। पहली बार खोलने पर अपने कंप्यूटर या Google Drive से Excel बैकअप चुनें। <strong>बैकअप</strong> टैब एक्सपोर्ट और Drive सिंक संभालता है। सब कुछ आपके ब्राउज़र में चलता है; डेटा आपके डिवाइस पर रहता है।",
      app_ul: "<li><strong>फ़तवा नहीं</strong> — अपने विद्वान से पुष्टि करें।</li><li>निसाब पर या उससे अधिक ज़कात योग्य धन पर <strong>2.5%</strong>; गहनों और कर्ज़ के मज़हबी नियम।</li><li><strong>ज़कात बेसलाइन:</strong> रमज़ान का पहला शुक्रवार (हेडर में दिखाया जाता है)।</li>",
      what_p1: "<strong>ज़कात</strong> इस्लाम का तीसरा स्तंभ है — एक चंद्र वर्ष तक रखी गई अधिशेष संपत्ति पर अनिवार्य वार्षिक दान। स्वैच्छिक <em>सदक़ह</em> के विपरीत, यह निसाब पहुँचने पर ग़रीबों का एक निश्चित अधिकार है।",
      what_p2: "क़ुरआन (9:60) में उल्लिखित हकदार: ग़रीब, ज़रूरतमंद, संग्राहक, दिल मिलाए जाने वाले, क़ैदी, क़र्ज़दार, अल्लाह की राह में, और मुसाफ़िर।",
      when_ul: function(nisabLine, jewelryLine, debtLine, rulesLabel) {
        return "<li><strong>हौल:</strong> ~354 चंद्र दिनों की स्वामित्व — प्रत्येक संपत्ति पर <strong>हौल स्टार्ट</strong> सेट करें।</li>" +
          "<li><strong>दर:</strong> <strong>2.5%</strong> (चालीसवाँ भाग) जब कुल ज़कात योग्य धन निसाब से ≥ हो।</li>" +
          "<li><strong>निसाब (" + rulesLabel + "):</strong> " + nisabLine + "। मज़हब मार्केट रेट्स टैब पर बदलें।</li>" +
          "<li><strong>गहने:</strong> " + jewelryLine + "</li>" +
          "<li><strong>सालाना, मासिक नहीं:</strong> अपनी ज़कात तारीख पर <strong>कुल नकद</strong> दर्ज करें।</li>" +
          "<li><strong>ज़कात-उल-फ़ित्र</strong> अलग है और यहाँ गणना नहीं होती।</li>";
      },
      calc_sub: "प्रति सदस्य संपत्ति → बेसलाइन तारीख पर मूल्य → निसाब जाँच → दरें → भुगतान घटाएँ।",
      calc_th: ["प्रकार", "इस ऐप में"],
      calc_rows: function(debtLine) { return [
        ["सोना / चाँदी / प्लैटिनम / हीरा", "ग्राम या बाज़ार मूल्य → निसाब से ऊपर <strong>2.5%</strong> का हिस्सा"],
        ["नकद / PF / स्टॉक / व्यापार", "बैलेंस पर <strong>सालाना 2.5%</strong>"],
        ["संपत्ति", "घर/किराया छूट; <strong>बिक्री के लिए</strong> → 2.5%; किराया → <strong>नकद</strong>"],
        ["पशु / कृषि / रिकाज़", "सुन्नत स्तर / फ़सल % / रिकाज़ पर <strong>एक बार 20%</strong>"],
        ["देनदारियाँ", debtLine],
        ["शेष", "देय − भुगतान"],
      ]; },
      calc_rate_note: function(g, s) { return "वर्तमान दरें: सोना " + g + "/ग्राम, चाँदी " + s + "/ग्राम।"; },
      schools_sub: function(label) { return "वर्तमान: <strong>" + label + "</strong> (मार्केट रेट्स टैब पर बदलें)।"; },
      schools_th: ["नियम", ""],
      schools_r_nisab: "निसाब", schools_r_jewelry: "पहने गहने", schools_r_debts: "क़र्ज़",
      schools_v_silver: "चाँदी", schools_v_gold: "सोना",
      schools_v_exempt: "छूट दे सकते हैं", schools_v_allgold: "सभी सोना/चाँदी",
      schools_v_none: "कोई नहीं", schools_v_cash: "केवल नकद", schools_v_full: "पूर्ण",
      using_ol: "<li><strong>डैशबोर्ड</strong> — दर सारांश, परिवार का कुल, सदस्य और संपत्ति।</li><li><strong>एनालिटिक्स</strong> — समय के साथ धन और ज़कात।</li><li><strong>वार्षिक समीक्षा</strong> — पिछले वर्षों की संपत्ति मूल्य रिकॉर्ड करें।</li><li><strong>मार्केट रेट्स</strong> — मज़हब चुनें, मैनुअल/लाइव दरें।</li><li><strong>बैकअप और रीस्टोर</strong> — Excel एक्सपोर्ट, Google Drive ऑटो-सेव।</li>",
      disclaimer_p: "केवल शैक्षिक उपकरण। भुगतान से पहले <strong>योग्य विद्वान</strong> से राशि और हकदारों की पुष्टि करें। बाज़ार दरें सांकेतिक हैं।",
      faq_a: function(rules, debtAns, jewelryAns) { return [
        "<strong>नहीं।</strong> यह विद्वान-समीक्षित डिफ़ॉल्ट के साथ एक घरेलू कैलकुलेटर है। भुगतान से पहले योग्य विद्वान से पुष्टि करें।",
        "ज़कात देय होने से पहले न्यूनतम ज़कात योग्य धन। यह ऐप आपकी <strong>" + rules.label + "</strong> सेटिंग के अनुसार सोने या चाँदी के वज़न × दरें उपयोग करता है।",
        "आमतौर पर: <strong>निसाब</strong> से कम; अभी <strong>हौल</strong> में; संपत्ति <strong>व्यक्तिगत/किराया</strong> है; गहने <strong>व्यक्तिगत उपयोग</strong> में चिह्नित; या मूल्य अभी दर्ज नहीं।",
        "नकद, शेयर, व्यापारिक संपत्ति और धातुओं के लिए <strong>आज का बाज़ार मूल्य</strong>।",
        "इमारत पर <strong>नहीं</strong> — <strong>संपत्ति → व्यक्तिगत आवास</strong>। एनालिटिक्स में रिकॉर्ड के लिए दिख सकता है लेकिन ज़कात से बाहर।",
        "दो <strong>संपत्ति</strong> एसेट: अपने घर के लिए <strong>व्यक्तिगत आवास</strong>, दूसरे के लिए <strong>किराया</strong> या <strong>बिक्री/व्यापार</strong>।",
        "<strong>वर्तमान बाज़ार मूल्य</strong> उपयोग करें, उपप्रकार <strong>व्यापार</strong>, हौल खरीद से।",
        "ज़कात योग्य धन के ~<strong>354 चंद्र दिन</strong> की स्वामित्व। संपत्ति मिलने या खरीदने पर <strong>हौल स्टार्ट</strong> सेट करें।",
        "कई परिवार <strong>रमज़ान</strong> उपयोग करते हैं। इस ऐप की बेसलाइन <strong>रमज़ान का पहला शुक्रवार</strong> (उम्म अल-क़ुरा) है।",
        "<strong>सालाना</strong> — चंद्र वर्ष में एक बार, मासिक नहीं।",
        jewelryAns,
        "<strong>रिकाज़</strong> दफ़न खज़ाना या वह धन है जिसे आपका विद्वान रिकाज़ घोषित करे। यह ऐप: <strong>एक बार 20%</strong>।",
        "<strong>ज़कात</strong> — अधिशेष धन पर निश्चित अधिकार। <strong>सदक़ह</strong> — स्वैच्छिक। <strong>ज़कात-उल-फ़ित्र</strong> — रमज़ान के अंत में प्रति व्यक्ति; इस कैलकुलेटर में <strong>नहीं</strong>।",
        "<strong>देनदारियाँ</strong> जोड़ें। <strong>" + rules.label + "</strong> के साथ: " + debtAns,
        "<strong>आपकी ज़कात तारीख पर बैंक में जो बचा है</strong>। जीवन-यापन पर खर्च किया वेतन ज़कात योग्य नहीं।",
        "<strong>PF / EPF:</strong> श्रेणी <strong>PF</strong>। <strong>फंड/शेयर:</strong> वर्तमान कुल मूल्य के साथ <strong>स्टॉक्स</strong>।",
        "डैशबोर्ड <strong>वर्तमान वर्ष</strong> दिखाता है। पिछले वर्षों के बैलेंस रिकॉर्ड करने के लिए <strong>वार्षिक समीक्षा</strong> उपयोग करें।",
        "प्रति सदस्य → <strong>+ भुगतान</strong>: प्राप्तकर्ता और राशि। <strong>शेष</strong> = देय − भुगतान।",
        "क़ुरआन 9:60: ग़रीब, ज़रूरतमंद, संग्राहक, दिल मिलाए जाने वाले, क़ैदी, क़र्ज़दार, अल्लाह की राह में, मुसाफ़िर।",
        "कई कैलकुलेटर केवल सोने का निसाब उपयोग करते हैं। <strong>हनफ़ी</strong> अक्सर <strong>समस्त धन</strong> की तुलना <strong>चाँदी के निसाब</strong> से करते हैं।",
        "पहली बार, अपने कंप्यूटर या Google Drive से बैकअप चुनें। बाद में, <strong>बैकअप और रीस्टोर</strong> टैब उपयोग करें।",
        "<strong>अर्जित वर्ष</strong> सेट करें और <strong>वार्षिक समीक्षा</strong> में समय के साथ बैलेंस रिकॉर्ड करें।",
        "<strong>हाँ।</strong> कई <strong>परिवार के सदस्य</strong> जोड़ें; ज़कात प्रति व्यक्ति गणना होती है और डैशबोर्ड पर जोड़ी जाती है।",
      ]; },
    },
  };

  // Button-driven collapse (same pattern as the server app's panel_section macro).
  function collapsible(title, bodyNodes, expanded) {
    const bodyId = "panel-" + Math.random().toString(36).slice(2, 10);
    const toggle = el("button", {
      type: "button",
      class: "panel-collapse-toggle",
      "aria-expanded": expanded ? "true" : "false",
      "aria-controls": bodyId,
    }, [
      el("span", { class: "panel-chevron", text: "\u25BE" }),
      el("span", { text: title }),
    ]);
    const body = el("div", {
      class: "panel-collapse-body",
      id: bodyId,
      "data-collapsed": expanded ? "false" : "true",
    }, bodyNodes);
    toggle.addEventListener("click", () => {
      const collapsed = body.dataset.collapsed === "true";
      setPanelCollapsed(toggle, body, !collapsed);
    });
    return el("div", { class: "collapsible-panel" }, [toggle, body]);
  }

  function html(tag, markup, cls) { return el(tag, cls ? { class: cls, html: markup } : { html: markup }); }

  function renderGuide() {
    const panel = document.getElementById("tab-guide");
    clear(panel);
    const madhab = Store.getMadhab();
    const rules = ZK.MADHAB_RULES[madhab];
    const allMadhabs = ZK.MADHAB_RULES;

    // Sub-navigation: About / FAQ
    const navPanel = el("div", { class: "panel" });
    navPanel.appendChild(el("h2", { text: Help.t("guide_learn") }));
    const subnav = el("div", { class: "subnav" }, [
      el("button", { class: "subnav-btn " + (guideView === "guide" ? "active" : ""), text: Help.t("guide_tab_about"), onclick: () => { guideView = "guide"; renderGuide(); } }),
      el("button", { class: "subnav-btn " + (guideView === "faq" ? "active" : ""), text: Help.t("guide_tab_faq"), onclick: () => { guideView = "faq"; renderGuide(); } }),
    ]);
    navPanel.appendChild(subnav);
    navPanel.appendChild(el("p", { class: "sub", text: Help.t("guide_cur_school") + " " + rules.label + " — " + Help.t("guide_change_school") }));
    const expandRow = el("div", { class: "btn-row" }, [
      el("button", { class: "link", text: Help.t("guide_expand_all"), onclick: () => setAllPanelsCollapsed(panel, false) }),
      el("button", { class: "link", text: Help.t("guide_collapse_all"), onclick: () => setAllPanelsCollapsed(panel, true) }),
    ]);
    navPanel.appendChild(expandRow);
    panel.appendChild(navPanel);

    const body = el("div", { class: "panel guide-panel" });
    if (guideView === "guide") buildGuideSections(body, madhab, rules, allMadhabs);
    else buildFaqSections(body, madhab, rules);
    panel.appendChild(body);
  }

  function buildGuideSections(root, madhab, rules, allMadhabs) {
    const lang = Help.getLang();
    const gc = GUIDE_CONTENT[lang] || GUIDE_CONTENT["en"];
    const sessionRates = Store.getRates();
    const goldRate = sessionRates.gold_inr_per_gram, silverRate = sessionRates.silver_inr_per_gram;
    const nisabLine = rules.nisab_basis === "silver"
      ? "<strong>" + ZK.NISAB_SILVER_GRAMS.toFixed(1) + " g \u00d7 silver rate/g</strong>"
      : "<strong>" + ZK.NISAB_GOLD_GRAMS.toFixed(1) + " g \u00d7 gold rate/g</strong>";
    const jewelryLine = rules.jewelry_exempt
      ? "Mark <strong>personal adornment</strong> per item to exempt worn pieces (" + rules.label + ")."
      : "All gold and silver counts, including jewelry (Hanafi).";
    const debtLine = rules.debt_deduction === "none" ? "Not deducted (" + rules.label + ")"
      : rules.debt_deduction === "cash_only" ? "From cash only" : "Deducted from investments";

    root.appendChild(collapsible(Help.t("guide_s_app"), [
      html("p", gc.app_p1),
      html("ul", gc.app_ul),
    ]));

    root.appendChild(collapsible(Help.t("guide_s_what"), [
      el("p", { class: "arabic", lang: "ar", dir: "rtl", text: "\u0632\u0643\u0627\u0629" }),
      html("p", gc.what_p1),
      html("p", gc.what_p2),
    ]));

    root.appendChild(collapsible(Help.t("guide_s_when"), [
      html("ul", gc.when_ul(nisabLine, jewelryLine, debtLine, rules.label)),
    ]));

    // Calc table \u2014 always use en strings for column labels (rows are translated via gc)
    const calcRows = gc.calc_rows(debtLine);
    const calcTh = gc.calc_th;
    let calcTbody = "";
    calcRows.forEach((r) => { calcTbody += "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>"; });
    const calcTable = "<table class='guide-table'><thead><tr><th>" + calcTh[0] + "</th><th>" + calcTh[1] + "</th></tr></thead><tbody>" + calcTbody + "</tbody></table>";
    root.appendChild(collapsible(Help.t("guide_s_calc"), [
      html("p", gc.calc_sub, "sub"),
      html("div", calcTable, "table-wrap"),
      html("p", gc.calc_rate_note(ZK.fmtINR(goldRate), ZK.fmtINR(silverRate)), "help"),
    ]));

    // Schools comparison table (current highlighted)
    const keys = Object.keys(allMadhabs);
    const schoolsTh = gc.schools_th;
    let headRow = "<tr><th>" + schoolsTh[0] + "</th>";
    keys.forEach((k) => { headRow += "<th" + (k === madhab ? " class='hl'" : "") + ">" + allMadhabs[k].label + (k === madhab ? " \u2713" : "") + "</th>"; });
    headRow += "</tr>";
    function row(label, fn) {
      let r = "<tr><td>" + label + "</td>";
      keys.forEach((k) => { r += "<td" + (k === madhab ? " class='hl'" : "") + ">" + fn(allMadhabs[k]) + "</td>"; });
      return r + "</tr>";
    }
    const schoolsTable = "<table class='guide-table'><thead>" + headRow + "</thead><tbody>" +
      row(gc.schools_r_nisab, (r) => r.nisab_basis === "silver" ? gc.schools_v_silver : gc.schools_v_gold) +
      row(gc.schools_r_jewelry, (r) => r.jewelry_exempt ? gc.schools_v_exempt : gc.schools_v_allgold) +
      row(gc.schools_r_debts, (r) => r.debt_deduction === "none" ? gc.schools_v_none : (r.debt_deduction === "cash_only" ? gc.schools_v_cash : gc.schools_v_full)) +
      "</tbody></table>";
    root.appendChild(collapsible(Help.t("guide_s_schools"), [
      html("p", gc.schools_sub(rules.label), "sub"),
      html("div", schoolsTable, "table-wrap"),
    ]));

    root.appendChild(collapsible(Help.t("guide_s_using"), [
      html("ol", gc.using_ol),
    ]));

    root.appendChild(collapsible(Help.t("guide_s_disclaimer"), [
      html("p", gc.disclaimer_p, "sub"),
    ]));
  }

  function buildFaqSections(root, madhab, rules) {
    var lang = Help.getLang();
    var gc = GUIDE_CONTENT[lang] || GUIDE_CONTENT["en"];
    var jewelryAns = rules.jewelry_exempt
      ? "Under <strong>" + rules.label + "</strong>, tick <strong>personal adornment</strong> on worn pieces; investment gold stays zakatable."
      : "Under <strong>Hanafi</strong>, <strong>all gold and silver</strong> is generally zakatable, including jewellery.";
    var debtAns = rules.debt_deduction === "none" ? "debts are <strong>not deducted</strong>."
      : rules.debt_deduction === "cash_only" ? "debts reduce <strong>cash only</strong>."
      : "debts reduce <strong>investments</strong> (stocks/business).";
    var answers = gc.faq_a(rules, debtAns, jewelryAns);
    var questions = [
      Help.t("guide_faq_q1"), Help.t("guide_faq_q2"), Help.t("guide_faq_q3"),
      Help.t("guide_faq_q4"), Help.t("guide_faq_q5"), Help.t("guide_faq_q6"),
      Help.t("guide_faq_q7"), Help.t("guide_faq_q8"), Help.t("guide_faq_q9"),
      Help.t("guide_faq_q10"), Help.t("guide_faq_q11"), Help.t("guide_faq_q12"),
      Help.t("guide_faq_q13"), Help.t("guide_faq_q14"), Help.t("guide_faq_q15"),
      Help.t("guide_faq_q16"), Help.t("guide_faq_q17"), Help.t("guide_faq_q18"),
      Help.t("guide_faq_q19"), Help.t("guide_faq_q20"), Help.t("guide_faq_q21"),
      Help.t("guide_faq_q22"), Help.t("guide_faq_q23"),
    ];
    questions.forEach(function(q, i) {
      if (answers[i] !== undefined) root.appendChild(collapsible(q, [html("p", answers[i])]));
    });
  }

    // --- Generic field builder ---
  function field(label, inputNode, help) {
    const f = el("div", { class: "field" }, [el("label", { text: label }), inputNode]);
    if (help) f.appendChild(el("div", { class: "help", text: help }));
    return f;
  }

  // --- Local dev: seed browser data from Python app export ---
  function maybeRestoreDevFixture() {
    const host = location.hostname;
    if (host !== "localhost" && host !== "127.0.0.1") return Promise.resolve(false);
    const params = new URLSearchParams(location.search);
    const force = params.has("seed") || params.has("restore");
    if (!force && Store.members().length > 0) return Promise.resolve(false);
    if (!Excel || !Excel.importBackupFromArrayBuffer) return Promise.resolve(false);
    return fetch("fixtures/household_backup.xlsx")
      .then((r) => {
        if (!r.ok) throw new Error("fixtures/household_backup.xlsx not found");
        return r.arrayBuffer();
      })
      .then((buf) => Excel.importBackupFromArrayBuffer(buf))
      .then((counts) => {
        toast(
          "Loaded Python app data (" + counts.members + " members, " + counts.assets + " assets)",
          "ok"
        );
        return true;
      })
      .catch((e) => {
        console.warn("Dev fixture restore skipped:", e.message || e);
        return false;
      });
  }

  function bootApp(opts) {
    opts = opts || {};
    baseline = ZK.zakatAsOf();
    setupTabs();
    renderChrome();
    renderBaselineMeta();
    renderFamilyNameMeta();
    renderDashboard();
    trackTabView("dashboard");
    maybeTrackFamilyNameActive();
    if (opts.fetchRates !== false) maybeAutoFetchRates();
  }

  // --- Init ---
  function init() {
    if (!global.XLSX) console.warn("SheetJS not loaded — Excel backup will be unavailable.");
    Store.load();
    // First run on this device: guess the local currency from the browser's
    // locale/timezone (existing pre-currency data is pinned to INR in Store.load).
    if (!Store.getCurrency()) Store.setCurrency(ZK.detectCurrency());
    ZK.setDisplayCurrency(Store.getCurrency());
    if (Drive) {
      Drive.setStatusCallback((kind, msg) => toast(msg, kind));
      // When a background auto-merge updates local state, refresh the UI.
      document.addEventListener("zk:drive-merge", () => {
        refreshAll();
      });
      Store.onSave(() => Drive.scheduleAutoBackup());
      setupDriveConnectResume();
    }

    if (hasHouseholdData()) {
      bootApp();
      return;
    }

    maybeRestoreDevFixture()
      .then((devRestored) => {
        if (devRestored) {
          bootApp();
          refreshAll();
          return;
        }
        bootApp({ fetchRates: false });
        showWelcomeModal(() => {
          refreshAll();
          if (hasHouseholdData()) maybeAutoFetchRates();
        });
      });
  }

  // On load, refresh today's market rates from the internet (default on; opt-out
  // per device). Silent and non-blocking: if offline or a value is implausible,
  // stored rates stay. Historical yearly rates are deliberately NOT touched here —
  // they only change via "Update historical rates" on the Market Rates tab.
  function maybeAutoFetchRates() {
    if (!Rates || !Store.getAutoRates()) return;
    const current = Store.getRates();
    Rates.fetchLiveRates(current.diamond_inr_per_carat, curCode())
      .then((res) => {
        const merged = Object.assign({}, current);
        let changed = false;
        ["gold_inr_per_gram", "silver_inr_per_gram", "platinum_inr_per_gram"].forEach((k) => {
          if (res.rates[k] > 0) { merged[k] = Math.round(res.rates[k] * 100) / 100; changed = true; }
        });
        if (changed) {
          Store.setRates(merged);
          baseline = ZK.zakatAsOf();
          renderBaselineMeta();
          refreshAll();
          toast("Today's metal rates updated (" + curCode() + ") — spot prices; verify against your local rates on the Market Rates tab", "ok");
        }
      })
      .catch(() => { /* offline or blocked — keep stored rates silently */ });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
