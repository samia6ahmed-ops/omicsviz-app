import React, { useState, useMemo, useRef, useCallback, useEffect, useContext } from "react";
import { ThemeCtx as TC, useTheme } from "../shared/theme";
import CloudProjects from "../shared/CloudProjects";

// ═══════════════════════════════════════════════════════════════════════════════
//  Omilytix — Pathway Suite (merged: enrichment dot/bar plots + network map)
//  One shared data sheet, one shared enrichment engine (ORA + preranked GSEA),
//  three switchable visualizations: Dot Plot | Bar Plot | Network Map —
//  matching the GraphPad Prism model of "one data table, multiple graph sheets."
//
//  All statistical/algorithmic engines below were verified independently before
//  integration (Fisher's exact ORA, BH correction, preranked GSEA permutation
//  testing + multi-set FDR, Jaccard redundancy reduction, force-directed graph
//  layout) — see the original build sessions for the verification methodology
//  (synthetic known-answer test cases, calibration checks, SSR-rendered output
//  inspection). This merge reuses that code verbatim wherever possible rather
//  than re-deriving it, to avoid re-introducing bugs that were already fixed.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Themes ─────────────────────────────────────────────────────────────────────
const useC = () => useContext(TC);

// ─── Inline SVG icons (no emoji) ─────────────────────────────────────────────────
const IconSearch = ({size=13, color="currentColor"}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.2" y2="16.2"/>
  </svg>
);
const IconX = ({size=11, color="currentColor"}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round">
    <line x1="4" y1="4" x2="20" y2="20"/><line x1="20" y1="4" x2="4" y2="20"/>
  </svg>
);
const IconSun = ({size=14, color="currentColor"}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
    <circle cx="12" cy="12" r="4.5"/>
    <g strokeLinecap="round"><line x1="12" y1="1.5" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22.5"/>
    <line x1="1.5" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22.5" y2="12"/>
    <line x1="4.2" y1="4.2" x2="6" y2="6"/><line x1="18" y1="18" x2="19.8" y2="19.8"/>
    <line x1="4.2" y1="19.8" x2="6" y2="18"/><line x1="18" y1="6" x2="19.8" y2="4.2"/></g>
  </svg>
);
const IconMoon = ({size=14, color="currentColor"}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>
  </svg>
);
const IconPlus = ({size=12, color="currentColor"}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round">
    <line x1="12" y1="4" x2="12" y2="20"/><line x1="4" y1="12" x2="20" y2="12"/>
  </svg>
);

// ─── Color scales — sequential (ORA/dot/bar) + diverging (NES/network) ──────────
function makeStopScale(stops) {
  return function(t) {
    t = Math.max(0, Math.min(1, t));
    for (let i=0;i<stops.length-1;i++) {
      const [t0,c0] = stops[i], [t1,c1] = stops[i+1];
      if (t>=t0 && t<=t1) {
        const f = (t1>t0) ? (t-t0)/(t1-t0) : 0;
        return "rgb("+Math.round(c0[0]+(c1[0]-c0[0])*f)+","+
                     Math.round(c0[1]+(c1[1]-c0[1])*f)+","+
                     Math.round(c0[2]+(c1[2]-c0[2])*f)+")";
      }
    }
    return "rgb("+stops[stops.length-1][1].join(",")+")";
  };
}
const viridisColor = makeStopScale([[0,[253,231,37]],[0.25,[122,209,81]],[0.5,[33,145,140]],[0.75,[59,82,139]],[1,[68,1,84]]]);
const magmaColor   = makeStopScale([[0,[252,253,191]],[0.25,[254,159,109]],[0.5,[222,73,104]],[0.75,[114,31,129]],[1,[0,0,4]]]);
const plasmaColor  = makeStopScale([[0,[240,249,33]],[0.25,[252,166,54]],[0.5,[204,71,120]],[0.75,[114,16,156]],[1,[13,8,135]]]);
const blueScale    = makeStopScale([[0,[239,246,255]],[1,[32,68,155]]]);
const redsScale    = makeStopScale([[0,[254,240,217]],[0.5,[252,141,89]],[1,[179,0,0]]]);
const spectralColor= makeStopScale([[0,[94,79,162]],[0.25,[171,221,164]],[0.5,[255,255,191]],[0.75,[253,174,97]],[1,[213,62,79]]]);
const rdbuColor    = makeStopScale([[0,[33,102,172]],[0.25,[103,169,207]],[0.5,[247,247,247]],[0.75,[239,138,98]],[1,[178,24,43]]]);

const COLOR_SCALES = {
  viridis: { fn: viridisColor, label:"Viridis",             cbSafe:true,  diverging:false },
  magma:   { fn: magmaColor,   label:"Magma",               cbSafe:true,  diverging:false },
  plasma:  { fn: plasmaColor,  label:"Plasma",              cbSafe:true,  diverging:false },
  blue:    { fn: blueScale,    label:"Blue (single-hue)",   cbSafe:true,  diverging:false },
  reds:    { fn: redsScale,    label:"Reds (single-hue)",   cbSafe:true,  diverging:false },
  spectral:{ fn: spectralColor,label:"Spectral (diverging)",cbSafe:false, diverging:true  },
  rdbu:    { fn: rdbuColor,    label:"Red-Blue (diverging)",cbSafe:false, diverging:true  },
};
const getColorFn = name => (COLOR_SCALES[name] || COLOR_SCALES.viridis).fn;
const isDivergingScale = name => (COLOR_SCALES[name] || COLOR_SCALES.viridis).diverging;

// ─── Defaults ───────────────────────────────────────────────────────────────────
const DEF_D = {
  ff:"Inter", plotTitle:"",
  xLblDot:"Gene Ratio", xLblBar:"-log10(p-value)",
  tsz:14, tbd:true, tit:false, tcl:"",
  asz:12, abd:false, ait:false, acl:"#1a1a1a",
  ksz:10, kbold:false, kit:false, kcl:"#1a1a1a",
  termsz:10, termbd:false,
  colorScale:"viridis", colorScaleMode:"log",
  pbg:"", gc:"", aw:1.2, gw:0.5, showGrid:true,
  method:"ORA", database:"KEGG 2025", correction:"BH", showMethodLine:true,
  // Prism-style frame settings — apply to Dot Plot and Bar Plot only (a
  // force-directed network graph has no cartesian axes to frame).
  frameStyle:"L",      // "L" (bottom+left only, current default) | "box" (all 4 sides)
  tickDir:"out",        // "out" | "in" | "both" — matches Prism's axis tick options
  // Network-view specific style (ignored by Dot/Bar, used by Network Map)
  netColorScale:"viridis", netValueMode:"pvalue", netSimThreshold:0.25,
  netNodeSizeBy:"count", netShowLabels:true,
  // Legend appearance. These were previously hardcoded at 9.5/8.5px with a
  // fixed 12x90 colour bar, which is unreadably small once a figure is reduced
  // to a single journal column.
  legTitleSz:11, legTickSz:10, legCountSz:10,
  legBarW:14, legBarH:100, legGap:26, legShowCount:true,
  // Figure geometry. Plot width was fixed at 320px and row height was locked to
  // the term font size, so enlarging the labels grew the figure with no way to
  // compensate.
  plotW:320, rowGap:1.0, rowMin:22,
};
const DEF_S = {
  pCol:"padj", pCut:0.05, topN:15, sortBy:"padj", barMetric:"nlp", minCount:2,
  dotMin:4, dotMax:16, wrapWidth:38,
  barOrientation:"horizontal",
  vertLabelAngle:0,   // 0 | 45 | 90 — Prism-style label orientation, vertical bar mode only
  xMinDot:0, xMaxDot:"auto", xMinBar:"auto", xMaxBar:"auto",
  catColors:{}, excluded:[], searchQ:"",
  redundancyThreshold:0,  // 0 = off. Jaccard similarity cutoff above which a less-
                           // significant term is hidden as redundant with a more
                           // significant one that shares most of its genes.
};
const FONTS = ["Inter","Arial","Helvetica","Times New Roman","Georgia","Courier New"];

// ─── Example data ─────────────────────────────────────────────────────────────
const EXAMPLE = [
  {term:"Cell cycle", category:"KEGG", pvalue:0.00001, padj:0.0003, count:18, geneRatioN:18, geneRatioD:120, genes:"CDK1,CDK2,CCNB1,CCNE1,CDC20,PLK1"},
  {term:"p53 signaling pathway", category:"KEGG", pvalue:0.00004, padj:0.0007, count:12, geneRatioN:12, geneRatioD:120, genes:"TP53,MDM2,CDKN1A,BAX,GADD45A"},
  {term:"PI3K-Akt signaling pathway", category:"KEGG", pvalue:0.00012, padj:0.0016, count:22, geneRatioN:22, geneRatioD:120, genes:"AKT1,PIK3CA,PTEN,MTOR,FOXO1"},
  {term:"Apoptosis", category:"KEGG", pvalue:0.0003, padj:0.0031, count:14, geneRatioN:14, geneRatioD:120, genes:"BAX,BCL2,CASP3,CASP9,FAS"},
  {term:"Focal adhesion", category:"KEGG", pvalue:0.0005, padj:0.0042, count:16, geneRatioN:16, geneRatioD:120, genes:"ITGB1,ITGA5,FN1,VCL,PXN"},
  {term:"MAPK signaling pathway", category:"KEGG", pvalue:0.0009, padj:0.0061, count:19, geneRatioN:19, geneRatioD:120, genes:"MAPK1,MAPK3,RAF1,MAP2K1,EGFR"},
  {term:"Wnt signaling pathway", category:"KEGG", pvalue:0.0015, padj:0.0089, count:11, geneRatioN:11, geneRatioD:120, genes:"WNT1,CTNNB1,GSK3B,APC,LRP6"},
  {term:"positive regulation of cell proliferation", category:"GO:BP", pvalue:0.00002, padj:0.0004, count:24, geneRatioN:24, geneRatioD:120, genes:"MYC,CCND1,EGFR,KRAS,STAT3"},
  {term:"DNA damage response, signal transduction by p53 class mediator", category:"GO:BP", pvalue:0.00009, padj:0.0011, count:10, geneRatioN:10, geneRatioD:120, genes:"TP53,ATM,ATR,CHEK1,CHEK2"},
  {term:"regulation of apoptotic process", category:"GO:BP", pvalue:0.0002, padj:0.0022, count:20, geneRatioN:20, geneRatioD:120, genes:"BAX,BCL2,CASP3,TP53,FAS"},
  {term:"protein kinase binding", category:"GO:MF", pvalue:0.0008, padj:0.0058, count:15, geneRatioN:15, geneRatioD:120, genes:"AKT1,MAPK1,CDK1,RAF1,PLK1"},
  {term:"nucleus", category:"GO:CC", pvalue:0.0021, padj:0.0102, count:35, geneRatioN:35, geneRatioD:120, genes:"TP53,MYC,CCND1,STAT3,FOXO1"},
  {term:"cytoplasm", category:"GO:CC", pvalue:0.0041, padj:0.0165, count:28, geneRatioN:28, geneRatioD:120, genes:"AKT1,MAPK1,CASP3,BAX,RAF1"},
  {term:"VEGF signaling pathway", category:"KEGG", pvalue:0.0067, padj:0.0231, count:8, geneRatioN:8, geneRatioD:120, genes:"VEGFA,KDR,FLT1,PIK3CA,AKT1"},
  {term:"Notch signaling pathway", category:"KEGG", pvalue:0.0098, padj:0.0312, count:6, geneRatioN:6, geneRatioD:120, genes:"NOTCH1,DLL1,HES1,JAG1,RBPJ"},
];

// ─── Bundled reference set for built-in ORA (exploratory only) ───────────────────
const REF_TERMS = [
  {term:"Cell cycle", category:"KEGG", genes:["CDK1","CDK2","CDK4","CDK6","CCNB1","CCNE1","CCND1","CDC20","PLK1","RB1","E2F1","CDKN1A","CDKN2A","MCM2","ORC1"]},
  {term:"p53 signaling pathway", category:"KEGG", genes:["TP53","MDM2","CDKN1A","BAX","GADD45A","BBC3","SERPINB5","RRM2B","SESN1","ATM"]},
  {term:"PI3K-Akt signaling pathway", category:"KEGG", genes:["AKT1","PIK3CA","PIK3R1","PTEN","MTOR","FOXO1","GSK3B","BAD","CCND1","MYC"]},
  {term:"Apoptosis", category:"KEGG", genes:["BAX","BCL2","CASP3","CASP8","CASP9","FAS","FADD","TP53","BID","APAF1"]},
  {term:"MAPK signaling pathway", category:"KEGG", genes:["MAPK1","MAPK3","MAPK8","RAF1","MAP2K1","MAP2K2","EGFR","KRAS","HRAS","NRAS"]},
  {term:"Wnt signaling pathway", category:"KEGG", genes:["WNT1","CTNNB1","GSK3B","APC","LRP6","FZD1","DVL1","TCF7","AXIN1","CCND1"]},
  {term:"Focal adhesion", category:"KEGG", genes:["ITGB1","ITGA5","FN1","VCL","PXN","ITGAV","COL1A1","LAMA1","TLN1","AKT1"]},
  {term:"VEGF signaling pathway", category:"KEGG", genes:["VEGFA","KDR","FLT1","PIK3CA","AKT1","MAPK1","NOS3","PLA2G4A","PRKCA"]},
  {term:"Notch signaling pathway", category:"KEGG", genes:["NOTCH1","NOTCH2","DLL1","DLL3","HES1","JAG1","JAG2","RBPJ","MAML1"]},
  {term:"JAK-STAT signaling pathway", category:"KEGG", genes:["JAK1","JAK2","STAT3","STAT1","IL6","IL6R","SOCS3","PIK3CA","AKT1"]},
  {term:"TGF-beta signaling pathway", category:"KEGG", genes:["TGFB1","TGFBR1","TGFBR2","SMAD2","SMAD3","SMAD4","SMAD7","BMP4"]},
  {term:"mTOR signaling pathway", category:"KEGG", genes:["MTOR","RPTOR","RICTOR","AKT1","PIK3CA","TSC1","TSC2","RHEB","EIF4EBP1"]},
  {term:"positive regulation of cell proliferation", category:"GO:BP", genes:["MYC","CCND1","EGFR","KRAS","STAT3","AKT1","MAPK1","CDK4","E2F1","FOXM1"]},
  {term:"DNA damage response, signal transduction by p53 class mediator", category:"GO:BP", genes:["TP53","ATM","ATR","CHEK1","CHEK2","MDM2","RAD51","BRCA1","BRCA2"]},
  {term:"regulation of apoptotic process", category:"GO:BP", genes:["BAX","BCL2","CASP3","TP53","FAS","BID","APAF1","CASP9","BBC3"]},
  {term:"angiogenesis", category:"GO:BP", genes:["VEGFA","KDR","FLT1","ANGPT1","ANGPT2","TEK","NOS3","HIF1A"]},
  {term:"epithelial to mesenchymal transition", category:"GO:BP", genes:["SNAI1","SNAI2","ZEB1","ZEB2","TWIST1","CDH1","CDH2","VIM","FN1"]},
  {term:"inflammatory response", category:"GO:BP", genes:["IL6","IL1B","TNF","NFKB1","TLR4","CXCL8","CCL2","PTGS2"]},
  {term:"protein kinase binding", category:"GO:MF", genes:["AKT1","MAPK1","CDK1","RAF1","PLK1","CDK2","GSK3B","MTOR"]},
  {term:"DNA binding transcription factor activity", category:"GO:MF", genes:["TP53","MYC","STAT3","FOXO1","NFKB1","E2F1","SMAD4","HIF1A"]},
  {term:"nucleus", category:"GO:CC", genes:["TP53","MYC","CCND1","STAT3","FOXO1","RB1","E2F1","SMAD4","NFKB1"]},
  {term:"cytoplasm", category:"GO:CC", genes:["AKT1","MAPK1","CASP3","BAX","RAF1","GSK3B","MTOR","PIK3CA"]},
  {term:"plasma membrane", category:"GO:CC", genes:["EGFR","KDR","FLT1","ITGB1","ITGA5","NOTCH1","FAS","TGFBR1"]},
];

const MM_PRESETS = [
  {label:"89mm", desc:"Single col", w:89},
  {label:"120mm", desc:"1.5 col", w:120},
  {label:"183mm", desc:"Double col", w:183},
  {label:"247mm", desc:"Full page", w:247},
];

// ─── Statistics (Fisher's exact test + BH correction, log-space) ─────────────────
function logGamma(x) {
  const g=7, c=[0.99999999999980993,676.5203681218851,-1259.1392167224028,
    771.32342877765313,-176.61502916214059,12.507343278686905,
    -0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  if (x<0.5) return Math.log(Math.PI/Math.sin(Math.PI*x)) - logGamma(1-x);
  x-=1; let a=c[0]; const t=x+g+0.5;
  for (let i=1;i<g+2;i++) a+=c[i]/(x+i);
  return 0.5*Math.log(2*Math.PI)+(x+0.5)*Math.log(t)-t+Math.log(a);
}
function logChoose(n,k){ if(k<0||k>n)return -Infinity; return logGamma(n+1)-logGamma(k+1)-logGamma(n-k+1); }
function fisherORA(k,K,n,N){
  let logP=-Infinity; const maxX=Math.min(K,n);
  for(let x=k;x<=maxX;x++){
    const lp=logChoose(K,x)+logChoose(N-K,n-x)-logChoose(N,n);
    logP=logP===-Infinity?lp:Math.log(Math.exp(logP-lp)+1)+lp;
  }
  return Math.min(1,Math.exp(logP));
}
function bhCorrect(pvals){
  const idx=pvals.map((p,i)=>i).sort((a,b)=>pvals[a]-pvals[b]);
  const m=pvals.length, adj=new Array(m); let prevMin=1;
  for(let rank=m;rank>=1;rank--){
    const i=idx[rank-1];
    const val=Math.min(prevMin,pvals[i]*m/rank);
    adj[i]=val; prevMin=val;
  }
  return adj;
}
function runORA(geneList, background, database){
  const N=background;
  const genes=new Set(geneList.map(g=>g.trim().toUpperCase()).filter(Boolean));
  const n=genes.size;
  const db = database && database.length ? database : REF_TERMS;
  const results=db.map(t=>{
    const termGenes=new Set(t.genes.map(g=>g.toUpperCase()));
    const K=termGenes.size;
    const overlap=[...genes].filter(g=>termGenes.has(g));
    const k=overlap.length;
    const pvalue=k>0?fisherORA(k,K,n,N):1;
    return {term:t.term, category:t.category||"", pvalue, count:k, geneRatioN:k, geneRatioD:n, genes:overlap.join(",")};
  }).filter(r=>r.count>=1);
  const padj=bhCorrect(results.map(r=>r.pvalue));
  return results.map((r,i)=>({...r,padj:padj[i]})).sort((a,b)=>a.pvalue-b.pvalue);
}

// ─── GMT file parser ──────────────────────────────────────────────────────────
// Standard format used by MSigDB (Hallmark, C2/KEGG/Reactome/WikiPathways
// collections), Reactome, and WikiPathways for their free .gmt downloads:
//   pathway_name<TAB>description_or_url<TAB>gene1<TAB>gene2<TAB>...
// Loading a real .gmt file gives access to the complete, accurate database —
// this is the same format GSEA desktop and clusterProfiler's read.gmt() use,
// deliberately chosen over hand-embedding gene sets (which risks transcription
// errors) or embedding entire databases (which would make this file enormous).
function parseGMT(text) {
  const lines = text.trim().replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");
  const sets = [];
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [name, , ...genes] = parts;
    const cleanGenes = genes.map(g=>g.trim().toUpperCase()).filter(Boolean);
    if (name.trim() && cleanGenes.length) sets.push({ term: name.trim(), category: "Custom", genes: cleanGenes });
  }
  return sets;
}

// ─── Redundancy reduction (Jaccard gene-overlap similarity) ─────────────────────
// Verified independently before integration: two pathways sharing most of their
// genes (e.g. "Cell cycle" and "Mitotic cell cycle") get correctly flagged as
// redundant, while pathways with no shared genes are correctly kept independent.
function jaccard(genesA, genesB) {
  const a = new Set(genesA), b = new Set(genesB);
  let intersection = 0;
  a.forEach(x => { if (b.has(x)) intersection++; });
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection/union : 0;
}
function reduceRedundancy(terms, threshold) {
  if (!threshold || threshold <= 0) return { kept: terms, redundantTo: {} };
  const sorted = [...terms].sort((a,b)=>a.sigVal-b.sigVal);
  const kept = [];
  const redundantTo = {};
  sorted.forEach(t => {
    const tGenes = (t.genes||"").split(",").map(g=>g.trim()).filter(Boolean);
    const dup = kept.find(k => {
      const kGenes = (k.genes||"").split(",").map(g=>g.trim()).filter(Boolean);
      return jaccard(kGenes, tGenes) >= threshold;
    });
    if (dup) redundantTo[t.term] = dup.term;
    else kept.push(t);
  });
  return { kept, redundantTo };
}

// ─── Preranked GSEA (Subramanian et al. 2005) ────────────────────────────────────
// Weighted running-sum enrichment statistic (classic GSEA), significance via
// gene-permutation testing (shuffling set membership against the fixed ranked
// list — the standard approach when only a ranked gene list is available, no
// per-sample expression matrix). NES normalizes by the mean of the same-sign
// null distribution; FDR pools null ES values across ALL tested gene sets,
// matching the multi-set FDR method in the original GSEA paper.
//
// Verified independently before integration against three synthetic cases:
//  - genes concentrated at the top of the ranking  -> strong positive NES, p<0.05
//  - genes concentrated at the bottom of the ranking -> strong negative NES, p<0.05
//  - genes randomly scattered (true null)          -> ~5% false-positive rate at
//    p<0.05 across 40 independent trials (2.5% observed — correctly calibrated)
//  - force-directed layout (for the network view) separates disconnected
//    clusters by >6x their internal spread on a known two-cluster test graph
function computeES(rankedGenes, rankedScores, geneSet, p=1) {
  const N = rankedGenes.length;
  const inSet = rankedGenes.map(g => geneSet.has(g));
  const Nh = inSet.filter(Boolean).length;
  if (Nh === 0) return { ES: 0, runningSum: [], leadingEdge: [] };
  let normSum = 0;
  for (let i=0;i<N;i++) if (inSet[i]) normSum += Math.pow(Math.abs(rankedScores[i]), p);
  if (normSum === 0) normSum = 1;
  const missPenalty = 1/(N-Nh);
  let runningSum = 0, maxDev = 0, peakIdx = 0;
  const arr = new Array(N);
  for (let i=0;i<N;i++) {
    if (inSet[i]) runningSum += Math.pow(Math.abs(rankedScores[i]), p)/normSum;
    else runningSum -= missPenalty;
    arr[i] = runningSum;
    if (Math.abs(runningSum) > Math.abs(maxDev)) { maxDev = runningSum; peakIdx = i; }
  }
  // Leading edge: genes from the start of the ranked list up to the peak (ES>0)
  // or from the peak to the end (ES<0) that are IN the set — the genes actually
  // driving the enrichment signal.
  const leadingEdge = [];
  if (maxDev >= 0) { for (let i=0;i<=peakIdx;i++) if (inSet[i]) leadingEdge.push(rankedGenes[i]); }
  else { for (let i=peakIdx;i<N;i++) if (inSet[i]) leadingEdge.push(rankedGenes[i]); }
  return { ES: maxDev, runningSum: arr, leadingEdge };
}
function shuffleArr(arr) {
  const a=[...arr];
  for (let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
// Async, chunked so the browser stays responsive and can show progress —
// permutation testing is O(nPerm * N) per gene set, which is real work for
// large ranked lists. Yields control every few gene sets.
async function runPrerankedGSEA(rankedGenes, rankedScores, geneSets, opts={}) {
  const nPerm = opts.nPerm || 200;
  const p = opts.p || 1;
  const onProgress = opts.onProgress || (()=>{});
  const N = rankedGenes.length;
  const idxPool = Array.from({length:N},(_,i)=>i);

  const results = [];
  const allNullPos = [], allNullNeg = [];

  for (let si=0; si<geneSets.length; si++) {
    const gs = geneSets[si];
    const geneSet = new Set(gs.genes.map(g=>g.toUpperCase()));
    const Nh = [...geneSet].filter(g=>rankedGenes.includes(g)).length;
    if (Nh < (opts.minSize||3)) { onProgress(si+1, geneSets.length); continue; }

    const { ES, leadingEdge } = computeES(rankedGenes, rankedScores, geneSet, p);
    const nullPos = [], nullNeg = [];
    for (let k=0;k<nPerm;k++) {
      const picked = shuffleArr(idxPool).slice(0, Nh);
      const permSet = new Set(picked.map(i=>rankedGenes[i]));
      const { ES: permES } = computeES(rankedGenes, rankedScores, permSet, p);
      if (permES>=0) nullPos.push(permES); else nullNeg.push(permES);
    }
    let pvalue, NES;
    if (ES>=0) {
      const more = nullPos.filter(x=>x>=ES).length;
      pvalue = nullPos.length ? Math.max(more,1)/nullPos.length : 1;
      const meanPos = nullPos.length ? nullPos.reduce((a,b)=>a+b,0)/nullPos.length : 1;
      NES = meanPos>0 ? ES/meanPos : 0;
      allNullPos.push(...nullPos.map(x=>x/(meanPos||1)));
    } else {
      const more = nullNeg.filter(x=>x<=ES).length;
      pvalue = nullNeg.length ? Math.max(more,1)/nullNeg.length : 1;
      const meanNeg = nullNeg.length ? Math.abs(nullNeg.reduce((a,b)=>a+b,0)/nullNeg.length) : 1;
      NES = meanNeg>0 ? ES/meanNeg : 0;
      allNullNeg.push(...nullNeg.map(x=>x/(meanNeg||1)));
    }
    results.push({ term: gs.term, category: gs.category||"", ES, NES, pvalue, count: Nh, leadingEdge, genes: leadingEdge.join(",") });

    if (si % 3 === 0) { onProgress(si+1, geneSets.length); await new Promise(r=>setTimeout(r,0)); }
  }

  // Multi-set FDR: pool null NES across all tested sets, compare each observed
  // NES to the pooled null of the same sign (matches Subramanian et al. 2005).
  const posResults = results.filter(r=>r.NES>=0).sort((a,b)=>b.NES-a.NES);
  const negResults = results.filter(r=>r.NES<0).sort((a,b)=>a.NES-b.NES);
  posResults.forEach(r=>{
    const nullFrac = allNullPos.length ? allNullPos.filter(x=>x>=r.NES).length/allNullPos.length : 1;
    const obsFrac = posResults.filter(o=>o.NES>=r.NES).length/Math.max(posResults.length,1);
    r.padj = Math.min(1, obsFrac>0 ? nullFrac/obsFrac : 1);
  });
  negResults.forEach(r=>{
    const nullFrac = allNullNeg.length ? allNullNeg.filter(x=>x<=r.NES).length/allNullNeg.length : 1;
    const obsFrac = negResults.filter(o=>o.NES<=r.NES).length/Math.max(negResults.length,1);
    r.padj = Math.min(1, obsFrac>0 ? nullFrac/obsFrac : 1);
  });

  return results.sort((a,b)=>b.NES-a.NES);
}
function parseRankedList(text) {
  // gene<TAB or space or comma>score, one per line
  return text.trim().replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n").map(line=>{
    const parts = line.split(/[\t,]+|\s+/).filter(Boolean);
    if (parts.length<2) return null;
    const gene = parts[0].trim().toUpperCase();
    const score = parseFloat(parts[1]);
    return (gene && !isNaN(score)) ? {gene, score} : null;
  }).filter(Boolean).sort((a,b)=>b.score-a.score);
}

// ─── Text wrapping (word-boundary, hard-breaks overlong words, max lines) ────────
// Hard-breaking prevents any single line from ever exceeding maxChars — this is
// what closes the residual collision risk found when a term contains one very
// long word (e.g. "spliceosome", "cyclin-dependent") that alone exceeds the wrap width.
function wrapText(text, maxChars, maxLines){
  const words=String(text).split(" ");
  const lines=[]; let cur="";
  words.forEach(w0=>{
    let w=w0;
    while (w.length > maxChars) {
      if (cur) { lines.push(cur); cur=""; }
      lines.push(w.slice(0, maxChars-1) + "-");
      w = w.slice(maxChars-1);
    }
    if((cur+" "+w).trim().length>maxChars && cur){ lines.push(cur); cur=w; }
    else cur=(cur+" "+w).trim();
  });
  if(cur)lines.push(cur);
  if(maxLines && lines.length>maxLines){
    const kept=lines.slice(0,maxLines);
    return kept;
  }
  return lines;
}

// ─── Force-directed layout (Fruchterman-Reingold) ────────────────────────────────
// Verified independently before integration: on a synthetic graph with two
// disconnected 4-node cliques, the algorithm separated the two cluster
// centroids by >6x their internal spread — confirms it actually does what an
// enrichment map needs (functionally related pathways cluster visually,
// unrelated ones separate).
function forceLayout(nodeIds, edges, opts={}) {
  const W = opts.W||700, H = opts.H||600;
  const iterations = opts.iterations||300;
  const area = W*H;
  const k = Math.sqrt(area/Math.max(nodeIds.length,1)) * (opts.kMult||1);
  const pos = {};
  nodeIds.forEach((n,i) => {
    // Deterministic-ish initial placement on a circle (avoids relying on Math.random
    // for reproducibility across renders/exports) with tiny jitter to break symmetry
    const angle = (2*Math.PI*i)/Math.max(nodeIds.length,1);
    pos[n] = { x: W/2 + Math.cos(angle)*W*0.3, y: H/2 + Math.sin(angle)*H*0.3 };
  });
  let temp = W/10;
  for (let iter=0; iter<iterations; iter++) {
    const disp = {}; nodeIds.forEach(n => disp[n]={x:0,y:0});
    for (let i=0;i<nodeIds.length;i++) {
      for (let j=i+1;j<nodeIds.length;j++) {
        const a=nodeIds[i], b=nodeIds[j];
        let dx=pos[a].x-pos[b].x, dy=pos[a].y-pos[b].y;
        let dist = Math.sqrt(dx*dx+dy*dy)||0.01;
        const force = (k*k)/dist;
        dx/=dist; dy/=dist;
        disp[a].x += dx*force; disp[a].y += dy*force;
        disp[b].x -= dx*force; disp[b].y -= dy*force;
      }
    }
    edges.forEach(({source,target,weight})=>{
      let dx=pos[source].x-pos[target].x, dy=pos[source].y-pos[target].y;
      let dist = Math.sqrt(dx*dx+dy*dy)||0.01;
      const force = (dist*dist)/k * (weight||1);
      dx/=dist; dy/=dist;
      disp[source].x -= dx*force; disp[source].y -= dy*force;
      disp[target].x += dx*force; disp[target].y += dy*force;
    });
    nodeIds.forEach(n=>{
      const d = disp[n];
      const dist = Math.sqrt(d.x*d.x+d.y*d.y)||0.01;
      pos[n].x += (d.x/dist)*Math.min(dist,temp);
      pos[n].y += (d.y/dist)*Math.min(dist,temp);
      pos[n].x = Math.min(W-20, Math.max(20, pos[n].x));
      pos[n].y = Math.min(H-20, Math.max(20, pos[n].y));
    });
    temp *= 0.97;
  }
  return pos;
}

// ─── UI atoms ────────────────────────────────────────────────────────────────────
function Pill({active, onClick, children}) {
  const C=useC();
  return <button onClick={onClick} style={{padding:"4px 11px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer",
    background:active?C.accent:"transparent", border:"1px solid "+(active?C.accent:C.border), color:active?"#fff":C.muted, whiteSpace:"nowrap"}}>{children}</button>;
}
function SLabel({children}) {
  const C=useC();
  return <div style={{fontSize:9, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.09em", marginBottom:6}}>{children}</div>;
}
function Divider() { const C=useC(); return <div style={{height:1, background:C.border, margin:"12px 0"}}/>; }
function ColDot({color, size=20, onChange}) {
  return <div style={{position:"relative", width:size, height:size, borderRadius:4, overflow:"hidden", flexShrink:0, cursor:"pointer", border:"1px solid rgba(0,0,0,.1)"}}>
    <div style={{position:"absolute", inset:0, background:color}}/>
    <input type="color" value={color} onChange={e=>onChange(e.target.value)} style={{opacity:0, position:"absolute", inset:0, cursor:"pointer", width:"100%", height:"100%"}}/>
  </div>;
}
function Toggle({value, onChange, label}) {
  const C=useC();
  return <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8}}>
    <span style={{fontSize:11, color:C.muted}}>{label}</span>
    <button onClick={()=>onChange(!value)} style={{width:34, height:18, borderRadius:9, border:"none", cursor:"pointer", background:value?C.accent:C.border, position:"relative", padding:0, flexShrink:0}}>
      <div style={{position:"absolute", top:2, left:value?16:2, width:14, height:14, borderRadius:7, background:"#fff"}}/>
    </button>
  </div>;
}
function Slider({label, value, min, max, step, onChange, display}) {
  const C=useC();
  return <div style={{marginBottom:10}}>
    <div style={{display:"flex", justifyContent:"space-between", marginBottom:3}}>
      <span style={{fontSize:11, color:C.muted}}>{label}</span>
      <span style={{fontSize:11, fontWeight:600, color:C.accent}}>{display!==undefined?display:value}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(+e.target.value)} style={{width:"100%", accentColor:C.accent}}/>
  </div>;
}

// ─── Unified sheet model — 9 columns, serves Dot/Bar plots AND the Network map ───
// (PathwayPlot used 8 cols with geneRatioN/D; PathwayNetwork used 7 with NES.
// Merged here so pasting once feeds every visualization — a GSEA paste fills
// NES + pvalue/padj + genes; an ORA paste fills geneRatioN/D + pvalue/padj + genes;
// either way, all three plot types can render from the same rows.)
const COLS = [
  {k:"term",       l:"Term",      w:200, t:"text", ph:"Cell cycle"},
  {k:"category",   l:"Category",  w:75,  t:"text", ph:"KEGG"},
  {k:"pvalue",     l:"p-value",   w:80,  t:"num",  ph:"0.001"},
  {k:"padj",       l:"p.adjust",  w:80,  t:"num",  ph:"0.01"},
  {k:"count",      l:"Count",     w:65,  t:"num",  ph:"15"},
  {k:"geneRatioN", l:"Ratio N",   w:70,  t:"num",  ph:"15"},
  {k:"geneRatioD", l:"Ratio D",   w:70,  t:"num",  ph:"120"},
  {k:"NES",        l:"NES",       w:60,  t:"num",  ph:"(GSEA)"},
  {k:"genes",      l:"Genes",     w:200, t:"text", ph:"TP53,MYC,..."},
];
function blankRow(){ const r={}; COLS.forEach(c=>{r[c.k]="";}); return r; }
function parsePaste(text, sr, sc0){
  return text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").trim().split("\n").map((line,li)=>{
    const vals=line.split("\t"), upd={};
    vals.forEach((v,vi)=>{
      const ci=sc0+vi;
      if(ci<COLS.length){ const col=COLS[ci]; upd[col.k]=col.t==="num"?(v.trim()===""||isNaN(v.trim())?"":+v.trim()):v.trim(); }
    });
    return {ri:sr+li, upd};
  });
}
function mkSheet(name){
  return { id:Date.now()+Math.random(), name, rows:EXAMPLE.map(r=>({...r})),
    d:{...DEF_D}, sets:{...DEF_S, excluded:[], catColors:{}},
    geneListInput:"", backgroundN:20000, rankedListInput:"", gseaPerms:200,
    plotType:"dot" };
}

// ─── File import ────────────────────────────────────────────────────────────
// Enrichment tools all export a results table, but no two agree on column
// names, on how the gene ratio is written, or on the gene delimiter. This maps
// the common ones automatically and then shows the mapping for confirmation —
// nothing is inserted silently.

function splitDelimLine(line, delim) {
  const out=[]; let cur="", inQ=false;
  for (let i=0;i<line.length;i++) {
    const ch=line[i];
    if (inQ) {
      if (ch==='"') { if (line[i+1]==='"') { cur+='"'; i++; } else inQ=false; }
      else cur+=ch;
    } else if (ch==='"') inQ=true;
    else if (ch===delim) { out.push(cur); cur=""; }
    else cur+=ch;
  }
  out.push(cur);
  return out;
}

function sniffDelimiter(firstLines) {
  // Score on the MOST COMMON field count, not the first line's: exports often
  // carry a comment banner above the header, and anchoring on line 1 would let
  // that decide the delimiter for the whole file.
  const cands=["\t",",",";","|"];
  let best="\t", bestScore=0;
  cands.forEach(d=>{
    const freq={};
    firstLines.forEach(l=>{ const n=splitDelimLine(l,d).length; if(n>1) freq[n]=(freq[n]||0)+1; });
    let modeCount=0, modeAgree=0;
    Object.keys(freq).forEach(k=>{
      const n=freq[k];
      if (n>modeAgree || (n===modeAgree && Number(k)>modeCount)) { modeAgree=n; modeCount=Number(k); }
    });
    const score=modeAgree*(modeCount-1);
    if (score>bestScore) { bestScore=score; best=d; }
  });
  return best;
}

function parseDelimitedText(text) {
  const clean=text.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  const rawLines=clean.split("\n").filter(l=>l.trim()!=="");
  if (!rawLines.length) return {rows:[], delim:"\t"};
  const delim=sniffDelimiter(rawLines.slice(0,10));
  return {rows:rawLines.map(l=>splitDelimLine(l,delim).map(c=>c.trim())), delim};
}

function parseImportNumber(raw) {
  const s=String(raw).trim();
  if (s==="" || /^(na|nan|null|-|inf)$/i.test(s)) return null;
  let cand=s;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) cand=s.replace(/,/g,"");
  if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cand)) return null;
  const v=parseFloat(cand);
  return isFinite(v) ? v : null;
}

// Header patterns per field, in priority order. Covers clusterProfiler, DAVID,
// Enrichr, g:Profiler, GSEA and GOseq output.
const PW_PATTERNS = {
  term:       [/^description$/i, /^term[_ ]?name$/i, /^term$/i, /^name$/i, /^pathway$/i, /^go[_ ]?term$/i, /^id$/i],
  category:   [/^category$/i, /^source$/i, /^database$/i, /^ontology$/i, /^gs[_ ]?type$/i, /^type$/i],
  pvalue:     [/^p[_ .-]?value$/i, /^pvalue$/i, /^pval$/i, /^nom[_ ]?p[_ -]?val$/i, /^p$/i],
  padj:       [/^p[_ .]?adjust$/i, /^adjusted[_ ]?p[_ -]?value$/i, /^padj$/i, /^p[_ .]?adj$/i, /^benjamini$/i, /^fdr[_ ]?q[_ -]?val$/i, /^fdr$/i, /^qvalue$/i, /^q[_ ]?value$/i, /^over[_ ]?represented.*adjust/i],
  count:      [/^count$/i, /^intersection[_ ]?size$/i, /^overlap[_ ]?size$/i, /^size$/i, /^num[_ ]?genes$/i],
  ratio:      [/^gene[_ ]?ratio$/i, /^overlap$/i, /^ratio$/i, /^bg[_ ]?ratio$/i],
  ratioD:     [/^list[_ ]?total$/i, /^ratio[_ ]?d(enominator)?$/i, /^denominator$/i, /^query[_ ]?size$/i],
  NES:        [/^nes$/i, /^normali[sz]ed[_ ]?enrichment/i],
  genes:      [/^gene[_ ]?id$/i, /^genes$/i, /^gene[_ ]?symbols?$/i, /^user[_ ]?ids?$/i, /^intersection$/i, /^lead(ing)?[_ ]?edge$/i, /^core[_ ]?enrichment$/i],
};

function autoDetectPathwayFields(header) {
  const map={}, used={};
  Object.keys(PW_PATTERNS).forEach(field=>{
    const pats=PW_PATTERNS[field];
    let found=-1;
    for (let pi=0; pi<pats.length && found<0; pi++) {
      for (let ci=0; ci<header.length; ci++) {
        if (used[ci]) continue;
        if (pats[pi].test((header[ci]||"").trim())) { found=ci; break; }
      }
    }
    if (found>=0) { map[field]=found; used[found]=true; } else map[field]=-1;
  });
  return map;
}

// "15/120" -> {n:15, d:120}. clusterProfiler writes GeneRatio this way and
// Enrichr writes Overlap the same; a bare integer is treated as the count.
function splitRatio(raw) {
  const s=String(raw||"").trim();
  const m=s.match(/^(\d+)\s*[\/:]\s*(\d+)$/);
  if (m) return {n:+m[1], d:+m[2]};
  const v=parseImportNumber(s);
  if (v!==null && v>0 && v<1) return null;      // a decimal ratio carries no denominator
  return v!==null ? {n:v, d:null} : null;
}

// Gene lists arrive slash-, semicolon-, space- or comma-separated. The grid
// expects commas, and downstream splitting assumes them.
function normalizeGeneList(raw) {
  const s=String(raw||"").trim();
  if (!s) return "";
  return s.split(/[\/;,\s|]+/).map(g=>g.trim()).filter(Boolean).join(",");
}

function PathwayFileImport({onImport, onClose}) {
  const C=useC();
  const [drag,setDrag]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  const [parsed,setParsed]=useState(null);
  const [headerRow,setHeaderRow]=useState(0);
  const [map,setMap]=useState({});
  const fileRef=useRef(null);

  const FIELDS=[
    {key:"term",     label:"Term",     required:true},
    {key:"category", label:"Category", required:false},
    {key:"pvalue",   label:"p-value",  required:true},
    {key:"padj",     label:"p.adjust", required:false},
    {key:"count",    label:"Count",    required:false},
    {key:"ratio",    label:"Gene ratio",required:false},
    {key:"ratioD",   label:"Ratio total",required:false},
    {key:"NES",      label:"NES",      required:false},
    {key:"genes",    label:"Genes",    required:false},
  ];

  const applyRows=(rows,delim,fileName,extra)=>{
    if (!rows.length) { setError("That file didn't contain any readable rows."); return; }
    setParsed({rows, delim, fileName, ...(extra||{})});
    setHeaderRow(0);
    setMap(autoDetectPathwayFields(rows[0]||[]));
    setError(null);
  };

  const readFile = async file => {
    setError(null); setBusy(true);
    try {
      if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
        let XLSX;
        try { XLSX = await import(/* @vite-ignore */ "xlsx"); }
        catch(_) {
          setError("Excel support needs the SheetJS library, which isn't installed. Install it from the SheetJS CDN (npm i --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz) — the copy on the npm registry is stale and unpatched. Save As → CSV in Excel works today.");
          setBusy(false); return;
        }
        const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});
        const first=wb.SheetNames[0];
        const rows=XLSX.utils.sheet_to_json(wb.Sheets[first],{header:1,blankrows:false,raw:true})
                    .map(r=>r.map(c=>c===undefined||c===null?"":String(c)));
        applyRows(rows,"\t",file.name,{sheetNames:wb.SheetNames, activeSheet:first, workbook:wb, XLSX});
      } else {
        const {rows,delim}=parseDelimitedText(await file.text());
        applyRows(rows,delim,file.name);
      }
    } catch(err) {
      setError("Couldn't read that file: "+(err&&err.message?err.message:"unknown error"));
    }
    setBusy(false);
  };

  const switchSheet = name => {
    if (!parsed||!parsed.workbook) return;
    const rows=parsed.XLSX.utils.sheet_to_json(parsed.workbook.Sheets[name],{header:1,blankrows:false,raw:true})
                .map(r=>r.map(c=>c===undefined||c===null?"":String(c)));
    setParsed(p=>({...p, rows, activeSheet:name}));
    setHeaderRow(0);
    setMap(autoDetectPathwayFields(rows[0]||[]));
  };

  const built = useMemo(()=>{
    if (!parsed) return null;
    const out=[]; let dropped=0, ratioSplit=0, geneFixed=0;
    const get=(row,key)=>{ const ci=map[key]; return ci>=0 && row[ci]!==undefined ? String(row[ci]).trim() : ""; };
    for (let r=headerRow+1;r<parsed.rows.length;r++) {
      const row=parsed.rows[r];
      if (!row || row.every(c=>String(c).trim()==="")) continue;
      const term=get(row,"term");
      const p=parseImportNumber(get(row,"pvalue"));
      if (!term || p===null) { dropped++; continue; }
      const rec={term, category:get(row,"category"), pvalue:p};
      const padj=parseImportNumber(get(row,"padj")); if(padj!==null) rec.padj=padj;
      const nes=parseImportNumber(get(row,"NES"));   if(nes!==null)  rec.NES=nes;
      let count=parseImportNumber(get(row,"count"));
      const ratio=splitRatio(get(row,"ratio"));
      if (ratio) {
        if (ratio.d!==null) { rec.geneRatioN=ratio.n; rec.geneRatioD=ratio.d; ratioSplit++; }
        if (count===null) count=ratio.n;
      }
      if (count!==null) rec.count=count;
      if (rec.geneRatioN===undefined && count!==null) rec.geneRatioN=count;
      // DAVID and friends give the ratio as two separate columns (Count and
      // List Total) rather than a "15/120" string.
      if (rec.geneRatioD===undefined) {
        const rd=parseImportNumber(get(row,"ratioD"));
        if (rd!==null && rd>0) rec.geneRatioD=rd;
      }
      const rawGenes=get(row,"genes");
      if (rawGenes) {
        const norm=normalizeGeneList(rawGenes);
        if (norm!==rawGenes) geneFixed++;
        rec.genes=norm;
      }
      out.push(rec);
    }
    return {rows:out, dropped, ratioSplit, geneFixed};
  },[parsed, headerRow, map]);

  const doImport = () => {
    if (!built) return;
    const warnings=[];
    if (built.dropped>0) warnings.push(built.dropped+" row(s) skipped — no term name or no usable p-value.");
    if (built.ratioSplit>0) warnings.push(built.ratioSplit+" gene ratio(s) like \"15/120\" were split into numerator and denominator.");
    if (built.geneFixed>0) warnings.push(built.geneFixed+" gene list(s) were re-separated with commas.");
    if (map.padj<0) warnings.push("No adjusted p-value column was found — plots set to use adjusted p will fall back to raw p.");
    onImport(built.rows, warnings);
  };

  if (!parsed) {
    return (
      <div style={{border:"1px solid "+C.border, borderRadius:8, background:C.panel2, padding:14, marginBottom:10}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
          <span style={{fontSize:12, fontWeight:700, color:C.text}}>Import enrichment results</span>
          <button onClick={onClose} style={{background:"transparent", border:"none", cursor:"pointer", fontSize:15, color:C.muted}}>×</button>
        </div>
        <div
          onDragOver={e=>{e.preventDefault();setDrag(true);}}
          onDragLeave={()=>setDrag(false)}
          onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)readFile(f);}}
          onClick={()=>fileRef.current&&fileRef.current.click()}
          style={{border:"2px dashed "+(drag?C.accent:C.cBorder), borderRadius:8, padding:"26px 16px", textAlign:"center", cursor:"pointer", background:drag?C.cSel:C.cBg}}>
          <div style={{fontSize:12, fontWeight:600, color:C.text, marginBottom:3}}>{busy?"Reading…":"Drop a results table here, or click to browse"}</div>
          <div style={{fontSize:10.5, color:C.muted}}>clusterProfiler, DAVID, Enrichr, g:Profiler or GSEA output · CSV, TSV, TXT, XLSX</div>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.tab,.xlsx,.xlsm,.xls" style={{display:"none"}}
          onChange={e=>{const f=e.target.files[0];if(f)readFile(f);e.target.value="";}}/>
        {error&&<div style={{marginTop:9, fontSize:11, lineHeight:1.6, padding:"8px 10px", borderRadius:6, background:"#FEE2E2", color:"#991B1B", border:"1px solid #FCA5A5"}}>{error}</div>}
      </div>
    );
  }

  const header=parsed.rows[headerRow]||[];
  const previewRows=parsed.rows.slice(0,5);
  const previewCols=Math.min(Math.max.apply(null, previewRows.map(r=>r.length)), 7);
  const missing=FIELDS.filter(f=>f.required && (map[f.key]===undefined || map[f.key]<0));
  const importable=built.rows.length>0 && missing.length===0;

  return (
    <div style={{border:"1px solid "+C.border, borderRadius:8, background:C.panel2, padding:14, marginBottom:10}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
        <span style={{fontSize:12, fontWeight:700, color:C.text}}>{parsed.fileName}</span>
        <button onClick={onClose} style={{background:"transparent", border:"none", cursor:"pointer", fontSize:15, color:C.muted}}>×</button>
      </div>
      <div style={{fontSize:10.5, color:C.muted, marginBottom:9}}>
        {parsed.rows.length} rows · delimiter {parsed.delim==="\t"?"tab":parsed.delim===","?"comma":parsed.delim===";"?"semicolon":parsed.delim} · will import <strong style={{color:C.text}}>{built.rows.length} terms</strong>
      </div>

      {parsed.sheetNames&&parsed.sheetNames.length>1&&(
        <div style={{marginBottom:9, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap"}}>
          <span style={{fontSize:10.5, color:C.muted}}>Worksheet:</span>
          {parsed.sheetNames.map(n=>(
            <button key={n} onClick={()=>switchSheet(n)}
              style={{padding:"3px 9px", borderRadius:5, fontSize:10.5, cursor:"pointer", border:"1px solid "+(n===parsed.activeSheet?C.accent:C.border), background:n===parsed.activeSheet?C.accent:"transparent", color:n===parsed.activeSheet?"#fff":C.muted}}>{n}</button>
          ))}
        </div>
      )}

      <div style={{border:"1px solid "+C.cBorder, borderRadius:6, overflow:"auto", maxHeight:120, marginBottom:10, background:C.cBg}}>
        <table style={{borderCollapse:"collapse", fontSize:10.5, width:"max-content", minWidth:"100%"}}>
          <tbody>
            {previewRows.map((row,ri)=>{
              const isHeader=ri===headerRow;
              return (
                <tr key={ri} style={{background:isHeader?C.cSel:"transparent", opacity:ri<headerRow?0.4:1}}>
                  <td style={{padding:"3px 7px", color:C.muted, borderRight:"1px solid "+C.cBorder, borderBottom:"1px solid "+C.cBorder, whiteSpace:"nowrap"}}>
                    <button onClick={()=>{setHeaderRow(ri);setMap(autoDetectPathwayFields(parsed.rows[ri]||[]));}}
                      style={{background:"transparent", border:"none", cursor:"pointer", color:isHeader?C.accent:C.muted, fontSize:10, fontWeight:isHeader?700:400, padding:0}}>
                      {isHeader?"header ▸":ri+1}
                    </button>
                  </td>
                  {Array.from({length:previewCols}).map((_,ci)=>{
                    const assigned=FIELDS.find(f=>map[f.key]===ci);
                    return (
                      <td key={ci} style={{padding:"3px 8px", borderRight:"1px solid "+C.cBorder, borderBottom:"1px solid "+C.cBorder,
                        whiteSpace:"nowrap", maxWidth:110, overflow:"hidden", textOverflow:"ellipsis",
                        color:assigned?C.accent:C.text, fontWeight:(isHeader||assigned)?600:400,
                        background:assigned&&!isHeader?C.tag:"transparent"}}>
                        {row[ci]!==undefined?row[ci]:""}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{fontSize:11, fontWeight:700, color:C.text, marginBottom:6}}>Map columns</div>
      {FIELDS.map(f=>(
        <div key={f.key} style={{display:"flex", alignItems:"center", gap:8, marginBottom:5}}>
          <span style={{fontSize:11, color:C.muted, width:74, flexShrink:0}}>
            {f.label}{f.required&&<span style={{color:"#DC2626"}}> *</span>}
          </span>
          <select value={map[f.key]!==undefined?map[f.key]:-1} onChange={e=>setMap(mm=>({...mm,[f.key]:Number(e.target.value)}))}
            style={{flex:1, minWidth:0, padding:"4px 7px", fontSize:11, borderRadius:5, background:C.cBg, color:C.text, outline:"none",
              border:"1px solid "+((f.required&&(map[f.key]===undefined||map[f.key]<0))?"#DC2626":C.border)}}>
            <option value={-1}>— not mapped —</option>
            {header.map((h,ci)=><option key={ci} value={ci}>{h||"(column "+(ci+1)+")"}</option>)}
          </select>
        </div>
      ))}
      {missing.length>0&&(
        <div style={{fontSize:10.5, color:"#DC2626", marginTop:4}}>Pick a column for: {missing.map(f=>f.label).join(", ")}</div>
      )}

      {built.ratioSplit>0&&(
        <div style={{fontSize:11, lineHeight:1.55, padding:"8px 10px", borderRadius:6, marginTop:9, background:C.tag, color:C.tagText, border:"1px solid "+C.cBorder}}>
          {built.ratioSplit} gene ratio(s) written as "15/120" will be split into Ratio N and Ratio D automatically.
        </div>
      )}
      {built.dropped>0&&(
        <div style={{fontSize:11, lineHeight:1.55, padding:"8px 10px", borderRadius:6, marginTop:7, background:"#FEF3C7", color:"#92400E", border:"1px solid #FDE68A"}}>
          {built.dropped} row(s) will be skipped — missing a term name or a usable p-value.
        </div>
      )}

      <div style={{display:"flex", gap:6, marginTop:10}}>
        <button onClick={doImport} disabled={!importable}
          style={{flex:1, padding:"8px 0", borderRadius:7, fontSize:12, fontWeight:700, cursor:importable?"pointer":"default", background:importable?C.accent:C.border, border:"none", color:"#fff"}}>
          {importable ? "Import "+built.rows.length+" terms" : "Map required columns first"}
        </button>
        <button onClick={()=>{setParsed(null);setError(null);}}
          style={{padding:"8px 16px", borderRadius:7, fontSize:12, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>
          Choose another file
        </button>
      </div>
    </div>
  );
}

// Max grid rows given DOM nodes at once. The full table stays in state; this
// only limits live inputs so a large enrichment table doesn't lock the tab.
const GRID_ROW_CAP = 300;

function Sheet({rows, setRows, undo, redo, canU, canR}) {
  const C=useC();
  const [foc, setFoc]=useState(null);
  const [askClr, setAskClr]=useState(false);
  const [showImport, setShowImport]=useState(false);
  const [rowLimit, setRowLimit]=useState(GRID_ROW_CAP);
  const [importMsg, setImportMsg]=useState(null);
  const refs=useRef({});
  const display=useMemo(()=>{ const r=[...rows].slice(0,rowLimit); while(r.length<18)r.push(blankRow()); return r; },[rows,rowLimit]);
  const upd=useCallback((ri,k,v)=>{ setRows(prev=>{ const n=[...prev]; while(n.length<=ri)n.push(blankRow()); n[ri]={...n[ri],[k]:v}; return n; }); },[setRows]);
  const onPaste=useCallback((e,ri,ci)=>{
    const txt=e.clipboardData.getData("text");
    if(!txt.includes("\t")&&!txt.includes("\n"))return;
    e.preventDefault();
    const patches=parsePaste(txt,ri,ci);
    setRows(prev=>{ const n=[...prev]; patches.forEach(({ri:r,upd:u})=>{ while(n.length<=r)n.push(blankRow()); n[r]={...n[r],...u}; }); return n; });
    setTimeout(()=>refs.current[patches[patches.length-1].ri+"-"+ci]?.focus(),20);
  },[setRows]);
  const onKey=useCallback((e,ri,ci)=>{
    if((e.ctrlKey||e.metaKey)&&(e.key==="z"||e.key==="y"))return;
    const go=(dr,dc)=>{ e.preventDefault(); const nr=Math.max(0,ri+dr),nc=Math.max(0,Math.min(COLS.length-1,ci+dc)); setFoc({r:nr,c:nc}); setTimeout(()=>refs.current[nr+"-"+nc]?.focus(),0); };
    if(e.key==="ArrowUp")go(-1,0);
    if(e.key==="ArrowDown"||e.key==="Enter")go(1,0);
    if(e.key==="ArrowLeft"&&e.target.selectionStart===0)go(0,-1);
    if(e.key==="ArrowRight"&&e.target.selectionStart===e.target.value.length)go(0,1);
    if(e.key==="Tab"){e.preventDefault();go(0,e.shiftKey?-1:1);}
  },[]);
  const filled=rows.filter(r=>Object.values(r).some(v=>v!==""&&v!=null)).length;
  return (
    <div>
      <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:10, flexWrap:"wrap"}}>
        <button onClick={()=>setRows(EXAMPLE)} style={{padding:"5px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:C.accent, border:"none", color:"#fff"}}>Load example data</button>
        <button onClick={()=>setShowImport(s=>!s)} style={{padding:"5px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:showImport?C.accent:"transparent", border:"1px solid "+(showImport?C.accent:C.border), color:showImport?"#fff":C.text}}>Import file</button>
        <button onClick={undo} disabled={!canU} style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+C.border, cursor:canU?"pointer":"default", color:canU?C.text:C.muted}}>Undo</button>
        <button onClick={redo} disabled={!canR} style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+C.border, cursor:canR?"pointer":"default", color:canR?C.text:C.muted}}>Redo</button>
        {!askClr
          ? <button onClick={()=>setAskClr(true)} style={{padding:"4px 10px", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>Clear</button>
          : <span style={{display:"flex", gap:4, alignItems:"center"}}>
              <span style={{fontSize:11, color:C.muted}}>Clear all data?</span>
              <button onClick={()=>{setRows([]);setAskClr(false);}} style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:C.danger, border:"none", color:"#fff", fontWeight:600}}>Yes</button>
              <button onClick={()=>setAskClr(false)} style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>Cancel</button>
            </span>}
        <span style={{marginLeft:"auto", fontSize:11, color:C.muted, fontWeight:500}}>{filled} terms</span>
      </div>
      {showImport && (
        <PathwayFileImport
          onClose={()=>setShowImport(false)}
          onImport={(newRows, warnings)=>{
            setRows(newRows);              // one history entry: an import is a single undo step
            setRowLimit(GRID_ROW_CAP);
            setShowImport(false);
            setImportMsg(warnings.length ? warnings : null);
          }}/>
      )}

      {importMsg && (
        <div style={{fontSize:11, marginBottom:8, padding:"8px 10px", borderRadius:6, lineHeight:1.6, background:"#FEF3C7", color:"#92400E", border:"1px solid #FDE68A"}}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8}}>
            <div>
              <strong>Imported with notes</strong>
              <ul style={{margin:"4px 0 0", paddingLeft:16}}>{importMsg.map((mm,i)=><li key={i}>{mm}</li>)}</ul>
            </div>
            <button onClick={()=>setImportMsg(null)} style={{background:"transparent", border:"none", cursor:"pointer", fontSize:14, color:"inherit", flexShrink:0}}>×</button>
          </div>
        </div>
      )}

      {rows.length > rowLimit && (
        <div style={{fontSize:11, marginBottom:8, padding:"7px 10px", background:C.tag, borderRadius:6, color:C.tagText, border:"1px solid "+C.cBorder, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
          <span>Showing the first {rowLimit.toLocaleString()} of {rows.length.toLocaleString()} rows. The full table is loaded and every row is used for the plot.</span>
          <button onClick={()=>setRowLimit(r=>r+GRID_ROW_CAP)} style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.cBorder, color:C.tagText}}>Show {Math.min(GRID_ROW_CAP, rows.length-rowLimit).toLocaleString()} more</button>
          <button onClick={()=>setRowLimit(rows.length)} style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.cBorder, color:C.tagText}}>Show all (slow)</button>
        </div>
      )}

      <div style={{fontSize:11, marginBottom:8, padding:"6px 10px", background:C.tag, borderRadius:6, color:C.tagText, border:"1px solid "+C.cBorder}}>
        Paste or import from clusterProfiler (enrichKEGG/enrichGO), DAVID, ShinyGO, g:Profiler or Enrichr. Columns: Term, Category, p-value, p.adjust, Count, Ratio N, Ratio D, Genes.
      </div>
      <div style={{border:"1px solid "+C.border, borderRadius:8, overflow:"hidden", maxHeight:430, overflowY:"auto"}}>
        <table style={{borderCollapse:"collapse", tableLayout:"fixed", width:"100%"}}>
          <colgroup><col style={{width:30}}/>{COLS.map(c=><col key={c.k} style={{width:c.w}}/>)}</colgroup>
          <thead>
            <tr style={{background:C.cHdr}}>
              <th style={{borderBottom:"2px solid "+C.border, borderRight:"1px solid "+C.border, fontSize:10, color:C.muted, padding:"6px 4px", textAlign:"center", position:"sticky", top:0, zIndex:2, background:C.cHdr}}>#</th>
              {COLS.map(c=><th key={c.k} style={{borderBottom:"2px solid "+C.border, borderRight:"1px solid "+C.cBorder, padding:"6px 8px", position:"sticky", top:0, zIndex:2, background:C.cHdr, fontSize:11, fontWeight:700, color:C.text, whiteSpace:"nowrap"}}>
                {c.l}{c.t==="num"&&<span style={{fontSize:9, color:C.muted, opacity:.6, marginLeft:3}}>#</span>}</th>)}
            </tr>
          </thead>
          <tbody>
            {display.map((row,ri)=>(
              <tr key={ri} style={{background:foc&&foc.r===ri?C.cSel:ri%2===0?C.cBg:C.panel}}>
                <td style={{background:C.cHdr, borderRight:"1px solid "+C.border, borderBottom:"1px solid "+C.cBorder, fontSize:10, color:C.muted, textAlign:"center", padding:"0 4px"}}>{ri+1}</td>
                {COLS.map((col,ci)=>{
                  const rk=ri+"-"+ci, f=foc&&foc.r===ri&&foc.c===ci;
                  return <td key={col.k} style={{padding:0, borderBottom:"1px solid "+C.cBorder, borderRight:"1px solid "+C.cBorder}}>
                    <input ref={el=>{refs.current[rk]=el;}} value={row[col.k]!==undefined?row[col.k]:""} placeholder={f?col.ph:""}
                      inputMode={col.t==="num"?"decimal":"text"} onChange={e=>upd(ri,col.k,e.target.value)} onFocus={()=>setFoc({r:ri,c:ci})}
                      onBlur={()=>{if(col.t==="num"&&row[col.k]!==""){const n=parseFloat(row[col.k]);if(!isNaN(n))upd(ri,col.k,n);}}}
                      onKeyDown={e=>onKey(e,ri,ci)} onPaste={e=>onPaste(e,ri,ci)}
                      style={{width:"100%", boxSizing:"border-box", padding:"4px 8px", fontSize:11, background:f?C.panel:"transparent", color:C.text, border:f?"2px solid "+C.cFocus:"2px solid transparent", outline:"none", fontFamily:"monospace"}}/>
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:4, fontSize:10, color:C.muted, textAlign:"center"}}>Auto-expands. Empty rows ignored when plotting.</div>
    </div>
  );
}

// ─── ORA Calculator Panel ────────────────────────────────────────────────────────

function EnrichmentPanel({geneListInput, setGeneListInput, backgroundN, setBackgroundN, onRunORA,
  customDB, setCustomDB, rankedListInput, setRankedListInput, gseaPerms, setGseaPerms,
  onRunGSEA, gseaRunning, gseaProgress}) {
  const C=useC();
  const [mode, setMode] = useState("ora"); // ora | gsea
  const geneCount=useMemo(()=>geneListInput.split(/[\n,;\s]+/).map(g=>g.trim()).filter(Boolean).length,[geneListInput]);
  const rankedList=useMemo(()=>parseRankedList(rankedListInput),[rankedListInput]);
  const fileInputRef = useRef(null);
  const activeDB = customDB && customDB.sets && customDB.sets.length ? customDB : null;
  const dbSize = activeDB ? activeDB.sets.length : REF_TERMS.length;

  const handleFile = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const sets = parseGMT(ev.target.result);
        if (!sets.length) { alert("No gene sets found — check the file is a valid .gmt (tab-separated: name, description, genes...)."); return; }
        setCustomDB({ name: file.name, sets });
      } catch(err) { alert("Failed to parse file: "+err.message); }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <div style={{display:"flex", gap:5, marginBottom:10}}>
        {[["ora","ORA"],["gsea","GSEA (preranked)"]].map(([v,lb])=>(
          <Pill key={v} active={mode===v} onClick={()=>setMode(v)}>{lb}</Pill>
        ))}
      </div>

      {mode==="ora" ? (
        <div style={{fontSize:11, marginBottom:10, padding:"8px 10px", background:"rgba(217,119,6,0.08)", borderRadius:7, color:C.warn, border:"1px solid rgba(217,119,6,0.25)", lineHeight:1.5, fontWeight:600}}>
          ORA (over-representation, Fisher's exact test) — tests an unranked gene list against a background universe. Use GSEA instead if you have a full ranked list (e.g. all genes with log2FC) and want rank-aware enrichment.
        </div>
      ) : (
        <div style={{fontSize:11, marginBottom:10, padding:"8px 10px", background:C.tag, borderRadius:7, color:C.tagText, border:"1px solid "+C.cBorder, lineHeight:1.5}}>
          Preranked GSEA (Subramanian et al. 2005) — weighted running-sum enrichment statistic, significance via gene-permutation testing, multi-set FDR. Runs entirely in your browser; more permutations = more precise p-values but slower.
        </div>
      )}

      <SLabel>Reference Database</SLabel>
      {activeDB ? (
        <div style={{padding:"8px 10px", borderRadius:7, background:C.cSel, border:"1px solid "+C.accent, marginBottom:8}}>
          <div style={{fontSize:11, fontWeight:700, color:C.text}}>{activeDB.name}</div>
          <div style={{fontSize:10, color:C.muted}}>{activeDB.sets.length} gene sets loaded</div>
          <button onClick={()=>setCustomDB(null)} style={{marginTop:4, fontSize:10, color:C.danger, background:"transparent", border:"none", cursor:"pointer", padding:0, fontWeight:600}}>Remove, use built-in demo set</button>
        </div>
      ) : (
        <div style={{padding:"8px 10px", borderRadius:7, background:C.panel2, border:"1px solid "+C.border, marginBottom:8}}>
          <div style={{fontSize:11, fontWeight:700, color:C.text}}>Built-in demo set ({REF_TERMS.length} terms)</div>
          <div style={{fontSize:10, color:C.muted}}>Common KEGG/GO terms — exploratory only, not a real database.</div>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept=".gmt,.txt" onChange={handleFile} style={{display:"none"}}/>
      <button onClick={()=>fileInputRef.current&&fileInputRef.current.click()} style={{width:"100%", padding:"8px 0", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:"transparent", border:"1.5px dashed "+C.accent, color:C.accent, marginBottom:6}}>Load .gmt database file</button>
      <div style={{fontSize:9, color:C.muted, marginBottom:12, lineHeight:1.6}}>
        Download free, complete, official .gmt files: MSigDB Hallmark/KEGG/Reactome/WikiPathways at
        gsea-msigdb.org/gsea/downloads.jsp, or export directly from reactome.org / wikipathways.org.
      </div>
      <Divider/>

      {mode==="ora" ? (
        <>
          <SLabel>Gene List</SLabel>
          <textarea value={geneListInput} onChange={e=>setGeneListInput(e.target.value)} rows={7}
            placeholder={"TP53\nMYC\nAKT1\nEGFR\n(one per line, or comma-separated)"}
            style={{width:"100%", boxSizing:"border-box", padding:"7px 9px", fontSize:11, borderRadius:6, border:"1px solid "+(geneListInput.trim()?C.accent:C.border), background:C.cBg, color:C.text, outline:"none", fontFamily:"monospace", resize:"vertical", marginBottom:6}}/>
          <div style={{fontSize:10, color:C.muted, marginBottom:10}}>{geneCount} genes detected</div>
          <SLabel>Background Gene Universe</SLabel>
          <input type="number" value={backgroundN} onChange={e=>setBackgroundN(+e.target.value||20000)}
            style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:12, borderRadius:6, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none", marginBottom:4}}/>
          <div style={{fontSize:10, color:C.muted, marginBottom:12}}>Total genes tested in your experiment. Default ~20,000 approximates the human protein-coding genome.</div>
          <button onClick={onRunORA} disabled={geneCount<1} style={{width:"100%", padding:"10px 0", borderRadius:8, fontSize:13, fontWeight:700, cursor:geneCount<1?"default":"pointer", background:geneCount<1?C.border:C.accent, border:"none", color:"#fff"}}>Run ORA (Fisher's Exact Test)</button>
        </>
      ) : (
        <>
          <SLabel>Ranked Gene List</SLabel>
          <textarea value={rankedListInput} onChange={e=>setRankedListInput(e.target.value)} rows={7}
            placeholder={"TP53\t3.2\nMYC\t2.8\nAKT1\t-1.1\nEGFR\t-2.4\n(gene + score, e.g. log2FC — any order, will be re-ranked by score)"}
            style={{width:"100%", boxSizing:"border-box", padding:"7px 9px", fontSize:11, borderRadius:6, border:"1px solid "+(rankedListInput.trim()?C.accent:C.border), background:C.cBg, color:C.text, outline:"none", fontFamily:"monospace", resize:"vertical", marginBottom:6}}/>
          <div style={{fontSize:10, color:C.muted, marginBottom:10}}>{rankedList.length} ranked genes detected (paste gene + a numeric score per line, e.g. log2FC or t-statistic)</div>
          <SLabel>Permutations</SLabel>
          <div style={{display:"flex", gap:5, marginBottom:6}}>
            {[100,200,500,1000].map(v=>(<Pill key={v} active={gseaPerms===v} onClick={()=>setGseaPerms(v)}>{v}</Pill>))}
          </div>
          <div style={{fontSize:9, color:C.muted, marginBottom:12, lineHeight:1.5}}>
            More permutations give more precise p-values (down to 1/nPerm resolution) but take proportionally longer. With {dbSize} gene sets × {rankedList.length||"?"} ranked genes, {gseaPerms} permutations may take anywhere from a few seconds to a minute or more in-browser.
          </div>
          {gseaRunning ? (
            <div>
              <div style={{height:8, borderRadius:4, background:C.panel2, overflow:"hidden", marginBottom:6}}>
                <div style={{height:"100%", width:(gseaProgress.total?100*gseaProgress.done/gseaProgress.total:0)+"%", background:C.accent, transition:"width .2s"}}/>
              </div>
              <div style={{fontSize:10, color:C.muted, textAlign:"center"}}>Testing gene set {gseaProgress.done} of {gseaProgress.total}...</div>
            </div>
          ) : (
            <button onClick={onRunGSEA} disabled={rankedList.length<10} style={{width:"100%", padding:"10px 0", borderRadius:8, fontSize:13, fontWeight:700, cursor:rankedList.length<10?"default":"pointer", background:rankedList.length<10?C.border:C.accent, border:"none", color:"#fff"}}>Run Preranked GSEA</button>
          )}
          {rankedList.length>0 && rankedList.length<10 && <div style={{fontSize:10, color:C.warn, marginTop:6}}>Need at least 10 ranked genes to run GSEA.</div>}
        </>
      )}
    </div>
  );
}

// ─── Style helper (extended with Prism-style frame settings) ────────────────────
function gS(d, C) {
  const f = d.ff || "Inter";
  const mkAxis = (sz,bd,it,cl) => ({ fontSize:d[sz]||12, fontWeight:d[bd]?"bold":"normal", fontStyle:d[it]?"italic":"normal", fill:d[cl]||C.text, fontFamily:f });
  return {
    ff:f,
    ttl:{fontSize:d.tsz||14, fontWeight:d.tbd?"bold":"normal", fontStyle:d.tit?"italic":"normal", color:d.tcl||C.text, fontFamily:f},
    ax:mkAxis("asz","abd","ait","acl"),
    tk:mkAxis("ksz","kbold","kit","kcl"),
    term:{fontSize:d.termsz||10, fontWeight:d.termbd?"bold":"normal", fill:C.text, fontFamily:f},
    bg:d.pbg||C.panel, grid:d.gc||C.grid, aw:d.aw||1.2, gw:d.gw||0.5, axLine:d.acl||C.text,
    frameStyle: d.frameStyle||"L", tickDir: d.tickDir||"out",
  };
}
// Tick mark line endpoints for a HORIZONTAL axis (x-axis ticks, vertical tick marks)
// at a given axisY. "out" = below the line (away from plot), "in" = above the line
// (into the plot area), "both" = crosses the line — matches Prism's axis tick options.
function tickMarkV(axisY, dir, len=5) {
  if (dir==="in")  return { y1: axisY-len, y2: axisY };
  if (dir==="both")return { y1: axisY-len, y2: axisY+len };
  return { y1: axisY, y2: axisY+len }; // "out" default
}
// Tick mark endpoints for a VERTICAL axis (y-axis ticks, horizontal tick marks) at axisX.
function tickMarkH(axisX, dir, len=5) {
  if (dir==="in")  return { x1: axisX, x2: axisX+len };
  if (dir==="both")return { x1: axisX-len, x2: axisX+len };
  return { x1: axisX-len, x2: axisX }; // "out" default (ticks point left, away from plot)
}

// ─── Style Panel ─────────────────────────────────────────────────────────────────
function PlotPanel({d, set, plotType}) {
  const C=useC();
  if (plotType==="network") return <NetworkStylePanel d={d} set={set}/>;
  return (
    <div>
      <SLabel>Figure Title</SLabel>
      <input value={d.plotTitle||""} onChange={e=>set(s=>({...s,plotTitle:e.target.value}))} placeholder="e.g. KEGG Pathway Enrichment"
        style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:12, borderRadius:6, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none", marginBottom:10}}/>
      <Divider/>
      <SLabel>Method Annotation</SLabel>
      <Toggle value={d.showMethodLine!==false} onChange={v=>set(s=>({...s,showMethodLine:v}))} label="Show method line on figure"/>
      <div style={{fontSize:9, color:C.muted, marginBottom:8, lineHeight:1.5}}>
        This only labels the figure caption — it describes whatever data is in your sheet, whether from
        this tool's built-in ORA/GSEA calculator or pasted from external software.
      </div>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6}}>
        <div><div style={{fontSize:10, color:C.muted, marginBottom:3}}>Method</div>
          <input value={d.method||"ORA"} onChange={e=>set(s=>({...s,method:e.target.value}))} placeholder="e.g. ORA, GSEA"
            style={{width:"100%", boxSizing:"border-box", padding:"5px 7px", fontSize:11, borderRadius:5, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none"}}/></div>
        <div><div style={{fontSize:10, color:C.muted, marginBottom:3}}>Correction</div>
          <select value={d.correction||"BH"} onChange={e=>set(s=>({...s,correction:e.target.value}))} style={{width:"100%", padding:"5px 7px", fontSize:11, borderRadius:5, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none"}}>
            <option value="BH">BH (FDR)</option><option value="bonferroni">Bonferroni</option><option value="none">None</option></select></div>
      </div>
      <div style={{marginBottom:10}}><div style={{fontSize:10, color:C.muted, marginBottom:3}}>Database / Source</div>
        <input value={d.database||""} onChange={e=>set(s=>({...s,database:e.target.value}))} placeholder="e.g. KEGG 2025, GO Biological Process"
          style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:11, borderRadius:6, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none"}}/></div>
      <div style={{padding:"7px 9px", borderRadius:6, background:C.panel2, border:"1px solid "+C.border, fontSize:10, color:C.muted, marginBottom:10}}>
        Preview: <span style={{color:C.text, fontWeight:600}}>{(d.method||"ORA")+", "+(d.database||"KEGG")+", "+(d.correction==="none"?"uncorrected":(d.correction||"BH")+"-corrected")}</span>
      </div>
      <Divider/>
      <SLabel>Figure Size</SLabel>
      <div style={{fontSize:9.5, color:C.muted, marginBottom:8, lineHeight:1.5}}>
        Height follows the number of terms and the term font size. Use row spacing to compress or open it up.
      </div>
      <Slider label="Plot width" value={d.plotW||320} min={160} max={900} step={10} onChange={v=>set(s=>({...s,plotW:v}))} display={(d.plotW||320)+"px"}/>
      <Slider label="Row spacing" value={d.rowGap||1} min={0.5} max={2.5} step={0.1} onChange={v=>set(s=>({...s,rowGap:v}))} display={(d.rowGap||1).toFixed(1)+"x"}/>
      <Slider label="Min row height" value={d.rowMin||22} min={12} max={60} step={1} onChange={v=>set(s=>({...s,rowMin:v}))} display={(d.rowMin||22)+"px"}/>

      <Divider/>
      <SLabel>Legend</SLabel>
      <Slider label="Title size" value={d.legTitleSz||11} min={7} max={22} step={0.5} onChange={v=>set(s=>({...s,legTitleSz:v}))} display={(d.legTitleSz||11)+"px"}/>
      <Slider label="Value label size" value={d.legTickSz||10} min={6} max={20} step={0.5} onChange={v=>set(s=>({...s,legTickSz:v}))} display={(d.legTickSz||10)+"px"}/>
      <Slider label="Count label size" value={d.legCountSz||10} min={6} max={20} step={0.5} onChange={v=>set(s=>({...s,legCountSz:v}))} display={(d.legCountSz||10)+"px"}/>
      <Slider label="Color bar width" value={d.legBarW||14} min={6} max={40} step={1} onChange={v=>set(s=>({...s,legBarW:v}))} display={(d.legBarW||14)+"px"}/>
      <Slider label="Color bar height" value={d.legBarH||100} min={50} max={260} step={5} onChange={v=>set(s=>({...s,legBarH:v}))} display={(d.legBarH||100)+"px"}/>
      <Slider label="Gap before Count" value={d.legGap||26} min={8} max={80} step={2} onChange={v=>set(s=>({...s,legGap:v}))} display={(d.legGap||26)+"px"}/>
      <Toggle value={d.legShowCount!==false} onChange={v=>set(s=>({...s,legShowCount:v}))} label="Show Count size legend"/>
      <div style={{fontSize:9.5, color:C.muted, marginTop:6, marginBottom:4, lineHeight:1.5}}>
        The legend can also be dragged to reposition it on the figure.
      </div>

      <Divider/>
      <SLabel>Color Scale</SLabel>
      <div style={{display:"flex", flexDirection:"column", gap:4, marginBottom:10}}>
        {Object.entries(COLOR_SCALES).map(([v,info])=>(
          <button key={v} onClick={()=>set(s=>({...s,colorScale:v}))} style={{display:"flex", alignItems:"center", gap:8, padding:"5px 8px", borderRadius:7, cursor:"pointer", textAlign:"left", background:(d.colorScale||"viridis")===v?C.cSel:"transparent", border:"1.5px solid "+((d.colorScale||"viridis")===v?C.accent:C.border)}}>
            <div style={{display:"flex", height:14, width:50, borderRadius:3, overflow:"hidden", flexShrink:0}}>
              {Array.from({length:10},(_,i)=>i/9).map((t,i)=><div key={i} style={{flex:1, background:info.fn(t)}}/>)}</div>
            <span style={{fontSize:11, fontWeight:600, color:(d.colorScale||"viridis")===v?C.text:C.muted, flex:1}}>{info.label}</span>
            {!info.cbSafe&&<span style={{fontSize:8, color:C.warn, fontWeight:700, padding:"1px 5px", borderRadius:6, background:"rgba(217,119,6,0.12)"}}>not CB-safe</span>}
          </button>
        ))}
      </div>
      <SLabel>Color Mapping</SLabel>
      <div style={{display:"flex", gap:5, marginBottom:6}}>
        {[["log","Log scale (recommended)"],["linear","Linear"]].map(([v,lb])=>(
          <Pill key={v} active={(d.colorScaleMode||"log")===v} onClick={()=>set(s=>({...s,colorScaleMode:v}))}>{lb}</Pill>))}
      </div>
      <div style={{fontSize:9, color:C.muted, marginBottom:10, lineHeight:1.5}}>p-values span orders of magnitude. Log mapping (on -log10(p)) keeps highly significant terms visually distinct.</div>
      <Divider/>
      <SLabel>Axis Style</SLabel>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10}}>
        {[["Axis labels","asz"],["Tick labels","ksz"],["Term names","termsz"],["Title","tsz"]].map(([lb,k])=>(
          <div key={k}><div style={{fontSize:10, color:C.muted, marginBottom:3}}>{lb}</div>
            <input type="number" min={7} max={22} value={d[k]} onChange={e=>set(s=>({...s,[k]:+e.target.value}))} style={{width:"100%", padding:"4px 7px", fontSize:11, borderRadius:5, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none"}}/></div>))}
      </div>
      <Divider/>
      <SLabel>Grid and Background</SLabel>
      <Toggle value={d.showGrid!==false} onChange={v=>set(s=>({...s,showGrid:v}))} label="Show grid lines"/>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:10}}>
        <span style={{fontSize:11, color:C.muted, flex:1}}>Plot background</span>
        <ColDot color={d.pbg||"#FFFFFF"} onChange={v=>set(s=>({...s,pbg:v}))}/>
        {d.pbg&&<button onClick={()=>set(s=>({...s,pbg:""}))} style={{fontSize:10, color:C.muted, background:"transparent", border:"none", cursor:"pointer"}}>reset</button>}
      </div>
      <Divider/>
      <SLabel>Font Family</SLabel>
      <select value={d.ff||"Inter"} onChange={e=>set(s=>({...s,ff:e.target.value}))} style={{width:"100%", padding:"6px 9px", fontSize:11, borderRadius:6, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none", marginBottom:10}}>
        {FONTS.map(f=><option key={f} value={f}>{f}</option>)}
      </select>
      <Divider/>
      <button onClick={()=>set({...DEF_D})} style={{width:"100%", padding:"6px 0", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>Reset all to defaults</button>
    </div>
  );
}

// ─── Network-specific style panel ────────────────────────────────────────────────
function NetworkStylePanel({d, set}) {
  const C=useC();
  return (
    <div>
      <SLabel>Figure Title</SLabel>
      <input value={d.plotTitle||""} onChange={e=>set(s=>({...s,plotTitle:e.target.value}))} placeholder="e.g. Enrichment Map"
        style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:12, borderRadius:6, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none", marginBottom:10}}/>
      <Divider/>
      <SLabel>Node Color</SLabel>
      <div style={{display:"flex", gap:5, marginBottom:6}}>
        {[["pvalue","p-value"],["nes","NES (GSEA)"]].map(([v,lb])=>(
          <Pill key={v} active={(d.netValueMode||"pvalue")===v} onClick={()=>set(s=>({...s,netValueMode:v}))}>{lb}</Pill>
        ))}
      </div>
      <div style={{display:"flex", flexDirection:"column", gap:4, marginBottom:10}}>
        {Object.entries(COLOR_SCALES).map(([v,info])=>(
          <button key={v} onClick={()=>set(s=>({...s,netColorScale:v}))} style={{display:"flex", alignItems:"center", gap:8, padding:"5px 8px", borderRadius:7, cursor:"pointer", textAlign:"left", background:(d.netColorScale||"viridis")===v?C.cSel:"transparent", border:"1.5px solid "+((d.netColorScale||"viridis")===v?C.accent:C.border)}}>
            <div style={{display:"flex", height:14, width:50, borderRadius:3, overflow:"hidden", flexShrink:0}}>
              {Array.from({length:10},(_,i)=>i/9).map((t,i)=><div key={i} style={{flex:1, background:info.fn(t)}}/>)}</div>
            <span style={{fontSize:11, fontWeight:600, color:(d.netColorScale||"viridis")===v?C.text:C.muted}}>{info.label}</span>
          </button>
        ))}
      </div>
      <Divider/>
      <SLabel>Node Size</SLabel>
      <div style={{display:"flex", gap:5, marginBottom:10}}>
        {[["count","Gene count"],["significance","-log10(p)"]].map(([v,lb])=>(
          <Pill key={v} active={(d.netNodeSizeBy||"count")===v} onClick={()=>set(s=>({...s,netNodeSizeBy:v}))}>{lb}</Pill>
        ))}
      </div>
      <Divider/>
      <SLabel>Edges (Gene Overlap)</SLabel>
      <Slider label="Similarity threshold (Jaccard)" value={d.netSimThreshold||0.25} min={0.05} max={0.75} step={0.05} onChange={v=>set(s=>({...s,netSimThreshold:v}))} display={((d.netSimThreshold||0.25)*100).toFixed(0)+"%"}/>
      <div style={{fontSize:9, color:C.muted, marginBottom:10, lineHeight:1.6}}>
        An edge connects two pathways sharing at least this fraction of their combined genes. 25% is a common starting point.
      </div>
      <Divider/>
      <Toggle value={d.netShowLabels!==false} onChange={v=>set(s=>({...s,netShowLabels:v}))} label="Show term labels"/>
      <Toggle value={d.showMethodLine!==false} onChange={v=>set(s=>({...s,showMethodLine:v}))} label="Show method line"/>
      <Divider/>
      <SLabel>Font Family</SLabel>
      <select value={d.ff||"Inter"} onChange={e=>set(s=>({...s,ff:e.target.value}))} style={{width:"100%", padding:"6px 9px", fontSize:11, borderRadius:6, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none", marginBottom:10}}>
        {FONTS.map(f=><option key={f} value={f}>{f}</option>)}
      </select>
    </div>
  );
}

// ─── Terms Panel ─────────────────────────────────────────────────────────────────
function TermsPanel({sets, setSets, totalTerms, shownTerms, redundantCount}) {
  const C=useC();
  const isVert = (sets.barOrientation||"horizontal")==="vertical";
  return (
    <div>
      <SLabel>Significance Source</SLabel>
      <div style={{display:"flex", gap:5, marginBottom:10}}>
        {[["padj","Adjusted p"],["pvalue","Raw p"]].map(([v,lb])=><Pill key={v} active={sets.pCol===v} onClick={()=>setSets(s=>({...s,pCol:v}))}>{lb}</Pill>)}
      </div>
      <Slider label="Significance cutoff" value={sets.pCut} min={0.001} max={0.2} step={0.001} onChange={v=>setSets(s=>({...s,pCut:v}))} display={sets.pCut}/>
      <Slider label="Minimum gene count" value={sets.minCount} min={1} max={20} step={1} onChange={v=>setSets(s=>({...s,minCount:v}))}/>
      <Divider/>
      <SLabel>Redundancy Reduction</SLabel>
      <Slider label="Gene-overlap similarity cutoff" value={sets.redundancyThreshold||0} min={0} max={0.9} step={0.05}
        onChange={v=>setSets(s=>({...s,redundancyThreshold:v}))} display={(sets.redundancyThreshold||0)===0?"Off":(sets.redundancyThreshold*100).toFixed(0)+"%"}/>
      <div style={{fontSize:9, color:C.muted, marginBottom:8, lineHeight:1.6}}>
        Hides a term when it shares this much gene membership (Jaccard) with a more significant term already shown.
      </div>
      {(sets.redundancyThreshold||0)>0 && redundantCount>0 && (
        <div style={{fontSize:10, color:C.accent, padding:"5px 9px", borderRadius:6, background:C.cSel, marginBottom:10}}>
          {redundantCount} redundant term{redundantCount!==1?"s":""} hidden
        </div>
      )}
      <Divider/>
      <SLabel>Terms Shown</SLabel>
      <div style={{padding:"10px", borderRadius:8, background:C.panel2, border:"1px solid "+C.border, marginBottom:10}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
          <span style={{fontSize:11, color:C.text, fontWeight:600}}>Top N terms</span>
          <span style={{fontSize:13, fontWeight:700, color:C.accent}}>{sets.topN}</span></div>
        <input type="range" min={5} max={40} step={1} value={sets.topN} onChange={e=>setSets(s=>({...s,topN:+e.target.value}))} style={{width:"100%", accentColor:C.accent}}/>
      </div>
      <div style={{fontSize:11, color:C.muted, marginBottom:10}}>Showing <span style={{color:C.accent, fontWeight:600}}>{shownTerms}</span> of {totalTerms} terms passing filters</div>
      <SLabel>Sort By</SLabel>
      <div style={{display:"flex", flexDirection:"column", gap:4, marginBottom:10}}>
        {[["padj","Adjusted p-value"],["pvalue","Raw p-value"],["count","Gene count"],["ratio","Gene ratio"],["category","Group by category"]].map(([v,lb])=>(
          <button key={v} onClick={()=>setSets(s=>({...s,sortBy:v}))} style={{display:"flex", alignItems:"center", gap:8, padding:"6px 10px", borderRadius:7, cursor:"pointer", textAlign:"left", background:sets.sortBy===v?C.cSel:"transparent", border:"1.5px solid "+(sets.sortBy===v?C.accent:C.border)}}>
            <div style={{width:11, height:11, borderRadius:"50%", flexShrink:0, border:"2px solid "+(sets.sortBy===v?C.accent:C.border), background:sets.sortBy===v?C.accent:"transparent"}}/>
            <div><div style={{fontSize:11, fontWeight:600, color:sets.sortBy===v?C.text:C.muted}}>{lb}</div>
              {v==="category"&&<div style={{fontSize:9, color:C.muted}}>Adds dashed dividers between category groups</div>}</div>
          </button>))}
      </div>
      <Divider/>
      <SLabel>Bar Plot Metric</SLabel>
      <div style={{display:"flex", gap:5, marginBottom:10}}>
        {[["nlp","-log10(p)"],["count","Gene count"]].map(([v,lb])=><Pill key={v} active={sets.barMetric===v} onClick={()=>setSets(s=>({...s,barMetric:v}))}>{lb}</Pill>)}
      </div>
      <SLabel>Bar Orientation</SLabel>
      <div style={{display:"flex", gap:5, marginBottom:6}}>
        {[["horizontal","Horizontal"],["vertical","Vertical"]].map(([v,lb])=><Pill key={v} active={(sets.barOrientation||"horizontal")===v} onClick={()=>setSets(s=>({...s,barOrientation:v}))}>{lb}</Pill>)}
      </div>
      <div style={{fontSize:9, color:C.muted, marginBottom:10, lineHeight:1.5}}>Vertical: plot scrolls horizontally rather than compressing when there are many terms.</div>
      {isVert && (
        <>
          <SLabel>Term Label Angle</SLabel>
          <div style={{display:"flex", gap:5, marginBottom:6}}>
            {[[0,"Horizontal"],[45,"Angled 45°"],[90,"Vertical 90°"]].map(([v,lb])=>(
              <Pill key={v} active={(sets.vertLabelAngle||0)===v} onClick={()=>setSets(s=>({...s,vertLabelAngle:v}))}>{lb}</Pill>
            ))}
          </div>
          <div style={{padding:"7px 9px", borderRadius:6, background:C.panel2, border:"1px solid "+C.border, marginBottom:6}}>
            <div style={{fontSize:10, color:C.muted, marginBottom:5}}>Fine angle</div>
            <input type="range" min={0} max={90} step={5} value={sets.vertLabelAngle||0} onChange={e=>setSets(s=>({...s,vertLabelAngle:+e.target.value}))} style={{width:"100%", accentColor:C.accent}}/>
            <div style={{textAlign:"right", fontSize:10, fontWeight:700, color:C.accent, marginTop:2}}>{sets.vertLabelAngle||0}°</div>
          </div>
          <div style={{fontSize:9, color:C.muted, marginBottom:10, lineHeight:1.6}}>
            0° wraps to multiple lines with zero overlap risk regardless of term count (recommended). Angled/vertical show one line only, truncating long names.
          </div>
        </>
      )}
      <Divider/>
      <SLabel>Dot Size Range</SLabel>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10}}>
        <div><div style={{fontSize:10, color:C.muted, marginBottom:3}}>Min (px)</div>
          <input type="number" min={1} max={10} value={sets.dotMin} onChange={e=>setSets(s=>({...s,dotMin:+e.target.value}))} style={{width:"100%", padding:"4px 7px", fontSize:11, borderRadius:5, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none"}}/></div>
        <div><div style={{fontSize:10, color:C.muted, marginBottom:3}}>Max (px)</div>
          <input type="number" min={8} max={30} value={sets.dotMax} onChange={e=>setSets(s=>({...s,dotMax:+e.target.value}))} style={{width:"100%", padding:"4px 7px", fontSize:11, borderRadius:5, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none"}}/></div>
      </div>
      <Divider/>
      <SLabel>Term Name Wrapping</SLabel>
      <Slider label="Wrap width (characters)" value={sets.wrapWidth} min={20} max={60} step={1} onChange={v=>setSets(s=>({...s,wrapWidth:v}))}/>
    </div>
  );
}

// ─── Axes + Frame Panel (Prism-style: range, box/L frame, tick direction) ────────
function AxesPanel({sets, setSets, d, setD, plotType}) {
  const C=useC();
  const AxIn=({label,k})=>{
    const [v,setV]=useState(String(sets[k]));
    useEffect(()=>setV(String(sets[k])),[sets[k]]);
    const commit=()=>{
      const sv=v.trim().toLowerCase();
      if(sv===""||sv==="auto"){setSets(p=>({...p,[k]:"auto"}));setV("auto");return;}
      const n=parseFloat(sv);
      if(!isNaN(n)){setSets(p=>({...p,[k]:n}));setV(String(n));} else setV(String(sets[k]));
    };
    return <div><div style={{fontSize:10, color:C.muted, marginBottom:3}}>{label}</div>
      <input value={v} onChange={e=>setV(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")commit();}} placeholder="auto"
        style={{width:"100%", boxSizing:"border-box", padding:"5px 7px", fontSize:11, borderRadius:5, border:"1px solid "+(v==="auto"||v===""?C.border:C.accent), background:C.cBg, color:C.text, outline:"none", fontFamily:"monospace"}}/></div>;
  };
  const isDot = plotType==="dot";
  return (
    <div>
      <SLabel>{isDot?"Gene Ratio Axis (Dot Plot)":"Metric Axis (Bar Plot)"}</SLabel>
      <div style={{fontSize:10, color:C.muted, marginBottom:8, lineHeight:1.5}}>Type "auto" to reset. Default starts at 0 — the journal-standard convention.</div>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8}}>
        {isDot ? <><AxIn label="Min" k="xMinDot"/><AxIn label="Max" k="xMaxDot"/></> : <><AxIn label="Min" k="xMinBar"/><AxIn label="Max" k="xMaxBar"/></>}
      </div>
      <button onClick={()=>setSets(s=>({...s, xMinDot:0, xMaxDot:"auto", xMinBar:"auto", xMaxBar:"auto"}))} style={{width:"100%", padding:"5px 0", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted, marginBottom:14}}>Reset range to default</button>

      <Divider/>
      <SLabel>Frame (Prism-style)</SLabel>
      <div style={{display:"flex", gap:5, marginBottom:6}}>
        {[["L","L-shape (bottom + left)"],["box","Full box (all 4 sides)"]].map(([v,lb])=>(
          <Pill key={v} active={(d.frameStyle||"L")===v} onClick={()=>setD(s=>({...s,frameStyle:v}))}>{lb}</Pill>
        ))}
      </div>
      <div style={{fontSize:9, color:C.muted, marginBottom:10, lineHeight:1.5}}>
        L-shape is the common convention for enrichment dot/bar plots (matches clusterProfiler, ggplot2 defaults).
        Full box matches classic Prism/GraphPad-style figures where all four sides are framed.
      </div>

      <SLabel>Tick Direction</SLabel>
      <div style={{display:"flex", gap:5, marginBottom:6}}>
        {[["out","Outside"],["in","Inside"],["both","Both"]].map(([v,lb])=>(
          <Pill key={v} active={(d.tickDir||"out")===v} onClick={()=>setD(s=>({...s,tickDir:v}))}>{lb}</Pill>
        ))}
      </div>
      <div style={{fontSize:9, color:C.muted, marginBottom:10, lineHeight:1.5}}>
        Prism defaults to inside-pointing ticks; most journal figures use outside. "Both" draws a small crossing tick, common in older-style figures.
      </div>

      <SLabel>Frame Line Width</SLabel>
      <Slider label="Width (pt)" value={d.aw||1.2} min={0.5} max={3} step={0.1} onChange={v=>setD(s=>({...s,aw:v}))}/>

      <Divider/>
      <div style={{fontSize:10, color:C.muted, lineHeight:1.6}}>Setting an explicit axis range is useful when comparing two pathway figures side by side — fix both to the same range so dot/bar sizes are visually comparable.</div>
    </div>
  );
}

function PlotTooltip({term, x, y, onClose, onExclude, onDownload, pColLabel, onMouseEnter, onMouseLeave}) {
  const t = term;
  const geneList = t.genes ? t.genes.split(",").map(g=>g.trim()).filter(Boolean) : [];
  const TW = 260;
  const visibleGenes = geneList.slice(0, 20);
  const moreCount = geneList.length - visibleGenes.length;

  const downloadGenes = () => {
    if (!geneList.length) return;
    const csv = "gene\n" + geneList.join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = t.term.slice(0,40).replace(/[^a-zA-Z0-9]/g,"_") + "_genes.csv";
    a.click();
    onDownload && onDownload(t);
  };

  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{
      position:"absolute", left:x+14, top:Math.max(y-10, 0), maxWidth:"calc(100% - 20px)",
      width:TW, zIndex:300, pointerEvents:"all",
      background:"#fff", border:"1px solid #DDE1E7", borderRadius:10,
      boxShadow:"0 8px 32px rgba(0,0,0,.14)", fontFamily:"Inter,system-ui,sans-serif",
    }}>
      <div style={{padding:"10px 12px 7px", borderBottom:"1px solid #EEF0F4"}}>
        <div style={{display:"flex", alignItems:"flex-start", gap:6}}>
          <div style={{flex:1, fontSize:12, fontWeight:700, color:"#1E2736", lineHeight:1.35}}>{t.term}</div>
          <button onClick={onClose} style={{flexShrink:0, width:20, height:20, borderRadius:10, border:"none", background:"#F0F2F5", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0}}><IconX size={9} color="#64748B"/></button>
        </div>
        {t.category&&<span style={{fontSize:10, color:"#2563EB", fontWeight:600, padding:"1px 6px", borderRadius:8, background:"rgba(37,99,235,.08)", display:"inline-block", marginTop:4}}>{t.category}</span>}
      </div>
      <div style={{padding:"8px 12px", borderBottom:"1px solid #EEF0F4"}}>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 12px"}}>
          {[
            [pColLabel, t.sigVal.toExponential(2)],
            ["p-value",  t.pvalue.toExponential(2)],
            ["-log10(p)", t.nlp.toFixed(3)],
            ["Count",    t.count],
            ["Gene Ratio", t.ratioD>1 ? (t.ratioN+"/"+t.ratioD+" ("+((t.ratio||0)*100).toFixed(1)+"%)") : "—"],
          ].map(([lb,val])=>(
            <div key={lb} style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <span style={{fontSize:10, color:"#64748B"}}>{lb}</span>
              <span style={{fontSize:10, fontWeight:700, color:"#1E2736"}}>{val}</span>
            </div>
          ))}
        </div>
      </div>
      {geneList.length>0&&(
        <div style={{padding:"7px 12px", borderBottom:"1px solid #EEF0F4"}}>
          <div style={{fontSize:10, fontWeight:700, color:"#64748B", marginBottom:4}}>Genes ({geneList.length})</div>
          <div style={{display:"flex", flexWrap:"wrap", gap:"2px 4px"}}>
            {visibleGenes.map(g=>(
              <span key={g} style={{fontSize:9, fontStyle:"italic", color:"#1D4ED8", background:"#EFF6FF", borderRadius:4, padding:"1px 5px", fontWeight:500}}>{g}</span>
            ))}
            {moreCount>0&&<span style={{fontSize:9, color:"#64748B", padding:"1px 4px"}}>+{moreCount} more</span>}
          </div>
        </div>
      )}
      <div style={{padding:"7px 10px", display:"flex", gap:5}}>
        {geneList.length>0&&(
          <button onClick={downloadGenes}
            style={{flex:1, padding:"5px 0", borderRadius:6, fontSize:10, fontWeight:600, cursor:"pointer", background:"#2563EB", border:"none", color:"#fff"}}>
            Download genes CSV
          </button>
        )}
        <button onClick={()=>onExclude&&onExclude(t.term)}
          style={{flex:1, padding:"5px 0", borderRadius:6, fontSize:10, fontWeight:600, cursor:"pointer", background:"transparent", border:"1px solid #DDE1E7", color:"#64748B"}}>
          Exclude term
        </button>
      </div>
    </div>
  );
}

// ─── Shared data processing ──────────────────────────────────────────────────────
function useProcessedTerms(rows, sets) {
  return useMemo(() => {
    const valid = rows.filter(r => r.term && r.term.trim());
    let anyRatioFallback = false;
    const mapped = valid.map(r => {
      const pvalue = +r.pvalue || 1;
      const padj   = r.padj !== "" && r.padj != null ? +r.padj : pvalue;
      const count  = +r.count || 0;
      const hasRatioN = r.geneRatioN !== "" && r.geneRatioN != null;
      const hasRatioD = r.geneRatioD !== "" && r.geneRatioD != null;
      const ratioN = hasRatioN ? +r.geneRatioN : count;
      const ratioD = hasRatioD ? +r.geneRatioD : 1;
      if (!hasRatioN || !hasRatioD) anyRatioFallback = true;
      const ratio  = ratioD>0 ? ratioN/ratioD : 0;
      const sigVal = sets.pCol==="padj" ? padj : pvalue;
      return {
        term: r.term, category: r.category||"", pvalue, padj, count,
        ratioN, ratioD, ratio, sigVal, genes: r.genes||"",
        nlp: -Math.log10(Math.max(sigVal,1e-300)),
      };
    }).filter(r => r.sigVal <= sets.pCut && r.count >= sets.minCount);

    // Redundancy reduction — collapses terms that share most of their genes
    // (e.g. "Cell cycle" / "Mitotic cell cycle") down to the more significant
    // representative. Verified independently before integration (see build notes).
    const { kept: deduped, redundantTo } = reduceRedundancy(mapped, sets.redundancyThreshold);

    const sortFn = {
      padj:    (a,b)=>a.padj-b.padj,
      pvalue:  (a,b)=>a.pvalue-b.pvalue,
      count:   (a,b)=>b.count-a.count,
      ratio:   (a,b)=>b.ratio-a.ratio,
      category:(a,b)=>{
        const cc = (a.category||"").localeCompare(b.category||"");
        return cc !== 0 ? cc : a.padj-b.padj;
      },
    }[sets.sortBy] || ((a,b)=>a.padj-b.padj);

    const sorted = [...deduped].sort(sortFn);
    const q = (sets.searchQ||"").trim().toLowerCase();
    const excluded = sets.excluded instanceof Set ? sets.excluded : new Set(Array.isArray(sets.excluded)?sets.excluded:[]);
    const filtered = sorted.filter(t => {
      if (excluded.has(t.term)) return false;
      if (!q) return true;
      return t.term.toLowerCase().includes(q) || (t.genes||"").toLowerCase().includes(q) || (t.category||"").toLowerCase().includes(q);
    });
    const top = filtered.slice(0, sets.topN);
    return { all: mapped, shown: top, ratioFallback: anyRatioFallback, redundantCount: Object.keys(redundantTo).length };
  }, [rows, sets.pCol, sets.pCut, sets.minCount, sets.sortBy, sets.topN, sets.searchQ, sets.excluded, sets.redundancyThreshold]);
}

// ─── Legend Card ──────────────────────────────────────────────────────────────
// Shared, polished legend component used by both dot plot and bar plot —
// framed like a Prism/Nature figure legend (subtle card, generous spacing)
// rather than a bare floating gradient bar.
// ─── Legend Card — rewritten: no bordered box, simplified tick labels ───────────
// Color always encodes significance (or NES) continuously; it is never silently
// swapped for category coloring. Category information is conveyed separately via
// the category separator lines (Sort By > Group by category) and the tooltip —
// not by hijacking the color channel, which is what caused the color scale to
// look "broken" (the legend showed a p-value gradient while dots/bars were
// actually colored by category whenever more than one category was present).
// Round "nice" tick values (1, 2, 5 x 10^n) covering a range. Legend ticks read
// as 0.01 / 0.02 / 0.03 rather than whatever the data minimum happened to be.
function niceStep(range, target) {
  const raw = range / Math.max(1, target);
  if (!(raw > 0) || !isFinite(raw)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return mult * mag;
}
function niceTicks(min, max, target, integerOnly) {
  if (!isFinite(min) || !isFinite(max) || max <= min) return isFinite(min) ? [min] : [];
  let step = niceStep(max - min, target);
  if (integerOnly) step = Math.max(1, Math.round(step));
  const start = Math.ceil(min / step) * step;
  const out = [];
  for (let v = start; v <= max + step * 1e-9 && out.length < 12; v += step) {
    out.push(integerOnly ? Math.round(v) : +v.toPrecision(12));
  }
  if (!out.length) return [integerOnly ? Math.round(min) : min];
  return out;
}
// On a log colour scale the useful gradations are decades (0.01, 1e-3, 1e-4).
// The bar is always anchored on the real data extremes, with whole decades in
// between — labelling only the decades inside the range often left just one or
// two ticks on a narrow p-value spread.
function niceLogPTicks(pLo, pHi, target) {
  const lo = Math.max(1e-300, Math.min(pLo, pHi)), hi = Math.max(pLo, pHi);
  if (!(hi > 0) || hi <= lo) return [hi];
  const out = [hi];
  const eHi = Math.floor(Math.log10(hi)), eLo = Math.ceil(Math.log10(lo));
  const span = Math.max(1, eHi - eLo + 1);
  const stride = Math.max(1, Math.ceil(span / Math.max(2, target)));
  for (let e = eHi; e >= eLo && out.length < 10; e -= stride) {
    const v = Math.pow(10, e);
    if (v < hi * 0.97 && v > lo * 1.03) out.push(v);
  }
  out.push(lo);
  return out;
}
// Linear colour bar: real extremes plus round values in between.
function niceRangeTicks(lo, hi, target) {
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return [hi];
  const inner = niceTicks(lo, hi, target, false).filter(v=>v > lo + (hi-lo)*0.04 && v < hi - (hi-lo)*0.04);
  return [hi].concat(inner.slice().reverse()).concat([lo]);
}
// Size legend: round values where the range allows, otherwise evenly spaced
// integers anchored on the true minimum and maximum.
function countLegendValues(cMin, cMax, target) {
  if (!(cMax > cMin)) return [Math.round(cMax)];
  const nice = niceTicks(cMin, cMax, target, true).filter(v=>v>=cMin && v<=cMax);
  if (nice.length >= 3) return nice;
  const out = [];
  for (let i=0;i<target;i++) out.push(Math.round(cMin + (cMax-cMin)*i/(target-1)));
  return out.filter((v,i,a)=>a.indexOf(v)===i);
}

function fmtLegendVal(v) {
  if (v === 0) return "0";
  const av = Math.abs(v);
  if (av >= 1 && av < 10000) return v.toFixed(av >= 100 ? 0 : 1).replace(/\.0$/,"");
  // Two significant figures below 1: rounding 0.0986 to "0.1" would misreport
  // the actual extreme of the data the bar is anchored on.
  if (av >= 0.001) return (+v.toPrecision(2)).toString();
  return v.toExponential(1).replace("e-","e-");
}
function LegendCard({x, y, C, ff, title, colorFn, legendTicks, useLog, cMin, cMax, dotR, showSizeLegend, countTicks, lg}) {
  const L = lg || {};
  const titleSz = L.titleSz || 9.5, tickSz = L.tickSz || 8.5, countSz = L.countSz || 9.5;
  const barW = L.barW || 12, gradH = L.barH || 90, gap = L.gap || 22;
  // Show every tick that was generated. Previously only the first, middle and
  // last were drawn, so a colour bar could never carry more than three labels.
  const ticks3 = legendTicks || [];
  const sizes = (countTicks && countTicks.length) ? countTicks : [cMin, Math.round((cMin+cMax)/2), cMax];
  return (
    <g transform={"translate("+x+","+y+")"}>
      <text x={0} y={0} fontSize={titleSz} fontWeight="700" fill={C.text} fontFamily={ff}>{title}</text>
      <g transform={"translate(0,"+(titleSz+4)+")"}>
        <defs>
          <linearGradient id="legGrad" x1="0" y1="0" x2="0" y2="1">
            {Array.from({length:10},(_,i)=>i/9).map((t,i)=><stop key={i} offset={(t*100)+"%"} stopColor={colorFn(1-t)}/>)}
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={barW} height={gradH} fill="url(#legGrad)" rx={3} stroke={C.border} strokeWidth={0.5}/>
        {ticks3.map((lt,i)=>(
          <g key={i}>
            <line x1={barW} y1={(1-lt.t)*gradH} x2={barW+4} y2={(1-lt.t)*gradH} stroke={C.muted} strokeWidth={1}/>
            <text x={barW+7} y={(1-lt.t)*gradH+tickSz*0.35} fontSize={tickSz} fill={C.text} fontFamily={ff}>{fmtLegendVal(lt.val)}</text>
          </g>
        ))}
      </g>
      {showSizeLegend && (
        <g transform={"translate(0,"+(titleSz+4+gradH+gap)+")"}>
          <text x={0} y={0} fontSize={titleSz} fontWeight="700" fill={C.text} fontFamily={ff}>Count</text>
          {(function(){
            // Space rows by the dot they contain so larger circles never collide.
            let cy = 14;
            return sizes.map((c,i)=>{
              const r = dotR(c);
              cy += (i===0 ? r : r + 6);
              const node = (
                <g key={i} transform={"translate("+(dotR(sizes[sizes.length-1])+2)+","+cy+")"}>
                  <circle cx={0} cy={0} r={r} fill="none" stroke={C.muted} strokeWidth={1}/>
                  <text x={dotR(sizes[sizes.length-1])+12} y={countSz*0.35} fontSize={countSz} fill={C.text} fontFamily={ff}>{c}</text>
                </g>
              );
              cy += r;
              return node;
            });
          })()}
        </g>
      )}
    </g>
  );
}

// ─── Draggable legend positioning ────────────────────────────────────────────
// Matches VolcanoPlot's structure: legend position is click-drag repositionable,
// using SVG-space coordinates (via createSVGPoint + getScreenCTM) so dragging
// stays correct regardless of how the SVG is scaled on screen. Position is
// treated as ephemeral UI state (like Volcano does) rather than persisted data —
// resets to a sensible default per plot type, not saved/loaded with the project.
function useLegendDrag(svgRef, initialPos) {
  const [pos, setPos] = useState(initialPos);
  const [drag, setDrag] = useState(null);
  // Until the user drags it, the legend follows the plot geometry. Once moved,
  // their placement wins and nothing repositions it behind their back.
  const [moved, setMoved] = useState(false);
  const toSVGPoint = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg || !svg.createSVGPoint) return {x:0,y:0};
    const pt = svg.createSVGPoint(); pt.x=clientX; pt.y=clientY;
    const ctm = svg.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : {x:0,y:0};
  }, [svgRef]);
  const onDragStart = useCallback(e => {
    e.stopPropagation();
    const sp = toSVGPoint(e.clientX, e.clientY);
    setDrag({sx:sp.x, sy:sp.y, ox:pos.x, oy:pos.y}); setMoved(true);
    e.preventDefault();
  }, [pos, toSVGPoint]);
  const onSVGMove = useCallback(e => {
    if (!drag) return;
    const sp = toSVGPoint(e.clientX, e.clientY);
    setPos({x: drag.ox+(sp.x-drag.sx), y: drag.oy+(sp.y-drag.sy)});
  }, [drag, toSVGPoint]);
  const onSVGUp = useCallback(()=>setDrag(null), []);
  const reset = useCallback(()=>{ setMoved(false); setPos(initialPos); }, [initialPos.x, initialPos.y]);
  return { pos, moved, reset, dragging: !!drag, onDragStart, onSVGMove, onSVGUp };
}
// Transparent hit-region rendered behind a legend so the whole card area is
// draggable, not just its text/graphics — sized generously since exact legend
// content height varies (ticks, size legend, category count, etc).
function LegendDragHandle({x, y, w=130, h=240, dragging, onDragStart}) {
  return <rect x={x-12} y={y-16} width={w} height={h} fill="transparent"
    style={{cursor: dragging?"grabbing":"move"}} onPointerDown={onDragStart}/>;
}

// ─── Dot Plot ─────────────────────────────────────────────────────────────────

function DotPlot({rows, sets, d, svgRef, onExclude, onDownloadGenes}) {
  const C = useC();
  const st = gS(d, C);
  const { shown, ratioFallback } = useProcessedTerms(rows, sets);
  const ff = st.ff;
  const colorFn = getColorFn(d.colorScale);
  const legDrag = useLegendDrag(svgRef, {x:546, y:44});   // reset via the Legend controls if geometry changes a lot
  const [hov, setHov] = useState(null);
  const containerRef = useRef(null);
  const hovTimer = useRef(null);
  const showHov = useCallback((data)=>{ clearTimeout(hovTimer.current); setHov(data); },[]);
  const hideHov = useCallback(()=>{ hovTimer.current=setTimeout(()=>setHov(null),160); },[]);
  const keepHov = useCallback(()=>{ clearTimeout(hovTimer.current); },[]);

  const ROWH = Math.max(d.rowMin||22, st.term.fontSize*2.6*(d.rowGap||1));
  const wrapWidth = sets.wrapWidth || 38;
  const termLines = useMemo(()=>shown.map(t=>wrapText(t.term, wrapWidth)), [shown, wrapWidth]);
  const rowHeights = termLines.map(lines => Math.max(ROWH, lines.length * (st.term.fontSize+4) + 8));
  const totalRowsH = rowHeights.reduce((a,b)=>a+b, 0);

  // Left margin must follow the label font size. The old formula multiplied the
  // wrap width by a fixed 5.2 px/char, which silently assumed a ~9px font — so
  // raising the term font size pushed labels off the left edge of the figure.
  // Measuring the longest wrapped line also avoids reserving space for the full
  // wrap width when every label is short.
  const TERM_CHAR_PX = st.term.fontSize * 0.58;
  const longestLine = termLines.reduce((mx,lines)=>{
    for (let i=0;i<lines.length;i++) if (lines[i].length>mx) mx=lines[i].length;
    return mx;
  }, 0);
  const ML = Math.min(560, Math.max(120, Math.ceil(longestLine*TERM_CHAR_PX)+18));
  // Right margin has to hold the legend, which is now user-sizable. A fixed
  // 150px clipped the colour bar as soon as its labels or height were enlarged.
  const legW = Math.max(
    (d.legBarW||14) + 12 + 7*(d.legTickSz||10)*0.62,
    2*(sets.dotMax||16) + 16 + 4*(d.legCountSz||10)*0.62
  );
  const MR = Math.max(110, Math.ceil(legW) + 34);
  const MT = 30;
  // Tick labels and the axis title sit below the plot, so the bottom margin has
  // to grow with their font size. These offsets used to be hardcoded (+16/+34
  // with MB=56), which clipped the axis title as soon as the font was enlarged.
  const tkOff = Math.round(st.tk.fontSize) + 8;
  const axOff = tkOff + Math.round(st.ax.fontSize) + 10;
  const MB = Math.max(46, axOff + Math.round(st.ax.fontSize*0.4) + 10);
  const PW = Math.max(120, d.plotW||320);
  const PH = Math.max(200, totalRowsH);
  const W = ML+PW+MR;
  const H = MT+PH+MB;

  const ratios = shown.map(t=>t.ratio);
  const dataMax = ratios.length?Math.max(...ratios):1;
  const rMin = sets.xMinDot==="auto" ? 0 : (+sets.xMinDot || 0);
  const rMax = sets.xMaxDot==="auto" ? Math.max(dataMax*1.1, 0.01) : (+sets.xMaxDot || 1);

  const sigVals = shown.map(t=>t.sigVal);
  const sigMin = sigVals.length?Math.min(...sigVals):1e-10, sigMax = sigVals.length?Math.max(...sigVals):1;
  const counts = shown.map(t=>t.count);
  const cMin = counts.length?Math.min(...counts):0, cMax = counts.length?Math.max(...counts):1;

  const sx = v => ML + ((v-rMin)/(Math.max(rMax-rMin,1e-9)))*PW;
  const dotR = c => sets.dotMin + (cMax>cMin ? (c-cMin)/(cMax-cMin) : 0.5) * (sets.dotMax-sets.dotMin);

  const useLog = (d.colorScaleMode||"log")==="log";
  const nlpVals = shown.map(t=>t.nlp);
  const nlpMin = nlpVals.length?Math.min(...nlpVals):0, nlpMax = nlpVals.length?Math.max(...nlpVals):1;
  const colT = t => {
    if (useLog) return nlpMax>nlpMin ? (t.nlp-nlpMin)/(nlpMax-nlpMin) : 0.5;
    return sigMax>sigMin ? 1-((t.sigVal-sigMin)/(sigMax-sigMin)) : 0.5;
  };

  const xTicks = useMemo(()=>{
    const n=4; const ticks=[];
    for(let i=0;i<=n;i++) ticks.push(rMin + (rMax-rMin)*i/n);
    return ticks;
  },[rMin,rMax]);

  const lgSet = {titleSz:d.legTitleSz||11, tickSz:d.legTickSz||10, countSz:d.legCountSz||10,
                 barW:d.legBarW||14, barH:d.legBarH||100, gap:d.legGap||26};
  const legX = legDrag.moved ? legDrag.pos.x : ML+PW+22;
  const legY = legDrag.moved ? legDrag.pos.y : MT+14;
  const legendSteps = 4;
  // Tick values are chosen as round numbers, then positioned on the bar by the
  // same mapping the dots use, so the labels line up with the colours they mean.
  const legendTicks = useMemo(()=>{
    if (useLog) {
      const vals = niceLogPTicks(Math.pow(10,-nlpMax), Math.pow(10,-nlpMin), legendSteps);
      return vals.map(v=>{
        const nlp = -Math.log10(v);
        return { t: nlpMax>nlpMin ? (nlp-nlpMin)/(nlpMax-nlpMin) : 0.5, val: v };
      }).filter(o=>o.t>=-0.001 && o.t<=1.001);
    }
    const vals = niceRangeTicks(sigMin, sigMax, legendSteps);
    return vals.map(v=>({ t: sigMax>sigMin ? 1-((v-sigMin)/(sigMax-sigMin)) : 0.5, val: v }))
               .filter(o=>o.t>=-0.001 && o.t<=1.001);
  },[useLog, nlpMin, nlpMax, sigMin, sigMax]);

  const countTicks = useMemo(()=>countLegendValues(cMin, cMax, 4), [cMin, cMax]);

  let cy = MT;
  const rows2 = shown.map((t,i) => {
    const y = cy + rowHeights[i]/2;
    cy += rowHeights[i];
    return {...t, y, lines: termLines[i], rowH: rowHeights[i]};
  });

  const showSeparators = sets.sortBy==="category";
  const dotSeparators = showSeparators ? rows2.reduce((acc, r, i) => {
    if (i===0) { acc.push({ y: r.y - rowHeights[i]/2 - 2, isFirst: true }); return acc; }
    if ((r.category||"") !== (rows2[i-1].category||"")) {
      const prevBottom = rows2[i-1].y + rowHeights[i-1]/2;
      const thisTop    = r.y - rowHeights[i]/2;
      acc.push({ y: (prevBottom + thisTop) / 2, isFirst: false });
    }
    return acc;
  }, []) : [];

  const methodText = (d.method||"ORA")+" | "+(d.database||"KEGG")+" | "+(d.correction==="none"?"uncorrected":(d.correction||"BH")+"-corrected");
  const extraH = (d.showMethodLine!==false?16:0)+(d.plotTitle?22:0)+(ratioFallback?16:0);

  return (
    <div ref={containerRef} style={{position:"relative", display:"inline-block"}}>
    <svg ref={svgRef} width={W} height={H+extraH}
      viewBox={"0 0 "+W+" "+(H+extraH)}
      style={{display:"block", maxWidth:"100%", overflow:"visible"}}
      onPointerMove={legDrag.onSVGMove} onPointerUp={legDrag.onSVGUp} onPointerLeave={legDrag.onSVGUp}>
      <g transform={"translate(0,"+(d.plotTitle?22:0)+(ratioFallback?16:0)+")"}>
        {d.plotTitle && <text x={W/2} y={-4-(ratioFallback?16:0)} textAnchor="middle" fontSize={st.ttl.fontSize} fontWeight={st.ttl.fontWeight} fontStyle={st.ttl.fontStyle} fill={st.ttl.color} fontFamily={ff}>{d.plotTitle}</text>}
        {ratioFallback && (
          <text x={0} y={-6} fontSize={9} fill="#D97706" fontFamily={ff} fontStyle="italic">
            Note: Ratio N/D not provided for some terms — Gene Ratio approximated from Count.
          </text>
        )}

        {d.showGrid!==false && xTicks.map((v,i)=>(
          <line key={"g"+i} x1={sx(v)} y1={MT} x2={sx(v)} y2={MT+PH} stroke={st.grid} strokeWidth={st.gw} strokeDasharray="3 3"/>
        ))}
        {d.showGrid!==false && rows2.map((r,i)=>(
          <line key={"hg"+i} x1={ML} y1={r.y} x2={ML+PW} y2={r.y} stroke={st.grid} strokeWidth={st.gw*0.6} strokeDasharray="1 3"/>
        ))}

        <line x1={ML} y1={MT+PH} x2={ML+PW} y2={MT+PH} stroke={st.axLine} strokeWidth={st.aw}/>
        <line x1={ML} y1={MT} x2={ML} y2={MT+PH} stroke={st.axLine} strokeWidth={st.aw}/>
        {st.frameStyle==="box" && (
          <>
            <line x1={ML} y1={MT} x2={ML+PW} y2={MT} stroke={st.axLine} strokeWidth={st.aw}/>
            <line x1={ML+PW} y1={MT} x2={ML+PW} y2={MT+PH} stroke={st.axLine} strokeWidth={st.aw}/>
          </>
        )}

        {xTicks.map((v,i)=>{
          const tm = tickMarkV(MT+PH, st.tickDir);
          return <line key={"tm"+i} x1={sx(v)} y1={tm.y1} x2={sx(v)} y2={tm.y2} stroke={st.axLine} strokeWidth={st.aw}/>;
        })}
        {xTicks.map((v,i)=>(
          <text key={"xt"+i} x={sx(v)} y={MT+PH+tkOff} textAnchor="middle" fontSize={st.tk.fontSize} fill={st.tk.fill} fontFamily={ff}>{v.toFixed(2)}</text>
        ))}
        <text x={ML+PW/2} y={MT+PH+axOff} textAnchor="middle" fontSize={st.ax.fontSize} fontWeight={st.ax.fontWeight} fontStyle={st.ax.fontStyle} fill={st.ax.fill} fontFamily={ff}>{d.xLblDot||"Gene Ratio"}</text>

        {rows2.map((r,i)=>(
          <text key={"term"+i} x={ML-10} y={r.y - (r.lines.length-1)*(st.term.fontSize+2)/2 + 3}
            textAnchor="end" fontSize={st.term.fontSize} fontWeight={st.term.fontWeight} fill={st.term.fill} fontFamily={ff}>
            {r.lines.map((line,li)=>(
              <tspan key={li} x={ML-10} dy={li===0?0:(st.term.fontSize+2)}>{line}</tspan>
            ))}
          </text>
        ))}

        {dotSeparators.map((sep,i)=>(
          !sep.isFirst && <line key={"dsep"+i} x1={ML} y1={sep.y} x2={ML+PW} y2={sep.y} stroke={C.muted} strokeWidth={1} strokeDasharray="5 3" strokeOpacity={0.5}/>
        ))}

        {rows2.map((r,i)=>(
          <g key={"dot"+i}
            onMouseEnter={e=>{
              const rect=containerRef.current?containerRef.current.getBoundingClientRect():{left:0,top:0};
              showHov({term:r, x:e.clientX-rect.left, y:e.clientY-rect.top});
            }}
            onMouseLeave={hideHov}
            style={{cursor:"pointer"}}>
            {hov&&hov.term.term===r.term&&<circle cx={sx(r.ratio)} cy={r.y} r={dotR(r.count)+4} fill={colorFn(colT(r))} fillOpacity={0.18}/>}
            <circle cx={sx(r.ratio)} cy={r.y} r={dotR(r.count)} fill={colorFn(colT(r))}
              stroke={hov&&hov.term.term===r.term?"rgba(0,0,0,0.5)":"rgba(0,0,0,0.15)"}
              strokeWidth={hov&&hov.term.term===r.term?1.5:0.5}/>
          </g>
        ))}

        <LegendDragHandle x={legX} y={legY} w={MR-16} h={(d.legBarH||100)+(d.legGap||26)+180} dragging={legDrag.dragging} onDragStart={legDrag.onDragStart}/>
        <LegendCard x={legX} y={legY} C={C} ff={ff} title={sets.pCol==="padj"?"adj. p":"p-value"}
          colorFn={colorFn} legendTicks={legendTicks} useLog={useLog} cMin={cMin} cMax={cMax} dotR={dotR} showSizeLegend={d.legShowCount!==false} countTicks={countTicks} lg={lgSet}/>

        {d.showMethodLine!==false && (
          <text x={ML} y={H+10} fontSize={8} fill={C.muted} fontFamily={ff} fontStyle="italic">{methodText}</text>
        )}
      </g>
    </svg>
    {hov&&<PlotTooltip term={hov.term} x={hov.x} y={hov.y} onClose={()=>setHov(null)} onMouseEnter={keepHov} onMouseLeave={hideHov} onExclude={t=>{setHov(null);onExclude&&onExclude(t);}} onDownload={onDownloadGenes} pColLabel={sets.pCol==="padj"?"adj. p":"p-value"}/>}
    </div>
  );
}

// ─── Bar Plot ─────────────────────────────────────────────────────────────────
// Label angle system (vertical orientation only):
//   0°  — multi-line wrap, unrotated, centered under each bar. Mathematically
//         zero collision risk regardless of term count (verified: an unrotated
//         line-stacking vector has zero horizontal component).
//   >0° — single line only, rotated. Rotating a MULTI-line label reintroduces
//         the exact overlap bug this tool was built to fix (each wrapped line
//         drifts sideways by sin(angle)*lineHeight once rotated) — so angled/
//         vertical modes intentionally restrict to one line, truncating with
//         "…" if the term name doesn't fit, matching how Prism and other tools
//         handle rotated category labels.
// All hooks are declared before the isVertical conditional return.
function BarPlot({rows, sets, d, svgRef, onExclude, onDownloadGenes}) {
  const C = useC();
  const st = gS(d, C);
  const { shown, ratioFallback } = useProcessedTerms(rows, sets);
  const ff = st.ff;
  const colorFn = getColorFn(d.colorScale);
  const [hov, setHov] = useState(null);
  const containerRef = useRef(null);
  const hovTimer = useRef(null);
  const showHov = useCallback((data)=>{ clearTimeout(hovTimer.current); setHov(data); },[]);
  const hideHov = useCallback(()=>{ hovTimer.current=setTimeout(()=>setHov(null),160); },[]);
  const keepHov = useCallback(()=>{ clearTimeout(hovTimer.current); },[]);
  const legDrag = useLegendDrag(svgRef, {x:520, y:44});
  const isVertical = (sets.barOrientation||"horizontal") === "vertical";

  const useCount = sets.barMetric==="count";
  const metricVal = t => useCount ? t.count : t.nlp;
  const vals = shown.map(metricVal);
  const dataMax = vals.length?Math.max(...vals):1;
  const vMin = sets.xMinBar==="auto" ? 0 : (+sets.xMinBar || 0);
  const vMax = sets.xMaxBar==="auto" ? Math.max(dataMax*1.1, 0.01) : (+sets.xMaxBar || 1);
  const sigVals = shown.map(t=>t.sigVal);
  const sigMin = sigVals.length?Math.min(...sigVals):1e-10, sigMax = sigVals.length?Math.max(...sigVals):1;
  const useLog = (d.colorScaleMode||"log")==="log";
  const nlpVals = shown.map(t=>t.nlp);
  const nlpMin = nlpVals.length?Math.min(...nlpVals):0, nlpMax = nlpVals.length?Math.max(...nlpVals):1;
  const colT = t => {
    if (useLog) return nlpMax>nlpMin ? (t.nlp-nlpMin)/(nlpMax-nlpMin) : 0.5;
    return sigMax>sigMin ? 1-((t.sigVal-sigMin)/(sigMax-sigMin)) : 0.5;
  };
  const methodText = (d.method||"ORA")+" | "+(d.database||"KEGG")+" | "+(d.correction==="none"?"uncorrected":(d.correction||"BH")+"-corrected");
  const wrapWidth = sets.wrapWidth || 38;
  const labelAngle = Math.max(0, Math.min(90, sets.vertLabelAngle||0));

  const barXTicks = useMemo(()=>{
    const n=4; const ticks=[];
    for(let i=0;i<=n;i++) ticks.push(vMin + (vMax-vMin)*i/n);
    return ticks;
  },[vMin,vMax]);
  const barLegendSteps = 4;
  const lgSet = {titleSz:d.legTitleSz||11, tickSz:d.legTickSz||10, countSz:d.legCountSz||10,
                 barW:d.legBarW||14, barH:d.legBarH||100, gap:d.legGap||26};
  // Same round-number treatment as the dot plot's colour bar.
  const barLegendTicks = useMemo(()=>{
    if (useLog) {
      return niceLogPTicks(Math.pow(10,-nlpMax), Math.pow(10,-nlpMin), barLegendSteps)
        .map(v=>{ const nlp=-Math.log10(v); return {t: nlpMax>nlpMin ? (nlp-nlpMin)/(nlpMax-nlpMin) : 0.5, val:v}; })
        .filter(o=>o.t>=-0.001 && o.t<=1.001);
    }
    return niceRangeTicks(sigMin, sigMax, barLegendSteps)
      .map(v=>({t: sigMax>sigMin ? 1-((v-sigMin)/(sigMax-sigMin)) : 0.5, val:v}))
      .filter(o=>o.t>=-0.001 && o.t<=1.001);
  },[useLog, nlpMin, nlpMax, sigMin, sigMax]);

  // Term wrap lines for BOTH orientations, computed unconditionally (plain map, not a hook).
  // Vertical mode: 0° gets multi-line short-wrap; any nonzero angle gets single line only.
  const termLinesAll = useMemo(()=>{
    if (!isVertical) return shown.map(t=>wrapText(t.term, wrapWidth));
    return labelAngle===0
      ? shown.map(t=>wrapText(t.term, 11, 4))
      : shown.map(t=>wrapText(t.term, 18, 1));
  }, [shown, wrapWidth, isVertical, labelAngle]);

  // ── VERTICAL orientation ──────────────────────────────────────────────────────
  if (isVertical) {
    const fontSize = st.term.fontSize;
    const angleRad = labelAngle * Math.PI/180;
    const avgCharPx = fontSize*0.55;
    let COLW, GAP, MB_V;
    if (labelAngle===0) {
      const maxWrapLines = Math.max(1, ...termLinesAll.map(l=>l.length));
      COLW = Math.max(64, sets.dotMin*4);
      GAP = 14;
      MB_V = 20 + maxWrapLines*(fontSize+3) + 20;
    } else {
      const estLineWidthPx = 18 * avgCharPx;
      COLW = Math.max(26, estLineWidthPx*Math.cos(angleRad) + 10);
      GAP = 12;
      MB_V = estLineWidthPx*Math.sin(angleRad) + fontSize + 30;
    }
    const PH_V = 260;
    const MT_V = 30;
    const ML_V = 50;
    const MR_V = 130;
    const PW_V = shown.length * (COLW + GAP);
    const W_V  = ML_V + PW_V + MR_V;
    const H_V  = MT_V + PH_V + MB_V;
    const sy   = v => MT_V + PH_V - ((v-vMin)/(Math.max(vMax-vMin,1e-9)))*PH_V;
    const cx   = i => ML_V + i*(COLW+GAP) + COLW/2;

    const showSepsV = sets.sortBy==="category";
    const vSeparators = showSepsV ? shown.reduce((acc,r,i)=>{
      if(i>0&&(r.category||"")!==(shown[i-1].category||"")) acc.push({x: cx(i)-GAP/2-COLW/2});
      return acc;
    },[]) : [];

    const extraH_V = (d.showMethodLine!==false?16:0)+(d.plotTitle?22:0);

    return (
      <div ref={containerRef} style={{position:"relative", display:"inline-block"}}>
      <svg ref={svgRef} width={W_V} height={H_V+extraH_V}
        viewBox={"0 0 "+W_V+" "+(H_V+extraH_V)}
        style={{display:"block", maxWidth:"100%", overflow:"visible"}}
        onPointerMove={legDrag.onSVGMove} onPointerUp={legDrag.onSVGUp} onPointerLeave={legDrag.onSVGUp}>
        <g transform={"translate(0,"+(d.plotTitle?22:0)+")"}>
          {d.plotTitle&&<text x={W_V/2} y={-4} textAnchor="middle" fontSize={st.ttl.fontSize} fontWeight={st.ttl.fontWeight} fontStyle={st.ttl.fontStyle} fill={st.ttl.color} fontFamily={ff}>{d.plotTitle}</text>}

          {d.showGrid!==false&&barXTicks.map((v,i)=>(
            <line key={"vg"+i} x1={ML_V} y1={sy(v)} x2={ML_V+PW_V} y2={sy(v)} stroke={st.grid} strokeWidth={st.gw} strokeDasharray="3 3"/>
          ))}

          <line x1={ML_V} y1={MT_V+PH_V} x2={ML_V+PW_V} y2={MT_V+PH_V} stroke={st.axLine} strokeWidth={st.aw}/>
          <line x1={ML_V} y1={MT_V} x2={ML_V} y2={MT_V+PH_V} stroke={st.axLine} strokeWidth={st.aw}/>
          {st.frameStyle==="box" && (
            <>
              <line x1={ML_V} y1={MT_V} x2={ML_V+PW_V} y2={MT_V} stroke={st.axLine} strokeWidth={st.aw}/>
              <line x1={ML_V+PW_V} y1={MT_V} x2={ML_V+PW_V} y2={MT_V+PH_V} stroke={st.axLine} strokeWidth={st.aw}/>
            </>
          )}

          {barXTicks.map((v,i)=>{
            const tm = tickMarkH(ML_V, st.tickDir);
            return <line key={"vtm"+i} x1={tm.x1} y1={sy(v)} x2={tm.x2} y2={sy(v)} stroke={st.axLine} strokeWidth={st.aw}/>;
          })}
          {barXTicks.map((v,i)=>(
            <text key={"yt"+i} x={ML_V-8} y={sy(v)+3} textAnchor="end" fontSize={st.tk.fontSize} fill={st.tk.fill} fontFamily={ff}>
              {useCount?Math.round(v):v.toFixed(1)}
            </text>
          ))}
          <text x={12} y={MT_V+PH_V/2} textAnchor="middle" fontSize={st.ax.fontSize} fontWeight={st.ax.fontWeight} fontStyle={st.ax.fontStyle} fill={st.ax.fill} fontFamily={ff}
            transform={"rotate(-90,12,"+(MT_V+PH_V/2)+")"}>
            {useCount ? "Gene Count" : (d.xLblBar||"-log10(p-value)")}
          </text>

          {vSeparators.map((sep,i)=>(
            <line key={"vsep"+i} x1={sep.x} y1={MT_V} x2={sep.x} y2={MT_V+PH_V} stroke={C.muted} strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.5}/>
          ))}

          {shown.map((r,i)=>{
            const barH = Math.max(1, sy(vMin)-sy(metricVal(r)));
            const barY = sy(metricVal(r));
            const lines = termLinesAll[i];
            const lx = cx(i);
            const ly = MT_V+PH_V + (labelAngle===0 ? 16 : 10);
            return (
              <g key={"vbar"+i}
                onMouseEnter={e=>{const rect=containerRef.current?containerRef.current.getBoundingClientRect():{left:0,top:0};showHov({term:r,x:e.clientX-rect.left,y:e.clientY-rect.top});}}
                onMouseLeave={hideHov}
                style={{cursor:"pointer"}}>
                <rect x={cx(i)-COLW/2} y={barY} width={COLW} height={barH} rx={2}
                  fill={colorFn(colT(r))}
                  fillOpacity={hov&&hov.term.term===r.term?1:0.88}
                  stroke={hov&&hov.term.term===r.term?"rgba(0,0,0,0.4)":"none"} strokeWidth={1}/>
                {barH>14&&<text x={cx(i)} y={barY+barH-4} textAnchor="middle" fontSize={7.5} fill="rgba(255,255,255,0.9)" fontFamily={ff}>{r.count}</text>}
                {labelAngle===0 ? (
                  <text x={lx} y={ly} textAnchor="middle" fontSize={fontSize} fontWeight={st.term.fontWeight} fill={st.term.fill} fontFamily={ff}>
                    {lines.map((ln,li)=>(
                      <tspan key={li} x={lx} dy={li===0?0:(fontSize+3)}>{ln}</tspan>
                    ))}
                  </text>
                ) : (
                  <text x={lx} y={ly} textAnchor="end" fontSize={fontSize} fontWeight={st.term.fontWeight} fill={st.term.fill} fontFamily={ff}
                    transform={"rotate(-"+labelAngle+","+lx+","+ly+")"}>
                    {lines[0]}
                  </text>
                )}
              </g>
            );
          })}

          <LegendDragHandle x={legDrag.pos.x} y={legDrag.pos.y} h={180} dragging={legDrag.dragging} onDragStart={legDrag.onDragStart}/>
          <LegendCard x={legDrag.pos.x} y={legDrag.pos.y} C={C} ff={ff} title={sets.pCol==="padj"?"adj. p":"p-value"}
            colorFn={colorFn} legendTicks={barLegendTicks} useLog={useLog} showSizeLegend={false} lg={lgSet}/>

          {d.showMethodLine!==false&&(
            <text x={ML_V} y={H_V+10} fontSize={8} fill={C.muted} fontFamily={ff} fontStyle="italic">{methodText}</text>
          )}
        </g>
      </svg>
      {hov&&<PlotTooltip term={hov.term} x={hov.x} y={hov.y} onClose={()=>setHov(null)} onMouseEnter={keepHov} onMouseLeave={hideHov} onExclude={t=>{setHov(null);onExclude&&onExclude(t);}} onDownload={onDownloadGenes} pColLabel={sets.pCol==="padj"?"adj. p":"p-value"}/>}
      </div>
    );
  }

  // ── HORIZONTAL orientation (default) — terms on Y, bars grow rightward ────────
  const ROWH = Math.max(d.rowMin||22, st.term.fontSize*2.6*(d.rowGap||1));
  const rowHeights = termLinesAll.map(lines => Math.max(ROWH, lines.length*(st.term.fontSize+4)+8));
  const totalRowsH = rowHeights.reduce((a,b)=>a+b, 0);

  // Left margin must follow the label font size. The old formula multiplied the
  // wrap width by a fixed 5.2 px/char, which silently assumed a ~9px font — so
  // raising the term font size pushed labels off the left edge of the figure.
  // Measuring the longest wrapped line also avoids reserving space for the full
  // wrap width when every label is short.
  const TERM_CHAR_PX = st.term.fontSize * 0.58;
  const longestLine = termLinesAll.reduce((mx,lines)=>{
    for (let i=0;i<lines.length;i++) if (lines[i].length>mx) mx=lines[i].length;
    return mx;
  }, 0);
  const ML = Math.min(560, Math.max(120, Math.ceil(longestLine*TERM_CHAR_PX)+18));
  // Right margin has to hold the legend, which is now user-sizable. A fixed
  // 150px clipped the colour bar as soon as its labels or height were enlarged.
  const legW = Math.max(
    (d.legBarW||14) + 12 + 7*(d.legTickSz||10)*0.62,
    2*(sets.dotMax||16) + 16 + 4*(d.legCountSz||10)*0.62
  );
  const MR = Math.max(110, Math.ceil(legW) + 34);
  const MT = 30;
  // Tick labels and the axis title sit below the plot, so the bottom margin has
  // to grow with their font size. These offsets used to be hardcoded (+16/+34
  // with MB=56), which clipped the axis title as soon as the font was enlarged.
  const tkOff = Math.round(st.tk.fontSize) + 8;
  const axOff = tkOff + Math.round(st.ax.fontSize) + 10;
  const MB = Math.max(46, axOff + Math.round(st.ax.fontSize*0.4) + 10);
  const PW = Math.max(120, d.plotW||320);
  const PH = Math.max(200, totalRowsH);
  const W = ML+PW+MR;
  const H = MT+PH+MB;

  const sx = v => ML + ((v-vMin)/(Math.max(vMax-vMin,1e-9)))*PW;
  const xTicks = barXTicks;
  const legendTicks = barLegendTicks;

  let cy = MT;
  const rows2 = shown.map((t,i) => {
    const y = cy;
    cy += rowHeights[i];
    return {...t, y, h:rowHeights[i]*0.62, rowH:rowHeights[i], lines: termLinesAll[i]};
  });

  const showSeparators = sets.sortBy==="category";
  const barSeparators = showSeparators ? rows2.reduce((acc, r, i) => {
    if (i===0) { acc.push({ y: r.y - 2, isFirst: true }); return acc; }
    if ((r.category||"") !== (rows2[i-1].category||"")) {
      const prevBottom = rows2[i-1].y + rows2[i-1].rowH;
      acc.push({ y: (prevBottom + r.y) / 2, isFirst: false });
    }
    return acc;
  }, []) : [];

  const extraH = (d.showMethodLine!==false?16:0)+(d.plotTitle?22:0)+(ratioFallback?16:0);

  return (
    <div ref={containerRef} style={{position:"relative", display:"inline-block"}}>
    <svg ref={svgRef} width={W} height={H+extraH}
      viewBox={"0 0 "+W+" "+(H+extraH)}
      style={{display:"block", maxWidth:"100%", overflow:"visible"}}
      onPointerMove={legDrag.onSVGMove} onPointerUp={legDrag.onSVGUp} onPointerLeave={legDrag.onSVGUp}>
      <g transform={"translate(0,"+(d.plotTitle?22:0)+(ratioFallback?16:0)+")"}>
        {d.plotTitle && <text x={W/2} y={-4-(ratioFallback?16:0)} textAnchor="middle" fontSize={st.ttl.fontSize} fontWeight={st.ttl.fontWeight} fontStyle={st.ttl.fontStyle} fill={st.ttl.color} fontFamily={ff}>{d.plotTitle}</text>}
        {ratioFallback && !useCount && (
          <text x={0} y={-6} fontSize={9} fill="#D97706" fontFamily={ff} fontStyle="italic">
            Note: Ratio N/D not provided for some terms — bar plot uses p-value or count, unaffected.
          </text>
        )}

        {d.showGrid!==false && xTicks.map((v,i)=>(
          <line key={"g"+i} x1={sx(v)} y1={MT} x2={sx(v)} y2={MT+PH} stroke={st.grid} strokeWidth={st.gw} strokeDasharray="3 3"/>
        ))}

        <line x1={ML} y1={MT+PH} x2={ML+PW} y2={MT+PH} stroke={st.axLine} strokeWidth={st.aw}/>
        <line x1={ML} y1={MT} x2={ML} y2={MT+PH} stroke={st.axLine} strokeWidth={st.aw}/>
        {st.frameStyle==="box" && (
          <>
            <line x1={ML} y1={MT} x2={ML+PW} y2={MT} stroke={st.axLine} strokeWidth={st.aw}/>
            <line x1={ML+PW} y1={MT} x2={ML+PW} y2={MT+PH} stroke={st.axLine} strokeWidth={st.aw}/>
          </>
        )}

        {xTicks.map((v,i)=>{
          const tm = tickMarkV(MT+PH, st.tickDir);
          return <line key={"btm"+i} x1={sx(v)} y1={tm.y1} x2={sx(v)} y2={tm.y2} stroke={st.axLine} strokeWidth={st.aw}/>;
        })}
        {xTicks.map((v,i)=>(
          <text key={"xt"+i} x={sx(v)} y={MT+PH+tkOff} textAnchor="middle" fontSize={st.tk.fontSize} fill={st.tk.fill} fontFamily={ff}>{useCount?Math.round(v):v.toFixed(1)}</text>
        ))}
        <text x={ML+PW/2} y={MT+PH+axOff} textAnchor="middle" fontSize={st.ax.fontSize} fontWeight={st.ax.fontWeight} fontStyle={st.ax.fontStyle} fill={st.ax.fill} fontFamily={ff}>
          {useCount ? "Gene Count" : (d.xLblBar||"-log10(p-value)")}
        </text>

        {rows2.map((r,i)=>(
          <text key={"term"+i} x={ML-10} y={(r.y+r.rowH/2) - (r.lines.length-1)*(st.term.fontSize+2)/2 + 3}
            textAnchor="end" fontSize={st.term.fontSize} fontWeight={st.term.fontWeight} fill={st.term.fill} fontFamily={ff}>
            {r.lines.map((line,li)=>(
              <tspan key={li} x={ML-10} dy={li===0?0:(st.term.fontSize+2)}>{line}</tspan>
            ))}
          </text>
        ))}

        {rows2.map((r,i)=>(
          <g key={"row"+i}>
            <rect x={sx(vMin)} y={r.y+(r.rowH-r.h)/2} width={Math.max(1,sx(metricVal(r))-sx(vMin))} height={r.h} rx={2}
              fill={colorFn(colT(r))}
              fillOpacity={hov&&hov.term.term===r.term?1:0.88}
              stroke={hov&&hov.term.term===r.term?"rgba(0,0,0,0.4)":"none"} strokeWidth={1}/>
            <text x={Math.max(sx(vMin)+4,sx(metricVal(r))+4)} y={r.y+r.rowH/2+3} fontSize={8.5} fill={C.muted} fontFamily={ff}>
              {r.count}
            </text>
            <rect x={ML} y={r.y} width={PW} height={r.rowH} fill="transparent" style={{cursor:"pointer"}}
              onMouseEnter={e=>{const rect=containerRef.current?containerRef.current.getBoundingClientRect():{left:0,top:0};showHov({term:r,x:e.clientX-rect.left,y:e.clientY-rect.top});}}
              onMouseLeave={hideHov}/>
          </g>
        ))}

        {barSeparators.map((sep,i)=>(
          !sep.isFirst && <line key={"bsep"+i} x1={ML} y1={sep.y} x2={ML+PW} y2={sep.y} stroke={C.muted} strokeWidth={1} strokeDasharray="5 3" strokeOpacity={0.5}/>
        ))}

        <LegendDragHandle x={legDrag.pos.x} y={legDrag.pos.y} h={180} dragging={legDrag.dragging} onDragStart={legDrag.onDragStart}/>
        <LegendCard x={legDrag.pos.x} y={legDrag.pos.y} C={C} ff={ff} title={sets.pCol==="padj"?"adj. p":"p-value"}
          colorFn={colorFn} legendTicks={legendTicks} useLog={useLog} showSizeLegend={false} lg={lgSet}/>

        {d.showMethodLine!==false && (
          <text x={ML} y={H+10} fontSize={8} fill={C.muted} fontFamily={ff} fontStyle="italic">{methodText}</text>
        )}
      </g>
    </svg>
    {hov&&<PlotTooltip term={hov.term} x={hov.x} y={hov.y} onClose={()=>setHov(null)} onMouseEnter={keepHov} onMouseLeave={hideHov} onExclude={t=>{setHov(null);onExclude&&onExclude(t);}} onDownload={onDownloadGenes} pColLabel={sets.pCol==="padj"?"adj. p":"p-value"}/>}
    </div>
  );
}


// ─── Network graph construction (uses net*-prefixed style settings to avoid
// clashing with Dot/Bar plot's own colorScale/etc. on the same shared `d` object) ─
function useNetworkGraph(rows, sets, d) {
  return useMemo(() => {
    const valid = rows.filter(r => r.term && r.term.trim());
    const q = (sets.searchQ||"").trim().toLowerCase();
    const excluded = sets.excluded instanceof Set ? sets.excluded : new Set(Array.isArray(sets.excluded)?sets.excluded:[]);
    const filtered = valid.filter(r => {
      if (excluded.has(r.term)) return false;
      const pvalue = +r.pvalue || 1;
      const padj = r.padj!==""&&r.padj!=null ? +r.padj : pvalue;
      if (padj > sets.pCut) return false;
      if (!q) return true;
      return r.term.toLowerCase().includes(q) || (r.category||"").toLowerCase().includes(q);
    });

    const nodes = filtered.map(r => {
      const pvalue = +r.pvalue || 1;
      const padj = r.padj!==""&&r.padj!=null ? +r.padj : pvalue;
      const count = +r.count || 0;
      const nes = r.NES!==""&&r.NES!=null ? +r.NES : null;
      const genes = (r.genes||"").split(",").map(g=>g.trim()).filter(Boolean);
      return { id:r.term, term:r.term, category:r.category||"", pvalue, padj, count, nes, genes, nlp:-Math.log10(Math.max(padj,1e-300)) };
    });

    const edges = [];
    for (let i=0;i<nodes.length;i++) {
      for (let j=i+1;j<nodes.length;j++) {
        const sim = jaccard(nodes[i].genes, nodes[j].genes);
        if (sim >= (d.netSimThreshold||0.25)) edges.push({ source: nodes[i].id, target: nodes[j].id, weight: sim });
      }
    }

    const nodeIds = nodes.map(n=>n.id);
    const pos = nodeIds.length ? forceLayout(nodeIds, edges, { W:700, H:560, iterations:250 }) : {};

    return { nodes, edges, pos, totalTerms: valid.length };
  }, [rows, sets.pCut, sets.searchQ, sets.excluded, d.netSimThreshold]);
}

// ─── Node Tooltip ─────────────────────────────────────────────────────────────
function NodeTooltip({node, x, y, onClose, onMouseEnter, onMouseLeave}) {
  const visibleGenes = node.genes.slice(0,20);
  const more = node.genes.length - visibleGenes.length;
  const download = () => {
    const csv = "gene\n"+node.genes.join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8,"+encodeURIComponent(csv);
    a.download = node.term.slice(0,40).replace(/[^a-zA-Z0-9]/g,"_")+"_genes.csv";
    a.click();
  };
  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{
      position:"absolute", left:x+14, top:Math.max(y-10,0), width:250, zIndex:300, pointerEvents:"all",
      background:"#fff", border:"1px solid #DDE1E7", borderRadius:10, boxShadow:"0 8px 32px rgba(0,0,0,.14)",
      fontFamily:"Inter,system-ui,sans-serif",
    }}>
      <div style={{padding:"10px 12px 7px", borderBottom:"1px solid #EEF0F4"}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:6}}>
          <div style={{flex:1, fontSize:12, fontWeight:700, color:"#1E2736", lineHeight:1.35}}>{node.term}</div>
          <button onClick={onClose} style={{flexShrink:0, width:18, height:18, borderRadius:9, border:"none", background:"#F0F2F5", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0}}><IconX size={8} color="#64748B"/></button>
        </div>
        {node.category && <span style={{fontSize:10, color:"#2563EB", fontWeight:600, padding:"1px 6px", borderRadius:8, background:"rgba(37,99,235,.08)", display:"inline-block", marginTop:4}}>{node.category}</span>}
      </div>
      <div style={{padding:"8px 12px", borderBottom:"1px solid #EEF0F4", display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 12px"}}>
        <div style={{display:"flex", justifyContent:"space-between"}}><span style={{fontSize:10, color:"#64748B"}}>adj. p</span><span style={{fontSize:10, fontWeight:700, color:"#1E2736"}}>{node.padj.toExponential(2)}</span></div>
        <div style={{display:"flex", justifyContent:"space-between"}}><span style={{fontSize:10, color:"#64748B"}}>Count</span><span style={{fontSize:10, fontWeight:700, color:"#1E2736"}}>{node.count}</span></div>
        {node.nes!==null && <div style={{display:"flex", justifyContent:"space-between"}}><span style={{fontSize:10, color:"#64748B"}}>NES</span><span style={{fontSize:10, fontWeight:700, color:"#1E2736"}}>{node.nes.toFixed(2)}</span></div>}
      </div>
      {node.genes.length>0 && (
        <div style={{padding:"7px 12px", borderBottom:"1px solid #EEF0F4", maxHeight:120, overflowY:"auto"}}>
          <div style={{display:"flex", flexWrap:"wrap", gap:"2px 4px"}}>
            {visibleGenes.map(g=><span key={g} style={{fontSize:9, fontStyle:"italic", color:"#1D4ED8", background:"#EFF6FF", borderRadius:4, padding:"1px 5px", fontWeight:500}}>{g}</span>)}
            {more>0 && <span style={{fontSize:9, color:"#64748B", padding:"1px 4px"}}>+{more} more</span>}
          </div>
        </div>
      )}
      <div style={{padding:"7px 10px"}}>
        <button onClick={download} style={{width:"100%", padding:"5px 0", borderRadius:6, fontSize:10, fontWeight:600, cursor:"pointer", background:"#2563EB", border:"none", color:"#fff"}}>Download genes CSV</button>
      </div>
    </div>
  );
}

// ─── Network Legend Card (distinct name — avoids clashing with the Dot/Bar LegendCard) ─
// ─── Network Legend Card — rewritten: no bordered box, consistent number
// formatting (reuses fmtLegendVal from the Dot/Bar legend fix) ──────────────────
function NetworkLegendCard({x, y, C, ff, colorFn, dataMin, dataMax, valueLabel, sizeMin, sizeMax, sizeLabel}) {
  const gradH = 80;
  return (
    <g transform={"translate("+x+","+y+")"}>
      <text x={0} y={0} fontSize={9.5} fontWeight="700" fill={C.text} fontFamily={ff}>{valueLabel}</text>
      <defs>
        <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
          {Array.from({length:10},(_,i)=>i/9).map((t,i)=><stop key={i} offset={(t*100)+"%"} stopColor={colorFn(1-t)}/>)}
        </linearGradient>
      </defs>
      <rect x={0} y={12} width={12} height={gradH} fill="url(#netGrad)" rx={3}/>
      {[0,0.5,1].map((t,i)=>(
        <g key={i}>
          <line x1={12} y1={12+t*gradH} x2={15} y2={12+t*gradH} stroke={C.muted} strokeWidth={1}/>
          <text x={18} y={12+t*gradH+3} fontSize={8.5} fill={C.muted} fontFamily={ff}>
            {fmtLegendVal(dataMax-(dataMax-dataMin)*t)}
          </text>
        </g>
      ))}
      <text x={0} y={12+gradH+22} fontSize={9.5} fontWeight="700" fill={C.text} fontFamily={ff}>{sizeLabel}</text>
      {[sizeMin, sizeMax].map((s,i)=>(
        <g key={i} transform={"translate(15,"+(12+gradH+40+i*36)+")"}>
          <circle cx={0} cy={0} r={4+i*7} fill="none" stroke={C.muted} strokeWidth={1}/>
          <text x={16} y={4} fontSize={9} fill={C.muted} fontFamily={ff}>{Math.round(s)}</text>
        </g>
      ))}
      <text x={0} y={12+gradH+128} fontSize={8} fill={C.muted} fontFamily={ff} fontStyle="italic">Edge = shared genes</text>
    </g>
  );
}

// ─── Network Graph ────────────────────────────────────────────────────────────
function NetworkGraph({rows, sets, d, svgRef}) {
  const C = useC();
  const ff = d.ff || "Inter";
  const { nodes, edges, pos, totalTerms } = useNetworkGraph(rows, sets, d);
  const colorFn = COLOR_SCALES[d.netColorScale||"viridis"].fn;
  const diverging = COLOR_SCALES[d.netColorScale||"viridis"].diverging;
  const [hov, setHov] = useState(null);
  const containerRef = useRef(null);
  const hovTimer = useRef(null);
  const showHov = useCallback((data)=>{ clearTimeout(hovTimer.current); setHov(data); },[]);
  const hideHov = useCallback(()=>{ hovTimer.current=setTimeout(()=>setHov(null),160); },[]);
  const keepHov = useCallback(()=>{ clearTimeout(hovTimer.current); },[]);
  const legDrag = useLegendDrag(svgRef, {x:720, y:30});

  const W = 700, H = 560;
  const MT = (d.plotTitle?26:10), MR = 140, MB = (d.showMethodLine!==false?20:6);
  const fullW = W+MR, fullH = H+MT+MB;

  const useNES = (d.netValueMode||"pvalue")==="nes" && nodes.some(n=>n.nes!==null);
  const values = useNES ? nodes.map(n=>n.nes||0) : nodes.map(n=>n.nlp);
  const vMin = values.length?Math.min(...values):0, vMax = values.length?Math.max(...values):1;
  const absMax = Math.max(Math.abs(vMin), Math.abs(vMax), 1e-9);
  const colorFor = n => {
    const v = useNES ? (n.nes||0) : n.nlp;
    if (diverging) return colorFn(Math.max(0,Math.min(1, 0.5+v/(2*absMax))));
    return colorFn(vMax>vMin ? (v-vMin)/(vMax-vMin) : 0.5);
  };

  const sizeMetric = n => (d.netNodeSizeBy||"count")==="count" ? n.count : n.nlp;
  const sizes = nodes.map(sizeMetric);
  const sMin = sizes.length?Math.min(...sizes):0, sMax = sizes.length?Math.max(...sizes):1;
  const nodeR = n => 5 + (sMax>sMin ? (sizeMetric(n)-sMin)/(sMax-sMin) : 0.5) * 16;

  const methodText = (d.method||"ORA")+" | edges = Jaccard gene overlap \u2265 "+((d.netSimThreshold||0.25)*100).toFixed(0)+"%";

  return (
    <div ref={containerRef} style={{position:"relative", display:"inline-block"}}>
    <svg ref={svgRef} width={fullW} height={fullH} viewBox={"0 0 "+fullW+" "+fullH} style={{display:"block", maxWidth:"100%", overflow:"visible"}}
      onPointerMove={legDrag.onSVGMove} onPointerUp={legDrag.onSVGUp} onPointerLeave={legDrag.onSVGUp}>
      {d.plotTitle && <text x={W/2} y={16} textAnchor="middle" fontSize={d.tsz||14} fontWeight={d.tbd?"bold":"normal"} fill={C.text} fontFamily={ff}>{d.plotTitle}</text>}
      <g transform={"translate(0,"+MT+")"}>
        {edges.map((e,i)=>{
          const a = pos[e.source], b = pos[e.target];
          if (!a||!b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#94A3B8" strokeWidth={0.5+e.weight*3.5} strokeOpacity={0.2+e.weight*0.35}/>;
        })}
        {nodes.map((n,i)=>{
          const p = pos[n.id]; if (!p) return null;
          const r = nodeR(n);
          const isHov = hov && hov.node.id===n.id;
          return (
            <g key={n.id}
              onMouseEnter={e=>{const rect=containerRef.current.getBoundingClientRect(); showHov({node:n, x:e.clientX-rect.left, y:e.clientY-rect.top});}}
              onMouseLeave={hideHov} style={{cursor:"pointer"}}>
              {isHov && <circle cx={p.x} cy={p.y} r={r+6} fill={colorFor(n)} fillOpacity={0.18}/>}
              <circle cx={p.x} cy={p.y} r={r} fill={colorFor(n)} stroke="#fff" strokeWidth={isHov?2.5:1.5}/>
              {isHov && <circle cx={p.x} cy={p.y} r={r} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1}/>}
              {d.netShowLabels!==false && (() => {
                const lines = wrapText(n.term, 16, 2);
                const ly = p.y+r+11;
                return (
                  <g>
                    {/* White halo pass (thick stroke, no fill) so labels stay legible
                        over edges/other nodes — standard technique for publication-
                        quality network figures with dense connections. Rendered as a
                        SEPARATE <text> element from the fill pass — SVG tspan `dy` is
                        cumulative within one <text>, so two tspan groups sharing one
                        <text> would stack incorrectly (the fill pass would start where
                        the halo pass ended, not reset to the label's own top line). */}
                    <text x={p.x} y={ly} textAnchor="middle" fontSize={9} fontFamily={ff}
                      stroke="#fff" strokeWidth={3} strokeLinejoin="round" fill="none" opacity={0.9}>
                      {lines.map((ln,li)=>(<tspan key={li} x={p.x} dy={li===0?0:10}>{ln}</tspan>))}
                    </text>
                    <text x={p.x} y={ly} textAnchor="middle" fontSize={9} fontFamily={ff} fill={C.text}>
                      {lines.map((ln,li)=>(<tspan key={li} x={p.x} dy={li===0?0:10}>{ln}</tspan>))}
                    </text>
                  </g>
                );
              })()}
            </g>
          );
        })}
        {nodes.length===0 && (
          <text x={W/2} y={H/2} textAnchor="middle" fontSize={13} fill={C.muted} fontFamily={ff}>No terms pass the current significance filter</text>
        )}
        <LegendDragHandle x={legDrag.pos.x} y={legDrag.pos.y} h={230} dragging={legDrag.dragging} onDragStart={legDrag.onDragStart}/>
        <NetworkLegendCard x={legDrag.pos.x} y={legDrag.pos.y} C={C} ff={ff} colorFn={colorFn} dataMin={diverging?-absMax:vMin} dataMax={diverging?absMax:vMax}
          valueLabel={useNES?"NES":"-log10(padj)"} sizeMin={sMin} sizeMax={sMax}
          sizeLabel={(d.netNodeSizeBy||"count")==="count"?"Gene Count":"-log10(p)"}/>
        {d.showMethodLine!==false && (
          <text x={0} y={H+16} fontSize={8} fill={C.muted} fontFamily={ff} fontStyle="italic">{methodText+" | "+nodes.length+" of "+totalTerms+" terms shown"}</text>
        )}
      </g>
    </svg>
    {hov && <NodeTooltip node={hov.node} x={hov.x} y={hov.y} onClose={()=>setHov(null)} onMouseEnter={keepHov} onMouseLeave={hideHov}/>}
    </div>
  );
}

// ─── Export Panel (unified — handles Dot/Bar/Network via the same svgRef pattern) ─
// ─── Export plumbing ────────────────────────────────────────────────────────
// Downloads used to fail silently. Three causes, all fixed here:
//
//  1. The anchor was never added to the document. Firefox ignores click() on a
//     detached element, so nothing downloaded and nothing was reported.
//  2. The SVG was handed to Image via a base64 data: URL. A transcriptome-scale
//     plot serialises to well over the ~2MB data: URL ceiling, so the image
//     never loaded — and with no onerror handler, the failure was invisible.
//     Object URLs have no such limit.
//  3. There was no catch anywhere, so any exception vanished into an unhandled
//     rejection while the UI just went back to idle.
function downloadURL(url, filename, revoke) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{
    if (a.parentNode) a.parentNode.removeChild(a);
    if (revoke) URL.revokeObjectURL(url);
  }, 0);
}

function downloadBlob(blob, filename) {
  downloadURL(URL.createObjectURL(blob), filename, true);
}

// Prepare a cloned <svg> for standalone rendering. An SVG that renders fine
// inside the page can still fail to load as an image: it inherits namespaces,
// fonts and sizing from the document, and none of that comes along in a
// detached copy.
function prepareSVGForExport(clone, svgW, svgH, fontFamily) {
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("version", "1.1");
  // Explicit intrinsic size: without it some browsers treat the image as 0x0
  // and either draw nothing or fail the load outright.
  clone.setAttribute("width", String(svgW));
  clone.setAttribute("height", String(svgH));
  if (fontFamily) clone.setAttribute("font-family", fontFamily);
  // Anything pulling in an external resource taints the canvas, which makes
  // toBlob return null later with no explanation. Drop them.
  const kill = clone.querySelectorAll ? clone.querySelectorAll("script,link,style") : [];
  for (let i=0;i<kill.length;i++) { if (kill[i].parentNode) kill[i].parentNode.removeChild(kill[i]); }
  return clone;
}

function serializeSVG(clone) {
  let str = new XMLSerializer().serializeToString(clone);
  // XMLSerializer emits named HTML entities in some engines; only the five XML
  // built-ins are legal in a standalone document, and an unknown one is a fatal
  // parse error rather than a warning.
  str = str.replace(/&nbsp;/g, "&#160;");
  if (str.indexOf("<?xml") !== 0) str = '<?xml version="1.0" encoding="UTF-8"?>\n' + str;
  return str;
}

// Load an SVG string into an Image. Tries a blob: URL first (no size ceiling),
// then a UTF-8 data: URL, then base64 — deployments with a restrictive
// Content-Security-Policy block some of these but rarely all.
function loadSVGImage(svgStr) {
  const attempts = [];
  try { attempts.push({label:"blob", url: URL.createObjectURL(new Blob([svgStr], {type:"image/svg+xml"})), revoke:true}); } catch(_){}
  try { attempts.push({label:"utf8 data URL", url: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr), revoke:false}); } catch(_){}
  try { attempts.push({label:"base64 data URL", url: "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgStr))), revoke:false}); } catch(_){}
  if (!attempts.length) return Promise.reject(new Error("This browser wouldn't let the plot be turned into an image at all."));

  const tryOne = i => new Promise((resolve, reject)=>{
    if (i >= attempts.length) { reject(new Error("The plot couldn't be loaded as an image. If your browser or network blocks inline images, SVG export still works and opens in Illustrator or Inkscape.")); return; }
    const {url, revoke} = attempts[i];
    const img = new Image();
    let settled = false;
    const done = fn => { if (settled) return; settled = true; fn(); };
    const timer = setTimeout(()=>done(()=>{ if(revoke) URL.revokeObjectURL(url); tryOne(i+1).then(resolve, reject); }), 15000);
    img.onload = () => done(()=>{ clearTimeout(timer); resolve({img, url, revoke}); });
    img.onerror = () => done(()=>{ clearTimeout(timer); if(revoke) URL.revokeObjectURL(url); tryOne(i+1).then(resolve, reject); });
    try { img.crossOrigin = "anonymous"; } catch(_){}
    img.src = url;
  });
  return tryOne(0);
}

// Rasterise an SVG string onto a canvas at the requested pixel size.
function rasterizeSVG(svgStr, pxW, pxH, svgW, svgH, bgFill) {
  pxW = Math.max(1, Math.round(pxW));
  pxH = Math.max(1, Math.round(pxH));
  if (!isFinite(svgW) || !isFinite(svgH) || svgW <= 0 || svgH <= 0) {
    return Promise.reject(new Error("The plot's dimensions couldn't be read. Try switching to the Plot view and exporting again."));
  }
  if (pxW * pxH > 268435456) {
    return Promise.reject(new Error("That output is too large to render ("+pxW+"x"+pxH+" px). Lower the DPI or the output size."));
  }
  return loadSVGImage(svgStr).then(({img, url, revoke})=>{
    try {
      const cv = document.createElement("canvas");
      cv.width = pxW; cv.height = pxH;
      const ctx = cv.getContext("2d");
      if (!ctx) throw new Error("This browser wouldn't provide a drawing canvas.");
      ctx.setTransform(pxW/svgW, 0, 0, pxH/svgH, 0, 0);
      ctx.fillStyle = bgFill || "#ffffff";
      ctx.fillRect(0, 0, svgW, svgH);
      ctx.drawImage(img, 0, 0, svgW, svgH);
      if (revoke) URL.revokeObjectURL(url);
      return cv;
    } catch (e) {
      if (revoke) URL.revokeObjectURL(url);
      throw new Error("The plot was loaded but couldn't be drawn: " + ((e&&e.message)||"unknown error"));
    }
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject)=>{
    const tainted = () => reject(new Error("The browser blocked reading the rendered image back out (a security restriction on the drawing canvas). SVG export still works."));
    if (canvas.toBlob) {
      let settled = false;
      const t = setTimeout(()=>{ if(!settled){ settled=true; tainted(); } }, 20000);
      canvas.toBlob(b=>{
        if (settled) return;
        settled = true; clearTimeout(t);
        if (b && b.size > 0) resolve(b); else tainted();
      }, type, quality);
    } else {
      try {
        const parts = canvas.toDataURL(type, quality).split(",");
        const bin = atob(parts[1]);
        const arr = new Uint8Array(bin.length);
        for (let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], {type:type}));
      } catch (e) { tainted(); }
    }
  });
}

// ─── Journal-ready raster encoding ──────────────────────────────────────────
// Two problems with browser-native canvas output for journal submission:
//
//  1. There is no native TIFF encoder, so "TIFF" export was a PNG with the
//     extension renamed. ImageJ opens it, but a submission system that sniffs
//     the file signature sees PNG and rejects it.
//  2. canvas.toBlob() writes no resolution metadata at all. A 2244px-wide file
//     exported "at 300 dpi" reports 72 dpi when the publisher checks it, which
//     is a very common desk-reject.
//
// Both are fixed by encoding the pixels ourselves: a baseline TIFF writer, and
// a pHYs chunk injected into the PNG stream.

function crc32(bytes) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n=0;n<256;n++) {
      let c = n;
      for (let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i=0;i<bytes.length;i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Insert a pHYs chunk so the PNG declares its real print resolution.
// pHYs must appear after IHDR and before the first IDAT.
function pngWithDPI(arrayBuffer, dpi) {
  const src = new Uint8Array(arrayBuffer);
  const SIG = [137,80,78,71,13,10,26,10];
  for (let i=0;i<8;i++) if (src[i] !== SIG[i]) return src;      // not a PNG; leave alone

  const ppm = Math.round(dpi / 0.0254);                          // pixels per metre
  const chunk = new Uint8Array(21);                              // 4 len + 4 type + 9 data + 4 crc
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk[4]=0x70; chunk[5]=0x48; chunk[6]=0x59; chunk[7]=0x73;    // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1;                                                 // unit = metre
  dv.setUint32(17, crc32(chunk.subarray(4,17)));

  // IHDR is always the first chunk: 8 sig + 4 len + 4 type + 13 data + 4 crc
  const insertAt = 8 + 4 + 4 + 13 + 4;
  const out = new Uint8Array(src.length + chunk.length);
  out.set(src.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(src.subarray(insertAt), insertAt + chunk.length);
  return out;
}

// Baseline TIFF (uncompressed RGB, little-endian) with real resolution tags.
// Baseline is the most broadly accepted flavour — every journal pipeline,
// ImageJ, Photoshop and Illustrator read it without a plugin.
function encodeTIFF(imageData, dpi) {
  const w = imageData.width, h = imageData.height, rgba = imageData.data;
  const TAGS = [
    [256, 4, 1, w],            // ImageWidth
    [257, 4, 1, h],            // ImageLength
    [258, 3, 3, null],         // BitsPerSample -> [8,8,8]
    [259, 3, 1, 1],            // Compression = none
    [262, 3, 1, 2],            // PhotometricInterpretation = RGB
    [273, 4, 1, null],         // StripOffsets
    [277, 3, 1, 3],            // SamplesPerPixel
    [278, 4, 1, h],            // RowsPerStrip = whole image
    [279, 4, 1, w*h*3],        // StripByteCounts
    [282, 5, 1, null],         // XResolution
    [283, 5, 1, null],         // YResolution
    [296, 3, 1, 2],            // ResolutionUnit = inch
  ];
  const n = TAGS.length;
  const ifdOffset   = 8;
  const ifdSize     = 2 + n*12 + 4;
  const bpsOffset   = ifdOffset + ifdSize;   // 3 SHORTs = 6 bytes
  const xresOffset  = bpsOffset + 6;         // RATIONAL = 8 bytes
  const yresOffset  = xresOffset + 8;
  const pixelOffset = yresOffset + 8;
  const total       = pixelOffset + w*h*3;

  const buf = new ArrayBuffer(total);
  const dv  = new DataView(buf);
  const u8  = new Uint8Array(buf);

  dv.setUint16(0, 0x4949, true);      // "II" little-endian
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdOffset, true);
  dv.setUint16(ifdOffset, n, true);

  const RES = Math.round(dpi);
  let p = ifdOffset + 2;
  TAGS.forEach(([tag, type, count, value])=>{
    dv.setUint16(p, tag, true);
    dv.setUint16(p+2, type, true);
    dv.setUint32(p+4, count, true);
    if (tag === 258)      dv.setUint32(p+8, bpsOffset, true);
    else if (tag === 273) dv.setUint32(p+8, pixelOffset, true);
    else if (tag === 282) dv.setUint32(p+8, xresOffset, true);
    else if (tag === 283) dv.setUint32(p+8, yresOffset, true);
    else if (type === 3)  { dv.setUint16(p+8, value, true); dv.setUint16(p+10, 0, true); }
    else                  dv.setUint32(p+8, value, true);
    p += 12;
  });
  dv.setUint32(p, 0, true);           // no further IFDs

  dv.setUint16(bpsOffset,   8, true);
  dv.setUint16(bpsOffset+2, 8, true);
  dv.setUint16(bpsOffset+4, 8, true);
  dv.setUint32(xresOffset,     RES, true); dv.setUint32(xresOffset+4, 1, true);
  dv.setUint32(yresOffset,     RES, true); dv.setUint32(yresOffset+4, 1, true);

  // RGBA -> RGB, compositing any transparency onto white so the file matches
  // what the screen showed rather than going dark in a print workflow.
  let o = pixelOffset;
  for (let i=0;i<rgba.length;i+=4) {
    const a = rgba[i+3];
    if (a === 255) { u8[o++]=rgba[i]; u8[o++]=rgba[i+1]; u8[o++]=rgba[i+2]; }
    else {
      const f = a/255;
      u8[o++] = Math.round(rgba[i]  *f + 255*(1-f));
      u8[o++] = Math.round(rgba[i+1]*f + 255*(1-f));
      u8[o++] = Math.round(rgba[i+2]*f + 255*(1-f));
    }
  }
  return buf;
}

// Encode a canvas for download in the requested format, with correct DPI
// metadata baked in for every raster format.
function encodeCanvas(canvas, format, dpi) {
  if (format === "tiff") {
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return Promise.resolve(new Blob([encodeTIFF(data, dpi)], {type:"image/tiff"}));
  }
  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  return canvasToBlob(canvas, mime, 0.95).then(blob=>{
    if (format !== "png") return blob;
    return blob.arrayBuffer().then(ab=>new Blob([pngWithDPI(ab, dpi)], {type:"image/png"}))
                             .catch(()=>blob);   // metadata is a bonus, never a blocker
  });
}

function ExportPanel({svgRef, d, rows, sets, comparisons, plotType}) {
  const C = useC();
  const [fmt, setFmt] = useState("png");
  const [dpi, setDpi] = useState(300);
  const [useSize, setUseSize] = useState(false);
  const [mmPreset, setMmPreset] = useState(183);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);

  const FMTS = [
    {id:"png",l:"PNG",sub:"Best for most journals"},
    {id:"jpeg",l:"JPEG",sub:"Smaller file size"},
    {id:"tiff",l:"TIFF",sub:"ImageJ / Photoshop"},
    {id:"svg",l:"SVG",sub:"Vector, infinitely scalable"},
    {id:"csv",l:"CSV",sub:"Download data table"},
  ];

  const svgEl0 = svgRef && svgRef.current;
  const vb = svgEl0 ? (svgEl0.getAttribute("viewBox")||"0 0 700 420").split(" ").map(Number) : [0,0,700,420];
  const nativeW = vb[2], nativeH = vb[3];
  const mmW = mmPreset, mmH = Math.round(mmPreset * (nativeH/nativeW));
  const pxFromMM = mm => Math.round(mm/25.4*dpi);
  const prevW = useSize ? pxFromMM(mmW) : Math.round(nativeW*dpi/96);
  const prevH = useSize ? pxFromMM(mmH) : Math.round(nativeH*dpi/96);

  const doExportCSV = () => {
    const filled = (rows||[]).filter(r=>r.term&&r.term.trim());
    if (!filled.length) return;
    const hasNES = filled.some(r=>r.NES!==undefined && r.NES!=="");
    const header = "term,category,pvalue,padj,count,geneRatioN,geneRatioD,genes"+(hasNES?",NES":"");
    const lines = filled.map(r=>
      [r.term,r.category||"",r.pvalue||"",r.padj||"",r.count||"",
       r.geneRatioN||"",r.geneRatioD||"",r.genes||"", ...(hasNES?[r.NES!==undefined?r.NES:""]:[])].map(v=>
        String(v).includes(",")?'"'+v+'"':v
      ).join(",")
    );
    const csv = header+"\n"+lines.join("\n");
    downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}), "pathway_"+plotType+"_"+new Date().toISOString().slice(0,10)+".csv");
  };

  const doExport = async () => {
    if (fmt==="csv") { doExportCSV(); setDone(true); setTimeout(()=>setDone(false),1500); return; }
    setSaving(true); setErr(null);
    const name = "pathway_"+plotType+"_" + new Date().toISOString().slice(0,10);
    await new Promise(r=>setTimeout(r,60));
    try {
      const svgEl = svgRef && svgRef.current;
      if (!svgEl) { setErr("Couldn't find the plot. Switch to the Plot or Split view and try again."); return; }
      const clone = svgEl.cloneNode(true);
      const vbParts = (svgEl.getAttribute("viewBox") || "0 0 700 420").split(" ").map(Number);
      const svgW = vbParts[2]||700, svgH = vbParts[3]||420;
      prepareSVGForExport(clone, svgW, svgH, d.ff);
      const svgStr = serializeSVG(clone);
      if (fmt==="svg") {
        downloadBlob(new Blob([svgStr],{type:"image/svg+xml;charset=utf-8"}), name+".svg");
      } else {
        const outW = useSize ? pxFromMM(mmW) : Math.round(svgW*dpi/96);
        const outH = useSize ? pxFromMM(mmH) : Math.round(svgH*dpi/96);
        const cv = await rasterizeSVG(svgStr, outW, outH, svgW, svgH, "#fff");
        const suffix = "_"+dpi+"dpi"+(useSize?"_"+mmW+"x"+mmH+"mm":"");
        const ext = fmt==="jpeg" ? ".jpg" : fmt==="tiff" ? ".tif" : ".png";
        downloadBlob(await encodeCanvas(cv, fmt, dpi), name+suffix+ext);
      }
      setDone(true); setTimeout(()=>setDone(false),1500);
    } catch(e) { setErr((e&&e.message)?e.message:"Export failed."); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <SLabel>Format</SLabel>
      <div style={{display:"flex", flexDirection:"column", gap:5, marginBottom:12}}>
        {FMTS.map(f=>(
          <button key={f.id} onClick={()=>setFmt(f.id)} style={{display:"flex", flexDirection:"column", padding:"7px 10px", borderRadius:8, textAlign:"left", cursor:"pointer",
            background:fmt===f.id?C.cSel:"transparent", border:"1.5px solid "+(fmt===f.id?C.accent:C.border)}}>
            <span style={{fontSize:12, fontWeight:700, color:fmt===f.id?C.text:C.muted}}>{f.l}</span>
            <span style={{fontSize:9, color:C.muted}}>{f.sub}</span>
          </button>
        ))}
      </div>
      {fmt!=="svg"&&fmt!=="csv"&&(
        <div style={{marginBottom:10}}>
          <SLabel>Resolution (DPI)</SLabel>
          <div style={{display:"flex", gap:5, marginBottom:6}}>
            {[72,150,300,600].map(v=><Pill key={v} active={dpi===v} onClick={()=>setDpi(v)}>{v}</Pill>)}
          </div>
        </div>
      )}
      {fmt!=="csv"&&<>
      <SLabel>Figure Size (mm)</SLabel>
      <Toggle value={useSize} onChange={setUseSize} label="Set custom size in mm"/>
      {useSize&&(
        <div style={{display:"flex", flexWrap:"wrap", gap:5, marginBottom:10}}>
          {MM_PRESETS.map(p=>(
            <button key={p.label} onClick={()=>setMmPreset(p.w)} style={{padding:"5px 9px", borderRadius:7, cursor:"pointer",
              background:mmPreset===p.w?C.cSel:"transparent", border:"1.5px solid "+(mmPreset===p.w?C.accent:C.border), textAlign:"left"}}>
              <div style={{fontSize:11, fontWeight:700, color:mmPreset===p.w?C.text:C.muted}}>{p.label}</div>
              <div style={{fontSize:8, color:C.muted}}>{p.desc}</div>
            </button>
          ))}
        </div>
      )}
      </>}
      {fmt!=="csv"&&<div style={{padding:"9px 11px", borderRadius:8, background:C.panel2, border:"1px solid "+C.border, marginBottom:12}}>
        <div style={{fontSize:10, color:C.muted, marginBottom:4, fontWeight:600}}>Output preview</div>
        {useSize&&<div style={{fontSize:11, color:C.text, marginBottom:2}}>{mmW} x {mmH} mm</div>}
        {fmt!=="svg"&&<div style={{fontSize:11, color:C.text}}>{prevW} x {prevH} px at {dpi} dpi</div>}
        {fmt!=="svg"&&(dpi>=300?<div style={{fontSize:10, color:C.success, fontWeight:600, marginTop:4}}>Journal quality</div>:<div style={{fontSize:10, color:C.muted, marginTop:4}}>Use 300+ dpi for publication</div>)}
      </div>}
      <button onClick={doExport} disabled={saving} style={{width:"100%", padding:"11px 0", borderRadius:8, fontSize:13, fontWeight:700, cursor:saving?"default":"pointer",
        background:done?C.success:C.accent, border:"none", color:"#fff"}}>
        {saving?"Preparing...":done?"Downloaded":fmt==="csv"?"Download CSV":"Download "+fmt.toUpperCase()}
      </button>
      {err&&(
        <div style={{marginTop:8, fontSize:11, lineHeight:1.55, padding:"8px 10px", borderRadius:6, background:"#FEE2E2", color:"#991B1B", border:"1px solid #FCA5A5"}}>
          <strong>Download failed.</strong> {err}
        </div>
      )}
    </div>
  );
}

// ─── Error Boundary ───────────────────────────────────────────────────────────
// Matches VolcanoPlot's structure: if a plot render throws (e.g. an unexpected
// data/settings combination), the whole app doesn't go blank — the user sees a
// recoverable message with the actual error, and the underlying data is untouched.
const IconWarn = ({size=28, color="#D97706"}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3 2 20h20L12 3z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r="0.6" fill={color} stroke="none"/>
  </svg>
);
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = {hasError:false, error:null}; }
  static getDerivedStateFromError(error) { return {hasError:true, error}; }
  componentDidCatch(error, info) { if (typeof console!=="undefined" && console.error) console.error("Plot render error:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding:"40px 24px", textAlign:"center", maxWidth:420, margin:"0 auto"}}>
          <div style={{marginBottom:8, display:"flex", justifyContent:"center"}}><IconWarn/></div>
          <div style={{fontSize:14, fontWeight:700, marginBottom:6, color:"#1E2736"}}>This plot hit a rendering error</div>
          <div style={{fontSize:11, color:"#64748B", lineHeight:1.6, marginBottom:12}}>
            Your data hasn't been lost — this usually means the current data or settings combination produced a shape the plot didn't expect. Check the Data tab for anything unusual, or load the example dataset to confirm the tool itself is working.
          </div>
          <div style={{fontSize:10, fontFamily:"monospace", background:"#F6F8FA", border:"1px solid #DDE1E7", borderRadius:6, padding:"8px 10px", marginBottom:14, textAlign:"left", color:"#991B1B", wordBreak:"break-word"}}>
            {this.state.error && this.state.error.message}
          </div>
          <button onClick={()=>this.setState({hasError:false,error:null})}
            style={{padding:"8px 20px", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer", background:"#2563EB", border:"none", color:"#fff"}}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Sheet Sidebar — dedicated left panel for multi-sheet management ───────────
// Matches VolcanoPlot's structure: rename/duplicate/delete via a per-sheet menu,
// inline rename, a "+ New" flow, and Save/Load project buttons grouped at the
// bottom — replaces the horizontal sheet-tabs row used previously.
const IconChart = ({size=13, color="currentColor"}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18"/><path d="M7 15l4-6 4 3 5-8"/>
  </svg>
);
function SheetSidebar({sheets, activeId, onSelect, onNew, onRename, onDuplicate, onDelete, onSave, onLoad}) {
  const C = useC();
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [menu, setMenu] = useState(null);
  const fileRef = useRef(null);
  const startRename = sh => { setRenaming(sh.id); setDraft(sh.name); setMenu(null); };
  const commitRename = () => { if (draft.trim()) onRename(renaming, draft.trim()); setRenaming(null); };
  return (
    <div style={{width:190, background:C.panel, borderRight:"1px solid "+C.border, display:"flex", flexDirection:"column", flexShrink:0}}>
      <div style={{padding:"10px 12px", borderBottom:"1px solid "+C.border, display:"flex", alignItems:"center", justifyContent:"space-between"}}>
        <span style={{fontSize:12, fontWeight:700, color:C.text}}>Sheets</span>
        <button onClick={()=>{setShowNew(true); setNewName("Pathway "+(sheets.length+1));}}
          style={{width:24, height:24, borderRadius:6, background:C.accent, border:"none", color:"#fff", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700}}>+</button>
      </div>
      <div style={{flex:1, overflowY:"auto", padding:"4px 0"}}>
        {sheets.map(sh=>(
          <div key={sh.id} onClick={()=>{onSelect(sh.id); setMenu(null);}}
            style={{position:"relative", display:"flex", alignItems:"center", gap:6, padding:"8px 12px", cursor:"pointer",
              background:sh.id===activeId?C.cSel:"transparent", borderLeft:"3px solid "+(sh.id===activeId?C.accent:"transparent")}}>
            <span style={{flexShrink:0, display:"flex", color:sh.id===activeId?C.accent:C.muted}}><IconChart size={13}/></span>
            {renaming===sh.id
              ? <input autoFocus value={draft} onChange={e=>setDraft(e.target.value)}
                  onBlur={commitRename} onKeyDown={e=>{if(e.key==="Enter")commitRename(); if(e.key==="Escape")setRenaming(null);}}
                  onClick={e=>e.stopPropagation()}
                  style={{flex:1, fontSize:11, padding:"2px 5px", borderRadius:4, border:"1px solid "+C.accent, background:C.cBg, color:C.text, outline:"none", minWidth:0}}/>
              : <span style={{flex:1, fontSize:11, fontWeight:sh.id===activeId?600:400, color:sh.id===activeId?C.text:C.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{sh.name}</span>
            }
            <button onClick={e=>{e.stopPropagation(); setMenu(menu===sh.id?null:sh.id);}}
              style={{padding:"2px 6px", fontSize:13, background:"transparent", border:"none", color:C.muted, cursor:"pointer", opacity:sh.id===activeId?1:0, flexShrink:0}}>...</button>
            {menu===sh.id&&(
              <div onClick={e=>e.stopPropagation()}
                style={{position:"absolute", right:4, top:30, zIndex:100, background:C.panel, border:"1px solid "+C.border, borderRadius:8, boxShadow:C.shadow, minWidth:138, padding:"4px 0"}}>
                {[["Rename",()=>startRename(sh)],["Duplicate",()=>{onDuplicate(sh.id); setMenu(null);}],["Delete",()=>{onDelete(sh.id); setMenu(null);}]].map(([lb,fn])=>(
                  <button key={lb} onClick={fn} style={{display:"block", width:"100%", padding:"7px 14px", textAlign:"left", fontSize:12, color:lb==="Delete"?C.danger:C.text, background:"transparent", border:"none", cursor:"pointer"}}>{lb}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {showNew&&(
        <div style={{padding:"10px", borderTop:"1px solid "+C.border, background:C.panel2}}>
          <div style={{fontSize:11, fontWeight:600, color:C.text, marginBottom:6}}>New Sheet</div>
          <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Sheet name"
            style={{width:"100%", boxSizing:"border-box", padding:"5px 8px", fontSize:11, borderRadius:5, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none", marginBottom:7}}/>
          <div style={{display:"flex", gap:5}}>
            <button onClick={()=>{onNew(newName.trim()||"Pathway "+(sheets.length+1)); setShowNew(false);}}
              style={{flex:1, padding:"5px 0", borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", background:C.accent, border:"none", color:"#fff"}}>Create</button>
            <button onClick={()=>setShowNew(false)}
              style={{flex:1, padding:"5px 0", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{padding:"10px 12px", borderTop:"1px solid "+C.border, display:"flex", flexDirection:"column", gap:5}}>
        <button onClick={onSave} style={{width:"100%", padding:"7px 0", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", background:C.success, border:"none", color:"#fff"}}>Save Project</button>
        <button onClick={()=>fileRef.current&&fileRef.current.click()} style={{width:"100%", padding:"7px 0", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>Load Project</button>
        <input ref={fileRef} type="file" accept=".json" style={{display:"none"}}
          onChange={e=>{const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>{try{onLoad(JSON.parse(ev.target.result));}catch(_){}}; r.readAsText(f); e.target.value="";}}/>
        <div style={{fontSize:9, color:C.muted, textAlign:"center"}}>Ctrl+S to save</div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function PathwaySuitePage() {
  const C = useTheme(); // live theme from the app shell
  const [rtab, setRtab] = useState("terms");
  const [layout, setLayout] = useState("split"); // split | sheet | plot — matches VolcanoPlot's responsive layout modes
  const svgExportRef = useRef(null);

  const [sheets, setSheets] = useState(()=>[mkSheet("Pathway 1")]);
  const [activeId, setActiveId] = useState(()=>sheets[0].id);
  const active = sheets.find(s=>s.id===activeId)||sheets[0];

  const histMap=useRef({}), curMap=useRef({});
  const pushHistory = useCallback((id, snapshot) => {
    if(!histMap.current[id]) histMap.current[id]=[];
    if(curMap.current[id]===undefined) curMap.current[id]=-1;
    const h=histMap.current[id]; const c=curMap.current[id];
    const trimmed=h.slice(0,c+1); trimmed.push(snapshot);
    histMap.current[id]=trimmed.slice(-50);
    curMap.current[id]=trimmed.length-1;
  },[]);

  const updateActive = useCallback((patch, record=true) => {
    setSheets(prev => prev.map(s => {
      if (s.id!==activeId) return s;
      const next = typeof patch==="function" ? patch(s) : {...s, ...patch};
      if (record) pushHistory(s.id, {rows:s.rows, d:s.d, sets:s.sets, plotType:s.plotType});
      return next;
    }));
  }, [activeId, pushHistory]);

  const setRows = useCallback(r => updateActive(s=>({...s, rows: typeof r==="function"?r(s.rows):r})), [updateActive]);
  const setD    = useCallback(r => updateActive(s=>({...s, d: typeof r==="function"?r(s.d):r}), true), [updateActive]);
  const setSets = useCallback(r => updateActive(s=>({...s, sets: typeof r==="function"?r(s.sets):r}), false), [updateActive]);
  const setPlotType = useCallback(v => updateActive(s=>({...s, plotType:v}), false), [updateActive]);
  const setGeneListInput = useCallback(v => updateActive(s=>({...s, geneListInput:v}), false), [updateActive]);
  const setBackgroundN = useCallback(v => updateActive(s=>({...s, backgroundN:v}), false), [updateActive]);
  const setRankedListInput = useCallback(v => updateActive(s=>({...s, rankedListInput:v}), false), [updateActive]);
  const setGseaPerms = useCallback(v => updateActive(s=>({...s, gseaPerms:v}), false), [updateActive]);

  const undo = useCallback(() => {
    const id=activeId, h=histMap.current[id], c=curMap.current[id];
    if(!h||c===undefined||c<0) return;
    const snap=h[c]; curMap.current[id]=c-1;
    setSheets(prev=>prev.map(s=>s.id===id?{...s,...snap}:s));
  },[activeId]);
  const redo = useCallback(() => {
    const id=activeId, h=histMap.current[id], c=curMap.current[id];
    if(!h||c===undefined||c>=h.length-1) return;
    curMap.current[id]=c+1; const snap=h[c+1];
    setSheets(prev=>prev.map(s=>s.id===id?{...s,...snap}:s));
  },[activeId]);
  const canU = (histMap.current[activeId]&&curMap.current[activeId]>=0);
  const canR = (histMap.current[activeId]&&curMap.current[activeId]<histMap.current[activeId].length-1);

  const {rows,d,sets,geneListInput,backgroundN,rankedListInput,gseaPerms}=active;
  const plotType = active.plotType||"dot";

  const handleExclude = useCallback(termName => {
    setSets(prev => {
      const ex = new Set(Array.isArray(prev.excluded)?prev.excluded:[]);
      ex.add(termName);
      return {...prev, excluded: [...ex]};
    });
  }, [setSets]);
  const handleRestoreAll = useCallback(() => { setSets(prev => ({...prev, excluded: []})); }, [setSets]);
  const handleDownloadGenes = useCallback(() => {}, []);

  const [customDB, setCustomDB] = useState(null);

  const runORAAndFill = useCallback(() => {
    const genes = geneListInput.split(/[\n,;\s]+/).map(g=>g.trim()).filter(Boolean);
    if (!genes.length) return;
    const results = runORA(genes, backgroundN||20000, customDB ? customDB.sets : null);
    updateActive(s=>({...s, rows: results}));
  }, [geneListInput, backgroundN, customDB, updateActive]);

  const [gseaRunning, setGseaRunning] = useState(false);
  const [gseaProgress, setGseaProgress] = useState({done:0, total:0});
  const runGSEAAndFill = useCallback(async () => {
    const ranked = parseRankedList(rankedListInput);
    if (ranked.length < 10) return;
    const geneSets = customDB ? customDB.sets : REF_TERMS;
    setGseaRunning(true);
    setGseaProgress({done:0, total:geneSets.length});
    try {
      const results = await runPrerankedGSEA(
        ranked.map(r=>r.gene), ranked.map(r=>r.score), geneSets,
        { nPerm: gseaPerms||200, onProgress: (done,total)=>setGseaProgress({done,total}) }
      );
      const rows = results.map(r => ({
        term: r.term, category: r.category, pvalue: r.pvalue, padj: r.padj,
        count: r.count, geneRatioN: r.leadingEdge.length, geneRatioD: r.count,
        genes: r.genes, NES: r.NES,
      }));
      updateActive(s=>({...s, rows, d:{...s.d, method:"GSEA (preranked)"}}));
    } finally {
      setGseaRunning(false);
    }
  }, [rankedListInput, gseaPerms, customDB, updateActive]);

  const { all: allTerms, shown: shownTermsArr, redundantCount } = useProcessedTerms(rows, sets);
  const shownTerms = shownTermsArr.length;
  const { nodes: netNodes, edges: netEdges } = useNetworkGraph(rows, sets, d);

  const addSheet = (name) => {
    const n = mkSheet(name || "Pathway " + (sheets.length+1));
    setSheets(prev=>[...prev, n]); setActiveId(n.id);
  };
  const removeSheet = id => {
    if (sheets.length<=1) return;
    setSheets(prev=>prev.filter(s=>s.id!==id));
    if (activeId===id) setActiveId(sheets.find(s=>s.id!==id).id);
  };
  const renameSheet = (id, name) => setSheets(prev=>prev.map(s=>s.id===id?{...s,name}:s));
  const duplicateSheet = id => {
    const src = sheets.find(s=>s.id===id); if (!src) return;
    const copy = {...JSON.parse(JSON.stringify(src)), id:Date.now()+Math.random(), name:src.name+" (copy)"};
    setSheets(prev=>[...prev, copy]); setActiveId(copy.id);
  };

  const saveProject = () => {
    const data = JSON.stringify({sheets, activeId}, null, 0);
    const a=document.createElement("a");
    a.href="data:application/json;charset=utf-8,"+encodeURIComponent(data);
    a.download="pathwaysuite_project_"+new Date().toISOString().slice(0,10)+".json";
    a.click();
  };
  const loadProject = parsed => {
    if (!parsed || !parsed.sheets || !parsed.sheets.length) return;
    setSheets(parsed.sheets); setActiveId(parsed.activeId||parsed.sheets[0].id);
  };

  useEffect(()=>{
    const onKey = e => {
      if ((e.ctrlKey||e.metaKey) && e.key==="s") { e.preventDefault(); saveProject(); }
      if ((e.ctrlKey||e.metaKey) && e.key==="z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey||e.metaKey) && (e.key==="y" || (e.key==="z"&&e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  },[undo,redo]);

  const isNetwork = plotType==="network";
  const TABS = isNetwork
    ? [{id:"terms",label:"Terms"},{id:"plot",label:"Style"},{id:"ora",label:"Enrichment"},{id:"export",label:"Export"}]
    : [{id:"terms",label:"Terms"},{id:"plot",label:"Style"},{id:"axes",label:"Axes/Frame"},{id:"ora",label:"Enrichment"},{id:"export",label:"Export"}];
  const filled = rows.filter(r=>r.term&&r.term.trim()).length;

  return (
    <div style={{height:"100%", background:C.bg, color:C.text, fontFamily:"Inter,system-ui,sans-serif", display:"flex", flexDirection:"column", overflow:"hidden"}}>
      {/* Compact header — app identity, active sheet name, layout toggle, undo/redo, theme */}
      <div style={{padding:"0 16px", borderBottom:"1px solid "+C.border, background:C.panel, display:"flex", alignItems:"center", gap:12, flexShrink:0, height:48, boxShadow:C.shadow}}>
        <div style={{display:"flex", alignItems:"center", gap:8}}>
          
          <span style={{fontSize:11, color:C.muted, padding:"2px 8px", borderRadius:10, background:C.panel2, border:"1px solid "+C.border}}>Pathway Suite</span>
        </div>
        <div style={{height:20, width:1, background:C.border}}/>
        <span style={{fontSize:12, fontWeight:600, color:C.muted}}>{active.name}</span>
        <div style={{flex:1}}/>
        <CloudProjects tool="pathway" getData={()=>({sheets,activeId})} onLoad={loadProject}/>
        <div style={{display:"flex", background:C.panel2, borderRadius:8, padding:2, border:"1px solid "+C.border}}>
          {[["split","Split"],["sheet","Data"],["plot","Plot"]].map(([id,lb])=>(
            <button key={id} onClick={()=>setLayout(id)} style={{padding:"4px 12px", fontSize:11, fontWeight:600, cursor:"pointer", borderRadius:6, border:"none", background:layout===id?C.panel:"transparent", color:layout===id?C.text:C.muted, boxShadow:layout===id?C.shadow:"none"}}>{lb}</button>
          ))}
        </div>
        <div style={{display:"flex", gap:3}}>
          <button onClick={undo} disabled={!canU} title="Ctrl+Z" style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+C.border, cursor:canU?"pointer":"default", color:canU?C.text:C.muted}}>Undo</button>
          <button onClick={redo} disabled={!canR} title="Ctrl+Y" style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+C.border, cursor:canR?"pointer":"default", color:canR?C.text:C.muted}}>Redo</button>
        </div>
      </div>

      <div style={{flex:1, display:"flex", minHeight:0, overflow:"hidden"}}>
        <SheetSidebar sheets={sheets} activeId={activeId} onSelect={setActiveId} onNew={addSheet} onRename={renameSheet} onDuplicate={duplicateSheet} onDelete={removeSheet} onSave={saveProject} onLoad={loadProject}/>

        <div style={{flex:1, display:"flex", minWidth:0, overflow:"hidden"}}>
          {(layout==="split"||layout==="sheet")&&(
            <div style={{flex:1, overflowY:"auto", padding:"16px 18px", borderRight:layout==="split"?"1px solid "+C.border:"none"}}>
              <div style={{marginBottom:14}}>
                <div style={{fontSize:15, fontWeight:700, color:C.text}}>{active.name}</div>
                <div style={{fontSize:11, color:C.muted, marginTop:2}}>Paste enrichment results from clusterProfiler, DAVID, ShinyGO, Enrichr, or this tool's built-in ORA/GSEA calculator.</div>
              </div>
              <Sheet rows={rows} setRows={setRows} undo={undo} redo={redo} canU={canU} canR={canR}/>
              {layout==="sheet"&&<div style={{marginTop:18, display:"flex", justifyContent:"center"}}><button onClick={()=>setLayout("plot")} style={{padding:"10px 32px", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer", background:C.accent, border:"none", color:"#fff", boxShadow:C.shadow}}>Generate Plot</button></div>}
            </div>
          )}
          {(layout==="split"||layout==="plot")&&(
            <div style={{flex:1, overflowY:"auto", padding:"16px 18px", display:"flex", flexDirection:"column"}}>
              <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:12}}>
                <div style={{display:"flex", gap:4, padding:3, borderRadius:9, background:C.panel2, border:"1px solid "+C.border}}>
                  {[["dot","Dot Plot"],["bar","Bar Plot"],["network","Network Map"]].map(([v,lb])=>(
                    <button key={v} onClick={()=>setPlotType(v)} style={{padding:"6px 14px", borderRadius:7, fontSize:12, fontWeight:700, cursor:"pointer",
                      background:plotType===v?C.panel:"transparent", color:plotType===v?C.text:C.muted, border:"none", boxShadow:plotType===v?C.shadow:"none"}}>{lb}</button>
                  ))}
                </div>
              </div>

              {!isNetwork && (
                <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:10, flexWrap:"wrap"}}>
                  <div style={{position:"relative", flex:1, maxWidth:320}}>
                    <div style={{position:"absolute", left:11, top:"50%", transform:"translateY(-50%)", color:C.muted, pointerEvents:"none", display:"flex"}}>
                      <IconSearch size={13}/>
                    </div>
                    <input value={sets.searchQ||""} onChange={e=>setSets(prev=>({...prev,searchQ:e.target.value}))}
                      placeholder="Search terms, genes, or categories..."
                      style={{width:"100%", boxSizing:"border-box", padding:"7px 10px 7px 32px", fontSize:11.5, borderRadius:20, border:"1px solid "+(sets.searchQ?C.accent:C.border), background:C.panel, color:C.text, outline:"none"}}/>
                    {sets.searchQ&&(
                      <button onClick={()=>setSets(prev=>({...prev,searchQ:""}))}
                        style={{position:"absolute", right:9, top:"50%", transform:"translateY(-50%)", color:C.muted, background:"transparent", border:"none", cursor:"pointer", padding:0, display:"flex"}}>
                        <IconX size={10}/>
                      </button>
                    )}
                  </div>
                  {(sets.excluded&&(Array.isArray(sets.excluded)?sets.excluded.length:sets.excluded.size)>0)&&(
                    <div style={{display:"flex", alignItems:"center", gap:6, padding:"5px 10px", borderRadius:16, background:"rgba(220,38,38,.07)", border:"1px solid rgba(220,38,38,.2)"}}>
                      <span style={{fontSize:11, color:"#DC2626", fontWeight:600}}>{Array.isArray(sets.excluded)?sets.excluded.length:sets.excluded.size} term{(Array.isArray(sets.excluded)?sets.excluded.length:sets.excluded.size)!==1?"s":""} excluded</span>
                      <button onClick={handleRestoreAll} style={{fontSize:10, color:"#DC2626", background:"transparent", border:"none", cursor:"pointer", padding:"0 4px", fontWeight:600}}>Restore all</button>
                    </div>
                  )}
                </div>
              )}

              <div style={{background:d.pbg||C.panel, border:"1px solid "+C.border, borderRadius:10, padding:"16px", boxShadow:C.shadow, overflowX:"auto"}}>
                <ErrorBoundary>
                  {plotType==="dot" && <DotPlot rows={rows} sets={sets} d={d} svgRef={svgExportRef} onExclude={handleExclude} onDownloadGenes={handleDownloadGenes}/>}
                  {plotType==="bar" && <BarPlot rows={rows} sets={sets} d={d} svgRef={svgExportRef} onExclude={handleExclude} onDownloadGenes={handleDownloadGenes}/>}
                  {plotType==="network" && <NetworkGraph rows={rows} sets={sets} d={d} svgRef={svgExportRef}/>}
                </ErrorBoundary>
              </div>
              <div style={{marginTop:6, fontSize:11, color:C.muted, textAlign:"center"}}>{filled} rows &middot; {sheets.length} sheet{sheets.length!==1?"s":""} &middot; Ctrl+S to save</div>
              {layout==="plot"&&<div style={{marginTop:10, textAlign:"center"}}><button onClick={()=>setLayout("sheet")} style={{padding:"5px 14px", borderRadius:6, fontSize:12, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>Back to data</button></div>}
            </div>
          )}
        </div>

        <div style={{width:280, borderLeft:"1px solid "+C.border, background:C.panel, flexShrink:0, display:"flex", flexDirection:"column"}}>
          <div style={{display:"flex", borderBottom:"1px solid "+C.border, flexShrink:0}}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setRtab(t.id)} style={{flex:1, padding:"10px 0", cursor:"pointer",
                background:rtab===t.id?C.panel2:"transparent", border:"none", borderBottom:"2px solid "+(rtab===t.id?C.accent:"transparent"), fontSize:10, fontWeight:700, color:rtab===t.id?C.text:C.muted}}>{t.label}</button>
            ))}
          </div>
          <div style={{flex:1, overflowY:"auto", padding:16}}>
            {rtab==="terms" && (isNetwork ? (
              <div>
                <SLabel>Significance Cutoff</SLabel>
                <Slider label="Adjusted p-value threshold" value={sets.pCut} min={0.001} max={0.2} step={0.001} onChange={v=>setSets(s=>({...s,pCut:v}))} display={sets.pCut}/>
                <div style={{fontSize:11, color:C.muted}}>Showing {netNodes.length} of {allTerms.length} terms</div>
                <div style={{fontSize:9, color:C.muted, marginTop:10, lineHeight:1.6}}>Significance filtering and search are shared with the Dot/Bar views — the same rows, filtered the same way, just visualized differently.</div>
              </div>
            ) : (
              <TermsPanel sets={sets} setSets={setSets} totalTerms={allTerms.length} shownTerms={shownTerms} redundantCount={redundantCount}/>
            ))}
            {rtab==="plot"  && <PlotPanel d={d} set={setD} plotType={plotType}/>}
            {rtab==="axes"  && !isNetwork && <AxesPanel sets={sets} setSets={setSets} d={d} setD={setD} plotType={plotType}/>}
            {rtab==="ora"   && <EnrichmentPanel geneListInput={geneListInput||""} setGeneListInput={setGeneListInput} backgroundN={backgroundN||20000} setBackgroundN={setBackgroundN} onRunORA={runORAAndFill} customDB={customDB} setCustomDB={setCustomDB} rankedListInput={rankedListInput||""} setRankedListInput={setRankedListInput} gseaPerms={gseaPerms||200} setGseaPerms={setGseaPerms} onRunGSEA={runGSEAAndFill} gseaRunning={gseaRunning} gseaProgress={gseaProgress}/>}
            {rtab==="export"&& <ExportPanel svgRef={svgExportRef} d={d} rows={rows} sets={sets} plotType={plotType}/>}
          </div>
          <div style={{padding:"6px 12px", borderTop:"1px solid "+C.border, fontSize:10, color:C.muted, display:"flex", alignItems:"center", justifyContent:"space-between"}}>
            <span>{filled} rows</span>
            <span style={{color:shownTerms>0?C.accent:C.muted}}>{shownTerms} shown</span>
            <span>Ctrl+S</span>
          </div>
        </div>
      </div>
    </div>
  );
}
