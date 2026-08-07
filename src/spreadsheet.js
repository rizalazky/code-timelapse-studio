const fs = require("fs");

/**
 * Minimal RFC4180-ish CSV parser. Handles quoted fields containing commas,
 * newlines, and escaped "" quotes — needed here because the "Kode HTML"
 * column is a full multi-line HTML/CSS/JS blob sitting inside one quoted
 * cell. A regex split-on-comma would shred it, so this walks char by char.
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // last row if the file doesn't end with a trailing newline
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function needsQuoting(field) {
  return /[",\n\r]/.test(field);
}

function quoteField(field) {
  const s = field == null ? "" : String(field);
  if (!needsQuoting(s)) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function stringifyCSV(rows) {
  return rows.map((row) => row.map(quoteField).join(",")).join("\r\n") + "\r\n";
}

function isBlankRow(r) {
  return !r || r.length === 0 || (r.length === 1 && (!r[0] || r[0].trim() === ""));
}

/**
 * Reads the sheet and returns { headers, records }, where each record is a
 * plain object keyed by header name (e.g. record["Kode HTML (full, siap
 * dipakai)"], record.STATUS, record.No, ...).
 */
function readSheet(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = parseCSV(text);
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0];
  const records = rows
    .slice(1)
    .filter((r) => !isBlankRow(r))
    .map((r) => {
      const rec = {};
      headers.forEach((h, colIdx) => {
        rec[h] = r[colIdx] != null ? r[colIdx] : "";
      });
      return rec;
    });
  return { headers, records };
}

function isDone(record) {
  return (record.STATUS || "").trim().toLowerCase() === "done";
}

/** First record whose STATUS isn't "done" (blank counts as not done). */
function findNextPending(records) {
  return records.find((r) => !isDone(r)) || null;
}

/**
 * Marks the row identified by its `No` column as "done", rewriting the
 * file in place while leaving every other row/cell untouched.
 */
function markDone(filePath, no) {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = parseCSV(text);
  if (rows.length === 0) throw new Error("Spreadsheet kosong");

  const headers = rows[0];
  const noCol = headers.indexOf("No");
  const statusCol = headers.indexOf("STATUS");
  if (noCol === -1 || statusCol === -1) {
    throw new Error("Kolom 'No' atau 'STATUS' tidak ditemukan di spreadsheet");
  }

  let found = false;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (isBlankRow(r)) continue;
    if (String(r[noCol]) === String(no)) {
      while (r.length <= statusCol) r.push("");
      r[statusCol] = "done";
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`Baris dengan No=${no} tidak ditemukan di spreadsheet`);

  fs.writeFileSync(filePath, stringifyCSV(rows));
  return true;
}

module.exports = { parseCSV, stringifyCSV, readSheet, isDone, findNextPending, markDone };
