import { KC } from "./costanti";

// ─── BADGE ────────────────────────────────────────────────────────────────────
// `lbl` (v0.3.36): etichetta da mostrare al posto del codice (es. la sigla
// dell'ambulatorio per A/Ap); i colori restano quelli del tipo.
export function Badge({ tipo, sott, man, lbl: lblIn }: { tipo?: string; sott?: boolean; man?: boolean; lbl?: string }){
  if(!tipo) return null;
  const c = KC[tipo]||{bg:"#1f2937",t:"#9ca3af",b:"#374151"};
  const lbl = lblIn ?? (tipo==="per11"?"p11":tipo);
  return (
    <span style={{
      display:"inline-flex",alignItems:"center",justifyContent:"center",
      background:c.bg,color:c.t,border:`1px solid ${c.b}`,
      borderRadius:"3px",fontSize:"9px",fontWeight:700,
      padding:"1px 3px",textDecoration:sott?"underline":"none",
      fontFamily:"monospace",minWidth:"17px",lineHeight:1.3,
      opacity:man?1:0.78,
    }}>{lbl}</span>
  );
}
