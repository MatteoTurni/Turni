import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { setSalt, setAmbRotStart, setPrevContext } from "../state";
import { makeCtx } from "../ctx";
import { vt, SPEC, LICENZE, isLicenza } from "../turni";
import { generaMigliorTentativo, completaObiettivi } from "../genera";
import { ASSENZE } from "../bilancio";
import { costruisciWorkbook } from "../../export/excel";

// ── ART.37 (v0.3.49): una licenza come L, ANA, 104, art.11 ───────────────────
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const MR = (id: number): Medico => ({ id, nome: `X. M${id}`, codice: "" + id, stato: "MR", obiettivo: 25, ambulatorio: false });
beforeEach(() => { setSalt(0); setAmbRotStart(0); setPrevContext(null, 2026, 10); setRegole(dft()); });
afterEach(() => { setRegole(dft()); });

describe("art37 vale come le altre licenze", () => {
  it("è nell'elenco unico delle licenze, nei codici di riposo e nelle assenze del bilancio", () => {
    expect(LICENZE).toContain("art37");
    expect(isLicenza("art37")).toBe(true);
    expect(SPEC).toContain("art37");
    expect(ASSENZE).toContain("art37");
  });
  it("1 punto verso l'obiettivo, come L", () => {
    expect(vt("art37")).toBe(vt("L"));
    expect(vt("art37")).toBe(1);
  });
  it("blocca ogni turno automatico quel giorno e la notte del giorno prima", () => {
    const m = MR(1);
    const c = makeCtx(2026, 10, 30, [m, MR(2)], { 1: { 10: { t: [{ tipo: "art37", man: true }] } } });
    for (const f of ["M", "P", "N", "ASS"]) expect(c.canR(m, 10, f)).toBe(false);
    expect(c.canN(1, 9)).toBe(false);                                 // come L/ANA: niente notte alla vigilia
    expect(c.cnt(1)).toBe(1);
    const cL = makeCtx(2026, 10, 30, [m, MR(2)], { 1: { 10: { t: [{ tipo: "L", man: true }] } } });
    expect(c.canN(1, 9)).toBe(cL.canN(1, 9));
  });
  it("generazione + completa: nessun turno nei giorni di art37 e obiettivo ridotto come con L", () => {
    const medici = [1, 2, 3, 4, 5, 6, 7].map(MR);
    const ex: TurniMese = { 1: {} };
    for (let g = 2; g <= 8; g++) ex[1][g] = { t: [{ tipo: "art37", man: true }] };
    const r = generaMigliorTentativo(2026, 10, 30, medici, ex, 2000);
    const T = completaObiettivi(2026, 10, 30, medici, r.turni).turni;
    for (let g = 2; g <= 8; g++) expect((T[1][g].t).map(s => s.tipo)).toEqual(["art37"]);
    expect((T[1][1]?.t || []).some(s => s.tipo === "N")).toBe(false);  // vigilia: niente notte
    const c = makeCtx(2026, 10, 30, medici, T);
    expect(c.cnt(1)).toBeLessThanOrEqual(25);
  });
  it("Excel: stampa art37", () => {
    const T: TurniMese = { 1: { 4: { t: [{ tipo: "art37", man: true }] } } };
    const ws = costruisciWorkbook(2026, 10, 30, [MR(1)], T).getWorksheet("Foglio1")!;
    expect(ws.getCell(9, 5).value).toBe("art37");
  });
});
