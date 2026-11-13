import type { Medico, TurniAll, TurniMese } from "./types";
import { mkKey, dimOf, dowOf, isFestivo, isSabN } from "./date";
import { isMatt, isPom, isNot, SPEC } from "./turni";
import { ENG } from "./state";

// ═══════════════════════════════════════════════════════════════════════════
// TURNI FESTIVI PER TIPO e ROTAZIONE FRA MESI (v0.3.56)
// ═══════════════════════════════════════════════════════════════════════════
// Tipi (v0.3.55): 0 mattina festiva, 1 pomeriggio festivo, 2 notte festiva,
// 3 pomeriggio del sabato, 4 notte del sabato o prefestiva. La mattina del
// sabato non è festiva. Contano anche PS (1, 2, 3) e sottolineati.
export const N_TIPI_FEST = 5;
/** I tipi che sono notti: notte festiva e notte del sabato o prefestiva. */
const TIPI_NOTTE = [2, 4];
export function tipoFestivo(fest:boolean, sab:boolean, prefest:boolean, tipo:string): number {
  if(fest) return isMatt(tipo) ? 0 : isPom(tipo) ? 1 : isNot(tipo) ? 2 : -1;
  if(sab)  return isPom(tipo) ? 3 : isNot(tipo) ? 4 : -1;
  return prefest && isNot(tipo) ? 4 : -1;
}

/** Turni festivi per tipo di ciascun medico in un mese salvato, e chi in quel
 *  mese ha lavorato almeno un giorno. */
export function festiviDelMese(T: TurniMese, anno:number, mese:number, ids:number[]) {
  const nd = dimOf(anno, mese);
  const conti: Record<number, number[]> = {};
  const presenti = new Set<number>();
  const senzaNotti = new Set<number>();          // ha lavorato ma non ha fatto nessuna notte (v0.3.59)
  for(const id of ids){
    const k = new Array<number>(N_TIPI_FEST).fill(0);
    let nNotti = 0;
    for(let g=1; g<=nd; g++){
      const sh = T[id]?.[g]?.t || [];
      if(!sh.length) continue;
      nNotti += sh.filter(s=>isNot(s.tipo)).length;
      if(sh.some(s=>!SPEC.includes(s.tipo))) presenti.add(id);
      const fest = isFestivo(anno, mese, g), sab = isSabN(dowOf(anno, mese, g)) && !fest;
      const pre = g<nd && isFestivo(anno, mese, g+1);
      for(const s of sh){ const t = tipoFestivo(fest, sab, pre, s.tipo); if(t>=0) k[t]++; }
    }
    conti[id] = k;
    if(presenti.has(id) && nNotti===0) senzaNotti.add(id);
  }
  return { conti, presenti, senzaNotti };
}

/** ROTAZIONE FRA MESI: per ogni MR e decreto Calabria, la MEDIA MENSILE dei
 *  turni festivi per tipo negli ultimi `nMesi` mesi salvati. Chi in un mese
 *  non ha lavorato (nuovo in squadra, assente tutto il mese) prende per quel
 *  mese la media dei colleghi: non deve "recuperare" festivi. null se non c'è
 *  nessun mese salvato o se la rotazione è spenta (nMesi = 0). */
export function calcolaStoricoFestivi(turniAll: TurniAll | null | undefined, anno:number, mese:number,
                                      medici: Medico[], nMesi:number): Record<number, number[]> | null {
  if(!turniAll || nMesi<=0) return null;
  const ids = medici.filter(m=>m.stato==="MR" || m.stato==="MDC").map(m=>m.id);
  if(!ids.length) return null;
  const mrSet = new Set(medici.filter(m=>m.stato==="MR").map(m=>m.id));
  const somma: Record<number, number[]> = {};
  for(const id of ids) somma[id] = new Array<number>(N_TIPI_FEST).fill(0);
  let usati = 0;
  for(let k=1; k<=nMesi; k++){
    const d = new Date(anno, mese-k, 1);
    const T = turniAll[mkKey(d.getFullYear(), d.getMonth())];
    if(!T) continue;
    const { conti, presenti, senzaNotti } = festiviDelMese(T, d.getFullYear(), d.getMonth(), ids);
    const pres = ids.filter(id=>presenti.has(id));
    if(!pres.length) continue;
    usati++;
    const media = Array.from({ length:N_TIPI_FEST }, (_,t)=>pres.reduce((q,id)=>q+conti[id][t],0)/pres.length);
    // ESENTATI DALLE NOTTI (v0.3.59): un MR che in quel mese ha lavorato senza
    // fare nemmeno una notte era esentato (o è come se lo fosse). Per le notti
    // festive prende la media di chi le ha fatte: finita l'esenzione non deve
    // recuperarle. Il decreto Calabria resta com'era (di notti ne fa poche).
    const conNotti = pres.filter(id=>!senzaNotti.has(id));
    const mediaN = (t:number) => conNotti.length ? conNotti.reduce((q,id)=>q+conti[id][t],0)/conNotti.length : 0;
    for(const id of ids){
      const x = presenti.has(id) ? conti[id] : media;
      const esente = senzaNotti.has(id) && mrSet.has(id);
      for(let t=0; t<N_TIPI_FEST; t++) somma[id][t] += (esente && TIPI_NOTTE.includes(t)) ? mediaN(t) : x[t];
    }
  }
  if(!usati) return null;
  for(const id of ids) somma[id] = somma[id].map(v=>v/usati);
  return somma;
}

/** Iniettato dalla UI prima di generare (come setPrevContext). */
export function setStoricoFestivi(turniAll: TurniAll | null | undefined, anno:number, mese:number, medici: Medico[], nMesi:number){
  ENG.STORICO_FEST = calcolaStoricoFestivi(turniAll, anno, mese, medici, nMesi);
}

// ═══════════════════════════════════════════════════════════════════════════
// EQUITÀ FRA MESI: NOTTI E WEEKEND LIBERI (v0.3.58)
// ═══════════════════════════════════════════════════════════════════════════
// Nel singolo mese notti e weekend liberi sono già pari (differenza al più 1),
// ma quando il conto non torna — 30 notti per 7 MR: due ne fanno 5 — a chi
// tocca la notte in più lo decideva il caso, ogni mese da capo. Misurato su 8
// squadre seguite per 6 mesi: fra l'MR con più notti e quello con meno 2,25 in
// media (fino a 4); lo stesso per i weekend liberi.
// Qui, per ogni medico, lo SCOSTAMENTO dei mesi salvati precedenti: quante
// notti (o weekend liberi) in più o in meno della media dei colleghi presenti,
// sommando i mesi. Le notti si contano come nel mese (N e 3, anche
// sottolineate) e solo fra gli MR; i weekend liberi come nel riepilogo
// (sabato e domenica senza lavoro, ferie comprese), MR fra MR e decreto
// Calabria fra decreto Calabria. Chi in un mese non ha lavorato (nuovo in
// squadra, assente tutto il mese) non accumula scostamento: non deve
// recuperare. Le assenze parziali contano: come nel mese, le ferie non
// spostano la quota.
// Il motore usa lo scostamento così (vedi nottiFraMesi e misuraTabellone):
//  · notti: ogni notte del mese costa lo spostamento del medico (betaNotti
//    per ogni notte di scostamento, al più `max`), contata solo dentro la
//    forchetta [⌊media⌋, ⌈media⌉] del mese: cambia A CHI tocca la notte in
//    più, e una notte oltre la forchetta non fa guadagnare nulla;
//  · weekend liberi: ogni weekend libero del mese costa pesoWk × spostamento
//    (stesso tetto): chi ne ha avuti di più li riceve per ultimo. È dentro il
//    soft: quanti weekend liberi mancano in tutto e il carico weekend, che
//    vengono prima, non cambiano.
export const EQ_MESI = { betaNotti: 0.8, betaWk: 0.8, max: 0.4, pesoWk: 25 };
export interface StoricoEq { notti: Record<number, number>; wk: Record<number, number> }

/** Notti e weekend liberi di ciascun medico in un mese salvato, e chi ha lavorato. */
export function contiEqMese(T: TurniMese, anno:number, mese:number, ids:number[]) {
  const nd = dimOf(anno, mese);
  const notti: Record<number, number> = {}, wk: Record<number, number> = {};
  const presenti = new Set<number>();
  const libero = (id:number, g:number) => (T[id]?.[g]?.t || []).every(s=>SPEC.includes(s.tipo));
  for(const id of ids){
    let n = 0, w = 0;
    for(let g=1; g<=nd; g++){
      const sh = T[id]?.[g]?.t || [];
      if(sh.some(s=>!SPEC.includes(s.tipo))) presenti.add(id);
      for(const s of sh) if(isNot(s.tipo)) n++;
      if(g<nd && isSabN(dowOf(anno, mese, g)) && libero(id,g) && libero(id,g+1)) w++;
    }
    notti[id] = n; wk[id] = w;
  }
  return { notti, wk, presenti };
}

/** Scostamenti di notti (MR) negli ultimi `mesiNotti` mesi salvati e di
 *  weekend liberi (MR, decreto Calabria) negli ultimi `mesiWk`: le due memorie
 *  sono separate (0 = spenta). null senza mesi salvati o con entrambe spente. */
export function calcolaStoricoEquita(turniAll: TurniAll | null | undefined, anno:number, mese:number,
                                     medici: Medico[], mesiNotti:number, mesiWk:number = mesiNotti): StoricoEq | null {
  if(!turniAll || (mesiNotti<=0 && mesiWk<=0)) return null;
  const mr = medici.filter(m=>m.stato==="MR").map(m=>m.id), mdc = medici.filter(m=>m.stato==="MDC").map(m=>m.id);
  const mrNotti = medici.filter(m=>m.stato==="MR" && !m.noNotti).map(m=>m.id);
  const ids = [...mr, ...mdc];
  if(!ids.length) return null;
  const st: StoricoEq = { notti:{}, wk:{} };
  for(const id of mrNotti) st.notti[id] = 0;
  for(const id of ids) st.wk[id] = 0;
  let usati = 0;
  for(let k=1; k<=Math.max(mesiNotti, mesiWk); k++){
    const d = new Date(anno, mese-k, 1);
    const T = turniAll[mkKey(d.getFullYear(), d.getMonth())];
    if(!T) continue;
    const { notti, wk, presenti } = contiEqMese(T, d.getFullYear(), d.getMonth(), ids);
    if(!ids.some(id=>presenti.has(id))) continue;
    usati++;
    const scosta = (gruppo:number[], conti:Record<number,number>, out:Record<number,number>, soloSe?:(id:number)=>boolean) => {
      const pres = gruppo.filter(id=>presenti.has(id) && (!soloSe || soloSe(id)));
      if(pres.length<2) return;
      const media = pres.reduce((q,id)=>q+conti[id],0)/pres.length;
      for(const id of pres) out[id] += conti[id]-media;
    };
    // ESENTATI DALLE NOTTI (v0.3.59): chi oggi è esentato non entra; e un mese
    // in cui un MR non ha fatto nemmeno una notte non conta, né per lui né per
    // la media: finita l'esenzione le notti non fatte non si recuperano.
    if(k<=mesiNotti) scosta(mrNotti, notti, st.notti, id=>notti[id]>0);
    if(k<=mesiWk){ scosta(mr, wk, st.wk); scosta(mdc, wk, st.wk); }
  }
  return usati ? st : null;
}

/** Iniettato dalla UI prima di generare (come setStoricoFestivi). */
export function setStoricoEquita(turniAll: TurniAll | null | undefined, anno:number, mese:number, medici: Medico[], mesiNotti:number, mesiWk:number = mesiNotti){
  ENG.STORICO_EQ = calcolaStoricoEquita(turniAll, anno, mese, medici, mesiNotti, mesiWk);
}

/** Spostamento di un medico: beta × scostamento, entro ±max. */
export const spostaEq = (dev:number|undefined, beta:number) => Math.max(-EQ_MESI.max, Math.min(EQ_MESI.max, beta*(dev ?? 0)));
/** Spostamenti di un gruppo, a somma zero (la media del gruppo non si muove). */
export function spostamentiEq(dev: Record<number,number>|undefined, ids:number[], beta:number): Map<number, number> {
  const raw = ids.map(id=>spostaEq(dev?.[id], beta));
  const mu = raw.length ? raw.reduce((q,x)=>q+x,0)/raw.length : 0;
  return new Map(ids.map((id,i)=>[id, raw[i]-mu]));
}
