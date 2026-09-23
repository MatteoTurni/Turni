// A/B del festivo locale dell'8 settembre (v0.3.31).
// Stessi scenari di settembre, R run ciascuno: si misura l'IMPATTO del giorno
// festivo in più (non un miglioramento: la modifica è definitoria). Il confronto
// ON/OFF si fa lanciando due volte questo script, con e senza "09-08" nel Set
// FESTIVI_LOCALI di date.ts.
import type { Medico, TurniMese } from "../src/engine/types";
import { dimOf, isFestivo } from "../src/engine/date";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { generaMigliorTentativo, misuraTabellone, problemiResidui, buchiCopertura } from "../src/engine/genera";

const mediciBase = (): Medico[] => [
  { id:1,  nome:"BALDI",      codice:"1",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:2,  nome:"RENIS",      codice:"2",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:3,  nome:"GENTILE",    codice:"3",  stato:"MDC", obiettivo:21, ambulatorio:false },
  { id:4,  nome:"DELGATTO",   codice:"4",  stato:"ML",  obiettivo:25, ambulatorio:false },
  { id:5,  nome:"CIAMPA",     codice:"5",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:6,  nome:"SPUGNARDI",  codice:"6",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:7,  nome:"STEFANUCCI", codice:"7",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:8,  nome:"LEZZI",      codice:"8",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:9,  nome:"GIORDANO",   codice:"9",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:10, nome:"CASILLI",    codice:"10", stato:"MPS", obiettivo:0,  ambulatorio:false },
  { id:11, nome:"SCUDERI",    codice:"11", stato:"MPS", obiettivo:0,  ambulatorio:false },
];
function conAssenze(a: Record<number,[number,number][]>): TurniMese {
  const T: TurniMese = {};
  for(const idS in a){ const id=+idS;
    for(const [da,b] of a[idS as any]) for(let g=da; g<=b; g++)
      (T[id] ||= {})[g] = { t:[{ tipo:"L", sott:false, man:true }] };
  }
  return T;
}

const SCEN = [
  { nome:"set26-vuoto",     anno:2026, mese:8, medici:mediciBase(), ex:{} },
  { nome:"set26-lungodeg",  anno:2026, mese:8, medici:mediciBase(), ex: conAssenze({1:[[1,30]], 2:[[1,15]]}) },
  { nome:"set27-mercoledi", anno:2027, mese:8, medici:mediciBase(), ex:{} },
  { nome:"set30-domenica",  anno:2030, mese:8, medici:mediciBase(), ex:{} },
];
const FILT = process.argv[4] ?? "";
const R = Number(process.argv[2] ?? 6);
const MS = Number(process.argv[3] ?? 8000);

console.log(`run=${R} maxMs=${MS}`);
for(const sc of SCEN){
  if(FILT && !sc.nome.includes(FILT)) continue;
  const nd = dimOf(sc.anno, sc.mese);
  const acc = { ok:0, buchi:0, viol:0, s:0, wkScarto:0, wkDef:0, ambPatrono:0, ms:0 };
  for(let r=0; r<R; r++){
    setRegole(mergeRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT))));
    ENG.PREV = null; setSalt(r*977); setAmbRotStart(r%4);
    const t0 = Date.now();
    const res = generaMigliorTentativo(sc.anno, sc.mese, nd, sc.medici, sc.ex, MS);
    acc.ms += Date.now()-t0;
    const m = misuraTabellone(sc.anno, sc.mese, nd, sc.medici, res.turni);
    const pr = problemiResidui(sc.anno, sc.mese, nd, sc.medici, res.turni);
    acc.ok += res.ok?1:0;
    acc.buchi += m.buchi; acc.s += m.s; acc.wkScarto += m.wkScarto; acc.wkDef += m.wkDef;
    acc.viol += pr.length - buchiCopertura(pr);
    acc.ambPatrono += sc.medici.some(md=>(res.turni[md.id]?.[8]?.t||[]).some(s=>s.tipo==="A")) ? 1 : 0;
  }
  const f = (x:number)=>(x/R).toFixed(2);
  console.log(`${sc.nome.padEnd(16)} 8/9 festivo=${String(isFestivo(sc.anno,sc.mese,8)).padEnd(5)} ok=${acc.ok}/${R} buchi=${f(acc.buchi)} viol=${f(acc.viol)} s=${f(acc.s)} wkScarto=${f(acc.wkScarto)} wkDef=${f(acc.wkDef)} A@8=${acc.ambPatrono}/${R} ms=${f(acc.ms)}`);
}
