// ═══════════════════════════════════════════════════════════════════════════
// FUZZ (v0.3.37): configurazioni CASUALI dell'intero pannello Regole, della
// squadra e dei turni manuali; generazione COMPLETA (ricerca + rifinitura con
// tappabuchi e riparazione con ambulatorio mobile) e poi "Completa obiettivi".
// Ogni tabellone passa dai validatori indipendenti di harness/validatori.ts.
// Uso: node fuzz.cjs <seme> <n_config> <ms>
// ═══════════════════════════════════════════════════════════════════════════
import type { Medico, TurniMese, Regole, Ambulatorio, FasciaAmb } from "../src/engine/types";
import { dimOf, dowOf } from "../src/engine/date";
import { setRegole, mergeRegole, REGOLE_DEFAULT } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { generaMigliorTentativo, completaObiettivi } from "../src/engine/genera";
import { diagnosiStatica } from "../src/engine/diagnosi";
import { violazioniIndip, corsaMassima, type CasoVal } from "./validatori";

function mulberry32(seed:number){ let a=seed>>>0; return ()=>{ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }

const [,, semeS="1", nS="30", msS="1500", dumpS=""] = process.argv;
import * as fs from "node:fs";
const rnd = mulberry32(+semeS * 7919 + 17);
const int = (a:number,b:number) => a + Math.floor(rnd()*(b-a+1));
const pick = <T,>(a:T[]) => a[Math.floor(rnd()*a.length)];
const prob = (p:number) => rnd() < p;

function caso(i:number): CasoVal & { desc:string } {
  const anno = pick([2026,2026,2027]), mese = int(0,11), nd = dimOf(anno,mese);
  // ── squadra
  let id = 0;
  const medici: Medico[] = [];
  const nMR = int(4,7);
  for(let k=0;k<nMR;k++) medici.push({ id:++id, nome:`M. MR${id}`, codice:String(id), stato:"MR", obiettivo:int(18,28), ambulatorio:false });
  const nMDC = pick([0,1,1,2]); for(let k=0;k<nMDC;k++) medici.push({ id:++id, nome:`M. MDC${id}`, codice:String(id), stato:"MDC", obiettivo:int(15,24), ambulatorio:false });
  const nML  = pick([0,1,1,1,2]); for(let k=0;k<nML;k++)  medici.push({ id:++id, nome:`M. ML${id}`,  codice:String(id), stato:"ML",  obiettivo:int(15,28), ambulatorio:false });
  const nMPS = pick([0,1,2]); for(let k=0;k<nMPS;k++) medici.push({ id:++id, nome:`M. MPS${id}`, codice:String(id), stato:"MPS", obiettivo:0, ambulatorio:false });
  const attivi = medici.filter(m=>m.stato!=="MPS");
  // ── regole
  const fer = { mMin:int(1,3), mMax:0, pMin:int(1,2), pMax:0 }; fer.mMax = fer.mMin+int(0,1); fer.pMax = fer.pMin+int(0,1);
  const sab = { mMin:int(1,2), mMax:0, pMin:1, pMax:1 }; sab.mMax = sab.mMin+int(0,1);
  const fest = { mMin:1, mMax:1, pMin:1, pMax:1 };
  const ambulatori: Ambulatorio[] = [];
  const nAmb = pick([0,1,1,2,3]);
  for(let k=0;k<nAmb;k++){
    const giorni: Partial<Record<number,FasciaAmb>> = {};
    for(let j=0;j<int(1,2);j++) giorni[int(0,4)] = pick<FasciaAmb>(["M","M","P","MP"]);
    ambulatori.push({ id:k===0?"A":`amb${k}`, nome:`Amb${k}`, sigla:`A${k}`, giorni });
  }
  for(const m of attivi){
    const ids = ambulatori.filter(()=>prob(0.45)).map(a=>a.id);
    if(prob(0.5)) { m.ambulatori = ids; m.ambulatorio = ids.length>0; }
    else m.ambulatorio = ids.includes("A");                  // formato storico (solo flag)
  }
  const regole: Regole = mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)),
    maxNotti: int(4,6), maxNottiConsec: int(1,3),
    notteLiberoNotte: prob(0.25), riposoEsteso: prob(0.2), mattinaDopoNotte: prob(0.25),
    maxConsec: pick([3,4,5,5,6,7,7]), wkTarget: int(1,2), maxAssSett: pick([0,1,1,2,2,3]),
    blocchiMattina: pick([0,3,4,5]), fabb: { fer, sab, fest }, ambulatori });
  // ── turni manuali
  const ex: TurniMese = {};
  const put = (mid:number,g:number,tipo:string,amb?:string) => { const c=((ex[mid] ||= {})[g] ||= { t:[] }); if(c.t.some(s=>s.tipo===tipo)) return; c.t.push({ tipo, sott:false, man:true, ...(amb?{amb}:{}) }); };
  const libero = (mid:number,g:number) => !(ex[mid]?.[g]?.t?.length);
  for(const m of attivi){
    if(prob(0.35)){ const da=int(1,nd), len=int(2,12); for(let g=da; g<=Math.min(nd,da+len); g++) put(m.id,g,pick(["L","L","L","ANA","104"])); }
    for(let k=0;k<int(0,3);k++){ const g=int(1,nd); if(libero(m.id,g)) put(m.id,g,pick(["X","Xm","Xp","Xn"])); }
  }
  // manuali di lavoro sparsi (legali o no: sono scelte dell'utente)
  for(let k=0;k<int(0,6);k++){
    const m = pick(medici), g = int(1,nd);
    if(!libero(m.id,g)) continue;
    if(m.stato==="MPS") put(m.id,g,pick(["N","3","1","2","M"]));
    else if(m.stato==="ML") put(m.id,g,"M");
    else {
      const r = rnd();
      if(r<0.35) put(m.id,g,"N");
      else if(r<0.6) put(m.id,g,"M");
      else if(r<0.8) put(m.id,g,"P");
      else if(ambulatori.length){ const a=pick(ambulatori); put(m.id,g,pick(["A","Ap"]),a.id); }
    }
  }
  // coda del mese precedente (notti e lavoro)
  let prevT: TurniMese|null = null;
  if(prob(0.4)){
    const pn = mese===0 ? dimOf(anno-1,11) : dimOf(anno,mese-1);
    prevT = {};
    for(const m of attivi.filter(x=>x.stato!=="ML")){
      if(prob(0.3)) (prevT[m.id] ||= {})[pn] = { t:[{ tipo:"N", sott:false, man:true }] };
      if(prob(0.3)) for(let g=pn-int(0,5); g<=pn; g++) if(!prevT[m.id]?.[g]) (prevT[m.id] ||= {})[g] = { t:[{ tipo:"M", sott:false, man:true }] };
    }
  }
  const desc = `${anno}-${String(mese+1).padStart(2,"0")} MR${nMR} MDC${nMDC} ML${nML} MPS${nMPS} consec=${regole.maxConsec} ass=${regole.maxAssSett} nLn=${+regole.notteLiberoNotte} rE=${+regole.riposoEsteso} mDN=${+regole.mattinaDopoNotte} amb=${nAmb} prev=${prevT?1:0}`;
  return { anno, mese, medici, ex, regole, prevT, desc };
}

let tot=0, conViol=0, errori=0, conViolObj=0, mlOltre=0, mlCasi=0, mlAvvisi=0;
const t0 = Date.now();
for(let i=0;i<+nS;i++){
  const c = caso(i);
  if(dumpS!=="" && i<+dumpS) continue;
  const nd = dimOf(c.anno,c.mese);
  setRegole(c.regole); setSalt(0); setAmbRotStart(0);
  ENG.PREV = c.prevT ? { ndim: c.mese===0?dimOf(c.anno-1,11):dimOf(c.anno,c.mese-1), T: c.prevT } : null;
  tot++;
  let V: string[] = [], Vo: string[] = [], problemi: string[] = [];
  try{
    const mr = Math.random; (Math as any).random = mulberry32(+semeS*1000+i);
    let r; try{ r = generaMigliorTentativo(c.anno,c.mese,nd,c.medici,c.ex,+msS); } finally { (Math as any).random = mr; }
    problemi = r.problemi;
    if(dumpS!=="" && +dumpS===i) fs.writeFileSync(`dump_${semeS}_${i}.json`, JSON.stringify({ caso:c, turni:r.turni, problemi }));
    V = violazioniIndip(c, r.turni);
    // pulsante 2 sul tabellone generato
    const o = completaObiettivi(c.anno,c.mese,nd,c.medici,r.turni);
    Vo = violazioniIndip(c, o.turni).filter(x=>!V.includes(x));
    // diagnosi statica: non deve esplodere
    diagnosiStatica(c.anno,c.mese,nd,c.medici,r.turni,c.regole);
    // ML e giorni consecutivi: l'ML è esente dal tetto (mai segnalato, mai bloccato)
    for(const m of c.medici.filter(x=>x.stato==="ML")){
      mlCasi++;
      const cm = Math.max(corsaMassima(c,r.turni,m.id), corsaMassima(c,o.turni,m.id));
      if(cm > c.regole.maxConsec) mlOltre++;
      const tag = m.nome.split(" ").pop()!;
      if(problemi.some(p=>p.startsWith(tag+":") && p.includes("consecutivi"))) mlAvvisi++;
    }
  }catch(e){ errori++; console.log(`#${i} ERRORE ${(e as Error).message}  ${c.desc}`); continue; }
  if(V.length) conViol++;
  if(Vo.length) conViolObj++;
  console.log(`#${String(i).padStart(3)} ${c.desc}  viol=${V.length} viol②=${Vo.length} probl=${problemi.length}${V.length||Vo.length?"  !!! "+[...V,...Vo].slice(0,4).join(" | "):""}`);
}
console.log(`\nSEME ${semeS}: ${tot} configurazioni in ${Math.round((Date.now()-t0)/1000)} s — con violazioni: ${conViol}, nuove violazioni dopo ②: ${conViolObj}, errori: ${errori}`);
console.log(`ML: ${mlCasi} casi, in ${mlOltre} l'ML ha lavorato PIÙ del tetto di consecutivi (esenzione attiva), avvisi "consecutivi" sull'ML: ${mlAvvisi}`);
