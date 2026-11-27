import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { isFestivo, isFestivoDopo, setFestiviLocali, dimOf } from "../date";
import { makeCtx } from "../ctx";
import { pesoWeekend, riepilogoMedico } from "../bilancio";
import { festiviDelMese, calcolaStoricoFestivi } from "../storico";
import { misuraTabellone, varietaFestivi } from "../genera";

// ── v0.3.74: la notte dell'ultimo del mese è prefestiva se il 1° del mese dopo
// è festivo (31/12 prima di Capodanno, 30/4 prima del 1° maggio, 31/10 prima di
// Ognissanti). Prima il motore guardava solo dentro il mese e la contava come
// una notte feriale: peso 0, fuori dall'equità dei weekend e dalla rotazione.
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const med = (id:number, stato:Medico["stato"]="MR"): Medico => ({ id, nome:`X. M${id}`, codice:String(id), stato, obiettivo:25, ambulatorio:false });
const cella = (tipo:string, man=false) => ({ t:[{ tipo, sott:false, man }] });
const N = [{ tipo:"N", sott:false, man:false }];
const DIC = { anno:2026, mese:11, nd:31 };                 // 31/12/2026 è giovedì, 1/1/2027 venerdì

beforeEach(()=>{ setRegole(dft()); ENG.PREV = null; ENG.STORICO_FEST = null; ENG.STORICO_EQ = null; setSalt(0); setAmbRotStart(0); });
afterEach(()=>{ setRegole(dft()); ENG.STORICO_FEST = null; });

describe("il giorno dopo, anche a cavallo del mese", () => {
  it("fine mese prima di un festivo", () => {
    expect(isFestivoDopo(2026, 11, 31)).toBe(true);        // → Capodanno
    expect(isFestivoDopo(2026, 3, 30)).toBe(true);         // → 1° maggio
    expect(isFestivoDopo(2027, 3, 30)).toBe(true);
    expect(isFestivoDopo(2028, 9, 31)).toBe(true);         // → Ognissanti
    expect(isFestivoDopo(2026, 1, 28)).toBe(true);         // → domenica 1° marzo 2026
    expect(isFestivoDopo(2027, 0, 31)).toBe(false);        // → lunedì 1° febbraio
    expect(isFestivoDopo(2026, 10, 30)).toBe(false);       // → martedì 1° dicembre
  });
  it("dentro il mese è uguale a prima", () => {
    expect(isFestivoDopo(2026, 11, 30)).toBe(false);       // 31/12 non è festivo
    expect(isFestivoDopo(2026, 11, 7)).toBe(true);         // → Immacolata
    expect(isFestivoDopo(2026, 11, 24)).toBe(true);        // → Natale
  });
  it("anni bisestili: il 28 febbraio guarda il 29", () => {
    expect(isFestivoDopo(2032, 1, 28)).toBe(true);         // 29/2/2032 è domenica
    expect(isFestivoDopo(2032, 1, 29)).toBe(false);        // 1/3/2032 è lunedì
  });
  it("coincide col calendario vero per ogni giorno dal 2024 al 2036", () => {
    const vero = (y:number,m:number,d:number) => { const dt = new Date(y, m, d + 1); return isFestivo(dt.getFullYear(), dt.getMonth(), dt.getDate()); };
    let diversi = 0;
    for (let y = 2024; y <= 2036; y++) for (let m = 0; m < 12; m++) for (let d = 1; d <= dimOf(y, m); d++)
      if (isFestivoDopo(y, m, d) !== vero(y, m, d)) diversi++;
    expect(diversi).toBe(0);
  });
  it("vale anche per le feste locali del 1° del mese", () => {
    expect(isFestivoDopo(2026, 4, 31)).toBe(false);        // 1/6/2026 è lunedì
    setFestiviLocali(["06-01"]);
    expect(isFestivoDopo(2026, 4, 31)).toBe(true);
  });
});

describe("dicembre 2026: la notte del 31 vale come le altre notti prefestive", () => {
  const medici = [med(1), med(2)];
  it("notte festiva e peso 2 (solo la notte: mattina e pomeriggio restano feriali)", () => {
    const c = makeCtx(DIC.anno, DIC.mese, DIC.nd, medici, {});
    expect(c.isPreFest(31)).toBe(true);
    expect(c.isNotteFest(31)).toBe(true);
    expect(c.pesoSlot(31, "N")).toBe(2);
    expect(c.pesoSlot(31, "P")).toBe(0);
    expect(c.pesoSlot(31, "M")).toBe(0);
    // le altre notti non cambiano
    expect(c.isNotteFest(30)).toBe(false);
    expect(c.pesoSlot(30, "N")).toBe(0);
    expect(c.isPreFest(7)).toBe(true);                     // prima dell'Immacolata
    expect(c.pesoSlot(24, "N")).toBe(2);                   // vigilia di Natale
  });
  it("gli altri mesi di fine anno: novembre resta feriale, ottobre era già weekend", () => {
    const nov = makeCtx(2026, 10, 30, medici, {});
    expect(nov.isNotteFest(30)).toBe(false);
    expect(nov.pesoSlot(30, "N")).toBe(0);
    const ott = makeCtx(2026, 9, 31, medici, {});           // sabato 31 ottobre
    expect(ott.isNotteFest(31)).toBe(true);
    expect(ott.pesoSlot(31, "N")).toBe(2);
  });
  it("«Festivi lav.» e carico weekend del motore la contano 2", () => {
    expect(pesoWeekend(DIC.anno, DIC.mese, DIC.nd, 31, N)).toBe(2);
    expect(pesoWeekend(DIC.anno, DIC.mese, DIC.nd, 30, N)).toBe(0);
    expect(pesoWeekend(DIC.anno, DIC.mese, DIC.nd, 31, [{ tipo:"P", sott:false, man:false }])).toBe(0);
    const T: TurniMese = { 1:{ 31:cella("N") }, 2:{ 30:cella("N") } };
    expect(riepilogoMedico(T, 1, DIC.nd, DIC.anno, DIC.mese).wk).toBe(2);
    expect(riepilogoMedico(T, 2, DIC.nd, DIC.anno, DIC.mese).wk).toBe(0);
    const c = makeCtx(DIC.anno, DIC.mese, DIC.nd, medici, T);
    expect(c.cntWk(1)).toBe(2);
    expect(c.cntWk(2)).toBe(0);
  });
  it("rotazione fra mesi: a gennaio il 31 dicembre conta come notte prefestiva", () => {
    const T: TurniMese = { 1:{ 31:cella("N") }, 2:{ 30:cella("N") } };
    const { conti } = festiviDelMese(T, DIC.anno, DIC.mese, [1, 2]);
    expect(conti[1]).toEqual([0, 0, 0, 0, 1]);
    expect(conti[2]).toEqual([0, 0, 0, 0, 0]);
    const h = calcolaStoricoFestivi({ "2026-12": T }, 2027, 0, medici, 3)!;
    expect(h[1][4]).toBe(1);
    expect(h[2][4]).toBe(0);
  });
  it("nel punteggio la notte del 31 va a chi nei mesi scorsi ne ha fatte meno", () => {
    const aUno: TurniMese = { 1:{ 31:cella("N") }, 2:{} };
    const aDue: TurniMese = { 1:{}, 2:{ 31:cella("N") } };
    const m = (T:TurniMese) => misuraTabellone(DIC.anno, DIC.mese, DIC.nd, medici, T);
    expect(m(aUno).soft).toBe(m(aDue).soft);               // senza storico: indifferente
    ENG.STORICO_FEST = { 1:[0,0,0,0,2], 2:[0,0,0,0,0] };   // il medico 1 ne ha fatte 2 al mese
    expect(varietaFestivi(makeCtx(DIC.anno, DIC.mese, DIC.nd, medici, aUno))).toBe(2);
    expect(varietaFestivi(makeCtx(DIC.anno, DIC.mese, DIC.nd, medici, aDue))).toBe(0);
    expect(m(aDue).soft).toBeLessThan(m(aUno).soft);
  });
});
