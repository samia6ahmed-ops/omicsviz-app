import { useTheme } from "./theme";

// The three overlapping circles stand for combining multiple omics data
// layers (genomics/transcriptomics/proteomics) into one figure — the
// core thing this product does. Color follows the shell's live theme.
export function LogoMark({ size = 22 }) {
  const C = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="12.7" cy="14.5" r="7.3" fill={C.accent} fillOpacity="0.55" />
      <circle cx="19.3" cy="14.5" r="7.3" fill={C.accent} fillOpacity="0.55" />
      <circle cx="16" cy="20" r="7.3" fill={C.accent} fillOpacity="0.55" />
    </svg>
  );
}
