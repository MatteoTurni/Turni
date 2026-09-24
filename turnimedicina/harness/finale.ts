// VERIFICA DEL TABELLONE FINALE (generazione + "Completa obiettivi") su sim.ts:
// errori, copertura, weekend, continuità, equilibrio M/P e notti, obiettivi.
// Uso: node finale.cjs <sim.json> [etichetta]
import { dimOf, dowOf } from "../src/engine/date";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../src/engine/regole";
import { ENG } from "../src/engine/state";
import { makeCtx } from "../src/engine/ctx";
import { completaObiettivi, misuraTabellone } from "../src/engine/genera";
import { violazioniIndip } from "./validatori";
import { scenari } from "./scenari";
import * as fs from "node:fs";
const [,, file, etich=""] = process.argv;
const runs: any[] = JSON.parse(fs.readFileSync(file,"utf8"));
const SC = new Map(scenari().map(s=>[s.nome,s]));
const ASS = ["L","ANA","104","per11","X"];
const A: Record<string,number[]> = {};
const add = (k:string,v:number) => (A[k] ||= []).push(v);
for(const r of runs){
  const sc = SC.get(r.scen)!;
  const regole = mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), ...(sc.regole||{}) } as any);
  setRegole(regole);
  ENG.PREV = sc.prevT ? { ndim: sc.mese===0?dimOf(sc.anno-1,11):dimOf(sc.anno,sc.mese-1), T: sc.prevT } : null;
  const nd = dimOf(sc.anno,sc.mese);
  const T = completaObiettivi(sc.anno,sc.mese,nd,sc.medici,r.turni).turni;
  const c = makeCtx(sc.anno,sc.mese,nd,sc.medici,T);
  const mis = misuraTabellone(sc.anno,sc.mese,nd,sc.medici,T);
  // ── errori e copertura
  add("violazioni", violazioniIndip({ anno:sc.anno, mese:sc.mese, medici:sc.medici, ex:sc.ex, regole, prevT:sc.prevT||null }, T).length);
  add("buchi", mis.buchi);
  add("avvisi", mis.probs.length);
  // ── weekend
  add("wk liberi mancanti", mis.wkDef);
  add("carico wk fuori forchetta", mis.wkScarto);
  const pieni = c.mr.filter(m=>{ for(let g=1;g<=nd;g++) if(c.gt(m.id,g).some(s=>ASS.includes(s.tipo))) return false; return true; });
  const wkLav = pieni.map(m=>c.wkPairs.filter(([s,d])=>c.lavoraGiorno(m.id,s)||c.lavoraGiorno(m.id,d)||c.haN(m.id,s-1)).length);
  add("wk lavorati: forbice MR", wkLav.length>1 ? Math.max(...wkLav)-Math.min(...wkLav) : 0);
  const wkLib = c.mrMdc.map(m=>c.cntWkLiberi(m.id));
  add("wk liberi: minimo", wkLib.length ? Math.min(...wkLib) : 0);
  // ── continuità
  let coppie=0, mm=0, pm=0;
  for(const g of c.feriali){
    if(!c.feriali.includes(g+1)) continue; coppie++;
    if(c.att.some(m=>c.gt(m.id,g).some(s=>s.tipo==="M") && c.gt(m.id,g+1).some(s=>s.tipo==="M"))) mm++;
    if(c.att.some(m=>c.gt(m.id,g).some(s=>s.tipo==="P") && c.gt(m.id,g+1).some(s=>s.tipo==="M"))) pm++;
  }
  add("continuità M→M %", 100*mm/Math.max(1,coppie));
  add("consegne P→M %", 100*pm/Math.max(1,coppie));
  let giorniM=0, blocchi=0;
  for(const m of c.att){ let run=false; for(const g of c.feriali){ const h=c.gt(m.id,g).some(s=>s.tipo==="M"); if(h){ giorniM++; if(!run) blocchi++; } run=h && c.feriali.includes(g+1); } }
  add("blocco mattine medio", giorniM/Math.max(1,blocchi));
  add("giorni isolati", mis.lavIso);
  add("P→M (conteggio)", mis.quickPM);
  // ── equilibrio
  const mp = c.mr.map(m=>{ let M=0,P=0; for(let g=1;g<=nd;g++){ const sh=c.gt(m.id,g); if(sh.some(s=>s.tipo==="M"||s.tipo==="A")) M++; if(sh.some(s=>s.tipo==="P"||s.tipo==="Ap")) P++; } return {M,P}; });
  const tM=mp.reduce((q,x)=>q+x.M,0), tT=mp.reduce((q,x)=>q+x.M+x.P,0), R=tT?tM/tT:0;
  add("scarto M/P", mp.reduce((q,x)=>q+Math.abs(x.M-R*(x.M+x.P)),0));
  const quotaM = pieni.map(m=>{ const i=c.mr.indexOf(m); const x=mp[i]; return x.M+x.P ? x.M/(x.M+x.P) : 0; });
  add("quota mattine: forbice %", quotaM.length>1 ? 100*(Math.max(...quotaM)-Math.min(...quotaM)) : 0);
  const nN = pieni.map(m=>c.cntN(m.id));
  add("notti: forbice MR", nN.length>1 ? Math.max(...nN)-Math.min(...nN) : 0);
  // ── obiettivi
  add("punti sotto obiettivo (MR)", c.mr.reduce((q,m)=>q+Math.max(0,m.obiettivo-c.cnt(m.id)),0));
  add("punti oltre obiettivo", c.att.reduce((q,m)=>q+Math.max(0,c.cnt(m.id)-m.obiettivo),0));
  const tMR = c.mr.map(m=>c.cnt(m.id)); add("totali MR: forbice", pieni.length>1 ? Math.max(...pieni.map(m=>c.cnt(m.id)))-Math.min(...pieni.map(m=>c.cnt(m.id))) : 0);
  const pP = pieni.map(m=>{ let k=0; for(let g=1;g<=nd;g++) if(c.gt(m.id,g).some(s=>s.tipo==="P"||s.tipo==="Ap")) k++; return k; }); add("pomeriggi MR: forbice", pP.length>1 ? Math.max(...pP)-Math.min(...pP) : 0);
  add("ML sotto obiettivo", c.ml.reduce((q,m)=>q+Math.max(0,m.obiettivo-c.cnt(m.id)),0));
}
if(process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify({ scen: runs.map(r=>r.scen), ...A }));
const media = (a:number[]) => a.reduce((x,y)=>x+y,0)/a.length;
const out: Record<string,number> = {};
for(const k in A) out[k] = +media(A[k]).toFixed(2);
console.log(JSON.stringify({ etichetta: etich || file, n: runs.length, ...out }));
