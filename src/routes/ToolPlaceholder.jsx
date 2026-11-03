import { useTheme } from "../shared/theme";
import { ToolGlyph } from "../shared/ToolGlyph";

export default function ToolPlaceholder({ tool }) {
  const C = useTheme();
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 28, boxSizing: "border-box" }}>
    <div style={{ maxWidth: 520 }}>
      <div style={{ color: C.accent, marginBottom: 14 }}>
        <ToolGlyph type={tool.glyph} size={30} />
      </div>
      <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, margin: 0, color: C.text }}>
        {tool.name}
      </h1>
      <p style={{ fontSize: 13.5, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>
        {tool.status === "planned"
          ? "Not built yet — on the roadmap."
          : "Route is live. This tool's component hasn't been migrated into the shared shell yet — that's Phase 2."}
      </p>
    </div>
    </div>
  );
}
