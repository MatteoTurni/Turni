// CONTINUITÀ DEL REPARTO su tabelloni di sim.ts: passaggi di consegne fra
// giorni feriali consecutivi (qualcuno della mattina di g è di mattina anche a
// g+1; oppure chi lavora g, di mattina o di pomeriggio, fa la mattina di g+1), strisce di mattine, lunghezza media dei blocchi,
// giorni isolati, rientri rapidi P→M. Uso: node continuita.cjs <sim.json> [obj]
import { dimOf } from "../src/engine/date";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../src/engine/regole";
import { ENG } from "../src/engine/state";
import { makeCtx } from "../src/engine/ctx";
import { completaObiettivi, misuraTabellone } from "../src/engine/genera";
import { scenari } from "./scenari";
import * as fs from "node:fs";
const [,, file, modo=""] = process.argv;
const runs: any[] = JSON.parse(fs.readFileSync(file,"utf8"));
const SC = new Map(scenari().map(s=>[s.nome,s]));
let coppie=0, passM=0, passP=0, strisce=0, giorniM=0, iso=0, qpm=0, n=0;
for(const r of runs){
  const sc = SC.get(r.scen)!;
  setRegole(mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), ...(sc.regole||{}) } as any));
  ENG.PREV = sc.prevT ? { ndim: sc.mese===0?dimOf(sc.anno-1,11):dimOf(sc.anno,sc.mese-1), T: sc.prevT } : null;
  const nd = dimOf(sc.anno,sc.mese);
  const T = modo==="obj" ? completaObiettivi(sc.anno,sc.mese,nd,sc.medici,r.turni).turni : r.turni;
  const c = makeCtx(sc.anno,sc.mese,nd,sc.medici,T);
  const chi = (g:number,t:string) => new Set(c.att.filter(m=>c.gt(m.id,g).some(s=>s.tipo===t)).map(m=>m.id));
  for(const g of c.feriali){
    if(!c.feriali.includes(g+1)) continue;
    coppie++;
    const m0=chi(g,"M"), m1=chi(g+1,"M"), p0=chi(g,"P"), p1=chi(g+1,"P");
    if([...m0].some(id=>m1.has(id))) passM++;
    // continuità allargata: chi lavora g (M o P) fa la mattina di g+1
    if(c.att.some(m=>c.gt(m.id,g).some(s=>s.tipo==="M"||s.tipo==="P") && m1.has(m.id))) passP++;
  }
  for(const m of c.att){
    let run=false;
    for(const g of c.feriali){ const h=c.gt(m.id,g).some(s=>s.tipo==="M"); if(h){ giorniM++; if(!run) strisce++; } run=h && c.feriali.includes(g+1); }
  }
  const mis = misuraTabellone(sc.anno,sc.mese,nd,sc.medici,T);
  iso+=mis.lavIso; qpm+=mis.quickPM; n++;
}
console.log(`${file.split("/").pop()} ${modo||"gen"}: continuità M→M ${(100*passM/coppie).toFixed(1)}%  (M o P)→M ${(100*passP/coppie).toFixed(1)}%  | blocchi di mattine: lunghezza media ${(giorniM/strisce).toFixed(2)} | giorni isolati ${(iso/n).toFixed(2)}/mese  rientri P→M ${(qpm/n).toFixed(2)}/mese`);
