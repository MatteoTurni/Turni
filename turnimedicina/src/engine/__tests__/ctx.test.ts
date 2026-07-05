import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { makeCtx } from "../ctx";
import { vt, isNot } from "../turni";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, mkRng, setSalt } from "../state";

const MEDICI: Medico[] = [
  { id:1, nome:"A. UNO",     codice:"1", stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:2, nome:"B. DUE",     codice:"2", stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:3, nome:"C. TRE",     codice:"3", stato:"ML",  obiettivo:25, ambulatorio:false },
  { id:4, nome:"D. QUATTRO", codice:"4", stato:"MDC", obiettivo:21, ambulatorio:false },
  { id:5, nome:"E. CINQUE",  codice:"5", stato:"MPS", obiettivo:0,  ambulatorio:false },
];

const ANNO = 2026, MESE = 5, NDIM = 30;   // giugno 2026

// Ricalcolo "brute force" indipendente dai contatori incrementali del ctx.
function bruteCnt(T: TurniMese, id: number, ndim: number){
  let t=0; for(let g=1;g<=ndim;g++) for(const s of (T[id]?.[g]?.t||[])) t+=vt(s.tipo,s.sott);
  return t;
}
function bruteCntN(T: TurniMese, id: number, ndim: number){
  let n=0; for(let g=1;g<=ndim;g++) for(const s of (T[id]?.[g]?.t||[])) if(isNot(s.tipo)&&!s.sott) n++;
  return n;
}
// Vista normalizzata di T (le celle vuote sono equivalenti a celle assenti).
function norm(T: TurniMese){
  const out: Record<string, Record<string, {tipo:string;sott:boolean;man:boolean}[]>> = {};
  for(const id in T){
    for(const g in T[id]){
      const c=T[id][g]?.t||[];
      if(c.length===0) continue;
      (out[id] ||= {})[g] = c.map(s=>({tipo:s.tipo,sott:!!s.sott,man:!!s.man}));
    }
  }
  return out;
}

beforeEach(()=>{
  setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));
  ENG.PREV = null;
  setSalt(0);
});

describe("contatori incrementali", () => {
  it("cnt/cntN coincidono col ricalcolo brute-force dopo molte mutazioni", () => {
    const T: TurniMese = {
      "1": { "3": { t:[{tipo:"N",sott:false,man:true}] }, "10": { t:[{tipo:"M",sott:true,man:true}] } },
      "2": { "5": { t:[{tipo:"M",sott:false,man:false},{tipo:"P",sott:false,man:false}] } },
    };
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    for(const m of MEDICI){
      expect(c.cnt(m.id)).toBe(bruteCnt(T,m.id,NDIM));
      expect(c.cntN(m.id)).toBe(bruteCntN(T,m.id,NDIM));
    }
    // sequenza pseudo-casuale di add / st (sovrascritture e rimozioni)
    const rng = mkRng(42);
    for(let i=0;i<500;i++){
      const id = MEDICI[Math.floor(rng()*MEDICI.length)].id;
      const g  = 1+Math.floor(rng()*NDIM);
      const op = rng();
      if(op<0.5){
        const tipo = ["M","P","N","A","L"][Math.floor(rng()*5)];
        c.add(id,g,tipo);
      } else if(op<0.8){
        // rimozione dei turni automatici della cella
        c.st(id,g, c.gt(id,g).filter(s=>s.man));
      } else {
        c.st(id,g, [{tipo:"P",sott:rng()<0.3,man:false}]);
      }
    }
    for(const m of MEDICI){
      expect(c.cnt(m.id)).toBe(bruteCnt(T,m.id,NDIM));
      expect(c.cntN(m.id)).toBe(bruteCntN(T,m.id,NDIM));
    }
  });
});

describe("undo-log: mark/rollback e snapshot/restore", () => {
  it("rollback riporta T (e i contatori) esattamente allo stato del mark", () => {
    const T: TurniMese = { "1": { "3": { t:[{tipo:"M",sott:false,man:true}] } } };
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    const prima = JSON.stringify(norm(T));
    const cntPrima = MEDICI.map(m=>c.cnt(m.id));
    const m0 = c.mark();
    const rng = mkRng(7);
    for(let i=0;i<300;i++){
      const id = MEDICI[Math.floor(rng()*MEDICI.length)].id;
      const g  = 1+Math.floor(rng()*NDIM);
      if(rng()<0.7) c.add(id,g,["M","P","N"][Math.floor(rng()*3)]);
      else c.st(id,g, c.gt(id,g).filter(s=>s.man));
    }
    c.rollback(m0);
    expect(JSON.stringify(norm(T))).toBe(prima);
    expect(MEDICI.map(m=>c.cnt(m.id))).toEqual(cntPrima);
  });

  it("restore(snapshot) riallinea T e mantiene VALIDI i mark precedenti", () => {
    const T: TurniMese = {};
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    const m0 = c.mark();
    c.add(1,3,"M"); c.add(2,3,"P"); c.add(1,8,"N");
    const statoA = JSON.stringify(norm(T));
    const snapA = c.snapshot();
    // si continua a mutare...
    c.add(2,10,"M"); c.st(1,3,[]);
    // ...poi si ripristina "in avanti" lo stato A (pattern bestSnap delle fasi)
    c.restore(snapA);
    expect(JSON.stringify(norm(T))).toBe(statoA);
    expect(c.cnt(1)).toBe(bruteCnt(T,1,NDIM));
    // il mark preso PRIMA dello snapshot deve restare valido dopo il restore
    c.rollback(m0);
    expect(JSON.stringify(norm(T))).toBe(JSON.stringify({}));
    expect(MEDICI.every(m=>c.cnt(m.id)===0)).toBe(true);
  });
});

describe("Regola N (checkRegolaN)", () => {
  it("stretta: N → g+1 libero, g+2 senza mattine/notti e max 1 P", () => {
    // N il 3; M il 4 → violazione (g+1 occupato)
    let T: TurniMese = { "1": { "3": { t:[{tipo:"N",sott:false,man:false}] }, "4": { t:[{tipo:"M",sott:false,man:false}] } } };
    expect(makeCtx(ANNO,MESE,NDIM,MEDICI,T).checkRegolaN()).toBe(false);
    // N il 3; P il 5 → ok
    T = { "1": { "3": { t:[{tipo:"N",sott:false,man:false}] }, "5": { t:[{tipo:"P",sott:false,man:false}] } } };
    expect(makeCtx(ANNO,MESE,NDIM,MEDICI,T).checkRegolaN()).toBe(true);
    // N il 3; M il 5 → violazione (g+2 con mattina)
    T = { "1": { "3": { t:[{tipo:"N",sott:false,man:false}] }, "5": { t:[{tipo:"M",sott:false,man:false}] } } };
    expect(makeCtx(ANNO,MESE,NDIM,MEDICI,T).checkRegolaN()).toBe(false);
    // N il 3; N il 5 → violazione stretta, ma AMMESSA con relaxN
    T = { "1": { "3": { t:[{tipo:"N",sott:false,man:false}] }, "5": { t:[{tipo:"N",sott:false,man:false}] } } };
    expect(makeCtx(ANNO,MESE,NDIM,MEDICI,T).checkRegolaN()).toBe(false);
    expect(makeCtx(ANNO,MESE,NDIM,MEDICI,T,null,true).checkRegolaN()).toBe(true);
    // i codici SPEC a g+1 non violano
    T = { "1": { "3": { t:[{tipo:"N",sott:false,man:false}] }, "4": { t:[{tipo:"X",sott:false,man:true}] } } };
    expect(makeCtx(ANNO,MESE,NDIM,MEDICI,T).checkRegolaN()).toBe(false); // X a g+1 blocca la N (hasAnteN)
    T = { "1": { "3": { t:[{tipo:"N",sott:false,man:false}] } } };
    expect(makeCtx(ANNO,MESE,NDIM,MEDICI,T).checkRegolaN()).toBe(true);
  });

  it("continuità: una N sull'ultimo giorno del mese precedente vincola i giorni 1-2", () => {
    ENG.PREV = { ndim: 31, T: { "1": { "31": { t:[{tipo:"N",sott:false,man:true}] } } } };
    // giorno 1 lavorato → violazione
    let T: TurniMese = { "1": { "1": { t:[{tipo:"M",sott:false,man:false}] } } };
    expect(makeCtx(ANNO,MESE,NDIM,MEDICI,T).checkRegolaN()).toBe(false);
    // giorno 1 libero, giorno 2 P → ok
    T = { "1": { "2": { t:[{tipo:"P",sott:false,man:false}] } } };
    expect(makeCtx(ANNO,MESE,NDIM,MEDICI,T).checkRegolaN()).toBe(true);
    // giorno 2 M → violazione
    T = { "1": { "2": { t:[{tipo:"M",sott:false,man:false}] } } };
    expect(makeCtx(ANNO,MESE,NDIM,MEDICI,T).checkRegolaN()).toBe(false);
  });

  it("le guardie di add() rifiutano in silenzio i turni che violerebbero la Regola N", () => {
    const T: TurniMese = { "1": { "3": { t:[{tipo:"N",sott:false,man:false}] } } };
    const c = makeCtx(ANNO,MESE,NDIM,MEDICI,T);
    c.add(1,4,"M");                       // g+1 di una notte → rifiutato
    expect(c.gt(1,4).length).toBe(0);
    c.add(1,5,"M");                       // g+2 → mattina rifiutata
    expect(c.gt(1,5).length).toBe(0);
    c.add(1,5,"P");                       // g+2 → P ammesso
    expect(c.gt(1,5).length).toBe(1);
  });
});
