import { useTheme } from "../shared/theme";
import { ToolGlyph } from "../shared/ToolGlyph";

export default function UnderConstruction({ umbrella }) {
  const C = useTheme();
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 28, boxSizing: "border-box" }}>
      <div style={{ maxWidth: 480 }}>
        <div style={{ color: C.muted, marginBottom: 14 }}>
          <ToolGlyph type={umbrella.glyph} size={30} />
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, margin: 0, color: C.text }}>
          {umbrella.name}
        </h1>
        <div
          style={{
            display: "inline-block",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: C.muted,
            background: C.panel2,
            border: "1px solid " + C.border,
            borderRadius: 20,
            padding: "3px 10px",
            marginTop: 10,
          }}
        >
          UNDER CONSTRUCTION
        </div>
        <p style={{ fontSize: 13.5, color: C.muted, marginTop: 14, lineHeight: 1.6 }}>
          {umbrella.name} tools aren't built yet — this section is on the roadmap.
          Transcriptomics is fully available today; check back here as {umbrella.name.toLowerCase()} support comes online.
        </p>
      </div>
    </div>
  );
}
