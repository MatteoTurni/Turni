// ═══════════════════════════════════════════════════════════════════════════
// DIAGNOSI NOTTI E WEEKEND LIBERI (v0.3.47) — solo lettura
// ═══════════════════════════════════════════════════════════════════════════
// La diagnosi "storica" spiega i BUCHI di copertura. Questa spiega gli avvisi
// sui WEEKEND LIBERI ("Spugnardi: 0/2 wk liberi"), che di solito nascono da un
// mese tirato sulle notti. Tre strumenti:
//  1) bilancioNotti   — dai soli turni MANUALI: notti da coprire contro notti
//     che la squadra può fare al massimo, e chi è obbligato ad arrivare al tetto;
//  2) spiegaWeekend   — sul tabellone generato: per ogni medico sotto obiettivo,
//     quali weekend lavora e perché nessun collega poteva prendere quei turni;
//  3) provaWeekend    — rigenera il mese con qualche allentamento (massimo notti
//     +1, consecutivi +1, senza un turno manuale) e dice quale avrebbe evitato
//     l'avviso. Più lento: gira in un worker, dopo la generazione.
// Nulla qui modifica il tabellone o il modo in cui il motore genera.
import type { Medico, TurniMese, Regole, Turno } from "./types";
import { DF, dowOf } from "./date";
import { getRegole, setRegole } from "./regole";
import { makeCtx } from "./ctx";
import { compagnoMDC, isNot, SPEC, etichettaTurno } from "./turni";
import { generaMigliorTentativo, misuraTabellone } from "./genera";

type Ctx = ReturnType<typeof makeCtx>;
const ASSENZE = ["L","ANA","104","per11"];
const cognome = (m: Medico) => { const c = m.nome.split(" ").pop() || m.nome; return c.charAt(0).toUpperCase()+c.slice(1).toLowerCase(); };
const gLbl = (anno:number, mese:number, g:number) => `${DF[dowOf(anno,mese,g)].slice(0,3).toLowerCase()} ${g}`;
const soloManuali = (T: TurniMese): TurniMese => {
  const out: TurniMese = {};
  for(const id in T) for(const g in T[id]){
    const t = (T[id][g]?.t || []).filter(s=>s.man);
    if(t.length) ((out[id] ||= {})[g] = { t });
  }
  return out;
};

// ── 1) BILANCIO NOTTI ───────────────────────────────────────────────────────
export interface CapNotti { id:number; nome:string; tetto:number; manuali:string[]; minimo:number; limite:"tetto"|"giorni"|"obiettivo" }
export interface BilancioNotti {
  daCoprire: number;        // notti di reparto ancora da assegnare
  capacita: number;         // notti che la squadra potrebbe fare al massimo (stima ottimistica)
  margine: number;          // capacita - daCoprire
  medici: CapNotti[];       // solo chi può fare notti
  tirato: boolean;          // margine piccolo: avviso
}
export function bilancioNotti(anno:number, mese:number, ndim:number, medici:Medico[], turni:TurniMese, regole?:Regole): BilancioNotti {
  const REG = regole ?? getRegole();
  const T = soloManuali(turni);
  const cm = makeCtx(anno, mese, ndim, medici, T);              // per i punti già fatti coi soli manuali
  const man = (id:number,g:number): Turno[] => T[id]?.[g]?.t || [];
  const notteMan = (id:number,g:number) => g>=1 && g<=ndim && man(id,g).some(s=>isNot(s.tipo));
  let daCoprire = 0;
  for(let g=1; g<=ndim; g++) if(!medici.some(m=>man(m.id,g).some(s=>s.tipo==="N"))) daCoprire++;
  const out: CapNotti[] = [];
  for(const m of medici){
    if(m.stato!=="MR" && m.stato!=="MDC") continue;
    const manuali: string[] = [];
    let giorni = 0;
    for(let g=1; g<=ndim; g++){
      const sh = man(m.id,g);
      if(sh.some(s=>isNot(s.tipo))) manuali.push(`${etichettaTurno(sh.find(s=>isNot(s.tipo))!, [])}${sh.find(s=>isNot(s.tipo))!.sott?" (ALPI)":""} il ${g}`);
      if(sh.length) continue;                                         // giorno già occupato (anche assenze ed esclusioni)
      if(notteMan(m.id,g-1)) continue;                                // riposo dopo una notte manuale
      if(m.stato==="MDC" && !medici.some(a=>a.id!==m.id && man(a.id,g).some(s=>compagnoMDC(s,"N",REG.psAff)))) continue;
      giorni++;
    }
    const notteMan_ = manuali.length;
    const daGiorni = Math.ceil(giorni/2);                              // una notte e il riposo: al più un giorno su due
    const daTetto = Math.max(0, REG.maxNotti - notteMan_);
    const daObiettivo = Math.max(0, Math.floor((m.obiettivo - cm.cnt(m.id))/2));   // una notte vale 2 punti
    const tetto = Math.min(daTetto, daGiorni, daObiettivo);
    if(tetto===0 && !manuali.length) continue;
    const limite = tetto===daTetto ? "tetto" : tetto===daObiettivo ? "obiettivo" : "giorni";
    out.push({ id:m.id, nome:cognome(m), tetto, manuali, minimo:0, limite });
  }
  const capacita = out.reduce((q,x)=>q+x.tetto,0);
  const margine = capacita - daCoprire;
  for(const x of out) x.minimo = Math.max(0, Math.min(x.tetto, x.tetto - margine));
  return { daCoprire, capacita, margine, medici: out, tirato: margine <= Math.max(2, Math.round(daCoprire*0.1)) };
}

// ── 2) SPIEGAZIONE DEI WEEKEND LIBERI MANCANTI ─────────────────────────────
export interface TurnoWeekend { g:number; tipo:string; man:boolean; motivi:string[] }
export interface SpiegazioneWeekend {
  id:number; nome:string; liberi:number; obiettivo:number;
  weekend: { sab:number; dom:number; turni:TurnoWeekend[] }[];
}
const FASCIA: Record<string,"M"|"P"|"N"> = { M:"M", A:"M", P:"P", Ap:"P", N:"N" };
/** Perché il collega `m` non può prendere il turno `f` del giorno g. null = potrebbe. */
function motivoNo(c:Ctx, m:Medico, g:number, f:"M"|"P"|"N"): string|null {
  const sh = c.gt(m.id,g);
  if(m.stato==="MPS") return null;
  if(sh.some(s=>ASSENZE.includes(s.tipo))) return "assente";
  if(c.escluso(m.id,g,f)) return "escluso";
  if(m.stato==="ML" && f!=="M") return null;                           // l'ML non è un candidato: non lo si elenca
  if(sh.some(s=>!SPEC.includes(s.tipo))) return "già in turno quel giorno";
  if(c.haN(m.id,g-1)) return "riposo dopo la notte";
  if(f==="N" && c.cntN(m.id)>=c.MAX_NOTTI) return "già al massimo notti";
  if(c.cnt(m.id)>=m.obiettivo) return "obiettivo già raggiunto";
  if(!c.canConsec(m.id,g)) return "troppi giorni di fila";
  if(!c.mdcOk(m,g,f)) return "MDC senza affiancamento";
  if(!c.canR(m,g,f)) return f==="N" ? "regole della notte (riposo, notti di fila)" : "regole di riposo";
  // Lo prenderebbe, ma perderebbe un weekend libero scendendo sotto il suo obiettivo?
  const pair = c.wkPairs.find(([s,d])=>s===g||d===g);
  if(pair && c.isLibWk(m.id,pair[0]) && c.isLibWk(m.id,pair[1]) && c.cntWkLiberi(m.id)<=c.wkTargetMed(m.id))
    return `perderebbe un weekend libero (ne ha ${c.cntWkLiberi(m.id)})`;
  return null;
}
export function spiegaWeekend(anno:number, mese:number, ndim:number, medici:Medico[], turni:TurniMese): SpiegazioneWeekend[] {
  const c = makeCtx(anno, mese, ndim, medici, turni);
  const out: SpiegazioneWeekend[] = [];
  for(const m of c.mrMdc){
    const liberi = c.cntWkLiberi(m.id), obiettivo = c.wkTargetMed(m.id);
    if(liberi>=obiettivo) continue;
    const weekend: SpiegazioneWeekend["weekend"] = [];
    for(const [s,d] of c.wkPairs){
      if(c.isLibWk(m.id,s) && c.isLibWk(m.id,d)) continue;
      const turni: TurnoWeekend[] = [];
      for(const g of [s,d]) for(const t of c.gt(m.id,g)){
        if(SPEC.includes(t.tipo)) continue;
        const tw: TurnoWeekend = { g, tipo: etichettaTurno(t, getRegole().ambulatori ?? []), man: !!t.man, motivi: [] };
        const f = FASCIA[t.tipo];
        if(!t.man && f){
          // Si toglie il turno al medico e si chiede a ogni collega perché non lo prende.
          const m0 = c.mark();
          c.st(m.id, g, c.gt(m.id,g).filter(x=>x!==t));
          const perMotivo = new Map<string,string[]>();
          for(const a of medici){
            if(a.id===m.id) continue;
            const mot = motivoNo(c, a, g, f);
            if(mot===null){ if(a.stato!=="MPS" && !(a.stato==="ML" && f!=="M")) (perMotivo.get("potrebbe") ?? perMotivo.set("potrebbe",[]).get("potrebbe")!).push(cognome(a)); continue; }
            (perMotivo.get(mot) ?? perMotivo.set(mot,[]).get(mot)!).push(cognome(a));
          }
          c.rollback(m0);
          for(const [mot, chi] of perMotivo)
            tw.motivi.push(mot==="potrebbe" ? `potrebbe prenderlo: ${chi.join(", ")}` : `${chi.join(", ")}: ${mot}`);
        }
        turni.push(tw);
      }
      weekend.push({ sab:s, dom:d, turni });
    }
    out.push({ id:m.id, nome:cognome(m), liberi, obiettivo, weekend });
  }
  return out;
}

// ── 3) PROVA "COSA SERVIREBBE" ──────────────────────────────────────────────
// Ogni prova rigenera il mese con UNA modifica e misura i weekend liberi
// mancanti. La generazione è casuale: ogni prova si ripete (in parallelo nei
// worker, vedi provaWeekendParallelo) e si tiene il risultato migliore.
export interface SpecProva {
  etichetta: string;                         // "" = generazione di riferimento, senza modifiche
  regole?: Partial<Regole>;
  togli?: { id:number; g:number; tipo:string; sott:boolean; est:boolean };
}
export interface ProvaWeekend { etichetta:string; deficit:number; buchi:number; risolve:boolean; migliora:boolean }
export interface EsitoProvaWeekend {
  base: { deficit:number; buchi:number };
  prove: ProvaWeekend[];
  ms: number;
}
const deficitWk = (anno:number, mese:number, ndim:number, medici:Medico[], T:TurniMese) => {
  const c = makeCtx(anno, mese, ndim, medici, T);
  return c.mrMdc.reduce((q,m)=>q+Math.max(0, c.wkTargetMed(m.id)-c.cntWkLiberi(m.id)), 0);
};
/** Le prove da fare: riferimento, massimo notti +1, consecutivi +1, e fino a
 *  maxTogli turni manuali (prima le notti, che consumano il tetto notti, poi i
 *  turni manuali nei weekend di chi è sotto obiettivo). */
export function specProveWeekend(anno:number, mese:number, ndim:number, medici:Medico[], turni:TurniMese, maxTogli=4): SpecProva[] {
  const REG = getRegole();
  const out: SpecProva[] = [
    { etichetta: "" },
    { etichetta: `Massimo notti ${REG.maxNotti+1} invece di ${REG.maxNotti}`, regole: { maxNotti: REG.maxNotti+1 } },
    { etichetta: `Massimo giorni consecutivi ${REG.maxConsec+1} invece di ${REG.maxConsec}`, regole: { maxConsec: REG.maxConsec+1 } },
  ];
  const sotto = new Set(spiegaWeekend(anno, mese, ndim, medici, turni).map(x=>x.id));
  const ex = soloManuali(turni);
  const c = makeCtx(anno, mese, ndim, medici, ex);
  const cand: { id:number; g:number; t:Turno; peso:number }[] = [];
  for(const m of c.mrMdc) for(let g=1; g<=ndim; g++) for(const t of c.gt(m.id,g)){
    if(SPEC.includes(t.tipo)) continue;
    const wk = c.wkPairs.some(([s,d])=>s===g||d===g);
    if(isNot(t.tipo)) cand.push({ id:m.id, g, t, peso: (t.tipo==="3" ? 0 : 1) + (sotto.has(m.id) ? 0 : 2) });
    else if(wk && sotto.has(m.id)) cand.push({ id:m.id, g, t, peso: 1 });
  }
  cand.sort((a,b)=>a.peso-b.peso || a.g-b.g);
  for(const k of cand.slice(0, maxTogli)){
    const m = medici.find(x=>x.id===k.id)!;
    out.push({ etichetta: `Senza ${etichettaTurno(k.t, REG.ambulatori ?? [])}${k.t.sott?" (ALPI)":""} di ${cognome(m)} ${gLbl(anno,mese,k.g)}`,
               togli: { id:k.id, g:k.g, tipo:k.t.tipo, sott:!!k.t.sott, est:!!k.t.est } });
  }
  return out;
}
/** Una prova: rigenera coi soli turni manuali (meno quello tolto) e le regole
 *  modificate; ritorna i weekend liberi mancanti e i buchi. */
export function eseguiProva(anno:number, mese:number, ndim:number, medici:Medico[], turni:TurniMese, spec:SpecProva, ms:number){
  const REG0 = getRegole();
  const ex = soloManuali(turni);
  if(spec.togli){
    const k = spec.togli, cella = ex[k.id]?.[k.g];
    if(cella) cella.t = cella.t.filter(s=>!(s.tipo===k.tipo && !!s.sott===k.sott && !!s.est===k.est));
  }
  setRegole({ ...REG0, ...(spec.regole || {}) });
  try{
    const r = generaMigliorTentativo(anno, mese, ndim, medici, ex, ms);
    return { deficit: deficitWk(anno, mese, ndim, medici, r.turni), buchi: misuraTabellone(anno, mese, ndim, medici, r.turni).buchi };
  } finally { setRegole(REG0); }
}
/** Mette insieme i risultati (più ripetizioni per prova: si tiene la migliore). */
export function componiEsito(spec:SpecProva[], ris:{deficit:number;buchi:number}[][], ms:number): EsitoProvaWeekend {
  const best = (a:{deficit:number;buchi:number}[]) => a.reduce((x,y)=> (y.buchi<x.buchi || (y.buchi===x.buchi && y.deficit<x.deficit)) ? y : x);
  const base = best(ris[0]);
  const prove = spec.slice(1).map((sp,i)=>{ const r=best(ris[i+1]); return { etichetta:sp.etichetta, ...r,
    risolve: r.deficit===0 && r.buchi<=base.buchi, migliora: r.deficit<base.deficit && r.buchi<=base.buchi }; });
  return { base, prove, ms };
}
/** Versione sequenziale (test e harness): ripetizioni × prove generazioni. */
export function provaWeekend(anno:number, mese:number, ndim:number, medici:Medico[], turni:TurniMese,
                             opt: { msPerProva?: number; ripetizioni?: number; maxTogli?: number } = {}): EsitoProvaWeekend {
  const t0 = Date.now();
  const spec = specProveWeekend(anno, mese, ndim, medici, turni, opt.maxTogli ?? 4);
  const ris = spec.map(sp=>Array.from({ length: opt.ripetizioni ?? 2 }, ()=>eseguiProva(anno, mese, ndim, medici, turni, sp, opt.msPerProva ?? 1500)));
  return componiEsito(spec, ris, Date.now()-t0);
}
