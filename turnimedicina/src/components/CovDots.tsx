import type { Regole } from "../engine/types";

// ─── COVERAGE DOTS ────────────────────────────────────────────────────────────
// Tre indicatori (M, P, N) di copertura della giornata. Le soglie arrivano dal
// pannello Regole (stessa fonte dell'engine, niente doppioni hardcoded).
export function CovDots({ mc, pc, nc, sp, sat, fabb }: {
  mc: number; pc: number; nc: number;
  sp: boolean; sat: boolean;
  fabb: Regole["fabb"];
}){
  const mn = sp?{mn:fabb.fest.mMin,mx:fabb.fest.mMax}:sat?{mn:fabb.sab.mMin,mx:fabb.sab.mMax}:{mn:fabb.fer.mMin,mx:fabb.fer.mMax};
  const pn = sp?{mn:fabb.fest.pMin,mx:fabb.fest.pMax}:sat?{mn:fabb.sab.pMin,mx:fabb.sab.pMax}:{mn:fabb.fer.pMin,mx:fabb.fer.pMax};
  const Dot = ({n,need}:{n:number;need:{mn:number;mx:number}}) => {
    const ok=n>=need.mn&&n<=need.mx, lo=n<need.mn;
    return <div style={{width:"16px",height:"7px",borderRadius:"2px",margin:"0.5px auto",
      background:n===0?"#111":ok?"#064e3b":lo?"#7f1d1d":"#78350f",
      border:`1px solid ${n===0?"#1f2937":ok?"#059669":lo?"#dc2626":"#d97706"}`,
      color:n===0?"#374151":ok?"#6ee7b7":lo?"#fca5a5":"#fde68a",
      fontSize:"6px",textAlign:"center",lineHeight:"7px",fontFamily:"monospace",fontWeight:700
    }}>{n||""}</div>;
  };
  return <div><Dot n={mc} need={mn}/><Dot n={pc} need={pn}/><Dot n={nc} need={{mn:1,mx:1}}/></div>;
}
