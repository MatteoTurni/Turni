import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../regole";
import { makeCtx } from "../ctx";
import { faseAmbulatorio } from "../fasi";
import { dimOf, dowOf, isFestivo } from "../date";
import { ENG, setAmbRotStart } from "../state";

// ─── EQUITÀ DEGLI AMBULATORI (v0.3.34) ────────────────────────────────────────
// La rotazione ordina per CARICO EFFETTIVO del mese (A manuali comprese) e usa
// la posizione nel round-robin solo come spareggio. Il caso che si rompeva:
// 4 abilitati, 4 martedì e una A MANUALE su un abilitato → quello prendeva
// sempre 2 ambulatori e un altro restava a 0, per OGNI indice di rotazione.

const medici = (): Medico[] => ([
  { id:1, nome:"Uno",     codice:"u", stato:"MR",  obiettivo:26, ambulatorio:true  },
  { id:2, nome:"Due",     codice:"d", stato:"MR",  obiettivo:26, ambulatorio:true  },
  { id:3, nome:"Tre",     codice:"t", stato:"MR",  obiettivo:26, ambulatorio:true  },
  { id:4, nome:"Quattro", codice:"q", stato:"MR",  obiettivo:26, ambulatorio:true  },
  { id:5, nome:"Cinque",  codice:"c", stato:"MR",  obiettivo:26, ambulatorio:false },
  { id:6, nome:"Sei",     codice:"s", stato:"MR",  obiettivo:26, ambulatorio:false },
  { id:7, nome:"Sette",   codice:"e", stato:"ML",  obiettivo:24, ambulatorio:false },
  { id:8, nome:"Otto",    codice:"o", stato:"MDC", obiettivo:20, ambulatorio:false },
]);
const anno=2026, mese=8, nd=dimOf(anno,mese);              // settembre 2026
const martedi = () => { const g:number[]=[];
  for(let i=1;i<=nd;i++) if(dowOf(anno,mese,i)===1 && !isFestivo(anno,mese,i)) g.push(i); return g; };
const conteggi = (T:TurniMese, gg:number[]) =>
  [1,2,3,4].map(id => gg.filter(g=>(T[id]?.[g]?.t||[]).some(s=>s.tipo==="A")).length);

beforeEach(()=>{
  setRegole(mergeRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT))));
  ENG.PREV=null;
});

describe("faseAmbulatorio: equità", () => {
  it("senza manuali distribuisce uno a testa, per ogni indice di rotazione", () => {
    const gg = martedi();
    for(let rot=0; rot<4; rot++){
      setAmbRotStart(rot);
      const T: TurniMese = {};
      const ctx = makeCtx(anno,mese,nd,medici(),T);
      expect(faseAmbulatorio(ctx)).toBe(true);
      const c = conteggi(ctx.T, gg);
      expect(Math.max(...c)-Math.min(...c)).toBeLessThanOrEqual(1);
    }
  });

  it("una A MANUALE conta come carico: chi ce l'ha non ne riceve una seconda", () => {
    const gg = martedi();
    const primo = gg[0];
    for(let rot=0; rot<4; rot++){
      setAmbRotStart(rot);
      // A manuale sul medico 1 nel primo giorno d'ambulatorio del mese.
      const T: TurniMese = { 1:{ [primo]:{t:[{tipo:"A",sott:false,man:true}]} } };
      const ctx = makeCtx(anno,mese,nd,medici(),T);
      expect(faseAmbulatorio(ctx)).toBe(true);
      const c = conteggi(ctx.T, gg);
      expect(c[0]).toBe(1);                                  // NON ne prende due
      expect(Math.min(...c)).toBeGreaterThanOrEqual(1);      // nessuno resta a zero
      expect(Math.max(...c)-Math.min(...c)).toBeLessThanOrEqual(1);
    }
  });

  it("la rotazione fra mesi è preservata: a carichi pari parte dal cursore", () => {
    const gg = martedi();
    for(let rot=0; rot<4; rot++){
      setAmbRotStart(rot);
      const ctx = makeCtx(anno,mese,nd,medici(),{});
      faseAmbulatorio(ctx);
      // il primo giorno del mese, con tutti a zero, va all'indice del cursore
      const atteso = rot+1;
      expect((ctx.T[atteso]?.[gg[0]]?.t||[]).some(s=>s.tipo==="A")).toBe(true);
    }
  });
});
