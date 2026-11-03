import { createContext, useContext } from "react";

// Design tokens — copied verbatim from VolcanoPlot/MAPlot/PCAPlot/Heatmap
// so the app shell and every migrated tool share one identical palette.
export const LIGHT = {
  bg: "#F0F2F5", panel: "#FFFFFF", panel2: "#F6F8FA", border: "#DDE1E7",
  accent: "#2563EB", up: "#DC2626", down: "#2563EB", ns: "#94A3B8",
  text: "#1E2736", muted: "#64748B", grid: "#E2E8F0", success: "#16A34A",
  warn: "#D97706", danger: "#DC2626",
  tip: "#1E293B", shadow: "0 2px 12px rgba(0,0,0,.08)",
  cBg: "#FFFFFF", cBorder: "#DDE1E7", cHdr: "#F6F8FA",
  cSel: "rgba(37,99,235,.07)", cFocus: "#2563EB",
  tag: "#EFF6FF", tagText: "#1D4ED8",
};

export const DARK = {
  bg: "#0F1117", panel: "#1A1D27", panel2: "#22263A", border: "#2D3149",
  accent: "#60A5FA", up: "#F87171", down: "#60A5FA", ns: "#64748B",
  text: "#E8ECF4", muted: "#94A3B8", grid: "#2D3149", success: "#4ADE80",
  warn: "#FBBF24", danger: "#F87171",
  tip: "#0F172A", shadow: "0 2px 12px rgba(0,0,0,.5)",
  cBg: "#0F1117", cBorder: "#2D3149", cHdr: "#1A1D27",
  cSel: "rgba(96,165,250,.1)", cFocus: "#60A5FA",
  tag: "#1E3A5F", tagText: "#93C5FD",
};

export const ThemeCtx = createContext(LIGHT);
export const useTheme = () => useContext(ThemeCtx);
