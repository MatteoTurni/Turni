// Misure del TABELLONE FINALE, condivise da finale.ts e confronto.ts:
// errori, copertura, weekend (liberi/lavorati/carico), notti (totali e di
// weekend), continuità, equilibrio mattine/pomeriggi, obiettivi.
import type { Medico, TurniMese, Regole } from "../src/engine/types";
import { dimOf } from "../src/engine/date";
import { makeCtx } from "../src/engine/ctx";
import { misuraTabellone, continuitaScoperti } from "../src/engine/genera";
import { violazioniIndip } from "./validatori";
export interface CasoM { anno:number; mese:number; medici:Medico[]; ex:TurniMese; regole:Regole; prevT?:TurniMese|null }
const ASS = ["L","ANA","104","per11","X"];
const forb = (a:number[]) => a.length>1 ? Math.max(...a)-Math.min(...a) : 0;
export function misure(sc: CasoM, T: TurniMese): Record<string,number> {
  const nd = dimOf(sc.anno,sc.mese);
  const c = makeCtx(sc.anno,sc.mese,nd,sc.medici,T);
  const mis = misuraTabellone(sc.anno,sc.mese,nd,sc.medici,T);
  const o: Record<string,number> = {};
  o["violazioni"] = violazioniIndip({ anno:sc.anno, mese:sc.mese, medici:sc.medici, ex:sc.ex, regole:sc.regole, prevT:sc.prevT||null }, T).length;
  o["buchi"] = mis.buchi;
  o["avvisi"] = mis.probs.length;
  // MR presenti tutto il mese (i confronti di equità hanno senso solo fra loro)
  const pieni = c.mr.filter(m=>{ for(let g=1;g<=nd;g++) if(c.gt(m.id,g).some(s=>ASS.includes(s.tipo))) return false; return true; });
  // ── weekend
  o["wk liberi mancanti"] = mis.wkDef;
  o["carico wk fuori forchetta"] = mis.wkScarto;
  const wkLib = c.mrMdc.map(m=>c.cntWkLiberi(m.id));
  o["wk liberi: minimo"] = wkLib.length ? Math.min(...wkLib) : 0;
  o["wk liberi: forbice MR"] = forb(pieni.map(m=>c.cntWkLiberi(m.id)));
  o["wk lavorati: forbice MR"] = forb(pieni.map(m=>c.wkPairs.filter(([s,d])=>c.lavoraGiorno(m.id,s)||c.lavoraGiorno(m.id,d)||c.haN(m.id,s-1)).length));
  o["carico wk: forbice MR"] = forb(pieni.map(m=>c.cntWk(m.id)));
  // ── notti
  o["notti: forbice MR"] = forb(pieni.map(m=>c.cntN(m.id)));
  const nTutti = c.mr.map(m=>c.cntN(m.id));
  o["notti: forbice tutti MR"] = forb(nTutti);
  o["notti: mese con MR a 2+ da un altro"] = forb(nTutti)>=2 ? 1 : 0;
  o["notti wk/festive: forbice MR"] = forb(pieni.map(m=>{ let k=0; for(let g=1;g<=nd;g++) if(c.haN(m.id,g) && c.isNotteFest(g)) k++; return k; }));
  // ── continuità
  let coppie=0, mm=0, pm=0;
  for(const g of c.feriali){
    if(!c.feriali.includes(g+1)) continue; coppie++;
    if(c.att.some(m=>c.gt(m.id,g).some(s=>s.tipo==="M") && c.gt(m.id,g+1).some(s=>s.tipo==="M"))) mm++;
    if(c.att.some(m=>c.gt(m.id,g).some(s=>s.tipo==="P") && c.gt(m.id,g+1).some(s=>s.tipo==="M"))) pm++;
  }
  o["continuità M→M feriali %"] = 100*mm/Math.max(1,coppie);
  o["consegne P→M %"] = 100*pm/Math.max(1,coppie);
  const cs = continuitaScoperti(c); const tl = cs.piena+cs.minima+cs.nessuna;
  o["senza ML: piena %"] = tl ? 100*cs.piena/tl : NaN;
  o["senza ML: nessuna %"] = tl ? 100*cs.nessuna/tl : NaN;
  o["giorni isolati"] = mis.lavIso;
  // ── equilibrio mattine/pomeriggi e carichi
  const mp = c.mr.map(m=>{ let M=0,P=0; for(let g=1;g<=nd;g++){ const sh=c.gt(m.id,g); if(sh.some(s=>s.tipo==="M"||s.tipo==="A")) M++; if(sh.some(s=>s.tipo==="P"||s.tipo==="Ap")) P++; } return {M,P}; });
  const tM=mp.reduce((q,x)=>q+x.M,0), tT=mp.reduce((q,x)=>q+x.M+x.P,0), R=tT?tM/tT:0;
  o["scarto M/P"] = mp.reduce((q,x)=>q+Math.abs(x.M-R*(x.M+x.P)),0);
  const qm = pieni.map(m=>{ const x=mp[c.mr.indexOf(m)]; return x.M+x.P ? x.M/(x.M+x.P) : 0; });
  o["quota mattine: forbice %"] = 100*forb(qm);
  o["pomeriggi: forbice MR"] = forb(pieni.map(m=>mp[c.mr.indexOf(m)].P));
  o["totali: forbice MR"] = forb(pieni.map(m=>c.cnt(m.id)));
  // ── obiettivi
  o["punti sotto obiettivo MR"] = c.mr.reduce((q,m)=>q+Math.max(0,m.obiettivo-c.cnt(m.id)),0);
  o["punti oltre obiettivo"] = c.att.reduce((q,m)=>q+Math.max(0,c.cnt(m.id)-m.obiettivo),0);
  o["MDC sotto obiettivo"] = c.mdc.reduce((q,m)=>q+Math.max(0,m.obiettivo-c.cnt(m.id)),0);
  o["ML sotto obiettivo"] = c.ml.reduce((q,m)=>q+Math.max(0,m.obiettivo-c.cnt(m.id)),0);
  return o;
}
