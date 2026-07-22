import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { dimOf } from "../date";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { makeCtx } from "../ctx";
import { misuraTabellone } from "../genera";

// ─── EQUITÀ DEL CARICO WEEKEND (v0.3.22) ─────────────────────────────────────
// Il carico weekend totale del mese è FISSO (calendario + minimi di fabbisogno):
// diviso per i portatori dà una forchetta [floor(W/n), ceil(W/n)]. `wkScarto`
// conta i punti fuori forchetta ed è il termine che il selettore globale usa
// per preferire, a parità di copertura, il tabellone equo.
//
// Regressione coperta: prima (varianza su mrMdc, peso 20) il tabellone
// weekend-perfetto poteva perdere contro uno sbilanciato solo perché aveva più
// strisce di mattine — la continuità batteva l'equità.

const anno = 2025, mese = 7;            // agosto 2025
const nd = dimOf(anno, mese);

const REG_MIN1 = {                      // minimi festivi a 1: l'MDC non può mai lavorare in weekend
  ...REGOLE_DEFAULT,
  fabb: {
    fer:  { mMin:2, mMax:3, pMin:1, pMax:2 },
    sab:  { mMin:1, mMax:2, pMin:1, pMax:1 },
    fest: { mMin:1, mMax:1, pMin:1, pMax:1 },
  },
};

const medici: Medico[] = [
  { id:1, nome:"MR 1",  codice:"1", stato:"MR",  obiettivo:16, ambulatorio:false },
  { id:2, nome:"MR 2",  codice:"2", stato:"MR",  obiettivo:16, ambulatorio:false },
  { id:3, nome:"MR 3",  codice:"3", stato:"MR",  obiettivo:16, ambulatorio:false },
  { id:4, nome:"ML",    codice:"4", stato:"ML",  obiettivo:20, ambulatorio:false },
  { id:5, nome:"MDC",   codice:"5", stato:"MDC", obiettivo:13, ambulatorio:false },
  { id:6, nome:"MPS",   codice:"6", stato:"MPS", obiettivo:0,  ambulatorio:false },
];

describe("equità carico weekend: popolazione dei portatori", () => {
  beforeEach(() => setRegole(REG_MIN1));

  it("esclude ML e MDC quando i minimi festivi valgono 1", () => {
    const c = makeCtx(anno, mese, nd, medici, {});
    expect(c.wkPortatori.map(m => m.id)).toEqual([1, 2, 3]);
  });

  it("include l'MDC se sulla fascia festiva c'è posto per un collega", () => {
    setRegole({ ...REG_MIN1, fabb: { ...REG_MIN1.fabb, fest: { mMin:1, mMax:2, pMin:1, pMax:1 } } });
    const c = makeCtx(anno, mese, nd, medici, {});
    expect(c.wkPortatori.map(m => m.id)).toContain(5);
  });

  it("esclude chi è in assenza manuale su TUTTI i giorni di weekend", () => {
    const T: TurniMese = {};
    const c0 = makeCtx(anno, mese, nd, medici, {});
    for(const g of c0.giorniArr) (T[3] ||= {})[g] = { t:[{ tipo:"L", man:true }] };
    const c = makeCtx(anno, mese, nd, medici, T);
    expect(c.wkPortatori.map(m => m.id)).toEqual([1, 2]);
  });

  it("pesoSlot: sabato mattina 0, notte festiva e prefestiva 2", () => {
    const c = makeCtx(anno, mese, nd, medici, {});
    expect(c.pesoSlot(2,  "M")).toBe(0);   // sabato 2 agosto: la mattina non conta
    expect(c.pesoSlot(2,  "P")).toBe(1);
    expect(c.pesoSlot(3,  "M")).toBe(1);   // domenica
    expect(c.pesoSlot(3,  "N")).toBe(2);
    expect(c.pesoSlot(14, "N")).toBe(2);   // notte prefestiva (il 15 è festivo)
    expect(c.pesoSlot(14, "P")).toBe(0);   // ma il pomeriggio del 14 è feriale
  });
});

describe("wkScarto: 0 solo sulla ripartizione aritmeticamente equa", () => {
  beforeEach(() => setRegole(REG_MIN1));

  // Costruisce un tabellone dando `quante` notti domenicali (peso 2) al medico
  // indicato: serve solo a produrre carichi weekend controllati.
  const conNotti = (piano: Record<number, number[]>): TurniMese => {
    const T: TurniMese = {};
    for(const idS in piano) for(const g of piano[idS]) (T[idS] ||= {})[g] = { t:[{ tipo:"N", man:false }] };
    return T;
  };

  const domeniche = [3, 10, 17, 24, 31];

  // 3 notti domenicali = 6 punti su 3 portatori → forchetta [2,2]
  const EQUO   = { 1:[3], 2:[10], 3:[17] };          // 2 / 2 / 2 ⇒ dentro
  const INIQUO = { 1:[3, 10, 17] };                  // 6 / 0 / 0 ⇒ 4+2+2 = 8 fuori

  it("scarto 0 quando i pesi stanno nella forchetta", () => {
    const m = misuraTabellone(anno, mese, nd, medici, conNotti(EQUO));
    expect(m.wkScarto).toBe(0);
  });

  it("scarto = punti fuori forchetta quando un medico li accumula tutti", () => {
    const m = misuraTabellone(anno, mese, nd, medici, conNotti(INIQUO));
    expect(m.wkScarto).toBe(8);
  });

  it("il soft premia il tabellone equo", () => {
    const mE = misuraTabellone(anno, mese, nd, medici, conNotti(EQUO));
    const mI = misuraTabellone(anno, mese, nd, medici, conNotti(INIQUO));
    expect(mE.soft).toBeLessThan(mI.soft);
  });

  it("con un solo portatore il termine è neutro (nessuna equità da misurare)", () => {
    const soli: Medico[] = [medici[0], medici[3], medici[5]];   // 1 MR + ML + MPS
    const T = conNotti({ 1: domeniche });
    const m = misuraTabellone(anno, mese, nd, soli, T);
    expect(m.wkScarto).toBe(0);
  });
});
