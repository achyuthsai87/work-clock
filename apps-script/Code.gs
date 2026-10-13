/**
 * Work Clock  Google Sheets sync backend.
 * Paste this whole file into Extensions > Apps Script (replace everything),
 * set SECRET below, then Deploy > New deployment > Web app:
 *   Execute as: Me      Who has access: Anyone
 * Copy the /exec URL into the app (Settings > Google Sheets sync).
 */
const SECRET = "CHANGE-ME-TO-SOMETHING-LONG";   // use 24+ random characters; never share or commit it
const SHEET_NAME = "Shifts";
const HEADERS = ["id", "Date", "Day", "Month", "Clock in", "Clock out", "Hours", "Tips", "Earned", "start", "end"];
const COL = { START: 10, END: 11, TIP: 8 };   // 1-based columns the app reads back
const MAX_BULK = 5000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Looks only: header colours, number formats, hidden technical columns. Never blocks syncing if it fails.
function style_(sh) {
  try {
    const h = sh.getRange(1, 1, 1, HEADERS.length);
    h.setFontWeight("bold").setBackground("#2f6fed").setFontColor("#ffffff");
    sh.setFrozenRows(1);
    sh.getRange("A:F").setNumberFormat("@");            // plain text: nothing is ever evaluated as a formula
    sh.getRange("G:G").setNumberFormat("0.00");
    sh.getRange("H:I").setNumberFormat("$#,##0.00");
    sh.hideColumns(1); sh.hideColumns(10, 2);             // id, start, end stay in the sheet but out of sight
    sh.setColumnWidth(2, 110); sh.setColumnWidths(5, 2, 90); sh.setColumnWidths(7, 3, 95);
  } catch (_) {}
}

// A live "Summary" tab: monthly hours / tips / earnings plus all-time totals. Formulas only, written once.
function summary_(ss) {
  try {
    if (ss.getSheetByName("Summary")) return;
    const s = ss.insertSheet("Summary");
    s.getRange("A1:E1").setValues([["Month", "Hours", "Tips", "Earned", "Shifts"]]);
    s.getRange("A2").setFormula('=IFERROR(SORT(UNIQUE(FILTER(Shifts!D2:D,Shifts!D2:D<>"")),1,FALSE),"")');
    s.getRange("B2").setFormula('=ARRAYFORMULA(IF(A2:A="","",SUMIF(Shifts!D:D,A2:A,Shifts!G:G)))');
    s.getRange("C2").setFormula('=ARRAYFORMULA(IF(A2:A="","",SUMIF(Shifts!D:D,A2:A,Shifts!H:H)))');
    s.getRange("D2").setFormula('=ARRAYFORMULA(IF(A2:A="","",SUMIF(Shifts!D:D,A2:A,Shifts!I:I)))');
    s.getRange("E2").setFormula('=ARRAYFORMULA(IF(A2:A="","",COUNTIF(Shifts!D:D,A2:A)))');
    s.getRange("G1:H1").setValues([["All time", ""]]);
    s.getRange("G2:G6").setValues([["Hours"], ["Tips"], ["Earned"], ["Shifts"], ["Average per hour"]]);
    s.getRange("H2").setFormula("=SUM(Shifts!G2:G)");
    s.getRange("H3").setFormula("=SUM(Shifts!H2:H)");
    s.getRange("H4").setFormula("=SUM(Shifts!I2:I)");
    s.getRange("H5").setFormula("=COUNTA(Shifts!A2:A)");
    s.getRange("H6").setFormula("=IFERROR(H4/H2,0)");
    s.getRange("B2:B").setNumberFormat("0.00"); s.getRange("C2:D").setNumberFormat("$#,##0.00");
    s.getRange("H2").setNumberFormat("0.00"); s.getRange("H3:H4").setNumberFormat("$#,##0.00"); s.getRange("H6").setNumberFormat("$#,##0.00");
    s.getRange("A1:E1").setFontWeight("bold").setBackground("#2f6fed").setFontColor("#ffffff");
    s.getRange("G1:H1").setFontWeight("bold").setBackground("#2f6fed").setFontColor("#ffffff");
    s.setFrozenRows(1); s.setColumnWidths(1, 5, 120); s.setColumnWidth(7, 130);
  } catch (_) {}
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  // An older layout? Keep it as a backup tab and start a fresh one (the app re-uploads everything).
  if (sh && sh.getLastRow() > 0 && sh.getRange(1, 1, 1, HEADERS.length).getValues()[0].join("|") !== HEADERS.join("|")) {
    sh.setName(SHEET_NAME + " (old " + Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd HHmm") + ")");
    sh = null;
  }
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); style_(sh); summary_(ss); }
  return sh;
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

// Constant-time comparison so response timing can't leak the secret.
function same_(a, b) {
  a = String(a || ""); b = String(b || "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// Only accept well-formed shifts; anything else is dropped. Text fields are stripped of formula/control characters.
function clean_(s) {
  if (!s || typeof s !== "object" || !ID_RE.test(String(s.id))) return null;
  const start = Number(s.start), end = Number(s.end);
  if (!isFinite(start) || !isFinite(end) || start < 9.46e11 || end < start || end - start > 7 * 864e5) return null;
  const txt = v => String(v == null ? "" : v).replace(/[^\w ,:.\-\/]/g, "").slice(0, 40);
  const tips = Math.round(Math.min(Math.max(Number(s.tips) || 0, 0), 100000) * 100) / 100;
  return [String(s.id), txt(s.date), txt(s.day), txt(s.month), txt(s.in), txt(s.out),
          Math.round((Number(s.hours) || 0) * 100) / 100, tips, Math.round((Number(s.earned) || 0) * 100) / 100, start, end];
}

function idMap_(sh) {
  const n = sh.getLastRow() - 1, map = {};
  if (n > 0) sh.getRange(2, 1, n, 1).getValues().forEach((r, i) => { map[String(r[0])] = i + 2; });
  return map;
}

function doGet() { return out_({ ok: true }); }   // reveals nothing

function doPost(e) {
  // Refuse to run with the placeholder or a weak secret.
  if (SECRET.indexOf("CHANGE-ME") === 0 || SECRET.length < 16) return out_({ ok: false, error: "Set a real SECRET (16+ characters) in the script" });
  let b;
  try {
    if (!e || !e.postData || e.postData.contents.length > 2000000) return out_({ ok: false, error: "Bad request" });
    b = JSON.parse(e.postData.contents);
  } catch (_) { return out_({ ok: false, error: "Bad request" }); }
  if (!b || typeof b !== "object" || !same_(b.secret, SECRET)) {
    Utilities.sleep(1500);                         // slows down guessing
    return out_({ ok: false, error: "Wrong secret" });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();

    if (b.action === "ping") return out_({ ok: true });

    if (b.action === "list") {
      const n = sh.getLastRow() - 1;
      const rows = n > 0 ? sh.getRange(2, 1, n, HEADERS.length).getValues() : [];
      return out_({ ok: true, shifts: rows.filter(r => r[0] && r[9] && r[10])
        .map(r => ({ id: String(r[0]), start: Number(r[9]), end: Number(r[10]), tip: Number(r[7]) || 0 })) });
    }

    if (b.action === "upsert" || b.action === "bulk") {
      const raw = b.action === "bulk" ? b.shifts : [b.shift];
      if (!Array.isArray(raw) || raw.length > MAX_BULK) return out_({ ok: false, error: "Bad request" });
      const rows = raw.map(clean_).filter(Boolean);
      const map = idMap_(sh), fresh = [];
      rows.forEach(r => {
        const at = map[r[0]];
        if (at) sh.getRange(at, 1, 1, HEADERS.length).setValues([r]);
        else fresh.push(r);
      });
      if (fresh.length) sh.getRange(sh.getLastRow() + 1, 1, fresh.length, HEADERS.length).setValues(fresh);
      try { sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).sort({ column: 10, ascending: false }); } catch (_) {}   // newest first
      return out_({ ok: true, count: rows.length });
    }

    if (b.action === "delete") {
      if (!ID_RE.test(String(b.id))) return out_({ ok: false, error: "Bad request" });
      const r = idMap_(sh)[String(b.id)];
      if (r) sh.deleteRow(r);
      return out_({ ok: true });
    }

    return out_({ ok: false, error: "Unknown action" });
  } catch (err) {
    return out_({ ok: false, error: "Server error" });   // no internal details leaked
  } finally {
    lock.releaseLock();
  }
}
