import type { Regole } from "./types";

// ─── REGOLE CONFIGURABILI ─────────────────────────────────────────────────────
// Fabbisogni giornalieri e limiti che prima erano costanti hardcoded. Il motore
// NON legge più localStorage: le regole correnti sono stato del modulo, che la
// UI imposta con setRegole() (al caricamento e a ogni modifica dal pannello
// "Regole"). L'engine le legge a OGNI creazione di contesto (makeCtx), quindi
// le modifiche valgono dalla generazione successiva. La NOTTE resta fissa a
// 1/giorno: è un invariante strutturale dell'engine (faseNotti assegna una
// notte per giorno), non un parametro.
export const REGOLE_DEFAULT: Regole = {
  maxNotti: 5,      // max notti/mese per medico
  maxNottiConsec: 2,// max notti "di fila" a passo 2 (N-libero-N-libero-N = 3 → vietato)
  maxConsec: 7,     // max giorni consecutivi di lavoro
  wkTarget: 2,      // obiettivo weekend liberi (resta ADATTIVO: è il tetto)
  maxAssSett: 2,    // max turni associati (M+P) per settimana per medico
  giorniAmb: [1],   // giorni di ambulatorio (0=Lun … 4=Ven): default martedì
  fabb: {
    fer:  { mMin:2, mMax:3, pMin:1, pMax:2 },  // feriale
    sab:  { mMin:2, mMax:2, pMin:1, pMax:1 },  // sabato
    fest: { mMin:1, mMax:1, pMin:1, pMax:1 },  // domenica/festivo
  },
};

const dft = (): Regole => JSON.parse(JSON.stringify(REGOLE_DEFAULT));

// Merge difensivo con i default: campi mancanti (versioni future) non rompono
// nulla. Usato dallo storage al caricamento, ma è logica pura → sta qui.
export function mergeRegole(s: Partial<Regole> | null | undefined): Regole {
  const d = dft();
  if(!s || typeof s!=="object") return d;
  // giorniAmb: campo ASSENTE (salvataggi pre-v0.3.8) → default [1] (martedì).
  // Campo PRESENTE → sanitizza: solo interi 0..4 (Lun-Ven), dedup, ordinati.
  // Un array presente ma vuoto è LEGITTIMO: significa "nessun ambulatorio".
  const gA = Array.isArray(s.giorniAmb)
    ? [...new Set(s.giorniAmb.filter(g=>Number.isInteger(g)&&g>=0&&g<=4))].sort((a,b)=>a-b)
    : d.giorniAmb;
  return { ...d, ...s, giorniAmb: gA, fabb:{
    fer: {...d.fabb.fer,  ...(s.fabb?.fer ||{})},
    sab: {...d.fabb.sab,  ...(s.fabb?.sab ||{})},
    fest:{...d.fabb.fest, ...(s.fabb?.fest||{})},
  }};
}

let REGOLE: Regole = dft();
export function setRegole(r: Regole){ REGOLE = mergeRegole(r); }
export function getRegole(): Regole { return REGOLE; }
