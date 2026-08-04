import { describe, it, expect, beforeEach } from "vitest";
import type { Medico } from "../types";
import { dimOf, dowOf, holSet, isHol, isHolLocale, isFestivo } from "../date";
import { pesoWeekend } from "../bilancio";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { ENG, setSalt, setAmbRotStart } from "../state";
import { generaMigliorTentativo } from "../genera";

// ─── FESTIVITÀ LOCALE: SANTO PATRONO (v0.3.31) ────────────────────────────────
// L'8 settembre (Madonna dell'Olmo, patrona di Cava de' Tirreni) deve comportarsi
// come un festivo QUALSIASI: fabbisogno ridotto, niente ambulatorio, notte del
// giorno prima prefestiva, peso nell'equità dei festivi.

const mediciTest = (): Medico[] => [
  { id:1,  nome:"D. BALDI",      codice:"1",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:2,  nome:"M. RENIS",      codice:"2",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:3,  nome:"M. GENTILE",    codice:"3",  stato:"MDC", obiettivo:21, ambulatorio:false },
  { id:4,  nome:"A. DEL GATTO",  codice:"4",  stato:"ML",  obiettivo:25, ambulatorio:false },
  { id:5,  nome:"C. CIAMPA",     codice:"5",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:6,  nome:"V. SPUGNARDI",  codice:"6",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:7,  nome:"M. STEFANUCCI", codice:"7",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:8,  nome:"M. LEZZI",      codice:"8",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:9,  nome:"V. GIORDANO",   codice:"9",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:10, nome:"B. CASILLI",    codice:"10", stato:"MPS", obiettivo:0,  ambulatorio:false },
  { id:11, nome:"P. SCUDERI",    codice:"11", stato:"MPS", obiettivo:0,  ambulatorio:false },
];

beforeEach(()=>{
  setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));
  ENG.PREV = null;
  setSalt(0);
  setAmbRotStart(0);
});

describe("isHolLocale: elenco delle feste locali", () => {
  it("riconosce l'8 settembre e SOLO quello", () => {
    expect(isHolLocale(8, 8)).toBe(true);    // 8 settembre (mese 0-based)
    expect(isHolLocale(8, 7)).toBe(false);   // 7 settembre
    expect(isHolLocale(8, 9)).toBe(false);   // 9 settembre
    expect(isHolLocale(5, 8)).toBe(false);   // 8 GIUGNO: stesso giorno, altro mese
    expect(isHolLocale(6, 8)).toBe(false);   // 8 luglio
  });

  it("vale per OGNI anno: la chiave non contiene l'anno", () => {
    for(const y of [2026, 2027, 2028, 2031, 2045])
      expect(isFestivo(y, 8, 8)).toBe(true);
  });
});

describe("separazione dalle festività nazionali", () => {
  it("holSet resta l'elenco delle sole NAZIONALI (la locale non ci entra)", () => {
    expect(holSet(2026).has("2026-09-08")).toBe(false);
    expect(holSet(2026).has("2026-08-15")).toBe(true);   // Ferragosto
    expect(holSet(2026).has("2026-04-06")).toBe(true);   // Lunedì dell'Angelo 2026
    expect(holSet(2026).size).toBe(11);                  // 10 fisse + Pasquetta
  });

  it("isHol somma nazionali e locali senza doppi conteggi", () => {
    expect(isHol(2026, 8, 8)).toBe(true);                // locale, martedì feriale
    expect(isHol(2026, 7, 15)).toBe(true);               // nazionale
    expect(isHol(2026, 8, 15)).toBe(false);              // 15 settembre: giorno normale
    // 8 settembre 2030 cade di DOMENICA: già festivo per il giorno della settimana
    expect(dowOf(2030, 8, 8)).toBe(6);
    expect(isFestivo(2030, 8, 8)).toBe(true);
  });
});

describe("effetti sul calcolo del carico weekend/festivo", () => {
  const N = [{ tipo:"N", sott:false, man:false }];
  const M = [{ tipo:"M", sott:false, man:false }];

  it("la notte del 7 settembre 2026 è PREFESTIVA e pesa 2", () => {
    expect(dowOf(2026, 8, 7)).toBe(0);                   // lunedì feriale
    expect(pesoWeekend(2026, 8, 30, 7, N)).toBe(2);
  });

  it("la mattina dell'8 settembre pesa 1 come una mattina di domenica", () => {
    expect(pesoWeekend(2026, 8, 30, 8, M)).toBe(1);
    // controprova: la mattina di un martedì feriale non pesa nulla
    expect(pesoWeekend(2026, 8, 30, 15, M)).toBe(0);
  });
});

describe("effetti sulla generazione di settembre 2026 (8/9 = martedì)", () => {
  // NOTA sui test di generazione: la ricerca ha un BUDGET A TEMPO, quindi il
  // tabellone prodotto non è deterministico e r.ok può essere false su una
  // macchina carica. Si asseriscono perciò solo INVARIANTI DURI (tetti massimi
  // e divieti, che il motore rispetta sempre); le proprietà che dipendono dal
  // raggiungimento dei MINIMI si verificano solo quando la generazione è
  // riuscita, altrimenti il test misura la CPU invece del codice.
  const anno=2026, mese=8;

  it("nessun ambulatorio il giorno del patrono, ambulatorio negli altri martedì", () => {
    const nd = dimOf(anno,mese);
    const medici = mediciTest();
    expect(dowOf(anno,mese,8)).toBe(1);                  // martedì = giorno d'ambulatorio di default
    const r = generaMigliorTentativo(anno, mese, nd, medici, {}, 8000);

    const conA = (g:number) => medici.filter(m=>(r.turni[m.id]?.[g]?.t||[]).some(s=>s.tipo==="A"));
    // INVARIANTE: l'ambulatorio nei festivi è VIETATO, riuscita o no la ricerca.
    expect(conA(8).length).toBe(0);
    for(let g=1; g<=nd; g++){
      if(dowOf(anno,mese,g)!==1 || g===8) continue;      // solo i martedì, patrono escluso
      expect(conA(g).every(m=>m.ambulatorio)).toBe(true);// mai un non abilitato
      if(r.ok) expect(conA(g).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("l'8 settembre rispetta il fabbisogno FESTIVO, non quello feriale", () => {
    const nd = dimOf(anno,mese);
    const medici = mediciTest();
    const r = generaMigliorTentativo(anno, mese, nd, medici, {}, 8000);
    const cf = (g:number, tipo:string) => {
      let n=0;
      for(const m of medici) for(const s of (r.turni[m.id]?.[g]?.t||[])) if(s.tipo===tipo) n++;
      return n;
    };
    // INVARIANTE: i MASSIMI festivi (mMax=1, pMax=1) sono tetti duri, contro
    // fer 3/2. Se valessero i feriali, qui passerebbero 2-3 mattine.
    expect(cf(8,"M")).toBeLessThanOrEqual(1);
    expect(cf(8,"P")).toBeLessThanOrEqual(1);
    if(r.ok){
      expect(cf(8,"M")).toBe(1);                         // minimi raggiunti
      expect(cf(8,"P")).toBe(1);
      expect(cf(15,"M")).toBeGreaterThanOrEqual(2);      // controprova: martedì feriale
    }
  });
});
