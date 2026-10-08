import type { Regole, Ambulatorio, FasciaAmb, OccAmb, Reparto, FestivoLocale, AffiancamentoPS } from "./types";
import { setFestiviLocali } from "./date";

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
  // Scheda reparto (v0.3.44): valori storici del reparto d'origine.
  reparto: {
    azienda: "AOU San Giovanni di Dio e Ruggi d'Aragona",
    presidio: "P.O. Santa Maria Incoronata dell'Olmo",
    unita: "U.O.C. Medicina Interna",
    righeExcel: [
      "Azienda Ospedaliero-Universitaria",
      "San Giovanni di Dio e Ruggi d\u2019Aragona  -  Salerno",
      "Presidio Ospedaliero \u201cSanta Maria Incoronata dell\u2019Olmo\u201d",
    ],
    siglaExcel: "MEDICINA",
    festiviLocali: [{ data:"09-08", nome:"Madonna dell'Olmo (patrona di Cava de' Tirreni)" }],
  },
  // Turni PS validi per affiancare l'MDC (v0.3.45): tutti, come prima.
  psAff: { "1":{ ord:true, alpi:true }, "2":{ ord:true, alpi:true }, "3":{ ord:true, alpi:true } },
  // PS 1/2 in altro ospedale: occupa tutta la giornata (v0.3.46).
  psEstGiornata: true,
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
  return { ...d, ...resto, ambulatori: amb, reparto: sanaReparto(s.reparto, d.reparto), psAff: sanaPsAff(s.psAff, d.psAff), psEstGiornata: typeof s.psEstGiornata==="boolean" ? s.psEstGiornata : d.psEstGiornata, notteLiberoNotte: nLN, riposoEsteso: rE,
           mattinaDopoNotte: mDN, blocchiMattina: bM, fabb:{
    fer: {...d.fabb.fer,  ...(s.fabb?.fer ||{})},
    sab: {...d.fabb.sab,  ...(s.fabb?.sab ||{})},
    fest:{...d.fabb.fest, ...(s.fabb?.fest||{})},
  }};
}

// ── AFFIANCAMENTO MDC CON TURNI PS (v0.3.45) ─────────────────────────────────
// Assente o malformato → default (tutti validi, comportamento storico).
function sanaPsAff(x: unknown, d: AffiancamentoPS): AffiancamentoPS {
  const out = JSON.parse(JSON.stringify(d)) as AffiancamentoPS;
  if(!x || typeof x!=="object") return out;
  for(const k of ["1","2","3"] as const){
    const v = (x as Record<string, unknown>)[k];
    if(!v || typeof v!=="object") continue;
    const o = v as { ord?: unknown; alpi?: unknown };
    if(typeof o.ord==="boolean") out[k].ord = o.ord;
    if(typeof o.alpi==="boolean") out[k].alpi = o.alpi;
  }
  return out;
}

// ── SCHEDA REPARTO (v0.3.44) ──────────────────────────────────────────────────
// Assente (salvataggi precedenti) → valori storici. Testi non stringa → default;
// logo accettato solo come data URL PNG/JPEG (o "" = nessun logo); festività
// solo "MM-GG" con mese e giorno plausibili, senza doppioni.
const LOGO_MAX = 700_000;   // caratteri del data URL (~500 KB di immagine)
function sanaReparto(x: unknown, d: Reparto): Reparto {
  if(!x || typeof x!=="object") return JSON.parse(JSON.stringify(d));
  const r = x as Partial<Reparto>;
  const txt = (v: unknown, def: string) => typeof v==="string" ? v.slice(0,200) : def;
  const righe = Array.isArray(r.righeExcel) ? r.righeExcel.filter(v=>typeof v==="string").slice(0,5).map(v=>v.slice(0,200)) : d.righeExcel;
  const logo = typeof r.logo==="string" && (r.logo==="" || (/^data:image\/(png|jpeg);base64,/.test(r.logo) && r.logo.length<=LOGO_MAX)) ? r.logo : undefined;
  const visti = new Set<string>();
  const fest: FestivoLocale[] = [];
  for(const f of Array.isArray(r.festiviLocali) ? r.festiviLocali : d.festiviLocali){
    if(!f || typeof f.data!=="string" || !/^\d\d-\d\d$/.test(f.data) || visti.has(f.data)) continue;
    const [mm,gg] = f.data.split("-").map(Number);
    if(mm<1||mm>12||gg<1||gg>31) continue;
    visti.add(f.data);
    fest.push({ data:f.data, nome: typeof f.nome==="string" ? f.nome.slice(0,100) : "" });
  }
  return { azienda: txt(r.azienda,d.azienda), presidio: txt(r.presidio,d.presidio), unita: txt(r.unita,d.unita),
           righeExcel: righe, siglaExcel: txt(r.siglaExcel,d.siglaExcel), ...(logo!==undefined ? { logo } : {}), festiviLocali: fest };
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
// Settimane del mese (v0.3.43): giorno 0–4 → { "1".."5"|"U" → fascia }.
// Giorni senza alcuna occorrenza valida vengono scartati.
const OCC_OK = new Set<string>(["1","2","3","4","5","U"]);
function sanaSettimane(x: unknown): Ambulatorio["settimane"] | undefined {
  if(!x || typeof x!=="object") return undefined;
  const out: NonNullable<Ambulatorio["settimane"]> = {};
  for(const [k,v] of Object.entries(x)){
    const d0=+k;
    if(!Number.isInteger(d0)||d0<0||d0>4||!v||typeof v!=="object") continue;
    const occ: Partial<Record<OccAmb,FasciaAmb>> = {};
    for(const [o,f] of Object.entries(v)) if(OCC_OK.has(o) && FASCE_OK.has(f as FasciaAmb)) occ[o as OccAmb]=f as FasciaAmb;
    if(Object.keys(occ).length) out[d0]=occ;
  }
  return Object.keys(out).length ? out : undefined;
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
      const settimane = sanaSettimane(a.settimane);
      out.push({ id:a.id, nome, sigla, giorni: sanaGiorni(a.giorni), ...(settimane ? { settimane } : {}) });
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
export function setRegole(r: Regole){ REGOLE = mergeRegole(r); setFestiviLocali(REGOLE.reparto.festiviLocali.map(f=>f.data)); }
export function getRegole(): Regole { return REGOLE; }
