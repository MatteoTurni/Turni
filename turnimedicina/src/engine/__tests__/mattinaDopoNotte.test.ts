import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese, Regole } from "../types";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../regole";
import { makeCtx } from "../ctx";
import { validazioneGlobale } from "../fasi";
import { generaMigliorTentativo, misuraTabellone } from "../genera";
import { dimOf } from "../date";
import { ENG } from "../state";

// ─── MATTINA AL 2° GIORNO DOPO LA NOTTE (v0.3.33) ─────────────────────────────
// Regola configurabile `mattinaDopoNotte`: a g+2 di una notte è ammessa anche
// una Mattina. Ortogonale a notteLiberoNotte, neutralizzata da riposoEsteso.

const medici = (): Medico[] => ([
  { id:1, nome:"A", codice:"a", stato:"MR",  obiettivo:22, ambulatorio:true  },
  { id:2, nome:"B", codice:"b", stato:"MR",  obiettivo:22, ambulatorio:true  },
  { id:3, nome:"C", codice:"c", stato:"MR",  obiettivo:22, ambulatorio:false },
  { id:4, nome:"D", codice:"d", stato:"MR",  obiettivo:22, ambulatorio:false },
  { id:5, nome:"E", codice:"e", stato:"MR",  obiettivo:22, ambulatorio:false },
  { id:6, nome:"F", codice:"f", stato:"MR",  obiettivo:22, ambulatorio:false },
  { id:7, nome:"G", codice:"g", stato:"ML",  obiettivo:20, ambulatorio:false },
  { id:8, nome:"H", codice:"h", stato:"MDC", obiettivo:18, ambulatorio:false },
  { id:9, nome:"I", codice:"i", stato:"MPS", obiettivo:0,  ambulatorio:false },
]);
const anno=2026, mese=5, nd=dimOf(anno,mese);   // giugno 2026
// Notte manuale al giorno 3 → g+2 = giorno 5.
const conNotte = (): TurniMese => ({ 1:{ 3:{t:[{tipo:"N",sott:false,man:true}]} } });
const reg = (extra: Partial<typeof REGOLE_DEFAULT>) =>
  setRegole(mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), ...extra } as any));

beforeEach(()=>{ ENG.PREV=null; });

describe("regola mattinaDopoNotte", () => {
  it("OFF (default): la M a g+2 di una notte resta vietata", () => {
    reg({});
    const c = makeCtx(anno,mese,nd,medici(),conNotte());
    expect(c.canMatt(1,5)).toBe(false);
    expect(c.canPom(1,5)).toBe(true);          // il P a g+2 era ed è ammesso
  });

  it("ON: la M a g+2 diventa ammessa, il giorno DOPO la notte resta libero", () => {
    reg({ mattinaDopoNotte:true });
    const c = makeCtx(anno,mese,nd,medici(),conNotte());
    expect(c.canMatt(1,5)).toBe(true);         // g+2: sbloccata
    expect(c.canMatt(1,4)).toBe(false);        // g+1: sempre libero, invariante
    expect(c.canLav(1,4)).toBe(false);
  });

  it("ON: una M a g+2 non è più segnalata come violazione della Regola N", () => {
    // Tabellone minimo: N manuale (g3) + M AUTOMATICA (g5). La M dev'essere
    // automatica perché la validazione non imputa al motore i conflitti fra due
    // manuali (scelta dell'utente). Le altre segnalazioni (copertura mancante)
    // sono attese e vengono filtrate: qui interessa SOLO la voce della Regola N.
    const T: TurniMese = { 1:{ 3:{t:[{tipo:"N",sott:false,man:true}]},
                               5:{t:[{tipo:"M",sott:false,man:false}]} } };
    const regolaN = (r:Regole|null) => {
      if(r) setRegole(r); 
      return validazioneGlobale(makeCtx(anno,mese,nd,medici(),T))
        .filter(p=>p.includes("Regola N"));
    };
    reg({});
    expect(regolaN(null)).toEqual(["Violazione Regola N / distanza associati"]);
    reg({ mattinaDopoNotte:true });
    expect(regolaN(null)).toEqual([]);
  });

  it("riposoEsteso vince: neutralizza mattinaDopoNotte", () => {
    reg({ mattinaDopoNotte:true, riposoEsteso:true });
    const c = makeCtx(anno,mese,nd,medici(),conNotte());
    expect(c.canMatt(1,5)).toBe(false);
    expect(c.canPom(1,5)).toBe(false);         // col riposo esteso g+2 è tutto libero
  });

  it("è ortogonale a notteLiberoNotte: possono convivere", () => {
    reg({ mattinaDopoNotte:true, notteLiberoNotte:true });
    const c = makeCtx(anno,mese,nd,medici(),conNotte());
    expect(c.canMatt(1,5)).toBe(true);
    expect(c.canN(1,5)).toBe(true);            // N a g+2 grazie a notteLiberoNotte
    reg({ mattinaDopoNotte:true });
    const c2 = makeCtx(anno,mese,nd,medici(),conNotte());
    expect(c2.canMatt(1,5)).toBe(true);
    expect(c2.canN(1,5)).toBe(false);          // senza notteLiberoNotte la N resta vietata
  });

  it("generazione: con la regola ON il mese resta valido e senza violazioni", () => {
    reg({ mattinaDopoNotte:true });
    const r = generaMigliorTentativo(anno,mese,nd,medici(),{},4000);
    const m = misuraTabellone(anno,mese,nd,medici(),r.turni);
    expect(m.probs).toEqual([]);
    expect(m.buchi).toBe(0);
  });
});
