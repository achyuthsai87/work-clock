/**
 * Work Clock  Google Sheets sync backend.
 * Paste this whole file into Extensions > Apps Script (replace everything),
 * set SECRET below, then Deploy > New deployment > Web app:
 *   Execute as: Me      Who has access: Anyone
 * Copy the /exec URL into the app (Settings > Google Sheets sync).
 */
const SECRET = "CHANGE-ME-TO-SOMETHING-LONG";   // use 24+ random characters; never share or commit it
const SHEET_NAME = "Shifts";
const HEADERS = ["id", "date", "in", "out", "hours", "earned", "start", "end"];
const MAX_BULK = 5000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange("A:D").setNumberFormat("@"); // plain text: nothing is ever evaluated as a formula
  }
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
  return [String(s.id), txt(s.date), txt(s.in), txt(s.out),
          Math.round((Number(s.hours) || 0) * 100) / 100, Math.round((Number(s.earned) || 0) * 100) / 100, start, end];
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
      return out_({ ok: true, shifts: rows.filter(r => r[0] && r[6] && r[7])
        .map(r => ({ id: String(r[0]), start: Number(r[6]), end: Number(r[7]) })) });
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
