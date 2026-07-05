import type { TurniAll, TurniMese } from "./types";
import { mkKey, dimOf } from "./date";

// ─── STATO MUTABILE DEL MOTORE ────────────────────────────────────────────────
// Raccolto in un unico oggetto (i binding `let` esportati non sono assegnabili
// dagli altri moduli ES). Nessun accesso a localStorage/DOM: tutto ciò che
// prima veniva letto dall'esterno ora viene INIETTATO dalla UI (o dai test)
// prima di una generazione.
export const ENG = {
  // GEN_SALT: sale globale iniettato in ogni RNG. Cambiandolo prima di una
  // generazione, TUTTE le fasi esplorano un ordine casuale diverso pur restando
  // internamente riproducibili. È il meccanismo alla base del multi-tentativo.
  // Con SALT=0 il comportamento è deterministico.
  SALT: 0,

  // PREV: coda del mese PRECEDENTE (sola lettura) per la CONTINUITÀ FRA MESI.
  // postN1/postN2 (Regola N), runConsec (max consecutivi) e canAssDist leggono
  // gli ultimi giorni del mese M-1. null = nessun mese precedente salvato.
  // I turni di M-1 NON vengono mai modificati.
  PREV: null as null | { ndim: number; T: TurniMese },

  // Budget interni della generazione, regolabili per abilitare i random restart.
  BT: 60,               // backtrack massimi nell'orchestratore
  TRIES: 20,            // retry per singola fase
  CLUSTER_NODES: 50000, // tetto nodi backtracking cluster critici
  REBAL_NODES: 200000,  // tetto nodi riequilibrio weekend

  // Indice di partenza della rotazione round-robin dell'ambulatorio. Prima
  // faseAmbulatorio leggeva/scriveva localStorage AD OGNI assegnazione: la
  // rotazione avanzava anche nei tentativi poi SCARTATI dal multi-tentativo
  // (iniquità) e il motore non era isolabile. Ora: la UI imposta l'indice qui
  // prima di generare; il motore lo usa in sola lettura; l'avanzamento viene
  // ricalcolato dal SOLO tabellone accettato (vedi calcAmbRotNext in genera.ts)
  // e persistito dalla UI.
  AMB_ROT_START: 0,
};

export function setPrevContext(turniAll: TurniAll | null | undefined, anno: number, mese: number){
  const py = mese===0 ? anno-1 : anno;
  const pm = mese===0 ? 11 : mese-1;
  const T  = turniAll?.[mkKey(py,pm)];
  ENG.PREV = T ? { ndim: dimOf(py,pm), T } : null;
}

export function setAmbRotStart(idx: number){ ENG.AMB_ROT_START = Number.isFinite(idx) ? idx : 0; }
export function setSalt(s: number){ ENG.SALT = s>>>0; }

// ─── RNG deterministico (per retry/backtracking variati) ─────────────────────
export function mkRng(seed: number){
  let s=(((seed>>>0) ^ (ENG.SALT>>>0))>>>0)||0x9e3779b9;
  return ()=>{ s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296; };
}
export function shuf<T>(arr: readonly T[], rng: ()=>number): T[] {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
