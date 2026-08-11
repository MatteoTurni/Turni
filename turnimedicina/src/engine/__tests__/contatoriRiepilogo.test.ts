import { describe, it, expect } from "vitest";
import type { TurniMese } from "../types";
import { alpiMedico, straordinariMedico, psMedico } from "../bilancio";

// ─── CONTATORI DEL RIEPILOGO (v0.3.33) ────────────────────────────────────────
// ALPI = PS sottolineati (1/2/3, il 3 vale 2). Straordinari = M/P/N
// sottolineati (la N vale 2). I due insiemi sono disgiunti per costruzione.

const T = (t: Record<number, {tipo:string;sott?:boolean}[]>): TurniMese => ({
  1: Object.fromEntries(Object.entries(t).map(([g,arr])=>
      [g,{t:arr.map(s=>({tipo:s.tipo,sott:!!s.sott,man:true}))}])),
});
const nd = 30;

describe("ALPI (PS sottolineati)", () => {
  it("conta 1 e 2 come 1, il 3 come 2", () => {
    const t = T({1:[{tipo:"1",sott:true}], 2:[{tipo:"2",sott:true}], 3:[{tipo:"3",sott:true}]});
    expect(alpiMedico(t,1,nd)).toBe(4);
  });
  it("ignora i PS NON sottolineati", () => {
    const t = T({1:[{tipo:"1"}], 2:[{tipo:"3"}], 3:[{tipo:"2",sott:true}]});
    expect(alpiMedico(t,1,nd)).toBe(1);
  });
  it("è un sottoinsieme del totale PS", () => {
    const t = T({1:[{tipo:"3",sott:true}], 2:[{tipo:"3"}], 3:[{tipo:"1",sott:true}]});
    expect(psMedico(t,1,nd,true)).toBe(5);     // 2 + 2 + 1
    expect(alpiMedico(t,1,nd)).toBe(3);        // 2 + 1
  });
});

describe("Straordinari (M/P/N sottolineati)", () => {
  it("conta M e P come 1, la N come 2", () => {
    const t = T({1:[{tipo:"M",sott:true}], 2:[{tipo:"P",sott:true}], 3:[{tipo:"N",sott:true}]});
    expect(straordinariMedico(t,1,nd)).toBe(4);
  });
  it("ignora i turni NON sottolineati", () => {
    const t = T({1:[{tipo:"M"}], 2:[{tipo:"N"}], 3:[{tipo:"P",sott:true}]});
    expect(straordinariMedico(t,1,nd)).toBe(1);
  });
  it("non conta l'ambulatorio né i codici di PS (che vanno in ALPI)", () => {
    const t = T({1:[{tipo:"A",sott:true}], 2:[{tipo:"1",sott:true}], 3:[{tipo:"3",sott:true}]});
    expect(straordinariMedico(t,1,nd)).toBe(0);
    expect(alpiMedico(t,1,nd)).toBe(3);
  });
  it("i due contatori non si sovrappongono mai", () => {
    const t = T({1:[{tipo:"M",sott:true},{tipo:"2",sott:true}], 5:[{tipo:"N",sott:true}]});
    expect(straordinariMedico(t,1,nd)).toBe(3);   // M(1) + N(2)
    expect(alpiMedico(t,1,nd)).toBe(1);           // 2(1)
  });
  it("una giornata mista pieno+sottolineato conta solo la parte sottolineata", () => {
    const t = T({1:[{tipo:"M"},{tipo:"P",sott:true}]});
    expect(straordinariMedico(t,1,nd)).toBe(1);
  });
});
