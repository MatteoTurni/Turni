import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { dimOf } from "../date";
import { SPEC, isNot } from "../turni";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart, conDeadline, scaduto } from "../state";
import { makeCtx } from "../ctx";
import { generaMigliorTentativo, misuraTabellone, compattaTurni } from "../genera";

const medici = (): Medico[] => [
  { id:1,  nome:"A", codice:"1",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:2,  nome:"B", codice:"2",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:3,  nome:"C", codice:"3",  stato:"MDC", obiettivo:21, ambulatorio:false },
  { id:4,  nome:"D", codice:"4",  stato:"ML",  obiettivo:25, ambulatorio:false },
  { id:5,  nome:"E", codice:"5",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:6,  nome:"F", codice:"6",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:7,  nome:"G", codice:"7",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:8,  nome:"H", codice:"8",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:9,  nome:"I", codice:"9",  stato:"MR",  obiettivo:25, ambulatorio:false },
];

const ferieLunghe = (): TurniMese => {
  const T: TurniMese = {};
  const metti = (id:number,da:number,a:number) => {
    for(let g=da; g<=a; g++) (T[id] ||= {})[g] = { t:[{ tipo:"L", sott:false, man:true }] };
  };
  metti(1,1,15); metti(7,1,15); metti(2,10,24); metti(5,16,31); metti(9,16,31);
  return T;
};

beforeEach(()=>{
  setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));
  ENG.PREV = null; ENG.DEADLINE = 0;
  setSalt(0); setAmbRotStart(0);
});

describe("deadline dura (v0.3.28)", () => {
  it("un mese difficile rispetta il budget con un margine limitato", () => {
    const anno=2026, mese=7, nd=dimOf(anno,mese);
    const t0 = Date.now();
    const r = generaMigliorTentativo(anno, mese, nd, medici(), ferieLunghe(), 1500);
    const ms = Date.now() - t0;
    expect(r.turni).toBeTruthy();
    // budget 1.5s: ricerca ≤1.5s + rifinitura cappata (ripara/riequilibri/UC/diagnosi).
    // Prima del fix lo stesso scenario superava i 4 MINUTI.
    expect(ms).toBeLessThan(15000);
    expect(ENG.DEADLINE).toBe(0);            // sempre ripristinata
  });
  it("conDeadline ripristina e scaduto() rispetta l'annidamento", () => {
    expect(scaduto()).toBe(false);
    const r = conDeadline(Date.now()-1, () => scaduto());
    expect(r).toBe(true);
    expect(ENG.DEADLINE).toBe(0);
    // deadline esterna più stretta resta prioritaria
    conDeadline(Date.now()-1, () => {
      conDeadline(Date.now()+60000, () => { expect(scaduto()).toBe(true); });
    });
  });
});

describe("organicità (v0.3.28)", () => {
  it("misuraTabellone espone lavIso e quickPM", () => {
    const anno=2026, mese=5, nd=dimOf(anno,mese);
    const T: TurniMese = {
      1: { 10:{t:[{tipo:"M",sott:false,man:false}]} },                    // giorno isolato
      2: { 10:{t:[{tipo:"P",sott:false,man:false}]},
           11:{t:[{tipo:"M",sott:false,man:false}]} },                    // rientro rapido P→M
    };
    const m = misuraTabellone(anno, mese, nd, medici(), T);
    expect(m.lavIso).toBe(1);                     // la M isolata del medico 1 (il blocco di 2 del medico 2 no)
    expect(m.quickPM).toBe(1);
    // la notte isolata NON conta come frammento (il riposo la circonda per regola)
    const TN: TurniMese = { 1: { 10:{t:[{tipo:"N",sott:false,man:false}]} } };
    expect(misuraTabellone(anno, mese, nd, medici(), TN).lavIso).toBe(0);
  });

  it("compattaTurni riduce i frammenti senza toccare copertura, weekend e regole", () => {
    const anno=2026, mese=5, nd=dimOf(anno,mese);
    const med = medici();
    // tabellone reale di partenza: generazione breve (contiene frammenti)
    const r = generaMigliorTentativo(anno, mese, nd, med, {}, 800);
    const prima = misuraTabellone(anno, mese, nd, med, r.turni);
    const copia: TurniMese = JSON.parse(JSON.stringify(r.turni));
    const c = makeCtx(anno, mese, nd, med, copia);
    compattaTurni(anno, mese, nd, med, c);
    const dopo = misuraTabellone(anno, mese, nd, med, copia);
    expect(dopo.s).toBeLessThanOrEqual(prima.s);                 // mai un buco/violazione in più
    expect(dopo.wkScarto).toBeLessThanOrEqual(prima.wkScarto);   // equità weekend intoccata
    expect(dopo.lavIso + dopo.quickPM).toBeLessThanOrEqual(prima.lavIso + prima.quickPM);
    // nessun turno manuale perso, nessun turno auto su giorni di riposo post-notte
    for(const m of med){
      for(let g=1; g<=nd; g++){
        const sh = copia[m.id]?.[g]?.t || [];
        if(sh.some(s=>isNot(s.tipo)) && g+1<=nd){
          const dopoN = copia[m.id]?.[g+1]?.t || [];
          expect(dopoN.some(s=>!SPEC.includes(s.tipo))).toBe(false);
        }
      }
    }
  });

  it("la generazione resta senza violazioni e i frammenti calano rispetto al motore cieco", () => {
    const anno=2026, mese=5, nd=dimOf(anno,mese);
    const med = medici();
    const r = generaMigliorTentativo(anno, mese, nd, med, {}, 2000);
    expect(r.ok).toBe(true);
    const m = misuraTabellone(anno, mese, nd, med, r.turni);
    expect(m.s).toBe(0);
    // taratura empirica dall'harness: senza organicità lavIso≈12-16 su questo
    // scenario; con la rifinitura deve stare ampiamente sotto.
    expect(m.lavIso).toBeLessThanOrEqual(8);
  });
});
