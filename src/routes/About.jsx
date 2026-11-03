import { useTheme } from "../shared/theme";
import { LogoMark } from "../shared/LogoMark";

export default function About() {
  const C = useTheme();

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 28, boxSizing: "border-box" }}>
      <div style={{ maxWidth: 640 }}>
        <div style={{ marginBottom: 8 }}>
          <LogoMark size={34} />
        </div>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "10px 0 4px", color: C.text }}>
          About Omilytix
        </h1>
        <p style={{ fontSize: 13.5, color: C.muted, marginBottom: 24, lineHeight: 1.6 }}>
          Omilytix is a multi-omics visualization platform for producing journal-quality
          figures directly from your data — no scripting required, no round-tripping
          through separate stats and design tools.
        </p>

        <Section title="What it does" C={C}>
          Each tool takes a raw data matrix or results table and turns it into a
          publication-ready figure: differential expression volcano and MA plots,
          PCA and clustering, expression heatmaps, pathway enrichment views, and a
          layout tool for assembling multi-panel composite figures. Every plot exports
          at 300dpi, in formats suitable for direct submission to a journal.
        </Section>

        <Section title="How it's organized" C={C}>
          Tools are grouped by omics type in the sidebar. Transcriptomics is fully
          built out today; Metabolomics, Microbiomics, and Proteomics are on the
          roadmap and currently under construction.
        </Section>

        <Section title="Where your data goes" C={C}>
          Everything runs in your browser — your data is processed locally and isn't
          uploaded to a server unless you explicitly save a project to your account.
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children, C }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h2 style={{ fontSize: 13.5, fontWeight: 700, color: C.text, marginBottom: 6 }}>{title}</h2>
      <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, margin: 0 }}>{children}</p>
    </div>
  );
}
