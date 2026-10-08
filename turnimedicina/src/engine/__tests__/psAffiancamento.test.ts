import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico, TurniMese, Turno } from "../types";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../regole";
import { setSalt, setAmbRotStart, setPrevContext } from "../state";
import { makeCtx } from "../ctx";
import { compagnoMDC, etichettaTurno, vt, cloneTDeep } from "../turni";
import { generaMigliorTentativo, completaObiettivi } from "../genera";
import { dimOf } from "../date";
import { costruisciWorkbook } from "../../export/excel";

// ── TURNI PS E AFFIANCAMENTO MDC (v0.3.45) ───────────────────────────────────
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const conPsAff = (patch: Record<string, { ord?: boolean; alpi?: boolean }>) => {
  const r = dft();
  for (const k in patch) r.psAff[k] = { ...r.psAff[k], ...patch[k] };
  return mergeRegole(r);
};
const MDC: Medico = { id: 1, nome: "X. MDC", codice: "1", stato: "MDC", obiettivo: 21, ambulatorio: false };
const MPS: Medico = { id: 2, nome: "X. MPS", codice: "2", stato: "MPS", obiettivo: 0, ambulatorio: false };
const MR: Medico = { id: 3, nome: "X. MR", codice: "3", stato: "MR", obiettivo: 25, ambulatorio: false };
const conTurno = (s: Turno): TurniMese => ({ 2: { 10: { t: [{ ...s, man: true }] } } });

beforeEach(() => { setSalt(0); setAmbRotStart(0); setPrevContext(null, 2026, 9); setRegole(dft()); });
afterEach(() => { setRegole(dft()); });

describe("compagnoMDC: la regola unica", () => {
  it("default: 1/2/3 ordinari e ALPI validi; in altro ospedale mai; i turni di reparto sempre", () => {
    const r = dft().psAff;
    for (const [tipo, f] of [["1", "M"], ["2", "P"], ["3", "N"]]) {
      expect(compagnoMDC({ tipo }, f, r)).toBe(true);
      expect(compagnoMDC({ tipo, sott: true }, f, r)).toBe(true);
      expect(compagnoMDC({ tipo, est: true }, f, r)).toBe(false);
      expect(compagnoMDC({ tipo, sott: true, est: true }, f, r)).toBe(false);
    }
    for (const [tipo, f] of [["M", "M"], ["A", "M"], ["P", "P"], ["Ap", "P"], ["N", "N"]]) expect(compagnoMDC({ tipo }, f, r)).toBe(true);
    expect(compagnoMDC({ tipo: "3" }, "M", r)).toBe(false);          // fascia sbagliata
  });
  it("le spunte della tabella distinguono ordinario e ALPI", () => {
    const r = conPsAff({ "3": { alpi: false }, "1": { ord: false } }).psAff;
    expect(compagnoMDC({ tipo: "3" }, "N", r)).toBe(true);
    expect(compagnoMDC({ tipo: "3", sott: true }, "N", r)).toBe(false);
    expect(compagnoMDC({ tipo: "1" }, "M", r)).toBe(false);
    expect(compagnoMDC({ tipo: "1", sott: true }, "M", r)).toBe(true);
    expect(compagnoMDC({ tipo: "2" }, "P", r)).toBe(true);
  });
});

describe("mdcOk nel motore", () => {
  const ok = (s: Turno, regole = dft()) => {
    setRegole(regole);
    const c = makeCtx(2026, 9, 31, [MDC, MPS, MR], conTurno(s));
    return c.mdcOk(MDC, 10, "N");
  };
  it("notte: 3 ordinario sì, 3 ALPI sì di default, no se la spunta ALPI è tolta, no se in altro ospedale", () => {
    expect(ok({ tipo: "3" })).toBe(true);
    expect(ok({ tipo: "3", sott: true })).toBe(true);
    expect(ok({ tipo: "3", sott: true }, conPsAff({ "3": { alpi: false } }))).toBe(false);
    expect(ok({ tipo: "3" }, conPsAff({ "3": { alpi: false } }))).toBe(true);
    expect(ok({ tipo: "3" }, conPsAff({ "3": { ord: false } }))).toBe(false);
    expect(ok({ tipo: "3", est: true })).toBe(false);
  });
});

describe("chi fa il turno PS in altro ospedale: vale come sempre", () => {
  it("punti invariati (ALPI 0), notte e riposo invariati", () => {
    expect(vt("3", false)).toBe(2);
    expect(vt("3", true)).toBe(0);
    const T: TurniMese = { 3: { 10: { t: [{ tipo: "3", man: true, est: true }] } } };
    const c = makeCtx(2026, 9, 31, [MDC, MPS, MR], T);
    expect(c.cnt(3)).toBe(2);
    expect(c.cntN(3)).toBe(1);
    expect(c.canR(MR, 11, "M")).toBe(false);                         // riposo dopo la notte
  });
  it("il segno resta nelle copie e nella sigla (asterisco)", () => {
    const T: TurniMese = { 3: { 10: { t: [{ tipo: "3", man: true, est: true }] } } };
    expect(cloneTDeep(T)[3][10].t[0].est).toBe(true);
    expect(etichettaTurno({ tipo: "3", est: true }, [])).toBe("3*");
    expect(etichettaTurno({ tipo: "3" }, [])).toBe("3");
    expect(etichettaTurno({ tipo: "M", est: true }, [])).toBe("M");
  });
  it("Excel: 3* (sottolineato se ALPI), senza legenda", () => {
    const T: TurniMese = { 3: { 10: { t: [{ tipo: "3", man: true, est: true, sott: true }] }, 12: { t: [{ tipo: "1", man: true, est: true }] } } };
    const ws = costruisciWorkbook(2026, 9, 31, [MR], T).getWorksheet("Foglio1")!;
    const v10 = ws.getCell(9, 11).value as any;
    expect(v10.richText.map((r: any) => r.text).join("")).toBe("3*");
    expect(v10.richText[0].font.underline).toBe(true);
    expect(ws.getCell(9, 13).value).toBe("1*");
    let legenda = false;
    ws.eachRow(r => r.eachCell(c => { if (typeof c.value === "string" && c.value.includes("altro ospedale")) legenda = true; }));
    expect(legenda).toBe(false);
  });
});

describe("salvataggi e generazione", () => {
  it("regole senza tabella (salvataggi vecchi) → tutti validi", () => {
    const { psAff: _p, ...vecchie } = dft();
    expect(mergeRegole(vecchie).psAff).toEqual(dft().psAff);
    expect(mergeRegole({ ...dft(), psAff: { "3": { alpi: "no" } } } as any).psAff["3"].alpi).toBe(true);
  });
  it("generazione: l'MDC non fa le notti coperte solo da un 3 ALPI se la spunta è tolta, né da un 3 in altro ospedale", () => {
    const medici: Medico[] = [
      { id: 1, nome: "D. UNO", codice: "1", stato: "MR", obiettivo: 25, ambulatorio: false },
      { id: 2, nome: "D. DUE", codice: "2", stato: "MR", obiettivo: 25, ambulatorio: false },
      { id: 3, nome: "D. TRE", codice: "3", stato: "MR", obiettivo: 25, ambulatorio: false },
      { id: 4, nome: "D. QUATTRO", codice: "4", stato: "MR", obiettivo: 25, ambulatorio: false },
      { id: 5, nome: "D. CINQUE", codice: "5", stato: "MR", obiettivo: 25, ambulatorio: false },
      { id: 6, nome: "D. SEI", codice: "6", stato: "MR", obiettivo: 25, ambulatorio: false },
      { id: 7, nome: "D. MDC", codice: "7", stato: "MDC", obiettivo: 21, ambulatorio: false },
      { id: 8, nome: "D. MPS", codice: "8", stato: "MPS", obiettivo: 0, ambulatorio: false },
    ];
    const nd = dimOf(2026, 9);
    const ex: TurniMese = { 8: {} };
    const tipi: Record<number, Turno> = {};
    for (let g = 2; g <= nd; g += 3) tipi[g] = g % 2 ? { tipo: "3", sott: true } : { tipo: "3", est: true };
    tipi[5] = { tipo: "3" };                                          // una sola notte con 3 valido
    for (const g in tipi) ex[8][g] = { t: [{ ...tipi[+g], man: true }] };
    setRegole(conPsAff({ "3": { alpi: false } }));
    const r = generaMigliorTentativo(2026, 9, nd, medici, ex, 3000);
    for (let g = 1; g <= nd; g++) {
      const nMdc = (r.turni[7]?.[g]?.t || []).some(s => s.tipo === "N");
      if (!nMdc) continue;
      const altri = medici.filter(m => m.id !== 7).some(m => (r.turni[m.id]?.[g]?.t || []).some(s =>
        s.tipo === "N" || (s.tipo === "3" && !s.est && !s.sott)));
      expect(altri, `MDC di notte il ${g} senza compagno valido`).toBe(true);
    }
  });
});

// ── v0.3.46: PS in altro ospedale che occupa la giornata ─────────────────────
describe("PS 1*/2* in altro ospedale: giornata occupata", () => {
  const MR2: Medico = { id: 4, nome: "X. MR2", codice: "4", stato: "MR", obiettivo: 25, ambulatorio: true, ambulatori: ["A"] };
  const casi: [string, Turno][] = [["1*", { tipo: "1", est: true }], ["2*", { tipo: "2", est: true }], ["2* ALPI", { tipo: "2", est: true, sott: true }]];
  it("default (spunta attiva): nessun turno di reparto o ambulatorio nello stesso giorno", () => {
    setRegole(dft());
    for (const [, s] of casi) {
      const c = makeCtx(2026, 9, 31, [MDC, MPS, MR2], { 4: { 13: { t: [{ ...s, man: true }] } } });
      for (const f of ["M", "P", "ASS", "N"]) expect(c.canR(MR2, 13, f)).toBe(false);
      c.add(4, 13, s.tipo === "1" ? "P" : "M");
      expect(c.gt(4, 13).length).toBe(1);                             // la guardia di add rifiuta
    }
  });
  it("spunta tolta: l'altra fascia torna assegnabile; un PS in sede la lascia sempre assegnabile", () => {
    setRegole(mergeRegole({ ...dft(), psEstGiornata: false }));
    const c = makeCtx(2026, 9, 31, [MDC, MPS, MR2], { 4: { 13: { t: [{ tipo: "1", est: true, man: true }] } } });
    expect(c.canR(MR2, 13, "P")).toBe(true);
    setRegole(dft());
    const c2 = makeCtx(2026, 9, 31, [MDC, MPS, MR2], { 4: { 13: { t: [{ tipo: "1", man: true }] } } });
    expect(c2.canR(MR2, 13, "P")).toBe(true);
  });
  it("salvataggi vecchi: spunta attiva", () => {
    const { psEstGiornata: _x, ...vecchie } = dft();
    expect(mergeRegole(vecchie).psEstGiornata).toBe(true);
  });
  it("generazione + completa: mai turni automatici nei giorni di 1*/2*", () => {
    const medici: Medico[] = [1, 2, 3, 4, 5, 6].map(i => ({ id: i, nome: "D" + i, codice: "" + i, stato: "MR", obiettivo: 27, ambulatorio: true, ambulatori: ["A"] } as Medico));
    medici.push({ id: 7, nome: "MDC", codice: "7", stato: "MDC", obiettivo: 21, ambulatorio: false });
    const ex: TurniMese = {};
    for (const [id, g, tipo] of [[1, 6, "1"], [1, 13, "2"], [2, 6, "2"], [3, 20, "1"], [4, 27, "1"], [5, 8, "2"]] as const)
      ((ex[id] ||= {})[g] = { t: [{ tipo, est: true, man: true }] });
    setRegole(dft());
    const r = generaMigliorTentativo(2026, 9, 31, medici, ex, 2500);
    const T = completaObiettivi(2026, 9, 31, medici, r.turni).turni;
    for (const id in ex) for (const g in ex[id]) {
      const auto = (T[id]?.[g]?.t || []).filter(s => !s.man);
      expect(auto, `medico ${id} giorno ${g}`).toEqual([]);
    }
  });
});
