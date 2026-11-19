import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { Medico, TurniMese } from "../types";
import { setRegole, getRegole, REGOLE_DEFAULT, tettoNotti } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { makeCtx } from "../ctx";
import { generaMigliorTentativo, completaObiettivi } from "../genera";
import { equilibra } from "../equilibra";
import { diagnosiStatica } from "../diagnosi";
import { violazioniIndip } from "../../../harness/validatori";

// ── v0.3.67: massimo di notti al mese per medico (scheda medico) ───────────────
const anno = 2026, mese = 10, nd = 30;                       // novembre 2026
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const med = (id:number, maxNotti?:number, stato:Medico["stato"]="MR"): Medico =>
  ({ id, nome:`X. M${id}`, codice:String(id), stato, obiettivo:25, ambulatorio:false, ...(maxNotti!==undefined ? { maxNotti } : {}) });
const cella = (tipo:string, man=false) => ({ t:[{ tipo, sott:false, man }] });
const notti = (T:TurniMese, id:number) => { let n=0; for(const g in T[id]||{}) for(const s of T[id][g].t) if(s.tipo==="N"||s.tipo==="3") n++; return n; };

beforeEach(()=>{ setRegole(dft()); ENG.PREV = null; ENG.DEADLINE = 0; ENG.STORICO_FEST = null; ENG.STORICO_EQ = null; setSalt(0); setAmbRotStart(0); });
afterEach(()=>{ setRegole(dft()); ENG.STORICO_EQ = null; });

describe("massimo di notti del medico: regole del motore", () => {
  it("vale quello della scheda se più basso; più alto, vuoto o non valido = quello delle Regole", () => {
    expect(getRegole().maxNotti).toBe(5);
    expect(tettoNotti(med(1))).toBe(5);
    expect(tettoNotti(med(1, 3))).toBe(3);
    expect(tettoNotti(med(1, 7))).toBe(5);                    // le Regole restano il tetto per tutti
    expect(tettoNotti(med(1, 5))).toBe(5);
    expect(tettoNotti(med(1, 0))).toBe(0);
    for (const x of [-1, 2.5, NaN, "3" as any]) expect(tettoNotti({ maxNotti:x })).toBe(5);
  });
  it("contano anche le notti a mano: al tetto del medico niente notte automatica, gli altri col tetto delle Regole", () => {
    const T: TurniMese = { 1:{ 4:cella("N",true), 10:cella("N",true) }, 2:{ 4:cella("N",true), 10:cella("N",true) } };
    const c = makeCtx(anno, mese, nd, [med(1, 2), med(2)], T);
    expect(c.maxNottiDi(1)).toBe(2);
    expect(c.maxNottiDi(2)).toBe(5);
    expect(c.canR(med(1, 2), 20, "N")).toBe(false);          // 2 notti su 2
    expect(c.canR(med(2), 20, "N")).toBe(true);              // 2 notti su 5
  });
  it("un massimo più alto delle Regole non permette notti oltre il limite generale", () => {
    const T: TurniMese = { 1:{}, 2:{} };
    for (const g of [2, 6, 10, 14, 18]) { T[1][g] = cella("N",true); T[2][g] = cella("N",true); }   // 5 notti a testa
    const c = makeCtx(anno, mese, nd, [med(1, 7), med(2)], T);
    expect(c.maxNottiDi(1)).toBe(5);
    expect(c.canR(med(1, 7), 24, "N")).toBe(false);          // 5 su 5: il 7 della scheda vale come le Regole
    expect(c.canR(med(2), 24, "N")).toBe(false);             // 5 su 5 (Regole)
  });
});

describe("massimo di notti del medico: novembre reale (anonimizzato)", () => {
  const sc = JSON.parse(fs.readFileSync("src/engine/__tests__/fixtures/novembre2026_manuali.json", "utf8"));
  const pipeline = (medici:Medico[]) => {
    const gen = generaMigliorTentativo(anno, mese, nd, medici, sc.ex, 3000);
    const fin = completaObiettivi(anno, mese, nd, medici, gen.turni).turni;
    const eq = equilibra(anno, mese, nd, medici, fin, { ms: 1500 }).turni;
    return [gen.turni, fin, eq];
  };
  it("più basso: generazione, Completa ed Equilibra non lo superano; nessuna violazione", () => {
    const medici: Medico[] = sc.medici.map((m:Medico)=> m.id===1 ? { ...m, maxNotti:2 } : m.id===8 ? { ...m, maxNotti:1 } : m);
    for (const T of pipeline(medici)) {
      expect(notti(T, 1)).toBeLessThanOrEqual(Math.max(2, notti(sc.ex, 1)));
      expect(notti(T, 8)).toBeLessThanOrEqual(Math.max(1, notti(sc.ex, 8)));
      expect(violazioniIndip({ anno, mese, medici, ex:sc.ex, regole:getRegole(), prevT:null }, T)).toEqual([]);
    }
  });
  it("più alto delle Regole: con le Regole a 2 notti, nemmeno i medici col massimo 6 ne fanno più di 2", () => {
    setRegole({ ...dft(), maxNotti:2 });
    const alti = [2, 5];
    const medici: Medico[] = sc.medici.map((m:Medico)=> alti.includes(m.id) ? { ...m, maxNotti:6 } : m);
    for (const T of pipeline(medici)) {
      for (const m of medici) if (m.stato==="MR"||m.stato==="MDC") {
        expect(notti(T, m.id), `medico ${m.id}`).toBeLessThanOrEqual(Math.max(2, notti(sc.ex, m.id)));
      }
      expect(violazioniIndip({ anno, mese, medici, ex:sc.ex, regole:getRegole(), prevT:null }, T)).toEqual([]);
    }
  });
});

describe("massimo di notti del medico: diagnosi", () => {
  it("la capacità di notti del mese usa i massimi dei medici", () => {
    const medici = [med(1, 1), med(2, 1), med(3, 1)];       // 3 notti al massimo per 30 da coprire
    const d = diagnosiStatica(anno, mese, nd, medici, {});
    const n = d.mese.find(x=>x.tipo==="notti")!;
    expect(n.capacita).toBe(3);
    expect(n.motivo).toMatch(/M1 max 1 \(scheda medico: 1 al mese\)/);
    const conRegole = diagnosiStatica(anno, mese, nd, [med(1), med(2), med(3)], {}).mese.find(x=>x.tipo==="notti")!;
    expect(conRegole.capacita).toBe(15);
  });
});
