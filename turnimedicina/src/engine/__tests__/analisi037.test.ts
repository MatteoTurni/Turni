import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { dimOf, dowOf, isHol, isFestivo } from "../date";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { makeCtx } from "../ctx";
import { tappaBuchi, riparaBuchi, validazioneGlobale } from "../fasi";
import { diagnosiStatica } from "../diagnosi";
import { diagnosiCausale } from "../diagnosiCausale";
import { completaObiettivi, generaMigliorTentativo } from "../genera";

// ── ANALISI v0.3.37: generazione e diagnosi ──────────────────────────────────

const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const put = (T: TurniMese, id: number, g: number, tipo: string, man = true, amb?: string) => {
  const c = ((T[id] ||= {})[g] ||= { t: [] });
  c.t = [...c.t, { tipo, sott: false, man, ...(amb ? { amb } : {}) }];
};
const med = (id: number, stato: Medico["stato"], obiettivo: number, extra: Partial<Medico> = {}): Medico =>
  ({ id, nome: `X. M${id}`, codice: String(id), stato, obiettivo, ambulatorio: false, ...extra });

beforeEach(() => { setSalt(0); setAmbRotStart(0); ENG.PREV = null; setRegole(dft()); });
afterEach(() => { setRegole(dft()); });

describe("calendario memorizzato", () => {
  it("dowOf/isHol/isFestivo coincidono col calcolo diretto, anche fuori mese", () => {
    for (const y of [2025, 2026, 2027]) for (let m = 0; m < 12; m++) for (let d = -3; d <= 34; d++) {
      expect(dowOf(y, m, d)).toBe((new Date(y, m, d).getDay() + 6) % 7);
      // seconda chiamata: dalla cache, stesso valore
      expect(dowOf(y, m, d)).toBe((new Date(y, m, d).getDay() + 6) % 7);
    }
    expect(isHol(2026, 7, 15)).toBe(true);          // Ferragosto
    expect(isHol(2026, 8, 8)).toBe(true);           // patrono locale
    expect(isHol(2026, 3, 6)).toBe(true);           // Pasquetta 2026
    expect(isFestivo(2026, 5, 7)).toBe(true);       // domenica
    expect(isFestivo(2026, 5, 8)).toBe(false);
  });
});

describe("restore considera anche l'ambulatorio", () => {
  it("una A di un altro ambulatorio viene davvero ripristinata", () => {
    const T: TurniMese = {}; put(T, 1, 9, "A", false, "dia");
    const c = makeCtx(2026, 5, 30, [med(1, "MR", 25)], T);
    const snap = c.snapshot();
    c.st(1, 9, [{ tipo: "A", sott: false, man: false, amb: "car" }]);
    c.restore(snap);
    expect(c.gt(1, 9)[0].amb).toBe("dia");
  });
});

describe("tappaBuchi", () => {
  it("copre le celle coperibili una per una (ML + MDC in affiancamento)", () => {
    // Lunedì 1 giugno 2026: gli MR sono "a obiettivo" (0) — restano ML e MDC.
    const medici = [med(1, "MR", 0), med(2, "MR", 0), med(3, "MDC", 21), med(4, "ML", 25)];
    const T: TurniMese = {};
    const c = makeCtx(2026, 5, 30, medici, T);
    expect(c.cf(1, "M")).toBe(0);
    tappaBuchi(c);
    expect(c.cf(1, "M")).toBe(2);                     // ML, poi l'MDC affiancato
    expect(c.cf(1, "P")).toBe(0);                     // MDC da solo: vietato
    expect(c.cf(1, "N")).toBe(0);
  });

  it("non spende il weekend libero di chi scenderebbe sotto il suo obiettivo", () => {
    // Giugno 2026: coppie 6-7, 13-14, 20-21, 27-28 → obiettivo 2 weekend liberi.
    const soloX = (manualiWeekend: boolean) => {
      const medici = [med(1, "MR", 25), med(2, "MR", 0), med(3, "MDC", 0), med(4, "ML", 0)];
      const T: TurniMese = {};
      // X è libero solo nei weekend (ferie nei feriali) e non fa notti: così
      // l'unica decisione in gioco è se spendere o no il suo sabato 6.
      for (let g = 1; g <= 30; g++) {
        if (dowOf(2026, 5, g) < 5) put(T, 1, g, "L"); else put(T, 1, g, "Xn");
      }
      if (manualiWeekend) { put(T, 1, 13, "M"); put(T, 1, 20, "M"); }
      const c = makeCtx(2026, 5, 30, medici, T);
      tappaBuchi(c);
      return c.gt(1, 6).some(s => s.tipo === "M" && !s.man);
    };
    expect(soloX(true)).toBe(false);   // 2 liberi su 2 richiesti: sabato 6 non si tocca
    expect(soloX(false)).toBe(true);   // 4 liberi: può cederne uno
  });
});

describe("riparaBuchi riassegna l'ambulatorio quando serve", () => {
  it("sposta la A all'altro abilitato e chiude il buco della mattina", () => {
    setRegole(mergeRegole({ ...dft(),
      fabb: { fer: { mMin: 1, mMax: 1, pMin: 0, pMax: 0 },
              sab: { mMin: 0, mMax: 0, pMin: 0, pMax: 0 },
              fest: { mMin: 0, mMax: 0, pMin: 0, pMax: 0 } } }));
    const medici = [
      med(1, "MR", 25, { ambulatorio: true, ambulatori: ["A"] }),
      med(2, "MR", 0,  { ambulatorio: true, ambulatori: ["A"] }),   // a obiettivo: niente M, ma la A sì
      med(3, "MR", 25),
      med(9, "MPS", 0),
    ];
    const T: TurniMese = {};
    for (let g = 1; g <= 30; g++) {
      if (g !== 9) put(T, 9, g, "N");                                  // notti coperte dall'MPS
      if (g !== 9 && dowOf(2026, 5, g) < 5) put(T, 9, g, "M");         // mattine feriali coperte
    }
    put(T, 1, 9, "A", false, "A");                                     // la A automatica è sull'unico che potrebbe fare la M
    expect(dowOf(2026, 5, 9)).toBe(1);                                 // martedì
    const c = makeCtx(2026, 5, 30, medici, T);
    expect(c.cf(9, "M")).toBe(0);
    expect(riparaBuchi(c, 12345, 20000)).toBe(true);
    expect(c.cf(9, "M")).toBe(1);
    expect(c.cf(9, "N")).toBe(1);
    expect(c.gt(2, 9).some(s => s.tipo === "A")).toBe(true);           // la A è passata al collega
    expect(c.ambMancanti(9)).toEqual([]);
  });
});

describe("max giornate piene per settimana", () => {
  it("add rifiuta la seconda giornata piena nella stessa settimana (limite 1)", () => {
    setRegole(mergeRegole({ ...dft(), maxAssSett: 1 }));
    const c = makeCtx(2026, 5, 30, [med(1, "MR", 40)], {});
    // lunedì 1 e giovedì 4 (stessa settimana), lunedì 8 (settimana dopo)
    c.add(1, 1, "M"); c.add(1, 1, "P");
    c.add(1, 4, "M"); c.add(1, 4, "P");
    c.add(1, 8, "M"); c.add(1, 8, "P");
    expect(c.haAss(1, 1)).toBe(true);
    expect(c.haAss(1, 4)).toBe(false);
    expect(c.haAss(1, 8)).toBe(true);
    expect(c.canR(med(1, "MR", 40), 4, "ASS")).toBe(false);
  });

  it("generazione con limite 1: nessuna settimana di calendario oltre il limite", () => {
    setRegole(mergeRegole({ ...dft(), maxAssSett: 1 }));
    const medici: Medico[] = [
      med(1, "MR", 25), med(2, "MR", 25, { ambulatorio: true }), med(3, "MDC", 21), med(4, "ML", 25),
      med(5, "MR", 25, { ambulatorio: true }), med(6, "MR", 25, { ambulatorio: true }), med(7, "MR", 25),
      med(8, "MR", 25, { ambulatorio: true }), med(9, "MR", 25), med(10, "MPS", 0), med(11, "MPS", 0),
    ];
    const r = generaMigliorTentativo(2026, 5, 30, medici, {}, 2500);
    for (const m of medici) {
      let sett = -1, n = 0;
      for (let g = 1; g <= 30; g++) {
        if (g === 1 || dowOf(2026, 5, g) === 0) { sett++; n = 0; }
        const t = (r.turni[m.id]?.[g]?.t || []).map(s => s.tipo);
        if (t.some(x => x === "M" || x === "A") && t.some(x => x === "P" || x === "Ap")) n++;
        expect(n).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("diagnosi", () => {
  const squadra15 = (): Medico[] => [1, 2, 5, 6, 7, 8, 9].map(id => med(id, "MR", 15))
    .concat([med(3, "MDC", 15), med(4, "ML", 15), med(10, "MPS", 0), med(11, "MPS", 0)]);

  it("statica: segnala il bilancio negativo (obiettivi insufficienti), non per i mesi normali", () => {
    const d = diagnosiStatica(2026, 5, 30, squadra15(), {});
    expect(d.bilancio).toBeDefined();
    expect(d.bilancio!.servono).toBeGreaterThan(d.bilancio!.disponibili);
    const ok = diagnosiStatica(2026, 5, 30, squadra15().map(m => ({ ...m, obiettivo: m.stato === "MPS" ? 0 : 25 })), {});
    expect(ok.bilancio).toBeUndefined();
  });

  it("causale: a tempo esaurito non afferma mai un deficit 'strutturale'", () => {
    const d = diagnosiCausale(2026, 5, 30, squadra15(), {}, { maxMs: 30 });
    for (const cl of d.cluster) expect(cl.esito).not.toBe("struttura");
  });
});

describe("completaObiettivi dice chi resta sotto obiettivo", () => {
  it("rimasti e postiLiberi coerenti col tabellone", () => {
    const medici = [med(1, "MR", 40), med(2, "MR", 40), med(3, "MR", 40)];
    const r = completaObiettivi(2026, 5, 30, medici, {});
    const c = makeCtx(2026, 5, 30, medici, r.turni);
    for (const x of r.rimasti) expect(c.cnt(x.id) + x.mancano).toBe(40);
    expect(r.rimasti.length).toBe(3);                 // 40 turni feriali non ci stanno
    expect(r.postiLiberi).toBeGreaterThanOrEqual(0);
    expect(validazioneGlobale(c).filter(p => p.includes("giornate piene"))).toEqual([]);
  });
});
