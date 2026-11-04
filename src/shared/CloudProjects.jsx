import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "./theme";
import { useAuth } from "./AuthContext";
import AuthModal from "./AuthModal";
import { listProjects, getProject, createProject, updateProject, deleteProject } from "./projects";

// "My projects" popover shown in each tool's header.
//   tool     — short id, e.g. "volcano" (keeps each tool's projects separate)
//   getData  — () => JSON-serializable project payload (same as the file save)
//   onLoad   — (payload) => void   (the tool's existing loadProject)
export default function CloudProjects({ tool, getData, onLoad }) {
  const C = useTheme();
  const { user, authConfigured } = useAuth();
  const [open, setOpen] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  const [currentId, setCurrentId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {ok:boolean,text:string}
  const [confirmDel, setConfirmDel] = useState(null);
  const box = useRef(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try { setItems(await listProjects(tool)); }
    catch (e) { setMsg({ ok: false, text: e.message || "Could not load your projects." }); }
  }, [user, tool]);

  useEffect(() => { if (open && user) refresh(); }, [open, user, refresh]);
  useEffect(() => { if (!user) { setCurrentId(null); setItems([]); } }, [user]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const run = async (fn) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: e.message || "Something went wrong." }); }
    finally { setBusy(false); }
  };

  const save = (asNew) => run(async () => {
    const nm = (name || "").trim() || "Untitled project";
    const payload = getData();
    const row = currentId && !asNew ? await updateProject(currentId, nm, payload) : await createProject(tool, nm, payload);
    setCurrentId(row.id); setName(row.name);
    setMsg({ ok: true, text: currentId && !asNew ? "Updated “" + row.name + "”." : "Saved “" + row.name + "”." });
    await refresh();
  });

  const openProject = (id) => run(async () => {
    const row = await getProject(id);
    onLoad(row.data);
    setCurrentId(row.id); setName(row.name);
    setMsg({ ok: true, text: "Opened “" + row.name + "”." });
  });

  const remove = (id) => run(async () => {
    await deleteProject(id);
    if (id === currentId) setCurrentId(null);
    setConfirmDel(null);
    await refresh();
  });

  const fmt = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch (_) { return ""; } };

  const btn = (primary, disabled) => ({
    padding: "5px 11px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: disabled ? "default" : "pointer",
    border: primary ? "none" : "1px solid " + C.border, background: primary ? C.accent : "transparent",
    color: primary ? "#fff" : C.text, opacity: disabled ? 0.55 : 1,
  });

  return (
    <div ref={box} style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)} disabled={!authConfigured}
        title={authConfigured ? "Save and open projects in your account" : "Accounts are not configured yet"}
        style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: authConfigured ? "pointer" : "default",
          border: "1px solid " + C.border, background: open ? C.panel2 : "transparent", color: C.text }}>
        ☁ My projects
      </button>

      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 320, zIndex: 60, background: C.panel,
          border: "1px solid " + C.border, borderRadius: 10, boxShadow: C.shadow, padding: 14 }}>
          {!user ? (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>Save to your account</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 12 }}>
                Sign in to keep your projects online and open them from any computer. The tools stay free to use without an account.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setShowAuth("signin")} style={btn(false)}>Sign in</button>
                <button onClick={() => setShowAuth("signup")} style={btn(true)}>Sign up</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: ".05em", marginBottom: 6 }}>
                {currentId ? "CURRENT PROJECT" : "SAVE THIS WORK"}
              </div>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name"
                style={{ width: "100%", boxSizing: "border-box", padding: "7px 9px", borderRadius: 6, fontSize: 12,
                  border: "1px solid " + C.border, background: C.panel2, color: C.text, marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button disabled={busy} onClick={() => save(false)} style={btn(true, busy)}>{currentId ? "Update" : "Save"}</button>
                {currentId && <button disabled={busy} onClick={() => save(true)} style={btn(false, busy)}>Save as new</button>}
                {currentId && <button disabled={busy} onClick={() => { setCurrentId(null); setName(""); setMsg(null); }} style={btn(false, busy)}>New</button>}
              </div>
              {msg && <div style={{ marginTop: 8, fontSize: 11.5, color: msg.ok ? C.success : C.danger, lineHeight: 1.4 }}>{msg.text}</div>}

              <div style={{ height: 1, background: C.border, margin: "12px 0" }} />
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: ".05em", marginBottom: 6 }}>YOUR SAVED PROJECTS</div>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {items.length === 0 && <div style={{ fontSize: 12, color: C.muted, padding: "6px 0" }}>Nothing saved for this tool yet.</div>}
                {items.map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid " + C.border }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: p.id === currentId ? 700 : 500, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div style={{ fontSize: 10.5, color: C.muted }}>{fmt(p.updated_at)}</div>
                    </div>
                    {confirmDel === p.id ? (
                      <>
                        <button disabled={busy} onClick={() => remove(p.id)} style={{ ...btn(false, busy), color: C.danger, borderColor: C.danger }}>Delete?</button>
                        <button onClick={() => setConfirmDel(null)} style={btn(false)}>No</button>
                      </>
                    ) : (
                      <>
                        <button disabled={busy} onClick={() => openProject(p.id)} style={btn(false, busy)}>Open</button>
                        <button disabled={busy} onClick={() => setConfirmDel(p.id)} title="Delete" style={{ ...btn(false, busy), color: C.muted }}>✕</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {showAuth && <AuthModal initialMode={showAuth} onClose={() => setShowAuth(false)} />}
    </div>
  );
}
