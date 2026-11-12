import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { makeCtx } from "../ctx";
import { misuraTabellone, nottiFraMesi } from "../genera";
import { calcolaStoricoEquita, setStoricoEquita, EQ_MESI } from "../storico";

// ── v0.3.58: equità fra mesi di notti e weekend liberi ────────────────────────
const med = (id:number, stato:Medico["stato"]="MR"): Medico => ({ id, nome:`X. M${id}`, codice:String(id), stato, obiettivo:25, ambulatorio:false });
const cella = (tipo:string, man=false, sott=false) => ({ t:[{ tipo, sott, man }] });
beforeEach(()=>{ setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT))); ENG.PREV = null; ENG.STORICO_FEST = null; ENG.STORICO_EQ = null; ENG.STORICO_SF = null; setSalt(0); setAmbRotStart(0); });
afterEach(()=>{ ENG.STORICO_EQ = null; });

describe("storico di notti e weekend liberi", () => {
  // ottobre 2026: weekend 3-4, 10-11, 17-18, 24-25 (sabato 31 senza domenica nel mese)
  const ottobre: TurniMese = {
    1: { 3:cella("M"), 5:cella("N"), 12:cella("N"), 20:cella("3",true,true) },   // 3 notti (PS sottolineato compreso), 3 weekend liberi
    2: { 7:cella("N"), 17:cella("L",true), 18:cella("L",true) },                  // 1 notte, 4 weekend liberi (le ferie contano)
    3: { 6:cella("L",true), 7:cella("L",true) },                                  // assente tutto il mese
    4: { 11:cella("P") },                                                         // MDC: 3 weekend liberi
    5: { 6:cella("M") },                                                          // MDC: 4 weekend liberi
  };
  const medici = [med(1), med(2), med(3), med(4,"MDC"), med(5,"MDC"), med(6,"MPS")];
  it("scostamento dalla media dei colleghi presenti; chi non ha lavorato non recupera", () => {
    const h = calcolaStoricoEquita({ "2026-10": ottobre }, 2026, 10, medici, 3)!;
    expect(h.notti[1]).toBe(1);                       // 3 contro una media di 2
    expect(h.notti[2]).toBe(-1);
    expect(h.notti[3]).toBe(0);                       // assente: nessuno scostamento
    expect(h.notti[4]).toBeUndefined();               // le notti ruotano solo fra gli MR
    expect(h.wk[1]).toBe(-0.5);                       // 3 contro una media di 3,5
    expect(h.wk[2]).toBe(0.5);
    expect(h.wk[3]).toBe(0);
    expect(h.wk[4]).toBe(-0.5);                       // decreto Calabria fra decreto Calabria
    expect(h.wk[5]).toBe(0.5);
    expect(h.wk[6]).toBeUndefined();
  });
  it("più mesi si sommano; i mesi non salvati si saltano", () => {
    const settembre: TurniMese = { 1:{ 1:cella("N") }, 2:{ 2:cella("M") }, 3:{ 3:cella("N") } };   // medie: notti 2/3
    const h = calcolaStoricoEquita({ "2026-10": ottobre, "2026-09": settembre }, 2026, 10, medici, 3)!;
    expect(h.notti[1]).toBeCloseTo(1 + 1/3);
    expect(h.notti[2]).toBeCloseTo(-1 - 2/3);
    expect(h.notti[3]).toBeCloseTo(1/3);
    expect(calcolaStoricoEquita({ "2026-10": ottobre, "2026-09": settembre }, 2026, 10, medici, 1)!.notti[1]).toBe(1);
  });
  it("spenta (0 mesi) o senza mesi salvati: nessuno storico", () => {
    expect(calcolaStoricoEquita({ "2026-10": ottobre }, 2026, 10, medici, 0)).toBeNull();
    expect(calcolaStoricoEquita({}, 2026, 10, medici, 3)).toBeNull();
    setStoricoEquita({ "2026-10": ottobre }, 2026, 10, medici, 0);
    expect(ENG.STORICO_EQ).toBeNull();
  });
  it("memorie separate: notti e weekend liberi si accendono e si spengono da soli", () => {
    const soloNotti = calcolaStoricoEquita({ "2026-10": ottobre }, 2026, 10, medici, 3, 0)!;
    expect(soloNotti.notti[1]).toBe(1);
    expect(soloNotti.wk[1]).toBe(0);
    const soloWk = calcolaStoricoEquita({ "2026-10": ottobre }, 2026, 10, medici, 0, 3)!;
    expect(soloWk.notti[1]).toBe(0);
    expect(soloWk.wk[1]).toBe(-0.5);
    expect(calcolaStoricoEquita({ "2026-10": ottobre }, 2026, 10, medici, 0, 0)).toBeNull();
    // le regole: default 3, si salvano e si sanificano
    expect(mergeRegole({}).equitaNottiMesi).toBe(3);
    expect(mergeRegole({}).equitaWeekendMesi).toBe(3);
    expect(mergeRegole({ equitaNottiMesi: 0, equitaWeekendMesi: 6 } as any).equitaNottiMesi).toBe(0);
    expect(mergeRegole({ equitaNottiMesi: 0, equitaWeekendMesi: 6 } as any).equitaWeekendMesi).toBe(6);
    expect(mergeRegole({ equitaNottiMesi: 99 } as any).equitaNottiMesi).toBe(3);
  });
});

describe("equità fra mesi nel punteggio", () => {
  const medici = [med(1), med(2)];
  const m = (T:TurniMese) => misuraTabellone(2026, 10, 30, medici, T);
  // novembre 2026: tre notti di martedì da dividere fra due MR
  const notti = (a:number[], b:number[]): TurniMese => ({
    1: Object.fromEntries(a.map(g=>[g, cella("N")])), 2: Object.fromEntries(b.map(g=>[g, cella("N")])) });
  it("la notte in più va a chi nei mesi scorsi ne ha fatte meno", () => {
    const dueAUno = notti([3,17],[10]), dueADue = notti([10],[3,17]);
    expect(m(dueAUno).soft).toBeCloseTo(m(dueADue).soft);        // senza storico: indifferente
    ENG.STORICO_EQ = { notti:{ 1:1, 2:-1 }, wk:{} };             // il medico 1 ne ha fatta una in più
    expect(m(dueADue).soft).toBeLessThan(m(dueAUno).soft);
    expect(m(dueADue).s).toBe(m(dueAUno).s);
  });
  it("la differenza nel mese non aumenta, nemmeno con uno storico molto sbilanciato", () => {
    ENG.STORICO_EQ = { notti:{ 1:20, 2:-20 }, wk:{} };
    expect(m(notti([10],[3,17])).soft).toBeLessThan(m(notti([],[3,10,17])).soft);
    // una notte oltre la forchetta del mese non fa guadagnare nulla dallo storico
    const c = makeCtx(2026, 10, 30, medici, notti([],[3,10,17]));
    const c2 = makeCtx(2026, 10, 30, medici, notti([10],[3,17]));
    expect(nottiFraMesi(c)).toBeCloseTo(nottiFraMesi(c2));
    expect(nottiFraMesi(c2)).toBeCloseTo(-EQ_MESI.max);          // 1·(+0,4) + 2·(−0,4)
  });
  it("il weekend libero va a chi nei mesi scorsi ne ha avuti meno", () => {
    // sabato 7 novembre: lavora l'uno o l'altro, il resto è identico
    const lavoraUno: TurniMese = { 1:{ 7:cella("M") }, 2:{} }, lavoraDue: TurniMese = { 1:{}, 2:{ 7:cella("M") } };
    expect(m(lavoraUno).soft).toBeCloseTo(m(lavoraDue).soft);
    ENG.STORICO_EQ = { notti:{}, wk:{ 1:2, 2:-2 } };             // il medico 1 ne ha avuti di più
    expect(m(lavoraUno).soft).toBeLessThan(m(lavoraDue).soft);   // meglio che il weekend libero vada al 2
    expect(m(lavoraUno).s).toBe(m(lavoraDue).s);
  });
});
