import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { makeCtx } from "../ctx";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt } from "../state";

// Un solo medico MR basta: la regola è pura (canN/add), non dipende dagli altri.
const MEDICI: Medico[] = [
  { id:1, nome:"A. UNO", codice:"1", stato:"MR", obiettivo:25, ambulatorio:false },
];
const ANNO = 2026, MESE = 5, NDIM = 30;   // giugno 2026

// Notte MANUALE sul giorno g (i manuali sono inviolabili → li usiamo per
// preparare la catena senza passare dalle guardie).
const nMan = (g:number): TurniMese => ({ "1": { [g]: { t:[{tipo:"N",sott:false,man:true}] } } });
const merge = (...ts: TurniMese[]): TurniMese => {
  const out: TurniMese = { "1": {} };
  for(const t of ts) for(const g in t["1"]) out["1"][g] = t["1"][g];
  return out;
};

beforeEach(()=>{
  setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));  // maxNottiConsec = 2
  ENG.PREV = null;
  setSalt(0);
});

describe("max notti di fila (catena a passo 2)", () => {
  it("con default=2: la 3ª notte di una catena N-libero-N-libero-N è vietata", () => {
    // Notti manuali a g1 e g3 (relaxN ammette la spaziatura a passo 2).
    const T = merge(nMan(1), nMan(3));
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T, null, /*relaxN*/true);
    // g5 chiuderebbe la catena a 3 → deve essere rifiutato.
    expect(c.canN(1, 5)).toBe(false);
  });

  it("con default=2: la 2ª notte (N-libero-N) resta ammessa", () => {
    const T = merge(nMan(1));
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T, null, true);
    expect(c.canN(1, 3)).toBe(true);   // catena = 2 ≤ 2
  });

  it("notti a 3+ giorni (≥2 liberi in mezzo) NON fanno catena", () => {
    // g1 e g4: due giorni liberi in mezzo → nessuna catena, g7 resta libero.
    const T = merge(nMan(1), nMan(4));
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T, null, true);
    expect(c.canN(1, 7)).toBe(true);
  });

  it("blocca anche l'inserimento IN MEZZO (notti a g3 e g7 → g5 vietato)", () => {
    const T = merge(nMan(3), nMan(7));
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T, null, true);
    expect(c.canN(1, 5)).toBe(false);   // 3+5+7 = 3 notti di fila
  });

  it("la guardia di add() non inserisce mai la notte di troppo (rete di sicurezza)", () => {
    const T = merge(nMan(1), nMan(3));
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T, null, true);
    c.add(1, 5, "N");                   // inserimento AUTOMATICO
    expect(c.haN(1, 5)).toBe(false);    // rifiutato: avrebbe fatto 3 di fila
  });

  it("il tetto è CONFIGURABILE: con maxNottiConsec=3 la 3ª notte diventa ammessa", () => {
    setRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), maxNottiConsec: 3 });
    const T = merge(nMan(1), nMan(3));
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T, null, true);
    expect(c.canN(1, 5)).toBe(true);    // catena = 3 ≤ 3
  });

  it("catena a cavallo di mese: una notte a fine mese precedente conta", () => {
    // Coda del mese M-1: notte sull'ultimo giorno (g=0 nella vista del corrente).
    ENG.PREV = { anno: ANNO, mese: MESE-1, ndim: 31,
      T: { "1": { "31": { t:[{tipo:"N",sott:false,man:true}] } } } } as any;
    const T = merge(nMan(2));           // notte a g2 del mese corrente
    const c = makeCtx(ANNO, MESE, NDIM, MEDICI, T, null, true);
    // g0(prev) + g2 + g4 = 3 di fila → g4 vietato.
    expect(c.canN(1, 4)).toBe(false);
  });
});
