// Esempio dell'utente: gennaio 2025, ML assente 8-9, 15-18, 20-21 (le domeniche
// non lavora). Mostra le MATTINE del tabellone generato e la continuità nei
// giorni senza ML. Uso: node catena.cjs <ms> [obj]
import { dimOf, dowOf } from "../src/engine/date";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { generaMigliorTentativo, completaObiettivi, continuitaScoperti } from "../src/engine/genera";
import { makeCtx } from "../src/engine/ctx";
import { squadraGennaio } from "./scenari";
function mulberry32(seed:number){ let a=seed>>>0; return ()=>{ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
const ms=+(process.argv[2]||2500), obj=process.argv[3]==="obj";
const anno=2025, mese=0, nd=dimOf(anno,mese), D="LMMGVSD";
const ex:any={}; for(const g of [8,9,15,16,17,18,20,21]) (ex[4] ||= {})[g]={t:[{tipo:"L",sott:false,man:true}]};
setRegole(mergeRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)))); ENG.PREV=null; setSalt(0); setAmbRotStart(0);
const medici=squadraGennaio();
const r0=Math.random; (Math as any).random=mulberry32(77);
let r; try{ r=generaMigliorTentativo(anno,mese,nd,medici,ex,ms); } finally { (Math as any).random=r0; }
const T = obj ? completaObiettivi(anno,mese,nd,medici,r.turni).turni : r.turni;
const c=makeCtx(anno,mese,nd,medici,T);
const G=Array.from({length:nd},(_,i)=>i+1);
console.log("".padEnd(11)+G.map(g=>String(g).padStart(3)).join(""));
console.log("".padEnd(11)+G.map(g=>"  "+D[dowOf(anno,mese,g)]).join(""));
for(const m of medici.filter(x=>x.stato!=="MPS")){
  console.log(m.nome.split(" ").pop()!.slice(0,10).padEnd(11)+G.map(g=>{ const sh=c.gt(m.id,g).map(s=>s.tipo); return sh.includes("M")?"  M":sh.includes("A")?"  A":sh.includes("L")?"  -":sh.includes("N")?"  n":sh.includes("P")?"  p":"  ."; }).join(""));
}
const cs=continuitaScoperti(c); const tl=cs.piena+cs.minima+cs.nessuna;
console.log(`giorni senza ML: piena ${cs.piena}/${tl}, solo P→M ${cs.minima}, nessuna ${cs.nessuna}  | problemi: ${r.problemi.length}`);
