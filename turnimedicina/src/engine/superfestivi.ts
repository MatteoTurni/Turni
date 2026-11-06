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
//   1. lo STESSO IDENTICO turno dell'anno scorso (es. la notte di Natale) non
//      ricapita allo stesso medico;
//   2. lo stesso superfestivo non due anni di fila;
//   3. alternanza: chi lavora a Natale non lavora a Capodanno, e viceversa;
//   4. pareggio annuo: chi negli ultimi 12 mesi ha fatto più turni
//      superfestivi riceve per ultimo quelli del mese, e uno stesso medico non
//      ne accumula più di uno se altri possono.
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
  n12: Record<number, number>;          // turni superfestivi negli ultimi 12 mesi
  identici: Record<number, string[]>;   // "sf|turno" fatti l'anno scorso (dei superfestivi di questo mese)
  stessi: Record<number, string[]>;     // superfestivi fatti l'anno scorso (idem)
  stagione: Record<number, string[]>;   // turni della stessa ricorrenza fatti nei mesi prima (la notte del 31 per il Capodanno di gennaio; Natale per l'alternanza)
}

export function calcolaStoricoSuperfestivi(turniAll: TurniAll | null | undefined, anno:number, mese:number,
                                           medici: Medico[], lista: Superfestivo[]): StoricoSF | null {
  if(!turniAll || !lista.length) return null;
  const ids = medici.filter(m=>m.stato!=="MPS").map(m=>m.id);
  const st: StoricoSF = { n12:{}, identici:{}, stessi:{}, stagione:{} };
  for(const id of ids){ st.n12[id]=0; st.identici[id]=[]; st.stessi[id]=[]; st.stagione[id]=[]; }
  const inizio = new Date(anno, mese, 1).getTime(), da12 = new Date(anno, mese-12, 1).getTime();
  const quando = (s:SlotSF) => new Date(s.y, s.m, s.d).getTime();
  // pareggio annuo: tutti i turni superfestivi degli ultimi 12 mesi
  for(const sf of lista) for(const y of [anno-2, anno-1, anno, anno+1]) for(const s of slotOccorrenza(sf, y)){
    const t = quando(s); if(t<da12 || t>=inizio) continue;
    for(const id of ids) if(fatto(turniAll, id, s)) st.n12[id]++;
  }
  // per le ricorrenze che hanno turni in questo mese: l'anno scorso e i mesi prima
  const ricorrenze = new Map<string, { sf:Superfestivo; anno:number }>();
  for(const s of slotDelMese(lista, anno, mese)){ const sf = lista.find(x=>x.id===s.sf)!; ricorrenze.set(`${s.sf}@${s.anno}`, { sf, anno:s.anno }); }
  for(const { sf, anno:a } of ricorrenze.values()){
    for(const s of slotOccorrenza(sf, a-1)) for(const id of ids) if(fatto(turniAll, id, s)){
      st.identici[id].push(`${sf.id}|${s.slot}`);
      if(!st.stessi[id].includes(sf.id)) st.stessi[id].push(sf.id);
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

export function setStoricoSuperfestivi(turniAll: TurniAll | null | undefined, anno:number, mese:number, medici: Medico[], lista: Superfestivo[]){
  ENG.STORICO_SF = calcolaStoricoSuperfestivi(turniAll, anno, mese, medici, lista);
}

/** Costo dei superfestivi del mese nel tabellone (soft, vedi le regole sopra). */
export function costoSuperfestivi(c: { att: Medico[]; gt: (id:number,g:number)=>Turno[] }, anno:number, mese:number): number {
  const R = getRegole();
  const lista = R.superfestivi ?? [];
  if(!lista.length) return 0;
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
    costo += PESI_SF.conteggio * (H?.n12[m.id] ?? 0) * n;
    costo += PESI_SF.coppia * ((n+p)*(n+p-1)/2 - p*(p-1)/2);
    const ident = H?.identici[m.id] ?? [], stessi = H?.stessi[m.id] ?? [];
    for(const s of miei) if(ident.includes(`${s.sf}|${s.slot}`)) costo += PESI_SF.identico;
    const sfs = new Set(miei.map(s=>s.sf));
    for(const sf of sfs) if(stessi.includes(sf)) costo += PESI_SF.stesso;
    if(alt && (sfs.has("natale") || prima.includes("natale")) && (sfs.has("capodanno") || prima.includes("capodanno"))) costo += PESI_SF.alternanza;
  }
  return costo;
}
