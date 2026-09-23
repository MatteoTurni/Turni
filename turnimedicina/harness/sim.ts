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
    const COMP:Record<string,string[]> = { M:["M","A","1"], P:["P","2"], N:["N","3"] };
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

function scenari(): ScenCfg[] {
  const S: ScenCfg[] = [];
  // 1) reale agosto 2026 dallo snapshot dell'utente
  const snap = JSON.parse(fs.readFileSync("scenario_agosto2026.json", "utf8"));
  S.push({ nome:"ago26-reale", anno:snap.anno, mese:snap.mese, medici:snap.medici, ex:snap.ex });
  // 2) giugno 2026 pieno organico, nessuna assenza
  S.push({ nome:"giu26-vuoto", anno:2026, mese:5, medici:mediciBase(), ex:{} });
  // 3) marzo 2026 due settimane di ferie sfalsate
  S.push({ nome:"mar26-ferie", anno:2026, mese:2, medici:mediciBase(),
           ex: conAssenze({1:[[2,8]], 5:[[9,15]], 7:[[16,22]], 9:[[9,15]]}) });
  // 4) agosto 2026 sintetico difficile: quindicine sovrapposte, 5 medici via
  S.push({ nome:"ago26-sint", anno:2026, mese:7, medici:mediciBase(),
           ex: conAssenze({1:[[1,15]], 2:[[10,24]], 5:[[16,31]], 7:[[1,15]], 9:[[16,31]]}) });
  // 5) dicembre 2026: festivi di Natale + ferie
  S.push({ nome:"dic26-fest", anno:2026, mese:11, medici:mediciBase(),
           ex: conAssenze({2:[[21,31]], 7:[[24,31]], 1:[[28,31]]}) });
  // 6) febbraio 2027 (mese corto)
  S.push({ nome:"feb27-corto", anno:2027, mese:1, medici:mediciBase(), ex: conAssenze({5:[[8,14]]}) });
  // 7) organico ridotto: 2 MR in meno
  S.push({ nome:"giu26-ridotto", anno:2026, mese:5,
           medici: mediciBase().filter(m=>![7,9].includes(m.id)), ex:{} });
  // 8) luglio 2026 senza MPS in organico
  S.push({ nome:"lug26-noMPS", anno:2026, mese:6,
           medici: mediciBase().filter(m=>m.stato!=="MPS"), ex: conAssenze({2:[[6,19]]}) });
  // 9) aprile 2027 (Pasqua/Pasquetta) con ferie attorno a Pasqua
  S.push({ nome:"apr27-pasqua", anno:2027, mese:3, medici:mediciBase(),
           ex: conAssenze({1:[[1,11]], 6:[[1,11]]}) });
  // 10) regola notte-libero-notte attiva (agosto reale)
  S.push({ nome:"ago26-nLn", anno:snap.anno, mese:snap.mese, medici:snap.medici, ex:snap.ex,
           regole:{ notteLiberoNotte:true } });
  // 11) riposo esteso attivo
  S.push({ nome:"giu26-ripEst", anno:2026, mese:5, medici:mediciBase(), ex:{}, regole:{ riposoEsteso:true } });
  // 12) obiettivo 3 weekend liberi
  S.push({ nome:"giu26-wk3", anno:2026, mese:5, medici:mediciBase(), ex:{}, regole:{ wkTarget:3 } });
  // 13) ambulatorio 3 giorni a settimana
  S.push({ nome:"giu26-amb3", anno:2026, mese:5, medici:mediciBase(), ex:{}, regole:{ ambulatori:[{ id:"A", nome:"Ambulatorio", sigla:"A", giorni:{ 0:"M", 2:"M", 4:"M" } }] } });
  // 14) fabbisogno alto (3 mattine, 2 pomeriggi minimi nei feriali)
  S.push({ nome:"giu26-fabbAlto", anno:2026, mese:5, medici:mediciBase(), ex:{},
           regole:{ fabb:{ fer:{mMin:3,mMax:3,pMin:2,pMax:2}, sab:{mMin:2,mMax:2,pMin:1,pMax:1}, fest:{mMin:1,mMax:1,pMin:1,pMax:1} } as any } });
  // 15) continuità: notti manuali a fine mese precedente
  {
    const prevT: TurniMese = { 1:{30:{t:[{tipo:"N",sott:false,man:true}]}}, 5:{29:{t:[{tipo:"N",sott:false,man:true}]}} };
    S.push({ nome:"lug26-prevN", anno:2026, mese:6, medici:mediciBase(), ex:{}, prevT });
  }
  // 16) obiettivi bassi (part-time diffuso)
  {
    const med = mediciBase().map(m=>({...m, obiettivo: m.stato==="MPS"?0:15}));
    S.push({ nome:"giu26-obj15", anno:2026, mese:5, medici:med, ex:{} });
  }
  // 17) un MR assente tutto il mese + un altro mezzo mese
  S.push({ nome:"set26-lungodeg", anno:2026, mese:8, medici:mediciBase(),
           ex: conAssenze({1:[[1,30]], 2:[[1,15]]}) });
  // 18) manuali fitti: notti e associati pre-piazzati dall'utente
  {
    const ex: TurniMese = {};
    const put=(id:number,g:number,tipo:string)=>{ (ex[id] ||= {})[g]={t:[...(ex[id]?.[g]?.t||[]),{tipo,sott:false,man:true}]}; };
    put(1,3,"N"); put(1,10,"N"); put(5,6,"N"); put(7,7,"M"); put(7,7,"P"); put(9,14,"N"); put(2,20,"N");
    put(6,12,"M"); put(6,12,"P");
    S.push({ nome:"ott26-manuali", anno:2026, mese:9, medici:mediciBase(), ex });
  }
  return S;
}

// ─── RUN ─────────────────────────────────────────────────────────────────────
async function main(){
  const [,, outFile="/tmp/sim_out.json", repsS="5", msS="2200", soloScen=""] = process.argv;
  const REPS=+repsS, MS=+msS;
  const out: any[] = [];
  const lista = scenari().filter(s=>!soloScen || s.nome.includes(soloScen));
  for(const sc of lista){
    const ndim = dimOf(sc.anno, sc.mese);
    for(let rep=0; rep<REPS; rep++){
      setRegole(mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), ...(sc.regole||{}) } as any));
      ENG.PREV = sc.prevT ? { ndim: sc.mese===0?dimOf(sc.anno-1,11):dimOf(sc.anno,sc.mese-1), T: sc.prevT } : null;
      setSalt(0); setAmbRotStart(rep % Math.max(1,sc.medici.filter(m=>m.ambulatorio).length));
      const rng = mulberry32(0xC0FFEE ^ (rep*2654435761));
      const mrand = Math.random; (Math as any).random = rng;
      const t0=Date.now();
      let r;
      try { r = generaMigliorTentativo(sc.anno, sc.mese, ndim, sc.medici, sc.ex, MS); }
      finally { (Math as any).random = mrand; }
      const ms=Date.now()-t0;
      const viol = violazioni(sc, r.turni);
      const met = metriche(sc, r.turni);
      out.push({ scen: sc.nome, rep, ms, ok: r.ok, viol, ...met,
                 problemi: r.problemi, altUC: !!r.alternativaUC, turni: r.turni });
      const wkl = Object.values(met.wkLib).join(",");
      console.log(`${sc.nome.padEnd(15)} #${rep} ${String(ms).padStart(5)}ms ok=${r.ok?1:0} s=${String(met.s).padStart(4)} soft=${String(met.soft).padStart(7)} buchi=${met.buchi} wkDef=${met.wkDef} wkSc=${met.wkScarto} sforo=${met.sforo} trans=${met.transMean} lavIso=${met.lavIsolati} libIso=${met.libIsolati} strisceM=${met.strisceM} wkLib=[${wkl}] VIOL=${viol.length}${viol.length?" !!! "+viol.slice(0,3).join(" | "):""}`);
    }
  }
  fs.writeFileSync(outFile, JSON.stringify(out,null,1));
  console.log("scritto", outFile);
}
main();
