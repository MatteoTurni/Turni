import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { dimOf } from "../date";
import { SPEC } from "../turni";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { makeCtx } from "../ctx";
import { generaMigliorTentativo } from "../genera";

// ─── ESENZIONE ML DAL TETTO DI GIORNI CONSECUTIVI (v0.3.30) ───────────────────
// L'ML lavora solo mattine feriali e di sabato: la domenica gli azzera comunque
// la serie, quindi in automatico non supera mai 6 giorni di fila. Il tetto
// maxConsec è pensato per chi ruota su pomeriggi e notti e per l'ML è solo un
// freno, come lo era l'obiettivo di weekend liberi (da cui è già esente).

const MEDICI: Medico[] = [
  { id:1,  nome:"BALDI",      codice:"1",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:2,  nome:"RENIS",      codice:"2",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:3,  nome:"GENTILE",    codice:"3",  stato:"MDC", obiettivo:21, ambulatorio:false },
  { id:4,  nome:"DELGATTO",   codice:"4",  stato:"ML",  obiettivo:25, ambulatorio:false },
  { id:5,  nome:"CIAMPA",     codice:"5",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:6,  nome:"SPUGNARDI",  codice:"6",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:7,  nome:"STEFANUCCI", codice:"7",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:8,  nome:"LEZZI",      codice:"8",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:9,  nome:"GIORDANO",   codice:"9",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:10, nome:"CASILLI",    codice:"10", stato:"MPS", obiettivo:0,  ambulatorio:false },
  { id:11, nome:"SCUDERI",    codice:"11", stato:"MPS", obiettivo:0,  ambulatorio:false },
];
const ML = 4, MR = 1;
const ANNO = 2026, MESE = 5, NDIM = dimOf(2026, 5);

const regole = (mc:number) =>
  setRegole(mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), maxConsec: mc } as any));

/** Serie massima di giorni lavorati, calcolata fuori dal ctx. */
function runMax(T:TurniMese, id:number, ndim:number){
  let run=0, mx=0;
  for(let g=1; g<=ndim; g++){
    if((T[id]?.[g]?.t||[]).some(s=>!SPEC.includes(s.tipo))){ run++; mx=Math.max(mx,run); } else run=0;
  }
  return mx;
}
/** Riempie di mattine manuali i giorni da..a. */
function mattineMan(id:number, da:number, a:number): TurniMese {
  const T: TurniMese = {};
  for(let g=da; g<=a; g++) (T[id] ||= {})[g] = { t:[{ tipo:"M", sott:false, man:true }] };
  return T;
}

beforeEach(()=>{ ENG.PREV = null; setSalt(7); setAmbRotStart(1); });

describe("canConsec: il cancello", () => {
  it("con la serie già oltre il tetto, l'ML passa e l'MR no", () => {
    regole(3);
    // 10 mattine manuali di fila a testa: serie ben oltre maxConsec=3
    const T: TurniMese = { ...mattineMan(ML,1,10), ...mattineMan(MR,1,10) };
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    expect(c.runConsec(ML,11)).toBeGreaterThan(3);
    expect(c.runConsec(MR,11)).toBeGreaterThan(3);
    expect(c.canConsec(ML,11)).toBe(true);      // esente
    expect(c.canConsec(MR,11)).toBe(false);     // soggetto al tetto
  });

  it("l'esenzione non tocca gli altri vincoli dell'ML", () => {
    regole(3);
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, { ...mattineMan(ML,1,10) });
    const ml = MEDICI.find(m=>m.id===ML)!;
    expect(c.canR(ml,11,"N")).toBe(false);      // ML: mai notti
    expect(c.canR(ml,11,"P")).toBe(false);      // ML: mai pomeriggi
    expect(c.canR(ml,11,"ASS")).toBe(false);    // ML: mai giornate piene
  });

  it("l'esenzione è per stato, non per indice: cambiando l'ML cambia l'esente", () => {
    regole(3);
    const med2 = MEDICI.map(m => m.id===7 ? { ...m, stato:"ML" as const } : m);
    const T: TurniMese = { ...mattineMan(7,1,10), ...mattineMan(ML,1,10), ...mattineMan(MR,1,10) };
    const c = makeCtx(ANNO, MESE, NDIM, med2, T);
    expect(c.canConsec(7,11)).toBe(true);
    expect(c.canConsec(ML,11)).toBe(true);      // resta ML anche lui
    expect(c.canConsec(MR,11)).toBe(false);
  });
});

describe("generazione", () => {
  it("con maxConsec basso l'ML non viene più frenato, gli altri sì", () => {
    regole(4);
    const r = generaMigliorTentativo(ANNO, MESE, NDIM, MEDICI, {}, 6000);
    // l'ML può superare il tetto…
    expect(runMax(r.turni, ML, NDIM)).toBeGreaterThan(4);
    // …mentre nessun non-ML lo supera
    for(const m of MEDICI){
      if(m.stato==="ML" || m.stato==="MPS") continue;
      expect(runMax(r.turni, m.id, NDIM)).toBeLessThanOrEqual(4);
    }
  });

  it("col default (7) il risultato è identico: la regola non mordeva già prima", () => {
    regole(7);
    const r = generaMigliorTentativo(ANNO, MESE, NDIM, MEDICI, {}, 6000);
    // niente domeniche/festivi per l'ML ⇒ serie naturale al massimo 6
    expect(runMax(r.turni, ML, NDIM)).toBeLessThanOrEqual(6);
  });

  it("l'ML può superare il tetto anche per manuali di domenica, senza travolgere gli altri", () => {
    regole(5);
    const r = generaMigliorTentativo(ANNO, MESE, NDIM, MEDICI, mattineMan(ML,1,14), 6000);
    expect(runMax(r.turni, ML, NDIM)).toBeGreaterThanOrEqual(14);
    for(const m of MEDICI){
      if(m.stato==="ML" || m.stato==="MPS") continue;
      expect(runMax(r.turni, m.id, NDIM)).toBeLessThanOrEqual(5);
    }
  });
});
