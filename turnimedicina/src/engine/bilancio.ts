import type { Medico, Turno, TurniMese, Regole } from "./types";
import { vt, isMatt, isPom, isNot } from "./turni";
import { dowOf, isFestivo, isSabN, isDomN } from "./date";

// ─── BILANCIO DEL MESE ────────────────────────────────────────────────────────
// Quattro numeri, tutti nella STESSA unità di cntM/vt (la colonna "Ob."):
// notte = 2, M/P/A/L/104/per11/ANA/1/2 = 1, turno sottolineato = 0.
//
//   L+P  assenze retribuite inserite a mano (L, 104, per11, ANA)
//   S    somma degli obiettivi mensili
//   PS   turni di pronto soccorso (1, 2, 3) — consumano obiettivo ma NON
//        coprono il fabbisogno di reparto
//   D    = S − (L+P) − PS   turni realmente lavorabili in reparto
//   F    = fabbisogno minimo del mese + ambulatori − quanto coprono gli MPS
//
// Il mese è copribile ⇔ D ≥ F.
//
// Gli MPS sono fuori da S (obiettivo 0), quindi devono restare fuori anche da
// L+P e da PS: i loro permessi non scalano nulla. I turni di reparto che però
// coprono davvero (M/P/N/A) si sottraggono da F, che è quindi un fabbisogno
// NETTO e si abbassa man mano che li inserisci.

export const ASSENZE = ["L", "104", "per11", "ANA"];
export const PS      = ["1", "2", "3"];
/** Turni che coprono il fabbisogno di reparto (l'ambulatorio è dentro F). */
export const COPRONO = ["M", "P", "N", "A"];

export interface Bilancio {
  lp: number;   // L + 104 + p11 + ANA (manuali, non-MPS)
  s: number;    // Σ obiettivi
  ps: number;   // turni PS dei non-MPS, in vt
  d: number;    // S − LP − PS
  f: number;    // fabbisogno netto
  fLordo: number;
  copertoMPS: number;
  ok: boolean;  // d >= f
}

const gt = (T: TurniMese, id: number, g: number) => T[id]?.[g]?.t || [];

/** Turni PS (1/2/3) di un medico nel mese, nell'unità di vt(): la notte (3)
 *  pesa 2, mattina e pomeriggio 1. Con `contaSott=false` (default) i turni
 *  sottolineati valgono 0 e il totale COINCIDE con la quota PS scalata da D
 *  nel bilancio. Con `contaSott=true` anche i sottolineati contano (col peso
 *  della loro versione piena): è la modalità del contatore riassuntivo in UI,
 *  che mostra TUTTI i turni fatti in PS, scalati o no dall'obiettivo. */
export function psMedico(T: TurniMese, id: number, nd: number, contaSott = false): number {
  let n = 0;
  for (let g = 1; g <= nd; g++)
    for (const s of gt(T, id, g)) if (PS.includes(s.tipo)) n += vt(s.tipo, contaSott ? false : s.sott);
  return n;
}

/** Riepilogo generale dei turni di un medico (solo conteggio, nessun effetto sul
 *  bilancio). m/p/n contano i turni per fascia INCLUSI i sottolineati; in n rientra
 *  anche il "3" (PS notte) e la sua variante. `wk` è il carico weekend (pesoWeekend). */
export interface RiepilogoMedico { m: number; p: number; n: number; wk: number; }

/** Peso "weekend lavorato" di una CELLA nel giorno g (v0.3.19). Metrica UNICA
 *  condivisa dal contatore riassuntivo (riepilogoMedico.wk) e dall'equità soft
 *  in generazione (byWk in ctx). Regole:
 *   · SABATO feriale → pomeriggio (P/2)=1, notte (N/3)=2; la MATTINA NON conta.
 *   · DOMENICA e FESTIVI infrasettimanali → mattina (M/1)=1, pomeriggio=1, notte=2.
 *   · NOTTE PREFESTIVA → la notte del giorno che precede un festivo vale 2 anche
 *     se quel giorno è feriale (es. lunedì notte prima di un martedì festivo).
 *  Conta ANCHE i sottolineati e i codici PS 1/2/3. La notte prefestiva a cavallo
 *  del mese (ultimo giorno) non è valutata: il conteggio è per-mese. */
export function pesoWeekend(anno: number, mese: number, nd: number, g: number, cella: Turno[]): number {
  const fest = isFestivo(anno, mese, g);                  // domenica + festivo infrasettimanale
  const sab  = isSabN(dowOf(anno, mese, g)) && !fest;     // sabato feriale
  const preFest = g < nd && isFestivo(anno, mese, g + 1); // giorno prefestivo → notte festiva
  if (!sab && !fest && !preFest) return 0;
  let v = 0;
  for (const s of cella) {
    if (isNot(s.tipo)) { if (sab || fest || preFest) v += 2; }
    else if (isPom(s.tipo)) { if (sab || fest) v += 1; }
    else if (isMatt(s.tipo) && fest) v += 1;              // mattina: solo domenica/festivo
  }
  return v;
}

export function riepilogoMedico(
  T: TurniMese, id: number, nd: number, anno: number, mese: number,
): RiepilogoMedico {
  let m = 0, p = 0, n = 0, wk = 0;
  for (let g = 1; g <= nd; g++) {
    const cella = gt(T, id, g);
    for (const s of cella) {
      // m/p/n di reparto (v0.3.20): includono ANCHE i sottolineati. In n rientra
      // anche il "3" (PS notte) e la sua variante sottolineata. La mattina PS "1"
      // e il pomeriggio PS "2" NON entrano in m/p (restano nel conteggio PS).
      if (s.tipo === "M") m++;
      else if (s.tipo === "P") p++;
      else if (isNot(s.tipo)) n++;          // "N", "3" e varianti sottolineate
    }
    wk += pesoWeekend(anno, mese, nd, g, cella);
  }
  return { m, p, n, wk };
}

/** Somma di vt() sui turni di un medico il cui tipo è in `tipi`. Se `soloMan`,
 *  contano solo i turni inseriti a mano. */
function sommaVt(T: TurniMese, id: number, nd: number, tipi: string[], soloMan = false): number {
  let n = 0;
  for (let g = 1; g <= nd; g++)
    for (const s of gt(T, id, g))
      if (tipi.includes(s.tipo) && (!soloMan || s.man)) n += vt(s.tipo, s.sott);
  return n;
}

/** Quanti turni servono nel mese, spezzati per tipo. m/p/n/a sono CONTEGGI di
 *  turni; `vt` è il totale nell'unità della colonna "Ob." (la notte pesa 2).
 *  L'ambulatorio non conta come mattina: la copertura M guarda solo i turni "M". */
export interface DettaglioFabb { m: number; p: number; n: number; a: number; vt: number; }

export function dettaglioFabbisogno(anno: number, mese: number, nd: number, r: Regole): DettaglioFabb {
  let m = 0, p = 0, a = 0;
  for (let g = 1; g <= nd; g++) {
    const dw = dowOf(anno, mese, g), h = isFestivo(anno, mese, g);
    const sp = h || isDomN(dw);
    const fs = sp ? r.fabb.fest : isSabN(dw) ? r.fabb.sab : r.fabb.fer;
    m += fs.mMin;
    p += fs.pMin;
    if ((r.giorniAmb ?? [1]).includes(dw) && !h) a += 1;   // giorno d'ambulatorio feriale
  }
  const n = nd;                    // una notte per ogni giorno del mese
  return { m, p, n, a, vt: m + p + 2 * n + a };
}

/** Fabbisogno LORDO, nell'unità di vt(). */
export function fabbisognoLordo(anno: number, mese: number, nd: number, r: Regole): number {
  return dettaglioFabbisogno(anno, mese, nd, r).vt;
}

export function calcolaBilancio(
  anno: number, mese: number, nd: number,
  medici: Medico[], T: TurniMese, r: Regole,
): Bilancio {
  let lp = 0, s = 0, ps = 0, copertoMPS = 0;
  for (const m of medici) {
    if (m.stato === "MPS") { copertoMPS += sommaVt(T, m.id, nd, COPRONO); continue; }
    s  += m.obiettivo;
    lp += sommaVt(T, m.id, nd, ASSENZE, true);
    ps += sommaVt(T, m.id, nd, PS);
  }
  const fLordo = fabbisognoLordo(anno, mese, nd, r);
  const f = Math.max(0, fLordo - copertoMPS);
  const d = s - lp - ps;
  return { lp, s, ps, d, f, fLordo, copertoMPS, ok: d >= f };
}
