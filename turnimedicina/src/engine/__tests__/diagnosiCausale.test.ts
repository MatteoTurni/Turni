import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { diagnosiCausale } from "../diagnosiCausale";
import { setRegole, getRegole, REGOLE_DEFAULT } from "../regole";
import { ENG } from "../state";
import { dowOf, isFestivo, dimOf, isSabN, isDomN } from "../date";

// ─── helper ──────────────────────────────────────────────────────────────────
const doc = (id: number, nome: string, stato: Medico["stato"] = "MR", amb = false, ob = 40): Medico =>
  ({ id, nome, codice: nome.slice(0, 2).toUpperCase(), stato, obiettivo: ob, ambulatorio: amb });

const put = (T: TurniMese, id: number, g: number, tipo: string) => {
  if (!T[id]) T[id] = {};
  const c = T[id][g]?.t || [];
  T[id][g] = { t: [...c, { tipo, sott: false, man: true }] };
};

// Copre MANUALMENTE tutti i minimi di un mese (giugno 2026, amb martedì) con un
// roster grande, rotazione naive senza notti (fabbisogno N coperto da un pool
// dedicato a giorni alterni per non violare nulla di rilevante ai fini del
// test: i manuali sono comunque fatti immovibili e tollerati dal motore).
function riempiMese(anno: number, mese: number, ndim: number, medici: Medico[], T: TurniMese,
                    salta: (g: number) => boolean = () => false) {
  const fb = (g: number) => {
    const d = dowOf(anno, mese, g), sp = isDomN(d) || isFestivo(anno, mese, g), sa = isSabN(d);
    return sp ? { m: 1, p: 1 } : sa ? { m: 2, p: 1 } : { m: 2, p: 1 };
  };
  const n = medici.length;
  for (let g = 1; g <= ndim; g++) {
    if (salta(g)) continue;
    const { m, p } = fb(g);
    const base = (g * 3) % n;
    for (let i = 0; i < m; i++) put(T, medici[(base + i) % n].id, g, "M");
    for (let i = 0; i < p; i++) put(T, medici[(base + m + i) % n].id, g, "P");
    put(T, medici[(base + m + p) % n].id, g, "N");
  }
}

beforeEach(() => {
  setRegole(REGOLE_DEFAULT);
  ENG.PREV = null;
  ENG.SALT = 0;
});

describe("diagnosiCausale", () => {
  const anno = 2026, mese = 5, ndim = dimOf(anno, mese); // giugno 2026: 1 = lunedì
  const roster = [
    doc(1, "Rossi Anna"), doc(2, "Bianchi Luca"), doc(3, "Verdi Sara"),
    doc(4, "Neri Paolo"), doc(5, "Gallo Elena"), doc(6, "Fontana Marco"),
    doc(7, "Riva Carla"), doc(8, "Greco Ivan", "MR", true),   // unico abilitato ambulatorio
  ];

  it("mese senza buchi → nessun cluster", () => {
    const T: TurniMese = {};
    riempiMese(anno, mese, ndim, roster, T);
    // anche gli ambulatori coperti (martedì: 2, 9, 16, 23, 30 giugno 2026)
    for (let g = 1; g <= ndim; g++)
      if (dowOf(anno, mese, g) === 1 && !isFestivo(anno, mese, g)) put(T, 8, g, "A");
    const r = diagnosiCausale(anno, mese, ndim, roster, T);
    expect(r.cluster.length).toBe(0);
    expect(r.completa).toBe(true);
  });

  it("ambulatorio bloccato dal riposo post-notte dell'unico abilitato → causa ambOff con motivo esplicito", () => {
    const T: TurniMese = {};
    riempiMese(anno, mese, ndim, roster, T);
    // A su tutti i martedì TRANNE il 9; l'abilitato (Greco) ha la NOTTE
    // manuale lunedì 8 → martedì 9 è il suo riposo obbligatorio: la A del 9
    // non è piazzabile da nessuno. Tutte le celle M/P/N restano coperte.
    for (let g = 1; g <= ndim; g++)
      if (dowOf(anno, mese, g) === 1 && !isFestivo(anno, mese, g) && g !== 9) put(T, 8, g, "A");
    put(T, 8, 8, "N");
    const r = diagnosiCausale(anno, mese, ndim, roster, T);
    expect(r.cluster.length).toBe(1);
    const cl = r.cluster[0];
    expect(cl.ambGiorni).toContain(9);
    expect(cl.esito).toBe("vincolo");
    expect(cl.vincoli).toContain("ambOff");
    // il dettaglio spiega PERCHÉ l'abilitato non può prendere la A
    expect(cl.dettagli.join(" ")).toMatch(/riposo obbligatorio \(notte il giorno prima\)/);
  });

  it("nucleo altrove: il buco dichiarato è la M ma il vero blocco è la notte del giorno prima", () => {
    // Mese interamente coperto a mano TRANNE i giorni 10-11 (mer-gio), gestiti
    // così: SOLO due medici (1 e 2) senza X in quei due giorni, tutti gli altri
    // esclusi con X. Il giorno 10 richiede M2+P1+N1 e il giorno 11 pure: con
    // due soli medici il blocco è totale, e sacrificare la NOTTE del 10 (che
    // costringe il suo titolare al riposo l'11) è ciò che libera più celle.
    // Qui basta verificare il MECCANISMO: la diagnosi analizza la finestra,
    // trova un esito non-"locale" e produce un nucleo non vuoto.
    const T: TurniMese = {};
    riempiMese(anno, mese, ndim, roster, T, g => g === 10 || g === 11);
    for (let g = 1; g <= ndim; g++)
      if (dowOf(anno, mese, g) === 1 && !isFestivo(anno, mese, g)) put(T, 8, g, "A");
    for (const m of roster) if (m.id > 2) { put(T, m.id, 10, "X"); put(T, m.id, 11, "X"); }
    // copertura parziale dei due giorni: notte del 10 al medico 1 → l'11 il
    // medico 1 è in riposo, resta solo il 2: M2 dell'11 incopribile.
    put(T, 1, 10, "N");
    put(T, 2, 10, "M");
    const r = diagnosiCausale(anno, mese, ndim, roster, T, { maxMs: 4000 });
    expect(r.cluster.length).toBeGreaterThan(0);
    const cl = r.cluster.find(c => c.lo <= 10 && c.hi >= 11)!;
    expect(cl).toBeTruthy();
    expect(cl.esito).not.toBe("locale");       // il deficit è reale nella finestra
    expect(cl.nucleo.length).toBeGreaterThan(0); // e la diagnosi indica COSA sacrificare
    expect(cl.motivo.length).toBeGreaterThan(20);
  });

  it("non muta il tabellone in ingresso e ripristina le regole", () => {
    const T: TurniMese = {};
    riempiMese(anno, mese, ndim, roster, T, g => g === 10);
    const prima = JSON.stringify(T);
    diagnosiCausale(anno, mese, ndim, roster, T, { maxMs: 2000 });
    expect(JSON.stringify(T)).toBe(prima);
    // le sonde sui limiti numerici devono aver RIPRISTINATO le regole correnti
    expect(getRegole().maxNotti).toBe(REGOLE_DEFAULT.maxNotti);
    expect(getRegole().maxConsec).toBe(REGOLE_DEFAULT.maxConsec);
  });
});
