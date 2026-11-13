import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { Medico, TurniMese } from "../types";
import { setRegole, getRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { makeCtx } from "../ctx";
import { generaMigliorTentativo, completaObiettivi, scartoNotti, misuraTabellone } from "../genera";
import { equilibra } from "../equilibra";
import { calcolaStoricoEquita, calcolaStoricoFestivi } from "../storico";
import { violazioniIndip } from "../../../harness/validatori";

// ── v0.3.59: medico esentato dalle notti (casella nella scheda) ───────────────
const anno = 2026, mese = 10, nd = 30;                       // novembre 2026
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const med = (id:number, stato:Medico["stato"]="MR", noNotti=false): Medico =>
  ({ id, nome:`X. M${id}`, codice:String(id), stato, obiettivo:25, ambulatorio:false, ...(noNotti ? { noNotti:true } : {}) });
const cella = (tipo:string, man=false) => ({ t:[{ tipo, sott:false, man }] });
const nottiAuto = (T:TurniMese, id:number) => { let n=0; for(const g in T[id]||{}) for(const s of T[id][g].t) if(!s.man && (s.tipo==="N"||s.tipo==="3")) n++; return n; };

beforeEach(()=>{ setRegole(dft()); ENG.PREV = null; ENG.DEADLINE = 0; ENG.STORICO_FEST = null; ENG.STORICO_EQ = null; ENG.STORICO_SF = null; setSalt(0); setAmbRotStart(0); });
afterEach(()=>{ setRegole(dft()); ENG.STORICO_EQ = null; });

describe("esentato dalle notti: regole del motore", () => {
  it("nessuna notte automatica; i turni di giorno e le notti a mano restano", () => {
    const es = med(1,"MR",true), altro = med(2);
    const T: TurniMese = { 1:{ 20:cella("N",true) } };       // una notte messa a mano
    const c = makeCtx(anno, mese, nd, [es, altro], T);
    expect(c.canR(es, 3, "N")).toBe(false);
    expect(c.canR(altro, 3, "N")).toBe(true);
    c.add(1, 3, "N");
    expect(c.haN(1, 3)).toBe(false);                          // la guardia di add() la rifiuta
    expect(c.canR(es, 3, "M")).toBe(true);
    c.add(1, 3, "M");
    expect(c.haM(1, 3)).toBe(true);
    expect(c.haN(1, 20)).toBe(true);                          // la notte manuale non si tocca
  });
  it("vale solo per MR e decreto Calabria; la notte che può fare solo lui non è «copribile»", () => {
    expect(makeCtx(anno, mese, nd, [med(1,"MDC",true), med(2)], {}).esentiNotti.has(1)).toBe(true);
    expect(makeCtx(anno, mese, nd, [{ ...med(1,"ML"), noNotti:true }], {}).esentiNotti.size).toBe(0);
    expect(makeCtx(anno, mese, nd, [med(1,"MR",true)], {}).needEff(3,"N")).toBe(0);
    expect(makeCtx(anno, mese, nd, [med(1,"MR",true), med(2)], {}).needEff(3,"N")).toBe(1);
  });
  it("l'equità delle notti si calcola fra chi le fa", () => {
    const T: TurniMese = { 1:{}, 2:{ 3:cella("N"), 10:cella("N") }, 3:{ 5:cella("N"), 12:cella("N") } };
    const conEsente = makeCtx(anno, mese, nd, [med(1,"MR",true), med(2), med(3)], T);
    expect(conEsente.mrNotti.map(m=>m.id)).toEqual([2,3]);
    expect(scartoNotti(conEsente)).toBe(0);                   // 2 e 2: pari
    expect(scartoNotti(makeCtx(anno, mese, nd, [med(1), med(2), med(3)], T))).toBeGreaterThan(0);   // senza esenzione lo 0 pesa
  });
});

describe("esentato dalle notti: nessun recupero fra mesi", () => {
  // ottobre 2026: il medico 3 lavora ma non fa notti (era esentato)
  const ottobre: TurniMese = {
    1: { 5:cella("N"), 12:cella("N"), 17:cella("N") },        // sabato 17: notte di sabato
    2: { 7:cella("N") },
    3: { 6:cella("M"), 8:cella("P"), 13:cella("M") },
  };
  it("chi oggi è esentato non entra nella memoria delle notti", () => {
    const h = calcolaStoricoEquita({ "2026-10": ottobre }, 2026, 10, [med(1), med(2), med(3,"MR",true)], 3)!;
    expect(h.notti[1]).toBe(1);                               // 3 contro una media di 2 (fra chi le fa)
    expect(h.notti[2]).toBe(-1);
    expect(h.notti[3]).toBeUndefined();
  });
  it("finita l'esenzione, il mese senza notti non conta: nessun debito", () => {
    const medici = [med(1), med(2), med(3)];                  // la spunta è stata tolta
    const h = calcolaStoricoEquita({ "2026-10": ottobre }, 2026, 10, medici, 3)!;
    expect(h.notti[3]).toBe(0);                               // non −2: non deve recuperare
    expect(h.notti[1]).toBe(1);                               // la media resta quella di chi le ha fatte
    // rotazione dei festivi: per le notti di sabato prende la media di chi le ha fatte
    const f = calcolaStoricoFestivi({ "2026-10": ottobre }, 2026, 10, medici, 3)!;
    expect(f[1][4]).toBe(1);
    expect(f[2][4]).toBe(0);
    expect(f[3][4]).toBe(0.5);                                // (1 + 0) / 2, non 0
    // …e nel punteggio la notte in più non va a lui per forza
    ENG.STORICO_EQ = h;
    const m = (T:TurniMese) => misuraTabellone(anno, mese, nd, medici, T);
    const aTre: TurniMese = { 1:{ 3:cella("N") }, 2:{ 10:cella("N") }, 3:{ 17:cella("N"), 24:cella("N") } };
    const aDue: TurniMese = { 1:{ 3:cella("N") }, 2:{ 10:cella("N"), 24:cella("N") }, 3:{ 17:cella("N") } };
    expect(m(aDue).nottiStor).toBeLessThan(m(aTre).nottiStor);   // la notte in più va al 2, che ne ha fatte meno
  });
});

describe("esentato dalle notti: novembre reale (anonimizzato)", () => {
  it("generazione, Completa ed Equilibra: nessuna notte automatica agli esentati, nessuna violazione", () => {
    const sc = JSON.parse(fs.readFileSync("src/engine/__tests__/fixtures/novembre2026_manuali.json", "utf8"));
    const esenti = [1, 8];                                                   // un MR e un decreto Calabria
    const medici: Medico[] = sc.medici.map((m:Medico)=> esenti.includes(m.id) ? { ...m, noNotti:true } : m);
    const gen = generaMigliorTentativo(anno, mese, nd, medici, sc.ex, 3000);
    const fin = completaObiettivi(anno, mese, nd, medici, gen.turni).turni;
    const eq = equilibra(anno, mese, nd, medici, fin, { ms: 1500 }).turni;
    for(const T of [gen.turni, fin, eq]){
      for(const id of esenti) expect(nottiAuto(T, id), `medico ${id}`).toBe(0);
      expect(violazioniIndip({ anno, mese, medici, ex:sc.ex, regole:getRegole(), prevT:null }, T)).toEqual([]);
    }
    // gli altri MR le notti le fanno
    const c = makeCtx(anno, mese, nd, medici, fin);
    expect(c.mrNotti.every(m=>c.cntN(m.id)>0)).toBe(true);
  });
});
