import type { Regole } from "../engine/types";

// Stato diagnostico di una fascia (v0.3.10):
//   "imp" = impossibilità CERTIFICATA dalla diagnosi statica (⊘, viola)
//   "mai" = mai coperta in NESSUN tentativo della generazione (⚠, ambra)
export type DiagFascia = "imp" | "mai";

// ─── COVERAGE DOTS ────────────────────────────────────────────────────────────
// Tre indicatori (M, P, N) di copertura della giornata. Le soglie arrivano dal
// pannello Regole (stessa fonte dell'engine, niente doppioni hardcoded).
// `diag` (opzionale): marca la fascia sotto-minimo come impossibile certificata
// (⊘) o mai coperta empiricamente (⚠) — solo grafica, calcolata dal chiamante.
export function CovDots({ mc, pc, nc, sp, sat, fabb, diag }: {
  mc: number; pc: number; nc: number;
  sp: boolean; sat: boolean;
  fabb: Regole["fabb"];
  diag?: Partial<Record<"M"|"P"|"N", DiagFascia>>;
}){
  const mn = sp?{mn:fabb.fest.mMin,mx:fabb.fest.mMax}:sat?{mn:fabb.sab.mMin,mx:fabb.sab.mMax}:{mn:fabb.fer.mMin,mx:fabb.fer.mMax};
  const pn = sp?{mn:fabb.fest.pMin,mx:fabb.fest.pMax}:sat?{mn:fabb.sab.pMin,mx:fabb.sab.pMax}:{mn:fabb.fer.pMin,mx:fabb.fer.pMax};
  const Dot = ({n,need,dg}:{n:number;need:{mn:number;mx:number};dg?:DiagFascia}) => {
    const ok=n>=need.mn&&n<=need.mx, lo=n<need.mn;
    // Il badge diagnostico vale solo se la fascia è davvero sotto-minimo.
    const fl = lo ? dg : undefined;
    const st = fl==="imp" ? {bg:"#1f1330",bd:"#7c3aed",tx:"#c4b5fd"}
             : fl==="mai" ? {bg:"#3a2705",bd:"#d97706",tx:"#fde68a"}
             : null;
    return <div title={fl==="imp"?"Impossibile: certificato dai turni manuali (vedi Diagnosi)"
                      :fl==="mai"?"Mai coperta in nessun tentativo di generazione (vedi Diagnosi)":undefined}
      style={{width:"16px",height:"7px",borderRadius:"2px",margin:"0.5px auto",
      background:st?st.bg:n===0?"#111":ok?"#064e3b":lo?"#7f1d1d":"#78350f",
      border:`1px solid ${st?st.bd:n===0?"#1f2937":ok?"#059669":lo?"#dc2626":"#d97706"}`,
      color:st?st.tx:n===0?"#374151":ok?"#6ee7b7":lo?"#fca5a5":"#fde68a",
      fontSize:"6px",textAlign:"center",lineHeight:"7px",fontFamily:"monospace",fontWeight:700
    }}>{fl==="imp"?"⊘":fl==="mai"?"⚠":(n||"")}</div>;
  };
  return <div><Dot n={mc} need={mn} dg={diag?.M}/><Dot n={pc} need={pn} dg={diag?.P}/><Dot n={nc} need={{mn:1,mx:1}} dg={diag?.N}/></div>;
}
