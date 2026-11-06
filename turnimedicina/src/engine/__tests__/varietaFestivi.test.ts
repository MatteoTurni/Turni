import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { makeCtx } from "../ctx";
import { misuraTabellone, varietaFestivi } from "../genera";

// ── v0.3.55: varietà dei turni festivi ────────────────────────────────────────
// Novembre 2026: sabati 14 e 28, domeniche 15 e 29. Stesse quattro notti, stesso
// carico weekend (4 a testa): divise "per tipo" (A: due notti di sabato, B: due
// notti di domenica) oppure "miste" (una notte di sabato e una di domenica a testa).
const anno = 2026, mese = 10, nd = 30;
const med = (id:number, stato:Medico["stato"]="MR"): Medico => ({ id, nome:`X. M${id}`, codice:String(id), stato, obiettivo:25, ambulatorio:false });
const tab = (righe: Record<number, [number,string,boolean?][]>): TurniMese => {
  const T: TurniMese = {};
  for(const id in righe) for(const [g,tipo,sott] of righe[id]) ((T[id] ||= {})[g] ||= { t:[] }).t.push({ tipo, sott:!!sott, man:false });
  return T;
};
beforeEach(()=>{ setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT))); ENG.PREV = null; setSalt(0); setAmbRotStart(0); });

describe("varietà dei turni festivi", () => {
  it("a parità di carico weekend, turni di tipo diverso battono turni ripetuti", () => {
    const medici = [med(1), med(2)];
    const ripetuti = tab({ 1:[[14,"N"],[28,"N"]], 2:[[15,"N"],[29,"N"]] });
    const misti    = tab({ 1:[[14,"N"],[29,"N"]], 2:[[15,"N"],[28,"N"]] });
    const cR = makeCtx(anno, mese, nd, medici, ripetuti), cM = makeCtx(anno, mese, nd, medici, misti);
    expect([cR.cntWk(1), cR.cntWk(2)]).toEqual([cM.cntWk(1), cM.cntWk(2)]);   // stesso carico weekend
    expect(varietaFestivi(cR)).toBe(2);
    expect(varietaFestivi(cM)).toBe(0);
    const mR = misuraTabellone(anno, mese, nd, medici, ripetuti), mM = misuraTabellone(anno, mese, nd, medici, misti);
    expect(mM.s).toBe(mR.s);
    expect(mM.soft).toBeLessThan(mR.soft);
  });
  it("cosa conta: PS e sottolineati sì, la mattina del sabato no, la notte prima di un festivo come una notte di sabato", () => {
    const medici = [med(1)];
    // sabato 14: mattina (non festiva); sabato 21: PS notte sottolineato (3) = notte di sabato;
    // sabato 28: notte → seconda notte di sabato = una coppia
    expect(varietaFestivi(makeCtx(anno, mese, nd, medici, tab({ 1:[[14,"M"],[21,"3",true],[28,"N"]] })))).toBe(1);
    // due mattine di sabato: nessuna coppia (non sono festive)
    expect(varietaFestivi(makeCtx(anno, mese, nd, medici, tab({ 1:[[7,"M"],[14,"M"]] })))).toBe(0);
    // dicembre 2026: martedì 8 è festivo, lunedì 7 è prefestivo → la notte del 7 vale come notte di sabato
    expect(varietaFestivi(makeCtx(2026, 11, 31, medici, tab({ 1:[[5,"N"],[7,"N"]] })))).toBe(1);
  });
});
