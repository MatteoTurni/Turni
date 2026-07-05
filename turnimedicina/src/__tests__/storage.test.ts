import { describe, it, expect } from "vitest";
import { migraTurni } from "../storage";
import type { TurniMese } from "../engine/types";

describe("storage: migrazione MP/AP", () => {
  it("converte i vecchi turni unici MP/AP in coppie di turni distinti", () => {
    const T: TurniMese = {
      "1": {
        "3": { t:[{ tipo:"MP", sott:false, man:true }] },
        "5": { t:[{ tipo:"AP", sott:false, man:false }] },
        "7": { t:[{ tipo:"N",  sott:false, man:false }] },
      },
    };
    migraTurni(T);
    expect(T["1"]["3"].t.map(s=>s.tipo)).toEqual(["M","P"]);
    expect(T["1"]["3"].t.every(s=>s.man)).toBe(true);
    expect(T["1"]["5"].t.map(s=>s.tipo)).toEqual(["A","P"]);
    expect(T["1"]["7"].t.map(s=>s.tipo)).toEqual(["N"]);
  });
});
