import React, { useState, useMemo, useRef, useCallback, useEffect, useContext } from "react";
import { ThemeCtx, useTheme, LIGHT } from "../shared/theme";
import CloudProjects from "../shared/CloudProjects";

// ════════════════════════════════════════════════════════════════════════════
// Omilytix — Expression Heatmap
// Reuses the same genes×samples matrix input as PCA Plot. Adds hierarchical
// clustering (UPGMA, validated against a textbook worked example) on rows
// and/or columns, dendrograms, per-gene Z-score normalization, and a
// multi-scale color-mapped grid with a sample-group annotation bar.
//
// Sample grouping is dropdown-driven rather than freeform text: a group only
// ever enters state via an explicit "+ New group" confirmation or an atomic
// rename-everywhere action, never via partial keystrokes. This is a deliberate
// fix for a prior bug where typing a group name letter-by-letter left every
// intermediate string ("C", "Co", "Con"...) permanently in the color legend.
// ════════════════════════════════════════════════════════════════════════════

// ─── Design tokens (shared across the Omilytix suite) ─────────────────────────
// Theme tokens live in src/shared/theme.js (shared with the app shell).
const FONTS = ["Inter","Arial","Helvetica","Times New Roman","Georgia","Courier New"];
const GROUP_PALETTE = ["#2563EB","#DC2626","#16A34A","#D97706","#7C3AED","#DB2777","#0891B2","#65A30D","#B91C1C","#4338CA"];

// ─── Color scales ───────────────────────────────────────────────────────────────
const COLOR_SCALES = {
  RdBu:    {type:"diverging", stops:[[0,"#2563EB"],[0.5,"#F7F7F7"],[1,"#DC2626"]]},
  RdYlBu:  {type:"diverging", stops:[[0,"#3B82F6"],[0.5,"#FEF9C3"],[1,"#DC2626"]]},
  Spectral:{type:"diverging", stops:[[0,"#3B82F6"],[0.25,"#5EEAD4"],[0.5,"#FEF9C3"],[0.75,"#FDBA74"],[1,"#DC2626"]]},
  Viridis: {type:"sequential",stops:[[0,"#440154"],[0.33,"#31688E"],[0.66,"#35B779"],[1,"#FDE725"]]},
  Blues:   {type:"sequential",stops:[[0,"#F7FBFF"],[1,"#08306B"]]},
  Greens:  {type:"sequential",stops:[[0,"#F7FCF5"],[1,"#00441B"]]},
};
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1),16);
  return [(n>>16)&255,(n>>8)&255,n&255];
}
function interpColor(scaleName, t) {
  const scale = COLOR_SCALES[scaleName] || COLOR_SCALES.RdBu;
  const stops = scale.stops;
  const tc = Math.max(0,Math.min(1,t));
  let lo = stops[0], hi = stops[stops.length-1];
  for (let i=0;i<stops.length-1;i++) {
    if (tc>=stops[i][0] && tc<=stops[i+1][0]) { lo=stops[i]; hi=stops[i+1]; break; }
  }
  const span = hi[0]-lo[0] || 1;
  const localT = (tc-lo[0])/span;
  const c1=hexToRgb(lo[1]), c2=hexToRgb(hi[1]);
  const r = Math.round(c1[0]+(c2[0]-c1[0])*localT);
  const g = Math.round(c1[1]+(c2[1]-c1[1])*localT);
  const b = Math.round(c1[2]+(c2[2]-c1[2])*localT);
  return "rgb("+r+","+g+","+b+")";
}

// ─── Example expression matrix (8 samples, 2 groups, 40 genes) ────────────────
function buildExampleMatrix() {
  const sampleNames = ["Ctrl_1","Ctrl_2","Ctrl_3","Ctrl_4","Treat_1","Treat_2","Treat_3","Treat_4"];
  const nGenes = 40;
  let seed = 42;
  const rand = () => { seed = (seed*1103515245+12345) & 0x7fffffff; return seed/0x7fffffff; };
  const geneNames = Array.from({length:nGenes}, (_,i)=>"Gene_"+String(i+1).padStart(3,"0"));
  const values = geneNames.map((_,gi)=>{
    const isDE = gi < 20;
    const base = 50 + rand()*400;
    return sampleNames.map((s,si)=>{
      const isTreat = si>=4;
      const shift = isDE ? (isTreat ? base*0.9 : -base*0.5) : 0;
      const noise = (rand()-0.5)*base*0.15;
      return Math.max(1, Math.round(base + shift + noise));
    });
  });
  return {sampleNames, geneNames, values};
}

// ─── Matrix parsing (used by the "advanced" bulk-paste import path) ───────────
function parseNumericCell(raw, delim) {
  const s = raw.trim();
  if (s === "") return {value:0, blank:true, bad:false};
  let candidate = s;
  if (delim !== "," && /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) candidate = s.replace(/,/g,"");
  const isValidNumber = /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(candidate);
  if (!isValidNumber) return {value:0, blank:false, bad:true};
  return {value:parseFloat(candidate), blank:false, bad:false};
}
// Validated against: comma thousand-separators ("1,234"->1234, previously
// silently corrupted to 1 by naive parseFloat), garbage-suffix cells ("10abc"
// now flagged bad instead of silently truncated to 10), scientific notation,
// ragged/short rows, extra columns beyond the header, duplicate sample names,
// and headers with no sample columns at all — all now surfaced as warnings
// instead of failing silently.
function parseMatrixText(text) {
  const lines = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").trim().split("\n").filter(l=>l.trim());
  if (lines.length < 2) return {sampleNames:[], geneNames:[], values:[], warnings:["Need a header row plus at least one gene row."]};
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const header = lines[0].split(delim).map(c=>c.trim());
  const sampleNames = header.slice(1).filter(Boolean);
  if (sampleNames.length===0) return {sampleNames:[], geneNames:[], values:[], warnings:["No sample columns detected in the header row — check that it's tab- or comma-separated with a sample name in each column after the first."]};
  const geneNames = [], values = [];
  const warnings = [];
  let badCells=0, shortRows=0, extraCols=0;
  const seenNames = new Set(), dupeNames = new Set();
  sampleNames.forEach(s=>{ if (seenNames.has(s)) dupeNames.add(s); seenNames.add(s); });
  for (let i=1; i<lines.length; i++) {
    const cells = lines[i].split(delim);
    const gene = (cells[0]||"").trim();
    if (!gene) continue;
    if (cells.length-1 < sampleNames.length) shortRows++;
    if (cells.length-1 > sampleNames.length) extraCols++;
    const row = sampleNames.map((_,si)=>{
      const cell = parseNumericCell(cells[si+1]||"", delim);
      if (cell.bad) badCells++;
      return cell.value;
    });
    geneNames.push(gene);
    values.push(row);
  }
  if (badCells>0) warnings.push(badCells+" non-numeric cell(s) were read as 0.");
  if (shortRows>0) warnings.push(shortRows+" row(s) had fewer values than sample columns — missing cells were filled with 0.");
  if (extraCols>0) warnings.push(extraCols+" row(s) had more values than sample columns — the extra cell(s) were ignored.");
  if (dupeNames.size>0) warnings.push("Duplicate sample name(s) found: "+[...dupeNames].join(", ")+" — group assignment and plotting key on sample name, so duplicates may overwrite each other unexpectedly.");
  return {sampleNames, geneNames, values, warnings};
}

// ─── Statistics: Z-score, distances, UPGMA clustering ──────────────────────────
// Z-score uses sample variance (n-1 denominator), matching R's scale(). A
// constant row (zero variance) is mapped to all zeros rather than NaN/Infinity.
// Validated: mean(z)=0, var(z)=1 on synthetic data.
function zscoreRow(row) {
  const n = row.length;
  const mean = row.reduce((s,v)=>s+v,0)/n;
  const variance = row.reduce((s,v)=>s+(v-mean)*(v-mean),0)/Math.max(1,n-1);
  const sd = Math.sqrt(variance);
  if (sd < 1e-12) return row.map(()=>0);
  return row.map(v=>(v-mean)/sd);
}
function euclideanDist(a,b) { let s=0; for (let i=0;i<a.length;i++) { const d=a[i]-b[i]; s+=d*d; } return Math.sqrt(s); }
function correlationDist(a,b) {
  const n=a.length;
  const ma=a.reduce((s,v)=>s+v,0)/n, mb=b.reduce((s,v)=>s+v,0)/n;
  let num=0,da=0,db=0;
  for (let i=0;i<n;i++) { const xa=a[i]-ma, xb=b[i]-mb; num+=xa*xb; da+=xa*xa; db+=xb*xb; }
  const denom=Math.sqrt(da*db)||1e-12;
  return 1-num/denom;
}

// UPGMA (average-linkage) agglomerative hierarchical clustering. Validated
// against a textbook worked example (5-point matrix, known merge order and
// heights, cross-checked against a brute-force full pairwise average) and a
// synthetic well-separated-pairs case.
function upgma(points, distFn) {
  const n = points.length;
  if (n<2) return {root:{leaf:0}, merges:[]};
  let clusters = points.map((p,i)=>({id:i, size:1, node:{leaf:i}}));
  let dist = {};
  const key=(a,b)=> a<b ? a+","+b : b+","+a;
  for (let i=0;i<n;i++) for (let j=i+1;j<n;j++) dist[key(i,j)] = distFn(points[i],points[j]);
  let nextId = n;
  const merges=[];
  while (clusters.length>1) {
    let bestD=Infinity, bi=-1, bj=-1;
    for (let i=0;i<clusters.length;i++) for (let j=i+1;j<clusters.length;j++) {
      const d = dist[key(clusters[i].id,clusters[j].id)];
      if (d<bestD) { bestD=d; bi=i; bj=j; }
    }
    const A=clusters[bi], B=clusters[bj];
    const newId=nextId++;
    const newSize=A.size+B.size;
    const newNode={left:A.node, right:B.node, height:bestD, size:newSize};
    merges.push({a:A.id,b:B.id,height:bestD,newId});
    const rest = clusters.filter((_,idx)=>idx!==bi&&idx!==bj);
    rest.forEach(C=>{
      const dA=dist[key(A.id,C.id)], dB=dist[key(B.id,C.id)];
      dist[key(newId,C.id)] = (A.size*dA+B.size*dB)/newSize;
    });
    clusters=[...rest,{id:newId,size:newSize,node:newNode}];
  }
  return {root:clusters[0].node, merges};
}
function leafOrder(node) {
  if (node.leaf!==undefined) return [node.leaf];
  return [...leafOrder(node.left), ...leafOrder(node.right)];
}
// Assigns {pos,height} to every node for dendrogram rendering. Validated:
// leaf positions are exactly {0..n-1} with no gaps/dupes, and node heights
// increase monotonically toward the root (required for a non-crossing tree).
function layoutDendrogram(node, leafPosMap) {
  if (node.leaf!==undefined) return {pos:leafPosMap[node.leaf], height:0, leaf:node.leaf};
  const L=layoutDendrogram(node.left,leafPosMap), R=layoutDendrogram(node.right,leafPosMap);
  return {pos:(L.pos+R.pos)/2, height:node.height, left:L, right:R};
}
function collectSegments(n, segs=[]) {
  if (n.leaf!==undefined) return segs;
  segs.push({type:"h", pos1:n.left.pos, pos2:n.right.pos, height:n.height});
  segs.push({type:"v", pos:n.left.pos, h1:n.left.height, h2:n.height});
  segs.push({type:"v", pos:n.right.pos, h1:n.right.height, h2:n.height});
  collectSegments(n.left,segs); collectSegments(n.right,segs);
  return segs;
}

// ─── Style resolver ─────────────────────────────────────────────────────────────
function resolveStyles(display, theme) {
  const font = display.ff || "Inter";
  return {
    font,
    title:{fontSize:display.titleSize||14, fontWeight:display.titleBold?"bold":"normal", fontStyle:display.titleItalic?"italic":"normal", color:display.titleColor||theme.text, fontFamily:font},
    tickSize: display.tickSize||9,
    labelSize: display.labelSize||9,
    axisLineColor: theme.text,
  };
}

// ─── Defaults ───────────────────────────────────────────────────────────────────
const DEFAULT_DISPLAY = {
  ff:"Inter", plotTitle:"",
  titleSize:14, titleBold:true, titleItalic:false, titleColor:"",
  tickSize:9, labelSize:9,
  showGeneLabels:true, showSampleLabels:true, showBorder:true,
};
const DEFAULT_STATS = {
  zscore:true, log2Transform:true, topVarGenes:50,
  clusterRows:true, clusterCols:true, distanceMetric:"euclidean",
  colorScale:"RdBu", clipSD:2.5,
};

// ─── Sheet model ────────────────────────────────────────────────────────────
// One sheet = one complete dataset (matrix + grouping + styling + settings).
// Sheets are independent; the sidebar switches between them and Save Project
// writes them all into a single file.
const EMPTY_MATRIX = {sampleNames:[], geneNames:[], values:[]};

function mkSheet(name) {
  return {
    id: Date.now()+Math.random(), name,
    matrix: {sampleNames:[], geneNames:[], values:[]},
    sampleGroups: {}, groupColors: {},
    display: {...DEFAULT_DISPLAY}, stats: {...DEFAULT_STATS},
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
function Divider() { const t=useTheme(); return <div style={{height:1, background:t.border, margin:"12px 0"}}/>; }
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

// ─── Matrix grid (spreadsheet-style input, same model as PCA Plot) ────────────
function blankMatrixRow(nSamples) { return new Array(nSamples).fill(0); }

// Max grid rows given DOM nodes at once. Rendering a full RNA-seq matrix as
// live inputs is what locks the tab, not holding it in memory.
const GRID_ROW_CAP = 300;

// ─── File import ────────────────────────────────────────────────────────────
// Turns a dropped CSV/TSV/XLSX into a preview the user confirms before it
// replaces the grid. Nothing is inserted silently: real omics exports carry
// metadata rows, ID columns and Excel's gene-symbol damage, and all of that is
// easier to catch in a preview than to undo afterwards.

// Split one delimited line, honouring "quoted, fields" and "" escapes.
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
  let m=s.match(new RegExp("^(\\d{1,2})-("+MONTHS+")$","i"));          // "9-Sep"
  if (!m) { const m2=s.match(new RegExp("^("+MONTHS+")-(\\d{1,2})$","i")); if (m2) m=[m2[0],m2[2],m2[1]]; } // "Sep-15"
  if (m) {
    const fam=MONTH_TO_FAMILY[m[2].toLowerCase()];
    return fam ? {kind:"date", suggested:fam+m[1]} : {kind:"date", suggested:null};
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return {kind:"date", suggested:null};
  if (/^\d+(\.\d+)?E\+\d+$/i.test(s)) return {kind:"sci", suggested:null};   // Ensembl ID eaten as a float
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

// rows -> matrix, taking row 0 as sample headers and column 0 as gene IDs.
function rowsToMatrix(rows, delim, headerRow, idCol) {
  const hdr=rows[headerRow]||[];
  const sampleNames=hdr.slice(idCol+1).map((h,i)=>h.trim()||("Sample"+(i+1)));
  const geneNames=[], values=[];
  let badCells=0;
  for (let r=headerRow+1;r<rows.length;r++) {
    const row=rows[r];
    if (!row || row.every(c=>c.trim()==="")) continue;
    geneNames.push((row[idCol]||"").trim());
    const vals=[];
    for (let c=0;c<sampleNames.length;c++) {
      const cell=parseNumericCell(row[idCol+1+c]!==undefined?row[idCol+1+c]:"", delim);
      if (cell.bad) badCells++;
      vals.push(cell.value);
    }
    values.push(vals);
  }
  return {sampleNames, geneNames, values, badCells};
}

function FileImport({onImport, onClose}) {
  const t=useTheme();
  const [drag,setDrag]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  const [parsed,setParsed]=useState(null);   // {rows, delim, fileName, sheetNames, activeSheet, workbook}
  const [headerRow,setHeaderRow]=useState(0);
  const [idCol,setIdCol]=useState(0);
  const [repair,setRepair]=useState(true);
  const inputRef=useRef(null);

  const ingestRows=(rows,delim,fileName,extra)=>{
    if (!rows.length) { setError("That file didn't contain any readable rows."); return; }
    setParsed({rows, delim, fileName, ...(extra||{})});
    setHeaderRow(0); setIdCol(0); setError(null);
  };

  const readFile = async file => {
    setError(null); setBusy(true);
    try {
      const isXlsx=/\.(xlsx|xlsm|xls)$/i.test(file.name);
      if (isXlsx) {
        let XLSX;
        try { XLSX = await import(/* @vite-ignore */ "xlsx"); }
        catch(_) {
          setError("Excel support needs the SheetJS library, which isn't installed. Install it from the SheetJS CDN (npm i --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz) — the copy on the npm registry is stale and unpatched. In the meantime, Save As → CSV in Excel works today.");
          setBusy(false); return;
        }
        const buf=await file.arrayBuffer();
        const wb=XLSX.read(buf,{type:"array"});
        const first=wb.SheetNames[0];
        const rows=XLSX.utils.sheet_to_json(wb.Sheets[first],{header:1,blankrows:false,raw:true})
                    .map(r=>r.map(c=>c===undefined||c===null?"":String(c)));
        ingestRows(rows,"\t",file.name,{sheetNames:wb.SheetNames, activeSheet:first, workbook:wb, XLSX});
      } else {
        const text=await file.text();
        const {rows,delim}=parseDelimitedText(text);
        ingestRows(rows,delim,file.name);
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
    setHeaderRow(0); setIdCol(0);
  };

  const built = useMemo(()=>{
    if (!parsed) return null;
    const m=rowsToMatrix(parsed.rows, parsed.delim, headerRow, idCol);
    return {...m, scan:scanGeneNames(m.geneNames)};
  },[parsed, headerRow, idCol]);

  const doImport = () => {
    if (!built) return;
    let geneNames=[...built.geneNames];
    if (repair) built.scan.dates.forEach(d=>{ if(d.suggested) geneNames[d.i]=d.suggested; });
    const warnings=[];
    if (built.badCells>0) warnings.push(built.badCells+" cell(s) weren't numeric and were set to 0.");
    const unrepaired=built.scan.dates.filter(d=>!d.suggested||!repair).length;
    if (unrepaired>0) warnings.push(unrepaired+" gene name(s) still look like dates — check them against your source file.");
    if (built.scan.sci.length>0) warnings.push(built.scan.sci.length+" gene ID(s) look like Excel turned them into scientific notation (e.g. 2310009E13). These can't be recovered automatically.");
    if (built.scan.dupes.length>0) warnings.push(built.scan.dupes.length+" duplicate gene name(s), e.g. "+built.scan.dupes.slice(0,3).join(", ")+".");
    onImport({sampleNames:built.sampleNames, geneNames, values:built.values}, warnings);
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
          <div style={{fontSize:12, fontWeight:600, color:t.text, marginBottom:3}}>{busy?"Reading…":"Drop a file here, or click to browse"}</div>
          <div style={{fontSize:10.5, color:t.muted}}>CSV, TSV, or TXT · Excel .xlsx if SheetJS is installed</div>
        </div>
        <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,.tab,.xlsx,.xlsm,.xls" style={{display:"none"}}
          onChange={e=>{const f=e.target.files[0];if(f)readFile(f);e.target.value="";}}/>
        {error&&<div style={{marginTop:9, fontSize:11, lineHeight:1.6, padding:"8px 10px", borderRadius:6, background:"#FEE2E2", color:"#991B1B", border:"1px solid #FCA5A5"}}>{error}</div>}
      </div>
    );
  }

  const previewRows=parsed.rows.slice(0,7);
  const previewCols=Math.min(Math.max(...previewRows.map(r=>r.length)), 7);
  const {scan}=built;
  const repairable=scan.dates.filter(d=>d.suggested);
  const importable=built.geneNames.length>0 && built.sampleNames.length>0;

  return (
    <div style={{...boxBase, padding:14, marginBottom:10}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
        <span style={{fontSize:12, fontWeight:700, color:t.text}}>{parsed.fileName}</span>
        <button onClick={onClose} style={{background:"transparent", border:"none", cursor:"pointer", fontSize:15, color:t.muted}}>×</button>
      </div>

      <div style={{fontSize:10.5, color:t.muted, marginBottom:9}}>
        {parsed.rows.length} rows · delimiter {parsed.delim==="\t"?"tab":parsed.delim===","?"comma":parsed.delim===";"?"semicolon":parsed.delim} · will import as <strong style={{color:t.text}}>{built.geneNames.length} genes × {built.sampleNames.length} samples</strong>
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

      <div style={{border:"1px solid "+t.cBorder, borderRadius:6, overflow:"auto", maxHeight:170, marginBottom:9, background:t.cBg}}>
        <table style={{borderCollapse:"collapse", fontSize:10.5, width:"max-content", minWidth:"100%"}}>
          <tbody>
            {previewRows.map((row,ri)=>{
              const isHeader=ri===headerRow, isSkipped=ri<headerRow;
              return (
                <tr key={ri} style={{background:isHeader?t.cSel:"transparent", opacity:isSkipped?0.4:1}}>
                  <td style={{padding:"3px 7px", color:t.muted, borderRight:"1px solid "+t.cBorder, borderBottom:"1px solid "+t.cBorder, whiteSpace:"nowrap"}}>
                    <button onClick={()=>setHeaderRow(ri)} title="Use this row as the sample header"
                      style={{background:"transparent", border:"none", cursor:"pointer", color:isHeader?t.accent:t.muted, fontSize:10, fontWeight:isHeader?700:400, padding:0}}>
                      {isHeader?"header ▸":ri+1}
                    </button>
                  </td>
                  {Array.from({length:previewCols}).map((_,ci)=>(
                    <td key={ci} onClick={()=>ri===headerRow&&setIdCol(ci)}
                      title={ri===headerRow?"Use this column as the gene ID":""}
                      style={{padding:"3px 8px", borderRight:"1px solid "+t.cBorder, borderBottom:"1px solid "+t.cBorder,
                        whiteSpace:"nowrap", maxWidth:120, overflow:"hidden", textOverflow:"ellipsis",
                        cursor:ri===headerRow?"pointer":"default",
                        color:ci===idCol?t.accent:t.text, fontWeight:(isHeader||ci===idCol)?600:400,
                        background:ci===idCol&&!isHeader?t.tag:"transparent"}}>
                      {row[ci]!==undefined?row[ci]:""}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{fontSize:10, color:t.muted, marginBottom:9}}>
        Click a row number to set the header row; click a header cell to set the gene ID column.
      </div>

      {(repairable.length>0||scan.dates.length>0)&&(
        <div style={{fontSize:11, lineHeight:1.6, padding:"9px 11px", borderRadius:6, marginBottom:9, background:"#FEF3C7", color:"#92400E", border:"1px solid #FDE68A"}}>
          <strong>{scan.dates.length} gene name{scan.dates.length!==1?"s":""} look{scan.dates.length===1?"s":""} like Excel converted {scan.dates.length===1?"it":"them"} to a date.</strong>
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

      {scan.sci.length>0&&(
        <div style={{fontSize:11, lineHeight:1.6, padding:"9px 11px", borderRadius:6, marginBottom:9, background:"#FEE2E2", color:"#991B1B", border:"1px solid #FCA5A5"}}>
          {scan.sci.length} gene ID{scan.sci.length!==1?"s":""} (e.g. {scan.sci[0].name}) look like Excel read an Ensembl-style ID as a number. The original characters are gone — re-export from your source without opening in Excel.
        </div>
      )}

      {!importable&&(
        <div style={{fontSize:11, lineHeight:1.6, padding:"9px 11px", borderRadius:6, marginBottom:9, background:"#FEE2E2", color:"#991B1B", border:"1px solid #FCA5A5"}}>
          No sample columns were found to the right of the gene ID column. Check that the header row and gene ID column are set correctly above — if the file is single-column, it isn't an expression matrix.
        </div>
      )}

      {built.badCells>0&&(
        <div style={{fontSize:11, padding:"8px 10px", borderRadius:6, marginBottom:9, background:t.tag, color:t.tagText, border:"1px solid "+t.cBorder}}>
          {built.badCells} non-numeric cell{built.badCells!==1?"s":""} will import as 0.
        </div>
      )}

      <div style={{display:"flex", gap:6}}>
        <button onClick={doImport} disabled={!importable}
          style={{flex:1, padding:"8px 0", borderRadius:7, fontSize:12, fontWeight:700, cursor:importable?"pointer":"default", background:importable?t.accent:t.border, border:"none", color:"#fff"}}>
          {importable ? "Import "+built.geneNames.length+" genes" : "Nothing to import"}
        </button>
        <button onClick={()=>{setParsed(null);setError(null);}}
          style={{padding:"8px 16px", borderRadius:7, fontSize:12, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>
          Choose another file
        </button>
      </div>
    </div>
  );
}

function MatrixGrid({matrix, setMatrix, undo, redo, canUndo, canRedo, onLoadExample}) {
  const t=useTheme();
  const {sampleNames, geneNames, values} = matrix;
  const [focus, setFocus] = useState(null);
  const [confirmClr, setConfirmClr] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [rowLimit, setRowLimit] = useState(GRID_ROW_CAP);
  const [advancedText, setAdvancedText] = useState("");
  const [importFeedback, setImportFeedback] = useState(null); // {type:'error'|'warning', messages:[]}
  const cellRefs = useRef({});
  const nCols = sampleNames.length + 1;
  const nRows = geneNames.length + 1;

  const detectDelim = text => text.split("\n")[0].includes("\t") ? "\t" : ",";

  const doPaste = useCallback((text, gridRow, gridCol) => {
    const delim = detectDelim(text);
    const lines = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n").filter((l,i,arr)=>l.trim()!==""||i<arr.length-1).map(l=>l.split(delim));
    if (!lines.length) return;
    const maxLineLen = Math.max(...lines.map(l=>l.length));
    const requiredSampleCols = gridCol===0 ? maxLineLen-1 : (gridCol-1)+maxLineLen;
    let badCells = 0;

    setMatrix(m => {
      let newSampleNames=[...m.sampleNames];
      while (newSampleNames.length<requiredSampleCols) newSampleNames.push("Sample"+(newSampleNames.length+1));
      let newGeneNames=[...m.geneNames];
      let newValues=m.values.map(row=>{ const r=[...row]; while(r.length<newSampleNames.length) r.push(0); return r; });
      const ensureRow = idx => { while (newGeneNames.length<=idx) { newGeneNames.push(""); newValues.push(blankMatrixRow(newSampleNames.length)); } };

      let lineOffset=0;
      if (gridRow===0) {
        const headerCells = lines[0];
        const sOffset = gridCol===0 ? 1 : 0;
        const sampleStartIdx = gridCol===0 ? 0 : (gridCol-1);
        headerCells.slice(sOffset).forEach((val,i)=>{ const v=val.trim(); if(v) newSampleNames[sampleStartIdx+i]=v; });
        lineOffset=1;
      }
      const startGeneRowIdx = gridRow===0 ? 0 : (gridRow-1);
      for (let li=lineOffset; li<lines.length; li++) {
        const rowIdx = startGeneRowIdx+(li-lineOffset);
        ensureRow(rowIdx);
        const cells = lines[li];
        const cOffset = gridCol===0 ? 1 : 0;
        const sampleStartIdx = gridCol===0 ? 0 : (gridCol-1);
        if (gridCol===0 && cells[0]!==undefined) newGeneNames[rowIdx]=cells[0].trim();
        cells.slice(cOffset).forEach((val,i)=>{
          const cell = parseNumericCell(val, delim);
          if (cell.bad) badCells++;
          newValues[rowIdx][sampleStartIdx+i] = cell.value;
        });
      }
      return {sampleNames:newSampleNames, geneNames:newGeneNames, values:newValues};
    });

    if (badCells>0) setImportFeedback({type:"warning", messages:[badCells+" pasted cell(s) weren't recognized as numbers and were set to 0. Check for stray text or formatting in your source data."]});
  },[setMatrix]);

  const onCellPaste = useCallback((e,r,c)=>{ const text=e.clipboardData.getData("text"); e.preventDefault(); doPaste(text,r,c); },[doPaste]);

  const updateHeader = (ci,val) => setMatrix(m=>{ const s=[...m.sampleNames]; s[ci]=val; return {...m,sampleNames:s}; });
  const updateGeneName = (ri,val) => setMatrix(m=>{ const g=[...m.geneNames]; g[ri]=val; return {...m,geneNames:g}; });
  const updateValue = (ri,ci,val) => setMatrix(m=>{ const v=m.values.map(row=>[...row]); v[ri][ci]=val; return {...m,values:v}; });
  const commitValue = (ri,ci,raw) => { const cell=parseNumericCell(raw,"\t"); updateValue(ri,ci, cell.value); };

  const addSampleColumn = () => setMatrix(m=>({...m, sampleNames:[...m.sampleNames,"Sample"+(m.sampleNames.length+1)], values:m.values.map(row=>[...row,0])}));
  const removeSampleColumn = idx => setMatrix(m=>({...m, sampleNames:m.sampleNames.filter((_,i)=>i!==idx), values:m.values.map(row=>row.filter((_,i)=>i!==idx))}));
  const addGeneRow = () => setMatrix(m=>({...m, geneNames:[...m.geneNames,""], values:[...m.values, blankMatrixRow(m.sampleNames.length)]}));
  const removeGeneRow = idx => setMatrix(m=>({...m, geneNames:m.geneNames.filter((_,i)=>i!==idx), values:m.values.filter((_,i)=>i!==idx)}));

  const onKeyNav = useCallback((e,r,c)=>{
    if ((e.ctrlKey||e.metaKey)&&(e.key==="z"||e.key==="y")) return;
    const move=(dr,dc)=>{ e.preventDefault(); const nr=Math.max(0,Math.min(nRows-1,r+dr)), nc=Math.max(0,Math.min(nCols-1,c+dc)); setFocus({r:nr,c:nc}); setTimeout(()=>cellRefs.current[nr+"-"+nc]?.focus(),0); };
    if (e.key==="ArrowUp") move(-1,0);
    if (e.key==="ArrowDown"||e.key==="Enter") move(1,0);
    if (e.key==="ArrowLeft"&&e.target.selectionStart===0) move(0,-1);
    if (e.key==="ArrowRight"&&e.target.selectionStart===e.target.value.length) move(0,1);
    if (e.key==="Tab"){ e.preventDefault(); move(0,e.shiftKey?-1:1); }
  },[nRows,nCols]);

  const importAdvanced = () => {
    const p = parseMatrixText(advancedText);
    if (!p.geneNames.length) {
      setImportFeedback({type:"error", messages:[p.warnings[0] || "Couldn't find any gene rows in that paste — check the format and try again."]});
      return;
    }
    setMatrix({sampleNames:p.sampleNames, geneNames:p.geneNames, values:p.values});
    setAdvancedText("");
    setShowAdvanced(false);
    setImportFeedback(p.warnings.length ? {type:"warning", messages:p.warnings} : null);
  };

  // Full matrix always stays in state — this only caps how many rows get DOM
  // nodes, so a 20k-row import doesn't create 20k x nSamples live inputs.
  const paddedRowCount = Math.max(nRows, 16);
  const displayRowCount = Math.min(paddedRowCount, rowLimit);
  const hiddenRowCount = paddedRowCount - displayRowCount;

  return (
    <div>
      <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:10, flexWrap:"wrap"}}>
        <button onClick={onLoadExample}
          style={{padding:"5px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:t.accent, border:"none", color:"#fff"}}>
          Load example data
        </button>
        <button onClick={()=>setShowImport(s=>!s)}
          style={{padding:"5px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:showImport?t.accent:"transparent", border:"1px solid "+(showImport?t.accent:t.border), color:showImport?"#fff":t.text}}>
          Import file
        </button>
        <button onClick={undo} disabled={!canUndo}
          style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+t.border, cursor:canUndo?"pointer":"default", color:canUndo?t.text:t.muted}}>Undo</button>
        <button onClick={redo} disabled={!canRedo}
          style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+t.border, cursor:canRedo?"pointer":"default", color:canRedo?t.text:t.muted}}>Redo</button>
        {!confirmClr
          ? <button onClick={()=>setConfirmClr(true)}
              style={{padding:"4px 10px", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>Clear</button>
          : <span style={{display:"flex", gap:4, alignItems:"center"}}>
              <span style={{fontSize:11, color:t.muted}}>Clear all data?</span>
              <button onClick={()=>{setMatrix({sampleNames:[],geneNames:[],values:[]});setConfirmClr(false);}}
                style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"#DC2626", border:"none", color:"#fff", fontWeight:600}}>Yes</button>
              <button onClick={()=>setConfirmClr(false)}
                style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>Cancel</button>
            </span>}
        <span style={{marginLeft:"auto", fontSize:11, color:t.muted, fontWeight:500}}>{geneNames.length} genes × {sampleNames.length} samples</span>
      </div>

      {showImport && (
        <FileImport
          onClose={()=>setShowImport(false)}
          onImport={(m, warnings)=>{
            setMatrix(m);                       // single history entry: file import is one undo step
            setRowLimit(GRID_ROW_CAP);
            setShowImport(false);
            setImportFeedback(warnings.length ? {type:"warning", messages:warnings} : null);
          }}/>
      )}

      <div style={{fontSize:11, marginBottom:8, padding:"6px 10px", background:t.tag, borderRadius:6, color:t.tagText, border:"1px solid "+t.cBorder}}>
        Click any cell and paste directly from Excel or a normalized-counts export — pasting at the top-left corner fills in sample names and gene rows together. Arrow keys and Tab to navigate.
      </div>


      {importFeedback && (
        <div style={{fontSize:11, marginBottom:8, padding:"8px 10px", borderRadius:6, lineHeight:1.6,
          background:importFeedback.type==="error"?"#FEE2E2":"#FEF3C7",
          color:importFeedback.type==="error"?"#991B1B":"#92400E",
          border:"1px solid "+(importFeedback.type==="error"?"#FCA5A5":"#FDE68A")}}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8}}>
            <div>
              <strong>{importFeedback.type==="error"?"Import failed":"Imported with warnings"}</strong>
              <ul style={{margin:"4px 0 0", paddingLeft:16}}>
                {importFeedback.messages.map((m,i)=><li key={i}>{m}</li>)}
              </ul>
            </div>
            <button onClick={()=>setImportFeedback(null)} style={{background:"transparent", border:"none", cursor:"pointer", fontSize:14, color:"inherit", flexShrink:0}}>×</button>
          </div>
        </div>
      )}

      {hiddenRowCount > 0 && (
        <div style={{fontSize:11, marginBottom:8, padding:"7px 10px", background:t.tag, borderRadius:6, color:t.tagText, border:"1px solid "+t.cBorder, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
          <span>Showing the first {displayRowCount.toLocaleString()} of {geneNames.length.toLocaleString()} rows. The full matrix is loaded and every row is used for the plot.</span>
          <button onClick={()=>setRowLimit(r=>r+GRID_ROW_CAP)}
            style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.cBorder, color:t.tagText}}>
            Show {Math.min(GRID_ROW_CAP, hiddenRowCount).toLocaleString()} more
          </button>
          <button onClick={()=>setRowLimit(paddedRowCount)}
            style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.cBorder, color:t.tagText}}>
            Show all (slow)
          </button>
        </div>
      )}

      <div style={{border:"1px solid "+t.border, borderRadius:8, overflow:"auto", maxHeight:420}}>
        <table style={{borderCollapse:"collapse", tableLayout:"fixed", width:"max-content", minWidth:"100%"}}>
          <colgroup>
            <col style={{width:28}}/>
            <col style={{width:130}}/>
            {sampleNames.map((_,i)=><col key={i} style={{width:96}}/>)}
          </colgroup>
          <thead>
            <tr style={{background:t.cHdr}}>
              <th style={{borderBottom:"2px solid "+t.border, borderRight:"1px solid "+t.border, position:"sticky", top:0, left:0, zIndex:3, background:t.cHdr}}/>
              <th style={{borderBottom:"2px solid "+t.border, borderRight:"1px solid "+t.border, fontSize:10, color:t.muted, padding:"6px 8px", textAlign:"left", position:"sticky", top:0, left:28, zIndex:3, background:t.cHdr}}>gene</th>
              {sampleNames.map((s,ci)=>{
                const rk="0-"+(ci+1), isFocused=focus&&focus.r===0&&focus.c===ci+1;
                return (
                  <th key={ci} style={{borderBottom:"2px solid "+(isFocused?t.accent:t.border), borderRight:"1px solid "+t.cBorder, padding:0, position:"sticky", top:0, zIndex:2, background:t.cHdr}}>
                    <div style={{display:"flex", alignItems:"center", gap:2}}>
                      <input ref={el=>{cellRefs.current[rk]=el;}} value={s}
                        onChange={e=>updateHeader(ci,e.target.value)}
                        onFocus={()=>setFocus({r:0,c:ci+1})}
                        onKeyDown={e=>onKeyNav(e,0,ci+1)}
                        onPaste={e=>onCellPaste(e,0,ci+1)}
                        style={{width:"100%", boxSizing:"border-box", padding:"6px 6px", fontSize:11, fontWeight:700, background:isFocused?t.panel:"transparent", color:t.accent, border:isFocused?"2px solid "+t.accent:"2px solid transparent", outline:"none", fontFamily:"inherit"}}/>
                      <button onClick={()=>removeSampleColumn(ci)} title="Remove sample column"
                        style={{padding:"2px 5px", fontSize:11, background:"transparent", border:"none", color:t.muted, cursor:"pointer", flexShrink:0}}>×</button>
                    </div>
                  </th>
                );
              })}
              <th style={{borderBottom:"2px solid "+t.border, padding:"0 6px", position:"sticky", top:0, zIndex:2, background:t.cHdr}}>
                <button onClick={addSampleColumn} title="Add sample column"
                  style={{padding:"3px 9px", borderRadius:5, fontSize:11, fontWeight:700, cursor:"pointer", background:t.accent, border:"none", color:"#fff", whiteSpace:"nowrap"}}>+ Sample</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({length:displayRowCount}).map((_,ri)=>{
              const gene = geneNames[ri]!==undefined ? geneNames[ri] : "";
              const rowVals = values[ri] || blankMatrixRow(sampleNames.length);
              const isRealRow = ri<geneNames.length;
              return (
                <tr key={ri} style={{background:focus&&focus.r===ri+1?t.cSel:ri%2===0?t.cBg:t.panel}}>
                  <td style={{background:t.cHdr, borderRight:"1px solid "+t.border, borderBottom:"1px solid "+t.cBorder, fontSize:9, color:t.muted, textAlign:"center", position:"sticky", left:0, zIndex:1}}>
                    {isRealRow ? (
                      <button onClick={()=>removeGeneRow(ri)} title="Delete this row"
                        style={{width:18, height:18, borderRadius:4, background:"rgba(220,38,38,0.08)", border:"1px solid rgba(220,38,38,0.35)", color:"#DC2626", cursor:"pointer", fontSize:12, fontWeight:700, padding:0, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto"}}>
                        ×
                      </button>
                    ) : ri+1}
                  </td>
                  <td style={{padding:0, borderBottom:"1px solid "+t.cBorder, borderRight:"1px solid "+t.cBorder, position:"sticky", left:28, background:focus&&focus.r===ri+1&&focus.c===0?t.panel:(ri%2===0?t.cBg:t.panel), zIndex:1}}>
                    <input ref={el=>{cellRefs.current[(ri+1)+"-0"]=el;}} value={gene}
                      placeholder={focus&&focus.r===ri+1&&focus.c===0?"Gene_001":""}
                      onChange={e=>updateGeneName(ri,e.target.value)}
                      onFocus={e=>{setFocus({r:ri+1,c:0});e.target.select();}}
                      onKeyDown={e=>onKeyNav(e,ri+1,0)}
                      onPaste={e=>onCellPaste(e,ri+1,0)}
                      style={{width:"100%", boxSizing:"border-box", padding:"4px 8px", fontSize:12, background:focus&&focus.r===ri+1&&focus.c===0?t.panel:"transparent", color:t.text, border:focus&&focus.r===ri+1&&focus.c===0?"2px solid "+t.cFocus:"2px solid transparent", outline:"none", fontFamily:"monospace"}}/>
                  </td>
                  {sampleNames.map((s,ci)=>{
                    const rk=(ri+1)+"-"+(ci+1), isFocused=focus&&focus.r===ri+1&&focus.c===ci+1;
                    return (
                      <td key={ci} style={{padding:0, borderBottom:"1px solid "+t.cBorder, borderRight:"1px solid "+t.cBorder}}>
                        <input ref={el=>{cellRefs.current[rk]=el;}}
                          value={rowVals[ci]!==undefined?rowVals[ci]:""}
                          inputMode="decimal"
                          onChange={e=>updateValue(ri,ci,e.target.value)}
                          onFocus={e=>{setFocus({r:ri+1,c:ci+1});e.target.select();}}
                          onBlur={e=>commitValue(ri,ci,e.target.value)}
                          onKeyDown={e=>onKeyNav(e,ri+1,ci+1)}
                          onPaste={e=>onCellPaste(e,ri+1,ci+1)}
                          style={{width:"100%", boxSizing:"border-box", padding:"4px 8px", fontSize:12, textAlign:"right", background:isFocused?t.panel:"transparent", color:t.text, border:isFocused?"2px solid "+t.cFocus:"2px solid transparent", outline:"none", fontFamily:"monospace"}}/>
                      </td>
                    );
                  })}
                  <td/>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:6}}>
        <button onClick={addGeneRow} style={{padding:"4px 12px", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>+ Add gene row</button>
        <span style={{fontSize:10, color:t.muted}}>Rows beyond your data are ignored when computing the heatmap.</span>
      </div>

      <Divider/>
      <button onClick={()=>setShowAdvanced(v=>!v)} style={{fontSize:11, color:t.accent, background:"transparent", border:"none", cursor:"pointer", padding:0, fontWeight:600}}>
        {showAdvanced?"− Hide":"+"} Advanced: paste a full matrix as one text block
      </button>
      {showAdvanced&&(
        <div style={{marginTop:8}}>
          <textarea value={advancedText} onChange={e=>setAdvancedText(e.target.value)} rows={6}
            placeholder={"gene\tCtrl_1\tCtrl_2\tTreat_1\tTreat_2\nGene_001\t120\t135\t410\t395\n..."}
            style={{width:"100%", boxSizing:"border-box", padding:"8px 10px", fontSize:11, borderRadius:8, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none", fontFamily:"monospace", resize:"vertical"}}/>
          <div style={{display:"flex", gap:6, marginTop:6, alignItems:"center", flexWrap:"wrap"}}>
            <button onClick={importAdvanced} disabled={!advancedText.trim()}
              style={{padding:"5px 14px", borderRadius:6, fontSize:11, fontWeight:600, cursor:advancedText.trim()?"pointer":"default", background:advancedText.trim()?t.accent:t.panel2, border:"none", color:advancedText.trim()?"#fff":t.muted}}>
              Replace grid with this
            </button>
            <span style={{fontSize:10, color:t.muted, alignSelf:"center"}}>This replaces everything currently in the grid.</span>
            {importFeedback&&importFeedback.type==="error"&&<span style={{fontSize:10, color:"#DC2626", fontWeight:600}}>{importFeedback.messages[0]}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sample groups panel ────────────────────────────────────────────────────────
// Dropdown-driven by design: a group name only ever enters state via an
// explicit "+ New group" confirmation (Enter/blur) or an atomic rename that
// re-labels every sample carrying that group in one step. There is no path
// by which a partially-typed string can land in sampleGroups, which is what
// previously let every keystroke of a group name become its own orphaned
// legend entry.
function SampleGroupsPanel({sampleNames, sampleGroups, setSampleGroups, groupColors, setGroupColors}) {
  const t=useTheme();
  const [addingFor, setAddingFor] = useState(null);
  const [newGroupDraft, setNewGroupDraft] = useState("");
  const [renamingGroup, setRenamingGroup] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");

  if (!sampleNames.length) {
    return <div style={{fontSize:12, color:t.muted, padding:"20px 8px", textAlign:"center"}}>Paste a matrix in the Data tab first — sample names will appear here for group assignment.</div>;
  }

  const distinctGroups = [...new Set(sampleNames.map(s=>sampleGroups[s]||"Group 1"))];
  const countFor = g => sampleNames.filter(s=>(sampleGroups[s]||"Group 1")===g).length;

  const assignGroup = (sample, group) => setSampleGroups(prev=>({...prev,[sample]:group}));

  const commitNewGroup = (sample) => {
    const name = newGroupDraft.trim();
    if (name) assignGroup(sample, name);
    setAddingFor(null); setNewGroupDraft("");
  };

  const commitRename = (oldName) => {
    const name = renameDraft.trim();
    if (name && name!==oldName) {
      const targetAlreadyExists = distinctGroups.includes(name);
      setSampleGroups(prev=>{
        const next={...prev};
        Object.keys(next).forEach(s=>{ if ((next[s]||"Group 1")===oldName) next[s]=name; });
        return next;
      });
      // Only migrate the color forward for a genuine rename. If the target
      // name already exists as a group, this is a merge — keep the target's
      // existing color rather than overwriting it.
      if (!targetAlreadyExists) {
        setGroupColors(prev=>{
          const next={...prev};
          if (next[oldName]!==undefined) { next[name]=next[oldName]; delete next[oldName]; }
          return next;
        });
      }
    }
    setRenamingGroup(null); setRenameDraft("");
  };

  return (
    <div>
      <SectionLabel>Assign Each Sample to a Group</SectionLabel>
      <div style={{fontSize:11, color:t.muted, marginBottom:10, lineHeight:1.5}}>
        Drives the annotation color bar above the heatmap. Pick an existing group from the dropdown, or add a new one — this keeps a typo from silently creating a duplicate group.
      </div>
      <div style={{border:"1px solid "+t.border, borderRadius:8, overflow:"hidden", marginBottom:14}}>
        {sampleNames.map((s,i)=>{
          const current = sampleGroups[s]||"Group 1";
          const isAdding = addingFor===s;
          return (
            <div key={s} style={{display:"flex", alignItems:"center", gap:8, padding:"6px 10px", borderBottom:i<sampleNames.length-1?"1px solid "+t.cBorder:"none", background:i%2===0?t.cBg:t.panel}}>
              <span style={{fontSize:11, fontFamily:"monospace", color:t.text, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{s}</span>
              {isAdding ? (
                <input autoFocus value={newGroupDraft} onChange={e=>setNewGroupDraft(e.target.value)}
                  onBlur={()=>commitNewGroup(s)}
                  onKeyDown={e=>{ if(e.key==="Enter"){e.preventDefault();commitNewGroup(s);} if(e.key==="Escape"){setAddingFor(null);setNewGroupDraft("");} }}
                  placeholder="New group name"
                  style={{width:120, padding:"3px 7px", fontSize:11, borderRadius:5, border:"1px solid "+t.accent, background:t.cBg, color:t.text, outline:"none"}}/>
              ) : (
                <select value={current} onChange={e=>{
                    if (e.target.value==="__new__") { setAddingFor(s); setNewGroupDraft(""); }
                    else assignGroup(s, e.target.value);
                  }}
                  style={{width:120, padding:"3px 7px", fontSize:11, borderRadius:5, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none"}}>
                  {distinctGroups.map(g=><option key={g} value={g}>{g}</option>)}
                  <option value="__new__">+ New group…</option>
                </select>
              )}
            </div>
          );
        })}
      </div>

      <SectionLabel>Group Colors</SectionLabel>
      <div style={{fontSize:10, color:t.muted, marginBottom:8}}>Double-click a group name to rename it everywhere at once.</div>
      <div style={{display:"flex", flexDirection:"column", gap:7}}>
        {distinctGroups.map((g,i)=>{
          const count = countFor(g);
          const isRenaming = renamingGroup===g;
          return (
            <div key={g} style={{display:"flex", alignItems:"center", gap:8}}>
              <ColorSwatch color={groupColors[g]||GROUP_PALETTE[i%GROUP_PALETTE.length]} onChange={v=>setGroupColors(prev=>({...prev,[g]:v}))}/>
              {isRenaming ? (
                <input autoFocus value={renameDraft} onChange={e=>setRenameDraft(e.target.value)}
                  onBlur={()=>commitRename(g)}
                  onKeyDown={e=>{ if(e.key==="Enter"){e.preventDefault();commitRename(g);} if(e.key==="Escape"){setRenamingGroup(null);setRenameDraft("");} }}
                  style={{fontSize:11, padding:"2px 6px", borderRadius:4, border:"1px solid "+t.accent, background:t.cBg, color:t.text, outline:"none", flex:1}}/>
              ) : (
                <span onDoubleClick={()=>{setRenamingGroup(g);setRenameDraft(g);}} title="Double-click to rename this group everywhere"
                  style={{fontSize:11, color:t.text, fontWeight:600, cursor:"text", flex:1}}>{g}</span>
              )}
              <span style={{fontSize:10, color:t.muted, whiteSpace:"nowrap"}}>{count} sample{count!==1?"s":""}</span>
              {count===1 && <span title="Singleton group — no within-group replicate variance to compare against" style={{fontSize:12, cursor:"help"}}>⚠️</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Preprocessing / clustering panel ──────────────────────────────────────────
function ClusteringPanel({stats, setStats, nGenesTotal, nGenesUsed}) {
  const t=useTheme();
  return (
    <div>
      <SectionLabel>Transform</SectionLabel>
      <Toggle value={stats.log2Transform} onChange={v=>setStats(s=>({...s,log2Transform:v}))} label="log2(x + 1) transform"/>
      <Toggle value={stats.zscore} onChange={v=>setStats(s=>({...s,zscore:v}))} label="Z-score normalize each gene (row)"/>
      <div style={{fontSize:10, color:t.muted, lineHeight:1.5, marginTop:-4, marginBottom:10}}>
        Standard for expression heatmaps — shows each gene's relative pattern across samples rather than absolute expression level, so highly-expressed genes don't visually dominate.
      </div>

      <Divider/>
      <SectionLabel>Most-Variable Gene Filter</SectionLabel>
      <LabeledSlider label="Top N genes by variance" value={stats.topVarGenes} min={10} max={500} step={5}
        onChange={v=>setStats(s=>({...s,topVarGenes:v}))} display={stats.topVarGenes>=nGenesTotal?"All ("+nGenesTotal+")":stats.topVarGenes}/>
      <div style={{fontSize:10, color:t.muted, lineHeight:1.5}}>
        {nGenesTotal>0
          ? "Using "+nGenesUsed.toLocaleString()+" of "+nGenesTotal.toLocaleString()+" genes. Heatmaps stay readable with tens to low hundreds of rows — for genome-wide clustering, use PCA instead."
          : "Paste a matrix to see how many genes will be used."}
      </div>

      <Divider/>
      <SectionLabel>Clustering</SectionLabel>
      <Toggle value={stats.clusterRows} onChange={v=>setStats(s=>({...s,clusterRows:v}))} label="Cluster genes (rows)"/>
      <Toggle value={stats.clusterCols} onChange={v=>setStats(s=>({...s,clusterCols:v}))} label="Cluster samples (columns)"/>
      <div style={{fontSize:10, color:t.muted, marginBottom:8}}>Method: average linkage (UPGMA)</div>
      <div style={{fontSize:10, color:t.muted, marginBottom:5}}>Distance metric</div>
      <div style={{display:"flex", gap:5, marginBottom:10}}>
        <Pill active={stats.distanceMetric==="euclidean"} onClick={()=>setStats(s=>({...s,distanceMetric:"euclidean"}))}>Euclidean</Pill>
        <Pill active={stats.distanceMetric==="correlation"} onClick={()=>setStats(s=>({...s,distanceMetric:"correlation"}))}>Correlation</Pill>
      </div>

      <Divider/>
      <SectionLabel>Color Scale</SectionLabel>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:10}}>
        {Object.keys(COLOR_SCALES).map(name=>(
          <button key={name} onClick={()=>setStats(s=>({...s,colorScale:name}))}
            style={{padding:"6px 4px", borderRadius:6, cursor:"pointer", textAlign:"center",
              background:stats.colorScale===name?t.cSel:"transparent", border:"1.5px solid "+(stats.colorScale===name?t.accent:t.border)}}>
            <div style={{height:8, borderRadius:2, marginBottom:3, background:"linear-gradient(to right, "+COLOR_SCALES[name].stops.map(s=>s[1]).join(",")+")"}}/>
            <div style={{fontSize:9, color:stats.colorScale===name?t.accent:t.muted, fontWeight:600}}>{name}</div>
          </button>
        ))}
      </div>
      {stats.zscore&&(
        <LabeledSlider label="Clip color scale at ± SD" value={stats.clipSD} min={1} max={4} step={0.25}
          onChange={v=>setStats(s=>({...s,clipSD:v}))} display={"±"+stats.clipSD+" SD"}/>
      )}
      <div style={{fontSize:10, color:t.muted, lineHeight:1.5}}>Clipping prevents a few extreme outlier genes from washing out color contrast for everything else.</div>
    </div>
  );
}

function StylePanel({display, setDisplay}) {
  const t=useTheme();
  return (
    <div>
      <SectionLabel>Figure Title</SectionLabel>
      <input value={display.plotTitle||""} onChange={e=>setDisplay(s=>({...s,plotTitle:e.target.value}))} placeholder="e.g. Top Variable Genes (Z-score)"
        style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:12, borderRadius:6, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none", marginBottom:10}}/>

      <Divider/>
      <SectionLabel>Labels</SectionLabel>
      <Toggle value={display.showGeneLabels!==false} onChange={v=>setDisplay(s=>({...s,showGeneLabels:v}))} label="Show gene labels (hidden if >80 genes)"/>
      <Toggle value={display.showSampleLabels!==false} onChange={v=>setDisplay(s=>({...s,showSampleLabels:v}))} label="Show sample labels"/>
      <Toggle value={display.showBorder!==false} onChange={v=>setDisplay(s=>({...s,showBorder:v}))} label="Show border around grid"/>

      <Divider/>
      <SectionLabel>Font Family</SectionLabel>
      <select value={display.ff||"Inter"} onChange={e=>setDisplay(s=>({...s,ff:e.target.value}))}
        style={{width:"100%", padding:"6px 9px", fontSize:11, borderRadius:6, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none", marginBottom:10}}>
        {FONTS.map(f=><option key={f} value={f}>{f}</option>)}
      </select>

      <SectionLabel>Font Sizes</SectionLabel>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10}}>
        {[["Labels","labelSize"],["Title","titleSize"]].map(([lb,key])=>(
          <div key={key}>
            <div style={{fontSize:10, color:t.muted, marginBottom:3}}>{lb}</div>
            <input type="number" min={6} max={18} value={display[key]} onChange={e=>setDisplay(s=>({...s,[key]:+e.target.value}))}
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

function ExportPanel({plotRef, display}) {
  const t=useTheme();
  const [format,setFormat]=useState("png");
  const [dpi,setDpi]=useState(300);
  const [mmWidth,setMmWidth]=useState(183);
  const [mmHeight,setMmHeight]=useState(140);
  const [useMm,setUseMm]=useState(false);
  const [saving,setSaving]=useState(false);
  const [done,setDone]=useState(false);
  const [err,setErr]=useState(null);
  const MM_PRESETS = [{label:"89mm",desc:"Single col",w:89},{label:"120mm",desc:"1.5 col",w:120},{label:"183mm",desc:"Double col",w:183},{label:"247mm",desc:"Full page",w:247}];

  const runExport=async()=>{
    setSaving(true); setErr(null);
    const name="heatmap_"+new Date().toISOString().slice(0,10);
    await new Promise(r=>setTimeout(r,60));
    try {
      const svgEl=plotRef&&plotRef.current&&plotRef.current.querySelector("svg");
      if(!svgEl){ setErr("Couldn't find the plot. Switch to the Plot or Split view and try again."); return; }
      const clone=svgEl.cloneNode(true);
      clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
      const vb=(svgEl.getAttribute("viewBox")||"0 0 700 420").split(" ").map(Number);
      const svgW=vb[2]||700, svgH=vb[3]||420;
      const bgFill="#ffffff"; // figures are always on white paper
      const bgRect=document.createElementNS("http://www.w3.org/2000/svg","rect");
      bgRect.setAttribute("width","100%"); bgRect.setAttribute("height","100%"); bgRect.setAttribute("fill",bgFill);
      clone.insertBefore(bgRect,clone.firstChild);
      if(format==="svg"){
        if(useMm){clone.setAttribute("width",mmWidth+"mm");clone.setAttribute("height",mmHeight+"mm");}
        else{clone.setAttribute("width",svgW);clone.setAttribute("height",svgH);}
        downloadBlob(new Blob([clone.outerHTML],{type:"image/svg+xml;charset=utf-8"}), name+".svg");
      } else {
        const pxW=useMm?Math.round(mmWidth/25.4*dpi):Math.round(svgW*(dpi/96));
        const pxH=useMm?Math.round(mmHeight/25.4*dpi):Math.round(svgH*(dpi/96));
        prepareSVGForExport(clone, svgW, svgH, display.ff);
        const svgStr=serializeSVG(clone);
        const cv = await rasterizeSVG(svgStr, pxW, pxH, svgW, svgH, bgFill);
        const suffix="_"+dpi+"dpi"+(useMm?"_"+mmWidth+"x"+mmHeight+"mm":"");
        const ext = format==="jpeg"?".jpg":format==="tiff"?".tif":".png";
        downloadBlob(await encodeCanvas(cv, format, dpi), name+suffix+ext);
      }
      setDone(true); setTimeout(()=>setDone(false),1500);
    } catch(e){ setErr((e&&e.message)?e.message:"Export failed."); }
    finally { setSaving(false); }
  };

  const FORMATS=[{id:"png",l:"PNG",sub:"Best for most journals"},{id:"jpeg",l:"JPEG",sub:"Smaller file size"},{id:"tiff",l:"TIFF",sub:"ImageJ / Photoshop"},{id:"svg",l:"SVG",sub:"Vector, infinitely scalable"}];

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
      {format!=="svg"&&(
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
        </div>
      )}
      <Divider/>
      <SectionLabel>Figure Size (mm)</SectionLabel>
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
        </div>
      )}
      <button onClick={runExport} disabled={saving}
        style={{width:"100%", padding:"11px 0", borderRadius:8, fontSize:13, fontWeight:700, cursor:saving?"default":"pointer",
          background:done?t.success:t.accent, border:"none", color:"#fff", transition:"background .2s", marginTop:12}}>
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

// ════════════════════════════════════════════════════════════════════════════
// Heatmap — the core visualization (dendrograms + annotation bar + grid)
// ════════════════════════════════════════════════════════════════════════════
function Heatmap({geneNames, sampleNames, matrix, zMatrix, stats, display, sampleGroups, groupColors}) {
  const t=useTheme();
  const style=resolveStyles(display,t);
  const nGenes=geneNames.length, nSamples=sampleNames.length;
  const [hovered,setHovered]=useState(null);

  const distFn = stats.distanceMetric==="correlation" ? correlationDist : euclideanDist;
  const dataForCluster = stats.zscore ? zMatrix : matrix;

  const rowClusterResult = useMemo(()=>{
    if (!stats.clusterRows || nGenes<3) return null;
    return upgma(dataForCluster, distFn);
  },[dataForCluster, stats.clusterRows, stats.distanceMetric, nGenes]);
  const colClusterResult = useMemo(()=>{
    if (!stats.clusterCols || nSamples<3) return null;
    const cols = sampleNames.map((_,ci)=>dataForCluster.map(row=>row[ci]));
    return upgma(cols, distFn);
  },[dataForCluster, stats.clusterCols, stats.distanceMetric, nSamples]);

  const rowOrder = rowClusterResult ? leafOrder(rowClusterResult.root) : geneNames.map((_,i)=>i);
  const colOrder = colClusterResult ? leafOrder(colClusterResult.root) : sampleNames.map((_,i)=>i);

  const rowDendroLayout = useMemo(()=>{
    if (!rowClusterResult) return null;
    const posMap={}; rowOrder.forEach((leafIdx,pos)=>{posMap[leafIdx]=pos;});
    const laid = layoutDendrogram(rowClusterResult.root, posMap);
    return {laid, segments:collectSegments(laid), maxHeight: rowClusterResult.root.height||1};
  },[rowClusterResult, rowOrder]);
  const colDendroLayout = useMemo(()=>{
    if (!colClusterResult) return null;
    const posMap={}; colOrder.forEach((leafIdx,pos)=>{posMap[leafIdx]=pos;});
    const laid = layoutDendrogram(colClusterResult.root, posMap);
    return {laid, segments:collectSegments(laid), maxHeight: colClusterResult.root.height||1};
  },[colClusterResult, colOrder]);

  const MAX_GRID_H=520, MAX_GRID_W=460;
  const cellH = Math.max(3, Math.min(20, MAX_GRID_H/Math.max(1,nGenes)));
  const cellW = Math.max(14, Math.min(38, MAX_GRID_W/Math.max(1,nSamples)));
  const gridH = cellH*nGenes, gridW = cellW*nSamples;

  const showGeneLabels = display.showGeneLabels!==false && nGenes<=80;
  const showSampleLabels = display.showSampleLabels!==false;

  const ROW_DENDRO_W = rowDendroLayout ? 56 : 4;
  const COL_DENDRO_H = colDendroLayout ? 56 : 4;
  const ANNOT_H = Object.keys(groupColors).length>0 ? 14 : 0;
  const GENE_LABEL_W = showGeneLabels ? 130 : 8;
  const SAMPLE_LABEL_H = showSampleLabels ? 90 : 8;
  const LEGEND_W = 130;
  const TITLE_H = display.plotTitle ? 26 : 0;
  const MARGIN = 16;

  const ML = MARGIN+ROW_DENDRO_W, MT = MARGIN+TITLE_H+COL_DENDRO_H+ANNOT_H;
  const svgW = ML+gridW+GENE_LABEL_W+LEGEND_W+MARGIN;
  const svgH = MT+gridH+SAMPLE_LABEL_H+MARGIN;

  const rowCenter = pos => MT + pos*cellH + cellH/2;
  const colCenter = pos => ML + pos*cellW + cellW/2;

  const colorDomain = useMemo(()=>{
    if (stats.zscore) {
      const clip = stats.clipSD||2.5;
      return {min:-clip, max:clip, centered:true};
    }
    const vals = matrix.flat();
    return {min:Math.min(...vals), max:Math.max(...vals), centered:false};
  },[stats.zscore, stats.clipSD, matrix]);

  const colorFor = useCallback((val)=>{
    const t01 = (val-colorDomain.min)/((colorDomain.max-colorDomain.min)||1);
    return interpColor(stats.colorScale, t01);
  },[stats.colorScale, colorDomain]);

  const cells = useMemo(()=>{
    const out=[];
    rowOrder.forEach((gi,ri)=>{
      colOrder.forEach((ci,ci2)=>{
        out.push({ri, ci:ci2, gene:geneNames[gi], sample:sampleNames[ci], raw:matrix[gi][ci], z:zMatrix[gi][ci]});
      });
    });
    return out;
  },[rowOrder,colOrder,geneNames,sampleNames,matrix,zMatrix]);

  const legendStops = COLOR_SCALES[stats.colorScale].stops;

  return (
    <div style={{background:t.panel,border:"1px solid "+t.border,borderRadius:10,padding:"12px",boxShadow:t.shadow,overflow:"auto"}}>
      <svg width={svgW} height={svgH} viewBox={"0 0 "+svgW+" "+svgH} style={{display:"block", overflow:"visible"}}>
        {display.plotTitle&&<text x={svgW/2} y={MARGIN+14} textAnchor="middle" fontSize={style.title.fontSize} fontWeight={style.title.fontWeight} fontStyle={style.title.fontStyle} fill={style.title.color} fontFamily={style.font}>{display.plotTitle}</text>}

        {colDendroLayout&&colDendroLayout.segments.map((seg,i)=>{
          const y0=MARGIN+TITLE_H+COL_DENDRO_H, scaleH=h=>y0-(h/colDendroLayout.maxHeight)*(COL_DENDRO_H-6);
          if (seg.type==="h") return <line key={i} x1={colCenter(seg.pos1)} y1={scaleH(seg.height)} x2={colCenter(seg.pos2)} y2={scaleH(seg.height)} stroke={t.muted} strokeWidth={1}/>;
          return <line key={i} x1={colCenter(seg.pos)} y1={scaleH(seg.h1)} x2={colCenter(seg.pos)} y2={scaleH(seg.h2)} stroke={t.muted} strokeWidth={1}/>;
        })}

        {rowDendroLayout&&rowDendroLayout.segments.map((seg,i)=>{
          const x0=ML-4, scaleH=h=>x0-(h/rowDendroLayout.maxHeight)*(ROW_DENDRO_W-6);
          if (seg.type==="h") return <line key={i} x1={scaleH(seg.height)} y1={rowCenter(seg.pos1)} x2={scaleH(seg.height)} y2={rowCenter(seg.pos2)} stroke={t.muted} strokeWidth={1}/>;
          return <line key={i} x1={scaleH(seg.h1)} y1={rowCenter(seg.pos)} x2={scaleH(seg.h2)} y2={rowCenter(seg.pos)} stroke={t.muted} strokeWidth={1}/>;
        })}

        {ANNOT_H>0 && colOrder.map((ci,pos)=>{
          const sample=sampleNames[ci], group=sampleGroups[sample]||"Group 1", col=groupColors[group]||"#94A3B8";
          return <rect key={pos} x={ML+pos*cellW} y={MARGIN+TITLE_H+COL_DENDRO_H} width={cellW} height={ANNOT_H} fill={col}/>;
        })}

        {cells.map((c,i)=>(
          <rect key={i} x={ML+c.ci*cellW} y={MT+c.ri*cellH} width={cellW} height={cellH}
            fill={colorFor(stats.zscore?c.z:c.raw)}
            stroke={hovered&&hovered.gene===c.gene&&hovered.sample===c.sample?"#000":"none"} strokeWidth={hovered&&hovered.gene===c.gene&&hovered.sample===c.sample?1.5:0}
            onMouseEnter={()=>setHovered(c)} onMouseLeave={()=>setHovered(null)}/>
        ))}

        {display.showBorder!==false && (
          <rect x={ML} y={MT} width={gridW} height={gridH} fill="none" stroke={t.text} strokeWidth={1}/>
        )}

        {showGeneLabels && rowOrder.map((gi,pos)=>(
          <text key={pos} x={ML+gridW+6} y={rowCenter(pos)+style.labelSize*0.35} fontSize={style.labelSize} fill={t.text} fontFamily={style.font}>{geneNames[gi]}</text>
        ))}

        {showSampleLabels && colOrder.map((ci,pos)=>(
          <text key={pos} x={colCenter(pos)} y={MT+gridH+10} fontSize={style.labelSize} fill={t.text} fontFamily={style.font}
            textAnchor="end" transform={"rotate(-45,"+colCenter(pos)+","+(MT+gridH+10)+")"}>{sampleNames[ci]}</text>
        ))}

        <g transform={"translate("+(ML+gridW+GENE_LABEL_W+10)+","+MT+")"}>
          <text x={0} y={0} fontSize={10} fontWeight="700" fill={t.text} fontFamily={style.font}>{stats.zscore?"Z-score":"Expression"}</text>
          <defs>
            <linearGradient id="hmLegendGrad" x1="0" y1="1" x2="0" y2="0">
              {legendStops.map(([off,col],i)=><stop key={i} offset={(off*100)+"%"} stopColor={col}/>)}
            </linearGradient>
          </defs>
          <rect x={0} y={8} width={16} height={90} fill="url(#hmLegendGrad)" stroke={t.border} strokeWidth={0.5}/>
          <text x={20} y={16} fontSize={9} fill={t.muted} fontFamily={style.font}>{colorDomain.max.toFixed(1)}</text>
          <text x={20} y={56} fontSize={9} fill={t.muted} fontFamily={style.font}>{((colorDomain.max+colorDomain.min)/2).toFixed(1)}</text>
          <text x={20} y={96} fontSize={9} fill={t.muted} fontFamily={style.font}>{colorDomain.min.toFixed(1)}</text>

          {Object.keys(groupColors).length>0 && (
            <g transform="translate(0,120)">
              <text x={0} y={0} fontSize={10} fontWeight="700" fill={t.text} fontFamily={style.font}>Group</text>
              {Object.entries(groupColors).map(([g,col],i)=>(
                <g key={g} transform={"translate(0,"+(14+i*16)+")"}>
                  <rect x={0} y={-8} width={10} height={10} fill={col} rx={2}/>
                  <text x={14} y={0} fontSize={9} fill={t.text} fontFamily={style.font}>{g}</text>
                </g>
              ))}
            </g>
          )}
        </g>

        {hovered&&(()=>{
          const tx=Math.min(svgW-160, ML+hovered.ci*cellW+cellW+8), ty=Math.max(MT+10, MT+hovered.ri*cellH-10);
          return (
            <g style={{pointerEvents:"none"}}>
              <rect x={tx} y={ty} width={150} height={60} rx={6} fill={t.tip} stroke={t.border} strokeWidth={1}/>
              <text x={tx+8} y={ty+15} fontSize={11} fontWeight="700" fill="#fff">{hovered.gene}</text>
              <text x={tx+8} y={ty+30} fontSize={9} fill="#CBD5E1">{hovered.sample}</text>
              <text x={tx+8} y={ty+45} fontSize={9} fill="#CBD5E1">raw: {hovered.raw.toFixed(1)}</text>
              <text x={tx+80} y={ty+45} fontSize={9} fill="#CBD5E1">z: {hovered.z.toFixed(2)}</text>
            </g>
          );
        })()}
      </svg>
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
// ════════════════════════════════════════════════════════════════════════════
// Sheet sidebar — multiple independent datasets in one session.
// Mirrors the Volcano / MA Plot sheet model: each sheet owns its own matrix,
// grouping and styling, plus its own undo history; Save Project writes all of
// them into a single file.
// ════════════════════════════════════════════════════════════════════════════
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
            <span style={{fontSize:14, flexShrink:0}}>{"\uD83D\uDCCA"}</span>
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
          onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{onLoad(JSON.parse(ev.target.result));}catch(_){}};r.readAsText(f);e.target.value="";}}/>
        <div style={{fontSize:9, color:t.muted, textAlign:"center"}}>Ctrl+S to save</div>
      </div>
    </div>
  );
}

export default function HeatmapPage() {
  const activeTheme = useTheme(); // live theme from the app shell
  const [layout,setLayout]=useState("split");
  const [leftTab,setLeftTab]=useState("data");
  const [rightTab,setRightTab]=useState("cluster");
  const plotRef=useRef(null);

  // ── Sheets: each one is a fully independent heatmap dataset ──────────────
  const [sheets,setSheets]=useState(()=>[mkSheet("Heatmap 1")]);
  const [activeId,setActiveId]=useState(()=>sheets[0].id);
  const activeSheet=sheets.find(s=>s.id===activeId)||sheets[0];

  // ── Per-sheet matrix undo/redo history ───────────────────────────────────
  const historyMap=useRef({}), cursorMap=useRef({});
  const [,forceUpdate]=useState(0);
  useEffect(()=>{ if(!historyMap.current[activeSheet.id]){ historyMap.current[activeSheet.id]=[activeSheet.matrix]; cursorMap.current[activeSheet.id]=0; } },[activeSheet.id]);
  const getHistory=id=>historyMap.current[id]||(historyMap.current[id]=[EMPTY_MATRIX]);
  const getCursor =id=>cursorMap.current[id]!==undefined?cursorMap.current[id]:0;

  const setMatrix=useCallback(fn=>{
    const id=activeId, hist=getHistory(id), cursor=getCursor(id), prev=hist[cursor]||EMPTY_MATRIX;
    const next = typeof fn==="function" ? fn(prev) : fn;
    historyMap.current[id]=[...hist.slice(0,cursor+1), next].slice(-20);
    cursorMap.current[id]=historyMap.current[id].length-1;
    setSheets(ss=>ss.map(s=>s.id===id?{...s,matrix:next}:s));
    forceUpdate(v=>v+1);
  },[activeId]);

  const undoMatrix=useCallback(()=>{
    const id=activeId, cursor=getCursor(id); if(cursor<=0) return;
    cursorMap.current[id]=cursor-1;
    setSheets(ss=>ss.map(s=>s.id===id?{...s,matrix:getHistory(id)[cursor-1]||EMPTY_MATRIX}:s));
    forceUpdate(v=>v+1);
  },[activeId]);

  const redoMatrix=useCallback(()=>{
    const id=activeId, cursor=getCursor(id), hist=getHistory(id); if(cursor>=hist.length-1) return;
    cursorMap.current[id]=cursor+1;
    setSheets(ss=>ss.map(s=>s.id===id?{...s,matrix:hist[cursor+1]||EMPTY_MATRIX}:s));
    forceUpdate(v=>v+1);
  },[activeId]);

  const canUndoMatrix=getCursor(activeId)>0, canRedoMatrix=getCursor(activeId)<getHistory(activeId).length-1;

  // ── Per-sheet setters for everything else ────────────────────────────────
  const setSampleGroups = useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,sampleGroups: typeof fn==="function"?fn(s.sampleGroups):fn}:s)),[activeId]);
  const setGroupColors  = useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,groupColors:  typeof fn==="function"?fn(s.groupColors):fn}:s)),[activeId]);
  const setDisplay      = useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,display:      typeof fn==="function"?fn(s.display):fn}:s)),[activeId]);
  const setStats        = useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,stats:        typeof fn==="function"?fn(s.stats):fn}:s)),[activeId]);

  // ── Sheet lifecycle ──────────────────────────────────────────────────────
  const newSheet = name => {
    const sh=mkSheet(name);
    historyMap.current[sh.id]=[sh.matrix]; cursorMap.current[sh.id]=0;
    setSheets(ss=>[...ss,sh]); setActiveId(sh.id);
  };
  const selectSheet = id => {
    if (!historyMap.current[id]) { const sh=sheets.find(s=>s.id===id); historyMap.current[id]=[sh?sh.matrix:EMPTY_MATRIX]; cursorMap.current[id]=0; }
    setActiveId(id);
  };
  const renameSheet = (id,name) => setSheets(ss=>ss.map(s=>s.id===id?{...s,name}:s));
  const duplicateSheet = id => {
    const src=sheets.find(s=>s.id===id); if(!src) return;
    const sh={...JSON.parse(JSON.stringify(src)), id:Date.now()+Math.random(), name:src.name+" (copy)"};
    historyMap.current[sh.id]=[sh.matrix]; cursorMap.current[sh.id]=0;
    setSheets(ss=>[...ss,sh]); setActiveId(sh.id);
  };
  const deleteSheet = id => {
    if (sheets.length<=1) return;
    const remaining=sheets.filter(s=>s.id!==id);
    setSheets(remaining);
    if (activeId===id) setActiveId(remaining[remaining.length-1].id);
  };

  const {matrix, sampleGroups, groupColors, display, stats} = activeSheet;

  const loadExample = () => {
    const ex = buildExampleMatrix();
    setMatrix(ex);
    const groups={};
    ex.sampleNames.forEach(s=>{ groups[s] = s.startsWith("Ctrl") ? "Control" : "Treatment"; });
    setSampleGroups(groups);
    setGroupColors({Control:GROUP_PALETTE[0], Treatment:GROUP_PALETTE[1]});
  };

  // ── Save / load: one file holds every sheet ──────────────────────────────
  const saveProject = useCallback(()=>{
    const a=document.createElement("a");
    a.href="data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify({version:2, tool:"heatmap", sheets},null,2));
    a.download="heatmap_project_"+new Date().toISOString().slice(0,10)+".json";
    a.click();
  },[sheets]);

  const loadProject = data => {
    if (!data) return;
    // v2 = multi-sheet. v1 = single dataset; wrap it so old project files still open.
    let loaded=null;
    if (data.sheets && data.sheets.length) {
      loaded = data.sheets.map(s=>({...mkSheet(s.name||"Sheet"), ...s}));
    } else if (data.matrix) {
      const base = mkSheet("Heatmap 1");
      loaded = [{...base,
        matrix:data.matrix,
        sampleGroups:data.sampleGroups||{}, groupColors:data.groupColors||{},
        display:{...DEFAULT_DISPLAY, ...(data.display||{})},
        stats:{...DEFAULT_STATS, ...(data.stats||{})},
      }];
    }
    if (!loaded || !loaded.length) return;
    setSheets(loaded); setActiveId(loaded[0].id);
    loaded.forEach(s=>{ historyMap.current[s.id]=[s.matrix]; cursorMap.current[s.id]=0; });
    forceUpdate(v=>v+1);
  };

  useEffect(()=>{
    const handler = e => {
      if ((e.ctrlKey||e.metaKey) && !e.shiftKey && e.key==="z") { e.preventDefault(); undoMatrix(); }
      if ((e.ctrlKey||e.metaKey) && (e.key==="y" || (e.shiftKey && e.key==="z"))) { e.preventDefault(); redoMatrix(); }
      if ((e.ctrlKey||e.metaKey) && e.key==="s") { e.preventDefault(); saveProject(); }
    };
    window.addEventListener("keydown",handler);
    return ()=>window.removeEventListener("keydown",handler);
  },[undoMatrix,redoMatrix,saveProject]);

  // Every newly-seen sample defaults into "Group 1" so it always has a valid group.
  useEffect(()=>{
    if (!matrix.sampleNames.length) return;
    setSampleGroups(prev=>{
      const next={...prev}; let changed=false;
      matrix.sampleNames.forEach(s=>{ if(!next[s]){ next[s]="Group 1"; changed=true; } });
      return changed?next:prev;
    });
  },[matrix.sampleNames, setSampleGroups]);

  // Full resync (not append-only): groupColors is rebuilt from whatever groups
  // actually exist right now. A color survives if its group still has samples
  // in it; anything else disappears on the next render instead of persisting.
  useEffect(()=>{
    const distinctGroups=[...new Set(matrix.sampleNames.map(s=>sampleGroups[s]||"Group 1"))];
    setGroupColors(prev=>{
      const next={};
      distinctGroups.forEach((g,i)=>{ next[g] = prev[g] || GROUP_PALETTE[i%GROUP_PALETTE.length]; });
      const same = Object.keys(prev).length===Object.keys(next).length && Object.keys(prev).every(k=>prev[k]===next[k]);
      return same ? prev : next;
    });
  },[matrix.sampleNames, sampleGroups, setGroupColors]);

  // ── Preprocessing: log2, top-variable-gene filter, z-score ───────────────
  const processed = useMemo(()=>{
    if (matrix.geneNames.length<1 || matrix.sampleNames.length<2) return {geneNames:[], sampleNames:matrix.sampleNames, matrix:[], zMatrix:[], nGenesUsed:0};
    let vals = matrix.values;
    if (stats.log2Transform) vals = vals.map(row=>row.map(v=>Math.log2(Math.max(v,0)+1)));

    let geneIdx = vals.map((_,i)=>i);
    const topN = stats.topVarGenes;
    if (topN < vals.length) {
      const variances = vals.map(row=>{
        const m=row.reduce((a,b)=>a+b,0)/row.length;
        return row.reduce((a,b)=>a+(b-m)*(b-m),0)/row.length;
      });
      geneIdx = geneIdx.sort((a,b)=>variances[b]-variances[a]).slice(0,topN);
    }
    geneIdx.sort((a,b)=>a-b);
    const filteredVals = geneIdx.map(gi=>vals[gi]);
    const filteredGeneNames = geneIdx.map(gi=>matrix.geneNames[gi]);
    const zMatrix = filteredVals.map(row=>zscoreRow(row));
    return {geneNames:filteredGeneNames, sampleNames:matrix.sampleNames, matrix:filteredVals, zMatrix, nGenesUsed:geneIdx.length};
  },[matrix, stats.log2Transform, stats.topVarGenes]);

  const LEFT_TABS=[["data","Data"],["groups","Groups"]];
  const RIGHT_TABS=[{id:"cluster",icon:"\u2699",label:"Cluster"},{id:"style",icon:"\uD83C\uDFA8",label:"Style"},{id:"export",icon:"\u2B07",label:"Export"}];

  return (
      <div style={{height:"100%",background:activeTheme.bg,color:activeTheme.text,fontFamily:"Inter,system-ui,sans-serif",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"0 16px",borderBottom:"1px solid "+activeTheme.border,background:activeTheme.panel,display:"flex",alignItems:"center",gap:12,flexShrink:0,height:48,boxShadow:activeTheme.shadow}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>{"\uD83D\uDD25"}</span>
            
            <span style={{fontSize:11,color:activeTheme.muted,padding:"2px 8px",borderRadius:10,background:activeTheme.panel2,border:"1px solid "+activeTheme.border}}>Heatmap</span>
          </div>
          <div style={{height:20,width:1,background:activeTheme.border}}/>
          <span style={{fontSize:12,fontWeight:600,color:activeTheme.muted}}>{activeSheet.name}</span>
          <div style={{flex:1}}/>
        <CloudProjects tool="heatmap" getData={()=>({version:2,tool:"heatmap",sheets})} onLoad={loadProject}/>
          <div style={{display:"flex",background:activeTheme.panel2,borderRadius:8,padding:2,border:"1px solid "+activeTheme.border}}>
            {[["split","Split"],["data","Data"],["plot","Plot"]].map(([id,lb])=>(
              <button key={id} onClick={()=>setLayout(id)} style={{padding:"4px 12px",fontSize:11,fontWeight:600,cursor:"pointer",borderRadius:6,border:"none",background:layout===id?activeTheme.panel:"transparent",color:layout===id?activeTheme.text:activeTheme.muted,boxShadow:layout===id?activeTheme.shadow:"none"}}>{lb}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:3}}>
            <button onClick={undoMatrix} disabled={!canUndoMatrix} title="Ctrl+Z" style={{padding:"4px 10px",borderRadius:6,fontSize:11,background:"transparent",border:"1px solid "+activeTheme.border,cursor:canUndoMatrix?"pointer":"default",color:canUndoMatrix?activeTheme.text:activeTheme.muted}}>Undo</button>
            <button onClick={redoMatrix} disabled={!canRedoMatrix} title="Ctrl+Y" style={{padding:"4px 10px",borderRadius:6,fontSize:11,background:"transparent",border:"1px solid "+activeTheme.border,cursor:canRedoMatrix?"pointer":"default",color:canRedoMatrix?activeTheme.text:activeTheme.muted}}>Redo</button>
          </div>
        </div>
        <div style={{flex:1,display:"flex",minHeight:0,overflow:"hidden"}}>
          <SheetSidebar sheets={sheets} activeId={activeId} onSelect={selectSheet} onNew={newSheet} onRename={renameSheet}
            onDuplicate={duplicateSheet} onDelete={deleteSheet} onSave={saveProject} onLoad={loadProject}/>
          <div style={{flex:1,display:"flex",minWidth:0,overflow:"hidden"}}>
            {(layout==="split"||layout==="data")&&(
              <div style={{flex:1,overflowY:"auto",padding:"16px 18px",borderRight:layout==="split"?"1px solid "+activeTheme.border:"none",minWidth:0}}>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:15,fontWeight:700,color:activeTheme.text}}>{activeSheet.name}</div>
                  <div style={{fontSize:11,color:activeTheme.muted,marginTop:2}}>Paste an expression matrix with genes as rows and samples as columns, or load the example dataset.</div>
                </div>
                <div style={{display:"flex",gap:4,marginBottom:14,background:activeTheme.panel2,borderRadius:8,padding:2,border:"1px solid "+activeTheme.border,width:"fit-content"}}>
                  {LEFT_TABS.map(([id,lb])=>(
                    <button key={id} onClick={()=>setLeftTab(id)} style={{padding:"5px 16px",fontSize:11,fontWeight:600,cursor:"pointer",borderRadius:6,border:"none",background:leftTab===id?activeTheme.panel:"transparent",color:leftTab===id?activeTheme.text:activeTheme.muted}}>{lb}</button>
                  ))}
                </div>
                {leftTab==="data"&&<MatrixGrid matrix={matrix} setMatrix={setMatrix} undo={undoMatrix} redo={redoMatrix} canUndo={canUndoMatrix} canRedo={canRedoMatrix} onLoadExample={loadExample}/>}
                {leftTab==="groups"&&<SampleGroupsPanel sampleNames={matrix.sampleNames} sampleGroups={sampleGroups} setSampleGroups={setSampleGroups} groupColors={groupColors} setGroupColors={setGroupColors}/>}
                {layout==="data"&&<div style={{marginTop:18,display:"flex",justifyContent:"center"}}><button onClick={()=>setLayout("plot")} style={{padding:"10px 32px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",background:activeTheme.accent,border:"none",color:"#fff",boxShadow:activeTheme.shadow}}>Generate Heatmap</button></div>}
              </div>
            )}
            {(layout==="split"||layout==="plot")&&(
              <div style={{flex:1,overflowY:"auto",padding:"16px 18px",minWidth:0}} ref={plotRef}>
                {processed.geneNames.length>0 ? (
                  <ThemeCtx.Provider value={LIGHT}>{/* Figure always on white paper with the light palette (see VolcanoPlot). */}
                  <ErrorBoundary>
                    <Heatmap geneNames={processed.geneNames} sampleNames={processed.sampleNames} matrix={processed.matrix} zMatrix={processed.zMatrix}
                      stats={stats} display={display} sampleGroups={sampleGroups} groupColors={groupColors}/>
                  </ErrorBoundary>
                  </ThemeCtx.Provider>
                ) : (
                  <div style={{padding:"60px 20px",textAlign:"center",color:activeTheme.muted,fontSize:12}}>
                    Paste an expression matrix (or load the example) with at least 2 samples to see the heatmap.
                  </div>
                )}
                <div style={{marginTop:10,fontSize:11,color:activeTheme.muted,textAlign:"center"}}>
                  {matrix.geneNames.length} genes · {processed.nGenesUsed||0} used after variance filter · {matrix.sampleNames.length} samples · {sheets.length} sheet{sheets.length!==1?"s":""} · Ctrl+S to save
                </div>
                {layout==="plot"&&<div style={{marginTop:10,textAlign:"center"}}><button onClick={()=>setLayout("data")} style={{padding:"5px 14px",borderRadius:6,fontSize:12,cursor:"pointer",background:"transparent",border:"1px solid "+activeTheme.border,color:activeTheme.muted}}>Back to data</button></div>}
              </div>
            )}
          </div>
          <div style={{width:242,background:activeTheme.panel,borderLeft:"1px solid "+activeTheme.border,display:"flex",flexDirection:"column",flexShrink:0}}>
            <div style={{display:"flex",borderBottom:"1px solid "+activeTheme.border,background:activeTheme.panel2}}>
              {RIGHT_TABS.map(tab=>(
                <button key={tab.id} onClick={()=>setRightTab(tab.id)} style={{flex:1,padding:"8px 2px 6px",fontSize:9,fontWeight:700,cursor:"pointer",border:"none",background:"transparent",color:rightTab===tab.id?activeTheme.accent:activeTheme.muted,borderBottom:"2px solid "+(rightTab===tab.id?activeTheme.accent:"transparent"),display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  <span style={{fontSize:14}}>{tab.icon}</span>{tab.label}
                </button>
              ))}
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"14px 12px"}}>
              {rightTab==="cluster"&&<ClusteringPanel stats={stats} setStats={setStats} nGenesTotal={matrix.geneNames.length} nGenesUsed={processed.nGenesUsed||0}/>}
              {rightTab==="style"&&<StylePanel display={display} setDisplay={setDisplay}/>}
              {rightTab==="export"&&<ExportPanel plotRef={plotRef} display={display}/>}
            </div>
            <div style={{padding:"6px 12px",borderTop:"1px solid "+activeTheme.border,fontSize:10,color:activeTheme.muted,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span>{matrix.sampleNames.length} samples</span>
              <span style={{color:processed.nGenesUsed>0?activeTheme.accent:activeTheme.muted}}>{processed.nGenesUsed||0} genes</span>
              <span>Ctrl+S</span>
            </div>
          </div>
        </div>
      </div>
  );
}
