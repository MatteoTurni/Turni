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
  for(const id of ids){
    const k = new Array<number>(N_TIPI_FEST).fill(0);
    for(let g=1; g<=nd; g++){
      const sh = T[id]?.[g]?.t || [];
      if(!sh.length) continue;
      if(sh.some(s=>!SPEC.includes(s.tipo))) presenti.add(id);
      const fest = isFestivo(anno, mese, g), sab = isSabN(dowOf(anno, mese, g)) && !fest;
      const pre = g<nd && isFestivo(anno, mese, g+1);
      for(const s of sh){ const t = tipoFestivo(fest, sab, pre, s.tipo); if(t>=0) k[t]++; }
    }
    conti[id] = k;
  }
  return { conti, presenti };
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
  const somma: Record<number, number[]> = {};
  for(const id of ids) somma[id] = new Array<number>(N_TIPI_FEST).fill(0);
  let usati = 0;
  for(let k=1; k<=nMesi; k++){
    const d = new Date(anno, mese-k, 1);
    const T = turniAll[mkKey(d.getFullYear(), d.getMonth())];
    if(!T) continue;
    const { conti, presenti } = festiviDelMese(T, d.getFullYear(), d.getMonth(), ids);
    const pres = ids.filter(id=>presenti.has(id));
    if(!pres.length) continue;
    usati++;
    const media = Array.from({ length:N_TIPI_FEST }, (_,t)=>pres.reduce((q,id)=>q+conti[id][t],0)/pres.length);
    for(const id of ids){ const x = presenti.has(id) ? conti[id] : media; for(let t=0; t<N_TIPI_FEST; t++) somma[id][t] += x[t]; }
  }
  if(!usati) return null;
  for(const id of ids) somma[id] = somma[id].map(v=>v/usati);
  return somma;
}

/** Iniettato dalla UI prima di generare (come setPrevContext). */
export function setStoricoFestivi(turniAll: TurniAll | null | undefined, anno:number, mese:number, medici: Medico[], nMesi:number){
  ENG.STORICO_FEST = calcolaStoricoFestivi(turniAll, anno, mese, medici, nMesi);
}
