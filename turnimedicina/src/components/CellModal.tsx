import { useState } from "react";
import type { Medico, Turno, Ambulatorio } from "../engine/types";
import { MESI, DF, dowOf, isFestivo, isSabN, isDomN } from "../engine/date";
import { KC, TM, TS } from "./costanti";
import { ESCL_PARZ, isEscl, isLicenza, escludeFascia, fasciaDi, isAmbT, ambIdDi, etichettaTurno } from "../engine/turni";
import { Badge } from "./Badge";

// ─── CELL MODAL ───────────────────────────────────────────────────────────────
// Editor dei turni MANUALI di una cella (medico, giorno). I turni automatici
// esistenti vengono preservati al salvataggio.
type Sel = { tipo:string; sott:boolean; amb?:string; est?:boolean };
// Turni PS che si possono svolgere in altro ospedale (v0.3.45).
const PS_EST = ["1","2","3"];

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
    esistenti.filter(s=>s.man).map(s=>({tipo:s.tipo,sott:!!s.sott,...(isAmbT(s.tipo)?{amb:ambIdDi(s)}:{}),...(s.est?{est:true}:{})}))
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
  const togE = (tipo:string) => setSel(p=>p.map(s=>s.tipo===tipo?{...s,est:!s.est}:s));
  const salva = () => {
    // I turni automatici restano, salvo quelli nella stessa fascia di un'A/Ap
    // manuale appena scelta (il medico non può fare due ambulatori insieme).
    const auto = esistenti.filter(s=>!s.man && !(isAmbT(s.tipo) && sel.some(x=>x.tipo===s.tipo)));
    onSalva([...sel.map(s=>({tipo:s.tipo,sott:s.sott,man:true,...(s.amb?{amb:s.amb}:{}),...(s.est&&PS_EST.includes(s.tipo)?{est:true}:{})})),...auto]);
    onClose();
  };
  const svuota = () => { onSalva([]); onClose(); };

  // GRUPPI DI PULSANTI (v0.3.49): turni lavorati, ambulatori, licenze/permessi,
  // esclusioni — solo una separazione visiva, la logica di selezione non cambia.
  const gruppo = (titolo:string, tipi:string[]) => (
    <div key={titolo} style={{marginBottom:"12px"}}>
          <div style={{color:"#64748b",fontSize:"9px",fontFamily:"monospace",marginBottom:"5px"}}>{titolo}</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
          {tipi.map(tipo=>{
            const s=sel.find(x=>x.tipo===tipo);
            const c=KC[tipo]||{bg:"#e2e8f0",t:"#7f8694",b:"#94a3b8"};
            return (
              <div key={tipo} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"2px"}}>
                <button onClick={()=>tog(tipo)} style={{
                  background:s?c.bg:"#ffffff",color:s?c.t:(c.t==="#ffffff"?c.bg:c.t),
                  border:`2px solid ${s?c.b:"#e2e8f0"}`,borderRadius:"6px",
                  padding:"5px 8px",fontFamily:"monospace",fontWeight:700,fontSize:"11px",
                  cursor:"pointer",minWidth:"38px",transition:"all .1s"
                }}>{tipo==="per11"?"p11":tipo==="art37"?"a37":tipo}</button>
                {s&&TS.includes(tipo)&&(
                  <button onClick={()=>togS(tipo)} style={{
                    background:s.sott?"#e2e8f0":"transparent",color:s.sott?"#2563eb":"#64748b",
                    border:"1px solid #e2e8f0",borderRadius:"3px",fontSize:"8px",
                    padding:"1px 4px",cursor:"pointer",textDecoration:"underline",fontFamily:"monospace"
                  }}>u</button>
                )}
                {s&&PS_EST.includes(tipo)&&(
                  <button onClick={()=>togE(tipo)} title="Turno PS svolto in altro ospedale: non affianca l'MDC"
                    style={{
                    background:s.est?"#fffbeb":"transparent",color:s.est?"#b45309":"#64748b",
                    border:"1px solid #e2e8f0",borderRadius:"3px",fontSize:"8px",
                    padding:"1px 4px",cursor:"pointer",fontFamily:"monospace"
                  }}>altro osp.</button>
                )}
              </div>
            );
          })}
          </div>
        </div>
  );

  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(15,23,42,.35)",display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:"14px",padding:"22px",width:"410px",boxShadow:"0 30px 80px #0f172a26"}}>
        <div style={{marginBottom:"14px"}}>
          <div style={{fontFamily:"monospace",fontWeight:700,fontSize:"14px",color:"#0f172a"}}>{medico?.nome}</div>
          <div style={{fontFamily:"monospace",fontSize:"11px",color:"#64748b",marginTop:"2px"}}>
            {DF[d]} {giorno} {MESI[mese]} {anno}
            {h&&<span style={{color:"#dc2626",marginLeft:"8px",fontWeight:700}}>FESTIVO</span>}
            {sat&&!h&&<span style={{color:"#6d28d9",marginLeft:"8px"}}>SAB</span>}
            {dom&&<span style={{color:"#6d28d9",marginLeft:"8px"}}>DOM</span>}
          </div>
        </div>
        {gruppo("TURNI", TM.filter(t=>!isAmbT(t) && !isLicenza(t) && !isEscl(t)))}
        {ambulatori.length>0&&(
          <div style={{marginBottom:"14px"}}>
            <div style={{color:"#64748b",fontSize:"9px",fontFamily:"monospace",marginBottom:"5px"}}>AMBULATORI (mattina · pomeriggio)</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
              {ambulatori.flatMap(a=>["A","Ap"].map(tipo=>{
                const on = sel.some(x=>eq(x,tipo,a.id));
                const c = KC[tipo];
                const lbl = a.sigla+(tipo==="Ap"?"p":"");
                return (
                  <button key={a.id+tipo} onClick={()=>tog(tipo,a.id)}
                    title={`${a.nome} — ${tipo==="Ap"?"pomeriggio":"mattina"}`}
                    style={{background:on?c.bg:"#ffffff",color:on?c.t:"#94a3b8",
                      border:`2px solid ${on?c.b:"#e2e8f0"}`,borderRadius:"6px",
                      padding:"5px 8px",fontFamily:"monospace",fontWeight:700,fontSize:"11px",
                      cursor:"pointer",minWidth:"38px"}}>{lbl}</button>
                );
              }))}
            </div>
          </div>
        )}
        {gruppo("LICENZE E PERMESSI", TM.filter(t=>isLicenza(t)))}
        {gruppo("ESCLUSIONI", TM.filter(t=>isEscl(t)))}
        {sel.length>0&&(
          <div style={{background:"#ffffff",border:"1px solid #f1f5f9",borderRadius:"7px",
            padding:"7px 10px",marginBottom:"12px",display:"flex",gap:"4px",flexWrap:"wrap",alignItems:"center"}}>
            <span style={{color:"#64748b",fontSize:"9px",marginRight:"4px"}}>Preview:</span>
            {sel.map((s,i)=><Badge key={i} tipo={s.tipo} sott={s.sott} man lbl={etichettaTurno(s,ambulatori)}/>)}
          </div>
        )}
        <div style={{display:"flex",gap:"8px",justifyContent:"space-between"}}>
          <button onClick={svuota} style={{background:"#fff1f2",color:"#be123c",border:"1px solid #fecdd3",borderRadius:"7px",padding:"8px 14px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace",fontWeight:700}}>Svuota</button>
          <div style={{display:"flex",gap:"8px"}}>
            <button onClick={onClose} style={{background:"#ffffff",color:"#64748b",border:"1px solid #e2e8f0",borderRadius:"7px",padding:"8px 14px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace"}}>Annulla</button>
            <button onClick={salva} style={{background:"#1d4ed8",color:"#fff",border:"none",borderRadius:"7px",padding:"8px 16px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace",fontWeight:700}}>Salva</button>
          </div>
        </div>
      </div>
    </div>
  );
}
