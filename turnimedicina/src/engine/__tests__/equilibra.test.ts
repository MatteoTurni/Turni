import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { makeCtx } from "../ctx";
import { equilibra } from "../equilibra";

// ── v0.3.42: pulsante "Equilibra" ────────────────────────────────────────────
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const put = (T: TurniMese, id: number, g: number, tipo: string, man = false) => {
  const c = ((T[id] ||= {})[g] ||= { t: [] });
  c.t = [...c.t, { tipo, sott: false, man }];
};
const med = (id: number, stato: Medico["stato"], obiettivo: number): Medico =>
  ({ id, nome: `X. M${id}`, codice: String(id), stato, obiettivo, ambulatorio: false });
const firma = (T: TurniMese, medici: Medico[]) => {
  const c = makeCtx(2026, 5, 30, medici, T);
  const a: number[] = [];
  for (let g = 1; g <= 30; g++) for (const f of ["M", "P", "N"]) a.push(c.cf(g, f));
  return a.join(",") + "|" + medici.map(m => c.cnt(m.id)).join(",");
};
const mat = (T: TurniMese, id: number) => Object.values(T[id] || {}).filter(c => c.t.some(s => s.tipo === "M")).length;

beforeEach(() => { setSalt(0); setAmbRotStart(0); ENG.PREV = null; setRegole(dft()); });
afterEach(() => { setRegole(dft()); });

describe("equilibra: mattine/pomeriggi", () => {
  const giorni = [2, 4, 9, 11, 16, 18];
  it("stesso giorno: da 6M/6P a 3 e 3, copertura e punti identici", () => {
    const medici = [med(1, "MR", 25), med(2, "MR", 25)];
    const T: TurniMese = {};
    for (const g of giorni) { put(T, 1, g, "M"); put(T, 2, g, "P"); }
    const e = equilibra(2026, 5, 30, medici, T);
    expect(e.scambiMP).toBeGreaterThan(0);
    expect(mat(e.turni, 1)).toBe(3);
    expect(mat(e.turni, 2)).toBe(3);
    expect(firma(e.turni, medici)).toBe(firma(T, medici));
    expect(e.celle.length).toBe(2 * e.scambiMP);
  });
  it("fra giorni diversi: mattine e pomeriggi in giorni distinti vengono riequilibrati", () => {
    const medici = [med(1, "MR", 25), med(2, "MR", 25)];
    const T: TurniMese = {};
    for (const g of [2, 9, 16, 23]) put(T, 1, g, "M");   // martedì: solo mattine a 1
    for (const g of [4, 11, 18, 25]) put(T, 2, g, "P");  // giovedì: solo pomeriggi a 2
    expect(equilibra(2026, 5, 30, medici, T).scambiMP).toBe(0);            // nessuno scambio nello stesso giorno
    const e = equilibra(2026, 5, 30, medici, T, { traGiorni: true });
    expect(e.scambiMP).toBeGreaterThan(0);
    expect(mat(e.turni, 1)).toBeLessThan(4);
    expect(mat(e.turni, 2)).toBeGreaterThan(0);
    expect(firma(e.turni, medici)).toBe(firma(T, medici));
  });
  it("manuali, MDC e ML non si toccano", () => {
    const medici = [med(1, "MR", 25), med(2, "MDC", 21), med(3, "MR", 25), med(4, "ML", 25)];
    const T: TurniMese = {};
    for (const g of giorni) { put(T, 1, g, "M", true); put(T, 3, g, "M", true); put(T, 2, g, "P"); put(T, 4, g, "M"); }
    const e = equilibra(2026, 5, 30, medici, T, { traGiorni: true });
    expect(e.scambiMP + e.scambiNotti).toBe(0);
    expect(e.celle).toEqual([]);
  });
});

describe("equilibra: notti", () => {
  it("5 contro 1 notti: la notte passa e chi la cede riprende 2 turni diurni (punti invariati)", () => {
    const medici = [med(1, "MR", 25), med(2, "MR", 25)];
    const T: TurniMese = {};
    for (const g of [1, 5, 9, 13, 17]) put(T, 1, g, "N");
    put(T, 2, 21, "N");
    for (const g of [2, 3, 4, 8, 10, 11, 15, 16, 22, 23, 24, 25, 29, 30]) put(T, 2, g, g % 2 ? "M" : "P");
    const e = equilibra(2026, 5, 30, medici, T);
    expect(e.scambiNotti).toBeGreaterThan(0);
    const c0 = makeCtx(2026, 5, 30, medici, T), c1 = makeCtx(2026, 5, 30, medici, e.turni);
    expect(Math.abs(c1.cntN(1) - c1.cntN(2))).toBeLessThan(Math.abs(c0.cntN(1) - c0.cntN(2)));
    expect(firma(e.turni, medici)).toBe(firma(T, medici));
  });
  it("le notti manuali restano dove sono", () => {
    const medici = [med(1, "MR", 25), med(2, "MR", 25)];
    const T: TurniMese = {};
    for (const g of [1, 5, 9, 13, 17]) put(T, 1, g, "N", true);
    const e = equilibra(2026, 5, 30, medici, T);
    expect(e.scambiNotti).toBe(0);
  });
});
