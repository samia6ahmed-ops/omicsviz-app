import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTheme } from "./theme";
import { ToolGlyph } from "./ToolGlyph";
import { LogoMark } from "./LogoMark";
import { UMBRELLAS } from "./tools";

export default function Sidebar() {
  const C = useTheme();
  const location = useLocation();

  // The umbrella matching the current URL starts expanded; otherwise only
  // Transcriptomics (the only one with real tools) starts expanded.
  const currentUmbrella = UMBRELLAS.find((u) => location.pathname.startsWith(u.path))?.id;
  const [openId, setOpenId] = useState(currentUmbrella || "transcriptomics");

  return (
    <nav
      style={{
        width: 240,
        flexShrink: 0,
        height: "100%",
        background: C.panel,
        borderRight: "1px solid " + C.border,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      <div style={{ padding: "22px 20px 16px" }}>
        <NavLink to="/about" style={{ textDecoration: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <LogoMark size={22} />
            <span
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700,
                fontSize: 19,
                color: C.text,
                letterSpacing: "-0.01em",
              }}
            >
              Omi<span style={{ color: C.accent }}>lytix</span>
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            multi-omics figures
          </div>
        </NavLink>
      </div>

      <div style={{ padding: "0 12px" }}>
        <NavLink
          to="/about"
          style={({ isActive }) => ({
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            margin: "1px 0",
            borderRadius: 6,
            textDecoration: "none",
            fontSize: 12.5,
            fontWeight: isActive ? 700 : 600,
            color: isActive ? C.accent : C.text,
            background: isActive ? C.cSel : "transparent",
          })}
        >
          About
        </NavLink>
      </div>

      <div style={{ padding: "4px 12px", flex: 1 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, letterSpacing: "0.06em", textTransform: "uppercase", padding: "12px 10px 6px" }}>
          Omics
        </div>

        {UMBRELLAS.map((u) => {
          const isOpen = openId === u.id;
          const isConstruction = u.status === "construction";
          return (
            <div key={u.id} style={{ marginBottom: 2 }}>
              <div
                onClick={() => setOpenId(isOpen ? null : u.id)}
                role="button"
                tabIndex={0}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "9px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  color: C.text,
                  userSelect: "none",
                }}
              >
                <span style={{ color: isConstruction ? C.muted : C.accent, display: "flex" }}>
                  <ToolGlyph type={u.glyph} size={16} />
                </span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{u.name}</span>
                {isConstruction ? (
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.muted, letterSpacing: "0.04em" }}>SOON</span>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .12s", flexShrink: 0 }}>
                    <path d="M3 1l4 4-4 4" stroke={C.muted} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>

              {isConstruction && (
                <NavLink
                  to={u.path}
                  style={{ display: "block", padding: "2px 10px 6px 35px", fontSize: 11, color: C.muted, textDecoration: "none" }}
                >
                  View status →
                </NavLink>
              )}

              {!isConstruction && isOpen && (
                <div style={{ marginLeft: 8, paddingLeft: 17, borderLeft: "1px solid " + C.border, marginTop: 1 }}>
                  {u.tools.map((t) => (
                    <NavLink
                      key={t.id}
                      to={t.path}
                      style={({ isActive }) => ({
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "7px 8px",
                        margin: "1px 0",
                        borderRadius: 6,
                        textDecoration: "none",
                        color: isActive ? C.accent : C.text,
                        background: isActive ? C.cSel : "transparent",
                        fontSize: 12.5,
                        fontWeight: isActive ? 600 : 500,
                        opacity: t.status === "planned" ? 0.55 : 1,
                      })}
                    >
                      <ToolGlyph type={t.glyph} size={15} />
                      <span style={{ flex: 1 }}>{t.name}</span>
                      {t.status === "planned" && (
                        <span style={{ fontSize: 8.5, fontWeight: 700, color: C.muted, letterSpacing: "0.03em" }}>SOON</span>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
