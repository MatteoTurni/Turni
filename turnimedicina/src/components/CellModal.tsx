import { useState } from "react";
import type { Medico, Turno, Ambulatorio } from "../engine/types";
import { MESI, DF, dowOf, isFestivo, isSabN, isDomN } from "../engine/date";
import { KC, TM, TS } from "./costanti";
import { ESCL_PARZ, isEscl, escludeFascia, fasciaDi, isAmbT, ambIdDi, etichettaTurno } from "../engine/turni";
import { Badge } from "./Badge";

// ─── CELL MODAL ───────────────────────────────────────────────────────────────
// Editor dei turni MANUALI di una cella (medico, giorno). I turni automatici
// esistenti vengono preservati al salvataggio.
type Sel = { tipo:string; sott:boolean; amb?:string };

export function CellModal({ medico, giorno, anno, mese, esistenti, ambulatori, onSalva, onClose }: {
  medico: Medico | undefined;
  giorno: number;
  anno: number;
  mese: number;
  esistenti: Turno[];
  ambulatori: Ambulatorio[];
  onSalva: (t: Turno[]) => void;
  onClose: () => void;
}){
  const [sel,setSel] = useState<Sel[]>(
    esistenti.filter(s=>s.man).map(s=>({tipo:s.tipo,sott:!!s.sott,...(isAmbT(s.tipo)?{amb:ambIdDi(s)}:{})}))
  );
  // Stesso turno? Per A/Ap conta anche l'ambulatorio.
  const eq = (s:Sel, tipo:string, amb?:string) => s.tipo===tipo && (!isAmbT(tipo) || ambIdDi(s)===amb);
  const d   = dowOf(anno,mese,giorno);
  const h   = isFestivo(anno,mese,giorno);
  const sat = isSabN(d), dom = isDomN(d);

  // ── SELEZIONE COERENTE (v0.3.30) ────────────────────────────────────────────
  // Le esclusioni non possono convivere né fra loro né col turno che negano:
  //  · X esclude tutto ⇒ toglie Xm/Xp/Xn (e viceversa);
  //  · Xm+Xp+Xn insieme ≡ X ⇒ la terna collassa in X;
  //  · aggiungere Xm toglie gli eventuali M/A/1 già selezionati, e aggiungere
  //    una M toglie l'Xm. Senza questo si potrebbe salvare "M + Xm", che il
  //    motore risolverebbe in silenzio (il manuale vince) lasciando però in
  //    tabellone una cella che dice una cosa e ne fa un'altra.
  const tog  = (tipo:string, amb?:string) => setSel(p=>{
    if(p.some(s=>eq(s,tipo,amb))) return p.filter(s=>!eq(s,tipo,amb));
    // Una sola A (e una sola Ap) per giorno: scegliere un altro ambulatorio
    // nella stessa fascia sostituisce il precedente.
    let next: Sel[] = [...p.filter(s=>!(isAmbT(tipo) && s.tipo===tipo)),{tipo,sott:false,...(amb?{amb}:{})}];
    if(isEscl(tipo)){
      if(tipo==="X") next = next.filter(s=>!ESCL_PARZ.includes(s.tipo));
      else           next = next.filter(s=>s.tipo!=="X");
      next = next.filter(s=>{ const f=fasciaDi(s.tipo); return !f || !escludeFascia(tipo,f); });
      if(ESCL_PARZ.every(t=>next.some(s=>s.tipo===t)))
        next = [...next.filter(s=>!ESCL_PARZ.includes(s.tipo)),{tipo:"X",sott:false}];
    } else {
      const f = fasciaDi(tipo);
      if(f) next = next.filter(s=>!escludeFascia(s.tipo,f));
    }
    return next;
  });
  const togS = (tipo:string) => setSel(p=>p.map(s=>s.tipo===tipo?{...s,sott:!s.sott}:s));
  const salva = () => {
    // I turni automatici restano, salvo quelli nella stessa fascia di un'A/Ap
    // manuale appena scelta (il medico non può fare due ambulatori insieme).
    const auto = esistenti.filter(s=>!s.man && !(isAmbT(s.tipo) && sel.some(x=>x.tipo===s.tipo)));
    onSalva([...sel.map(s=>({tipo:s.tipo,sott:s.sott,man:true,...(s.amb?{amb:s.amb}:{})})),...auto]);
    onClose();
  };
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
          {TM.filter(t=>!isAmbT(t)).map(tipo=>{
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
        {ambulatori.length>0&&(
          <div style={{marginBottom:"14px"}}>
            <div style={{color:"#2d5a8a",fontSize:"9px",fontFamily:"monospace",marginBottom:"5px"}}>AMBULATORI (mattina · pomeriggio)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
              {ambulatori.flatMap(a=>["A","Ap"].map(tipo=>{
                const on = sel.some(x=>eq(x,tipo,a.id));
                const c = KC[tipo];
                const lbl = a.sigla+(tipo==="Ap"?"p":"");
                return (
                  <button key={a.id+tipo} onClick={()=>tog(tipo,a.id)}
                    title={`${a.nome} — ${tipo==="Ap"?"pomeriggio":"mattina"}`}
                    style={{background:on?c.bg:"#0d1117",color:on?c.t:"#374151",
                      border:`2px solid ${on?c.b:"#1e293b"}`,borderRadius:"6px",
                      padding:"5px 8px",fontFamily:"monospace",fontWeight:700,fontSize:"11px",
                      cursor:"pointer",minWidth:"38px"}}>{lbl}</button>
                );
              }))}
            </div>
          </div>
        )}
        {sel.length>0&&(
          <div style={{background:"#030810",border:"1px solid #0f2035",borderRadius:"7px",
            padding:"7px 10px",marginBottom:"12px",display:"flex",gap:"4px",flexWrap:"wrap",alignItems:"center"}}>
            <span style={{color:"#2d5a8a",fontSize:"9px",marginRight:"4px"}}>Preview:</span>
            {sel.map((s,i)=><Badge key={i} tipo={s.tipo} sott={s.sott} man lbl={etichettaTurno(s,ambulatori)}/>)}
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
