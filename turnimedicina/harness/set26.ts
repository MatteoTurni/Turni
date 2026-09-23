// ─── HARNESS SETTEMBRE 2026 (scenario reale) ─────────────────────────────────
// Replica FEDELE di generaParallelo su un solo thread: NW ricerche indipendenti
// con saltSeed distinti, poi rifinitura del primario + rifinisciCandidati sui
// best degli altri worker. Stampa "primario" (com'era prima della v0.3.32) e
// "finale" (dopo), nella STESSA esecuzione: è l'unico confronto privo del
// rumore introdotto dalle fasi a budget di tempo.
//   npx vite-node harness/set26.ts <daRep> <nRep> <fileOut>
import type { Medico, TurniMese } from "../src/engine/types";
import { dimOf } from "../src/engine/date";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { cercaMigliorTentativo, rifinituraFinale, misuraTabellone, cmpMis, rifinisciCandidati } from "../src/engine/genera";
import * as fs from "node:fs";
function mulberry32(seed:number){let a=seed>>>0;return()=>{a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const snap=JSON.parse(fs.readFileSync("scenario_settembre2026.json","utf8"));
const {anno,mese}=snap; const medici:Medico[]=snap.medici; const ex=snap.ex; const ndim=dimOf(anno,mese);
const REG={...JSON.parse(JSON.stringify(REGOLE_DEFAULT)),maxConsec:5};   // regola non-default dell'utente
const FROM=+(process.argv[2]||"0"), REPS=+(process.argv[3]||"8"), OUT=process.argv[4]||"/tmp/set26.json";
const NW=4, MAXMS=12000, MSRIC=Math.max(3000,MAXMS-2500);
const rows:any[]=fs.existsSync(OUT)?JSON.parse(fs.readFileSync(OUT,"utf8")):[];
for(let rep=FROM;rep<FROM+REPS;rep++){
  setRegole(mergeRegole(REG as any)); ENG.PREV=null; setSalt(0); setAmbRotStart(rep%4);
  const rng=mulberry32(0xC0FFEE^Math.imul(rep+1,2654435761));
  const mrand=Math.random; (Math as any).random=rng;
  let res:any, mPrim:any, msRif=0;
  try{
    const perW:{turni:TurniMese;m:any}[]=[];
    for(let w=0;w<NW;w++){
      const r=cercaMigliorTentativo(anno,mese,ndim,medici,ex,MSRIC,
        {saltSeed:(Math.imul(0x9E3779B9,w+1)>>>0)^((rng()*0x100000000)>>>0)});
      perW.push({turni:r.turni,m:misuraTabellone(anno,mese,ndim,medici,r.turni)});
    }
    const ord=[...perW].sort((a,b)=>cmpMis(a.m,b.m));
    const tR=Date.now();
    res=rifinituraFinale(anno,mese,ndim,medici,ex,ord[0].turni,2000);
    mPrim=misuraTabellone(anno,mese,ndim,medici,res.turni);
    res=rifinisciCandidati(anno,mese,ndim,medici,ex,ord[0].turni,ord.slice(1),res,Date.now()+1800);
    msRif=Date.now()-tR;
  } finally { (Math as any).random=mrand; }
  const m=misuraTabellone(anno,mese,ndim,medici,res.turni);
  rows.push({rep, primario:[mPrim.s,mPrim.wkScarto,Math.round(mPrim.soft)],
                  finale:[m.s,m.wkScarto,Math.round(m.soft)], msRif});
  console.log(`#${rep} primario=[wkSc ${mPrim.wkScarto}, soft ${Math.round(mPrim.soft)}] `
            + `finale=[wkSc ${m.wkScarto}, soft ${Math.round(m.soft)}] rif=${msRif}ms`);
}
const n=rows.length, sum=(k:string,i:number)=>rows.reduce((q,r)=>q+r[k][i],0);
console.log(`\n${n} run — wkScarto medio ${(sum("primario",1)/n).toFixed(2)} → ${(sum("finale",1)/n).toFixed(2)}`
          + ` | soft medio ${(sum("primario",2)/n).toFixed(1)} → ${(sum("finale",2)/n).toFixed(1)}`
          + ` | migliorati ${rows.filter(r=>r.finale[1]<r.primario[1]||(r.finale[1]===r.primario[1]&&r.finale[2]<r.primario[2])).length}`);
fs.writeFileSync(OUT,JSON.stringify(rows,null,1));
