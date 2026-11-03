import { useState } from "react";
import { useTheme } from "./theme";
import { useAuth } from "./AuthContext";
import AuthModal from "./AuthModal";

export default function TopBar({ theme, setTheme }) {
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
        gap: 10,
        padding: "0 20px",
        borderBottom: "1px solid " + C.border,
        background: C.panel,
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <button
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        style={{
          padding: "5px 12px", borderRadius: 20, cursor: "pointer",
          border: "1px solid " + C.border, background: C.panel2, color: C.text,
          fontSize: 11.5, fontWeight: 600,
        }}
      >
        {theme === "light" ? "🌙 Dark" : "☀️ Light"}
      </button>

      {user ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: C.muted }}>{user.email}</span>
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
  padding: "6px 13px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
  border: primary ? "none" : "1px solid " + C.border,
  background: primary ? C.accent : "transparent",
  color: primary ? "#fff" : C.text,
});
