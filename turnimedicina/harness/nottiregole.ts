// riequilibraNotti sotto TUTTE le combinazioni delle regole della notte.
// Per ogni combinazione e scenario: tabellone di copertura minima, poi
// riequilibraNotti diretto. Controlli: nessuna violazione nuova (validatori
// indipendenti), copertura di ogni cella invariata, manuali intatti.
// Uso: node nottiregole.cjs
import type { TurniMese } from "../src/engine/types";
import { dimOf } from "../src/engine/date";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../src/engine/regole";
import { ENG } from "../src/engine/state";
import { makeCtx } from "../src/engine/ctx";
import { generaCoperturaMinima, riequilibraNotti, scartoNotti } from "../src/engine/genera";
import { cloneT } from "../src/engine/turni";
import { violazioniIndip } from "./validatori";
import { scenari } from "./scenari";

const SCEN = ["giu26-vuoto","mar26-ferie","lug26-prevN","ott26-manuali","ago26-reale"];
const lista = scenari().filter(s=>SCEN.includes(s.nome));
let prove=0, mosse=0, conMosse=0, nuoveViol=0, copCambiata=0, manPersi=0, scPrima=0, scDopo=0;
const firma = (T:TurniMese, nd:number, c:ReturnType<typeof makeCtx>) => {
  const a:number[]=[]; for(let g=1;g<=nd;g++) for(const f of ["M","P","N"]) a.push(c.cf(g,f)); return a.join(",");
};
for(const maxNotti of [3,4,5,6]) for(const maxNottiConsec of [1,2,3])
for(const [nLn,rE,mDN] of [[0,0,0],[1,0,0],[0,1,0],[0,0,1],[1,0,1]]){
  for(const sc of lista){
    const regole = mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), ...(sc.regole||{}),
      maxNotti, maxNottiConsec, notteLiberoNotte:!!nLn, riposoEsteso:!!rE, mattinaDopoNotte:!!mDN } as any);
    setRegole(regole);
    ENG.PREV = sc.prevT ? { ndim: sc.mese===0?dimOf(sc.anno-1,11):dimOf(sc.anno,sc.mese-1), T: sc.prevT } : null;
    ENG.BT=6; ENG.TRIES=3; ENG.CLUSTER_NODES=8000; ENG.REBAL_NODES=15000;
    const nd = dimOf(sc.anno, sc.mese);
    for(let i=0;i<2;i++){
      ENG.SALT=(Math.imul(i+1+maxNotti*7+maxNottiConsec*31,2654435761)>>>0);
      let r; try{ r=generaCoperturaMinima(sc.anno,sc.mese,nd,sc.medici,sc.ex); }catch(e){ continue; }
      const caso = { anno:sc.anno, mese:sc.mese, medici:sc.medici, ex:sc.ex, regole, prevT:sc.prevT||null };
      const T0 = cloneT(r.turni);
      const V0 = new Set(violazioniIndip(caso, T0));
      const T = cloneT(r.turni);
      const c = makeCtx(sc.anno,sc.mese,nd,sc.medici,T);
      const f0 = firma(T,nd,c), s0 = scartoNotti(c);
      const n0 = c.mr.map(m=>c.cntN(m.id));
      riequilibraNotti(sc.anno,sc.mese,nd,sc.medici,c);
      prove++;
      const n1 = c.mr.map(m=>c.cntN(m.id));
      const mv = n0.reduce((q,v,k)=>q+Math.abs(v-n1[k]),0)/2;
      mosse+=mv; if(mv>0) conMosse++;
      scPrima+=s0; scDopo+=scartoNotti(c);
      const V1 = violazioniIndip(caso, c.T).filter(v=>!V0.has(v));
      if(V1.length){ nuoveViol++; console.log(`!!! ${sc.nome} maxN=${maxNotti} consec=${maxNottiConsec} nLn=${nLn} rE=${rE} mDN=${mDN}: ${V1.slice(0,3).join(" | ")}`); }
      if(firma(c.T,nd,c)!==f0){ copCambiata++; console.log(`!!! copertura cambiata ${sc.nome}`); }
      for(const id in sc.ex) for(const g in sc.ex[id]) for(const s of sc.ex[id][g].t)
        if(!(c.T[id as any]?.[g as any]?.t||[]).some(x=>x.tipo===s.tipo&&x.man)){ manPersi++; console.log(`!!! manuale perso ${sc.nome} ${id}/${g}`); }
    }
  }
}
console.log(`prove ${prove}, con spostamenti ${conMosse}, notti spostate ${mosse}`);
console.log(`scarto notti medio: ${(scPrima/prove).toFixed(3)} → ${(scDopo/prove).toFixed(3)}`);
console.log(`nuove violazioni ${nuoveViol}, copertura cambiata ${copCambiata}, manuali persi ${manPersi}`);
