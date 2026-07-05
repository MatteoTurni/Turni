import { KC } from "./costanti";

// ─── BADGE ────────────────────────────────────────────────────────────────────
export function Badge({ tipo, sott, man }: { tipo?: string; sott?: boolean; man?: boolean }){
  if(!tipo) return null;
  const c = KC[tipo]||{bg:"#1f2937",t:"#9ca3af",b:"#374151"};
  const lbl = tipo==="per11"?"p11":tipo;
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
