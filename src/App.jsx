import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { AuthProvider } from "./shared/AuthContext";
import AppShell from "./shared/AppShell";
import About from "./routes/About";
import Contact from "./routes/Contact";
import Methods from "./routes/Methods";
import TranscriptomicsHome from "./routes/TranscriptomicsHome";
import UnderConstruction from "./routes/UnderConstruction";
import ToolPlaceholder from "./routes/ToolPlaceholder";
const VolcanoPlot = lazy(() => import("./routes/VolcanoPlot"));
const MAPlot = lazy(() => import("./routes/MAPlot"));
const PCAPlot = lazy(() => import("./routes/PCAPlot"));
const Heatmap = lazy(() => import("./routes/Heatmap"));
const CorrelationHeatmap = lazy(() => import("./routes/CorrelationHeatmap"));
const VennDiagram = lazy(() => import("./routes/VennDiagram"));
const PathwaySuite = lazy(() => import("./routes/PathwaySuite"));
const FigureLayout = lazy(() => import("./routes/FigureLayout"));
import { UMBRELLAS, TOOLS } from "./shared/tools";

// Real, migrated tool components go here. Anything not listed still falls
// back to the placeholder automatically.
const TOOL_COMPONENTS = {
  volcano: VolcanoPlot,
  ma: MAPlot,
  pca: PCAPlot,
  heatmap: Heatmap,
  correlation: CorrelationHeatmap,
  venn: VennDiagram,
  pathway: PathwaySuite,
  figures: FigureLayout,
};

function NotFound() {
  return (
    <div style={{ padding: "48px 24px", maxWidth: 520 }}>
      <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.55, letterSpacing: ".06em" }}>404</div>
      <h1 style={{ fontSize: 26, margin: "6px 0 10px" }}>Page not found</h1>
      <p style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.8 }}>That address doesn't match any page. Pick a tool from the menu, or go to the <Link to="/transcriptomics">Transcriptomics tools</Link>.</p>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/about" replace />} />
            <Route path="/about" element={<About />} />
            <Route path="/tutorials" element={<Navigate to="/about" replace />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/methods" element={<Methods />} />

            {/* Transcriptomics: index page + one route per tool */}
            <Route path="/transcriptomics" element={<TranscriptomicsHome />} />
            {TOOLS.map((t) => {
              const Real = TOOL_COMPONENTS[t.id];
              return (
                <Route
                  key={t.id}
                  path={t.path}
                  element={Real ? (
                    <Suspense fallback={<div style={{ padding: 32, fontSize: 13, opacity: 0.6 }}>Loading tool…</div>}>
                      <Real />
                    </Suspense>
                  ) : <ToolPlaceholder tool={t} />}
                />
              );
            })}

            {/* Umbrellas with no tools yet */}
            {UMBRELLAS.filter((u) => u.status === "construction").map((u) => (
              <Route key={u.id} path={u.path} element={<UnderConstruction umbrella={u} />} />
            ))}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
