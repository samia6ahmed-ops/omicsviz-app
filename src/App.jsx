import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./shared/AuthContext";
import AppShell from "./shared/AppShell";
import About from "./routes/About";
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

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/about" replace />} />
            <Route path="/about" element={<About />} />

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
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
