import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { dimOf } from "../date";
import { isMatt, isPom, isNot, SPEC, isEscl, escludeFascia, fasciaDi } from "../turni";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { makeCtx } from "../ctx";
import { diagnosiStatica } from "../diagnosi";
import { generaMigliorTentativo } from "../genera";

// ─── ESCLUSIONI PARZIALI (v0.3.30) ────────────────────────────────────────────
// Xm / Xp / Xn escludono UNA fascia lasciando libere le altre. Il contratto che
// questi test difendono è duplice:
//   1) NESSUN turno AUTOMATICO può finire su una fascia esclusa (vincolo duro);
//   2) l'esclusione parziale NON deve comportarsi come una X totale — chi ha un
//      Xn resta un candidato pieno per mattina e pomeriggio, e la capacità
//      strutturale (capCell/needEff, diagnosiStatica) deve rifletterlo.
// Il secondo punto è quello che si rompe in silenzio: un'esclusione trattata
// come blocco di giornata non produce violazioni, produce buchi.

const MEDICI: Medico[] = [
  { id:1,  nome:"D. BALDI",      codice:"1",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:2,  nome:"M. RENIS",      codice:"2",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:3,  nome:"M. GENTILE",    codice:"3",  stato:"MDC", obiettivo:21, ambulatorio:false },
  { id:4,  nome:"A. DEL GATTO",  codice:"4",  stato:"ML",  obiettivo:25, ambulatorio:false },
  { id:5,  nome:"C. CIAMPA",     codice:"5",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:6,  nome:"V. SPUGNARDI",  codice:"6",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:7,  nome:"M. STEFANUCCI", codice:"7",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:8,  nome:"M. LEZZI",      codice:"8",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:9,  nome:"V. GIORDANO",   codice:"9",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:10, nome:"B. CASILLI",    codice:"10", stato:"MPS", obiettivo:0,  ambulatorio:false },
  { id:11, nome:"P. SCUDERI",    codice:"11", stato:"MPS", obiettivo:0,  ambulatorio:false },
];

const ANNO = 2026, MESE = 5, NDIM = dimOf(2026, 5);   // giugno 2026

const escl = (tipo:string) => ({ t:[{ tipo, sott:false, man:true }] });

beforeEach(()=>{
  setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));
  ENG.PREV = null;
  setSalt(0);
  setAmbRotStart(0);
});

describe("codifica delle esclusioni", () => {
  it("X esclude ogni fascia, Xm/Xp/Xn solo la propria", () => {
    for(const f of ["M","P","N"] as const) expect(escludeFascia("X", f)).toBe(true);
    expect(escludeFascia("Xm","M")).toBe(true);
    expect(escludeFascia("Xm","P")).toBe(false);
    expect(escludeFascia("Xm","N")).toBe(false);
    expect(escludeFascia("Xp","P")).toBe(true);
    expect(escludeFascia("Xn","N")).toBe(true);
    // un codice qualsiasi non esclude nulla
    for(const f of ["M","P","N"] as const) expect(escludeFascia("L", f)).toBe(false);
  });

  it("sono codici SPEC (riposo, peso 0) e la fascia dei turni reali è corretta", () => {
    for(const t of ["X","Xm","Xp","Xn"]){ expect(SPEC.includes(t)).toBe(true); expect(isEscl(t)).toBe(true); }
    expect(isEscl("L")).toBe(false);
    // A e 1 sono mattina, 2 pomeriggio, 3 notte: le esclusioni devono seguirli
    expect(fasciaDi("A")).toBe("M"); expect(fasciaDi("1")).toBe("M");
    expect(fasciaDi("2")).toBe("P"); expect(fasciaDi("3")).toBe("N");
    expect(fasciaDi("L")).toBe(null); expect(fasciaDi("Xm")).toBe(null);
  });
});

describe("eleggibilità: l'esclusione parziale libera le altre fasce", () => {
  it("con Xn il medico resta candidato per mattina e pomeriggio", () => {
    const T: TurniMese = { "1": { "10": escl("Xn") } };
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    const m = MEDICI[0];
    expect(c.escluso(1,10,"N")).toBe(true);
    expect(c.escluso(1,10,"M")).toBe(false);
    expect(c.canR(m,10,"N")).toBe(false);
    expect(c.canR(m,10,"M")).toBe(true);
    expect(c.canR(m,10,"P")).toBe(true);
    // eleggibili passa da haQ: un'esclusione NON deve "occupare" la cella
    expect(c.eleggibili(10,"M",[m]).map(x=>x.id)).toEqual([1]);
  });

  it("con Xm+Xp resta solo la notte (e l'associato cade)", () => {
    const T: TurniMese = { "1": { "10": { t:[
      { tipo:"Xm", sott:false, man:true }, { tipo:"Xp", sott:false, man:true },
    ] } } };
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    const m = MEDICI[0];
    expect(c.canR(m,10,"M")).toBe(false);
    expect(c.canR(m,10,"P")).toBe(false);
    expect(c.canR(m,10,"ASS")).toBe(false);
    expect(c.canR(m,10,"N")).toBe(true);
    expect(c.eleggibili(10,"N",[m]).map(x=>x.id)).toEqual([1]);
  });

  it("l'associato cade se è esclusa anche UNA sola delle due metà", () => {
    const T: TurniMese = { "1": { "10": escl("Xp") } };
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    expect(c.esclusoAss(1,10)).toBe(true);
    expect(c.canR(MEDICI[0],10,"ASS")).toBe(false);
    expect(c.canR(MEDICI[0],10,"M")).toBe(true);
  });
});

describe("guardia di add()", () => {
  it("rifiuta il turno AUTOMATICO sulla fascia esclusa e accetta le altre", () => {
    const T: TurniMese = { "1": { "10": escl("Xm") } };
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    c.add(1,10,"M");  expect(c.gt(1,10).some(s=>s.tipo==="M")).toBe(false);
    c.add(1,10,"A");  expect(c.gt(1,10).some(s=>s.tipo==="A")).toBe(false);   // la A è mattina
    c.add(1,10,"1");  expect(c.gt(1,10).some(s=>s.tipo==="1")).toBe(false);   // anche il codice PS di mattina
    c.add(1,10,"P");  expect(c.gt(1,10).some(s=>s.tipo==="P")).toBe(true);
  });

  it("il turno MANUALE resta inviolabile anche contro un'esclusione", () => {
    const T: TurniMese = { "1": { "10": escl("Xm") } };
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    c.add(1,10,"M",true);
    expect(c.gt(1,10).some(s=>s.tipo==="M"&&s.man)).toBe(true);
  });
});

describe("interazione con la Regola N", () => {
  it("un Xm al giorno DOPO non vieta la notte (solo la X totale lo fa)", () => {
    const conXm: TurniMese = { "1": { "11": escl("Xm") } };
    expect(makeCtx(ANNO, MESE, NDIM, MEDICI, conXm).canN(1,10)).toBe(true);
    const conX: TurniMese = { "1": { "11": escl("X") } };
    expect(makeCtx(ANNO, MESE, NDIM, MEDICI, conX).canN(1,10)).toBe(false);
  });

  it("un'esclusione nel giorno dopo una notte non conta come lavoro", () => {
    const T: TurniMese = { "1": { "10": { t:[{tipo:"N",sott:false,man:true}] }, "11": escl("Xp") } };
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    expect(c.lavoraGiorno(1,11)).toBe(false);
    expect(c.checkRegolaN()).toBe(true);
  });
});

describe("capacità strutturale", () => {
  it("needEff scende solo sulla fascia esclusa", () => {
    const T: TurniMese = {};
    for(const m of MEDICI) (T[m.id] ||= {})["10"] = escl("Xm");
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    expect(c.needEff(10,"M")).toBe(0);      // nessuno può fare la mattina
    expect(c.needEff(10,"N")).toBe(1);      // la notte è ancora copribile
    expect(c.needEff(10,"P")).toBeGreaterThan(0);
  });

  it("la diagnosi statica certifica la cella solo sulla fascia esclusa", () => {
    const T: TurniMese = {};
    for(const m of MEDICI) (T[m.id] ||= {})["10"] = escl("Xn");
    const d = diagnosiStatica(ANNO, MESE, NDIM, MEDICI, T);
    const notte  = d.celle.filter(c=>c.g===10 && c.f==="N");
    const giorno = d.celle.filter(c=>c.g===10 && c.f!=="N");
    expect(notte.length).toBe(1);
    expect(notte[0].disp).toBe(0);
    expect(giorno.length).toBe(0);          // mattina e pomeriggio restano coperti
  });
});

describe("equità weekend", () => {
  it("un Xn nei weekend riduce la capacità ma non toglie il medico dai portatori", () => {
    const base = makeCtx(ANNO, MESE, NDIM, MEDICI, {});
    const capBase = base.wkCapacita(MEDICI[0]);
    const T: TurniMese = {};
    for(let g=1; g<=NDIM; g++) if(base.isWk(g)) (T[1] ||= {})[g] = escl("Xn");
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    expect(c.wkCapacita(MEDICI[0])).toBeLessThan(capBase);
    expect(c.wkCapacita(MEDICI[0])).toBeGreaterThan(0);
    expect(c.wkPortatori.some(m=>m.id===1)).toBe(true);
  });
});

describe("generazione completa", () => {
  it("nessun turno assegnato viola un'esclusione parziale", () => {
    // Esclusioni sparse su fasce e medici diversi, comprese due giornate in cui
    // lo stesso medico può SOLO la notte (Xm+Xp).
    const T: TurniMese = {};
    const metti = (id:number, g:number, tipi:string[]) =>
      (T[id] ||= {})[g] = { t: tipi.map(tipo=>({ tipo, sott:false, man:true })) };
    for(let g=2; g<=NDIM; g+=3) metti(1, g, ["Xm"]);
    for(let g=3; g<=NDIM; g+=4) metti(2, g, ["Xn"]);
    for(let g=5; g<=NDIM; g+=5) metti(5, g, ["Xp"]);
    metti(6, 8,  ["Xm","Xp"]);
    metti(6, 19, ["Xm","Xp"]);
    for(let g=4; g<=NDIM; g+=7) metti(9, g, ["Xn"]);

    const r = generaMigliorTentativo(ANNO, MESE, NDIM, MEDICI, T, 6000);

    const violazioni: string[] = [];
    for(const m of MEDICI){
      for(let g=1; g<=NDIM; g++){
        const cella = r.turni[m.id]?.[g]?.t || [];
        for(const s of cella){
          const f = fasciaDi(s.tipo); if(!f) continue;
          if(cella.some(e=>escludeFascia(e.tipo, f)))
            violazioni.push(`${m.nome} g${g}: ${s.tipo} su fascia ${f} esclusa`);
        }
      }
    }
    expect(violazioni).toEqual([]);

    // …e le esclusioni manuali sono ancora tutte lì (nessuna fase le ha erose).
    for(const idS in T) for(const gS in T[idS])
      for(const s of T[idS][gS].t)
        expect((r.turni[idS]?.[gS]?.t || []).some(x=>x.tipo===s.tipo && x.man)).toBe(true);
  });

  it("un Xn diffuso non impedisce di coprire mattine e pomeriggi di quei giorni", () => {
    // Se un'esclusione parziale fosse trattata come X totale, questi giorni
    // resterebbero scoperti su TUTTE le fasce: è la regressione da difendere.
    const T: TurniMese = {};
    const giorni = [7, 8, 9, 14, 15, 16];
    for(const m of MEDICI){
      if(m.stato==="MPS") continue;
      for(const g of giorni) (T[m.id] ||= {})[g] = escl("Xn");
    }
    const r = generaMigliorTentativo(ANNO, MESE, NDIM, MEDICI, T, 6000);
    const cop = (g:number, f:"M"|"P") =>
      MEDICI.reduce((n,m)=>n+((r.turni[m.id]?.[g]?.t||[]).some(s=>s.tipo===f)?1:0),0);
    for(const g of giorni){
      expect(cop(g,"M")).toBeGreaterThan(0);
      expect(cop(g,"P")).toBeGreaterThan(0);
    }
  });
});

describe("export ed esclusioni non sono lavoro", () => {
  it("le esclusioni non entrano nel carico né rendono la giornata occupata", () => {
    const T: TurniMese = { "1": { "10": { t:[
      { tipo:"Xm", sott:false, man:true }, { tipo:"Xn", sott:false, man:true },
    ] } } };
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    expect(c.cnt(1)).toBe(0);
    expect(c.haQ(1,10)).toBe(false);        // la cella è ancora "libera"
    expect(c.isLibWk(1,10)).toBe(true);     // e conta come weekend libero
    expect(isMatt("Xm")||isPom("Xp")||isNot("Xn")).toBe(false);
  });
});
