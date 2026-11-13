import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico, TurniAll, TurniMese } from "../types";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { misuraTabellone } from "../genera";
import { calcolaStoricoFestivi, setStoricoFestivi } from "../storico";

// ── v0.3.56: rotazione dei turni festivi fra mesi ─────────────────────────────
const med = (id:number, stato:Medico["stato"]="MR"): Medico => ({ id, nome:`X. M${id}`, codice:String(id), stato, obiettivo:25, ambulatorio:false });
const cella = (tipo:string, man=false) => ({ t:[{ tipo, sott:false, man }] });
beforeEach(()=>{ setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT))); ENG.PREV = null; ENG.STORICO_FEST = null; setSalt(0); setAmbRotStart(0); });
afterEach(()=>{ ENG.STORICO_FEST = null; });

describe("storico dei festivi", () => {
  // ottobre 2026: sabati 3, 10, 17, 24, 31
  const ottobre: TurniMese = {
    1: { 10:cella("N"), 24:cella("N") },              // due notti di sabato
    2: { 6:cella("M"), 7:cella("N") },                // ha lavorato (anche una notte feriale), nessun festivo
    3: { 6:cella("L",true), 7:cella("L",true) },      // solo licenze: assente tutto il mese
  };
  const medici = [med(1), med(2), med(3), med(4,"MPS")];
  it("media mensile per tipo; chi non ha lavorato prende la media dei colleghi", () => {
    const h = calcolaStoricoFestivi({ "2026-10": ottobre }, 2026, 10, medici, 3)!;
    expect(h[1][4]).toBe(2);                          // notti di sabato
    expect(h[2][4]).toBe(0);
    expect(h[3][4]).toBe(1);                          // (2 + 0) / 2
    expect(h[4]).toBeUndefined();                     // gli MPS non ruotano
    // due mesi salvati: media mensile
    const h2 = calcolaStoricoFestivi({ "2026-10": ottobre, "2026-09": { 1:{ 2:cella("M"), 9:cella("N") }, 2:{ 5:cella("N") }, 3:{ 1:cella("M"), 16:cella("N") } } }, 2026, 10, medici, 3)!;
    expect(h2[1][4]).toBe(1);                         // (2 + 0) / 2 mesi
    expect(h2[2][4]).toBe(0.5);                       // (0 + 1) / 2 — sabato 5 settembre
  });
  it("spenta (0 mesi) o senza mesi salvati: nessuno storico", () => {
    expect(calcolaStoricoFestivi({ "2026-10": ottobre }, 2026, 10, medici, 0)).toBeNull();
    expect(calcolaStoricoFestivi({}, 2026, 10, medici, 3)).toBeNull();
    setStoricoFestivi({ "2026-10": ottobre }, 2026, 10, medici, 0);
    expect(ENG.STORICO_FEST).toBeNull();
  });
  it("la regola si salva e si sanifica", () => {
    expect(mergeRegole({}).rotazioneFestiviMesi).toBe(3);
    expect(mergeRegole({ rotazioneFestiviMesi: 0 } as any).rotazioneFestiviMesi).toBe(0);
    expect(mergeRegole({ rotazioneFestiviMesi: 99 } as any).rotazioneFestiviMesi).toBe(3);
  });
});

describe("rotazione nel punteggio", () => {
  it("la notte di sabato va a chi nei mesi scorsi ne ha fatte meno", () => {
    const medici = [med(1), med(2)];
    const aUno: TurniMese = { 1:{ 14:cella("N") }, 2:{} };   // novembre 2026: sabato 14
    const aDue: TurniMese = { 1:{}, 2:{ 14:cella("N") } };
    const m = (T:TurniMese) => misuraTabellone(2026, 10, 30, medici, T);
    expect(m(aUno).soft).toBe(m(aDue).soft);                 // senza storico: indifferente
    ENG.STORICO_FEST = { 1:[0,0,0,0,2], 2:[0,0,0,0,0] };    // il medico 1 ne ha fatte 2 al mese
    expect(m(aDue).soft).toBeLessThan(m(aUno).soft);
    expect(m(aDue).s).toBe(m(aUno).s);
  });
});
