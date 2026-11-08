import { Link } from "react-router-dom";
import { useTheme } from "../shared/theme";
import { TUTORIALS } from "../shared/siteConfig";
import { TOOLS } from "../shared/tools";

function Player({ t, C }) {
  if (t.youtube) {
    return (
      <iframe
        src={"https://www.youtube-nocookie.com/embed/" + t.youtube + "?rel=0"}
        title={t.title}
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        style={{ width: "100%", aspectRatio: "16 / 9", border: 0, display: "block", background: "#000" }}
      />
    );
  }
  return (
    <video
      controls
      playsInline
      preload="none"
      poster={"/videos/" + t.file + ".jpg"}
      src={"/videos/" + t.file + ".mp4"}
      style={{ width: "100%", aspectRatio: "16 / 9", display: "block", background: "#000" }}
    >
      Your browser can't play this video.
    </video>
  );
}

// Video cards shared by the About page. `intro` = the welcome video alone;
// `rest` = the grid of tool tutorials.
export function VideoCard({ t, big }) {
  const C = useTheme();
  const toolPath = TOOLS.find((x) => x.id === t.toolId)?.path;
  const linkStyle = { fontSize: 12, fontWeight: 600, color: C.accent, textDecoration: "none", whiteSpace: "nowrap" };
  return (
    <div style={{ background: C.panel, border: "1px solid " + C.border, borderRadius: 10, overflow: "hidden", boxShadow: C.shadow }}>
      <Player t={t} C={C} />
      <div style={{ padding: big ? "14px 18px 16px" : "12px 14px 14px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h3 style={{ fontSize: big ? 16 : 14, fontWeight: 700, color: C.text, margin: 0, flex: 1 }}>{t.title}</h3>
          {t.link && <Link to={t.link[0]} style={linkStyle}>{t.link[1]}</Link>}
          {toolPath && <Link to={toolPath} style={linkStyle}>Open tool →</Link>}
        </div>
        <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, margin: "5px 0 0" }}>{t.blurb}</p>
      </div>
    </div>
  );
}

export function VideoGrid({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))", gap: 18 }}>
      {items.map((t) => <VideoCard key={t.id} t={t} />)}
    </div>
  );
}

export { TUTORIALS };
