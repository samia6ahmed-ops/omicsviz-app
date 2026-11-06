import React, { useState, useMemo, useRef, useCallback, useEffect, useContext } from "react";
import { ThemeCtx as TC, useTheme, LIGHT } from "../shared/theme";
import CloudProjects from "../shared/CloudProjects";

// ─── Themes ───────────────────────────────────────────────────────────────────
const useC = () => useContext(TC);

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEF_D = {
  ff:"Inter", plotTitle:"",
  xLbl:"log\u2082 Fold Change",
  yLbl:"\u2212log\u2081\u2080(P value)",
  tsz:14, tbd:true,  tit:false, tcl:"",
  asz:12, abd:false, ait:false, acl:"#1a1a1a",
  ksz:10, kbold:false, kit:false, kcl:"#1a1a1a",
  psz:9,  pbold:false, pit:true,  pcl:"",
  cu:"#DC2626", cd:"#2563EB", cn:"#94A3B8",
  pbg:"", gc:"", aw:1.2, gw:0.5, showGrid:true, frameStyle:"open",
};
const DEF_S = {
  fc:1, pt:0.05, dotR:4, adjP:false, labelColor:"#1E2736",
  topN:0, topNby:"pval",
  colorMode:"3group", fcOnlyColor:"#D97706",
  repelLabels:true,
  xmin:"auto", xmax:"auto", ymin:"auto", ymax:"auto",
};
const FONTS = ["Inter","Arial","Helvetica","Times New Roman","Georgia","Courier New"];

// ─── Example data ─────────────────────────────────────────────────────────────
const EXAMPLE = [
  {gene:"TP53",   log2fc:-2.3, pval:0.0008},
  {gene:"MYC",    log2fc:3.1,  pval:0.000005},
  {gene:"BRCA1",  log2fc:-1.8, pval:0.032},
  {gene:"EGFR",   log2fc:2.5,  pval:0.0002},
  {gene:"KRAS",   log2fc:1.2,  pval:0.041},
  {gene:"CDH1",   log2fc:-3.0, pval:0.00001},
  {gene:"AKT1",   log2fc:1.9,  pval:0.015},
  {gene:"PTEN",   log2fc:-1.1, pval:0.22},
  {gene:"VHL",    log2fc:-2.8, pval:0.0003},
  {gene:"BCL2",   log2fc:2.2,  pval:0.0078},
  {gene:"MDM2",   log2fc:1.5,  pval:0.055},
  {gene:"VEGFA",  log2fc:3.4,  pval:0.000001},
  {gene:"HIF1A",  log2fc:2.0,  pval:0.009},
  {gene:"NOTCH1", log2fc:-0.8, pval:0.38},
  {gene:"STAT3",  log2fc:1.7,  pval:0.021},
  {gene:"RB1",    log2fc:-2.1, pval:0.006},
  {gene:"CCND1",  log2fc:2.3,  pval:0.0015},
  {gene:"CDK4",   log2fc:1.8,  pval:0.013},
];

const LEGEND_ITEMS = [
  {id:"title",   label:"Header",      desc:"p and FC cutoff line"},
  {id:"colorKey",label:"Color key",   desc:"UP / DOWN / NS with counts"},
  {id:"pval",    label:"p-value",     desc:"Threshold value"},
  {id:"nlp",     label:"-log10(p)",   desc:"Numeric cutoff"},
  {id:"fc",      label:"|log2FC|",    desc:"Fold-change threshold"},
  {id:"total",   label:"Total genes", desc:"N in dataset"},
  {id:"pct",     label:"% Sig",       desc:"(UP+DOWN)/Total"},
  {id:"updown",  label:"Up/Down",     desc:"Counts each direction"},
  {id:"labeled", label:"Labeled",     desc:"Count of gene labels"},
];

const MM_PRESETS = [
  {label:"89mm",  desc:"Single col", w:89},
  {label:"120mm", desc:"1.5 col",    w:120},
  {label:"183mm", desc:"Double col", w:183},
  {label:"247mm", desc:"Full page",  w:247},
];

// ─── Style helper ─────────────────────────────────────────────────────────────
function gS(d, C) {
  const f = d.ff || "Inter";
  // axis/tick use C.text fallback (black in light mode) — gene labels use C.muted
  const mkAxis = (sz, bd, it, cl) => ({
    fontSize:d[sz]||12, fontWeight:d[bd]?"bold":"normal",
    fontStyle:d[it]?"italic":"normal", fill:d[cl]||C.text, fontFamily:f,
  });
  const mkLabel = (sz, bd, it, cl) => ({
    fontSize:d[sz]||9, fontWeight:d[bd]?"bold":"normal",
    fontStyle:d[it]?"italic":"normal", fill:d[cl]||C.muted, fontFamily:f,
  });
  return {
    ff:f,
    ttl:{fontSize:d.tsz||14, fontWeight:d.tbd?"bold":"normal", fontStyle:d.tit?"italic":"normal", color:d.tcl||C.text, fontFamily:f},
    ax:mkAxis("asz","abd","ait","acl"),
    tk:mkAxis("ksz","kbold","kit","kcl"),
    lb:mkLabel("psz","pbold","pit","pcl"),
    cu:d.cu||C.up, cd:d.cd||C.down, cn:d.cn||C.ns,
    bg:d.pbg||C.panel, grid:d.gc||C.grid, aw:d.aw||1.2, gw:d.gw||0.5,
    // axis LINE color — defaults to C.text (black in light, white in dark)
    axLine:d.acl||C.text,
  };
}

// ─── Sheet helpers ────────────────────────────────────────────────────────────
const COLS = [
  {k:"gene",   l:"Gene",    w:110, t:"text", ph:"TP53"},
  {k:"log2fc", l:"Log2FC",  w:90,  t:"num",  ph:"-2.30"},
  {k:"pval",   l:"p-value", w:110, t:"num",  ph:"0.001"},
];
function blankRow() { const r={}; COLS.forEach(c=>{r[c.k]="";}); return r; }
function parsePaste(text, sr, sc0) {
  return text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").trim().split("\n").map((line,li)=>{
    const vals=line.split("\t"), upd={};
    vals.forEach((v,vi)=>{
      const ci=sc0+vi;
      if(ci<COLS.length){
        const col=COLS[ci];
        upd[col.k]=col.t==="num"?(v.trim()===""||isNaN(v.trim())?"":+v.trim()):v.trim();
      }
    });
    return {ri:sr+li, upd};
  });
}
function mkSheet(name) {
  return {
    id:Date.now()+Math.random(), name,
    rows:EXAMPLE.map(r=>({...r})),
    d:{...DEF_D}, sets:{...DEF_S},
    geneSet:"", geneSetColor:"#7C3AED",
  };
}

// ─── Tiny UI atoms ────────────────────────────────────────────────────────────
function Pill({active, onClick, children, color}) {
  const C=useC();
  return (
    <button onClick={onClick} style={{padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer",
      background:active?(color||C.accent):"transparent",
      border:"1px solid "+(active?(color||C.accent):C.border),
      color:active?"#fff":C.muted, transition:"all .12s"}}>
      {children}
    </button>
  );
}
function SLabel({children, mt=0}) {
  const C=useC();
  return <div style={{fontSize:9, fontWeight:700, color:C.muted, textTransform:"uppercase", letterSpacing:"0.09em", marginBottom:6, marginTop:mt}}>{children}</div>;
}
function Divider() {
  const C=useC();
  return <div style={{height:1, background:C.border, margin:"12px 0"}}/>;
}
function ColDot({color, size=20, onChange}) {
  return (
    <div style={{position:"relative", width:size, height:size, borderRadius:4, overflow:"hidden", flexShrink:0, cursor:"pointer", border:"1px solid rgba(0,0,0,.1)"}}>
      <div style={{position:"absolute", inset:0, background:color}}/>
      <input type="color" value={color} onChange={e=>onChange(e.target.value)}
        style={{opacity:0, position:"absolute", inset:0, cursor:"pointer", width:"100%", height:"100%"}}/>
    </div>
  );
}
function Toggle({value, onChange, label}) {
  const C=useC();
  return (
    <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8}}>
      <span style={{fontSize:11, color:C.muted}}>{label}</span>
      <button onClick={()=>onChange(!value)} style={{width:34, height:18, borderRadius:9, border:"none", cursor:"pointer",
        background:value?C.accent:C.border, position:"relative", transition:"background .15s", padding:0, flexShrink:0}}>
        <div style={{position:"absolute", top:2, left:value?16:2, width:14, height:14, borderRadius:7, background:"#fff", transition:"left .15s"}}/>
      </button>
    </div>
  );
}
function Slider({label, value, min, max, step, onChange, display}) {
  const C=useC();
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:"flex", justifyContent:"space-between", marginBottom:3}}>
        <span style={{fontSize:11, color:C.muted}}>{label}</span>
        <span style={{fontSize:11, fontWeight:600, color:C.accent}}>{display!==undefined?display:value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(+e.target.value)} style={{width:"100%", accentColor:C.accent}}/>
    </div>
  );
}

// ─── Scatter rendering at scale ─────────────────────────────────────────────
// A transcriptome-wide volcano is ~20k points. One <circle> each means 20k DOM
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

// ─── Data Sheet ───────────────────────────────────────────────────────────────
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
function parseImportNumber(raw, delim) {
  const s=String(raw).trim();
  if (s==="") return null;
  let cand=s;
  if (delim !== "," && /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) cand=s.replace(/,/g,"");
  if (delim === ";" && /^-?\d+,\d+$/.test(s)) cand=s.replace(",","."); // European decimal comma
  if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cand)) return null;
  const v=parseFloat(cand);
  return isFinite(v) ? v : null;
}

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
  const t=useC();
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
    setHeaderRow(0);
    setMap(autoDetectFields(rows[0]||[], wanted));
    setError(null);
  };

  const readFile = async file => {
    setError(null); setBusy(true);
    try {
      if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
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
    setHeaderRow(0);
    setMap(autoDetectFields(rows[0]||[], wanted));
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
          <div style={{fontSize:10.5, color:t.muted}}>DESeq2, edgeR or limma output · CSV, TSV, TXT · Excel .xlsx if SheetJS is installed</div>
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

function Sheet({rows, setRows, undo, redo, canU, canR}) {
  const C=useC();
  const [foc,     setFoc]     = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [rowLimit,   setRowLimit]   = useState(GRID_ROW_CAP);
  const [importMsg,  setImportMsg]  = useState(null);
  const [askClr,  setAskClr]  = useState(false);
  const [colLbls, setColLbls] = useState(()=>Object.fromEntries(COLS.map(c=>[c.k,c.l])));
  const [editHdr, setEditHdr] = useState(null);
  const [hdrDraft,setHdrDraft]= useState("");
  const refs    = useRef({});
  const hdrRefs = useRef({});

  const display = useMemo(()=>{ const r=[...rows].slice(0,rowLimit); while(r.length<22)r.push(blankRow()); return r; },[rows,rowLimit]);

  const upd = useCallback((ri,k,v)=>{
    setRows(prev=>{ const n=[...prev]; while(n.length<=ri)n.push(blankRow()); n[ri]={...n[ri],[k]:v}; return n; });
  },[setRows]);

  const onPaste = useCallback((e,ri,ci)=>{
    const txt=e.clipboardData.getData("text");
    if(!txt.includes("\t")&&!txt.includes("\n"))return;
    e.preventDefault();
    const patches=parsePaste(txt,ri,ci);
    setRows(prev=>{ const n=[...prev]; patches.forEach(({ri:r,upd:u})=>{ while(n.length<=r)n.push(blankRow()); n[r]={...n[r],...u}; }); return n; });
    setTimeout(()=>refs.current[patches[patches.length-1].ri+"-"+ci]?.focus(),20);
  },[setRows]);

  const onKey = useCallback((e,ri,ci)=>{
    if((e.ctrlKey||e.metaKey)&&(e.key==="z"||e.key==="y"))return;
    const go=(dr,dc)=>{ e.preventDefault(); const nr=Math.max(0,ri+dr),nc=Math.max(0,Math.min(COLS.length-1,ci+dc)); setFoc({r:nr,c:nc}); setTimeout(()=>refs.current[nr+"-"+nc]?.focus(),0); };
    if(e.key==="ArrowUp")go(-1,0);
    if(e.key==="ArrowDown"||e.key==="Enter")go(1,0);
    if(e.key==="ArrowLeft"&&e.target.selectionStart===0)go(0,-1);
    if(e.key==="ArrowRight"&&e.target.selectionStart===e.target.value.length)go(0,1);
    if(e.key==="Tab"){e.preventDefault();go(0,e.shiftKey?-1:1);}
  },[]);

  const removeRow = idx => setRows(prev=>prev.filter((_,i)=>i!==idx));

  const startHdr  = (k,cur)=>{ setEditHdr(k); setHdrDraft(cur); setTimeout(()=>hdrRefs.current[k]?.select(),0); };
  const commitHdr = k=>{ if(hdrDraft.trim())setColLbls(p=>({...p,[k]:hdrDraft.trim()})); setEditHdr(null); };
  const hasCustom = COLS.some(c=>colLbls[c.k]!==c.l);
  const filled    = rows.filter(r=>Object.values(r).some(v=>v!==""&&v!=null)).length;

  return (
    <div>
      <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:10, flexWrap:"wrap"}}>
        <button onClick={()=>setRows(EXAMPLE)}
          style={{padding:"5px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:C.accent, border:"none", color:"#fff"}}>
          Load example data
        </button>
        <button onClick={()=>setShowImport(s=>!s)}
          style={{padding:"5px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:showImport?C.accent:"transparent", border:"1px solid "+(showImport?C.accent:C.border), color:showImport?"#fff":C.text}}>
          Import file
        </button>
        <button onClick={undo} disabled={!canU}
          style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+C.border, cursor:canU?"pointer":"default", color:canU?C.text:C.muted}}>
          Undo
        </button>
        <button onClick={redo} disabled={!canR}
          style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+C.border, cursor:canR?"pointer":"default", color:canR?C.text:C.muted}}>
          Redo
        </button>
        {hasCustom&&(
          <button onClick={()=>setColLbls(Object.fromEntries(COLS.map(c=>[c.k,c.l])))}
            style={{padding:"4px 10px", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>
            Reset headers
          </button>
        )}
        {!askClr
          ?<button onClick={()=>setAskClr(true)}
              style={{padding:"4px 10px", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>
              Clear
            </button>
          :<span style={{display:"flex", gap:4, alignItems:"center"}}>
              <span style={{fontSize:11, color:C.muted}}>Clear all data?</span>
              <button onClick={()=>{setRows([]);setAskClr(false);}}
                style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"#DC2626", border:"none", color:"#fff", fontWeight:600}}>Yes</button>
              <button onClick={()=>setAskClr(false)}
                style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>Cancel</button>
            </span>
        }
        <span style={{marginLeft:"auto", fontSize:11, color:C.muted, fontWeight:500}}>{filled} gene rows</span>
      </div>

      {showImport && (
        <FileImportRows
          fields={[{key:"gene",label:"Gene",kind:"text",required:true},{key:"log2fc",label:"Log2FC",kind:"num",required:true},{key:"pval",label:"p-value",kind:"num",required:true}]}
          onClose={()=>setShowImport(false)}
          onImport={(newRows, warnings)=>{
            setRows(newRows);                 // single history entry: file import is one undo step
            setRowLimit(GRID_ROW_CAP);
            setShowImport(false);
            setImportMsg(warnings.length ? warnings : null);
          }}/>
      )}

      {rows.length > rowLimit && (
        <div style={{fontSize:11, marginBottom:8, padding:"7px 10px", background:C.tag, borderRadius:6, color:C.tagText, border:"1px solid "+C.cBorder, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
          <span>Showing the first {rowLimit.toLocaleString()} of {rows.length.toLocaleString()} rows. The full table is loaded and every row is used for the plot.</span>
          <button onClick={()=>setRowLimit(r=>r+GRID_ROW_CAP)}
            style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.cBorder, color:C.tagText}}>
            Show {Math.min(GRID_ROW_CAP, rows.length-rowLimit).toLocaleString()} more
          </button>
          <button onClick={()=>setRowLimit(rows.length)}
            style={{padding:"3px 9px", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.cBorder, color:C.tagText}}>
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

      <div style={{fontSize:11, marginBottom:8, padding:"6px 10px", background:C.tag, borderRadius:6, color:C.tagText, border:"1px solid "+C.cBorder}}>
        Paste directly from Excel, DESeq2, edgeR, or limma. Arrow keys and Tab to navigate. Double-click any column header to rename it.
      </div>

      <div style={{border:"1px solid "+C.border, borderRadius:8, overflow:"hidden", maxHeight:430, overflowY:"auto"}}>
        <table style={{borderCollapse:"collapse", tableLayout:"fixed", width:"100%"}}>
          <colgroup>
            <col style={{width:32}}/>
            {COLS.map(c=><col key={c.k} style={{width:c.w}}/>)}
          </colgroup>
          <thead>
            <tr style={{background:C.cHdr}}>
              <th style={{borderBottom:"2px solid "+C.border, borderRight:"1px solid "+C.border, fontSize:10, color:C.muted, padding:"6px 4px", textAlign:"center", position:"sticky", top:0, zIndex:2, background:C.cHdr}}>#</th>
              {COLS.map(c=>{
                const isEd=editHdr===c.k, isCust=colLbls[c.k]!==c.l;
                return (
                  <th key={c.k} style={{borderBottom:"2px solid "+(isEd?C.accent:C.border), borderRight:"1px solid "+C.cBorder, padding:0, position:"sticky", top:0, zIndex:2, background:C.cHdr}}>
                    {isEd
                      ?<input ref={el=>{hdrRefs.current[c.k]=el;}} value={hdrDraft}
                          onChange={e=>setHdrDraft(e.target.value)}
                          onBlur={()=>commitHdr(c.k)}
                          onKeyDown={e=>{if(e.key==="Enter")commitHdr(c.k);if(e.key==="Escape")setEditHdr(null);}}
                          style={{width:"100%", boxSizing:"border-box", padding:"6px 8px", fontSize:11, fontWeight:700, background:C.panel, color:C.accent, border:"none", outline:"2px solid "+C.accent, fontFamily:"inherit"}}/>
                      :<div onDoubleClick={()=>startHdr(c.k,colLbls[c.k]||c.l)} title="Double-click to rename"
                            style={{display:"flex", alignItems:"center", gap:3, padding:"6px 8px", cursor:"text", userSelect:"none", whiteSpace:"nowrap"}}>
                          <span style={{fontSize:11, fontWeight:700, color:isCust?C.accent:C.text}}>{colLbls[c.k]||c.l}</span>
                          {c.t==="num"&&<span style={{fontSize:9, color:C.muted, opacity:.6}}>123</span>}
                          {isCust&&<span style={{fontSize:9, color:C.accent}}>✎</span>}
                        </div>
                    }
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {display.map((row,ri)=>{
              const isRealRow = ri<rows.length;
              return (
              <tr key={ri} style={{background:foc&&foc.r===ri?C.cSel:ri%2===0?C.cBg:C.panel}}>
                <td style={{background:C.cHdr, borderRight:"1px solid "+C.border, borderBottom:"1px solid "+C.cBorder, fontSize:10, color:C.muted, textAlign:"center", padding:"0 4px"}}>
                  {isRealRow ? (
                    <button onClick={()=>removeRow(ri)} title="Delete this row"
                      style={{width:18, height:18, borderRadius:4, background:"rgba(220,38,38,0.08)", border:"1px solid rgba(220,38,38,0.35)", color:"#DC2626", cursor:"pointer", fontSize:12, fontWeight:700, padding:0, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto"}}>
                      ×
                    </button>
                  ) : ri+1}
                </td>
                {COLS.map((col,ci)=>{
                  const rk=ri+"-"+ci, f=foc&&foc.r===ri&&foc.c===ci;
                  return (
                    <td key={col.k} style={{padding:0, borderBottom:"1px solid "+C.cBorder, borderRight:"1px solid "+C.cBorder}}>
                      <input ref={el=>{refs.current[rk]=el;}}
                        value={row[col.k]!==undefined?row[col.k]:""}
                        placeholder={f?col.ph:""}
                        inputMode={col.t==="num"?"decimal":"text"}
                        onChange={e=>upd(ri,col.k,e.target.value)}
                        onFocus={e=>{setFoc({r:ri,c:ci});e.target.select();}}
                        onBlur={()=>{if(col.t==="num"&&row[col.k]!==""){const n=parseFloat(row[col.k]);if(!isNaN(n))upd(ri,col.k,n);}}}
                        onKeyDown={e=>onKey(e,ri,ci)}
                        onPaste={e=>onPaste(e,ri,ci)}
                        style={{width:"100%", boxSizing:"border-box", padding:"4px 8px", fontSize:12, background:f?C.panel:"transparent", color:C.text, border:f?"2px solid "+C.cFocus:"2px solid transparent", outline:"none", fontFamily:"monospace"}}/>
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:4, fontSize:10, color:C.muted, textAlign:"center"}}>Auto-expands. Empty rows are ignored when plotting.</div>
    </div>
  );
}

// ─── Labels Panel ─────────────────────────────────────────────────────────────
function LabelsPanel({sets, setSets, geneSet, setGeneSet, geneSetColor, setGeneSetColor, gsCount, labeled, setLabeled, sigGenes}) {
  const C=useC();
  const nlpVal=-Math.log10(sets.pt||0.05);

  const downloadSigGenes=()=>{
    if(!sigGenes||!sigGenes.length)return;
    const adj=sets.adjP?"adj.p":"p";
    const csv=["gene,log2fc,"+adj+",nlp,group"]
      .concat(sigGenes.map(g=>g.gene+","+g.log2fc+","+g.pval+","+g.nlp+","+g.group))
      .join("\n");
    const a=document.createElement("a");
    a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);
    a.download="significant_genes_"+new Date().toISOString().slice(0,10)+".csv";
    a.click();
  };

  return (
    <div>
      <SLabel>Significance Thresholds</SLabel>
      <Slider label="FC threshold" value={sets.fc} min={0.5} max={3} step={0.1} onChange={v=>setSets(s=>({...s,fc:v}))} display={sets.fc}/>
      <Slider label="p-value cutoff" value={sets.pt} min={0.001} max={0.1} step={0.001}
        onChange={v=>setSets(s=>({...s,pt:v}))} display={sets.pt+" ("+nlpVal.toFixed(2)+" in log)"}/>
      <div style={{display:"flex", gap:5, marginBottom:10}}>
        {[["p-value",false],["adj. p-value",true]].map(([lb,val])=>(
          <Pill key={lb} active={(sets.adjP||false)===val} onClick={()=>setSets(s=>({...s,adjP:val}))}>{lb}</Pill>
        ))}
      </div>

      {sigGenes&&sigGenes.length>0&&(
        <div style={{marginBottom:10, padding:"9px 11px", borderRadius:8, background:C.cSel, border:"1px solid "+C.accent}}>
          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5}}>
            <div>
              <div style={{fontSize:12, fontWeight:700, color:C.text}}>{sigGenes.length} significant genes</div>
              <div style={{fontSize:10, color:C.muted}}>{"FC > "+sets.fc+" and p < "+sets.pt}</div>
            </div>
            <button onClick={downloadSigGenes}
              style={{padding:"5px 10px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", background:C.accent, border:"none", color:"#fff", whiteSpace:"nowrap"}}>
              Download CSV
            </button>
          </div>
          <div style={{display:"flex", gap:10, fontSize:10}}>
            <span style={{fontWeight:600, color:C.up}}>UP: {sigGenes.filter(g=>g.group==="UP").length}</span>
            <span style={{fontWeight:600, color:C.down}}>DOWN: {sigGenes.filter(g=>g.group==="DOWN").length}</span>
          </div>
        </div>
      )}

      <Divider/>
      <SLabel>Color Mode</SLabel>
      <div style={{display:"flex", flexDirection:"column", gap:4, marginBottom:10}}>
        {[["3group","3 Groups","UP / DOWN / NS"],["4group","4 Groups","+ FC-only (sig FC, NS p)"],["gradient","Gradient","Color by |log2FC| magnitude"]].map(([val,lb,desc])=>(
          <button key={val} onClick={()=>setSets(s=>({...s,colorMode:val}))}
            style={{display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:8, cursor:"pointer", textAlign:"left",
              background:(sets.colorMode||"3group")===val?C.cSel:"transparent",
              border:"1.5px solid "+((sets.colorMode||"3group")===val?C.accent:C.border)}}>
            <div style={{width:12, height:12, borderRadius:"50%", flexShrink:0,
              border:"2px solid "+((sets.colorMode||"3group")===val?C.accent:C.border),
              background:(sets.colorMode||"3group")===val?C.accent:"transparent"}}/>
            <div>
              <div style={{fontSize:11, fontWeight:600, color:(sets.colorMode||"3group")===val?C.text:C.muted}}>{lb}</div>
              <div style={{fontSize:9, color:C.muted}}>{desc}</div>
            </div>
          </button>
        ))}
      </div>
      {(sets.colorMode||"3group")==="4group"&&(
        <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:10, padding:"6px 9px", background:C.panel2, borderRadius:6, border:"1px solid "+C.border}}>
          <ColDot color={sets.fcOnlyColor||"#D97706"} size={18} onChange={v=>setSets(s=>({...s,fcOnlyColor:v}))}/>
          <span style={{fontSize:11, color:C.muted}}>FC-only group color</span>
        </div>
      )}

      <Divider/>
      <SLabel>Dot Appearance</SLabel>
      <Slider label="Dot radius" value={sets.dotR} min={1} max={10} step={0.5} onChange={v=>setSets(s=>({...s,dotR:v}))} display={sets.dotR+"px"}/>

      <Divider/>
      <SLabel>Auto-label Top Genes</SLabel>
      <div style={{padding:"10px", borderRadius:8, background:C.panel2, border:"1px solid "+C.border, marginBottom:10}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
          <span style={{fontSize:11, color:C.text, fontWeight:600}}>Top N genes to label</span>
          <span style={{fontSize:13, fontWeight:700, color:sets.topN===0?C.muted:C.accent}}>{sets.topN===0?"OFF":sets.topN}</span>
        </div>
        <input type="range" min={0} max={30} step={1} value={sets.topN}
          onChange={e=>setSets(s=>({...s,topN:+e.target.value}))} style={{width:"100%", accentColor:C.accent, marginBottom:8}}/>
        {sets.topN>0&&(
          <div>
            <div style={{fontSize:10, color:C.muted, marginBottom:5}}>Rank by</div>
            <div style={{display:"flex", gap:4}}>
              {[["pval","p-value"],["fc","|FC|"],["both","Combined"]].map(([v,lb])=>(
                <Pill key={v} active={sets.topNby===v} onClick={()=>setSets(s=>({...s,topNby:v}))}>{lb}</Pill>
              ))}
            </div>
          </div>
        )}
      </div>

      <SLabel>Label Style</SLabel>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:6}}>
        <ColDot color={sets.labelColor||"#1E2736"} size={26} onChange={v=>setSets(s=>({...s,labelColor:v}))}/>
        <span style={{fontSize:11, color:C.muted}}>Label color</span>
        <div style={{display:"flex", gap:3, marginLeft:"auto"}}>
          {["#1E2736","#DC2626","#2563EB","#16A34A","#7C3AED","#EA580C"].map(col=>(
            <button key={col} onClick={()=>setSets(s=>({...s,labelColor:col}))}
              style={{width:16, height:16, borderRadius:3, background:col, border:(sets.labelColor||"#1E2736")===col?"2px solid "+C.text:"1px solid "+C.border, cursor:"pointer", padding:0}}/>
          ))}
        </div>
      </div>
      <Toggle value={sets.repelLabels!==false} onChange={v=>setSets(s=>({...s,repelLabels:v}))} label="Repel overlapping labels (ggrepel)"/>

      {labeled&&labeled.size>0&&(
        <div style={{padding:"8px 10px", borderRadius:7, background:C.panel2, border:"1px solid "+C.border, marginBottom:10}}>
          <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
            <span style={{fontSize:11, color:C.text, fontWeight:600}}>{labeled.size} gene{labeled.size!==1?"s":""} labeled manually</span>
            <button onClick={()=>setLabeled&&setLabeled(new Set())}
              style={{fontSize:10, color:C.muted, background:"transparent", border:"1px solid "+C.border, cursor:"pointer", padding:"2px 7px", borderRadius:4}}>
              Clear all
            </button>
          </div>
        </div>
      )}

      <Divider/>
      <SLabel>Gene Set Highlight</SLabel>
      <div style={{padding:"10px", borderRadius:8, background:C.panel2, border:"1px solid "+C.border, marginBottom:10}}>
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6}}>
          <span style={{fontSize:11, fontWeight:600, color:C.text}}>Paste gene list to highlight</span>
          {gsCount>0&&<span style={{fontSize:10, fontWeight:600, color:C.accent, padding:"1px 7px", borderRadius:10, background:C.cSel}}>{gsCount} genes</span>}
        </div>
        <textarea value={geneSet} onChange={e=>setGeneSet(e.target.value)} rows={4}
          placeholder={"EGFR\nTP53\nMYC\n(one per line, or comma-separated)"}
          style={{width:"100%", boxSizing:"border-box", padding:"6px 8px", fontSize:11, borderRadius:6,
            border:"1px solid "+(geneSet.trim()?C.accent:C.border), background:C.cBg, color:C.text, outline:"none", fontFamily:"monospace", resize:"vertical"}}/>
        <div style={{display:"flex", alignItems:"center", gap:7, marginTop:7}}>
          <ColDot color={geneSetColor} size={20} onChange={setGeneSetColor}/>
          <span style={{fontSize:11, color:C.muted}}>Ring color</span>
          <div style={{display:"flex", gap:3, marginLeft:"auto"}}>
            {["#7C3AED","#EA580C","#0891B2","#16A34A","#DB2777"].map(col=>(
              <button key={col} onClick={()=>setGeneSetColor(col)}
                style={{width:14, height:14, borderRadius:3, background:col, border:geneSetColor===col?"2px solid "+C.text:"1px solid "+C.border, cursor:"pointer", padding:0}}/>
            ))}
          </div>
          {geneSet.trim()&&<button onClick={()=>setGeneSet("")} style={{fontSize:10, color:C.muted, background:"transparent", border:"none", cursor:"pointer"}}>clear</button>}
        </div>
      </div>
    </div>
  );
}

// ─── Plot Style Panel ─────────────────────────────────────────────────────────
function PlotPanel({d, set}) {
  const C=useC();
  const XP=["log\u2082 Fold Change","Log2FC","log\u2082(Fold Change)"];
  const YP=["\u2212log\u2081\u2080(P value)","\u2212log\u2081\u2080(p-value)","\u2212log\u2081\u2080(adj. P)","\u2212log\u2081\u2080(FDR)"];
  return (
    <div>
      <SLabel>Figure Title</SLabel>
      <input value={d.plotTitle||""} onChange={e=>set(s=>({...s,plotTitle:e.target.value}))} placeholder="e.g. Treatment vs Control (DESeq2)"
        style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:12, borderRadius:6, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none", marginBottom:10}}/>

      <Divider/>
      <SLabel>X Axis Label</SLabel>
      <input value={d.xLbl||""} onChange={e=>set(s=>({...s,xLbl:e.target.value}))}
        style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:11, borderRadius:6, border:"1px solid "+C.accent, background:C.cBg, color:C.text, outline:"none", marginBottom:5}}/>
      <div style={{display:"flex", gap:3, flexWrap:"wrap", marginBottom:10}}>
        {XP.map(p=><button key={p} onClick={()=>set(s=>({...s,xLbl:p}))}
          style={{padding:"2px 7px", borderRadius:10, fontSize:10, cursor:"pointer", background:(d.xLbl||"")==p?C.accent:"transparent", border:"1px solid "+((d.xLbl||"")==p?C.accent:C.border), color:(d.xLbl||"")==p?"#fff":C.muted}}>{p}</button>)}
      </div>

      <SLabel>Y Axis Label</SLabel>
      <input value={d.yLbl||""} onChange={e=>set(s=>({...s,yLbl:e.target.value}))}
        style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:11, borderRadius:6, border:"1px solid "+C.accent, background:C.cBg, color:C.text, outline:"none", marginBottom:5}}/>
      <div style={{display:"flex", gap:3, flexWrap:"wrap", marginBottom:10}}>
        {YP.map(p=><button key={p} onClick={()=>set(s=>({...s,yLbl:p}))}
          style={{padding:"2px 7px", borderRadius:10, fontSize:10, cursor:"pointer", background:(d.yLbl||"")==p?C.accent:"transparent", border:"1px solid "+((d.yLbl||"")==p?C.accent:C.border), color:(d.yLbl||"")==p?"#fff":C.muted}}>{p}</button>)}
      </div>

      <Divider/>
      <SLabel>Series Colors</SLabel>
      {[["Upregulated","cu"],["Downregulated","cd"],["Not significant","cn"]].map(([lb,k])=>(
        <div key={k} style={{display:"flex", alignItems:"center", gap:8, marginBottom:8}}>
          <ColDot color={d[k]} onChange={v=>set(s=>({...s,[k]:v}))}/>
          <span style={{fontSize:11, color:C.muted, flex:1}}>{lb}</span>
        </div>
      ))}
      <div style={{display:"flex", gap:5, marginBottom:10}}>
        {[["Nature","#DC2626","#1D4ED8"],["Cell","#B91C1C","#1E40AF"],["Colorblind","#D55E00","#0072B2"]].map(([name,up,down])=>(
          <button key={name} onClick={()=>set(s=>({...s,cu:up,cd:down}))}
            style={{flex:1, padding:"5px 0", borderRadius:7, fontSize:10, cursor:"pointer", background:C.panel2, border:"1px solid "+C.border, color:C.muted}}>
            <div style={{display:"flex", gap:3, justifyContent:"center", marginBottom:3}}>
              <div style={{width:8, height:8, borderRadius:2, background:up}}/>
              <div style={{width:8, height:8, borderRadius:2, background:down}}/>
            </div>
            {name}
          </button>
        ))}
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
      <SLabel>Axis Frame</SLabel>
      <div style={{display:"flex", gap:5, marginBottom:6}}>
        <Pill active={(d.frameStyle||"open")==="open"} onClick={()=>set(s=>({...s,frameStyle:"open"}))}>Open</Pill>
        <Pill active={d.frameStyle==="closed"} onClick={()=>set(s=>({...s,frameStyle:"closed"}))}>Closed</Pill>
        <Pill active={d.frameStyle==="offset"} onClick={()=>set(s=>({...s,frameStyle:"offset"}))}>Offset</Pill>
      </div>
      <div style={{fontSize:10, color:C.muted, lineHeight:1.5}}>
        Open = classic L-shaped axes (left + bottom only). Closed = full box frame on all four sides. Offset = axis lines detached from the corner, spanning only the tick range — a common journal-figure style (sometimes called a Tufte range frame).
      </div>

      <Divider/>
      <SLabel>Font Family</SLabel>
      <select value={d.ff||"Inter"} onChange={e=>set(s=>({...s,ff:e.target.value}))}
        style={{width:"100%", padding:"6px 9px", fontSize:11, borderRadius:6, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none", marginBottom:10}}>
        {FONTS.map(f=><option key={f} value={f}>{f}</option>)}
      </select>

      <SLabel>Font Sizes</SLabel>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10}}>
        {[["Axis labels","asz"],["Tick labels","ksz"],["Gene labels","psz"],["Title","tsz"]].map(([lb,k])=>(
          <div key={k}>
            <div style={{fontSize:10, color:C.muted, marginBottom:3}}>{lb}</div>
            <input type="number" min={7} max={22} value={d[k]} onChange={e=>set(s=>({...s,[k]:+e.target.value}))}
              style={{width:"100%", padding:"4px 7px", fontSize:11, borderRadius:5, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none"}}/>
          </div>
        ))}
      </div>

      <Divider/>
      <button onClick={()=>set({...DEF_D})}
        style={{width:"100%", padding:"6px 0", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>
        Reset all to defaults
      </button>
    </div>
  );
}

// ─── Axes Panel ───────────────────────────────────────────────────────────────
function AxesPanel({d, set, sets, setSets}) {
  const C=useC();
  const AxIn=({label,k})=>{
    const [v,setV]=useState(String(sets[k]));
    useEffect(()=>setV(String(sets[k])),[sets[k]]);
    const commit=()=>{
      const sv=v.trim().toLowerCase();
      if(sv===""||sv==="auto"){setSets(p=>({...p,[k]:"auto"}));setV("auto");return;}
      const n=parseFloat(sv);
      if(!isNaN(n)){setSets(p=>({...p,[k]:n}));setV(String(n));}
      else setV(String(sets[k]));
    };
    return (
      <div>
        <div style={{fontSize:10, color:C.muted, marginBottom:3}}>{label}</div>
        <input value={v} onChange={e=>setV(e.target.value)} onBlur={commit}
          onKeyDown={e=>{if(e.key==="Enter")commit();}} placeholder="auto"
          style={{width:"100%", boxSizing:"border-box", padding:"5px 7px", fontSize:11, borderRadius:5,
            border:"1px solid "+(v==="auto"||v===""?C.border:C.accent), background:C.cBg, color:C.text, outline:"none", fontFamily:"monospace"}}/>
      </div>
    );
  };
  return (
    <div>
      <SLabel>Axis Range (type "auto" to reset)</SLabel>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8}}>
        <AxIn label="X min" k="xmin"/><AxIn label="X max" k="xmax"/>
      </div>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8}}>
        <AxIn label="Y min" k="ymin"/><AxIn label="Y max" k="ymax"/>
      </div>
      <button onClick={()=>setSets(s=>({...s,xmin:"auto",xmax:"auto",ymin:"auto",ymax:"auto"}))}
        style={{width:"100%", padding:"5px 0", borderRadius:5, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted, marginBottom:10}}>
        Reset all to auto
      </button>
      <Divider/>
      <SLabel>Line Thickness</SLabel>
      <Slider label="Axis lines" value={d.aw||1.2} min={0.5} max={5} step={0.1}
        onChange={v=>set(s=>({...s,aw:v}))} display={(d.aw||1.2)+"px"}/>
      <Slider label="Grid lines" value={d.gw||0.5} min={0.3} max={3} step={0.1}
        onChange={v=>set(s=>({...s,gw:v}))} display={(d.gw||0.5)+"px"}/>
    </div>
  );
}

// ─── Legend Panel ─────────────────────────────────────────────────────────────
function LegendPanel({legVis, setLegVis, legStyle, setLegStyle, legPos, setLegPos, MT}) {
  const C=useC();
  const vis=id=>legVis[id]!==false;
  return (
    <div>
      <SLabel>Visible Legend Items</SLabel>
      <div style={{display:"flex", gap:4, marginBottom:8}}>
        <button onClick={()=>{const m={};LEGEND_ITEMS.forEach(x=>{m[x.id]=true;});setLegVis(m);}}
          style={{padding:"3px 10px", borderRadius:5, fontSize:10, cursor:"pointer", background:C.accent, border:"none", color:"#fff"}}>All</button>
        <button onClick={()=>{const m={};LEGEND_ITEMS.forEach(x=>{m[x.id]=false;});setLegVis(m);}}
          style={{padding:"3px 10px", borderRadius:5, fontSize:10, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>None</button>
      </div>
      <div style={{display:"flex", flexDirection:"column", gap:3, marginBottom:12}}>
        {LEGEND_ITEMS.map(item=>{
          const on=vis(item.id);
          return (
            <button key={item.id} onClick={()=>setLegVis(p=>({...p,[item.id]:!p[item.id]}))}
              style={{display:"flex", alignItems:"center", gap:8, padding:"6px 9px", borderRadius:7, cursor:"pointer", textAlign:"left",
                background:on?C.cSel:"transparent", border:"1px solid "+(on?C.accent:C.border)}}>
              <div style={{width:14, height:14, borderRadius:4, flexShrink:0, background:on?C.accent:C.panel2, border:"1px solid "+(on?C.accent:C.border), display:"flex", alignItems:"center", justifyContent:"center"}}>
                {on&&<span style={{color:"#fff", fontSize:10, fontWeight:700}}>v</span>}
              </div>
              <span style={{fontSize:11, fontWeight:600, color:on?C.text:C.muted}}>{item.label}</span>
              <span style={{fontSize:9, color:C.muted, marginLeft:2}}>{item.desc}</span>
            </button>
          );
        })}
      </div>
      <Divider/>
      <SLabel>Text Style</SLabel>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:10}}>
        <span style={{fontSize:11, color:C.muted, flex:1}}>Font size</span>
        <button onClick={()=>setLegStyle(s=>({...s,fontSize:Math.max(7,s.fontSize-1)}))}
          style={{width:26, height:26, borderRadius:5, border:"1px solid "+C.border, background:C.panel2, color:C.text, cursor:"pointer", fontSize:15, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center"}}>-</button>
        <span style={{fontSize:12, fontWeight:700, color:C.accent, minWidth:20, textAlign:"center"}}>{legStyle.fontSize}</span>
        <button onClick={()=>setLegStyle(s=>({...s,fontSize:Math.min(18,s.fontSize+1)}))}
          style={{width:26, height:26, borderRadius:5, border:"1px solid "+C.border, background:C.panel2, color:C.text, cursor:"pointer", fontSize:15, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center"}}>+</button>
      </div>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:10}}>
        <button onClick={()=>setLegStyle(s=>({...s,bold:!s.bold}))}
          style={{padding:"4px 12px", borderRadius:6, fontSize:12, fontWeight:700, cursor:"pointer", border:"1px solid "+(legStyle.bold?C.accent:C.border), background:legStyle.bold?C.accent:"transparent", color:legStyle.bold?"#fff":C.muted}}>B</button>
        <span style={{fontSize:11, color:C.muted}}>Bold text</span>
      </div>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:12}}>
        <ColDot color={legStyle.color||C.muted} size={22} onChange={v=>setLegStyle(s=>({...s,color:v}))}/>
        <span style={{fontSize:11, color:C.muted}}>Color override</span>
        {legStyle.color&&<button onClick={()=>setLegStyle(s=>({...s,color:""}))} style={{fontSize:10, color:C.muted, background:"transparent", border:"none", cursor:"pointer"}}>auto</button>}
      </div>
      <Divider/>
      <SLabel>Position</SLabel>
      <div style={{fontSize:11, color:C.muted, marginBottom:8, lineHeight:1.5}}>
        Drag the legend anywhere on the plot to reposition it. Click any label text in the legend to edit it inline.
      </div>
      <button onClick={()=>setLegPos({x:548,y:MT})}
        style={{width:"100%", padding:"5px 0", borderRadius:6, fontSize:11, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>
        Reset to default position
      </button>
    </div>
  );
}

// ─── Export Panel ─────────────────────────────────────────────────────────────
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

function ExportPanel({plotRef, d, rows}) {
  const C=useC();
  const [fmt,     setFmt]     = useState("png");
  const [dpi,     setDpi]     = useState(300);
  const [mmW,     setMmW]     = useState(183);
  const [mmH,     setMmH]     = useState(120);
  const [useSize, setUseSize] = useState(false);
  const [trim,    setTrim]    = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [done,    setDone]    = useState(false);
  const [err,     setErr]     = useState(null);

  const doExport=async()=>{
    setSaving(true); setErr(null);
    const name="volcano_"+new Date().toISOString().slice(0,10);
    await new Promise(r=>setTimeout(r,60));
    try{
      if(fmt==="csv"){
        const filled=rows.filter(r=>Object.values(r).some(v=>v!==""&&v!=null));
        if(filled.length){
          const csv="gene,log2fc,pval\n"+filled.map(r=>(r.gene||"")+","+(r.log2fc||0)+","+(r.pval||1)).join("\n");
          downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}), name+".csv");
        }
        setDone(true); setTimeout(()=>setDone(false),1500); return;
      }
      const svgEl=plotRef&&plotRef.current&&plotRef.current.querySelector("svg");
      if(!svgEl){ setErr("Couldn't find the plot. Switch to the Plot or Split view and try again."); return; }
      const clone=svgEl.cloneNode(true);
      clone.style.removeProperty("width"); clone.style.removeProperty("max-width"); clone.style.removeProperty("height"); // on-screen scaling only
      clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
      const vbAttr=svgEl.getAttribute("viewBox")||"0 0 700 420";
      const vbParts=vbAttr.split(" ").map(Number);
      const fullW=vbParts[2]||700, fullH=vbParts[3]||420;
      const box=trim?tightViewBox(svgEl,fullW,fullH,4):{x:0,y:0,w:fullW,h:fullH};
      const svgW=box.w, svgH=box.h;
      clone.setAttribute("viewBox",box.x+" "+box.y+" "+box.w+" "+box.h);
      const bgFill=d.pbg||"#ffffff"; // figures are always on white paper
      const bgR=document.createElementNS("http://www.w3.org/2000/svg","rect");
      bgR.setAttribute("x",box.x); bgR.setAttribute("y",box.y);
      bgR.setAttribute("width",box.w); bgR.setAttribute("height",box.h); bgR.setAttribute("fill",bgFill);
      clone.insertBefore(bgR,clone.firstChild);
      if(fmt==="svg"){
        if(useSize){clone.setAttribute("width",mmW+"mm");clone.setAttribute("height",mmH+"mm");}
        else{clone.setAttribute("width",svgW);clone.setAttribute("height",svgH);}
        downloadBlob(new Blob([clone.outerHTML],{type:"image/svg+xml;charset=utf-8"}), name+".svg");
      } else {
        const pxW=useSize?Math.round(mmW/25.4*dpi):Math.round(svgW*(dpi/96));
        const pxH=useSize?Math.round(mmH/25.4*dpi):Math.round(svgH*(dpi/96));
        prepareSVGForExport(clone, svgW, svgH, d.ff);
        const svgStr=serializeSVG(clone);
        const cv=await rasterizeSVG(svgStr,pxW,pxH,svgW,svgH,bgFill);
        const sfx="_"+dpi+"dpi"+(useSize?"_"+mmW+"x"+mmH+"mm":"");
        const ext = fmt==="jpeg"?".jpg":fmt==="tiff"?".tif":".png";
        downloadBlob(await encodeCanvas(cv, fmt, dpi), name+sfx+ext);
      }
      setDone(true); setTimeout(()=>setDone(false),1500);
    }catch(e){ setErr((e&&e.message)?e.message:"Export failed."); }
    finally{setSaving(false);}
  };

  const FMTS=[{id:"png",l:"PNG",sub:"Best for most journals"},{id:"jpeg",l:"JPEG",sub:"Smaller file size"},{id:"tiff",l:"TIFF",sub:"ImageJ / Photoshop"},{id:"svg",l:"SVG",sub:"Vector, infinitely scalable"},{id:"csv",l:"CSV",sub:"Download data table"}];
  const svgEl2=plotRef&&plotRef.current&&plotRef.current.querySelector("svg");
  const vbStr=(svgEl2&&svgEl2.getAttribute("viewBox"))||"0 0 680 400";
  const vbArr=vbStr.split(" ").map(Number);
  const prevW=useSize?Math.round(mmW/25.4*dpi):Math.round((vbArr[2]||680)*(dpi/96));
  const prevH=useSize?Math.round(mmH/25.4*dpi):Math.round((vbArr[3]||400)*(dpi/96));

  return (
    <div>
      <SLabel>Format</SLabel>
      <div style={{display:"flex", flexDirection:"column", gap:4, marginBottom:12}}>
        {FMTS.map(f=>(
          <button key={f.id} onClick={()=>setFmt(f.id)}
            style={{display:"flex", alignItems:"center", gap:10, padding:"8px 10px", borderRadius:7, cursor:"pointer", textAlign:"left",
              background:fmt===f.id?C.cSel:"transparent", border:"1.5px solid "+(fmt===f.id?C.accent:C.border)}}>
            <div style={{width:12, height:12, borderRadius:"50%", border:"2px solid "+(fmt===f.id?C.accent:C.border), background:fmt===f.id?C.accent:"transparent", flexShrink:0}}/>
            <span style={{fontSize:11, fontWeight:700, color:fmt===f.id?C.text:C.muted, width:34}}>{f.l}</span>
            <span style={{fontSize:10, color:C.muted}}>{f.sub}</span>
          </button>
        ))}
      </div>
      {fmt==="tiff"&&<div style={{padding:"6px 9px", borderRadius:6, background:C.tag, fontSize:10, color:C.tagText, marginBottom:10, border:"1px solid "+C.cBorder}}>Exported as PNG with .tif extension — opens correctly in ImageJ, FIJI, and Photoshop.</div>}

      {fmt!=="svg"&&fmt!=="csv"&&(
        <div>
          <Divider/>
          <SLabel>Resolution (DPI)</SLabel>
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, marginBottom:6}}>
            {[[72,"Screen"],[150,"Draft"],[300,"Journal"],[600,"High-res"]].map(([v,lb])=>(
              <button key={v} onClick={()=>setDpi(v)}
                style={{padding:"6px 4px", borderRadius:6, cursor:"pointer", textAlign:"center",
                  background:dpi===v?C.cSel:"transparent", border:"1.5px solid "+(dpi===v?C.accent:C.border)}}>
                <div style={{fontSize:12, fontWeight:700, color:dpi===v?C.accent:C.muted}}>{v}</div>
                <div style={{fontSize:9, color:C.muted}}>{lb}</div>
              </button>
            ))}
          </div>
          <input type="number" min={72} max={1200} value={dpi} onChange={e=>setDpi(Math.min(1200,Math.max(72,+e.target.value||72)))}
            style={{width:"100%", padding:"5px 7px", fontSize:11, borderRadius:5, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none", marginBottom:8}}/>
        </div>
      )}

      {fmt!=="csv"&&(
        <div>
          <Divider/>
          <SLabel>Figure Size (mm)</SLabel>
          <Toggle value={trim} onChange={setTrim} label="Trim empty space"/>
          <div style={{fontSize:10, color:C.muted, lineHeight:1.5, margin:"2px 0 8px"}}>Crops the exported file to the plot itself. Leave on unless you want the blank margin kept.</div>
          <Toggle value={useSize} onChange={setUseSize} label="Set custom size in mm"/>
          {useSize&&(
            <div>
              <div style={{display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:4, marginBottom:8}}>
                {MM_PRESETS.map(p=>(
                  <button key={p.w} onClick={()=>setMmW(p.w)}
                    style={{padding:"5px 4px", borderRadius:6, cursor:"pointer", textAlign:"center",
                      background:mmW===p.w?C.cSel:"transparent", border:"1.5px solid "+(mmW===p.w?C.accent:C.border)}}>
                    <div style={{fontSize:11, fontWeight:700, color:mmW===p.w?C.accent:C.muted}}>{p.label}</div>
                    <div style={{fontSize:9, color:C.muted}}>{p.desc}</div>
                  </button>
                ))}
              </div>
              <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:8}}>
                <div>
                  <div style={{fontSize:10, color:C.muted, marginBottom:3}}>Width (mm)</div>
                  <input type="number" min={50} max={500} value={mmW} onChange={e=>setMmW(+e.target.value||89)}
                    style={{width:"100%", padding:"5px 7px", fontSize:11, borderRadius:5, border:"1px solid "+C.accent, background:C.cBg, color:C.text, outline:"none"}}/>
                </div>
                <div>
                  <div style={{fontSize:10, color:C.muted, marginBottom:3}}>Height (mm)</div>
                  <input type="number" min={30} max={500} value={mmH} onChange={e=>setMmH(+e.target.value||100)}
                    style={{width:"100%", padding:"5px 7px", fontSize:11, borderRadius:5, border:"1px solid "+C.accent, background:C.cBg, color:C.text, outline:"none"}}/>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {fmt!=="svg"&&fmt!=="csv"&&(
        <div style={{padding:"9px 11px", borderRadius:8, background:C.panel2, border:"1px solid "+C.border, marginBottom:12}}>
          <div style={{fontSize:10, color:C.muted, marginBottom:4, fontWeight:600}}>Output preview</div>
          {useSize&&<div style={{fontSize:11, color:C.text, marginBottom:2}}>{mmW} x {mmH} mm</div>}
          <div style={{fontSize:11, color:C.text}}>{prevW} x {prevH} px at {dpi} dpi</div>
          {dpi>=300?<div style={{fontSize:10, color:C.success, fontWeight:600, marginTop:4}}>Journal quality</div>:<div style={{fontSize:10, color:C.muted, marginTop:4}}>Use 300+ dpi for publication</div>}
        </div>
      )}

      <button onClick={doExport} disabled={saving}
        style={{width:"100%", padding:"11px 0", borderRadius:8, fontSize:13, fontWeight:700, cursor:saving?"default":"pointer",
          background:done?C.success:C.accent, border:"none", color:"#fff", transition:"background .2s"}}>
        {done?"Saved!":saving?"Saving...":"Download "+fmt.toUpperCase()}
      </button>
      {err&&(
        <div style={{marginTop:8, fontSize:11, lineHeight:1.55, padding:"8px 10px", borderRadius:6, background:"#FEE2E2", color:"#991B1B", border:"1px solid #FCA5A5"}}>
          <strong>Download failed.</strong> {err}
        </div>
      )}
    </div>
  );
}

// ─── Sheet Sidebar ────────────────────────────────────────────────────────────
function SheetSidebar({sheets, activeId, onSelect, onNew, onRename, onDuplicate, onDelete, onSave, onLoad, C}) {
  const [renaming,setRenaming]=useState(null);
  const [draft,   setDraft]   =useState("");
  const [showNew, setShowNew] =useState(false);
  const [newName, setNewName] =useState("");
  const [menu,    setMenu]    =useState(null);
  const fileRef=useRef(null);
  const startRename =sh=>{setRenaming(sh.id);setDraft(sh.name);setMenu(null);};
  const commitRename=()=>{if(draft.trim())onRename(renaming,draft.trim());setRenaming(null);};
  return (
    <div style={{width:190, background:C.panel, borderRight:"1px solid "+C.border, display:"flex", flexDirection:"column", flexShrink:0}}>
      <div style={{padding:"10px 12px", borderBottom:"1px solid "+C.border, display:"flex", alignItems:"center", justifyContent:"space-between"}}>
        <span style={{fontSize:12, fontWeight:700, color:C.text}}>Sheets</span>
        <button onClick={()=>{setShowNew(true);setNewName("Sheet "+(sheets.length+1));}}
          style={{width:24, height:24, borderRadius:6, background:C.accent, border:"none", color:"#fff", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700}}>+</button>
      </div>
      <div style={{flex:1, overflowY:"auto", padding:"4px 0"}}>
        {sheets.map(sh=>(
          <div key={sh.id} onClick={()=>{onSelect(sh.id);setMenu(null);}}
            style={{position:"relative", display:"flex", alignItems:"center", gap:6, padding:"8px 12px", cursor:"pointer",
              background:sh.id===activeId?C.cSel:"transparent", borderLeft:"3px solid "+(sh.id===activeId?C.accent:"transparent")}}>
            <span style={{fontSize:14, flexShrink:0}}>📈</span>
            {renaming===sh.id
              ?<input autoFocus value={draft} onChange={e=>setDraft(e.target.value)}
                  onBlur={commitRename} onKeyDown={e=>{if(e.key==="Enter")commitRename();if(e.key==="Escape")setRenaming(null);}}
                  onClick={e=>e.stopPropagation()}
                  style={{flex:1, fontSize:11, padding:"2px 5px", borderRadius:4, border:"1px solid "+C.accent, background:C.cBg, color:C.text, outline:"none", minWidth:0}}/>
              :<span style={{flex:1, fontSize:11, fontWeight:sh.id===activeId?600:400, color:sh.id===activeId?C.text:C.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{sh.name}</span>
            }
            <button onClick={e=>{e.stopPropagation();setMenu(menu===sh.id?null:sh.id);}}
              style={{padding:"2px 6px", fontSize:13, background:"transparent", border:"none", color:C.muted, cursor:"pointer", opacity:sh.id===activeId?1:0, flexShrink:0}}>...</button>
            {menu===sh.id&&(
              <div onClick={e=>e.stopPropagation()}
                style={{position:"absolute", right:4, top:30, zIndex:100, background:C.panel, border:"1px solid "+C.border, borderRadius:8, boxShadow:C.shadow, minWidth:138, padding:"4px 0"}}>
                {[["Rename",()=>startRename(sh)],["Duplicate",()=>{onDuplicate(sh.id);setMenu(null);}],["Delete",()=>{onDelete(sh.id);setMenu(null);}]].map(([lb,fn])=>(
                  <button key={lb} onClick={fn} style={{display:"block", width:"100%", padding:"7px 14px", textAlign:"left", fontSize:12, color:lb==="Delete"?"#DC2626":C.text, background:"transparent", border:"none", cursor:"pointer"}}>{lb}</button>
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
            <button onClick={()=>{onNew(newName.trim()||"Sheet "+(sheets.length+1));setShowNew(false);}}
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
          onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{onLoad(JSON.parse(ev.target.result));}catch(_){}};r.readAsText(f);e.target.value="";}}/>
        <div style={{fontSize:9, color:C.muted, textAlign:"center"}}>Ctrl+S to save</div>
      </div>
    </div>
  );
}

// ─── Volcano SVG ──────────────────────────────────────────────────────────────
function VolcanoPlot({data, sets, d, geneSetParsed, geneSetColor, legVis, legStyle, legPos, setLegPos, labeled, setLabeled}) {
  const C=useC();
  const st=gS(d,C);
  const fc       = sets.fc||1;
  const pt       = sets.pt||0.05;
  const dotR     = sets.dotR||4;
  const adjP     = sets.adjP||false;
  const lc       = sets.labelColor||C.text;
  const colorMode= sets.colorMode||"3group";
  const topN     = sets.topN||0;
  const topNby   = sets.topNby||"pval";
  const repel    = sets.repelLabels!==false;
  const fcOnlyC  = sets.fcOnlyColor||"#D97706";
  const x1s      = sets.xmin||"auto";
  const x2s      = sets.xmax||"auto";
  const y1s      = sets.ymin||"auto";
  const y2s      = sets.ymax||"auto";
  const nlpThresh= -Math.log10(pt);

  const [hov,        setHov]        = useState(null);
  const [labelMode,  setLabelMode]  = useState(false);
  const [legDrag,    setLegDrag]    = useState(null);
  const [editingRow, setEditingRow] = useState(null);
  const [editVal,    setEditVal]    = useState("");
  const [customLbls, setCustomLbls] = useState({});

  const svgRef          = useRef(null);
  const svgContainerRef = useRef(null);
  const editInputRef    = useRef(null);

  const vis      = id  => legVis[id]!==false;
  const getLabel = (k,fb) => customLbls[k]!==undefined?customLbls[k]:fb;
  const setLabel = (k,v)  => setCustomLbls(p=>({...p,[k]:v}));
  const toggle   = useCallback(g=>{setLabeled(prev=>{const n=new Set(prev);if(n.has(g))n.delete(g);else n.add(g);return n;});},[setLabeled]);

  // ── Data ────────────────────────────────────────────────────────────────
  const proc=useMemo(()=>data.map(r=>{const pv=Math.max(+r.pval||0,1e-300);return{...r,nlp:+(-Math.log10(pv)).toFixed(4)};}),[data]);
  const fcVals=proc.map(p=>Math.abs(p.log2fc));
  const fcMin=Math.min.apply(null,fcVals);
  const fcMax=Math.max.apply(null,[...fcVals,0.01]);

  const gradCol=useCallback(v=>{
    const t=Math.max(0,Math.min(1,(Math.abs(v)-fcMin)/(fcMax-fcMin)));
    if(t<0.5){const s=t*2;return"rgb("+Math.round(80+175*s)+","+Math.round(120+135*s)+","+Math.round(255*(1-s)+120*s)+")";}
    const s=(t-0.5)*2;return"rgb(255,"+Math.round(255*(1-s))+","+Math.round(120*(1-s))+")";
  },[fcMin,fcMax]);

  const getCol=useCallback(p=>{
    if(colorMode==="gradient")return gradCol(p.log2fc);
    const sigP=p.nlp>=nlpThresh,sigFC=Math.abs(p.log2fc)>=fc;
    if(sigP&&p.log2fc>fc) return st.cu;
    if(sigP&&p.log2fc<-fc)return st.cd;
    if(colorMode==="4group"&&sigFC)return fcOnlyC;
    return st.cn;
  },[colorMode,nlpThresh,fc,st.cu,st.cd,st.cn,fcOnlyC,gradCol]);

  const up    =proc.filter(p=>p.nlp>=nlpThresh&&p.log2fc>fc).length;
  const dn    =proc.filter(p=>p.nlp>=nlpThresh&&p.log2fc<-fc).length;
  const fcOnly=proc.filter(p=>p.nlp<nlpThresh&&Math.abs(p.log2fc)>=fc).length;
  const ns_   =proc.length-up-dn-fcOnly;

  const inGS=useCallback(g=>geneSetParsed.size>0&&geneSetParsed.has((g||"").toUpperCase()),[geneSetParsed]);

  const xVals=proc.map(p=>p.log2fc).filter(isFinite);
  const yVals=proc.map(p=>p.nlp).filter(isFinite);
  const amax =Math.max.apply(null,[...xVals.map(Math.abs),0.5]);
  const x1=x1s==="auto"?-(amax*1.15):+x1s;
  const x2=x2s==="auto"?amax*1.15:+x2s;
  const y1=y1s==="auto"?0:+y1s;
  const y2=y2s==="auto"?Math.max.apply(null,[...yVals,1])*1.15:+y2s;

  const autoLabeled=useMemo(()=>{
    if(!topN)return new Set();
    const sig=proc.filter(p=>p.nlp>=nlpThresh&&Math.abs(p.log2fc)>=fc);
    let sorted;
    if(topNby==="fc")     sorted=[...sig].sort((a,b)=>Math.abs(b.log2fc)-Math.abs(a.log2fc));
    else if(topNby==="both")sorted=[...sig].sort((a,b)=>(b.nlp*Math.abs(b.log2fc))-(a.nlp*Math.abs(a.log2fc)));
    else                  sorted=[...sig].sort((a,b)=>b.nlp-a.nlp);
    return new Set(sorted.slice(0,topN).map(p=>p.gene));
  },[proc,topN,topNby,nlpThresh,fc]);

  // ── Layout ──────────────────────────────────────────────────────────────
  const W=520, ML=52, MR=20, MT=30, MB=48, PH=310, PW=W-ML-MR, H=PH+MT+MB;
  // Extra right margin to hold the threshold label outside the plot area (Option 2)
  const LABEL_MARGIN=36;
  const SVGW=W+MR+LABEL_MARGIN+180;
  const r=dotR;

  const sx=useCallback(v=>ML+(v-x1)/(x2-x1)*PW,[x1,x2,PW]);
  const sy=useCallback(v=>MT+PH-(v-y1)/(y2-y1)*PH,[y1,y2,PH]);

  // Dots carrying extra decoration stay as individual elements; everything else
  // is merged. Deliberately excludes the hovered gene so that moving the mouse
  // doesn't invalidate the merged geometry on every frame.
  const specialGenes = useMemo(()=>{
    const s=new Set();
    labeled.forEach(g=>s.add(g));
    autoLabeled.forEach(g=>s.add(g));
    if (geneSetParsed.size>0) proc.forEach(p=>{ if(inGS(p.gene)) s.add(p.gene); });
    return s;
  },[labeled,autoLabeled,geneSetParsed,inGS,proc]);

  const plainLayers = useMemo(()=>{
    const groups=new Map();
    for (let i=0;i<proc.length;i++) {
      const p=proc[i];
      if (specialGenes.has(p.gene)) continue;
      const col=getCol(p);
      let g=groups.get(col);
      if (!g) { g=[]; groups.set(col,g); }
      g.push({cx:sx(p.log2fc), cy:sy(p.nlp)});
    }
    const out=[];
    groups.forEach((pts,col)=>{
      for (let i=0;i<pts.length;i+=DOT_CHUNK) out.push({col, d:dotsToPath(pts.slice(i,i+DOT_CHUNK), r)});
    });
    return out;
  },[proc,specialGenes,getCol,sx,sy,r]);

  const specialPts = useMemo(()=>proc.filter(p=>specialGenes.has(p.gene)),[proc,specialGenes]);

  const hitIndex = useMemo(()=>buildHitIndex(
    proc.map(p=>({p, cx:sx(p.log2fc), cy:sy(p.nlp)})), 14
  ),[proc,sx,sy]);

  const hitAt = useCallback(e=>{
    const svg=svgRef.current;
    if (!svg) return null;
    const box=svg.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const px=(e.clientX-box.left)*(SVGW/box.width);
    const py=(e.clientY-box.top)*(H/box.height);
    return queryHitIndex(hitIndex, px, py, r+5);
  },[hitIndex,r,SVGW,H]);
  // Round-number ticks (1/2/2.5/5 x 10^k), the way Prism and ggplot place them.
  // Evenly splitting the range into sixths gave values like -3.7 / -1.9 that
  // land next to the FC threshold markers and read as noise.
  const xTk=useMemo(()=>niceTicks(x1,x2,6),[x1,x2]);
  const yTk=useMemo(()=>niceTicks(y1,y2,5),[y1,y2]);
  const xTks=xTk.ticks, yTks=yTk.ticks;

  // ── Label repulsion ──────────────────────────────────────────────────────
  // Labels are drawn text-anchor "start" at (x, y=baseline), so each label's
  // box is [x, x+w] x [y-h+1, y+2]. The previous version treated x as the box
  // centre and only pushed labels away from other labels — never from dots —
  // so names routinely landed on top of neighbouring points.
  const labelPositions=useMemo(()=>{
    const all=proc.filter(p=>labeled.has(p.gene)||autoLabeled.has(p.gene));
    if(!all.length||!repel)return{};
    const lbFs=st.lb.fontSize||9, charW=lbFs*0.58, h=lbFs+1;
    const L=ML+2, R=ML+PW-2, T=MT+2, B=MT+PH-2;
    // Every visible dot is an obstacle; decorated dots use their halo radius.
    const CELL=24, grid=new Map();
    proc.forEach(p=>{
      const cx=sx(p.log2fc), cy=sy(p.nlp);
      if(!(cx>=ML&&cx<=ML+PW&&cy>=MT&&cy<=MT+PH))return;
      const deco=labeled.has(p.gene)||autoLabeled.has(p.gene)||inGS(p.gene);
      const o={x:cx,y:cy,r:(deco?r+5:r)+1.5};
      const k=Math.floor(cx/CELL)+","+Math.floor(cy/CELL);
      if(!grid.has(k))grid.set(k,[]); grid.get(k).push(o);
    });
    const near=(x0,y0,x1,y1)=>{
      const out=[];
      for(let gx=Math.floor((x0-12)/CELL);gx<=Math.floor((x1+12)/CELL);gx++)
        for(let gy=Math.floor((y0-12)/CELL);gy<=Math.floor((y1+12)/CELL);gy++){const c=grid.get(gx+","+gy);if(c)for(const o of c)out.push(o);}
      return out;
    };
    const pos={};
    all.forEach(p=>{
      const cx=sx(p.log2fc), cy=sy(p.nlp), w=p.gene.length*charW+2;
      const home=labelHome(cx,cy,w,r,L,R);
      pos[p.gene]={x:home.x,y:home.y,ox:cx,oy:cy,hx:home.x,hy:home.y,w,h};
    });
    const genes=Object.keys(pos);
    for(let it=0;it<150;it++){
      let moved=0;
      genes.forEach(g=>{
        const a=pos[g]; let fx=0, fy=0;
        const ax0=a.x, ax1=a.x+a.w, ay0=a.y-a.h+1, ay1=a.y+2;
        // label vs label: separate along the axis of least overlap
        genes.forEach(g2=>{
          if(g===g2)return;
          const b=pos[g2], bx0=b.x, bx1=b.x+b.w, by0=b.y-b.h+1, by1=b.y+2;
          const ox=Math.min(ax1,bx1)-Math.max(ax0,bx0)+2, oy=Math.min(ay1,by1)-Math.max(ay0,by0)+2;
          if(ox>0&&oy>0){
            const dx=(ax0+ax1)-(bx0+bx1), dy=(ay0+ay1)-(by0+by1);
            if(oy<=ox) fy+=(dy>=0?1:-1)*oy*0.5; else fx+=(dx>=0?1:-1)*ox*0.5;
          }
        });
        // label vs dots: push the box out of every circle it touches
        near(ax0,ay0,ax1,ay1).forEach(o=>{
          const nx=Math.max(ax0,Math.min(o.x,ax1)), ny=Math.max(ay0,Math.min(o.y,ay1));
          let dx=nx-o.x, dy=ny-o.y; const dd=Math.hypot(dx,dy);
          if(dd>=o.r)return;
          if(dd<1e-6){dx=(ax0+ax1)/2-o.x; dy=(ay0+ay1)/2-o.y; const m=Math.hypot(dx,dy)||1; dx/=m; dy/=m;}
          else {dx/=dd; dy/=dd;}
          const push=(o.r-dd)*0.6; fx+=dx*push; fy+=dy*push;
        });
        // weak spring back toward the label's own dot
        fx+=(a.hx-a.x)*0.02; fy+=(a.hy-a.y)*0.02;
        const nx=Math.max(L,Math.min(R-a.w,a.x+fx)), ny=Math.max(T+a.h,Math.min(B,a.y+fy));
        moved+=Math.abs(nx-a.x)+Math.abs(ny-a.y); a.x=nx; a.y=ny;
      });
      if(moved<0.05)break;
    }
    return pos;
  },[proc,labeled,autoLabeled,repel,r,sx,sy,st.lb.fontSize,ML,PW,MT,PH,inGS]);

  // ── Legend ──────────────────────────────────────────────────────────────
  const LW=158;
  const fs=legStyle.fontSize, fw=legStyle.bold?"bold":"normal", ff=st.ff;
  const overCol=legStyle.color||null;

  const legRows=useMemo(()=>{
    const rows=[],adj=adjP?"adj.p":"p";
    if(vis("title"))   rows.push({id:"title",  type:"title",    text:getLabel("title",adj+"<"+pt+" | |log2FC|>"+fc)});
    if(vis("colorKey")){
      if(colorMode!=="gradient"){
        rows.push({id:"up",   type:"color",col:st.cu,   lbl:getLabel("up","UP"),     val:String(up)});
        rows.push({id:"down", type:"color",col:st.cd,   lbl:getLabel("down","DOWN"), val:String(dn)});
        if(colorMode==="4group")rows.push({id:"fconly",type:"color",col:fcOnlyC,lbl:getLabel("fconly","FC only"),val:String(fcOnly)});
        rows.push({id:"ns",   type:"color",col:st.cn,   lbl:getLabel("ns","NS"),     val:String(ns_)});
      } else {
        rows.push({id:"grad",type:"gradient"});
      }
      if(geneSetParsed.size>0)rows.push({id:"gs",type:"color",col:geneSetColor,lbl:getLabel("gs","Gene set"),val:String(geneSetParsed.size)});
    }
    if(vis("pval"))  rows.push({id:"pval",  type:"kv",lbl:getLabel("pval",  adj+" cutoff"),  val:pt.toExponential(1)});
    if(vis("nlp"))   rows.push({id:"nlp",   type:"kv",lbl:getLabel("nlp",   "-log10(p)"),    val:nlpThresh.toFixed(2)});
    if(vis("fc"))    rows.push({id:"fc",    type:"kv",lbl:getLabel("fc",    "|log2FC|"),     val:"+/-"+fc});
    if(vis("total")) rows.push({id:"total", type:"kv",lbl:getLabel("total", "Total genes"),  val:String(proc.length)});
    if(vis("pct"))   rows.push({id:"pct",   type:"kv",lbl:getLabel("pct",   "% Sig"),        val:(proc.length?((up+dn)/proc.length*100).toFixed(1):0)+"%",accent:true});
    if(vis("updown"))rows.push({id:"updown",type:"kv",lbl:getLabel("updown","Up/Down"),      val:up+"/"+dn});
    if(vis("labeled")&&labeled.size>0)rows.push({id:"labeled",type:"color",col:lc,lbl:getLabel("labeled","Labeled"),val:String(labeled.size)});
    return rows;
  },[legVis,up,dn,ns_,fcOnly,pt,nlpThresh,fc,proc.length,labeled.size,adjP,colorMode,st.cu,st.cd,st.cn,fcOnlyC,geneSetColor,geneSetParsed.size,lc,customLbls]);

  const legH=useMemo(()=>{let h=0;legRows.forEach(row=>{h+=row.type==="title"?fs+8:row.type==="gradient"?fs+34:fs+9;});return h;},[legRows,fs]);
  const anyLeg=legRows.length>0;

  // ── Drag ────────────────────────────────────────────────────────────────
  const onLegDown=useCallback(e=>{
    e.stopPropagation();
    const svg=svgRef.current;if(!svg)return;
    const pt2=svg.createSVGPoint();pt2.x=e.clientX;pt2.y=e.clientY;
    const sp=pt2.matrixTransform(svg.getScreenCTM().inverse());
    setLegDrag({sx:sp.x,sy:sp.y,ox:legPos.x,oy:legPos.y});
    e.preventDefault();
  },[legPos]);

  const onSVGMove=useCallback(e=>{
    if(!legDrag)return;
    const svg=svgRef.current;if(!svg)return;
    const pt2=svg.createSVGPoint();pt2.x=e.clientX;pt2.y=e.clientY;
    const sp=pt2.matrixTransform(svg.getScreenCTM().inverse());
    setLegPos({x:legDrag.ox+(sp.x-legDrag.sx),y:legDrag.oy+(sp.y-legDrag.sy)});
  },[legDrag,setLegPos]);

  const onSVGUp=useCallback(()=>setLegDrag(null),[]);

  // ── Inline legend label editing ──────────────────────────────────────────
  const startEdit=useCallback((rowId,curVal,e)=>{e&&e.stopPropagation();setEditingRow(rowId);setEditVal(curVal);setTimeout(()=>editInputRef.current&&editInputRef.current.focus(),30);},[]);
  const commitEdit=useCallback(()=>{if(editingRow)setLabel(editingRow,editVal);setEditingRow(null);},[editingRow,editVal]);
  const cancelEdit=useCallback(()=>setEditingRow(null),[]);

  const getEditStyle=useCallback(()=>{
    if(!editingRow||!svgContainerRef.current)return{display:"none"};
    const idx=legRows.findIndex(row=>row.id===editingRow);
    if(idx<0)return{display:"none"};
    let rowY=legPos.y;
    for(let i=0;i<idx;i++){const row=legRows[i];rowY+=row.type==="title"?fs+8:row.type==="gradient"?fs+34:fs+9;}
    const svgEl=svgContainerRef.current.querySelector("svg");if(!svgEl)return{display:"none"};
    const sRect=svgEl.getBoundingClientRect(),cRect=svgContainerRef.current.getBoundingClientRect();
    const scale=sRect.width/(SVGW||700);
    return{position:"absolute",left:Math.round(legPos.x*scale+(sRect.left-cRect.left)),top:Math.round(rowY*scale+(sRect.top-cRect.top)),
      width:Math.round(LW*scale),height:Math.round((fs+6)*scale),zIndex:200,
      background:C.cBg,border:"1.5px solid "+C.accent,borderRadius:4,padding:"1px 5px",
      fontSize:fs,color:C.text,outline:"none",fontFamily:ff,boxSizing:"border-box"};
  },[editingRow,legRows,legPos,SVGW,LW,fs,ff,C]);

  // ── Render legend (clean floating text, no box) ──────────────────────────
  const renderLegend=()=>{
    const lx=legPos.x,ly=legPos.y;
    const els=[];
    els.push(<rect key="drag" x={lx-4} y={ly-4} width={LW+8} height={legH+8} fill="transparent" style={{cursor:legDrag?"grabbing":"move"}} onPointerDown={onLegDown}/>);
    let cy=ly;
    legRows.forEach(row=>{
      const isEd=editingRow===row.id;
      if(row.type==="title"){
        els.push(<text key={row.id} x={lx} y={cy+fs} fontSize={fs} fontWeight="700" fill={isEd?C.accent:(overCol||C.muted)} fontFamily={ff} style={{cursor:"pointer"}} onClick={e=>startEdit(row.id,row.text,e)}>{isEd?"editing...":row.text}</text>);
        cy+=fs+8;
      } else if(row.type==="gradient"){
        els.push(<g key="grad">
          <defs><linearGradient id="vgLeg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor={gradCol(-fcMax)}/><stop offset="50%" stopColor={gradCol(0)}/><stop offset="100%" stopColor={gradCol(fcMax)}/></linearGradient></defs>
          <text x={lx} y={cy+fs} fontSize={fs} fontWeight={fw} fill={overCol||C.muted} fontFamily={ff}>log2FC</text>
          <rect x={lx} y={cy+fs+3} width={LW} height={9} rx={3} fill="url(#vgLeg)"/>
          <text x={lx} y={cy+fs+24} fontSize={fs-2} fill={overCol||C.muted} fontFamily={ff}>{(-fcMax).toFixed(1)}</text>
          <text x={lx+LW/2} y={cy+fs+24} fontSize={fs-2} fill={overCol||C.muted} fontFamily={ff} textAnchor="middle">0</text>
          <text x={lx+LW} y={cy+fs+24} fontSize={fs-2} fill={overCol||C.muted} fontFamily={ff} textAnchor="end">{fcMax.toFixed(1)}</text>
        </g>);
        cy+=fs+34;
      } else if(row.type==="color"){
        els.push(<circle key={row.id+"d"} cx={lx+fs*0.5} cy={cy+fs*0.42} r={r} fill={row.col}/>);
        els.push(<text key={row.id+"l"} x={lx+fs+5} y={cy+fs} fontSize={fs} fontWeight={fw} fill={isEd?C.accent:(overCol||row.col)} fontFamily={ff} style={{cursor:"pointer"}} onClick={e=>startEdit(row.id,row.lbl,e)}>{isEd?"editing...":row.lbl}</text>);
        els.push(<text key={row.id+"v"} x={lx+LW} y={cy+fs} fontSize={fs} fontWeight="700" fill={overCol||C.text} fontFamily={ff} textAnchor="end">{row.val}</text>);
        cy+=fs+9;
      } else if(row.type==="kv"){
        els.push(<text key={row.id+"l"} x={lx} y={cy+fs} fontSize={fs} fontWeight={fw} fill={isEd?C.accent:(overCol||C.muted)} fontFamily={ff} style={{cursor:"pointer"}} onClick={e=>startEdit(row.id,row.lbl,e)}>{isEd?"editing...":row.lbl}</text>);
        els.push(<text key={row.id+"v"} x={lx+LW} y={cy+fs} fontSize={fs} fontWeight="700" fill={row.accent?C.accent:(overCol||C.text)} fontFamily={ff} textAnchor="end">{row.val}</text>);
        cy+=fs+9;
      }
    });
    return <g key="legend">{els}</g>;
  };

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:10}}>
        {[{l:"Upregulated",v:up,c:st.cu},{l:"Downregulated",v:dn,c:st.cd},{l:"Not significant",v:ns_,c:st.cn}].map(x=>(
          <div key={x.l} style={{background:C.panel,border:"1px solid "+C.border,borderRadius:8,padding:"6px 10px",flex:1,textAlign:"center",boxShadow:C.shadow}}>
            <div style={{fontSize:18,fontWeight:700,color:x.c}}>{x.v}</div>
            <div style={{fontSize:10,color:C.muted}}>{x.l}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,flexWrap:"wrap"}}>
        <button onClick={()=>setLabelMode(m=>!m)}
          style={{padding:"4px 14px",borderRadius:16,fontSize:11,fontWeight:600,cursor:"pointer",
            background:labelMode?"#7C3AED":"transparent",
            border:"1px solid "+(labelMode?"#7C3AED":C.border),
            color:labelMode?"#fff":C.muted}}>
          {labelMode?"Label mode ON — click a dot to label it":"Click genes to label them"}
        </button>
        {labeled.size>0&&<button onClick={()=>setLabeled(new Set())} style={{padding:"4px 10px",borderRadius:16,fontSize:11,cursor:"pointer",background:"transparent",border:"1px solid "+C.border,color:C.muted}}>Clear {labeled.size} label{labeled.size!==1?"s":""}</button>}
        {autoLabeled.size>0&&<span style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>+{autoLabeled.size} auto-labeled</span>}
      </div>
      <div ref={svgContainerRef} style={{position:"relative",background:d.pbg||C.panel,border:"1px solid "+C.border,borderRadius:10,padding:"10px",boxShadow:C.shadow,overflowX:"auto"}}>
        {d.plotTitle&&<div style={{textAlign:"center",marginBottom:6,fontSize:st.ttl.fontSize,fontWeight:st.ttl.fontWeight,fontStyle:st.ttl.fontStyle,color:st.ttl.color,fontFamily:st.ff}}>{d.plotTitle}</div>}
        {editingRow&&<input ref={editInputRef} value={editVal} onChange={e=>setEditVal(e.target.value)} onBlur={commitEdit} onKeyDown={e=>{if(e.key==="Enter")commitEdit();if(e.key==="Escape")cancelEdit();}} style={getEditStyle()}/>}
        <svg ref={svgRef} width={SVGW} height={H} viewBox={"0 0 "+SVGW+" "+H}
          style={{display:"block",width:"100%",maxWidth:SVGW,height:"auto",cursor:legDrag?"grabbing":labelMode?"crosshair":"default",overflow:"visible"}}
          onPointerMove={onSVGMove} onPointerUp={onSVGUp} onPointerLeave={onSVGUp}>
          {d.showGrid!==false&&yTks.map((v,i)=><line key={"gy"+i} x1={ML} y1={sy(v)} x2={ML+PW} y2={sy(v)} stroke={st.grid} strokeWidth={st.gw} strokeDasharray="4 3"/>)}
          {d.showGrid!==false&&xTks.map((v,i)=><line key={"gx"+i} x1={sx(v)} y1={MT} x2={sx(v)} y2={MT+PH} stroke={st.grid} strokeWidth={st.gw} strokeDasharray="4 3"/>)}
          {(()=>{
            const frameStyle = d.frameStyle||"open";
            const bottomY=MT+PH, topY=MT, leftX=ML, rightX=ML+PW;
            let xa=leftX, xb=rightX, ya=topY, yb=bottomY;
            if (frameStyle==="offset") {
              xa=Math.min(sx(xTks[0]),sx(xTks[xTks.length-1])); xb=Math.max(sx(xTks[0]),sx(xTks[xTks.length-1]));
              ya=Math.min(sy(yTks[0]),sy(yTks[yTks.length-1])); yb=Math.max(sy(yTks[0]),sy(yTks[yTks.length-1]));
            }
            return (
              <g>
                <line x1={xa} y1={bottomY} x2={xb} y2={bottomY} stroke={st.axLine} strokeWidth={st.aw}/>
                <line x1={leftX} y1={ya} x2={leftX} y2={yb} stroke={st.axLine} strokeWidth={st.aw}/>
                {frameStyle==="closed"&&<line x1={leftX} y1={topY} x2={rightX} y2={topY} stroke={st.axLine} strokeWidth={st.aw}/>}
                {frameStyle==="closed"&&<line x1={rightX} y1={topY} x2={rightX} y2={bottomY} stroke={st.axLine} strokeWidth={st.aw}/>}
              </g>
            );
          })()}
          {yTks.map((v,i)=><text key={"yt"+i} x={ML-6} y={sy(v)+4} textAnchor="end" fontSize={st.tk.fontSize} fill={st.tk.fill} fontFamily={ff}>{v.toFixed(yTk.dec)}</text>)}
          {xTks.map((v,i)=><text key={"xt"+i} x={sx(v)} y={MT+PH+16} textAnchor="middle" fontSize={st.tk.fontSize} fill={st.tk.fill} fontFamily={ff}>{v.toFixed(xTk.dec)}</text>)}
          {/* FC threshold values sit above the plot at the top of their dashed
              lines, so they can never collide with the x-axis tick labels. */}
          <text x={sx(fc)} y={MT-6} textAnchor="middle" fontSize={9} fill={st.cu} fontFamily={ff} fontWeight="600">{fc}</text>
          <text x={sx(-fc)} y={MT-6} textAnchor="middle" fontSize={9} fill={st.cd} fontFamily={ff} fontWeight="600">{-fc}</text>
          <text x={ML+PW/2} y={H-4} textAnchor="middle" fontSize={st.ax.fontSize} fontWeight={st.ax.fontWeight} fontStyle={st.ax.fontStyle} fill={st.ax.fill} fontFamily={ff}>{d.xLbl||"log2 Fold Change"}</text>
          <text x={12} y={MT+PH/2} textAnchor="middle" fontSize={st.ax.fontSize} fontWeight={st.ax.fontWeight} fontStyle={st.ax.fontStyle} fill={st.ax.fill} fontFamily={ff} transform={"rotate(-90,12,"+(MT+PH/2)+")"}>{d.yLbl||"-log10(P value)"}</text>
          <line x1={sx(fc)} y1={MT} x2={sx(fc)} y2={MT+PH} stroke={st.cu} strokeDasharray="5 3" strokeOpacity={0.4} strokeWidth={1}/>
          <line x1={sx(-fc)} y1={MT} x2={sx(-fc)} y2={MT+PH} stroke={st.cd} strokeDasharray="5 3" strokeOpacity={0.4} strokeWidth={1}/>
          {/* OPTION 2: p-value ref line label at RIGHT end — no overlap with Y axis ticks */}
          <line x1={ML} y1={sy(nlpThresh)} x2={ML+PW} y2={sy(nlpThresh)} stroke={st.cn} strokeDasharray="5 3" strokeOpacity={0.5} strokeWidth={1}/>
          <text x={ML+PW+6} y={sy(nlpThresh)+4} textAnchor="start" fontSize={9} fontWeight="600" fill={st.cn} fontFamily={ff}>{nlpThresh.toFixed(2)}</text>
          {/* Transparent capture layer: hover/click are resolved against the
              spatial index, so merged dots stay interactive without handlers. */}
          <rect x={ML} y={MT} width={PW} height={PH} fill="transparent"
            onMouseMove={e=>{const h=hitAt(e); setHov(h?{...h.p,cx:h.cx,cy:h.cy}:null);}}
            onMouseLeave={()=>setHov(null)}
            onClick={e=>{if(!labelMode)return;const h=hitAt(e);if(h)toggle(h.p.gene);}}
            style={{cursor:labelMode?"crosshair":"default"}}/>

          {plainLayers.map((L,i)=>(
            <path key={"dots"+i} d={L.d} fill={L.col} fillOpacity={0.9} style={{pointerEvents:"none"}}/>
          ))}

          {specialPts.map((p,i)=>{
            const col=getCol(p),isManual=labeled.has(p.gene),isAuto=autoLabeled.has(p.gene),isLbl=isManual||isAuto;
            const isGS=inGS(p.gene);
            const cx=sx(p.log2fc),cy=sy(p.nlp);
            const lpos=isLbl&&repel?labelPositions[p.gene]:null;
            const lhome=lpos?null:labelHome(cx,cy,p.gene.length*((st.lb.fontSize||9)*0.58)+2,r,ML+2,ML+PW-2);
            const lx2=lpos?lpos.x:lhome.x, ly2=lpos?lpos.y:lhome.y;
            return (
              <g key={"sp"+i} style={{pointerEvents:"none"}}>
                {isGS&&<circle cx={cx} cy={cy} r={r+5} fill={geneSetColor} fillOpacity={0.15} stroke={geneSetColor} strokeWidth={1.5}/>}
                {isLbl&&<circle cx={cx} cy={cy} r={r+4} fill={lc} fillOpacity={0.15} stroke={lc} strokeWidth={0.8} strokeOpacity={0.4}/>}
                <circle cx={cx} cy={cy} r={isGS?r+2:r} fill={isGS?geneSetColor:col} fillOpacity={0.9} stroke={isLbl?lc:isGS?geneSetColor:"none"} strokeWidth={isLbl||isGS?1.5:1}/>
                {isLbl&&repel&&lpos&&(()=>{
                  const tx=Math.max(lpos.x,Math.min(cx,lpos.x+lpos.w)), ty=Math.max(lpos.y-lpos.h+1,Math.min(cy,lpos.y+2));
                  const dl=Math.hypot(tx-cx,ty-cy); if(dl<r+7)return null;
                  const sx0=cx+(tx-cx)/dl*(r+4), sy0=cy+(ty-cy)/dl*(r+4);
                  return <line x1={sx0} y1={sy0} x2={tx} y2={ty} stroke={lc} strokeWidth={0.7} strokeOpacity={0.6}/>;
                })()}
                {isLbl&&<text x={lx2} y={ly2} fontSize={st.lb.fontSize||9} fontWeight={st.lb.fontWeight} fontStyle={isAuto&&!isManual?"italic":st.lb.fontStyle} fill={lc} fontFamily={ff} style={{pointerEvents:"none"}}>{p.gene}</text>}
              </g>
            );
          })}

          {/* Hover highlight drawn on top, independent of the merged geometry. */}
          {hov&&isFinite(hov.cx)&&isFinite(hov.cy)&&(
            <g style={{pointerEvents:"none"}}>
              <circle cx={hov.cx} cy={hov.cy} r={r+4} fill={getCol(hov)} fillOpacity={0.15}/>
              <circle cx={hov.cx} cy={hov.cy} r={inGS(hov.gene)?r+2:r} fill={inGS(hov.gene)?geneSetColor:getCol(hov)} fillOpacity={0.95} stroke="#fff" strokeWidth={1}/>
            </g>
          )}
          {hov&&(()=>{
            const cx=hov.cx,cy=hov.cy,tx=cx>W-165?cx-165:cx+10,ty=Math.max(MT,cy-62);
            return (
              <g style={{pointerEvents:"none"}}>
                <rect x={tx} y={ty} width={158} height={labelMode?80:67} rx={6} fill={C.tip} stroke={C.border} strokeWidth={1}/>
                <text x={tx+9} y={ty+16} fontSize={12} fontWeight="700" fill={C.text}>{hov.gene}</text>
                <line x1={tx+9} y1={ty+20} x2={tx+149} y2={ty+20} stroke={C.border} strokeWidth={0.5}/>
                <text x={tx+9} y={ty+33} fontSize={10} fill={C.muted}>log2FC</text>
                <text x={tx+149} y={ty+33} fontSize={10} fontWeight="600" fill={hov.log2fc>0?st.cu:st.cd} textAnchor="end">{hov.log2fc}</text>
                <text x={tx+9} y={ty+47} fontSize={10} fill={C.muted}>p-value</text>
                <text x={tx+149} y={ty+47} fontSize={10} fontWeight="600" fill={C.text} textAnchor="end">{(+hov.pval).toExponential(2)}</text>
                <text x={tx+9} y={ty+61} fontSize={10} fill={C.muted}>-log10p</text>
                <text x={tx+149} y={ty+61} fontSize={10} fontWeight="600" fill={C.text} textAnchor="end">{hov.nlp.toFixed(3)}</text>
                {labelMode&&<text x={tx+79} y={ty+74} fontSize={9} fill="#7C3AED" textAnchor="middle" fontStyle="italic">Click to {labeled.has(hov.gene)?"remove":"add"} label</text>}
              </g>
            );
          })()}
          {anyLeg&&renderLegend()}
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

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function VolcanoPlotPage() {
  const C = useTheme(); // live theme from the app shell
  const [layout,setLayout]=useState("split");
  const [rtab,setRtab]=useState("labels");
  const plotRef=useRef(null);
  const MT=30;
  const [sheets,setSheets]=useState(()=>[mkSheet("Volcano 1")]);
  const [activeId,setActiveId]=useState(()=>sheets[0].id);
  const active=sheets.find(s=>s.id===activeId)||sheets[0];
  const histMap=useRef({}),curMap=useRef({});
  const [,bump]=useState(0);
  useEffect(()=>{if(!histMap.current[active.id]){histMap.current[active.id]=[active.rows];curMap.current[active.id]=0;}},[active.id]);
  const getH=id=>histMap.current[id]||(histMap.current[id]=[]);
  const getC=id=>curMap.current[id]!==undefined?curMap.current[id]:0;
  const setRows=useCallback(fn=>{const id=activeId,h=getH(id),c=getC(id),prev=h[c]||[];const next=typeof fn==="function"?fn(prev):fn;histMap.current[id]=[...h.slice(0,c+1),next].slice(-50);curMap.current[id]=histMap.current[id].length-1;setSheets(ss=>ss.map(s=>s.id===id?{...s,rows:next}:s));bump(v=>v+1);},[activeId]);
  const undo=useCallback(()=>{const id=activeId,c=getC(id);if(c<=0)return;curMap.current[id]=c-1;setSheets(ss=>ss.map(s=>s.id===id?{...s,rows:getH(id)[c-1]||[]}:s));bump(v=>v+1);},[activeId]);
  const redo=useCallback(()=>{const id=activeId,c=getC(id),h=getH(id);if(c>=h.length-1)return;curMap.current[id]=c+1;setSheets(ss=>ss.map(s=>s.id===id?{...s,rows:h[c+1]||[]}:s));bump(v=>v+1);},[activeId]);
  const canU=getC(activeId)>0,canR=getC(activeId)<getH(activeId).length-1;
  const setD=useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,d:typeof fn==="function"?fn(s.d):fn}:s)),[activeId]);
  const setSets=useCallback(fn=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,sets:typeof fn==="function"?fn(s.sets):fn}:s)),[activeId]);
  const setGeneSet=useCallback(v=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,geneSet:v}:s)),[activeId]);
  const setGeneSetColor=useCallback(v=>setSheets(ss=>ss.map(s=>s.id===activeId?{...s,geneSetColor:v}:s)),[activeId]);
  const newSheet=name=>{const sh=mkSheet(name);histMap.current[sh.id]=[sh.rows];curMap.current[sh.id]=0;setSheets(ss=>[...ss,sh]);setActiveId(sh.id);};
  const selectSheet=id=>{if(!histMap.current[id]){const sh=sheets.find(s=>s.id===id);histMap.current[id]=[sh?sh.rows:[]];curMap.current[id]=0;}setActiveId(id);};
  const renameSheet=(id,name)=>setSheets(ss=>ss.map(s=>s.id===id?{...s,name}:s));
  const dupSheet=id=>{const src=sheets.find(s=>s.id===id);if(!src)return;const sh={...JSON.parse(JSON.stringify(src)),id:Date.now()+Math.random(),name:src.name+" (copy)"};histMap.current[sh.id]=[sh.rows];curMap.current[sh.id]=0;setSheets(ss=>[...ss,sh]);setActiveId(sh.id);};
  const delSheet=id=>{if(sheets.length<=1)return;const rem=sheets.filter(s=>s.id!==id);setSheets(rem);if(activeId===id)setActiveId(rem[rem.length-1].id);};
  const saveProject=useCallback(()=>{const a=document.createElement("a");a.href="data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify({version:2,sheets},null,2));a.download="volcano_project_"+new Date().toISOString().slice(0,10)+".json";a.click();},[sheets]);
  const loadProject=data=>{if(!data||!data.sheets||!data.sheets.length)return;setSheets(data.sheets);setActiveId(data.sheets[0].id);data.sheets.forEach(s=>{histMap.current[s.id]=[s.rows];curMap.current[s.id]=0;});bump(v=>v+1);};
  useEffect(()=>{const h=e=>{if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==="z"){e.preventDefault();undo();}if((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.shiftKey&&e.key==="z"))){e.preventDefault();redo();}if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault();saveProject();}};window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);},[undo,redo,saveProject]);
  const {rows,d,sets,geneSet,geneSetColor}=active;
  const geneSetParsed=useMemo(()=>{if(!geneSet||!geneSet.trim())return new Set();return new Set(geneSet.split(/[\n,;\s]+/).map(g=>g.trim().toUpperCase()).filter(Boolean));},[geneSet]);
  const plotData=useMemo(()=>{const filled=rows.filter(r=>Object.values(r).some(v=>v!==""&&v!=null));if(filled.length>=2)return filled.map(r=>({gene:String(r.gene||"?"),log2fc:+r.log2fc||0,pval:+r.pval||1}));return EXAMPLE;},[rows]);
  const sigGenes=useMemo(()=>{const nlpCutoff=-Math.log10(sets.pt||0.05),fc=sets.fc||1;return plotData.map(r=>{const pv=Math.max(+r.pval||0,1e-300);return{...r,nlp:+(-Math.log10(pv)).toFixed(4)};}).filter(r=>r.nlp>=nlpCutoff&&Math.abs(r.log2fc)>=fc).map(r=>({gene:r.gene,log2fc:r.log2fc,pval:r.pval,nlp:r.nlp,group:r.log2fc>fc?"UP":"DOWN"})).sort((a,b)=>b.nlp-a.nlp);},[plotData,sets.pt,sets.fc]);
  const filled=rows.filter(r=>Object.values(r).some(v=>v!==""&&v!=null)).length;
  const [legVis,setLegVis]=useState(()=>{const m={};LEGEND_ITEMS.forEach(x=>{m[x.id]=true;});return m;});
  const [legStyle,setLegStyle]=useState({fontSize:11,bold:false,color:""});
  const [legPos,setLegPos]=useState({x:548,y:MT});
  const [labeled,setLabeled]=useState(new Set());
  const TABS=[{id:"labels",icon:"🏷",label:"Labels"},{id:"plot",icon:"🎨",label:"Style"},{id:"axes",icon:"📐",label:"Axes"},{id:"legend",icon:"📋",label:"Legend"},{id:"export",icon:"⬇",label:"Export"}];
  return (
      <div style={{height:"100%",background:C.bg,color:C.text,fontFamily:"Inter,system-ui,sans-serif",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"0 16px",borderBottom:"1px solid "+C.border,background:C.panel,display:"flex",alignItems:"center",gap:12,flexShrink:0,height:48,boxShadow:C.shadow}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>🌋</span>
            
            <span style={{fontSize:11,color:C.muted,padding:"2px 8px",borderRadius:10,background:C.panel2,border:"1px solid "+C.border}}>Volcano Plot</span>
          </div>
          <div style={{height:20,width:1,background:C.border}}/>
          <span style={{fontSize:12,fontWeight:600,color:C.muted}}>{active.name}</span>
          <div style={{flex:1}}/>
        <CloudProjects tool="volcano" getData={()=>({version:2,sheets})} onLoad={loadProject}/>
          <div style={{display:"flex",background:C.panel2,borderRadius:8,padding:2,border:"1px solid "+C.border}}>
            {[["split","Split"],["sheet","Data"],["plot","Plot"]].map(([id,lb])=>(
              <button key={id} onClick={()=>setLayout(id)} style={{padding:"4px 12px",fontSize:11,fontWeight:600,cursor:"pointer",borderRadius:6,border:"none",background:layout===id?C.panel:"transparent",color:layout===id?C.text:C.muted,boxShadow:layout===id?C.shadow:"none"}}>{lb}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:3}}>
            <button onClick={undo} disabled={!canU} title="Ctrl+Z" style={{padding:"4px 10px",borderRadius:6,fontSize:11,background:"transparent",border:"1px solid "+C.border,cursor:canU?"pointer":"default",color:canU?C.text:C.muted}}>Undo</button>
            <button onClick={redo} disabled={!canR} title="Ctrl+Y" style={{padding:"4px 10px",borderRadius:6,fontSize:11,background:"transparent",border:"1px solid "+C.border,cursor:canR?"pointer":"default",color:canR?C.text:C.muted}}>Redo</button>
          </div>
        </div>
        <div style={{flex:1,display:"flex",minHeight:0,overflow:"hidden"}}>
          <SheetSidebar sheets={sheets} activeId={activeId} onSelect={selectSheet} onNew={newSheet} onRename={renameSheet} onDuplicate={dupSheet} onDelete={delSheet} onSave={saveProject} onLoad={loadProject} C={C}/>
          <div style={{flex:1,display:"flex",minWidth:0,overflow:"hidden"}}>
            {(layout==="split"||layout==="sheet")&&(
              <div style={{flex:1,overflowY:"auto",padding:"16px 18px",borderRight:layout==="split"?"1px solid "+C.border:"none"}}>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:15,fontWeight:700,color:C.text}}>{active.name}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>Enter your differential expression results, or paste directly from DESeq2, edgeR, or limma output.</div>
                </div>
                <Sheet rows={rows} setRows={setRows} undo={undo} redo={redo} canU={canU} canR={canR}/>
                {layout==="sheet"&&<div style={{marginTop:18,display:"flex",justifyContent:"center"}}><button onClick={()=>setLayout("plot")} style={{padding:"10px 32px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",background:C.accent,border:"none",color:"#fff",boxShadow:C.shadow}}>Generate Plot</button></div>}
              </div>
            )}
            {(layout==="split"||layout==="plot")&&(
              <div style={{flex:1,overflowY:"auto",padding:"16px 18px",minWidth:0}} ref={plotRef}>
                {/* The figure is always rendered on white "paper" with the light
                    palette, whatever the app theme — like Prism. Exports match. */}
                <TC.Provider value={LIGHT}>
                <ErrorBoundary>
                  <VolcanoPlot data={plotData} sets={sets} d={d} geneSetParsed={geneSetParsed} geneSetColor={geneSetColor||"#7C3AED"} legVis={legVis} legStyle={legStyle} legPos={legPos} setLegPos={setLegPos} labeled={labeled} setLabeled={setLabeled}/>
                </ErrorBoundary>
                </TC.Provider>
                <div style={{marginTop:6,fontSize:11,color:C.muted,textAlign:"center"}}>{filled} rows · {sheets.length} sheet{sheets.length!==1?"s":""} · Ctrl+S to save</div>
                {layout==="plot"&&<div style={{marginTop:10,textAlign:"center"}}><button onClick={()=>setLayout("sheet")} style={{padding:"5px 14px",borderRadius:6,fontSize:12,cursor:"pointer",background:"transparent",border:"1px solid "+C.border,color:C.muted}}>Back to data</button></div>}
              </div>
            )}
          </div>
          <div style={{width:242,background:C.panel,borderLeft:"1px solid "+C.border,display:"flex",flexDirection:"column",flexShrink:0}}>
            <div style={{display:"flex",borderBottom:"1px solid "+C.border,background:C.panel2}}>
              {TABS.map(tab=>(
                <button key={tab.id} onClick={()=>setRtab(tab.id)} style={{flex:1,padding:"8px 2px 6px",fontSize:9,fontWeight:700,cursor:"pointer",border:"none",background:"transparent",color:rtab===tab.id?C.accent:C.muted,borderBottom:"2px solid "+(rtab===tab.id?C.accent:"transparent"),display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  <span style={{fontSize:14}}>{tab.icon}</span>{tab.label}
                </button>
              ))}
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"14px 12px"}}>
              {rtab==="labels"&&<LabelsPanel sets={sets} setSets={setSets} geneSet={geneSet||""} setGeneSet={setGeneSet} geneSetColor={geneSetColor||"#7C3AED"} setGeneSetColor={setGeneSetColor} gsCount={geneSetParsed.size} labeled={labeled} setLabeled={setLabeled} sigGenes={sigGenes}/>}
              {rtab==="plot"&&<PlotPanel d={d} set={setD}/>}
              {rtab==="axes"&&<AxesPanel d={d} set={setD} sets={sets} setSets={setSets}/>}
              {rtab==="legend"&&<LegendPanel legVis={legVis} setLegVis={setLegVis} legStyle={legStyle} setLegStyle={setLegStyle} legPos={legPos} setLegPos={setLegPos} MT={MT}/>}
              {rtab==="export"&&<ExportPanel plotRef={plotRef} d={d} rows={rows}/>}
            </div>
            <div style={{padding:"6px 12px",borderTop:"1px solid "+C.border,fontSize:10,color:C.muted,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span>{filled} rows</span>
              <span style={{color:sigGenes.length>0?C.accent:C.muted}}>{sigGenes.length} sig genes</span>
              <span>Ctrl+S</span>
            </div>
          </div>
        </div>
      </div>
  );
}
