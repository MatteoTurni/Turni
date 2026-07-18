import type { Regole } from "../engine/types";

// Stato diagnostico di una fascia (v0.3.10):
//   "imp" = impossibilità CERTIFICATA dalla diagnosi statica (⊘, viola)
//   "mai" = mai coperta in NESSUN tentativo della generazione (⚠, ambra)
export type DiagFascia = "imp" | "mai";

// ─── COVERAGE DOTS ────────────────────────────────────────────────────────────
// Tre indicatori (M, P, N) di copertura della giornata. Le soglie arrivano dal
// pannello Regole (stessa fonte dell'engine, niente doppioni hardcoded).
// v0.3.13 — leggibilità: barrette 20×13 con font 10; nelle fasce SOTTO minimo
// il numero diventa "n/min" (quanto c'è / quanto serve), così il deficit è
// quantificato a colpo d'occhio. `diag` (opzionale): marca la fascia
// sotto-minimo come impossibile certificata (⊘) o mai coperta (⚠).
// `amb` (v0.3.13): SOLO nei giorni d'ambulatorio feriali il chiamante passa il
// codice del medico con la A (stringa) o null se la A manca → quarto
// quadratino: verde acqua col codice, rosso tratteggiato "A?" se scoperta.
// `undefined` = giorno senza ambulatorio: nessun quadratino extra.
export function CovDots({ mc, pc, nc, sp, sat, fabb, diag, amb }: {
  mc: number; pc: number; nc: number;
  sp: boolean; sat: boolean;
  fabb: Regole["fabb"];
  diag?: Partial<Record<"M"|"P"|"N", DiagFascia>>;
  amb?: string | null;
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
    // Sotto minimo (senza badge): deficit esplicito "n/min" a font ridotto.
    const testo = fl==="imp" ? "⊘" : fl==="mai" ? "⚠" : lo ? `${n}/${need.mn}` : (n||"");
    return <div title={fl==="imp"?"Impossibile: certificato dai turni manuali (vedi Diagnosi)"
                      :fl==="mai"?"Mai coperta in nessun tentativo di generazione (vedi Diagnosi)"
                      :lo?`Sotto il minimo: ${n} su ${need.mn}`:undefined}
      style={{width:"20px",height:"13px",borderRadius:"3px",margin:"1px auto",
      background:st?st.bg:n===0&&!lo?"#111":ok?"#064e3b":lo?"#7f1d1d":"#78350f",
      border:`1px solid ${st?st.bd:n===0&&!lo?"#1f2937":ok?"#059669":lo?"#dc2626":"#d97706"}`,
      color:st?st.tx:n===0&&!lo?"#374151":ok?"#6ee7b7":lo?"#fca5a5":"#fde68a",
      fontSize:lo&&!fl?"8px":"10px",textAlign:"center",lineHeight:"13px",fontFamily:"monospace",fontWeight:700
    }}>{testo}</div>;
  };
  return <div>
    <Dot n={mc} need={mn} dg={diag?.M}/><Dot n={pc} need={pn} dg={diag?.P}/><Dot n={nc} need={{mn:1,mx:1}} dg={diag?.N}/>
    {amb!==undefined && (amb
      ? <div title={"Ambulatorio assegnato: "+amb}
          style={{width:"20px",height:"13px",borderRadius:"3px",margin:"1px auto",background:"#052e2b",
          border:"1px solid #14b8a6",color:"#5eead4",fontSize:"8px",textAlign:"center",lineHeight:"13px",
          fontFamily:"monospace",fontWeight:700,overflow:"hidden"}}>{amb.slice(0,3)}</div>
      : <div title="Giorno d'ambulatorio SENZA medico assegnato alla A"
          style={{width:"20px",height:"13px",borderRadius:"3px",margin:"1px auto",background:"#3a0a0a",
          border:"1px dashed #ef4444",color:"#fca5a5",fontSize:"8px",textAlign:"center",lineHeight:"13px",
          fontFamily:"monospace",fontWeight:700}}>A?</div>)}
  </div>;
}
