// Analisi di EQUITÀ NOTTI (solo MR: MDC e ML esclusi per le loro limitazioni)
// e d'uso del MDC (mattine/pomeriggi, occasioni di pomeriggio non sfruttate)
// sui tabelloni prodotti da sim.ts.
// Uso: node equita.cjs <sim_out.json> [dettaglio]
import type { TurniMese } from "../src/engine/types";
import { dimOf } from "../src/engine/date";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../src/engine/regole";
import { ENG } from "../src/engine/state";
import { makeCtx } from "../src/engine/ctx";
import { isNot } from "../src/engine/turni";
import { completaObiettivi } from "../src/engine/genera";
import { scenari } from "./scenari";
import * as fs from "node:fs";

const [,, file="/tmp/sim_out.json", modo="", det=""] = process.argv;   // modo "obj": dopo "Completa obiettivi"
const runs: any[] = JSON.parse(fs.readFileSync(file,"utf8"));
const SC = new Map(scenari().map(s=>[s.nome,s]));
// Codici che rendono un giorno NON disponibile per la notte (assenze/esclusioni).
const ASS = ["L","ANA","104","per11","X","Xn","MAL","CONG"];

const agg: Record<string, any[]> = {};
for(const r of runs){
  const sc = SC.get(r.scen)!; if(!sc) continue;
  setRegole(mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), ...(sc.regole||{}) } as any));
  ENG.PREV = sc.prevT ? { ndim: sc.mese===0?dimOf(sc.anno-1,11):dimOf(sc.anno,sc.mese-1), T: sc.prevT } : null;
  const nd = dimOf(sc.anno, sc.mese);
  const T: TurniMese = modo==="obj" ? completaObiettivi(sc.anno, sc.mese, nd, sc.medici, r.turni).turni : r.turni;
  const c = makeCtx(sc.anno, sc.mese, nd, sc.medici, T);
  // ── NOTTI fra MR
  const mr = c.mr;
  const disp = mr.map(m=>{ let d=0; for(let g=1;g<=nd;g++) if(!(sc.ex[m.id]?.[g]?.t||[]).some(s=>ASS.includes(s.tipo))) d++; return d; });
  const n  = mr.map(m=>c.cntN(m.id));
  const nf = mr.map(m=>{ let k=0; for(let g=1;g<=nd;g++) if(c.gt(m.id,g).some(s=>isNot(s.tipo)) && c.isNotteFest(g)) k++; return k; });
  const tot = n.reduce((a,b)=>a+b,0), dTot = disp.reduce((a,b)=>a+b,0);
  // quota proporzionale ai giorni disponibili, cappata a maxNotti
  const quota = disp.map(d=>tot*d/dTot);
  const dev = n.reduce((q,v,i)=>q+Math.abs(v-quota[i]),0);
  const pieni = mr.map((m,i)=>i).filter(i=>disp[i]===nd);
  const rng = pieni.length ? Math.max(...pieni.map(i=>n[i]))-Math.min(...pieni.map(i=>n[i])) : 0;
  const rngF = pieni.length ? Math.max(...pieni.map(i=>nf[i]))-Math.min(...pieni.map(i=>nf[i])) : 0;
  const nMdc = c.mdc.reduce((q,m)=>q+c.cntN(m.id),0);
  // ── MDC
  const mdcRows = c.mdc.map(m=>{
    let M=0,P=0,A=0,occP=0,occM=0,soloAmb=0;
    for(let g=1;g<=nd;g++){
      const sh = c.gt(m.id,g);
      if(sh.some(s=>s.tipo==="M")) M++;
      if(sh.some(s=>s.tipo==="P")) P++;
      if(sh.some(s=>s.tipo==="A"||s.tipo==="Ap")) A++;
      // MDC in reparto (M/P) il cui unico "compagno" di fascia è in ambulatorio
      for(const [f,rep,amb] of [["M",["M","1"],"A"],["P",["P","2"],"Ap"]] as const){
        if(!sh.some(s=>s.tipo===f)) continue;
        const altri = sc.medici.filter(a=>a.id!==m.id).flatMap(a=>c.gt(a.id,g).map(s=>s.tipo));
        if(!altri.some(t=>(rep as readonly string[]).includes(t)) && altri.includes(amb)) soloAmb++;
      }
      if(sh.length===0 || sh.every(s=>c.SPEC.includes(s.tipo) && !ASS.includes(s.tipo) && !s.tipo.startsWith("X"))){
        if(c.cf(g,"P")>=1 && c.cf(g,"P")<c.npn(g).mx && c.canR(m,g,"P") && c.mdcOk(m,g,"P")) occP++;
        if(c.cf(g,"M")>=1 && c.cf(g,"M")<c.nmn(g).mx && c.canR(m,g,"M") && c.mdcOk(m,g,"M")) occM++;
      }
    }
    return { nome:m.nome, cnt:c.cnt(m.id), obj:m.obiettivo, M, P, A, occP, occM, soloAmb };
  });
  const mrSotto = c.mr.reduce((q,m)=>q+Math.max(0,m.obiettivo-c.cnt(m.id)),0);
  const mrSottoMax = Math.max(0,...c.mr.map(m=>m.obiettivo-c.cnt(m.id)));
  (agg[r.scen] ||= []).push({ n, disp, rng, rngF, dev, nMdc, mdcRows, mrSotto, mrSottoMax, nomi: mr.map(m=>m.nome) });
  if(det) console.log(r.scen, "#"+r.rep, "notti MR", mr.map((m,i)=>`${m.nome}:${n[i]}(${nf[i]}f)/${disp[i]}d`).join(" "), "| MDC", JSON.stringify(mdcRows));
}
console.log("scenario        | notti MR: range pieni  range fest  scarto da quota | MDC: turni/obj  M  P  A  N | occasioni P non usate (con MDC sotto obiettivo)");
let T1=0,T2=0,T3=0,Tsotto=0,Tocc=0;
for(const [s,a] of Object.entries(agg)){
  const mean = (f:(x:any)=>number) => a.reduce((q,x)=>q+f(x),0)/a.length;
  const r1=mean(x=>x.rng), r2=mean(x=>x.rngF), r3=mean(x=>x.dev); T1+=r1;T2+=r2;T3+=r3;
  const md = a.flatMap(x=>x.mdcRows);
  const mm = (f:(x:any)=>number) => md.length? (md.reduce((q,x)=>q+f(x),0)/md.length).toFixed(1) : "-";
  const sotto = md.filter(x=>x.cnt<x.obj);
  const occ = sotto.reduce((q,x)=>q+x.occP,0)/Math.max(1,a.length);
  Tsotto+=sotto.length; Tocc+=sotto.reduce((q,x)=>q+x.occP,0);
  console.log(`${s.padEnd(15)} | ${r1.toFixed(1).padStart(8)} ${r2.toFixed(1).padStart(11)} ${r3.toFixed(1).padStart(15)}  | ${mm(x=>x.cnt)}/${mm(x=>x.obj)}  ${mm(x=>x.M)} ${mm(x=>x.P)} ${mm(x=>x.A)} ${mean(x=>x.nMdc).toFixed(1)} | ${sotto.length}/${md.length} sotto obj, occ.P ${occ.toFixed(1)} | MR sotto obj: tot ${mean(x=>x.mrSotto).toFixed(1)} max ${mean(x=>x.mrSottoMax).toFixed(1)}`);
}
console.log("MDC in reparto con solo un collega in ambulatorio:", Object.values(agg).flat().flatMap((x:any)=>x.mdcRows).reduce((q:number,x:any)=>q+x.soloAmb,0));
console.log(`TOTALE range ${T1.toFixed(1)} rangeFest ${T2.toFixed(1)} scarto ${T3.toFixed(1)} | MDC sotto obiettivo ${Tsotto}, occasioni P ${Tocc}`);
