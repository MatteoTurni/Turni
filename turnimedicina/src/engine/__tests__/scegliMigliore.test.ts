import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, Risultato, TurniMese } from "../types";
import { dimOf, dowOf } from "../date";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { makeCtx } from "../ctx";
import { scegliMigliore, scoreCopertura, deficitWeekend } from "../genera";

// ─── P1: a PARITÀ di copertura vince chi ha pagato meno weekend liberi ───────
// Caso patologico pre-patch: un tabellone "aggressivo" (weekend concentrati su
// un medico) con un avviso in meno batteva quello che li preservava, pur senza
// coprire nulla in più. Il deficit weekend ora decide PRIMA di problemi.length.
describe("scegliMigliore: spareggio sul deficit weekend (P1)", () => {
  beforeEach(() => setRegole(REGOLE_DEFAULT));

  const anno = 2026, mese = 8;                       // settembre 2026
  const med: Medico[] = [1,2,3,4].map(id =>
    ({ id, nome:`M ${id}`, codice:`${id}`, stato:"MR", obiettivo:25, ambulatorio:false }));

  it("a pari copertura preferisce il tabellone con meno weekend pagati", () => {
    const nd = dimOf(anno, mese);
    const c0 = makeCtx(anno, mese, nd, med, {});
    const wkDays = c0.giorniArr.filter(g => c0.isWk(g));

    // indice della coppia di weekend = numero di sabati incontrati fin lì
    let sab = 0; const pairIdx: Record<number,number> = {};
    for(const g of wkDays){ if(dowOf(anno,mese,g)===5) sab++; pairIdx[g]=Math.max(0,sab-1); }

    const mk = (assegna:(g:number)=>number): TurniMese => {
      const T: TurniMese = {};
      for(const g of wkDays){ const id=assegna(g); (T[id] ||= {})[g] = { t:[{ tipo:"M", man:false }] }; }
      return T;
    };
    const TA = mk(g => med[pairIdx[g] % 4].id);      // ogni medico UNA coppia → wkDef 0
    const TB = mk(_ => 2);                            // il medico 2 li lavora TUTTI → wkDef 2

    // stessa copertura per cella (1 M per giorno di weekend in entrambi)
    expect(scoreCopertura(anno,mese,nd,med,TA)).toBe(scoreCopertura(anno,mese,nd,med,TB));
    expect(deficitWeekend(anno,mese,nd,med,TA)).toBe(0);
    expect(deficitWeekend(anno,mese,nd,med,TB)).toBeGreaterThan(0);

    // B ha MENO problemi dichiarati: col vecchio spareggio avrebbe vinto
    const A: Risultato = { turni:TA, ok:false, parziale:true, problemi:["avviso1","avviso2"] };
    const B: Risultato = { turni:TB, ok:false, parziale:true, problemi:["avviso1"] };
    expect(scegliMigliore(anno,mese,nd,med,A,B)).toBe(A);
    expect(scegliMigliore(anno,mese,nd,med,B,A)).toBe(A);   // simmetrico
  });

  it("la copertura resta il criterio dominante (più copertura vince comunque)", () => {
    const nd = dimOf(anno, mese);
    const c0 = makeCtx(anno, mese, nd, med, {});
    const wkDays = c0.giorniArr.filter(g => c0.isWk(g));
    const TB: TurniMese = {};
    for(const g of wkDays) (TB[2] ||= {})[g] = { t:[{ tipo:"M", man:false }] };
    const A: Risultato = { turni:{}, ok:false, parziale:true, problemi:[] };
    const B: Risultato = { turni:TB, ok:false, parziale:true, problemi:["a","b","c"] };
    // B copre di più pur pagando weekend e con più avvisi: vince B
    expect(scegliMigliore(anno,mese,nd,med,A,B)).toBe(B);
  });
});
