// Equilibrio MATTINE / POMERIGGI fra gli MR (MDC e ML esclusi) sul tabellone
// finale (generazione + "Completa obiettivi"). Uso: node mp.cjs <sim.json> [det]
import { dimOf } from "../src/engine/date";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../src/engine/regole";
import { ENG } from "../src/engine/state";
import { makeCtx } from "../src/engine/ctx";
import { completaObiettivi, riequilibraMP, misuraTabellone } from "../src/engine/genera";
import { scenari } from "./scenari";
import * as fs from "node:fs";
const [,, file, det=""] = process.argv;
const APPLICA = !!process.env.MP;   // applica riequilibraMP dopo "Completa obiettivi"
let dSoft=0, dIso=0, nScambi=0, dS=0;
const runs: any[] = JSON.parse(fs.readFileSync(file,"utf8"));
const SC = new Map(scenari().map(s=>[s.nome,s]));
const ASS = ["L","ANA","104","per11","X"];
const agg: Record<string,{rM:number;rP:number;rMf:number;rPf:number;dev:number}[]> = {};
for(const r of runs){
  const sc = SC.get(r.scen)!;
  setRegole(mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), ...(sc.regole||{}) } as any));
  ENG.PREV = sc.prevT ? { ndim: sc.mese===0?dimOf(sc.anno-1,11):dimOf(sc.anno,sc.mese-1), T: sc.prevT } : null;
  const nd = dimOf(sc.anno,sc.mese);
  const T = process.env.GEN ? r.turni : completaObiettivi(sc.anno,sc.mese,nd,sc.medici,r.turni).turni;   // GEN=1: tabellone generato
  const c = makeCtx(sc.anno,sc.mese,nd,sc.medici,T);
  if(APPLICA){
    const m0 = misuraTabellone(sc.anno,sc.mese,nd,sc.medici,c.T);
    nScambi += riequilibraMP(sc.anno,sc.mese,nd,sc.medici,c);
    const m1 = misuraTabellone(sc.anno,sc.mese,nd,sc.medici,c.T);
    dSoft += m1.soft-m0.soft; dIso += m1.lavIso-m0.lavIso; dS += m1.s-m0.s;
  }
  const rows = c.mr.map(m=>{
    let M=0,P=0,Mf=0,Pf=0,disp=0;
    for(let g=1;g<=nd;g++){
      const sh=c.gt(m.id,g); if(!sh.some(s=>ASS.includes(s.tipo))) disp++;
      if(sh.some(s=>s.tipo==="M")){ M++; if(c.isFer(g)) Mf++; }
      if(sh.some(s=>s.tipo==="P")){ P++; if(c.isFer(g)) Pf++; }
    }
    return { nome:m.nome, M, P, Mf, Pf, disp };
  });
  const pieni = rows.filter(x=>x.disp===nd);
  const rng = (f:(x:any)=>number) => pieni.length>1 ? Math.max(...pieni.map(f))-Math.min(...pieni.map(f)) : 0;
  const totM = rows.reduce((q,x)=>q+x.M,0), totP = rows.reduce((q,x)=>q+x.P,0), totD = rows.reduce((q,x)=>q+x.disp,0);
  const dev = rows.reduce((q,x)=>q+Math.abs(x.M-totM*x.disp/totD)+Math.abs(x.P-totP*x.disp/totD),0);
  (agg[r.scen] ||= []).push({ rM:rng(x=>x.M), rP:rng(x=>x.P), rMf:rng(x=>x.Mf), rPf:rng(x=>x.Pf), dev });
  if(det) console.log(r.scen,"#"+r.rep, rows.map(x=>`${x.nome}:${x.M}M/${x.P}P${x.disp<nd?`(${x.disp}d)`:""}`).join(" "));
}
console.log("scenario        range M  range P  (feriali: M  P)  scarto da quota");
const T={a:0,b:0,c:0,d:0,e:0};
for(const [s,a] of Object.entries(agg)){
  const m=(f:(x:any)=>number)=>a.reduce((q,x)=>q+f(x),0)/a.length;
  T.a+=m(x=>x.rM);T.b+=m(x=>x.rP);T.c+=m(x=>x.rMf);T.d+=m(x=>x.rPf);T.e+=m(x=>x.dev);
  console.log(`${s.padEnd(15)} ${m(x=>x.rM).toFixed(1).padStart(7)} ${m(x=>x.rP).toFixed(1).padStart(8)}    ${m(x=>x.rMf).toFixed(1).padStart(5)} ${m(x=>x.rPf).toFixed(1).padStart(3)}  ${m(x=>x.dev).toFixed(1).padStart(12)}`);
}
if(APPLICA) console.log(`scambi ${nScambi}, delta s ${dS}, delta soft ${dSoft.toFixed(0)}, delta giorni isolati ${dIso}`);
console.log(`TOTALE          ${T.a.toFixed(1).padStart(7)} ${T.b.toFixed(1).padStart(8)}    ${T.c.toFixed(1).padStart(5)} ${T.d.toFixed(1).padStart(3)}  ${T.e.toFixed(1).padStart(12)}`);
