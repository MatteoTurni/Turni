import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { makeCtx } from "../ctx";
import { misuraTabellone, cmpMis } from "../genera";

// ── v0.3.54: a parità di weekend liberi mancanti, nessuno resta a zero ────────
// Novembre 2026: weekend 7-8, 14-15, 21-22, 28-29; obiettivo 2 weekend liberi.
// Stessi turni (le mattine di sabato 7/14/21/28 e domenica 8/15), divisi in due
// modi: tutti i weekend a A (A a zero, B a 2) oppure 3 e 3 (uno libero a testa).
const anno = 2026, mese = 10, nd = 30;
const med = (id:number): Medico => ({ id, nome:`X. M${id}`, codice:String(id), stato:"MR", obiettivo:25, ambulatorio:false });
const T = (a:number[], b:number[]): TurniMese => {
  const t: TurniMese = { 1:{}, 2:{} };
  for(const g of a) t[1][g] = { t:[{ tipo:"M", sott:false, man:false }] };
  for(const g of b) t[2][g] = { t:[{ tipo:"M", sott:false, man:false }] };
  return t;
};
beforeEach(()=>{ setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT))); ENG.PREV = null; setSalt(0); setAmbRotStart(0); });

describe("weekend liberi: a parità di mancanti, meglio nessuno a zero", () => {
  it("dividere i weekend mancanti batte concentrarli su un medico", () => {
    const medici = [med(1), med(2)];
    const conc = T([7,14,21,28], [8,15]), divisi = T([7,14,21], [8,15,28]);
    const cc = makeCtx(anno, mese, nd, medici, conc), cd = makeCtx(anno, mese, nd, medici, divisi);
    expect([cc.cntWkLiberi(1), cc.cntWkLiberi(2)]).toEqual([0, 2]);
    expect([cd.cntWkLiberi(1), cd.cntWkLiberi(2)]).toEqual([1, 1]);
    const mc = misuraTabellone(anno, mese, nd, medici, conc), md = misuraTabellone(anno, mese, nd, medici, divisi);
    expect(mc.buchi).toBe(md.buchi);
    expect(mc.wkDef).toBe(2); expect(md.wkDef).toBe(2);
    expect(mc.wkZero).toBe(1); expect(md.wkZero).toBe(0);
    expect(cmpMis(md, mc)).toBeLessThan(0);                 // prima vinceva il tabellone concentrato
  });
});
