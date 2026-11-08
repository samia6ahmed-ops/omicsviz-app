// Site-wide settings you may want to edit by hand.

// Shown on the Contact page as "Prefer email? Write to …".
// Leave empty ("") to hide the email line.
export const CONTACT_EMAIL = "";

// Tutorial videos. Each entry plays /videos/<file>.mp4 from the `public` folder.
// To host a video on YouTube instead (saves bandwidth), paste its video ID into
// `youtube`, e.g. youtube: "dQw4w9WgXcQ" — the page then embeds YouTube and the
// local file is no longer needed.
export const TUTORIALS = [
  { id: "intro", file: "intro", youtube: "zD4OPPvBXO0", toolId: null,
    title: "Welcome to Omilytix", blurb: "A one-minute tour of the platform and what each tool does." },
  { id: "volcano", file: "volcano_plot", youtube: "iTJfwHXWLTo", toolId: "volcano",
    title: "Volcano Plot", blurb: "Import DESeq2 or edgeR results, set thresholds, label genes and export at 300 dpi." },
  { id: "ma", file: "ma_plot", youtube: "K7M9f9kj59c", toolId: "ma",
    title: "MA Plot", blurb: "Mean expression vs. fold-change with a LOESS trend line." },
  { id: "pca", file: "pca_plot", youtube: "xMQ2P1JrRnY", toolId: "pca",
    title: "PCA Plot", blurb: "From a counts matrix to grouped samples, confidence ellipses and a scree plot." },
  { id: "heatmap", file: "expression_heatmap", youtube: "exTKpQbVgB8", toolId: "heatmap",
    title: "Expression Heatmap", blurb: "Z-scored expression with clustering and group annotation bars." },
  { id: "correlation", file: "correlation_heatmap", youtube: "KynthcU1_sg", toolId: "correlation",
    title: "Correlation Heatmap", blurb: "Sample-to-sample correlation to spot outliers and batch effects." },
  { id: "venn", file: "venn_upset", youtube: "C5snQDc5uQ0", toolId: "venn",
    title: "Venn / UpSet", blurb: "Compare gene lists: Venn diagrams up to 5 sets, UpSet plots beyond." },
  { id: "pathway", file: "pathway_suite", youtube: "l14qQIvl6b0", toolId: "pathway",
    title: "Pathway Suite", blurb: "ORA and GSEA enrichment, dot and bar plots, and network maps." },
  { id: "figures", file: "figure_layout", youtube: "1-yJOjP68N0", toolId: "figures",
    title: "Figure Layout", blurb: "Assemble panels into a journal-ready multi-panel figure." },
  { id: "math", file: "", youtube: "Kwv94ECCWJo", toolId: null, link: ["/methods", "Read the Methods →"],
    title: "The Math Behind the Plots", blurb: "The statistics and algorithms each tool runs: PCA, clustering, correlation tests, enrichment and more." },
];
