// Mese segnalato dal reparto: ottobre 2026 con i soli inserimenti manuali
// (scenario_ottobre2026.json). Genera + "Completa obiettivi" e conta le notti
// per medico. Uso: node ottobre.cjs <ms> <semi>
import { dimOf } from "../src/engine/date";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { generaMigliorTentativo, completaObiettivi } from "../src/engine/genera";
import { makeCtx } from "../src/engine/ctx";
import { squadraGennaio } from "./scenari";
import * as fs from "node:fs";
function mulberry32(seed:number){ let a=seed>>>0; return ()=>{ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
const ms=+(process.argv[2]||2500), semi=+(process.argv[3]||4);
const snap=JSON.parse(fs.readFileSync("scenario_ottobre2026.json","utf8"));
const { anno, mese, ex } = snap; const nd=dimOf(anno,mese);
const medici = squadraGennaio().map(m=>m.id===3 ? { ...m, ambulatorio:true } : m);
let forb=0;
for(let s=0;s<semi;s++){
  setRegole(mergeRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)))); ENG.PREV=null; ENG.MPVAR=+(process.env.MPVAR||0); setSalt(0); setAmbRotStart(s%5);
  const r0=Math.random; (Math as any).random=mulberry32(500+s);
  let r; try{ r=generaMigliorTentativo(anno,mese,nd,medici,ex,ms); } finally { (Math as any).random=r0; }
  const T=completaObiettivi(anno,mese,nd,medici,r.turni).turni;
  const c=makeCtx(anno,mese,nd,medici,T);
  const man=(id:number)=>{ let k=0; for(let g=1;g<=nd;g++) if((ex[id]?.[g]?.t||[]).some((x:any)=>x.tipo==="N")) k++; return k; };
  const assenze=(id:number)=>{ let k=0; for(let g=1;g<=nd;g++) if((ex[id]?.[g]?.t||[]).some((x:any)=>["L","ANA","104","per11","X"].includes(x.tipo))) k++; return k; };
  const nMR=c.mr.map(m=>c.cntN(m.id));
  forb+=Math.max(...nMR)-Math.min(...nMR);
  console.log(`seme ${s}: `+c.mr.map(m=>`${m.nome.split(" ").pop()} ${c.cntN(m.id)}${man(m.id)?`(${man(m.id)} man)`:""}`).join("  ")+`  | MDC ${c.mdc.map(m=>c.cntN(m.id)).join(",")}  notti scoperte ${c.giorniArr.filter(g=>c.cf(g,"N")<1).length}`);
  if(s===0) console.log("   giorni di assenza/esclusione: "+c.mr.map(m=>`${m.nome.split(" ").pop()} ${assenze(m.id)}`).join("  "));
  if(process.env.MP){
    const f=(id:number,t:string[])=>{ let k=0; for(let g=1;g<=nd;g++) if(c.gt(id,g).some(x=>t.includes(x.tipo))) k++; return k; };
    console.log("   M/P/N/tot: "+c.mr.map(m=>`${m.nome.split(" ").pop()!.slice(0,5)} ${f(m.id,["M","A"])}/${f(m.id,["P","Ap"])}/${c.cntN(m.id)}=${c.cnt(m.id)}`).join("  "));
  }
}
console.log(`forbice media notti fra MR: ${(forb/semi).toFixed(2)}`);
