import { useState, useMemo, useRef, useCallback, useEffect, useContext } from "react";
import { ThemeCtx, useTheme } from "../shared/theme";

// ════════════════════════════════════════════════════════════════════════════
// Omilytix — Figure Layout
// A Prism-style free-form canvas: import panel images already exported from
// Volcano/MA/PCA/Heatmap (SVG or PNG/JPEG), then drag, resize, align, and
// label them into a single journal-ready composite figure.
//
// Uploaded SVGs are embedded as native nested <svg> elements (not rasterized
// data-URI images), so the exported composite figure stays true vector for
// every panel that started as vector — this is what "journal ready" actually
// requires: a reviewer opening the SVG in Illustrator should see real vector
// paths, not an embedded bitmap.
//
// Theme tokens now live in src/shared/theme.js — ThemeCtx here is the same
// context object AppShell provides, so this receives the shell's live theme.
// ════════════════════════════════════════════════════════════════════════════

const FONTS = ["Inter","Arial","Helvetica","Times New Roman","Georgia","Courier New"];

// ─── mm <-> px conversion ───────────────────────────────────────────────────────
// 96 CSS px per inch, 25.4mm per inch — validated against 183mm (standard
// double-column journal width) producing a sane on-screen pixel size.
const MM_TO_PX = 96/25.4;
const mm2px = mm => mm*MM_TO_PX;

const PAGE_PRESETS = [
  {label:"Single column", w:89, h:120},
  {label:"1.5 column",    w:120, h:160},
  {label:"Double column", w:183, h:230},
  {label:"US Letter",     w:215.9, h:279.4},
  {label:"A4",            w:210, h:297},
];

// ─── Auto panel lettering (Excel-style: A..Z, AA, AB, ...) ─────────────────────
function nextLabel(index) {
  let n = index, label = "";
  do { label = String.fromCharCode(65+(n%26))+label; n = Math.floor(n/26)-1; } while (n>=0);
  return label;
}

// ─── Geometry helpers — validated against known cases before integration ──────
// (fixed-opposite-corner resize behavior, aspect-lock, min-size clamp, and
// exact-equal-gap distribution all confirmed on synthetic inputs.)
function resizeObject(obj, handle, dxMM, dyMM, lockAspect, minSize=5) {
  let {x,y,w,h} = obj;
  const aspect = obj.w/obj.h || 1;
  let nx=x, ny=y, nw=w, nh=h;
  const hasLeft=handle.includes("l"), hasRight=handle.includes("r");
  const hasTop=handle.includes("t"), hasBottom=handle.includes("b");
  if (hasLeft) { nx=x+dxMM; nw=w-dxMM; }
  if (hasRight) { nw=w+dxMM; }
  if (hasTop) { ny=y+dyMM; nh=h-dyMM; }
  if (hasBottom) { nh=h+dyMM; }
  if (lockAspect && (hasLeft||hasRight) && (hasTop||hasBottom)) {
    nh = nw/aspect;
    if (hasTop) ny = (y+h)-nh;
  }
  if (nw<minSize) { if (hasLeft) nx -= (minSize-nw); nw=minSize; }
  if (nh<minSize) { if (hasTop) ny -= (minSize-nh); nh=minSize; }
  return {x:nx,y:ny,w:nw,h:nh};
}
function alignLeft(objs)    { const v=Math.min(...objs.map(o=>o.x)); return objs.map(o=>({...o,x:v})); }
function alignRight(objs)   { const v=Math.max(...objs.map(o=>o.x+o.w)); return objs.map(o=>({...o,x:v-o.w})); }
function alignTop(objs)     { const v=Math.min(...objs.map(o=>o.y)); return objs.map(o=>({...o,y:v})); }
function alignBottom(objs)  { const v=Math.max(...objs.map(o=>o.y+o.h)); return objs.map(o=>({...o,y:v-o.h})); }
function alignCenterH(objs) { const v=objs.reduce((s,o)=>s+o.x+o.w/2,0)/objs.length; return objs.map(o=>({...o,x:v-o.w/2})); }
function alignCenterV(objs) { const v=objs.reduce((s,o)=>s+o.y+o.h/2,0)/objs.length; return objs.map(o=>({...o,y:v-o.h/2})); }
function distributeHorizontal(objs) {
  if (objs.length<3) return objs;
  const sorted=[...objs].sort((a,b)=>a.x-b.x);
  const minX=sorted[0].x, maxR=sorted[sorted.length-1].x+sorted[sorted.length-1].w;
  const totalW=sorted.reduce((s,o)=>s+o.w,0);
  const gap=(maxR-minX-totalW)/(sorted.length-1);
  let cursor=minX;
  return sorted.map(o=>{ const placed={...o,x:cursor}; cursor+=o.w+gap; return placed; });
}
function distributeVertical(objs) {
  if (objs.length<3) return objs;
  const sorted=[...objs].sort((a,b)=>a.y-b.y);
  const minY=sorted[0].y, maxB=sorted[sorted.length-1].y+sorted[sorted.length-1].h;
  const totalH=sorted.reduce((s,o)=>s+o.h,0);
  const gap=(maxB-minY-totalH)/(sorted.length-1);
  let cursor=minY;
  return sorted.map(o=>{ const placed={...o,y:cursor}; cursor+=o.h+gap; return placed; });
}

// ─── File reading: SVG kept as real vector markup, raster as data URL ────────
function readSvgFile(file) {
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result;
        const doc = new DOMParser().parseFromString(text, "image/svg+xml");
        const svgEl = doc.querySelector("svg");
        if (!svgEl || doc.querySelector("parsererror")) { reject(new Error("Could not parse SVG")); return; }
        let viewBox = svgEl.getAttribute("viewBox");
        let w = parseFloat(svgEl.getAttribute("width"))||0;
        let h = parseFloat(svgEl.getAttribute("height"))||0;
        if (!viewBox) viewBox = "0 0 "+(w||600)+" "+(h||400);
        const vbParts = viewBox.split(/\s+/).map(Number);
        const naturalW = w||vbParts[2]||600, naturalH = h||vbParts[3]||400;
        resolve({kind:"svg", viewBox, innerMarkup:svgEl.innerHTML, naturalW, naturalH});
      } catch(e) { reject(e); }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
function readRasterFile(file) {
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => resolve({kind:"raster", dataUrl, naturalW:img.naturalWidth||600, naturalH:img.naturalHeight||400});
      img.onerror = reject;
      img.src = dataUrl;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Small reusable UI atoms ────────────────────────────────────────────────────
function Pill({active, onClick, children}) {
  const t=useTheme();
  return (
    <button onClick={onClick} style={{padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer",
      background:active?t.accent:"transparent", border:"1px solid "+(active?t.accent:t.border),
      color:active?"#fff":t.muted, transition:"all .12s"}}>
      {children}
    </button>
  );
}
function SectionLabel({children}) {
  const t=useTheme();
  return <div style={{fontSize:9, fontWeight:700, color:t.muted, textTransform:"uppercase", letterSpacing:"0.09em", marginBottom:6}}>{children}</div>;
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
function NumField({label, value, onChange, min, max, step=1, suffix}) {
  const t=useTheme();
  return (
    <div>
      <div style={{fontSize:10, color:t.muted, marginBottom:3}}>{label}</div>
      <div style={{display:"flex", alignItems:"center", gap:4}}>
        <input type="number" min={min} max={max} step={step} value={Math.round(value*100)/100}
          onChange={e=>onChange(+e.target.value)}
          style={{width:"100%", padding:"4px 7px", fontSize:11, borderRadius:5, border:"1px solid "+t.border, background:t.cBg, color:t.text, outline:"none"}}/>
        {suffix&&<span style={{fontSize:10, color:t.muted}}>{suffix}</span>}
      </div>
    </div>
  );
}

// ─── Insert panel ───────────────────────────────────────────────────────────────
function InsertPanel({onFilesAdded, onAddText}) {
  const t=useTheme();
  const fileRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div>
      <SectionLabel>Add Panels</SectionLabel>
      <div
        onDragOver={e=>{e.preventDefault();setDragOver(true);}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={e=>{e.preventDefault();setDragOver(false);onFilesAdded(e.dataTransfer.files);}}
        onClick={()=>fileRef.current&&fileRef.current.click()}
        style={{padding:"22px 12px", borderRadius:10, border:"2px dashed "+(dragOver?t.accent:t.border), background:dragOver?t.cSel:t.panel2, textAlign:"center", cursor:"pointer", marginBottom:10}}>
        <div style={{fontSize:22, marginBottom:6}}>📁</div>
        <div style={{fontSize:11, color:t.text, fontWeight:600}}>Drop panel images here</div>
        <div style={{fontSize:10, color:t.muted, marginTop:2}}>or click to browse — SVG, PNG, JPEG</div>
      </div>
      <input ref={fileRef} type="file" accept=".svg,.png,.jpg,.jpeg" multiple style={{display:"none"}}
        onChange={e=>{ if(e.target.files.length) onFilesAdded(e.target.files); e.target.value=""; }}/>
      <div style={{fontSize:10, color:t.muted, lineHeight:1.5, marginBottom:12}}>
        Export each panel from Volcano/MA/PCA/Heatmap as SVG for true vector quality in the final figure, or PNG/JPEG if that's what you have. SVG panels stay fully vector when you export this composite as SVG.
      </div>
      <Divider/>
      <SectionLabel>Add Text</SectionLabel>
      <button onClick={onAddText}
        style={{width:"100%", padding:"7px 0", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.text}}>
        + Text box (caption, title…)
      </button>
    </div>
  );
}

// ─── Layers panel ───────────────────────────────────────────────────────────────
function LayersPanel({objects, selectedIds, setSelectedIds, onReorder, onDelete, onDuplicate, onToggleVisible}) {
  const t=useTheme();
  const sorted = [...objects].sort((a,b)=>b.zIndex-a.zIndex);
  return (
    <div>
      <SectionLabel>Layers (front to back)</SectionLabel>
      {sorted.length===0 && <div style={{fontSize:11, color:t.muted, padding:"12px 4px"}}>No panels yet — add some from the Insert tab.</div>}
      <div style={{display:"flex", flexDirection:"column", gap:3}}>
        {sorted.map(o=>{
          const isSel = selectedIds.includes(o.id);
          return (
            <div key={o.id} onClick={e=>{
                if (e.shiftKey) setSelectedIds(prev=>prev.includes(o.id)?prev.filter(id=>id!==o.id):[...prev,o.id]);
                else setSelectedIds([o.id]);
              }}
              style={{display:"flex", alignItems:"center", gap:6, padding:"6px 8px", borderRadius:6, cursor:"pointer",
                background:isSel?t.cSel:"transparent", border:"1px solid "+(isSel?t.accent:t.border)}}>
              <span style={{fontSize:11, fontWeight:700, color:t.accent, width:20}}>{o.type==="text"?"T":o.label||"—"}</span>
              <span style={{fontSize:11, color:t.text, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                {o.type==="text" ? (o.text||"(empty text)") : o.name}
              </span>
              <button onClick={e=>{e.stopPropagation();onToggleVisible(o.id);}} title="Toggle visibility"
                style={{background:"transparent", border:"none", cursor:"pointer", fontSize:11, color:t.muted, padding:2}}>{o.visible===false?"◻":"◼"}</button>
              <button onClick={e=>{e.stopPropagation();onDuplicate(o.id);}} title="Duplicate"
                style={{background:"transparent", border:"none", cursor:"pointer", fontSize:11, color:t.muted, padding:2}}>⧉</button>
              <button onClick={e=>{e.stopPropagation();onDelete(o.id);}} title="Delete"
                style={{background:"transparent", border:"none", cursor:"pointer", fontSize:12, color:"#DC2626", padding:2}}>×</button>
            </div>
          );
        })}
      </div>
      {selectedIds.length===1 && (
        <div style={{display:"flex", gap:5, marginTop:10}}>
          <button onClick={()=>onReorder(selectedIds[0],"front")} style={{flex:1, padding:"5px 0", borderRadius:5, fontSize:10, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>To front</button>
          <button onClick={()=>onReorder(selectedIds[0],"back")} style={{flex:1, padding:"5px 0", borderRadius:5, fontSize:10, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.muted}}>To back</button>
        </div>
      )}
    </div>
  );
}

// ─── Label style panel ──────────────────────────────────────────────────────────
function LabelPanel({labelStyle, setLabelStyle, onRelabelAll}) {
  const t=useTheme();
  return (
    <div>
      <SectionLabel>Panel Label Convention</SectionLabel>
      <div style={{display:"flex", gap:5, marginBottom:10}}>
        <Pill active={labelStyle.format==="ABC"} onClick={()=>setLabelStyle(s=>({...s,format:"ABC"}))}>A, B, C</Pill>
        <Pill active={labelStyle.format==="abc"} onClick={()=>setLabelStyle(s=>({...s,format:"abc"}))}>(a), (b), (c)</Pill>
      </div>
      <button onClick={onRelabelAll} style={{width:"100%", padding:"6px 0", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", background:"transparent", border:"1px solid "+t.border, color:t.text, marginBottom:10}}>
        Relabel all in current layer order
      </button>
      <div style={{fontSize:10, color:t.muted, lineHeight:1.5, marginBottom:10}}>New panels auto-append the next label. Use this if you've reordered or deleted panels and want the sequence tidied up.</div>

      <Divider/>
      <SectionLabel>Style</SectionLabel>
      <Toggle value={labelStyle.visible!==false} onChange={v=>setLabelStyle(s=>({...s,visible:v}))} label="Show panel labels"/>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10}}>
        <NumField label="Font size" value={labelStyle.fontSize} onChange={v=>setLabelStyle(s=>({...s,fontSize:v}))} min={8} max={28} suffix="pt"/>
        <div>
          <div style={{fontSize:10, color:t.muted, marginBottom:3}}>Color</div>
          <ColorSwatch color={labelStyle.color} onChange={v=>setLabelStyle(s=>({...s,color:v}))}/>
        </div>
      </div>
      <Toggle value={labelStyle.bold!==false} onChange={v=>setLabelStyle(s=>({...s,bold:v}))} label="Bold"/>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8}}>
        <NumField label="Offset X" value={labelStyle.offsetX} onChange={v=>setLabelStyle(s=>({...s,offsetX:v}))} min={-20} max={20} step={0.5} suffix="mm"/>
        <NumField label="Offset Y" value={labelStyle.offsetY} onChange={v=>setLabelStyle(s=>({...s,offsetY:v}))} min={-20} max={20} step={0.5} suffix="mm"/>
      </div>
    </div>
  );
}

// ─── Canvas (page) settings panel ──────────────────────────────────────────────
function CanvasPanel({canvas, setCanvas}) {
  const t=useTheme();
  return (
    <div>
      <SectionLabel>Page Size</SectionLabel>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:8}}>
        {PAGE_PRESETS.map(p=>(
          <button key={p.label} onClick={()=>setCanvas(c=>({...c,widthMM:p.w,heightMM:p.h}))}
            style={{padding:"6px 4px", borderRadius:6, cursor:"pointer", textAlign:"center",
              background:(canvas.widthMM===p.w&&canvas.heightMM===p.h)?t.cSel:"transparent", border:"1.5px solid "+((canvas.widthMM===p.w&&canvas.heightMM===p.h)?t.accent:t.border)}}>
            <div style={{fontSize:10, fontWeight:700, color:t.text}}>{p.label}</div>
            <div style={{fontSize:9, color:t.muted}}>{p.w}×{p.h}mm</div>
          </button>
        ))}
      </div>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10}}>
        <NumField label="Width" value={canvas.widthMM} onChange={v=>setCanvas(c=>({...c,widthMM:v}))} min={40} max={500} suffix="mm"/>
        <NumField label="Height" value={canvas.heightMM} onChange={v=>setCanvas(c=>({...c,heightMM:v}))} min={40} max={500} suffix="mm"/>
      </div>

      <Divider/>
      <SectionLabel>Appearance</SectionLabel>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:10}}>
        <span style={{fontSize:11, color:t.muted, flex:1}}>Background</span>
        <ColorSwatch color={canvas.bg} onChange={v=>setCanvas(c=>({...c,bg:v}))}/>
      </div>
      <Toggle value={canvas.showMargin} onChange={v=>setCanvas(c=>({...c,showMargin:v}))} label="Show margin guide (not exported)"/>
      {canvas.showMargin&&<NumField label="Margin" value={canvas.marginMM} onChange={v=>setCanvas(c=>({...c,marginMM:v}))} min={0} max={30} suffix="mm"/>}
      <Toggle value={canvas.snapToObjects!==false} onChange={v=>setCanvas(c=>({...c,snapToObjects:v}))} label="Snap to nearby panel edges"/>
    </div>
  );
}

// ─── Align toolbar (shown when 2+ objects selected) ────────────────────────────
function AlignToolbarWired({selectedIds, objects, setObjects}) {
  const align = (mode) => {
    const sel = objects.filter(o=>selectedIds.includes(o.id));
    let aligned;
    if (mode==="left") aligned=alignLeft(sel);
    else if (mode==="right") aligned=alignRight(sel);
    else if (mode==="top") aligned=alignTop(sel);
    else if (mode==="bottom") aligned=alignBottom(sel);
    else if (mode==="centerH") aligned=alignCenterH(sel);
    else if (mode==="centerV") aligned=alignCenterV(sel);
    else if (mode==="distH") aligned=distributeHorizontal(sel);
    else if (mode==="distV") aligned=distributeVertical(sel);
    else aligned=sel;
    const byId = Object.fromEntries(aligned.map(o=>[o.id,o]));
    setObjects(prev=>prev.map(o=>byId[o.id]?{...o,...byId[o.id]}:o));
  };
  const t=useTheme();
  const BTN = (label,mode,title) => (
    <button key={mode} onClick={()=>align(mode)} title={title}
      style={{padding:"5px 9px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer", background:t.panel2, border:"1px solid "+t.border, color:t.text}}>
      {label}
    </button>
  );
  return (
    <div style={{position:"absolute", top:10, left:"50%", transform:"translateX(-50%)", display:"flex", gap:4, padding:"6px 8px", borderRadius:9, background:t.panel, border:"1px solid "+t.border, boxShadow:t.shadow, zIndex:50}}>
      {BTN("⊢","left","Align left edges")}
      {BTN("⊣","right","Align right edges")}
      {BTN("⊤","top","Align top edges")}
      {BTN("⊥","bottom","Align bottom edges")}
      {BTN("┃","centerH","Align horizontal centers")}
      {BTN("━","centerV","Align vertical centers")}
      {selectedIds.length>=3 && BTN("⇔","distH","Distribute horizontally")}
      {selectedIds.length>=3 && BTN("⇕","distV","Distribute vertically")}
    </div>
  );
}

// ─── Export panel ───────────────────────────────────────────────────────────────
function ExportPanel({canvasRef, canvas}) {
  const t=useTheme();
  const [format,setFormat]=useState("png");
  const [dpi,setDpi]=useState(300);
  const [saving,setSaving]=useState(false);
  const [done,setDone]=useState(false);

  const runExport = async () => {
    setSaving(true);
    const name = "figure_"+new Date().toISOString().slice(0,10);
    await new Promise(r=>setTimeout(r,60));
    try {
      const svgEl = canvasRef.current && canvasRef.current.querySelector("svg");
      if (!svgEl) return;
      const clone = svgEl.cloneNode(true);
      clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
      // strip selection-only UI (handles, guides) from the export clone
      clone.querySelectorAll("[data-ui-only='true']").forEach(el=>el.remove());
      const svgWpx = mm2px(canvas.widthMM), svgHpx = mm2px(canvas.heightMM);
      if (format==="svg") {
        clone.setAttribute("width", canvas.widthMM+"mm");
        clone.setAttribute("height", canvas.heightMM+"mm");
        const a=document.createElement("a");
        a.href=URL.createObjectURL(new Blob([clone.outerHTML],{type:"image/svg+xml"}));
        a.download=name+".svg"; a.click();
      } else {
        const pxW = Math.round(canvas.widthMM/25.4*dpi), pxH = Math.round(canvas.heightMM/25.4*dpi);
        clone.setAttribute("width", svgWpx); clone.setAttribute("height", svgHpx);
        const svgStr = new XMLSerializer().serializeToString(clone);
        const img = new Image();
        img.onload = () => {
          const c=document.createElement("canvas"); c.width=pxW; c.height=pxH;
          const ctx=c.getContext("2d"); ctx.scale(pxW/svgWpx, pxH/svgHpx);
          ctx.fillStyle=canvas.bg||"#fff"; ctx.fillRect(0,0,svgWpx,svgHpx);
          ctx.drawImage(img,0,0);
          const suffix="_"+dpi+"dpi";
          const a=document.createElement("a");
          if (format==="jpeg") { a.href=c.toDataURL("image/jpeg",0.95); a.download=name+suffix+".jpg"; }
          else if (format==="tiff") { a.href=c.toDataURL("image/png"); a.download=name+suffix+".tif"; }
          else { a.href=c.toDataURL("image/png"); a.download=name+suffix+".png"; }
          a.click();
        };
        img.src = "data:image/svg+xml;base64,"+btoa(unescape(encodeURIComponent(svgStr)));
      }
      setDone(true); setTimeout(()=>setDone(false),1500);
    } finally { setSaving(false); }
  };

  const FORMATS=[{id:"png",l:"PNG",sub:"Best for most journals"},{id:"jpeg",l:"JPEG",sub:"Smaller file size"},{id:"tiff",l:"TIFF",sub:"ImageJ / Photoshop"},{id:"svg",l:"SVG",sub:"True vector — best for revision"}];
  const pxW = Math.round(canvas.widthMM/25.4*dpi), pxH = Math.round(canvas.heightMM/25.4*dpi);

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
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, marginBottom:8}}>
            {[[150,"Draft"],[300,"Journal"],[600,"High-res"],[1200,"Poster"]].map(([v,lb])=>(
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
      <div style={{padding:"9px 11px", borderRadius:8, background:t.panel2, border:"1px solid "+t.border, marginBottom:12}}>
        <div style={{fontSize:10, color:t.muted, marginBottom:4, fontWeight:600}}>Output preview</div>
        <div style={{fontSize:11, color:t.text}}>{canvas.widthMM} × {canvas.heightMM} mm</div>
        {format!=="svg"&&<div style={{fontSize:11, color:t.text}}>{pxW} × {pxH} px at {dpi} dpi</div>}
        {format!=="svg"&&(dpi>=300?<div style={{fontSize:10, color:t.success, fontWeight:600, marginTop:4}}>Journal quality</div>:<div style={{fontSize:10, color:t.muted, marginTop:4}}>Use 300+ dpi for publication</div>)}
        {format==="svg"&&<div style={{fontSize:10, color:t.success, fontWeight:600, marginTop:4}}>Vector — resolution-independent</div>}
      </div>
      <button onClick={runExport} disabled={saving}
        style={{width:"100%", padding:"11px 0", borderRadius:8, fontSize:13, fontWeight:700, cursor:saving?"default":"pointer",
          background:done?t.success:t.accent, border:"none", color:"#fff", transition:"background .2s"}}>
        {done?"Saved!":saving?"Saving...":"Download "+format.toUpperCase()}
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Canvas — the interactive page
// ════════════════════════════════════════════════════════════════════════════
function FigureCanvas({canvas, objects, setObjects, selectedIds, setSelectedIds, labelStyle}) {
  const t=useTheme();
  const svgRef = useRef(null);
  const dragState = useRef(null); // {mode:'move'|'resize', ids, startPointerMM, startObjs, handle}

  const svgW = mm2px(canvas.widthMM), svgH = mm2px(canvas.heightMM);

  const pointerToMM = useCallback((clientX, clientY) => {
    const svg = svgRef.current; if (!svg) return {x:0,y:0};
    const pt = svg.createSVGPoint(); pt.x=clientX; pt.y=clientY;
    const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
    return {x: svgPt.x/MM_TO_PX, y: svgPt.y/MM_TO_PX};
  },[]);

  const onObjectPointerDown = useCallback((e, obj) => {
    e.stopPropagation();
    if (!selectedIds.includes(obj.id)) {
      setSelectedIds(e.shiftKey ? [...selectedIds, obj.id] : [obj.id]);
    }
    const startMM = pointerToMM(e.clientX, e.clientY);
    const idsToMove = selectedIds.includes(obj.id) ? selectedIds : [obj.id];
    dragState.current = { mode:"move", ids:idsToMove, startMM, startObjs: objects.filter(o=>idsToMove.includes(o.id)).map(o=>({id:o.id,x:o.x,y:o.y})) };
  },[selectedIds, objects, pointerToMM, setSelectedIds]);

  const onHandlePointerDown = useCallback((e, obj, handle) => {
    e.stopPropagation();
    setSelectedIds([obj.id]);
    const startMM = pointerToMM(e.clientX, e.clientY);
    dragState.current = { mode:"resize", ids:[obj.id], handle, startMM, startObjs:[{id:obj.id,x:obj.x,y:obj.y,w:obj.w,h:obj.h}] };
  },[pointerToMM, setSelectedIds]);

  const onCanvasPointerMove = useCallback((e) => {
    const ds = dragState.current; if (!ds) return;
    const curMM = pointerToMM(e.clientX, e.clientY);
    const dx = curMM.x-ds.startMM.x, dy = curMM.y-ds.startMM.y;
    if (ds.mode==="move") {
      setObjects(prev=>prev.map(o=>{
        const start = ds.startObjs.find(s=>s.id===o.id);
        if (!start) return o;
        return {...o, x:Math.max(0,Math.min(canvas.widthMM-o.w, start.x+dx)), y:Math.max(0,Math.min(canvas.heightMM-o.h, start.y+dy))};
      }));
    } else if (ds.mode==="resize") {
      const start = ds.startObjs[0];
      setObjects(prev=>prev.map(o=>{
        if (o.id!==start.id) return o;
        const resized = resizeObject({x:start.x,y:start.y,w:start.w,h:start.h}, ds.handle, dx, dy, o.lockAspect!==false);
        return {...o, ...resized};
      }));
    }
  },[pointerToMM, setObjects, canvas.widthMM, canvas.heightMM]);

  const onCanvasPointerUp = useCallback(()=>{ dragState.current=null; },[]);

  const onCanvasBackgroundClick = () => setSelectedIds([]);

  const HANDLES = ["tl","t","tr","r","br","b","bl","l"];
  const handlePos = (o, h) => {
    const cx=o.x+o.w/2, cy=o.y+o.h/2;
    if (h==="tl") return [o.x,o.y]; if (h==="t") return [cx,o.y]; if (h==="tr") return [o.x+o.w,o.y];
    if (h==="r") return [o.x+o.w,cy]; if (h==="br") return [o.x+o.w,o.y+o.h]; if (h==="b") return [cx,o.y+o.h];
    if (h==="bl") return [o.x,o.y+o.h]; return [o.x,cy]; // "l"
  };
  const cursorFor = h => ({tl:"nwse-resize",br:"nwse-resize",tr:"nesw-resize",bl:"nesw-resize",t:"ns-resize",b:"ns-resize",l:"ew-resize",r:"ew-resize"}[h]);

  return (
    <div style={{background:t.panel2, borderRadius:10, padding:16, display:"inline-block", position:"relative"}}>
      {selectedIds.length>=2 && <AlignToolbarWired selectedIds={selectedIds} objects={objects} setObjects={setObjects}/>}
      <div ref={el=>{svgRef.current = el ? el.querySelector("svg") : null;}}>
        <svg width={svgW} height={svgH} viewBox={"0 0 "+svgW+" "+svgH}
          style={{display:"block", background:canvas.bg||"#fff", boxShadow:"0 1px 8px rgba(0,0,0,.15)", cursor:"default"}}
          onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerLeave={onCanvasPointerUp}
          onClick={onCanvasBackgroundClick}>
          {canvas.showMargin && (
            <rect data-ui-only="true" x={mm2px(canvas.marginMM)} y={mm2px(canvas.marginMM)}
              width={svgW-2*mm2px(canvas.marginMM)} height={svgH-2*mm2px(canvas.marginMM)}
              fill="none" stroke={t.accent} strokeWidth={1} strokeDasharray="4 3" opacity={0.5}/>
          )}

          {[...objects].filter(o=>o.visible!==false).sort((a,b)=>a.zIndex-b.zIndex).map(o=>{
            const isSel = selectedIds.includes(o.id);
            const px = mm2px(o.x), py = mm2px(o.y), pw = mm2px(o.w), ph = mm2px(o.h);
            return (
              <g key={o.id}>
                <g onPointerDown={e=>onObjectPointerDown(e,o)} style={{cursor:"move"}}>
                  {o.type==="image" && o.data.kind==="svg" && (
                    <svg x={px} y={py} width={pw} height={ph} viewBox={o.data.viewBox} preserveAspectRatio="xMidYMid meet"
                      dangerouslySetInnerHTML={{__html:o.data.innerMarkup}}/>
                  )}
                  {o.type==="image" && o.data.kind==="raster" && (
                    <image x={px} y={py} width={pw} height={ph} href={o.data.dataUrl} preserveAspectRatio="xMidYMid meet"/>
                  )}
                  {o.type==="text" && (
                    <foreignObject x={px} y={py} width={pw} height={ph}>
                      <div style={{width:"100%", height:"100%", display:"flex", alignItems:o.vAlign||"flex-start", justifyContent:o.hAlign||"flex-start",
                        fontSize:(o.fontSize||11)*MM_TO_PX/2.83, fontWeight:o.bold?"bold":"normal", fontStyle:o.italic?"italic":"normal",
                        color:o.color||t.text, fontFamily:o.ff||"Inter", textAlign:o.textAlign||"left", overflow:"hidden", wordBreak:"break-word"}}>
                        {o.text||"Click to edit text"}
                      </div>
                    </foreignObject>
                  )}
                  {/* transparent hit area ensures empty/whitespace regions of an SVG panel are still draggable */}
                  <rect x={px} y={py} width={pw} height={ph} fill="transparent"/>
                </g>

                {o.type==="image" && labelStyle.visible!==false && o.showLabel!==false && (
                  <text data-ui-only="false" x={px+mm2px(labelStyle.offsetX)} y={py+mm2px(labelStyle.offsetY)+labelStyle.fontSize*MM_TO_PX/2.83}
                    fontSize={labelStyle.fontSize*MM_TO_PX/2.83} fontWeight={labelStyle.bold!==false?"bold":"normal"} fill={labelStyle.color}
                    fontFamily="Inter" style={{pointerEvents:"none"}}>
                    {labelStyle.format==="abc" ? "("+o.label.toLowerCase()+")" : o.label}
                  </text>
                )}

                {isSel && (
                  <g data-ui-only="true">
                    <rect x={px} y={py} width={pw} height={ph} fill="none" stroke={t.accent} strokeWidth={1.5} strokeDasharray={objects.length>1&&selectedIds.length>1?"5 3":"0"}/>
                    {selectedIds.length===1 && HANDLES.map(h=>{
                      const [hx,hy] = handlePos(o,h);
                      return (
                        <rect key={h} x={mm2px(hx)-4} y={mm2px(hy)-4} width={8} height={8} fill="#fff" stroke={t.accent} strokeWidth={1.5}
                          style={{cursor:cursorFor(h)}} onPointerDown={e=>onHandlePointerDown(e,o,h)}/>
                      );
                    })}
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Main App
// ════════════════════════════════════════════════════════════════════════════
export default function FigureLayoutPage() {
  const activeTheme = useTheme(); // live theme from the app shell's toggle
  const [rightTab,setRightTab]=useState("insert");
  const canvasWrapRef = useRef(null);

  const [canvas,setCanvas]=useState({widthMM:183, heightMM:230, bg:"#FFFFFF", showMargin:false, marginMM:5, snapToObjects:true});
  const [labelStyle,setLabelStyle]=useState({format:"ABC", visible:true, fontSize:14, bold:true, color:"#1E2736", offsetX:1, offsetY:5});

  const objectsHistory = useRef([[]]);
  const objectsCursor = useRef(0);
  const [objects,setObjectsRaw]=useState([]);
  const [,bump]=useState(0);
  const setObjects = useCallback(fn=>{
    const prev = objectsHistory.current[objectsCursor.current];
    const next = typeof fn==="function" ? fn(prev) : fn;
    objectsHistory.current = [...objectsHistory.current.slice(0,objectsCursor.current+1), next].slice(-30);
    objectsCursor.current = objectsHistory.current.length-1;
    setObjectsRaw(next); bump(v=>v+1);
  },[]);
  const undo = useCallback(()=>{ if(objectsCursor.current<=0) return; objectsCursor.current--; setObjectsRaw(objectsHistory.current[objectsCursor.current]); bump(v=>v+1); },[]);
  const redo = useCallback(()=>{ if(objectsCursor.current>=objectsHistory.current.length-1) return; objectsCursor.current++; setObjectsRaw(objectsHistory.current[objectsCursor.current]); bump(v=>v+1); },[]);
  const canUndo = objectsCursor.current>0, canRedo = objectsCursor.current<objectsHistory.current.length-1;

  const [selectedIds,setSelectedIds]=useState([]);

  const nextZ = () => (objects.length ? Math.max(...objects.map(o=>o.zIndex)) : 0) + 1;
  const nextPanelLabelIndex = () => objects.filter(o=>o.type==="image").length;

  const onFilesAdded = async (fileList) => {
    const files = Array.from(fileList);
    let cascade = objects.length;
    for (const file of files) {
      try {
        const isSvg = file.type==="image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
        const data = isSvg ? await readSvgFile(file) : await readRasterFile(file);
        const aspect = data.naturalW/data.naturalH || 1.5;
        const targetW = Math.min(80, canvas.widthMM*0.45);
        const targetH = targetW/aspect;
        const offset = (cascade%5)*8;
        const idx = nextPanelLabelIndex();
        setObjects(prev=>[...prev, {
          id: Date.now()+Math.random(), type:"image", name:file.name,
          x: 10+offset, y: 10+offset, w: targetW, h: targetH,
          lockAspect: true, zIndex: nextZ()+cascade, visible:true,
          showLabel:true, label: nextLabel(idx),
          data,
        }]);
        cascade++;
      } catch(err) { console.error("Failed to load", file.name, err); }
    }
  };

  const onAddText = () => {
    setObjects(prev=>[...prev, {
      id: Date.now()+Math.random(), type:"text", text:"Figure 1. ", 
      x: 10, y: canvas.heightMM-30, w: canvas.widthMM-20, h: 20,
      fontSize:10, bold:false, italic:false, color:"#1E2736", ff:"Inter", textAlign:"left", hAlign:"flex-start", vAlign:"flex-start",
      zIndex: nextZ(), visible:true,
    }]);
  };

  const onReorder = (id, dir) => setObjects(prev=>{
    const z = dir==="front" ? Math.max(...prev.map(o=>o.zIndex))+1 : Math.min(...prev.map(o=>o.zIndex))-1;
    return prev.map(o=>o.id===id?{...o,zIndex:z}:o);
  });
  const onDelete = (id) => { setObjects(prev=>prev.filter(o=>o.id!==id)); setSelectedIds(prev=>prev.filter(i=>i!==id)); };
  const onDuplicate = (id) => setObjects(prev=>{
    const src = prev.find(o=>o.id===id); if (!src) return prev;
    return [...prev, {...src, id:Date.now()+Math.random(), x:src.x+6, y:src.y+6, zIndex:nextZ()}];
  });
  const onToggleVisible = (id) => setObjects(prev=>prev.map(o=>o.id===id?{...o,visible:o.visible===false}:o));

  const onRelabelAll = () => setObjects(prev=>{
    const imgs = prev.filter(o=>o.type==="image").sort((a,b)=>a.zIndex-b.zIndex);
    const relabeled = Object.fromEntries(imgs.map((o,i)=>[o.id, nextLabel(i)]));
    return prev.map(o=>o.type==="image" ? {...o, label:relabeled[o.id]} : o);
  });

  useEffect(()=>{
    const handler = e => {
      if ((e.ctrlKey||e.metaKey) && !e.shiftKey && e.key==="z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey||e.metaKey) && (e.key==="y"||(e.shiftKey&&e.key==="z"))) { e.preventDefault(); redo(); }
      if ((e.key==="Delete"||e.key==="Backspace") && selectedIds.length && document.activeElement.tagName!=="INPUT" && document.activeElement.tagName!=="TEXTAREA") {
        e.preventDefault();
        setObjects(prev=>prev.filter(o=>!selectedIds.includes(o.id)));
        setSelectedIds([]);
      }
      if ((e.ctrlKey||e.metaKey) && e.key==="d" && selectedIds.length===1) { e.preventDefault(); onDuplicate(selectedIds[0]); }
      const nudge = e.shiftKey ? 5 : 1;
      if (selectedIds.length && ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key) && document.activeElement.tagName!=="INPUT") {
        e.preventDefault();
        const dx = e.key==="ArrowLeft"?-nudge:e.key==="ArrowRight"?nudge:0;
        const dy = e.key==="ArrowUp"?-nudge:e.key==="ArrowDown"?nudge:0;
        setObjects(prev=>prev.map(o=>selectedIds.includes(o.id)?{...o,x:o.x+dx,y:o.y+dy}:o));
      }
    };
    window.addEventListener("keydown",handler);
    return ()=>window.removeEventListener("keydown",handler);
  },[undo,redo,selectedIds,setObjects]);

  const selectedObjects = objects.filter(o=>selectedIds.includes(o.id));
  const RIGHT_TABS=[{id:"insert",icon:"\u2795",label:"Insert"},{id:"layers",icon:"\uD83D\uDCDA",label:"Layers"},{id:"label",icon:"\uD83C\uDFF7",label:"Label"},{id:"canvas",icon:"\uD83D\uDCD0",label:"Page"},{id:"export",icon:"\u2B07",label:"Export"}];

  return (
    <div style={{height:"100%",background:activeTheme.bg,color:activeTheme.text,fontFamily:"Inter,system-ui,sans-serif",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"0 16px",borderBottom:"1px solid "+activeTheme.border,background:activeTheme.panel,display:"flex",alignItems:"center",gap:12,flexShrink:0,height:48,boxShadow:activeTheme.shadow}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:13,fontWeight:800,color:activeTheme.text}}>Figure Layout</span>
          </div>
          <div style={{flex:1}}/>
          <div style={{display:"flex",gap:3}}>
            <button onClick={undo} disabled={!canUndo} title="Ctrl+Z" style={{padding:"4px 10px",borderRadius:6,fontSize:11,background:"transparent",border:"1px solid "+activeTheme.border,cursor:canUndo?"pointer":"default",color:canUndo?activeTheme.text:activeTheme.muted}}>Undo</button>
            <button onClick={redo} disabled={!canRedo} title="Ctrl+Y" style={{padding:"4px 10px",borderRadius:6,fontSize:11,background:"transparent",border:"1px solid "+activeTheme.border,cursor:canRedo?"pointer":"default",color:canRedo?activeTheme.text:activeTheme.muted}}>Redo</button>
          </div>
        </div>
        <div style={{flex:1,display:"flex",minHeight:0,overflow:"hidden"}}>
          <div style={{flex:1,overflow:"auto",padding:24,display:"flex",justifyContent:"center",alignItems:"flex-start"}} ref={canvasWrapRef}>
            <FigureCanvas canvas={canvas} objects={objects} setObjects={setObjects} selectedIds={selectedIds} setSelectedIds={setSelectedIds} labelStyle={labelStyle}/>
          </div>
          <div style={{width:260,background:activeTheme.panel,borderLeft:"1px solid "+activeTheme.border,display:"flex",flexDirection:"column",flexShrink:0}}>
            <div style={{display:"flex",borderBottom:"1px solid "+activeTheme.border,background:activeTheme.panel2}}>
              {RIGHT_TABS.map(tab=>(
                <button key={tab.id} onClick={()=>setRightTab(tab.id)} style={{flex:1,padding:"8px 2px 6px",fontSize:9,fontWeight:700,cursor:"pointer",border:"none",background:"transparent",color:rightTab===tab.id?activeTheme.accent:activeTheme.muted,borderBottom:"2px solid "+(rightTab===tab.id?activeTheme.accent:"transparent"),display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  <span style={{fontSize:13}}>{tab.icon}</span>{tab.label}
                </button>
              ))}
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"14px 12px"}}>
              {rightTab==="insert"&&<InsertPanel onFilesAdded={onFilesAdded} onAddText={onAddText}/>}
              {rightTab==="layers"&&<LayersPanel objects={objects} selectedIds={selectedIds} setSelectedIds={setSelectedIds} onReorder={onReorder} onDelete={onDelete} onDuplicate={onDuplicate} onToggleVisible={onToggleVisible}/>}
              {rightTab==="label"&&<LabelPanel labelStyle={labelStyle} setLabelStyle={setLabelStyle} onRelabelAll={onRelabelAll}/>}
              {rightTab==="canvas"&&<CanvasPanel canvas={canvas} setCanvas={setCanvas}/>}
              {rightTab==="export"&&<ExportPanel canvasRef={canvasWrapRef} canvas={canvas}/>}
            </div>
            {selectedObjects.length===1 && selectedObjects[0].type==="text" && (
              <div style={{padding:"10px 12px", borderTop:"1px solid "+activeTheme.border, background:activeTheme.panel2}}>
                <SectionLabel>Edit Text</SectionLabel>
                <textarea value={selectedObjects[0].text} rows={3}
                  onChange={e=>setObjects(prev=>prev.map(o=>o.id===selectedObjects[0].id?{...o,text:e.target.value}:o))}
                  style={{width:"100%", boxSizing:"border-box", padding:"6px 8px", fontSize:11, borderRadius:6, border:"1px solid "+activeTheme.border, background:activeTheme.cBg, color:activeTheme.text, outline:"none", resize:"vertical"}}/>
              </div>
            )}
            <div style={{padding:"6px 12px",borderTop:"1px solid "+activeTheme.border,fontSize:10,color:activeTheme.muted,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span>{objects.length} object{objects.length!==1?"s":""}</span>
              <span>{selectedIds.length ? selectedIds.length+" selected" : "Del to remove · ⇧ to multi-select"}</span>
            </div>
          </div>
        </div>
      </div>
  );
}
