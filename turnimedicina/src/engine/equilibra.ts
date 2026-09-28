// ═══════════════════════════════════════════════════════════════════════════
// EQUILIBRA (v0.3.42) — rifinitura FACOLTATIVA, lanciata dall'utente
// ═══════════════════════════════════════════════════════════════════════════
// "Completa obiettivi" non rimaneggia i turni. Questo pulsante sì, ma solo
// quando l'utente lo chiede: scambia turni AUTOMATICI fra gli MR per rendere
// più equi le notti e il rapporto mattine/pomeriggi.
// Invarianti di OGNI scambio (se una cade, lo scambio si annulla):
//   · turni/punti di ogni medico identici (gli obiettivi non si muovono);
//   · copertura di ogni cella identica;
//   · regole: ogni inserimento passa da canR/add; nessun buco, violazione,
//     MDC lasciato solo; weekend liberi e carico weekend non peggiorano;
//   · manuali, sottolineati ed esclusioni non si toccano.
// Prezzo accettato (scelta del reparto): un blocco di mattine si può
// accorciare di un giorno per ogni scambio.
import type { Medico, TurniMese } from "./types";
import { cloneT, pulisciT } from "./turni";
import { scaduto, conDeadline } from "./state";
import { makeCtx } from "./ctx";
import { misuraTabellone, quoteNotti, scartoNotti, scartoMP, mdcViolCount, PESI, type MisuraTab } from "./genera";

type Ctx = ReturnType<typeof makeCtx>;
export interface RigaEquilibrio { id:number; nome:string; M:number; P:number; N:number }
export interface OpzEquilibra { traGiorni?: boolean; ms?: number }
export interface EsitoEquilibra {
  turni: TurniMese; scambiNotti: number; scambiMP: number;
  prima: RigaEquilibrio[]; dopo: RigaEquilibrio[];
  celle: { id:number; g:number }[];                 // celle cambiate
}

const righe = (c:Ctx): RigaEquilibrio[] => c.mr.map(m=>{
  let M=0,P=0;
  for(let g=1; g<=c.ndim; g++){
    const sh=c.gt(m.id,g);
    if(sh.some(s=>s.tipo==="M"||s.tipo==="A")) M++;
    if(sh.some(s=>s.tipo==="P"||s.tipo==="Ap")) P++;
  }
  return { id:m.id, nome:m.nome, M, P, N:c.cntN(m.id) };
});

export function equilibra(anno:number, mese:number, ndim:number, medici:Medico[], turni:TurniMese, opz:OpzEquilibra = {}): EsitoEquilibra {
  const T = cloneT(turni);
  const c = makeCtx(anno, mese, ndim, medici, T);
  const prima = righe(c);
  const misura = ()=>misuraTabellone(anno,mese,ndim,medici,c.T);
  const mdc0 = mdcViolCount(ndim,medici,c);
  const punti0 = new Map(c.att.map(m=>[m.id, c.cnt(m.id)]));
  const copertura = ()=>{ const a:number[]=[]; for(let g=1;g<=ndim;g++) for(const f of ["M","P","N"]) a.push(c.cf(g,f)); return a.join(","); };
  const cop0 = copertura();
  const invarianti = ()=> c.att.every(m=>c.cnt(m.id)===punti0.get(m.id)) && copertura()===cop0 && mdcViolCount(ndim,medici,c)<=mdc0;
  const auto = (x:{man?:boolean;sott?:boolean}) => !x.man && !x.sott;
  const solo = (id:number,g:number,f:"M"|"P") => { const sh=c.gt(id,g); return sh.length===1 && sh[0].tipo===f && auto(sh[0]); };
  let scambiNotti=0, scambiMP=0;

  conDeadline(Date.now()+(opz.ms ?? 4000), ()=>{
    // ── 1) NOTTI fra gli MR: la notte passa a chi ne ha meno; chi la cede
    // riprende dal ricevente turni diurni automatici per lo stesso numero di
    // punti (una notte = 2 punti), così nessun obiettivo si sposta.
    // Il resto del punteggio (tolti notti, strisce e continuità) non peggiora.
    let nd0 = scartoNotti(c);
    let cur = misura(); let altro0 = cur.soft - nd0*PESI.notti - cur.strisceM*PESI.strisce - cur.contPen*PESI.cont;
    for(let iter=0; iter<30 && !scaduto(); iter++){
      const q=quoteNotti(c); const sc=(id:number)=>c.cntN(id)-q.get(id)!;
      const donatori=[...c.mr].sort((a,z)=>sc(z.id)-sc(a.id));
      const riceventi=[...c.mr].sort((a,z)=>sc(a.id)-sc(z.id));
      let mossa=false;
      outer:
      for(const o of donatori) for(const u of riceventi){
        if(o.id===u.id || sc(o.id)-sc(u.id)<=1) continue;
        for(let g=1; g<=ndim && !scaduto(); g++){
          if(!c.gt(o.id,g).some(s=>s.tipo==="N" && auto(s))) continue;
          const m0=c.mark();
          if(!spostaNotte(c, o, u, g, ndim) || !compensa(c, o, u, punti0, ndim)){ c.rollback(m0); continue; }
          if(!invarianti()){ c.rollback(m0); continue; }
          const nx=misura(); const ndx=scartoNotti(c);
          const altroX = nx.soft - ndx*PESI.notti - nx.strisceM*PESI.strisce - nx.contPen*PESI.cont;
          if(ndx<nd0-1e-9 && nx.s<=cur.s && nx.wkScarto<=cur.wkScarto && altroX<=altro0+1e-9){
            cur=nx; nd0=ndx; altro0=altroX; scambiNotti++; mossa=true; break outer;
          }
          c.rollback(m0);
        }
      }
      if(!mossa) break;
    }

    // ── 2) MATTINE / POMERIGGI fra gli MR (quota di mattine della squadra).
    const tutti=[...c.mr, ...c.ml, ...c.mdc];
    const filo=(g1:number,g2:number)=>tutti.some(m=>c.gt(m.id,g1).some(s=>s.tipo==="M"||s.tipo==="P") && c.gt(m.id,g2).some(s=>s.tipo==="M"));
    const cont=(g:number)=>(c.feriali.includes(g-1)&&filo(g-1,g)?1:0)+(c.feriali.includes(g+1)&&filo(g,g+1)?1:0);
    const altro=(x:MisuraTab)=>x.soft - x.strisceM*PESI.strisce - x.contPen*PESI.cont;
    cur = misura();
    const prova = (giorni:number[], fai:()=>boolean): boolean => {
      const c0 = giorni.reduce((q,g)=>q+cont(g),0);
      const m0=c.mark();
      if(!fai() || giorni.reduce((q,g)=>q+cont(g),0) < c0-1 || !invarianti()){ c.rollback(m0); return false; }
      const nx=misura();
      if(nx.s<=cur.s && nx.wkScarto<=cur.wkScarto && altro(nx)<=altro(cur)+1e-9){ cur=nx; return true; }
      c.rollback(m0); return false;
    };
    for(let iter=0; iter<80 && !scaduto(); iter++){
      const e=scartoMP(c);
      const piuM=[...c.mr].sort((a,z)=>e.get(z.id)!-e.get(a.id)!);
      const piuP=[...c.mr].sort((a,z)=>e.get(a.id)!-e.get(z.id)!);
      let mossa=false;
      outer2:
      for(const a of piuM) for(const b of piuP){
        if(a.id===b.id || e.get(a.id)!-e.get(b.id)!<=1) continue;
        // stesso giorno: a M→P, b P→M
        for(const g of c.feriali){
          if(scaduto()) break outer2;
          if(!solo(a.id,g,"M") || !solo(b.id,g,"P")) continue;
          if(prova([g], ()=>{ c.st(a.id,g,[]); c.st(b.id,g,[]);
              if(!c.canR(a,g,"P")) return false; c.add(a.id,g,"P"); if(!c.gt(a.id,g).some(s=>s.tipo==="P")) return false;
              if(!c.canR(b,g,"M")) return false; c.add(b.id,g,"M"); return c.gt(b.id,g).some(s=>s.tipo==="M"); })){
            scambiMP++; mossa=true; break outer2;
          }
        }
        if(!opz.traGiorni) continue;
        // giorni diversi: a lascia la mattina di h e prende il pomeriggio di g
        // (lasciato da b); b prende la mattina di h.
        for(const h of c.feriali){
          if(!solo(a.id,h,"M") || c.gt(b.id,h).length) continue;
          for(const g of c.feriali){
            if(scaduto()) break outer2;
            if(g===h || !solo(b.id,g,"P") || c.gt(a.id,g).length) continue;
            if(prova([g,h], ()=>{ c.st(a.id,h,[]); c.st(b.id,g,[]);
                if(!c.canR(a,g,"P") || !c.mdcOk(a,g,"P")) return false; c.add(a.id,g,"P"); if(!c.gt(a.id,g).some(s=>s.tipo==="P")) return false;
                if(!c.canR(b,h,"M") || !c.mdcOk(b,h,"M")) return false; c.add(b.id,h,"M"); return c.gt(b.id,h).some(s=>s.tipo==="M"); })){
              scambiMP++; mossa=true; break outer2;
            }
          }
        }
      }
      if(!mossa) break;
    }
  });

  const out = pulisciT(c.T);
  const celle: { id:number; g:number }[] = [];
  for(const m of medici) for(let g=1; g<=ndim; g++){
    const k=(x:TurniMese)=>(x[m.id]?.[g]?.t||[]).map(s=>s.tipo+(s.man?"!":"")+(s.sott?"_":"")).sort().join(",");
    if(k(turni)!==k(out)) celle.push({ id:m.id, g });
  }
  return { turni: out, scambiNotti, scambiMP, prima, dopo: righe(makeCtx(anno,mese,ndim,medici,out)), celle };
}

// La notte automatica di o nel giorno g passa a u. Se u ha turni diurni
// automatici che glielo impediscono (g, g+1, mattina di g+2) li prende o.
function spostaNotte(c:Ctx, o:Medico, u:Medico, g:number, ndim:number): boolean {
  const auto=(x:{man?:boolean;sott?:boolean})=>!x.man && !x.sott;
  c.st(o.id,g, c.gt(o.id,g).filter(s=>!(s.tipo==="N" && auto(s))));
  if(!c.haQ(u.id,g) && c.canR(u,g,"N")){ c.add(u.id,g,"N"); if(c.haN(u.id,g)) return true; }
  const daCedere:{g:number; f:"M"|"P"}[]=[];
  for(const gg of [g, g+1, g+2]){
    if(gg>ndim) continue;
    const sh=c.gt(u.id,gg);
    const confl = gg===g+2 ? sh.filter(x=>x.tipo==="M") : sh;
    if(!confl.length) continue;
    if(!confl.every(x=>(x.tipo==="M"||x.tipo==="P") && auto(x))) return false;
    for(const x of confl) daCedere.push({ g:gg, f:x.tipo as "M"|"P" });
    c.st(u.id,gg, sh.filter(x=>!confl.includes(x)));
  }
  if(!daCedere.length || !c.canR(u,g,"N")) return false;
  c.add(u.id,g,"N"); if(!c.haN(u.id,g)) return false;
  for(const {g:gg,f} of daCedere){
    if(!(c.canR(o,gg,f) && c.mdcOk(o,gg,f))) return false;
    c.add(o.id,gg,f); if(!c.gt(o.id,gg).some(x=>x.tipo===f && !x.man)) return false;
  }
  return true;
}

// Riporta i punti di o e u a quelli di partenza: o riprende da u turni
// diurni automatici feriali (prima quelli attaccati ad altri suoi giorni).
function compensa(c:Ctx, o:Medico, u:Medico, punti0:Map<number,number>, ndim:number): boolean {
  const auto=(x:{man?:boolean;sott?:boolean})=>!x.man && !x.sott;
  for(let guard=0; guard<6 && c.cnt(o.id)<punti0.get(o.id)!; guard++){
    const cand:{g:number; f:"M"|"P"}[]=[];
    for(const g of c.feriali){
      const sh=c.gt(u.id,g);
      if(sh.length!==1 || !(sh[0].tipo==="M"||sh[0].tipo==="P") || !auto(sh[0]) || c.gt(o.id,g).length) continue;
      cand.push({ g, f:sh[0].tipo as "M"|"P" });
    }
    const vic=(g:number)=>(c.lavoraGiorno(o.id,g-1)||(g<ndim&&c.lavoraGiorno(o.id,g+1)))?0:1;
    cand.sort((a,b)=>vic(a.g)-vic(b.g) || a.g-b.g);
    let fatto=false;
    for(const {g,f} of cand){
      const m0=c.mark();
      c.st(u.id,g,[]);
      if(c.canR(o,g,f) && c.mdcOk(o,g,f)){ c.add(o.id,g,f); if(c.gt(o.id,g).some(x=>x.tipo===f)){ fatto=true; break; } }
      c.rollback(m0);
    }
    if(!fatto) return false;
  }
  return c.cnt(o.id)===punti0.get(o.id) && c.cnt(u.id)===punti0.get(u.id);
}
