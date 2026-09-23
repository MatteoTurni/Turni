// Profilo della rifinitura: replica i passi di rifinituraFinale con timer.
import { dimOf } from "../src/engine/date";
import { setRegole, REGOLE_DEFAULT } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { makeCtx } from "../src/engine/ctx";
import { riparaBuchi, riequilibraWeekendLiberi } from "../src/engine/fasi";
import { cercaMigliorTentativo, misuraTabellone, generaConUltimaChance } from "../src/engine/genera";
import { diagnosiCausale } from "../src/engine/diagnosiCausale";
import { cloneT } from "../src/engine/turni";
import type { Medico, TurniMese } from "../src/engine/types";

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
function conAssenze(assenze: Record<number,[number,number][]>): TurniMese {
  const T: TurniMese = {};
  for(const idS in assenze){ const id=+idS;
    for(const [da,a] of assenze[idS as any]) for(let g=da; g<=a; g++) (T[id] ||= {})[g]={t:[{tipo:"L",sott:false,man:true}]};
  }
  return T;
}

const quale = process.argv[2] || "sint";
let anno=2026, mese=7, medici=mediciBase(), ex: TurniMese = {};
if(quale==="sint"){ ex = conAssenze({1:[[1,15]], 2:[[10,24]], 5:[[16,31]], 7:[[1,15]], 9:[[16,31]]}); }
if(quale==="ridotto"){ mese=5; medici=mediciBase().filter(m=>![7,9].includes(m.id)); }
if(quale==="obj15"){ mese=5; medici=mediciBase().map(m=>({...m, obiettivo:m.stato==="MPS"?0:15})); }

setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));
ENG.PREV=null; setSalt(0); setAmbRotStart(0);
const ndim=dimOf(anno,mese);
const T=(l:string,f:()=>any)=>{ const t0=Date.now(); const r=f(); console.log(l, Date.now()-t0+"ms"); return r; };

const cerca = T("cerca(800ms)", ()=>cercaMigliorTentativo(anno,mese,ndim,medici,ex,800));
const m0 = misuraTabellone(anno,mese,ndim,medici,cerca.turni);
console.log("  s=",m0.s,"buchi=",m0.buchi,"wkDef=",m0.wkDef,"tentativi=",cerca.tentativi);
if(m0.buchi>0) T("riparaBuchi", ()=>{ const c=makeCtx(anno,mese,ndim,medici,cloneT(cerca.turni)); return riparaBuchi(c,424243,ENG.REBAL_NODES); });
if(m0.wkDef>0) T("riequilibraWk", ()=>{ const c=makeCtx(anno,mese,ndim,medici,cloneT(cerca.turni)); return riequilibraWeekendLiberi(c); });
if(m0.buchi>0) T("ultimaChance(1200)", ()=>generaConUltimaChance(anno,mese,ndim,medici,ex,1200));
T("diagnosiCausale(1500)", ()=>diagnosiCausale(anno,mese,ndim,medici,cerca.turni,{maxMs:1500}));
