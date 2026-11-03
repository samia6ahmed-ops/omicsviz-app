import { useState } from "react";
import { Outlet } from "react-router-dom";
import { ThemeCtx, LIGHT, DARK } from "./theme";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

export default function AppShell() {
  const [theme, setTheme] = useState(() => localStorage.getItem("ov-theme") || "light");
  const C = theme === "light" ? LIGHT : DARK;

  const changeTheme = (t) => {
    setTheme(t);
    localStorage.setItem("ov-theme", t);
  };

  return (
    <ThemeCtx.Provider value={C}>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: C.bg, color: C.text, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <Sidebar />
        <div style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column" }}>
          <TopBar theme={theme} setTheme={changeTheme} />
          <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <Outlet />
          </main>
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}
