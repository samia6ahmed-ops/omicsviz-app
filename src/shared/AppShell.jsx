import { useState, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ThemeCtx, LIGHT, DARK } from "./theme";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { TOOLS } from "./tools";

/* Below 900px the sidebar becomes a slide-out drawer (it used to stay 240px wide
   and squeeze every page into ~150px on a phone). The figure tools themselves need
   a laptop-sized screen, so on phones and portrait tablets they keep a desktop width inside a
   horizontally scrollable area, with a one-line notice. */
function useMedia(q) {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(q), h = () => setM(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", h) : mq.addListener(h);
    h();
    return () => (mq.removeEventListener ? mq.removeEventListener("change", h) : mq.removeListener(h));
  }, [q]);
  return m;
}

export default function AppShell() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("ov-theme") || "light"; } catch (_) { return "light"; } });
  const C = theme === "light" ? LIGHT : DARK;
  const narrow = useMedia("(max-width: 899px)");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();
  const onTool = TOOLS.some((t) => t.path && pathname.startsWith(t.path));
  const [noteHidden, setNoteHidden] = useState(() => { try { return sessionStorage.getItem("ov-mobile-note") === "1"; } catch (_) { return false; } });

  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  useEffect(() => { if (!narrow) setDrawerOpen(false); }, [narrow]);

  const changeTheme = (t) => {
    setTheme(t);
    try { localStorage.setItem("ov-theme", t); } catch (_) {}
  };
  const hideNote = () => { setNoteHidden(true); try { sessionStorage.setItem("ov-mobile-note", "1"); } catch (_) {} };
  const wideTool = narrow && onTool;   /* phones and portrait tablets */

  return (
    <ThemeCtx.Provider value={C}>
      <div style={{ display: "flex", height: "100dvh", overflow: "hidden", background: C.bg, color: C.text, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <Sidebar drawer={narrow} open={drawerOpen} />
        {narrow && drawerOpen && (
          <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 55, background: "rgba(15,23,42,.45)" }} />
        )}
        <div style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column" }}>
          <TopBar theme={theme} setTheme={changeTheme} compact={narrow} onMenu={narrow ? () => setDrawerOpen(true) : null} />
          {wideTool && !noteHidden && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 14px", fontSize: 12, lineHeight: 1.45, background: C.panel2, borderBottom: "1px solid " + C.border, color: C.text }}>
              <span style={{ flex: 1 }}>Omilytix tools are built for a laptop or desktop screen. You can look around here — open omilytix.com on a computer to make figures.</span>
              <button onClick={hideNote} aria-label="Dismiss" style={{ border: "none", background: "transparent", color: C.muted, fontSize: 18, cursor: "pointer", padding: 4 }}>×</button>
            </div>
          )}
          <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: wideTool ? "auto" : "hidden" }}>
            {wideTool
              ? <div style={{ minWidth: 1100, flex: 1, minHeight: 640, display: "flex", flexDirection: "column" }}><Outlet /></div>
              : <Outlet />}
          </main>
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}
