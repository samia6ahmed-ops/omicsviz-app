import { useState } from "react";
import { useTheme } from "../shared/theme";
import { useAuth } from "../shared/AuthContext";
import { supabase } from "../shared/supabaseClient";
import { CONTACT_EMAIL } from "../shared/siteConfig";
import { TOOLS } from "../shared/tools";

const TYPES = [
  ["bug", "Report a bug"],
  ["feature", "Suggest a feature"],
  ["question", "Ask a question"],
  ["other", "General feedback"],
];

export default function Contact() {
  const C = useTheme();
  const { user } = useAuth();
  const [type, setType] = useState("bug");
  const [tool, setTool] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState(user?.email || "");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot: real people never see or fill this
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [err, setErr] = useState("");

  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSend = message.trim().length >= 5 && emailOk && status !== "sending";

  const mailtoHref = () =>
    "mailto:" + CONTACT_EMAIL +
    "?subject=" + encodeURIComponent("Omilytix " + TYPES.find((t) => t[0] === type)[1].toLowerCase()) +
    "&body=" + encodeURIComponent(message + (tool ? "\n\nTool: " + tool : ""));

  async function submit(e) {
    e.preventDefault();
    if (!canSend) return;
    if (website) { setStatus("sent"); return; } // bot
    if (!supabase) {
      if (CONTACT_EMAIL) { window.location.href = mailtoHref(); return; }
      setStatus("error"); setErr("The feedback form isn't connected yet. Please try again later.");
      return;
    }
    setStatus("sending"); setErr("");
    const { error } = await supabase.from("feedback").insert({
      type,
      tool: tool || null,
      name: name.trim().slice(0, 120) || null,
      email: email.trim().slice(0, 200) || null,
      message: message.trim().slice(0, 5000),
      page_url: document.referrer ? document.referrer.slice(0, 300) : null,
      user_agent: navigator.userAgent.slice(0, 300),
    });
    if (error) {
      setStatus("error");
      console.error("feedback insert failed", error);
      setErr("Your message couldn't be sent. Check your internet connection and try again." +
        (CONTACT_EMAIL ? " You can email us instead." : " Please try again in a moment."));
      return;
    }
    setStatus("sent");
  }

  const label = { display: "block", fontSize: 12, fontWeight: 600, color: C.text, margin: "0 0 5px" };
  const input = {
    width: "100%", boxSizing: "border-box", padding: "9px 11px", fontSize: 13.5, fontFamily: "inherit",
    color: C.text, background: C.cBg, border: "1px solid " + C.border, borderRadius: 7, outline: "none",
  };

  if (status === "sent") {
    return (
      <Wrap C={C}>
        <div style={{ background: C.panel, border: "1px solid " + C.border, borderRadius: 10, padding: "26px 24px" }}>
          <div style={{ fontSize: 28, color: C.success, lineHeight: 1 }}>✓</div>
          <h2 style={{ fontSize: 18, color: C.text, margin: "10px 0 6px" }}>Thanks, we got your message.</h2>
          <p style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6, margin: "0 0 16px" }}>
            {email.trim() ? "We read every message and will reply to " + email.trim() + " if needed." : "We read every message. Leave an email next time if you'd like a reply."}
          </p>
          <button
            onClick={() => { setMessage(""); setTool(""); setStatus("idle"); }}
            style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600, borderRadius: 7, border: "1px solid " + C.border, background: C.panel2, color: C.text, cursor: "pointer" }}
          >
            Send another
          </button>
        </div>
      </Wrap>
    );
  }

  return (
    <Wrap C={C}>
      <form onSubmit={submit} noValidate style={{ background: C.panel, border: "1px solid " + C.border, borderRadius: 10, padding: "20px 20px 22px" }}>
        <div role="radiogroup" aria-label="What is this about?" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          {TYPES.map(([v, l]) => (
            <button
              type="button" key={v} role="radio" aria-checked={type === v} onClick={() => setType(v)}
              style={{
                padding: "7px 12px", fontSize: 12.5, fontWeight: 600, borderRadius: 999, cursor: "pointer",
                border: "1px solid " + (type === v ? C.accent : C.border),
                background: type === v ? C.cSel : "transparent", color: type === v ? C.accent : C.text,
              }}
            >{l}</button>
          ))}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label} htmlFor="fb-tool">Which tool? <span style={{ fontWeight: 400, color: C.muted }}>(optional)</span></label>
          <select id="fb-tool" value={tool} onChange={(e) => setTool(e.target.value)} style={input}>
            <option value="">Not about a specific tool</option>
            {TOOLS.filter((t) => t.status === "ready").map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={label} htmlFor="fb-msg">Message</label>
          <textarea
            id="fb-msg" rows={7} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000}
            placeholder={type === "bug" ? "What did you do, what did you expect, and what happened instead?" : "Tell us what's on your mind…"}
            style={{ ...input, resize: "vertical", lineHeight: 1.5 }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 6 }}>
          <div>
            <label style={label} htmlFor="fb-name">Name <span style={{ fontWeight: 400, color: C.muted }}>(optional)</span></label>
            <input id="fb-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} style={input} autoComplete="name" />
          </div>
          <div>
            <label style={label} htmlFor="fb-email">Email <span style={{ fontWeight: 400, color: C.muted }}>(optional, if you'd like a reply)</span></label>
            <input id="fb-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="email"
              style={{ ...input, borderColor: emailOk ? C.border : C.danger }} />
            {!emailOk && <div style={{ fontSize: 11.5, color: C.danger, marginTop: 4 }}>That email doesn't look right.</div>}
          </div>
        </div>

        <input
          tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)}
          name="website" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
        />

        {status === "error" && (
          <div role="alert" style={{ fontSize: 12.5, color: C.danger, margin: "12px 0 0", lineHeight: 1.5 }}>
            {err} {CONTACT_EMAIL && <a href={mailtoHref()} style={{ color: C.accent }}>Email {CONTACT_EMAIL}</a>}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
          <button
            type="submit" disabled={!canSend}
            style={{
              padding: "10px 20px", fontSize: 13.5, fontWeight: 700, borderRadius: 7, border: "none",
              background: canSend ? C.accent : C.border, color: canSend ? "#fff" : C.muted, cursor: canSend ? "pointer" : "default",
            }}
          >{status === "sending" ? "Sending…" : "Send"}</button>
          <span style={{ fontSize: 11.5, color: C.muted }}>Please don't paste your research data here. A screenshot description is enough.</span>
        </div>
      </form>

      {CONTACT_EMAIL && (
        <p style={{ fontSize: 13, color: C.muted, margin: "16px 0 0" }}>
          Prefer email? Write to <a href={"mailto:" + CONTACT_EMAIL} style={{ color: C.accent }}>{CONTACT_EMAIL}</a>.
        </p>
      )}
    </Wrap>
  );
}

function Wrap({ C, children }) {
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 28, boxSizing: "border-box" }}>
      <div style={{ maxWidth: 620 }}>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "0 0 4px", color: C.text }}>
          Contact &amp; feedback
        </h1>
        <p style={{ fontSize: 13.5, color: C.muted, margin: "0 0 20px", lineHeight: 1.6 }}>
          Found a bug, missing a feature, or have a question? Omilytix is actively developed and your feedback shapes what we build next.
        </p>
        {children}
      </div>
    </div>
  );
}
