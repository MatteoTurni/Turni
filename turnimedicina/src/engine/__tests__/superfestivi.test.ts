import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico, TurniAll, TurniMese } from "../types";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { misuraTabellone } from "../genera";
import { slotDelMese, calcolaStoricoSuperfestivi, setStoricoSuperfestivi, costoSuperfestivi, PESI_SF } from "../superfestivi";
import { makeCtx } from "../ctx";

// ── v0.3.57: superfestivi ─────────────────────────────────────────────────────
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const med = (id:number, stato:Medico["stato"]="MR"): Medico => ({ id, nome:`X. M${id}`, codice:String(id), stato, obiettivo:25, ambulatorio:false });
const medici = [med(1), med(2), med(3), med(4), med(5), med(6,"MPS")];
const c = (tipo:string) => ({ t:[{ tipo, sott:false, man:true }] });
// l'anno scorso (inserito a mano): Natale 2025 e Capodanno 2026
const annoScorso: TurniAll = {
  "2025-12": { 1:{ 25:c("N") }, 2:{ 24:c("N") }, 3:{ 31:c("N") } },
  "2026-01": { 4:{ 1:c("M") } },
};
beforeEach(()=>{ setRegole(dft()); ENG.PREV = null; ENG.STORICO_FEST = null; ENG.STORICO_SF = null; setSalt(0); setAmbRotStart(0); });
afterEach(()=>{ ENG.STORICO_SF = null; setRegole(dft()); });

describe("turni superfestivi", () => {
  it("quattro turni per superfestivo: notte prima, mattina, pomeriggio, notte", () => {
    const L = dft().superfestivi;
    const dic = slotDelMese(L, 2026, 11).map(s=>`${s.sf}:${s.slot}:${s.d}`);
    expect(dic).toEqual(["natale:vigilia:24","natale:M:25","natale:P:25","natale:N:25","capodanno:vigilia:31"]);
    expect(slotDelMese(L, 2027, 0).map(s=>`${s.sf}:${s.slot}:${s.d}`)).toEqual(["capodanno:M:1","capodanno:P:1","capodanno:N:1"]);
    // Pasqua 2027 è il 28 marzo; Ferragosto con la notte del 14
    expect(slotDelMese(L, 2027, 2).map(s=>`${s.slot}:${s.d}`)).toEqual(["vigilia:27","M:28","P:28","N:28"]);
    expect(slotDelMese(L, 2026, 7).map(s=>`${s.slot}:${s.d}`)).toEqual(["vigilia:14","M:15","P:15","N:15"]);
  });
  it("storico: l'anno scorso, i 12 mesi e la stagione", () => {
    const h = calcolaStoricoSuperfestivi(annoScorso, 2026, 11, medici, dft().superfestivi)!;
    expect(h.identici[1]).toEqual({ "natale|N":1 });
    expect(h.identici[2]).toEqual({ "natale|vigilia":1 });
    expect(h.identici[3]).toEqual({ "capodanno|vigilia":1 });   // il Capodanno 2027 ha la notte del 31 in questo dicembre
    expect(h.identici[4]).toEqual({ "capodanno|M":1 });
    expect(h.stessi[1]).toEqual({ natale:1 });
    expect([1,2,3,4,5].map(id=>h.nAnno[id])).toEqual([1,1,1,1,0]);
    expect(h.nAnno[6]).toBeUndefined();                       // MPS fuori
    // gennaio 2026: la notte del 31 dicembre 2025 e il Natale 2025 sono "stagione"
    const g = calcolaStoricoSuperfestivi(annoScorso, 2026, 0, medici, dft().superfestivi)!;
    expect(g.stagione[3]).toEqual(["capodanno"]);
    expect(g.stagione[1]).toEqual(["natale"]);
    expect(calcolaStoricoSuperfestivi(annoScorso, 2026, 11, medici, [])).toBeNull();
  });
  it("più anni indietro: due anni fa conta a metà; la media per anno", () => {
    const dueAnni: TurniAll = { ...annoScorso, "2024-12": { 5:{ 25:c("M") }, 1:{ 25:c("N") } } };
    const h1 = calcolaStoricoSuperfestivi(dueAnni, 2026, 11, medici, dft().superfestivi, 1)!;
    expect(h1.identici[5]).toEqual({});                          // con un anno solo il 2024 non conta
    const h2 = calcolaStoricoSuperfestivi(dueAnni, 2026, 11, medici, dft().superfestivi, 2)!;
    expect(h2.identici[5]).toEqual({ "natale|M":0.5 });
    expect(h2.identici[1]).toEqual({ "natale|N":1.5 });          // anche due anni fa: 1 + ½
    expect(h2.stessi[5]).toEqual({ natale:0.5 });
    expect(h2.nAnno[1]).toBe(1);                                 // 2 turni in 2 anni
    expect(h2.nAnno[5]).toBe(0.5);
  });
  it("spenta: nessuno storico e nessun costo", () => {
    setStoricoSuperfestivi(annoScorso, 2026, 11, medici, dft().superfestivi, false, 2);
    expect(ENG.STORICO_SF).toBeNull();
    setStoricoSuperfestivi(annoScorso, 2026, 11, medici, dft().superfestivi, true, 1);
    setRegole({ ...dft(), superfestiviAttivi:false });
    const T: TurniMese = { 1:{ 25:{ t:[{ tipo:"N", sott:false, man:false }] } } };
    expect(costoSuperfestivi(makeCtx(2026, 11, 31, medici, T), 2026, 11)).toBe(0);
    expect(mergeRegole({}).superfestiviAttivi).toBe(true);
    expect(mergeRegole({}).superfestiviAnni).toBe(2);
    expect(mergeRegole({ superfestiviAnni: 9 } as any).superfestiviAnni).toBe(2);
  });
  it("lo stesso identico turno dell'anno scorso costa più di un turno nuovo", () => {
    setStoricoSuperfestivi(annoScorso, 2026, 11, medici, dft().superfestivi);
    const T = (id:number): TurniMese => ({ [id]:{ 25:{ t:[{ tipo:"N", sott:false, man:false }] } } });
    const costo = (id:number) => costoSuperfestivi(makeCtx(2026, 11, 31, medici, T(id)), 2026, 11);
    // 1: notte di Natale anche l'anno scorso; 2: Natale sì ma un altro turno; 5: nessun superfestivo
    expect(costo(1)).toBeGreaterThan(costo(2));
    expect(costo(2)).toBeGreaterThan(costo(5));
    expect(costo(5)).toBe(0);
    const m = (id:number) => misuraTabellone(2026, 11, 31, medici, T(id));
    expect(m(5).soft).toBeLessThan(m(1).soft);
  });
  it("alternanza Natale / Capodanno, anche a cavallo di gennaio", () => {
    setStoricoSuperfestivi({}, 2026, 11, medici, dft().superfestivi);
    const a: TurniMese = { 5:{ 25:{ t:[{ tipo:"M", sott:false, man:false }] }, 31:{ t:[{ tipo:"N", sott:false, man:false }] } } };
    const b: TurniMese = { 5:{ 25:{ t:[{ tipo:"M", sott:false, man:false }] } }, 4:{ 31:{ t:[{ tipo:"N", sott:false, man:false }] } } };
    const k = (T:TurniMese) => costoSuperfestivi(makeCtx(2026, 11, 31, medici, T), 2026, 11);
    expect(k(a)).toBeGreaterThan(k(b));
    // gennaio: chi ha fatto Natale a dicembre non prende l'1
    setStoricoSuperfestivi({ "2026-12": { 1:{ 25:c("M") } } }, 2027, 0, medici, dft().superfestivi);
    const j = (id:number) => costoSuperfestivi(makeCtx(2027, 0, 31, medici, { [id]:{ 1:{ t:[{ tipo:"P", sott:false, man:false }] } } }), 2027, 0);
    expect(j(1)).toBeGreaterThan(j(2));
    // spenta: resta solo il pareggio annuo (il medico 1 ha già un superfestivo nei 12 mesi)
    const conAlt = j(1);
    setRegole({ ...dft(), alternanzaNataleCapodanno:false });
    expect(j(1)).toBe(conAlt - PESI_SF.alternanza);
    expect(j(1)).toBe(PESI_SF.conteggio);
  });
  it("regole: predefiniti, aggiunte e date non valide", () => {
    expect(mergeRegole({}).superfestivi.map(x=>x.id)).toEqual(["natale","capodanno","pasqua","ferragosto"]);
    expect(mergeRegole({}).alternanzaNataleCapodanno).toBe(true);
    const r = mergeRegole({ superfestivi:[{ id:"x", nome:"Santo Stefano", data:"12-26" }, { id:"y", nome:"", data:"13-40" }, { id:"z", nome:"", data:"pasquetta" }] } as any);
    expect(r.superfestivi.map(x=>x.data)).toEqual(["12-26","pasquetta"]);
    expect(mergeRegole({ superfestivi:[] } as any).superfestivi).toEqual([]);
  });
});
