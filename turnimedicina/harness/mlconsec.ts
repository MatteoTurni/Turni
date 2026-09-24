// ML e tetto di giorni consecutivi: l'ML è ESENTE (v0.3.30). Al variare di
// maxConsec (7 → 2) l'ML deve lavorare come prima (stessi turni, sequenze
// anche più lunghe del tetto), mentre MR/MDC restano entro il tetto.
// Uso: node mlconsec.cjs <ms>
import type { Medico, TurniMese } from "../src/engine/types";
import { dimOf } from "../src/engine/date";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { generaMigliorTentativo, completaObiettivi } from "../src/engine/genera";
import { makeCtx } from "../src/engine/ctx";
import { violazioniIndip, corsaMassima } from "./validatori";

function mulberry32(seed:number){ let a=seed>>>0; return ()=>{ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
const ms = +(process.argv[2] || 1500);
const squadra = (): Medico[] => [
  { id:1, nome:"D. BALDI", codice:"1", stato:"MR", obiettivo:25, ambulatorio:false },
  { id:2, nome:"M. RENIS", codice:"2", stato:"MR", obiettivo:25, ambulatorio:true },
  { id:3, nome:"M. GENTILE", codice:"3", stato:"MDC", obiettivo:21, ambulatorio:false },
  { id:4, nome:"A. DEL GATTO", codice:"4", stato:"ML", obiettivo:25, ambulatorio:false },
  { id:5, nome:"C. CIAMPA", codice:"5", stato:"MR", obiettivo:25, ambulatorio:true },
  { id:6, nome:"V. SPUGNARDI", codice:"6", stato:"MR", obiettivo:25, ambulatorio:true },
  { id:7, nome:"M. STEFANUCCI", codice:"7", stato:"MR", obiettivo:25, ambulatorio:false },
  { id:8, nome:"M. LEZZI", codice:"8", stato:"MR", obiettivo:25, ambulatorio:true },
  { id:9, nome:"V. GIORDANO", codice:"9", stato:"MR", obiettivo:25, ambulatorio:false },
  { id:10, nome:"B. CASILLI", codice:"10", stato:"MPS", obiettivo:0, ambulatorio:false },
  { id:11, nome:"P. SCUDERI", codice:"11", stato:"MPS", obiettivo:0, ambulatorio:false },
];
const L = (T:TurniMese, id:number, da:number, a:number) => { for(let g=da; g<=a; g++) (T[id] ||= {})[g] = { t:[{ tipo:"L", sott:false, man:true }] }; };
const casi: { nome:string; anno:number; mese:number; ex:()=>TurniMese; ml2?:boolean }[] = [
  { nome:"giu26 pieno",      anno:2026, mese:5, ex:()=>({}) },
  { nome:"ago26 ferie",      anno:2026, mese:7, ex:()=>{ const T={}; L(T,1,3,16); L(T,7,10,23); L(T,9,17,30); return T; } },
  { nome:"nov26 ML reduce",  anno:2026, mese:10, ex:()=>{ const T={}; L(T,4,1,9); return T; } },   // l'ML rientra il 10
  { nome:"mar27 due ML",     anno:2027, mese:2, ex:()=>({}), ml2:true },
];
console.log("caso              consec | ML: turni  corsa max | tetto rispettato da MR/MDC | avvisi ML | violazioni");
for(const cs of casi){
  const riga: string[] = [];
  for(const mc of [7,6,5,4,3,2]){
    setRegole(mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), maxConsec: mc }));
    ENG.PREV = null; setSalt(0); setAmbRotStart(0);
    let medici = squadra();
    if(cs.ml2) medici = medici.map(m=>m.id===9 ? { ...m, stato:"ML" as const, nome:"V. GIORDANO" } : m);
    const nd = dimOf(cs.anno, cs.mese), ex = cs.ex();
    const mr = Math.random; (Math as any).random = mulberry32(mc*31+cs.anno);
    let r; try{ r = generaMigliorTentativo(cs.anno, cs.mese, nd, medici, ex, ms); } finally { (Math as any).random = mr; }
    const o = completaObiettivi(cs.anno, cs.mese, nd, medici, r.turni);
    const caso = { anno:cs.anno, mese:cs.mese, medici, ex, regole: mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), maxConsec: mc }), prevT:null };
    const c = makeCtx(cs.anno, cs.mese, nd, medici, o.turni);
    const mls = medici.filter(m=>m.stato==="ML");
    const altri = medici.filter(m=>m.stato==="MR"||m.stato==="MDC");
    const maxAltri = Math.max(...altri.map(m=>corsaMassima(caso,o.turni,m.id)));
    const avvisiML = r.problemi.filter(p=>mls.some(m=>p.startsWith(m.nome.split(" ").pop()+":") && p.includes("consecutivi"))).length;
    const V = [...violazioniIndip(caso, r.turni), ...violazioniIndip(caso, o.turni)];
    for(const m of mls)
      console.log(`${(cs.nome+" "+m.nome.split(" ").pop()).padEnd(22)} ${String(mc).padStart(2)}   | ${String(c.cnt(m.id)).padStart(2)}/${m.obiettivo}     ${String(corsaMassima(caso,o.turni,m.id)).padStart(2)}      | ${maxAltri<=mc?"sì":"NO"} (max ${maxAltri})                 | ${avvisiML}         | ${V.length}${V.length?" "+V.slice(0,2).join(" | "):""}`);
  }
}
