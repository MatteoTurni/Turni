// ═══════════════════════════════════════════════════════════════════════════
// IL 1° GENNAIO GENERATO INSIEME A DICEMBRE (v0.3.72)
// ═══════════════════════════════════════════════════════════════════════════
// Con la casella «Comprendi il 1° gennaio», dopo ogni passo su dicembre
// (Copertura, Obiettivi, Equilibra) si genera anche il giorno 1 di gennaio,
// partendo dal dicembre appena fatto (riposi dopo la notte del 31, giorni di
// fila…). Si generano i giorni 1–3 di gennaio, con dicembre come mese
// precedente, e se ne tiene solo il giorno 1: i giorni 2 e 3 servono a
// rispettare i turni già messi a mano lì (riposo dopo una notte del 1°).
// Misurato su 10 dicembri: sempre coperto, nessuna violazione, ~0,4 s; con
// gennaio intero una fascia scoperta su 10 e ~4,5 s.
// I turni scritti nel giorno 1 sono manuali (fissi quando si genera gennaio) e
// portano il segno `dic`: rigenerando dicembre si tolgono e si rifanno. I turni
// del 1° messi a mano (o dal piano festivi) restano.
import type { Medico, TurniAll, TurniMese } from "./types";
import { mkKey } from "./date";
import { ENG, setPrevContext } from "./state";
import { setStoricoFestivi, setStoricoEquita } from "./storico";
import { getRegole } from "./regole";
import { generaMigliorTentativo } from "./genera";
import { meseGenerato } from "./festiviApp";

export const chiaveGennaio = (anno: number) => mkKey(anno + 1, 0);

/** Gennaio senza i turni del 1° generati con dicembre (l'originale non cambia). */
export function togliPrimoGennaio(T: TurniMese | undefined): TurniMese {
  const out: TurniMese = {};
  for (const [id, gi] of Object.entries(T || {})) {
    out[id] = { ...gi };
    const c = gi["1"];
    if (c && c.t.some(s => s.dic)) {
      const resto = c.t.filter(s => !s.dic);
      if (resto.length) out[id]["1"] = { t: resto }; else delete out[id]["1"];
    }
  }
  return out;
}
/** Turni del 1° gennaio generati con dicembre, in tutto. */
export const nPrimoGennaio = (T: TurniMese | undefined) =>
  Object.values(T || {}).reduce((n, gi) => n + (gi["1"]?.t || []).filter(s => s.dic).length, 0);

export interface EsitoPrimoGennaio {
  /** Gennaio da salvare (uguale a prima se c'è un blocco). */
  gennaio: TurniMese;
  /** Motivo per cui il 1° gennaio non è stato generato ("" = generato). */
  blocco: string;
  /** Fasce del 1° gennaio rimaste sotto il minimo (es. ["M"]). */
  scoperti: ("M" | "P" | "N")[];
}

/** Genera il 1° gennaio dell'anno dopo `anno`, con `dicembre` come mese prima. */
export function generaPrimoGennaio(anno: number, medici: Medico[], turniAll: TurniAll, dicembre: TurniMese, ms = 500, giorni = 3): EsitoPrimoGennaio {
  const K = chiaveGennaio(anno);
  const tutti: TurniAll = { ...turniAll, [mkKey(anno, 11)]: dicembre };
  const base = togliPrimoGennaio(tutti[K]);
  if (meseGenerato(base))
    return { gennaio: tutti[K] || {}, blocco: "Gennaio è già stato generato: il 1° gennaio resta com'è.", scoperti: [] };
  const R = getRegole();
  const salva = { PREV: ENG.PREV, STORICO_FEST: ENG.STORICO_FEST, STORICO_EQ: ENG.STORICO_EQ };
  let gen: TurniMese;
  try {
    setPrevContext(tutti, anno + 1, 0);
    setStoricoFestivi(tutti, anno + 1, 0, medici, R.rotazioneFestiviMesi);
    setStoricoEquita(tutti, anno + 1, 0, medici, R.equitaNottiMesi, R.equitaWeekendMesi);
    gen = generaMigliorTentativo(anno + 1, 0, giorni, medici, base, ms).turni;
  } finally {
    ENG.PREV = salva.PREV; ENG.STORICO_FEST = salva.STORICO_FEST; ENG.STORICO_EQ = salva.STORICO_EQ;
  }
  const gennaio: TurniMese = {};
  for (const [id, gi] of Object.entries(base)) gennaio[id] = { ...gi };
  for (const m of medici) {
    const nuovi = (gen[m.id]?.["1"]?.t || []).filter(s => !s.man).map(s => ({ ...s, man: true, dic: true }));
    if (!nuovi.length) continue;
    const gi = (gennaio[m.id] ||= {});
    gi["1"] = { t: [...(gi["1"]?.t || []), ...nuovi] };
  }
  // fasce sotto il minimo festivo (il 1° gennaio è festivo); conta chiunque, MPS compresi
  const conta = (f: string) => Object.values(gennaio).reduce((n, gi) => n + (gi["1"]?.t || []).filter(s => s.tipo === f).length, 0);
  const scoperti: ("M" | "P" | "N")[] = [];
  if (conta("M") < R.fabb.fest.mMin) scoperti.push("M");
  if (conta("P") < R.fabb.fest.pMin) scoperti.push("P");
  if (conta("N") < 1) scoperti.push("N");
  return { gennaio, blocco: "", scoperti };
}
