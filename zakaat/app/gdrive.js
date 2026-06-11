/*
 * Google Drive backup/restore — browser-only Excel (.xlsx) sync.
 *
 * Backups are stored at: MY_FAMILY/ZAKAAT/zakaat_<mon>_<year>.xlsx
 * (e.g. zakaat_jun_2026.xlsx). Folders are created if missing.
 *
 * Uses the Athar family Google OAuth Web Client ID (Drive API enabled).
 */
(function (global) {
  "use strict";

  const DEFAULT_CLIENT_ID = "1013887002929-tp0qaue517d1650g3gq9jtjkgq91r629.apps.googleusercontent.com";
  const GIS_SRC = "https://accounts.google.com/gsi/client";
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const CFG_KEY = "zakat_gdrive_cfg_v1";
  const FILES_API = "https://www.googleapis.com/drive/v3/files";
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  const FOLDER_FAMILY = "MY_FAMILY";
  const FOLDER_ZAKAAT = "ZAKAAT";
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  let accessToken = null;
  let tokenExpiry = 0;
  let tokenClient = null;
  let gisLoading = null;
  let autoTimer = null;
  let statusCb = null;
  let pendingConnect = null;

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
    try {
      const w = window.open("about:blank", "_blank", "noopener,noreferrer,width=1,height=1");
      if (!w || w.closed || typeof w.closed === "undefined") return true;
      w.close();
      return false;
    } catch (e) {
      return true;
    }
  }

  function isPopupBlockedError(err) {
    const text = String((err && err.message) || err || "").toLowerCase();
    return /popup|pop-up|popup_timeout|failed_to_open|popup_closed|window\.open/i.test(text);
  }

  function popupBlockedHelpHtml() {
    const site = siteHost();
    return (
      "<p><strong>Google sign-in needs a small pop-up window.</strong> If nothing appeared, allow pop-ups for <code>" + site + "</code>:</p>" +
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

  function connect(opts) {
    opts = opts || {};
    if (isConnected()) return Promise.resolve({ access_token: accessToken });
    if (pendingConnect) return pendingConnect;

    const clientId = getClientId();
    if (!clientId) return Promise.reject(new Error("Set your Google OAuth Client ID first."));

    pendingConnect = loadGis().then(
      () =>
        new Promise((resolve, reject) => {
          let settled = false;
          function finish(fn, value) {
            if (settled) return;
            settled = true;
            if (popupTimer) clearTimeout(popupTimer);
            fn(value);
          }

          const popupTimer = opts.interactive
            ? setTimeout(() => {
                finish(
                  reject,
                  new Error(
                    "popup_timeout: Google sign-in pop-up did not appear. " +
                    "Your browser may be blocking pop-ups for " + siteHost() + "."
                  )
                );
              }, 45000)
            : null;

          try {
            if (!tokenClient) {
              tokenClient = global.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: SCOPE,
                callback: (resp) => {
                  if (resp && resp.access_token) {
                    accessToken = resp.access_token;
                    tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) * 1000);
                    if (opts.interactive) setDriveEnabled(true);
                    finish(resolve, resp);
                  } else {
                    rejectOAuthError((err) => finish(reject, err), null, resp);
                  }
                },
                error_callback: (err) => {
                  rejectOAuthError((err) => finish(reject, err), err, null);
                },
              });
            }
            tokenClient.requestAccessToken({ prompt: opts.interactive ? "consent" : "" });
          } catch (e) {
            finish(reject, e);
          }
        })
    ).finally(() => {
      pendingConnect = null;
    });
    return pendingConnect;
  }

  function disconnect() {
    const tok = accessToken;
    accessToken = null;
    tokenExpiry = 0;
    if (tok && global.google && global.google.accounts && global.google.accounts.oauth2) {
      try {
        global.google.accounts.oauth2.revoke(tok, () => {});
      } catch (e) {
        /* ignore */
      }
    }
  }

  function ensureToken() {
    if (isConnected()) return Promise.resolve();
    if (!getDriveEnabled()) {
      return Promise.reject(new Error("Sign in to Google Drive first."));
    }
    return connect({ interactive: false });
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
        const bytes = new Uint8Array(Excel.buildBackupBuffer());
        return uploadXlsx(ctx.folderId, ctx.fileName, bytes, ctx.existing && ctx.existing.id).then((res) => ({
          res: res,
          ctx: ctx,
        }));
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

  global.ZKDrive = {
    isConfigured,
    isConnected,
    getClientId,
    setClientId,
    getLastSync,
    getLastFileName,
    connect,
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
    SCOPE,
    FOLDER_FAMILY,
    FOLDER_ZAKAAT,
  };
})(window);
