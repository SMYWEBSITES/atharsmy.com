/*
 * Google Drive backup/restore — Excel (.xlsx) sync.
 *
 * Backups are stored at: MY_FAMILY/ZAKAAT/zakaat_<mon>_<year>.xlsx
 * (e.g. zakaat_jun_2026.xlsx). Folders are created if missing.
 *
 * Auth strategy:
 *  - Web browser  → Google Identity Services (GIS) implicit token flow (popup)
 *  - Android/iOS  → PKCE Authorization Code flow via Chrome Custom Tab
 *                   (Google blocks OAuth popups inside WebViews since 2021)
 *
 * Mobile setup (one-time, Google Cloud Console):
 *  1. APIs & Services → Credentials → Create → OAuth 2.0 Client → Android
 *  2. Package name: com.atharsmy.zakat  SHA-1: debug keystore fingerprint
 *  3. Copy the new client ID into DEFAULT_MOBILE_CLIENT_ID below and rebuild
 *
 * Token persistence (mobile):
 *  Access token + refresh token are stored in localStorage under TOKEN_KEY so
 *  they survive app restarts and WebView reloads within the same device.
 *  Refresh tokens let the app silently renew without asking the user to sign in
 *  again (access_type=offline). The refresh token is only cleared on explicit
 *  disconnect() or when Google revokes it.
 */
(function (global) {
  "use strict";

  // Web client (GIS popup flow — browser only)
  const DEFAULT_CLIENT_ID = "1013887002929-tp0qaue517d1650g3gq9jtjkgq91r629.apps.googleusercontent.com";
  // Android client — validates via package name + SHA-1, no redirect URI registration needed.
  const DEFAULT_ANDROID_CLIENT_ID = "1013887002929-qd4qgoh2gtg918n677mdsu93ec3cu8l1.apps.googleusercontent.com";
  // iOS client — validates via bundle ID (com.atharsmy.zakat), no redirect URI registration needed.
  const DEFAULT_IOS_CLIENT_ID     = "1013887002929-kulc4m2njt1j3mh1vc4go28q8ue28hau.apps.googleusercontent.com";
  // Fallback alias kept for any stored overrides in localStorage.
  const DEFAULT_MOBILE_CLIENT_ID  = DEFAULT_ANDROID_CLIENT_ID;
  const GIS_SRC = "https://accounts.google.com/gsi/client";
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const CFG_KEY = "zakat_gdrive_cfg_v1";
  // Separate key for the token so clearing it doesn't disturb the Drive config.
  const TOKEN_KEY = "zakat_gdrive_token_v1";

  // ── Mobile OAuth (PKCE) constants ──────────────────────────────────────────
  // Redirect URI registered as a custom scheme — Android catches it via the
  // intent filter in AndroidManifest.xml; iOS via CFBundleURLTypes in Info.plist
  const PKCE_REDIRECT_URI   = "com.atharsmy.zakat://oauth2callback";
  const OAUTH_AUTH_ENDPOINT  = "https://accounts.google.com/o/oauth2/v2/auth";
  const OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
  const FILES_API = "https://www.googleapis.com/drive/v3/files";
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  const FOLDER_FAMILY = "MY_FAMILY";
  const FOLDER_ZAKAAT = "ZAKAAT";
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  let accessToken = null;
  let tokenExpiry = 0;
  let refreshToken = null;   // mobile only — persisted to localStorage
  let tokenClient = null;
  let gisLoading = null;
  let autoTimer = null;
  let statusCb = null;
  let pendingConnect = null;
  let activeConnect = null;
  let refreshing = null;     // in-flight refresh promise (deduplicate concurrent calls)
  const connectListeners = [];

  // ── Platform detection ─────────────────────────────────────────────────────
  function isCapacitorNative() {
    return !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
  }

  function capacitorPlugins() {
    return (global.Capacitor && global.Capacitor.Plugins) || null;
  }

  // ── Token persistence (mobile) ─────────────────────────────────────────────
  // Saves access token + expiry + optional refresh token to localStorage so
  // they survive app restarts and WebView reloads on the same device.
  function persistToken(data) {
    try {
      localStorage.setItem(TOKEN_KEY, JSON.stringify(data));
    } catch (e) { /* quota or private-browsing — ignore */ }
  }

  function clearPersistedToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    refreshToken = null;
  }

  // Called once at module init. Restores in-memory token state from a prior
  // session without requiring the user to sign in again.
  function loadPersistedToken() {
    try {
      const stored = JSON.parse(localStorage.getItem(TOKEN_KEY) || "{}") || {};
      if (stored.refresh_token) {
        // Always restore the refresh token — it lets us silently renew later.
        refreshToken = stored.refresh_token;
      }
      if (stored.access_token && stored.expiry && Date.now() < stored.expiry - 5000) {
        accessToken = stored.access_token;
        tokenExpiry = stored.expiry;
      }
    } catch (e) { /* corrupt storage — ignore */ }
  }

  // ── PKCE helpers ───────────────────────────────────────────────────────────
  function pkceVerifier() {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode.apply(null, arr))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  function pkceChallenge(verifier) {
    const buf = new TextEncoder().encode(verifier);
    return crypto.subtle.digest("SHA-256", buf).then(function (hash) {
      return btoa(String.fromCharCode.apply(null, new Uint8Array(hash)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    });
  }

  // ── Mobile OAuth (PKCE + Custom Tab) ──────────────────────────────────────
  // Opens the Google consent screen in a Chrome Custom Tab (not the WebView).
  // Google redirects to com.atharsmy.zakat://oauth2callback which Android
  // hands back to the app; Capacitor fires the 'appUrlOpen' event.
  function connectMobile(opts) {
    return new Promise(function (resolve, reject) {
      var plugins = capacitorPlugins();
      if (!plugins || !plugins.Browser || !plugins.App) {
        reject(new Error(
          "Capacitor Browser/App plugins not loaded. " +
          "Run: npm install @capacitor/browser @capacitor/app && npx cap sync"
        ));
        return;
      }

      var clientId = getMobileClientId();
      if (!clientId) {
        reject(new Error(
          "Mobile OAuth client ID not configured. Contact the app administrator."
        ));
        return;
      }

      var verifier = pkceVerifier();
      var state = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

      pkceChallenge(verifier).then(function (challenge) {
        var authUrl =
          OAUTH_AUTH_ENDPOINT +
          "?client_id="             + encodeURIComponent(clientId) +
          "&redirect_uri="          + encodeURIComponent(PKCE_REDIRECT_URI) +
          "&response_type=code" +
          "&scope="                 + encodeURIComponent(SCOPE) +
          "&code_challenge="        + encodeURIComponent(challenge) +
          "&code_challenge_method=S256" +
          "&state="                 + encodeURIComponent(state) +
          // offline → Google issues a refresh token so the app can renew
          // silently after the 1-hour access token expires.
          // prompt=consent ensures Google always returns the refresh token
          // (it is otherwise only sent on the very first authorization).
          "&access_type=offline" +
          "&prompt=consent";

        var settled = false;
        var listenerHandle = null;
        var browserFinishedHandle = null;

        function finish(fn, value) {
          if (settled) return;
          settled = true;
          if (listenerHandle) {
            try { listenerHandle.remove(); } catch (e) { /* ignore */ }
            listenerHandle = null;
          }
          if (browserFinishedHandle) {
            try { browserFinishedHandle.remove(); } catch (e) { /* ignore */ }
            browserFinishedHandle = null;
          }
          fn(value);
        }

        // Listen for the custom-scheme deep link coming back from the browser.
        // Capacitor 6+ makes addListener() synchronous — it returns a
        // PluginListenerHandle directly (no .then()).
        try {
          listenerHandle = plugins.App.addListener("appUrlOpen", function (data) {
            if (!data || !data.url) return;
            var url;
            try { url = new URL(data.url); } catch (e) { return; }
            // Only handle our redirect scheme
            if (url.protocol !== "com.atharsmy.zakat:" || url.hostname !== "oauth2callback") return;

            // Close the Custom Tab
            try { plugins.Browser.close(); } catch (e) { /* ignore */ }

            var code          = url.searchParams.get("code");
            var returnedState = url.searchParams.get("state");
            var error         = url.searchParams.get("error");

            if (error) {
              if (error === "access_denied") {
                finish(reject, new Error(
                  "Google blocked sign-in (access_denied). " +
                  "If the app is in Testing mode, go to Google Cloud Console → " +
                  "APIs & Services → OAuth consent screen → Test users → add your Gmail, " +
                  "then tap Connect again."
                ));
              } else {
                finish(reject, new Error("Google sign-in error: " + error));
              }
              return;
            }
            if (returnedState !== state) {
              finish(reject, new Error("OAuth state mismatch — possible CSRF. Please try again."));
              return;
            }
            if (!code) {
              finish(reject, new Error("No authorization code returned by Google."));
              return;
            }

            // Exchange the code for an access token (PKCE — no client secret needed)
            fetch(OAUTH_TOKEN_ENDPOINT, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type:    "authorization_code",
                code:          code,
                redirect_uri:  PKCE_REDIRECT_URI,
                client_id:     clientId,
                code_verifier: verifier,
              }).toString(),
            })
              .then(function (r) { return r.json(); })
              .then(function (token) {
                if (token.access_token) {
                  accessToken  = token.access_token;
                  tokenExpiry  = Date.now() + (Number(token.expires_in) || 3600) * 1000;
                  // Persist refresh token if Google returned one (access_type=offline).
                  // Google only returns it on first authorization or when prompt=consent
                  // is set; preserve any previously stored refresh token otherwise.
                  if (token.refresh_token) refreshToken = token.refresh_token;
                  persistToken({
                    access_token:  accessToken,
                    expiry:        tokenExpiry,
                    refresh_token: refreshToken || null,
                  });
                  if (opts && opts.interactive) setDriveEnabled(true);
                  finish(resolve, { access_token: accessToken });
                  notifyConnectChange();
                } else {
                  finish(reject, new Error(token.error_description || token.error || "Token exchange failed"));
                }
              })
              .catch(function (e) {
                finish(reject, new Error("Token exchange failed: " + (e.message || e)));
              });
          });
        } catch (e) {
          finish(reject, new Error("Failed to register deep link listener: " + (e.message || e)));
          return;
        }

        // Detect when the user closes the Custom Tab without completing sign-in
        // (e.g. after Google shows an "Access blocked" error page). Without this,
        // the app would silently wait for the 5-minute timeout.
        try {
          browserFinishedHandle = plugins.Browser.addListener("browserFinished", function () {
            // Give appUrlOpen a short head-start in case both events fire together
            // (the redirect fires appUrlOpen, then the tab closes and fires this).
            setTimeout(function () {
              if (!settled) {
                finish(reject, new Error(
                  "Google sign-in was cancelled or blocked. " +
                  "If you saw an \"Access blocked\" error, add your Gmail to " +
                  "Google Cloud Console → OAuth consent screen → Test users, then tap Connect again."
                ));
              }
            }, 800);
          });
        } catch (e) { /* ignore — plugin may not support this event */ }

        // Open the auth URL in a Chrome Custom Tab
        plugins.Browser.open({ url: authUrl }).catch(function (e) {
          finish(reject, new Error("Failed to open browser: " + (e.message || e)));
        });

        // 5-minute timeout (fallback if browserFinished never fires)
        setTimeout(function () {
          finish(reject, new Error("Google sign-in timed out. Please try again."));
          try { plugins.Browser.close(); } catch (e) { /* ignore */ }
        }, 300000);
      }).catch(function (e) {
        reject(new Error("PKCE setup failed: " + (e.message || e)));
      });
    });
  }

  function loadCfg() {
    try {
      return JSON.parse(localStorage.getItem(CFG_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function saveCfg(patch) {
    const cfg = Object.assign(loadCfg(), patch);
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    return cfg;
  }

  function getClientId() {
    return (loadCfg().client_id || DEFAULT_CLIENT_ID).trim();
  }

  function setClientId(id) {
    saveCfg({ client_id: String(id || "").trim() });
    tokenClient = null;
  }

  // Mobile uses a separate Desktop-type OAuth client (no client secret, allows PKCE).
  // Falls back to DEFAULT_MOBILE_CLIENT_ID (the pre-created "Zakat Mobile" Desktop
  // client) so sign-in works out of the box without any manual setup.
  // Returns the correct platform client ID: iOS client on iOS, Android client on Android.
  // A stored override in localStorage (mobile_client_id) takes precedence if set.
  function getMobileClientId() {
    var stored = (loadCfg().mobile_client_id || "").trim();
    if (stored) return stored;
    var platform = (window.Capacitor && window.Capacitor.getPlatform) ? window.Capacitor.getPlatform() : "web";
    return platform === "ios" ? DEFAULT_IOS_CLIENT_ID : DEFAULT_ANDROID_CLIENT_ID;
  }

  function setMobileClientId(id) {
    saveCfg({ mobile_client_id: String(id || "").trim() });
  }

  function getLastSync() {
    return loadCfg().last_sync || null;
  }

  function getLastFileName() {
    return loadCfg().last_file_name || null;
  }

  function getAutoSync() {
    return loadCfg().auto_sync !== false;
  }

  function setAutoSync(v) {
    saveCfg({ auto_sync: !!v });
  }

  function getDriveEnabled() {
    return !!loadCfg().drive_enabled;
  }

  function setDriveEnabled(v) {
    saveCfg({ drive_enabled: !!v });
  }

  function monthKey(date) {
    const d = date || new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return d.getFullYear() + "-" + m;
  }

  function parseBackupFileName(name) {
    const m = /^zakaat_([a-z]{3})_(\d{4})\.xlsx$/i.exec(String(name || ""));
    if (!m) return null;
    const mon = m[1].toLowerCase();
    const idx = MONTHS.indexOf(mon);
    if (idx < 0) return null;
    return { month: idx, year: parseInt(m[2], 10) };
  }

  function monthSortKey(parsed) {
    return parsed.year * 12 + parsed.month;
  }

  function latestPriorBackup(files, date) {
    const d = date || new Date();
    const currentKey = d.getFullYear() * 12 + d.getMonth();
    let best = null;
    let bestKey = -1;
    (files || []).forEach((f) => {
      const parsed = parseBackupFileName(f.name);
      if (!parsed) return;
      const key = monthSortKey(parsed);
      if (key >= currentKey || key <= bestKey) return;
      best = f;
      bestKey = key;
    });
    return best;
  }

  function setStatusCallback(fn) {
    statusCb = typeof fn === "function" ? fn : null;
  }

  function notify(kind, message) {
    if (statusCb) statusCb(kind, message);
  }

  function notifyConnectChange() {
    const connected = isConnected();
    connectListeners.forEach((cb) => {
      try { cb(connected); } catch (e) { /* ignore */ }
    });
  }

  function onConnectChange(cb) {
    if (typeof cb === "function") connectListeners.push(cb);
  }

  function abortActiveConnect(reason) {
    if (!activeConnect || activeConnect.settled) return;
    activeConnect.finish(
      activeConnect.reject,
      new Error(reason || "Connect cancelled")
    );
  }

  function isConfigured() {
    return !!getClientId();
  }

  function isConnected() {
    return !!accessToken && Date.now() < tokenExpiry - 5000;
  }

  function backupFileName(date) {
    const d = date || new Date();
    return "zakaat_" + MONTHS[d.getMonth()] + "_" + d.getFullYear() + ".xlsx";
  }

  function folderPathLabel() {
    return FOLDER_FAMILY + "/" + FOLDER_ZAKAAT + "/";
  }

  function getPageOrigin() {
    return location.origin;
  }

  function originMismatchHelp() {
    return (
      "OAuth origin mismatch. In Google Cloud Console → APIs & Services → Credentials → " +
      "your Web OAuth client → Authorized JavaScript origins, add exactly: " + getPageOrigin()
    );
  }

  function siteHost() {
    return location.hostname || "atharsmy.com";
  }

  function isPopupLikelyBlocked() {
    // Do not window.open() here — that about:blank tab is often the "blank page" users see.
    return false;
  }

  function isPopupBlockedError(err) {
    const text = String((err && err.message) || err || "").toLowerCase();
    return /popup|pop-up|popup_timeout|popup_closed|failed_to_open|blank|window\.open|window closed/i.test(text);
  }

  function popupBlockedHelpHtml() {
    const site = siteHost();
    return (
      "<p><strong>Google sign-in opens a pop-up (not a blank tab).</strong> If you only see an empty white window, close it, allow pop-ups for <code>" + site + "</code>, then try again:</p>" +
      "<ul class=\"popup-help-list\">" +
      "<li><strong>Chrome / Edge:</strong> Click the icon left of the address bar → <em>Pop-ups and redirects</em> → <strong>Allow</strong>. " +
      "Or Settings → Privacy → Pop-ups → add <code>" + site + "</code>.</li>" +
      "<li><strong>Safari (Mac):</strong> Safari → Settings → Websites → Pop-up Windows → <code>" + site + "</code> → <strong>Allow</strong>.</li>" +
      "<li><strong>Safari (iPhone/iPad):</strong> Settings → Safari → turn off <em>Block Pop-ups</em>, or tap <strong>Allow</strong> when Safari asks for this site.</li>" +
      "<li><strong>Firefox:</strong> Click the permissions icon in the address bar → allow <em>Pop-ups</em> for this site.</li>" +
      "</ul>" +
      "<p class=\"help\">Pause ad blockers for this site, reload the page, then try <strong>Connect</strong> again. " +
      "Until sign-in works, use <strong>Download backup</strong> or open an <strong>Excel file from this device</strong> instead.</p>"
    );
  }

  function rejectOAuthError(reject, err, resp) {
    const raw =
      (err && (err.message || err.type || err.error)) ||
      (resp && (resp.error_description || resp.error)) ||
      "Authorization failed";
    const text = String(raw);
    if (/origin_mismatch|origin/i.test(text)) {
      reject(new Error(originMismatchHelp()));
      return;
    }
    if (/access_denied|verification|test users/i.test(text)) {
      reject(new Error(
        "Google sign-in blocked: this OAuth app is in Testing mode. " +
        "In Google Cloud Console → OAuth consent screen → Test users, add your Gmail address " +
        "(e.g. smy.altamash@gmail.com), save, wait a minute, then Connect again."
      ));
      return;
    }
    if (/popup_closed|window closed/i.test(text)) {
      reject(new Error(
        "popup_closed: Google sign-in closed before finishing. Close any blank tab, allow pop-ups for " +
        siteHost() + ", then try Connect again."
      ));
      return;
    }
    if (isPopupBlockedError(text)) {
      reject(new Error("popup_blocked: Allow pop-ups for " + siteHost() + " and try Connect again."));
      return;
    }
    reject(new Error(text));
  }

  function loadGis() {
    if (global.google && global.google.accounts && global.google.accounts.oauth2) {
      return Promise.resolve();
    }
    if (gisLoading) return gisLoading;
    gisLoading = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-gis="1"]');
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("Failed to load Google sign-in script")));
        return;
      }
      const s = document.createElement("script");
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.dataset.gis = "1";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load Google sign-in script (check your internet connection)."));
      document.head.appendChild(s);
    });
    return gisLoading;
  }

  // ── Refresh token (mobile only) ────────────────────────────────────────────
  // Silently gets a new access token using the stored refresh token.
  // Deduplicates concurrent calls so only one fetch is in-flight at a time.
  function refreshAccessToken() {
    if (!refreshToken) return Promise.reject(new Error("No refresh token stored — sign in again."));
    if (refreshing) return refreshing;

    var clientId = getMobileClientId();
    refreshing = fetch(OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
        client_id:     clientId,
      }).toString(),
    })
      .then(function (r) { return r.json(); })
      .then(function (token) {
        if (token.access_token) {
          accessToken = token.access_token;
          tokenExpiry = Date.now() + (Number(token.expires_in) || 3600) * 1000;
          // Google may rotate the refresh token; update it if a new one is given.
          if (token.refresh_token) refreshToken = token.refresh_token;
          persistToken({
            access_token:  accessToken,
            expiry:        tokenExpiry,
            refresh_token: refreshToken,
          });
          notifyConnectChange();
          return { access_token: accessToken };
        }
        // Refresh token revoked / expired — clear it and ask user to sign in.
        clearPersistedToken();
        accessToken = null;
        tokenExpiry = 0;
        throw new Error(token.error_description || token.error || "Token refresh failed — please sign in again.");
      })
      .finally(function () { refreshing = null; });

    return refreshing;
  }

  function connect(opts) {
    opts = opts || {};
    if (isConnected()) {
      notifyConnectChange();
      return Promise.resolve({ access_token: accessToken });
    }

    // ── Native mobile: use PKCE + Chrome Custom Tab ──────────────────────────
    // Google blocks OAuth popups inside Android/iOS WebViews (disallowed_useragent).
    // Instead we open a real Chrome Custom Tab, capture the redirect deep link,
    // and exchange the auth code for a token ourselves via PKCE.
    if (isCapacitorNative()) {
      if (opts.interactive) setDriveEnabled(true);
      return connectMobile(opts);
    }

    // ── Web browser: existing GIS implicit token flow ─────────────────────────
    if (opts.interactive) {
      setDriveEnabled(true);
      abortActiveConnect("restarted");
    } else if (pendingConnect && !opts.resume) {
      return pendingConnect;
    } else if (pendingConnect && opts.resume) {
      abortActiveConnect("resume");
    }

    const clientId = getClientId();
    if (!clientId) return Promise.reject(new Error("Set your Google OAuth Client ID first."));

    if (opts.interactive) {
      tokenClient = null;
    }

    pendingConnect = loadGis().then(
      () =>
        new Promise((resolve, reject) => {
          let settled = false;
          function finish(fn, value) {
            if (settled) return;
            settled = true;
            if (activeConnect) activeConnect.settled = true;
            if (popupTimer) clearTimeout(popupTimer);
            fn(value);
          }

          activeConnect = { finish: finish, reject: reject, resolve: resolve, settled: false, opts: opts };

          const popupTimer = opts.interactive
            ? setTimeout(() => {
                finish(
                  reject,
                  new Error(
                    "popup_timeout: Google sign-in did not complete. Close any blank tab, allow pop-ups for " +
                    siteHost() + ", disable ad blockers, then try Connect again."
                  )
                );
              }, 30000)
            : null;

          try {
            tokenClient = global.google.accounts.oauth2.initTokenClient({
              client_id: clientId,
              scope: SCOPE,
              callback: (resp) => {
                if (resp && resp.access_token) {
                  accessToken = resp.access_token;
                  tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) * 1000);
                  if (opts.interactive) setDriveEnabled(true);
                  finish(resolve, resp);
                  notifyConnectChange();
                } else {
                  rejectOAuthError((err) => finish(reject, err), null, resp);
                }
              },
              error_callback: (err) => {
                rejectOAuthError((err) => finish(reject, err), err, null);
              },
            });
            tokenClient.requestAccessToken({ prompt: opts.interactive ? "select_account" : "" });
          } catch (e) {
            finish(reject, e);
          }
        })
    ).finally(() => {
      pendingConnect = null;
      activeConnect = null;
    });
    return pendingConnect;
  }

  // OAuth may finish in Google's pop-up/tab without notifying this page — retry silently when user returns.
  function resumeAfterOAuthTab() {
    if (isConnected()) {
      notifyConnectChange();
      return Promise.resolve(true);
    }
    if (!pendingConnect && !activeConnect) return Promise.resolve(false);

    return new Promise((resolve) => {
      setTimeout(() => {
        if (isConnected()) {
          notifyConnectChange();
          resolve(true);
          return;
        }
        if (!pendingConnect && !activeConnect) {
          resolve(false);
          return;
        }
        abortActiveConnect("resume");
        connect({ interactive: false, resume: true })
          .then(() => {
            notifyConnectChange();
            resolve(isConnected());
          })
          .catch(() => resolve(false));
      }, 700);
    });
  }

  function disconnect() {
    const tok = accessToken;
    accessToken = null;
    tokenExpiry = 0;
    clearPersistedToken(); // clears refreshToken too
    if (tok && global.google && global.google.accounts && global.google.accounts.oauth2) {
      try {
        global.google.accounts.oauth2.revoke(tok, () => {});
      } catch (e) {
        /* ignore */
      }
    }
  }

  function ensureToken(opts) {
    opts = opts || {};
    if (isConnected()) return Promise.resolve();

    // On mobile: try the refresh token first before bothering the user.
    if (isCapacitorNative() && refreshToken) {
      return refreshAccessToken().catch(function () {
        // Refresh failed (token revoked). Fall through to interactive sign-in
        // only if the caller explicitly requested it; otherwise surface the error.
        if (!getDriveEnabled()) {
          return Promise.reject(new Error("Sign in to Google Drive first."));
        }
        return Promise.reject(new Error("Google session expired — tap Connect again to sign in."));
      });
    }

    if (!getDriveEnabled() && !opts.resume) {
      return Promise.reject(new Error("Sign in to Google Drive first."));
    }
    return connect({ interactive: false, resume: !!opts.resume });
  }

  function authHeaders(extra) {
    return Object.assign({ Authorization: "Bearer " + accessToken }, extra || {});
  }

  function driveFetch(url, options) {
    return fetch(url, options).then((r) => {
      if (r.status === 401) {
        accessToken = null;
        tokenExpiry = 0;
        throw new Error("Drive session expired — click Connect again.");
      }
      if (!r.ok) {
        return r.text().then((t) => {
          throw new Error("Drive error " + r.status + ": " + (t || "").slice(0, 200));
        });
      }
      return r;
    });
  }

  function escapeQueryName(name) {
    return String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  function findFolder(parentId, name) {
    const parentQ = parentId === "root" ? "'root' in parents" : "'" + parentId + "' in parents";
    const q =
      "name='" + escapeQueryName(name) + "' and mimeType='application/vnd.google-apps.folder' and " +
      parentQ + " and trashed=false";
    const url = FILES_API + "?q=" + encodeURIComponent(q) + "&fields=files(id,name)&pageSize=1";
    return driveFetch(url, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => (d.files && d.files[0]) || null);
  }

  function createFolder(parentId, name) {
    const meta = { name: name, mimeType: "application/vnd.google-apps.folder" };
    if (parentId !== "root") meta.parents = [parentId];
    return driveFetch(FILES_API, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(meta),
    }).then((r) => r.json());
  }

  function ensureFolder(parentId, name) {
    return findFolder(parentId, name).then((existing) => {
      if (existing) return existing.id;
      return createFolder(parentId, name).then((f) => f.id);
    });
  }

  function ensureZakaatFolder() {
    return ensureFolder("root", FOLDER_FAMILY).then((familyId) => ensureFolder(familyId, FOLDER_ZAKAAT));
  }

  function findFileInFolder(folderId, fileName) {
    const q =
      "name='" + escapeQueryName(fileName) + "' and '" + folderId + "' in parents and trashed=false";
    const url = FILES_API + "?q=" + encodeURIComponent(q) + "&fields=files(id,name,modifiedTime)&pageSize=1";
    return driveFetch(url, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => (d.files && d.files[0]) || null);
  }

  function xlsxMultipartBody(metadata, bytes, boundary) {
    const enc = new TextEncoder();
    const metaPart = enc.encode(
      "--" + boundary + "\r\n" +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) + "\r\n" +
      "--" + boundary + "\r\n" +
      "Content-Type: " + XLSX_MIME + "\r\n" +
      "Content-Transfer-Encoding: binary\r\n\r\n"
    );
    const endPart = enc.encode("\r\n--" + boundary + "--");
    const body = new Uint8Array(metaPart.length + bytes.length + endPart.length);
    body.set(metaPart, 0);
    body.set(bytes, metaPart.length);
    body.set(endPart, metaPart.length + bytes.length);
    return body;
  }

  function uploadXlsx(folderId, fileName, bytes, existingId) {
    const boundary = "zk_" + Math.random().toString(36).slice(2);
    const metadata = existingId ? { name: fileName } : { name: fileName, parents: [folderId] };
    const method = existingId ? "PATCH" : "POST";
    const url =
      UPLOAD_API +
      (existingId ? "/" + existingId : "") +
      "?uploadType=multipart&fields=id,name,modifiedTime";
    return driveFetch(url, {
      method: method,
      headers: authHeaders({ "Content-Type": "multipart/related; boundary=" + boundary }),
      body: xlsxMultipartBody(metadata, bytes, boundary),
    }).then((r) => r.json());
  }

  function downloadFile(fileId) {
    const url = FILES_API + "/" + fileId + "?alt=media";
    return driveFetch(url, { headers: authHeaders() }).then((r) => r.arrayBuffer());
  }

  function listFilesInFolder(folderId) {
    const q = "'" + folderId + "' in parents and trashed=false and name contains 'zakaat_'";
    const url =
      FILES_API + "?q=" + encodeURIComponent(q) +
      "&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=50";
    return driveFetch(url, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => (d.files || []).filter((f) => /\.xlsx$/i.test(f.name)));
  }

  function listBackups() {
    return ensureToken()
      .then(() => ensureZakaatFolder())
      .then((folderId) => listFilesInFolder(folderId));
  }

  // If the calendar month changed and no current-month file exists yet, seed local
  // data from the latest prior monthly backup on Drive before uploading.
  function prepareCurrentMonth(date) {
    const Excel = global.ZKExcel;
    const d = date || new Date();
    const fileName = backupFileName(d);
    const key = monthKey(d);

    return ensureZakaatFolder().then((folderId) =>
      findFileInFolder(folderId, fileName).then((existing) => {
        if (existing) {
          saveCfg({ active_month: key });
          return { folderId: folderId, existing: existing, fileName: fileName, rolled: false };
        }
        if (loadCfg().active_month === key) {
          return { folderId: folderId, existing: null, fileName: fileName, rolled: false };
        }
        return listFilesInFolder(folderId).then((files) => {
          const prior = latestPriorBackup(files, d);
          if (!prior || !Excel || !Excel.importBackupFromArrayBuffer) {
            saveCfg({ active_month: key });
            return { folderId: folderId, existing: null, fileName: fileName, rolled: false };
          }
          return downloadFile(prior.id).then((buf) =>
            Excel.importBackupFromArrayBuffer(buf).then(() => {
              saveCfg({ active_month: key, rollover_source: prior.name });
              notify("ok", "New month: started " + fileName + " from " + prior.name);
              return { folderId: folderId, existing: null, fileName: fileName, rolled: true, source: prior.name };
            })
          );
        });
      })
    );
  }

  function backup(date) {
    const Excel = global.ZKExcel;
    if (!Excel || !Excel.buildBackupBuffer) {
      return Promise.reject(new Error("Excel backup module not loaded."));
    }

    return ensureToken()
      .then(() => prepareCurrentMonth(date))
      .then((ctx) => {
        return Excel.buildBackupBuffer().then((buf) => {
          const bytes = new Uint8Array(buf);
          return uploadXlsx(ctx.folderId, ctx.fileName, bytes, ctx.existing && ctx.existing.id).then((res) => ({
            res: res,
            ctx: ctx,
          }));
        });
      })
      .then(({ res, ctx }) => {
        const when = new Date().toISOString();
        saveCfg({
          last_sync: when,
          last_file_name: ctx.fileName,
          last_file_id: res.id || null,
          active_month: monthKey(date),
        });
        return {
          id: res.id,
          fileName: ctx.fileName,
          savedAt: when,
          path: folderPathLabel() + ctx.fileName,
          rolled: ctx.rolled,
          source: ctx.source || null,
        };
      });
  }

  function maybeSyncMonthRollover() {
    if (!getAutoSync() || !isConfigured() || !getDriveEnabled() || !isConnected()) {
      return Promise.resolve(false);
    }
    return ensureToken()
      .then(() => prepareCurrentMonth())
      .then((ctx) => {
        if (!ctx.rolled) return false;
        return backup().then(() => true);
      })
      .catch(() => false);
  }

  function restore(fileName) {
    const Excel = global.ZKExcel;
    if (!Excel || !Excel.importBackupFromArrayBuffer) {
      return Promise.reject(new Error("Excel backup module not loaded."));
    }
    const targetName = fileName || backupFileName();

    return ensureToken()
      .then(() => ensureZakaatFolder())
      .then((folderId) => findFileInFolder(folderId, targetName))
      .then((existing) => {
        if (!existing) {
          throw new Error("No backup found at " + folderPathLabel() + targetName);
        }
        return downloadFile(existing.id).then((buf) => ({
          buf: buf,
          fileName: existing.name,
          modifiedTime: existing.modifiedTime,
        }));
      })
      .then((payload) =>
        Excel.importBackupFromArrayBuffer(payload.buf).then((counts) => ({
          counts: counts,
          fileName: payload.fileName,
          modifiedTime: payload.modifiedTime,
        }))
      )
      .then((result) => {
        saveCfg({ last_sync: new Date().toISOString(), last_file_name: result.fileName });
        return result;
      });
  }

  function scheduleAutoBackup() {
    if (!getAutoSync() || !isConfigured() || !getDriveEnabled() || !isConnected()) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (!isConnected()) return;
      backup()
        .then((res) => {
          const msg = res.rolled
            ? "New month backup created: " + res.path + (res.source ? " (from " + res.source + ")" : "")
            : "Auto-saved to Drive: " + res.path;
          notify("ok", msg);
        })
        .catch((e) => notify("err", "Auto-save failed: " + (e.message || e)));
    }, 2000);
  }

  // Restore any token saved in a prior session as soon as the module loads.
  // This runs synchronously before any caller can call connect() or ensureToken().
  loadPersistedToken();

  global.ZKDrive = {
    isConfigured,
    isConnected,
    getClientId,
    setClientId,
    getMobileClientId,
    setMobileClientId,
    getLastSync,
    getLastFileName,
    connect,
    resumeAfterOAuthTab,
    onConnectChange,
    disconnect,
    backup,
    restore,
    listBackups,
    backupFileName,
    folderPathLabel,
    getPageOrigin,
    originMismatchHelp,
    isPopupLikelyBlocked,
    isPopupBlockedError,
    popupBlockedHelpHtml,
    getAutoSync,
    setAutoSync,
    getDriveEnabled,
    setDriveEnabled,
    scheduleAutoBackup,
    maybeSyncMonthRollover,
    prepareCurrentMonth,
    setStatusCallback,
    refreshAccessToken,
    SCOPE,
    FOLDER_FAMILY,
    FOLDER_ZAKAAT,
  };
})(window);
