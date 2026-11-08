import { useState } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "./theme";
import { useAuth } from "./AuthContext";
import AuthModal from "./AuthModal";

export default function TopBar({ theme, setTheme, compact = false, onMenu = null }) {
  const C = useTheme();
  const { user, signOut, authConfigured } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState("signup");

  return (
    <header
      style={{
        height: 54,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: compact ? 6 : 10,
        padding: compact ? "0 10px" : "0 20px",
        borderBottom: "1px solid " + C.border,
        background: C.panel,
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      {onMenu && (
        <>
          <button onClick={onMenu} aria-label="Open menu"
            style={{ border: "1px solid " + C.border, background: C.panel2, color: C.text, borderRadius: 8, width: 36, height: 34, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
          <Link to="/about" style={{ fontWeight: 800, fontSize: 17, color: C.text, textDecoration: "none", marginRight: "auto", marginLeft: 4, whiteSpace: "nowrap" }}>
            Omi<span style={{ color: C.accent }}>lytix</span>
          </Link>
        </>
      )}
      <button
        aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        style={{
          padding: "5px 12px", borderRadius: 20, cursor: "pointer",
          border: "1px solid " + C.border, background: C.panel2, color: C.text,
          fontSize: 11.5, fontWeight: 600,
        }}
      >
        {compact ? (theme === "light" ? "🌙" : "☀️") : (theme === "light" ? "🌙 Dark" : "☀️ Light")}
      </button>

      {user ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!compact && <span style={{ fontSize: 12, color: C.muted }}>{user.email}</span>}
          <button onClick={signOut} style={smallBtn(C)}>Sign out</button>
        </div>
      ) : !authConfigured ? (
        <button onClick={() => { setAuthMode("signup"); setShowAuth(true); }} style={smallBtn(C, true)}>
          Accounts (soon)
        </button>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => { setAuthMode("signin"); setShowAuth(true); }} style={smallBtn(C, false)}>
            Sign in
          </button>
          <button onClick={() => { setAuthMode("signup"); setShowAuth(true); }} style={smallBtn(C, true)}>
            Sign up
          </button>
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} initialMode={authMode} />}
    </header>
  );
}

const smallBtn = (C, primary) => ({
  whiteSpace: "nowrap",
  padding: "6px 13px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
  border: primary ? "none" : "1px solid " + C.border,
  background: primary ? C.accent : "transparent",
  color: primary ? "#fff" : C.text,
});
