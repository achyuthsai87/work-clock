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

const PAY_SHEET = "Payments";
const PAY_HEADERS = ["id", "Date", "Month", "Amount", "Note", "ts"];

function payStyle_(p) {
  try {
    p.getRange(1, 1, 1, PAY_HEADERS.length).setFontWeight("bold").setBackground("#2f6fed").setFontColor("#ffffff");
    p.setFrozenRows(1);
    p.getRange("A:C").setNumberFormat("@"); p.getRange("E:E").setNumberFormat("@");
    p.getRange("D:D").setNumberFormat("$#,##0.00");
    p.hideColumns(1); p.hideColumns(6);
    p.setColumnWidth(2, 110); p.setColumnWidth(5, 200);
  } catch (_) {}
}

function paySheet_(ss) {
  let p = ss.getSheetByName(PAY_SHEET);
  if (!p) p = ss.insertSheet(PAY_SHEET);
  if (p.getLastRow() === 0) { p.appendRow(PAY_HEADERS); payStyle_(p); }
  return p;
}

// A live "Summary" tab: per month hours / tips / earned / received / balance, plus all-time totals. Formulas only.
// Rebuilt automatically when the layout version below changes.
function summary_(ss) {
  try {
    let s = ss.getSheetByName("Summary");
    if (s && s.getRange("K1").getValue() === "v2") return;
    if (!s) s = ss.insertSheet("Summary"); else s.clear();
    s.getRange("A1:G1").setValues([["Month", "Hours", "Tips", "Earned", "Received", "Balance", "Shifts"]]);
    const MON = 'UNIQUE({Shifts!D2:D;Payments!C2:C})';
    s.getRange("A2").setFormula('=IFERROR(SORT(FILTER(' + MON + ',' + MON + '<>""),1,FALSE),"")');
    const sumif = (col, sheetName, rngCol) => '=ARRAYFORMULA(IF(A2:A="","",SUMIF(' + sheetName + '!' + col + ',A2:A,' + sheetName + '!' + rngCol + ')))';
    s.getRange("B2").setFormula(sumif("D:D", "Shifts", "G:G"));
    s.getRange("C2").setFormula(sumif("D:D", "Shifts", "H:H"));
    s.getRange("D2").setFormula(sumif("D:D", "Shifts", "I:I"));
    s.getRange("E2").setFormula(sumif("C:C", "Payments", "D:D"));
    s.getRange("F2").setFormula('=ARRAYFORMULA(IF(A2:A="","",D2:D-E2:E))');
    s.getRange("G2").setFormula('=ARRAYFORMULA(IF(A2:A="","",COUNTIF(Shifts!D:D,A2:A)))');
    s.getRange("I1:J1").setValues([["All time", ""]]);
    s.getRange("I2:I8").setValues([["Hours"], ["Tips"], ["Earned"], ["Received"], ["Still owed"], ["Shifts"], ["Average per hour"]]);
    s.getRange("J2").setFormula("=SUM(Shifts!G2:G)");
    s.getRange("J3").setFormula("=SUM(Shifts!H2:H)");
    s.getRange("J4").setFormula("=SUM(Shifts!I2:I)");
    s.getRange("J5").setFormula("=SUM(Payments!D2:D)");
    s.getRange("J6").setFormula("=J4-J5");
    s.getRange("J7").setFormula("=COUNTA(Shifts!A2:A)");
    s.getRange("J8").setFormula("=IFERROR(J4/J2,0)");
    s.getRange("B2:B").setNumberFormat("0.00"); s.getRange("C2:F").setNumberFormat("$#,##0.00");
    s.getRange("J2").setNumberFormat("0.00"); s.getRange("J3:J6").setNumberFormat("$#,##0.00"); s.getRange("J8").setNumberFormat("$#,##0.00");
    s.getRange("A1:G1").setFontWeight("bold").setBackground("#2f6fed").setFontColor("#ffffff");
    s.getRange("I1:J1").setFontWeight("bold").setBackground("#2f6fed").setFontColor("#ffffff");
    s.getRange("I6:J6").setFontWeight("bold");
    s.setFrozenRows(1); s.setColumnWidths(1, 7, 105); s.setColumnWidth(9, 130); s.setColumnWidth(10, 100);
    s.getRange("K1").setValue("v2").setFontColor("#ffffff");
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
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); style_(sh); }
  paySheet_(ss);
  summary_(ss);
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

// Payments the owner made to you.
function cleanPay_(p) {
  if (!p || typeof p !== "object" || !ID_RE.test(String(p.id))) return null;
  const ts = Number(p.ts), amt = Math.round(Number(p.amount) * 100) / 100;
  if (!isFinite(ts) || ts < 9.46e11 || !isFinite(amt) || amt <= 0 || amt > 1e7) return null;
  const txt = (v, n) => String(v == null ? "" : v).replace(/[^\w ,:.\-\/]/g, "").slice(0, n);
  return [String(p.id), txt(p.date, 40), txt(p.month, 10), amt, txt(p.note, 60), ts];
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

    if (b.action === "plist") {
      const p = paySheet_(SpreadsheetApp.getActiveSpreadsheet()), n = p.getLastRow() - 1;
      const rows = n > 0 ? p.getRange(2, 1, n, PAY_HEADERS.length).getValues() : [];
      return out_({ ok: true, payments: rows.filter(r => r[0] && r[5])
        .map(r => ({ id: String(r[0]), ts: Number(r[5]), amount: Number(r[3]) || 0, note: String(r[4] || "") })) });
    }

    if (b.action === "pupsert" || b.action === "pbulk") {
      const raw = b.action === "pbulk" ? b.payments : [b.payment];
      if (!Array.isArray(raw) || raw.length > MAX_BULK) return out_({ ok: false, error: "Bad request" });
      const p = paySheet_(SpreadsheetApp.getActiveSpreadsheet()), rows = raw.map(cleanPay_).filter(Boolean);
      const map = idMap_(p), fresh = [];
      rows.forEach(r => { const at = map[r[0]]; if (at) p.getRange(at, 1, 1, PAY_HEADERS.length).setValues([r]); else fresh.push(r); });
      if (fresh.length) p.getRange(p.getLastRow() + 1, 1, fresh.length, PAY_HEADERS.length).setValues(fresh);
      return out_({ ok: true, count: rows.length });
    }

    if (b.action === "pdelete") {
      if (!ID_RE.test(String(b.id))) return out_({ ok: false, error: "Bad request" });
      const p = paySheet_(SpreadsheetApp.getActiveSpreadsheet()), r = idMap_(p)[String(b.id)];
      if (r) p.deleteRow(r);
      return out_({ ok: true });
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
