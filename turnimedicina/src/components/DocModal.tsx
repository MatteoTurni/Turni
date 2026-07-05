import { useState } from "react";
import type { Medico, Stato } from "../engine/types";

// ─── DOC MODAL ────────────────────────────────────────────────────────────────
// Creazione/modifica di un medico. `doc` senza id = nuovo medico; l'attribuzione
// dell'id e l'inserimento nella lista sono compito del chiamante (onSalva).
export type DocDraft = Omit<Medico, "id"> & { id?: number };

export function DocModal({ doc, onSalva, onClose }: {
  doc: DocDraft;
  onSalva: (f: DocDraft) => void;
  onClose: () => void;
}){
  const isN = !doc.id;
  const [f,setF] = useState<DocDraft>({...doc});
  const inp: React.CSSProperties = {width:"100%",background:"#030810",border:"1px solid #1e3a5f",color:"#e2f0ff",borderRadius:"7px",padding:"7px 10px",fontSize:"12px",fontFamily:"monospace",boxSizing:"border-box"};
  const salva = () => {
    if(!f.nome?.trim()) return;
    onSalva(f);
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
        <div style={{marginBottom:"16px",display:"flex",alignItems:"center",gap:"10px"}}>
          <input
            id="amb-check" type="checkbox"
            checked={!!f.ambulatorio}
            onChange={e=>setF(p=>({...p,ambulatorio:e.target.checked}))}
            style={{width:"16px",height:"16px",accentColor:"#10b981",cursor:"pointer"}}
          />
          <label htmlFor="amb-check" style={{color:"#34d399",fontSize:"11px",fontFamily:"monospace",cursor:"pointer",userSelect:"none"}}>
            Abilitato turni ambulatorio
          </label>
        </div>
        <div style={{display:"flex",gap:"8px",justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{background:"#0d1117",color:"#2d5a8a",border:"1px solid #1e293b",borderRadius:"7px",padding:"8px 14px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace"}}>Annulla</button>
          <button onClick={salva}   style={{background:"#1d4ed8",color:"#fff",border:"none",borderRadius:"7px",padding:"8px 16px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace",fontWeight:700}}>Salva</button>
        </div>
      </div>
    </div>
  );
}
