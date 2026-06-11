/*
 * Excel backup export/import using SheetJS (vendored locally).
 * Format is byte-compatible with the server app's app/data_backup.py
 * (backup_type "zakat-household", format_version 2), so a backup made here
 * can be restored on the server and vice-versa — including asset images.
 */
(function (global) {
  "use strict";

  const ZK = global.ZK;
  const Store = global.ZKStore;

  const BACKUP_FORMAT_VERSION = 2;
  const BACKUP_TYPE = "zakat-household";
  const B64_CHUNK_SIZE = 30000;

  const ASSET_HEADERS = [
    "asset_ref", "member_ref", "category", "description", "valuation_inr",
    "weight_grams", "gem_carats", "purity_value", "image_path", "created_at",
    "acquired_year", "hawl_start_date", "is_personal_jewelry", "asset_subtype",
    "quantity_count", "balance_as_of_date", "monthly_contribution_employee",
    "monthly_contribution_employer", "annual_interest_rate",
  ];

  function aoa(headers, rows) {
    return [headers].concat(rows);
  }

  function blank(v) {
    return v === null || v === undefined ? "" : v;
  }

  function dataUrlParts(dataUrl) {
    // data:image/png;base64,XXXX
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || "");
    if (!m) return null;
    return { mime: m[1], b64: m[2] };
  }

  function mimeToExt(mime) {
    const map = {
      "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp",
    };
    return map[mime] || ".jpg";
  }

  function buildBackupWorkbook() {
    const state = Store.getState();
    const XLSX = global.XLSX;
    const wb = XLSX.utils.book_new();

    // Meta
    const meta = aoa(["key", "value"], [
      ["format_version", BACKUP_FORMAT_VERSION],
      ["backup_type", BACKUP_TYPE],
      ["exported_at", new Date().toISOString()],
      ["username", "local"],
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), "Meta");

    // Settings
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
      aoa(["madhab", "family_name"], [[state.madhab || ZK.DEFAULT_MADHAB, blank(state.family_name)]])), "Settings");

    // SessionRates
    const r = Store.getRates();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa(
      ["gold_inr_per_gram", "silver_inr_per_gram", "platinum_inr_per_gram", "diamond_inr_per_carat"],
      [[r.gold_inr_per_gram, r.silver_inr_per_gram, r.platinum_inr_per_gram, r.diamond_inr_per_carat]]
    )), "SessionRates");

    const memberRows = [];
    const assetRows = [];
    const imageRows = [];
    const paymentRows = [];
    const snapshotRows = [];

    state.members.forEach((member, mi) => {
      const mref = "M" + (mi + 1);
      memberRows.push([mref, member.name, member.relationship]);

      (member.assets || []).forEach((a, ai) => {
        const aref = "A" + (mi + 1) + "." + (ai + 1);

        (a.snapshots || []).forEach((s) => {
          snapshotRows.push([
            aref, s.year, blank(s.category || a.category),
            s.valuation_inr != null ? ZK.num(s.valuation_inr) : "",
            s.weight_grams != null ? ZK.num(s.weight_grams) : "",
            s.gem_carats != null ? ZK.num(s.gem_carats) : "",
            blank(s.purity_value), !!s.is_backfill, blank(s.recorded_at),
          ]);
        });
        assetRows.push([
          aref, mref, a.category, blank(a.description), ZK.num(a.valuation_inr),
          a.weight_grams != null ? ZK.num(a.weight_grams) : "",
          a.gem_carats != null ? ZK.num(a.gem_carats) : "",
          blank(a.purity_value),
          a.image && a.image_filename ? "uploads/" + a.image_filename : "",
          blank(a.created_at),
          a.acquired_year || "",
          blank(a.hawl_start_date),
          !!a.is_personal_jewelry,
          blank(a.asset_subtype),
          a.quantity_count || "",
          blank(a.balance_as_of_date),
          a.monthly_contribution_employee != null ? ZK.num(a.monthly_contribution_employee) : "",
          a.monthly_contribution_employer != null ? ZK.num(a.monthly_contribution_employer) : "",
          a.annual_interest_rate != null ? ZK.num(a.annual_interest_rate) : "",
        ]);

        if (a.image) {
          const parts = dataUrlParts(a.image);
          if (parts && parts.b64) {
            const filename = a.image_filename || ("image" + mimeToExt(parts.mime));
            const chunks = [];
            for (let i = 0; i < parts.b64.length; i += B64_CHUNK_SIZE) {
              chunks.push(parts.b64.slice(i, i + B64_CHUNK_SIZE));
            }
            chunks.forEach((chunk, idx) => {
              imageRows.push([aref, filename, parts.mime, idx, chunks.length, chunk]);
            });
          }
        }
      });

      (member.zakat_payments || []).forEach((p) => {
        paymentRows.push([mref, p.given_to, ZK.num(p.amount_inr)]);
      });
    });

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
      aoa(["member_ref", "name", "relationship"], memberRows)), "FamilyMembers");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa(ASSET_HEADERS, assetRows)), "Assets");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
      aoa(["asset_ref", "filename", "mime_type", "chunk_index", "chunk_count", "data"], imageRows)), "Images");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa(
      ["asset_ref", "year", "category", "valuation_inr", "weight_grams", "gem_carats", "purity_value", "is_backfill", "recorded_at"],
      snapshotRows)), "Snapshots");

    const yearlyRows = (state.yearly_rates || []).map((yr) => [
      yr.year, ZK.num(yr.gold_inr_per_gram), ZK.num(yr.silver_inr_per_gram),
      ZK.num(yr.platinum_inr_per_gram), ZK.num(yr.diamond_inr_per_carat),
      !!yr.is_estimated, !!yr.is_user_override, blank(yr.rate_source), "",
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa(
      ["year", "gold_inr_per_gram", "silver_inr_per_gram", "platinum_inr_per_gram", "diamond_inr_per_carat", "is_estimated", "is_user_override", "rate_source", "recorded_at"],
      yearlyRows)), "YearlyRates");

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
      aoa(["member_ref", "given_to", "amount_inr"], paymentRows)), "Payments");

    return wb;
  }

  function buildBackupBuffer() {
    const XLSX = global.XLSX;
    const wb = buildBackupWorkbook();
    return XLSX.write(wb, { bookType: "xlsx", type: "array" });
  }

  function exportBackup() {
    const XLSX = global.XLSX;
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    XLSX.writeFile(buildBackupWorkbook(), "zakat_backup_" + stamp + ".xlsx");
  }

  // --- Readable Zakat report (mirrors server app/excel_export.py) ---
  function safeSheetName(name, used) {
    let base = String(name || "Member").replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 28) || "Member";
    let candidate = base, i = 2;
    while (used[candidate]) { candidate = base.slice(0, 25) + " " + i; i++; }
    used[candidate] = true;
    return candidate;
  }

  function buildReportWorkbook() {
    const XLSX = global.XLSX;
    const wb = XLSX.utils.book_new();
    const rates = Store.getRates();
    const madhab = Store.getMadhab();
    const members = Store.members();
    const baseline = ZK.zakatAsOf();
    const household = ZK.computeHousehold(members, rates, madhab, baseline);
    const rules = ZK.MADHAB_RULES[madhab];

    // Summary sheet
    const summary = [];
    summary.push(["Household Zakat report"]);
    summary.push(["School", rules.label]);
    summary.push(["Calculated as of (Zakat baseline)", ZK.fmtDate(baseline)]);
    summary.push([]);
    summary.push(["Market rates"]);
    summary.push(["Gold (INR/gram)", ZK.num(rates.gold_inr_per_gram)]);
    summary.push(["Silver (INR/gram)", ZK.num(rates.silver_inr_per_gram)]);
    summary.push(["Platinum (INR/gram)", ZK.num(rates.platinum_inr_per_gram)]);
    summary.push(["Diamond (INR/carat)", ZK.num(rates.diamond_inr_per_carat)]);
    summary.push([]);
    summary.push(["Household totals"]);
    summary.push(["Total Zakat due (INR)", round2(household.total_zakat_inr)]);
    summary.push(["Total paid (INR)", round2(household.total_paid_inr)]);
    summary.push(["Total remaining (INR)", round2(Math.max(0, household.total_remaining_inr))]);
    summary.push([]);
    summary.push(["Per member"]);
    summary.push(["Member", "Eligible", "Wealth (INR)", "Nisab (INR)", "Zakat due (INR)", "Paid (INR)", "Remaining (INR)"]);
    household.members.forEach((s) => {
      summary.push([
        s.member_name, s.is_eligible ? "Yes" : "No",
        round2(s.total_wealth_inr), round2(s.nisab_threshold_inr),
        round2(s.zakat_due_inr), round2(s.total_paid_inr), round2(Math.max(0, s.remaining_inr)),
      ]);
    });
    summary.push([]);
    summary.push(["Nisab note", rules.nisab_basis === "silver"
      ? "Hanafi: total wealth compared to silver nisab (" + ZK.NISAB_SILVER_GRAMS + " g)."
      : "Gold nisab (" + ZK.NISAB_GOLD_GRAMS + " g) when gold held, else silver."]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

    // Per-member sheets
    const used = { Summary: true };
    members.forEach((m) => {
      const s = ZK.computeMemberZakat(m, m.assets || [], m.zakat_payments || [], rates, madhab, baseline);
      const rows = [];
      rows.push([m.name + " (" + (m.relationship || "Family") + ")"]);
      rows.push(["Eligible", s.is_eligible ? "Yes" : "No"]);
      rows.push(["Nisab basis", s.nisab_basis]);
      rows.push(["Zakatable wealth (INR)", round2(s.nisab_wealth_inr)]);
      rows.push(["Nisab threshold (INR)", round2(s.nisab_threshold_inr)]);
      rows.push(["Zakat due (INR)", round2(s.zakat_due_inr)]);
      rows.push(["Paid (INR)", round2(s.total_paid_inr)]);
      rows.push(["Remaining (INR)", round2(Math.max(0, s.remaining_inr))]);
      if (s.hawl_pending_wealth_inr > 0) {
        rows.push(["Awaiting hawl (INR)", round2(s.hawl_pending_wealth_inr) + " across " + s.assets_pending_hawl + " asset(s)"]);
      }
      rows.push([]);
      rows.push(["Zakat by component", "INR"]);
      ZK.CHART_KEY_ORDER.concat(["total"]).forEach((k) => {
        const z = ZK.componentZakatValues(s)[k];
        if (k === "total" || (z && z > 0.005)) rows.push([ZK.COMPONENT_LABELS[k] || k, round2(z)]);
      });
      rows.push([]);
      rows.push(["Assets"]);
      rows.push(["Category", "Description", "Details", "Value (INR)"]);
      (m.assets || []).forEach((a) => {
        const val = ZK.effectiveValuationInr(a, rates, baseline);
        rows.push([a.category, a.description || "", assetDetailText(a), round2(val)]);
      });
      rows.push([]);
      rows.push(["Payments"]);
      rows.push(["Given to", "Amount (INR)"]);
      (m.zakat_payments || []).forEach((p) => rows.push([p.given_to, round2(ZK.num(p.amount_inr))]));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), safeSheetName(m.name, used));
    });

    return wb;
  }

  function round2(v) { return Math.round(ZK.num(v) * 100) / 100; }

  function assetDetailText(a) {
    const bits = [];
    if (a.weight_grams) bits.push(ZK.fmtGrams(a.weight_grams) + " g");
    if (a.gem_carats) bits.push(ZK.fmtGrams(a.gem_carats) + " ct");
    if (a.purity_value) bits.push(String(a.purity_value));
    if (a.quantity_count) bits.push(a.quantity_count + " head");
    if (a.asset_subtype) bits.push(a.asset_subtype);
    if (a.is_personal_jewelry) bits.push("personal jewelry");
    if (a.acquired_year) bits.push("since " + a.acquired_year);
    return bits.join(" \u00b7 ");
  }

  function exportReport() {
    const XLSX = global.XLSX;
    const wb = buildReportWorkbook();
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    XLSX.writeFile(wb, "zakat_report_" + stamp + ".xlsx");
  }

  // --- Import ---
  function sheetTable(ws, XLSX) {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
    if (!rows.length) return [];
    const headers = rows[0].map((h) => (h == null ? "" : String(h).trim()));
    const records = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row.some((c) => c != null && String(c).trim() !== "")) continue;
      const rec = {};
      headers.forEach((h, idx) => { if (h) rec[h] = idx < row.length ? row[idx] : null; });
      records.push(rec);
    }
    return records;
  }

  function readMeta(ws, XLSX) {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
    const meta = {};
    for (const row of rows) {
      if (!row || row[0] == null) continue;
      meta[String(row[0]).trim()] = row[1] == null ? "" : String(row[1]).trim();
    }
    return meta;
  }

  function parseImagesTable(rows) {
    const grouped = {};
    for (const row of rows) {
      const aref = row.asset_ref ? String(row.asset_ref).trim() : "";
      if (!aref) continue;
      const idx = parseInt(row.chunk_index, 10);
      const count = parseInt(row.chunk_count, 10);
      const data = row.data == null ? "" : String(row.data);
      const filename = row.filename ? String(row.filename) : "image.jpg";
      const mime = row.mime_type ? String(row.mime_type) : "image/jpeg";
      if (isNaN(idx) || isNaN(count) || !data) continue;
      (grouped[aref] = grouped[aref] || []).push({ idx, count, data, filename, mime });
    }
    const images = {};
    for (const aref of Object.keys(grouped)) {
      const chunks = grouped[aref].sort((a, b) => a.idx - b.idx);
      const expected = chunks[0].count;
      if (chunks.length !== expected) throw new Error("Incomplete image data for asset " + aref);
      const b64 = chunks.map((c) => c.data).join("");
      images[aref] = {
        dataUrl: "data:" + chunks[0].mime + ";base64," + b64,
        filename: chunks[0].filename,
        mime: chunks[0].mime,
      };
    }
    return images;
  }

  function parseBackupArrayBuffer(buf) {
    const XLSX = global.XLSX;
    const wb = XLSX.read(buf, { type: "array" });
    const names = wb.SheetNames;

    if (!names.includes("Meta")) throw new Error("Missing 'Meta' sheet — not a household backup file.");
    const meta = readMeta(wb.Sheets["Meta"], XLSX);
    if (meta.backup_type !== BACKUP_TYPE) throw new Error("Unrecognized backup file type.");
    const version = parseInt(meta.format_version, 10);
    if (isNaN(version) || version > BACKUP_FORMAT_VERSION) {
      throw new Error("Unsupported backup format version " + meta.format_version + ".");
    }

    const settings = names.includes("Settings") ? sheetTable(wb.Sheets["Settings"], XLSX) : [];
    const madhab = settings.length ? (settings[0].madhab || "hanafi") : "hanafi";
    const family_name = settings.length ? String(settings[0].family_name || "").trim() : "";

    let sessionRates = null;
    if (names.includes("SessionRates")) {
      const rr = sheetTable(wb.Sheets["SessionRates"], XLSX);
      if (rr.length) {
        sessionRates = {
          gold_inr_per_gram: ZK.num(rr[0].gold_inr_per_gram),
          silver_inr_per_gram: ZK.num(rr[0].silver_inr_per_gram),
          platinum_inr_per_gram: ZK.num(rr[0].platinum_inr_per_gram),
          diamond_inr_per_carat: ZK.num(rr[0].diamond_inr_per_carat),
        };
      }
    }

    const memberList = names.includes("FamilyMembers") ? sheetTable(wb.Sheets["FamilyMembers"], XLSX) : [];
    const assets = names.includes("Assets") ? sheetTable(wb.Sheets["Assets"], XLSX) : [];
    const snapshots = names.includes("Snapshots") ? sheetTable(wb.Sheets["Snapshots"], XLSX) : [];
    const yearly = names.includes("YearlyRates") ? sheetTable(wb.Sheets["YearlyRates"], XLSX) : [];
    const payments = names.includes("Payments") ? sheetTable(wb.Sheets["Payments"], XLSX) : [];
    const imageRows = names.includes("Images") ? sheetTable(wb.Sheets["Images"], XLSX) : [];
    const images = imageRows.length ? parseImagesTable(imageRows) : {};

    return {
      meta,
      madhab: String(madhab).trim() || "hanafi",
      family_name: family_name,
      session_rates: sessionRates,
      members: memberList,
      assets: assets,
      snapshots: snapshots,
      images: images,
      yearly_rates: yearly,
      payments: payments,
    };
  }

  function importBackupFromArrayBuffer(buf) {
    try {
      const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
      const parsed = parseBackupArrayBuffer(bytes);
      return Promise.resolve(Store.replaceFromBackup(parsed));
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function importBackupFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function (e) {
        importBackupFromArrayBuffer(e.target.result).then(resolve).catch(reject);
      };
      reader.onerror = function () { reject(new Error("Could not read the file.")); };
      reader.readAsArrayBuffer(file);
    });
  }

  global.ZKExcel = {
    exportBackup,
    exportReport,
    buildBackupBuffer,
    importBackupFromFile,
    importBackupFromArrayBuffer,
    parseBackupArrayBuffer,
  };
})(window);
