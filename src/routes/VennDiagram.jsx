import React, { useState, useMemo, useRef, useCallback, useEffect, useContext } from "react";
import { readProjectText } from "../shared/projectFile";
import { loadXLSX, XLSX_FAIL_MSG } from "../shared/loadXLSX";
import { encodeCanvas } from "../shared/exportUtils";
import { ThemeCtx as TC, useTheme, LIGHT } from "../shared/theme";
import CloudProjects from "../shared/CloudProjects";

// ═══════════════════════════════════════════════════════════════════════════════
//  Omilytix — Venn / UpSet Diagram
//  2-3 sets: classic circle Venn (standard schematic layout, not area-proportional
//    — matching convention used by most published circle Venns since exact
//    proportional layouts beyond 2 sets are a separate, much harder problem).
//  4+ sets: automatically switches to an UpSet plot. This is a deliberate choice,
//    not a limitation: Lex et al. 2014 (the UpSet paper) and subsequent field
//    practice recommend UpSet over Venn/Euler diagrams beyond ~3 sets, since
//    circle/ellipse Venns become combinatorially unreadable and often
//    geometrically misleading past that point. Manual override available.
//
//  Set arithmetic (bitmask region computation) verified independently before
//  integration — see build notes.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Themes (consistent with the rest of the suite) ──────────────────────────────
const useC = () => useContext(TC);

// ─── Inline SVG icons (no emoji) ─────────────────────────────────────────────────
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

// ─── Categorical palette (used for set colors in both Venn and UpSet) ───────────
const SET_PALETTE = ["#2563EB","#DC2626","#16A34A","#D97706","#7C3AED","#0891B2","#DB2777","#65A30D"];

// ─── Defaults ───────────────────────────────────────────────────────────────────
const DEF_D = {
  ff:"Inter", plotTitle:"",
  tsz:14, tbd:true, asz:11, ksz:10, labelsz:11,
  mode:"auto",          // auto | venn | upset
  showCounts:true, showPercent:false,
  upsetSortBy:"size",   // size | degree
  upsetMinSize:1,
  upsetMaxBars:25,
  showMethodLine:true, method:"Set intersection",
};
const DEF_S = { excluded:[] };
const FONTS = ["Inter","Arial","Helvetica","Times New Roman","Georgia","Courier New"];
const MM_PRESETS = [
  {label:"89mm", desc:"Single col", w:89},
  {label:"120mm", desc:"1.5 col", w:120},
  {label:"183mm", desc:"Double col", w:183},
  {label:"247mm", desc:"Full page", w:247},
];

// ─── Example data ───────────────────────────────────────────────────────────────
const EXAMPLE_SETS = [
  { name:"TreatA_up", genes:"TP53,MYC,CDK1,CDK2,CCNB1,BAX,BCL2,EGFR,KRAS,STAT3" },
  { name:"TreatB_up", genes:"CDK1,CDK2,CCNB1,MAPK1,MAPK3,RAF1,STAT3,JAK1,IL6,FOXO1" },
  { name:"TreatC_up", genes:"BAX,BCL2,CASP3,CASP9,FAS,STAT3,IL6,TNF,NFKB1,PTGS2" },
];

// ─── Set arithmetic — bitmask region computation ─────────────────────────────────
// Verified independently before integration: total genes across all regions
// equals total unique genes across all input lists exactly once each; a gene
// present in all N sets lands in exactly the all-sets bitmask region.
// ─── Venn geometry ──────────────────────────────────────────────────────────
// Circles can only produce a correct Venn diagram up to 3 sets. Four and five
// sets require ellipses: the 4-set layout is the classical four-ellipse
// construction, and the 5-set one is Grünbaum's five congruent rotated
// ellipses. Both show every region exactly once — 15 regions for n=4, 31 for
// n=5. Beyond 5, no arrangement of ellipses can enclose all 63+ regions, so an
// UpSet plot is the honest choice rather than a diagram that silently omits
// intersections.
//
// Layouts are normalised to a unit square and scaled to the canvas.
const VENN_SHAPES = {
  1: [ {x:0.50, y:0.50, w:0.68, h:0.68, a:0} ],
  2: [ {x:0.38, y:0.50, w:0.62, h:0.62, a:0},
       {x:0.62, y:0.50, w:0.62, h:0.62, a:0} ],
  3: [ {x:0.40, y:0.42, w:0.60, h:0.60, a:0},
       {x:0.60, y:0.42, w:0.60, h:0.60, a:0},
       {x:0.50, y:0.60, w:0.60, h:0.60, a:0} ],
  4: [ {x:0.350, y:0.400, w:0.72, h:0.45, a:140},
       {x:0.450, y:0.500, w:0.72, h:0.45, a:140},
       {x:0.544, y:0.500, w:0.72, h:0.45, a:40},
       {x:0.644, y:0.400, w:0.72, h:0.45, a:40} ],
  5: [ {x:0.428, y:0.449, w:0.87, h:0.50, a:155},
       {x:0.469, y:0.543, w:0.87, h:0.50, a:82},
       {x:0.558, y:0.523, w:0.87, h:0.50, a:10},
       {x:0.578, y:0.432, w:0.87, h:0.50, a:118},
       {x:0.489, y:0.383, w:0.87, h:0.50, a:46} ],
};
const MAX_VENN_SETS = 5;

function vennEllipses(n, W, H) {
  const spec = VENN_SHAPES[n];
  if (!spec) return [];
  return spec.map((e,i)=>({
    cx: e.x*W, cy: e.y*H,
    rx: e.w*W/2, ry: e.h*H/2,
    rot: e.a,
    color: SET_PALETTE[i%SET_PALETTE.length],
  }));
}

function pointInEllipse(px, py, e) {
  const t = -e.rot*Math.PI/180;
  const dx = px-e.cx, dy = py-e.cy;
  const rxp =  dx*Math.cos(t) - dy*Math.sin(t);
  const ryp =  dx*Math.sin(t) + dy*Math.cos(t);
  return (rxp*rxp)/(e.rx*e.rx) + (ryp*ryp)/(e.ry*e.ry) <= 1;
}

// Where to put each region's count. Analytic positions only work for the
// hand-tuned 2- and 3-circle cases; with four or five ellipses many regions are
// thin crescents whose centroid falls outside the region itself. So the
// position is found numerically: rasterise the diagram, then for each region
// take the point furthest from any other region (a pole-of-inaccessibility
// approximation via a two-pass chamfer distance transform). This generalises to
// any shape set without per-layout tuning.
function computeVennLabelPositions(ellipses, W, H, step) {
  const s = step || 3;
  const cols = Math.max(1, Math.floor(W/s)), rows = Math.max(1, Math.floor(H/s));
  const mask = new Int32Array(cols*rows);
  for (let j=0;j<rows;j++) {
    const py = (j+0.5)*s;
    for (let i=0;i<cols;i++) {
      const px = (i+0.5)*s;
      let m = 0;
      for (let k=0;k<ellipses.length;k++) if (pointInEllipse(px,py,ellipses[k])) m |= (1<<k);
      mask[j*cols+i] = m;
    }
  }
  // Distance (in cells) from each cell to the nearest cell of a different mask.
  const INF = 1e9;
  const dist = new Float32Array(cols*rows);
  for (let j=0;j<rows;j++) for (let i=0;i<cols;i++) {
    const idx = j*cols+i, m = mask[idx];
    let edge = (i===0||j===0||i===cols-1||j===rows-1);
    if (!edge) {
      if (mask[idx-1]!==m || mask[idx+1]!==m || mask[idx-cols]!==m || mask[idx+cols]!==m) edge = true;
    }
    dist[idx] = edge ? 0 : INF;
  }
  const D1 = 1, D2 = 1.41421356;
  for (let j=0;j<rows;j++) for (let i=0;i<cols;i++) {
    const idx=j*cols+i; let d=dist[idx];
    if (j>0)            d=Math.min(d, dist[idx-cols]+D1);
    if (i>0)            d=Math.min(d, dist[idx-1]+D1);
    if (j>0&&i>0)       d=Math.min(d, dist[idx-cols-1]+D2);
    if (j>0&&i<cols-1)  d=Math.min(d, dist[idx-cols+1]+D2);
    dist[idx]=d;
  }
  for (let j=rows-1;j>=0;j--) for (let i=cols-1;i>=0;i--) {
    const idx=j*cols+i; let d=dist[idx];
    if (j<rows-1)           d=Math.min(d, dist[idx+cols]+D1);
    if (i<cols-1)           d=Math.min(d, dist[idx+1]+D1);
    if (j<rows-1&&i<cols-1) d=Math.min(d, dist[idx+cols+1]+D2);
    if (j<rows-1&&i>0)      d=Math.min(d, dist[idx+cols-1]+D2);
    dist[idx]=d;
  }
  const best = {};
  for (let j=0;j<rows;j++) for (let i=0;i<cols;i++) {
    const idx=j*cols+i, m=mask[idx];
    if (m===0) continue;
    const d=dist[idx];
    if (!best[m] || d>best[m].d) best[m] = {d, x:(i+0.5)*s, y:(j+0.5)*s};
  }
  const out = {};
  Object.keys(best).forEach(m=>{ out[m] = {x:best[m].x, y:best[m].y, room:best[m].d*s}; });
  return out;
}

// Set-name placement. The old rule ("push 22% further out than the set's own
// region") left names sitting on the lobe edge next to its count. Instead walk outward
// from the diagram centre through the set's own region until the point is
// outside every ellipse, then place the name just beyond it (anchored away
// from the diagram) and keep it inside the padded canvas.
function computeOuterSetLabels(ellipses, labelPos, W, H, names, fs, padX, padY) {
  const cx = W/2, cy = H/2, maxT = Math.hypot(W, H);
  return ellipses.map((e,i)=>{
    const own = labelPos[1<<i];
    let dx = (own ? own.x : e.cx) - cx, dy = (own ? own.y : e.cy) - cy;
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    let t = len;
    while (t < maxT && ellipses.some(E=>pointInEllipse(cx+dx*t, cy+dy*t, E))) t += 2;
    t += fs*0.6;
    let x = cx + dx*t, y = cy + dy*t;
    const anchor = Math.abs(dx) < 0.4 ? "middle" : dx > 0 ? "start" : "end";
    if (anchor === "middle") y += dy > 0 ? fs*0.9 : -fs*0.2; else y += fs*0.35;
    const w = String((names && names[i]) || "").length * fs * 0.6;
    const L = -padX + 4, R = W + padX - 4;
    if (anchor === "start") x = Math.min(x, R - w);
    else if (anchor === "end") x = Math.max(x, L + w);
    else x = Math.max(L + w/2, Math.min(R - w/2, x));
    y = Math.max(-padY + fs, Math.min(H + padY - 4, y));
    return { x, y, anchor };
  });
}

function computeRegions(namedLists) {
  const n = namedLists.length;
  const geneToMask = {};
  namedLists.forEach((l,i) => {
    l.geneSet.forEach(g => { geneToMask[g] = (geneToMask[g]||0) | (1<<i); });
  });
  const regions = {}; // mask -> [genes]
  Object.entries(geneToMask).forEach(([gene,mask]) => {
    if (!regions[mask]) regions[mask] = [];
    regions[mask].push(gene);
  });
  return regions; // does not include mask=0 (genes in no set — never generated)
}
function parseGeneList(text) {
  return text.split(/[\n,;\t\s]+/).map(g=>g.trim().toUpperCase()).filter(Boolean);
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

// ─── Sheet model ─────────────────────────────────────────────────────────────────
function mkSheet(name){
  return { id:Date.now()+Math.random(), name, lists: EXAMPLE_SETS.map(s=>({...s})), d:{...DEF_D}, sets:{...DEF_S, excluded:[]} };
}

// ─── Gene List Sheet (each set = one named textarea, up to 8 sets) ──────────────
function Sheet({lists, setLists}) {
  const C=useC();
  const MAX_SETS = 8;

  const addList = () => {
    if (lists.length>=MAX_SETS) return;
    const palette = SET_PALETTE;
    setLists(prev=>[...prev, { name:"Set "+(prev.length+1), genes:"" }]);
  };
  const removeList = (i) => setLists(prev=>prev.filter((_,idx)=>idx!==i));
  const renameList = (i, name) => setLists(prev=>prev.map((l,idx)=>idx===i?{...l,name}:l));
  const updateGenes = (i, genes) => setLists(prev=>prev.map((l,idx)=>idx===i?{...l,genes}:l));

  const counts = lists.map(l => new Set(parseGeneList(l.genes)).size);

  return (
    <div>
      <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:10, flexWrap:"wrap"}}>
        {/* "Load example data" lives in the toolbar above; it used to appear twice. */}
        <span style={{marginLeft:"auto", fontSize:11, color:C.muted, fontWeight:500}}>{lists.length} sets</span>
      </div>

      <div style={{fontSize:11, marginBottom:12, padding:"7px 10px", background:C.tag, borderRadius:6, color:C.tagText, border:"1px solid "+C.cBorder, lineHeight:1.5}}>
        Each set is a named gene list. Paste gene IDs one per line, or comma/space separated —
        duplicates and case are handled automatically. 2-3 sets render as a Venn diagram; 4+ sets
        automatically switch to an UpSet plot (the standard for readable many-set comparisons).
      </div>

      {lists.map((l,i)=>(
        <div key={i} style={{marginBottom:12, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden"}}>
          <div style={{display:"flex", alignItems:"center", gap:6, padding:"6px 8px", background:C.panel2, borderBottom:"1px solid "+C.border}}>
            <div style={{width:11, height:11, borderRadius:3, background:SET_PALETTE[i%SET_PALETTE.length], flexShrink:0}}/>
            <input value={l.name} onChange={e=>renameList(i,e.target.value)}
              style={{flex:1, fontSize:12, fontWeight:700, border:"none", background:"transparent", color:C.text, outline:"none"}}/>
            <span style={{fontSize:10, color:C.muted}}>{counts[i]} genes</span>
            {lists.length>2 && <button onClick={()=>removeList(i)} style={{border:"none", background:"transparent", cursor:"pointer", padding:2, display:"flex"}}><IconX size={10} color={C.muted}/></button>}
          </div>
          <textarea value={l.genes} onChange={e=>updateGenes(i,e.target.value)} rows={3}
            placeholder={"TP53\nMYC\nEGFR\n(one per line, or comma-separated)"}
            style={{width:"100%", boxSizing:"border-box", padding:"7px 9px", fontSize:11, border:"none", background:C.cBg, color:C.text, outline:"none", fontFamily:"monospace", resize:"vertical"}}/>
        </div>
      ))}

      {lists.length<MAX_SETS && (
        <button onClick={addList} style={{width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:5, padding:"9px 0", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", background:"transparent", border:"1px dashed "+C.border, color:C.muted}}>
          <IconPlus size={11}/> Add set{lists.length>=4?" (will use UpSet layout)":""}
        </button>
      )}
      {lists.length>=MAX_SETS && <div style={{fontSize:10, color:C.muted, textAlign:"center"}}>Maximum {MAX_SETS} sets</div>}
    </div>
  );
}

// ─── Style helper ────────────────────────────────────────────────────────────────
function gS(d, C) {
  const f = d.ff || "Inter";
  return {
    ff:f,
    ttl:{fontSize:d.tsz||14, fontWeight:d.tbd?"bold":"normal", color:C.text, fontFamily:f},
    ax:{fontSize:d.asz||11, fill:C.text, fontFamily:f},
    tk:{fontSize:d.ksz||10, fill:C.muted, fontFamily:f},
    label:{fontSize:d.labelsz||11, fill:C.text, fontFamily:f},
  };
}

// ─── Style Panel ─────────────────────────────────────────────────────────────────
// effectiveMode comes from the tool itself so the panel can never disagree with
// what is drawn (it used an old "Venn only up to 3 sets" rule while the plot
// draws Venns up to MAX_VENN_SETS).
function PlotPanel({d, set, nSets, effectiveMode}) {
  const C=useC();
  return (
    <div>
      <SLabel>Figure Title</SLabel>
      <input value={d.plotTitle||""} onChange={e=>set(s=>({...s,plotTitle:e.target.value}))} placeholder="e.g. DEG Overlap Across Treatments"
        style={{width:"100%", boxSizing:"border-box", padding:"6px 9px", fontSize:12, borderRadius:6, border:"1px solid "+C.border, background:C.cBg, color:C.text, outline:"none", marginBottom:10}}/>
      <Divider/>
      <SLabel>Diagram Type</SLabel>
      <div style={{display:"flex", gap:5, marginBottom:6}}>
        {[["auto","Auto"],["venn","Venn"],["upset","UpSet"]].map(([v,lb])=>(
          <Pill key={v} active={(d.mode||"auto")===v} onClick={()=>set(s=>({...s,mode:v}))}>{lb}</Pill>
        ))}
      </div>
      <div style={{padding:"7px 9px", borderRadius:6, background:C.panel2, border:"1px solid "+C.border, fontSize:10, color:C.muted, marginBottom:6}}>
        Currently showing: <span style={{color:C.text, fontWeight:700}}>{effectiveMode==="venn"?"Venn diagram":"UpSet plot"}</span>
      </div>
      {nSets>MAX_VENN_SETS && d.mode==="venn" && (
        <div style={{fontSize:9, color:C.warn, padding:"6px 9px", borderRadius:6, background:"rgba(217,119,6,0.08)", border:"1px solid rgba(217,119,6,0.2)", marginBottom:6, lineHeight:1.5}}>
          No arrangement of ellipses can show every intersection beyond {MAX_VENN_SETS} sets — showing UpSet instead, the standard for many-set comparisons (Lex et al. 2014).
        </div>
      )}
      <div style={{fontSize:9, color:C.muted, marginBottom:10, lineHeight:1.5}}>Auto: Venn for 2–{MAX_VENN_SETS} sets, UpSet beyond that. UpSet works for any number of sets and shows exact intersection sizes, sorted by size.</div>
      <Divider/>
      <SLabel>Labels</SLabel>
      <Toggle value={d.showCounts!==false} onChange={v=>set(s=>({...s,showCounts:v}))} label="Show counts"/>
      <Toggle value={d.showPercent||false} onChange={v=>set(s=>({...s,showPercent:v}))} label="Show percentages"/>
      {effectiveMode==="upset" && (
        <>
          <Divider/>
          <SLabel>UpSet Options</SLabel>
          <div style={{display:"flex", gap:5, marginBottom:6}}>
            {[["size","Sort by size"],["degree","Sort by degree"]].map(([v,lb])=>(
              <Pill key={v} active={(d.upsetSortBy||"size")===v} onClick={()=>set(s=>({...s,upsetSortBy:v}))}>{lb}</Pill>
            ))}
          </div>
          <Slider label="Minimum intersection size shown" value={d.upsetMinSize||1} min={1} max={20} step={1} onChange={v=>set(s=>({...s,upsetMinSize:v}))}/>
          <Slider label="Maximum bars shown" value={d.upsetMaxBars||25} min={5} max={50} step={1} onChange={v=>set(s=>({...s,upsetMaxBars:v}))}/>
        </>
      )}
      <Divider/>
      <SLabel>Method Annotation</SLabel>
      <Toggle value={d.showMethodLine!==false} onChange={v=>set(s=>({...s,showMethodLine:v}))} label="Show method line on figure"/>
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

// ─── Shared data processing ──────────────────────────────────────────────────────
function useProcessedSets(lists) {
  return useMemo(() => {
    const named = lists.filter(l => l.name && l.name.trim());
    const withGenes = named.map(l => ({ name: l.name, geneSet: new Set(parseGeneList(l.genes)) }));
    // Matching is case-insensitive (keys are upper-cased), but genes are shown
    // and exported the way the user first wrote them — upper-casing everything
    // turned mouse symbols like Gfap/Trem2 into GFAP/TREM2.
    const display = {};
    named.forEach(l => String(l.genes||"").split(/[\n,;\t\s]+/).forEach(tok => {
      const g = tok.trim(); if (!g) return;
      const k = g.toUpperCase(); if (!(k in display)) display[k] = g;
    }));
    const regions = computeRegions(withGenes);
    const setSizes = withGenes.map(l => l.geneSet.size);
    const n = withGenes.length;
    // All non-empty regions, each with its bitmask, member-set names, gene list, count
    const regionList = Object.entries(regions).map(([mask, genes]) => {
      const m = Number(mask);
      const memberSets = withGenes.map((l,i)=>({name:l.name, in: !!(m&(1<<i))}));
      const degree = memberSets.filter(s=>s.in).length;
      return { mask:m, genes: genes.map(g=>display[g]||g), count:genes.length, memberSets, degree };
    });
    const totalUnion = regionList.reduce((a,r)=>a+r.count,0);
    return { names: withGenes.map(l=>l.name), setSizes, regionList, totalUnion, n };
  }, [lists]);
}

// ─── Region Tooltip ───────────────────────────────────────────────────────────
function RegionTooltip({region, names, x, y, onClose, onMouseEnter, onMouseLeave, totalUnion}) {
  const visibleGenes = region.genes.slice(0,25);
  const more = region.genes.length - visibleGenes.length;
  const label = region.memberSets.filter(s=>s.in).map(s=>s.name).join(" ∩ ");
  const pct = totalUnion ? (region.count/totalUnion*100).toFixed(1) : "0";

  const download = () => {
    const csv = "gene\n"+region.genes.join("\n");
    downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}), label.replace(/[^a-zA-Z0-9]/g,"_").slice(0,50)+"_genes.csv"); /* blob download: data: URLs fail silently past ~2MB / in Firefox */
  };

  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{
      position:"absolute", left:x+14, top:Math.max(y-10,0), width:250, zIndex:300, pointerEvents:"all",
      background:"#fff", border:"1px solid #DDE1E7", borderRadius:10, boxShadow:"0 8px 32px rgba(0,0,0,.14)",
      fontFamily:"Inter,system-ui,sans-serif",
    }}>
      <div style={{padding:"10px 12px 7px", borderBottom:"1px solid #EEF0F4"}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:6}}>
          <div style={{flex:1, fontSize:12, fontWeight:700, color:"#1E2736", lineHeight:1.35}}>{label}</div>
          <button onClick={onClose} style={{flexShrink:0, width:18, height:18, borderRadius:9, border:"none", background:"#F0F2F5", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", padding:0}}><IconX size={8} color="#64748B"/></button>
        </div>
        <div style={{fontSize:10, color:"#64748B", marginTop:2}}>{region.count} genes ({pct}% of union)</div>
      </div>
      {region.genes.length>0 && (
        <div style={{padding:"7px 12px", borderBottom:"1px solid #EEF0F4", maxHeight:140, overflowY:"auto"}}>
          <div style={{display:"flex", flexWrap:"wrap", gap:"2px 4px"}}>
            {visibleGenes.map(g=>(
              <span key={g} style={{fontSize:9, fontStyle:"italic", color:"#1D4ED8", background:"#EFF6FF", borderRadius:4, padding:"1px 5px", fontWeight:500}}>{g}</span>
            ))}
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

// ─── Venn Diagram (2-set and 3-set, standard schematic layout) ──────────────────
// Not area-proportional — this is the widely-used convention for published circle
// Venns (exact area-proportional layouts require specialized ellipse fitting and
// are a separate, harder problem; most journal figures use this schematic form).
// Canvas grows with set count: the 4- and 5-ellipse layouts pack many more
// regions into the same footprint, and cramped crescents need the extra room.
function vennCanvasSize(n) {
  if (n <= 3) return {W:520, H:460};
  if (n === 4) return {W:620, H:560};
  return {W:760, H:700};
}

function VennDiagram({names, setSizes, regionList, d, svgRef, totalUnion}) {
  const C = useC();
  const st = gS(d, C);
  const ff = st.ff;
  const [hov, setHov] = useState(null);
  const containerRef = useRef(null);
  const hovTimer = useRef(null);
  const showHov = useCallback((data)=>{ clearTimeout(hovTimer.current); setHov(data); },[]);
  const hideHov = useCallback(()=>{ hovTimer.current=setTimeout(()=>setHov(null),160); },[]);
  const keepHov = useCallback(()=>{ clearTimeout(hovTimer.current); },[]);

  const n = Math.min(names.length, MAX_VENN_SETS);
  const base = vennCanvasSize(n);
  const scale = (d.vennScale||1);
  const W = Math.round(base.W*scale), H = Math.round(base.H*scale);

  const ellipses = useMemo(()=>vennEllipses(n, W, H), [n, W, H]);
  // Label placement is a raster pass, so it is memoised on geometry only —
  // changing counts or colours must not re-run it.
  const labelPos = useMemo(()=>computeVennLabelPositions(ellipses, W, H, 3), [ellipses, W, H]);
  // A margin around the ellipses lets every set name sit outside its lobe.
  const nameFs = st.label.fontSize+1;
  const maxNameW = Math.max(0, ...names.slice(0,n).map(nm=>String(nm).length*nameFs*0.6));
  // (2 sets put the names straight out to the sides, so they need the full width.)
  const PADX = Math.round(n===2 ? Math.min(200, maxNameW+16) : Math.min(170, maxNameW*0.75+12));
  const PADY = Math.round(nameFs*2+8);
  const setLabelPos = useMemo(()=>computeOuterSetLabels(ellipses, labelPos, W, H, names.slice(0,n), nameFs, PADX, PADY),
    [ellipses, labelPos, W, H, n, names, nameFs, PADX, PADY]);
  const SW = W + 2*PADX, SH = H + 2*PADY;

  const regionByMask = {}; regionList.forEach(r=>{ regionByMask[r.mask]=r; });
  const extraH = (d.showMethodLine!==false?18:0)+(d.plotTitle?26:0);
  const titleOff = d.plotTitle?20:0;
  // Method line sits just under the lowest lobe (+ its set name) instead of at
  // the canvas floor, which left a band of empty space above it.
  const lowest = ellipses.reduce((m,e)=>{ const t=e.rot*Math.PI/180; return Math.max(m, e.cy+Math.sqrt(Math.pow(e.rx*Math.sin(t),2)+Math.pow(e.ry*Math.cos(t),2))); }, 0);
  const methodY = Math.min(SH+extraH-6, (d.plotTitle?20:0) + PADY + Math.max(lowest, ...setLabelPos.map(p=>p.y)) + nameFs + 10);

  const countSize = st.ax.fontSize+2;
  const pctSize = st.tk.fontSize;

  return (
    <div ref={containerRef} style={{position:"relative", display:"inline-block"}}>
    <svg ref={svgRef} width={SW} height={SH+extraH} viewBox={"0 0 "+SW+" "+(SH+extraH)} style={{display:"block", maxWidth:"100%", overflow:"visible"}}>
      {d.plotTitle && <text x={SW/2} y={18} textAnchor="middle" fontSize={st.ttl.fontSize} fontWeight={st.ttl.fontWeight} fill={C.text} fontFamily={ff}>{d.plotTitle}</text>}
      <g transform={"translate("+PADX+","+(titleOff+PADY)+")"}>
        {ellipses.map((e,i)=>(
          <ellipse key={i} cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry}
            transform={"rotate("+e.rot+" "+e.cx+" "+e.cy+")"}
            fill={(d.setColors&&d.setColors[i])||e.color} fillOpacity={d.fillOpacity!==undefined?d.fillOpacity:0.32}
            stroke={(d.setColors&&d.setColors[i])||e.color} strokeWidth={d.strokeW||1.5}/>
        ))}
        {names.slice(0,n).map((name,i)=>(
          <text key={"nl"+i} x={setLabelPos[i].x} y={setLabelPos[i].y} textAnchor={setLabelPos[i].anchor||"middle"}
            fontSize={st.label.fontSize+1} fontWeight="700"
            fill={(d.setColors&&d.setColors[i])||SET_PALETTE[i%SET_PALETTE.length]} fontFamily={ff}>{name}</text>
        ))}
        {Object.keys(labelPos).map(maskKey=>{
          const mask = Number(maskKey);
          const pos = labelPos[maskKey];
          const region = regionByMask[mask];
          const count = region ? region.count : 0;
          if (count===0 && d.hideEmpty) return null;
          const pct = totalUnion ? (count/totalUnion*100).toFixed(1) : "0";
          // Thin crescents in the 4/5-set layouts can't hold full-size type, so
          // the count shrinks to fit rather than spilling into a neighbour.
          const room = pos.room||99;
          const fit = Math.max(0.55, Math.min(1, room/(countSize*0.95)));
          const cs = Math.max(6, countSize*fit), ps = Math.max(5, pctSize*fit);
          return (
            <g key={maskKey}
              onMouseEnter={e=>{ if(!region) return; const rect=containerRef.current.getBoundingClientRect(); showHov({region, x:e.clientX-rect.left, y:e.clientY-rect.top}); }}
              onMouseLeave={hideHov} style={{cursor:region?"pointer":"default"}}>
              <circle cx={pos.x} cy={pos.y} r={Math.max(8, Math.min(24, room))} fill="transparent"/>
              {d.showCounts!==false && (
                <text x={pos.x} y={pos.y-(d.showPercent?ps*0.5:0)} textAnchor="middle" fontSize={cs} fontWeight="700" fill={C.text} fontFamily={ff}>{count}</text>
              )}
              {d.showPercent && (
                <text x={pos.x} y={pos.y+(d.showCounts!==false?cs*0.85:0)} textAnchor="middle" fontSize={ps} fill={C.muted} fontFamily={ff}>{pct}%</text>
              )}
            </g>
          );
        })}
      </g>
      {d.showMethodLine!==false && (
        <text x={10} y={methodY} fontSize={8} fill={C.muted} fontFamily={ff} fontStyle="italic">{(d.method||"Set intersection")+" | "+totalUnion+" genes in union"}</text>
      )}
    </svg>
    {hov && <RegionTooltip region={hov.region} names={names} x={hov.x} y={hov.y} onClose={()=>setHov(null)} onMouseEnter={keepHov} onMouseLeave={hideHov} totalUnion={totalUnion}/>}
    </div>
  );
}

// ─── UpSet Plot ─────────────────────────────────────────────────────────────────
// Standard layout: sorted bar chart of intersection sizes on top, dot-connector
// matrix below showing which sets compose each bar, set-size bars on the left.
function UpSetPlot({names, setSizes, regionList, d, svgRef, totalUnion}) {
  const C = useC();
  const st = gS(d, C);
  const ff = st.ff;
  const [hov, setHov] = useState(null);
  const containerRef = useRef(null);
  const hovTimer = useRef(null);
  const showHov = useCallback((data)=>{ clearTimeout(hovTimer.current); setHov(data); },[]);
  const hideHov = useCallback(()=>{ hovTimer.current=setTimeout(()=>setHov(null),160); },[]);
  const keepHov = useCallback(()=>{ clearTimeout(hovTimer.current); },[]);

  const n = names.length;
  const minSize = d.upsetMinSize||1;
  const maxBars = d.upsetMaxBars||25;
  const sortBy = d.upsetSortBy||"size";

  let bars = regionList.filter(r => r.count >= minSize);
  bars = bars.sort((a,b) => sortBy==="degree" ? (b.degree-a.degree)||(b.count-a.count) : b.count-a.count);
  bars = bars.slice(0, maxBars);

  const BARW = 26, BARGAP = 8;
  const MATRIXROWH = 22;
  // Left block, laid out left-to-right: set-size numbers | set-size bars |
  // set names | matrix. Names and bars used to share one anchor (ML-14) and
  // overprint each other, with a fixed 130px margin regardless of name length.
  const nameFs = st.label.fontSize;
  const nameW = Math.max(40, ...names.map(nm=>String(nm).length*nameFs*0.6)) + 6;
  const NUMW = 30, setBarsW = 80;
  const barRight = 8 + NUMW + setBarsW;
  const nameX = barRight + 8;
  const ML = nameX + nameW + 12;
  const MT = 30 + (d.plotTitle?24:0);
  const chartH = 200;
  const matrixH = n*MATRIXROWH + 14;
  const PW = bars.length*(BARW+BARGAP);
  const MR = 20;
  const W = ML + PW + MR;
  const H = MT + chartH + matrixH + (d.showMethodLine!==false?24:14);

  const maxCount = bars.length ? Math.max(...bars.map(b=>b.count)) : 1;
  // Round-number axis (e.g. 0/50/100/150) instead of quarters of the max.
  const rawStep = maxCount/4, mag = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep,1e-9))));
  const yStep = [1,2,2.5,5,10].map(m=>m*mag).find(v=>v>=rawStep) || 10*mag;
  const yTop = Math.max(yStep, Math.ceil(maxCount/yStep)*yStep);
  const yTicks = []; for (let v=0; v<=yTop+1e-9; v+=yStep) yTicks.push(+v.toFixed(6));
  const by = c => MT + chartH - (c/yTop)*chartH;
  const bx = i => ML + i*(BARW+BARGAP);

  const maxSetSize = Math.max(...setSizes, 1);
  const sbx = s => (setBarsW) * (s/maxSetSize);

  const matrixTop = MT + chartH + 14;
  const rowY = ri => matrixTop + ri*MATRIXROWH + MATRIXROWH/2;

  const extraH = 0;

  return (
    <div ref={containerRef} style={{position:"relative", display:"inline-block"}}>
    <svg ref={svgRef} width={W} height={H} viewBox={"0 0 "+W+" "+H} style={{display:"block", maxWidth:"100%", overflow:"visible"}}>
      {d.plotTitle && <text x={W/2} y={18} textAnchor="middle" fontSize={st.ttl.fontSize} fontWeight={st.ttl.fontWeight} fill={C.text} fontFamily={ff}>{d.plotTitle}</text>}

      {/* Y axis grid + ticks for bar chart */}
      {yTicks.map((v,i)=>(
        <line key={i} x1={ML} y1={by(v)} x2={ML+PW} y2={by(v)} stroke={C.grid} strokeWidth={0.5} strokeDasharray="3 3"/>
      ))}
      {yTicks.map((v,i)=>(
        <text key={"t"+i} x={ML-8} y={by(v)+3} textAnchor="end" fontSize={st.tk.fontSize} fill={C.muted} fontFamily={ff}>{v}</text>
      ))}
      <line x1={ML} y1={MT+chartH} x2={ML+PW} y2={MT+chartH} stroke={C.text} strokeWidth={1}/>
      <line x1={ML} y1={MT} x2={ML} y2={MT+chartH} stroke={C.text} strokeWidth={1}/>
      <text x={ML-38} y={MT+chartH/2} textAnchor="middle" fontSize={st.ax.fontSize} fill={C.text} fontFamily={ff} transform={"rotate(-90,"+(ML-38)+","+(MT+chartH/2)+")"}>Intersection size</text>

      {/* Bars */}
      {bars.map((r,i)=>(
        <g key={"bar"+i}
          onMouseEnter={e=>{const rect=containerRef.current.getBoundingClientRect(); showHov({region:r, x:e.clientX-rect.left, y:e.clientY-rect.top});}}
          onMouseLeave={hideHov} style={{cursor:"pointer"}}>
          <rect x={bx(i)} y={by(r.count)} width={BARW} height={MT+chartH-by(r.count)} fill={r.degree===1?SET_PALETTE[names.indexOf(r.memberSets.find(s=>s.in).name)%SET_PALETTE.length]:C.text} fillOpacity={r.degree===1?0.85:0.75}/>
          {d.showCounts!==false && <text x={bx(i)+BARW/2} y={by(r.count)-4} textAnchor="middle" fontSize={8.5} fill={C.text} fontFamily={ff}>{r.count}</text>}
        </g>
      ))}

      {/* Set size bars (left of matrix) */}
      {names.map((name,ri)=>(
        <g key={"sb"+ri}>
          <rect x={barRight-sbx(setSizes[ri])} y={rowY(ri)-7} width={sbx(setSizes[ri])} height={14} fill={SET_PALETTE[ri%SET_PALETTE.length]} fillOpacity={0.75}/>
          <text x={barRight-sbx(setSizes[ri])-4} y={rowY(ri)+3} textAnchor="end" fontSize={8.5} fill={C.muted} fontFamily={ff}>{setSizes[ri]}</text>
        </g>
      ))}

      {/* Set name labels */}
      {names.map((name,ri)=>(
        <text key={"sn"+ri} x={nameX} y={rowY(ri)+3} textAnchor="start" fontSize={st.label.fontSize} fontWeight="600" fill={C.text} fontFamily={ff}>{name}</text>
      ))}

      {/* Matrix background row stripes */}
      {names.map((name,ri)=>(
        <rect key={"strip"+ri} x={ML} y={rowY(ri)-MATRIXROWH/2} width={PW} height={MATRIXROWH} fill={ri%2===0?C.panel2:"transparent"} opacity={0.5}/>
      ))}

      {/* Matrix dots + connector lines */}
      {bars.map((r,ci)=>{
        const activeRows = names.map((_,ri)=>r.memberSets[ri].in);
        const activeIdxs = activeRows.map((v,i)=>v?i:-1).filter(i=>i>=0);
        const yTop = activeIdxs.length ? rowY(Math.min(...activeIdxs)) : 0;
        const yBot = activeIdxs.length ? rowY(Math.max(...activeIdxs)) : 0;
        return (
          <g key={"mx"+ci}>
            {activeIdxs.length>1 && <line x1={bx(ci)+BARW/2} y1={yTop} x2={bx(ci)+BARW/2} y2={yBot} stroke={C.text} strokeWidth={2}/>}
            {names.map((_,ri)=>(
              <circle key={ri} cx={bx(ci)+BARW/2} cy={rowY(ri)} r={r.memberSets[ri].in?6:3}
                fill={r.memberSets[ri].in?C.text:C.border}/>
            ))}
          </g>
        );
      })}

      {d.showMethodLine!==false && (
        <text x={ML} y={H-6} fontSize={8} fill={C.muted} fontFamily={ff} fontStyle="italic">{(d.method||"Set intersection")+" | "+totalUnion+" genes in union"+(bars.length<regionList.filter(r=>r.count>=minSize).length?" | showing top "+bars.length:"")}</text>
      )}
    </svg>
    {hov && <RegionTooltip region={hov.region} names={names} x={hov.x} y={hov.y} onClose={()=>setHov(null)} onMouseEnter={keepHov} onMouseLeave={hideHov} totalUnion={totalUnion}/>}
    </div>
  );
}

// ─── Export Panel ─────────────────────────────────────────────────────────────
// ─── File import ────────────────────────────────────────────────────────────
// Gene lists arrive two ways in practice: one column per set (wide) or a
// gene/set pair per row (long). Both are detected and previewed before import.

function splitDelimLine(line, delim) {
  const out=[]; let cur="", inQ=false;
  for (let i=0;i<line.length;i++) {
    const ch=line[i];
    if (inQ) { if (ch==='"') { if (line[i+1]==='"') { cur+='"'; i++; } else inQ=false; } else cur+=ch; }
    else if (ch==='"') inQ=true;
    else if (ch===delim) { out.push(cur); cur=""; }
    else cur+=ch;
  }
  out.push(cur);
  return out;
}
function sniffDelimiter(lines) {
  const cands=["\t",",",";","|"];
  let best="\t", bestScore=0;
  cands.forEach(d=>{
    const freq={};
    lines.forEach(l=>{ const n=splitDelimLine(l,d).length; if(n>1) freq[n]=(freq[n]||0)+1; });
    let modeCount=0, modeAgree=0;
    Object.keys(freq).forEach(k=>{ const n=freq[k];
      if (n>modeAgree || (n===modeAgree && Number(k)>modeCount)) { modeAgree=n; modeCount=Number(k); } });
    const score=modeAgree*(modeCount-1);
    if (score>bestScore) { bestScore=score; best=d; }
  });
  return bestScore>0 ? best : null;   // null = single column, treat as one list
}
function parseDelimitedText(text) {
  const clean=text.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  const raw=clean.split("\n").filter(l=>l.trim()!=="");
  if (!raw.length) return {rows:[], delim:null};
  const delim=sniffDelimiter(raw.slice(0,20));
  if (!delim) return {rows:raw.map(l=>[l.trim()]), delim:null};
  return {rows:raw.map(l=>splitDelimLine(l,delim).map(c=>c.trim())), delim};
}

// Long format is two columns where one side repeats heavily — that repeating
// column is the set label. Guessing wrong would silently build the wrong sets,
// so the result is always shown for confirmation.
function detectLayout(rows) {
  if (!rows.length) return {layout:"wide", hasHeader:false};
  const width = Math.max.apply(null, rows.map(r=>r.length));
  if (width === 1) return {layout:"wide", hasHeader:false};
  if (width === 2) {
    const body = rows.slice(1);
    if (body.length >= 4) {
      const colA = new Set(body.map(r=>r[0])), colB = new Set(body.map(r=>r[1]));
      if (colB.size <= Math.max(2, body.length/3) && colB.size < colA.size) return {layout:"long", geneCol:0, setCol:1, hasHeader:true};
      if (colA.size <= Math.max(2, body.length/3) && colA.size < colB.size) return {layout:"long", geneCol:1, setCol:0, hasHeader:true};
    }
  }
  return {layout:"wide", hasHeader:true};
}

function buildSetsFromRows(rows, cfg) {
  const out = [];
  if (cfg.layout === "long") {
    const body = cfg.hasHeader ? rows.slice(1) : rows;
    const bySet = {};
    body.forEach(r=>{
      const g=(r[cfg.geneCol]||"").trim(), s=(r[cfg.setCol]||"").trim();
      if (!g||!s) return;
      if (!bySet[s]) bySet[s]=[];
      bySet[s].push(g);
    });
    Object.keys(bySet).forEach(name=>out.push({name, genes:bySet[name].join("\n")}));
  } else {
    const width = Math.max.apply(null, rows.map(r=>r.length));
    const header = cfg.hasHeader ? rows[0] : null;
    const body = cfg.hasHeader ? rows.slice(1) : rows;
    for (let c=0;c<width;c++) {
      const genes=[];
      body.forEach(r=>{ const g=(r[c]||"").trim(); if(g) genes.push(g); });
      if (!genes.length) continue;
      const nm = header && (header[c]||"").trim() ? header[c].trim() : "Set "+(out.length+1);
      out.push({name:nm, genes:genes.join("\n")});
    }
  }
  return out;
}

function VennFileImport({onImport, onClose, maxSets}) {
  const C=useC();
  const [drag,setDrag]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  const [parsed,setParsed]=useState(null);
  const [cfg,setCfg]=useState({layout:"wide", hasHeader:true, geneCol:0, setCol:1});
  const fileRef=useRef(null);

  const ingest=(rows,delim,fileName,extra)=>{
    if (!rows.length) { setError("That file didn't contain any readable rows."); return; }
    setParsed({rows, delim, fileName, ...(extra||{})});
    setCfg(c=>({...c, ...detectLayout(rows)}));
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
        const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});
        const first=wb.SheetNames[0];
        const rows=XLSX.utils.sheet_to_json(wb.Sheets[first],{header:1,blankrows:false,raw:true})
                    .map(r=>r.map(c=>c===undefined||c===null?"":String(c)));
        ingest(rows,"\t",file.name,{sheetNames:wb.SheetNames, activeSheet:first, workbook:wb, XLSX});
      } else {
        const {rows,delim}=parseDelimitedText(await file.text());
        ingest(rows,delim,file.name);
      }
    } catch(err) { setError("Couldn't read that file: "+((err&&err.message)||"unknown error")); }
    setBusy(false);
  };

  const switchSheet = name => {
    if (!parsed||!parsed.workbook) return;
    const rows=parsed.XLSX.utils.sheet_to_json(parsed.workbook.Sheets[name],{header:1,blankrows:false,raw:true})
                .map(r=>r.map(c=>c===undefined||c===null?"":String(c)));
    setParsed(p=>({...p, rows, activeSheet:name}));
    setCfg(c=>({...c, ...detectLayout(rows)}));
  };

  const built = useMemo(()=>{
    if (!parsed) return null;
    const sets = buildSetsFromRows(parsed.rows, cfg);
    const sizes = sets.map(s=>new Set(s.genes.split("\n").map(g=>g.trim().toUpperCase()).filter(Boolean)).size);
    return {sets, sizes};
  },[parsed, cfg]);

  const doImport = () => {
    if (!built) return;
    const warnings=[];
    let sets = built.sets;
    if (sets.length > maxSets) {
      warnings.push("File contained "+sets.length+" sets; the first "+maxSets+" were imported.");
      sets = sets.slice(0, maxSets);
    }
    const empty = sets.filter(s=>!s.genes.trim()).length;
    if (empty) warnings.push(empty+" set(s) had no genes.");
    if (sets.length > MAX_VENN_SETS) warnings.push("With more than "+MAX_VENN_SETS+" sets the view switches to UpSet — no arrangement of ellipses can show every intersection beyond "+MAX_VENN_SETS+" sets.");
    onImport(sets, warnings);
  };

  if (!parsed) {
    return (
      <div style={{border:"1px solid "+C.border, borderRadius:8, background:C.panel2, padding:14, marginBottom:12}}>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
          <span style={{fontSize:12, fontWeight:700, color:C.text}}>Import gene lists</span>
          <button onClick={onClose} style={{background:"transparent", border:"none", cursor:"pointer", fontSize:15, color:C.muted}}>×</button>
        </div>
        <div
          onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)}
          onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)readFile(f);}}
          onClick={()=>fileRef.current&&fileRef.current.click()}
          style={{border:"2px dashed "+(drag?C.accent:C.cBorder), borderRadius:8, padding:"26px 16px", textAlign:"center", cursor:"pointer", background:drag?C.cSel:C.cBg}}>
          <div style={{fontSize:12, fontWeight:600, color:C.text, marginBottom:3}}>{busy?"Reading…":"Drop a file here, or click to browse"}</div>
          <div style={{fontSize:10.5, color:C.muted}}>One column per set, or a gene/set pair per row · CSV, TSV, TXT, XLSX</div>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.tab,.xlsx,.xlsm,.xls" style={{display:"none"}}
          onChange={e=>{const f=e.target.files[0];if(f)readFile(f);e.target.value="";}}/>
        {error&&<div style={{marginTop:9, fontSize:11, lineHeight:1.6, padding:"8px 10px", borderRadius:6, background:"#FEE2E2", color:"#991B1B", border:"1px solid #FCA5A5"}}>{error}</div>}
      </div>
    );
  }

  const preview=parsed.rows.slice(0,5);
  const pcols=Math.min(Math.max.apply(null, preview.map(r=>r.length)), 6);
  const importable=built.sets.length>=1;

  return (
    <div style={{border:"1px solid "+C.border, borderRadius:8, background:C.panel2, padding:14, marginBottom:12}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
        <span style={{fontSize:12, fontWeight:700, color:C.text}}>{parsed.fileName}</span>
        <button onClick={onClose} style={{background:"transparent", border:"none", cursor:"pointer", fontSize:15, color:C.muted}}>×</button>
      </div>
      <div style={{fontSize:10.5, color:C.muted, marginBottom:9}}>
        {parsed.rows.length} rows · will import <strong style={{color:C.text}}>{built.sets.length} set{built.sets.length!==1?"s":""}</strong>
      </div>

      {parsed.sheetNames&&parsed.sheetNames.length>1&&(
        <div style={{marginBottom:9, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap"}}>
          <span style={{fontSize:10.5, color:C.muted}}>Worksheet:</span>
          {parsed.sheetNames.map(nm=>(
            <button key={nm} onClick={()=>switchSheet(nm)}
              style={{padding:"3px 9px", borderRadius:5, fontSize:10.5, cursor:"pointer", border:"1px solid "+(nm===parsed.activeSheet?C.accent:C.border), background:nm===parsed.activeSheet?C.accent:"transparent", color:nm===parsed.activeSheet?"#fff":C.muted}}>{nm}</button>
          ))}
        </div>
      )}

      <div style={{border:"1px solid "+C.cBorder, borderRadius:6, overflow:"auto", maxHeight:110, marginBottom:10, background:C.cBg}}>
        <table style={{borderCollapse:"collapse", fontSize:10.5, width:"max-content", minWidth:"100%"}}>
          <tbody>
            {preview.map((row,ri)=>(
              <tr key={ri} style={{background:(cfg.hasHeader&&ri===0)?C.cSel:"transparent"}}>
                <td style={{padding:"3px 7px", color:C.muted, borderRight:"1px solid "+C.cBorder, borderBottom:"1px solid "+C.cBorder, fontSize:10}}>{cfg.hasHeader&&ri===0?"names":ri+1}</td>
                {Array.from({length:pcols}).map((_,ci)=>(
                  <td key={ci} style={{padding:"3px 8px", borderRight:"1px solid "+C.cBorder, borderBottom:"1px solid "+C.cBorder, whiteSpace:"nowrap", maxWidth:100, overflow:"hidden", textOverflow:"ellipsis", color:C.text, fontWeight:(cfg.hasHeader&&ri===0)?600:400}}>
                    {row[ci]!==undefined?row[ci]:""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{display:"flex", gap:5, marginBottom:8}}>
        {[["wide","One column per set"],["long","Gene + set columns"]].map(([id,lb])=>(
          <button key={id} onClick={()=>setCfg(c=>({...c,layout:id}))}
            style={{flex:1, padding:"5px 4px", borderRadius:6, fontSize:10.5, cursor:"pointer", color:C.text,
              background:cfg.layout===id?C.cSel:"transparent", border:"1.5px solid "+(cfg.layout===id?C.accent:C.border)}}>{lb}</button>
        ))}
      </div>
      <Toggle value={cfg.hasHeader} onChange={v=>setCfg(c=>({...c,hasHeader:v}))} label="First row holds set names"/>

      <div style={{fontSize:11, lineHeight:1.55, padding:"8px 10px", borderRadius:6, margin:"8px 0", background:C.tag, color:C.tagText, border:"1px solid "+C.cBorder}}>
        {built.sets.length ? built.sets.slice(0,6).map((s,i)=>s.name+" ("+built.sizes[i]+")").join(" · ") : "No sets found — try the other layout."}
        {built.sets.length>6 && " · +"+(built.sets.length-6)+" more"}
      </div>
      {built.sets.length>MAX_VENN_SETS && (
        <div style={{fontSize:11, lineHeight:1.55, padding:"8px 10px", borderRadius:6, marginBottom:8, background:"#FEF3C7", color:"#92400E", border:"1px solid #FDE68A"}}>
          {built.sets.length} sets will render as an UpSet plot. A true Venn diagram is only possible up to {MAX_VENN_SETS} sets.
        </div>
      )}

      <div style={{display:"flex", gap:6}}>
        <button onClick={doImport} disabled={!importable}
          style={{flex:1, padding:"8px 0", borderRadius:7, fontSize:12, fontWeight:700, cursor:importable?"pointer":"default", background:importable?C.accent:C.border, border:"none", color:"#fff"}}>
          {importable ? "Import "+Math.min(built.sets.length,maxSets)+" sets" : "Nothing to import"}
        </button>
        <button onClick={()=>{setParsed(null);setError(null);}}
          style={{padding:"8px 16px", borderRadius:7, fontSize:12, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>
          Another file
        </button>
      </div>
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


// Crop the export to what is actually drawn (plus a small pad).
function tightViewBox(svgEl, fallbackW, fallbackH, pad) {
  const full = {x:0, y:0, w:fallbackW, h:fallbackH};
  if (!svgEl || typeof svgEl.getBBox !== "function") return full;
  try {
    const bb = svgEl.getBBox();
    if (!bb || !(bb.width > 1) || !(bb.height > 1)) return full;
    return {x: bb.x-pad, y: bb.y-pad, w: bb.width+pad*2, h: bb.height+pad*2};
  } catch (_) { return full; }
}

function ExportPanel({svgRef, regionList, names}) {
  const C = useC();
  const [fmt, setFmt] = useState("png");
  const [dpi, setDpi] = useState(300);
  const [useSize, setUseSize] = useState(false);
  const [mmPreset, setMmPreset] = useState(120);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);
  const [trim, setTrim] = useState(true);

  const FMTS = [
    {id:"png",l:"PNG",sub:"Best for most journals"},
    {id:"jpeg",l:"JPEG",sub:"Smaller file size"},
    {id:"tiff",l:"TIFF",sub:"True TIFF with DPI metadata"},
    {id:"svg",l:"SVG",sub:"Vector, infinitely scalable"},
    {id:"csv",l:"CSV",sub:"Download all region gene lists"},
  ];

  const svgEl0 = svgRef && svgRef.current;
  const vb = svgEl0 ? (svgEl0.getAttribute("viewBox")||"0 0 520 460").split(" ").map(Number) : [0,0,520,460];
  const box0 = trim && svgEl0 ? tightViewBox(svgEl0, vb[2], vb[3], 8) : {w:vb[2], h:vb[3]};
  const nativeW = box0.w, nativeH = box0.h;
  const mmW = mmPreset, mmH = Math.round(mmPreset * (nativeH/nativeW));
  const pxFromMM = mm => Math.round(mm/25.4*dpi);
  const prevW = useSize ? pxFromMM(mmW) : Math.round(nativeW*dpi/96);
  const prevH = useSize ? pxFromMM(mmH) : Math.round(nativeH*dpi/96);

  const doExportCSV = () => {
    if (!regionList.length) return;
    const header = "region,degree,count,genes";
    const lines = regionList.map(r => {
      const label = r.memberSets.filter(s=>s.in).map(s=>s.name).join(" & ");
      return [label, r.degree, r.count, r.genes.join(";")].map(v=>String(v).includes(",")?'"'+v+'"':v).join(",");
    });
    const csv = header+"\n"+lines.join("\n");
    downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}), "venn_regions_"+new Date().toISOString().slice(0,10)+".csv");
  };

  const doExport = async () => {
    if (fmt==="csv") { doExportCSV(); setDone(true); setTimeout(()=>setDone(false),1500); return; }
    setSaving(true); setErr(null);
    const name = "venn_" + new Date().toISOString().slice(0,10);
    await new Promise(r=>setTimeout(r,60));
    try {
      const svgEl = svgRef && svgRef.current;
      if (!svgEl) { setErr("Couldn't find the diagram. Switch to the Plot or Split view and try again."); return; }
      const clone = svgEl.cloneNode(true);
      const vbParts = (svgEl.getAttribute("viewBox") || "0 0 520 460").split(" ").map(Number);
      const box = trim ? tightViewBox(svgEl, vbParts[2]||520, vbParts[3]||460, 8) : {x:0, y:0, w:vbParts[2]||520, h:vbParts[3]||460};
      clone.setAttribute("viewBox", box.x+" "+box.y+" "+box.w+" "+box.h);
      const svgW = box.w, svgH = box.h;
      prepareSVGForExport(clone, svgW, svgH, null);
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
      <Toggle value={trim} onChange={setTrim} label="Trim empty space"/>
      <div style={{fontSize:10, color:C.muted, lineHeight:1.5, margin:"2px 0 8px"}}>Crops the exported file to the diagram itself. Leave on unless you want the blank margin kept.</div>
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

// ─── Main App ─────────────────────────────────────────────────────────────────
function SheetSidebar({sheets, activeId, onSelect, onNew, onRename, onDuplicate, onDelete, onSave, onLoad}) {
  const t=useC();
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
          onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>readProjectText(ev.target.result,"venn-diagram",onLoad);r.readAsText(f);e.target.value="";}}/>
        <div style={{fontSize:9, color:t.muted, textAlign:"center"}}>Ctrl+S to save</div>
      </div>
    </div>
  );
}


export default function VennDiagramPage() {
  const C = useTheme(); // live theme from the app shell
  const [rtab, setRtab] = useState("plot");
  const [layout, setLayout] = useState("split");
  const [showImport, setShowImport] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  const svgExportRef = useRef(null);

  const [sheets, setSheets] = useState(()=>[mkSheet("Venn 1")]);
  const [activeId, setActiveId] = useState(()=>sheets[0].id);
  const active = sheets.find(s=>s.id===activeId)||sheets[0];

  const updateActive = useCallback((patch) => {
    setSheets(prev => prev.map(s => s.id!==activeId ? s : (typeof patch==="function" ? patch(s) : {...s, ...patch})));
  }, [activeId]);

  // ── Per-sheet undo/redo over the gene lists ──────────────────────────────
  const historyMap = useRef({}), cursorMap = useRef({});
  const [,forceUpdate] = useState(0);
  useEffect(()=>{ if(!historyMap.current[active.id]){ historyMap.current[active.id]=[active.lists]; cursorMap.current[active.id]=0; } },[active.id]);
  const getHist = id => historyMap.current[id] || (historyMap.current[id]=[[]]);
  const getCur  = id => cursorMap.current[id]!==undefined ? cursorMap.current[id] : 0;

  const setLists = useCallback(r => {
    const id = activeId, hist = getHist(id), cur = getCur(id);
    const prev = hist[cur] || [];
    const next = typeof r==="function" ? r(prev) : r;
    historyMap.current[id] = [...hist.slice(0,cur+1), next].slice(-25);
    cursorMap.current[id] = historyMap.current[id].length-1;
    setSheets(ss=>ss.map(s=>s.id===id?{...s, lists:next}:s));
    forceUpdate(v=>v+1);
  }, [activeId]);

  const undo = useCallback(()=>{
    const id=activeId, cur=getCur(id); if(cur<=0) return;
    cursorMap.current[id]=cur-1;
    setSheets(ss=>ss.map(s=>s.id===id?{...s, lists:getHist(id)[cur-1]||[]}:s));
    forceUpdate(v=>v+1);
  },[activeId]);
  const redo = useCallback(()=>{
    const id=activeId, cur=getCur(id), hist=getHist(id); if(cur>=hist.length-1) return;
    cursorMap.current[id]=cur+1;
    setSheets(ss=>ss.map(s=>s.id===id?{...s, lists:hist[cur+1]||[]}:s));
    forceUpdate(v=>v+1);
  },[activeId]);
  const canUndo = getCur(activeId)>0, canRedo = getCur(activeId)<getHist(activeId).length-1;

  const setD = useCallback(r => updateActive(s=>({...s, d: typeof r==="function"?r(s.d):r})), [updateActive]);

  const { lists, d } = active;
  const { names, setSizes, regionList, totalUnion, n } = useProcessedSets(lists);

  // A true Venn is only possible up to 5 sets; past that the view switches to
  // UpSet, which is the standard for many-set comparisons.
  const effectiveMode = d.mode==="auto"
    ? (n<=MAX_VENN_SETS ? "venn" : "upset")
    : (d.mode==="venn" && n>MAX_VENN_SETS ? "upset" : d.mode);

  // ── Sheet lifecycle ──────────────────────────────────────────────────────
  const newSheet = name => {
    const ns = mkSheet(name || ("Venn "+(sheets.length+1)));
    historyMap.current[ns.id]=[ns.lists]; cursorMap.current[ns.id]=0;
    setSheets(prev=>[...prev, ns]); setActiveId(ns.id);
  };
  const selectSheet = id => {
    if (!historyMap.current[id]) { const sh=sheets.find(s=>s.id===id); historyMap.current[id]=[sh?sh.lists:[]]; cursorMap.current[id]=0; }
    setActiveId(id);
  };
  const renameSheet = (id,name) => setSheets(prev=>prev.map(s=>s.id===id?{...s,name}:s));
  const duplicateSheet = id => {
    const srcSheet = sheets.find(s=>s.id===id); if(!srcSheet) return;
    const ns = {...JSON.parse(JSON.stringify(srcSheet)), id:Date.now()+Math.random(), name:srcSheet.name+" (copy)"};
    historyMap.current[ns.id]=[ns.lists]; cursorMap.current[ns.id]=0;
    setSheets(prev=>[...prev, ns]); setActiveId(ns.id);
  };
  const deleteSheet = id => {
    if (sheets.length<=1) return;
    const rest = sheets.filter(s=>s.id!==id);
    setSheets(rest);
    if (activeId===id) setActiveId(rest[rest.length-1].id);
  };

  const saveProject = useCallback(()=>{
    downloadBlob(new Blob([JSON.stringify({version:2, tool:"venn-diagram", sheets},null,2)],{type:"application/json;charset=utf-8"}),
      "venn_project_"+new Date().toISOString().slice(0,10)+".json");
  },[sheets]);

  const loadProject = data => {
    if (!data) return;
    let loaded=null;
    if (data.sheets && data.sheets.length) loaded = data.sheets.map(s=>({...mkSheet(s.name||"Venn"), ...s}));
    if (!loaded || !loaded.length) return;
    setSheets(loaded); setActiveId(loaded[0].id);
    loaded.forEach(s=>{ historyMap.current[s.id]=[s.lists]; cursorMap.current[s.id]=0; });
    forceUpdate(v=>v+1);
  };

  useEffect(()=>{
    const onKey = e => {
      if ((e.ctrlKey||e.metaKey) && !e.shiftKey && e.key==="z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey||e.metaKey) && (e.key==="y" || (e.shiftKey && e.key==="z"))) { e.preventDefault(); redo(); }
      if ((e.ctrlKey||e.metaKey) && e.key==="s") { e.preventDefault(); saveProject(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  },[undo,redo,saveProject]);

  const TABS=[
    {id:"data",  label:"Sets"},
    {id:"plot",  label:"Style"},
    {id:"export",label:"Export"},
  ];

  const modeNote = n>MAX_VENN_SETS
    ? " — a Venn diagram cannot show every intersection beyond "+MAX_VENN_SETS+" sets, so this is an UpSet plot"
    : "";

  return (
    <div style={{display:"flex", flexDirection:"column", height:"100%", background:C.bg, fontFamily:"Inter,system-ui,sans-serif", overflow:"hidden"}}>
      <div style={{display:"flex", alignItems:"center", gap:10, padding:"0 16px", height:48, background:C.panel, borderBottom:"1px solid "+C.border, flexShrink:0}}>
        
        <span style={{fontSize:11, color:C.muted, padding:"2px 8px", borderRadius:10, background:C.panel2, border:"1px solid "+C.border}}>Venn / UpSet</span>
        <div style={{height:20, width:1, background:C.border}}/>
        <span style={{fontSize:12, fontWeight:600, color:C.muted}}>{active.name}</span>
        <div style={{flex:1}}/>
        <CloudProjects tool="venn" getData={()=>({version:2,tool:"venn-diagram",sheets})} onLoad={loadProject}/>
        <div style={{display:"flex", background:C.panel2, borderRadius:8, padding:2, border:"1px solid "+C.border}}>
          {[["split","Split"],["data","Sets"],["plot","Plot"]].map(([id,lb])=>(
            <button key={id} onClick={()=>setLayout(id)} style={{padding:"4px 12px", fontSize:11, fontWeight:600, cursor:"pointer", borderRadius:6, border:"none",
              background:layout===id?C.panel:"transparent", color:layout===id?C.text:C.muted}}>{lb}</button>
          ))}
        </div>
        <div style={{display:"flex", gap:3}}>
          <button onClick={undo} disabled={!canUndo} title="Ctrl+Z" style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+C.border, cursor:canUndo?"pointer":"default", color:canUndo?C.text:C.muted}}>Undo</button>
          <button onClick={redo} disabled={!canRedo} title="Ctrl+Y" style={{padding:"4px 10px", borderRadius:6, fontSize:11, background:"transparent", border:"1px solid "+C.border, cursor:canRedo?"pointer":"default", color:canRedo?C.text:C.muted}}>Redo</button>
        </div>
      </div>

      <div style={{display:"flex", flex:1, minHeight:0, overflow:"hidden"}}>
        <SheetSidebar sheets={sheets} activeId={activeId} onSelect={selectSheet} onNew={newSheet} onRename={renameSheet}
          onDuplicate={duplicateSheet} onDelete={deleteSheet} onSave={saveProject} onLoad={loadProject}/>

        {(layout==="split"||layout==="data") && (
          <div style={{width:layout==="split"?400:undefined, flex:layout==="data"?1:undefined, borderRight:"1px solid "+C.border, background:C.panel, overflowY:"auto", padding:16, flexShrink:0}}>
            <div style={{display:"flex", alignItems:"center", gap:6, marginBottom:10, flexWrap:"wrap"}}>
              <button onClick={()=>setLists(EXAMPLE_SETS.map(s=>({...s})))} style={{padding:"5px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:C.accent, border:"none", color:"#fff"}}>Load example data</button>
              <button onClick={()=>setShowImport(v=>!v)} style={{padding:"5px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:showImport?C.accent:"transparent", border:"1px solid "+(showImport?C.accent:C.border), color:showImport?"#fff":C.text}}>Import file</button>
            </div>

            {showImport && (
              <VennFileImport maxSets={8} onClose={()=>setShowImport(false)}
                onImport={(sets, warnings)=>{ setLists(sets); setShowImport(false); setImportMsg(warnings.length?warnings:null); }}/>
            )}
            {importMsg && (
              <div style={{fontSize:11, marginBottom:10, padding:"8px 10px", borderRadius:6, lineHeight:1.6, background:"#FEF3C7", color:"#92400E", border:"1px solid #FDE68A"}}>
                <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8}}>
                  <div><strong>Imported with notes</strong>
                    <ul style={{margin:"4px 0 0", paddingLeft:16}}>{importMsg.map((mm,i)=><li key={i}>{mm}</li>)}</ul></div>
                  <button onClick={()=>setImportMsg(null)} style={{background:"transparent", border:"none", cursor:"pointer", fontSize:14, color:"inherit", flexShrink:0}}>×</button>
                </div>
              </div>
            )}

            <Sheet lists={lists} setLists={setLists}/>
            {layout==="data" && (
              <div style={{marginTop:18, display:"flex", justifyContent:"center"}}>
                <button onClick={()=>setLayout("plot")} style={{padding:"10px 32px", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer", background:C.accent, border:"none", color:"#fff"}}>Generate Diagram</button>
              </div>
            )}
          </div>
        )}

        {(layout==="split"||layout==="plot") && (
          <div style={{flex:1, overflowY:"auto", padding:20, display:"flex", flexDirection:"column", alignItems:"flex-start", minWidth:0}}>
            <div style={{marginBottom:10, fontSize:12, color:C.muted}}>
              {names.length} sets, {totalUnion} genes in union — showing <strong style={{color:C.text}}>{effectiveMode==="venn"?"Venn diagram":"UpSet plot"}</strong>{modeNote}
            </div>
            <TC.Provider value={LIGHT}>{/* Figure always on white paper with the light palette (see VolcanoPlot). */}
            <div style={{background:d.pbg||LIGHT.panel, border:"1px solid "+C.border, borderRadius:10, padding:"16px", boxShadow:C.shadow, overflowX:"auto"}}>
              {n===0 ? (
                <div style={{padding:40, color:C.muted, fontSize:13}}>Add at least one gene list to see the diagram.</div>
              ) : effectiveMode==="venn" ? (
                <VennDiagram names={names} setSizes={setSizes} regionList={regionList} d={d} svgRef={svgExportRef} totalUnion={totalUnion}/>
              ) : (
                <UpSetPlot names={names} setSizes={setSizes} regionList={regionList} d={d} svgRef={svgExportRef} totalUnion={totalUnion}/>
              )}
            </div>
            </TC.Provider>
            <div style={{marginTop:10, fontSize:11, color:C.muted}}>
              {sheets.length} sheet{sheets.length!==1?"s":""} · Ctrl+S to save
            </div>
            {layout==="plot" && (
              <button onClick={()=>setLayout("data")} style={{marginTop:10, padding:"5px 14px", borderRadius:6, fontSize:12, cursor:"pointer", background:"transparent", border:"1px solid "+C.border, color:C.muted}}>Back to sets</button>
            )}
          </div>
        )}

        <div style={{width:280, borderLeft:"1px solid "+C.border, background:C.panel, flexShrink:0, display:"flex", flexDirection:"column"}}>
          <div style={{display:"flex", borderBottom:"1px solid "+C.border, flexShrink:0}}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setRtab(t.id)} style={{flex:1, padding:"10px 0", cursor:"pointer",
                background:rtab===t.id?C.panel2:"transparent", border:"none", borderBottom:"2px solid "+(rtab===t.id?C.accent:"transparent"), fontSize:10.5, fontWeight:700, color:rtab===t.id?C.text:C.muted}}>{t.label}</button>
            ))}
          </div>
          <div style={{flex:1, overflowY:"auto", padding:16}}>
            {rtab==="data"  && <div style={{fontSize:11, color:C.muted, lineHeight:1.6}}>Edit gene lists in the Sets panel. Names, colours and counts update live. Up to {MAX_VENN_SETS} sets draw as a Venn diagram; more switch to UpSet.</div>}
            {rtab==="plot"  && <PlotPanel d={d} set={setD} nSets={n} effectiveMode={effectiveMode}/>}
            {rtab==="export"&& <ExportPanel svgRef={svgExportRef} regionList={regionList} names={names}/>}
          </div>
        </div>
      </div>
    </div>
  );
}
