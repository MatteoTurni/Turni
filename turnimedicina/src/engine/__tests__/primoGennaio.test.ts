import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import type { Medico, TurniMese } from "../types";
import { setRegole, getRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { generaMigliorTentativo } from "../genera";
import { generaPrimoGennaio, togliPrimoGennaio, nPrimoGennaio, chiaveGennaio } from "../primoGennaio";
import { violazioniIndip } from "../../../harness/validatori";
import { mergeRegole } from "../regole";
import { costruisciWorkbook } from "../../export/excel";

// ── v0.3.72: il 1° gennaio generato insieme a dicembre ────────────────────────
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const sc = JSON.parse(fs.readFileSync("src/engine/__tests__/fixtures/novembre2026_manuali.json", "utf8"));
const medici: Medico[] = sc.medici;
const cella = (tipo:string) => ({ t:[{ tipo, sott:false, man:true }] });
const giorno1 = (T:TurniMese) => medici.flatMap(m => (T[m.id]?.["1"]?.t || []).map(s => ({ id:m.id, ...s })));
beforeEach(()=>{ setRegole(dft()); ENG.PREV = null; ENG.DEADLINE = 0; ENG.STORICO_FEST = null; ENG.STORICO_EQ = null; setSalt(0); setAmbRotStart(0); });
afterEach(()=>{ setRegole(dft()); ENG.PREV = null; });

describe("il 1° gennaio con dicembre", () => {
  const dic = generaMigliorTentativo(2026, 11, 31, medici, {}, 1500).turni;
  it("coperto, fisso e segnato; dopo la notte del 31 si riposa; nessuna violazione; il contesto del motore torna com'era", () => {
    const prima = ENG.PREV;
    const e = generaPrimoGennaio(2026, medici, {}, dic);
    expect(ENG.PREV).toBe(prima);
    expect(e.blocco).toBe("");
    expect(e.scoperti).toEqual([]);
    const g1 = giorno1(e.gennaio);
    expect(g1.length).toBeGreaterThan(0);
    expect(g1.every(s => s.man && s.dic)).toBe(true);
    expect(g1.filter(s=>s.tipo==="N").length).toBe(1);
    expect(nPrimoGennaio(e.gennaio)).toBe(g1.length);
    for (const s of g1) expect((dic[s.id]?.["31"]?.t || []).some(x=>x.tipo==="N"||x.tipo==="3"), `medico ${s.id}: notte il 31 e turno il 1°`).toBe(false);
    expect(violazioniIndip({ anno:2027, mese:0, medici, ex:{}, regole:getRegole(), prevT:dic }, e.gennaio).filter(v=>!/obiettivo|turni \(|sotto/.test(v))).toEqual([]);
  });
  it("rispetta i turni del 1° già messi a mano (o dal piano festivi) e chi è in ferie", () => {
    const mr = medici.filter(m=>m.stato==="MR").map(m=>m.id);
    const gen: TurniMese = { [mr[0]]: { 1: cella("N") }, [mr[1]]: { 1: cella("L") } };
    const e = generaPrimoGennaio(2026, medici, { [chiaveGennaio(2026)]: gen }, dic);
    expect(e.blocco).toBe("");
    expect(e.gennaio[mr[0]]["1"].t).toEqual(gen[mr[0]][1].t);                 // la notte a mano resta, e basta
    expect(e.gennaio[mr[1]]["1"].t).toEqual(gen[mr[1]][1].t);                 // in ferie: niente turni
    expect(giorno1(e.gennaio).filter(s=>s.tipo==="N").length).toBe(1);
    expect(gen[mr[0]][1].t.length).toBe(1);                                    // l'originale non cambia
  });
  it("guarda anche i turni a mano del 2 gennaio: chi lavora il 2 non fa la notte del 1°", () => {
    const notturni = medici.filter(m=>m.stato==="MR"||m.stato==="MDC").map(m=>m.id);
    const libero = notturni.find(id => !(dic[id]?.["31"]?.t || []).length && !(dic[id]?.["30"]?.t || []).some(x=>x.tipo==="N"))!;
    const gen: TurniMese = Object.fromEntries(notturni.filter(id=>id!==libero).map(id=>[id, { 2: cella("M") }]));
    const e = generaPrimoGennaio(2026, medici, { [chiaveGennaio(2026)]: gen }, dic);
    const notte = giorno1(e.gennaio).filter(s=>s.tipo==="N");
    expect(notte.every(s=>s.id===libero)).toBe(true);
    expect(violazioniIndip({ anno:2027, mese:0, medici, ex:gen, regole:getRegole(), prevT:dic }, e.gennaio).filter(v=>!/obiettivo|turni \(|sotto/.test(v))).toEqual([]);
  });
  it("rigenerando si tolgono i turni fatti prima con dicembre; gennaio già generato resta com'è", () => {
    const e1 = generaPrimoGennaio(2026, medici, {}, dic);
    expect(nPrimoGennaio(togliPrimoGennaio(e1.gennaio))).toBe(0);
    const e2 = generaPrimoGennaio(2026, medici, { [chiaveGennaio(2026)]: e1.gennaio }, dic);
    expect(e2.blocco).toBe("");
    expect(nPrimoGennaio(e2.gennaio)).toBe(giorno1(e2.gennaio).length);        // nessun doppione
    expect(giorno1(e2.gennaio).filter(s=>s.tipo==="N").length).toBe(1);
    const generato: TurniMese = { [medici[0].id]: { 5: { t:[{ tipo:"M", sott:false, man:false }] } } };
    const e3 = generaPrimoGennaio(2026, medici, { [chiaveGennaio(2026)]: generato }, dic);
    expect(e3.blocco).toMatch(/già stato generato/);
    expect(e3.gennaio).toBe(generato);
  });
  it("generando poi gennaio, il giorno 1 resta com'era", () => {
    const e = generaPrimoGennaio(2026, medici, {}, dic);
    ENG.PREV = { ndim:31, T:dic };
    const gen = generaMigliorTentativo(2027, 0, 31, medici, e.gennaio, 1500).turni;
    for (const m of medici) expect(gen[m.id]?.["1"]?.t || []).toEqual(e.gennaio[m.id]?.["1"]?.t || []);
  });
  it("Excel di dicembre: la colonna «1 gen» dopo il 31, festiva, coi turni del 1° gennaio", () => {
    const e = generaPrimoGennaio(2026, medici, {}, dic);
    const ws = costruisciWorkbook(2026, 11, 31, medici, dic, e.gennaio).getWorksheet("Foglio1")!;
    expect(ws.getCell(7, 33).value).toBe("1 gen");
    expect(ws.getCell(8, 33).value).toBe("V");                                   // 1° gennaio 2027: venerdì
    expect((ws.getCell(7, 33).fill as any)?.fgColor?.argb).toBe("FFFFC000");      // arancione dei festivi
    const testo = (r:number) => { const v = ws.getCell(r, 33).value as any; return typeof v === "string" ? v : v?.richText?.map((x:any)=>x.text).join("") ?? ""; };
    const righe = medici.map((m,i)=>({ m, t: testo(9+i) }));
    for (const { m, t } of righe) {
      const att = (e.gennaio[m.id]?.["1"]?.t || []).map(x=>x.tipo).filter(x=>!/^X/.test(x));
      expect(t.length > 0, `medico ${m.id}`).toBe(att.length > 0);
    }
    expect(righe.some(r=>r.t==="N")).toBe(true);
    // senza il 1° gennaio, o in un altro mese, il foglio non cambia
    expect(costruisciWorkbook(2026, 11, 31, medici, dic).getWorksheet("Foglio1")!.getCell(7, 33).value).toBeNull();
    expect(costruisciWorkbook(2026, 10, 30, medici, {}, e.gennaio).getWorksheet("Foglio1")!.getCell(7, 32).value).toBeNull();
  });
  it("Regole: casella spenta di serie, salvata", () => {
    expect(mergeRegole({}).primoGennaio).toBe(false);
    expect(mergeRegole({ primoGennaio:true } as any).primoGennaio).toBe(true);
    expect(mergeRegole({ primoGennaio:"sì" } as any).primoGennaio).toBe(false);
  });
});
