// ═══════════════════════════════════════════════════════════════════════════
// PIANO FESTIVI (v0.3.60) — sorteggio dei turni festivi su un periodo
// ═══════════════════════════════════════════════════════════════════════════
// Porting del nucleo dello strumento «Turni festivi» del reparto: stesso
// sorteggio e stessi criteri, senza interfaccia. Su un periodo fino a 12 mesi
// ogni festività ha tre turni — notte prima, giorno (12 ore), notte — ciascuno
// con i suoi punti; le notti condivise fra due festivi consecutivi (25→26
// dicembre) sono un turno solo e valgono il punteggio più alto. Il sorteggio
// distribuisce i PUNTI, non il numero di turni, tenendo conto di: saldo di
// partenza, festività già fatte (storico), preferenze, massimo di turni e
// minimo di superfestivi per medico, reperibilità facoltativa.
// Differenze dallo strumento: i medici sono chiavi qualsiasi (nell'app gli id),
// le festività arrivano dalle Regole, e chi è esentato dalle notti (`soloDiurni`)
// riceve solo turni di giorno.
// Indipendente dal motore mensile: non legge né scrive i tabelloni.

export type RuoloFest = "nottePrima" | "giorno" | "notte";
export type RuoloPref = RuoloFest | "any";
/** Preferenza su una festività: un turno, «any» o (v0.3.68) più turni, uno
 *  qualsiasi dei quali la soddisfa (es. ["giorno", "notte"] = giorno o notte). */
export type PrefFesta = RuoloPref | RuoloFest[];
const ORDINE_RUOLI: RuoloFest[] = ["nottePrima", "giorno", "notte"];
export interface PuntiFest { nottePrima: number; giorno: number; notte: number }
/** Festività di calendario del piano (Regole.festiviPiano). `data`: "MM-GG",
 *  "pasqua" o "pasquetta". `soloGiorno`: voce senza notti proprie (24 e 31/12). */
export interface FestivitaPiano { id: string; nome: string; data: string; sup: boolean; soloGiorno?: boolean; punti: PuntiFest }
/** Festività con la data di un anno preciso. `base` = nome senza anno (storico). */
export interface FestData { date: string; name: string; base: string; id: string; sup: boolean; soloGiorno?: boolean; skipNottePrima?: boolean; slots: PuntiFest }
export interface TurnoFest {
  date: string; tipo: "diurno" | "notturno";
  contribs: { hol: FestData; role: RuoloFest; val: number }[];
  isSuper: boolean; holNames: string[]; holBases: string[]; keys: string[]; points: number; shared: boolean;
}
export interface RichiestaPref { hol: string; role: RuoloPref; date: string; lastDate: string; sup: boolean; /** più turni (v0.3.68): basta uno */ roles?: RuoloFest[] }
export interface Reperibilita { enabled: boolean; weightPct: number; maxPer: number; eligible: string[] }
export interface CfgPiano {
  doctors: string[];
  holidays: FestData[];
  maxShifts: number; minSuper: number;
  saldo?: Record<string, number>;
  superPrio?: string[];
  history?: Record<string, string[]>;
  preferences?: Record<string, Record<string, PrefFesta>>;
  prefItems?: Record<string, RichiestaPref[]>;
  onCall?: Reperibilita;
  /** Medici che ricevono solo turni di giorno (esentati dalle notti). */
  soloDiurni?: string[];
  baseSeed?: number; attempts?: number; topK?: number; localSearch?: boolean;
}
export interface Assegnazione {
  date: string; tipo: "diurno" | "notturno"; holNames: string[]; holBases: string[]; keys: string[];
  isSuper: boolean; points: number; shared: boolean; doctor: string | null;
  histHit: boolean; prefHit: boolean; onCall: string | null; onCallPoints: number;
}
type Conti = Record<string, number>;
export interface Soluzione {
  assignments: Assegnazione[];
  counts: Conti; supCounts: Conti; dayCounts: Conti; nightCounts: Conti; prefHits: Conti; points: Conti;
  onCallCounts: Conti; onCallPoints: Conti; totals: Conti;
  score?: number; seed?: number; lsMoves?: number; shiftCount?: number;
  prefItems?: Record<string, RichiestaPref[]>; maxShifts?: number;
  spreadBefore?: number; spreadAfter?: number; saldo?: Record<string, number>;
}

// ── date in formato "AAAA-MM-GG" ─────────────────────────────────────────────
const pad2 = (n: number) => String(n).padStart(2, "0");
export const iso = (y: number, m: number, d: number) => y + "-" + pad2(m) + "-" + pad2(d);
export function addDays(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + delta * 86400000);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
/** a − b in giorni. */
export function diffDays(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(ya, ma - 1, da) - Date.UTC(yb, mb - 1, db)) / 86400000);
}
export function fmtIt(isoDate: string): string {
  const gg = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
  const [y, m, d] = isoDate.split("-").map(Number);
  return gg[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + " " + pad2(d) + "/" + pad2(m) + "/" + y;
}
/** Pasqua — algoritmo di Meeus (calendario gregoriano). */
export function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100,
        d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
        g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
        i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
        m = Math.floor((a + 11 * h + 22 * l) / 451),
        month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

// ── festività ────────────────────────────────────────────────────────────────
// Punti dal sondaggio del reparto (novembre 2026): mediana delle risposte, scala
// da 1 a 3, riferimento fisso notte 31/12 → 1/1 = 3. I diurni del 24 e del 31/12
// non erano nel sondaggio: 1. Modificabili nella sezione Festivi.
const F = (id: string, nome: string, data: string, sup: boolean, nottePrima: number, giorno: number, notte: number): FestivitaPiano =>
  ({ id, nome, data, sup, punti: { nottePrima, giorno, notte } });
const G = (id: string, nome: string, data: string, giorno: number): FestivitaPiano =>
  ({ id, nome, data, sup: false, soloGiorno: true, punti: { nottePrima: 0, giorno, notte: 0 } });
export const FESTIVI_PIANO_NAZIONALI: FestivitaPiano[] = [
  F("capodanno", "Capodanno", "01-01", true, 3, 3, 2),                 // notte prima = notte 31/12
  F("epifania", "Epifania", "01-06", false, 2, 2, 1),
  F("pasqua", "Pasqua", "pasqua", true, 2, 3, 2),
  F("pasquetta", "Lunedì dell'Angelo", "pasquetta", false, 2, 3, 2),   // notte prima = notte di Pasqua
  F("liberazione", "Liberazione", "04-25", false, 1, 1, 1),
  F("lavoro", "Festa del Lavoro", "05-01", false, 1, 2, 1),
  F("repubblica", "Festa della Repubblica", "06-02", false, 1, 2, 1),
  F("ferragosto", "Ferragosto", "08-15", false, 2, 3, 2),
  F("ognissanti", "Ognissanti", "11-01", false, 2, 2, 1),
  F("immacolata", "Immacolata", "12-08", false, 1, 2, 2),
  G("vigilia", "Vigilia di Natale", "12-24", 2),                        // la notte 24→25 è la notte prima di Natale
  F("natale", "Natale", "12-25", true, 3, 3, 3),
  F("santostefano", "Santo Stefano", "12-26", true, 3, 2, 2),           // notte prima = notte di Natale
  G("sansilvestro", "San Silvestro", "12-31", 2),                       // la notte 31/12→1/1 è la notte prima di Capodanno
];
/** Elenco predefinito: le nazionali più le festività locali del reparto (1 punto per turno). */
export function festiviPianoDefault(locali: { data: string; nome: string }[] = []): FestivitaPiano[] {
  const out = FESTIVI_PIANO_NAZIONALI.map(f => ({ ...f, punti: { ...f.punti } }));
  for (const l of locali) {
    if (!/^\d\d-\d\d$/.test(l.data) || out.some(f => f.data === l.data)) continue;
    out.push(F("locale-" + l.data, l.nome || "Festa locale", l.data, false, 1, 1, 1));
  }
  return out;
}
/** Data ammessa per una voce dell'elenco: "MM-GG", "pasqua" o "pasquetta". */
export function dataPianoValida(data: unknown): data is string {
  if (data === "pasqua" || data === "pasquetta") return true;
  const m = typeof data === "string" ? /^(\d\d)-(\d\d)$/.exec(data) : null;
  if (!m) return false;
  const mm = +m[1], gg = +m[2];
  return mm >= 1 && mm <= 12 && gg >= 1 && gg <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
}
const punto = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v)); return isFinite(n) ? Math.min(20, Math.max(0, Math.round(n * 100) / 100)) : 0; };
/** Elenco salvato → elenco valido (null se assente: vale il predefinito). */
export function sanaFestiviPiano(x: unknown): FestivitaPiano[] | null {
  if (!Array.isArray(x)) return null;
  const out: FestivitaPiano[] = []; const ids = new Set<string>(), date = new Set<string>();
  for (const v of x) {
    if (!v || typeof v !== "object") continue;
    const f = v as Partial<FestivitaPiano>;
    if (!dataPianoValida(f.data) || date.has(f.data)) continue;
    let id = typeof f.id === "string" && f.id ? f.id.slice(0, 40) : "f-" + f.data;
    if (ids.has(id)) id = "f-" + f.data;
    ids.add(id); date.add(f.data);
    const p = (f.punti || {}) as Partial<PuntiFest>;
    const solo = f.soloGiorno === true;
    out.push({ id, nome: typeof f.nome === "string" && f.nome.trim() ? f.nome.slice(0, 60) : "Festività", data: f.data, sup: f.sup === true,
      ...(solo ? { soloGiorno: true } : {}),
      punti: { nottePrima: solo ? 0 : punto(p.nottePrima), giorno: punto(p.giorno), notte: solo ? 0 : punto(p.notte) } });
  }
  return out;
}
/** Le feste locali del reparto stanno sempre nell'elenco (1 punto per turno alla
 *  prima comparsa, poi modificabili); quelle tolte dalla scheda reparto escono. */
export function allineaFestiviPiano(lista: FestivitaPiano[], locali: { data: string; nome: string }[] = []): FestivitaPiano[] {
  const dateLoc = new Set(locali.map(l => l.data));
  const out = lista.filter(f => !f.id.startsWith("locale-") || dateLoc.has(f.data));
  for (const l of locali) {
    if (!dataPianoValida(l.data) || out.some(f => f.data === l.data)) continue;
    out.push(F("locale-" + l.data, (l.nome || "Festa locale").slice(0, 60), l.data, false, 1, 1, 1));
  }
  return out;
}
/** Data della festività nell'anno y (null se la data non è valida). */
export function dataFestivita(f: FestivitaPiano, y: number): string | null {
  if (f.data === "pasqua") return easter(y);
  if (f.data === "pasquetta") return addDays(easter(y), 1);
  const m = /^(\d\d)-(\d\d)$/.exec(f.data);
  if (!m) return null;
  const mm = +m[1], gg = +m[2];
  const dt = new Date(Date.UTC(y, mm - 1, gg));
  return dt.getUTCMonth() === mm - 1 && dt.getUTCDate() === gg ? iso(y, mm, gg) : null;
}
/** Le festività dell'elenco con la data dell'anno y, in ordine di data. */
export function festivitaAnno(lista: FestivitaPiano[], y: number): FestData[] {
  const out: FestData[] = [];
  for (const f of lista) {
    const date = dataFestivita(f, y);
    if (!date) continue;
    out.push({ date, name: f.nome, base: f.nome, id: f.id, sup: !!f.sup, ...(f.soloGiorno ? { soloGiorno: true } : {}),
      slots: f.soloGiorno ? { nottePrima: 0, giorno: f.punti.giorno, notte: 0 } : { ...f.punti } });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
/** Una voce «solo diurno» non ha turni di notte. */
export const hasSlot = (h: { soloGiorno?: boolean }, role: RuoloFest) => !h.soloGiorno || role === "giorno";

/** Festività di un PERIODO (al massimo 12 mesi, anche a cavallo di due anni).
 *  Una festività appartiene al periodo se la sua data cade dentro, e porta con
 *  sé la sua notte prima. Eccezione: se il giorno prima dell'inizio è anch'esso
 *  festivo, quella notte è già del periodo precedente. Se il periodo è a
 *  cavallo di due anni, il nome prende l'anno (es. due Pasque in 12 mesi). */
export function festivitaPeriodo(lista: FestivitaPiano[], start: string, end: string): FestData[] {
  const y1 = +start.slice(0, 4), y2 = +end.slice(0, 4);
  let all: FestData[] = [];
  for (let y = y1 - 1; y <= y2; y++) all = all.concat(festivitaAnno(lista, y));
  const allDates = new Set(all.filter(h => !h.soloGiorno).map(h => h.date));
  const multi = y1 !== y2;
  const list = all.filter(h => h.date >= start && h.date <= end);
  for (const h of list) {
    if (multi) h.name = h.name + " " + h.date.slice(0, 4);
    if (h.date === start && allDates.has(addDays(start, -1))) h.skipNottePrima = true;
  }
  return list;
}
export function periodoOk(start: string, end: string): string {
  if (!start || !end) return "Inserisci la data di inizio e di fine.";
  if (end < start) return "La data di fine deve essere dopo quella di inizio.";
  const [y, m, d] = start.split("-").map(Number);
  if (end >= iso(y + 1, m, d)) return "Il periodo può durare al massimo 12 mesi.";
  return "";
}
/** Periodo successivo: stessa durata (in mesi interi se il periodo è allineato ai mesi). */
export function periodoSuccessivo(p: { start: string; end: string }): { start: string; end: string } {
  const [sy, sm, sd] = p.start.split("-").map(Number);
  const [ey, em] = p.end.split("-").map(Number);
  const ns = addDays(p.end, 1);
  const monthEnd = addDays(em === 12 ? iso(ey + 1, 1, 1) : iso(ey, em + 1, 1), -1) === p.end;
  if (sd === 1 && monthEnd) {
    const months = (ey * 12 + em) - (sy * 12 + sm) + 1;
    const [ny, nm] = ns.split("-").map(Number);
    const t = ny * 12 + (nm - 1) + months;
    return { start: ns, end: addDays(iso(Math.floor(t / 12), t % 12 + 1, 1), -1) };
  }
  return { start: ns, end: addDays(ns, diffDays(p.end, p.start)) };
}

/** Generatore casuale con seme: risultati riproducibili e varianti rigenerabili. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slotVal(h: FestData, role: RuoloFest): number {
  const v = (h.slots || {})[role];
  return (typeof v === "number" && isFinite(v)) ? v : 0;
}

/** Da elenco festività a elenco turni unici: per ogni festività H → notturno di
 *  H−1, diurno di H, notturno di H. I turni condivisi restano unici. */
export function buildShifts(holidays: FestData[]): TurnoFest[] {
  const map = new Map<string, TurnoFest>();
  const add = (date: string, tipo: "diurno" | "notturno", hol: FestData, role: RuoloFest) => {
    const k = date + "|" + tipo;
    if (!map.has(k)) map.set(k, { date, tipo, contribs: [], isSuper: false, holNames: [], holBases: [], keys: [], points: 0, shared: false });
    map.get(k)!.contribs.push({ hol, role, val: slotVal(hol, role) });
  };
  const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  for (const h of sorted) {
    if (!h.skipNottePrima && hasSlot(h, "nottePrima")) add(addDays(h.date, -1), "notturno", h, "nottePrima");
    add(h.date, "diurno", h, "giorno");
    if (hasSlot(h, "notte")) add(h.date, "notturno", h, "notte");
  }
  const shifts = [...map.values()];
  shifts.sort((a, b) => a.date === b.date ? a.tipo.localeCompare(b.tipo) : a.date.localeCompare(b.date));
  for (const s of shifts) {
    s.isSuper = s.contribs.some(c => c.hol.sup);
    s.holNames = [...new Set(s.contribs.map(c => c.hol.name))];
    s.holBases = [...new Set(s.contribs.map(c => c.hol.base || c.hol.name))];
    s.keys = s.contribs.map(c => c.hol.name + "|" + c.role);
    s.points = Math.round(Math.max(...s.contribs.map(c => c.val)) * 100) / 100;   // notte condivisa: vale il più alto
    s.shared = s.contribs.length > 1;
  }
  return shifts;
}

/** Turni della festività che si possono chiedere (v0.3.68). */
export const ruoliFesta = (h: { soloGiorno?: boolean; skipNottePrima?: boolean }): RuoloFest[] =>
  ORDINE_RUOLI.filter(r => hasSlot(h, r) && !(r === "nottePrima" && h.skipNottePrima));
/** Preferenza con più turni → la forma più semplice: tutti i turni della
 *  festività = "any", uno solo = quel turno; null se nessuno è valido. */
export function semplificaPref(h: { soloGiorno?: boolean; skipNottePrima?: boolean }, v: PrefFesta): PrefFesta | null {
  if (!Array.isArray(v)) return v;
  const possibili = ruoliFesta(h);
  const ok = possibili.filter(r => v.includes(r));
  if (!ok.length) return null;
  if (ok.length === possibili.length && possibili.length > 1) return "any";
  return ok.length === 1 ? ok[0] : ok;
}
/** Preferenze { medico: { festività: ruolo o ruoli } } → richieste per medico. */
export function normalizePrefs(prefs: CfgPiano["preferences"], holidays: FestData[]): Record<string, RichiestaPref[]> {
  const byName: Record<string, FestData> = {};
  for (const h of holidays) byName[h.name] = h;
  const out: Record<string, RichiestaPref[]> = {};
  for (const d of Object.keys(prefs || {})) {
    const items: RichiestaPref[] = [];
    for (const [hol, val] of Object.entries(prefs![d] || {})) {
      const h = byName[hol];
      if (!h) continue;
      if (Array.isArray(val)) {                                              // più turni (v0.3.68)
        const v = semplificaPref(h, val);
        if (v === null) continue;
        if (Array.isArray(v)) {
          const np = (h.skipNottePrima || h.soloGiorno) ? h.date : addDays(h.date, -1);
          items.push({ hol, role: v[0], roles: v, date: v.includes("nottePrima") ? np : h.date, lastDate: h.date, sup: !!h.sup });
          continue;
        }
        if (v !== "any" && !hasSlot(h, v)) continue;
        const np = (h.skipNottePrima || h.soloGiorno) ? h.date : addDays(h.date, -1);
        items.push({ hol, role: v, date: (v === "nottePrima" || v === "any") ? np : h.date, lastDate: v === "nottePrima" ? np : h.date, sup: !!h.sup });
        continue;
      }
      const role = val;
      if (!["any", "nottePrima", "giorno", "notte"].includes(role)) continue;
      if (role !== "any" && !hasSlot(h, role)) continue;
      const np = (h.skipNottePrima || h.soloGiorno) ? h.date : addDays(h.date, -1);
      const date = (role === "nottePrima" || role === "any") ? np : h.date;    // primo turno utile
      const lastDate = (role === "nottePrima") ? np : h.date;                  // ultimo turno utile
      items.push({ hol, role, date, lastDate, sup: !!h.sup });
    }
    out[d] = items;
  }
  return out;
}
export function prefMatches(it: RichiestaPref, s: { holNames: string[]; keys: string[] }): boolean {
  if (it.roles) return it.roles.some(r => s.keys.includes(it.hol + "|" + r));   // più turni: basta uno
  return it.role === "any" ? s.holNames.includes(it.hol) : s.keys.includes(it.hol + "|" + it.role);
}

/** Un singolo tentativo di assegnazione, in ordine di data. */
export function assignOnce(cfg: CfgPiano, shifts: TurnoFest[], rnd: () => number): Soluzione {
  const counts: Conti = {}, supCounts: Conti = {}, dayCounts: Conti = {}, nightCounts: Conti = {}, prefHits: Conti = {}, points: Conti = {};
  const lastDate: Record<string, string | null> = {}, lastNight: Record<string, string | null> = {};
  for (const d of cfg.doctors) { counts[d] = 0; supCounts[d] = 0; dayCounts[d] = 0; nightCounts[d] = 0; prefHits[d] = 0; points[d] = 0; lastDate[d] = null; lastNight[d] = null; }

  // ── reperibilità (livello facoltativo)
  const oc = cfg.onCall;
  const ocEnabled = !!oc?.enabled;
  const ocEligible = new Set(oc?.eligible || []);
  const ocWeight = (typeof oc?.weightPct === "number" ? oc.weightPct : 40) / 100;
  const ocMax = (typeof oc?.maxPer === "number" ? oc.maxPer : 999);
  const onCallCounts: Conti = {}, onCallPoints: Conti = {};
  const activeDates: Record<string, Set<string>> = {}, onCallDates: Record<string, Set<string>> = {};
  for (const d of cfg.doctors) { onCallCounts[d] = 0; onCallPoints[d] = 0; activeDates[d] = new Set(); onCallDates[d] = new Set(); }
  const totalPoints = (d: string) => Math.round((points[d] + onCallPoints[d]) * 100) / 100;
  const sal = (d: string) => (cfg.saldo && +cfg.saldo[d]) || 0;
  const supPrio = new Set(cfg.superPrio || []);
  const soloDiurni = new Set(cfg.soloDiurni || []);

  const hist = cfg.history || {};
  const inSet = (obj: Record<string, string[]>, d: string, names: string[]) => (obj[d] || []).some(n => names.includes(n));

  const prefItems = cfg.prefItems || normalizePrefs(cfg.preferences, cfg.holidays);
  const pItems = (d: string) => prefItems[d] || [];
  const prefSat: Record<string, Set<number>> = {};
  for (const d of cfg.doctors) prefSat[d] = new Set();
  const hitsOf = (d: string, s: TurnoFest) => { const r: number[] = []; pItems(d).forEach((it, i) => { if (prefMatches(it, s)) r.push(i); }); return r; };

  const isValid = (d: string, s: TurnoFest) => {
    if (counts[d] >= cfg.maxShifts) return false;
    if (s.tipo === "notturno" && soloDiurni.has(d)) return false;     // esentato dalle notti
    if (onCallDates[d].has(s.date)) return false;                     // già reperibile quel giorno
    if (lastDate[d]) {
      const df = diffDays(s.date, lastDate[d]!);
      if (df === 0) return false;                                     // mai diurno + notturno lo stesso giorno
      if (df === 1) return false;                                     // mai due giorni consecutivi
    }
    if (s.tipo === "notturno" && lastNight[d] && diffDays(s.date, lastNight[d]!) === 1) return false;
    return true;
  };

  const priority = (d: string, s: TurnoFest) => {
    let p = 0;
    const histHit = inSet(hist, d, s.holBases);
    const newHit = hitsOf(d, s).some(i => !prefSat[d].has(i));
    const pend = pItems(d).filter((it, i) => !prefSat[d].has(i) && it.lastDate >= s.date);   // richieste ancora raggiungibili
    if (histHit) p -= 50000;                    // evita la stessa festività già fatta
    if (newHit) p += 60000;                     // turno richiesto: batte lo storico
    if (s.isSuper && supCounts[d] < cfg.minSuper) {
      p += pend.some(it => it.sup) && !newHit ? 20000 : 100000;
      if (supPrio.has(d)) p += 30000;           // rimasto senza nel periodo precedente: precedenza
    }
    if (!s.isSuper && supCounts[d] < cfg.minSuper) {
      const rem = cfg.maxShifts - counts[d];
      if (rem === 1) p -= 10000;                // ultimo posto: riservalo a un superfestivo
      else if (rem === 2) p -= 5000;
    }
    if (!newHit && pend.length) {
      if ((cfg.maxShifts - counts[d]) <= pend.length) p -= 15000;     // riserva posti per i turni richiesti
      if (pend.some(it => it.role !== "any" && (it.date === s.date || diffDays(it.date, s.date) === 1))) p -= 40000;
    }
    p -= (totalPoints(d) + sal(d)) * 1200;      // equità: saldo di partenza + attivo + reperibile
    p -= supCounts[d] * 400;                    // bilanciamento dei superfestivi
    if (lastDate[d]) {
      const rest = diffDays(s.date, lastDate[d]!);
      if (rest >= 2) p += Math.min(rest - 1, 30) * 10;                // più riposo = più priorità
    } else {
      p += 300;                                 // non ha ancora lavorato
    }
    p += rnd() * 0.99;                          // sparigliamento casuale
    return p;
  };

  const isValidOnCall = (d: string, s: TurnoFest, titolare: string | null) => {
    if (!ocEligible.has(d)) return false;
    if (d === titolare) return false;
    if (s.tipo === "notturno" && soloDiurni.has(d)) return false;     // esentato dalle notti
    if (onCallCounts[d] >= ocMax) return false;
    if (activeDates[d].has(s.date)) return false;
    if (onCallDates[d].has(s.date)) return false;
    return true;
  };
  const ocPriority = (d: string) => {
    let p = 0;
    p -= (totalPoints(d) + sal(d)) * 1200;
    p -= onCallCounts[d] * 300;
    p += rnd() * 0.99;
    return p;
  };

  const assignments: Assegnazione[] = [];
  for (const s of shifts) {
    let best: string | null = null, bestP = -Infinity;
    for (const d of cfg.doctors) {
      if (!isValid(d, s)) continue;
      const p = priority(d, s);
      if (p > bestP) { bestP = p; best = d; }
    }
    const rec: Assegnazione = { date: s.date, tipo: s.tipo, holNames: s.holNames, holBases: s.holBases, keys: s.keys, isSuper: s.isSuper,
      points: s.points, shared: s.shared, doctor: best, histHit: false, prefHit: false, onCall: null, onCallPoints: 0 };
    if (best) {
      const hits = hitsOf(best, s);
      rec.histHit = inSet(hist, best, s.holBases);
      rec.prefHit = hits.length > 0;
      counts[best]++;
      points[best] = Math.round((points[best] + s.points) * 100) / 100;
      activeDates[best].add(s.date);
      if (s.isSuper) supCounts[best]++;
      if (s.tipo === "diurno") dayCounts[best]++; else nightCounts[best]++;
      if (rec.prefHit) { prefHits[best]++; hits.forEach(i => prefSat[best!].add(i)); }
      lastDate[best] = s.date;
      if (s.tipo === "notturno") lastNight[best] = s.date;
    }
    if (ocEnabled) {
      const ocPts = Math.round(s.points * ocWeight * 100) / 100;
      let ocBest: string | null = null, ocBestP = -Infinity;
      for (const d of cfg.doctors) {
        if (!isValidOnCall(d, s, best)) continue;
        const p = ocPriority(d);
        if (p > ocBestP) { ocBestP = p; ocBest = d; }
      }
      if (ocBest) {
        rec.onCall = ocBest;
        rec.onCallPoints = ocPts;
        onCallCounts[ocBest]++;
        onCallPoints[ocBest] = Math.round((onCallPoints[ocBest] + ocPts) * 100) / 100;
        onCallDates[ocBest].add(s.date);
      }
    }
    assignments.push(rec);
  }
  const totals: Conti = {};
  for (const d of cfg.doctors) totals[d] = totalPoints(d);
  return { assignments, counts, supCounts, dayCounts, nightCounts, prefHits, points, onCallCounts, onCallPoints, totals };
}

/** Punteggio della soluzione: più basso = migliore. */
export function scoreSolution(sol: Soluzione, cfg: CfgPiano): number {
  let score = 0;
  score += sol.assignments.filter(a => !a.doctor).length * 1e9;
  const supPrio = new Set(cfg.superPrio || []);
  for (const d of cfg.doctors) {
    if (sol.supCounts[d] < cfg.minSuper) {
      score += 1e6 * (cfg.minSuper - sol.supCounts[d]);
      if (supPrio.has(d)) score += 3e5;         // a restare senza non deve essere chi lo è già stato
    }
  }
  score += sol.assignments.filter(a => a.histHit && !a.prefHit).length * 20000;
  const prefItems = cfg.prefItems || normalizePrefs(cfg.preferences, cfg.holidays);
  let missed = 0;
  for (const d of cfg.doctors) {
    for (const it of (prefItems[d] || [])) {
      if (!sol.assignments.some(a => a.doctor === d && prefMatches(it, a))) missed++;
    }
  }
  score += missed * 25000;                      // una richiesta rispettata vale più di qualche decimo di equità

  const ocOn = !!cfg.onCall?.enabled;
  const spreadVar = (vals: number[], wSpread: number, wVar: number) => {
    let s = (Math.max(...vals) - Math.min(...vals)) * wSpread;
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    s += vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length * wVar;
    return s;
  };
  const sal = (d: string) => (cfg.saldo && +cfg.saldo[d]) || 0;
  const activeV = cfg.doctors.map(d => sol.points[d] + sal(d));
  if (ocOn) {
    const totV = cfg.doctors.map(d => sol.totals[d] + sal(d));
    score += spreadVar(totV, 4000, 1500);       // con reperibilità domina il carico totale
    score += spreadVar(activeV, 800, 300);
  } else {
    score += spreadVar(activeV, 4000, 1500);
  }
  const cv = cfg.doctors.map(d => sol.counts[d]);
  score += (Math.max(...cv) - Math.min(...cv)) * (ocOn ? 120 : 600);
  const sv = cfg.doctors.map(d => sol.supCounts[d]);
  score += (Math.max(...sv) - Math.min(...sv)) * 500;
  const nv = cfg.doctors.map(d => sol.nightCounts[d]);
  score += (Math.max(...nv) - Math.min(...nv)) * 300;

  if (ocOn) {
    score += sol.assignments.filter(a => !a.onCall).length * 5e5;     // turni senza reperibile
    const elig = (cfg.onCall!.eligible || []).filter(d => cfg.doctors.includes(d));
    if (elig.length) {
      const ov = elig.map(d => sol.onCallCounts[d]);
      score += (Math.max(...ov) - Math.min(...ov)) * 500;
    }
  }
  return score;
}

/** Ricalcola tutte le statistiche di una soluzione dall'elenco dei turni. */
export function rebuildSolution(A: Assegnazione[], cfg: CfgPiano): Soluzione {
  const z = () => { const o: Conti = {}; for (const d of cfg.doctors) o[d] = 0; return o; };
  const sol: Soluzione = { assignments: A, counts: z(), supCounts: z(), dayCounts: z(), nightCounts: z(), prefHits: z(), points: z(),
    onCallCounts: z(), onCallPoints: z(), totals: z() };
  const hist = cfg.history || {}, PI = cfg.prefItems || {};
  const w = (typeof cfg.onCall?.weightPct === "number" ? cfg.onCall.weightPct : 40) / 100;
  for (const a of A) {
    const d = a.doctor;
    a.histHit = !!d && (hist[d] || []).some(n => (a.holBases || a.holNames).includes(n));
    a.prefHit = !!d && (PI[d] || []).some(it => prefMatches(it, a));
    if (d) {
      sol.counts[d]++; sol.points[d] = Math.round((sol.points[d] + a.points) * 100) / 100;
      if (a.isSuper) sol.supCounts[d]++;
      if (a.tipo === "diurno") sol.dayCounts[d]++; else sol.nightCounts[d]++;
      if (a.prefHit) sol.prefHits[d]++;
    }
    a.onCallPoints = a.onCall ? Math.round(a.points * w * 100) / 100 : 0;
    if (a.onCall) {
      sol.onCallCounts[a.onCall]++;
      sol.onCallPoints[a.onCall] = Math.round((sol.onCallPoints[a.onCall] + a.onCallPoints) * 100) / 100;
    }
  }
  for (const d of cfg.doctors) sol.totals[d] = Math.round((sol.points[d] + sol.onCallPoints[d]) * 100) / 100;
  return sol;
}

/** Vincoli rigidi per i medici toccati da uno spostamento. */
export function feasibleFor(A: Assegnazione[], cfg: CfgPiano, ds: (string | null)[]): boolean {
  const oc = cfg.onCall, ocOn = !!oc?.enabled;
  const elig = new Set(oc?.eligible || []);
  const ocMax = typeof oc?.maxPer === "number" ? oc.maxPer : 999;
  const soloDiurni = new Set(cfg.soloDiurni || []);
  for (const d of ds) {
    if (!d) continue;
    const act: string[] = [], onc: string[] = [];
    const sd = soloDiurni.has(d);
    for (const a of A) {
      if (a.doctor === d) { if (sd && a.tipo === "notturno") return false; act.push(a.date); }
      if (a.onCall === d) { if (sd && a.tipo === "notturno") return false; onc.push(a.date); }
    }
    if (act.length > cfg.maxShifts) return false;
    act.sort();
    for (let i = 1; i < act.length; i++) if (diffDays(act[i], act[i - 1]) < 2) return false;   // no stesso giorno / giorni consecutivi
    if (onc.length) {
      if (!ocOn || !elig.has(d) || onc.length > ocMax) return false;
      if (new Set(onc).size !== onc.length) return false;
      for (const x of onc) if (act.includes(x)) return false;         // mai titolare e reperibile lo stesso giorno
    }
  }
  return true;
}

/** Ricerca locale a scambi: sposta un turno a un altro medico o scambia due
 *  turni (e lo stesso per i reperibili); tiene ogni cambio che migliora il
 *  punteggio rispettando i vincoli. */
export function improveLocal(sol: Soluzione, cfg: CfgPiano, maxPasses?: number): Soluzione {
  const A = sol.assignments.map(a => Object.assign({}, a));
  const ocOn = !!cfg.onCall?.enabled;
  let best = scoreSolution(rebuildSolution(A, cfg), cfg);
  const tryMove = (apply: () => void, undo: () => void, ds: (string | null)[]) => {
    apply();
    if (feasibleFor(A, cfg, ds)) {
      const sc = scoreSolution(rebuildSolution(A, cfg), cfg);
      if (sc < best - 1e-9) { best = sc; return true; }
    }
    undo(); return false;
  };
  let passes = 0, moves = 0, improved = true;
  while (improved && passes < (maxPasses || 30)) {
    improved = false; passes++;
    for (let i = 0; i < A.length; i++) {
      for (const d of cfg.doctors) {
        const old = A[i].doctor; if (d === old) continue;
        if (tryMove(() => { A[i].doctor = d; }, () => { A[i].doctor = old; }, [d, old])) { improved = true; moves++; }
      }
      for (let j = i + 1; j < A.length; j++) {
        const x = A[i].doctor, y = A[j].doctor; if (x === y) continue;
        if (tryMove(() => { A[i].doctor = y; A[j].doctor = x; }, () => { A[i].doctor = x; A[j].doctor = y; }, [x, y])) { improved = true; moves++; }
      }
      if (ocOn) {
        for (const d of cfg.doctors) {
          const old = A[i].onCall; if (d === old) continue;
          if (tryMove(() => { A[i].onCall = d; }, () => { A[i].onCall = old; }, [d, old])) { improved = true; moves++; }
        }
        for (let j = i + 1; j < A.length; j++) {
          const x = A[i].onCall, y = A[j].onCall; if (x === y) continue;
          if (tryMove(() => { A[i].onCall = y; A[j].onCall = x; }, () => { A[i].onCall = x; A[j].onCall = y; }, [x, y])) { improved = true; moves++; }
        }
      }
    }
  }
  const out = rebuildSolution(A, cfg);
  out.lsMoves = moves;
  return out;
}

/** Sorteggio: molti tentativi in ordine di data, poi ricerca locale sui migliori. */
export function generaPiano(cfg: CfgPiano): Soluzione {
  const shifts = buildShifts(cfg.holidays);
  const cfg2: CfgPiano = Object.assign({}, cfg, { prefItems: normalizePrefs(cfg.preferences, cfg.holidays) });
  const attempts = cfg.attempts || 400;
  const ocOn = !!cfg.onCall?.enabled;
  const sal = (d: string) => (cfg.saldo && +cfg.saldo[d]) || 0;
  const spreadOf = (s: Soluzione) => { const v = cfg.doctors.map(d => (ocOn ? s.totals[d] : s.points[d]) + sal(d));
    return Math.round((Math.max(...v) - Math.min(...v)) * 100) / 100; };
  const top: Soluzione[] = [];
  const TOPK = cfg.topK || 3;
  for (let i = 0; i < attempts; i++) {
    const seed = (cfg.baseSeed || 1) * 7919 + i * 104729;
    const sol = assignOnce(cfg2, shifts, mulberry32(seed));
    sol.score = scoreSolution(sol, cfg2); sol.seed = seed;
    if (top.length < TOPK || sol.score < top[top.length - 1].score!) {
      top.push(sol); top.sort((a, b) => a.score! - b.score!); if (top.length > TOPK) top.pop();
    }
  }
  const greedyBest = top[0];
  let best = greedyBest, bestScore = greedyBest.score!;
  if (cfg.localSearch !== false) {
    for (const g of top) {
      const imp = improveLocal(g, cfg2);
      const sc = scoreSolution(imp, cfg2);
      if (sc < bestScore) { best = imp; bestScore = sc; best.seed = g.seed; }
    }
  }
  best.score = bestScore; best.shiftCount = shifts.length;
  best.prefItems = cfg2.prefItems; best.maxShifts = cfg.maxShifts;
  best.spreadBefore = spreadOf(greedyBest); best.spreadAfter = spreadOf(best);
  best.saldo = Object.assign({}, cfg.saldo || {});
  return best;
}

/** Verifica indipendente dei vincoli di un piano (per l'interfaccia e i test). */
export function verificaPiano(sol: Soluzione, cfg: CfgPiano): string[] {
  const err: string[] = [];
  const soloDiurni = new Set(cfg.soloDiurni || []);
  for (const a of sol.assignments) if (!a.doctor) err.push(`${fmtIt(a.date)} ${a.tipo}: nessun medico disponibile`);
  for (const d of cfg.doctors) {
    const miei = sol.assignments.filter(a => a.doctor === d).sort((a, b) => a.date.localeCompare(b.date));
    if (miei.length > cfg.maxShifts) err.push(`${d}: ${miei.length} turni (massimo ${cfg.maxShifts})`);
    for (let i = 1; i < miei.length; i++) if (diffDays(miei[i].date, miei[i - 1].date) < 2) err.push(`${d}: turni troppo vicini (${fmtIt(miei[i - 1].date)} e ${fmtIt(miei[i].date)})`);
    if (soloDiurni.has(d) && miei.some(a => a.tipo === "notturno")) err.push(`${d}: esentato dalle notti ma ha una notte`);
    const rep = sol.assignments.filter(a => a.onCall === d);
    for (const a of rep) if (miei.some(x => x.date === a.date)) err.push(`${d}: titolare e reperibile lo stesso giorno (${fmtIt(a.date)})`);
  }
  return err;
}
