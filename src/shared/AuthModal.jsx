import { useState } from "react";
import { useTheme } from "./theme";
import { useAuth } from "./AuthContext";

export default function AuthModal({ onClose, initialMode = "signup" }) {
  const C = useTheme();
  const { signIn, signUp, authConfigured } = useAuth();
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email, password);
      else await signUp(email, password);
      onClose();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 340, background: C.panel, border: "1px solid " + C.border, borderRadius: 10, padding: 24, boxShadow: C.shadow }}
      >
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17, color: C.text, marginBottom: 4 }}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </div>
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 18 }}>
          {authConfigured ? "Save and reload your projects across sessions." : "Accounts aren't configured on this deployment yet."}
        </div>

        {!authConfigured ? (
          <button onClick={onClose} style={btnStyle(C, true)}>Close</button>
        ) : (
          <form onSubmit={submit}>
            <label style={labelStyle(C)}>Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle(C)}
            />
            <label style={labelStyle(C)}>Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle(C)}
            />
            {error && <div style={{ fontSize: 12, color: C.up, marginTop: 6 }}>{error}</div>}
            <button type="submit" disabled={busy} style={btnStyle(C, true)}>
              {busy ? "Working…" : mode === "signin" ? "Sign in" : "Sign up"}
            </button>
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              style={btnStyle(C, false)}
            >
              {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const labelStyle = (C) => ({ display: "block", fontSize: 11.5, fontWeight: 600, color: C.muted, marginTop: 12, marginBottom: 4 });
const inputStyle = (C) => ({
  width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13,
  border: "1px solid " + C.border, borderRadius: 6, background: C.panel2, color: C.text, outline: "none",
});
const btnStyle = (C, primary) => ({
  width: "100%", marginTop: 16, padding: "9px 0", borderRadius: 6, fontSize: 13, fontWeight: 600,
  cursor: "pointer", border: primary ? "none" : "1px solid " + C.border,
  background: primary ? C.accent : "transparent", color: primary ? "#fff" : C.text,
});
