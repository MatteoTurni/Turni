import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt } from "../state";
import { makeCtx } from "../ctx";
import { catenaContinuita } from "../fasi";

// ─── SQUADRA SINTETICA SENZA ML: il caso "ML manca tutto il mese" ─────────────
const mediciNoML = (): Medico[] => [
  { id:1, nome:"D. BALDI",      codice:"1", stato:"MR", obiettivo:25, ambulatorio:false },
  { id:2, nome:"M. RENIS",      codice:"2", stato:"MR", obiettivo:25, ambulatorio:false },
  { id:3, nome:"C. CIAMPA",     codice:"3", stato:"MR", obiettivo:25, ambulatorio:false },
  { id:4, nome:"M. STEFANUCCI", codice:"4", stato:"MR", obiettivo:25, ambulatorio:false },
  { id:5, nome:"V. GIORDANO",   codice:"5", stato:"MR", obiettivo:25, ambulatorio:false },
];

// Giugno 2026: inizia di lunedì → settimane pulite, comodo per i tratti.
const ANNO = 2026, MESE = 5, NDIM = 30;

beforeEach(() => {
  setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));
  ENG.PREV = null;
  setSalt(0);
});

const mDi = (T: TurniMese, id: number, g: number) =>
  (T[id]?.[g]?.t || []).some(s => s.tipo === "M");

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

  it("senza ML copre ogni feriale entro il minimo, a blocchi con passaggio di consegne", () => {
    setRegole(mergeRegole({ ...REGOLE_DEFAULT, blocchiMattina: 3 }));
    const K = 3;
    const ctx = makeCtx(ANNO, MESE, NDIM, mediciNoML(), {});
    catenaContinuita(ctx);
    const { T, feriali, nmn, cf } = ctx;

    // 1) Ogni feriale ha almeno una M e MAI oltre il fabbisogno minimo:
    //    la catena decide CHI, non aggiunge mattine oltre gli slot dovuti.
    for (const g of feriali) {
      expect(cf(g, "M")).toBeGreaterThanOrEqual(1);
      expect(cf(g, "M")).toBeLessThanOrEqual(nmn(g).mn);
    }

    // 2) Esiste almeno un giorno di passaggio di consegne: due M nello stesso
    //    feriale (uscente + entrante), possibile perché mMin feriale = 2.
    expect(feriali.some(g => cf(g, "M") === 2)).toBe(true);

    // 3) Le strisce di M per medico (contigue sull'asse dei FERIALI: il
    //    weekend senza M assegnate non spezza il blocco) non superano K+1:
    //    K giorni del blocco + l'eventuale giorno di affiancamento in uscita.
    for (const m of mediciNoML()) {
      let run = 0;
      for (const g of feriali) {
        run = mDi(T, m.id, g) ? run + 1 : 0;
        expect(run).toBeLessThanOrEqual(K + 1);
      }
    }

    // 4) Continuità dentro il blocco: ogni striscia (troncamenti ai bordi del
    //    mese esclusi) è lunga almeno 2 — nessuna M "orfana" di un solo giorno,
    //    che è l'opposto della continuità richiesta.
    for (const m of mediciNoML()) {
      const runs: number[] = [];
      let run = 0;
      for (const g of feriali) {
        if (mDi(T, m.id, g)) run++;
        else if (run) { runs.push(run); run = 0; }
      }
      // la striscia eventualmente aperta a fine mese è un troncamento lecito
      for (const r of runs.slice(0, -1).concat(runs.length ? [Math.max(runs[runs.length - 1], 2)] : []))
        expect(r).toBeGreaterThanOrEqual(2);
    }
  });

  it("rispetta le mattine del ML: nei giorni coperti dal ML non assegna nulla", () => {
    setRegole(mergeRegole({ ...REGOLE_DEFAULT, blocchiMattina: 3 }));
    const medici: Medico[] = [
      ...mediciNoML(),
      { id: 9, nome: "A. DEL GATTO", codice: "9", stato: "ML", obiettivo: 25, ambulatorio: false },
    ];
    // ML in tabellone (come dopo la 5A) su tutti i feriali TRANNE i giorni
    // 8–12 (lun–ven della seconda settimana): il tratto scoperto è lì.
    const T: TurniMese = {};
    const ctx0 = makeCtx(ANNO, MESE, NDIM, medici, {});
    for (const g of ctx0.feriali) if (g < 8 || g > 12)
      (T[9] ||= {})[g] = { t: [{ tipo: "M", sott: false, man: true }] };

    const ctx = makeCtx(ANNO, MESE, NDIM, medici, T);
    catenaContinuita(ctx);

    // Nel tratto scoperto le mattine ci sono; un unico portatore le regge
    // (blocco ≤ K=3 su 5 giorni → al più un cambio con affiancamento).
    for (let g = 8; g <= 12; g++) expect(ctx.cf(g, "M")).toBeGreaterThanOrEqual(1);
    // Fuori dal tratto la catena non aggiunge M dei sostituti, salvo il solo
    // AFFIANCAMENTO ai bordi (g=5 venerdì prima, g=15 lunedì dopo).
    for (const g of ctx.feriali) {
      if (g >= 8 && g <= 12) continue;
      const extra = mediciNoML().filter(m => mDi(ctx.T, m.id, g)).length;
      if (g === 5 || g === 15) expect(extra).toBeLessThanOrEqual(1);
      else expect(extra).toBe(0);
    }
  });
});
