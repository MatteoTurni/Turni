import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { Medico, TurniMese } from "../types";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { setPrevContext } from "../state";
import { makeCtx } from "../ctx";
import { completaObiettivi } from "../genera";

// ── v0.3.52: Completa obiettivi aggiunge la MATTINA a chi ha già il pomeriggio ─
// Caso reale (novembre 2026, nomi anonimizzati): un MDC a 20/21 con il solo
// pomeriggio il 12; quel giorno la mattina è libera (2/3) e ammessa da tutte
// le regole, ma Completa costruiva le giornate piene solo nel verso M→P.
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
beforeEach(() => { setRegole(dft()); setPrevContext(null, 2026, 10); });
afterEach(() => { setRegole(dft()); });

describe("Completa obiettivi: giornata piena nel verso P→M", () => {
  it("il caso di novembre: l'MDC (id 8) riceve la mattina del 12 e arriva all'obiettivo", () => {
    const sc = JSON.parse(fs.readFileSync("src/engine/__tests__/fixtures/novembre2026_lezzi.json", "utf8"));
    const m8 = sc.medici.find((m: Medico) => m.id === 8);
    const prima = makeCtx(2026, 10, 30, sc.medici, JSON.parse(JSON.stringify(sc.T)));
    expect(prima.cnt(8)).toBe(20);
    const r = completaObiettivi(2026, 10, 30, sc.medici, sc.T);
    expect((r.turni[8][12].t).map(s => s.tipo).sort()).toEqual(["M", "P"]);
    expect(makeCtx(2026, 10, 30, sc.medici, r.turni).cnt(8)).toBe(m8.obiettivo);
    expect(r.rimasti.find(x => x.id === 8)).toBeUndefined();
    // nessun turno già presente è stato tolto o spostato
    for (const id in sc.T) for (const g in sc.T[id]) for (const s of sc.T[id][g].t)
      expect(r.turni[id][g].t.some((x: any) => x.tipo === s.tipo), `${id}/${g}/${s.tipo}`).toBe(true);
  });
  it("prima i giorni liberi: la mattina associata è l'ultima scelta", () => {
    const medici: Medico[] = [{ id: 1, nome: "X. A", codice: "1", stato: "MR", obiettivo: 2, ambulatorio: false }];
    const T: TurniMese = { 1: { 3: { t: [{ tipo: "P" }] } } };            // ha il P martedì 3; il resto è libero
    const r = completaObiettivi(2026, 10, 30, medici, T);
    expect((r.turni[1][3].t).map(s => s.tipo)).toEqual(["P"]);           // non completa il 3: usa un giorno libero
  });
});
