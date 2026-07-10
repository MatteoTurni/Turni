import { describe, it, expect } from "vitest";
import { calcolaBilancio, fabbisognoLordo, psMedico } from "../bilancio";
import { REGOLE_DEFAULT } from "../regole";
import type { Medico, TurniMese } from "../types";

const R = REGOLE_DEFAULT;
const m = (id:number, stato:Medico["stato"], obiettivo:number): Medico =>
  ({ id, nome:`M${id}`, codice:"", stato, obiettivo, ambulatorio:false });

const MED: Medico[] = [
  m(1,"MR",27), m(2,"MR",27), m(3,"MDC",21), m(4,"ML",27),
  m(5,"MR",27), m(6,"MR",27), m(7,"MR",27), m(8,"MR",27), m(9,"MR",27),
  m(10,"MPS",0), m(11,"MPS",0),
];

describe("fabbisognoLordo", () => {
  it("luglio 2026: 31 giorni, 4 martedì non festivi → 155", () => {
    expect(fabbisognoLordo(2026, 6, 31, R)).toBe(155);
  });
  it("agosto 2026: Ferragosto cade di sabato e vale come festivo → 153", () => {
    expect(fabbisognoLordo(2026, 7, 31, R)).toBe(153);
  });
  it("la notte pesa 2, come nella colonna Ob.", () => {
    const zero = { ...R, fabb:{ fer:{mMin:0,mMax:0,pMin:0,pMax:0}, sab:{mMin:0,mMax:0,pMin:0,pMax:0}, fest:{mMin:0,mMax:0,pMin:0,pMax:0} } };
    // 31 notti × 2 + 4 ambulatori
    expect(fabbisognoLordo(2026, 6, 31, zero)).toBe(66);
  });
});

describe("psMedico", () => {
  it("conta i TURNI di PS, non il loro valore (la notte PS resta 1 turno)", () => {
    const T: TurniMese = { 3:{ 7:{t:[{tipo:"1",man:true},{tipo:"P",man:true}]}, 8:{t:[{tipo:"3",man:true}]} } };
    expect(psMedico(T, 3, 31)).toBe(2);   // "1" e "3" → 2 turni (vt sarebbe 3)
  });
});

describe("calcolaBilancio", () => {
  const T: TurniMese = {
    1: { 1:{t:[{tipo:"L",man:true}]}, 2:{t:[{tipo:"L",man:true}]}, 3:{t:[{tipo:"104",man:true}]} },
    2: { 5:{t:[{tipo:"ANA",man:true}]}, 6:{t:[{tipo:"per11",man:true}]} },
    3: { 7:{t:[{tipo:"1",man:true},{tipo:"P",man:true}]}, 8:{t:[{tipo:"3",man:true}]} },
    4: { 9:{t:[{tipo:"X",man:true}]}, 10:{t:[{tipo:"M",sott:true,man:true}]} },
    10:{ 1:{t:[{tipo:"N",man:true}]}, 2:{t:[{tipo:"M",man:true}]}, 3:{t:[{tipo:"L",man:true}]} },
    11:{ 4:{t:[{tipo:"3",man:true}]} },
  };
  const b = calcolaBilancio(2026, 6, 31, MED, T, R);

  it("S somma solo gli obiettivi (gli MPS valgono 0)", () => expect(b.s).toBe(237));
  it("L+P conta L/104/p11/ANA manuali, X escluso", () => expect(b.lp).toBe(5));
  it("la L di un MPS non scala nulla", () => expect(b.lp).toBe(5));
  it("PS somma i vt: 1 (=1) + 3 (=2) = 3", () => expect(b.ps).toBe(3));
  it("il PS di un MPS non entra in PS", () => expect(b.ps).toBe(3));
  it("D = S − (L+P) − PS", () => expect(b.d).toBe(237 - 5 - 3));
  it("gli MPS scalano da F solo i turni che coprono (N=2 + M=1); il loro '3' no", () =>
    expect(b.copertoMPS).toBe(3));
  it("F è netto: 155 − 3", () => expect(b.f).toBe(152));
  it("esito ok quando D ≥ F", () => expect(b.ok).toBe(true));

  it("un turno sottolineato vale 0 ovunque", () => {
    const T2: TurniMese = { 1:{ 1:{t:[{tipo:"L",sott:true,man:true}]} } };
    expect(calcolaBilancio(2026,6,31,MED,T2,R).lp).toBe(0);
  });

  it("gli MPS abbassano F di quanto coprono", () => {
    const pieno = Object.fromEntries(
      Array.from({length:31},(_,i)=>[i+1,{t:[{tipo:"N",man:true},{tipo:"M",man:true},{tipo:"P",man:true}]}]));
    const b3 = calcolaBilancio(2026,6,31,MED,{ 10:pieno } as TurniMese,R);
    expect(b3.copertoMPS).toBe(31*4);      // (N=2)+(M=1)+(P=1) per giorno
    expect(b3.f).toBe(155 - 124);
  });

  it("F non scende sotto zero", () => {
    const pieno = Object.fromEntries(
      Array.from({length:31},(_,i)=>[i+1,{t:[{tipo:"N",man:true},{tipo:"M",man:true},{tipo:"P",man:true}]}]));
    const b3 = calcolaBilancio(2026,6,31,MED,{ 10:pieno, 11:pieno } as TurniMese,R);
    expect(b3.f).toBe(0);
    expect(b3.ok).toBe(true);
  });

  it("mese non copribile quando le assenze mangiano gli obiettivi", () => {
    const T4: TurniMese = {};
    for (const md of MED) {
      if (md.stato === "MPS") continue;
      T4[md.id] = Object.fromEntries(Array.from({length:12},(_,i)=>[i+1,{t:[{tipo:"L",man:true}]}]));
    }
    const b4 = calcolaBilancio(2026,6,31,MED,T4,R);
    expect(b4.lp).toBe(9*12);
    expect(b4.d).toBe(237 - 108);
    expect(b4.ok).toBe(false);      // 129 < 155
  });
});
