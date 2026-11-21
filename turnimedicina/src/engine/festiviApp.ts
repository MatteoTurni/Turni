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
import type { Medico, TurniAll, TurniMese, Turno } from "./types";
import { mkKey, dowOf, isSabN, isFestivo } from "./date";
import { getRegole } from "./regole";
import { isMatt, isPom, isNot, SPEC } from "./turni";
import {
  type FestivitaPiano, type FestData, type RuoloPref, type PrefFesta, type CfgPiano, type Soluzione, prefMatches,
  festivitaPeriodo, buildShifts, generaPiano, addDays, iso, periodoSuccessivo, periodoOk, chiaveTurno, diffDays, normalizePrefs,
} from "./pianoFestivi";

export interface TurnoPiano {
  date: string; tipo: "diurno" | "notturno"; nomi: string[]; basi: string[]; chiavi: string[];
  sup: boolean; punti: number; condiviso: boolean;
  medico: number | null; reperibile: number | null; puntiRep: number;
  storico: boolean; pref: boolean;
  /** Assegnato prima del sorteggio (v0.3.73). */
  fisso?: boolean;
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
  /** Medici che facevano solo i turni assegnati (v0.3.73): fuori dall'equità. */
  soloAssegnati?: number[];
}
/** Un turno assegnato a mano prima del sorteggio (v0.3.73). */
export interface TurnoAssegnato { date: string; tipo: "diurno" | "notturno"; id: number }
export interface StatoFestivi {
  periodo: { start: string; end: string };
  maxShifts: number; minSuper: number;
  /** Medici tolti dal sorteggio. */
  esclusi: number[];
  /** Solo turni di giorno, scelto a mano (assente = dalla scheda: «esentato dalle notti»). */
  soloGiorno: Record<number, boolean>;
  /** Correzioni a mano: se presenti vincono sulla lettura automatica. */
  saldoMan: Record<number, number>;
  /** Periodo in cui contare i punti del saldo (v0.3.63), scelto a mano: contano
   *  solo i punti fatti fra queste date, senza il saldo del piano precedente.
   *  null = automatico (piano precedente + punti da allora, o gli ultimi anni). */
  periodoSaldo: { start: string; end: string } | null;
  storicoMan: Record<number, string[]>;
  precMan: Record<number, boolean>;
  /** medico → festività del periodo (nome) → turno richiesto, o più turni
   *  (v0.3.68) di cui ne basta uno. */
  preferenze: Record<number, Record<string, PrefFesta>>;
  reperibilita: { enabled: boolean; weightPct: number; maxPer: number; nonIdonei: number[] };
  /** v0.3.73: turni già assegnati prima del sorteggio (solo per questo periodo). */
  assegnati: TurnoAssegnato[];
  /** v0.3.73: medici che fanno solo i turni assegnati (niente altro, fuori dall'equità). */
  soloAssegnati: number[];
  /** v0.3.70: almeno un turno da titolare a testa (se i turni bastano) e
   *  reperibilità in proporzione. */
  bilanciaRuoli: boolean;
  /** v0.3.70: preferenze difese solo se stanno nella parte di punti del medico. */
  prefEntroQuota: boolean;
  seme: number;
  piano: PianoSalvato | null;
  /** Piani dei periodi precedenti (i più recenti in fondo). */
  archivio: PianoSalvato[];
  /** Turni che l'app ha scritto nei mesi dal piano (v0.3.61), per mese "AAAA-MM":
   *  servono a toglierli o a sostituirli dopo un nuovo sorteggio. */
  inseriti: Record<string, InserimentoMese>;
}
/** Un turno del piano scritto in un mese: medico, giorno e codici messi (N oppure M e P). */
export interface TurnoInserito { id: number; g: number; tipi: string[] }
export interface InserimentoMese { generato: string; turni: TurnoInserito[] }

/** Periodo proposto la prima volta: l'anno solare che segue `oggi`. */
export function statoFestiviDefault(oggi: Date = new Date()): StatoFestivi {
  const y = oggi.getFullYear() + 1;
  return { periodo: { start: iso(y, 1, 1), end: iso(y, 12, 31) }, maxShifts: 5, minSuper: 1, esclusi: [], soloGiorno: {},
    saldoMan: {}, periodoSaldo: null, storicoMan: {}, precMan: {}, preferenze: {}, reperibilita: { enabled: false, weightPct: 40, maxPer: 5, nonIdonei: [] },
    assegnati: [], soloAssegnati: [], bilanciaRuoli: true, prefEntroQuota: true, seme: 1, piano: null, archivio: [], inseriti: {} };
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
      puntiRep: numIn(t.puntiRep, 0, 99, 0), storico: !!t.storico, pref: !!t.pref, ...(t.fisso ? { fisso: true } : {}) });
  }
  const saldo: Record<number, number> = {};
  for (const [k, v] of Object.entries(p.saldo || {})) if (typeof v === "number" && isFinite(v)) saldo[+k] = v;
  return { periodo: { start: p.periodo.start, end: p.periodo.end }, generato: typeof p.generato === "string" ? p.generato : "",
    seme: numIn(p.seme, 0, 1e9, 1), partecipanti: ids(p.partecipanti), maxShifts: numIn(p.maxShifts, 1, 30, 5), minSuper: numIn(p.minSuper, 0, 9, 1),
    repOn: !!p.repOn, repPct: numIn(p.repPct, 0, 100, 40), saldo, turni,
    richieste: numIn(p.richieste, 0, 9999, 0), richiesteOk: numIn(p.richiesteOk, 0, 9999, 0),
    scartoPrima: numIn(p.scartoPrima, 0, 9999, 0), scartoDopo: numIn(p.scartoDopo, 0, 9999, 0),
    ...(ids(p.soloAssegnati).length ? { soloAssegnati: ids(p.soloAssegnati) } : {}) };
}
function sanaInseriti(x: unknown): Record<string, InserimentoMese> {
  const out: Record<string, InserimentoMese> = {};
  if (!x || typeof x !== "object") return out;
  for (const [k, v] of Object.entries(x)) {
    if (!/^\d{4}-\d\d$/.test(k) || !v || typeof v !== "object" || !Array.isArray((v as InserimentoMese).turni)) continue;
    const turni = (v as InserimentoMese).turni.filter(t => t && Number.isInteger(t.id) && Number.isInteger(t.g) && Array.isArray(t.tipi) && t.tipi.every(c => c === "M" || c === "P" || c === "N"))
      .map(t => ({ id: t.id, g: t.g, tipi: [...t.tipi] }));
    out[k] = { generato: typeof (v as InserimentoMese).generato === "string" ? (v as InserimentoMese).generato : "", turni };
  }
  return out;
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
    periodoSaldo: s.periodoSaldo && isData(s.periodoSaldo.start) && isData(s.periodoSaldo.end) && s.periodoSaldo.start <= s.periodoSaldo.end
      ? { start: s.periodoSaldo.start, end: s.periodoSaldo.end } : null,
    storicoMan: mappa(s.storicoMan, q => Array.isArray(q) ? q.filter(n => typeof n === "string") as string[] : undefined),
    precMan: mappa(s.precMan, q => typeof q === "boolean" ? q : undefined),
    preferenze: mappa(s.preferenze, q => {
      if (!q || typeof q !== "object") return undefined;
      const o: Record<string, PrefFesta> = {};
      for (const [n, ru] of Object.entries(q)) {
        if (RUOLI.includes(ru as string)) o[n] = ru as RuoloPref;
        else if (Array.isArray(ru)) {                                        // più turni (v0.3.68)
          const v = (["nottePrima", "giorno", "notte"] as const).filter(r => ru.includes(r));
          if (v.length) o[n] = v.length === 1 ? v[0] : [...v];
        }
      }
      return o;
    }),
    reperibilita: { enabled: !!r.enabled, weightPct: numIn(r.weightPct, 0, 100, 40), maxPer: Math.round(numIn(r.maxPer, 1, 99, 5)), nonIdonei: ids(r.nonIdonei) },
    assegnati: (() => {                                                      // v0.3.73: un medico per turno, l'ultimo vince
      const per = new Map<string, TurnoAssegnato>();
      for (const a of Array.isArray(s.assegnati) ? s.assegnati : [])
        if (a && isData(a.date) && (a.tipo === "diurno" || a.tipo === "notturno") && Number.isInteger(a.id)) per.set(a.date + "|" + a.tipo, { date: a.date, tipo: a.tipo, id: a.id });
      return [...per.values()].sort((x, y) => (x.date + x.tipo).localeCompare(y.date + y.tipo));
    })(),
    soloAssegnati: ids(s.soloAssegnati),
    bilanciaRuoli: typeof s.bilanciaRuoli === "boolean" ? s.bilanciaRuoli : d.bilanciaRuoli,
    prefEntroQuota: typeof s.prefEntroQuota === "boolean" ? s.prefEntroQuota : d.prefEntroQuota,
    seme: Math.round(numIn(s.seme, 1, 1e9, 1)),
    piano: sanaPiano(s.piano),
    archivio: (Array.isArray(s.archivio) ? s.archivio.map(sanaPiano).filter((p): p is PianoSalvato => !!p) : []).slice(-6),
    inseriti: sanaInseriti(s.inseriti),
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
  /** Da dove partono i conti: dal piano precedente, dai soli mesi salvati
   *  degli ultimi anni, o dal periodo scelto a mano. */
  origine: "piano" | "mesi" | "scelto";
  /** Periodo scelto a mano non valido (allora vale l'automatico); "" = nessun errore. */
  errPeriodoSaldo: string;
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

/** Il periodo dei punti scelto a mano va bene per un piano che inizia a `start`? "" = sì. */
export function periodoSaldoOk(ps: { start: string; end: string }, start: string): string {
  if (ps.end < ps.start) return "La data di fine viene prima di quella di inizio.";
  if (ps.end >= start) return `Il periodo dei punti deve finire prima dell'inizio del piano (${fmtGiorno(start)}).`;
  return "";
}
const fmtGiorno = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4);

/** Saldo, storico e precedenze letti dai mesi salvati per il periodo che inizia a `start`. */
export function automaticiFestivi(st: Pick<StatoFestivi, "periodo" | "minSuper" | "archivio" | "piano"> & { periodoSaldo?: StatoFestivi["periodoSaldo"] },
  turniAll: TurniAll, medici: Medico[], lista: FestivitaPiano[], anni: number, partecipanti: number[]): AutoFestivi {
  const start = st.periodo.start, ieri = addDays(start, -1);
  // i piani che finiscono prima del periodo: l'ultimo è «il piano precedente»
  const piani = [...st.archivio, ...(st.piano ? [st.piano] : [])].filter(p => p.periodo.end < start)
    .sort((x, y) => x.periodo.start.localeCompare(y.periodo.start));
  const prec = piani.length ? piani[piani.length - 1] : null;
  // PERIODO SCELTO A MANO (v0.3.63): solo i punti fatti fra le due date, senza riporto
  const errPeriodoSaldo = st.periodoSaldo ? periodoSaldoOk(st.periodoSaldo, start) : "";
  const scelto = st.periodoSaldo && !errPeriodoSaldo ? st.periodoSaldo : null;
  const da = scelto ? scelto.start : prec ? prec.periodo.start : anniPrima(start, Math.max(1, anni));
  const a = scelto ? scelto.end : ieri;
  const letti = leggiTurniFestivi(turniAll, medici, lista, da, a, piani);
  const punti: Record<number, number> = {}, riporto: Record<number, number> = {};
  for (const m of medici) { punti[m.id] = 0; riporto[m.id] = prec && !scelto ? (+prec.saldo[m.id] || 0) : 0; }
  let nMese = 0, nPiano = 0, nVuoti = 0;
  for (const t of letti) {
    if (t.fonte === "mese") nMese++; else if (t.fonte === "piano") nPiano++; else nVuoti++;
    for (const c of t.chi) punti[c.id] = r2((punti[c.id] || 0) + t.punti * c.quota);
  }
  const tot = partecipanti.map(id => (riporto[id] || 0) + (punti[id] || 0));
  // v0.3.73: chi nel piano precedente faceva solo i turni assegnati non entra
  // nell'equità: il minimo si prende fra gli altri e il suo saldo è la media
  // dei loro (né in credito né in debito)
  const fuori = new Set(prec && !scelto ? prec.soloAssegnati || [] : []);
  const dentro = partecipanti.map((id, i) => fuori.has(id) ? null : tot[i]).filter((v): v is number => v !== null);
  const mn = dentro.length ? Math.min(...dentro) : tot.length ? Math.min(...tot) : 0;
  const saldo: Record<number, number> = {};
  partecipanti.forEach((id, i) => { if (!fuori.has(id)) saldo[id] = r2(tot[i] - mn); });
  const media = dentro.length ? r2(dentro.reduce((t, v) => t + v - mn, 0) / dentro.length) : 0;
  for (const id of partecipanti) if (fuori.has(id)) saldo[id] = media;

  // storico: per ogni tipo di festività, chi l'ha fatta l'ULTIMA volta (negli anni chiesti)
  const lettiSt = leggiTurniFestivi(turniAll, medici, lista, anniPrima(start, Math.max(1, anni)), ieri, piani);
  const ultima = new Map<string, string>();           // tipo → data dell'ultima volta con dati
  for (const t of lettiSt) if (t.chi.length) for (const f of t.feste) if (!ultima.has(f.base) || ultima.get(f.base)! < f.data) ultima.set(f.base, f.data);
  const st2: Record<number, Set<string>> = {};
  for (const t of lettiSt) for (const f of t.feste) if (ultima.get(f.base) === f.data) for (const c of t.chi) (st2[c.id] ||= new Set()).add(f.base);
  const storico: Record<number, string[]> = {};
  for (const m of medici) storico[m.id] = [...(st2[m.id] || [])];

  // precedenza: nel periodo precedente (il piano precedente, o gli ultimi 12 mesi) sotto il minimo di superfestivi
  const daPrec = prec ? prec.periodo.start : anniPrima(start, 1);
  // (non dipende dal periodo dei punti scelto a mano: si rilegge la finestra del periodo precedente)
  const lettiPrec = scelto ? leggiTurniFestivi(turniAll, medici, lista, addDays(daPrec, -1), ieri, piani) : letti;
  const sup = lettiSt.concat(lettiPrec).filter((t, i, arr) => t.sup && t.date >= addDays(daPrec, -1) && arr.findIndex(q => q.date === t.date && q.tipo === t.tipo) === i);
  const nSup: Record<number, number> = {};
  for (const t of sup) for (const c of t.chi) nSup[c.id] = (nSup[c.id] || 0) + 1;
  const precedenza = sup.some(t => t.chi.length) && st.minSuper > 0 ? partecipanti.filter(id => (nSup[id] || 0) < st.minSuper) : [];
  return { origine: scelto ? "scelto" : prec ? "piano" : "mesi", errPeriodoSaldo, da, a, punti, riporto, saldo, storico, precedenza, nMese, nPiano, nVuoti, letti };
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
  /** v0.3.73: turni assegnati validi per questo periodo (turno del periodo, medico nel sorteggio). */
  assegnati: TurnoAssegnato[];
  /** v0.3.73: medici che fanno solo i turni assegnati (fuori dal sorteggio). */
  solo: Set<number>;
  /** v0.3.73: turni assegnati che non valgono (fuori periodo o medico tolto dal sorteggio). */
  ignorati: TurnoAssegnato[];
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
  const preferences: Record<string, Record<string, PrefFesta>> = {};
  for (const m of partecipanti) {
    const p = Object.entries(st.preferenze[m.id] || {}).filter(([n]) => nomiFeste.has(n));
    if (p.length) preferences[k(m.id)] = Object.fromEntries(p);
  }
  // v0.3.73: turni assegnati prima del sorteggio
  const chiavi = new Set(buildShifts(feste).map(chiaveTurno));
  const ids0 = new Set(partecipanti.map(m => m.id));
  const assegnati = (st.assegnati || []).filter(a => chiavi.has(chiaveTurno(a)) && ids0.has(a.id));
  const ignorati = (st.assegnati || []).filter(a => !assegnati.includes(a));
  const solo = new Set((st.soloAssegnati || []).filter(id => assegnati.some(a => a.id === id)));
  const nelSorteggio = partecipanti.filter(m => !solo.has(m.id));
  const cfg: CfgPiano = {
    doctors: nelSorteggio.map(m => k(m.id)), holidays: feste, maxShifts: st.maxShifts, minSuper: st.minSuper,
    saldo: Object.fromEntries(partecipanti.map(m => [k(m.id), saldo[m.id]])),
    history: Object.fromEntries(partecipanti.map(m => [k(m.id), storico[m.id]])),
    superPrio: [...precedenza].map(k), preferences,
    onCall: { enabled: st.reperibilita.enabled, weightPct: st.reperibilita.weightPct, maxPer: st.reperibilita.maxPer,
      eligible: nelSorteggio.filter(m => !st.reperibilita.nonIdonei.includes(m.id)).map(m => k(m.id)) },
    soloDiurni: [...soloGiorno].map(k), baseSeed: st.seme,
    bilanciaRuoli: st.bilanciaRuoli !== false, prefEntroQuota: st.prefEntroQuota !== false,
    ...(assegnati.length ? { fissi: Object.fromEntries(assegnati.map(a => [chiaveTurno(a), k(a.id)])) } : {}),
  };
  return { partecipanti, feste, soloGiorno, saldo, storico, precedenza, cfg, assegnati, solo, ignorati };
}
/** Avvisi sui turni assegnati prima del sorteggio (v0.3.73): conflitti fra loro
 *  e con le preferenze, assegnati che non valgono. Non bloccano il sorteggio. */
export function avvisiAssegnati(d: DatiSorteggio, maxShifts: number, nome: (id: number) => string): string[] {
  const out: string[] = [];
  const turni = buildShifts(d.feste);
  const per = new Map(turni.map(s => [chiaveTurno(s), s]));
  const eti = (a: { date: string; tipo: string }) => { const s = per.get(chiaveTurno(a)); return `${s ? s.holNames.join(" / ") + " " : ""}${a.tipo === "diurno" ? "giorno" : "notte"} ${a.date.slice(8)}/${a.date.slice(5, 7)}`; };
  if (d.ignorati.length) out.push(`${d.ignorati.length} turn${d.ignorati.length === 1 ? "o assegnato non vale" : "i assegnati non valgono"}: fuori dal periodo o di medici tolti dal sorteggio.`);
  const perMedico = new Map<number, TurnoAssegnato[]>();
  for (const a of d.assegnati) perMedico.set(a.id, [...(perMedico.get(a.id) || []), a]);
  for (const [id, as] of perMedico) {
    const ord = [...as].sort((x, y) => x.date.localeCompare(y.date));
    for (let i = 1; i < ord.length; i++) if (diffDays(ord[i].date, ord[i - 1].date) < 2)
      out.push(`${nome(id)}: due turni assegnati ${ord[i].date === ord[i - 1].date ? "lo stesso giorno" : "in giorni consecutivi"} (${eti(ord[i - 1])} e ${eti(ord[i])}).`);
    if (ord.length > maxShifts) out.push(`${nome(id)}: ${ord.length} turni assegnati, più del massimo di ${maxShifts}.`);
    if (d.soloGiorno.has(id)) for (const a of ord) if (a.tipo === "notturno") out.push(`${nome(id)} fa solo turni di giorno ma ha assegnata la ${eti(a)}.`);
  }
  // preferenze che i turni assegnati rendono impossibili
  const items = normalizePrefs(d.cfg.preferences, d.feste);
  const fissi = new Map(d.assegnati.map(a => [chiaveTurno(a), a.id]));
  for (const [doc, its] of Object.entries(items)) {
    const id = +doc, miei = perMedico.get(id) || [];
    for (const it of its) {
      const adatti = turni.filter(s => prefMatches(it, s));
      if (!adatti.length || adatti.some(s => fissi.get(chiaveTurno(s)) === id)) continue;     // già soddisfatta da un suo assegnato
      const liberi = adatti.filter(s => !fissi.has(chiaveTurno(s)));
      const cosa = `«${it.hol}${it.roles ? " " + it.roles.map(r => r === "nottePrima" ? "notte prima" : r).join(" o ") : it.role === "any" ? "" : " " + (it.role === "nottePrima" ? "notte prima" : it.role)}»`;
      if (!liberi.length) out.push(`La preferenza di ${nome(id)} ${cosa} non si può rispettare: il turno è assegnato a ${adatti.map(s => nome(fissi.get(chiaveTurno(s))!)).join(", ")}.`);
      else if (liberi.every(s => miei.some(a => Math.abs(diffDays(a.date, s.date)) <= 1)))
        out.push(`${nome(id)}: la preferenza ${cosa} non si può rispettare insieme al turno assegnato ${eti(miei.find(a => liberi.some(s => Math.abs(diffDays(a.date, s.date)) <= 1))!)} (giorni vicini).`);
    }
  }
  return out;
}
/** Esegue il sorteggio e lo restituisce nel formato che l'app salva. */
export function sorteggia(d: DatiSorteggio, st: StatoFestivi, quando: string): { piano: PianoSalvato; sol: Soluzione } {
  const sol = generaPiano(d.cfg);
  const num = (s: string | null) => s == null ? null : +s;
  const richieste = Object.values(sol.prefItems || {}).reduce((n, a) => n + a.length, 0);
  let richiesteOk = 0;
  for (const [doc, items] of Object.entries(sol.prefItems || {})) for (const it of items)
    if (sol.assignments.some(a => a.doctor === doc && prefMatches(it, a))) richiesteOk++;
  const piano: PianoSalvato = {
    periodo: { ...st.periodo }, generato: quando, seme: st.seme, partecipanti: d.partecipanti.map(m => m.id),
    maxShifts: st.maxShifts, minSuper: st.minSuper, repOn: st.reperibilita.enabled, repPct: st.reperibilita.weightPct,
    saldo: { ...d.saldo },
    turni: sol.assignments.map(a => ({ date: a.date, tipo: a.tipo, nomi: a.holNames, basi: a.holBases, chiavi: a.keys, sup: a.isSuper, punti: a.points,
      condiviso: a.shared, medico: num(a.doctor), reperibile: num(a.onCall), puntiRep: a.onCallPoints, storico: a.histHit, pref: a.prefHit,
      ...(d.cfg.fissi?.[chiaveTurno(a)] !== undefined ? { fisso: true } : {}) })),
    richieste, richiesteOk, scartoPrima: sol.spreadBefore ?? 0, scartoDopo: sol.spreadAfter ?? 0,
    ...(d.solo.size ? { soloAssegnati: [...d.solo] } : {}),
  };
  return { piano, sol };
}

export interface RigaRiepilogo {
  id: number; saldo: number; punti: number; nRep: number; puntiRep: number; totale: number;
  turni: number; diurni: number; notturni: number; superfestivi: number; pref: number;
  /** v0.3.73: turni assegnati prima del sorteggio; fa solo quelli (fuori dall'equità). */
  fissi: number; solo: boolean;
}
/** Riepilogo per medico di un piano salvato. */
export function riepilogoPiano(p: PianoSalvato): RigaRiepilogo[] {
  return p.partecipanti.map(id => {
    const miei = p.turni.filter(t => t.medico === id), rep = p.turni.filter(t => t.reperibile === id);
    const punti = r2(miei.reduce((s, t) => s + t.punti, 0)), puntiRep = r2(rep.reduce((s, t) => s + t.puntiRep, 0));
    const saldo = +p.saldo[id] || 0;
    return { id, saldo, punti, nRep: rep.length, puntiRep, totale: r2(saldo + punti + puntiRep), turni: miei.length,
      diurni: miei.filter(t => t.tipo === "diurno").length, notturni: miei.filter(t => t.tipo === "notturno").length,
      superfestivi: miei.filter(t => t.sup).length, pref: miei.filter(t => t.pref).length,
      fissi: miei.filter(t => t.fisso).length, solo: (p.soloAssegnati || []).includes(id) };
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
    if (miei.filter(t => t.sup).length < p.minSuper && !(p.soloAssegnati || []).includes(id)) senzaSup.push(nome(id));   // (chi fa solo i suoi: no)
    if (soloGiorno.has(id) && (miei.some(t => t.tipo === "notturno") || p.turni.some(t => t.reperibile === id && t.tipo === "notturno"))) nottiEs.push(nome(id));
    if (p.turni.some(t => t.reperibile === id && miei.some(x => Math.abs(dd(x.date, t.date)) <= 1))) doppi.push(nome(id));   // v0.3.69: anche il giorno prima o dopo
  }
  out.push({ ok: !troppi.length, testo: troppi.length ? `Oltre il massimo di ${p.maxShifts} turni: ${troppi.join(", ")}` : `Nessuno supera ${p.maxShifts} turni` });
  // v0.3.70: chi è rimasto senza turni da titolare (inevitabile se i turni sono meno dei medici)
  const senzaTit = p.partecipanti.filter(id => !p.turni.some(t => t.medico === id));
  const inevitabili = Math.max(0, p.partecipanti.length - p.turni.length);
  out.push(!senzaTit.length ? { ok: true, testo: "Tutti hanno almeno un turno da titolare" }
    : senzaTit.length <= inevitabili ? { ok: true, testo: `${senzaTit.length} senza turni da titolare (${senzaTit.map(nome).join(", ")}): i turni sono ${p.turni.length}, i medici ${p.partecipanti.length}` }
    : { ok: false, testo: `Senza turni da titolare: ${senzaTit.map(nome).join(", ")}` });
  out.push({ ok: !vicini.length, testo: vicini.length ? `Turni lo stesso giorno o in giorni consecutivi: ${vicini.join(", ")}` : "Mai due turni lo stesso giorno o in giorni consecutivi" });
  if (p.minSuper > 0) out.push({ ok: !senzaSup.length, testo: senzaSup.length ? `Sotto il minimo di ${p.minSuper} superfestiv${p.minSuper === 1 ? "o" : "i"}: ${senzaSup.join(", ")}` : `Tutti hanno almeno ${p.minSuper} superfestiv${p.minSuper === 1 ? "o" : "i"}` });
  if (soloGiorno.size) out.push({ ok: !nottiEs.length, testo: nottiEs.length ? `Notti a chi fa solo turni di giorno: ${nottiEs.join(", ")}` : "Chi fa solo turni di giorno non ha notti" });
  if (p.richieste) out.push({ ok: p.richiesteOk === p.richieste, testo: `Preferenze rispettate: ${p.richiesteOk} su ${p.richieste}` });
  const ripetute = p.turni.filter(t => t.storico && !t.pref && !t.fisso).length;
  // v0.3.73: turni assegnati prima del sorteggio
  const nFissi = p.turni.filter(t => t.fisso).length;
  if (nFissi) out.push({ ok: true, testo: `📌 ${nFissi} turn${nFissi === 1 ? "o assegnato" : "i assegnati"} prima del sorteggio` });
  const solo = p.soloAssegnati || [];
  if (solo.length) {
    const altro = solo.filter(id => p.turni.some(t => (t.medico === id && !t.fisso) || t.reperibile === id));
    out.push({ ok: !altro.length, testo: altro.length ? `Hanno turni non assegnati pur facendo solo i loro: ${altro.map(nome).join(", ")}`
      : `Chi fa solo i turni assegnati non ha altro (${solo.map(nome).join(", ")})` });
  }
  out.push({ ok: !ripetute, testo: ripetute ? `${ripetute} turni a chi aveva già fatto la stessa festività l'ultima volta` : "Nessuno ripete una festività fatta l'ultima volta" });
  if (p.repOn) {
    const senza = p.turni.filter(t => t.reperibile == null).length;
    out.push({ ok: !senza, testo: senza ? `${senza} turni senza reperibile` : "Ogni turno ha un reperibile" });
    out.push({ ok: !doppi.length, testo: doppi.length ? `Reperibile lo stesso giorno, il giorno prima o il giorno dopo un suo turno: ${doppi.join(", ")}` : "Mai reperibile lo stesso giorno, il giorno prima o il giorno dopo un suo turno" });
  }
  return out;
}
/** Passa al periodo successivo: il piano va in archivio, saldo e storico si rileggono da capo. */
/** Cancella il piano sorteggiato (v0.3.71). Con `togliDaiMesi` toglie anche dai
 *  tabelloni i turni che l'app vi aveva inserito dal piano; senza, i turni
 *  restano nei mesi come manuali e il registro resta (un nuovo piano potrà
 *  sostituirli o toglierli). Saldo, storico, preferenze e archivio non cambiano. */
export function cancellaPiano(st: StatoFestivi, turniAll: TurniAll, togliDaiMesi: boolean): { stato: StatoFestivi; mesi: Record<string, TurniMese>; tolti: number } {
  const mesi: Record<string, TurniMese> = {};
  let tolti = 0;
  if (togliDaiMesi) for (const [k, ins] of Object.entries(st.inseriti)) {
    const r = togliInseriti(turniAll[k], ins.turni);
    mesi[k] = r.turni; tolti += r.tolti;
  }
  return { stato: { ...st, piano: null, inseriti: togliDaiMesi ? {} : st.inseriti }, mesi, tolti };
}
/** Turni inseriti nei mesi dal piano (registro), in tutto. */
export const nInseriti = (st: StatoFestivi) => Object.values(st.inseriti).reduce((n, x) => n + x.turni.length, 0);
export function prossimoPeriodo(st: StatoFestivi): StatoFestivi {
  const base = st.piano ? st.piano.periodo : st.periodo;
  return { ...st, periodo: periodoSuccessivo(base), piano: null, archivio: st.piano ? [...st.archivio, st.piano].slice(-6) : st.archivio,
    saldoMan: {}, periodoSaldo: null, storicoMan: {}, precMan: {}, preferenze: {}, assegnati: [], soloAssegnati: [], seme: 1 };
}
/** Un medico eliminato dall'app esce anche dalla sezione Festivi: un nuovo medico con lo stesso numero non eredita nulla. */
export function rimuoviMedicoFestivi(st: StatoFestivi, id: number): StatoFestivi {
  const senza = <T,>(o: Record<number, T>) => { const { [id]: _via, ...resto } = o; return resto; };
  const pulisci = (p: PianoSalvato): PianoSalvato => ({ ...p, partecipanti: p.partecipanti.filter(x => x !== id), saldo: senza(p.saldo),
    turni: p.turni.map(t => ({ ...t, medico: t.medico === id ? null : t.medico, reperibile: t.reperibile === id ? null : t.reperibile, puntiRep: t.reperibile === id ? 0 : t.puntiRep })) });
  return { ...st, esclusi: st.esclusi.filter(x => x !== id), soloGiorno: senza(st.soloGiorno), saldoMan: senza(st.saldoMan), storicoMan: senza(st.storicoMan),
    precMan: senza(st.precMan), preferenze: senza(st.preferenze),
    assegnati: (st.assegnati || []).filter(a => a.id !== id), soloAssegnati: (st.soloAssegnati || []).filter(x => x !== id),
    reperibilita: { ...st.reperibilita, nonIdonei: st.reperibilita.nonIdonei.filter(x => x !== id) },
    piano: st.piano ? pulisci(st.piano) : null, archivio: st.archivio.map(pulisci),
    inseriti: Object.fromEntries(Object.entries(st.inseriti).map(([k, v]) => [k, { ...v, turni: v.turni.filter(t => t.id !== id) }])) };
}

// ── DAL PIANO AI MESI (v0.3.61) ──────────────────────────────────────────────
// Facoltativo, un mese alla volta: i turni del piano entrano nel tabellone come
// turni MANUALI (notte → N; giorno → M e P allo stesso medico), prima di
// generare il mese. Non si sovrascrive nulla: dove la cella è occupata, il turno
// è già di un altro medico (oltre il fabbisogno massimo del giorno) o urterebbe
// un turno già presente, si salta e si segnala. L'app ricorda che cosa ha
// scritto, per toglierlo o sostituirlo dopo un nuovo sorteggio.
export interface Saltato { date: string; tipo: "diurno" | "notturno"; medico: number; motivo: string }
export interface EsitoInserimento {
  /** Perché non si può inserire in questo mese ("" = si può). */
  blocco: string;
  turni: TurniMese;               // il tabellone del mese dopo l'inserimento
  inseriti: TurnoInserito[];
  saltati: Saltato[];
  tolti: number;                  // turni dell'inserimento precedente tolti
}
/** Mesi ("AAAA-MM") toccati da un piano, con quanti turni ciascuno. */
export function mesiDelPiano(p: PianoSalvato): { chiave: string; anno: number; mese: number; turni: number }[] {
  const n = new Map<string, number>();
  for (const t of p.turni) if (t.medico != null) n.set(t.date.slice(0, 7), (n.get(t.date.slice(0, 7)) || 0) + 1);
  return [...n.entries()].sort().map(([chiave, turni]) => ({ chiave, anno: +chiave.slice(0, 4), mese: +chiave.slice(5, 7) - 1, turni }));
}
/** Il mese è già stato generato: ha almeno un turno automatico. */
export const meseGenerato = (T: TurniMese | undefined) => !!T && Object.values(T).some(gi => Object.values(gi || {}).some(c => (c?.t || []).some(s => !s.man)));
/** Toglie dal tabellone i turni scritti da un inserimento precedente (solo se sono ancora lì, manuali). */
export function togliInseriti(T: TurniMese | undefined, prec: TurnoInserito[]): { turni: TurniMese; tolti: number } {
  const out: TurniMese = {}; let tolti = 0;
  for (const id in T) { out[id] = {}; for (const g in T[id]) out[id][g] = { t: [...(T[id][g]?.t || [])] }; }
  for (const p of prec) {
    const c = out[p.id]?.[p.g]; if (!c) continue;
    let via = 0;
    for (const tipo of p.tipi) { const i = c.t.findIndex(s => s.tipo === tipo && s.man && !s.sott); if (i >= 0) { c.t.splice(i, 1); via++; } }
    if (via) tolti++;
    if (!c.t.length) delete out[p.id][p.g];
  }
  return { turni: out, tolti };
}
/** Scrive nel mese `chiave` i turni del piano. Non modifica `turniAll`: restituisce il tabellone nuovo. */
export function inserisciPiano(piano: PianoSalvato, turniAll: TurniAll, chiave: string, prec: TurnoInserito[] = [], medici: Medico[] = []): EsitoInserimento {
  const base = togliInseriti(turniAll[chiave], prec);
  const esito: EsitoInserimento = { blocco: "", turni: base.turni, inseriti: [], saltati: [], tolti: base.tolti };
  if (meseGenerato(base.turni)) { esito.blocco = "Il mese è già stato generato: il piano entra solo nei mesi nuovi. Togli prima i turni dell'app (Rimuovi App) oppure riporta i turni a mano."; esito.turni = turniAll[chiave] || {}; esito.tolti = 0; return esito; }
  const T = esito.turni;
  // cella di un giorno qualsiasi (anche del mese prima o dopo), per i controlli a cavallo
  const cella = (id: number, data: string): Turno[] => {
    const k = data.slice(0, 7), g = +data.slice(8, 10);
    return (k === chiave ? T : turniAll[k])?.[id]?.[g]?.t || [];
  };
  const lavora = (id: number, data: string) => cella(id, data).some(s => !SPEC.includes(s.tipo));
  // chi ha già quel turno di reparto nel giorno, e quanti ne servono al massimo (fabbisogno delle Regole)
  const anno = +chiave.slice(0, 4), mese = +chiave.slice(5, 7) - 1, FB = getRegole().fabb;
  const nomeDi = (id: number) => medici.find(m => m.id === id)?.nome ?? "un altro medico";
  const chiHa = (g: number, tipo: string) => Object.keys(T).map(Number).filter(id => (T[id]?.[g]?.t || []).some(s => s.tipo === tipo));
  const fascia = (g: number) => isFestivo(anno, mese, g) ? FB.fest : isSabN(dowOf(anno, mese, g)) ? FB.sab : FB.fer;
  for (const t of piano.turni) {
    if (t.medico == null || t.date.slice(0, 7) !== chiave) continue;
    const id = t.medico, g = +t.date.slice(8, 10);
    const salta = (motivo: string) => esito.saltati.push({ date: t.date, tipo: t.tipo, medico: id, motivo });
    const oggi = cella(id, t.date);
    if (oggi.length) { salta("cella occupata (" + oggi.map(s => s.tipo).join("+") + ")"); continue; }
    if (cella(id, addDays(t.date, -1)).some(s => isNot(s.tipo))) { salta("il giorno prima ha una notte"); continue; }
    if (t.tipo === "notturno" && lavora(id, addDays(t.date, 1))) { salta("il giorno dopo ha già un turno"); continue; }
    if (t.tipo === "notturno") { const altri = chiHa(g, "N"); if (altri.length) { salta("la notte è già di " + altri.map(nomeDi).join(", ")); continue; } }
    else {
      const f = fascia(g), aM = chiHa(g, "M"), aP = chiHa(g, "P");
      if (aM.length >= f.mMax) { salta("la mattina è già di " + aM.map(nomeDi).join(", ")); continue; }
      if (aP.length >= f.pMax) { salta("il pomeriggio è già di " + aP.map(nomeDi).join(", ")); continue; }
    }
    const tipi = t.tipo === "notturno" ? ["N"] : ["M", "P"];
    ((T[id] ||= {})[g] ||= { t: [] }).t.push(...tipi.map(tipo => ({ tipo, sott: false, man: true })));
    esito.inseriti.push({ id, g, tipi });
  }
  return esito;
}
