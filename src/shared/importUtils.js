// Shared helpers for the file importers.

const MISSING = /^(na|n\/a|#n\/a|nan|null|none|-|—|\.)$/i;

// Parse one cell into a number, or null when it's blank / NA / not a number.
// - thousands separators ("1,234" → 1234) unless the file is comma-delimited
// - European decimal comma in ";"-delimited files ("0,045" → 0.045, "1,1e-27")
// - ±Inf → ±Infinity is NOT returned: callers treat it as missing.
export function parseLocaleNumber(raw, delim) {
  const s = String(raw == null ? "" : raw).trim();
  if (s === "" || MISSING.test(s)) return null;
  let cand = s;
  if (delim === ";" && /^-?\d+,\d+(e[-+]?\d+)?$/i.test(s)) cand = s.replace(",", ".");
  else if (delim !== "," && /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) cand = s.replace(/,/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cand)) return null;
  const v = parseFloat(cand);
  return isFinite(v) ? v : null;
}

export const isMissingCell = raw => {
  const s = String(raw == null ? "" : raw).trim();
  return s === "" || MISSING.test(s);
};

// Find the header row: real exports often start with a title line ("Experiment: …")
// or a tool comment ("# Program:featureCounts …"). Pick the first row, within the
// first 15, that has at least 2 filled cells and roughly as many cells as the
// typical data row, and is followed by a row containing at least one number.
export function guessHeaderRow(rows) {
  if (!rows || rows.length < 2) return 0;
  const lens = rows.slice(0, 60).map(r => r.filter(c => String(c).trim() !== "").length);
  const freq = {};
  lens.forEach(n => { if (n > 1) freq[n] = (freq[n] || 0) + 1; });
  let mode = 0, best = 0;
  Object.keys(freq).forEach(k => { if (freq[k] > best || (freq[k] === best && +k > mode)) { best = freq[k]; mode = +k; } });
  if (!mode) return 0;
  for (let i = 0; i < Math.min(15, rows.length - 1); i++) {
    if (lens[i] < 2 || lens[i] < mode * 0.6) continue;
    if (/^\s*#/.test(String(rows[i][0] || ""))) continue;
    const next = rows[i + 1] || [];
    if (next.some(c => parseLocaleNumber(c, "\t") !== null)) return i;
  }
  return 0;
}

// featureCounts / HTSeq-style annotation columns that are never samples.
const ANNOT = /^(chr|chrom|chromosome|start|end|stop|strand|length|gene[_ ]?length|biotype|gene[_ ]?biotype|description|gene[_ ]?name|symbol|gene[_ ]?symbol|entrez(id)?|ensembl(id)?)$/i;

// Clean sample headers: "/data/bam/Ctrl_1.sorted.bam" → "Ctrl_1".
export function cleanSampleName(h) {
  let s = String(h || "").trim();
  if (/[\\/]/.test(s)) s = s.split(/[\\/]/).pop();
  s = s.replace(/(\.sorted)?(\.dedup)?\.(bam|sam|cram)$/i, "").replace(/Aligned\.sortedByCoord\.out$/i, "");
  return s;
}

// Which columns to the right of the ID column hold sample values? Skips known
// annotation columns and any column that is mostly non-numeric in the first 200
// data rows. Returns {cols:[index], skipped:[name]}.
export function detectSampleColumns(rows, headerRow, idCol, delim) {
  const hdr = rows[headerRow] || [];
  const width = Math.max(hdr.length, ...(rows.slice(headerRow + 1, headerRow + 30).map(r => r.length)));
  const cols = [], skipped = [];
  const data = rows.slice(headerRow + 1, headerRow + 201);
  for (let c = idCol + 1; c < width; c++) {
    const name = String(hdr[c] || "").trim();
    if (ANNOT.test(name)) { skipped.push(name); continue; }
    let num = 0, filled = 0;
    data.forEach(r => {
      const v = r[c];
      if (isMissingCell(v)) return;
      filled++;
      if (parseLocaleNumber(v, delim) !== null) num++;
    });
    if (filled > 0 && num / filled < 0.8) { skipped.push(name || "column " + (c + 1)); continue; }
    cols.push(c);
  }
  return { cols, skipped };
}

// rows → matrix for the counts-based tools (PCA, heatmaps).
// Genes with any missing/non-numeric value are dropped (complete cases) rather than
// filled with 0 — a fake 0 among real counts creates a huge artificial difference
// that can drag a sample away from its group in PCA.
export function rowsToMatrixClean(rows, delim, headerRow, idCol) {
  const hdr = rows[headerRow] || [];
  const { cols, skipped } = detectSampleColumns(rows, headerRow, idCol, delim);
  const sampleNames = cols.map((c, i) => cleanSampleName(hdr[c]) || ("Sample" + (i + 1)));
  const geneNames = [], values = [];
  let droppedRows = 0, badCells = 0;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => String(c).trim() === "")) continue;
    if (/^\s*#/.test(String(row[0] || ""))) continue;
    const vals = []; let ok = true;
    for (const c of cols) {
      const v = parseLocaleNumber(row[c], delim);
      if (v === null) { ok = false; badCells++; break; }
      vals.push(v);
    }
    if (!ok) { droppedRows++; continue; }
    geneNames.push(String(row[idCol] || "").trim());
    values.push(vals);
  }
  return { sampleNames, geneNames, values, badCells, droppedRows, skippedCols: skipped };
}
