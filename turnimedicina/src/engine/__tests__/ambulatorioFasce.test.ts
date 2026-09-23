import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { dimOf, dowOf, isHol } from "../date";
import { isPom, isMatt, vt } from "../turni";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../regole";
import { setSalt, setAmbRotStart, setPrevContext } from "../state";
import { generaMigliorTentativo, calcAmbRotNext } from "../genera";
import { dettaglioFabbisogno } from "../bilancio";

// ── FASCIA DELL'AMBULATORIO (v0.3.35) ────────────────────────────────────────
// Dal pannello Regole ogni giorno d'ambulatorio può essere di mattina (A,
// storico), di pomeriggio (Ap) o di mattina + pomeriggio (A e Ap).

const mediciTest = (): Medico[] => [
  { id:1,  nome:"D. BALDI",      codice:"1",  stato:"MR",  obiettivo:25, ambulatorio:false },
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

const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
// Ambulatorio storico "A" con le fasce date per giorno della settimana.
const conFasce = (giorni: Record<number,string>) =>
  mergeRegole({ ...dft(), ambulatori:[{ id:"A", nome:"Ambulatorio", sigla:"A", giorni }] } as any);
const chi = (T:TurniMese, medici:Medico[], g:number, cod:string) =>
  medici.filter(m=>(T[m.id]?.[g]?.t||[]).some(s=>s.tipo===cod));

beforeEach(()=>{ setSalt(0); setAmbRotStart(0); setPrevContext(null, 2026, 5); setRegole(dft()); });
afterEach(()=>{ setRegole(dft()); });

describe("codice Ap", () => {
  it("è un turno di pomeriggio che pesa 1", () => {
    expect(isPom("Ap")).toBe(true);
    expect(isMatt("Ap")).toBe(false);
    expect(vt("Ap")).toBe(1);
  });
});

describe("mergeRegole: fasce del vecchio formato (v0.3.35)", () => {
  it("fasceAmb converte nei giorni dell'ambulatorio \"A\"; valori non validi → mattina", () => {
    const r = mergeRegole({ giorniAmb:[1,2,3,4], fasceAmb: { 1:"P", 2:"MP", 3:"M", 4:"boh", 7:"P" } } as any);
    expect(r.ambulatori[0].giorni).toEqual({ 1:"P", 2:"MP", 3:"M", 4:"M" });
  });
});

describe("fabbisogno: gli slot d'ambulatorio seguono la fascia", () => {
  it("mattina+pomeriggio conta 2 slot per giorno", () => {
    const anno=2026, mese=5, nd=dimOf(anno,mese);   // giugno 2026 (2/6 festivo di martedì)
    const a1 = dettaglioFabbisogno(anno, mese, nd, mergeRegole(dft())).a;
    const a2 = dettaglioFabbisogno(anno, mese, nd, conFasce({1:"MP"})).a;
    const aP = dettaglioFabbisogno(anno, mese, nd, conFasce({1:"P"})).a;
    expect(a2).toBe(2*a1);
    expect(aP).toBe(a1);
  });
});

describe("generazione con ambulatorio di pomeriggio", () => {
  const anno=2026, mese=5;

  it("solo pomeriggio: ogni martedì feriale ha una Ap (a un abilitato) e nessuna A", () => {
    setRegole(conFasce({1:"P"}));
    const nd=dimOf(anno,mese), medici=mediciTest();
    const r = generaMigliorTentativo(anno, mese, nd, medici, {}, 3000);
    // Nessun problema d'ambulatorio. (r.ok non si pretende: sotto carico il
    // multi-tentativo a tempo può mancare di rado un weekend libero, ~1 run su
    // 20 anche a regole di default — non dipende dagli ambulatori.)
    expect(r.problemi.filter(p=>/ambulatorio/i.test(p))).toEqual([]);
    for(let g=1; g<=nd; g++){
      const amb = dowOf(anno,mese,g)===1 && !isHol(anno,mese,g);
      const ap = chi(r.turni, medici, g, "Ap"), a = chi(r.turni, medici, g, "A");
      expect(a.length).toBe(0);
      if(amb){
        expect(ap.length).toBe(1);
        expect(ap[0].ambulatorio).toBe(true);
      } else expect(ap.length).toBe(0);
    }
  });

  it("mattina + pomeriggio: A e Ap presenti, di norma a medici diversi", () => {
    setRegole(conFasce({1:"MP"}));
    const nd=dimOf(anno,mese), medici=mediciTest();
    const r = generaMigliorTentativo(anno, mese, nd, medici, {}, 3000);
    // Nessun problema d'ambulatorio. (r.ok non si pretende: sotto carico il
    // multi-tentativo a tempo può mancare di rado un weekend libero, ~1 run su
    // 20 anche a regole di default — non dipende dagli ambulatori.)
    expect(r.problemi.filter(p=>/ambulatorio/i.test(p))).toEqual([]);
    for(let g=1; g<=nd; g++){
      if(dowOf(anno,mese,g)!==1 || isHol(anno,mese,g)) continue;
      const a = chi(r.turni, medici, g, "A"), ap = chi(r.turni, medici, g, "Ap");
      expect(a.length).toBe(1);
      expect(ap.length).toBe(1);
      expect(a[0].ambulatorio && ap[0].ambulatorio).toBe(true);
      expect(a[0].id).not.toBe(ap[0].id);
    }
  });

  it("la Ap manuale viene rispettata e non duplicata", () => {
    setRegole(conFasce({1:"MP"}));
    const nd=dimOf(anno,mese), medici=mediciTest();
    expect(dowOf(anno,mese,9)).toBe(1);
    const T: TurniMese = { "5": { "9": { t:[{tipo:"Ap",sott:false,man:true}] } } };
    const r = generaMigliorTentativo(anno, mese, nd, medici, T, 3000);
    const ap = chi(r.turni, medici, 9, "Ap");
    expect(ap.map(m=>m.id)).toEqual([5]);
    expect(chi(r.turni, medici, 9, "A").length).toBe(1);
  });

  it("calcAmbRotNext conta anche le Ap automatiche", () => {
    setRegole(conFasce({1:"P"}));
    const nd=dimOf(anno,mese), medici=mediciTest();   // abilitati: ids 2,5,6,8 → indici 0..3
    const T: TurniMese = { "6": { "23": { t:[{tipo:"Ap",sott:false,man:false}] } } };
    expect(dowOf(anno,mese,23)).toBe(1);
    expect(calcAmbRotNext(T, medici, anno, mese, nd, 0)).toBe(3);
  });
});
