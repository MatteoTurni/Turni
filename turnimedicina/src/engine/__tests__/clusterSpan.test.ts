import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { makeCtx } from "../ctx";
import { faseCritici } from "../fasi";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt } from "../state";

// ─── v0.3.24: CHIUSURA DELLO SPAN DEI CLUSTER ────────────────────────────────
// faseCritici raggruppa i giorni critici in componenti connesse (distanza ≤2).
// Un giorno NON critico che cade DENTRO lo span di una componente deve entrare
// comunque nel cluster: altrimenti il backtracking risolve i giorni critici che
// lo circondano senza sapere che anche lui ha un fabbisogno, e può scegliere una
// combinazione che — via riposo post-notte — glielo rende impossibile.
// Scenario minimo: g10 e g12 critici (pochi eleggibili), g11 comodo e incastrato.

const MEDICI: Medico[] = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1, nome: `M${i + 1}. TEST`, codice: String(i + 1),
  stato: "MR" as const, obiettivo: 25, ambulatorio: false,
}));
const ANNO = 2026, MESE = 5, NDIM = 30;   // giugno 2026

const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));

beforeEach(() => {
  const R = dft();
  // Un solo medico per fascia: rende il giorno stretto senza renderlo impossibile.
  R.fabb.fer = { mMin: 1, pMin: 1, nMin: 1 };
  setRegole(R);
  ENG.PREV = null;
  setSalt(0);
});

/** Assenze costruite perché la criticità cada SOLO su g10 e g12:
 *   g10: 5 assenti          ⇒ elig(10,·) = 3            ⇒ critico
 *   g12: 3 assenti + g13: 2 ⇒ elig(12,N) = 3            ⇒ critico
 *   g11: nessun assente     ⇒ elig(11,N) = 5            ⇒ NON critico
 *  g10 e g12 distano 2 ⇒ stessa componente ⇒ g11 è INCASTRATO nello span. */
const scenario = (): TurniMese => {
  const T: TurniMese = {};
  for (const m of MEDICI) T[m.id] = {};
  const assenze: [number, number[]][] = [[10, [1, 2, 3, 4, 5]], [12, [1, 2, 3]], [13, [4, 5]]];
  for (const [g, ids] of assenze) for (const id of ids)
    T[id][g] = { t: [{ tipo: "X", sott: false, man: true }] };
  return T;
};

describe("faseCritici: chiusura dello span dei cluster", () => {
  it("il giorno incastrato è davvero NON critico e i suoi vicini SÌ", () => {
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, scenario());
    const elig = (g: number) => c.eleggibili(g, "N", c.mrMdc).length;
    expect(elig(10) - c.needEff(10, "N")).toBeLessThanOrEqual(2);   // critico
    expect(elig(12) - c.needEff(12, "N")).toBeLessThanOrEqual(2);   // critico
    expect(elig(11) - c.needEff(11, "N")).toBeGreaterThan(2);       // NON critico
    expect(12 - 10).toBeLessThanOrEqual(2);                          // stessa componente
  });

  it("faseCritici copre la notte del giorno incastrato, non solo quelle dei critici", () => {
    const T = scenario();
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    expect(faseCritici(c, 12345)).toBe(true);
    // I due giorni critici sono coperti (comportamento preesistente)...
    expect(c.cf(10, "N")).toBeGreaterThanOrEqual(1);
    expect(c.cf(12, "N")).toBeGreaterThanOrEqual(1);
    // ...e il giorno incastrato pure: senza la chiusura dello span restava a
    // 0/1 su TUTTE le fasce, scaricato su faseNotti col pool già consumato.
    expect(c.cf(11, "N")).toBeGreaterThanOrEqual(1);
    expect(c.cf(11, "M")).toBeGreaterThanOrEqual(1);
    expect(c.cf(11, "P")).toBeGreaterThanOrEqual(1);
  });

  it("un giorno comodo FUORI dallo span resta fuori dal cluster", () => {
    const T = scenario();
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    faseCritici(c, 12345);
    // g20 è lontano da ogni giorno critico: faseCritici non deve toccarlo,
    // altrimenti la fase avrebbe smesso di essere "solo i colli di bottiglia".
    expect(c.cf(20, "N")).toBe(0);
  });
});
