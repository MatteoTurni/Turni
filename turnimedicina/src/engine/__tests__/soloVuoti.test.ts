import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { TurniMese } from "../types";
import { dimOf } from "../date";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../regole";
import { setSalt, setAmbRotStart, setPrevContext } from "../state";
import { generaMigliorTentativo, completaObiettivi } from "../genera";
import { fissaTurni, liberaTurni } from "../turni";
import { squadraGennaio } from "../../../harness/scenari";

// ── PULSANTE COPERTURA «RIEMPI SOLO I VUOTI» (v0.3.50) ───────────────────────
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
beforeEach(() => { setSalt(0); setAmbRotStart(0); setRegole(dft()); });
afterEach(() => { setRegole(dft()); });
const auto = (T: TurniMese) => { const s = new Set<string>(); for (const id in T) for (const g in T[id]) for (const x of T[id][g].t) if (!x.man) s.add(`${id}/${g}/${x.tipo}/${x.amb ?? ""}`); return s; };

describe("fissaTurni / liberaTurni", () => {
  it("rendono manuali gli automatici e poi li riportano automatici, lasciando manuali i manuali", () => {
    const T: TurniMese = { 1: { 3: { t: [{ tipo: "M" }, { tipo: "P", man: true }] }, 4: { t: [{ tipo: "A", amb: "A" }] } } };
    const f = fissaTurni(T);
    expect(f.turni[1][3].t.every(s => s.man)).toBe(true);
    expect(T[1][3].t[0].man).toBeUndefined();                          // l'originale non cambia
    f.turni[1][5] = { t: [{ tipo: "N", man: false }] };                  // un turno nuovo del motore
    liberaTurni(f.turni, f.auto);
    expect(f.turni[1][3].t.map(s => [s.tipo, !!s.man])).toEqual([["M", false], ["P", true]]);
    expect(f.turni[1][4].t[0].man).toBe(false);
    expect(f.turni[1][5].t[0].man).toBe(false);
  });
});

describe("Copertura su un tabellone quasi pieno", () => {
  it("in modalità «solo vuoti» nessun turno automatico presente viene spostato o tolto", () => {
    const sc = JSON.parse(fs.readFileSync("scenario_ottobre2026.json", "utf8"));
    const nd = dimOf(sc.anno, sc.mese);
    const medici = squadraGennaio().map(m => m.id === 3 ? { ...m, ambulatorio: true } : m);
    setPrevContext(null, sc.anno, sc.mese);
    setRegole(mergeRegole({ ...dft(), coperturaSoloVuoti: true }));
    let T1 = generaMigliorTentativo(sc.anno, sc.mese, nd, medici, sc.ex, 2000).turni;
    T1 = completaObiettivi(sc.anno, sc.mese, nd, medici, T1).turni;
    let tolti = 0; const T1b: TurniMese = JSON.parse(JSON.stringify(T1));
    outer: for (const id in T1b) for (const g in T1b[id]) { const t = T1b[id][g].t; if (t.length === 1 && !t[0].man && ["M", "P"].includes(t[0].tipo)) { delete T1b[id][g]; if (++tolti === 2) break outer; } }
    const f = fissaTurni(T1b);
    const T2 = liberaTurni(generaMigliorTentativo(sc.anno, sc.mese, nd, medici, f.turni, 2000).turni, f.auto);
    const prima = auto(T1b), dopo = auto(T2);
    expect([...prima].filter(k => !dopo.has(k))).toEqual([]);           // nessun automatico perso o spostato
    let man1 = 0, man2 = 0;
    for (const id in T1b) for (const g in T1b[id]) man1 += T1b[id][g].t.filter(s => s.man).length;
    for (const id in T2) for (const g in T2[id]) man2 += T2[id][g].t.filter(s => s.man).length;
    expect(man2).toBe(man1);                                             // nessun automatico rimasto "manuale"
  });
});
