import type { Medico, TurniAll, Turno, Superfestivo } from "./types";
import { calcPasqua, mkKey } from "./date";
import { isMatt, isPom, isNot } from "./turni";
import { getRegole } from "./regole";
import { ENG } from "./state";

// ═══════════════════════════════════════════════════════════════════════════
// SUPERFESTIVI (v0.3.57) — equità fra gli anni
// ═══════════════════════════════════════════════════════════════════════════
// Un superfestivo (Natale, Capodanno, Pasqua, Ferragosto, più quelli che
// aggiunge il reparto) ha quattro turni: la NOTTE PRIMA, la mattina, il
// pomeriggio e la notte del giorno. Contano anche PS e sottolineati. Le
// regole, tutte preferenze (vengono dopo buchi, regole, weekend e obiettivi):
//   1. lo STESSO IDENTICO turno degli anni scorsi (es. la notte di Natale)
//      non ricapita allo stesso medico;
//   2. lo stesso superfestivo non negli anni subito prima;
//   3. alternanza: chi lavora a Natale non lavora a Capodanno, e viceversa;
//   4. pareggio: chi negli ultimi anni ha fatto più turni superfestivi (media
//      per anno) riceve per ultimo quelli del mese, e uno stesso medico non ne
//      accumula più di uno se altri possono.
// Si guardano gli ultimi `superfestiviAnni` anni (1-5): l'anno scorso conta
// per intero, quello prima a metà, poi un terzo... Con l'equità spenta
// (superfestiviAttivi = false) il motore li tratta come festivi normali.
// Lo storico viene dai mesi salvati nell'app (anche quelli dell'anno scorso
// inseriti a mano): la UI lo calcola prima di generare (setStoricoSuperfestivi).
export type SlotNome = "vigilia" | "M" | "P" | "N";
export interface SlotSF { sf: string; slot: SlotNome; y: number; m: number; d: number; anno: number }
const FASCIA: Record<SlotNome, "M"|"P"|"N"> = { vigilia:"N", M:"M", P:"P", N:"N" };
export const PESI_SF = { identico: 300, stesso: 120, alternanza: 150, conteggio: 40, coppia: 40 };

/** Data del superfestivo nell'anno y (null se la data non è valida). */
export function dataSuperfestivo(sf: Superfestivo, y: number): Date | null {
  if(sf.data==="pasqua") return calcPasqua(y);
  if(sf.data==="pasquetta"){ const p = calcPasqua(y); return new Date(y, p.getMonth(), p.getDate()+1); }
  const m = /^(\d\d)-(\d\d)$/.exec(sf.data);
  return m ? new Date(y, +m[1]-1, +m[2]) : null;
}
/** I quattro turni del superfestivo dell'anno y. */
export function slotOccorrenza(sf: Superfestivo, y: number): SlotSF[] {
  const D = dataSuperfestivo(sf, y); if(!D) return [];
  const V = new Date(D.getFullYear(), D.getMonth(), D.getDate()-1);
  const s = (slot:SlotNome, x:Date): SlotSF => ({ sf:sf.id, slot, y:x.getFullYear(), m:x.getMonth(), d:x.getDate(), anno:y });
  return [s("vigilia",V), s("M",D), s("P",D), s("N",D)];
}
let memo: { k:string; v:SlotSF[] } | null = null;
/** Turni superfestivi che cadono nel mese (la notte prima di Capodanno è il 31 dicembre). */
export function slotDelMese(lista: Superfestivo[], anno:number, mese:number): SlotSF[] {
  const k = `${anno}-${mese}-${lista.map(x=>x.id+"@"+x.data).join(",")}`;
  if(memo && memo.k===k) return memo.v;
  const v: SlotSF[] = [];
  for(const sf of lista) for(const y of [anno-1, anno, anno+1]) for(const s of slotOccorrenza(sf, y)) if(s.y===anno && s.m===mese) v.push(s);
  memo = { k, v };
  return v;
}
const haFascia = (sh: Turno[], f: "M"|"P"|"N") => sh.some(s => f==="M" ? isMatt(s.tipo) : f==="P" ? isPom(s.tipo) : isNot(s.tipo));
const fatto = (turniAll: TurniAll, id:number, s:SlotSF) => {
  const T = turniAll[mkKey(s.y, s.m)];
  return !!T && haFascia(T[id]?.[s.d]?.t || [], FASCIA[s.slot]);
};

export interface StoricoSF {
  nAnno: Record<number, number>;                     // turni superfestivi per anno (media sugli anni considerati)
  identici: Record<number, Record<string, number>>;  // "sf|turno" fatti negli anni scorsi → peso (1, ½, ⅓...)
  stessi: Record<number, Record<string, number>>;    // superfestivi fatti negli anni scorsi → peso
  stagione: Record<number, string[]>;                // turni della stessa ricorrenza fatti nei mesi prima (la notte del 31 per il Capodanno di gennaio; Natale per l'alternanza)
}

export function calcolaStoricoSuperfestivi(turniAll: TurniAll | null | undefined, anno:number, mese:number,
                                           medici: Medico[], lista: Superfestivo[], anni = 1): StoricoSF | null {
  if(!turniAll || !lista.length || anni<1) return null;
  const ids = medici.filter(m=>m.stato!=="MPS").map(m=>m.id);
  const st: StoricoSF = { nAnno:{}, identici:{}, stessi:{}, stagione:{} };
  for(const id of ids){ st.nAnno[id]=0; st.identici[id]={}; st.stessi[id]={}; st.stagione[id]=[]; }
  const inizio = new Date(anno, mese, 1).getTime(), daQui = new Date(anno, mese-12*anni, 1).getTime();
  const quando = (s:SlotSF) => new Date(s.y, s.m, s.d).getTime();
  // pareggio: i turni superfestivi degli ultimi `anni` anni, in media per anno
  for(const sf of lista) for(let y=anno-anni-1; y<=anno+1; y++) for(const s of slotOccorrenza(sf, y)){
    const t = quando(s); if(t<daQui || t>=inizio) continue;
    for(const id of ids) if(fatto(turniAll, id, s)) st.nAnno[id] += 1/anni;
  }
  // per le ricorrenze che hanno turni in questo mese: gli anni scorsi e i mesi prima
  const ricorrenze = new Map<string, { sf:Superfestivo; anno:number }>();
  for(const s of slotDelMese(lista, anno, mese)){ const sf = lista.find(x=>x.id===s.sf)!; ricorrenze.set(`${s.sf}@${s.anno}`, { sf, anno:s.anno }); }
  for(const { sf, anno:a } of ricorrenze.values()){
    for(let k=1; k<=anni; k++) for(const s of slotOccorrenza(sf, a-k)) for(const id of ids) if(fatto(turniAll, id, s)){
      const ki = `${sf.id}|${s.slot}`;
      st.identici[id][ki] = (st.identici[id][ki] ?? 0) + 1/k;
      st.stessi[id][sf.id] = Math.max(st.stessi[id][sf.id] ?? 0, 1/k);
    }
    for(const s of slotOccorrenza(sf, a)) if(quando(s)<inizio) for(const id of ids) if(fatto(turniAll, id, s)) st.stagione[id].push(sf.id);
    // alternanza: per il Capodanno conta il Natale appena passato (dicembre dell'anno prima)
    if(sf.id==="capodanno"){
      const natale = lista.find(x=>x.id==="natale");
      if(natale) for(const s of slotOccorrenza(natale, a-1)) if(quando(s)<inizio) for(const id of ids) if(fatto(turniAll, id, s)) st.stagione[id].push("natale");
    }
  }
  return st;
}

export function setStoricoSuperfestivi(turniAll: TurniAll | null | undefined, anno:number, mese:number, medici: Medico[],
                                      lista: Superfestivo[], attivi = true, anni = 1){
  ENG.STORICO_SF = attivi ? calcolaStoricoSuperfestivi(turniAll, anno, mese, medici, lista, anni) : null;
}

/** Costo dei superfestivi del mese nel tabellone (soft, vedi le regole sopra). */
export function costoSuperfestivi(c: { att: Medico[]; gt: (id:number,g:number)=>Turno[] }, anno:number, mese:number): number {
  const R = getRegole();
  const lista = R.superfestivi ?? [];
  if(!lista.length || R.superfestiviAttivi===false) return 0;
  const slots = slotDelMese(lista, anno, mese);
  if(!slots.length) return 0;
  const H = ENG.STORICO_SF;
  const alt = !!R.alternanzaNataleCapodanno && lista.some(x=>x.id==="natale") && lista.some(x=>x.id==="capodanno");
  let costo = 0;
  for(const m of c.att){
    const miei = slots.filter(s=>haFascia(c.gt(m.id, s.d), FASCIA[s.slot]));
    if(!miei.length) continue;
    const prima = H?.stagione[m.id] ?? [];
    const n = miei.length, p = prima.filter(x=>miei.some(s=>s.sf===x)).length;
    costo += PESI_SF.conteggio * (H?.nAnno[m.id] ?? 0) * n;
    costo += PESI_SF.coppia * ((n+p)*(n+p-1)/2 - p*(p-1)/2);
    const ident = H?.identici[m.id] ?? {}, stessi = H?.stessi[m.id] ?? {};
    for(const s of miei) costo += PESI_SF.identico * (ident[`${s.sf}|${s.slot}`] ?? 0);
    const sfs = new Set(miei.map(s=>s.sf));
    for(const sf of sfs) costo += PESI_SF.stesso * (stessi[sf] ?? 0);
    if(alt && (sfs.has("natale") || prima.includes("natale")) && (sfs.has("capodanno") || prima.includes("capodanno"))) costo += PESI_SF.alternanza;
  }
  return costo;
}
