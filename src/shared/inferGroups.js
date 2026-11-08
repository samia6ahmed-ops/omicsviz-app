// Guess experimental groups from sample names by stripping a trailing
// replicate number: Ctrl_1, Ctrl_2 -> "Ctrl"; WT-1 -> "WT"; KO.2 -> "KO";
// Tau3 -> "Tau"; Model_rep1 -> "Model".
// Returns {sampleName: group} or null when the names don't form a usable
// pattern (fewer than 2 groups, or every sample ends up in its own group).
const TRAILING_REP = /^(.*?)(?:[\s_.-]+(?:rep|replicate|sample|r|s))?[\s_.-]*\d+$/i;

export function inferGroups(names) {
  if (!names || names.length < 2) return null;
  const map = {};
  for (const n of names) {
    const s = String(n).trim();
    const m = s.match(TRAILING_REP);
    const base = (m && m[1] ? m[1] : s).replace(/[\s_.-]+$/, "");
    if (!base) return null;
    map[n] = base;
  }
  const groups = new Set(Object.values(map));
  if (groups.size < 2 || groups.size >= names.length) return null;
  return map;
}

// Used by each tool's "new samples appeared" effect: if every sample is still
// unassigned (or on the default "Group 1"), apply the guess to all of them;
// otherwise only give brand-new samples the default group.
export function withDefaultGroups(prev, names, fallback = "Group 1") {
  if (!names.some(s => !prev[s])) return prev;
  const allDefault = names.every(s => !prev[s] || prev[s] === fallback);
  const guess = allDefault ? inferGroups(names) : null;
  const next = { ...prev };
  names.forEach(s => { if (guess) next[s] = guess[s]; else if (!next[s]) next[s] = fallback; });
  return next;
}
