import React, { useState, useMemo, useRef, useCallback, useEffect, useContext } from "react";
import { readProjectText } from "../shared/projectFile";
import { parseLocaleNumber, guessHeaderRow } from "../shared/importUtils";
import { loadXLSX, XLSX_FAIL_MSG } from "../shared/loadXLSX";
import { encodeCanvas } from "../shared/exportUtils";
import { ThemeCtx, useTheme, LIGHT } from "../shared/theme";
import CloudProjects from "../shared/CloudProjects";

// ════════════════════════════════════════════════════════════════════════════
// Omilytix — MA Plot
// A vs M visualization for RNA-seq differential expression (DESeq2/edgeR/limma
// style). X = mean expression (A), Y = log2 fold change (M).
// ════════════════════════════════════════════════════════════════════════════

// ─── Design tokens (shared across the Omilytix suite) ─────────────────────────
// Theme tokens live in src/shared/theme.js (shared with the app shell).
const FONTS = ["Inter","Arial","Helvetica","Times New Roman","Georgia","Courier New"];

// ─── Data column schema ────────────────────────────────────────────────────────
const COLS = [
  {key:"gene",     label:"Gene",      width:100, type:"text", placeholder:"TP53"},
  {key:"baseMean", label:"Mean Expr", width:100, type:"num",  placeholder:"2840"},
  {key:"log2fc",   label:"Log2FC",    width:90,  type:"num",  placeholder:"-2.30"},
  {key:"pval",     label:"p-value",   width:110, type:"num",  placeholder:"0.001"},
];
function blankRow() { const r={}; COLS.forEach(c=>{r[c.key]="";}); return r; }

const EXAMPLE_DATA = [
  {gene:"TP53",   baseMean:2840,  log2fc:-2.3, pval:0.0008},
  {gene:"MYC",    baseMean:9120,  log2fc:3.1,  pval:0.000005},
  {gene:"BRCA1",  baseMean:410,   log2fc:-1.8, pval:0.032},
  {gene:"EGFR",   baseMean:5230,  log2fc:2.5,  pval:0.0002},
  {gene:"KRAS",   baseMean:1870,  log2fc:1.2,  pval:0.041},
  {gene:"CDH1",   baseMean:6640,  log2fc:-3.0, pval:0.00001},
  {gene:"AKT1",   baseMean:3320,  log2fc:1.9,  pval:0.015},
  {gene:"PTEN",   baseMean:1490,  log2fc:-1.1, pval:0.22},
  {gene:"VHL",    baseMean:780,   log2fc:-2.8, pval:0.0003},
  {gene:"BCL2",   baseMean:2260,  log2fc:2.2,  pval:0.0078},
  {gene:"MDM2",   baseMean:640,   log2fc:1.5,  pval:0.055},
  {gene:"VEGFA",  baseMean:11400, log2fc:3.4,  pval:0.000001},
  {gene:"HIF1A",  baseMean:4180,  log2fc:2.0,  pval:0.009},
  {gene:"NOTCH1", baseMean:970,   log2fc:-0.8, pval:0.38},
  {gene:"STAT3",  baseMean:3760,  log2fc:1.7,  pval:0.021},
  {gene:"RB1",    baseMean:1120,  log2fc:-2.1, pval:0.006},
  {gene:"CCND1",  baseMean:5960,  log2fc:2.3,  pval:0.0015},
  {gene:"CDK4",   baseMean:2010,  log2fc:1.8,  pval:0.013},
];

function mkSheet(name) {
  return {
    id:Date.now()+Math.random(), name,
    rows:EXAMPLE_DATA.map(r=>({...r})),
    display:{...DEFAULT_DISPLAY}, stats:{...DEFAULT_STATS},
    geneSet:"", geneSetColor:"#7C3AED",
  };
}

// ─── Style & statistics defaults ───────────────────────────────────────────────
const DEFAULT_DISPLAY = {
  ff:"Inter", plotTitle:"",
  xLbl:"Mean of Normalized Counts (log\u2081\u2080)",
  yLbl:"log\u2082 Fold Change",
  titleSize:14, titleBold:true,  titleItalic:false, titleColor:"",
  axisSize:12,  axisBold:false, axisItalic:false, axisColor:"#1a1a1a",
  tickSize:10,  tickBold:false, tickItalic:false, tickColor:"#1a1a1a",
  labelSize:9,  labelBold:false, labelItalic:true,  labelColorOverride:"",
  colorUp:"#DC2626", colorDown:"#2563EB", colorNs:"#94A3B8",
  plotBg:"", gridColor:"", axisWidth:1.2, gridWidth:0.5, showGrid:true, frameStyle:"open",
};
const DEFAULT_STATS = {
  fcThreshold:1, pThreshold:0.05, dotRadius:4, useAdjP:false,
  labelColor:"#1E2736",
  topN:0, topNBy:"pval",
  colorMode:"3group", fcOnlyColor:"#D97706",
  repelLabels:true,
  xMin:"auto", xMax:"auto", yMin:"auto", yMax:"auto",
  meanExprFloor:0.5,               // DESeq2-style epsilon so log10(0) never occurs
  showTrend:false, trendSpan:0.3, trendColor:"#16A34A",
};

const LEGEND_ITEMS = [
  {id:"title",    label:"Header",      desc:"p and FC cutoff line"},
  {id:"colorKey", label:"Color key",   desc:"UP / DOWN / NS with counts"},
  {id:"pval",     label:"p-value",     desc:"Threshold value"},
  {id:"nlp",      label:"-log10(p)",   desc:"Numeric cutoff (not plotted)"},
  {id:"fc",       label:"|log2FC|",    desc:"Fold-change threshold"},
  {id:"total",    label:"Total genes", desc:"N in dataset"},
  {id:"pct",      label:"% Sig",       desc:"(UP+DOWN)/Total"},
  {id:"updown",   label:"Up/Down",     desc:"Counts each direction"},
  {id:"labeled",  label:"Labeled",     desc:"Count of gene labels"},
];
const MM_PRESETS = [
  {label:"89mm",  desc:"Single col", w:89},
  {label:"120mm", desc:"1.5 col",    w:120},
  {label:"183mm", desc:"Double col", w:183},
  {label:"247mm", desc:"Full page",  w:247},
];

// ─── Pure data helpers ──────────────────────────────────────────────────────────
// A = log10(mean expression), floored at `eps` so zero/near-zero counts don't
// produce -Infinity. DESeq2's plotMA() uses the same convention.
function meanExprToA(baseMean, eps) {
  return Math.log10(Math.max(+baseMean || 0, eps));
}
function pToNlp(pval) {
  return -Math.log10(Math.max(+pval || 0, 1e-300));
}
function classify(nlp, log2fc, nlpThresh, fcThresh) {
  const sigP = nlp >= nlpThresh, sigFC = Math.abs(log2fc) >= fcThresh;
  if (sigP && log2fc > fcThresh) return "UP";
  if (sigP && log2fc < -fcThresh) return "DOWN";
  if (sigFC) return "FC_ONLY";
  return "NS";
}

// Tricube-weighted local linear regression (single-pass, non-robust LOESS).
// Runs in O(n) after an initial sort thanks to a sliding window over x.
function computeLoess(pairs, span) {
  const n = pairs.length;
  if (n < 4) return pairs;
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const xs = sorted.map(p => p[0]);
  const ys = sorted.map(p => p[1]);
  const windowSize = Math.max(3, Math.min(n, Math.ceil(span * n)));
  const out = new Array(n);
  let left = 0;
  for (let i = 0; i < n; i++) {
    const x0 = xs[i];
    while (left + windowSize < n && Math.abs(xs[left + windowSize] - x0) < Math.abs(xs[left] - x0)) left++;
    const right = Math.min(left + windowSize - 1, n - 1);
    let maxDist = 1e-9;
    for (let j = left; j <= right; j++) maxDist = Math.max(maxDist, Math.abs(xs[j] - x0));
    let sw = 0, swx = 0, swy = 0, swxy = 0, swxx = 0;
    for (let j = left; j <= right; j++) {
      const dNorm = Math.abs(xs[j] - x0) / maxDist;
      const w = dNorm < 1 ? Math.pow(1 - Math.pow(dNorm, 3), 3) : 0;
      sw += w; swx += w * xs[j]; swy += w * ys[j]; swxy += w * xs[j] * ys[j]; swxx += w * xs[j] * xs[j];
    }
    const denom = sw * swxx - swx * swx;
    let yhat;
    if (sw < 1e-9) yhat = ys[i];
    else if (Math.abs(denom) < 1e-9) yhat = swy / sw;
    else { const b = (sw * swxy - swx * swy) / denom; const a = (swy - b * swx) / sw; yhat = a + b * x0; }
    out[i] = [x0, yhat];
  }
  return out;
}

function parsePastedText(text, startRow, startCol) {
  return text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").trim().split("\n").map((line, li) => {
    const cells = line.split("\t"), patch = {};
    cells.forEach((cell, ci) => {
      const colIdx = startCol + ci;
      if (colIdx < COLS.length) {
        const col = COLS[colIdx];
        patch[col.key] = col.type === "num"
          ? (cell.trim() === "" || isNaN(cell.trim()) ? "" : +cell.trim())
          : cell.trim();
      }
    });
    return {row: startRow + li, patch};
  });
}

// Resolves display settings into ready-to-use SVG style objects for one theme.
function resolveStyles(display, theme) {
  const font = display.ff || "Inter";
  const textStyle = (sizeKey, boldKey, italicKey, colorKey, fallbackColor) => ({
    fontSize: display[sizeKey] || 12,
    fontWeight: display[boldKey] ? "bold" : "normal",
    fontStyle: display[italicKey] ? "italic" : "normal",
    fill: display[colorKey] || fallbackColor,
    fontFamily: font,
  });
  return {
    font,
    title: {
      fontSize: display.titleSize || 14, fontWeight: display.titleBold ? "bold" : "normal",
      fontStyle: display.titleItalic ? "italic" : "normal", color: display.titleColor || theme.text, fontFamily: font,
    },
    axis: textStyle("axisSize","axisBold","axisItalic","axisColor", theme.text),
    tick: textStyle("tickSize","tickBold","tickItalic","tickColor", theme.text),
    pointLabel: textStyle("labelSize","labelBold","labelItalic","labelColorOverride", theme.muted),
    colorUp: display.colorUp || theme.up,
    colorDown: display.colorDown || theme.down,
    colorNs: display.colorNs || theme.ns,
    plotBg: display.plotBg || theme.panel,
    gridColor: display.gridColor || theme.grid,
    axisWidth: display.axisWidth || 1.2,
    gridWidth: display.gridWidth || 0.5,
    axisLineColor: display.axisColor || theme.text,
  };
}

// ─── Small reusable UI atoms ────────────────────────────────────────────────────
function Pill({active, onClick, children, color}) {
  const t=useTheme();
  return (
    <button onClick={onClick} style={{padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer",
      background:active?(color||t.accent):"transparent",
      border:"1px solid "+(active?(color||t.accent):t.border),
      color:active?"#fff":t.muted, transition:"all .12s"}}>
      {children}
    </button>
  );
}
function SectionLabel({children, marginTop=0}) {
  const t=useTheme();
  return <div style={{fontSize:9, fontWeight:700, color:t.muted, textTransform:"uppercase", letterSpacing:"0.09em", marginBottom:6, marginTop}}>{children}</div>;
}
function Divider() {
  const t=useTheme();
  return <div style={{height:1, background:t.border, margin:"12px 0"}}/>;
}
function ColorSwatch({color, size=20, onChange}) {
  return (
    <div style={{position:"relative", width:size, height:size, borderRadius:4, overflow:"hidden", flexShrink:0, cursor:"pointer", border:"1px solid rgba(0,0,0,.1)"}}>
      <div style={{position:"absolute", inset:0, background:color}}/>
      <input type="color" value={color} onChange={e=>onChange(e.target.value)}
        style={{opacity:0, position:"absolute", inset:0, cursor:"pointer", width:"100%", height:"100%"}}/>
    </div>
  );
}
function Toggle({value, onChange, label}) {
  const t=useTheme();
  return (
    <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8}}>
      <span style={{fontSize:11, color:t.muted}}>{label}</span>
      <button onClick={()=>onChange(!value)} style={{width:34, height:18, borderRadius:9, border:"none", cursor:"pointer",
        background:value?t.accent:t.border, position:"relative", transition:"background .15s", padding:0, flexShrink:0}}>
        <div style={{position:"absolute", top:2, left:value?16:2, width:14, height:14, borderRadius:7, background:"#fff", transition:"left .15s"}}/>
      </button>
    </div>
  );
}
function LabeledSlider({label, value, min, max, step, onChange, display}) {
  const t=useTheme();
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:"flex", justifyContent:"space-between", marginBottom:3}}>
        <span style={{fontSize:11, color:t.muted}}>{label}</span>
        <span style={{fontSize:11, fontWeight:600, color:t.accent}}>{display!==undefined?display:value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(+e.target.value)} style={{width:"100%", accentColor:t.accent}}/>
    </div>
  );
}

// ─── Data entry sheet ───────────────────────────────────────────────────────────
// ─── File import (results-table tools) ──────────────────────────────────────
// A DESeq2/edgeR/limma export has far more columns than this tool needs
// (baseMean, log2FoldChange, lfcSE, stat, pvalue, padj, ...), so the job here
// is mapping columns to fields rather than reading a fixed layout. Headers are
// auto-detected and then shown for confirmation — never applied silently.

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
  // Score by the MOST COMMON field count, not the first line's: real exports
  // often carry "# generated by ..." comment rows above the header, and
  // anchoring on line 1 would let those decide the delimiter for the file.
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

// Excel silently rewrites a handful of gene symbols as dates on open/save.
// SEPT/MARCH/DEC are the well-known families; anything else date-shaped gets
// flagged but not auto-corrected, since we can't guess the original safely.
const MONTH_TO_FAMILY = {sep:"SEPT", mar:"MARCH", dec:"DEC"};
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

function repairGeneSymbol(name) {
  const s=(name||"").trim();
  let m=s.match(new RegExp("^(\\d{1,2})-("+MONTHS+")$","i"));
  if (!m) { const m2=s.match(new RegExp("^("+MONTHS+")-(\\d{1,2})$","i")); if (m2) m=[m2[0],m2[2],m2[1]]; }
  if (m) {
    const fam=MONTH_TO_FAMILY[m[2].toLowerCase()];
    return fam ? {kind:"date", suggested:fam+m[1]} : {kind:"date", suggested:null};
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return {kind:"date", suggested:null};
  if (/^\d+(\.\d+)?E\+\d+$/i.test(s)) return {kind:"sci", suggested:null};
  return null;
}

function scanGeneNames(names) {
  const dates=[], sci=[], dupes=[], seen={};
  names.forEach((n,i)=>{
    const r=repairGeneSymbol(n);
    if (r && r.kind==="date") dates.push({i, name:n, suggested:r.suggested});
    if (r && r.kind==="sci")  sci.push({i, name:n});
    const k=(n||"").trim().toUpperCase();
    if (k) { if (seen[k]) dupes.push(n); else seen[k]=true; }
  });
  return {dates, sci, dupes:[...new Set(dupes)]};
}

// Local numeric parser. Handles thousands separators, and returns null rather
// than 0 for unparseable input so a bad cell can't masquerade as a real value.
const parseImportNumber = parseLocaleNumber;   /* shared/importUtils: NA, EU decimal comma incl. 1,1e-27 */

// Header patterns for the field each tool needs. Ordered: first match wins.
const FIELD_PATTERNS = {
  gene:     [/^gene[_ ]?(name|symbol|id)?$/i, /^symbol$/i, /^feature[_ ]?id$/i, /^id$/i, /^name$/i, /gene/i],
  log2fc:   [/^log2[_ ]?fold[_ ]?change$/i, /^log2fc$/i, /^logfc$/i, /^lfc$/i, /log2.*fold/i, /fold[_ ]?change/i],
  pval:     [/^p[_ ]?value$/i, /^pval$/i, /^p$/i, /^pvalue$/i, /^pr\(>\|?t\|?\)$/i, /^p\.value$/i],
  padj:     [/^p[_ ]?adj$/i, /^padj$/i, /^adj\.?[_ ]?p[_ ]?val/i, /^fdr$/i, /^q[_ ]?value$/i, /^qval$/i],
  baseMean: [/^base[_ ]?mean$/i, /^mean[_ ]?expr/i, /^ave[_ ]?expr$/i, /^avg[_ ]?expr/i, /^aveexpr$/i, /^logcpm$/i],
};

function autoDetectFields(header, wanted) {
  const map={};
  const used={};
  wanted.forEach(field=>{
    const pats=FIELD_PATTERNS[field]||[];
    let found=-1;
    for (let pi=0; pi<pats.length && found<0; pi++) {
      for (let ci=0; ci<header.length; ci++) {
        if (used[ci]) continue;
        if (pats[pi].test((header[ci]||"").trim())) { found=ci; break; }
      }
    }
    if (found>=0) { map[field]=found; used[found]=true; }
    else map[field]=-1;
  });
  // DESeq2's write.csv(results(dds)) writes gene IDs as unnamed rownames, so
  // the first header cell is empty and nothing above matches it. If the gene
  // field is still unmapped, fall back to the first unclaimed column.
  if (map.gene !== undefined && map.gene < 0) {
    for (let ci=0; ci<header.length; ci++) {
      if (!used[ci]) { map.gene=ci; used[ci]=true; break; }
    }
  }
  return map;
}

function FileImportRows({fields, onImport, onClose}) {
  // fields: [{key, label, kind:"text"|"num", required, hint}]
  const t=useTheme();
  const [drag,setDrag]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  const [parsed,setParsed]=useState(null);
  const [headerRow,setHeaderRow]=useState(0);
  const [map,setMap]=useState({});
  const [repair,setRepair]=useState(true);
  const [negLog,setNegLog]=useState(false);
  const inputRef=useRef(null);
  const wanted=fields.map(f=>f.key);

  const applyRows=(rows,delim,fileName,extra)=>{
    if (!rows.length) { setError("That file didn't contain any readable rows."); return; }
    setParsed({rows, delim, fileName, ...(extra||{})});
    { const hr=guessHeaderRow(rows); setHeaderRow(hr); setMap(autoDetectFields(rows[hr]||[], wanted)); }
    setError(null);
  };

  const readFile = async file => {
    setError(null); setBusy(true);
    try {
      if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
        let XLSX;
        try { XLSX = await loadXLSX(); }
        catch(_) {
          setError(XLSX_FAIL_MSG);
          setBusy(false); return;
        }
        const buf=await file.arrayBuffer();
        const wb=XLSX.read(buf,{type:"array"});
        const first=wb.SheetNames[0];
        const rows=XLSX.utils.sheet_to_json(wb.Sheets[first],{header:1,blankrows:false,raw:true})
                    .map(r=>r.map(c=>c===undefined||c===null?"":String(c)));
        applyRows(rows,"\t",file.name,{sheetNames:wb.SheetNames, activeSheet:first, workbook:wb, XLSX});
      } else {
        const text=await file.text();
        const {rows,delim}=parseDelimitedText(text);
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
    { const hr=guessHeaderRow(rows); setHeaderRow(hr); setMap(autoDetectFields(rows[hr]||[], wanted)); }
  };

  const built = useMemo(()=>{
    if (!parsed) return null;
    const out=[]; let bad=0, dropped=0;
    for (let r=headerRow+1;r<parsed.rows.length;r++) {
      const row=parsed.rows[r];
      if (!row || row.every(c=>String(c).trim()==="")) continue;
      const rec={}; let usable=true;
      fields.forEach(f=>{
        const ci=map[f.key];
        const raw = ci>=0 && row[ci]!==undefined ? String(row[ci]).trim() : "";
        if (f.kind==="num") {
          if (raw==="" || raw.toUpperCase()==="NA" || raw.toUpperCase()==="NAN" || raw==="-") { rec[f.key]=""; if(f.required) usable=false; return; }
          const num=parseImportNumber(raw, parsed.delim);
          if (num===null) { bad++; rec[f.key]=""; if(f.required) usable=false; return; }
          rec[f.key]=num;
        } else {
          rec[f.key]=raw;
          if (f.required && raw==="") usable=false;
        }
      });
      if (!usable) { dropped++; continue; }
      out.push(rec);
    }
    if (negLog && map.pval>=0) {
      out.forEach(r=>{ if(typeof r.pval==="number") r.pval=Math.pow(10,-r.pval); });
    }
    return {rows:out, bad, dropped, scan:scanGeneNames(out.map(r=>r.gene||""))};
  },[parsed, headerRow, map, negLog, fields]);

  const doImport = () => {
    if (!built) return;
    let rows=built.rows.map(r=>({...r}));
    if (repair) built.scan.dates.forEach(d=>{ if(d.suggested) rows[d.i].gene=d.suggested; });
    const warnings=[];
    if (built.dropped>0) warnings.push(built.dropped+" row(s) skipped for missing required values (blank, NA, or non-numeric).");
    if (built.bad>0) warnings.push(built.bad+" non-numeric value(s) encountered.");
    const unrepaired=built.scan.dates.filter(d=>!d.suggested||!repair).length;
    if (unrepaired>0) warnings.push(unrepaired+" gene name(s) still look like dates — check them against your source file.");
    if (built.scan.sci.length>0) warnings.push(built.scan.sci.length+" gene ID(s) look like Excel turned them into scientific notation. These can't be recovered automatically.");
    if (built.scan.dupes.length>0) warnings.push(built.scan.dupes.length+" duplicate gene name(s), e.g. "+built.scan.dupes.slice(0,3).join(", ")+".");
    onImport(rows, warnings);
  };

  const boxBase={border:"1px solid "+t.border, borderRadius:8, background:t.panel2};

  if (!parsed) {
    return (
      <div style={{...boxBase, padding:14, marginBottom:10}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
          <span style={{fontSize:12, fontWeight:700, color:t.text}}>Import from file</span>
          <button onClick={onClose} style={{background:"transparent", border:"none", cursor:"pointer", fontSize:15, color:t.muted}}>×</button>
        </div>
        <div
          onDragOver={e=>{e.preventDefault();setDrag(true);}}
          onDragLeave={()=>setDrag(false)}
          onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)readFile(f);}}
          onClick={()=>inputRef.current&&inputRef.current.click()}
          style={{border:"2px dashed "+(drag?t.accent:t.cBorder), borderRadius:8, padding:"26px 16px", textAlign:"center", cursor:"pointer", background:drag?t.cSel:t.cBg}}>
          <div style={{fontSize:12, fontWeight:600, color:t.text, marginBottom:3}}>{busy?"Reading…":"Drop a results table here, or click to browse"}</div>
          <div style={{fontSize:10.5, color:t.muted}}>DESeq2, edgeR or limma output · CSV, TSV, TXT · Excel .xlsx</div>
        </div>
        <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,.tab,.xlsx,.xlsm,.xls" style={{display:"none"}}
          onChange={e=>{const f=e.target.files[0];if(f)readFile(f);e.target.value="";}}/>
        {error&&<div style={{marginTop:9, fontSize:11, lineHeight:1.6, padding:"8px 10px", borderRadius:6, background:"#FEE2E2", color:"#991B1B", border:"1px solid #FCA5A5"}}>{error}</div>}
      </div>
    );
  }

  const header=parsed.rows[headerRow]||[];
  const previewRows=parsed.rows.slice(0,6);
  const previewCols=Math.min(Math.max(...previewRows.map(r=>r.length)), 8);
  const missingRequired=fields.filter(f=>f.required && (map[f.key]===undefined || map[f.key]<0));
  const importable=built.rows.length>0 && missingRequired.length===0;
  const repairable=built.scan.dates.filter(d=>d.suggested);

  return (
    <div style={{...boxBase, padding:14, marginBottom:10}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
        <span style={{fontSize:12, fontWeight:700, color:t.text}}>{parsed.fileName}</span>
        <button onClick={onClose} style={{background:"transparent", border:"none", cursor:"pointer", fontSize:15, color:t.muted}}>×</button>
      </div>

      <div style={{fontSize:10.5, color:t.muted, marginBottom:9}}>
        {parsed.rows.length} rows · delimiter {parsed.delim==="\t"?"tab":parsed.delim===","?"comma":parsed.delim===";"?"semicolon":parsed.delim} · will import <strong style={{color:t.text}}>{built.rows.length} genes</strong>
      </div>

      {parsed.sheetNames&&parsed.sheetNames.length>1&&(
        <div style={{marginBottom:9, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap"}}>
          <span style={{fontSize:10.5, color:t.muted}}>Worksheet:</span>
          {parsed.sheetNames.map(n=>(
            <button key={n} onClick={()=>switchSheet(n)}
              style={{padding:"3px 9px", borderRadius:5, fontSize:10.5, cursor:"pointer", border:"1px solid "+(n===parsed.activeSheet?t.accent:t.border), background:n===parsed.activeSheet?t.accent:"transparent", color:n===parsed.activeSheet?"#fff":t.muted}}>{n}</button>
          ))}
        </div>
      )}

      <div style={{border:"1px solid "+t.cBorder, borderRadius:6, overflow:"auto", maxHeight:140, marginBottom:10, background:t.cBg}}>
        <table style={{borderCollapse:"collapse", fontSize:10.5, width:"max-content", minWidth:"100%"}}>
          <tbody>
            {previewRows.map((row,ri)=>{
              const isHeader=ri===headerRow;
              return (
                <tr key={ri} style={{background:isHeader?t.cSel:"transparent", opacity:ri<headerRow?0.4:1}}>
                  <td style={{padding:"3px 7px", color:t.muted, borderRight:"1px solid "+t.cBorder, borderBottom:"1px solid "+t.cBorder, whiteSpace:"nowrap"}}>
                    <button onClick={()=>{setHeaderRow(ri);setMap(autoDetectFields(parsed.rows[ri]||[],wanted));}} title="Use this row as the header"
                      style={{background:"transparent", border:"none", cursor:"pointer", color:isHeader?t.accent:t.muted, fontSize:10, fontWeight:isHeader?700:400, padding:0}}>
                      {isHeader?"header ▸":ri+1}
                    </button>
                  </td>
                  {Array.from({length:previewCols}).map((_,ci)=>{
                    const assigned=fields.find(f=>map[f.key]===ci);
                    return (
                      <td key={ci} style={{padding:"3px 8px", borderRight:"1px solid "+t.cBorder, borderBottom:"1px solid "+t.cBorder,
                        whiteSpace:"nowrap", maxWidth:110, overflow:"hidden", textOverflow:"ellipsis",
                        color:assigned?t.accent:t.text, fontWeight:(isHeader||assigned)?600:400,
                        background:assigned&&!isHeader?t.tag:"transparent"}}>
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

      <div style={{marginBottom:10}}>
        <div style={{fontSize:11, fontWeight:700, color:t.text, marginBottom:6}}>Map columns</div>
        {fields.map(f=>(
          <div key={f.key} style={{display:"flex", alignItems:"center", gap:8, marginBottom:5}}>
            <span style={{fontSize:11, color:t.muted, width:86, flexShrink:0}}>
              {f.label}{f.required&&<span style={{color:"#DC2626"}}> *</span>}
            </span>
            <select value={map[f.key]!==undefined?map[f.key]:-1} onChange={e=>setMap(mm=>({...mm,[f.key]:Number(e.target.value)}))}
              style={{flex:1, minWidth:0, padding:"4px 7px", fontSize:11, borderRadius:5, border:"1px solid "+((f.required&&(map[f.key]===undefined||map[f.key]<0))?"#DC2626":t.border), background:t.cBg, color:t.text, outline:"none"}}>
              <option value={-1}>— not mapped —</option>
              {header.map((h,ci)=><option key={ci} value={ci}>{(h||"(column "+(ci+1)+")")}</option>)}
            </select>
          </div>
        ))}
        {missingRequired.length>0&&(
          <div style={{fontSize:10.5, color:"#DC2626", marginTop:4}}>
            Pick a column for: {missingRequired.map(f=>f.label).join(", ")}
          </div>
        )}
      </div>

      <label style={{display:"flex", alignItems:"center", gap:6, marginBottom:10, cursor:"pointer", fontSize:11, color:t.muted}}>
        <input type="checkbox" checked={negLog} onChange={e=>setNegLog(e.target.checked)}/>
        <span>The p-value column holds −log₁₀(p), not raw p — convert on import</span>
      </label>

      {built.scan.dates.length>0&&(
        <div style={{fontSize:11, lineHeight:1.6, padding:"9px 11px", borderRadius:6, marginBottom:9, background:"#FEF3C7", color:"#92400E", border:"1px solid #FDE68A"}}>
          <strong>{built.scan.dates.length} gene name{built.scan.dates.length!==1?"s":""} look{built.scan.dates.length===1?"s":""} like Excel converted {built.scan.dates.length===1?"it":"them"} to a date.</strong>
          {repairable.length>0&&(
            <>
              <div style={{marginTop:4}}>
                {repairable.slice(0,4).map(d=>d.name+" → "+d.suggested).join(", ")}{repairable.length>4?", …":""}
              </div>
              <label style={{display:"flex", alignItems:"center", gap:6, marginTop:6, cursor:"pointer"}}>
                <input type="checkbox" checked={repair} onChange={e=>setRepair(e.target.checked)}/>
                <span>Restore {repairable.length} symbol{repairable.length!==1?"s":""} on import</span>
              </label>
              <div style={{marginTop:4, fontSize:10, opacity:0.85}}>
                Ambiguous cases (1-Mar could be MARCH1 or MARC1) default to the larger family — verify against your source.
              </div>
            </>
          )}
        </div>
      )}

      {built.scan.sci.length>0&&(
        <div style={{fontSize:11, lineHeight:1.6, padding:"9px 11px", borderRadius:6, marginBottom:9, background:"#FEE2E2", color:"#991B1B", border:"1px solid #FCA5A5"}}>
          {built.scan.sci.length} gene ID{built.scan.sci.length!==1?"s":""} (e.g. {built.scan.sci[0].name}) look like Excel read an Ensembl-style ID as a number. The original characters are gone — re-export from your source without opening in Excel.
        </div>
      )}

      {built.dropped>0&&(
        <div style={{fontSize:11, padding:"8px 10px", borderRadius:6, marginBottom:9, background:t.tag, color:t.tagText, border:"1px solid "+t.cBorder}}>
          {built.dropped} row{built.dropped!==1?"s":""} will be skipped — blank, NA, or non-numeric in a required column. That's normal for DESeq2 output, where independent filtering leaves NA p-values.
        </div>
      )}

      <div style={{display:"flex", gap:6}}>
        <button onClick={doImport} disabled={!importable}
          style={{flex:1, padding:"8px 0", borderRadius:7, fontSize:12, fontWeight:700, cursor:importable?"pointer":"default", background:importable?t.accent:t.border, border:"none", color:"#fff"}}>
          {importable ? "Import "+built.rows.length+" genes" : "Map required columns first"}
        </button>
        <button onClick={()=>{setParsed(null);setError(null);}}
          style={{padding:"8px 16px", borderRadius:7, fontSize:12, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>
          Choose another file
        </button>
      </div>
    </div>
  );
}

// Max grid rows given DOM nodes at once. The full table stays in state;
// this only limits live inputs so a 20k-row import doesn't lock the tab.
const GRID_ROW_CAP = 300;

// Home position for a gene label. It sits to the right of its dot, but flips to
// the left when the text would otherwise run past the plot edge — previously
// labels were allowed 30px of overshoot, which pushed long names (novel_circ_*)
// straight over the legend. x is always the LEFT edge of the text.
function niceTicks(lo, hi, target) {
  if (!(hi > lo)) return {ticks:[lo], dec:1};
  const raw = (hi - lo) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const ticks = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(10));
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (Math.abs(step / mag - 2.5) < 1e-9 ? 1 : 0));
  return {ticks: ticks.map(v => Math.abs(v) < 1e-12 ? 0 : v), dec};
}

function labelHome(cx, cy, wEst, r, leftBound, rightBound) {
  let x = (cx + r + 3 + wEst <= rightBound) ? cx + r + 3 : cx - r - 3 - wEst;
  x = Math.max(leftBound, Math.min(rightBound - wEst, x));
  return {x, y: cy + 4};
}

// Tight content box for export. The plot canvas reserves room for the legend
// and for threshold labels, so the nominal viewBox is always wider and taller
// than the ink. Exporting that verbatim bakes the empty margin into the file,
// which then shows up as dead space when the panel is placed in a figure.
function tightViewBox(svgEl, fallbackW, fallbackH, pad) {
  const full = {x:0, y:0, w:fallbackW, h:fallbackH};
  if (!svgEl || typeof svgEl.getBBox !== "function") return full;
  try {
    const bb = svgEl.getBBox();
    if (!bb || !(bb.width > 1) || !(bb.height > 1)) return full;
    return {x: bb.x-pad, y: bb.y-pad, w: bb.width+pad*2, h: bb.height+pad*2};
  } catch (_) { return full; }
}

// ─── Scatter rendering at scale ─────────────────────────────────────────────
// A transcriptome-wide MA plot is ~20k points. One <circle> each means 20k DOM
// nodes plus 20k event handlers, which is what makes the tab crawl. Instead the
// ordinary dots are merged into a handful of <path> elements — still real
// vector geometry, so SVG/PDF export is unchanged and stays publication-grade.
// Decorated dots (labelled, gene-set, hovered) keep their own <circle> so they
// remain individually styleable.
//
// Points are emitted in chunks rather than one giant path because subpaths
// inside a single path fill as a union: overlapping dots in the same path
// would stop darkening each other, flattening the density cloud. Chunking
// keeps most overlaps across separate elements, preserving that cue.
const DOT_CHUNK = 250;

function dotsToPath(pts, rad) {
  const R = rad.toFixed(2), D = (rad * 2).toFixed(2), ND = (-rad * 2).toFixed(2);
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const cx = pts[i].cx, cy = pts[i].cy;
    if (!isFinite(cx) || !isFinite(cy)) continue;
    d += "M" + (cx - rad).toFixed(2) + "," + cy.toFixed(2) +
         "a" + R + "," + R + " 0 1,0 " + D + ",0" +
         "a" + R + "," + R + " 0 1,0 " + ND + ",0";
  }
  return d;
}

// Uniform-grid index so hover/click can find the nearest dot by arithmetic
// instead of relying on per-element DOM hit testing.
function buildHitIndex(items, cell) {
  const buckets = new Map();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!isFinite(it.cx) || !isFinite(it.cy)) continue;
    const k = Math.floor(it.cx / cell) + "," + Math.floor(it.cy / cell);
    let b = buckets.get(k);
    if (!b) { b = []; buckets.set(k, b); }
    b.push(it);
  }
  return {cell, buckets};
}

function queryHitIndex(index, px, py, maxDist) {
  const {cell, buckets} = index;
  const gi = Math.floor(px / cell), gj = Math.floor(py / cell);
  let best = null, bestD = maxDist * maxDist;
  for (let i = gi - 1; i <= gi + 1; i++) {
    for (let j = gj - 1; j <= gj + 1; j++) {
      const b = buckets.get(i + "," + j);
      if (!b) continue;
      for (let k = 0; k < b.length; k++) {
        const dx = b[k].cx - px, dy = b[k].cy - py, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = b[k]; }
      }
    }
  }
  return best;
}

function DataSheet({rows, setRows, undo, redo, canUndo, canRedo}) {
  const t=useTheme();
  const [focus,      setFocus]     = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [rowLimit,   setRowLimit]   = useState(GRID_ROW_CAP);
  const [importMsg,  setImportMsg]  = useState(null);
  const [confirmClr, setConfirmClr]= useState(false);
  const [colLabels,  setColLabels] = useState(()=>Object.fromEntries(COLS.map(c=>[c.key,c.label])));
  const [editingHdr, setEditingHdr]= useState(null);
  const [hdrDraft,   setHdrDraft]  = useState("");
  const cellRefs = useRef({});
  const hdrRefs  = useRef({});

  const displayRows = useMemo(()=>{ const r=[...rows].slice(0,rowLimit); while(r.length<22) r.push(blankRow()); return r; },[rows,rowLimit]);

  const updateCell = useCallback((ri,key,val)=>{
    setRows(prev=>{ const next=[...prev]; while(next.length<=ri) next.push(blankRow()); next[ri]={...next[ri],[key]:val}; return next; });
  },[setRows]);

  const handlePaste = useCallback((e,ri,ci)=>{
    const text=e.clipboardData.getData("text");
    if(!text.includes("\t")&&!text.includes("\n")) return;
    e.preventDefault();
    const patches=parsePastedText(text,ri,ci);
    setRows(prev=>{ const next=[...prev]; patches.forEach(({row,patch})=>{ while(next.length<=row) next.push(blankRow()); next[row]={...next[row],...patch}; }); return next; });
    setTimeout(()=>cellRefs.current[patches[patches.length-1].row+"-"+ci]?.focus(),20);
  },[setRows]);

  const handleKeyNav = useCallback((e,ri,ci)=>{
    if((e.ctrlKey||e.metaKey)&&(e.key==="z"||e.key==="y")) return;
    const move=(dr,dc)=>{ e.preventDefault(); const nr=Math.max(0,ri+dr), nc=Math.max(0,Math.min(COLS.length-1,ci+dc)); setFocus({r:nr,c:nc}); setTimeout(()=>cellRefs.current[nr+"-"+nc]?.focus(),0); };
    if(e.key==="ArrowUp") move(-1,0);
    if(e.key==="ArrowDown"||e.key==="Enter") move(1,0);
    if(e.key==="ArrowLeft"&&e.target.selectionStart===0) move(0,-1);
    if(e.key==="ArrowRight"&&e.target.selectionStart===e.target.value.length) move(0,1);
    if(e.key==="Tab"){ e.preventDefault(); move(0,e.shiftKey?-1:1); }
  },[]);

  const removeRow = idx => setRows(prev=>prev.filter((_,i)=>i!==idx));

  const startHdrEdit  = (key,current)=>{ setEditingHdr(key); setHdrDraft(current); setTimeout(()=>hdrRefs.current[key]?.select(),0); };
  const commitHdrEdit = key=>{ if(hdrDraft.trim()) setColLabels(p=>({...p,[key]:hdrDraft.trim()})); setEditingHdr(null); };
  const hasCustomHdrs = COLS.some(c=>colLabels[c.key]!==c.label);
  const filledCount   = rows.filter(r=>Object.values(r).some(v=>v!==""&&v!=null)).length;

  return (
    <div>
      <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:10, flexWrap:"wrap"}}>
        <button onClick={()=>setRows(EXAMPLE_DATA)}
          style={{padding:"5px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:t.accent, border:"none", color:"#fff"}}>
          Load example data
        </button>
        <button onClick={()=>setShowImport(s=>!s)}
          style={{padding:"5px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:showImport?t.accent:"transparent", border:"1px solid "+(showImport?t.accent:t.border), color:showImport?"#fff":t.text}}>
          Import file
        </button>
        <button onClick={undo} disabled={!canUndo}
          style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+t.border, cursor:canUndo?"pointer":"default", color:canUndo?t.text:t.muted}}>
          Undo
        </button>
        <button onClick={redo} disabled={!canRedo}
          style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+t.border, cursor:canRedo?"pointer":"default", color:canRedo?t.text:t.muted}}>
          Redo
        </button>
        {hasCustomHdrs&&(
          <button onClick={()=>setColLabels(Object.fromEntries(COLS.map(c=>[c.key,c.label])))}
            style={{padding:"4px 10px", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>
            Reset headers
          </button>
        )}
        {!confirmClr
          ?<button onClick={()=>setConfirmClr(true)}
              style={{padding:"4px 10px", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>
              Clear
            </button>
          :<span style={{display:"flex", gap:4, alignItems:"center"}}>
              <span style={{fontSize:11, color:t.muted}}>Clear all data?</span>
              <button onClick={()=>{setRows([]);setConfirmClr(false);}}
                style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"#DC2626", border:"none", color:"#fff", fontWeight:600}}>Yes</button>
              <button onClick={()=>setConfirmClr(false)}
                style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>Cancel</button>
            </span>
        }
        <span style={{marginLeft:"auto", fontSize:11, color:t.muted, fontWeight:500}}>{filledCount} gene rows</span>
      </div>

      {showImport && (
        <FileImportRows
          fields={[{key:"gene",label:"Gene",kind:"text",required:true},{key:"baseMean",label:"Mean Expr",kind:"num",required:true},{key:"log2fc",label:"Log2FC",kind:"num",required:true},{key:"pval",label:"p-value",kind:"num",required:true}]}
          onClose={()=>setShowImport(false)}
          onImport={(newRows, warnings)=>{
            setRows(newRows);                 // single history entry: file import is one undo step
            setRowLimit(GRID_ROW_CAP);
            setShowImport(false);
            setImportMsg(warnings.length ? warnings : null);
          }}/>
      )}

      {rows.length > rowLimit && (
        <div style={{fontSize:11, marginBottom:8, padding:"7px 10px", background:t.tag, borderRadius:6, color:t.tagText, border:"1px solid "+t.cBorder, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
          <span>Showing the first {rowLimit.toLocaleString()} of {rows.length.toLocaleString()} rows. The full table is loaded and every row is used for the plot.</span>
          <button onClick={()=>setRowLimit(r=>r+GRID_ROW_CAP)}
            style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.cBorder, color:t.tagText}}>
            Show {Math.min(GRID_ROW_CAP, rows.length-rowLimit).toLocaleString()} more
          </button>
          <button onClick={()=>setRowLimit(rows.length)}
            style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.cBorder, color:t.tagText}}>
            Show all (slow)
          </button>
        </div>
      )}

      {importMsg && (
        <div style={{fontSize:11, marginBottom:8, padding:"8px 10px", borderRadius:6, lineHeight:1.6, background:"#FEF3C7", color:"#92400E", border:"1px solid #FDE68A"}}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8}}>
            <div>
              <strong>Imported with warnings</strong>
              <ul style={{margin:"4px 0 0", paddingLeft:16}}>{importMsg.map((mm,i)=><li key={i}>{mm}</li>)}</ul>
            </div>
            <button onClick={()=>setImportMsg(null)} style={{background:"transparent", border:"none", cursor:"pointer", fontSize:14, color:"inherit", flexShrink:0}}>×</button>
          </div>
        </div>
      )}

      <div style={{fontSize:11, marginBottom:8, padding:"6px 10px", background:t.tag, borderRadius:6, color:t.tagText, border:"1px solid "+t.cBorder}}>
        Paste directly from DESeq2 (baseMean, log2FoldChange, pvalue), edgeR, or limma output. Arrow keys and Tab to navigate. Double-click any header to rename it.
      </div>

      <div style={{border:"1px solid "+t.border, borderRadius:8, overflow:"hidden", maxHeight:430, overflowY:"auto"}}>
        <table style={{borderCollapse:"collapse", tableLayout:"fixed", width:"100%"}}>
          <colgroup>
            <col style={{width:32}}/>
            {COLS.map(c=><col key={c.key} style={{width:c.width}}/>)}
          </colgroup>
          <thead>
            <tr style={{background:t.cHdr}}>
              <th style={{borderBottom:"2px solid "+t.border, borderRight:"1px solid "+t.border, fontSize:10, color:t.muted, padding:"6px 4px", textAlign:"center", position:"sticky", top:0, zIndex:2, background:t.cHdr}}>#</th>
              {COLS.map(col=>{
                const isEditing=editingHdr===col.key, isCustom=colLabels[col.key]!==col.label;
                return (
                  <th key={col.key} style={{borderBottom:"2px solid "+(isEditing?t.accent:t.border), borderRight:"1px solid "+t.cBorder, padding:0, position:"sticky", top:0, zIndex:2, background:t.cHdr}}>
                    {isEditing
                      ?<input ref={el=>{hdrRefs.current[col.key]=el;}} value={hdrDraft}
                          onChange={e=>setHdrDraft(e.target.value)}
                          onBlur={()=>commitHdrEdit(col.key)}
                          onKeyDown={e=>{if(e.key==="Enter")commitHdrEdit(col.key);if(e.key==="Escape")setEditingHdr(null);}}
                          style={{width:"100%", boxSizing:"border-box", padding:"6px 8px", fontSize:11, fontWeight:700, background:t.panel, color:t.accent, border:"none", outline:"2px solid "+t.accent, fontFamily:"inherit"}}/>
                      :<div onDoubleClick={()=>startHdrEdit(col.key,colLabels[col.key]||col.label)} title="Double-click to rename"
                            style={{display:"flex", alignItems:"center", gap:3, padding:"6px 8px", cursor:"text", userSelect:"none", whiteSpace:"nowrap"}}>
                          <span style={{fontSize:11, fontWeight:700, color:isCustom?t.accent:t.text}}>{colLabels[col.key]||col.label}</span>
                          {col.type==="num"&&<span style={{fontSize:9, color:t.muted, opacity:.6}}>123</span>}
                          {isCustom&&<span style={{fontSize:9, color:t.accent}}>✎</span>}
                        </div>
                    }
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row,ri)=>{
              const isRealRow = ri<rows.length;
              return (
              <tr key={ri} style={{background:focus&&focus.r===ri?t.cSel:ri%2===0?t.cBg:t.panel}}>
                <td style={{background:t.cHdr, borderRight:"1px solid "+t.border, borderBottom:"1px solid "+t.cBorder, fontSize:10, color:t.muted, textAlign:"center", padding:"0 4px"}}>
                  {isRealRow ? (
                    <button onClick={()=>removeRow(ri)} title="Delete this row"
                      style={{width:18, height:18, borderRadius:4, background:"rgba(220,38,38,0.08)", border:"1px solid rgba(220,38,38,0.35)", color:"#DC2626", cursor:"pointer", fontSize:12, fontWeight:700, padding:0, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto"}}>
                      ×
                    </button>
                  ) : ri+1}
                </td>
                {COLS.map((col,ci)=>{
                  const key=ri+"-"+ci, isFocused=focus&&focus.r===ri&&focus.c===ci;
                  return (
                    <td key={col.key} style={{padding:0, borderBottom:"1px solid "+t.cBorder, borderRight:"1px solid "+t.cBorder}}>
                      <input ref={el=>{cellRefs.current[key]=el;}}
                        value={row[col.key]!==undefined?row[col.key]:""}
                        placeholder={isFocused?col.placeholder:""}
                        inputMode={col.type==="num"?"decimal":"text"}
                        onChange={e=>updateCell(ri,col.key,e.target.value)}
                        onFocus={e=>{setFocus({r:ri,c:ci});e.target.select();}}
                        onBlur={()=>{if(col.type==="num"&&row[col.key]!==""){const n=parseFloat(row[col.key]);if(!isNaN(n))updateCell(ri,col.key,n);}}}
                        onKeyDown={e=>handleKeyNav(e,ri,ci)}
                        onPaste={e=>handlePaste(e,ri,ci)}
                        style={{width:"100%", boxSizing:"border-box", padding:"4px 8px", fontSize:12, background:isFocused?t.panel:"transparent", color:t.text, border:isFocused?"2px solid "+t.cFocus:"2px solid transparent", outline:"none", fontFamily:"monospace"}}/>
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:4, fontSize:10, color:t.muted, textAlign:"center"}}>Auto-expands. Empty rows are ignored when plotting.</div>
    </div>
  );
}

// ─── Right-rail panels ──────────────────────────────────────────────────────────
function SignificancePanel({stats, setStats, geneSet, setGeneSet, geneSetColor, setGeneSetColor, geneSetCount, labeled, setLabeled, sigGenes, totalN}) {
  const t=useTheme();
  const nlpThresh = pToNlp(stats.pThreshold||0.05);

  const downloadSigGenes = () => {
    if (!sigGenes || !sigGenes.length) return;
    const pLabel = stats.useAdjP ? "adj.p" : "p";
    const csv = ["gene,baseMean,log2fc,"+pLabel+",nlp,group"]
      .concat(sigGenes.map(g => [g.gene,g.baseMean,g.log2fc,g.pval,g.nlp,g.group].join(",")))
      .join("\n");
    downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}), "ma_plot_significant_genes_"+new Date().toISOString().slice(0,10)+".csv"); /* blob download: data: URLs fail silently past ~2MB / in Firefox */
  };

  return (
    <div>
      <SectionLabel>Significance Thresholds</SectionLabel>
      <LabeledSlider label="FC threshold" value={stats.fcThreshold} min={0.5} max={3} step={0.1}
        onChange={v=>setStats(s=>({...s,fcThreshold:v}))} display={stats.fcThreshold}/>
      <LabeledSlider label="p-value cutoff" value={stats.pThreshold} min={0.001} max={0.1} step={0.001}
        onChange={v=>setStats(s=>({...s,pThreshold:v}))} display={stats.pThreshold+" ("+nlpThresh.toFixed(2)+" in log)"}/>
      <div style={{display:"flex", gap:5, marginBottom:10}}>
        {[["p-value",false],["adj. p-value",true]].map(([lb,val])=>(
          <Pill key={lb} active={(stats.useAdjP||false)===val} onClick={()=>setStats(s=>({...s,useAdjP:val}))}>{lb}</Pill>
        ))}
      </div>

      {sigGenes&&sigGenes.length>0&&(
        <div style={{marginBottom:10, padding:"9px 11px", borderRadius:8, background:t.cSel, border:"1px solid "+t.accent}}>
          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5}}>
            <div>
              <div style={{fontSize:12, fontWeight:700, color:t.text}}>{sigGenes.length} significant genes</div>
              <div style={{fontSize:10, color:t.muted}}>{"FC > "+stats.fcThreshold+" and p < "+stats.pThreshold}</div>
            </div>
            <button onClick={downloadSigGenes}
              style={{padding:"5px 10px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", background:t.accent, border:"none", color:"#fff", whiteSpace:"nowrap"}}>
              Download CSV
            </button>
          </div>
          <div style={{display:"flex", gap:10, fontSize:10}}>
            <span style={{fontWeight:600, color:t.up}}>UP: {sigGenes.filter(g=>g.group==="UP").length}</span>
            <span style={{fontWeight:600, color:t.down}}>DOWN: {sigGenes.filter(g=>g.group==="DOWN").length}</span>
          </div>
        </div>
      )}

      <Divider/>
      <SectionLabel>Color Mode</SectionLabel>
      <div style={{display:"flex", flexDirection:"column", gap:4, marginBottom:10}}>
        {[["3group","3 Groups","UP / DOWN / NS"],["4group","4 Groups","+ FC-only (sig FC, NS p)"],["gradient","Gradient","Color by |log2FC| magnitude"]].map(([val,lb,desc])=>(
          <button key={val} onClick={()=>setStats(s=>({...s,colorMode:val}))}
            style={{display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:8, cursor:"pointer", textAlign:"left",
              background:(stats.colorMode||"3group")===val?t.cSel:"transparent",
              border:"1.5px solid "+((stats.colorMode||"3group")===val?t.accent:t.border)}}>
            <div style={{width:12, height:12, borderRadius:"50%", flexShrink:0,
              border:"2px solid "+((stats.colorMode||"3group")===val?t.accent:t.border),
              background:(stats.colorMode||"3group")===val?t.accent:"transparent"}}/>
            <div>
              <div style={{fontSize:11, fontWeight:600, color:(stats.colorMode||"3group")===val?t.text:t.muted}}>{lb}</div>
              <div style={{fontSize:9, color:t.muted}}>{desc}</div>
            </div>
          </button>
        ))}
      </div>
      {(stats.colorMode||"3group")==="4group"&&(
        <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:10, padding:"6px 9px", background:t.panel2, borderRadius:6, border:"1px solid "+t.border}}>
          <ColorSwatch color={stats.fcOnlyColor||"#D97706"} size={18} onChange={v=>setStats(s=>({...s,fcOnlyColor:v}))}/>
          <span style={{fontSize:11, color:t.muted}}>FC-only group color</span>
        </div>
      )}

      <Divider/>
      <SectionLabel>Dot Appearance</SectionLabel>
      <LabeledSlider label="Dot radius" value={stats.dotRadius} min={1} max={10} step={0.5}
        onChange={v=>setStats(s=>({...s,dotRadius:v}))} display={stats.dotRadius+"px"}/>
      {totalN>500&&(
        <div style={{fontSize:10, color:t.muted, lineHeight:1.5, marginTop:-4, marginBottom:10}}>
          {totalN.toLocaleString()} genes loaded — non-highlighted points are automatically drawn smaller and more transparent to keep dense regions legible at 300 dpi. Labeled and gene-set points always render at full size and opacity.
        </div>
      )}

      <Divider/>
      <SectionLabel>Auto-label Top Genes</SectionLabel>
      <div style={{padding:"10px", borderRadius:8, background:t.panel2, border:"1px solid "+t.border, marginBottom:10}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
          <span style={{fontSize:11, color:t.text, fontWeight:600}}>Top N genes to label</span>
          <span style={{fontSize:13, fontWeight:700, color:stats.topN===0?t.muted:t.accent}}>{stats.topN===0?"OFF":stats.topN}</span>
        </div>
        <input type="range" min={0} max={30} step={1} value={stats.topN}
          onChange={e=>setStats(s=>({...s,topN:+e.target.value}))} style={{width:"100%", accentColor:t.accent, marginBottom:8}}/>
        {stats.topN>0&&(
          <div>
            <div style={{fontSize:10, color:t.muted, marginBottom:5}}>Rank by</div>
            <div style={{display:"flex", gap:4}}>
              {[["pval","p-value"],["fc","|FC|"],["both","Combined"]].map(([v,lb])=>(
                <Pill key={v} active={stats.topNBy===v} onClick={()=>setStats(s=>({...s,topNBy:v}))}>{lb}</Pill>
              ))}
            </div>
          </div>
        )}
      </div>

      <SectionLabel>Label Style</SectionLabel>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:6}}>
        <ColorSwatch color={stats.labelColor||"#1E2736"} size={26} onChange={v=>setStats(s=>({...s,labelColor:v}))}/>
        <span style={{fontSize:11, color:t.muted}}>Label color</span>
        <div style={{display:"flex", gap:3, marginLeft:"auto"}}>
          {["#1E2736","#DC2626","#2563EB","#16A34A","#7C3AED","#EA580C"].map(col=>(
            <button key={col} onClick={()=>setStats(s=>({...s,labelColor:col}))}
              style={{width:16, height:16, borderRadius:3, background:col, border:(stats.labelColor||"#1E2736")===col?"2px solid "+t.text:"1px solid "+t.border, cursor:"pointer", padding:0}}/>
          ))}
        </div>
      </div>
      <Toggle value={stats.repelLabels!==false} onChange={v=>setStats(s=>({...s,repelLabels:v}))} label="Repel overlapping labels (ggrepel)"/>

      {labeled&&labeled.size>0&&(
        <div style={{padding:"8px 10px", borderRadius:7, background:t.panel2, border:"1px solid "+t.border, marginBottom:10}}>
          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
            <span style={{fontSize:11, color:t.text, fontWeight:600}}>{labeled.size} gene{labeled.size!==1?"s":""} labeled manually</span>
            <button onClick={()=>setLabeled&&setLabeled(new Set())}
              style={{fontSize:10, color:t.muted, background:"transparent", border:"1px solid "+t.border, cursor:"pointer", padding:"2px 7px", borderRadius:4}}>
              Clear all
            </button>
          </div>
        </div>
      )}

      <Divider/>
      <SectionLabel>Gene Set Highlight</SectionLabel>
      <div style={{padding:"10px", borderRadius:8, background:t.panel2, border:"1px solid "+t.border, marginBottom:10}}>
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6}}>
          <span style={{fontSize:11, fontWeight:600, color:t.text}}>Paste gene list to highlight</span>
          {geneSetCount>0&&<span style={{fontSize:10, fontWeight:600, color:t.accent, padding:"1px 7px", borderRadius:10, background:t.cSel}}>{geneSetCount} genes</span>}
        </div>
        <textarea value={geneSet} onChange={e=>setGeneSet(e.target.value)} rows={4}
          placeholder={"EGFR\nTP53\nMYC\n(one per line, or comma-separated)"}
          style={{width:"100%", boxSizing:"border-box", padding:"6px 8px", fontSize:11, borderRadius:6,
            border:"1px solid "+(geneSet.trim()?t.accent:t.border), background:t.cBg, color:t.text, outline:"none", fontFamily:"monospace", resize:"vertical"}}/>
        <div style={{display:"flex", alignItems:"center", gap:7, marginTop:7}}>
          <ColorSwatch color={geneSetColor} size={20} onChange={setGeneSetColor}/>
          <span style={{fontSize:11, color:t.muted}}>Ring color</span>
          <div style={{display:"flex", gap:3, marginLeft:"auto"}}>
            {["#7C3AED","#EA580C","#0891B2","#16A34A","#DB2777"].map(col=>(
              <button key={col} onClick={()=>setGeneSetColor(col)}
                style={{width:14, height:14, borderRadius:3, background:col, border:geneSetColor===col?"2px solid "+t.text:"1px solid "+t.border, cursor:"pointer", padding:0}}/>
            ))}
          </div>
          {geneSet.trim()&&<button onClick={()=>setGeneSet("")} style={{fontSize:10, color:t.muted, background:"transparent", border:"none", cursor:"pointer"}}>clear</button>}
        </div>
      </div>
    </div>
  );
}

function StylePanel({display, setDisplay}) {
  const t=useTheme();
  const xPresets=["Mean of Normalized Counts (log\u2081\u2080)","log\u2081\u2080 Mean Expression","A (average log expression)"];
  const yPresets=["log\u2082 Fold Change","M (log2 ratio)","log\u2082 Fold Change (shrunken)"];
  return (
    <div>
      <SectionLabel>Figure Title</SectionLabel>
      <input value={display.plotTitle||""} onChange={e=>setDisplay(s=>({...s,plotTitle:e.target.value}))} placeholder="e.g. Treatment vs Control (DESeq2)"
        style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:12, borderRadius:6, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none", marginBottom:10}}/>

      <Divider/>
      <SectionLabel>X Axis Label</SectionLabel>
      <input value={display.xLbl||""} onChange={e=>setDisplay(s=>({...s,xLbl:e.target.value}))}
        style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:11, borderRadius:6, border:"1px solid "+t.accent, background:t.cBg, color:t.text, outline:"none", marginBottom:5}}/>
      <div style={{display:"flex", gap:3, flexWrap:"wrap", marginBottom:10}}>
        {xPresets.map(p=><button key={p} onClick={()=>setDisplay(s=>({...s,xLbl:p}))}
          style={{padding:"2px 7px", borderRadius:10, fontSize:10, cursor:"pointer", background:(display.xLbl||"")==p?t.accent:"transparent", border:"1px solid "+((display.xLbl||"")==p?t.accent:t.border), color:(display.xLbl||"")==p?"#fff":t.muted}}>{p}</button>)}
      </div>

      <SectionLabel>Y Axis Label</SectionLabel>
      <input value={display.yLbl||""} onChange={e=>setDisplay(s=>({...s,yLbl:e.target.value}))}
        style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:11, borderRadius:6, border:"1px solid "+t.accent, background:t.cBg, color:t.text, outline:"none", marginBottom:5}}/>
      <div style={{display:"flex", gap:3, flexWrap:"wrap", marginBottom:10}}>
        {yPresets.map(p=><button key={p} onClick={()=>setDisplay(s=>({...s,yLbl:p}))}
          style={{padding:"2px 7px", borderRadius:10, fontSize:10, cursor:"pointer", background:(display.yLbl||"")==p?t.accent:"transparent", border:"1px solid "+((display.yLbl||"")==p?t.accent:t.border), color:(display.yLbl||"")==p?"#fff":t.muted}}>{p}</button>)}
      </div>

      <Divider/>
      <SectionLabel>Series Colors</SectionLabel>
      {[["Upregulated","colorUp"],["Downregulated","colorDown"],["Not significant","colorNs"]].map(([lb,key])=>(
        <div key={key} style={{display:"flex", alignItems:"center", gap:8, marginBottom:8}}>
          <ColorSwatch color={display[key]} onChange={v=>setDisplay(s=>({...s,[key]:v}))}/>
          <span style={{fontSize:11, color:t.muted, flex:1}}>{lb}</span>
        </div>
      ))}
      <div style={{display:"flex", gap:5, marginBottom:10}}>
        {[["Nature","#DC2626","#1D4ED8"],["Cell","#B91C1C","#1E40AF"],["Colorblind","#D55E00","#0072B2"]].map(([name,up,down])=>(
          <button key={name} onClick={()=>setDisplay(s=>({...s,colorUp:up,colorDown:down}))}
            style={{flex:1, padding:"5px 0", borderRadius:7, fontSize:10, cursor:"pointer", background:t.panel2, border:"1px solid "+t.border, color:t.muted}}>
            <div style={{display:"flex", gap:3, justifyContent:"center", marginBottom:3}}>
              <div style={{width:8, height:8, borderRadius:2, background:up}}/>
              <div style={{width:8, height:8, borderRadius:2, background:down}}/>
            </div>
            {name}
          </button>
        ))}
      </div>

      <Divider/>
      <SectionLabel>Grid and Background</SectionLabel>
      <Toggle value={display.showGrid!==false} onChange={v=>setDisplay(s=>({...s,showGrid:v}))} label="Show grid lines"/>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:10}}>
        <span style={{fontSize:11, color:t.muted, flex:1}}>Plot background</span>
        <ColorSwatch color={display.plotBg||"#FFFFFF"} onChange={v=>setDisplay(s=>({...s,plotBg:v}))}/>
        {display.plotBg&&<button onClick={()=>setDisplay(s=>({...s,plotBg:""}))} style={{fontSize:10, color:t.muted, background:"transparent", border:"none", cursor:"pointer"}}>reset</button>}
      </div>

      <Divider/>
      <SectionLabel>Axis Frame</SectionLabel>
      <div style={{display:"flex", gap:5, marginBottom:6}}>
        <Pill active={(display.frameStyle||"open")==="open"} onClick={()=>setDisplay(s=>({...s,frameStyle:"open"}))}>Open</Pill>
        <Pill active={display.frameStyle==="closed"} onClick={()=>setDisplay(s=>({...s,frameStyle:"closed"}))}>Closed</Pill>
        <Pill active={display.frameStyle==="offset"} onClick={()=>setDisplay(s=>({...s,frameStyle:"offset"}))}>Offset</Pill>
      </div>
      <div style={{fontSize:10, color:t.muted, lineHeight:1.5}}>
        Open = classic L-shaped axes. Closed = full box frame. Offset = axis lines detached from the corner, spanning only the tick range (a Tufte-style range frame, common in journal figures).
      </div>

      <Divider/>
      <SectionLabel>Font Family</SectionLabel>
      <select value={display.ff||"Inter"} onChange={e=>setDisplay(s=>({...s,ff:e.target.value}))}
        style={{width:"100%", padding:"6px 9px", fontSize:11, borderRadius:6, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none", marginBottom:10}}>
        {FONTS.map(f=><option key={f} value={f}>{f}</option>)}
      </select>

      <SectionLabel>Font Sizes</SectionLabel>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10}}>
        {[["Axis labels","axisSize"],["Tick labels","tickSize"],["Gene labels","labelSize"],["Title","titleSize"]].map(([lb,key])=>(
          <div key={key}>
            <div style={{fontSize:10, color:t.muted, marginBottom:3}}>{lb}</div>
            <input type="number" min={7} max={22} value={display[key]} onChange={e=>setDisplay(s=>({...s,[key]:+e.target.value}))}
              style={{width:"100%", padding:"4px 7px", fontSize:11, borderRadius:5, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none"}}/>
          </div>
        ))}
      </div>

      <Divider/>
      <button onClick={()=>setDisplay({...DEFAULT_DISPLAY})}
        style={{width:"100%", padding:"6px 0", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>
        Reset all to defaults
      </button>
    </div>
  );
}

function AxesPanel({display, setDisplay, stats, setStats}) {
  const t=useTheme();
  const RangeInput=({label,statKey})=>{
    const [val,setVal]=useState(String(stats[statKey]));
    useEffect(()=>setVal(String(stats[statKey])),[stats[statKey]]);
    const commit=()=>{
      const trimmed=val.trim().toLowerCase();
      if(trimmed===""||trimmed==="auto"){setStats(p=>({...p,[statKey]:"auto"}));setVal("auto");return;}
      const n=parseFloat(trimmed);
      if(!isNaN(n)){setStats(p=>({...p,[statKey]:n}));setVal(String(n));}
      else setVal(String(stats[statKey]));
    };
    return (
      <div>
        <div style={{fontSize:10, color:t.muted, marginBottom:3}}>{label}</div>
        <input value={val} onChange={e=>setVal(e.target.value)} onBlur={commit}
          onKeyDown={e=>{if(e.key==="Enter")commit();}} placeholder="auto"
          style={{width:"100%", boxSizing:"border-box", padding:"5px 7px", fontSize:11, borderRadius:5,
            border:"1px solid "+(val==="auto"||val===""?t.border:t.accent), background:t.cBg, color:t.text, outline:"none", fontFamily:"monospace"}}/>
      </div>
    );
  };
  return (
    <div>
      <SectionLabel>Axis Range (type "auto" to reset)</SectionLabel>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8}}>
        <RangeInput label="X min" statKey="xMin"/><RangeInput label="X max" statKey="xMax"/>
      </div>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8}}>
        <RangeInput label="Y min" statKey="yMin"/><RangeInput label="Y max" statKey="yMax"/>
      </div>
      <button onClick={()=>setStats(s=>({...s,xMin:"auto",xMax:"auto",yMin:"auto",yMax:"auto"}))}
        style={{width:"100%", padding:"5px 0", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted, marginBottom:10}}>
        Reset all to auto
      </button>

      <Divider/>
      <SectionLabel>Mean Expression Floor</SectionLabel>
      <LabeledSlider label="Epsilon (baseMean floor)" value={stats.meanExprFloor} min={0.1} max={2} step={0.1}
        onChange={v=>setStats(s=>({...s,meanExprFloor:v}))} display={stats.meanExprFloor}/>
      <div style={{fontSize:10, color:t.muted, lineHeight:1.5, marginBottom:10}}>
        X = log\u2081\u2080(max(mean expression, epsilon)). DESeq2's plotMA() uses 0.5 by default — this keeps zero/near-zero counts from producing -Infinity without compressing the low-expression tail the way a +1 offset would.
      </div>

      <Divider/>
      <SectionLabel>Line Thickness</SectionLabel>
      <LabeledSlider label="Axis lines" value={display.axisWidth||1.2} min={0.5} max={5} step={0.1}
        onChange={v=>setDisplay(s=>({...s,axisWidth:v}))} display={(display.axisWidth||1.2)+"px"}/>
      <LabeledSlider label="Grid lines" value={display.gridWidth||0.5} min={0.3} max={3} step={0.1}
        onChange={v=>setDisplay(s=>({...s,gridWidth:v}))} display={(display.gridWidth||0.5)+"px"}/>

      <Divider/>
      <SectionLabel>Trend Line (LOESS)</SectionLabel>
      <Toggle value={stats.showTrend||false} onChange={v=>setStats(s=>({...s,showTrend:v}))} label="Show smoothed trend line"/>
      {stats.showTrend&&(
        <div>
          <LabeledSlider label="Smoothing span" value={stats.trendSpan||0.3} min={0.05} max={0.9} step={0.05}
            onChange={v=>setStats(s=>({...s,trendSpan:v}))} display={stats.trendSpan||0.3}/>
          <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:6}}>
            <ColorSwatch color={stats.trendColor||"#16A34A"} size={20} onChange={v=>setStats(s=>({...s,trendColor:v}))}/>
            <span style={{fontSize:11, color:t.muted}}>Line color</span>
          </div>
          <div style={{fontSize:10, color:t.muted, lineHeight:1.5}}>Lower span follows local noise more closely; higher span gives a smoother overall curve.</div>
        </div>
      )}
    </div>
  );
}

function LegendPanel({legendVisible, setLegendVisible, legendStyle, setLegendStyle, legendPos, setLegendPos, topMargin}) {
  const t=useTheme();
  const isVisible=id=>legendVisible[id]!==false;
  return (
    <div>
      <SectionLabel>Visible Legend Items</SectionLabel>
      <div style={{display:"flex", gap:4, marginBottom:8}}>
        <button onClick={()=>{const m={};LEGEND_ITEMS.forEach(x=>{m[x.id]=true;});setLegendVisible(m);}}
          style={{padding:"3px 10px", borderRadius:5, fontSize:10, cursor:"pointer", background:t.accent, border:"none", color:"#fff"}}>All</button>
        <button onClick={()=>{const m={};LEGEND_ITEMS.forEach(x=>{m[x.id]=false;});setLegendVisible(m);}}
          style={{padding:"3px 10px", borderRadius:5, fontSize:10, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>None</button>
      </div>
      <div style={{display:"flex", flexDirection:"column", gap:3, marginBottom:12}}>
        {LEGEND_ITEMS.map(item=>{
          const on=isVisible(item.id);
          return (
            <button key={item.id} onClick={()=>setLegendVisible(p=>({...p,[item.id]:!p[item.id]}))}
              style={{display:"flex", alignItems:"center", gap:8, padding:"6px 9px", borderRadius:7, cursor:"pointer", textAlign:"left",
                background:on?t.cSel:"transparent", border:"1px solid "+(on?t.accent:t.border)}}>
              <div style={{width:14, height:14, borderRadius:4, flexShrink:0, background:on?t.accent:t.panel2, border:"1px solid "+(on?t.accent:t.border), display:"flex", alignItems:"center", justifyContent:"center"}}>
                {on&&<span style={{color:"#fff", fontSize:10, fontWeight:700}}>v</span>}
              </div>
              <span style={{fontSize:11, fontWeight:600, color:on?t.text:t.muted}}>{item.label}</span>
              <span style={{fontSize:9, color:t.muted, marginLeft:2}}>{item.desc}</span>
            </button>
          );
        })}
      </div>
      <Divider/>
      <SectionLabel>Text Style</SectionLabel>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:10}}>
        <span style={{fontSize:11, color:t.muted, flex:1}}>Font size</span>
        <button onClick={()=>setLegendStyle(s=>({...s,fontSize:Math.max(7,s.fontSize-1)}))}
          style={{width:26, height:26, borderRadius:5, border:"1px solid "+t.border, background:t.panel2, color:t.text, cursor:"pointer", fontSize:15, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center"}}>-</button>
        <span style={{fontSize:12, fontWeight:700, color:t.accent, minWidth:20, textAlign:"center"}}>{legendStyle.fontSize}</span>
        <button onClick={()=>setLegendStyle(s=>({...s,fontSize:Math.min(18,s.fontSize+1)}))}
          style={{width:26, height:26, borderRadius:5, border:"1px solid "+t.border, background:t.panel2, color:t.text, cursor:"pointer", fontSize:15, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center"}}>+</button>
      </div>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:10}}>
        <button onClick={()=>setLegendStyle(s=>({...s,bold:!s.bold}))}
          style={{padding:"4px 12px", borderRadius:6, fontSize:12, fontWeight:700, cursor:"pointer", border:"1px solid "+(legendStyle.bold?t.accent:t.border), background:legendStyle.bold?t.accent:"transparent", color:legendStyle.bold?"#fff":t.muted}}>B</button>
        <span style={{fontSize:11, color:t.muted}}>Bold text</span>
      </div>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:12}}>
        <ColorSwatch color={legendStyle.color||t.muted} size={22} onChange={v=>setLegendStyle(s=>({...s,color:v}))}/>
        <span style={{fontSize:11, color:t.muted}}>Color override</span>
        {legendStyle.color&&<button onClick={()=>setLegendStyle(s=>({...s,color:""}))} style={{fontSize:10, color:t.muted, background:"transparent", border:"none", cursor:"pointer"}}>auto</button>}
      </div>
      <Divider/>
      <SectionLabel>Position</SectionLabel>
      <div style={{fontSize:11, color:t.muted, marginBottom:8, lineHeight:1.5}}>
        Drag the legend anywhere on the plot to reposition it. Click any label text in the legend to edit it inline.
      </div>
      <button onClick={()=>setLegendPos({x:548,y:topMargin})}
        style={{width:"100%", padding:"5px 0", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>
        Reset to default position
      </button>
    </div>
  );
}

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
/* encodeCanvas: shared/exportUtils (adds JPEG DPI) */

function ExportPanel({plotRef, display, rows}) {
  const t=useTheme();
  const [format,   setFormat]  = useState("png");
  const [dpi,      setDpi]     = useState(300);
  const [mmWidth,  setMmWidth] = useState(183);
  const [mmHeight, setMmHeight]= useState(120);
  const [useMm,    setUseMm]   = useState(false);
  const [trim,     setTrim]    = useState(true);
  const [saving,   setSaving]  = useState(false);
  const [done,     setDone]    = useState(false);
  const [err,      setErr]     = useState(null);

  const runExport = async () => {
    setSaving(true); setErr(null);
    const name = "ma_plot_"+new Date().toISOString().slice(0,10);
    await new Promise(r=>setTimeout(r,60));
    try {
      if (format==="csv") {
        const filled = rows.filter(r=>Object.values(r).some(v=>v!==""&&v!=null));
        if (filled.length) {
          const csv = "gene,baseMean,log2fc,pval\n"+filled.map(r=>(r.gene||"")+","+(r.baseMean||0)+","+(r.log2fc||0)+","+(r.pval||1)).join("\n");
          downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}), name+".csv");
        }
        setDone(true); setTimeout(()=>setDone(false),1500); return;
      }
      const svgEl = plotRef && plotRef.current && plotRef.current.querySelector("svg");
      if (!svgEl) { setErr("Couldn't find the plot. Switch to the Plot or Split view and try again."); return; }
      const clone = svgEl.cloneNode(true);
      clone.style.removeProperty("width"); clone.style.removeProperty("max-width"); clone.style.removeProperty("height"); // on-screen scaling only
      clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
      const vb = (svgEl.getAttribute("viewBox")||"0 0 700 420").split(" ").map(Number);
      const fullW=vb[2]||700, fullH=vb[3]||420;
      const box = trim ? tightViewBox(svgEl, fullW, fullH, 4) : {x:0,y:0,w:fullW,h:fullH};
      const svgW=box.w, svgH=box.h;
      clone.setAttribute("viewBox", box.x+" "+box.y+" "+box.w+" "+box.h);
      const bgFill = display.plotBg || "#ffffff"; // figures are always on white paper
      const bgRect = document.createElementNS("http://www.w3.org/2000/svg","rect");
      bgRect.setAttribute("x",box.x); bgRect.setAttribute("y",box.y);
      bgRect.setAttribute("width",box.w); bgRect.setAttribute("height",box.h); bgRect.setAttribute("fill",bgFill);
      clone.insertBefore(bgRect, clone.firstChild);
      if (format==="svg") {
        if (useMm) { clone.setAttribute("width",mmWidth+"mm"); clone.setAttribute("height",mmHeight+"mm"); }
        else { clone.setAttribute("width",svgW); clone.setAttribute("height",svgH); }
        downloadBlob(new Blob([clone.outerHTML],{type:"image/svg+xml;charset=utf-8"}), name+".svg");
      } else {
        const pxW = useMm ? Math.round(mmWidth/25.4*dpi) : Math.round(svgW*(dpi/96));
        const pxH = useMm ? Math.round(mmHeight/25.4*dpi) : Math.round(svgH*(dpi/96));
        prepareSVGForExport(clone, svgW, svgH, display.ff);
        const svgStr = serializeSVG(clone);
        const cv = await rasterizeSVG(svgStr, pxW, pxH, svgW, svgH, bgFill);
        const suffix = "_"+dpi+"dpi"+(useMm?"_"+mmWidth+"x"+mmHeight+"mm":"");
        const ext = format==="jpeg"?".jpg":format==="tiff"?".tif":".png";
        downloadBlob(await encodeCanvas(cv, format, dpi), name+suffix+ext);
      }
      setDone(true); setTimeout(()=>setDone(false),1500);
    } catch(e){ setErr((e&&e.message)?e.message:"Export failed."); }
    finally { setSaving(false); }
  };

  const FORMATS=[{id:"png",l:"PNG",sub:"Best for most journals"},{id:"jpeg",l:"JPEG",sub:"Smaller file size"},{id:"tiff",l:"TIFF",sub:"ImageJ / Photoshop"},{id:"svg",l:"SVG",sub:"Vector, infinitely scalable"},{id:"csv",l:"CSV",sub:"Download data table"}];
  const svgPreview = plotRef && plotRef.current && plotRef.current.querySelector("svg");
  const vbPreview = ((svgPreview&&svgPreview.getAttribute("viewBox"))||"0 0 680 400").split(" ").map(Number);
  const previewW = useMm ? Math.round(mmWidth/25.4*dpi) : Math.round((vbPreview[2]||680)*(dpi/96));
  const previewH = useMm ? Math.round(mmHeight/25.4*dpi) : Math.round((vbPreview[3]||400)*(dpi/96));

  return (
    <div>
      <SectionLabel>Format</SectionLabel>
      <div style={{display:"flex", flexDirection:"column", gap:4, marginBottom:12}}>
        {FORMATS.map(f=>(
          <button key={f.id} onClick={()=>setFormat(f.id)}
            style={{display:"flex", alignItems:"center", gap:10, padding:"8px 10px", borderRadius:7, cursor:"pointer", textAlign:"left",
              background:format===f.id?t.cSel:"transparent", border:"1.5px solid "+(format===f.id?t.accent:t.border)}}>
            <div style={{width:12, height:12, borderRadius:"50%", border:"2px solid "+(format===f.id?t.accent:t.border), background:format===f.id?t.accent:"transparent", flexShrink:0}}/>
            <span style={{fontSize:11, fontWeight:700, color:format===f.id?t.text:t.muted, width:34}}>{f.l}</span>
            <span style={{fontSize:10, color:t.muted}}>{f.sub}</span>
          </button>
        ))}
      </div>
      {format==="tiff"&&<div style={{padding:"6px 9px", borderRadius:6, background:t.tag, fontSize:10, color:t.tagText, marginBottom:10, border:"1px solid "+t.cBorder}}>Exported as PNG with .tif extension — opens correctly in ImageJ, FIJI, and Photoshop.</div>}

      {format!=="svg"&&format!=="csv"&&(
        <div>
          <Divider/>
          <SectionLabel>Resolution (DPI)</SectionLabel>
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, marginBottom:6}}>
            {[[72,"Screen"],[150,"Draft"],[300,"Journal"],[600,"High-res"]].map(([v,lb])=>(
              <button key={v} onClick={()=>setDpi(v)}
                style={{padding:"6px 4px", borderRadius:6, cursor:"pointer", textAlign:"center",
                  background:dpi===v?t.cSel:"transparent", border:"1.5px solid "+(dpi===v?t.accent:t.border)}}>
                <div style={{fontSize:12, fontWeight:700, color:dpi===v?t.accent:t.muted}}>{v}</div>
                <div style={{fontSize:9, color:t.muted}}>{lb}</div>
              </button>
            ))}
          </div>
          <input type="number" min={72} max={1200} value={dpi} onChange={e=>setDpi(Math.min(1200,Math.max(72,+e.target.value||72)))}
            style={{width:"100%", padding:"5px 7px", fontSize:11, borderRadius:5, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none", marginBottom:8}}/>
        </div>
      )}

      {format!=="csv"&&(
        <div>
          <Divider/>
          <SectionLabel>Figure Size (mm)</SectionLabel>
          <Toggle value={trim} onChange={setTrim} label="Trim empty space"/>
          <div style={{fontSize:10, color:t.muted, lineHeight:1.5, margin:"2px 0 8px"}}>Crops the exported file to the plot itself. Leave on unless you want the blank margin kept.</div>
          <Toggle value={useMm} onChange={setUseMm} label="Set custom size in mm"/>
          {useMm&&(
            <div>
              <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:4, marginBottom:8}}>
                {MM_PRESETS.map(p=>(
                  <button key={p.w} onClick={()=>setMmWidth(p.w)}
                    style={{padding:"5px 4px", borderRadius:6, cursor:"pointer", textAlign:"center",
                      background:mmWidth===p.w?t.cSel:"transparent", border:"1.5px solid "+(mmWidth===p.w?t.accent:t.border)}}>
                    <div style={{fontSize:11, fontWeight:700, color:mmWidth===p.w?t.accent:t.muted}}>{p.label}</div>
                    <div style={{fontSize:9, color:t.muted}}>{p.desc}</div>
                  </button>
                ))}
              </div>
              <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8}}>
                <div>
                  <div style={{fontSize:10, color:t.muted, marginBottom:3}}>Width (mm)</div>
                  <input type="number" min={50} max={500} value={mmWidth} onChange={e=>setMmWidth(+e.target.value||89)}
                    style={{width:"100%", padding:"5px 7px", fontSize:11, borderRadius:5, border:"1px solid "+t.accent, background:t.cBg, color:t.text, outline:"none"}}/>
                </div>
                <div>
                  <div style={{fontSize:10, color:t.muted, marginBottom:3}}>Height (mm)</div>
                  <input type="number" min={30} max={500} value={mmHeight} onChange={e=>setMmHeight(+e.target.value||100)}
                    style={{width:"100%", padding:"5px 7px", fontSize:11, borderRadius:5, border:"1px solid "+t.accent, background:t.cBg, color:t.text, outline:"none"}}/>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {format!=="svg"&&format!=="csv"&&(
        <div style={{padding:"9px 11px", borderRadius:8, background:t.panel2, border:"1px solid "+t.border, marginBottom:12}}>
          <div style={{fontSize:10, color:t.muted, marginBottom:4, fontWeight:600}}>Output preview</div>
          {useMm&&<div style={{fontSize:11, color:t.text, marginBottom:2}}>{mmWidth} x {mmHeight} mm</div>}
          <div style={{fontSize:11, color:t.text}}>{previewW} x {previewH} px at {dpi} dpi</div>
          {dpi>=300?<div style={{fontSize:10, color:t.success, fontWeight:600, marginTop:4}}>Journal quality</div>:<div style={{fontSize:10, color:t.muted, marginTop:4}}>Use 300+ dpi for publication</div>}
        </div>
      )}

      <button onClick={runExport} disabled={saving}
        style={{width:"100%", padding:"11px 0", borderRadius:8, fontSize:13, fontWeight:700, cursor:saving?"default":"pointer",
          background:done?t.success:t.accent, border:"none", color:"#fff", transition:"background .2s"}}>
        {done?"Saved!":saving?"Saving...":"Download "+format.toUpperCase()}
      </button>
      {err&&(
        <div style={{marginTop:8, fontSize:11, lineHeight:1.55, padding:"8px 10px", borderRadius:6, background:"#FEE2E2", color:"#991B1B", border:"1px solid #FCA5A5"}}>
          <strong>Download failed.</strong> {err}
        </div>
      )}
    </div>
  );
}

// ─── Sheet sidebar (multi-dataset tabs) ────────────────────────────────────────
function SheetSidebar({sheets, activeId, onSelect, onNew, onRename, onDuplicate, onDelete, onSave, onLoad}) {
  const t=useTheme();
  const [renaming,setRenaming]=useState(null);
  const [draft,   setDraft]   =useState("");
  const [showNew, setShowNew] =useState(false);
  const [newName, setNewName] =useState("");
  const [menu,    setMenu]    =useState(null);
  const fileRef=useRef(null);
  const startRename =sh=>{setRenaming(sh.id);setDraft(sh.name);setMenu(null);};
  const commitRename=()=>{if(draft.trim())onRename(renaming,draft.trim());setRenaming(null);};
  return (
    <div style={{width:190, background:t.panel, borderRight:"1px solid "+t.border, display:"flex", flexDirection:"column", flexShrink:0}}>
      <div style={{padding:"10px 12px", borderBottom:"1px solid "+t.border, display:"flex", alignItems:"center", justifyContent:"space-between"}}>
        <span style={{fontSize:12, fontWeight:700, color:t.text}}>Sheets</span>
        <button onClick={()=>{setShowNew(true);setNewName("Sheet "+(sheets.length+1));}}
          style={{width:24, height:24, borderRadius:6, background:t.accent, border:"none", color:"#fff", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700}}>+</button>
      </div>
      <div style={{flex:1, overflowY:"auto", padding:"4px 0"}}>
        {sheets.map(sh=>(
          <div key={sh.id} onClick={()=>{onSelect(sh.id);setMenu(null);}}
            style={{position:"relative", display:"flex", alignItems:"center", gap:6, padding:"8px 12px", cursor:"pointer",
              background:sh.id===activeId?t.cSel:"transparent", borderLeft:"3px solid "+(sh.id===activeId?t.accent:"transparent")}}>
            <span style={{fontSize:14, flexShrink:0}}>📊</span>
            {renaming===sh.id
              ?<input autoFocus value={draft} onChange={e=>setDraft(e.target.value)}
                  onBlur={commitRename} onKeyDown={e=>{if(e.key==="Enter")commitRename();if(e.key==="Escape")setRenaming(null);}}
                  onClick={e=>e.stopPropagation()}
                  style={{flex:1, fontSize:11, padding:"2px 5px", borderRadius:4, border:"1px solid "+t.accent, background:t.cBg, color:t.text, outline:"none", minWidth:0}}/>
              :<span style={{flex:1, fontSize:11, fontWeight:sh.id===activeId?600:400, color:sh.id===activeId?t.text:t.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{sh.name}</span>
            }
            <button onClick={e=>{e.stopPropagation();setMenu(menu===sh.id?null:sh.id);}}
              style={{padding:"2px 6px", fontSize:13, background:"transparent", border:"none", color:t.muted, cursor:"pointer", opacity:sh.id===activeId?1:0, flexShrink:0}}>...</button>
            {menu===sh.id&&(
              <div onClick={e=>e.stopPropagation()}
                style={{position:"absolute", right:4, top:30, zIndex:100, background:t.panel, border:"1px solid "+t.border, borderRadius:8, boxShadow:t.shadow, minWidth:138, padding:"4px 0"}}>
                {[["Rename",()=>startRename(sh)],["Duplicate",()=>{onDuplicate(sh.id);setMenu(null);}],["Delete",()=>{onDelete(sh.id);setMenu(null);}]].map(([lb,fn])=>(
                  <button key={lb} onClick={fn} style={{display:"block", width:"100%", padding:"7px 14px", textAlign:"left", fontSize:12, color:lb==="Delete"?"#DC2626":t.text, background:"transparent", border:"none", cursor:"pointer"}}>{lb}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {showNew&&(
        <div style={{padding:"10px", borderTop:"1px solid "+t.border, background:t.panel2}}>
          <div style={{fontSize:11, fontWeight:600, color:t.text, marginBottom:6}}>New Sheet</div>
          <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Sheet name"
            style={{width:"100%", boxSizing:"border-box", padding:"5px 8px", fontSize:11, borderRadius:5, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none", marginBottom:7}}/>
          <div style={{display:"flex", gap:5}}>
            <button onClick={()=>{onNew(newName.trim()||"Sheet "+(sheets.length+1));setShowNew(false);}}
              style={{flex:1, padding:"5px 0", borderRadius:5, fontSize:11, fontWeight:600, cursor:"pointer", background:t.accent, border:"none", color:"#fff"}}>Create</button>
            <button onClick={()=>setShowNew(false)}
              style={{flex:1, padding:"5px 0", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{padding:"10px 12px", borderTop:"1px solid "+t.border, display:"flex", flexDirection:"column", gap:5}}>
        <button onClick={onSave} style={{width:"100%", padding:"7px 0", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", background:t.success, border:"none", color:"#fff"}}>Save Project</button>
        <button onClick={()=>fileRef.current&&fileRef.current.click()} style={{width:"100%", padding:"7px 0", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>Load Project</button>
        <input ref={fileRef} type="file" accept=".json" style={{display:"none"}}
          onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>readProjectText(ev.target.result,"ma-plot",onLoad);r.readAsText(f);e.target.value="";}}/>
        <div style={{fontSize:9, color:t.muted, textAlign:"center"}}>Ctrl+S to save</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MA Plot — the core SVG visualization
// ════════════════════════════════════════════════════════════════════════════
function MAPlot({data, stats, display, geneSetParsed, geneSetColor, legendVisible, legendStyle, legendPos, setLegendPos, labeled, setLabeled}) {
  const t=useTheme();
  const style=resolveStyles(display,t);

  const fcThreshold = stats.fcThreshold||1;
  const pThreshold  = stats.pThreshold||0.05;
  const dotRadius   = stats.dotRadius||4;
  const meanExprEps = stats.meanExprFloor||0.5;
  const labelColor  = stats.labelColor||t.text;
  const colorMode   = stats.colorMode||"3group";
  const topN        = stats.topN||0;
  const topNBy      = stats.topNBy||"pval";
  const repel       = stats.repelLabels!==false;
  const fcOnlyColor = stats.fcOnlyColor||"#D97706";
  const xMinSetting = stats.xMin||"auto";
  const xMaxSetting = stats.xMax||"auto";
  const yMinSetting = stats.yMin||"auto";
  const yMaxSetting = stats.yMax||"auto";
  const nlpThreshold= pToNlp(pThreshold);
  const showTrend   = stats.showTrend||false;
  const trendSpan   = stats.trendSpan||0.3;
  const trendColor  = stats.trendColor||"#16A34A";

  const [hovered,     setHovered]     = useState(null);
  const [labelMode,   setLabelMode]   = useState(false);
  const [legendDrag,  setLegendDrag]  = useState(null);
  const [editingRow,  setEditingRow]  = useState(null);
  const [editValue,   setEditValue]   = useState("");
  const [customLabels,setCustomLabels]= useState({});

  const svgRef          = useRef(null);
  const svgContainerRef = useRef(null);
  const editInputRef    = useRef(null);

  const isLegendItemVisible = id => legendVisible[id]!==false;
  const getLegendLabel = (key,fallback) => customLabels[key]!==undefined ? customLabels[key] : fallback;
  const setLegendLabel = (key,val) => setCustomLabels(p=>({...p,[key]:val}));
  const toggleLabeled  = useCallback(gene=>{
    setLabeled(prev=>{ const next=new Set(prev); if(next.has(gene)) next.delete(gene); else next.add(gene); return next; });
  },[setLabeled]);

  // ── Derive per-point statistics: A (mean expr), M (log2FC), significance ──
  const points = useMemo(()=>data.map(row=>{
    const nlp = pToNlp(row.pval);
    const a   = meanExprToA(row.baseMean, meanExprEps);
    const group = classify(nlp, row.log2fc, nlpThreshold, fcThreshold);
    return {...row, nlp, a, group};
  }),[data, meanExprEps, nlpThreshold, fcThreshold]);

  const absFcValues = points.map(p=>Math.abs(p.log2fc));
  const fcRangeMin = Math.min.apply(null, absFcValues);
  const fcRangeMax = Math.max.apply(null, [...absFcValues, 0.01]);

  const gradientColor = useCallback(v=>{
    const tNorm = Math.max(0, Math.min(1, (Math.abs(v)-fcRangeMin)/(fcRangeMax-fcRangeMin)));
    if (tNorm<0.5) { const s=tNorm*2; return "rgb("+Math.round(80+175*s)+","+Math.round(120+135*s)+","+Math.round(255*(1-s)+120*s)+")"; }
    const s=(tNorm-0.5)*2; return "rgb(255,"+Math.round(255*(1-s))+","+Math.round(120*(1-s))+")";
  },[fcRangeMin,fcRangeMax]);

  const colorForPoint = useCallback(p=>{
    if (colorMode==="gradient") return gradientColor(p.log2fc);
    if (p.group==="UP") return style.colorUp;
    if (p.group==="DOWN") return style.colorDown;
    if (colorMode==="4group" && p.group==="FC_ONLY") return fcOnlyColor;
    return style.colorNs;
  },[colorMode,style.colorUp,style.colorDown,style.colorNs,fcOnlyColor,gradientColor]);

  const upCount     = points.filter(p=>p.group==="UP").length;
  const downCount   = points.filter(p=>p.group==="DOWN").length;
  const fcOnlyCount = points.filter(p=>p.group==="FC_ONLY").length;
  const nsCount     = points.length - upCount - downCount - fcOnlyCount;

  const isInGeneSet = useCallback(gene=>geneSetParsed.size>0 && geneSetParsed.has((gene||"").toUpperCase()),[geneSetParsed]);

  // ── Axis ranges ─────────────────────────────────────────────────────────
  const aValues = points.map(p=>p.a).filter(isFinite);
  const mValues = points.map(p=>p.log2fc).filter(isFinite);
  const aMin = Math.min.apply(null, [...aValues, Math.log10(meanExprEps)]);
  const aMax = Math.max.apply(null, [...aValues, 1]);
  const aPad = (aMax-aMin)*0.06 || 0.3;
  const mAbsMax = Math.max.apply(null, [...mValues.map(Math.abs), 0.5]);

  const x1 = xMinSetting==="auto" ? aMin-aPad : +xMinSetting;
  const x2 = xMaxSetting==="auto" ? aMax+aPad : +xMaxSetting;
  const y1 = yMinSetting==="auto" ? -(mAbsMax*1.15) : +yMinSetting;
  const y2 = yMaxSetting==="auto" ? mAbsMax*1.15 : +yMaxSetting;

  const autoLabeledGenes = useMemo(()=>{
    if (!topN) return new Set();
    const significant = points.filter(p=>p.group==="UP"||p.group==="DOWN");
    let sorted;
    if (topNBy==="fc") sorted=[...significant].sort((a,b)=>Math.abs(b.log2fc)-Math.abs(a.log2fc));
    else if (topNBy==="both") sorted=[...significant].sort((a,b)=>(b.nlp*Math.abs(b.log2fc))-(a.nlp*Math.abs(a.log2fc)));
    else sorted=[...significant].sort((a,b)=>b.nlp-a.nlp);
    return new Set(sorted.slice(0,topN).map(p=>p.gene));
  },[points,topN,topNBy]);

  // ── Layout geometry ─────────────────────────────────────────────────────
  const PLOT_W=520, MARGIN_L=52, MARGIN_R=20, MARGIN_T=30, MARGIN_B=48, PLOT_H=310;
  const innerW = PLOT_W-MARGIN_L-MARGIN_R;
  const totalH = PLOT_H+MARGIN_T+MARGIN_B;
  const LABEL_MARGIN=36;
  const svgW = PLOT_W+MARGIN_R+LABEL_MARGIN+180;
  const r = dotRadius;

  const scaleX = useCallback(v=>MARGIN_L+(v-x1)/(x2-x1)*innerW,[x1,x2,innerW]);
  const scaleY = useCallback(v=>MARGIN_T+PLOT_H-(v-y1)/(y2-y1)*PLOT_H,[y1,y2]);
  // Round-number ticks (1/2/2.5/5 x 10^k) instead of equal sixths of the range,
  // which produced values like -0.6 / 0.3 / 1.1.
  const xTk = useMemo(()=>niceTicks(x1,x2,6),[x1,x2]);
  const yTk = useMemo(()=>niceTicks(y1,y2,5),[y1,y2]);
  const xTicks = xTk.ticks, yTicks = yTk.ticks;

  // ── Density-aware rendering — keeps large datasets (10k+ genes) legible ──
  const nPoints = points.length;
  const densityScale = nPoints>8000 ? 0.45 : nPoints>4000 ? 0.6 : nPoints>1500 ? 0.75 : nPoints>500 ? 0.9 : 1;
  const plainPointOpacity = Math.max(0.35, 0.9*densityScale);
  const plainPointRadius  = Math.max(1.2, r*Math.max(0.5,densityScale));

  // Dots carrying extra decoration stay as individual elements; everything else
  // is merged. Deliberately excludes the hovered gene so that moving the mouse
  // doesn't invalidate the merged geometry on every frame.
  const specialGenes = useMemo(()=>{
    const s=new Set();
    labeled.forEach(g=>s.add(g));
    autoLabeledGenes.forEach(g=>s.add(g));
    points.forEach(p=>{ if(isInGeneSet(p.gene)) s.add(p.gene); });
    return s;
  },[labeled,autoLabeledGenes,isInGeneSet,points]);

  const plainLayers = useMemo(()=>{
    const groups=new Map();
    for (let i=0;i<points.length;i++) {
      const p=points[i];
      if (specialGenes.has(p.gene)) continue;
      const col=colorForPoint(p);
      let g=groups.get(col);
      if (!g) { g=[]; groups.set(col,g); }
      g.push({cx:scaleX(p.a), cy:scaleY(p.log2fc)});
    }
    const out=[];
    groups.forEach((pts,col)=>{
      for (let i=0;i<pts.length;i+=DOT_CHUNK) out.push({col, d:dotsToPath(pts.slice(i,i+DOT_CHUNK), plainPointRadius)});
    });
    return out;
  },[points,specialGenes,colorForPoint,scaleX,scaleY,plainPointRadius]);

  const specialPts = useMemo(()=>points.filter(p=>specialGenes.has(p.gene)),[points,specialGenes]);

  const hitIndex = useMemo(()=>buildHitIndex(
    points.map(p=>({p, cx:scaleX(p.a), cy:scaleY(p.log2fc)})), 14
  ),[points,scaleX,scaleY]);

  const hitAt = useCallback(e=>{
    const svg=svgRef.current;
    if (!svg) return null;
    const box=svg.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const px=(e.clientX-box.left)*(svgW/box.width);
    const py=(e.clientY-box.top)*(totalH/box.height);
    return queryHitIndex(hitIndex, px, py, r+5);
  },[hitIndex,r,svgW,totalH]);

  // ── Trend line (LOESS over A vs M) ────────────────────────────────────────
  const trendPath = useMemo(()=>{
    if (!showTrend || points.length<4) return "";
    const pairs = points.map(p=>[p.a, p.log2fc]);
    const smoothed = computeLoess(pairs, trendSpan);
    return smoothed.map((p,i)=>(i===0?"M ":"L ")+scaleX(p[0]).toFixed(2)+" "+scaleY(p[1]).toFixed(2)).join(" ");
  },[points, showTrend, trendSpan, scaleX, scaleY]);

  // ── Label repulsion ───────────────────────────────────────────────────────
  // Labels are drawn text-anchor "start" at (x, y=baseline): box is
  // [x, x+w] x [y-h+1, y+2]. The previous version read an unset pos.hx
  // (NaN), so every repelled label got x=NaN and never rendered; it also
  // treated x as the box centre and ignored dots as obstacles.
  const labelPositions = useMemo(()=>{
    const labeledPoints = points.filter(p=>labeled.has(p.gene)||autoLabeledGenes.has(p.gene));
    if (!labeledPoints.length || !repel) return {};
    const lbFs=style.pointLabel.fontSize||9, charW=lbFs*0.58, h=lbFs+1;
    const L=MARGIN_L+2, R=MARGIN_L+innerW-2, T=MARGIN_T+2, B=MARGIN_T+PLOT_H-2;
    const CELL=24, grid=new Map();
    points.forEach(p=>{
      const cx=scaleX(p.a), cy=scaleY(p.log2fc);
      if(!(cx>=MARGIN_L&&cx<=MARGIN_L+innerW&&cy>=MARGIN_T&&cy<=MARGIN_T+PLOT_H))return;
      const deco=labeled.has(p.gene)||autoLabeledGenes.has(p.gene)||isInGeneSet(p.gene);
      const o={x:cx,y:cy,r:(deco?r+5:r)+1.5};
      const k=Math.floor(cx/CELL)+","+Math.floor(cy/CELL);
      if(!grid.has(k))grid.set(k,[]); grid.get(k).push(o);
    });
    const near=(x0,y0,x1_,y1_)=>{
      const out=[];
      for(let gx=Math.floor((x0-12)/CELL);gx<=Math.floor((x1_+12)/CELL);gx++)
        for(let gy=Math.floor((y0-12)/CELL);gy<=Math.floor((y1_+12)/CELL);gy++){const c=grid.get(gx+","+gy);if(c)for(const o of c)out.push(o);}
      return out;
    };
    const positions = {};
    labeledPoints.forEach(p=>{
      const cx=scaleX(p.a), cy=scaleY(p.log2fc), w=p.gene.length*charW+2;
      const home=labelHome(cx,cy,w,r,L,R);
      positions[p.gene]={x:home.x,y:home.y,ox:cx,oy:cy,hx:home.x,hy:home.y,w,h};
    });
    const genes = Object.keys(positions);
    for (let it=0; it<150; it++) {
      let moved=0;
      genes.forEach(g=>{
        const a_=positions[g]; let fx=0, fy=0;
        const ax0=a_.x, ax1=a_.x+a_.w, ay0=a_.y-a_.h+1, ay1=a_.y+2;
        genes.forEach(g2=>{
          if(g===g2)return;
          const b_=positions[g2], bx0=b_.x, bx1=b_.x+b_.w, by0=b_.y-b_.h+1, by1=b_.y+2;
          const ox=Math.min(ax1,bx1)-Math.max(ax0,bx0)+2, oy=Math.min(ay1,by1)-Math.max(ay0,by0)+2;
          if(ox>0&&oy>0){
            const dx=(ax0+ax1)-(bx0+bx1), dy=(ay0+ay1)-(by0+by1);
            if(oy<=ox) fy+=(dy>=0?1:-1)*oy*0.5; else fx+=(dx>=0?1:-1)*ox*0.5;
          }
        });
        near(ax0,ay0,ax1,ay1).forEach(o=>{
          const nx=Math.max(ax0,Math.min(o.x,ax1)), ny=Math.max(ay0,Math.min(o.y,ay1));
          let dx=nx-o.x, dy=ny-o.y; const dd=Math.hypot(dx,dy);
          if(dd>=o.r)return;
          if(dd<1e-6){dx=(ax0+ax1)/2-o.x; dy=(ay0+ay1)/2-o.y; const m=Math.hypot(dx,dy)||1; dx/=m; dy/=m;}
          else {dx/=dd; dy/=dd;}
          const push=(o.r-dd)*0.6; fx+=dx*push; fy+=dy*push;
        });
        fx+=(a_.hx-a_.x)*0.02; fy+=(a_.hy-a_.y)*0.02;
        const nx=Math.max(L,Math.min(R-a_.w,a_.x+fx)), ny=Math.max(T+a_.h,Math.min(B,a_.y+fy));
        moved+=Math.abs(nx-a_.x)+Math.abs(ny-a_.y); a_.x=nx; a_.y=ny;
      });
      if(moved<0.05)break;
    }
    return positions;
  },[points, labeled, autoLabeledGenes, repel, r, scaleX, scaleY, isInGeneSet, style.pointLabel.fontSize, innerW]);

  // ── Legend rows ──────────────────────────────────────────────────────────
  const LEGEND_W=158;
  const legendFontSize=legendStyle.fontSize, legendFontWeight=legendStyle.bold?"bold":"normal", legendFont=style.font;
  const legendColorOverride = legendStyle.color||null;

  const legendRows = useMemo(()=>{
    const rows=[], pLabel = stats.useAdjP ? "adj.p" : "p";
    if (isLegendItemVisible("title")) rows.push({id:"title", type:"title", text:getLegendLabel("title", pLabel+"<"+pThreshold+" | |log2FC|>"+fcThreshold)});
    if (isLegendItemVisible("colorKey")) {
      if (colorMode!=="gradient") {
        rows.push({id:"up",   type:"color", col:style.colorUp,   lbl:getLegendLabel("up","UP"),     val:String(upCount)});
        rows.push({id:"down", type:"color", col:style.colorDown, lbl:getLegendLabel("down","DOWN"), val:String(downCount)});
        if (colorMode==="4group") rows.push({id:"fconly", type:"color", col:fcOnlyColor, lbl:getLegendLabel("fconly","FC only"), val:String(fcOnlyCount)});
        rows.push({id:"ns", type:"color", col:style.colorNs, lbl:getLegendLabel("ns","NS"), val:String(nsCount)});
      } else {
        rows.push({id:"grad", type:"gradient"});
      }
      if (geneSetParsed.size>0) rows.push({id:"gs", type:"color", col:geneSetColor, lbl:getLegendLabel("gs","Gene set"), val:String(geneSetParsed.size)});
    }
    if (isLegendItemVisible("pval"))   rows.push({id:"pval",   type:"kv", lbl:getLegendLabel("pval", pLabel+" cutoff"), val:pThreshold.toExponential(1)});
    if (isLegendItemVisible("nlp"))    rows.push({id:"nlp",    type:"kv", lbl:getLegendLabel("nlp","-log10(p)"),        val:nlpThreshold.toFixed(2)});
    if (isLegendItemVisible("fc"))     rows.push({id:"fc",     type:"kv", lbl:getLegendLabel("fc","|log2FC|"),         val:"+/-"+fcThreshold});
    if (isLegendItemVisible("total"))  rows.push({id:"total",  type:"kv", lbl:getLegendLabel("total","Total genes"),   val:String(points.length)});
    if (isLegendItemVisible("pct"))    rows.push({id:"pct",    type:"kv", lbl:getLegendLabel("pct","% Sig"),           val:(points.length?((upCount+downCount)/points.length*100).toFixed(1):0)+"%", accent:true});
    if (isLegendItemVisible("updown")) rows.push({id:"updown", type:"kv", lbl:getLegendLabel("updown","Up/Down"),      val:upCount+"/"+downCount});
    if (isLegendItemVisible("labeled") && labeled.size>0) rows.push({id:"labeled", type:"color", col:labelColor, lbl:getLegendLabel("labeled","Labeled"), val:String(labeled.size)});
    return rows;
  },[legendVisible,upCount,downCount,nsCount,fcOnlyCount,pThreshold,nlpThreshold,fcThreshold,points.length,labeled.size,stats.useAdjP,colorMode,style.colorUp,style.colorDown,style.colorNs,fcOnlyColor,geneSetColor,geneSetParsed.size,labelColor,customLabels]);

  const legendH = useMemo(()=>{
    let h=0;
    legendRows.forEach(row=>{ h += row.type==="title" ? legendFontSize+8 : row.type==="gradient" ? legendFontSize+34 : legendFontSize+9; });
    return h;
  },[legendRows,legendFontSize]);
  const hasLegend = legendRows.length>0;

  // ── Legend drag handling ────────────────────────────────────────────────
  const onLegendPointerDown = useCallback(e=>{
    e.stopPropagation();
    const svg=svgRef.current; if(!svg) return;
    const pt=svg.createSVGPoint(); pt.x=e.clientX; pt.y=e.clientY;
    const svgPt=pt.matrixTransform(svg.getScreenCTM().inverse());
    setLegendDrag({sx:svgPt.x, sy:svgPt.y, ox:legendPos.x, oy:legendPos.y});
    e.preventDefault();
  },[legendPos]);

  const onSvgPointerMove = useCallback(e=>{
    if (!legendDrag) return;
    const svg=svgRef.current; if(!svg) return;
    const pt=svg.createSVGPoint(); pt.x=e.clientX; pt.y=e.clientY;
    const svgPt=pt.matrixTransform(svg.getScreenCTM().inverse());
    setLegendPos({x:legendDrag.ox+(svgPt.x-legendDrag.sx), y:legendDrag.oy+(svgPt.y-legendDrag.sy)});
  },[legendDrag,setLegendPos]);

  const onSvgPointerUp = useCallback(()=>setLegendDrag(null),[]);

  // ── Inline legend label editing ────────────────────────────────────────
  const startEditingLabel = useCallback((rowId,currentVal,e)=>{
    e && e.stopPropagation();
    setEditingRow(rowId); setEditValue(currentVal);
    setTimeout(()=>editInputRef.current && editInputRef.current.focus(),30);
  },[]);
  const commitLabelEdit = useCallback(()=>{ if(editingRow) setLegendLabel(editingRow,editValue); setEditingRow(null); },[editingRow,editValue]);
  const cancelLabelEdit = useCallback(()=>setEditingRow(null),[]);

  const editInputStyle = useCallback(()=>{
    if (!editingRow || !svgContainerRef.current) return {display:"none"};
    const idx = legendRows.findIndex(row=>row.id===editingRow);
    if (idx<0) return {display:"none"};
    let rowY=legendPos.y;
    for (let i=0;i<idx;i++) { const row=legendRows[i]; rowY += row.type==="title" ? legendFontSize+8 : row.type==="gradient" ? legendFontSize+34 : legendFontSize+9; }
    const svgEl = svgContainerRef.current.querySelector("svg"); if(!svgEl) return {display:"none"};
    const svgRect=svgEl.getBoundingClientRect(), containerRect=svgContainerRef.current.getBoundingClientRect();
    const scale = svgRect.width/(svgW||700);
    return {
      position:"absolute", left:Math.round(legendPos.x*scale+(svgRect.left-containerRect.left)), top:Math.round(rowY*scale+(svgRect.top-containerRect.top)),
      width:Math.round(LEGEND_W*scale), height:Math.round((legendFontSize+6)*scale), zIndex:200,
      background:t.cBg, border:"1.5px solid "+t.accent, borderRadius:4, padding:"1px 5px",
      fontSize:legendFontSize, color:t.text, outline:"none", fontFamily:legendFont, boxSizing:"border-box",
    };
  },[editingRow,legendRows,legendPos,svgW,legendFontSize,legendFont,t]);

  // ── Render legend (clean floating text, no box) ────────────────────────
  const renderLegend = () => {
    const lx=legendPos.x, ly=legendPos.y;
    const elements=[];
    elements.push(<rect key="drag" x={lx-4} y={ly-4} width={LEGEND_W+8} height={legendH+8} fill="transparent" style={{cursor:legendDrag?"grabbing":"move"}} onPointerDown={onLegendPointerDown}/>);
    let cy=ly;
    legendRows.forEach(row=>{
      const isEditing = editingRow===row.id;
      if (row.type==="title") {
        elements.push(<text key={row.id} x={lx} y={cy+legendFontSize} fontSize={legendFontSize} fontWeight="700" fill={isEditing?t.accent:(legendColorOverride||t.muted)} fontFamily={legendFont} style={{cursor:"pointer"}} onClick={e=>startEditingLabel(row.id,row.text,e)}>{isEditing?"editing...":row.text}</text>);
        cy += legendFontSize+8;
      } else if (row.type==="gradient") {
        elements.push(<g key="grad">
          <defs><linearGradient id="maLegGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor={gradientColor(-fcRangeMax)}/><stop offset="50%" stopColor={gradientColor(0)}/><stop offset="100%" stopColor={gradientColor(fcRangeMax)}/></linearGradient></defs>
          <text x={lx} y={cy+legendFontSize} fontSize={legendFontSize} fontWeight={legendFontWeight} fill={legendColorOverride||t.muted} fontFamily={legendFont}>log2FC</text>
          <rect x={lx} y={cy+legendFontSize+3} width={LEGEND_W} height={9} rx={3} fill="url(#maLegGrad)"/>
          <text x={lx} y={cy+legendFontSize+24} fontSize={legendFontSize-2} fill={legendColorOverride||t.muted} fontFamily={legendFont}>{(-fcRangeMax).toFixed(1)}</text>
          <text x={lx+LEGEND_W/2} y={cy+legendFontSize+24} fontSize={legendFontSize-2} fill={legendColorOverride||t.muted} fontFamily={legendFont} textAnchor="middle">0</text>
          <text x={lx+LEGEND_W} y={cy+legendFontSize+24} fontSize={legendFontSize-2} fill={legendColorOverride||t.muted} fontFamily={legendFont} textAnchor="end">{fcRangeMax.toFixed(1)}</text>
        </g>);
        cy += legendFontSize+34;
      } else if (row.type==="color") {
        elements.push(<circle key={row.id+"d"} cx={lx+legendFontSize*0.5} cy={cy+legendFontSize*0.42} r={r} fill={row.col}/>);
        elements.push(<text key={row.id+"l"} x={lx+legendFontSize+5} y={cy+legendFontSize} fontSize={legendFontSize} fontWeight={legendFontWeight} fill={isEditing?t.accent:(legendColorOverride||row.col)} fontFamily={legendFont} style={{cursor:"pointer"}} onClick={e=>startEditingLabel(row.id,row.lbl,e)}>{isEditing?"editing...":row.lbl}</text>);
        elements.push(<text key={row.id+"v"} x={lx+LEGEND_W} y={cy+legendFontSize} fontSize={legendFontSize} fontWeight="700" fill={legendColorOverride||t.text} fontFamily={legendFont} textAnchor="end">{row.val}</text>);
        cy += legendFontSize+9;
      } else if (row.type==="kv") {
        elements.push(<text key={row.id+"l"} x={lx} y={cy+legendFontSize} fontSize={legendFontSize} fontWeight={legendFontWeight} fill={isEditing?t.accent:(legendColorOverride||t.muted)} fontFamily={legendFont} style={{cursor:"pointer"}} onClick={e=>startEditingLabel(row.id,row.lbl,e)}>{isEditing?"editing...":row.lbl}</text>);
        elements.push(<text key={row.id+"v"} x={lx+LEGEND_W} y={cy+legendFontSize} fontSize={legendFontSize} fontWeight="700" fill={row.accent?t.accent:(legendColorOverride||t.text)} fontFamily={legendFont} textAnchor="end">{row.val}</text>);
        cy += legendFontSize+9;
      }
    });
    return <g key="legend">{elements}</g>;
  };

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        {[{l:"Upregulated",v:upCount,c:style.colorUp},{l:"Downregulated",v:downCount,c:style.colorDown},{l:"Not significant",v:nsCount,c:style.colorNs}].map(x=>(
          <div key={x.l} style={{background:t.panel,border:"1px solid "+t.border,borderRadius:8,padding:"6px 10px",flex:1,textAlign:"center",boxShadow:t.shadow}}>
            <div style={{fontSize:18,fontWeight:700,color:x.c}}>{x.v}</div>
            <div style={{fontSize:10,color:t.muted}}>{x.l}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,flexWrap:"wrap"}}>
        <button onClick={()=>setLabelMode(m=>!m)}
          style={{padding:"4px 14px",borderRadius:16,fontSize:11,fontWeight:600,cursor:"pointer",
            background:labelMode?"#7C3AED":"transparent",
            border:"1px solid "+(labelMode?"#7C3AED":t.border),
            color:labelMode?"#fff":t.muted}}>
          {labelMode?"Label mode ON — click a dot to label it":"Click genes to label them"}
        </button>
        {labeled.size>0&&<button onClick={()=>setLabeled(new Set())} style={{padding:"4px 10px",borderRadius:16,fontSize:11,cursor:"pointer",background:"transparent",border:"1px solid "+t.border,color:t.muted}}>Clear {labeled.size} label{labeled.size!==1?"s":""}</button>}
        {autoLabeledGenes.size>0&&<span style={{fontSize:10,color:t.muted,fontStyle:"italic"}}>+{autoLabeledGenes.size} auto-labeled</span>}
      </div>
      <div ref={svgContainerRef} style={{position:"relative",background:display.plotBg||t.panel,border:"1px solid "+t.border,borderRadius:10,padding:"10px",boxShadow:t.shadow,overflowX:"auto"}}>
        {display.plotTitle&&<div style={{textAlign:"center",marginBottom:6,fontSize:style.title.fontSize,fontWeight:style.title.fontWeight,fontStyle:style.title.fontStyle,color:style.title.color,fontFamily:style.font}}>{display.plotTitle}</div>}
        {editingRow&&<input ref={editInputRef} value={editValue} onChange={e=>setEditValue(e.target.value)} onBlur={commitLabelEdit} onKeyDown={e=>{if(e.key==="Enter")commitLabelEdit();if(e.key==="Escape")cancelLabelEdit();}} style={editInputStyle()}/>}
        <svg ref={svgRef} width={svgW} height={totalH} viewBox={"0 0 "+svgW+" "+totalH}
          style={{display:"block",width:"100%",maxWidth:svgW,height:"auto",cursor:legendDrag?"grabbing":labelMode?"crosshair":"default",overflow:"visible"}}
          onPointerMove={onSvgPointerMove} onPointerUp={onSvgPointerUp} onPointerLeave={onSvgPointerUp}>
          {display.showGrid!==false&&yTicks.map((v,i)=><line key={"gy"+i} x1={MARGIN_L} y1={scaleY(v)} x2={MARGIN_L+innerW} y2={scaleY(v)} stroke={style.gridColor} strokeWidth={style.gridWidth} strokeDasharray="4 3"/>)}
          {display.showGrid!==false&&xTicks.map((v,i)=><line key={"gx"+i} x1={scaleX(v)} y1={MARGIN_T} x2={scaleX(v)} y2={MARGIN_T+PLOT_H} stroke={style.gridColor} strokeWidth={style.gridWidth} strokeDasharray="4 3"/>)}
          {(()=>{
            const frameStyle = display.frameStyle||"open";
            const bottomY=MARGIN_T+PLOT_H, topY=MARGIN_T, leftX=MARGIN_L, rightX=MARGIN_L+innerW;
            let xa=leftX, xb=rightX, ya=topY, yb=bottomY;
            if (frameStyle==="offset") {
              xa=Math.min(scaleX(xTicks[0]),scaleX(xTicks[xTicks.length-1])); xb=Math.max(scaleX(xTicks[0]),scaleX(xTicks[xTicks.length-1]));
              ya=Math.min(scaleY(yTicks[0]),scaleY(yTicks[yTicks.length-1])); yb=Math.max(scaleY(yTicks[0]),scaleY(yTicks[yTicks.length-1]));
            }
            return (
              <g>
                <line x1={xa} y1={bottomY} x2={xb} y2={bottomY} stroke={style.axisLineColor} strokeWidth={style.axisWidth}/>
                <line x1={leftX} y1={ya} x2={leftX} y2={yb} stroke={style.axisLineColor} strokeWidth={style.axisWidth}/>
                {frameStyle==="closed"&&<line x1={leftX} y1={topY} x2={rightX} y2={topY} stroke={style.axisLineColor} strokeWidth={style.axisWidth}/>}
                {frameStyle==="closed"&&<line x1={rightX} y1={topY} x2={rightX} y2={bottomY} stroke={style.axisLineColor} strokeWidth={style.axisWidth}/>}
              </g>
            );
          })()}
          {yTicks.map((v,i)=><text key={"yt"+i} x={MARGIN_L-6} y={scaleY(v)+4} textAnchor="end" fontSize={style.tick.fontSize} fill={style.tick.fill} fontFamily={style.font}>{v.toFixed(yTk.dec)}</text>)}
          {xTicks.map((v,i)=><text key={"xt"+i} x={scaleX(v)} y={MARGIN_T+PLOT_H+16} textAnchor="middle" fontSize={style.tick.fontSize} fill={style.tick.fill} fontFamily={style.font}>{v.toFixed(xTk.dec)}</text>)}
          <text x={MARGIN_L+innerW/2} y={totalH-4} textAnchor="middle" fontSize={style.axis.fontSize} fontWeight={style.axis.fontWeight} fontStyle={style.axis.fontStyle} fill={style.axis.fill} fontFamily={style.font}>{display.xLbl||"Mean of Normalized Counts (log10)"}</text>
          <text x={12} y={MARGIN_T+PLOT_H/2} textAnchor="middle" fontSize={style.axis.fontSize} fontWeight={style.axis.fontWeight} fontStyle={style.axis.fontStyle} fill={style.axis.fill} fontFamily={style.font} transform={"rotate(-90,12,"+(MARGIN_T+PLOT_H/2)+")"}>{display.yLbl||"log2 Fold Change"}</text>
          {/* M = 0 baseline — standard MA-plot reference */}
          <line x1={MARGIN_L} y1={scaleY(0)} x2={MARGIN_L+innerW} y2={scaleY(0)} stroke={style.axisLineColor} strokeOpacity={0.55} strokeWidth={style.axisWidth*0.9}/>
          {/* Fold-change thresholds — horizontal since M (log2FC) is the y-axis */}
          <line x1={MARGIN_L} y1={scaleY(fcThreshold)} x2={MARGIN_L+innerW} y2={scaleY(fcThreshold)} stroke={style.colorUp} strokeDasharray="5 3" strokeOpacity={0.45} strokeWidth={1}/>
          <line x1={MARGIN_L} y1={scaleY(-fcThreshold)} x2={MARGIN_L+innerW} y2={scaleY(-fcThreshold)} stroke={style.colorDown} strokeDasharray="5 3" strokeOpacity={0.45} strokeWidth={1}/>
          <text x={MARGIN_L+innerW+6} y={scaleY(fcThreshold)+4} textAnchor="start" fontSize={9} fontWeight="600" fill={style.colorUp} fontFamily={style.font}>{"+"+fcThreshold}</text>
          <text x={MARGIN_L+innerW+6} y={scaleY(-fcThreshold)+4} textAnchor="start" fontSize={9} fontWeight="600" fill={style.colorDown} fontFamily={style.font}>{-fcThreshold}</text>
          {/* Transparent capture layer: hover/click are resolved against the
              spatial index, so merged dots stay interactive without handlers. */}
          <rect x={MARGIN_L} y={MARGIN_T} width={innerW} height={PLOT_H} fill="transparent"
            onMouseMove={e=>{const h=hitAt(e); setHovered(h?{...h.p,cx:h.cx,cy:h.cy}:null);}}
            onMouseLeave={()=>setHovered(null)}
            onClick={e=>{if(!labelMode)return;const h=hitAt(e);if(h)toggleLabeled(h.p.gene);}}
            style={{cursor:labelMode?"crosshair":"default"}}/>

          {plainLayers.map((L,i)=>(
            <path key={"dots"+i} d={L.d} fill={L.col} fillOpacity={plainPointOpacity} style={{pointerEvents:"none"}}/>
          ))}

          {/* LOESS trend sits above the background dots (it used to be drawn
              first and was buried under thousands of NS points); a thin white
              halo keeps it readable over dense regions. */}
          {showTrend&&trendPath&&<g style={{pointerEvents:"none"}}>
            <path d={trendPath} fill="none" stroke="#ffffff" strokeWidth={4.5} strokeOpacity={0.9} strokeLinejoin="round" strokeLinecap="round"/>
            <path d={trendPath} fill="none" stroke={trendColor} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round"/>
          </g>}

          {specialPts.map((p,i)=>{
            const col=colorForPoint(p), isManual=labeled.has(p.gene), isAuto=autoLabeledGenes.has(p.gene), isLabeled=isManual||isAuto;
            const isGeneSetHit=isInGeneSet(p.gene);
            const cx=scaleX(p.a), cy=scaleY(p.log2fc);
            const labelPos = isLabeled&&repel ? labelPositions[p.gene] : null;
            const lhome=labelPos?null:labelHome(cx,cy,p.gene.length*((style.pointLabel.fontSize||9)*0.58)+2,r,MARGIN_L+2,MARGIN_L+innerW-2);
            const lx=labelPos?labelPos.x:lhome.x, ly=labelPos?labelPos.y:lhome.y;
            return (
              <g key={"sp"+i} style={{pointerEvents:"none"}}>
                {isGeneSetHit&&<circle cx={cx} cy={cy} r={r+5} fill={geneSetColor} fillOpacity={0.15} stroke={geneSetColor} strokeWidth={1.5}/>}
                {isLabeled&&<circle cx={cx} cy={cy} r={r+4} fill={labelColor} fillOpacity={0.15} stroke={labelColor} strokeWidth={0.8} strokeOpacity={0.4}/>}
                <circle cx={cx} cy={cy} r={isGeneSetHit?r+2:r} fill={isGeneSetHit?geneSetColor:col} fillOpacity={0.9} stroke={isLabeled?labelColor:isGeneSetHit?geneSetColor:"none"} strokeWidth={isLabeled||isGeneSetHit?1.5:1}/>
                {isLabeled&&repel&&labelPos&&(()=>{
                  const tx=Math.max(labelPos.x,Math.min(cx,labelPos.x+labelPos.w)), ty=Math.max(labelPos.y-labelPos.h+1,Math.min(cy,labelPos.y+2));
                  const dl=Math.hypot(tx-cx,ty-cy); if(dl<r+7)return null;
                  const sx0=cx+(tx-cx)/dl*(r+4), sy0=cy+(ty-cy)/dl*(r+4);
                  return <line x1={sx0} y1={sy0} x2={tx} y2={ty} stroke={labelColor} strokeWidth={0.7} strokeOpacity={0.6}/>;
                })()}
                {isLabeled&&<text x={lx} y={ly} fontSize={style.pointLabel.fontSize||9} fontWeight={style.pointLabel.fontWeight} fontStyle={isAuto&&!isManual?"italic":style.pointLabel.fontStyle} fill={labelColor} fontFamily={style.font} style={{pointerEvents:"none"}}>{p.gene}</text>}
              </g>
            );
          })}

          {/* Hover highlight drawn on top, independent of the merged geometry. */}
          {hovered&&isFinite(hovered.cx)&&isFinite(hovered.cy)&&(
            <g style={{pointerEvents:"none"}}>
              <circle cx={hovered.cx} cy={hovered.cy} r={r+4} fill={colorForPoint(hovered)} fillOpacity={0.15}/>
              <circle cx={hovered.cx} cy={hovered.cy} r={isInGeneSet(hovered.gene)?r+2:r} fill={isInGeneSet(hovered.gene)?geneSetColor:colorForPoint(hovered)} fillOpacity={0.95} stroke="#fff" strokeWidth={1}/>
            </g>
          )}
          {hovered&&(()=>{
            const cx=hovered.cx, cy=hovered.cy, tx=cx>PLOT_W-165?cx-165:cx+10, ty=Math.max(MARGIN_T,cy-62);
            return (
              <g style={{pointerEvents:"none"}}>
                <rect x={tx} y={ty} width={158} height={labelMode?80:67} rx={6} fill={t.tip} stroke={t.border} strokeWidth={1}/>
                <text x={tx+9} y={ty+16} fontSize={12} fontWeight="700" fill={t.text}>{hovered.gene}</text>
                <line x1={tx+9} y1={ty+20} x2={tx+149} y2={ty+20} stroke={t.border} strokeWidth={0.5}/>
                <text x={tx+9} y={ty+33} fontSize={10} fill={t.muted}>log2FC</text>
                <text x={tx+149} y={ty+33} fontSize={10} fontWeight="600" fill={hovered.log2fc>0?style.colorUp:style.colorDown} textAnchor="end">{hovered.log2fc}</text>
                <text x={tx+9} y={ty+47} fontSize={10} fill={t.muted}>p-value</text>
                <text x={tx+149} y={ty+47} fontSize={10} fontWeight="600" fill={t.text} textAnchor="end">{(+hovered.pval).toExponential(2)}</text>
                <text x={tx+9} y={ty+61} fontSize={10} fill={t.muted}>Mean expr</text>
                <text x={tx+149} y={ty+61} fontSize={10} fontWeight="600" fill={t.text} textAnchor="end">{(+hovered.baseMean||0).toFixed(0)}</text>
                {labelMode&&<text x={tx+79} y={ty+74} fontSize={9} fill="#7C3AED" textAnchor="middle" fontStyle="italic">Click to {labeled.has(hovered.gene)?"remove":"add"} label</text>}
              </g>
            );
          })()}
          {hasLegend&&renderLegend()}
        </svg>
      </div>
    </div>
  );
}

// ─── Error boundary ─────────────────────────────────────────────────────────
// Catches render-time crashes in the plot itself (e.g. a data shape or
// settings combination the plot didn't expect) so the rest of the UI — data
// entry, tabs, settings — stays usable instead of the whole tool going to a
// blank white screen. This follows React's documented error-boundary
// contract (class component + getDerivedStateFromError/componentDidCatch).
// Note: this contract only fires during real client-side render/commit, not
// during static SSR, so — unlike the rest of this file's validation — it
// could not be proven with the SSR harness used elsewhere; it rests on
// React's documented behavior and careful review instead.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = {hasError:false, error:null}; }
  static getDerivedStateFromError(error) { return {hasError:true, error}; }
  componentDidCatch(error, info) { if (typeof console!=="undefined" && console.error) console.error("Plot render error:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{padding:"40px 24px", textAlign:"center", maxWidth:420, margin:"0 auto"}}>
          <div style={{fontSize:32, marginBottom:8}}>{"\u26A0\uFE0F"}</div>
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

// ════════════════════════════════════════════════════════════════════════════
// Main App
// ════════════════════════════════════════════════════════════════════════════
export default function MAPlotPage() {
  const activeTheme = useTheme(); // live theme from the app shell
  const [layout,setLayout]=useState("split");
  const [rightTab,setRightTab]=useState("stats");
  const plotRef=useRef(null);
  const LEGEND_TOP=30;

  const [sheets,setSheets]=useState(()=>[mkSheet("MA Plot 1")]);
  const [activeId,setActiveId]=useState(()=>sheets[0].id);
  const activeSheet=sheets.find(s=>s.id===activeId)||sheets[0];

  const historyMap=useRef({}), cursorMap=useRef({});
  const [,forceUpdate]=useState(0);
  useEffect(()=>{ if(!historyMap.current[activeSheet.id]){ historyMap.current[activeSheet.id]=[activeSheet.rows]; cursorMap.current[activeSheet.id]=0; } },[activeSheet.id]);
  const getHistory=id=>historyMap.current[id]||(historyMap.current[id]=[]);
  const getCursor =id=>cursorMap.current[id]!==undefined?cursorMap.current[id]:0;

  const setRows=useCallback(fn=>{
    const id=activeId, hist=getHistory(id), cursor=getCursor(id), prevRows=hist[cursor]||[];
    const nextRows = typeof fn==="function" ? fn(prevRows) : fn;
    historyMap.current[id]=[...hist.slice(0,cursor+1), nextRows].slice(-50);
    cursorMap.current[id]=historyMap.current[id].length-1;
    setSheets(ss=>ss.map(s=>s.id===id?{...s,rows:nextRows}:s));
    forceUpdate(v=>v+1);
  },[activeId]);

  const undo=useCallback(()=>{
    const id=activeId, cursor=getCursor(id); if(cursor<=0) return;
    cursorMap.current[id]=cursor-1;
    setSheets(ss=>ss.map(s=>s.id===id?{...s,rows:getHistory(id)[cursor-1]||[]}:s));
    forceUpdate(v=>v+1);
  },[activeId]);

  const redo=useCallback(()=>{
    const id=activeId, cursor=getCursor(id), hist=getHistory(id); if(cursor>=hist.length-1) return;
    cursorMap.current[id]=cursor+1;
    setSheets(ss=>ss.map(s=>s.id===id?{...s,rows:hist[cursor+1]||[]}:s));
    forceUpdate(v=>v+1);
  },[activeId]);

  const canUndo=getCursor(activeId)>0, canRedo=getCursor(activeId)<getHistory(activeId).length-1;

  const setDisplay = useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,display:typeof fn==="function"?fn(s.display):fn}:s)),[activeId]);
  const setStats   = useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,stats:typeof fn==="function"?fn(s.stats):fn}:s)),[activeId]);
  const setGeneSet = useCallback(v=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,geneSet:v}:s)),[activeId]);
  const setGeneSetColor = useCallback(v=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,geneSetColor:v}:s)),[activeId]);

  const newSheet = name => {
    const sh=mkSheet(name);
    historyMap.current[sh.id]=[sh.rows]; cursorMap.current[sh.id]=0;
    setSheets(ss=>[...ss,sh]); setActiveId(sh.id);
  };
  const selectSheet = id => {
    if (!historyMap.current[id]) { const sh=sheets.find(s=>s.id===id); historyMap.current[id]=[sh?sh.rows:[]]; cursorMap.current[id]=0; }
    setActiveId(id);
  };
  const renameSheet = (id,name) => setSheets(ss=>ss.map(s=>s.id===id?{...s,name}:s));
  const duplicateSheet = id => {
    const src=sheets.find(s=>s.id===id); if(!src) return;
    const sh={...JSON.parse(JSON.stringify(src)), id:Date.now()+Math.random(), name:src.name+" (copy)"};
    historyMap.current[sh.id]=[sh.rows]; cursorMap.current[sh.id]=0;
    setSheets(ss=>[...ss,sh]); setActiveId(sh.id);
  };
  const deleteSheet = id => {
    if (sheets.length<=1) return;
    const remaining=sheets.filter(s=>s.id!==id);
    setSheets(remaining);
    if (activeId===id) setActiveId(remaining[remaining.length-1].id);
  };

  const saveProject = useCallback(()=>{
    downloadBlob(new Blob([JSON.stringify({version:1,tool:"ma-plot",sheets},null,2)],{type:"application/json;charset=utf-8"}), "ma_plot_project_"+new Date().toISOString().slice(0,10)+".json"); /* blob download: data: URLs fail silently past ~2MB / in Firefox */
  },[sheets]);

  const loadProject = data => {
    if (!data || !data.sheets || !data.sheets.length) return;
    setSheets(data.sheets); setActiveId(data.sheets[0].id);
    data.sheets.forEach(s=>{ historyMap.current[s.id]=[s.rows]; cursorMap.current[s.id]=0; });
    forceUpdate(v=>v+1);
  };

  useEffect(()=>{
    const handler = e => {
      if ((e.ctrlKey||e.metaKey) && !e.shiftKey && e.key==="z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey||e.metaKey) && (e.key==="y" || (e.shiftKey && e.key==="z"))) { e.preventDefault(); redo(); }
      if ((e.ctrlKey||e.metaKey) && e.key==="s") { e.preventDefault(); saveProject(); }
    };
    window.addEventListener("keydown",handler);
    return ()=>window.removeEventListener("keydown",handler);
  },[undo,redo,saveProject]);

  const {rows,display,stats,geneSet,geneSetColor} = activeSheet;

  const geneSetParsed = useMemo(()=>{
    if (!geneSet || !geneSet.trim()) return new Set();
    return new Set(geneSet.split(/[\n,;\s]+/).map(g=>g.trim().toUpperCase()).filter(Boolean));
  },[geneSet]);

  const plotData = useMemo(()=>{
    const filled = rows.filter(r=>Object.values(r).some(v=>v!==""&&v!=null));
    if (filled.length>=2) return filled.map(r=>({gene:String(r.gene||"?"), baseMean:+r.baseMean||0, log2fc:+r.log2fc||0, pval:+r.pval||1}));
    return EXAMPLE_DATA;
  },[rows]);

  const sigGenes = useMemo(()=>{
    const nlpCutoff = pToNlp(stats.pThreshold||0.05), fcThresh = stats.fcThreshold||1;
    return plotData
      .map(r=>({...r, nlp:pToNlp(r.pval)}))
      .filter(r=>r.nlp>=nlpCutoff && Math.abs(r.log2fc)>=fcThresh)
      .map(r=>({gene:r.gene, baseMean:r.baseMean, log2fc:r.log2fc, pval:r.pval, nlp:r.nlp, group:r.log2fc>fcThresh?"UP":"DOWN"}))
      .sort((a,b)=>b.nlp-a.nlp);
  },[plotData, stats.pThreshold, stats.fcThreshold]);

  const filledCount = rows.filter(r=>Object.values(r).some(v=>v!==""&&v!=null)).length;

  const [legendVisible,setLegendVisible]=useState(()=>{ const m={}; LEGEND_ITEMS.forEach(x=>{m[x.id]=true;}); return m; });
  const [legendStyle,setLegendStyle]=useState({fontSize:11,bold:false,color:""});
  const [legendPos,setLegendPos]=useState({x:548,y:LEGEND_TOP});
  const [labeled,setLabeled]=useState(new Set());

  const TABS=[{id:"stats",icon:"\uD83D\uDCCA",label:"Stats"},{id:"style",icon:"\uD83C\uDFA8",label:"Style"},{id:"axes",icon:"\uD83D\uDCD0",label:"Axes"},{id:"legend",icon:"\uD83D\uDCCB",label:"Legend"},{id:"export",icon:"\u2B07",label:"Export"}];

  return (
      <div style={{height:"100%",background:activeTheme.bg,color:activeTheme.text,fontFamily:"Inter,system-ui,sans-serif",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"0 16px",borderBottom:"1px solid "+activeTheme.border,background:activeTheme.panel,display:"flex",alignItems:"center",gap:12,flexShrink:0,height:48,boxShadow:activeTheme.shadow}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>📊</span>
            
            <span style={{fontSize:11,color:activeTheme.muted,padding:"2px 8px",borderRadius:10,background:activeTheme.panel2,border:"1px solid "+activeTheme.border}}>MA Plot</span>
          </div>
          <div style={{height:20,width:1,background:activeTheme.border}}/>
          <span style={{fontSize:12,fontWeight:600,color:activeTheme.muted}}>{activeSheet.name}</span>
          <div style={{flex:1}}/>
        <CloudProjects tool="ma" getData={()=>({version:1,tool:"ma-plot",sheets})} onLoad={loadProject}/>
          <div style={{display:"flex",background:activeTheme.panel2,borderRadius:8,padding:2,border:"1px solid "+activeTheme.border}}>
            {[["split","Split"],["sheet","Data"],["plot","Plot"]].map(([id,lb])=>(
              <button key={id} onClick={()=>setLayout(id)} style={{padding:"4px 12px",fontSize:11,fontWeight:600,cursor:"pointer",borderRadius:6,border:"none",background:layout===id?activeTheme.panel:"transparent",color:layout===id?activeTheme.text:activeTheme.muted,boxShadow:layout===id?activeTheme.shadow:"none"}}>{lb}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:3}}>
            <button onClick={undo} disabled={!canUndo} title="Ctrl+Z" style={{padding:"4px 10px",borderRadius:6,fontSize:11,background:"transparent",border:"1px solid "+activeTheme.border,cursor:canUndo?"pointer":"default",color:canUndo?activeTheme.text:activeTheme.muted}}>Undo</button>
            <button onClick={redo} disabled={!canRedo} title="Ctrl+Y" style={{padding:"4px 10px",borderRadius:6,fontSize:11,background:"transparent",border:"1px solid "+activeTheme.border,cursor:canRedo?"pointer":"default",color:canRedo?activeTheme.text:activeTheme.muted}}>Redo</button>
          </div>
        </div>
        <div style={{flex:1,display:"flex",minHeight:0,overflow:"hidden"}}>
          <SheetSidebar sheets={sheets} activeId={activeId} onSelect={selectSheet} onNew={newSheet} onRename={renameSheet} onDuplicate={duplicateSheet} onDelete={deleteSheet} onSave={saveProject} onLoad={loadProject}/>
          <div style={{flex:1,display:"flex",minWidth:0,overflow:"hidden"}}>
            {(layout==="split"||layout==="sheet")&&(
              <div style={{flex:1,overflowY:"auto",padding:"16px 18px",borderRight:layout==="split"?"1px solid "+activeTheme.border:"none"}}>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:15,fontWeight:700,color:activeTheme.text}}>{activeSheet.name}</div>
                  <div style={{fontSize:11,color:activeTheme.muted,marginTop:2}}>Enter mean expression and fold-change results, or paste directly from DESeq2 (baseMean, log2FoldChange, pvalue), edgeR, or limma output.</div>
                </div>
                <DataSheet rows={rows} setRows={setRows} undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo}/>
                {layout==="sheet"&&<div style={{marginTop:18,display:"flex",justifyContent:"center"}}><button onClick={()=>setLayout("plot")} style={{padding:"10px 32px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",background:activeTheme.accent,border:"none",color:"#fff",boxShadow:activeTheme.shadow}}>Generate Plot</button></div>}
              </div>
            )}
            {(layout==="split"||layout==="plot")&&(
              <div style={{flex:1,overflowY:"auto",padding:"16px 18px",minWidth:0}} ref={plotRef}>
                {/* Figure always on white paper with the light palette (see VolcanoPlot). */}
                <ThemeCtx.Provider value={LIGHT}>
                <ErrorBoundary>
                  <MAPlot data={plotData} stats={stats} display={display} geneSetParsed={geneSetParsed} geneSetColor={geneSetColor||"#7C3AED"} legendVisible={legendVisible} legendStyle={legendStyle} legendPos={legendPos} setLegendPos={setLegendPos} labeled={labeled} setLabeled={setLabeled}/>
                </ErrorBoundary>
                </ThemeCtx.Provider>
                <div style={{marginTop:6,fontSize:11,color:activeTheme.muted,textAlign:"center"}}>{filledCount} rows · {sheets.length} sheet{sheets.length!==1?"s":""} · Ctrl+S to save</div>
                {layout==="plot"&&<div style={{marginTop:10,textAlign:"center"}}><button onClick={()=>setLayout("sheet")} style={{padding:"5px 14px",borderRadius:6,fontSize:12,cursor:"pointer",background:"transparent",border:"1px solid "+activeTheme.border,color:activeTheme.muted}}>Back to data</button></div>}
              </div>
            )}
          </div>
          <div style={{width:242,background:activeTheme.panel,borderLeft:"1px solid "+activeTheme.border,display:"flex",flexDirection:"column",flexShrink:0}}>
            <div style={{display:"flex",borderBottom:"1px solid "+activeTheme.border,background:activeTheme.panel2}}>
              {TABS.map(tab=>(
                <button key={tab.id} onClick={()=>setRightTab(tab.id)} style={{flex:1,padding:"8px 2px 6px",fontSize:9,fontWeight:700,cursor:"pointer",border:"none",background:"transparent",color:rightTab===tab.id?activeTheme.accent:activeTheme.muted,borderBottom:"2px solid "+(rightTab===tab.id?activeTheme.accent:"transparent"),display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  <span style={{fontSize:14}}>{tab.icon}</span>{tab.label}
                </button>
              ))}
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"14px 12px"}}>
              {rightTab==="stats"&&<SignificancePanel stats={stats} setStats={setStats} geneSet={geneSet||""} setGeneSet={setGeneSet} geneSetColor={geneSetColor||"#7C3AED"} setGeneSetColor={setGeneSetColor} geneSetCount={geneSetParsed.size} labeled={labeled} setLabeled={setLabeled} sigGenes={sigGenes} totalN={plotData.length}/>}
              {rightTab==="style"&&<StylePanel display={display} setDisplay={setDisplay}/>}
              {rightTab==="axes"&&<AxesPanel display={display} setDisplay={setDisplay} stats={stats} setStats={setStats}/>}
              {rightTab==="legend"&&<LegendPanel legendVisible={legendVisible} setLegendVisible={setLegendVisible} legendStyle={legendStyle} setLegendStyle={setLegendStyle} legendPos={legendPos} setLegendPos={setLegendPos} topMargin={LEGEND_TOP}/>}
              {rightTab==="export"&&<ExportPanel plotRef={plotRef} display={display} rows={rows}/>}
            </div>
            <div style={{padding:"6px 12px",borderTop:"1px solid "+activeTheme.border,fontSize:10,color:activeTheme.muted,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span>{filledCount} rows</span>
              <span style={{color:sigGenes.length>0?activeTheme.accent:activeTheme.muted}}>{sigGenes.length} sig genes</span>
              <span>Ctrl+S</span>
            </div>
          </div>
        </div>
      </div>
  );
}
