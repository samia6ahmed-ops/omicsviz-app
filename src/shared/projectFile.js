// Validate a project file before handing it to a tool's loadProject.
// Previously every tool did try{onLoad(JSON.parse(text))}catch(_){} — a damaged file
// was ignored with no message, and a project from a *different* tool was loaded
// as-is (MA Plot crashed on a Volcano project; the others showed an empty plot).
const NAMES = {
  "volcano-plot": "Volcano Plot", "ma-plot": "MA Plot", "pca-plot": "PCA Plot",
  "heatmap": "Expression Heatmap", "correlation-heatmap": "Correlation Heatmap",
  "venn-diagram": "Venn / UpSet", "pathway-suite": "Pathway Suite",
};

// Older Volcano and Pathway files carry no "tool" tag; recognise them by shape.
function toolOf(d) {
  if (d.tool) return d.tool;
  if (d.activeId && d.version === undefined) return "pathway-suite";
  if (d.version === 2) return "volcano-plot";
  return null;
}

export function toast(msg) {
  try {
    const el = document.createElement("div");
    el.textContent = msg;
    el.setAttribute("role", "alert");
    Object.assign(el.style, {
      position: "fixed", left: "50%", bottom: "28px", transform: "translateX(-50%)", zIndex: 9999,
      maxWidth: "min(520px, calc(100vw - 32px))", padding: "11px 16px", borderRadius: "9px",
      background: "#991B1B", color: "#fff", font: "600 13px/1.45 Inter, system-ui, sans-serif",
      boxShadow: "0 8px 24px rgba(0,0,0,.25)", cursor: "pointer",
    });
    el.onclick = () => el.remove();
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  } catch (_) { /* no DOM */ }
}

export function readProjectText(text, expected, onLoad) {
  let d;
  try { d = JSON.parse(text); } catch (_) { toast("That file isn't a readable Omilytix project (.json)."); return; }
  if (!d || typeof d !== "object" || !Array.isArray(d.sheets) || !d.sheets.length) {
    toast("That file isn't an Omilytix project — it has no sheets."); return;
  }
  const t = toolOf(d);
  if (t && t !== expected) {
    toast(`This is a ${NAMES[t] || t} project. Open it from ${NAMES[t] || "that tool"} instead.`); return;
  }
  if (!t && (expected === "volcano-plot" || expected === "pathway-suite")) { /* untagged legacy file */ }
  else if (!t) { toast("This project file doesn't say which tool it belongs to, so it can't be opened here."); return; }
  try { onLoad(d); } catch (e) { toast("Couldn't open that project: " + (e && e.message ? e.message : "unknown error")); }
}
