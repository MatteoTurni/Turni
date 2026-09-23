import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt } from "../state";
import { makeCtx } from "../ctx";
import { catenaContinuita } from "../fasi";

// ── SQUADRA SENZA ML: il caso "ML manca tutto il mese" → la catena copre da 1 a fine
const mediciNoML = (): Medico[] => [
  { id:1, nome:"D. BALDI",      codice:"1", stato:"MR", obiettivo:25, ambulatorio:false },
  { id:2, nome:"M. RENIS",      codice:"2", stato:"MR", obiettivo:25, ambulatorio:false },
  { id:3, nome:"C. CIAMPA",     codice:"3", stato:"MR", obiettivo:25, ambulatorio:false },
  { id:4, nome:"M. STEFANUCCI", codice:"4", stato:"MR", obiettivo:25, ambulatorio:false },
  { id:5, nome:"V. GIORDANO",   codice:"5", stato:"MR", obiettivo:25, ambulatorio:false },
];

const ANNO = 2026, MESE = 5, NDIM = 30;  // giugno 2026: g1 lunedì

beforeEach(() => {
  setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));
  ENG.PREV = null;
  setSalt(0);
});

const mDi = (ctx: any, id: number, g: number) =>
  ctx.gt(id, g).some((s: any) => s.tipo === "M");

describe("mergeRegole: blocchiMattina", () => {
  it("campo assente (salvataggi pre-v0.3.17) → default", () => {
    expect(mergeRegole({ maxNotti: 4 } as any).blocchiMattina).toBe(REGOLE_DEFAULT.blocchiMattina);
  });
  it("presente e valido → conservato; 0 è legittimo (catena off)", () => {
    expect(mergeRegole({ blocchiMattina: 3 } as any).blocchiMattina).toBe(3);
    expect(mergeRegole({ blocchiMattina: 0 } as any).blocchiMattina).toBe(0);
  });
  it("valori invalidi → default", () => {
    expect(mergeRegole({ blocchiMattina: -1 } as any).blocchiMattina).toBe(REGOLE_DEFAULT.blocchiMattina);
    expect(mergeRegole({ blocchiMattina: 2.5 } as any).blocchiMattina).toBe(REGOLE_DEFAULT.blocchiMattina);
    expect(mergeRegole({ blocchiMattina: "tre" } as any).blocchiMattina).toBe(REGOLE_DEFAULT.blocchiMattina);
  });
});

describe("catenaContinuita", () => {
  it("K=0: non tocca il tabellone (comportamento storico)", () => {
    setRegole(mergeRegole({ ...REGOLE_DEFAULT, blocchiMattina: 0 }));
    const ctx = makeCtx(ANNO, MESE, NDIM, mediciNoML(), {});
    catenaContinuita(ctx);
    for (const m of mediciNoML()) for (let g = 1; g <= NDIM; g++)
      expect(ctx.gt(m.id, g).length).toBe(0);
  });

  it("senza ML copre i feriali entro il MINIMO, senza mai sforare il tetto", () => {
    setRegole(mergeRegole({ ...REGOLE_DEFAULT, blocchiMattina: 4 }));
    const ctx = makeCtx(ANNO, MESE, NDIM, mediciNoML(), {});
    catenaContinuita(ctx);
    const { feriali, nmn, cf } = ctx;
    for (const g of feriali) {
      expect(cf(g, "M")).toBeGreaterThanOrEqual(1);
      expect(cf(g, "M")).toBeLessThanOrEqual(nmn(g).mn);   // MAI oltre il minimo
    }
  });

  it("produce continuità: blocchi pluri-giorno e poche mattine orfane", () => {
    setRegole(mergeRegole({ ...REGOLE_DEFAULT, blocchiMattina: 4 }));
    const ctx = makeCtx(ANNO, MESE, NDIM, mediciNoML(), {});
    catenaContinuita(ctx);
    const { feriali } = ctx;
    // run-length delle M vere per medico sull'asse dei feriali
    const runs: number[] = [];
    for (const m of mediciNoML()) {
      let r = 0;
      for (const g of feriali) {
        if (mDi(ctx, m.id, g)) r++;
        else if (r) { runs.push(r); r = 0; }
      }
      if (r) runs.push(r);
    }
    const media = runs.reduce((a, b) => a + b, 0) / runs.length;
    const orfane = runs.filter(r => r === 1).length;
    // Con corsie sfalsate su un mese pulito la continuità è netta: blocchi
    // mediamente ≥2 giorni e non più della metà delle strisce isolate.
    expect(media).toBeGreaterThanOrEqual(2);
    expect(orfane).toBeLessThanOrEqual(runs.length / 2);
    // esiste almeno un blocco lungo (≥3) — la catena "porta" davvero
    expect(runs.some(r => r >= 3)).toBe(true);
  });

  it("PAUSA: un impedimento di un giorno (turno PS '1') non spezza il blocco del portatore", () => {
    setRegole(mergeRegole({ ...REGOLE_DEFAULT, blocchiMattina: 4 }));
    // id1 (primo portatore a parità di carico) ha un "1" manuale il g4 (giovedì).
    const T: TurniMese = { 1: { 4: { t: [{ tipo: "1", sott: false, man: true }] } } };
    const ctx = makeCtx(ANNO, MESE, NDIM, mediciNoML(), T);
    catenaContinuita(ctx);
    // Se id1 porta il blocco che include g3 e g5, il g4 è coperto da un
    // supplente (≠ id1) e la M vera di id1 NON è nel g4: il "1" è una pausa.
    if (mDi(ctx, 1, 3) && mDi(ctx, 1, 5)) {
      expect(mDi(ctx, 1, 4)).toBe(false);
      expect(ctx.cf(4, "M")).toBeGreaterThanOrEqual(1);   // qualcuno copre comunque
    }
  });

  it("rispetta le mattine del ML: nei giorni coperti dal ML la catena non le rimuove", () => {
    setRegole(mergeRegole({ ...REGOLE_DEFAULT, blocchiMattina: 4 }));
    const medici: Medico[] = [
      ...mediciNoML(),
      { id: 9, nome: "A. DEL GATTO", codice: "9", stato: "ML", obiettivo: 25, ambulatorio: false },
    ];
    // ML in tabellone su tutti i feriali TRANNE g8..g12 (tratto scoperto lì).
    const T: TurniMese = {};
    const c0 = makeCtx(ANNO, MESE, NDIM, medici, {});
    for (const g of c0.feriali) if (g < 8 || g > 12)
      (T[9] ||= {})[g] = { t: [{ tipo: "M", sott: false, man: true }] };
    const ctx = makeCtx(ANNO, MESE, NDIM, medici, T);
    catenaContinuita(ctx);
    // Le M del ML restano intatte…
    for (const g of ctx.feriali) if (g < 8 || g > 12)
      expect(mDi(ctx, 9, g)).toBe(true);
    // …e il tratto scoperto viene coperto.
    for (let g = 8; g <= 12; g++) expect(ctx.cf(g, "M")).toBeGreaterThanOrEqual(1);
  });
});
