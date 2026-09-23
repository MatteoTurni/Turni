import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Medico, TurniMese, Ambulatorio } from "../types";
import { dimOf, dowOf, isHol } from "../date";
import { abilitatoAmb, ambIdDi, etichettaTurno, slotAmbGiorno } from "../turni";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../regole";
import { setSalt, setAmbRotStart, setPrevContext } from "../state";
import { generaMigliorTentativo, calcAmbRotNext } from "../genera";

// ── PIÙ AMBULATORI (v0.3.36) ─────────────────────────────────────────────────
// Ogni ambulatorio ha giorni/fasce e abilitati propri; l'equità si misura sul
// TOTALE degli ambulatori fatti; due ambulatori nella stessa fascia vanno a
// medici diversi.

const DIA: Ambulatorio = { id:"dia", nome:"Diabetologia", sigla:"DIA", giorni:{ 1:"M", 3:"P" } };
const CAR: Ambulatorio = { id:"car", nome:"Cardiologia",  sigla:"CAR", giorni:{ 1:"M" } };

const mediciTest = (): Medico[] => [
  { id:1,  nome:"D. BALDI",      codice:"1",  stato:"MR",  obiettivo:25, ambulatorio:false, ambulatori:[] },
  { id:2,  nome:"M. RENIS",      codice:"2",  stato:"MR",  obiettivo:25, ambulatorio:true,  ambulatori:["dia"] },
  { id:3,  nome:"M. GENTILE",    codice:"3",  stato:"MDC", obiettivo:21, ambulatorio:false, ambulatori:[] },
  { id:4,  nome:"A. DEL GATTO",  codice:"4",  stato:"ML",  obiettivo:25, ambulatorio:false, ambulatori:[] },
  { id:5,  nome:"C. CIAMPA",     codice:"5",  stato:"MR",  obiettivo:25, ambulatorio:true,  ambulatori:["dia","car"] },
  { id:6,  nome:"V. SPUGNARDI",  codice:"6",  stato:"MR",  obiettivo:25, ambulatorio:true,  ambulatori:["car"] },
  { id:7,  nome:"M. STEFANUCCI", codice:"7",  stato:"MR",  obiettivo:25, ambulatorio:true,  ambulatori:["car"] },
  { id:8,  nome:"M. LEZZI",      codice:"8",  stato:"MR",  obiettivo:25, ambulatorio:true,  ambulatori:["dia"] },
  { id:9,  nome:"V. GIORDANO",   codice:"9",  stato:"MR",  obiettivo:25, ambulatorio:false, ambulatori:[] },
  { id:10, nome:"B. CASILLI",    codice:"10", stato:"MPS", obiettivo:0,  ambulatorio:false },
  { id:11, nome:"P. SCUDERI",    codice:"11", stato:"MPS", obiettivo:0,  ambulatorio:false },
];

const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
const regole = (ambulatori: Ambulatorio[]) => mergeRegole({ ...dft(), ambulatori });
/** Medici che coprono l'ambulatorio `amb` col codice `cod` nel giorno g. */
const chi = (T:TurniMese, medici:Medico[], g:number, amb:string, cod:string) =>
  medici.filter(m=>(T[m.id]?.[g]?.t||[]).some(s=>s.tipo===cod && ambIdDi(s)===amb));

beforeEach(()=>{ setSalt(0); setAmbRotStart(0); setPrevContext(null, 2026, 5); setRegole(dft()); });
afterEach(()=>{ setRegole(dft()); });

describe("utility", () => {
  it("abilitatoAmb: lista esplicita, altrimenti il vecchio flag vale per \"A\"", () => {
    const m = mediciTest();
    expect(abilitatoAmb(m[4], "dia")).toBe(true);
    expect(abilitatoAmb(m[4], "car")).toBe(true);
    expect(abilitatoAmb(m[1], "car")).toBe(false);
    const vecchio: Medico = { id:99, nome:"X", codice:"", stato:"MR", obiettivo:25, ambulatorio:true };
    expect(abilitatoAmb(vecchio, "A")).toBe(true);
    expect(abilitatoAmb(vecchio, "dia")).toBe(false);
    expect(abilitatoAmb({ ...vecchio, stato:"MPS" }, "A")).toBe(false);
  });

  it("slotAmbGiorno ed etichettaTurno", () => {
    expect(slotAmbGiorno([DIA, CAR], 1)).toEqual([{ amb:"dia", cod:"A" }, { amb:"car", cod:"A" }]);
    expect(slotAmbGiorno([DIA, CAR], 3)).toEqual([{ amb:"dia", cod:"Ap" }]);
    expect(slotAmbGiorno([DIA, CAR], 0)).toEqual([]);
    expect(etichettaTurno({ tipo:"A", amb:"dia" }, [DIA, CAR])).toBe("DIA");
    expect(etichettaTurno({ tipo:"Ap", amb:"dia" }, [DIA, CAR])).toBe("DIAp");
    expect(etichettaTurno({ tipo:"A", amb:"sparito" }, [DIA, CAR])).toBe("A");
    expect(etichettaTurno({ tipo:"M" }, [DIA, CAR])).toBe("M");
  });
});

describe("generazione con due ambulatori", () => {
  const anno=2026, mese=5;   // giugno 2026: 2/6 festivo di martedì

  it("ogni slot è coperto da un SUO abilitato; stessa fascia → medici diversi", () => {
    setRegole(regole([DIA, CAR]));
    const nd=dimOf(anno,mese), medici=mediciTest();
    const r = generaMigliorTentativo(anno, mese, nd, medici, {}, 3000);
    expect(r.ok).toBe(true);
    expect(r.problemi).toEqual([]);
    for(let g=1; g<=nd; g++){
      const dw = dowOf(anno,mese,g), fer = !isHol(anno,mese,g);
      const diaA = chi(r.turni, medici, g, "dia", "A"), carA = chi(r.turni, medici, g, "car", "A");
      const diaP = chi(r.turni, medici, g, "dia", "Ap");
      if(dw===1 && fer){
        expect(diaA.length).toBe(1); expect(carA.length).toBe(1);
        expect(abilitatoAmb(diaA[0], "dia")).toBe(true);
        expect(abilitatoAmb(carA[0], "car")).toBe(true);
        expect(diaA[0].id).not.toBe(carA[0].id);
      } else { expect(diaA.length).toBe(0); expect(carA.length).toBe(0); }
      if(dw===3 && fer){
        expect(diaP.length).toBe(1);
        expect(abilitatoAmb(diaP[0], "dia")).toBe(true);
      } else expect(diaP.length).toBe(0);
    }
  });

  it("equità sul TOTALE: nessun abilitato resta a zero, scarto max−min contenuto", () => {
    setRegole(regole([DIA, CAR]));
    const nd=dimOf(anno,mese), medici=mediciTest();
    const r = generaMigliorTentativo(anno, mese, nd, medici, {}, 3000);
    const abil = medici.filter(m=>(m.ambulatori??[]).length>0);
    const tot = abil.map(m=>{
      let k=0; for(let g=1; g<=nd; g++) for(const s of (r.turni[m.id]?.[g]?.t||[])) if(s.tipo==="A"||s.tipo==="Ap") k++;
      return k;
    });
    // 4 martedì feriali × 2 + 4 mercoledì × 1 = 12 slot su 5 abilitati
    expect(tot.reduce((a,b)=>a+b,0)).toBe(12);
    expect(Math.min(...tot)).toBeGreaterThan(0);
    expect(Math.max(...tot)-Math.min(...tot)).toBeLessThanOrEqual(2);
  });

  it("un ambulatorio senza abilitati resta scoperto e viene segnalato col suo nome", () => {
    const VUOTO: Ambulatorio = { id:"vuoto", nome:"Pneumologia", sigla:"PNE", giorni:{ 4:"M" } };
    setRegole(regole([DIA, VUOTO]));
    const nd=dimOf(anno,mese), medici=mediciTest();
    const r = generaMigliorTentativo(anno, mese, nd, medici, {}, 3000);
    expect(r.problemi.some(p=>p.includes("ambulatorio Pneumologia mancante"))).toBe(true);
    for(let g=1; g<=nd; g++) expect(chi(r.turni, medici, g, "vuoto", "A").length).toBe(0);
  });

  it("una A manuale di un ambulatorio non copre l'altro", () => {
    setRegole(regole([DIA, CAR]));
    const nd=dimOf(anno,mese), medici=mediciTest();
    expect(dowOf(anno,mese,9)).toBe(1);
    const T: TurniMese = { "5": { "9": { t:[{tipo:"A",sott:false,man:true,amb:"car"}] } } };
    const r = generaMigliorTentativo(anno, mese, nd, medici, T, 3000);
    expect(chi(r.turni, medici, 9, "car", "A").map(m=>m.id)).toEqual([5]);
    const dia = chi(r.turni, medici, 9, "dia", "A");
    expect(dia.length).toBe(1);
    expect(dia[0].id).not.toBe(5);
  });

  it("calcAmbRotNext gira sugli abilitati ad almeno un ambulatorio", () => {
    setRegole(regole([DIA, CAR]));
    const nd=dimOf(anno,mese), medici=mediciTest();   // abilitati: ids 2,5,6,7,8 → indici 0..4
    const T: TurniMese = { "7": { "23": { t:[{tipo:"A",sott:false,man:false,amb:"car"}] } } };
    expect(calcAmbRotNext(T, medici, anno, mese, nd, 0)).toBe(4);
  });
});
