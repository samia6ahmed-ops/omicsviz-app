// Tiny, literal glyphs — each one is a miniature reading of the plot it
// represents, not a generic icon-font symbol. 20x20 viewbox, stroke-based,
// inherits currentColor so it follows nav item state.
export function ToolGlyph({ type, size = 18 }) {
  const common = { width: size, height: size, viewBox: "0 0 20 20", fill: "none" };
  switch (type) {
    case "volcano": // two lobes rising from a baseline, like -log10(p) vs logFC
      return (
        <svg {...common}>
          <path d="M2 16h16M4 16 8 6l2 3 2-3 4 10" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      );
    case "scatter":
      return (
        <svg {...common}>
          <path d="M2 17h16M2 17V2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="6" cy="12" r="1.3" fill="currentColor" />
          <circle cx="9" cy="9" r="1.3" fill="currentColor" />
          <circle cx="12" cy="11" r="1.3" fill="currentColor" />
          <circle cx="15" cy="6" r="1.3" fill="currentColor" />
          <path d="M5 13c3-6 8-8 11-6" stroke="currentColor" strokeWidth="1" strokeDasharray="1.6 1.6" fill="none" />
        </svg>
      );
    case "cluster":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="1.6" fill="currentColor" />
          <circle cx="8" cy="8.5" r="1.6" fill="currentColor" />
          <circle cx="5" cy="9" r="1.6" fill="currentColor" />
          <circle cx="14" cy="13" r="1.6" fill="currentColor" />
          <circle cx="16" cy="15.5" r="1.6" fill="currentColor" />
          <circle cx="13" cy="16" r="1.6" fill="currentColor" />
        </svg>
      );
    case "grid":
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="15" height="15" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2.5 8h15M2.5 13h15M8 2.5v15M13 2.5v15" stroke="currentColor" strokeWidth="0.9" opacity="0.6" />
        </svg>
      );
    case "dotplot":
      return (
        <svg {...common}>
          <path d="M2 4h6M2 10h9M2 16h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
          <circle cx="12" cy="4" r="2" fill="currentColor" />
          <circle cx="15" cy="10" r="2.6" fill="currentColor" />
          <circle cx="9.5" cy="16" r="1.5" fill="currentColor" />
        </svg>
      );
    case "network":
      return (
        <svg {...common}>
          <path d="M6 6 14 5M6 6 9 14M14 5 9 14M14 5 16 13M9 14 16 13" stroke="currentColor" strokeWidth="1" opacity="0.55" />
          <circle cx="6" cy="6" r="1.8" fill="currentColor" />
          <circle cx="14" cy="5" r="1.8" fill="currentColor" />
          <circle cx="9" cy="14" r="1.8" fill="currentColor" />
          <circle cx="16" cy="13" r="1.8" fill="currentColor" />
        </svg>
      );
    case "layout":
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="7" height="7" rx="0.7" stroke="currentColor" strokeWidth="1.2" />
          <rect x="10.5" y="2.5" width="7" height="4" rx="0.7" stroke="currentColor" strokeWidth="1.2" />
          <rect x="10.5" y="7.5" width="7" height="10" rx="0.7" stroke="currentColor" strokeWidth="1.2" />
          <rect x="2.5" y="10.5" width="7" height="7" rx="0.7" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case "helix": // shared by Primer Design AND the Transcriptomics umbrella
      return (
        <svg {...common}>
          <path d="M5 2c0 5 10 11 10 16M15 2C15 7 5 13 5 18" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
          <path d="M6.3 6h7.4M5.3 10h9.4M6.3 14h7.4" stroke="currentColor" strokeWidth="1" opacity="0.55" />
        </svg>
      );
    case "flask": // Metabolomics — small molecules, conical flask
      return (
        <svg {...common}>
          <path d="M8 2.5h4M8.5 2.5v4.2L4.5 15c-.6 1.3.3 2.5 1.7 2.5h7.6c1.4 0 2.3-1.2 1.7-2.5l-4-8.3V2.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
          <circle cx="8" cy="14" r="0.9" fill="currentColor" />
          <circle cx="10.5" cy="15.5" r="0.7" fill="currentColor" />
          <circle cx="12" cy="13" r="0.6" fill="currentColor" />
        </svg>
      );
    case "microbe": // Microbiomics — bacterial cell with flagella
      return (
        <svg {...common}>
          <ellipse cx="10" cy="10" rx="5" ry="3.4" transform="rotate(-30 10 10)" stroke="currentColor" strokeWidth="1.3" fill="none" />
          <path d="M14.2 6.8 17 4.5M14.6 9.5 18 9M12.5 13.5 14 17" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
          <circle cx="8.5" cy="9" r="0.6" fill="currentColor" />
          <circle cx="10.5" cy="11" r="0.6" fill="currentColor" />
        </svg>
      );
    case "protein": // Proteomics — folded ribbon structure
      return (
        <svg {...common}>
          <path d="M3 5c3 0 3 3.5 6 3.5s3-3.5 6-3.5M3 10c3 0 3 3.5 6 3.5s3-3.5 6-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
  }
}
