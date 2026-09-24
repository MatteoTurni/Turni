// Riproduce il caso segnalato: gennaio 2026 vuoto, squadra reale (obiettivi 27,
// MDC 21), generazione + "Completa obiettivi"; turni per MR (M/P/N/totale).
// Uso: node gennaio.cjs <ms> <semi>
import type { Medico } from "../src/engine/types";
import { dimOf } from "../src/engine/date";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { generaMigliorTentativo, completaObiettivi } from "../src/engine/genera";
import { makeCtx } from "../src/engine/ctx";
function mulberry32(seed:number){ let a=seed>>>0; return ()=>{ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
const ms = +(process.argv[2]||2000), semi = +(process.argv[3]||3);
export const squadraGennaio = (): Medico[] => [
  { id:1, nome:"D. BALDI", codice:"8109", stato:"MR", obiettivo:27, ambulatorio:false },
  { id:2, nome:"M. RENIS", codice:"8199", stato:"MR", obiettivo:27, ambulatorio:true },
  { id:3, nome:"M. GENTILE", codice:"8204", stato:"MR", obiettivo:27, ambulatorio:false },
  { id:4, nome:"A. DEL GATTO", codice:"8205", stato:"ML", obiettivo:27, ambulatorio:false },
  { id:5, nome:"C. CIAMPA", codice:"12086", stato:"MR", obiettivo:27, ambulatorio:true },
  { id:6, nome:"V. SPUGNARDI", codice:"12088", stato:"MR", obiettivo:27, ambulatorio:true },
  { id:7, nome:"M. STEFANUCCI", codice:"12334", stato:"MR", obiettivo:27, ambulatorio:false },
  { id:8, nome:"M. LEZZI", codice:"12523", stato:"MDC", obiettivo:21, ambulatorio:true },
  { id:9, nome:"V. GIORDANO", codice:"12497", stato:"MR", obiettivo:27, ambulatorio:false },
  { id:10, nome:"B. CASILLI", codice:"8175", stato:"MPS", obiettivo:0, ambulatorio:false },
  { id:11, nome:"P. SCUDERI", codice:"60680", stato:"MPS", obiettivo:0, ambulatorio:false },
];
const anno=2026, mese=0, nd=dimOf(anno,mese);
const tot = { rngP:0, rngTot:0 };
for(let s=0; s<semi; s++){
  setRegole(mergeRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)))); ENG.PREV=null; setSalt(0); setAmbRotStart(s%4);
  const medici = squadraGennaio();
  const mr0 = Math.random; (Math as any).random = mulberry32(1000+s);
  let r; try{ r = generaMigliorTentativo(anno,mese,nd,medici,{},ms); } finally { (Math as any).random = mr0; }
  const o = completaObiettivi(anno,mese,nd,medici,r.turni);
  const c = makeCtx(anno,mese,nd,medici,o.turni);
  const righe = c.mr.map(m=>{ let M=0,P=0; for(let g=1;g<=nd;g++){ const sh=c.gt(m.id,g); if(sh.some(x=>x.tipo==="M"||x.tipo==="A")) M++; if(sh.some(x=>x.tipo==="P"||x.tipo==="Ap")) P++; } return { n:m.nome.split(" ").pop(), M, P, N:c.cntN(m.id), t:c.cnt(m.id) }; });
  const P = righe.map(x=>x.P), T = righe.map(x=>x.t);
  tot.rngP += Math.max(...P)-Math.min(...P); tot.rngTot += Math.max(...T)-Math.min(...T);
  console.log(`seme ${s}: `+righe.map(x=>`${x.n} ${x.M}M/${x.P}P/${x.N}N=${x.t}`).join("  ")+`  | MDC ${c.cnt(8)}/21 ML ${c.cnt(4)}`);
}
console.log(`media forbice pomeriggi ${(tot.rngP/semi).toFixed(1)}, forbice totali ${(tot.rngTot/semi).toFixed(1)}`);
