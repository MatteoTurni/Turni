import { describe, it, expect } from "vitest";
import { calcPasqua, holSet, isFestivo, dowOf, dimOf, mkKey } from "../date";
import { mergeRegole, REGOLE_DEFAULT } from "../regole";
import { vt, cloneT, pulisciT } from "../turni";

describe("date e festivi", () => {
  it("calcola la Pasqua (Gauss/Meeus) per anni noti", () => {
    expect(calcPasqua(2024).getMonth()).toBe(2);  // marzo
    expect(calcPasqua(2024).getDate()).toBe(31);
    expect(calcPasqua(2025).getMonth()).toBe(3);  // aprile
    expect(calcPasqua(2025).getDate()).toBe(20);
    expect(calcPasqua(2026).getMonth()).toBe(3);
    expect(calcPasqua(2026).getDate()).toBe(5);
  });

  it("include la Pasquetta nel set dei festivi", () => {
    expect(holSet(2026).has("2026-04-06")).toBe(true);   // lunedì dell'Angelo 2026
    expect(holSet(2025).has("2025-04-21")).toBe(true);
  });

  it("riconosce domeniche e feste nazionali come festivi", () => {
    expect(isFestivo(2026, 5, 7)).toBe(true);    // 7 giugno 2026 = domenica
    expect(isFestivo(2026, 7, 15)).toBe(true);   // Ferragosto
    expect(isFestivo(2026, 5, 8)).toBe(false);   // lunedì 8 giugno
  });

  it("dowOf/dimOf/mkKey", () => {
    expect(dowOf(2026, 5, 1)).toBe(0);   // 1 giugno 2026 = lunedì
    expect(dimOf(2026, 1)).toBe(28);     // febbraio 2026
    expect(dimOf(2028, 1)).toBe(29);     // bisestile
    expect(mkKey(2026, 0)).toBe("2026-01");
    expect(mkKey(2026, 11)).toBe("2026-12");
  });
});

describe("regole", () => {
  it("mergeRegole integra i campi mancanti con i default", () => {
    const r = mergeRegole({ maxNotti: 4 } as any);
    expect(r.maxNotti).toBe(4);
    expect(r.maxConsec).toBe(REGOLE_DEFAULT.maxConsec);
    expect(r.fabb.fer.mMin).toBe(REGOLE_DEFAULT.fabb.fer.mMin);
    const r2 = mergeRegole({ fabb: { fer: { mMin: 3 } } } as any);
    expect(r2.fabb.fer.mMin).toBe(3);
    expect(r2.fabb.fer.pMax).toBe(REGOLE_DEFAULT.fabb.fer.pMax);
    expect(mergeRegole(null)).toEqual(REGOLE_DEFAULT);
  });

  it("giorniAmb: assente → default martedì; presente → sanitizzato", () => {
    // Salvataggi pre-v0.3.8 senza il campo → default [1]
    expect(mergeRegole({ maxNotti: 4 } as any).giorniAmb).toEqual([1]);
    // Presente e valido → conservato (ordinato, dedup)
    expect(mergeRegole({ giorniAmb: [2, 1, 2] } as any).giorniAmb).toEqual([1, 2]);
    // Vuoto è LEGITTIMO: nessun ambulatorio
    expect(mergeRegole({ giorniAmb: [] } as any).giorniAmb).toEqual([]);
    // Valori fuori range (weekend, negativi, non interi) scartati
    expect(mergeRegole({ giorniAmb: [5, 6, -1, 1.5, 3] } as any).giorniAmb).toEqual([3]);
    // Tipo sbagliato → default
    expect(mergeRegole({ giorniAmb: "martedì" } as any).giorniAmb).toEqual([1]);
  });
});

describe("utility turni", () => {
  it("vt pesa notti 2, diurni 1, sottolineati 0", () => {
    expect(vt("N")).toBe(2);
    expect(vt("3")).toBe(2);
    expect(vt("M")).toBe(1);
    expect(vt("P")).toBe(1);
    expect(vt("M", true)).toBe(0);   // sottolineato
    expect(vt("X")).toBe(0);
  });

  it("cloneT produce una copia indipendente ai livelli oggetto", () => {
    const T = { "1": { "3": { t: [{ tipo: "M", sott: false, man: false }] } } };
    const c = cloneT(T as any);
    (c as any)["1"]["4"] = { t: [{ tipo: "P", sott: false, man: false }] };
    expect((T as any)["1"]["4"]).toBe(undefined);
    expect((c as any)["1"]["3"].t[0].tipo).toBe("M");
  });

  it("pulisciT elimina le celle vuote", () => {
    const T: any = { "1": { "3": { t: [] }, "4": { t: [{ tipo:"M", sott:false, man:false }] } }, "2": { "5": { t: [] } } };
    pulisciT(T);
    expect(T["1"]["3"]).toBe(undefined);
    expect(T["1"]["4"].t.length).toBe(1);
    expect(T["2"]).toBe(undefined);
  });
});
