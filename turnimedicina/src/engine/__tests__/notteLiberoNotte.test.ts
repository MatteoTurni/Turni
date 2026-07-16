import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { makeCtx } from "../ctx";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt } from "../state";

// ─── v0.3.11: (1) le notti "3" e le varianti sottolineate consumano il tetto
// maxNotti; (2) la deroga notte→libero→notte è una regola configurabile che
// vale anche per la generazione di base e per la validazione. ─────────────────

const MEDICI: Medico[] = [
  { id:1, nome:"A. UNO", codice:"1", stato:"MR", obiettivo:25, ambulatorio:false },
  { id:2, nome:"B. DUE", codice:"2", stato:"MR", obiettivo:25, ambulatorio:false },
];
const ANNO = 2026, MESE = 5, NDIM = 30;   // giugno 2026

const cella = (g:number, tipo:string, sott=false): TurniMese =>
  ({ "1": { [g]: { t:[{tipo, sott, man:true}] } } });
const merge = (...ts: TurniMese[]): TurniMese => {
  const out: TurniMese = { "1": {} };
  for(const t of ts) for(const g in t["1"]) out["1"][g] = t["1"][g];
  return out;
};
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));

beforeEach(()=>{
  setRegole(dft());
  ENG.PREV = null;
  setSalt(0);
});

describe("mergeRegole: notteLiberoNotte", () => {
  it("campo assente (salvataggi vecchi) → default false", () => {
    expect(mergeRegole({ maxNotti: 4 } as any).notteLiberoNotte).toBe(false);
    expect(mergeRegole(null).notteLiberoNotte).toBe(false);
  });
  it("campo presente → rispettato; non-boolean → coercizione", () => {
    expect(mergeRegole({ notteLiberoNotte: true } as any).notteLiberoNotte).toBe(true);
    expect(mergeRegole({ notteLiberoNotte: 1 } as any).notteLiberoNotte).toBe(true);
    expect(mergeRegole({ notteLiberoNotte: 0 } as any).notteLiberoNotte).toBe(false);
  });
});

describe("tetto maxNotti: contano N, 3 e sottolineate", () => {
  it("le notti '3' consumano il budget: con maxNotti=2 e due '3', niente N automatica", () => {
    setRegole({ ...dft(), maxNotti: 2 });
    const T = merge(cella(1,"3"), cella(10,"3"));
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    expect(c.cntN(1)).toBe(2);
    expect(c.canR(MEDICI[0], 20, "N")).toBe(false);   // budget esaurito
    expect(c.canR(MEDICI[1], 20, "N")).toBe(true);    // l'altro medico resta libero
  });

  it("anche le varianti SOTTOLINEATE contano (N e 3)", () => {
    setRegole({ ...dft(), maxNotti: 2 });
    const T = merge(cella(1,"N",true), cella(10,"3",true));
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    expect(c.cntN(1)).toBe(2);
    expect(c.canR(MEDICI[0], 20, "N")).toBe(false);
  });

  it("sotto il tetto la notte resta assegnabile", () => {
    setRegole({ ...dft(), maxNotti: 2 });
    const T = merge(cella(1,"3",true));
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    expect(c.cntN(1)).toBe(1);
    expect(c.canR(MEDICI[0], 20, "N")).toBe(true);
  });
});

describe("regola notteLiberoNotte (N-libero-N in generazione base)", () => {
  it("OFF (default): a g+2 di una notte la N resta vietata senza relaxN", () => {
    const T = cella(1,"N");
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);   // nessun relaxN
    expect(c.canN(1, 3)).toBe(false);
  });

  it("ON: a g+2 di una notte la N è ammessa anche senza relaxN", () => {
    setRegole({ ...dft(), notteLiberoNotte: true });
    const T = cella(1,"N");
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    expect(c.canN(1, 3)).toBe(true);
    expect(c.canN(1, 2)).toBe(false);   // g+1 resta SEMPRE libero
  });

  it("ON: add() inserisce la N a g+2 e checkRegolaN non la segnala", () => {
    setRegole({ ...dft(), notteLiberoNotte: true });
    const T = cella(1,"N");
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    c.add(1, 3, "N");
    expect(c.haN(1, 3)).toBe(true);
    expect(c.checkRegolaN()).toBe(true);
  });

  it("OFF: un N-libero-N automatico resta una violazione (checkRegolaN=false)", () => {
    const T = cella(1,"N");
    const cRel = makeCtx(ANNO, MESE, NDIM, MEDICI, T, null, true);  // come l'ultima chance
    cRel.add(1, 3, "N");
    expect(cRel.haN(1, 3)).toBe(true);
    // validazione STRETTA su un T che contiene la coppia N-libero-N automatica
    const cStr = makeCtx(ANNO, MESE, NDIM, MEDICI, cRel.T);
    expect(cStr.checkRegolaN()).toBe(false);
  });

  it("ON: il tetto maxNottiConsec resta attivo sulle catene a passo 2", () => {
    setRegole({ ...dft(), notteLiberoNotte: true });   // maxNottiConsec = 2
    const T = merge(cella(1,"N"), cella(3,"N"));
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T);
    expect(c.canN(1, 5)).toBe(false);   // 3ª notte della catena → vietata
  });
});
