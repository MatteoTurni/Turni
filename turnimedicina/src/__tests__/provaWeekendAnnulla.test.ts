import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico } from "../engine/types";
import { setRegole, REGOLE_DEFAULT } from "../engine/regole";
import { provaWeekendParallelo } from "../provaWeekendParallelo";

// ── v0.3.51: la diagnosi "cosa servirebbe" si può interrompere ───────────────
// In node non ci sono Worker: si esercita il ripiego sequenziale, che usa lo
// stesso meccanismo di annullamento.
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const medici: Medico[] = [1, 2, 3, 4, 5, 6].map(i => ({ id: i, nome: "D. M" + i, codice: "" + i, stato: "MR", obiettivo: 25, ambulatorio: false }));
beforeEach(() => { setRegole(dft()); (globalThis as any).navigator ??= { hardwareConcurrency: 2 }; });
afterEach(() => { setRegole(dft()); });

describe("provaWeekendParallelo annullabile", () => {
  it("con un segnale già interrotto rifiuta subito, senza generare", async () => {
    const ctl = new AbortController(); ctl.abort();
    const t0 = Date.now();
    await expect(provaWeekendParallelo(2026, 8, 30, medici, {}, ctl.signal)).rejects.toThrow(/annullata/);
    expect(Date.now() - t0).toBeLessThan(500);
  });
  it("interrotta durante il lavoro si ferma e non restituisce risultati", async () => {
    const ctl = new AbortController();
    const p = provaWeekendParallelo(2026, 8, 30, medici, {}, ctl.signal);
    setTimeout(() => ctl.abort(), 50);
    const t0 = Date.now();
    await expect(p).rejects.toThrow(/annullata/);
    expect(Date.now() - t0).toBeLessThan(5000);                         // non arriva in fondo alle ~14 prove
  }, 20000);
});
