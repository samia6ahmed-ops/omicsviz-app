import { Link } from "react-router-dom";
import { useTheme } from "../shared/theme";
import { EQ } from "../shared/methodsMath";

// Public "Methods" page: the statistics and algorithms behind each tool, written so
// users can check what Omilytix does and describe it in their own Methods sections.

const SECTIONS = [
  ["overview", "Overview"],
  ["volcano", "Volcano Plot"],
  ["ma", "MA Plot"],
  ["pca", "PCA Plot"],
  ["heatmap", "Expression Heatmap"],
  ["correlation", "Correlation Heatmap"],
  ["venn", "Venn / UpSet"],
  ["pathway", "Pathway Suite"],
  ["summary", "Summary"],
  ["cite", "Citing Omilytix"],
  ["refs", "References"],
];

export default function Methods() {
  const C = useTheme();

  const H2 = ({ id, children }) => (
    <h2 id={id} style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, color: C.text, margin: "36px 0 10px", scrollMarginTop: 16 }}>{children}</h2>
  );
  const P = ({ children }) => <p style={{ fontSize: 14, lineHeight: 1.7, color: C.text, margin: "0 0 12px" }}>{children}</p>;
  const B = ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>;
  const UL = ({ children }) => <ul style={{ fontSize: 14, lineHeight: 1.7, color: C.text, margin: "0 0 12px", paddingLeft: 22 }}>{children}</ul>;
  const Eq = ({ k }) => (
    <div
      className="ov-eq"
      style={{ background: C.panel2, border: "1px solid " + C.border, borderRadius: 8, padding: "10px 14px", margin: "4px 0 14px", overflowX: "auto", color: C.text, fontSize: 17 }}
      dangerouslySetInnerHTML={{ __html: EQ[k] }}
    />
  );
  const Note = ({ children }) => (
    <div style={{ borderLeft: "3px solid " + C.accent, background: C.cSel, padding: "9px 14px", borderRadius: "0 6px 6px 0", fontSize: 13, lineHeight: 1.65, color: C.text, margin: "4px 0 14px" }}>
      {children}
    </div>
  );
  const ToolLink = ({ to }) => (
    <Link to={to} style={{ fontSize: 12.5, fontWeight: 600, color: C.accent, textDecoration: "none", marginLeft: 10, fontFamily: "Inter, sans-serif" }}>Open tool →</Link>
  );

  const th = { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid " + C.border, fontSize: 12.5, color: C.muted, fontWeight: 700 };
  const td = { padding: "8px 10px", borderBottom: "1px solid " + C.border, fontSize: 13, lineHeight: 1.55, color: C.text, verticalAlign: "top" };

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 28, boxSizing: "border-box" }}>
      <style>{`.ov-eq math{font-size:1em} .ov-eq math[display=block]{margin:0}`}</style>
      <div style={{ maxWidth: 820 }}>
        <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, margin: "0 0 4px", color: C.text }}>
          Methods
        </h1>
        <p style={{ fontSize: 13.5, color: C.muted, margin: "0 0 18px", lineHeight: 1.6 }}>
          The statistics and algorithms behind each tool, so you can check what Omilytix computes and describe it in your paper.
        </p>

        <div style={{ maxWidth: 560, margin: "0 0 18px", borderRadius: 10, overflow: "hidden", border: "1px solid " + C.border }}>
          <iframe
            src="https://www.youtube-nocookie.com/embed/Kwv94ECCWJo?rel=0"
            title="The Math Behind the Plots"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            style={{ width: "100%", aspectRatio: "16 / 9", border: 0, display: "block", background: "#000" }}
          />
        </div>

        <nav aria-label="On this page" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={"#" + id}
              onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); }}
              style={{ fontSize: 12, fontWeight: 600, color: C.text, textDecoration: "none", padding: "5px 10px", border: "1px solid " + C.border, borderRadius: 999, background: C.panel }}>
              {label}
            </a>
          ))}
        </nav>

        <H2 id="overview">Overview</H2>
        <P>
          All calculations run in your browser. Your data is not sent to a server unless you choose to save a project to your account. Every statistical routine is implemented directly in
          JavaScript rather than through a third-party statistics library, and is documented below.
        </P>
        <P>
          The Volcano and MA plots do <B>not</B> test for differential expression themselves. They display log₂ fold-changes and
          p / adjusted p-values that you have already computed with DESeq2, edgeR or limma. The tools that perform their own
          calculations are PCA, the two heatmaps and the Pathway Suite.
        </P>

        <H2 id="volcano">Volcano Plot <ToolLink to="/transcriptomics/volcano" /></H2>
        <P>A log transform plus a rectangular decision rule; no statistical test is performed.</P>
        <Eq k="volcanoY" />
        <UL>
          <li>p-values are floored at 10⁻³⁰⁰ so that p = 0 can still be plotted. On the log scale, p = 10⁻⁵ sits five units up.</li>
          <li>Each gene is classified by whether |log₂FC| and −log₁₀(p) pass your thresholds: <B>Up</B>, <B>Down</B>, fold-change only, or not significant.</li>
          <li>Axis ticks are rounded to steps of 1, 2, 2.5 or 5 times a power of ten.</li>
        </UL>

        <H2 id="ma">MA Plot <ToolLink to="/transcriptomics/ma" /></H2>
        <P>A display of precomputed differential-expression results with a LOESS trend line.</P>
        <Eq k="maAM" />
        <P>baseMean is floored at a small ε to avoid log(0), following the DESeq2 <code>plotMA</code> convention.</P>
        <P>
          <B>LOESS trend line.</B> Local linear regression with tricube weights (Cleveland, 1979). At each point, the weighted
          least-squares slope <i>b</i> and intercept <i>a</i> are solved in closed form over a window of span × n nearest points.
        </P>
        <Eq k="loess" />
        <Note>
          This is single-pass LOESS. R's <code>lowess()</code> adds robustness iterations that down-weight outliers. The difference
          is small for a display trend line, and the line does not affect any reported statistic.
        </Note>

        <H2 id="pca">PCA Plot <ToolLink to="/transcriptomics/pca" /></H2>
        <P>
          The data matrix <i>X</i> has <i>n</i> samples × <i>p</i> genes. PCA is computed by eigendecomposition of the small
          <i> n × n</i> sample Gram matrix with the Jacobi rotation method.
        </P>
        <P>
          <B>1. Centering.</B> Each gene is centered to mean 0 but not scaled to unit variance (covariance PCA), so high-variance
          genes contribute most. Log-transform or normalize your counts beforehand if needed.
        </P>
        <P>
          <B>2. Gram-matrix (dual) form.</B> Rather than the <i>p × p</i> covariance matrix (p can exceed 20,000), the tool
          decomposes the <i>n × n</i> matrix
        </P>
        <Eq k="gram" />
        <P>Both share the same non-zero eigenvalues σᵢ², from the singular value decomposition X<sub>c</sub> = UΣVᵀ:</P>
        <Eq k="svd" />
        <P>Sample scores on PC <i>k</i> are therefore √λₖ · uₖ, identical to those from the covariance form.</P>
        <P>
          <B>3. Jacobi eigenvalue algorithm.</B> G is real and symmetric, so G = QΛQᵀ with Q orthogonal. Q is built from Givens
          rotations, each zeroing one off-diagonal entry. Iteration stops when the off-diagonal sum of squares falls below 10⁻¹⁰.
        </P>
        <Eq k="jacobi" />
        <P><B>4. Variance explained.</B> At most n − 1 components are non-zero, because centering reduces the rank by one.</P>
        <Eq k="varexp" />
        <P>
          <B>5. Group ellipses.</B> Each group's 2 × 2 sample covariance <i>S</i> (n − 1 denominator) is eigendecomposed. Semi-axes
          are √(λᵢ · χ²₂,α), rotated along the first eigenvector, using χ² critical values 4.605 (90%), 5.991 (95%) and 9.210 (99%):
        </P>
        <Eq k="mahal" />
        <Note>
          These are <B>data ellipses</B>: the region expected to contain about 95% of a group's samples under a bivariate normal
          model. They are not confidence regions for the group mean, which would be smaller by a factor of √n.
        </Note>

        <H2 id="heatmap">Expression Heatmap <ToolLink to="/transcriptomics/heatmap" /></H2>
        <P><B>Row z-score.</B> Standard deviation uses the n − 1 denominator, matching R's <code>scale()</code>. Genes with constant expression are set to 0.</P>
        <Eq k="zscore" />
        <P><B>Distance.</B> Euclidean distance ‖a − b‖₂, or correlation distance 1 − r (standard in genomics).</P>
        <P><B>Hierarchical clustering.</B> UPGMA (average linkage). After clusters A and B merge, distances are updated with the Lance–Williams formula:</P>
        <Eq k="lw" />
        <P>
          <B>Dendrogram.</B> Each node is drawn at the midpoint of its children, at a height equal to the merge distance, giving an
          ultrametric tree.
        </P>

        <H2 id="correlation">Correlation Heatmap <ToolLink to="/transcriptomics/correlation" /></H2>
        <P><B>Pearson r</B> (returns 0 if either sample has zero variance):</P>
        <Eq k="pearson" />
        <P>
          <B>Spearman ρ</B> is Pearson r computed on ranks, with tied values given their average rank. This form is exact with
          ties; the shortcut 1 − 6Σd²/(n(n²−1)) is not.
        </P>
        <P>
          <B>p-value.</B> Exact two-sided test of H₀: ρ = 0, the same approach as R's <code>cor.test()</code>. The t statistic is
          converted to a p-value via the regularized incomplete beta function:
        </P>
        <Eq k="tstat" />
        <UL>
          <li>ln Γ(x) uses the Lanczos approximation (g = 7, 9 coefficients) with Euler's reflection formula for x &lt; 0.5.</li>
          <li>I<sub>x</sub>(a, b) is evaluated as a continued fraction with the modified Lentz algorithm, using the symmetry I<sub>x</sub>(a,b) = 1 − I<sub>1−x</sub>(b,a) where that converges faster.</li>
        </UL>
        <P>
          <B>Clustering.</B> Distance 1 − r with UPGMA, computed with the nearest-neighbour chain algorithm (Murtagh, 1983). This
          gives the same dendrogram as the standard algorithm in O(n²) time instead of O(n³).
        </P>

        <H2 id="venn">Venn / UpSet <ToolLink to="/transcriptomics/venn" /></H2>
        <P>
          Set intersections are computed exactly from your gene lists. Drawing uses computational geometry: a point belongs to an
          ellipse if, after rotating by −θ around the ellipse centre, it satisfies
        </P>
        <Eq k="ellipse" />
        <UL>
          <li>
            <B>Label placement.</B> Each region gets a chamfer distance transform, and its count label goes at the point furthest
            from the region's edge. This keeps labels inside the thin crescent-shaped regions of 4- and 5-set diagrams, where the
            centroid can fall outside the region.
          </li>
          <li>
            <B>Not area-proportional.</B> Ellipse sizes are fixed, so region areas do not reflect set sizes. Use the UpSet plot
            when you need sizes to be compared visually.
          </li>
        </UL>

        <H2 id="pathway">Pathway Suite <ToolLink to="/transcriptomics/pathway" /></H2>
        <P>
          <B>Over-representation analysis (ORA)</B> is a one-sided Fisher's exact test. With N background genes, K genes in the
          pathway, n genes in your list and k in the overlap, the p-value is the upper tail of the hypergeometric distribution:
        </P>
        <Eq k="hyper" />
        <P>
          Binomial coefficients are computed in log space via ln Γ, and the tail is summed with the log-sum-exp identity, so very
          large backgrounds (e.g. 20,000 genes) never overflow.
        </P>
        <P><B>Multiple testing.</B> Benjamini–Hochberg FDR (1995), with a running minimum so adjusted values stay monotone:</P>
        <Eq k="bh" />
        <Note>
          BH controls the FDR for independent or positively dependent tests. Pathways share genes, so their tests are correlated;
          BH remains the standard choice for enrichment analysis.
        </Note>
        <P><B>Preranked GSEA</B> (Subramanian et al., 2005):</P>
        <UL>
          <li><B>Running sum.</B> A weighted Kolmogorov–Smirnov-type walk down your ranked list; the enrichment score (ES) is its maximum deviation from zero. The weight exponent is q = 1, the GSEA default. The leading edge is the hits up to the peak.</li>
          <li><B>Null distribution.</B> 200 random gene sets of the same size, with positive and negative scores handled separately.</li>
          <li><B>NES</B> = ES / mean of null ES with the same sign.</li>
          <li><B>FDR q</B> as in the original paper: fraction of null NES at least as extreme, divided by the fraction of observed NES at least as extreme, pooled across gene sets.</li>
        </UL>
        <Eq k="gsea" />
        <Note>
          (1) Gene-set permutation, as in GSEA-preranked and fgsea, ignores gene–gene correlation and is somewhat
          anti-conservative compared with phenotype permutation. (2) With 200 permutations the smallest attainable p-value is
          about 0.005, so the strongest pathways share that value.
        </Note>
        <P><B>Redundancy filter.</B> Terms are taken in order of significance and kept only if their Jaccard similarity to every term already kept is below your threshold:</P>
        <Eq k="jaccard" />
        <P>
          <B>Enrichment map layout.</B> Fruchterman–Reingold force-directed layout (1991): all nodes repel (k²/d), linked
          pathways attract (d²/k × edge weight), and the step size cools over 300 iterations. A weak pull toward the centre stops
          unconnected pathways drifting to the edges. A fixed starting arrangement makes the layout identical every time you
          export.
        </P>

        <H2 id="summary">Summary</H2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520 }}>
            <thead><tr><th style={th}>Area</th><th style={th}>Methods used</th><th style={th}>Tools</th></tr></thead>
            <tbody>
              {[
                ["Linear algebra", "Spectral theorem, SVD, Gram (dual) form, Jacobi / Givens rotations", "PCA"],
                ["Numerical analysis", "Lanczos approximation of Γ, continued fractions (Lentz), log-sum-exp", "Correlation, Pathway"],
                ["Probability and statistics", "Hypergeometric test, t-test for r, χ² of Mahalanobis distance, KS-type running sum, permutation null, Benjamini–Hochberg", "PCA, Correlation, Pathway"],
                ["Clustering and graphs", "UPGMA / Lance–Williams, nearest-neighbour chain, force-directed layout", "Heatmaps, Pathway"],
                ["Geometry", "Rotation matrices, ellipse equation, distance transform", "PCA, Venn"],
                ["Regression", "Tricube-weighted local linear regression (LOESS)", "MA"],
              ].map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} style={{ ...td, fontWeight: i === 0 ? 600 : 400 }}>{c}</td>)}</tr>)}
            </tbody>
          </table>
        </div>

        <H2 id="cite">Citing Omilytix</H2>
        <P>If Omilytix helped with a figure in your paper, you can describe it in your Methods section, for example:</P>
        <div style={{ background: C.panel2, border: "1px solid " + C.border, borderRadius: 8, padding: "12px 14px", fontSize: 13.5, lineHeight: 1.65, color: C.text, margin: "0 0 12px" }}>
          "Principal component analysis and hierarchical clustering (UPGMA, Pearson correlation distance) were performed and
          visualized with Omilytix (https://omilytix.com, accessed [date])."
        </div>
        <P>Please also cite the original method papers below for the analyses you used.</P>

        <H2 id="refs">References</H2>
        <ol style={{ fontSize: 13, lineHeight: 1.7, color: C.text, paddingLeft: 22, margin: "0 0 12px" }}>
          <li>Benjamini Y, Hochberg Y (1995). Controlling the false discovery rate: a practical and powerful approach to multiple testing. <i>J R Stat Soc B</i> 57:289–300.</li>
          <li>Cleveland WS (1979). Robust locally weighted regression and smoothing scatterplots. <i>J Am Stat Assoc</i> 74:829–836.</li>
          <li>Fruchterman TMJ, Reingold EM (1991). Graph drawing by force-directed placement. <i>Softw Pract Exper</i> 21:1129–1164.</li>
          <li>Love MI, Huber W, Anders S (2014). Moderated estimation of fold change and dispersion for RNA-seq data with DESeq2. <i>Genome Biol</i> 15:550.</li>
          <li>Murtagh F (1983). A survey of recent advances in hierarchical clustering algorithms. <i>Comput J</i> 26:354–359.</li>
          <li>Sokal RR, Michener CD (1958). A statistical method for evaluating systematic relationships. <i>Univ Kansas Sci Bull</i> 38:1409–1438.</li>
          <li>Subramanian A, et al. (2005). Gene set enrichment analysis: a knowledge-based approach for interpreting genome-wide expression profiles. <i>PNAS</i> 102:15545–15550.</li>
        </ol>
        <p style={{ fontSize: 12.5, color: C.muted, margin: "24px 0 0" }}>
          Spotted an error or need more detail? <Link to="/contact" style={{ color: C.accent }}>Tell us</Link>.
        </p>
      </div>
    </div>
  );
}
