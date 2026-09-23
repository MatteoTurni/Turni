import type { Regole, Ambulatorio, FasciaAmb } from "./types";

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
  notteLiberoNotte: false, // N-libero-N in generazione base: OFF = solo ultima chance (storico)
  riposoEsteso: false, // dopo la notte anche g+2 completamente libero (vince su tutto): OFF = storico
  mattinaDopoNotte: false, // M ammessa a g+2 dopo una notte: OFF = storico (a g+2 niente M)
  maxConsec: 7,     // max giorni consecutivi di lavoro
  wkTarget: 2,      // obiettivo weekend liberi (resta ADATTIVO: è il tetto)
  maxAssSett: 2,    // max turni associati (M+P) per settimana per medico
  blocchiMattina: 4,// catena di continuità mattine: blocchi da ~4 giorni (0 = off)
  // Ambulatori (v0.3.36): default un solo ambulatorio il martedì mattina.
  ambulatori: [{ id:"A", nome:"Ambulatorio", sigla:"A", giorni:{ 1:"M" } }],
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
  const amb = sanaAmbulatori(s);
  // notteLiberoNotte: campo ASSENTE (salvataggi pre-v0.3.11) → default false;
  // presente ma non boolean → coercizione difensiva.
  const nLN = s.notteLiberoNotte===undefined ? d.notteLiberoNotte : !!s.notteLiberoNotte;
  // riposoEsteso: campo ASSENTE (salvataggi pre-v0.3.16) → default false.
  const rE  = s.riposoEsteso===undefined ? d.riposoEsteso : !!s.riposoEsteso;
  // mattinaDopoNotte: campo ASSENTE (salvataggi pre-v0.3.33) → default false.
  const mDN = s.mattinaDopoNotte===undefined ? d.mattinaDopoNotte : !!s.mattinaDopoNotte;
  // blocchiMattina: campo ASSENTE (salvataggi pre-v0.3.17) → default; presente
  // ma non intero ≥ 0 → default. Lo 0 è LEGITTIMO: catena disattivata.
  const bM  = Number.isInteger(s.blocchiMattina) && (s.blocchiMattina as number)>=0
    ? (s.blocchiMattina as number) : d.blocchiMattina;
  const { giorniAmb: _gA, fasceAmb: _fA, ...resto } = s;
  return { ...d, ...resto, ambulatori: amb, notteLiberoNotte: nLN, riposoEsteso: rE,
           mattinaDopoNotte: mDN, blocchiMattina: bM, fabb:{
    fer: {...d.fabb.fer,  ...(s.fabb?.fer ||{})},
    sab: {...d.fabb.sab,  ...(s.fabb?.sab ||{})},
    fest:{...d.fabb.fest, ...(s.fabb?.fest||{})},
  }};
}

// ── AMBULATORI ────────────────────────────────────────────────────────────────
const FASCE_OK = new Set<FasciaAmb>(["M","P","MP"]);
function sanaGiorni(x: unknown): Partial<Record<number,FasciaAmb>> {
  const out: Partial<Record<number,FasciaAmb>> = {};
  if(!x || typeof x!=="object") return out;
  for(const [k,v] of Object.entries(x)){
    const d0=+k;
    if(Number.isInteger(d0)&&d0>=0&&d0<=4&&FASCE_OK.has(v as FasciaAmb)) out[d0]=v as FasciaAmb;
  }
  return out;
}
/** Sigla di ripiego: prime 3 lettere del nome, maiuscole. */
export function siglaDaNome(nome: string): string {
  const s = (nome||"").replace(/[^A-Za-zÀ-ÿ0-9 ]/g,"").trim().toUpperCase();
  return (s.replace(/ /g,"").slice(0,3)) || "A";
}
// `ambulatori` PRESENTE (array) → sanificato (id unici, sigla non vuota).
// ASSENTE (salvataggi pre-v0.3.36) → un unico ambulatorio "A" costruito dai
// vecchi giorniAmb (assente → martedì) e fasceAmb (assente → mattina).
function sanaAmbulatori(s: Partial<Regole>): Ambulatorio[] {
  if(Array.isArray(s.ambulatori)){
    const visti = new Set<string>();
    const out: Ambulatorio[] = [];
    for(const a of s.ambulatori){
      if(!a || typeof a!=="object" || typeof a.id!=="string" || !a.id || visti.has(a.id)) continue;
      visti.add(a.id);
      const nome = typeof a.nome==="string" && a.nome.trim() ? a.nome.trim() : "Ambulatorio";
      const sigla = typeof a.sigla==="string" && a.sigla.trim() ? a.sigla.trim().slice(0,5) : siglaDaNome(nome);
      out.push({ id:a.id, nome, sigla, giorni: sanaGiorni(a.giorni) });
    }
    return out;
  }
  const gA = Array.isArray(s.giorniAmb)
    ? [...new Set(s.giorniAmb.filter(g=>Number.isInteger(g)&&g>=0&&g<=4))]
    : [1];
  const fA = sanaGiorni(s.fasceAmb);
  const giorni: Partial<Record<number,FasciaAmb>> = {};
  for(const g of gA) giorni[g] = fA[g] ?? "M";
  return [{ id:"A", nome:"Ambulatorio", sigla:"A", giorni }];
}

let REGOLE: Regole = dft();
export function setRegole(r: Regole){ REGOLE = mergeRegole(r); }
export function getRegole(): Regole { return REGOLE; }
