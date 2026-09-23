// ═══════════════════════════════════════════════════════════════════════════
// HARNESS DI SIMULAZIONE MULTI-SCENARIO — indipendente dalla suite Vitest.
// Esegue generaMigliorTentativo su molti scenari, verifica le regole con
// VALIDATORI INDIPENDENTI (non riusano il ctx) e misura la qualità dei turni.
// ═══════════════════════════════════════════════════════════════════════════
import type { Medico, TurniMese, Regole } from "../src/engine/types";
import { dimOf, dowOf, isHol, isFestivo, mkKey } from "../src/engine/date";
import { SPEC, isMatt, isPom, isNot, vt } from "../src/engine/turni";
import { setRegole, REGOLE_DEFAULT, getRegole, mergeRegole } from "../src/engine/regole";
import { abilitatoAmb, ambIdDi, slotAmbGiorno } from "../src/engine/turni";
import { ENG, setSalt, setAmbRotStart, setPrevContext } from "../src/engine/state";
import { generaMigliorTentativo, misuraTabellone } from "../src/engine/genera";
import * as fs from "node:fs";

// ─── RNG deterministico per run (sostituisce Math.random del multi-tentativo) ─
function mulberry32(seed: number){
  let a = seed>>>0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── VALIDATORI INDIPENDENTI ─────────────────────────────────────────────────
const cell = (T:TurniMese,id:number,g:number) => T[id]?.[g]?.t||[];
const lavora = (T:TurniMese,id:number,g:number) => cell(T,id,g).some(s=>!SPEC.includes(s.tipo));

interface ScenCfg {
  nome: string;
  anno: number; mese: number;              // mese 0-based
  medici: Medico[];
  ex: TurniMese;
  regole?: Partial<Regole>;
  prevT?: TurniMese | null;                // turni del mese precedente (continuità)
}

function violazioni(sc: ScenCfg, T: TurniMese): string[] {
  const R = getRegole();
  const { anno, mese, medici } = sc;
  const ndim = dimOf(anno, mese);
  const V: string[] = [];
  const man = (id:number,g:number,pred:(s:any)=>boolean) => cell(sc.ex,id,g).filter(s=>s.man&&pred(s));
  const prevT = sc.prevT || null;
  const prevNdim = mese===0 ? dimOf(anno-1,11) : dimOf(anno,mese-1);
  const cellB = (id:number,g:number) => g>=1 ? cell(T,id,g) : (prevT ? (prevT[id]?.[prevNdim+g]?.t||[]) : []);
  const lavoraB = (id:number,g:number) => cellB(id,g).some((s:any)=>!SPEC.includes(s.tipo));
  const haNB = (id:number,g:number) => cellB(id,g).some((s:any)=>isNot(s.tipo));

  for(const m of medici){
    if(m.stato==="MPS"){
      // MPS: nessun turno automatico
      for(let g=1;g<=ndim;g++) if(cell(T,m.id,g).some(s=>!s.man))
        V.push(`${m.nome}: turno AUTO su MPS g${g}`);
      continue;
    }
    // ── Regola N (g+1 libero; g+2 secondo config) — solo violazioni con ≥1 auto
    for(let g=1;g<=ndim;g++){
      const nSh = cell(T,m.id,g).find(s=>isNot(s.tipo));
      const nShPrev1 = haNB(m.id,g-1) ? cellB(m.id,g-1).find((s:any)=>isNot(s.tipo)) : null;
      if(nSh){
        const nMan = !!nSh.man;
        if(g+1<=ndim){
          const bad = cell(T,m.id,g+1).filter(s=>!SPEC.includes(s.tipo)&&(!s.man||!nMan));
          if(bad.length) V.push(`${m.nome}: g${g+1} lavorato dopo Notte g${g}`);
        }
        if(g+2<=ndim && !R.notteLiberoNotte){
          const sh=cell(T,m.id,g+2).filter(s=>!SPEC.includes(s.tipo));
          const off = sh.filter(s=>(R.riposoEsteso ? true : (isMatt(s.tipo)||isNot(s.tipo))));
          if(off.some(s=>!s.man||!nMan)) V.push(`${m.nome}: g${g+2} viola riposo post-notte g${g}`);
        }
      }
      // continuità dal mese precedente (immovibile): turni auto del mese corrente
      if(g===1||g===2){
        if(haNB(m.id,g-1)){
          const bad = cell(T,m.id,g).filter(s=>!SPEC.includes(s.tipo)&&!s.man);
          if(bad.length && g-1<1) V.push(`${m.nome}: g${g} lavorato (auto) dopo Notte di fine mese prec.`);
        }
      }
    }
    // ── catena notti a passo 2 > maxNottiConsec (con ≥1 auto nella catena)
    for(let g=1;g<=ndim;g++){
      if(!cell(T,m.id,g).some(s=>isNot(s.tipo))) continue;
      if(cellB(m.id,g-2).some((s:any)=>isNot(s.tipo))) continue; // non inizio catena
      let len=1, autoIn = cell(T,m.id,g).some(s=>isNot(s.tipo)&&!s.man);
      let k=g+2;
      while(k<=ndim && cell(T,m.id,k).some(s=>isNot(s.tipo))){
        len++; if(cell(T,m.id,k).some(s=>isNot(s.tipo)&&!s.man)) autoIn=true; k+=2;
      }
      if(len>Math.max(1,R.maxNottiConsec) && autoIn)
        V.push(`${m.nome}: catena di ${len} notti a passo 2 da g${g}`);
    }
    // ── max notti/mese (se almeno una auto)
    let notti=0, nottiAuto=0;
    for(let g=1;g<=ndim;g++) for(const s of cell(T,m.id,g)) if(isNot(s.tipo)){ notti++; if(!s.man) nottiAuto++; }
    if(notti>R.maxNotti && nottiAuto>0) V.push(`${m.nome}: ${notti} notti (max ${R.maxNotti})`);
    // ── max giorni consecutivi (violazione imputabile ad almeno un auto)
    {
      let run=0, runMan=0;
      // coda mese precedente (immovibile)
      let tp=0; for(let k=0;k>=-6 && lavoraB(m.id,k);k--) tp++;
      run=tp; runMan=tp;
      for(let g=1;g<=ndim;g++){
        const lav = lavora(T,m.id,g);
        const lavMan = cell(T,m.id,g).some(s=>!SPEC.includes(s.tipo)&&s.man);
        run = lav?run+1:0; runMan = lavMan?runMan+1:0;
        if(run>R.maxConsec && runMan<=R.maxConsec){ V.push(`${m.nome}: >${R.maxConsec} giorni consecutivi (g${g})`); break; }
      }
    }
    // ── distanza associati (giornate piene a <3 giorni, con ≥1 auto)
    const haAssG = (g:number)=>{ const sh=g>=1?cell(T,m.id,g):cellB(m.id,g); return sh.some((s:any)=>isMatt(s.tipo))&&sh.some((s:any)=>isPom(s.tipo)); };
    const assMan = (g:number)=>{ const sh=g>=1?cell(T,m.id,g):[{man:true}] as any; return sh.filter((s:any)=>isMatt(s.tipo)||isPom(s.tipo)).every((s:any)=>s.man); };
    for(let g=1;g<=ndim;g++){
      if(!haAssG(g)) continue;
      for(let k=Math.max(g-2,-1);k<=Math.min(ndim,g+2);k++){
        if(k===g) continue;
        if(haAssG(k) && !(assMan(g)&&assMan(k))){ V.push(`${m.nome}: associati troppo vicini g${g}/g${k}`); break; }
      }
    }
    // ── ML: solo mattine, mai festivi (auto)
    if(m.stato==="ML"){
      for(let g=1;g<=ndim;g++) for(const s of cell(T,m.id,g)){
        if(s.man) continue;
        if(isPom(s.tipo)||isNot(s.tipo)) V.push(`${m.nome}(ML): ${s.tipo} g${g}`);
        if(isMatt(s.tipo)&&isFestivo(anno,mese,g)) V.push(`${m.nome}(ML): M festiva g${g}`);
      }
    }
  }
  // ── MDC mai solo in turno
  for(const m of medici){
    if(m.stato!=="MDC") continue;
    const COMP:Record<string,string[]> = { M:["M","A","1"], P:["P","2","Ap"], N:["N","3"] };
    for(let g=1;g<=ndim;g++) for(const s of cell(T,m.id,g)){
      const f = isMatt(s.tipo)?"M":isPom(s.tipo)?"P":isNot(s.tipo)?"N":null;
      if(!f || s.man) continue;
      const comp = medici.some(a=>a.id!==m.id && cell(T,a.id,g).some(x=>COMP[f].includes(x.tipo)));
      if(!comp) V.push(`${m.nome}(MDC): solo in turno ${f} g${g}`);
    }
  }
  // ── fabbisogno massimo mai superato / A solo abilitati+giorni giusti
  const fb = R.fabb;
  for(let g=1;g<=ndim;g++){
    const dow = dowOf(anno,mese,g);
    const fest = isFestivo(anno,mese,g);
    const sab = dow===5 && !fest;
    const fx = fest?fb.fest:sab?fb.sab:fb.fer;
    let M=0,P=0,N=0;
    for(const m of medici) for(const s of cell(T,m.id,g)){ if(s.tipo==="M")M++; else if(s.tipo==="P")P++; else if(s.tipo==="N")N++; }
    // conteggio dei soli automatici entro il massimo (i manuali possono sforare per scelta utente)
    let Ma=0,Pa=0;
    for(const m of medici) for(const s of cell(T,m.id,g)){ if(!s.man){ if(s.tipo==="M")Ma++; if(s.tipo==="P")Pa++; } }
    if(M>fx.mMax && Ma>0) V.push(`g${g}: mattine ${M}>${fx.mMax}`);
    if(P>fx.pMax && Pa>0) V.push(`g${g}: pomeriggi ${P}>${fx.pMax}`);
    if(N>1){ const na=medici.reduce((q,m)=>q+cell(T,m.id,g).filter(s=>s.tipo==="N"&&!s.man).length,0); if(na>0) V.push(`g${g}: ${N} notti`); }
    for(const m of medici){
      for(const s of cell(T,m.id,g)){
        if(!((s.tipo==="A"||s.tipo==="Ap")&&!s.man)) continue;
        if(!abilitatoAmb(m,ambIdDi(s))) V.push(`g${g}: ${s.tipo} auto a non abilitato ${m.nome}`);
        const slots = isHol(anno,mese,g) ? [] : slotAmbGiorno(R.ambulatori??[],dow);
        if(!slots.some(sl=>sl.cod===s.tipo&&sl.amb===ambIdDi(s))) V.push(`g${g}: ${s.tipo} auto fuori dai giorni/fasce d'ambulatorio`);
      }
    }
  }
  // ── conservazione dei manuali
  for(const m of medici) for(let g=1;g<=ndim;g++){
    for(const s of man(m.id,g,()=>true)){
      if(!cell(T,m.id,g).some(x=>x.tipo===s.tipo&&x.man))
        V.push(`${m.nome}: manuale ${s.tipo} g${g} perso`);
    }
  }
  return V;
}

// ─── METRICHE DI QUALITÀ ─────────────────────────────────────────────────────
function metriche(sc: ScenCfg, T: TurniMese){
  const { anno, mese, medici } = sc;
  const ndim = dimOf(anno, mese);
  const m0 = misuraTabellone(anno, mese, ndim, medici, T);
  const att = medici.filter(m=>m.stato!=="MPS");
  // weekend liberi per medico (coppie sab+dom completamente libere)
  const wkPairs: [number,number][] = [];
  for(let g=1;g<=ndim;g++){ if(dowOf(anno,mese,g)===5 && g+1<=ndim && dowOf(anno,mese,g+1)===6) wkPairs.push([g,g+1]); }
  const libero = (id:number,g:number)=>{ const sh=cell(T,id,g); return sh.length===0||sh.every(s=>SPEC.includes(s.tipo)); };
  const wkLib: Record<string,number> = {};
  for(const m of att) wkLib[m.nome] = wkPairs.filter(([s,d])=>libero(m.id,s)&&libero(m.id,d)).length;
  // organicità: transizioni lavoro/riposo, giorni di lavoro isolati, liberi isolati
  let transTot=0, lavIsolati=0, libIsolati=0, strisceM=0;
  for(const m of att){
    let prev=false, trans=0;
    for(let g=1;g<=ndim;g++){
      const lv=lavora(T,m.id,g);
      if(g>1 && lv!==prev) trans++;
      prev=lv;
    }
    transTot+=trans;
    for(let g=2;g<ndim;g++){
      const lv=(x:number)=>lavora(T,m.id,x);
      const notte=(x:number)=>cell(T,m.id,x).some(s=>isNot(s.tipo));
      if(lv(g)&&!lv(g-1)&&!lv(g+1)&&!notte(g)) lavIsolati++;
      // libero isolato NON dovuto al riposo post-notte
      if(!lv(g)&&lv(g-1)&&lv(g+1)&&!notte(g-1)) libIsolati++;
    }
    let inRun=false;
    for(let g=1;g<=ndim;g++){
      if(isFestivo(anno,mese,g)||dowOf(anno,mese,g)>=5){ inRun=false; continue; }
      const has = cell(T,m.id,g).some(s=>s.tipo==="M");
      if(has&&!inRun) strisceM++;
      inRun=has;
    }
  }
  // carichi e notti
  const cnt = (id:number)=>{ let v=0; for(let g=1;g<=ndim;g++) for(const s of cell(T,id,g)) v+=vt(s.tipo,!!s.sott); return v; };
  const cntN = (id:number)=>{ let v=0; for(let g=1;g<=ndim;g++) for(const s of cell(T,id,g)) if(isNot(s.tipo)) v++; return v; };
  const sforo = att.reduce((q,m)=>q+Math.max(0,cnt(m.id)-m.obiettivo),0);
  const notti = Object.fromEntries(att.map(m=>[m.nome,cntN(m.id)]));
  return {
    s: m0.s, soft: Math.round(m0.soft*10)/10, buchi: m0.buchi, wkDef: m0.wkDef,
    wkScarto: m0.wkScarto, probs: m0.probs.length, sforo,
    wkLibMin: Math.min(...Object.values(wkLib)), wkLib,
    transMean: Math.round(transTot/att.length*10)/10,
    lavIsolati, libIsolati, strisceM, notti,
  };
}

// ─── SCENARI ─────────────────────────────────────────────────────────────────
const mediciBase = (): Medico[] => [
  { id:1,  nome:"BALDI",      codice:"1",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:2,  nome:"RENIS",      codice:"2",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:3,  nome:"GENTILE",    codice:"3",  stato:"MDC", obiettivo:21, ambulatorio:false },
  { id:4,  nome:"DELGATTO",   codice:"4",  stato:"ML",  obiettivo:25, ambulatorio:false },
  { id:5,  nome:"CIAMPA",     codice:"5",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:6,  nome:"SPUGNARDI",  codice:"6",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:7,  nome:"STEFANUCCI", codice:"7",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:8,  nome:"LEZZI",      codice:"8",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:9,  nome:"GIORDANO",   codice:"9",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:10, nome:"CASILLI",    codice:"10", stato:"MPS", obiettivo:0,  ambulatorio:false },
  { id:11, nome:"SCUDERI",    codice:"11", stato:"MPS", obiettivo:0,  ambulatorio:false },
];
function conAssenze(assenze: Record<number,[number,number][]>, tipo="L"): TurniMese {
  const T: TurniMese = {};
  for(const idS in assenze){
    const id=+idS;
    for(const [da,a] of assenze[idS as any]){
      for(let g=da; g<=a; g++) (T[id] ||= {})[g] = { t:[{ tipo, sott:false, man:true }] };
    }
  }
  return T;
}

// ═══════════════════════════════════════════════════════════════════════════
// STRESS PIÙ AMBULATORI (v0.3.36): configurazioni CASUALI di ambulatori
// (1-3 ambulatori, giorni/fasce casuali, abilitati casuali, A/Ap manuali
// sparse) sulle squadre reali di agosto/settembre 2026 e su giugno pieno
// organico. Oltre ai validatori di sim.ts, controlli specifici:
//   · ogni slot (ambulatorio, A|Ap) coperto da UN solo medico, oppure
//     dichiarato mancante nei problemi;
//   · nessun medico con due A (o due Ap) nello stesso giorno;
//   · A/Ap automatiche solo agli abilitati di QUEL ambulatorio e solo nei
//     suoi giorni/fasce (già in violazioni()).
// Uso: node multiamb.cjs [n_config=40] [ms=2000]
// ═══════════════════════════════════════════════════════════════════════════
function violazioniAmb(sc: ScenCfg, T: TurniMese, problemi: string[]): string[] {
  const V: string[] = [];
  const R = getRegole();
  const ndim = dimOf(sc.anno, sc.mese);
  for(let g=1; g<=ndim; g++){
    for(const m of sc.medici){
      const c = cell(T,m.id,g);
      if(c.filter(s=>s.tipo==="A").length>1) V.push(`g${g}: ${m.nome} con due A`);
      if(c.filter(s=>s.tipo==="Ap").length>1) V.push(`g${g}: ${m.nome} con due Ap`);
    }
    const slots = isFestivo(sc.anno,sc.mese,g) ? [] : slotAmbGiorno(R.ambulatori, dowOf(sc.anno,sc.mese,g));
    for(const sl of slots){
      const chi = sc.medici.filter(m=>cell(T,m.id,g).some(s=>s.tipo===sl.cod && ambIdDi(s)===sl.amb));
      if(chi.length>1 && chi.some(m=>cell(T,m.id,g).some(s=>s.tipo===sl.cod&&ambIdDi(s)===sl.amb&&!s.man)))
        V.push(`g${g}: slot ${sl.amb}/${sl.cod} coperto ${chi.length} volte`);
      if(chi.length===0 && !problemi.some(p=>new RegExp(`(^|\\D)${g}: .*ambulatorio.*mancante`).test(p)))
        V.push(`g${g}: slot ${sl.amb}/${sl.cod} scoperto e NON segnalato`);
    }
  }
  return V;
}

function scenari(n: number): (ScenCfg & { desc: string })[] {
  const rnd = mulberry32(0xA3B1);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd()*a.length)];
  const basi: { nome:string; anno:number; mese:number; medici:Medico[]; ex:TurniMese }[] = [];
  for(const f of ["scenario_agosto2026.json","scenario_settembre2026.json"]){
    const s = JSON.parse(fs.readFileSync(f,"utf8"));
    basi.push({ nome:f.slice(9,15), anno:s.anno, mese:s.mese, medici:s.medici, ex:s.ex });
  }
  const giu = JSON.parse(fs.readFileSync("scenario_settembre2026.json","utf8"));
  basi.push({ nome:"giugno", anno:2026, mese:5, medici:giu.medici, ex:{} });
  const S: (ScenCfg & { desc: string })[] = [];
  for(let i=0;i<n;i++){
    const b = basi[i % basi.length];
    const nAmb = 1 + Math.floor(rnd()*3);
    const ambs: any[] = [];
    for(let k=0;k<nAmb;k++){
      const giorni: Record<number,string> = {};
      const nG = 1 + Math.floor(rnd()*2);
      for(let j=0;j<nG;j++) giorni[Math.floor(rnd()*5)] = pick(["M","M","P","MP"]);
      ambs.push({ id:"amb"+k, nome:"Amb"+k, sigla:"A"+k, giorni });
    }
    const cand = b.medici.filter(m=>m.stato!=="MPS");
    const medici = b.medici.map(m=>{
      if(m.stato==="MPS") return { ...m, ambulatori:[] as string[] };
      const ids = ambs.filter(()=>rnd()<0.45).map(a=>a.id);
      return { ...m, ambulatori:ids, ambulatorio:ids.length>0 };
    });
    // garantisce almeno 2 abilitati per ambulatorio (salvo 1 config su 8: 0 abilitati)
    for(const a of ambs){
      if(i%8===7 && a.id==="amb0"){ for(const m of medici) m.ambulatori = (m.ambulatori||[]).filter(x=>x!==a.id); continue; }
      let k = medici.filter(m=>m.ambulatori?.includes(a.id)).length;
      while(k<2){ const m = pick(medici.filter(x=>x.stato!=="MPS" && !x.ambulatori?.includes(a.id))); m.ambulatori=[...(m.ambulatori||[]),a.id]; m.ambulatorio=true; k++; }
    }
    // A/Ap manuali sparse (1 config su 3)
    const ex: TurniMese = JSON.parse(JSON.stringify(b.ex||{}));
    if(i%3===0){
      const ndim=dimOf(b.anno,b.mese);
      for(let t=0;t<2;t++){
        const a = pick(ambs), g = 1+Math.floor(rnd()*ndim), m = pick(cand);
        const c = (ex[m.id] ||= {})[g] ||= { t:[] };
        if(c.t.length===0) c.t.push({ tipo: rnd()<0.5?"A":"Ap", sott:false, man:true, amb:a.id });
      }
    }
    const desc = ambs.map(a=>`${a.id}:${JSON.stringify(a.giorni)}[${medici.filter(m=>m.ambulatori?.includes(a.id)).length}ab]`).join(" ");
    S.push({ nome:`${b.nome}#${i}`, anno:b.anno, mese:b.mese, medici, ex, regole:{ ambulatori: ambs } as any, desc });
  }
  return S;
}

function main(){
  const [,, nS="40", msS="2000"] = process.argv;
  let tot=0, conViol=0, ambMancanti=0, mancantiSenzaAbil=0;
  for(const sc of scenari(+nS)){
    const ndim = dimOf(sc.anno, sc.mese);
    setRegole(mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), ...(sc.regole||{}) } as any));
    ENG.PREV = null; setSalt(0); setAmbRotStart(0);
    const rng = mulberry32(0xBEEF ^ tot); const mr = Math.random; (Math as any).random = rng;
    let r; try { r = generaMigliorTentativo(sc.anno, sc.mese, ndim, sc.medici, sc.ex, +msS); } finally { (Math as any).random = mr; }
    const v = [...violazioni(sc, r.turni), ...violazioniAmb(sc, r.turni, r.problemi)];
    const pa = r.problemi.filter(p=>/ambulatorio.*mancante/.test(p));
    tot++; if(v.length) conViol++; ambMancanti += pa.length;
    console.log(`${sc.nome.padEnd(12)} ok=${r.ok?1:0} amb-mancanti=${pa.length} VIOL=${v.length}${v.length?" !!! "+v.slice(0,4).join(" | "):""}  ${sc.desc}`);
    if(pa.length) console.log("      ", pa.slice(0,3).join(" | "));
    // Per ogni slot mancante: perché ciascun abilitato non poteva prenderlo
    // (classificazione INDIPENDENTE, grossolana). "LIBERO?" = nessun motivo
    // evidente: da guardare.
    const R = getRegole();
    for(let g=1; g<=ndim; g++){
      if(isFestivo(sc.anno,sc.mese,g)) continue;
      for(const sl of slotAmbGiorno(R.ambulatori, dowOf(sc.anno,sc.mese,g))){
        if(sc.medici.some(m=>cell(r.turni,m.id,g).some(s=>s.tipo===sl.cod&&ambIdDi(s)===sl.amb))) continue;
        const ab = sc.medici.filter(m=>abilitatoAmb(m,sl.amb));
        const mot = ab.map(m=>{
          const c = cell(r.turni,m.id,g), pom = sl.cod==="Ap";
          const has = (id:number,gg:number,f:(t:string)=>boolean)=> gg>=1 && gg<=ndim && cell(r.turni,id,gg).some(s=>f(s.tipo));
          let why = "LIBERO?";
          if(c.some(s=>["L","ANA","104","per11","X"].includes(s.tipo))) why="assente";
          else if(c.some(s=>s.tipo===(pom?"Xp":"Xm"))) why="escluso fascia";
          else if(pom && m.stato==="ML") why="ML";
          else if(c.some(s=>isNot(s.tipo))) why="notte oggi";
          else if(has(m.id,g-1,isNot)) why="smonto notte";
          else if(!pom && has(m.id,g-2,isNot)) why="notte g-2";
          else if(c.some(s=>s.tipo===sl.cod)) why="altro amb stessa fascia";
          else if(c.some(s=>(pom?isPom:isMatt)(s.tipo))) why="già in turno quella fascia";
          else {
            let run=1; for(let k=g-1;k>=1&&lavora(r.turni,m.id,k);k--) run++; for(let k=g+1;k<=ndim&&lavora(r.turni,m.id,k);k++) run++;
            if(!lavora(r.turni,m.id,g) && run>R.maxConsec) why="consecutivi";
            else if(c.some(s=>!SPEC.includes(s.tipo))) why="già in turno altra fascia("+c.map(s=>s.tipo).join("")+")";
          }
          return `${m.nome.split(" ").pop()}=${why}`;
        });
        console.log(`        g${g} ${sl.amb}/${sl.cod}: ${mot.join(", ")||"nessun abilitato"}`);
      }
    }
  }
  console.log(`\nTOTALE: ${tot} configurazioni, ${conViol} con violazioni, ${ambMancanti} slot d'ambulatorio segnalati mancanti`);
}
main();
