import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { Medico, TurniMese } from "../types";
import { setRegole, getRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { makeCtx } from "../ctx";
import { validazioneGlobale } from "../fasi";
import { generaMigliorTentativo, completaObiettivi } from "../genera";
import { violazioniIndip } from "../../../harness/validatori";

// ── v0.3.54: turni associati — definizione unica e limite mensile per medico ──
// Turno associato = un giorno con una mattina (M, A, 1) e un pomeriggio (P, Ap,
// 2), PS e sottolineati compresi. Vale per la distanza, per il tetto settimanale
// del pannello Regole e per il limite mensile della scheda medico.
const anno = 2026, mese = 10, nd = 30;                       // novembre 2026: lun 2, mar 3, ven 6
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const med = (id:number, stato:Medico["stato"], obiettivo:number, maxAssMese?:number): Medico =>
  ({ id, nome:`X. M${id}`, codice:String(id), stato, obiettivo, ambulatorio:false, ...(maxAssMese!==undefined ? { maxAssMese } : {}) });
const man = (T:TurniMese, id:number, g:number, tipo:string, sott=false) => {
  const c = ((T[id] ||= {})[g] ||= { t:[] }); c.t = [...c.t, { tipo, sott, man:true }];
};
const tipi = (T:TurniMese, id:number, g:number) => (T[id]?.[g]?.t || []).map(s=>s.tipo).sort().join("+");

beforeEach(()=>{ setRegole(dft()); ENG.PREV = null; ENG.DEADLINE = 0; setSalt(0); setAmbRotStart(0); });
afterEach(()=>{ setRegole(dft()); });

describe("tetto settimanale: contano anche le metà di PS", () => {
  it("mattina in reparto + pomeriggio di PS (M + 2) occupa la quota della settimana", () => {
    setRegole({ ...dft(), maxAssSett: 1 });
    const m = med(1,"MR",25), T: TurniMese = {};
    man(T, 1, 3, "2", true);                               // PS pomeriggio sottolineato, martedì 3
    const c = makeCtx(anno, mese, nd, [m], T);
    c.add(1, 3, "M");
    expect(tipi(c.T,1,3)).toBe("2+M");
    expect(c.assInSett(1, 3)).toBe(1);
    c.add(1, 6, "M");                                      // venerdì 6: stessa settimana, a distanza
    expect(c.canR(m, 6, "P")).toBe(false);
    c.add(1, 6, "P");
    expect(tipi(c.T,1,6)).toBe("M");                       // il secondo associato non entra
  });
  it("PS di mattina e di pomeriggio (1 + 2) conta come associato", () => {
    setRegole({ ...dft(), maxAssSett: 1 });
    const m = med(1,"MR",25), T: TurniMese = {};
    man(T, 1, 3, "1", true); man(T, 1, 3, "2", true);
    const c = makeCtx(anno, mese, nd, [m], T);
    expect(c.assInSett(1, 6)).toBe(1);
    c.add(1, 6, "M"); c.add(1, 6, "P");
    expect(tipi(c.T,1,6)).toBe("M");
  });
});

describe("limite mensile di turni associati (scheda medico)", () => {
  it("oltre il limite il motore non crea associati; senza limite sì", () => {
    const conLim = med(1,"MR",25,1), senza = med(2,"MR",25);
    const c = makeCtx(anno, mese, nd, [conLim, senza], {});
    for(const id of [1,2]){ c.add(id, 3, "M"); c.add(id, 3, "P"); }    // primo associato: ammesso a entrambi
    expect(c.assInMese(1)).toBe(1);
    for(const id of [1,2]) c.add(id, 10, "M");
    expect(c.canR(conLim, 10, "P")).toBe(false);
    expect(c.canR(conLim, 10, "ASS")).toBe(false);
    expect(c.canR(senza, 10, "P")).toBe(true);
    for(const id of [1,2]) c.add(id, 10, "P");
    expect(tipi(c.T,1,10)).toBe("M");
    expect(tipi(c.T,2,10)).toBe("M+P");
    // annullando il primo associato la quota si libera
    const m0 = c.mark(); c.st(1, 3, []);
    expect(c.canR(conLim, 10, "P")).toBe(true);
    c.rollback(m0);
    expect(c.assInMese(1)).toBe(1);
  });
  it("gli associati manuali contano e non si toccano; nessun avviso se sono tutti manuali", () => {
    const m = med(1,"MR",25,1), T: TurniMese = {};
    man(T, 1, 3, "M"); man(T, 1, 3, "2", true);           // due associati inseriti a mano
    man(T, 1, 10, "1", true); man(T, 1, 10, "P");
    const c = makeCtx(anno, mese, nd, [m], T);
    expect(c.assInMese(1)).toBe(2);
    c.add(1, 17, "M"); c.add(1, 17, "P");
    expect(tipi(c.T,1,17)).toBe("M");
    expect(validazioneGlobale(c).some(p=>/nel mese/.test(p))).toBe(false);
  });
  it("generazione + Completa sul novembre reale (anonimizzato) con limiti bassi: mai superati", () => {
    const sc = JSON.parse(fs.readFileSync("src/engine/__tests__/fixtures/novembre2026_manuali.json", "utf8"));
    const lim: Record<number, number> = { 1:1, 5:0, 8:1 };                  // due MR e un decreto Calabria
    const medici: Medico[] = sc.medici.map((m:Medico)=> lim[m.id]!==undefined ? { ...m, maxAssMese: lim[m.id] } : m);
    const gen = generaMigliorTentativo(anno, mese, nd, medici, sc.ex, 3000);
    const fin = completaObiettivi(anno, mese, nd, medici, gen.turni).turni;
    for(const T of [gen.turni, fin]){
      const c = makeCtx(anno, mese, nd, medici, T);
      for(const id in lim) expect(c.assInMese(+id), `medico ${id}`).toBeLessThanOrEqual(Math.max(lim[+id], makeCtx(anno, mese, nd, medici, sc.ex).assInMese(+id)));
      expect(violazioniIndip({ anno, mese, medici, ex:sc.ex, regole:getRegole(), prevT:null }, T)).toEqual([]);
    }
  });
});
