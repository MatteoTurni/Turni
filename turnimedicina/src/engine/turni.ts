import type { Turno, TurniMese } from "./types";

// ─── UTILITY TURNI ────────────────────────────────────────────────────────────
// I turni associati (M+P oppure A+P) NON sono un tipo a sé: sono sempre
// due turni distinti nella stessa giornata. Le utility considerano quindi
// solo i singoli codici di mattina, pomeriggio e notte.
export function isMatt(t:string){ return ["M","A","1"].includes(t); }
export function isPom(t:string) { return ["P","2"].includes(t); }
export function isNot(t:string) { return ["N","3"].includes(t); }
export function vt(t:string,u?:boolean): number {
  if(u)return 0;
  if(["N","3"].includes(t))return 2;
  if(["M","P","A","L","ANA","104","per11","1","2"].includes(t))return 1;
  return 0;
}

// ─── ESCLUSIONI ───────────────────────────────────────────────────────────────
// "X" esclude il medico dall'INTERA giornata. Le esclusioni PARZIALI (v0.3.30)
// bloccano UNA SOLA fascia: il medico resta disponibile per le altre.
//   Xm → niente mattina (M, A, 1)      Xp → niente pomeriggio (P, 2)
//   Xn → niente notte   (N, 3)
// Sono combinabili: Xm+Xp = "solo notte". Xm+Xp+Xn equivale a X (il CellModal
// normalizza la terna in X). Come X sono codici SPEC: non sono lavoro, valgono
// come riposo, pesano 0 e non finiscono nell'export Excel.
export const ESCL_PARZ = ["Xm","Xp","Xn"];
/** Il codice è un'esclusione (totale o parziale)? */
export function isEscl(t:string){ return t==="X" || ESCL_PARZ.includes(t); }
/** Il codice esclude la fascia f? "X" esclude tutto. */
export function escludeFascia(t:string, f:"M"|"P"|"N"){
  if(t==="X") return true;
  return t === (f==="M" ? "Xm" : f==="P" ? "Xp" : "Xn");
}
/** Fascia di appartenenza di un turno reale (null per i codici non-turno). */
export function fasciaDi(t:string): "M"|"P"|"N"|null {
  return isMatt(t) ? "M" : isPom(t) ? "P" : isNot(t) ? "N" : null;
}

// Codici "speciali": non sono lavoro (assenze/esclusioni) e valgono come riposo.
export const SPEC = ["X","Xm","Xp","Xn","ANA","per11","104","L"];

// ─── CLONAZIONE VELOCE DI T ───────────────────────────────────────────────────
// Sostituisce JSON.parse(JSON.stringify(T)) nei punti in cui serve una COPIA
// PIENA (snapshot "da conservare", copie di lavoro). È molto più veloce perché
// conosce la struttura. INVARIANTE su cui si appoggia: gli array `t` delle
// celle sono IMMUTABILI — l'unico scrittore del motore (st, in makeCtx)
// sostituisce sempre l'intero array, mai una mutazione in place. Per questo la
// copia può CONDIVIDERE gli array dei turni (copiando solo i due livelli di
// oggetto), senza rischi.
export function cloneT(src: TurniMese): TurniMese {
  const out: TurniMese = {};
  for(const id in src){
    const gsrc = src[id]; if(!gsrc) continue;
    const gi: Record<string,{t:Turno[]}> = {};
    for(const g in gsrc){
      const c = gsrc[g];
      if(!c || !Array.isArray(c.t)) continue;
      gi[g] = { t: c.t };
    }
    out[id] = gi;
  }
  return out;
}

// Copia PROFONDA (anche i singoli turni): usata quando il risultato esce dal
// motore verso l'esterno (UI/localStorage), per non condividere riferimenti.
export function cloneTDeep(src: TurniMese): TurniMese {
  const out: TurniMese = {};
  for(const id in src){
    const gsrc = src[id]; if(!gsrc) continue;
    const gi: Record<string,{t:Turno[]}> = {};
    for(const g in gsrc){
      const c = gsrc[g];
      if(!c || !Array.isArray(c.t)) continue;
      gi[g] = { t: c.t.map(s=>({ tipo:s.tipo, sott:!!s.sott, man:!!s.man })) };
    }
    out[id] = gi;
  }
  return out;
}

// Rimuove le celle vuote ({t:[]}) che il restore-per-diff può lasciare in T:
// per il motore sono equivalenti a celle assenti, ma sporcherebbero il
// localStorage. Chiamata solo sui risultati in uscita.
export function pulisciT(T: TurniMese): TurniMese {
  for(const id in T){
    const gi = T[id];
    for(const g in gi){ if(!gi[g] || !gi[g].t || gi[g].t.length===0) delete gi[g]; }
    if(Object.keys(gi).length===0) delete T[id];
  }
  return T;
}
