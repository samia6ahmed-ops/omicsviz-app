import React, { useState, useMemo, useRef, useCallback, useEffect, useContext } from "react";
import { readProjectText } from "../shared/projectFile";
import { rowsToMatrixClean, guessHeaderRow } from "../shared/importUtils";
import { loadXLSX, XLSX_FAIL_MSG } from "../shared/loadXLSX";
import { encodeCanvas } from "../shared/exportUtils";
import { ThemeCtx, useTheme, LIGHT } from "../shared/theme";
import { withDefaultGroups } from "../shared/inferGroups";
import AutoGroupButton from "../shared/AutoGroupButton";
import CloudProjects from "../shared/CloudProjects";

// ════════════════════════════════════════════════════════════════════════════
// Omilytix — PCA Plot
// Computes principal components in-browser from a raw expression matrix
// (genes as rows, samples as columns). Uses the dual-space / Gram-matrix
// trick so performance stays independent of gene count — only the
// samples × samples covariance needs to be eigendecomposed.
// ════════════════════════════════════════════════════════════════════════════

// ─── Design tokens (shared across the Omilytix suite) ─────────────────────────
// Theme tokens live in src/shared/theme.js (shared with the app shell).
const FONTS = ["Inter","Arial","Helvetica","Times New Roman","Georgia","Courier New"];
const GROUP_PALETTE = ["#2563EB","#DC2626","#16A34A","#D97706","#7C3AED","#DB2777","#0891B2","#65A30D","#B91C1C","#4338CA"];
const CHI_SQ = {0.90:4.605, 0.95:5.991, 0.99:9.210}; // chi-square critical values, 2 dof

// ─── Example expression matrix (8 samples, 2 groups, 40 genes) ────────────────
function buildExampleMatrix() {
  const sampleNames = ["Ctrl_1","Ctrl_2","Ctrl_3","Ctrl_4","Treat_1","Treat_2","Treat_3","Treat_4"];
  const nGenes = 40;
  let seed = 42;
  const rand = () => { seed = (seed*1103515245+12345) & 0x7fffffff; return seed/0x7fffffff; };
  const geneNames = Array.from({length:nGenes}, (_,i)=>"Gene_"+String(i+1).padStart(3,"0"));
  const values = geneNames.map((_,gi)=>{
    const isDE = gi < 15; // first 15 genes actually separate the groups
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

// ─── Matrix parsing ─────────────────────────────────────────────────────────────
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

// ─── Linear algebra: Jacobi eigenvalue algorithm for symmetric matrices ───────
// Validated against known eigenvalues/eigenvectors and reconstruction error
// (A = V diag(λ) Vᵀ) before being wired into the PCA pipeline.
function jacobiEigen(A, maxSweeps=100, tol=1e-10) {
  const n = A.length;
  const a = A.map(row=>[...row]);
  const v = Array.from({length:n}, (_,i)=>Array.from({length:n}, (_,j)=>i===j?1:0));
  for (let sweep=0; sweep<maxSweeps; sweep++) {
    let off=0;
    for (let i=0;i<n;i++) for (let j=i+1;j<n;j++) off += a[i][j]*a[i][j];
    if (off<tol) break;
    for (let p=0;p<n;p++) {
      for (let q=p+1;q<n;q++) {
        if (Math.abs(a[p][q])<1e-14) continue;
        const theta=(a[q][q]-a[p][p])/(2*a[p][q]);
        const t=(theta>=0?1:-1)/(Math.abs(theta)+Math.sqrt(theta*theta+1));
        const c=1/Math.sqrt(t*t+1), s=t*c;
        const app=a[p][p], aqq=a[q][q], apq=a[p][q];
        a[p][p]=c*c*app-2*s*c*apq+s*s*aqq;
        a[q][q]=s*s*app+2*s*c*apq+c*c*aqq;
        a[p][q]=0; a[q][p]=0;
        for (let k=0;k<n;k++) {
          if (k!==p && k!==q) {
            const akp=a[k][p], akq=a[k][q];
            a[k][p]=c*akp-s*akq; a[p][k]=a[k][p];
            a[k][q]=s*akp+c*akq; a[q][k]=a[k][q];
          }
        }
        for (let k=0;k<n;k++) {
          const vkp=v[k][p], vkq=v[k][q];
          v[k][p]=c*vkp-s*vkq;
          v[k][q]=s*vkp+c*vkq;
        }
      }
    }
  }
  const eigenvalues = a.map((row,i)=>row[i]);
  const order = eigenvalues.map((_,i)=>i).sort((i,j)=>eigenvalues[j]-eigenvalues[i]);
  return {
    values: order.map(i=>eigenvalues[i]),
    vectors: order.map(i=>v.map(row=>row[i])),
  };
}

function transpose(A) { return A[0].map((_,j)=>A.map(row=>row[j])); }
function matMul(A,B) {
  const n=A.length, m=B[0].length, k=B.length;
  const C=Array.from({length:n},()=>new Array(m).fill(0));
  for (let i=0;i<n;i++) for (let j=0;j<m;j++) for (let l=0;l<k;l++) C[i][j]+=A[i][l]*B[l][j];
  return C;
}
function centerColumns(X) {
  const n=X.length, p=X[0].length;
  const means=new Array(p).fill(0);
  for (let j=0;j<p;j++) { for (let i=0;i<n;i++) means[j]+=X[i][j]; means[j]/=n; }
  return X.map(row=>row.map((v,j)=>v-means[j]));
}

// ─── PCA — dual-space (Gram matrix) method ─────────────────────────────────────
// X: samples (rows) × genes (columns). Efficient regardless of gene count
// since only the n×n sample covariance is eigendecomposed (validated to
// match classical primal-space PCA on a synthetic two-group dataset).
function computePCA(X) {
  const n = X.length;
  if (n<3) return {scores:[], varExplained:[], nComp:0};
  const Xc = centerColumns(X);
  const G = matMul(Xc, transpose(Xc));
  const eig = jacobiEigen(G);
  const totalVar = eig.values.reduce((a,b)=>a+Math.max(b,0),0) || 1;
  const nComp = n-1;
  const compScores = [];
  for (let k=0;k<nComp;k++) {
    const lambda = Math.max(eig.values[k],0);
    const s = Math.sqrt(lambda);
    compScores.push(eig.vectors[k].map(v=>v*s));
  }
  const varExplained = eig.values.slice(0,nComp).map(v=>Math.max(v,0)/totalVar);
  // scores[sampleIdx][pcIdx]
  const scores = X.map((_,si)=>compScores.map(comp=>comp[si]));
  return {scores, varExplained, nComp};
}

// 95%-style confidence ellipse for a group of 2D points (validated against
// synthetic Gaussian clusters of known variance).
function confidenceEllipse(points, chiSq) {
  const n = points.length;
  if (n<3) return null;
  const mx=points.reduce((s,p)=>s+p[0],0)/n, my=points.reduce((s,p)=>s+p[1],0)/n;
  let sxx=0, syy=0, sxy=0;
  points.forEach(p=>{ const dx=p[0]-mx, dy=p[1]-my; sxx+=dx*dx; syy+=dy*dy; sxy+=dx*dy; });
  sxx/=(n-1); syy/=(n-1); sxy/=(n-1);
  const eig = jacobiEigen([[sxx,sxy],[sxy,syy]]);
  const a = Math.sqrt(Math.max(eig.values[0],0)*chiSq);
  const b = Math.sqrt(Math.max(eig.values[1],0)*chiSq);
  return {cx:mx, cy:my, semiA:a, semiB:b, axis1:eig.vectors[0]};
}
function ellipsePathPoints(ellipse, nSeg=48) {
  if (!ellipse) return [];
  const {cx,cy,semiA,semiB,axis1} = ellipse;
  const angle = Math.atan2(axis1[1], axis1[0]);
  const cosA=Math.cos(angle), sinA=Math.sin(angle);
  const pts=[];
  for (let i=0;i<=nSeg;i++) {
    const t=(i/nSeg)*2*Math.PI;
    const lx=semiA*Math.cos(t), ly=semiB*Math.sin(t);
    pts.push([cx+lx*cosA-ly*sinA, cy+lx*sinA+ly*cosA]);
  }
  return pts;
}

// ─── Style resolver ─────────────────────────────────────────────────────────────
function resolveStyles(display, theme) {
  const font = display.ff || "Inter";
  const textStyle=(sizeKey,boldKey,italicKey,colorKey,fallback)=>({
    fontSize:display[sizeKey]||12, fontWeight:display[boldKey]?"bold":"normal",
    fontStyle:display[italicKey]?"italic":"normal", fill:display[colorKey]||fallback, fontFamily:font,
  });
  return {
    font,
    title:{fontSize:display.titleSize||14, fontWeight:display.titleBold?"bold":"normal", fontStyle:display.titleItalic?"italic":"normal", color:display.titleColor||theme.text, fontFamily:font},
    axis:textStyle("axisSize","axisBold","axisItalic","axisColor",theme.text),
    tick:textStyle("tickSize","tickBold","tickItalic","tickColor",theme.text),
    pointLabel:textStyle("labelSize","labelBold","labelItalic","labelColorOverride",theme.muted),
    plotBg:display.plotBg||theme.panel,
    gridColor:display.gridColor||theme.grid,
    axisWidth:display.axisWidth||1.2,
    gridWidth:display.gridWidth||0.5,
    axisLineColor:display.axisColor||theme.text,
  };
}

// ─── Defaults ───────────────────────────────────────────────────────────────────
const DEFAULT_DISPLAY = {
  ff:"Inter", plotTitle:"",
  xLbl:"", yLbl:"", // blank = auto "PCn (xx.x%)"
  titleSize:14, titleBold:true, titleItalic:false, titleColor:"",
  axisSize:12, axisBold:false, axisItalic:false, axisColor:"#1a1a1a",
  tickSize:10, tickBold:false, tickItalic:false, tickColor:"#1a1a1a",
  labelSize:9, labelBold:false, labelItalic:false, labelColorOverride:"",
  plotBg:"", gridColor:"", axisWidth:1.2, gridWidth:0.5, showGrid:true, frameStyle:"open",
};
const DEFAULT_STATS = {
  dotRadius:5, showLabels:true, repelLabels:true,
  showEllipses:true, ellipseConfidence:0.95,
  pcX:0, pcY:1,
  xMin:"auto", xMax:"auto", yMin:"auto", yMax:"auto",
  log2Transform:true, scaleUnitVariance:false, topVarGenes:2000,
};

const LEGEND_ITEMS = [
  {id:"title",  label:"Header",       desc:"Sample / gene counts"},
  {id:"groups", label:"Group colors", desc:"One row per group"},
  {id:"varexp", label:"Variance",     desc:"% explained by plotted PCs"},
];
const MM_PRESETS = [
  {label:"89mm",  desc:"Single col", w:89},
  {label:"120mm", desc:"1.5 col",    w:120},
  {label:"183mm", desc:"Double col", w:183},
  {label:"247mm", desc:"Full page",  w:247},
];

// ─── Sheet model ────────────────────────────────────────────────────────────
// One sheet = one complete PCA dataset (matrix + grouping + styling + legend).
// Sheets are independent; the sidebar switches between them and Save Project
// writes them all into a single file.
const LEGEND_TOP = 30;
const EMPTY_MATRIX = {sampleNames:[], geneNames:[], values:[]};

function mkSheet(name) {
  const legendVisible = {};
  LEGEND_ITEMS.forEach(x=>{ legendVisible[x.id] = true; });
  return {
    id: Date.now()+Math.random(), name,
    matrix: {sampleNames:[], geneNames:[], values:[]},
    sampleGroups: {}, groupColors: {},
    display: {...DEFAULT_DISPLAY}, stats: {...DEFAULT_STATS},
    legendVisible,
    legendStyle: {fontSize:11, bold:false, color:""},
    legendPos: {x:548, y:LEGEND_TOP},
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

// ─── Matrix input panel ─────────────────────────────────────────────────────────
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

// rows -> matrix: see shared/importUtils (skips annotation columns, drops genes
// with missing values instead of filling them with 0, cleans BAM-path headers).
const rowsToMatrix = rowsToMatrixClean;

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
    setHeaderRow(guessHeaderRow(rows)); setIdCol(0); setError(null);
  };

  const readFile = async file => {
    setError(null); setBusy(true);
    try {
      const isXlsx=/\.(xlsx|xlsm|xls)$/i.test(file.name);
      if (isXlsx) {
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
    setHeaderRow(guessHeaderRow(rows)); setIdCol(0);
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
    if (built.droppedRows>0) warnings.push(built.droppedRows+" gene(s) with missing or non-numeric values (NA, blank, text) were left out.");
    if (built.skippedCols && built.skippedCols.length) warnings.push("Skipped non-sample column(s): "+built.skippedCols.slice(0,6).join(", ")+(built.skippedCols.length>6?"…":"")+".");
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
          <div style={{fontSize:10.5, color:t.muted}}>CSV, TSV, or TXT · Excel .xlsx</div>
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

      {(built.droppedRows>0||built.skippedCols.length>0)&&(
        <div style={{fontSize:11, lineHeight:1.6, padding:"8px 10px", borderRadius:6, marginBottom:9, background:t.tag, color:t.tagText, border:"1px solid "+t.cBorder}}>
          {built.droppedRows>0&&<div>{built.droppedRows} gene{built.droppedRows!==1?"s":""} with missing values (NA, blank or text) will be left out.</div>}
          {built.skippedCols.length>0&&<div>Skipping non-sample column{built.skippedCols.length!==1?"s":""}: {built.skippedCols.slice(0,6).join(", ")}{built.skippedCols.length>6?"…":""}</div>}
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
  const [focus, setFocus] = useState(null); // {r,c} r=0 header row, r>=1 gene row; c=0 gene/corner, c>=1 sample col
  const [confirmClr, setConfirmClr] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [rowLimit, setRowLimit] = useState(GRID_ROW_CAP);
  const [advancedText, setAdvancedText] = useState("");
  const [importFeedback, setImportFeedback] = useState(null); // {type:'error'|'warning', messages:[]}
  const cellRefs = useRef({});
  const nCols = sampleNames.length + 1;
  const nRows = geneNames.length + 1; // +1 for header row

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

  const onCellPaste = useCallback((e,r,c)=>{
    const text=e.clipboardData.getData("text");
    e.preventDefault();
    doPaste(text,r,c);
  },[doPaste]);

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
          style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+t.border, cursor:canUndo?"pointer":"default", color:canUndo?t.text:t.muted}}>
          Undo
        </button>
        <button onClick={redo} disabled={!canRedo}
          style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+t.border, cursor:canRedo?"pointer":"default", color:canRedo?t.text:t.muted}}>
          Redo
        </button>
        {!confirmClr
          ? <button onClick={()=>setConfirmClr(true)}
              style={{padding:"4px 10px", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>
              Clear
            </button>
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
        Click any cell and paste directly from Excel or a normalized-counts export (DESeq2, edgeR) — pasting at the top-left corner fills in sample names and gene rows together. Arrow keys and Tab to navigate; double-click a header to rename a sample.
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
        <span style={{fontSize:10, color:t.muted}}>Rows beyond your data are ignored when computing PCA.</span>
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
function SampleGroupsPanel({sampleNames, sampleGroups, setSampleGroups, groupColors, setGroupColors}) {
  const t=useTheme();
  if (!sampleNames.length) {
    return <div style={{fontSize:12, color:t.muted, padding:"20px 8px", textAlign:"center"}}>Paste a matrix in the Data tab first — sample names will appear here for group assignment.</div>;
  }
  const distinctGroups = [...new Set(sampleNames.map(s=>sampleGroups[s]||"Group 1"))];
  return (
    <div>
      <SectionLabel>Assign Each Sample to a Group</SectionLabel>
      <div style={{fontSize:11, color:t.muted, marginBottom:10, lineHeight:1.5}}>
        Group names drive point color and the confidence ellipses. Samples with the same group name are treated as replicates.
      </div>
      <AutoGroupButton sampleNames={sampleNames} setSampleGroups={setSampleGroups}/>
      <div style={{border:"1px solid "+t.border, borderRadius:8, overflow:"hidden", marginBottom:14}}>
        {sampleNames.map((s,i)=>(
          <div key={s} style={{display:"flex", alignItems:"center", gap:8, padding:"6px 10px", borderBottom:i<sampleNames.length-1?"1px solid "+t.cBorder:"none", background:i%2===0?t.cBg:t.panel}}>
            <span style={{fontSize:11, fontFamily:"monospace", color:t.text, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{s}</span>
            <input value={sampleGroups[s]||"Group 1"} onChange={e=>setSampleGroups(prev=>({...prev,[s]:e.target.value}))}
              style={{width:110, padding:"3px 7px", fontSize:11, borderRadius:5, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none"}}/>
          </div>
        ))}
      </div>

      <SectionLabel>Group Colors</SectionLabel>
      <div style={{display:"flex", flexDirection:"column", gap:6}}>
        {distinctGroups.map((g,i)=>(
          <div key={g} style={{display:"flex", alignItems:"center", gap:8}}>
            <ColorSwatch color={groupColors[g]||GROUP_PALETTE[i%GROUP_PALETTE.length]} onChange={v=>setGroupColors(prev=>({...prev,[g]:v}))}/>
            <span style={{fontSize:11, color:t.text, fontWeight:600}}>{g}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Preprocessing panel ────────────────────────────────────────────────────────
function PreprocessingPanel({stats, setStats, nGenesTotal, nGenesUsed}) {
  const t=useTheme();
  return (
    <div>
      <SectionLabel>Transform</SectionLabel>
      <Toggle value={stats.log2Transform} onChange={v=>setStats(s=>({...s,log2Transform:v}))} label="log2(x + 1) transform"/>
      <div style={{fontSize:10, color:t.muted, lineHeight:1.5, marginTop:-4, marginBottom:10}}>
        Standard for raw or normalized RNA-seq counts — compresses the dynamic range so a handful of very highly expressed genes don't dominate the variance.
      </div>
      <Toggle value={stats.scaleUnitVariance} onChange={v=>setStats(s=>({...s,scaleUnitVariance:v}))} label="Scale genes to unit variance"/>
      <div style={{fontSize:10, color:t.muted, lineHeight:1.5, marginBottom:10}}>
        Off = covariance-based PCA (expression-magnitude genes dominate). On = correlation-based PCA (every gene weighted equally regardless of expression level).
      </div>

      <Divider/>
      <SectionLabel>Most-Variable Gene Filter</SectionLabel>
      <LabeledSlider label="Top N genes by variance" value={stats.topVarGenes} min={50} max={5000} step={50}
        onChange={v=>setStats(s=>({...s,topVarGenes:v}))} display={stats.topVarGenes>=nGenesTotal?"All ("+nGenesTotal+")":stats.topVarGenes}/>
      <div style={{fontSize:10, color:t.muted, lineHeight:1.5}}>
        {nGenesTotal>0
          ? "Using "+nGenesUsed.toLocaleString()+" of "+nGenesTotal.toLocaleString()+" genes. Restricting to the most variable genes (typical: 500\u20132000) reduces noise from genes that don't vary meaningfully across samples — this is the same default DESeq2's plotPCA() and Seurat use."
          : "Paste a matrix to see how many genes will be used."}
      </div>

      <Divider/>
      <SectionLabel>Confidence Ellipses</SectionLabel>
      <Toggle value={stats.showEllipses} onChange={v=>setStats(s=>({...s,showEllipses:v}))} label="Show group confidence ellipses"/>
      {stats.showEllipses&&(
        <div style={{display:"flex", gap:5, marginBottom:10}}>
          {[0.90,0.95,0.99].map(c=>(
            <Pill key={c} active={stats.ellipseConfidence===c} onClick={()=>setStats(s=>({...s,ellipseConfidence:c}))}>{(c*100)+"%"}</Pill>
          ))}
        </div>
      )}
      <div style={{fontSize:10, color:t.muted, lineHeight:1.5}}>Ellipses need at least 3 samples per group to draw — groups with fewer replicates are skipped.</div>

      <Divider/>
      <SectionLabel>Sample Points</SectionLabel>
      <LabeledSlider label="Dot radius" value={stats.dotRadius} min={2} max={12} step={0.5}
        onChange={v=>setStats(s=>({...s,dotRadius:v}))} display={stats.dotRadius+"px"}/>
      <Toggle value={stats.showLabels} onChange={v=>setStats(s=>({...s,showLabels:v}))} label="Show sample name labels"/>
      {stats.showLabels&&<Toggle value={stats.repelLabels!==false} onChange={v=>setStats(s=>({...s,repelLabels:v}))} label="Repel overlapping labels"/>}
    </div>
  );
}

// ─── Axes panel (PC selection + ranges) ────────────────────────────────────────
function AxesPanel({display, setDisplay, stats, setStats, varExplained}) {
  const t=useTheme();
  const nComp = varExplained.length;
  const pcOptions = Array.from({length:nComp}, (_,i)=>i);
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
      <SectionLabel>Principal Components to Plot</SectionLabel>
      {nComp===0
        ? <div style={{fontSize:11, color:t.muted}}>Paste a matrix with at least 3 samples to compute components.</div>
        : (
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10}}>
            <div>
              <div style={{fontSize:10, color:t.muted, marginBottom:3}}>X axis</div>
              <select value={stats.pcX} onChange={e=>setStats(s=>({...s,pcX:+e.target.value}))}
                style={{width:"100%", padding:"5px 7px", fontSize:11, borderRadius:5, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none"}}>
                {pcOptions.map(i=><option key={i} value={i}>PC{i+1} ({(varExplained[i]*100).toFixed(1)}%)</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:10, color:t.muted, marginBottom:3}}>Y axis</div>
              <select value={stats.pcY} onChange={e=>setStats(s=>({...s,pcY:+e.target.value}))}
                style={{width:"100%", padding:"5px 7px", fontSize:11, borderRadius:5, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none"}}>
                {pcOptions.map(i=><option key={i} value={i}>PC{i+1} ({(varExplained[i]*100).toFixed(1)}%)</option>)}
              </select>
            </div>
          </div>
        )}

      <Divider/>
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
      <SectionLabel>Line Thickness</SectionLabel>
      <LabeledSlider label="Axis lines" value={display.axisWidth||1.2} min={0.5} max={5} step={0.1}
        onChange={v=>setDisplay(s=>({...s,axisWidth:v}))} display={(display.axisWidth||1.2)+"px"}/>
      <LabeledSlider label="Grid lines" value={display.gridWidth||0.5} min={0.3} max={3} step={0.1}
        onChange={v=>setDisplay(s=>({...s,gridWidth:v}))} display={(display.gridWidth||0.5)+"px"}/>
    </div>
  );
}

function StylePanel({display, setDisplay}) {
  const t=useTheme();
  return (
    <div>
      <SectionLabel>Figure Title</SectionLabel>
      <input value={display.plotTitle||""} onChange={e=>setDisplay(s=>({...s,plotTitle:e.target.value}))} placeholder="e.g. Sample Clustering (PCA)"
        style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:12, borderRadius:6, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none", marginBottom:10}}/>

      <Divider/>
      <SectionLabel>Axis Labels</SectionLabel>
      <div style={{fontSize:10, color:t.muted, marginBottom:6}}>Leave blank to auto-generate "PCn (xx.x% variance)".</div>
      <input value={display.xLbl||""} onChange={e=>setDisplay(s=>({...s,xLbl:e.target.value}))} placeholder="auto"
        style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:11, borderRadius:6, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none", marginBottom:6}}/>
      <input value={display.yLbl||""} onChange={e=>setDisplay(s=>({...s,yLbl:e.target.value}))} placeholder="auto"
        style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:11, borderRadius:6, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none", marginBottom:10}}/>

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
        {[["Axis labels","axisSize"],["Tick labels","tickSize"],["Sample labels","labelSize"],["Title","titleSize"]].map(([lb,key])=>(
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

function LegendPanel({legendVisible, setLegendVisible, legendStyle, setLegendStyle, legendPos, setLegendPos, topMargin}) {
  const t=useTheme();
  const isVisible=id=>legendVisible[id]!==false;
  return (
    <div>
      <SectionLabel>Visible Legend Items</SectionLabel>
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
          style={{width:26, height:26, borderRadius:5, border:"1px solid "+t.border, background:t.panel2, color:t.text, cursor:"pointer", fontSize:15, fontWeight:700}}>-</button>
        <span style={{fontSize:12, fontWeight:700, color:t.accent, minWidth:20, textAlign:"center"}}>{legendStyle.fontSize}</span>
        <button onClick={()=>setLegendStyle(s=>({...s,fontSize:Math.min(18,s.fontSize+1)}))}
          style={{width:26, height:26, borderRadius:5, border:"1px solid "+t.border, background:t.panel2, color:t.text, cursor:"pointer", fontSize:15, fontWeight:700}}>+</button>
      </div>
      <Divider/>
      <SectionLabel>Position</SectionLabel>
      <div style={{fontSize:11, color:t.muted, marginBottom:8, lineHeight:1.5}}>Drag the legend anywhere on the plot to reposition it.</div>
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

function ExportPanel({plotRef, display}) {
  const t=useTheme();
  const [format,setFormat]=useState("png");
  const [dpi,setDpi]=useState(300);
  const [mmWidth,setMmWidth]=useState(183);
  const [mmHeight,setMmHeight]=useState(120);
  const [useMm,setUseMm]=useState(false);
  const [saving,setSaving]=useState(false);
  const [done,setDone]=useState(false);
  const [err,setErr]=useState(null);

  const runExport=async()=>{
    setSaving(true); setErr(null);
    const name="pca_plot_"+new Date().toISOString().slice(0,10);
    await new Promise(r=>setTimeout(r,60));
    try {
      const svgEl=plotRef&&plotRef.current&&plotRef.current.querySelector("svg");
      if(!svgEl){ setErr("Couldn't find the plot. Switch to the Plot or Split view and try again."); return; }
      const clone=svgEl.cloneNode(true);
      clone.style.removeProperty("width"); clone.style.removeProperty("max-width"); clone.style.removeProperty("height"); // on-screen scaling only
      clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
      const vb=(svgEl.getAttribute("viewBox")||"0 0 700 420").split(" ").map(Number);
      const svgW=vb[2]||700, svgH=vb[3]||420;
      const bgFill=display.plotBg||"#ffffff"; // figures are always on white paper
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
  const svgPreview=plotRef&&plotRef.current&&plotRef.current.querySelector("svg");
  const vbPreview=((svgPreview&&svgPreview.getAttribute("viewBox"))||"0 0 680 400").split(" ").map(Number);
  const previewW=useMm?Math.round(mmWidth/25.4*dpi):Math.round((vbPreview[2]||680)*(dpi/96));
  const previewH=useMm?Math.round(mmHeight/25.4*dpi):Math.round((vbPreview[3]||400)*(dpi/96));

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
          <input type="number" min={72} max={1200} value={dpi} onChange={e=>setDpi(Math.min(1200,Math.max(72,+e.target.value||72)))}
            style={{width:"100%", padding:"5px 7px", fontSize:11, borderRadius:5, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none", marginBottom:8}}/>
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

      <div style={{padding:"9px 11px", borderRadius:8, background:t.panel2, border:"1px solid "+t.border, marginBottom:12}}>
        <div style={{fontSize:10, color:t.muted, marginBottom:4, fontWeight:600}}>Output preview</div>
        {useMm&&<div style={{fontSize:11, color:t.text, marginBottom:2}}>{mmWidth} x {mmHeight} mm</div>}
        {format!=="svg"&&<div style={{fontSize:11, color:t.text}}>{previewW} x {previewH} px at {dpi} dpi</div>}
        {format!=="svg"&&(dpi>=300?<div style={{fontSize:10, color:t.success, fontWeight:600, marginTop:4}}>Journal quality</div>:<div style={{fontSize:10, color:t.muted, marginTop:4}}>Use 300+ dpi for publication</div>)}
      </div>

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

// ════════════════════════════════════════════════════════════════════════════
// Scree plot — variance explained per PC
// ════════════════════════════════════════════════════════════════════════════
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

function ScreePlot({varExplained}) {
  const t=useTheme();
  if (!varExplained.length) return null;
  const shown = varExplained.slice(0, Math.min(10, varExplained.length));
  const W=320, H=140, ML=38, MR=10, MT=10, MB=28;
  const innerW=W-ML-MR, innerH=H-MT-MB;
  const barW = innerW/shown.length*0.6;
  const gap = innerW/shown.length;
  let cumulative=0;
  return (
    <div style={{background:t.panel, border:"1px solid "+t.border, borderRadius:10, padding:"10px", boxShadow:t.shadow}}>
      <div style={{fontSize:11, fontWeight:700, color:t.text, marginBottom:6}}>Scree Plot — Variance Explained</div>
      <svg width={W} height={H} viewBox={"0 0 "+W+" "+H} style={{display:"block",width:"100%",maxWidth:W,height:"auto"}}>
        {[0,0.25,0.5,0.75,1].map((f,i)=>(
          <line key={i} x1={ML} y1={MT+innerH*(1-f)} x2={ML+innerW} y2={MT+innerH*(1-f)} stroke={t.grid} strokeWidth={0.5} strokeDasharray="3 2"/>
        ))}
        <line x1={ML} y1={MT+innerH} x2={ML+innerW} y2={MT+innerH} stroke={t.text} strokeWidth={1}/>
        <line x1={ML} y1={MT} x2={ML} y2={MT+innerH} stroke={t.text} strokeWidth={1}/>
        {[0,0.25,0.5,0.75,1].map((f,i)=>(
          <text key={i} x={ML-5} y={MT+innerH*(1-f)+3} textAnchor="end" fontSize={8} fill={t.muted}>{(f*100).toFixed(0)}%</text>
        ))}
        {shown.map((v,i)=>{
          const x=ML+gap*i+(gap-barW)/2;
          const h=innerH*v;
          const y=MT+innerH-h;
          cumulative+=v;
          const cy=MT+innerH-innerH*Math.min(cumulative,1);
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h} fill={t.accent} fillOpacity={0.85} rx={2}/>
              <text x={x+barW/2} y={MT+innerH+12} textAnchor="middle" fontSize={8} fill={t.muted}>PC{i+1}</text>
              <circle cx={x+barW/2} cy={cy} r={2} fill={t.success}/>
              {i>0&&<line x1={ML+gap*(i-1)+(gap-barW)/2+barW/2} y1={MT+innerH-innerH*Math.min(cumulative-v,1)} x2={x+barW/2} y2={cy} stroke={t.success} strokeWidth={1.2}/>}
            </g>
          );
        })}
      </svg>
      <div style={{fontSize:9, color:t.muted, marginTop:2}}>Bars = individual variance · green line = cumulative</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PCA scatter plot — the core visualization
// ════════════════════════════════════════════════════════════════════════════
function PCAScatter({samples, varExplained, stats, display, groupColors, legendVisible, legendStyle, legendPos, setLegendPos}) {
  const t=useTheme();
  const style=resolveStyles(display,t);
  const pcX=stats.pcX||0, pcY=stats.pcY||1;
  const dotRadius=stats.dotRadius||5;
  const showLabels=stats.showLabels!==false;
  const repel=stats.repelLabels!==false;
  const showEllipses=stats.showEllipses!==false;
  const chiSq = CHI_SQ[stats.ellipseConfidence] || CHI_SQ[0.95];

  const [hovered,setHovered]=useState(null);
  const [legendDrag,setLegendDrag]=useState(null);
  const svgRef=useRef(null);
  const svgContainerRef=useRef(null);

  const isLegendItemVisible = id => legendVisible[id]!==false;

  const points = useMemo(()=>samples.map(s=>({...s, x:s.coords[pcX]||0, y:s.coords[pcY]||0})),[samples,pcX,pcY]);
  const groups = useMemo(()=>[...new Set(points.map(p=>p.group))],[points]);

  // Compute ellipses in DATA space first (not yet pixel-scaled) so their
  // extents can be folded into the axis-range calculation below — this is
  // what keeps an ellipse from ever being clipped by the plot bounds.
  const rawEllipsesByGroup = useMemo(()=>{
    if (!showEllipses) return {};
    const out={};
    groups.forEach(g=>{
      const pts = points.filter(p=>p.group===g).map(p=>[p.x,p.y]);
      const e = confidenceEllipse(pts, chiSq);
      if (e) out[g] = ellipsePathPoints(e);
    });
    return out;
  },[points,groups,showEllipses,chiSq]);

  const xVals = points.map(p=>p.x), yVals = points.map(p=>p.y);
  const ellipseXVals = Object.values(rawEllipsesByGroup).flat().map(p=>p[0]);
  const ellipseYVals = Object.values(rawEllipsesByGroup).flat().map(p=>p[1]);
  const xAbsMax = Math.max.apply(null,[...xVals.map(Math.abs),...ellipseXVals.map(Math.abs),1]);
  const yAbsMax = Math.max.apply(null,[...yVals.map(Math.abs),...ellipseYVals.map(Math.abs),1]);
  const x1 = stats.xMin==="auto"?-(xAbsMax*1.15):+stats.xMin;
  const x2 = stats.xMax==="auto"?xAbsMax*1.15:+stats.xMax;
  const y1 = stats.yMin==="auto"?-(yAbsMax*1.15):+stats.yMin;
  const y2 = stats.yMax==="auto"?yAbsMax*1.15:+stats.yMax;

  const PLOT_W=560, ML=58, MR=28, MT=32, MB=50, PLOT_H=380;
  const innerW=PLOT_W-ML-MR, totalH=PLOT_H+MT+MB;
  const svgW=PLOT_W+MR+130;

  const scaleX=useCallback(v=>ML+(v-x1)/(x2-x1)*innerW,[x1,x2]);
  const scaleY=useCallback(v=>MT+PLOT_H-(v-y1)/(y2-y1)*PLOT_H,[y1,y2]);
  // Round-number ticks (1/2/2.5/5 x 10^k) instead of equal sixths of the range.
  const xTk=useMemo(()=>niceTicks(x1,x2,6),[x1,x2]);
  const yTk=useMemo(()=>niceTicks(y1,y2,5),[y1,y2]);
  const xTicks=xTk.ticks, yTicks=yTk.ticks;

  // Sample-label placement. Labels are drawn text-anchor "start" at
  // (x, y=baseline), so a label's box is [x, x+w] x [y-h+1, y+2]. The old
  // version treated x as the box centre, never avoided dots, let labels drift
  // 30px outside the frame, and silently hid any label pushed >200px away.
  const labelPositions = useMemo(()=>{
    if (!showLabels || !repel) return {};
    const fs=style.pointLabel.fontSize||9, charW=fs*0.58, h=fs+1;
    const L=ML+2, R=ML+innerW-2, T=MT+2, B=MT+PLOT_H-2;
    const dots=points.map(p=>({x:scaleX(p.x), y:scaleY(p.y), r:dotRadius+2}));
    const pos={};
    points.forEach(p=>{
      const cx=scaleX(p.x), cy=scaleY(p.y), w=p.name.length*charW+2;
      // start on the right of the dot, or the left if that would leave the frame
      let x=cx+dotRadius+3; if (x+w>R) x=cx-dotRadius-3-w;
      pos[p.name]={x, y:cy+fs*0.35, ox:cx, oy:cy, hx:x, hy:cy+fs*0.35, w, h};
    });
    const names=Object.keys(pos);
    for (let it=0; it<150; it++) {
      let moved=0;
      names.forEach(nm=>{
        const a=pos[nm]; let fx=0, fy=0;
        const ax0=a.x, ax1=a.x+a.w, ay0=a.y-a.h+1, ay1=a.y+2;
        names.forEach(nm2=>{
          if (nm===nm2) return;
          const b=pos[nm2], bx0=b.x, bx1=b.x+b.w, by0=b.y-b.h+1, by1=b.y+2;
          const ox=Math.min(ax1,bx1)-Math.max(ax0,bx0)+2, oy=Math.min(ay1,by1)-Math.max(ay0,by0)+2;
          if (ox>0&&oy>0) {
            const dx=(ax0+ax1)-(bx0+bx1), dy=(ay0+ay1)-(by0+by1);
            if (oy<=ox) fy+=(dy>=0?1:-1)*oy*0.5; else fx+=(dx>=0?1:-1)*ox*0.5;
          }
        });
        dots.forEach(o=>{
          const nx=Math.max(ax0,Math.min(o.x,ax1)), ny=Math.max(ay0,Math.min(o.y,ay1));
          let dx=nx-o.x, dy=ny-o.y; const dd=Math.hypot(dx,dy);
          if (dd>=o.r) return;
          if (dd<1e-6) { dx=(ax0+ax1)/2-o.x; dy=(ay0+ay1)/2-o.y; const m=Math.hypot(dx,dy)||1; dx/=m; dy/=m; }
          else { dx/=dd; dy/=dd; }
          const push=(o.r-dd)*0.6; fx+=dx*push; fy+=dy*push;
        });
        fx+=(a.hx-a.x)*0.03; fy+=(a.hy-a.y)*0.03;
        const nx=Math.max(L,Math.min(R-a.w,a.x+fx)), ny=Math.max(T+a.h,Math.min(B,a.y+fy));
        moved+=Math.abs(nx-a.x)+Math.abs(ny-a.y); a.x=nx; a.y=ny;
      });
      if (moved<0.05) break;
    }
    return pos;
  },[points,showLabels,repel,dotRadius,scaleX,scaleY,style.pointLabel.fontSize,innerW]);

  // Map the already-computed data-space ellipses into pixel space now that
  // the (ellipse-aware) scale functions exist.
  const ellipsesByGroup = useMemo(()=>{
    const out={};
    Object.entries(rawEllipsesByGroup).forEach(([g,pts])=>{ out[g]=pts.map(([px,py])=>[scaleX(px),scaleY(py)]); });
    return out;
  },[rawEllipsesByGroup,scaleX,scaleY]);

  const xLabel = display.xLbl && display.xLbl.trim() ? display.xLbl : "PC"+(pcX+1)+" ("+(varExplained[pcX]*100).toFixed(1)+"% variance)";
  const yLabel = display.yLbl && display.yLbl.trim() ? display.yLbl : "PC"+(pcY+1)+" ("+(varExplained[pcY]*100).toFixed(1)+"% variance)";


  // ── Legend ──────────────────────────────────────────────────────────────
  const LEGEND_W=170;
  const fs=legendStyle.fontSize, fw=legendStyle.bold?"bold":"normal", ff=style.font;
  const legendRows = useMemo(()=>{
    const rows=[];
    if (isLegendItemVisible("title")) rows.push({type:"title", text:points.length+" samples · "+groups.length+" group"+(groups.length!==1?"s":"")});
    if (isLegendItemVisible("groups")) groups.forEach(g=>rows.push({type:"color", col:groupColors[g]||"#94A3B8", lbl:g, val:String(points.filter(p=>p.group===g).length)}));
    if (isLegendItemVisible("varexp")) rows.push({type:"kv", lbl:"PC"+(pcX+1)+"+PC"+(pcY+1), val:((varExplained[pcX]+varExplained[pcY])*100).toFixed(1)+"%"});
    return rows;
  },[legendVisible,points,groups,groupColors,pcX,pcY,varExplained]);
  const legendH = legendRows.reduce((h,row)=>h+(row.type==="title"?fs+8:fs+9),0);

  const onLegendPointerDown=useCallback(e=>{
    e.stopPropagation();
    const svg=svgRef.current; if(!svg) return;
    const pt=svg.createSVGPoint(); pt.x=e.clientX; pt.y=e.clientY;
    const svgPt=pt.matrixTransform(svg.getScreenCTM().inverse());
    setLegendDrag({sx:svgPt.x,sy:svgPt.y,ox:legendPos.x,oy:legendPos.y});
    e.preventDefault();
  },[legendPos]);
  const onSvgPointerMove=useCallback(e=>{
    if(!legendDrag)return;
    const svg=svgRef.current; if(!svg)return;
    const pt=svg.createSVGPoint(); pt.x=e.clientX; pt.y=e.clientY;
    const svgPt=pt.matrixTransform(svg.getScreenCTM().inverse());
    setLegendPos({x:legendDrag.ox+(svgPt.x-legendDrag.sx), y:legendDrag.oy+(svgPt.y-legendDrag.sy)});
  },[legendDrag,setLegendPos]);
  const onSvgPointerUp=useCallback(()=>setLegendDrag(null),[]);

  const renderLegend=()=>{
    const lx=legendPos.x, ly=legendPos.y;
    const els=[<rect key="drag" x={lx-4} y={ly-4} width={LEGEND_W+8} height={legendH+8} fill="transparent" style={{cursor:legendDrag?"grabbing":"move"}} onPointerDown={onLegendPointerDown}/>];
    let cy=ly;
    legendRows.forEach((row,i)=>{
      if (row.type==="title") { els.push(<text key={i} x={lx} y={cy+fs} fontSize={fs} fontWeight="700" fill={t.muted} fontFamily={ff}>{row.text}</text>); cy+=fs+8; }
      else if (row.type==="color") {
        els.push(<circle key={i+"d"} cx={lx+fs*0.5} cy={cy+fs*0.42} r={dotRadius*0.8} fill={row.col}/>);
        els.push(<text key={i+"l"} x={lx+fs+5} y={cy+fs} fontSize={fs} fontWeight={fw} fill={row.col} fontFamily={ff}>{row.lbl}</text>);
        els.push(<text key={i+"v"} x={lx+LEGEND_W} y={cy+fs} fontSize={fs} fontWeight="700" fill={t.text} fontFamily={ff} textAnchor="end">{row.val}</text>);
        cy+=fs+9;
      } else if (row.type==="kv") {
        els.push(<text key={i+"l"} x={lx} y={cy+fs} fontSize={fs} fontWeight={fw} fill={t.muted} fontFamily={ff}>{row.lbl}</text>);
        els.push(<text key={i+"v"} x={lx+LEGEND_W} y={cy+fs} fontSize={fs} fontWeight="700" fill={t.accent} fontFamily={ff} textAnchor="end">{row.val}</text>);
        cy+=fs+9;
      }
    });
    return <g>{els}</g>;
  };

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        {groups.map(g=>{
          const col=groupColors[g]||"#94A3B8";
          const count=points.filter(p=>p.group===g).length;
          return (
            <div key={g} style={{background:t.panel,border:"1px solid "+t.border,borderRadius:8,padding:"6px 10px",flex:1,textAlign:"center",boxShadow:t.shadow}}>
              <div style={{fontSize:18,fontWeight:700,color:col}}>{count}</div>
              <div style={{fontSize:10,color:t.muted}}>{g}</div>
            </div>
          );
        })}
        <div style={{background:t.panel,border:"1px solid "+t.border,borderRadius:8,padding:"6px 10px",flex:1,textAlign:"center",boxShadow:t.shadow}}>
          <div style={{fontSize:18,fontWeight:700,color:t.accent}}>{((varExplained[pcX]+varExplained[pcY])*100).toFixed(1)}%</div>
          <div style={{fontSize:10,color:t.muted}}>PC{pcX+1}+PC{pcY+1} variance</div>
        </div>
      </div>
      <div ref={svgContainerRef} style={{position:"relative",background:display.plotBg||t.panel,border:"1px solid "+t.border,borderRadius:10,padding:"10px",boxShadow:t.shadow,overflowX:"auto"}}>
        {display.plotTitle&&<div style={{textAlign:"center",marginBottom:6,fontSize:style.title.fontSize,fontWeight:style.title.fontWeight,fontStyle:style.title.fontStyle,color:style.title.color,fontFamily:style.font}}>{display.plotTitle}</div>}
        <svg ref={svgRef} width={svgW} height={totalH} viewBox={"0 0 "+svgW+" "+totalH} style={{display:"block",width:"100%",maxWidth:svgW,height:"auto",cursor:legendDrag?"grabbing":"default",overflow:"visible"}}
          onPointerMove={onSvgPointerMove} onPointerUp={onSvgPointerUp} onPointerLeave={onSvgPointerUp}>
          {display.showGrid!==false&&yTicks.map((v,i)=><line key={"gy"+i} x1={ML} y1={scaleY(v)} x2={ML+innerW} y2={scaleY(v)} stroke={style.gridColor} strokeWidth={style.gridWidth} strokeDasharray="4 3"/>)}
          {display.showGrid!==false&&xTicks.map((v,i)=><line key={"gx"+i} x1={scaleX(v)} y1={MT} x2={scaleX(v)} y2={MT+PLOT_H} stroke={style.gridColor} strokeWidth={style.gridWidth} strokeDasharray="4 3"/>)}
          {(()=>{
            const frameStyle = display.frameStyle||"open";
            const bottomY=MT+PLOT_H, topY=MT, leftX=ML, rightX=ML+innerW;
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
          {yTicks.map((v,i)=><text key={"yt"+i} x={ML-6} y={scaleY(v)+4} textAnchor="end" fontSize={style.tick.fontSize} fill={style.tick.fill} fontFamily={style.font}>{v.toFixed(yTk.dec)}</text>)}
          {xTicks.map((v,i)=><text key={"xt"+i} x={scaleX(v)} y={MT+PLOT_H+16} textAnchor="middle" fontSize={style.tick.fontSize} fill={style.tick.fill} fontFamily={style.font}>{v.toFixed(xTk.dec)}</text>)}
          <text x={ML+innerW/2} y={totalH-4} textAnchor="middle" fontSize={style.axis.fontSize} fontWeight={style.axis.fontWeight} fontStyle={style.axis.fontStyle} fill={style.axis.fill} fontFamily={style.font}>{xLabel}</text>
        <text x={12} y={MT+PLOT_H/2} textAnchor="middle" fontSize={style.axis.fontSize} fontWeight={style.axis.fontWeight} fontStyle={style.axis.fontStyle} fill={style.axis.fill} fontFamily={style.font} transform={"rotate(-90,12,"+(MT+PLOT_H/2)+")"}>{yLabel}</text>
        <line x1={ML} y1={scaleY(0)} x2={ML+innerW} y2={scaleY(0)} stroke={style.axisLineColor} strokeOpacity={0.3} strokeWidth={0.8}/>
        <line x1={scaleX(0)} y1={MT} x2={scaleX(0)} y2={MT+PLOT_H} stroke={style.axisLineColor} strokeOpacity={0.3} strokeWidth={0.8}/>

        {showEllipses&&groups.map(g=>{
          const pathPts=ellipsesByGroup[g];
          if (!pathPts) return null;
          const d = pathPts.map((p,i)=>(i===0?"M ":"L ")+p[0].toFixed(2)+" "+p[1].toFixed(2)).join(" ")+" Z";
          return <path key={g} d={d} fill={groupColors[g]||"#94A3B8"} fillOpacity={0.06} stroke={groupColors[g]||"#94A3B8"} strokeWidth={1.1} strokeOpacity={0.55} strokeDasharray="5 3"/>;
        })}

        {points.map((p,i)=>{
          const cx=scaleX(p.x), cy=scaleY(p.y);
          const col=groupColors[p.group]||"#94A3B8";
          const isHovered=hovered&&hovered.name===p.name;
          const labelPos = showLabels&&repel ? labelPositions[p.name] : null;
          const lx=labelPos?labelPos.x:cx+dotRadius+4, ly=labelPos?labelPos.y:cy+4;
          return (
            <g key={i} onMouseEnter={()=>setHovered({...p,cx,cy})} onMouseLeave={()=>setHovered(null)}>
              {isHovered&&<circle cx={cx} cy={cy} r={dotRadius+4} fill={col} fillOpacity={0.2}/>}
              <circle cx={cx} cy={cy} r={dotRadius} fill={col} fillOpacity={0.9} stroke={isHovered?"#fff":col} strokeWidth={isHovered?2:1}/>
              {showLabels&&labelPos&&(()=>{
                const tx=Math.max(labelPos.x,Math.min(cx,labelPos.x+labelPos.w)), ty=Math.max(labelPos.y-labelPos.h+1,Math.min(cy,labelPos.y+2));
                const dl=Math.hypot(tx-cx,ty-cy); if(dl<dotRadius+7) return null;
                return <line x1={cx+(tx-cx)/dl*(dotRadius+2)} y1={cy+(ty-cy)/dl*(dotRadius+2)} x2={tx} y2={ty} stroke={style.pointLabel.fill} strokeWidth={0.6} strokeOpacity={0.55} style={{pointerEvents:"none"}}/>;
              })()}
              {showLabels&&<text x={lx} y={ly} fontSize={style.pointLabel.fontSize||9} fontWeight={style.pointLabel.fontWeight} fontStyle={style.pointLabel.fontStyle} fill={style.pointLabel.fill} fontFamily={style.font} style={{pointerEvents:"none"}}>{p.name}</text>}
            </g>
          );
        })}

        {hovered&&(()=>{
          const cx=hovered.cx, cy=hovered.cy, tx=cx>PLOT_W-165?cx-165:cx+10, ty=Math.max(MT,cy-52);
          return (
            <g style={{pointerEvents:"none"}}>
              <rect x={tx} y={ty} width={155} height={57} rx={6} fill={t.tip} stroke={t.border} strokeWidth={1}/>
              <text x={tx+9} y={ty+16} fontSize={12} fontWeight="700" fill="#fff">{hovered.name}</text>
              <line x1={tx+9} y1={ty+20} x2={tx+146} y2={ty+20} stroke={t.border} strokeWidth={0.5}/>
              <text x={tx+9} y={ty+33} fontSize={10} fill="#CBD5E1">Group</text>
              <text x={tx+146} y={ty+33} fontSize={10} fontWeight="600" fill="#fff" textAnchor="end">{hovered.group}</text>
              <text x={tx+9} y={ty+47} fontSize={10} fill="#CBD5E1">PC{pcX+1}/PC{pcY+1}</text>
              <text x={tx+146} y={ty+47} fontSize={10} fontWeight="600" fill="#fff" textAnchor="end">{hovered.x.toFixed(2)}, {hovered.y.toFixed(2)}</text>
            </g>
          );
        })()}
        {legendRows.length>0&&renderLegend()}
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
// ════════════════════════════════════════════════════════════════════════════
// Sheet sidebar — multiple independent datasets in one session.
// Mirrors the Volcano / MA Plot sheet model: each sheet owns its own matrix,
// grouping, styling and undo history; Save Project writes all of them at once.
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
          onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>readProjectText(ev.target.result,"pca-plot",onLoad);r.readAsText(f);e.target.value="";}}/>
        <div style={{fontSize:9, color:t.muted, textAlign:"center"}}>Ctrl+S to save</div>
      </div>
    </div>
  );
}

export default function PCAPlotPage() {
  const activeTheme = useTheme(); // live theme from the app shell
  const [layout,setLayout]=useState("split");
  const [leftTab,setLeftTab]=useState("data");
  const [rightTab,setRightTab]=useState("preprocess");
  const plotRef=useRef(null);

  // ── Sheets: each one is a fully independent PCA dataset ──────────────────
  const [sheets,setSheets]=useState(()=>[mkSheet("PCA 1")]);
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
  const setSampleGroups  = useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,sampleGroups: typeof fn==="function"?fn(s.sampleGroups):fn}:s)),[activeId]);
  const setGroupColors   = useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,groupColors:  typeof fn==="function"?fn(s.groupColors):fn}:s)),[activeId]);
  const setDisplay       = useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,display:      typeof fn==="function"?fn(s.display):fn}:s)),[activeId]);
  const setStats         = useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,stats:        typeof fn==="function"?fn(s.stats):fn}:s)),[activeId]);
  const setLegendVisible = useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,legendVisible:typeof fn==="function"?fn(s.legendVisible):fn}:s)),[activeId]);
  const setLegendStyle   = useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,legendStyle:  typeof fn==="function"?fn(s.legendStyle):fn}:s)),[activeId]);
  const setLegendPos     = useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,legendPos:    typeof fn==="function"?fn(s.legendPos):fn}:s)),[activeId]);

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

  const {matrix, sampleGroups, groupColors, display, stats, legendVisible, legendStyle, legendPos} = activeSheet;

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
    downloadBlob(new Blob([JSON.stringify({version:2, tool:"pca-plot", sheets},null,2)],{type:"application/json;charset=utf-8"}), "pca_plot_project_"+new Date().toISOString().slice(0,10)+".json"); /* blob download: data: URLs fail silently past ~2MB / in Firefox */
  },[sheets]);

  const loadProject = data => {
    if (!data) return;
    // v2 = multi-sheet. v1 = single dataset; wrap it so old project files still open.
    let loaded=null;
    if (data.sheets && data.sheets.length) {
      loaded = data.sheets.map(s=>({...mkSheet(s.name||"Sheet"), ...s}));
    } else if (data.matrix) {
      const base = mkSheet("PCA 1");
      loaded = [{...base,
        matrix:data.matrix,
        sampleGroups:data.sampleGroups||{}, groupColors:data.groupColors||{},
        display:{...DEFAULT_DISPLAY, ...(data.display||{})},
        stats:{...DEFAULT_STATS, ...(data.stats||{})},
        legendVisible:data.legendVisible||base.legendVisible,
        legendStyle:data.legendStyle||base.legendStyle,
        legendPos:data.legendPos||base.legendPos,
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
    // New samples get a group guessed from their names (Ctrl_1 -> "Ctrl")
    // when nothing has been assigned yet; otherwise the default "Group 1".
    setSampleGroups(prev=>withDefaultGroups(prev, matrix.sampleNames));
  },[matrix.sampleNames, setSampleGroups]);

  // Full resync: a color survives only while its group still has samples.
  useEffect(()=>{
    const distinctGroups=[...new Set(matrix.sampleNames.map(s=>sampleGroups[s]||"Group 1"))];
    setGroupColors(prev=>{
      const next={};
      distinctGroups.forEach((g,i)=>{ next[g] = prev[g] || GROUP_PALETTE[i%GROUP_PALETTE.length]; });
      const same = Object.keys(prev).length===Object.keys(next).length && Object.keys(prev).every(k=>prev[k]===next[k]);
      return same ? prev : next;
    });
  },[matrix.sampleNames, sampleGroups, setGroupColors]);

  // ── Preprocessing + PCA computation ──────────────────────────────────────
  const pcaResult = useMemo(()=>{
    if (matrix.geneNames.length<1 || matrix.sampleNames.length<3) return {scores:[],varExplained:[],nComp:0,nGenesUsed:0};
    let values = matrix.values; // [gene][sample]
    if (stats.log2Transform) values = values.map(row=>row.map(v=>Math.log2(Math.max(v,0)+1)));

    let geneIdx = values.map((_,i)=>i);
    const topN = stats.topVarGenes;
    if (topN < values.length) {
      const variances = values.map(row=>{
        const m=row.reduce((a,b)=>a+b,0)/row.length;
        return row.reduce((a,b)=>a+(b-m)*(b-m),0)/row.length;
      });
      geneIdx = geneIdx.sort((a,b)=>variances[b]-variances[a]).slice(0,topN);
    }
    const filtered = geneIdx.map(gi=>values[gi]); // [geneSubset][sample]
    let X = transpose(filtered); // [sample][geneSubset]

    if (stats.scaleUnitVariance) {
      const p = X[0].length, n = X.length;
      for (let j=0;j<p;j++) {
        const col=X.map(row=>row[j]);
        const m=col.reduce((a,b)=>a+b,0)/n;
        const sd=Math.sqrt(col.reduce((a,b)=>a+(b-m)*(b-m),0)/n) || 1;
        for (let i=0;i<n;i++) X[i][j]=(X[i][j]-m)/sd;
      }
    }

    const result = computePCA(X);
    return {...result, nGenesUsed: geneIdx.length};
  },[matrix, stats.log2Transform, stats.scaleUnitVariance, stats.topVarGenes]);

  const samples = useMemo(()=>{
    if (!pcaResult.scores.length) return [];
    return matrix.sampleNames.map((name,i)=>({
      name, group: sampleGroups[name]||"Group 1", coords: pcaResult.scores[i]||[],
    }));
  },[matrix.sampleNames, sampleGroups, pcaResult.scores]);

  useEffect(()=>{
    if (pcaResult.nComp>0) {
      setStats(s=>({...s, pcX: Math.min(s.pcX, pcaResult.nComp-1), pcY: Math.min(s.pcY, pcaResult.nComp-1)}));
    }
  },[pcaResult.nComp, setStats]);

  const LEFT_TABS=[["data","Data"],["groups","Groups"]];
  const RIGHT_TABS=[{id:"preprocess",icon:"\u2699",label:"Prep"},{id:"axes",icon:"\uD83D\uDCD0",label:"Axes"},{id:"style",icon:"\uD83C\uDFA8",label:"Style"},{id:"legend",icon:"\uD83D\uDCCB",label:"Legend"},{id:"export",icon:"\u2B07",label:"Export"}];

  return (
      <div style={{height:"100%",background:activeTheme.bg,color:activeTheme.text,fontFamily:"Inter,system-ui,sans-serif",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"0 16px",borderBottom:"1px solid "+activeTheme.border,background:activeTheme.panel,display:"flex",alignItems:"center",gap:12,flexShrink:0,height:48,boxShadow:activeTheme.shadow}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>{"\uD83D\uDD2C"}</span>
            
            <span style={{fontSize:11,color:activeTheme.muted,padding:"2px 8px",borderRadius:10,background:activeTheme.panel2,border:"1px solid "+activeTheme.border}}>PCA Plot</span>
          </div>
          <div style={{height:20,width:1,background:activeTheme.border}}/>
          <span style={{fontSize:12,fontWeight:600,color:activeTheme.muted}}>{activeSheet.name}</span>
          <div style={{flex:1}}/>
        <CloudProjects tool="pca" getData={()=>({version:2,tool:"pca-plot",sheets})} onLoad={loadProject}/>
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
                  <div style={{fontSize:11,color:activeTheme.muted,marginTop:2}}>Paste a raw expression matrix with genes as rows and samples as columns, or load the example dataset.</div>
                </div>
                <div style={{display:"flex",gap:4,marginBottom:14,background:activeTheme.panel2,borderRadius:8,padding:2,border:"1px solid "+activeTheme.border,width:"fit-content"}}>
                  {LEFT_TABS.map(([id,lb])=>(
                    <button key={id} onClick={()=>setLeftTab(id)} style={{padding:"5px 16px",fontSize:11,fontWeight:600,cursor:"pointer",borderRadius:6,border:"none",background:leftTab===id?activeTheme.panel:"transparent",color:leftTab===id?activeTheme.text:activeTheme.muted}}>{lb}</button>
                  ))}
                </div>
                {leftTab==="data"&&<MatrixGrid matrix={matrix} setMatrix={setMatrix} undo={undoMatrix} redo={redoMatrix} canUndo={canUndoMatrix} canRedo={canRedoMatrix} onLoadExample={loadExample}/>}
                {leftTab==="groups"&&<SampleGroupsPanel sampleNames={matrix.sampleNames} sampleGroups={sampleGroups} setSampleGroups={setSampleGroups} groupColors={groupColors} setGroupColors={setGroupColors}/>}
                {layout==="data"&&<div style={{marginTop:18,display:"flex",justifyContent:"center"}}><button onClick={()=>setLayout("plot")} style={{padding:"10px 32px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",background:activeTheme.accent,border:"none",color:"#fff",boxShadow:activeTheme.shadow}}>Generate Plot</button></div>}
              </div>
            )}
            {(layout==="split"||layout==="plot")&&(
              <div style={{flex:1,overflowY:"auto",padding:"16px 18px",minWidth:0}} ref={plotRef}>
                {samples.length>0 ? (
                  <div style={{display:"flex",flexDirection:"column",gap:14,alignItems:"flex-start"}}>
                    {/* Figure always on white paper with the light palette (see VolcanoPlot). */}
                    <ThemeCtx.Provider value={LIGHT}>
                    <ErrorBoundary>
                      <PCAScatter samples={samples} varExplained={pcaResult.varExplained} stats={stats} display={display} groupColors={groupColors}
                        legendVisible={legendVisible} legendStyle={legendStyle} legendPos={legendPos} setLegendPos={setLegendPos}/>
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <ScreePlot varExplained={pcaResult.varExplained}/>
                    </ErrorBoundary>
                    </ThemeCtx.Provider>
                  </div>
                ) : (
                  <div style={{padding:"60px 20px",textAlign:"center",color:activeTheme.muted,fontSize:12}}>
                    Paste an expression matrix (or load the example) with at least 3 samples to see the PCA plot.
                  </div>
                )}
                <div style={{marginTop:10,fontSize:11,color:activeTheme.muted,textAlign:"center"}}>
                  {matrix.geneNames.length} genes · {pcaResult.nGenesUsed||0} used after variance filter · {matrix.sampleNames.length} samples · {sheets.length} sheet{sheets.length!==1?"s":""} · Ctrl+S to save
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
              {rightTab==="preprocess"&&<PreprocessingPanel stats={stats} setStats={setStats} nGenesTotal={matrix.geneNames.length} nGenesUsed={pcaResult.nGenesUsed||0}/>}
              {rightTab==="axes"&&<AxesPanel display={display} setDisplay={setDisplay} stats={stats} setStats={setStats} varExplained={pcaResult.varExplained}/>}
              {rightTab==="style"&&<StylePanel display={display} setDisplay={setDisplay}/>}
              {rightTab==="legend"&&<LegendPanel legendVisible={legendVisible} setLegendVisible={setLegendVisible} legendStyle={legendStyle} setLegendStyle={setLegendStyle} legendPos={legendPos} setLegendPos={setLegendPos} topMargin={LEGEND_TOP}/>}
              {rightTab==="export"&&<ExportPanel plotRef={plotRef} display={display}/>}
            </div>
            <div style={{padding:"6px 12px",borderTop:"1px solid "+activeTheme.border,fontSize:10,color:activeTheme.muted,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span>{matrix.sampleNames.length} samples</span>
              <span style={{color:pcaResult.nComp>0?activeTheme.accent:activeTheme.muted}}>{pcaResult.nComp} PCs</span>
              <span>Ctrl+S</span>
            </div>
          </div>
        </div>
      </div>
  );
}
