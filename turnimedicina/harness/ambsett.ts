// CONFRONTO su scenari CASUALI realistici: squadra, assenze dell'ML, ferie,
// esclusioni, manuali, regole, ambulatori. Generazione completa + "Completa
// obiettivi", misure del tabellone finale (misure.ts). Stessi semi per ogni
// variante: le varianti si confrontano configurazione per configurazione.
// AMBULATORI PER SETTIMANA DEL MESE (v0.3.43): stessi mesi casuali di
// confronto.ts, ma ogni giorno d'ambulatorio con prob. 0,7 vale solo in alcune
// settimane (1ª…5ª, ultima) con fasce proprie. Controlli: nessuna violazione
// (validatori indipendenti), ogni slot previsto coperto se ha abilitati.
// Uso: node ambsett.cjs <seme> <n> <ms> <out.json>
import type { Medico, TurniMese, Regole, Ambulatorio, FasciaAmb } from "../src/engine/types";
import { dimOf } from "../src/engine/date";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { generaMigliorTentativo, completaObiettivi } from "../src/engine/genera";
import { misure } from "./misure";
import { violazioniIndip } from "./validatori";
import { equilibra } from "../src/engine/equilibra";
import { makeCtx } from "../src/engine/ctx";
import { abilitatoAmb } from "../src/engine/turni";
import { getRegole } from "../src/engine/regole";
import * as fs from "node:fs";
function mulberry32(seed:number){ let a=seed>>>0; return ()=>{ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
const [,, semeS="1", nS="40", msS="2500", out="/tmp/confronto.json"] = process.argv;
const risultati: any[] = [];
for(let i=0;i<+nS;i++){
  const rnd = mulberry32(+semeS*100003 + i*7919);
  const int = (a:number,b:number) => a + Math.floor(rnd()*(b-a+1));
  const pick = <T,>(a:T[]) => a[Math.floor(rnd()*a.length)];
  const prob = (p:number) => rnd() < p;
  const anno = pick([2026,2027]), mese = int(0,11), nd = dimOf(anno,mese);
  let id=0; const medici: Medico[] = [];
  const nMR = int(5,8); for(let k=0;k<nMR;k++) medici.push({ id:++id, nome:`M. MR${id}`, codice:String(id), stato:"MR", obiettivo:int(20,27), ambulatorio:false });
  const nMDC = pick([0,1,1,1,2]); for(let k=0;k<nMDC;k++) medici.push({ id:++id, nome:`M. MDC${id}`, codice:String(id), stato:"MDC", obiettivo:int(16,21), ambulatorio:false });
  const nML = prob(0.85) ? 1 : 0; for(let k=0;k<nML;k++) medici.push({ id:++id, nome:`M. ML${id}`, codice:String(id), stato:"ML", obiettivo:int(22,27), ambulatorio:false });
  const nMPS = pick([0,1,2,2]); for(let k=0;k<nMPS;k++) medici.push({ id:++id, nome:`M. MPS${id}`, codice:String(id), stato:"MPS", obiettivo:0, ambulatorio:false });
  const ambulatori: Ambulatorio[] = [];
  const nAmb = pick([0,1,1,1,2]);
  for(let k=0;k<nAmb;k++){
    const giorni: Partial<Record<number,FasciaAmb>> = {}; const settimane: any = {};
    for(let j=0;j<int(1,2);j++){ const d=int(0,4);
      if(prob(0.7)){ const occ: any = {}; for(const o of ["1","2","3","4","5","U"]) if(prob(0.35)) occ[o]=pick<FasciaAmb>(["M","M","P","MP"]); if(!Object.keys(occ).length) occ[pick(["1","2","3","4","U"])]="M"; settimane[d]=occ; delete giorni[d]; }
      else if(!settimane[d]) giorni[d]=pick<FasciaAmb>(["M","M","P","MP"]);
    }
    ambulatori.push({ id:k===0?"A":`amb${k}`, nome:`Amb${k}`, sigla:`A${k}`, giorni, ...(Object.keys(settimane).length?{settimane}:{}) });
  }
  for(const m of medici.filter(x=>x.stato==="MR"||x.stato==="MDC")) if(ambulatori.length && prob(0.5)){ m.ambulatori = ambulatori.filter(()=>prob(0.7)).map(a=>a.id); m.ambulatorio = m.ambulatori.length>0; }
  const regole: Regole = mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)),
    maxConsec: pick([5,6,7,7]), notteLiberoNotte: prob(0.2), mattinaDopoNotte: prob(0.15), maxAssSett: pick([1,2,2,3]), ambulatori } as any);
  const ex: TurniMese = {};
  const put = (mid:number,g:number,tipo:string) => { if(g<1||g>nd) return; const c=((ex[mid] ||= {})[g] ||= { t:[] }); if(c.t.length) return; c.t.push({ tipo, sott:false, man:true }); };
  // assenze dell'ML (0-3 periodi)
  for(const m of medici.filter(x=>x.stato==="ML")) for(let k=0;k<int(0,3);k++){ const da=int(1,nd), len=int(1,7); for(let g=da; g<da+len; g++) put(m.id,g,pick(["L","L","ANA"])); }
  // ferie di MR/MDC
  for(const m of medici.filter(x=>x.stato==="MR"||x.stato==="MDC")) if(prob(0.3)){ const da=int(1,nd), len=int(4,14); for(let g=da; g<da+len; g++) put(m.id,g,"L"); }
  // mesi PESANTI (come l'ottobre segnalato): assenze ed esclusioni fitte
  if(process.env.PESANTE) for(const m of medici.filter(x=>x.stato==="MR"||x.stato==="MDC")){
    for(let k=0;k<int(1,3);k++){ const da=int(1,nd), len=int(1,4); for(let g=da; g<da+len; g++) put(m.id,g,pick(["L","ANA","ANA","104","X","per11"])); }
    if(prob(0.4)) put(m.id,int(1,nd),pick(["Xp","Xn"]));
  }
  // esclusioni sparse
  for(const m of medici.filter(x=>x.stato!=="MPS")) for(let k=0;k<int(0,2);k++) put(m.id,int(1,nd),pick(["X","Xn","Xm","Xp"]));
  // pochi manuali di lavoro
  for(let k=0;k<int(0,4);k++){ const m=pick(medici.filter(x=>x.stato==="MR")); put(m.id,int(1,nd),pick(["N","M","P"])); }
  const desc = `${anno}-${mese+1} MR${nMR} MDC${nMDC} ML${nML} MPS${nMPS} amb${nAmb}`;
  setRegole(regole); ENG.PREV=null; setSalt(0); setAmbRotStart(0);
  const r0 = Math.random; (Math as any).random = mulberry32(+semeS*977 + i);
  let r; try{ r = generaMigliorTentativo(anno,mese,nd,medici,ex,+msS); } finally { (Math as any).random = r0; }
  const T0 = completaObiettivi(anno,mese,nd,medici,r.turni).turni;
  const T = equilibra(anno,mese,nd,medici,T0,{ traGiorni:true }).turni;
  const V = violazioniIndip({ anno, mese, medici, ex, regole, prevT:null }, T);
  if(process.env.SOLO && +process.env.SOLO===i){
    for(const [k,X] of [["generazione",r.turni],["completa",T0],["equilibra",T]] as const)
      console.log(k, violazioniIndip({ anno, mese, medici, ex, regole, prevT:null }, X));
    console.log(JSON.stringify(getRegole().ambulatori));
  }
  // slot previsti ma scoperti pur avendo abilitati disponibili quel giorno
  const c = makeCtx(anno,mese,nd,medici,T);
  let slot=0, scop=0;
  let slotS=0, scopS=0, senzaCand=0;
  for(let g=1; g<=nd; g++) for(const sl of c.ambSlots(g)){
    const perSett = !!getRegole().ambulatori.find(a=>a.id===sl.amb)?.settimane?.[c.dw(g)];
    const vuoto = !medici.some(m=>c.haSlot(m.id,g,sl));
    // "senza candidati": nessun abilitato (non ML per Ap) libero da assenze quel giorno
    const cand = medici.filter(m=>m.stato!=="MPS" && abilitatoAmb(m, sl.amb) && !(sl.cod==="Ap" && m.stato==="ML")
      && !(ex[m.id]?.[g]?.t||[]).length);
    if(vuoto && cand.length===0) senzaCand++;
    if(perSett){ slotS++; if(vuoto) scopS++; } else { slot++; if(vuoto) scop++; }
  }
  const sett = getRegole().ambulatori.filter(a=>a.settimane).length;
  risultati.push({ i, desc, viol:V.length, slot, scop, slotS, scopS, senzaCand, sett, buchi:c.giorniArr.filter(g=>c.cf(g,"M")<c.needEff(g,"M")||c.cf(g,"P")<c.needEff(g,"P")).length });
  if(V.length) console.log(`!!! #${i} ${desc}: ${V.slice(0,3).join(" | ")}`);
  console.log(`#${i} ${desc} amb-per-settimana ${sett} slot ${slot} scoperti ${scop} viol ${V.length}`);
}
fs.writeFileSync(out, JSON.stringify(risultati));
console.log("scritto", out);
