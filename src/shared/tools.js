// Central registry, organized by omics umbrella. Adding a new tool = adding
// one entry to the right umbrella's `tools` array, plus one route in App.jsx.
export const UMBRELLAS = [
  {
    id: "transcriptomics",
    path: "/transcriptomics",
    name: "Transcriptomics",
    glyph: "helix",
    status: "active",
    tools: [
      {
        id: "volcano",
        path: "/transcriptomics/volcano",
        name: "Volcano Plot",
        short: "Differential expression, significance vs. fold-change.",
        glyph: "volcano",
        status: "ready",
      },
      {
        id: "ma",
        path: "/transcriptomics/ma",
        name: "MA Plot",
        short: "Mean expression vs. log-fold-change, with LOESS trend.",
        glyph: "scatter",
        status: "ready",
      },
      {
        id: "pca",
        path: "/transcriptomics/pca",
        name: "PCA Plot",
        short: "Sample-level variance and clustering.",
        glyph: "cluster",
        status: "ready",
      },
      {
        id: "heatmap",
        path: "/transcriptomics/heatmap",
        name: "Expression Heatmap",
        short: "Z-scored expression matrix with UPGMA clustering.",
        glyph: "grid",
        status: "ready",
      },
      {
        id: "correlation",
        path: "/transcriptomics/correlation",
        name: "Correlation Heatmap",
        short: "Sample-to-sample correlation matrix with clustering.",
        glyph: "grid",
        status: "ready",
      },
      {
        id: "venn",
        path: "/transcriptomics/venn",
        name: "Venn / UpSet",
        short: "Set overlaps for gene lists: Venn up to 5 sets, UpSet beyond.",
        glyph: "cluster",
        status: "ready",
      },
      {
        id: "pathway",
        path: "/transcriptomics/pathway",
        name: "Pathway Suite",
        short: "Enrichment (ORA / GSEA), dot and bar plots, and network maps.",
        glyph: "dotplot",
        status: "ready",
      },
      {
        id: "figures",
        path: "/transcriptomics/figures",
        name: "Figure Layout",
        short: "Assemble panels into a journal-ready composite figure.",
        glyph: "layout",
        status: "ready",
      },
      {
        id: "primer",
        path: "/transcriptomics/primer",
        name: "Primer Design",
        short: "circRNA / miRNA / mRNA primer design.",
        glyph: "helix",
        status: "planned",
      },
    ],
  },
  {
    id: "metabolomics",
    path: "/metabolomics",
    name: "Metabolomics",
    glyph: "flask",
    status: "construction",
    tools: [],
  },
  {
    id: "microbiomics",
    path: "/microbiomics",
    name: "Microbiomics",
    glyph: "microbe",
    status: "construction",
    tools: [],
  },
  {
    id: "proteomics",
    path: "/proteomics",
    name: "Proteomics",
    glyph: "protein",
    status: "construction",
    tools: [],
  },
];

// Flat list of every real tool, across all umbrellas — convenient for
// routing and for the "all tools" view.
export const TOOLS = UMBRELLAS.flatMap((u) => u.tools);

