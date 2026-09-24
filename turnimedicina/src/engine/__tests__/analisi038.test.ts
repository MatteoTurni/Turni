import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { makeCtx } from "../ctx";
import { quoteNotti, scartoNotti, riequilibraNotti, riequilibraMP, completaObiettivi } from "../genera";

// ── v0.3.38: equità delle notti fra gli MR e dei turni mancanti ──────────────

const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const put = (T: TurniMese, id: number, g: number, tipo: string, man = false) => {
  const c = ((T[id] ||= {})[g] ||= { t: [] });
  c.t = [...c.t, { tipo, sott: false, man }];
};
const med = (id: number, stato: Medico["stato"], obiettivo: number): Medico =>
  ({ id, nome: `X. M${id}`, codice: String(id), stato, obiettivo, ambulatorio: false });

beforeEach(() => { setSalt(0); setAmbRotStart(0); ENG.PREV = null; setRegole(dft()); });
afterEach(() => { setRegole(dft()); });

describe("scartoNotti: solo MR, stessa quota per tutti", () => {
  it("l'MDC (e l'ML) non entrano nel conto", () => {
    const medici = [med(1, "MR", 25), med(2, "MR", 25), med(3, "MDC", 21), med(4, "ML", 25)];
    const T: TurniMese = {};
    for (const g of [1, 5, 9, 13]) put(T, 1, g, "N");
    for (const g of [3, 7, 11, 15]) put(T, 2, g, "N");
    const c = makeCtx(2026, 5, 30, medici, T);
    expect(scartoNotti(c)).toBe(0);                  // 4 e 4: equo, anche se l'MDC ne ha 0
  });
  it("le ferie non cambiano la quota (media fra gli MR)", () => {
    const medici = [med(1, "MR", 25), med(2, "MR", 25)];
    const T: TurniMese = {};
    for (let g = 16; g <= 30; g++) put(T, 2, g, "L", true);
    for (const g of [1, 5, 9, 13, 17, 21]) put(T, 1, g, "N");
    for (const g of [3, 7, 11]) put(T, 2, g, "N");
    const c = makeCtx(2026, 5, 30, medici, T);
    const q = quoteNotti(c);
    expect(q.get(1)).toBeCloseTo(4.5);
    expect(q.get(2)).toBeCloseTo(4.5);
    expect(scartoNotti(c)).toBeCloseTo(2.25);
  });
});

describe("riequilibraNotti", () => {
  it("5 contro 1 notti fra due MR presenti tutto il mese → 3 e 3, stesse notti coperte", () => {
    const medici = [med(1, "MR", 25), med(2, "MR", 25)];
    const T: TurniMese = {};
    for (const g of [1, 5, 9, 13, 17]) put(T, 1, g, "N");
    put(T, 2, 21, "N");
    const c = makeCtx(2026, 5, 30, medici, T);
    const prima = [1, 5, 9, 13, 17, 21].map(g => c.cf(g, "N"));
    expect(riequilibraNotti(2026, 5, 30, medici, c)).toBe(true);
    expect([c.cntN(1), c.cntN(2)].sort()).toEqual([3, 3]);
    expect([1, 5, 9, 13, 17, 21].map(g => c.cf(g, "N"))).toEqual(prima);
  });
  it("non tocca le notti manuali", () => {
    const medici = [med(1, "MR", 25), med(2, "MR", 25)];
    const T: TurniMese = {};
    for (const g of [1, 5, 9, 13, 17]) put(T, 1, g, "N", true);
    const c = makeCtx(2026, 5, 30, medici, T);
    expect(riequilibraNotti(2026, 5, 30, medici, c)).toBe(false);
    expect(c.cntN(1)).toBe(5);
  });
});

describe("riequilibraMP: equilibrio mattine/pomeriggi fra gli MR", () => {
  const giorni = [2, 4, 9, 11, 16, 18];   // mar e gio: nessuna mattina adiacente (ven→lun conta come blocco)
  it("tutte mattine a uno e tutti pomeriggi all'altro → metà e metà, copertura identica", () => {
    const medici = [med(1, "MR", 25), med(2, "MR", 25)];
    const T: TurniMese = {};
    for (const g of giorni) { put(T, 1, g, "M"); put(T, 2, g, "P"); }
    const c = makeCtx(2026, 5, 30, medici, T);
    const prima = giorni.map(g => `${c.cf(g, "M")}${c.cf(g, "P")}`);
    expect(riequilibraMP(2026, 5, 30, medici, c)).toBeGreaterThan(0);
    const mat = (id: number) => giorni.filter(g => c.gt(id, g).some(x => x.tipo === "M")).length;
    expect(mat(1)).toBe(3);
    expect(mat(2)).toBe(3);
    expect(giorni.map(g => `${c.cf(g, "M")}${c.cf(g, "P")}`)).toEqual(prima);
  });
  it("MDC, ML e turni manuali non vengono scambiati", () => {
    const medici = [med(1, "MR", 25), med(2, "MDC", 21), med(3, "MR", 25)];
    const T: TurniMese = {};
    for (const g of giorni) { put(T, 1, g, "M", true); put(T, 3, g, "M"); put(T, 2, g, "P"); }
    const c = makeCtx(2026, 5, 30, medici, T);
    expect(riequilibraMP(2026, 5, 30, medici, c)).toBe(0);
  });
});

describe("Completa obiettivi: fascia scelta per equilibrio mattine/pomeriggi", () => {
  it("un MR con solo mattine riceve pomeriggi, uno con soli pomeriggi riceve mattine", () => {
    const medici = [med(1, "MR", 12), med(2, "MR", 12)];
    const T: TurniMese = {};
    for (const g of [2, 3, 4, 5]) put(T, 1, g, "M", true);      // 1: 4 mattine
    for (const g of [2, 3, 4, 5]) put(T, 2, g, "P", true);      // 2: 4 pomeriggi
    const o = completaObiettivi(2026, 5, 30, medici, T);
    const c = makeCtx(2026, 5, 30, medici, o.turni);
    const conta = (id: number, t: string) => c.giorniArr.filter(g => c.gt(id, g).some(x => x.tipo === t)).length;
    expect(c.cnt(1)).toBe(12);
    expect(c.cnt(2)).toBe(12);
    expect(Math.abs(conta(1, "M") - conta(2, "M"))).toBeLessThanOrEqual(2);
  });
});

describe("Completa obiettivi: MR serviti a turno", () => {
  it("posti per 42 turni e 3 MR da 25: 14/14/14, non 25/9/8", () => {
    setRegole(mergeRegole({ ...dft(), fabb: { fer: { mMin: 1, mMax: 1, pMin: 1, pMax: 1 },
      sab: { mMin: 0, mMax: 0, pMin: 0, pMax: 0 }, fest: { mMin: 0, mMax: 0, pMin: 0, pMax: 0 } } }));
    const medici = [med(1, "MR", 25), med(2, "MR", 25), med(3, "MR", 25)];
    const o = completaObiettivi(2026, 5, 30, medici, {});
    const c = makeCtx(2026, 5, 30, medici, o.turni);
    const n = medici.map(m => c.cnt(m.id));
    expect(n.reduce((a, b) => a + b, 0)).toBe(42);
    expect(Math.max(...n) - Math.min(...n)).toBeLessThanOrEqual(1);
  });
});
