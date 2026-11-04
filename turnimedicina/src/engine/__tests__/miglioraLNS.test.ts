import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { Medico, TurniMese } from "../types";
import { dimOf } from "../date";
import { setRegole, getRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart, conDeadline } from "../state";
import { makeCtx } from "../ctx";
import { generaCoperturaMinima, cercaMigliorTentativo, miglioraLNS, misuraTabellone, cmpMis, mdcViolCount, completaObiettivi } from "../genera";
import { violazioniIndip } from "../../../harness/validatori";

// ── v0.3.53: miglioramento «svuota e ricostruisci» (LNS) ─────────────────────
const anno = 2026, mese = 2, nd = dimOf(anno, mese);          // marzo 2026
const med = (id:number, stato:Medico["stato"], obiettivo:number): Medico =>
  ({ id, nome:`X. M${id}`, codice:String(id), stato, obiettivo, ambulatorio:false });
const medici = (): Medico[] => [
  med(1,"MR",24), med(2,"MR",24), med(3,"MR",22), med(4,"MR",25), med(5,"MR",23),
  med(6,"MR",24), med(7,"MDC",19), med(8,"ML",24), med(9,"MPS",0),
];
// manuali dell'utente: ferie, una notte, una mattina sottolineata (ALPI), il PS
const manuali = (): TurniMese => {
  const T: TurniMese = {};
  const put = (id:number, g:number, tipo:string, sott=false) => { (T[id] ||= {})[g] = { t:[{ tipo, sott, man:true }] }; };
  for(let g=9; g<=15; g++) put(1, g, "L");
  for(let g=20; g<=22; g++) put(8, g, "L");
  put(3, 12, "N"); put(5, 18, "M", true); put(9, 6, "3"); put(9, 14, "1");
  return T;
};
const chiave = (T:TurniMese, id:number, g:number) =>
  (T[id]?.[g]?.t || []).map(s=>s.tipo+(s.man?"!":"")+(s.sott?"_":"")).sort().join(",");

beforeEach(()=>{ setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT))); ENG.PREV = null; ENG.DEADLINE = 0; setSalt(0); setAmbRotStart(0); });
afterEach(()=>{ ENG.LNS_FRAZ = 0.45; setSalt(0); });

describe("miglioraLNS", () => {
  const ex = manuali(), M = medici();
  setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));
  setSalt(12345);
  const grezzo = generaCoperturaMinima(anno, mese, nd, M, ex).turni;   // un solo tentativo, senza rifinitura
  setSalt(0);

  it("migliora il tabellone e non lo peggiora mai", () => {
    const prima = misuraTabellone(anno, mese, nd, M, grezzo);
    const r = miglioraLNS(anno, mese, nd, M, grezzo, { fino: Date.now()+1500, seme: 7 });
    expect(r.mosse).toBeGreaterThan(0);
    expect(cmpMis(r.m, prima)).toBeLessThan(0);
    expect(cmpMis(misuraTabellone(anno, mese, nd, M, r.turni), r.m)).toBe(0);   // il risultato è quello misurato
  });

  it("regole, copertura e intoccabili", () => {
    const r = miglioraLNS(anno, mese, nd, M, grezzo, { fino: Date.now()+1500, seme: 11 });
    const c0 = makeCtx(anno, mese, nd, M, grezzo), c1 = makeCtx(anno, mese, nd, M, r.turni);
    // nessuna violazione delle regole (validatori indipendenti dal motore)
    expect(violazioniIndip({ anno, mese, medici:M, ex, regole:getRegole(), prevT:null }, r.turni)).toEqual([]);
    expect(mdcViolCount(nd, M, c1)).toBeLessThanOrEqual(mdcViolCount(nd, M, c0));
    for(let g=1; g<=nd; g++) for(const f of ["M","P","N"] as const){
      // ogni cella coperta almeno come prima (fino al fabbisogno)
      expect(c1.cf(g,f), `${g}${f}`).toBeGreaterThanOrEqual(Math.min(c0.needEff(g,f), c0.cf(g,f)));
    }
    for(const m of M) for(let g=1; g<=nd; g++){
      // manuali e sottolineati identici; i turni dell'ML non si toccano
      const man0 = (grezzo[m.id]?.[g]?.t || []).filter(s=>s.man || s.sott);
      const man1 = (r.turni[m.id]?.[g]?.t || []).filter(s=>s.man || s.sott);
      expect(JSON.stringify(man1), `${m.id}/${g}`).toBe(JSON.stringify(man0));
      if(m.stato==="ML" || m.stato==="MPS") expect(chiave(r.turni,m.id,g), `${m.id}/${g}`).toBe(chiave(grezzo,m.id,g));
    }
  });
});

describe("miglioraLNS sul novembre reale (anonimizzato, soli turni manuali)", () => {
  it("chi ha un weekend libero non scende a zero; weekend mancanti e obiettivi non peggiorano", () => {
    const sc = JSON.parse(fs.readFileSync("src/engine/__tests__/fixtures/novembre2026_manuali.json", "utf8"));
    const nd = 30;
    // tabellone di partenza: un solo tentativo, con i budget dei restart e un tetto di tempo
    const budget = { BT:ENG.BT, TRIES:ENG.TRIES, CN:ENG.CLUSTER_NODES, RN:ENG.REBAL_NODES };
    Object.assign(ENG, { BT:6, TRIES:3, CLUSTER_NODES:8000, REBAL_NODES:15000 });
    setSalt(777);
    const grezzo = conDeadline(Date.now()+3000, ()=>generaCoperturaMinima(2026, 10, nd, sc.medici, sc.ex).turni);
    setSalt(0);
    Object.assign(ENG, { BT:budget.BT, TRIES:budget.TRIES, CLUSTER_NODES:budget.CN, REBAL_NODES:budget.RN });
    const r = miglioraLNS(2026, 10, nd, sc.medici, grezzo, { fino: Date.now()+2000, seme: 5 });
    const c0 = makeCtx(2026, 10, nd, sc.medici, grezzo), c1 = makeCtx(2026, 10, nd, sc.medici, r.turni);
    for(const m of c0.att) if(c0.cntWkLiberi(m.id)>0) expect(c1.cntWkLiberi(m.id), m.nome).toBeGreaterThan(0);
    expect(r.m.wkDef).toBeLessThanOrEqual(misuraTabellone(2026, 10, nd, sc.medici, grezzo).wkDef);
    const mancanti = (T:TurniMese) => completaObiettivi(2026, 10, nd, sc.medici, T).rimasti.reduce((q,x)=>q+x.mancano, 0);
    expect(mancanti(r.turni)).toBeLessThanOrEqual(mancanti(grezzo));
    expect(violazioniIndip({ anno:2026, mese:10, medici:sc.medici, ex:sc.ex, regole:getRegole(), prevT:null }, r.turni)).toEqual([]);
  });
});

describe("cercaMigliorTentativo con il miglioramento LNS", () => {
  it("con LNS_FRAZ=0 i restart usano tutto il tempo, come prima", () => {
    ENG.LNS_FRAZ = 0;
    const r = cercaMigliorTentativo(anno, mese, nd, medici(), manuali(), 1500);
    expect(r.lns).toBeUndefined();
  });
  it("attivo: il tempo che resta migliora il tabellone migliore", () => {
    const r = cercaMigliorTentativo(anno, mese, nd, medici(), manuali(), 3000);
    expect(r.lns).toBeDefined();
    expect(r.lns!.passi).toBeGreaterThan(0);
  });
});
