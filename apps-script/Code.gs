/**
 * Work Clock  Google Sheets sync backend.
 * Paste this whole file into Extensions > Apps Script (replace everything),
 * set SECRET below, then Deploy > New deployment > Web app:
 *   Execute as: Me      Who has access: Anyone
 * Copy the /exec URL into the app (Settings > Google Sheets sync).
 */
const SECRET = "CHANGE-ME-TO-SOMETHING-LONG";
const SHEET_NAME = "Shifts";
const HEADERS = ["id", "date", "in", "out", "hours", "earned", "start", "end"];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
    sh.getRange("A:D").setNumberFormat("@"); // keep dates/times as typed text
  }
  return sh;
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function row_(s) {
  return [String(s.id), s.date, s.in, s.out, Number(s.hours) || 0,
          Number(s.earned) || 0, Number(s.start) || "", Number(s.end) || ""];
}

function idMap_(sh) {
  const n = sh.getLastRow() - 1, map = {};
  if (n > 0) sh.getRange(2, 1, n, 1).getValues().forEach((r, i) => { map[String(r[0])] = i + 2; });
  return map;
}

function doGet() { return out_({ ok: true, service: "work-clock" }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let b;
    try { b = JSON.parse(e.postData.contents); } catch (_) { return out_({ ok: false, error: "Bad request" }); }
    if (b.secret !== SECRET) return out_({ ok: false, error: "Wrong secret" });
    const sh = sheet_();

    if (b.action === "ping") return out_({ ok: true });

    if (b.action === "list") {
      const n = sh.getLastRow() - 1;
      const rows = n > 0 ? sh.getRange(2, 1, n, HEADERS.length).getValues() : [];
      return out_({ ok: true, shifts: rows.filter(r => r[0] && r[6] && r[7])
        .map(r => ({ id: String(r[0]), start: Number(r[6]), end: Number(r[7]) })) });
    }

    if (b.action === "upsert" || b.action === "bulk") {
      const list = b.action === "bulk" ? (b.shifts || []) : [b.shift];
      const map = idMap_(sh), fresh = [];
      list.forEach(s => {
        if (!s || !s.id) return;
        const r = map[String(s.id)];
        if (r) sh.getRange(r, 1, 1, HEADERS.length).setValues([row_(s)]);
        else fresh.push(row_(s));
      });
      if (fresh.length) {
        const start = sh.getLastRow() + 1;
        sh.getRange(start, 1, fresh.length, HEADERS.length).setValues(fresh);
      }
      return out_({ ok: true, count: list.length });
    }

    if (b.action === "delete") {
      const r = idMap_(sh)[String(b.id)];
      if (r) sh.deleteRow(r);
      return out_({ ok: true });
    }

    return out_({ ok: false, error: "Unknown action" });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
