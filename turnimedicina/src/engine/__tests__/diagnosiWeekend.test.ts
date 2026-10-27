import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { setRegole, REGOLE_DEFAULT, getRegole } from "../regole";
import { setSalt, setAmbRotStart, setPrevContext } from "../state";
import { bilancioNotti, spiegaWeekend, specProveWeekend, eseguiProva, componiEsito } from "../diagnosiWeekend";

// ── DIAGNOSI NOTTI E WEEKEND LIBERI (v0.3.47) ────────────────────────────────
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const med = (id: number, stato: Medico["stato"], obiettivo = 27): Medico => ({ id, nome: `X. M${id}`, codice: "" + id, stato, obiettivo, ambulatorio: false });
beforeEach(() => { setSalt(0); setAmbRotStart(0); setPrevContext(null, 2026, 8); setRegole(dft()); });
afterEach(() => { setRegole(dft()); });

describe("bilancioNotti", () => {
  it("conta notti da coprire, tetti (notti manuali, obiettivo, giorni liberi) e margine", () => {
    const medici = [med(1, "MR"), med(2, "MR"), med(3, "MR", 6), med(4, "ML")];
    const T: TurniMese = {
      1: { 10: { t: [{ tipo: "N", man: true }] }, 12: { t: [{ tipo: "3", sott: true, est: true, man: true }] } },
      2: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [i + 1, { t: [{ tipo: "L", man: true }] }])),
    };
    const b = bilancioNotti(2026, 8, 30, medici, T);
    expect(b.daCoprire).toBe(29);                                       // 30 notti meno la N manuale del 10
    const x = Object.fromEntries(b.medici.map(m => [m.nome, m]));
    expect(x["M1"].tetto).toBe(3);                                      // 5 − 2 notti manuali (N e 3*)
    expect(x["M1"].manuali).toEqual(["N il 10", "3* (ALPI) il 12"]);
    expect(x["M2"].limite).not.toBe("tetto");                           // in licenza fino al 24
    expect(x["M3"].tetto).toBe(3);                                      // obiettivo 6 → al massimo 3 notti
    expect(x["M3"].limite).toBe("obiettivo");
    expect(b.medici.some(m => m.nome === "M4")).toBe(false);            // l'ML non fa notti
    expect(b.margine).toBe(b.capacita - b.daCoprire);
    expect(b.tirato).toBe(true);
  });
});

describe("spiegaWeekend", () => {
  it("niente da spiegare se tutti hanno i weekend liberi", () => {
    const medici = [med(1, "MR"), med(2, "MR")];
    expect(spiegaWeekend(2026, 8, 30, medici, {})).toEqual([]);
  });
  it("per un turno automatico di weekend elenca perché i colleghi non potevano prenderlo", () => {
    // settembre 2026: sab 5, 12, 19, 26. M1 lavora tutti i sabati (automatici)
    const medici = [med(1, "MR"), med(2, "MR"), med(3, "MR")];
    const T: TurniMese = { 1: {}, 2: {}, 3: {} };
    for (const g of [5, 12, 19, 26]) T[1][g] = { t: [{ tipo: "M" }] };
    T[2][12] = { t: [{ tipo: "L", man: true }] };                        // M2 assente sab 12
    T[3][11] = { t: [{ tipo: "N" }] };                                   // M3 di notte il venerdì 11
    const sp = spiegaWeekend(2026, 8, 30, medici, T);
    const m1 = sp.find(x => x.id === 1)!;
    expect(m1.liberi).toBe(0);
    const sab12 = m1.weekend.find(w => w.sab === 12)!.turni[0];
    expect(sab12.man).toBe(false);
    expect(sab12.motivi.join(" | ")).toMatch(/M2: assente/);
    expect(sab12.motivi.join(" | ")).toMatch(/M3: riposo dopo la notte/);
  });
});

describe("prove 'cosa servirebbe'", () => {
  it("le prove: riferimento, massimo notti +1, consecutivi +1, poi i turni manuali (prima i 3)", () => {
    const medici = [med(1, "MR"), med(2, "MR"), med(3, "MR")];
    const T: TurniMese = { 1: { 9: { t: [{ tipo: "N", man: true }] }, 16: { t: [{ tipo: "3", sott: true, est: true, man: true }] } } };
    const sp = specProveWeekend(2026, 8, 30, medici, T);
    expect(sp[0].etichetta).toBe("");
    expect(sp[1].regole).toEqual({ maxNotti: getRegole().maxNotti + 1 });
    expect(sp[2].regole).toEqual({ maxConsec: getRegole().maxConsec + 1 });
    expect(sp[3].togli).toEqual({ id: 1, g: 16, tipo: "3", sott: true, est: true });
    expect(sp[3].etichetta).toMatch(/Senza 3\* \(ALPI\) di M1 mer 16/);
  });
  it("una prova rigenera senza modificare le regole correnti", () => {
    const medici = [med(1, "MR"), med(2, "MR"), med(3, "MR"), med(4, "MR"), med(5, "MR"), med(6, "MR")];
    const prima = JSON.stringify(getRegole());
    const r = eseguiProva(2026, 8, 30, medici, {}, { etichetta: "x", regole: { maxNotti: 9 } }, 800);
    expect(r.buchi).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(getRegole())).toBe(prima);
  });
  it("componiEsito: tiene la ripetizione migliore e segna risolve/migliora rispetto al riferimento", () => {
    const e = componiEsito(
      [{ etichetta: "" }, { etichetta: "a" }, { etichetta: "b" }, { etichetta: "c" }],
      [[{ deficit: 3, buchi: 0 }, { deficit: 2, buchi: 0 }], [{ deficit: 1, buchi: 0 }, { deficit: 0, buchi: 0 }], [{ deficit: 1, buchi: 0 }], [{ deficit: 0, buchi: 2 }]], 0);
    expect(e.base).toEqual({ deficit: 2, buchi: 0 });
    expect(e.prove.map(p => [p.etichetta, p.risolve, p.migliora])).toEqual([["a", true, true], ["b", false, true], ["c", false, false]]);
  });
});
