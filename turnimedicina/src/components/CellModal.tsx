import { useState } from "react";
import type { Medico, Turno } from "../engine/types";
import { MESI, DF, dowOf, isFestivo, isSabN, isDomN } from "../engine/date";
import { KC, TM, TS } from "./costanti";
import { Badge } from "./Badge";

// ─── CELL MODAL ───────────────────────────────────────────────────────────────
// Editor dei turni MANUALI di una cella (medico, giorno). I turni automatici
// esistenti vengono preservati al salvataggio.
export function CellModal({ medico, giorno, anno, mese, esistenti, onSalva, onClose }: {
  medico: Medico | undefined;
  giorno: number;
  anno: number;
  mese: number;
  esistenti: Turno[];
  onSalva: (t: Turno[]) => void;
  onClose: () => void;
}){
  const [sel,setSel] = useState<{tipo:string;sott:boolean}[]>(
    esistenti.filter(s=>s.man).map(s=>({tipo:s.tipo,sott:!!s.sott}))
  );
  const d   = dowOf(anno,mese,giorno);
  const h   = isFestivo(anno,mese,giorno);
  const sat = isSabN(d), dom = isDomN(d);

  const tog  = (tipo:string) => setSel(p=>{ const i=p.findIndex(s=>s.tipo===tipo); return i>=0?p.filter((_,j)=>j!==i):[...p,{tipo,sott:false}]; });
  const togS = (tipo:string) => setSel(p=>p.map(s=>s.tipo===tipo?{...s,sott:!s.sott}:s));
  const salva = () => { onSalva([...sel.map(s=>({tipo:s.tipo,sott:s.sott,man:true})),...esistenti.filter(s=>!s.man)]); onClose(); };
  const svuota = () => { onSalva([]); onClose(); };

  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.88)",display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"#08101e",border:"1px solid #1e3a5f",borderRadius:"14px",padding:"22px",width:"410px",boxShadow:"0 30px 80px #000"}}>
        <div style={{marginBottom:"14px"}}>
          <div style={{fontFamily:"monospace",fontWeight:700,fontSize:"14px",color:"#e2f0ff"}}>{medico?.nome}</div>
          <div style={{fontFamily:"monospace",fontSize:"11px",color:"#2d5a8a",marginTop:"2px"}}>
            {DF[d]} {giorno} {MESI[mese]} {anno}
            {h&&<span style={{color:"#ef4444",marginLeft:"8px",fontWeight:700}}>FESTIVO</span>}
            {sat&&!h&&<span style={{color:"#a78bfa",marginLeft:"8px"}}>SAB</span>}
            {dom&&<span style={{color:"#a78bfa",marginLeft:"8px"}}>DOM</span>}
          </div>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:"6px",marginBottom:"14px"}}>
          {TM.map(tipo=>{
            const s=sel.find(x=>x.tipo===tipo);
            const c=KC[tipo]||{bg:"#1f2937",t:"#6b7280",b:"#374151"};
            return (
              <div key={tipo} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"2px"}}>
                <button onClick={()=>tog(tipo)} style={{
                  background:s?c.bg:"#0d1117",color:s?c.t:"#374151",
                  border:`2px solid ${s?c.b:"#1e293b"}`,borderRadius:"6px",
                  padding:"5px 8px",fontFamily:"monospace",fontWeight:700,fontSize:"11px",
                  cursor:"pointer",minWidth:"38px",transition:"all .1s"
                }}>{tipo==="per11"?"p11":tipo}</button>
                {s&&TS.includes(tipo)&&(
                  <button onClick={()=>togS(tipo)} style={{
                    background:s.sott?"#1e3a5f":"transparent",color:s.sott?"#93c5fd":"#2d5a8a",
                    border:"1px solid #1e3a5f",borderRadius:"3px",fontSize:"8px",
                    padding:"1px 4px",cursor:"pointer",textDecoration:"underline",fontFamily:"monospace"
                  }}>u</button>
                )}
              </div>
            );
          })}
        </div>
        {sel.length>0&&(
          <div style={{background:"#030810",border:"1px solid #0f2035",borderRadius:"7px",
            padding:"7px 10px",marginBottom:"12px",display:"flex",gap:"4px",flexWrap:"wrap",alignItems:"center"}}>
            <span style={{color:"#2d5a8a",fontSize:"9px",marginRight:"4px"}}>Preview:</span>
            {sel.map((s,i)=><Badge key={i} tipo={s.tipo} sott={s.sott} man/>)}
          </div>
        )}
        <div style={{display:"flex",gap:"8px",justifyContent:"space-between"}}>
          <button onClick={svuota} style={{background:"#1a0606",color:"#f87171",border:"1px solid #7f1d1d",borderRadius:"7px",padding:"8px 14px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace",fontWeight:700}}>Svuota</button>
          <div style={{display:"flex",gap:"8px"}}>
            <button onClick={onClose} style={{background:"#0d1117",color:"#2d5a8a",border:"1px solid #1e293b",borderRadius:"7px",padding:"8px 14px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace"}}>Annulla</button>
            <button onClick={salva} style={{background:"#1d4ed8",color:"#fff",border:"none",borderRadius:"7px",padding:"8px 16px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace",fontWeight:700}}>Salva</button>
          </div>
        </div>
      </div>
    </div>
  );
}
