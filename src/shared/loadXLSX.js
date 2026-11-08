// Load SheetJS for Excel import.
// SheetJS isn't in package.json (the npm-registry copy is stale and unpatched), so on
// the live site an .xlsx upload used to fail with a message telling the *user* to run
// npm. Try a bundled copy first (if someone installs it later), then the official
// SheetJS CDN build as a browser ES module. Cached after the first load.
const CDN = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
let cached = null;
export function loadXLSX() {
  if (!cached) {
    cached = import(/* @vite-ignore */ "xlsx")
      .catch(() => import(/* @vite-ignore */ CDN))
      .then(m => (m && m.read ? m : m.default))
      .catch(err => { cached = null; throw err; });
  }
  return cached;
}
export const XLSX_FAIL_MSG =
  "Couldn't load Excel support (check your internet connection). You can also open the file in Excel and use File → Save As → CSV, then import the CSV.";
