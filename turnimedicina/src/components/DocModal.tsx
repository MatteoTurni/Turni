import { useState } from "react";
import type { Medico, Stato, Ambulatorio } from "../engine/types";
import { abilitatoAmb } from "../engine/turni";

// ─── DOC MODAL ────────────────────────────────────────────────────────────────
// Creazione/modifica di un medico. `doc` senza id = nuovo medico; l'attribuzione
// dell'id e l'inserimento nella lista sono compito del chiamante (onSalva).
export type DocDraft = Omit<Medico, "id"> & { id?: number };

export function DocModal({ doc, ambulatori, onSalva, onClose }: {
  doc: DocDraft;
  ambulatori: Ambulatorio[];
  onSalva: (f: DocDraft) => void;
  onClose: () => void;
}){
  const isN = !doc.id;
  // Abilitazioni materializzate (il vecchio flag diventa la lista esplicita).
  const [f,setF] = useState<DocDraft>(()=>{
    const attivi = ambulatori.filter(a=>abilitatoAmb({...doc,id:0} as Medico,a.id)).map(a=>a.id);
    // id di ambulatori non più esistenti: si conservano ma non contano.
    const orfani = (doc.ambulatori??[]).filter(id=>!ambulatori.some(a=>a.id===id));
    return {...doc, ambulatori:[...attivi,...orfani], ambulatorio: attivi.length>0};
  });
  const togAmb = (id:string) => setF(p=>{
    const cur = p.ambulatori ?? [];
    const ids = cur.includes(id) ? cur.filter(x=>x!==id) : [...cur,id];
    return {...p, ambulatori:ids, ambulatorio: ids.some(x=>ambulatori.some(a=>a.id===x))};
  });
  const inp: React.CSSProperties = {width:"100%",background:"#030810",border:"1px solid #1e3a5f",color:"#e2f0ff",borderRadius:"7px",padding:"7px 10px",fontSize:"12px",fontFamily:"monospace",boxSizing:"border-box"};
  const salva = () => {
    if(!f.nome?.trim()) return;
    // Il limite di turni associati e l'esenzione dalle notti valgono solo per MR e decreto Calabria.
    const out = {...f};
    if(!(out.stato==="MR"||out.stato==="MDC")){ delete out.maxAssMese; delete out.noNotti; }
    if(!out.noNotti) delete out.noNotti;
    onSalva(out);
    onClose();
  };
  const campi: [string, "nome"|"codice"|"obiettivo", string][] = [["Nome","nome","text"],["Codice","codice","text"],["Obiettivo","obiettivo","number"]];
  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.88)",display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"#08101e",border:"1px solid #1e3a5f",borderRadius:"14px",padding:"22px",width:"340px",boxShadow:"0 30px 80px #000"}}>
        <div style={{fontFamily:"monospace",fontWeight:700,color:"#e2f0ff",marginBottom:"16px",fontSize:"14px"}}>
          {isN?"➕ Nuovo medico":"✏ Modifica medico"}
        </div>
        {campi.map(([l,k,t])=>(
          <div key={k} style={{marginBottom:"11px"}}>
            <label style={{color:"#2d5a8a",fontSize:"10px",fontFamily:"monospace",display:"block",marginBottom:"3px"}}>{l}</label>
            <input type={t} value={f[k]??""} style={inp}
              onChange={e=>setF(p=>({...p,[k]:t==="number"?+e.target.value:e.target.value}))}/>
          </div>
        ))}
        <div style={{marginBottom:"16px"}}>
          <label style={{color:"#2d5a8a",fontSize:"10px",fontFamily:"monospace",display:"block",marginBottom:"3px"}}>Stato</label>
          <select value={f.stato} style={inp} onChange={e=>setF(p=>({...p,stato:e.target.value as Stato}))}>
            <option value="MR">MR — Medico Regolare</option>
            <option value="ML">ML — Con Limitazioni</option>
            <option value="MDC">MDC — Decreto Calabria</option>
            <option value="MPS">MPS — Pronto Soccorso</option>
          </select>
        </div>
        {(f.stato==="MR"||f.stato==="MDC") && (
          <div style={{marginBottom:"16px"}}>
            <label htmlFor="max-ass-mese" style={{color:"#2d5a8a",fontSize:"10px",fontFamily:"monospace",display:"block",marginBottom:"3px"}}>Max turni associati al mese</label>
            <input id="max-ass-mese" type="number" min={0} value={f.maxAssMese ?? ""} placeholder="nessun limite" style={inp}
              onChange={e=>{ const v=e.target.value; setF(p=>({...p, maxAssMese: v==="" ? undefined : Math.max(0, Math.floor(+v))})); }}/>
            <div style={{color:"#3d5878",fontSize:"9px",fontFamily:"monospace",marginTop:"3px"}}>Giorni con mattina e pomeriggio, anche di PS o sottolineati. Vuoto = nessun limite.</div>
          </div>
        )}
        {(f.stato==="MR"||f.stato==="MDC") && (
          <div style={{marginBottom:"16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
              <input id="no-notti" type="checkbox" checked={!!f.noNotti}
                onChange={e=>setF(p=>({...p, noNotti: e.target.checked}))}
                style={{width:"16px",height:"16px",accentColor:"#8b5cf6",cursor:"pointer"}}/>
              <label htmlFor="no-notti" style={{color:"#c4b5fd",fontSize:"11px",fontFamily:"monospace",cursor:"pointer",userSelect:"none"}}>Esentato dalle notti</label>
            </div>
            <div style={{color:"#3d5878",fontSize:"9px",fontFamily:"monospace",marginTop:"3px"}}>Il motore non gli assegna notti; quelle messe a mano restano. Tolta la spunta, le notti non fatte non si recuperano.</div>
          </div>
        )}
        <div style={{marginBottom:"16px"}}>
          <label style={{color:"#2d5a8a",fontSize:"10px",fontFamily:"monospace",display:"block",marginBottom:"5px"}}>Abilitato agli ambulatori</label>
          {ambulatori.length===0 && <div style={{color:"#3d5878",fontSize:"10px",fontFamily:"monospace"}}>Nessun ambulatorio configurato (pannello Regole).</div>}
          {ambulatori.map(a=>(
            <div key={a.id} style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"5px"}}>
              <input id={"amb-"+a.id} type="checkbox"
                checked={(f.ambulatori??[]).includes(a.id)}
                disabled={f.stato==="MPS"}
                onChange={()=>togAmb(a.id)}
                style={{width:"16px",height:"16px",accentColor:"#10b981",cursor:"pointer"}}/>
              <label htmlFor={"amb-"+a.id} style={{color:"#34d399",fontSize:"11px",fontFamily:"monospace",cursor:"pointer",userSelect:"none"}}>
                {a.nome} <span style={{color:"#6ee7b7",fontWeight:700}}>({a.sigla})</span>
              </label>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:"8px",justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{background:"#0d1117",color:"#2d5a8a",border:"1px solid #1e293b",borderRadius:"7px",padding:"8px 14px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace"}}>Annulla</button>
          <button onClick={salva}   style={{background:"#1d4ed8",color:"#fff",border:"none",borderRadius:"7px",padding:"8px 16px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace",fontWeight:700}}>Salva</button>
        </div>
      </div>
    </div>
  );
}
