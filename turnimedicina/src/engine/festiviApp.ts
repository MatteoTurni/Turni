// ═══════════════════════════════════════════════════════════════════════════
// SEZIONE FESTIVI (v0.3.60) — il piano festivi dentro l'app
// ═══════════════════════════════════════════════════════════════════════════
// Collega il sorteggio (pianoFestivi.ts) ai dati dell'app: i medici sono quelli
// dell'elenco, e saldo, storico e precedenze si LEGGONO dai mesi salvati —
// correggibili a mano. Logica pura: niente localStorage, niente rete.
//
// Come si leggono i turni festivi fatti:
//  • notte prima e notte → chi ha una notte (N o 3) quel giorno: i suoi punti;
//  • giorno → chi ha mattina E pomeriggio: i punti del giorno; solo mattina o
//    solo pomeriggio: metà. Contano anche i turni di PS e quelli sottolineati;
//  • dove il mese non è salvato (o quel turno non ha nessuno) vale il piano
//    festivi che copriva quella data, se c'è.
import type { Medico, TurniAll } from "./types";
import { mkKey } from "./date";
import { isMatt, isPom, isNot } from "./turni";
import {
  type FestivitaPiano, type FestData, type RuoloPref, type CfgPiano, type Soluzione,
  festivitaPeriodo, buildShifts, generaPiano, addDays, iso, periodoSuccessivo, periodoOk,
} from "./pianoFestivi";

export interface TurnoPiano {
  date: string; tipo: "diurno" | "notturno"; nomi: string[]; basi: string[]; chiavi: string[];
  sup: boolean; punti: number; condiviso: boolean;
  medico: number | null; reperibile: number | null; puntiRep: number;
  storico: boolean; pref: boolean;
}
export interface PianoSalvato {
  periodo: { start: string; end: string };
  generato: string;                       // data e ora del sorteggio
  seme: number;
  partecipanti: number[];
  maxShifts: number; minSuper: number; repOn: boolean; repPct: number;
  saldo: Record<number, number>;          // saldo di partenza usato
  turni: TurnoPiano[];
  richieste: number;                      // preferenze chieste…
  richiesteOk: number;                    // …e rispettate
  scartoPrima: number; scartoDopo: number;
}
export interface StatoFestivi {
  periodo: { start: string; end: string };
  maxShifts: number; minSuper: number;
  /** Medici tolti dal sorteggio. */
  esclusi: number[];
  /** Solo turni di giorno, scelto a mano (assente = dalla scheda: «esentato dalle notti»). */
  soloGiorno: Record<number, boolean>;
  /** Correzioni a mano: se presenti vincono sulla lettura automatica. */
  saldoMan: Record<number, number>;
  storicoMan: Record<number, string[]>;
  precMan: Record<number, boolean>;
  /** medico → festività del periodo (nome) → turno richiesto. */
  preferenze: Record<number, Record<string, RuoloPref>>;
  reperibilita: { enabled: boolean; weightPct: number; maxPer: number; nonIdonei: number[] };
  seme: number;
  piano: PianoSalvato | null;
  /** Piani dei periodi precedenti (i più recenti in fondo). */
  archivio: PianoSalvato[];
}

/** Periodo proposto la prima volta: l'anno solare che segue `oggi`. */
export function statoFestiviDefault(oggi: Date = new Date()): StatoFestivi {
  const y = oggi.getFullYear() + 1;
  return { periodo: { start: iso(y, 1, 1), end: iso(y, 12, 31) }, maxShifts: 5, minSuper: 1, esclusi: [], soloGiorno: {},
    saldoMan: {}, storicoMan: {}, precMan: {}, preferenze: {}, reperibilita: { enabled: false, weightPct: 40, maxPer: 5, nonIdonei: [] },
    seme: 1, piano: null, archivio: [] };
}
const isData = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v) && !isNaN(Date.parse(v + "T00:00:00Z"));
const numIn = (v: unknown, lo: number, hi: number, def: number) => typeof v === "number" && isFinite(v) && v >= lo && v <= hi ? v : def;
const ids = (v: unknown): number[] => Array.isArray(v) ? [...new Set(v.filter(x => Number.isInteger(x)))] as number[] : [];
function sanaPiano(x: unknown): PianoSalvato | null {
  if (!x || typeof x !== "object") return null;
  const p = x as Partial<PianoSalvato>;
  if (!p.periodo || !isData(p.periodo.start) || !isData(p.periodo.end) || !Array.isArray(p.turni)) return null;
  const turni: TurnoPiano[] = [];
  for (const t of p.turni) {
    if (!t || !isData(t.date) || (t.tipo !== "diurno" && t.tipo !== "notturno")) continue;
    const str = (a: unknown) => Array.isArray(a) ? a.filter(s => typeof s === "string") as string[] : [];
    turni.push({ date: t.date, tipo: t.tipo, nomi: str(t.nomi), basi: str(t.basi), chiavi: str(t.chiavi), sup: !!t.sup,
      punti: numIn(t.punti, 0, 99, 0), condiviso: !!t.condiviso,
      medico: Number.isInteger(t.medico) ? t.medico : null, reperibile: Number.isInteger(t.reperibile) ? t.reperibile : null,
      puntiRep: numIn(t.puntiRep, 0, 99, 0), storico: !!t.storico, pref: !!t.pref });
  }
  const saldo: Record<number, number> = {};
  for (const [k, v] of Object.entries(p.saldo || {})) if (typeof v === "number" && isFinite(v)) saldo[+k] = v;
  return { periodo: { start: p.periodo.start, end: p.periodo.end }, generato: typeof p.generato === "string" ? p.generato : "",
    seme: numIn(p.seme, 0, 1e9, 1), partecipanti: ids(p.partecipanti), maxShifts: numIn(p.maxShifts, 1, 30, 5), minSuper: numIn(p.minSuper, 0, 9, 1),
    repOn: !!p.repOn, repPct: numIn(p.repPct, 0, 100, 40), saldo, turni,
    richieste: numIn(p.richieste, 0, 9999, 0), richiesteOk: numIn(p.richiesteOk, 0, 9999, 0),
    scartoPrima: numIn(p.scartoPrima, 0, 9999, 0), scartoDopo: numIn(p.scartoDopo, 0, 9999, 0) };
}
/** Stato salvato → stato valido (campi mancanti o guasti: valori predefiniti). */
export function mergeStatoFestivi(x: unknown, oggi: Date = new Date()): StatoFestivi {
  const d = statoFestiviDefault(oggi);
  if (!x || typeof x !== "object") return d;
  const s = x as Partial<StatoFestivi>;
  const per = s.periodo && isData(s.periodo.start) && isData(s.periodo.end) && !periodoOk(s.periodo.start, s.periodo.end)
    ? { start: s.periodo.start, end: s.periodo.end } : d.periodo;
  const mappa = <T,>(v: unknown, ok: (q: unknown) => T | undefined): Record<number, T> => {
    const out: Record<number, T> = {};
    if (v && typeof v === "object") for (const [k, q] of Object.entries(v)) { const r = ok(q); if (Number.isInteger(+k) && r !== undefined) out[+k] = r; }
    return out;
  };
  const RUOLI = ["any", "nottePrima", "giorno", "notte"];
  const r = (s.reperibilita || {}) as Partial<StatoFestivi["reperibilita"]>;
  return {
    periodo: per,
    maxShifts: Math.round(numIn(s.maxShifts, 1, 20, d.maxShifts)), minSuper: Math.round(numIn(s.minSuper, 0, 5, d.minSuper)),
    esclusi: ids(s.esclusi),
    soloGiorno: mappa(s.soloGiorno, q => typeof q === "boolean" ? q : undefined),
    saldoMan: mappa(s.saldoMan, q => typeof q === "number" && isFinite(q) ? q : undefined),
    storicoMan: mappa(s.storicoMan, q => Array.isArray(q) ? q.filter(n => typeof n === "string") as string[] : undefined),
    precMan: mappa(s.precMan, q => typeof q === "boolean" ? q : undefined),
    preferenze: mappa(s.preferenze, q => {
      if (!q || typeof q !== "object") return undefined;
      const o: Record<string, RuoloPref> = {};
      for (const [n, ru] of Object.entries(q)) if (RUOLI.includes(ru as string)) o[n] = ru as RuoloPref;
      return o;
    }),
    reperibilita: { enabled: !!r.enabled, weightPct: numIn(r.weightPct, 0, 100, 40), maxPer: Math.round(numIn(r.maxPer, 1, 99, 5)), nonIdonei: ids(r.nonIdonei) },
    seme: Math.round(numIn(s.seme, 1, 1e9, 1)),
    piano: sanaPiano(s.piano),
    archivio: (Array.isArray(s.archivio) ? s.archivio.map(sanaPiano).filter((p): p is PianoSalvato => !!p) : []).slice(-6),
  };
}

// ── LETTURA DEI TURNI FESTIVI FATTI ──────────────────────────────────────────
export interface TurnoLetto {
  date: string; tipo: "diurno" | "notturno"; nomi: string[]; basi: string[]; sup: boolean; punti: number;
  /** Chi l'ha fatto e per quanta parte (1 = intero, 0,5 = solo mattina o solo pomeriggio). */
  chi: { id: number; quota: number }[];
  fonte: "mese" | "piano" | null;
  /** Data di ciascuna festività a cui il turno appartiene (per lo storico). */
  feste: { base: string; data: string }[];
}
/** I turni festivi fra `da` e `a` (comprese) con chi li ha fatti. */
export function leggiTurniFestivi(turniAll: TurniAll, medici: Medico[], lista: FestivitaPiano[], da: string, a: string, piani: PianoSalvato[] = []): TurnoLetto[] {
  if (a < da) return [];
  const noti = new Set(medici.map(m => m.id));
  const daPiano = new Map<string, number>();
  for (const p of piani) for (const t of p.turni) if (t.medico != null) daPiano.set(t.date + "|" + t.tipo, t.medico);   // i più recenti vincono
  const out: TurnoLetto[] = [];
  for (const s of buildShifts(festivitaPeriodo(lista, da, a))) {
    const [y, m, g] = s.date.split("-").map(Number);
    const T = turniAll[mkKey(y, m - 1)];
    const chi: { id: number; quota: number }[] = [];
    if (T) for (const idS of Object.keys(T)) {
      const id = +idS; if (!noti.has(id)) continue;
      const tt = T[id]?.[g]?.t || [];
      if (s.tipo === "notturno") { if (tt.some(x => isNot(x.tipo))) chi.push({ id, quota: 1 }); }
      else { const q = (tt.some(x => isMatt(x.tipo)) ? 0.5 : 0) + (tt.some(x => isPom(x.tipo)) ? 0.5 : 0); if (q) chi.push({ id, quota: q }); }
    }
    let fonte: TurnoLetto["fonte"] = chi.length ? "mese" : null;
    if (!chi.length) { const id = daPiano.get(s.date + "|" + s.tipo); if (id != null && noti.has(id)) { chi.push({ id, quota: 1 }); fonte = "piano"; } }
    out.push({ date: s.date, tipo: s.tipo, nomi: s.holNames, basi: s.holBases, sup: s.isSuper, punti: s.points, chi, fonte,
      feste: s.contribs.map(c => ({ base: c.hol.base, data: c.hol.date })) });
  }
  return out;
}

export interface AutoFestivi {
  /** Da dove partono i conti: dal piano precedente o dai soli mesi salvati. */
  origine: "piano" | "mesi";
  /** Intervallo riletto per il saldo. */
  da: string; a: string;
  /** Punti fatti nell'intervallo (per medico). */
  punti: Record<number, number>;
  /** Saldo del piano precedente da cui si riparte (0 senza piano). */
  riporto: Record<number, number>;
  /** Saldo automatico dei partecipanti: riporto + punti, tolto il minimo. */
  saldo: Record<number, number>;
  /** Per medico, i tipi di festività fatti l'ultima volta. */
  storico: Record<number, string[]>;
  /** Chi nel periodo precedente è rimasto sotto il minimo di superfestivi. */
  precedenza: number[];
  /** Turni riletti per il saldo: dai mesi, dal piano, senza dati. */
  nMese: number; nPiano: number; nVuoti: number;
  letti: TurnoLetto[];
}
const anniPrima = (d: string, n: number) => { const [y, m, g] = d.split("-").map(Number); return iso(y - n, m, m === 2 && g === 29 ? 28 : g); };
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Saldo, storico e precedenze letti dai mesi salvati per il periodo che inizia a `start`. */
export function automaticiFestivi(st: Pick<StatoFestivi, "periodo" | "minSuper" | "archivio" | "piano">, turniAll: TurniAll, medici: Medico[],
  lista: FestivitaPiano[], anni: number, partecipanti: number[]): AutoFestivi {
  const start = st.periodo.start, a = addDays(start, -1);
  // i piani che finiscono prima del periodo: l'ultimo è «il piano precedente»
  const piani = [...st.archivio, ...(st.piano ? [st.piano] : [])].filter(p => p.periodo.end < start)
    .sort((x, y) => x.periodo.start.localeCompare(y.periodo.start));
  const prec = piani.length ? piani[piani.length - 1] : null;
  const da = prec ? prec.periodo.start : anniPrima(start, Math.max(1, anni));
  const letti = leggiTurniFestivi(turniAll, medici, lista, da, a, piani);
  const punti: Record<number, number> = {}, riporto: Record<number, number> = {};
  for (const m of medici) { punti[m.id] = 0; riporto[m.id] = prec ? (+prec.saldo[m.id] || 0) : 0; }
  let nMese = 0, nPiano = 0, nVuoti = 0;
  for (const t of letti) {
    if (t.fonte === "mese") nMese++; else if (t.fonte === "piano") nPiano++; else nVuoti++;
    for (const c of t.chi) punti[c.id] = r2((punti[c.id] || 0) + t.punti * c.quota);
  }
  const tot = partecipanti.map(id => (riporto[id] || 0) + (punti[id] || 0));
  const mn = tot.length ? Math.min(...tot) : 0;
  const saldo: Record<number, number> = {};
  partecipanti.forEach((id, i) => { saldo[id] = r2(tot[i] - mn); });

  // storico: per ogni tipo di festività, chi l'ha fatta l'ULTIMA volta (negli anni chiesti)
  const lettiSt = leggiTurniFestivi(turniAll, medici, lista, anniPrima(start, Math.max(1, anni)), a, piani);
  const ultima = new Map<string, string>();           // tipo → data dell'ultima volta con dati
  for (const t of lettiSt) if (t.chi.length) for (const f of t.feste) if (!ultima.has(f.base) || ultima.get(f.base)! < f.data) ultima.set(f.base, f.data);
  const st2: Record<number, Set<string>> = {};
  for (const t of lettiSt) for (const f of t.feste) if (ultima.get(f.base) === f.data) for (const c of t.chi) (st2[c.id] ||= new Set()).add(f.base);
  const storico: Record<number, string[]> = {};
  for (const m of medici) storico[m.id] = [...(st2[m.id] || [])];

  // precedenza: nel periodo precedente (il piano precedente, o gli ultimi 12 mesi) sotto il minimo di superfestivi
  const daPrec = prec ? prec.periodo.start : anniPrima(start, 1);
  const sup = lettiSt.concat(letti).filter((t, i, arr) => t.sup && t.date >= addDays(daPrec, -1) && arr.findIndex(q => q.date === t.date && q.tipo === t.tipo) === i);
  const nSup: Record<number, number> = {};
  for (const t of sup) for (const c of t.chi) nSup[c.id] = (nSup[c.id] || 0) + 1;
  const precedenza = sup.some(t => t.chi.length) && st.minSuper > 0 ? partecipanti.filter(id => (nSup[id] || 0) < st.minSuper) : [];
  return { origine: prec ? "piano" : "mesi", da, a, punti, riporto, saldo, storico, precedenza, nMese, nPiano, nVuoti, letti };
}

// ── DAL PANNELLO AL SORTEGGIO ────────────────────────────────────────────────
export interface DatiSorteggio {
  partecipanti: Medico[];
  feste: FestData[];
  soloGiorno: Set<number>;
  saldo: Record<number, number>;
  storico: Record<number, string[]>;
  precedenza: Set<number>;
  cfg: CfgPiano;
}
/** Esentato dalle notti nella scheda (vale solo per MR e decreto Calabria). */
export const esenteNotti = (m: Medico) => !!m.noNotti && (m.stato === "MR" || m.stato === "MDC");
/** Tutto ciò che serve al sorteggio: scelte del pannello, con i valori automatici dove non corretti a mano. */
export function datiSorteggio(st: StatoFestivi, medici: Medico[], lista: FestivitaPiano[], auto: AutoFestivi): DatiSorteggio {
  const partecipanti = medici.filter(m => !st.esclusi.includes(m.id));
  const feste = periodoOk(st.periodo.start, st.periodo.end) ? [] : festivitaPeriodo(lista, st.periodo.start, st.periodo.end);
  const nomiFeste = new Set(feste.map(h => h.name));
  const k = (id: number) => String(id);
  const soloGiorno = new Set(partecipanti.filter(m => st.soloGiorno[m.id] ?? esenteNotti(m)).map(m => m.id));
  const saldo: Record<number, number> = {}, storico: Record<number, string[]> = {};
  const precedenza = new Set<number>();
  for (const m of partecipanti) {
    saldo[m.id] = st.saldoMan[m.id] ?? auto.saldo[m.id] ?? 0;
    storico[m.id] = st.storicoMan[m.id] ?? auto.storico[m.id] ?? [];
    if (st.precMan[m.id] ?? auto.precedenza.includes(m.id)) precedenza.add(m.id);
  }
  const preferences: Record<string, Record<string, RuoloPref>> = {};
  for (const m of partecipanti) {
    const p = Object.entries(st.preferenze[m.id] || {}).filter(([n]) => nomiFeste.has(n));
    if (p.length) preferences[k(m.id)] = Object.fromEntries(p);
  }
  const cfg: CfgPiano = {
    doctors: partecipanti.map(m => k(m.id)), holidays: feste, maxShifts: st.maxShifts, minSuper: st.minSuper,
    saldo: Object.fromEntries(partecipanti.map(m => [k(m.id), saldo[m.id]])),
    history: Object.fromEntries(partecipanti.map(m => [k(m.id), storico[m.id]])),
    superPrio: [...precedenza].map(k), preferences,
    onCall: { enabled: st.reperibilita.enabled, weightPct: st.reperibilita.weightPct, maxPer: st.reperibilita.maxPer,
      eligible: partecipanti.filter(m => !st.reperibilita.nonIdonei.includes(m.id)).map(m => k(m.id)) },
    soloDiurni: [...soloGiorno].map(k), baseSeed: st.seme,
  };
  return { partecipanti, feste, soloGiorno, saldo, storico, precedenza, cfg };
}
/** Esegue il sorteggio e lo restituisce nel formato che l'app salva. */
export function sorteggia(d: DatiSorteggio, st: StatoFestivi, quando: string): { piano: PianoSalvato; sol: Soluzione } {
  const sol = generaPiano(d.cfg);
  const num = (s: string | null) => s == null ? null : +s;
  const richieste = Object.values(sol.prefItems || {}).reduce((n, a) => n + a.length, 0);
  let richiesteOk = 0;
  for (const [doc, items] of Object.entries(sol.prefItems || {})) for (const it of items)
    if (sol.assignments.some(a => a.doctor === doc && (it.role === "any" ? a.holNames.includes(it.hol) : a.keys.includes(it.hol + "|" + it.role)))) richiesteOk++;
  const piano: PianoSalvato = {
    periodo: { ...st.periodo }, generato: quando, seme: st.seme, partecipanti: d.partecipanti.map(m => m.id),
    maxShifts: st.maxShifts, minSuper: st.minSuper, repOn: st.reperibilita.enabled, repPct: st.reperibilita.weightPct,
    saldo: { ...d.saldo },
    turni: sol.assignments.map(a => ({ date: a.date, tipo: a.tipo, nomi: a.holNames, basi: a.holBases, chiavi: a.keys, sup: a.isSuper, punti: a.points,
      condiviso: a.shared, medico: num(a.doctor), reperibile: num(a.onCall), puntiRep: a.onCallPoints, storico: a.histHit, pref: a.prefHit })),
    richieste, richiesteOk, scartoPrima: sol.spreadBefore ?? 0, scartoDopo: sol.spreadAfter ?? 0,
  };
  return { piano, sol };
}

export interface RigaRiepilogo {
  id: number; saldo: number; punti: number; nRep: number; puntiRep: number; totale: number;
  turni: number; diurni: number; notturni: number; superfestivi: number; pref: number;
}
/** Riepilogo per medico di un piano salvato. */
export function riepilogoPiano(p: PianoSalvato): RigaRiepilogo[] {
  return p.partecipanti.map(id => {
    const miei = p.turni.filter(t => t.medico === id), rep = p.turni.filter(t => t.reperibile === id);
    const punti = r2(miei.reduce((s, t) => s + t.punti, 0)), puntiRep = r2(rep.reduce((s, t) => s + t.puntiRep, 0));
    const saldo = +p.saldo[id] || 0;
    return { id, saldo, punti, nRep: rep.length, puntiRep, totale: r2(saldo + punti + puntiRep), turni: miei.length,
      diurni: miei.filter(t => t.tipo === "diurno").length, notturni: miei.filter(t => t.tipo === "notturno").length,
      superfestivi: miei.filter(t => t.sup).length, pref: miei.filter(t => t.pref).length };
  });
}
export interface Controllo { ok: boolean; testo: string }
/** Verifica dei vincoli di un piano salvato (indipendente dal sorteggio). */
export function controlliPiano(p: PianoSalvato, soloGiorno: Set<number>, nome: (id: number) => string): Controllo[] {
  const out: Controllo[] = [];
  const dd = (a: string, b: string) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
  const scoperti = p.turni.filter(t => t.medico == null).length;
  out.push({ ok: !scoperti, testo: scoperti ? `${scoperti} turni senza medico: alza il massimo di turni o aggiungi medici` : `Tutti i ${p.turni.length} turni hanno un medico` });
  const troppi: string[] = [], vicini: string[] = [], senzaSup: string[] = [], nottiEs: string[] = [], doppi: string[] = [];
  for (const id of p.partecipanti) {
    const miei = p.turni.filter(t => t.medico === id).sort((a, b) => a.date.localeCompare(b.date));
    if (miei.length > p.maxShifts) troppi.push(`${nome(id)} (${miei.length})`);
    if (miei.some((t, i) => i > 0 && dd(t.date, miei[i - 1].date) < 2)) vicini.push(nome(id));
    if (miei.filter(t => t.sup).length < p.minSuper) senzaSup.push(nome(id));
    if (soloGiorno.has(id) && (miei.some(t => t.tipo === "notturno") || p.turni.some(t => t.reperibile === id && t.tipo === "notturno"))) nottiEs.push(nome(id));
    if (p.turni.some(t => t.reperibile === id && miei.some(x => x.date === t.date))) doppi.push(nome(id));
  }
  out.push({ ok: !troppi.length, testo: troppi.length ? `Oltre il massimo di ${p.maxShifts} turni: ${troppi.join(", ")}` : `Nessuno supera ${p.maxShifts} turni` });
  out.push({ ok: !vicini.length, testo: vicini.length ? `Turni lo stesso giorno o in giorni consecutivi: ${vicini.join(", ")}` : "Mai due turni lo stesso giorno o in giorni consecutivi" });
  if (p.minSuper > 0) out.push({ ok: !senzaSup.length, testo: senzaSup.length ? `Sotto il minimo di ${p.minSuper} superfestiv${p.minSuper === 1 ? "o" : "i"}: ${senzaSup.join(", ")}` : `Tutti hanno almeno ${p.minSuper} superfestiv${p.minSuper === 1 ? "o" : "i"}` });
  if (soloGiorno.size) out.push({ ok: !nottiEs.length, testo: nottiEs.length ? `Notti a chi fa solo turni di giorno: ${nottiEs.join(", ")}` : "Chi fa solo turni di giorno non ha notti" });
  if (p.richieste) out.push({ ok: p.richiesteOk === p.richieste, testo: `Preferenze rispettate: ${p.richiesteOk} su ${p.richieste}` });
  const ripetute = p.turni.filter(t => t.storico && !t.pref).length;
  out.push({ ok: !ripetute, testo: ripetute ? `${ripetute} turni a chi aveva già fatto la stessa festività l'ultima volta` : "Nessuno ripete una festività fatta l'ultima volta" });
  if (p.repOn) {
    const senza = p.turni.filter(t => t.reperibile == null).length;
    out.push({ ok: !senza, testo: senza ? `${senza} turni senza reperibile` : "Ogni turno ha un reperibile" });
    out.push({ ok: !doppi.length, testo: doppi.length ? `Titolare e reperibile lo stesso giorno: ${doppi.join(", ")}` : "Mai titolare e reperibile lo stesso giorno" });
  }
  return out;
}
/** Passa al periodo successivo: il piano va in archivio, saldo e storico si rileggono da capo. */
export function prossimoPeriodo(st: StatoFestivi): StatoFestivi {
  const base = st.piano ? st.piano.periodo : st.periodo;
  return { ...st, periodo: periodoSuccessivo(base), piano: null, archivio: st.piano ? [...st.archivio, st.piano].slice(-6) : st.archivio,
    saldoMan: {}, storicoMan: {}, precMan: {}, preferenze: {}, seme: 1 };
}
/** Un medico eliminato dall'app esce anche dalla sezione Festivi: un nuovo medico con lo stesso numero non eredita nulla. */
export function rimuoviMedicoFestivi(st: StatoFestivi, id: number): StatoFestivi {
  const senza = <T,>(o: Record<number, T>) => { const { [id]: _via, ...resto } = o; return resto; };
  const pulisci = (p: PianoSalvato): PianoSalvato => ({ ...p, partecipanti: p.partecipanti.filter(x => x !== id), saldo: senza(p.saldo),
    turni: p.turni.map(t => ({ ...t, medico: t.medico === id ? null : t.medico, reperibile: t.reperibile === id ? null : t.reperibile, puntiRep: t.reperibile === id ? 0 : t.puntiRep })) });
  return { ...st, esclusi: st.esclusi.filter(x => x !== id), soloGiorno: senza(st.soloGiorno), saldoMan: senza(st.saldoMan), storicoMan: senza(st.storicoMan),
    precMan: senza(st.precMan), preferenze: senza(st.preferenze),
    reperibilita: { ...st.reperibilita, nonIdonei: st.reperibilita.nonIdonei.filter(x => x !== id) },
    piano: st.piano ? pulisci(st.piano) : null, archivio: st.archivio.map(pulisci) };
}
