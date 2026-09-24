// ═══════════════════════════════════════════════════════════════════════════
// VALIDATORI INDIPENDENTI (v0.3.37) — non riusano MAI il ctx del motore.
// Ogni regola è riscritta da zero a partire dal tabellone: se il motore e il
// validatore divergono, è un bug di uno dei due. Si segnalano solo violazioni
// in cui è coinvolto almeno un turno AUTOMATICO (i manuali sono scelte
// dell'utente, inviolabili).
// ═══════════════════════════════════════════════════════════════════════════
import type { Medico, TurniMese, Regole, Turno } from "../src/engine/types";
import { dimOf, dowOf, isFestivo } from "../src/engine/date";

const SPEC = ["X","Xm","Xp","Xn","ANA","per11","104","L"];
const ASS  = ["L","ANA","per11","104"];
const isM  = (t:string) => t==="M"||t==="A"||t==="1";
const isP  = (t:string) => t==="P"||t==="Ap"||t==="2";
const isN  = (t:string) => t==="N"||t==="3";
const escl = (t:string, f:"M"|"P"|"N") => t==="X" || t===(f==="M"?"Xm":f==="P"?"Xp":"Xn");

export interface CasoVal {
  anno:number; mese:number; medici:Medico[]; ex:TurniMese; regole:Regole;
  prevT?: TurniMese|null;
}

export function violazioniIndip(c: CasoVal, T: TurniMese): string[] {
  const { anno, mese, medici, ex, regole: R } = c;
  const nd = dimOf(anno, mese);
  const V: string[] = [];
  const cell = (id:number,g:number): Turno[] => T[id]?.[g]?.t || [];
  const prevNd = mese===0 ? dimOf(anno-1,11) : dimOf(anno,mese-1);
  const cellB = (id:number,g:number): Turno[] => g>=1 ? cell(id,g) : (c.prevT?.[id]?.[prevNd+g]?.t || []);
  const lav = (id:number,g:number) => cellB(id,g).some(s=>!SPEC.includes(s.tipo));
  const nome = (m:Medico) => m.nome.split(" ").pop();

  for(const m of medici){
    // ── MPS: mai turni automatici
    if(m.stato==="MPS"){
      for(let g=1;g<=nd;g++) if(cell(m.id,g).some(s=>!s.man)) V.push(`${nome(m)}(MPS): turno automatico g${g}`);
      continue;
    }
    for(let g=1;g<=nd;g++){
      const sh = cell(m.id,g);
      const auto = sh.filter(s=>!s.man);
      // ── assenze ed esclusioni: nessun turno automatico sulla fascia negata
      if(sh.some(s=>ASS.includes(s.tipo)&&s.man) && auto.some(s=>!SPEC.includes(s.tipo)))
        V.push(`${nome(m)}: turno automatico in giorno di assenza g${g}`);
      for(const f of ["M","P","N"] as const){
        if(!sh.some(s=>escl(s.tipo,f))) continue;
        const pred = f==="M"?isM:f==="P"?isP:isN;
        if(auto.some(s=>pred(s.tipo))) V.push(`${nome(m)}: turno ${f} automatico nonostante l'esclusione g${g}`);
      }
      // ── al più un turno per fascia
      if(sh.filter(s=>isM(s.tipo)).length>1 && auto.some(s=>isM(s.tipo))) V.push(`${nome(m)}: due mattine g${g}`);
      if(sh.filter(s=>isP(s.tipo)).length>1 && auto.some(s=>isP(s.tipo))) V.push(`${nome(m)}: due pomeriggi g${g}`);
      // ── notte esclusiva col resto della giornata
      if(sh.some(s=>isN(s.tipo)) && sh.some(s=>isM(s.tipo)||isP(s.tipo)) && sh.some(s=>!s.man&&!SPEC.includes(s.tipo)))
        V.push(`${nome(m)}: notte e giorno insieme g${g}`);
      // ── ML: solo mattine, mai festivi
      if(m.stato==="ML") for(const s of auto){
        if(isP(s.tipo)||isN(s.tipo)) V.push(`${nome(m)}(ML): ${s.tipo} automatico g${g}`);
        if(isM(s.tipo) && isFestivo(anno,mese,g)) V.push(`${nome(m)}(ML): mattina festiva g${g}`);
      }
      // ── Regola N
      const nSh = sh.find(s=>isN(s.tipo));
      if(nSh){
        const nMan = !!nSh.man;
        if(g+1<=nd && cell(m.id,g+1).some(s=>!SPEC.includes(s.tipo)&&(!s.man||!nMan))) V.push(`${nome(m)}: lavora il giorno dopo la notte g${g}`);
        if(g+1<=nd && !nMan && cell(m.id,g+1).some(s=>ASS.includes(s.tipo)||s.tipo==="X")) V.push(`${nome(m)}: notte automatica prima di un'assenza g${g}`);
        if(g+2<=nd){
          const sh2 = cell(m.id,g+2).filter(s=>!SPEC.includes(s.tipo));
          const ammessoM = R.mattinaDopoNotte && !R.riposoEsteso;
          const ammessoN = R.notteLiberoNotte && !R.riposoEsteso;
          const viola = sh2.filter(s => R.riposoEsteso ? true : (isM(s.tipo)&&!ammessoM) || (isN(s.tipo)&&!ammessoN));
          if(viola.some(s=>!s.man||!nMan)) V.push(`${nome(m)}: riposo a g+2 violato dopo la notte g${g}`);
        }
      }
    }
    // ── continuità col mese precedente
    if(c.prevT){
      if(cellB(m.id,0).some(s=>isN(s.tipo)) && cell(m.id,1).some(s=>!s.man&&!SPEC.includes(s.tipo))) V.push(`${nome(m)}: lavora il 1 dopo la notte di fine mese precedente`);
    }
    // ── max notti/mese e catene di notti a passo 2
    let notti=0, auto=0;
    for(let g=1;g<=nd;g++) for(const s of cell(m.id,g)) if(isN(s.tipo)){ notti++; if(!s.man) auto++; }
    if(notti>R.maxNotti && auto>0) V.push(`${nome(m)}: ${notti} notti (max ${R.maxNotti})`);
    for(let g=1;g<=nd;g++){
      if(!cell(m.id,g).some(s=>isN(s.tipo)) || cellB(m.id,g-2).some(s=>isN(s.tipo))) continue;
      let len=1, a=cell(m.id,g).some(s=>isN(s.tipo)&&!s.man);
      for(let k=g+2;k<=nd && cell(m.id,k).some(s=>isN(s.tipo));k+=2){ len++; if(cell(m.id,k).some(s=>isN(s.tipo)&&!s.man)) a=true; }
      if(len>Math.max(1,R.maxNottiConsec) && a) V.push(`${nome(m)}: ${len} notti di fila a passo 2 da g${g}`);
    }
    // ── max giorni consecutivi — l'ML è ESENTE per regola (v0.3.30)
    if(m.stato!=="ML"){
      let run=0, runMan=0;
      for(let k=0;k>=-6 && lav(m.id,k);k--){ run++; runMan++; }
      for(let g=1;g<=nd;g++){
        run = lav(m.id,g) ? run+1 : 0;
        runMan = cell(m.id,g).some(s=>!SPEC.includes(s.tipo)&&s.man) ? runMan+1 : 0;
        if(run>R.maxConsec && runMan<=R.maxConsec){ V.push(`${nome(m)}: ${run} giorni consecutivi (max ${R.maxConsec}) a g${g}`); break; }
      }
    }
    // ── distanza fra giornate piene (≥2 giorni liberi da giornate piene)
    const piena = (g:number) => { const sh=cellB(m.id,g); return sh.some(s=>isM(s.tipo))&&sh.some(s=>isP(s.tipo)); };
    const pienaMan = (g:number) => g<1 || cell(m.id,g).filter(s=>isM(s.tipo)||isP(s.tipo)).every(s=>s.man);
    for(let g=1;g<=nd;g++){
      if(!piena(g)) continue;
      for(let k=g+1;k<=Math.min(nd,g+2);k++)
        if(piena(k) && !(pienaMan(g)&&pienaMan(k))) V.push(`${nome(m)}: giornate piene troppo vicine g${g}/g${k}`);
    }
    // ── max giornate piene REALI per settimana lun–dom (v0.3.37)
    const reale = (g:number) => { const sh=cellB(m.id,g); return sh.some(s=>isM(s.tipo)&&s.tipo!=="1")&&sh.some(s=>isP(s.tipo)&&s.tipo!=="2"); };
    const realeAuto = (g:number) => g>=1 && reale(g) && cell(m.id,g).some(s=>!s.man&&(isM(s.tipo)||isP(s.tipo)));
    const dw1 = dowOf(anno,mese,1);
    for(let da=1-dw1; da<=nd; da+=7){
      let n=0, a=false;
      for(let k=da;k<da+7&&k<=nd;k++){ if(k<-6) continue; if(reale(k)) n++; if(realeAuto(k)) a=true; }
      if(n>R.maxAssSett && a) V.push(`${nome(m)}: ${n} giornate piene nella settimana del ${Math.max(1,da)} (max ${R.maxAssSett})`);
    }
    // ── obiettivo: sforo massimo +1 (una notte vale 2) sui soli automatici
    // (misurato a parte: non è una violazione dura, vedi `sforo` in metriche)
  }
  // ── MDC mai solo in turno (automatico)
  const COMP = { M:["M","A","1"], P:["P","2","Ap"], N:["N","3"] } as const;
  for(const m of medici){
    if(m.stato!=="MDC") continue;
    for(let g=1;g<=nd;g++) for(const s of cell(m.id,g)){
      if(s.man) continue;
      const f = isM(s.tipo)?"M":isP(s.tipo)?"P":isN(s.tipo)?"N":null;
      if(!f) continue;
      if(!medici.some(a=>a.id!==m.id && cell(a.id,g).some(x=>(COMP[f] as readonly string[]).includes(x.tipo))))
        V.push(`${nome(m)}(MDC): solo in turno ${f} g${g}`);
    }
  }
  // ── fabbisogno MASSIMO (solo se superato con automatici) e una notte al giorno
  for(let g=1;g<=nd;g++){
    const fest = isFestivo(anno,mese,g), sab = dowOf(anno,mese,g)===5 && !fest;
    const fx = fest ? R.fabb.fest : sab ? R.fabb.sab : R.fabb.fer;
    let M=0,P=0,N=0,Ma=0,Pa=0,Na=0;
    for(const m of medici) for(const s of cell(m.id,g)){
      if(s.tipo==="M"){ M++; if(!s.man) Ma++; }
      if(s.tipo==="P"){ P++; if(!s.man) Pa++; }
      if(s.tipo==="N"){ N++; if(!s.man) Na++; }
    }
    if(M>fx.mMax && Ma>0) V.push(`g${g}: ${M} mattine oltre il massimo ${fx.mMax}`);
    if(P>fx.pMax && Pa>0) V.push(`g${g}: ${P} pomeriggi oltre il massimo ${fx.pMax}`);
    if(N>1 && Na>0) V.push(`g${g}: ${N} notti`);
  }
  // ── ambulatori: solo abilitati, solo nei loro giorni/fasce, uno per slot
  for(let g=1;g<=nd;g++){
    const fest = isFestivo(anno,mese,g), dw = dowOf(anno,mese,g);
    for(const m of medici) for(const s of cell(m.id,g)){
      if(!(s.tipo==="A"||s.tipo==="Ap") || s.man) continue;
      const id = s.amb ?? "A";
      const amb = R.ambulatori.find(a=>a.id===id);
      const abil = Array.isArray(m.ambulatori) ? m.ambulatori.includes(id) : (!!m.ambulatorio && id==="A");
      if(!abil || m.stato==="MPS") V.push(`${nome(m)}: ambulatorio ${id} automatico senza abilitazione g${g}`);
      const f = amb?.giorni?.[dw];
      const ok = !fest && f && (s.tipo==="A" ? (f==="M"||f==="MP") : (f==="P"||f==="MP"));
      if(!ok) V.push(`${nome(m)}: ambulatorio ${id}/${s.tipo} fuori dai suoi giorni g${g}`);
      if(s.tipo==="Ap" && m.stato==="ML") V.push(`${nome(m)}(ML): ambulatorio di pomeriggio g${g}`);
    }
    for(const a of R.ambulatori) for(const cod of ["A","Ap"]){
      const chi = medici.filter(m=>cell(m.id,g).some(s=>s.tipo===cod&&(s.amb??"A")===a.id));
      if(chi.length>1 && chi.some(m=>cell(m.id,g).some(s=>s.tipo===cod&&(s.amb??"A")===a.id&&!s.man)))
        V.push(`g${g}: ambulatorio ${a.id}/${cod} assegnato ${chi.length} volte`);
    }
  }
  // ── nessun turno manuale perso o alterato
  for(const idS in ex) for(const gS in ex[idS]) for(const s of ex[idS][gS].t){
    if(!s.man) continue;
    if(!cell(+idS,+gS).some(x=>x.man&&x.tipo===s.tipo&&(x.amb??"")===(s.amb??"")&&!!x.sott===!!s.sott))
      V.push(`manuale ${s.tipo} del medico ${idS} g${gS} perso`);
  }
  return V;
}

/** Corsa massima di giorni lavorati di un medico (con la coda del mese precedente). */
export function corsaMassima(c: CasoVal, T: TurniMese, id: number): number {
  const nd = dimOf(c.anno, c.mese);
  const prevNd = c.mese===0 ? dimOf(c.anno-1,11) : dimOf(c.anno,c.mese-1);
  const cellB = (g:number) => g>=1 ? (T[id]?.[g]?.t||[]) : (c.prevT?.[id]?.[prevNd+g]?.t || []);
  const lav = (g:number) => cellB(g).some(s=>!SPEC.includes(s.tipo));
  let run=0, max=0;
  for(let k=0;k>=-6 && lav(k);k--) run++;
  for(let g=1;g<=nd;g++){ run = lav(g) ? run+1 : 0; max=Math.max(max,run); }
  return max;
}
