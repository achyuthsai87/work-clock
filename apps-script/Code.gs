/**
 * Work Clock  Google Sheets sync backend.
 * Paste this whole file into Extensions > Apps Script (replace everything),
 * set SECRET below, then Deploy > New deployment > Web app:
 *   Execute as: Me      Who has access: Anyone
 * Copy the /exec URL into the app (Settings > Google Sheets sync).
 */
const SECRET = "CHANGE-ME-TO-SOMETHING-LONG";   // use 24+ random characters; never share or commit it
const SHEET_NAME = "Shifts";
const HEADERS = ["id", "Date", "Day", "Month", "Clock in", "Clock out", "Hours", "Tips", "Earned", "start", "end", "Note", "Rate", "Job", "jobId", "Break", "Break paid", "In place", "Out place", "In from work (m)", "Out from work (m)"];
const COL = { START: 10, END: 11, TIP: 8 };   // 1-based columns the app reads back
const MAX_BULK = 5000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Looks only: header colours, number formats, hidden technical columns. Never blocks syncing if it fails.
function style_(sh) {
  try {
    const h = sh.getRange(1, 1, 1, HEADERS.length);
    h.setFontWeight("bold").setBackground("#2f6fed").setFontColor("#ffffff");
    sh.setFrozenRows(1);
    sh.getRange("A:F").setNumberFormat("@"); sh.getRange("L:L").setNumberFormat("@");            // plain text: nothing is ever evaluated as a formula
    sh.getRange("G:G").setNumberFormat("0.00");
    sh.getRange("H:I").setNumberFormat("$#,##0.00");
    sh.hideColumns(1); sh.hideColumns(10, 2);             // id, start, end stay in the sheet but out of sight
    sh.setColumnWidth(2, 110); sh.setColumnWidth(12, 200); sh.getRange("N:N").setNumberFormat("@"); sh.getRange("O:O").setNumberFormat("@"); sh.hideColumns(15); sh.getRange("M:M").setNumberFormat("$#,##0.00"); sh.setColumnWidths(5, 2, 90); sh.setColumnWidths(7, 3, 95);
  } catch (_) {}
}

const PAY_SHEET = "Payments";
const PAY_HEADERS = ["id", "Date", "Month", "Amount", "Note", "ts", "Gross", "Job"];

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
  else {
    if (p.getRange(1, 7).getValue() !== "Gross") p.getRange(1, 7).setValue("Gross").setFontWeight("bold").setBackground("#2f6fed").setFontColor("#ffffff");
    if (p.getRange(1, 8).getValue() !== "Job") p.getRange(1, 8).setValue("Job").setFontWeight("bold").setBackground("#2f6fed").setFontColor("#ffffff");
  }
  return p;
}

// Punches: "clock in" / "clock out" requests sent from an iPhone Shortcut. The app picks them up next time it opens.
const PUNCH_SHEET = "Punches";
const PUNCH_HEADERS = ["id", "kind", "ts", "Time"];
function punchSheet_(ss) {
  let p = ss.getSheetByName(PUNCH_SHEET);
  if (!p) p = ss.insertSheet(PUNCH_SHEET);
  if (p.getLastRow() === 0) { p.appendRow(PUNCH_HEADERS); try { p.getRange(1, 1, 1, 4).setFontWeight("bold"); p.setFrozenRows(1); p.hideColumns(1); p.hideColumns(3); } catch (_) {} }
  return p;
}

// App data that isn't a shift or a payment (jobs, planned shifts, days off, expenses, a few settings), stored as small JSON blobs.
const DATA_SHEET = "AppData";
function dataSheet_(ss) {
  let d = ss.getSheetByName(DATA_SHEET);
  if (!d) d = ss.insertSheet(DATA_SHEET);
  if (d.getLastRow() === 0) { d.appendRow(["key", "json", "updated"]); try { d.getRange("A:B").setNumberFormat("@"); d.getRange("A1:C1").setFontWeight("bold").setBackground("#2f6fed").setFontColor("#ffffff"); d.setFrozenRows(1); d.setColumnWidth(2, 300); } catch (_) {} }
  return d;
}
const KV_KEY_RE = /^[a-z0-9-]{1,24}$/, KV_MAX = 45000;

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

// Your numbers (pay rate, weekly goal, payday) so a restore brings everything back.
function settingsSheet_(ss) {
  let s = ss.getSheetByName("Settings");
  if (!s) {
    s = ss.insertSheet("Settings");
    s.getRange(1, 1, 1, 2).setValues([["Setting", "Value"]]);
    s.getRange(2, 1, 5, 2).setValues([["rate", 14], ["goal", 0], ["payday", 0], ["breakMin", 0], ["breakAfter", 6]]);
    try { s.getRange("A1:B1").setFontWeight("bold").setBackground("#2f6fed").setFontColor("#ffffff"); s.setFrozenRows(1); s.setColumnWidth(1, 120);
      s.getRange("C1").setValue("0 = not set (goal, payday, break). The app keeps these in sync.").setFontColor("#888888"); } catch (_) {}
  }
  return s;
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  // An older layout? Keep it as a backup tab and start a fresh one (the app re-uploads everything).
  const BASE = 11;                          // the first 11 columns are the stable layout; Note and Rate were added later, in place
  if (sh && sh.getLastRow() > 0) {
    const hdr = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    if (hdr.slice(0, BASE).join("|") === HEADERS.slice(0, BASE).join("|")) {
      for (let i = BASE; i < HEADERS.length; i++) if (!hdr[i]) sh.getRange(1, i + 1).setValue(HEADERS[i]);   // add newer columns in place
      try { sh.getRange("L:L").setNumberFormat("@"); sh.getRange("M:M").setNumberFormat("$#,##0.00"); sh.getRange("N:O").setNumberFormat("@"); sh.hideColumns(15); sh.getRange("R:S").setNumberFormat("@"); sh.getRange("T:U").setNumberFormat("0"); } catch (_) {}
    }
  }
  if (sh && sh.getLastRow() > 0 && sh.getRange(1, 1, 1, BASE).getValues()[0].join("|") !== HEADERS.slice(0, BASE).join("|")) {
    sh.setName(SHEET_NAME + " (old " + Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd HHmm") + ")");
    sh = null;
  }
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); style_(sh); }
  paySheet_(ss);
  settingsSheet_(ss);
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

// Where the shift started/ended: "lat,lng,accuracy-in-metres", digits only. Anything else is dropped.
function place_(v) {
  const m = /^(-?\d{1,2}(?:\.\d{1,6})?),(-?\d{1,3}(?:\.\d{1,6})?),(\d{1,5})$/.exec(String(v == null ? "" : v));
  return m && Math.abs(Number(m[1])) <= 90 && Math.abs(Number(m[2])) <= 180 ? m[0] : "";
}
function dist_(v) { return (v === "" || v == null || !isFinite(Number(v)) || Number(v) < 0 || Number(v) > 1e7) ? "" : Math.round(Number(v)); }

// Only accept well-formed shifts; anything else is dropped. Text fields are stripped of formula/control characters.
function clean_(s) {
  if (!s || typeof s !== "object" || !ID_RE.test(String(s.id))) return null;
  const start = Number(s.start), end = Number(s.end);
  if (!isFinite(start) || !isFinite(end) || start < 9.46e11 || end < start || end - start > 7 * 864e5) return null;
  const txt = v => String(v == null ? "" : v).replace(/[^\w ,:.\-\/]/g, "").replace(/^[\-]+/, "").slice(0, 40);
  const note = String(s.note == null ? "" : s.note).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/^[\s=+\-@]+/, "").trim().slice(0, 80);
  const tips = Math.round(Math.min(Math.max(Number(s.tips) || 0, 0), 100000) * 100) / 100;
  return [String(s.id), txt(s.date), txt(s.day), txt(s.month), txt(s.in), txt(s.out),
          Math.round((Number(s.hours) || 0) * 100) / 100, tips, Math.round((Number(s.earned) || 0) * 100) / 100, start, end, note,
          (s.rate === "" || s.rate == null || !isFinite(Number(s.rate)) || Number(s.rate) < 0 || Number(s.rate) > 100000) ? "" : Number(s.rate),
          txt(s.jobName).slice(0, 24), ID_RE.test(String(s.job || "")) ? String(s.job) : "",
          (s.brk === "" || s.brk == null || !isFinite(Number(s.brk)) || Number(s.brk) < 0 || Number(s.brk) > 720) ? "" : Math.round(Number(s.brk)),
          (s.brkPaid === 1 || s.brkPaid === true || s.brkPaid === "1") ? 1 : "",
          place_(s.pin), place_(s.pout), dist_(s.dIn), dist_(s.dOut)];
}

// Payments the owner made to you.
function cleanPay_(p) {
  if (!p || typeof p !== "object" || !ID_RE.test(String(p.id))) return null;
  const ts = Number(p.ts), amt = Math.round(Number(p.amount) * 100) / 100;
  if (!isFinite(ts) || ts < 9.46e11 || !isFinite(amt) || amt <= 0 || amt > 1e7) return null;
  const txt = (v, n) => String(v == null ? "" : v).replace(/[^\w ,:.\-\/]/g, "").replace(/^[\-]+/, "").slice(0, n);
  const g = Math.round(Number(p.gross) * 100) / 100;
  return [String(p.id), txt(p.date, 40), txt(p.month, 10), amt, txt(p.note, 60), ts, (p.gross != null && isFinite(g) && g >= amt && g <= 1e7) ? g : "", ID_RE.test(String(p.job || "")) ? String(p.job) : ""];
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

    if (b.action === "ping") { let nm = ""; try { nm = String(SpreadsheetApp.getActiveSpreadsheet().getName() || "").slice(0, 60); } catch (e) {} return out_({ ok: true, sheet: nm }); }

    if (b.action === "list") {
      const n = sh.getLastRow() - 1;
      const rows = n > 0 ? sh.getRange(2, 1, n, HEADERS.length).getValues() : [];
      return out_({ ok: true, shifts: rows.filter(r => r[0] && r[9] && r[10])
        .map(r => ({ id: String(r[0]), start: Number(r[9]), end: Number(r[10]), tip: Number(r[7]) || 0, note: String(r[11] || ""), rate: r[12] === "" || r[12] == null ? null : Number(r[12]), job: String(r[14] || ""), brk: r[15] === "" || r[15] == null ? null : Number(r[15]), brkPaid: r[16] == 1 ? 1 : 0, pin: String(r[17] || ""), pout: String(r[18] || "") })) });
    }

    if (b.action === "sget") {
      const s = settingsSheet_(SpreadsheetApp.getActiveSpreadsheet()), out = {};
      s.getRange(2, 1, Math.max(1, Math.min(5, s.getLastRow() - 1)), 2).getValues().forEach(r => { out[String(r[0])] = Number(r[1]); });
      return out_({ ok: true, settings: out });
    }

    if (b.action === "sset") {
      const x = b.settings || {}, s = settingsSheet_(SpreadsheetApp.getActiveSpreadsheet());
      const rate = Number(x.rate), goal = Number(x.goal), payday = Math.round(Number(x.payday));
      if (isFinite(rate) && rate >= 0 && rate <= 100000) s.getRange(2, 2).setValue(rate);
      if (isFinite(goal) && goal >= 0 && goal <= 1000000) s.getRange(3, 2).setValue(goal);
      if (isFinite(payday) && payday >= 0 && payday <= 28) s.getRange(4, 2).setValue(payday);
      const bm = Math.round(Number(x.breakMin)), ba = Number(x.breakAfter);
      if (isFinite(bm) && bm >= 0 && bm <= 120) s.getRange(5, 1, 1, 2).setValues([["breakMin", bm]]);
      if (isFinite(ba) && ba >= 1 && ba <= 24) s.getRange(6, 1, 1, 2).setValues([["breakAfter", ba]]);
      return out_({ ok: true });
    }

    if (b.action === "kvget") {
      const d = dataSheet_(SpreadsheetApp.getActiveSpreadsheet()), n = d.getLastRow() - 1, out = {};
      (n > 0 ? d.getRange(2, 1, n, 2).getValues() : []).forEach(r => { if (KV_KEY_RE.test(String(r[0])) && String(r[1]).length <= KV_MAX) out[String(r[0])] = String(r[1]); });
      return out_({ ok: true, data: out });
    }

    if (b.action === "kvset") {
      const key = String(b.key), val = typeof b.value === "string" ? b.value : "";
      if (!KV_KEY_RE.test(key) || val.length > KV_MAX) return out_({ ok: false, error: "Bad request" });
      try { JSON.parse(val); } catch (_) { return out_({ ok: false, error: "Bad request" }); }
      const d = dataSheet_(SpreadsheetApp.getActiveSpreadsheet()), n = d.getLastRow() - 1;
      const keys = n > 0 ? d.getRange(2, 1, n, 1).getValues().map(r => String(r[0])) : [];
      const at = keys.indexOf(key), row = [key, val, Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")];
      if (at >= 0) d.getRange(at + 2, 1, 1, 3).setValues([row]);
      else if (keys.length >= 60) return out_({ ok: false, error: "Bad request" });
      else d.getRange(d.getLastRow() + 1, 1, 1, 3).setValues([row]);
      return out_({ ok: true });
    }

    if (b.action === "plist") {
      const p = paySheet_(SpreadsheetApp.getActiveSpreadsheet()), n = p.getLastRow() - 1;
      const rows = n > 0 ? p.getRange(2, 1, n, PAY_HEADERS.length).getValues() : [];
      return out_({ ok: true, payments: rows.filter(r => r[0] && r[5])
        .map(r => ({ id: String(r[0]), ts: Number(r[5]), amount: Number(r[3]) || 0, note: String(r[4] || ""), gross: r[6] === "" || r[6] == null ? undefined : Number(r[6]), job: String(r[7] || "") })) });
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

    if (b.action === "punch") {
      const kind = String(b.kind);
      if (kind !== "in" && kind !== "out") return out_({ ok: false, error: "Bad request" });
      const p = punchSheet_(SpreadsheetApp.getActiveSpreadsheet()), n = p.getLastRow() - 1, now = Date.now();
      if (n > 200) return out_({ ok: false, error: "Open the app to catch up first" });
      const last = n > 0 ? p.getRange(n + 1, 1, 1, 3).getValues()[0] : null;
      if (last && String(last[1]) === kind && now - Number(last[2]) < 20000) return out_({ ok: true, duplicate: true });   // double-tap guard
      p.appendRow([Utilities.getUuid().replace(/-/g, "").slice(0, 16), kind, now, Utilities.formatDate(new Date(now), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")]);
      return out_({ ok: true, kind: kind });
    }

    if (b.action === "punches") {
      const p = punchSheet_(SpreadsheetApp.getActiveSpreadsheet()), n = p.getLastRow() - 1;
      const rows = n > 0 ? p.getRange(2, 1, n, 3).getValues() : [];
      return out_({ ok: true, punches: rows.filter(r => r[0] && (r[1] === "in" || r[1] === "out") && r[2]).map(r => ({ id: String(r[0]), kind: String(r[1]), ts: Number(r[2]) })) });
    }

    if (b.action === "punchdel") {
      const ids = Array.isArray(b.ids) ? b.ids.map(String).filter(x => ID_RE.test(x)).slice(0, 500) : [];
      const p = punchSheet_(SpreadsheetApp.getActiveSpreadsheet()), n = p.getLastRow() - 1;
      if (n > 0 && ids.length) {
        const vals = p.getRange(2, 1, n, 1).getValues();
        for (let i = n - 1; i >= 0; i--) if (ids.indexOf(String(vals[i][0])) >= 0) p.deleteRow(i + 2);
      }
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
