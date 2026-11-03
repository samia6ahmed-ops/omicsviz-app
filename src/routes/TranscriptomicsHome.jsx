import { Link } from "react-router-dom";
import { useTheme } from "../shared/theme";
import { ToolGlyph } from "../shared/ToolGlyph";
import { UMBRELLAS } from "../shared/tools";

export default function TranscriptomicsHome() {
  const C = useTheme();
  const tools = UMBRELLAS.find((u) => u.id === "transcriptomics").tools;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 28, boxSizing: "border-box" }}>
    <div style={{ maxWidth: 980 }}>
      <div style={{ marginBottom: 30 }}>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: 0, color: C.text }}>
          Transcriptomics
        </h1>
        <p style={{ fontSize: 13.5, color: C.muted, marginTop: 6, maxWidth: 560 }}>
          Pick a plot. Every tool exports 300dpi, journal-sized figures — and once you're signed in, saves back to your workspace.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
        {tools.map((t) => {
          const disabled = t.status === "planned";
          const card = (
            <div
              style={{
                border: "1px solid " + C.border,
                borderRadius: 10,
                padding: 18,
                background: C.panel,
                height: "100%",
                boxSizing: "border-box",
                opacity: disabled ? 0.55 : 1,
                transition: "border-color .15s",
              }}
            >
              <div style={{ color: C.accent, marginBottom: 10 }}>
                <ToolGlyph type={t.glyph} size={22} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>
                {t.name}
                {disabled && <span style={{ fontSize: 9.5, fontWeight: 700, color: C.muted, marginLeft: 8 }}>SOON</span>}
              </div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>{t.short}</div>
            </div>
          );
          return disabled ? (
            <div key={t.id}>{card}</div>
          ) : (
            <Link key={t.id} to={t.path} style={{ textDecoration: "none" }}>
              {card}
            </Link>
          );
        })}
      </div>
    </div>
    </div>
  );
}
