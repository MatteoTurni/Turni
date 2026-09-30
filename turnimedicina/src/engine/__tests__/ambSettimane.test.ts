import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico, TurniMese, Ambulatorio } from "../types";
import { dimOf, dowOf, isHol } from "../date";
import { fasciaAmbGiorno, slotAmbGiorno, ambConfigurato, ambIdDi } from "../turni";
import { setRegole, mergeRegole, getRegole, REGOLE_DEFAULT } from "../regole";
import { setSalt, setAmbRotStart, setPrevContext } from "../state";
import { generaMigliorTentativo } from "../genera";
import { dettaglioFabbisogno } from "../bilancio";

// ── SETTIMANE DEL MESE (v0.3.43) ─────────────────────────────────────────────
// Un ambulatorio può valere solo in alcune occorrenze del giorno nel mese
// (2° e 4° giovedì, primo e ultimo martedì…), con fascia propria.

const GIO = 3, MAR = 1;
const giorniDi = (anno:number, mese:number, dw:number) => {
  const out:number[]=[]; for(let g=1; g<=dimOf(anno,mese); g++) if(dowOf(anno,mese,g)===dw) out.push(g); return out;
};
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));

describe("fasciaAmbGiorno", () => {
  it("2° giovedì di mattina, 4° di pomeriggio, gli altri giovedì niente", () => {
    const a: Ambulatorio = { id:"x", nome:"X", sigla:"X", giorni:{}, settimane:{ [GIO]:{ "2":"M", "4":"P" } } };
    for(const [anno,mese] of [[2026,9],[2026,1],[2027,6]] as const){
      const nd=dimOf(anno,mese), gio=giorniDi(anno,mese,GIO);
      expect(fasciaAmbGiorno(a, GIO, gio[1], nd)).toBe("M");
      expect(fasciaAmbGiorno(a, GIO, gio[3], nd)).toBe("P");
      for(const k of [0,2,4]) if(gio[k]) expect(fasciaAmbGiorno(a, GIO, gio[k], nd)).toBeNull();
    }
  });
  it("primo e ultimo martedì, con 4 e con 5 martedì nel mese", () => {
    const a: Ambulatorio = { id:"x", nome:"X", sigla:"X", giorni:{}, settimane:{ [MAR]:{ "1":"M", "U":"M" } } };
    for(let mese=0; mese<12; mese++){
      const nd=dimOf(2026,mese), mar=giorniDi(2026,mese,MAR);
      const attivi = mar.filter(g=>fasciaAmbGiorno(a, MAR, g, nd));
      expect(attivi).toEqual([mar[0], mar[mar.length-1]]);
    }
  });
  it("la 4ª che è anche l'ultima: le fasce si sommano (un solo giorno, Matt.+Pom.)", () => {
    const a: Ambulatorio = { id:"x", nome:"X", sigla:"X", giorni:{}, settimane:{ [GIO]:{ "4":"M", "U":"P" } } };
    // febbraio 2026: 4 giovedì → il 4° è anche l'ultimo
    const nd=dimOf(2026,1), gio=giorniDi(2026,1,GIO);
    expect(gio.length).toBe(4);
    expect(fasciaAmbGiorno(a, GIO, gio[3], nd)).toBe("MP");
    // ottobre 2026: 5 giovedì → il 4° di mattina, l'ultimo (5°) di pomeriggio
    const nd2=dimOf(2026,9), gio2=giorniDi(2026,9,GIO);
    expect(gio2.length).toBe(5);
    expect(fasciaAmbGiorno(a, GIO, gio2[3], nd2)).toBe("M");
    expect(fasciaAmbGiorno(a, GIO, gio2[4], nd2)).toBe("P");
  });
  it("senza settimane: ogni settimana come prima", () => {
    const a: Ambulatorio = { id:"x", nome:"X", sigla:"X", giorni:{ [MAR]:"MP" } };
    for(const g of giorniDi(2026,9,MAR)) expect(fasciaAmbGiorno(a, MAR, g, 31)).toBe("MP");
    expect(slotAmbGiorno([a], MAR, 6, 31)).toEqual([{ amb:"x", cod:"A" }, { amb:"x", cod:"Ap" }]);
  });
  it("ambConfigurato vede anche i giorni per settimana", () => {
    expect(ambConfigurato({ id:"x", nome:"X", sigla:"X", giorni:{} })).toBe(false);
    expect(ambConfigurato({ id:"x", nome:"X", sigla:"X", giorni:{}, settimane:{ [GIO]:{ "2":"M" } } })).toBe(true);
    expect(ambConfigurato({ id:"x", nome:"X", sigla:"X", giorni:{}, settimane:{ [GIO]:{} } })).toBe(false);
  });
});

describe("regole: salvataggio e fabbisogno", () => {
  it("mergeRegole conserva le settimane valide e scarta quelle non valide", () => {
    const r = mergeRegole({ ...dft(), ambulatori:[
      { id:"x", nome:"X", sigla:"X", giorni:{ [MAR]:"M" }, settimane:{ [GIO]:{ "2":"M", "4":"P", "9":"M", "U":"zz" }, 7:{ "1":"M" }, [MAR]:{} } },
    ] } as any);
    expect(r.ambulatori[0].settimane).toEqual({ [GIO]:{ "2":"M", "4":"P" } });
    expect(r.ambulatori[0].giorni).toEqual({ [MAR]:"M" });
  });
  it("il fabbisogno conta solo i giorni effettivi", () => {
    const r = mergeRegole({ ...dft(), ambulatori:[ { id:"x", nome:"X", sigla:"X", giorni:{}, settimane:{ [GIO]:{ "2":"M", "4":"MP" } } } ] } as any);
    // ottobre 2026: 2° e 4° giovedì feriali → 1 + 2 slot
    expect(dettaglioFabbisogno(2026, 9, 31, r).a).toBe(3);
  });
});

describe("generazione", () => {
  const medici = (): Medico[] => [
    { id:1, nome:"D. UNO",   codice:"1", stato:"MR", obiettivo:25, ambulatorio:true, ambulatori:["x"] },
    { id:2, nome:"D. DUE",   codice:"2", stato:"MR", obiettivo:25, ambulatorio:true, ambulatori:["x"] },
    { id:3, nome:"D. TRE",   codice:"3", stato:"MR", obiettivo:25, ambulatorio:false, ambulatori:[] },
    { id:4, nome:"D. QUATTRO", codice:"4", stato:"MR", obiettivo:25, ambulatorio:false, ambulatori:[] },
    { id:5, nome:"D. CINQUE", codice:"5", stato:"MR", obiettivo:25, ambulatorio:true, ambulatori:["x"] },
    { id:6, nome:"D. SEI",   codice:"6", stato:"MR", obiettivo:25, ambulatorio:false, ambulatori:[] },
    { id:7, nome:"D. SETTE", codice:"7", stato:"MR", obiettivo:25, ambulatorio:false, ambulatori:[] },
    { id:8, nome:"D. OTTO",  codice:"8", stato:"ML", obiettivo:25, ambulatorio:false, ambulatori:[] },
  ];
  beforeEach(()=>{ setSalt(0); setAmbRotStart(0); setPrevContext(null, 2026, 9); setRegole(dft()); });
  afterEach(()=>{ setRegole(dft()); });

  it("2° giovedì di mattina e 4° di pomeriggio: ambulatorio SOLO in quei giorni, coperto da un abilitato", () => {
    const anno=2026, mese=9, nd=dimOf(anno,mese);
    setRegole(mergeRegole({ ...dft(), ambulatori:[ { id:"x", nome:"X", sigla:"X", giorni:{}, settimane:{ [GIO]:{ "2":"M", "4":"P" } } } ] } as any));
    expect(getRegole().ambulatori[0].settimane).toBeTruthy();
    const med = medici();
    const r = generaMigliorTentativo(anno, mese, nd, med, {}, 3000);
    expect(r.problemi.filter(p=>/ambulatorio/i.test(p))).toEqual([]);
    const gio = giorniDi(anno,mese,GIO);
    const chi = (T:TurniMese, g:number, cod:string) => med.filter(m=>(T[m.id]?.[g]?.t||[]).some(s=>s.tipo===cod && ambIdDi(s)==="x"));
    for(let g=1; g<=nd; g++){
      const A = chi(r.turni, g, "A"), Ap = chi(r.turni, g, "Ap");
      const atteso = isHol(anno,mese,g) ? "" : g===gio[1] ? "A" : g===gio[3] ? "Ap" : "";
      expect(A.length).toBe(atteso==="A" ? 1 : 0);
      expect(Ap.length).toBe(atteso==="Ap" ? 1 : 0);
      for(const m of [...A, ...Ap]) expect(m.ambulatori).toContain("x");
    }
  });
});
