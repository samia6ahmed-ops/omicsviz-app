import { useState } from "react";
import { useTheme } from "./theme";
import { inferGroups } from "./inferGroups";

// "Auto-detect from names" for a Groups panel: Ctrl_1…Ctrl_4 -> "Ctrl", etc.
export default function AutoGroupButton({ sampleNames, setSampleGroups }) {
  const t = useTheme();
  const [msg, setMsg] = useState("");
  const run = () => {
    const g = inferGroups(sampleNames);
    if (!g) { setMsg("No naming pattern found. Name samples like Ctrl_1, Ctrl_2, KO_1… or type the groups below."); return; }
    setSampleGroups(prev => ({ ...prev, ...g }));
    const n = new Set(Object.values(g)).size;
    setMsg("Found " + n + " groups from sample names.");
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <button onClick={run} style={{ width: "100%", padding: "7px 10px", fontSize: 11, fontWeight: 600, borderRadius: 7, cursor: "pointer",
        border: "1px solid " + t.accent, background: "transparent", color: t.accent }}>
        Auto-detect groups from sample names
      </button>
      {msg && <div style={{ fontSize: 10, color: t.muted, marginTop: 5, lineHeight: 1.5 }}>{msg}</div>}
    </div>
  );
}
