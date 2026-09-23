// Equità AMBULATORI su più mesi consecutivi, con il cursore di rotazione
// riportato da un mese al successivo esattamente come fa la UI.
import type { Medico } from "../src/engine/types";
import { dimOf, dowOf, isFestivo } from "../src/engine/date";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { generaMigliorTentativo, calcAmbRotNext } from "../src/engine/genera";
import * as fs from "node:fs";
function mulberry32(seed:number){let a=seed>>>0;return()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const medici:Medico[] = JSON.parse(fs.readFileSync("scen_amb.json","utf8")).medici;
const ab=medici.filter(m=>m.ambulatorio); const nome=(m:Medico)=>m.nome.split(" ").pop()!;
const GA = (process.argv[3]||"1").split(",").map(Number);
const REG={...JSON.parse(JSON.stringify(REGOLE_DEFAULT)),maxConsec:5,giorniAmb:GA};
const MESI=+(process.argv[2]||"12");
const tot:Record<string,number>={}; for(const m of ab) tot[nome(m)]=0;
let rot=0, anno=2026, mese=8;
for(let k=0;k<MESI;k++){
  const ndim=dimOf(anno,mese);
  setRegole(mergeRegole(REG as any)); ENG.PREV=null; setSalt(0); setAmbRotStart(rot);
  const rng=mulberry32(0xC0FFEE^Math.imul(k+1,2654435761));
  const mr=Math.random;(Math as any).random=rng;
  let r:any; try{ r=generaMigliorTentativo(anno,mese,ndim,medici,{},6000);} finally{(Math as any).random=mr;}
  const per:Record<string,number>={}; for(const m of ab) per[nome(m)]=0;
  let nA=0;
  for(let g=1;g<=ndim;g++){
    if(!GA.includes(dowOf(anno,mese,g))||isFestivo(anno,mese,g)) continue;
    const q=ab.find(m=>(r.turni[m.id]?.[g]?.t||[]).some((s:any)=>s.tipo==="A"));
    if(q){ per[nome(q)]++; tot[nome(q)]++; nA++; }
  }
  console.log(`${anno}-${String(mese+1).padStart(2,"0")} rot=${rot} A=${nA} | ${ab.map(x=>`${nome(x)}:${per[nome(x)]}`).join(" ")}`);
  rot = calcAmbRotNext(r.turni, medici, anno, mese, ndim, rot);
  mese++; if(mese>11){ mese=0; anno++; }
}
const v=ab.map(x=>tot[nome(x)]);
console.log(`TOTALE ${MESI} mesi:`, ab.map(x=>`${nome(x)}:${tot[nome(x)]}`).join(" "),
            `| max-min = ${Math.max(...v)-Math.min(...v)}`);
