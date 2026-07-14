import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { dimOf, dowOf, isHol, isFestivo } from "../date";
import { SPEC, isMatt, isNot, isPom } from "../turni";
import { setRegole, REGOLE_DEFAULT, getRegole } from "../regole";
import { ENG, setSalt, setAmbRotStart, setPrevContext } from "../state";
import { makeCtx } from "../ctx";
import { validazioneGlobale } from "../fasi";
import { generaMigliorTentativo, completaObiettivi, problemiResidui, buchiCopertura, calcAmbRotNext } from "../genera";

// ─── SQUADRA SINTETICA (stessa composizione del reparto reale) ────────────────
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

// Assenza L su un intervallo di giorni (turni manuali, come farebbe l'utente).
function conAssenze(assenze: Record<number,[number,number][]>): TurniMese {
  const T: TurniMese = {};
  for(const idS in assenze){
    const id = +idS;
    for(const [da,a] of assenze[idS as unknown as number]){
      for(let g=da; g<=a; g++){
        (T[id] ||= {})[g] = { t: [{ tipo:"L", sott:false, man:true }] };
      }
    }
  }
  return T;
}

// ─── VALIDATORI INDIPENDENTI (non riusano il codice del ctx) ─────────────────
const lavora = (T:TurniMese,id:number,g:number) => (T[id]?.[g]?.t||[]).some(s=>!SPEC.includes(s.tipo));

function violaRegolaNStretta(T:TurniMese, medici:Medico[], ndim:number){
  for(const m of medici){
    if(m.stato==="MPS") continue;
    for(let g=1; g<=ndim; g++){
      const haN = (T[m.id]?.[g]?.t||[]).some(s=>isNot(s.tipo));
      if(!haN) continue;
      if(g+1<=ndim && lavora(T,m.id,g+1)) return `id${m.id} g${g}: g+1 lavorato`;
      if(g+2<=ndim){
        const sh=(T[m.id]?.[g+2]?.t||[]).filter(s=>!SPEC.includes(s.tipo));
        if(sh.some(s=>isMatt(s.tipo)||isNot(s.tipo))) return `id${m.id} g${g}: g+2 con mattina/notte`;
        if(sh.filter(s=>isPom(s.tipo)).length>1) return `id${m.id} g${g}: g+2 con più P`;
      }
    }
  }
  return null;
}

function maxConsecutivi(T:TurniMese, medici:Medico[], ndim:number){
  let mx=0;
  for(const m of medici){
    if(m.stato==="MPS") continue;
    let run=0;
    for(let g=1; g<=ndim; g++){
      if(lavora(T,m.id,g)){ run++; mx=Math.max(mx,run); } else run=0;
    }
  }
  return mx;
}

function maxNottiPerMedico(T:TurniMese, medici:Medico[], ndim:number){
  let mx=0;
  for(const m of medici){
    let n=0;
    for(let g=1; g<=ndim; g++) for(const s of (T[m.id]?.[g]?.t||[])) if(isNot(s.tipo)&&!s.sott) n++;
    mx=Math.max(mx,n);
  }
  return mx;
}

function cfDi(T:TurniMese, medici:Medico[], g:number, tipo:string){
  let n=0;
  for(const m of medici) for(const s of (T[m.id]?.[g]?.t||[])) if(s.tipo===tipo) n++;
  return n;
}

beforeEach(()=>{
  setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));
  ENG.PREV = null;
  setSalt(0);
  setAmbRotStart(0);
});

describe("generazione: mese senza assenze (giugno 2026)", () => {
  it("produce un tabellone perfetto che rispetta tutti gli invarianti", () => {
    const anno=2026, mese=5, nd=dimOf(anno,mese);
    const medici = mediciTest();
    const r = generaMigliorTentativo(anno, mese, nd, medici, {}, 3000);

    expect(r.ok).toBe(true);
    expect(r.problemi).toEqual([]);

    // invarianti verificati in modo INDIPENDENTE dal motore
    expect(violaRegolaNStretta(r.turni, medici, nd)).toBe(null);
    expect(maxConsecutivi(r.turni, medici, nd)).toBeLessThanOrEqual(getRegole().maxConsec);
    expect(maxNottiPerMedico(r.turni, medici, nd)).toBeLessThanOrEqual(getRegole().maxNotti);

    for(let g=1; g<=nd; g++){
      // una notte per giorno, sempre
      expect(cfDi(r.turni,medici,g,"N")).toBeGreaterThanOrEqual(1);
      // sui festivi il fabbisogno massimo (1/1) non va MAI superato
      if(isFestivo(anno,mese,g)){
        expect(cfDi(r.turni,medici,g,"M")).toBeLessThanOrEqual(getRegole().fabb.fest.mMax);
        expect(cfDi(r.turni,medici,g,"P")).toBeLessThanOrEqual(getRegole().fabb.fest.pMax);
      }
      // ogni martedì feriale ha l'ambulatorio, assegnato a un abilitato
      if(dowOf(anno,mese,g)===1 && !isHol(anno,mese,g)){
        const assegnatari = medici.filter(m=>(r.turni[m.id]?.[g]?.t||[]).some(s=>s.tipo==="A"));
        expect(assegnatari.length).toBeGreaterThanOrEqual(1);
        expect(assegnatari.every(m=>m.ambulatorio)).toBe(true);
      }
    }
  });
});

describe("generazione: mese con N assenze note (marzo 2026)", () => {
  it("copre comunque tutto il fabbisogno", () => {
    const anno=2026, mese=2, nd=dimOf(anno,mese);
    const medici = mediciTest();
    // due medici in ferie una settimana a testa, sfalsati
    const ex = conAssenze({ 1:[[2,8]], 7:[[16,22]] });
    const r = generaMigliorTentativo(anno, mese, nd, medici, ex, 4000);

    const probs = problemiResidui(anno, mese, nd, medici, r.turni, false);
    expect(buchiCopertura(probs)).toBe(0);                    // copertura piena
    expect(violaRegolaNStretta(r.turni, medici, nd)).toBe(null);
    expect(maxConsecutivi(r.turni, medici, nd)).toBeLessThanOrEqual(getRegole().maxConsec);
    // le assenze manuali sono rimaste intatte
    for(let g=2; g<=8; g++) expect((r.turni[1]?.[g]?.t||[]).some(s=>s.tipo==="L"&&s.man)).toBe(true);
    for(let g=2; g<=8; g++) expect((r.turni[1]?.[g]?.t||[]).some(s=>!SPEC.includes(s.tipo))).toBe(false);
  });
});

describe("generazione: agosto 2026 difficile (ferie concentrate)", () => {
  it("gli invarianti duri reggono e la semantica ok è coerente con la validazione stretta", () => {
    const anno=2026, mese=7, nd=dimOf(anno,mese);
    const medici = mediciTest();
    // 4 medici via per quindicine sovrapposte + un quinto a cavallo di Ferragosto
    const ex = conAssenze({ 1:[[1,16]], 2:[[1,16]], 5:[[14,31]], 6:[[14,31]], 8:[[10,20]] });
    const r = generaMigliorTentativo(anno, mese, nd, medici, ex, 5000);

    // Vincoli DURI: valgono SEMPRE, anche su un risultato parziale/di emergenza.
    expect(maxConsecutivi(r.turni, medici, nd)).toBeLessThanOrEqual(getRegole().maxConsec);
    expect(maxNottiPerMedico(r.turni, medici, nd)).toBeLessThanOrEqual(getRegole().maxNotti);
    for(let g=1; g<=nd; g++){
      if(isFestivo(anno,mese,g)){
        expect(cfDi(r.turni,medici,g,"M")).toBeLessThanOrEqual(getRegole().fabb.fest.mMax);
        expect(cfDi(r.turni,medici,g,"P")).toBeLessThanOrEqual(getRegole().fabb.fest.pMax);
      }
      // mai una A automatica a un non abilitato
      for(const m of medici){
        if(m.ambulatorio) continue;
        expect((r.turni[m.id]?.[g]?.t||[]).some(s=>!s.man&&["A"].includes(s.tipo))).toBe(false);
      }
    }

    // FIX SEMANTICA "ok" (regressione): il verdetto deve coincidere con la
    // validazione STRETTA rifatta da zero sul tabellone restituito. Se il ramo
    // rilassato è stato adottato, la violazione della Regola N stretta DEVE
    // comparire nei problemi e ok DEVE essere false.
    const c = makeCtx(anno, mese, nd, medici, r.turni);
    const probsStretti = validazioneGlobale(c);
    expect(r.ok).toBe(probsStretti.length===0);
    if(violaRegolaNStretta(r.turni, medici, nd)!==null){
      expect(r.ok).toBe(false);
      expect(r.problemi.some(p=>p.includes("Regola N"))).toBe(true);
    }
  });

  it("problemiResidui: la validazione stretta segnala N→libero→N, quella rilassata no", () => {
    const anno=2026, mese=7, nd=dimOf(anno,mese);
    const medici = mediciTest();
    // tabellone artificiale con violazione stretta della Regola N (N g5, N g7)
    const T: TurniMese = { "1": {
      "5": { t:[{tipo:"N",sott:false,man:false}] },
      "7": { t:[{tipo:"N",sott:false,man:false}] },
    } };
    const strette  = problemiResidui(anno, mese, nd, medici, T, false);
    const rilassate= problemiResidui(anno, mese, nd, medici, T, true);
    expect(strette.some(p=>p.includes("Regola N"))).toBe(true);
    expect(rilassate.some(p=>p.includes("Regola N"))).toBe(false);
    // i BUCHI di copertura invece non dipendono da relaxN
    expect(buchiCopertura(strette)).toBe(buchiCopertura(rilassate));
  });
});

describe("continuità col mese precedente", () => {
  it("una N manuale sull'ultimo giorno di M-1 impone giorno 1 libero e giorno 2 senza mattine", () => {
    const anno=2026, mese=6, nd=dimOf(anno,mese);      // luglio 2026
    const medici = mediciTest();
    const turniGiu: TurniMese = { "3": { "30": { t:[{tipo:"N",sott:false,man:true}] } } };
    setPrevContext({ "2026-06": turniGiu }, anno, mese);
    const r = generaMigliorTentativo(anno, mese, nd, medici, {}, 3000);
    expect(lavora(r.turni, 3, 1)).toBe(false);
    const sh2=(r.turni[3]?.[2]?.t||[]).filter(s=>!SPEC.includes(s.tipo));
    expect(sh2.some(s=>isMatt(s.tipo)||isNot(s.tipo))).toBe(false);
  });
});

describe("completaObiettivi", () => {
  it("porta i medici verso l'obiettivo senza rompere gli invarianti", () => {
    const anno=2026, mese=5, nd=dimOf(anno,mese);
    const medici = mediciTest();
    const r1 = generaMigliorTentativo(anno, mese, nd, medici, {}, 2500);
    const r2 = completaObiettivi(anno, mese, nd, medici, r1.turni);
    expect(violaRegolaNStretta(r2.turni, medici, nd)).toBe(null);
    expect(maxConsecutivi(r2.turni, medici, nd)).toBeLessThanOrEqual(getRegole().maxConsec);
    // nessun medico oltre l'obiettivo per effetto dei turni automatici
    const c = makeCtx(anno, mese, nd, medici, r2.turni);
    for(const m of medici){
      if(m.stato==="MPS") continue;
      expect(c.cnt(m.id)).toBeLessThanOrEqual(m.obiettivo);
      expect(c.cnt(m.id)).toBeGreaterThanOrEqual(Math.min(c.cnt(m.id), m.obiettivo));
    }
  });
});

describe("rotazione ambulatorio", () => {
  it("calcAmbRotNext deriva l'indice successivo dal tabellone accettato", () => {
    const anno=2026, mese=5, nd=dimOf(anno,mese);      // giugno 2026: martedì 2,9,16,23,30 (il 2 è festivo)
    const medici = mediciTest();
    const ab = medici.filter(m=>m.ambulatorio);        // ids 2,5,6,8 → indici 0..3
    // A automatiche: martedì 9 → id 5 (idx 1), martedì 16 → id 6 (idx 2)
    const T: TurniMese = {
      "5": { "9":  { t:[{tipo:"A",sott:false,man:false}] } },
      "6": { "16": { t:[{tipo:"A",sott:false,man:false}] } },
    };
    // l'ultimo martedì con A automatica è il 16 (idx 2) → next = 3
    expect(calcAmbRotNext(T, medici, anno, mese, nd, 0)).toBe(3);
    expect(ab[2].id).toBe(6);
    // nessuna A automatica → l'indice resta quello di partenza
    expect(calcAmbRotNext({}, medici, anno, mese, nd, 2)).toBe(2);
    // le A MANUALI non fanno avanzare la rotazione
    const TM: TurniMese = { "5": { "9": { t:[{tipo:"A",sott:false,man:true}] } } };
    expect(calcAmbRotNext(TM, medici, anno, mese, nd, 1)).toBe(1);
  });
});

describe("giorni di ambulatorio configurabili (regole.giorniAmb)", () => {
  it("con martedì+mercoledì la A viene generata su ENTRAMBI i giorni feriali", () => {
    setRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), giorniAmb:[1,2] });
    const anno=2026, mese=5, nd=dimOf(anno,mese);   // giugno 2026 (2/6 festivo di martedì)
    const medici = mediciTest();
    const r = generaMigliorTentativo(anno, mese, nd, medici, {}, 3000);
    expect(r.ok).toBe(true);

    for(let g=1; g<=nd; g++){
      const dw = dowOf(anno,mese,g), fer = !isHol(anno,mese,g);
      const assegnatari = medici.filter(m=>(r.turni[m.id]?.[g]?.t||[]).some(s=>s.tipo==="A"));
      if((dw===1||dw===2) && fer){
        // ogni martedì/mercoledì feriale ha l'ambulatorio, a un abilitato
        expect(assegnatari.length).toBeGreaterThanOrEqual(1);
        expect(assegnatari.every(m=>m.ambulatorio)).toBe(true);
      } else {
        // nessuna A automatica fuori dai giorni configurati
        expect(assegnatari.length).toBe(0);
      }
    }
  });

  it("calcAmbRotNext segue i giorni configurati: una A del mercoledì fa avanzare l'indice", () => {
    setRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), giorniAmb:[1,2] });
    const anno=2026, mese=5, nd=dimOf(anno,mese);
    const medici = mediciTest();                       // abilitati: ids 2,5,6,8 → indici 0..3
    // Mercoledì 24 giugno 2026: A automatica a id 8 (idx 3) → next = 0.
    // Col solo martedì (default) questo giorno sarebbe IGNORATO.
    const T: TurniMese = { "8": { "24": { t:[{tipo:"A",sott:false,man:false}] } } };
    expect(dowOf(anno,mese,24)).toBe(2);
    expect(calcAmbRotNext(T, medici, anno, mese, nd, 1)).toBe(0);
    setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));
    expect(calcAmbRotNext(T, medici, anno, mese, nd, 1)).toBe(1);
  });

  it("con giorniAmb vuoto non viene generata NESSUNA A e la validazione non protesta", () => {
    setRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), giorniAmb:[] });
    const anno=2026, mese=5, nd=dimOf(anno,mese);
    const medici = mediciTest();
    const r = generaMigliorTentativo(anno, mese, nd, medici, {}, 3000);
    expect(r.ok).toBe(true);
    expect(r.problemi).toEqual([]);
    for(let g=1; g<=nd; g++)
      for(const m of medici)
        expect((r.turni[m.id]?.[g]?.t||[]).some(s=>s.tipo==="A")).toBe(false);
  });
});
