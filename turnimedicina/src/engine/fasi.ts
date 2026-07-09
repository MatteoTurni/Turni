import type { Medico, TurniMese } from "./types";
import { isMatt, isPom, isNot } from "./turni";
import { ENG, mkRng, shuf } from "./state";
import type { Ctx } from "./ctx";

export type Blocco = Record<number, Set<number>> | null;

// ═══════════════════════════════════════════════════════════════════════════
// FASE 1 — TURNI CRITICI
// Le caselle critiche di giorni vicini sono accoppiate dalle regole notte
// (g→g+1 libero, g+2 max P) e associati (g-2..g+2): vengono raggruppate in
// CLUSTER (componenti connesse: giorni a distanza ≤2) e ogni cluster è risolto
// con un piccolo BACKTRACKING (euristica MRV, candidati mescolati dal seed,
// tetto ai nodi). Se il cluster è infeasible o si sfora il tetto si ripiega sul
// vecchio riempimento best-effort.
// ═══════════════════════════════════════════════════════════════════════════

// Backtracking su un singolo cluster di caselle critiche.
export function risolviCluster(ctx: Ctx, cells: {g:number;f:string;need:number}[], rng: ()=>number, limiteNodi: number){
  const { cf, mrMdc, ml, add, gt, st, haM, haP, haQ, canR, mdcOk } = ctx;
  const basePer = (f:string) => f==="M" ? [...ml,...mrMdc] : mrMdc;
  const remaining = (c:{g:number;f:string;need:number}) => c.need - cf(c.g,c.f);
  // candidati attuali per (g,f). NON si usa `eleggibili`: il suo filtro !haQ
  // vieterebbe il turno ASSOCIATO (M+P della stessa persona), che nei giorni
  // sovraccarichi di assenze è l'unico modo di coprire M e P con 2 medici
  // lasciandone uno libero per la Notte.
  const candidati = (g:number,f:string) => basePer(f).filter(m=>{
    if(!canR(m,g,f) || !mdcOk(m,g,f)) return false;
    if(f==="N") return !haQ(m.id,g);
    if(f==="M") return !haM(m.id,g) && (!haP(m.id,g) || canR(m,g,"ASS"));
    return !haP(m.id,g) && (!haM(m.id,g) || canR(m,g,"ASS"));            // P
  });
  // rimuove SOLO il turno automatico che abbiamo aggiunto (man resta intatto)
  const rimuovi = (id:number,g:number,f:string) => st(id,g, gt(id,g).filter(s=>!(s.tipo===f && !s.man)));

  let nodi = 0;
  const solve = (): boolean => {
    if(++nodi > limiteNodi) return false;
    // scegli la casella ancora scoperta col minor numero di candidati (MRV)
    let target:{g:number;f:string;need:number}|null=null, best=Infinity, bestCand:Medico[]|null=null;
    for(const c of cells){
      if(remaining(c)<=0) continue;
      const cand = candidati(c.g,c.f);
      if(cand.length < best){ best=cand.length; target=c; bestCand=cand; if(best===0) break; }
    }
    if(!target) return true;             // tutte le caselle del cluster coperte
    if(bestCand!.length===0) return false; // vicolo cieco → backtrack
    for(const m of shuf(bestCand!,rng)){
      add(m.id,target.g,target.f);
      // Le guardie interne di add() possono rifiutare l'inserimento in silenzio:
      // se il turno non risulta davvero inserito si passa al candidato successivo
      // (senza questo controllo solve() ricorrerebbe all'infinito).
      if(!gt(m.id,target.g).some(s=>s.tipo===target!.f && !s.man)) continue;
      if(solve()) return true;
      rimuovi(m.id,target.g,target.f);
    }
    return false;
  };
  return solve();
}

export function faseCritici(ctx: Ctx, seed: number){
  const { giorniArr, cf, eleggibili, mrMdc, ml, byL, add, haM, haP, haQ, canR, mdcOk, needEff } = ctx;

  // 1) elenco delle caselle con margine eleggibili-fabbisogno ≤ 2.
  //    Il fabbisogno usato è needEff: una cella STRUTTURALMENTE impossibile
  //    (capacità statica < minimo) non deve far fallire la fase — verrà
  //    dichiarata come buco solo dalla validazione finale. Prima un solo
  //    giorno impossibile bruciava tutti i backtrack dell'orchestratore e
  //    faceva collassare l'intera generazione in best-effort.
  const celle: {g:number;f:string;need:number;elig:number}[]=[];
  for(const g of giorniArr){
    celle.push({g,f:"M",need:needEff(g,"M"),elig:eleggibili(g,"M",[...ml,...mrMdc]).length});
    celle.push({g,f:"P",need:needEff(g,"P"),elig:eleggibili(g,"P",mrMdc).length});
    celle.push({g,f:"N",need:needEff(g,"N"),elig:eleggibili(g,"N",mrMdc).length});
  }
  const critici = celle.filter(c=>c.elig - c.need <= 2);
  if(critici.length===0) return true;

  // 2) raggruppa in CLUSTER (componenti connesse 1D: giorni a distanza ≤2)
  const giorniCritici = [...new Set(critici.map(c=>c.g))].sort((a,b)=>a-b);
  const compDi: Record<number,number> = {};
  let nc = 0;
  for(let i=0;i<giorniCritici.length;i++){
    if(i>0 && giorniCritici[i]-giorniCritici[i-1] <= 2) compDi[giorniCritici[i]] = compDi[giorniCritici[i-1]];
    else compDi[giorniCritici[i]] = nc++;
  }
  const clusters: {g:number;f:string;need:number;elig:number}[][] = Array.from({length:nc},()=>[]);
  // ESPANSIONE A GIORNATA INTERA: se un giorno ha anche una sola casella
  // critica, TUTTE le sue caselle (M, P, N) entrano nel cluster.
  for(const c of celle) if(compDi[c.g]!==undefined) clusters[compDi[c.g]].push(c);

  // 3) risolvi ogni cluster con backtracking randomizzato + cap nodi
  const LIMITE_NODI = ENG.CLUSTER_NODES;
  let ok = true;
  for(const cl of clusters){
    cl.sort((a,b)=>a.elig-b.elig || a.g-b.g);   // più strette prima (aiuta l'MRV)
    const rng = mkRng((seed||0) + cl[0].g*2654435761);
    if(risolviCluster(ctx, cl, rng, LIMITE_NODI)) continue;

    // 4) FALLBACK best-effort (vecchio greedy). Le NOTTI prima di M/P.
    const candFallback = (c:{g:number;f:string}) => {
      const base = c.f==="M" ? [...ml,...mrMdc] : mrMdc;
      return byL(base.filter(m=>{
        if(!canR(m,c.g,c.f) || !mdcOk(m,c.g,c.f)) return false;
        if(c.f==="N") return !haQ(m.id,c.g);
        if(c.f==="M") return !haM(m.id,c.g) && (!haP(m.id,c.g) || canR(m,c.g,"ASS"));
        return !haP(m.id,c.g) && (!haM(m.id,c.g) || canR(m,c.g,"ASS"));
      }));
    };
    const clOrd = [...cl].sort((a,b)=>(a.f==="N"?0:1)-(b.f==="N"?0:1) || a.elig-b.elig || a.g-b.g);
    for(const c of clOrd){
      let at=0;
      while(cf(c.g,c.f)<c.need && at<20){
        at++;
        const pool = candFallback(c);
        if(!pool[0]) break;
        add(pool[0].id,c.g,c.f);
      }
    }
    ok = false;
  }

  // 5) verifica finale su TUTTE le caselle entrate nei cluster
  for(const cl of clusters) for(const c of cl) if(cf(c.g,c.f)<c.need) ok=false;
  return ok;
}

// ═══════════════════════════════════════════════════════════════════════════
// RIPARAZIONE LOCALE (LNS) — per i mesi difficili
// Un restart completo ricostruisce da zero anche il 95% del tabellone che era
// già valido, sperando che il caso sistemi gli 1-2 giorni problematici. Qui
// invece si RIPARA il miglior tentativo: attorno a ogni buco residuo si svuota
// una finestra di ±2 giorni (l'orizzonte dei vincoli: Regola N e distanza
// associati) e la si risolve da capo con risolviCluster a budget nodi alto.
// Restano intatti: turni manuali, ambulatorio (A, congelato per la
// rotazione) e tutto ciò che è fuori finestra. Ogni finestra è transazionale:
// se il backtracking non trova una soluzione completa si fa rollback e quella
// finestra resta com'era. I buchi possono quindi solo diminuire; l'eventuale
// costo in weekend liberi (pesato 10 contro 1000 in misura) viene recuperato
// dal riequilibrio finale a valle.
// ═══════════════════════════════════════════════════════════════════════════
export function riparaBuchi(ctx: Ctx, seed: number, limiteNodi = ENG.CLUSTER_NODES){
  const { giorniArr, ndim, cf, needEff, gt, st, medici, mark, rollback, mdcOk } = ctx;
  const FASCE = ["M","P","N"] as const;

  // Giorni con almeno un buco COLMABILE (needEff: gli impossibili strutturali
  // non aprono finestre — nessuna riparazione può coprirli).
  const giorniBuco = giorniArr.filter(g=>FASCE.some(f=>cf(g,f)<needEff(g,f)));
  if(giorniBuco.length===0) return false;

  // Finestre ±2 attorno ai giorni bucati, fuse se sovrapposte/adiacenti.
  // Tetto di 9 giorni per finestra: oltre, il cluster diventa troppo grande e
  // conviene lavorare per finestre separate (in sequenza, ognuna transazionale).
  const finestre: [number,number][] = [];
  for(const g of giorniBuco){
    const lo=Math.max(1,g-2), hi=Math.min(ndim,g+2);
    const last=finestre[finestre.length-1];
    if(last && lo<=last[1]+1 && Math.max(hi,last[1])-last[0]+1<=9) last[1]=Math.max(hi,last[1]);
    else finestre.push([lo,hi]);
  }

  // Guardia MDC: svuotare la finestra può togliere il "compagno" a un turno
  // MANUALE di un medico MDC, e mdcOk viene verificato solo all'inserimento.
  // Una riparazione non deve introdurre NUOVE violazioni (quelle preesistenti,
  // es. create dall'utente coi manuali, restano tollerate come prima).
  const soliMdc = (lo:number,hi:number) => {
    const out=new Set<string>();
    for(let g=lo;g<=hi;g++) for(const m of medici){
      if(m.stato!=="MDC") continue;
      const sh=gt(m.id,g);
      for(const f of FASCE){
        const ha = f==="M" ? sh.some(s=>isMatt(s.tipo))
                 : f==="P" ? sh.some(s=>isPom(s.tipo))
                 :           sh.some(s=>isNot(s.tipo));
        if(ha && !mdcOk(m,g,f)) out.add(`${m.id}:${g}:${f}`);
      }
    }
    return out;
  };

  let riparato=false;
  for(const [lo,hi] of finestre){
    // Celle della finestra col fabbisogno EFFICACE (needEff è stabile rispetto
    // allo svuotamento: capCell guarda solo manuali/immovibili).
    const cells: {g:number;f:string;need:number}[]=[];
    for(let g=lo;g<=hi;g++) for(const f of FASCE){ const need=needEff(g,f); if(need>0) cells.push({g,f,need}); }
    if(cells.length===0) continue;
    const soliPrima = soliMdc(lo,hi);
    for(let att=0; att<3; att++){
      const m0=mark();
      // Svuota i turni AUTOMATICI M/P/N della finestra (manuali, ambulatorio e
      // codici speciali intatti). Liberare i vicini del buco è ciò che dà al
      // solver i gradi di libertà che i riempimenti greedy avevano consumato.
      for(let g=lo;g<=hi;g++) for(const m of medici){
        const c=gt(m.id,g);
        const resto=c.filter(s=>s.man || !["M","P","N"].includes(s.tipo));
        if(resto.length!==c.length) st(m.id,g,resto);
      }
      const rng=mkRng(seed + lo*2654435761 + att*7919);
      if(risolviCluster(ctx,cells,rng,limiteNodi)){
        const dopo=soliMdc(lo,hi);
        if([...dopo].every(k=>soliPrima.has(k))){ riparato=true; break; }
      }
      rollback(m0);   // soluzione incompleta o nuova violazione MDC → finestra intatta
    }
  }
  return riparato;
}

// ═══════════════════════════════════════════════════════════════════════════
// FASE 2 — AMBULATORIO MARTEDÌ (poi CONGELATO)
// Rotazione round-robin: l'indice di partenza è INIETTATO (ENG.AMB_ROT_START)
// e avanzato solo LOCALMENTE. Niente più localStorage nel motore: la
// persistenza dell'indice, calcolata dal SOLO tabellone accettato, è compito
// della UI (vedi calcAmbRotNext in genera.ts). Questo chiude anche il bug di
// equità per cui la rotazione avanzava nei tentativi scartati dal multi-tentativo.
// ═══════════════════════════════════════════════════════════════════════════
export function faseAmbulatorio(ctx: Ctx){
  const { giorniArr, isMar, isH, gt, add, medici, ambilitati, haX, haN, cnt, canConsec, canMatt } = ctx;
  const n = ambilitati.length;
  let nextIdx = n>0 ? ((ENG.AMB_ROT_START % n) + n) % n : 0;
  let ok=true;
  for(const g of giorniArr){
    if(!isMar(g)||isH(g)) continue;
    if(medici.some(m=>gt(m.id,g).some(s=>s.man&&["A"].includes(s.tipo)))) continue;
    if(medici.some(m=>gt(m.id,g).some(s=>!s.man&&s.tipo==="A"))) continue;

    const canAmb = (m: Medico, ignoraObiettivo=false) => {
      if(m.stato==="MPS") return false;
      if(haX(m.id,g)) return false;
      if(gt(m.id,g).some(s=>s.man&&["L","ANA","per11","104"].includes(s.tipo))) return false;
      // Vincolo MORBIDO: superabile nel 2° passaggio, quando l'alternativa
      // sarebbe lasciare l'ambulatorio scoperto.
      if(!ignoraObiettivo && m.obiettivo>0 && cnt(m.id)>=m.obiettivo) return false;
      if(haN(m.id,g)) return false;
      // La A è un turno di MATTINA → vale la Regola N (vietata a g+1 e g+2 di una notte).
      if(!canMatt(m.id,g)) return false;
      if(!canConsec(m.id,g)) return false;
      const tt=gt(m.id,g).filter(s=>s.tipo!=="X"&&!["L","ANA","per11","104"].includes(s.tipo));
      return tt.length===0;
    };

    // La A automatica va SOLO agli abilitati: 1° passaggio rispettando
    // l'obiettivo; 2° passaggio IGNORANDO l'obiettivo (vincolo morbido); se
    // nessun abilitato è disponibile per vincoli DURI la fase FALLISCE e
    // l'orchestratore rimescola le notti dei Critici con un seed nuovo.
    let assegnato=false;
    for(const ignoraObiettivo of [false,true]){
      if(assegnato || n===0) break;
      for(let off=0; off<n; off++){
        const idx=(nextIdx+off)%n;
        const m=ambilitati[idx];
        if(!canAmb(m,ignoraObiettivo)) continue;
        add(m.id,g,"A");
        // Le guardie di add() possono rifiutare in silenzio: verificare SEMPRE
        // che la A sia stata davvero inserita prima di dichiarare successo.
        if(!gt(m.id,g).some(s=>s.tipo==="A")) continue;
        nextIdx=(idx+1)%n;
        assegnato=true; break;
      }
    }
    if(!assegnato) ok=false;
  }
  return ok;
}

// ═══════════════════════════════════════════════════════════════════════════
// FASE 3 — WEEKEND (liberi + copertura), poi CONGELATO
// ═══════════════════════════════════════════════════════════════════════════
// `evita` (FEEDBACK NOTTI→WEEKEND): per medico, l'insieme delle coppie sab-dom
// da NON riservargli perché contengono una notte rimasta scoperta nei tentativi
// precedenti e lui è tra i (pochi) eleggibili per coprirla. Evitamento SOFT:
// le coppie evitate finiscono in fondo all'ordinamento, quindi vengono scelte
// solo se altrimenti il medico non raggiungerebbe il proprio obiettivo.
export function assegnaWkLiberi(ctx: Ctx, rng: ()=>number, evita?: Record<number, Set<string>>){
  const { wkPairs, mrMdc, gt, SPEC, wkTargetMed } = ctx;
  const isManocc = (m:Medico,[s,d]:[number,number]) =>
    gt(m.id,s).some(x=>x.man&&!SPEC.includes(x.tipo)) ||
    gt(m.id,d).some(x=>x.man&&!SPEC.includes(x.tipo));
  const daEvitare = (m:Medico,[s,d]:[number,number]) => evita?.[m.id]?.has(`${s}-${d}`) ?? false;
  const blocco: Record<number,Set<number>>={}; for(const m of mrMdc) blocco[m.id]=new Set();
  const candCount = (m:Medico) => wkPairs.filter(p=>!isManocc(m,p)).length;
  // chi ha meno candidati va servito prima (meno flessibilità); shuffle per varietà
  const ordine = shuf([...mrMdc],rng).sort((a,b)=>candCount(a)-candCount(b));
  const carico: Record<string,number>={}; for(const [s,d] of wkPairs) carico[`${s}-${d}`]=0;
  let tuttiOk=true;
  for(const m of ordine){
    const tgt = wkTargetMed(m.id);   // obiettivo per-medico (ridotto dai manuali)
    const cand = shuf(wkPairs.filter(p=>!isManocc(m,p)),rng)
                  .sort((a,b)=>((daEvitare(m,a)?1:0)-(daEvitare(m,b)?1:0))
                            || (carico[`${a[0]}-${a[1]}`]-carico[`${b[0]}-${b[1]}`]));
    let n=0;
    for(const [s,d] of cand){
      if(n>=tgt) break;
      blocco[m.id].add(s); blocco[m.id].add(d);
      carico[`${s}-${d}`]++; n++;
    }
    if(n<tgt) tuttiOk=false; // impossibile riservare i weekend richiesti a questo medico
  }
  return { blocco, tuttiOk };
}

export function coperturaWeekend(ctx: Ctx, blocco: Blocco){
  const { giorniArr, isWk, isSp, isS, haAss, medici, mrMdc, ml, byL, add,
          canR, mdcOk, canAssDist, cf, nmn, npn, haM, haP, haQ, cntWkLiberi } = ctx;
  const isBloc = (id:number,g:number) => blocco?.[id]?.has(g) ?? false;
  const poolWk = (g:number,f:string,base:Medico[]) => byL(base.filter(m=>!haQ(m.id,g)&&canR(m,g,f)&&mdcOk(m,g,f)));
  // Se TUTTI i candidati hanno il weekend riservato, una prenotazione va
  // bruciata comunque: si sceglie chi ha PIÙ weekend liberi (può cederne uno).
  const pick   = (pool:Medico[],g:number) => pool.filter(m=>!isBloc(m.id,g))[0]
    ?? pool.slice().sort((a,b)=>cntWkLiberi(b.id)-cntWkLiberi(a.id))[0];

  for(const g of giorniArr){
    if(!isWk(g)) continue;

    if(isSp(g)){
      // DOMENICA/FESTIVO: intervenire SOLO se la copertura minima manca ancora
      // (guardando cf, per non sovracoprire il fabbisogno mx 1/1).
      const mancaM = cf(g,"M") < nmn(g).mn;
      const mancaP = cf(g,"P") < npn(g).mn;
      if(mancaM && mancaP){
        const poolAss = poolWk(g,"M",mrMdc).filter(m=>canR(m,g,"P")&&mdcOk(m,g,"P")&&canAssDist(m.id,g));
        const ch = pick(poolAss,g);
        if(ch){ add(ch.id,g,"M"); add(ch.id,g,"P"); }
        else {
          const cM=pick(poolWk(g,"M",mrMdc),g); if(cM) add(cM.id,g,"M");
          const cP=pick(poolWk(g,"P",mrMdc).filter(m=>m.id!==cM?.id),g); if(cP) add(cP.id,g,"P");
        }
      } else {
        if(mancaM){ const cM=pick(poolWk(g,"M",mrMdc),g); if(cM) add(cM.id,g,"M"); }
        if(mancaP){ const cP=pick(poolWk(g,"P",mrMdc),g); if(cP) add(cP.id,g,"P"); }
      }
    } else if(isS(g)){
      // SABATO: associato (M+P) solo se mancano ANCORA sia una M sia la P
      // (il P del sabato ha mx 1) + 2ª mattina (priorità ML) + pomeriggio.
      if(cf(g,"M")<nmn(g).mn && cf(g,"P")<npn(g).mn &&
         !medici.some(m=>m.stato!=="MPS"&&haAss(m.id,g))){
        const poolAss = poolWk(g,"M",mrMdc).filter(m=>canR(m,g,"P")&&mdcOk(m,g,"P")&&canAssDist(m.id,g));
        const ch = pick(poolAss,g);
        if(ch){ add(ch.id,g,"M"); add(ch.id,g,"P"); }
      }
      if(cf(g,"M")<nmn(g).mn){
        // priorità: ML, poi tutti gli altri (MR/MDC)
        const poolML    = poolWk(g,"M",ml).filter(m=>!haM(m.id,g));
        const poolAltri = poolWk(g,"M",mrMdc).filter(m=>!haM(m.id,g));
        const ch = pick(poolML,g) ?? pick(poolAltri,g);
        if(ch) add(ch.id,g,"M");
      }
      if(cf(g,"P")<npn(g).mn){
        const ch = pick(poolWk(g,"P",mrMdc).filter(m=>!haP(m.id,g)),g);
        if(ch) add(ch.id,g,"P");
      }
    }
  }
}

// ── SEPARAZIONE REGOLE / COPERTURA (fix ripiego weekend) ────────────────────
// Prima validaWeekend fondeva due cose diverse: le REGOLE (Regola N, ambulatorio),
// che sono vincoli rigidi e sempre rispettabili, e la COPERTURA piena dei weekend,
// che su certi mesi NON è raggiungibile da nessun tentativo (es. una domenica in
// cui gli unici medici liberi sono bloccati dalle notti dei giorni prima).
// Poiché faseWeekend registrava il "miglior tentativo" solo dentro
// if(validaWeekend(...)), una sola cella weekend irraggiungibile rendeva il
// ripiego CODICE MORTO: la fase falliva sempre, l'orchestratore bruciava tutti i
// backtrack e l'intero mese cadeva in best-effort. Stesso problema in
// riequilibraWeekendLiberi, il cui backtracking terminava con validaWeekend.
// Ora: le regole restano un gate; la copertura diventa un PUNTEGGIO da massimizzare.

/** Vincoli RIGIDI dei weekend: ambulatorio del martedì + Regola N/associati. */
export function validaWeekendRegole(ctx: Ctx){
  const { giorniArr, isMar, isH, medici, gt, checkRegolaN } = ctx;
  for(const g of giorniArr){
    if(isMar(g)&&!isH(g) && !medici.some(m=>gt(m.id,g).some(s=>["A"].includes(s.tipo)))) return false;
  }
  return checkRegolaN();
}
/** Copertura weekend raggiunta (saturata a needEff): più alta è, meglio è. */
export function copWeekend(ctx: Ctx){
  const { giorniArr, isWk, cf, needEff } = ctx;
  let s=0;
  for(const g of giorniArr){
    if(!isWk(g)) continue;
    s += Math.min(cf(g,"M"), needEff(g,"M")) + Math.min(cf(g,"P"), needEff(g,"P"));
  }
  return s;
}
/** Copertura weekend MASSIMA teorica (somma dei needEff). Costante nel mese. */
export function copWeekendMax(ctx: Ctx){
  const { giorniArr, isWk, needEff } = ctx;
  let s=0;
  for(const g of giorniArr){ if(!isWk(g)) continue; s += needEff(g,"M") + needEff(g,"P"); }
  return s;
}

export function validaWeekend(ctx: Ctx){
  // NB: il controllo dei weekend liberi NON è qui: è nella validazione globale
  // finale (dopo le notti), perché le notti possono occupare weekend liberi.
  const { giorniArr, isWk, cf, isMar, isH, medici, gt, checkRegolaN, needEff } = ctx;
  for(const g of giorniArr){
    if(!isWk(g)) continue;
    // needEff: un sabato/festivo STRUTTURALMENTE impossibile non deve rendere
    // la validazione falsa per sempre (prima bloccava faseWeekend — anche in
    // accettaMigliore — e riequilibraWeekendLiberi, distruggendo l'equità dei
    // weekend in tutto il mese).
    if(cf(g,"M")<needEff(g,"M")) return false;
    if(cf(g,"P")<needEff(g,"P")) return false;
  }
  for(const g of giorniArr){
    if(isMar(g)&&!isH(g) && !medici.some(m=>gt(m.id,g).some(s=>["A"].includes(s.tipo)))) return false;
  }
  if(!checkRegolaN()) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// FASE PRELIMINARE — RIEQUILIBRIO DEI WEEKEND LIBERI
// Ridistribuisce i SOLI turni weekend fra i medici sbilanciati rispetto al
// proprio obiettivo; riesce solo se una configurazione valida ed equa esiste.
// ═══════════════════════════════════════════════════════════════════════════
export function riequilibraWeekendLiberi(ctx: Ctx){
  const { mrMdc, giorniArr, isWk, gt, st, SPEC, cntWkLiberi,
          canR, mdcOk, canAssDist, mark, rollback, wkTargetMed } = ctx;

  // 1) Individua i due gruppi sbilanciati rispetto all'obiettivo per-medico.
  const sotto = mrMdc.filter(m=>cntWkLiberi(m.id)<wkTargetMed(m.id));
  if(sotto.length===0) return false;                 // niente da riequilibrare
  const sopra = mrMdc.filter(m=>cntWkLiberi(m.id)>wkTargetMed(m.id));
  if(sopra.length===0) return false;                 // nessuna riserva disponibile

  // 2) Insieme dei medici coinvolti: SOLO < target e > target (gli == restano).
  const coinvolti = [...sotto, ...sopra];

  const fasciaDi = (t:string) => isMatt(t)?"M":isPom(t)?"P":isNot(t)?"N":null;
  const haFascia = (id:number,g:number,f:string) => gt(id,g).some(s=>fasciaDi(s.tipo)===f);

  // 3) Raccolta di tutti i turni weekend (non manuali, non SPEC) dei coinvolti.
  const cells: {g:number;f:string;tipo:string}[] = [];
  for(const g of giorniArr){
    if(!isWk(g)) continue;
    for(const m of coinvolti){
      for(const s of gt(m.id,g)){
        if(s.man || SPEC.includes(s.tipo)) continue;
        const f=fasciaDi(s.tipo);
        if(f) cells.push({ g, f, tipo:s.tipo });
      }
    }
  }
  if(cells.length===0) return false;
  // M prima del P dello stesso giorno: il backtracking incontra le due fasce in
  // sequenza e la preferenza per l'ASSOCIATO può riunirle sullo stesso medico.
  const rankF = (f:string) => f==="M"?0:f==="P"?1:2;
  cells.sort((a,b)=>a.g-b.g || rankF(a.f)-rankF(b.f));

  const m0 = mark();
  // Copertura weekend PRIMA dello svuotamento: la ridistribuzione non deve
  // peggiorarla. Prima il backtracking terminava con validaWeekend(), che
  // pretende la copertura PIENA: su un mese con una cella weekend irraggiungibile
  // il riequilibrio non poteva MAI riuscire e l'equità restava com'era.
  const copPrima = copWeekend(ctx);

  // 4) Svuota i turni weekend ridistribuibili dei coinvolti (mantiene manuali/SPEC).
  for(const g of giorniArr){
    if(!isWk(g)) continue;
    for(const m of coinvolti){
      st(m.id,g, gt(m.id,g).filter(s=>s.man||SPEC.includes(s.tipo)));
    }
  }

  const metti   = (id:number,g:number,tipo:string) => { const c=gt(id,g); if(c.some(s=>s.tipo===tipo)) return; st(id,g,[...c,{tipo,sott:false,man:false}]); };
  const rimuovi = (id:number,g:number,tipo:string) => st(id,g, gt(id,g).filter(s=>!(s.tipo===tipo&&!s.man)));

  const obiettivoOk = () => coinvolti.every(m=>cntWkLiberi(m.id)>=wkTargetMed(m.id));

  // 5) Backtracking: privilegia chi ha più weekend liberi residui, e la forma
  //    ad ASSOCIATO (un solo medico brucia il weekend invece di due).
  let nodi = 0;
  const LIMITE = ENG.REBAL_NODES;
  const solve = (i:number): boolean => {
    if(++nodi > LIMITE) return false;
    if(i>=cells.length) return obiettivoOk() && validaWeekendRegole(ctx) && copWeekend(ctx)>=copPrima;
    const { g, f, tipo } = cells[i];
    const compl = f==="M" ? "P" : f==="P" ? "M" : null;
    const wouldAss = (m:Medico) => compl!==null && haFascia(m.id,g,compl);
    const cand = coinvolti
      .filter(m=>!haFascia(m.id,g,f) && canR(m,g,f) && mdcOk(m,g,f) && (!wouldAss(m)||canAssDist(m.id,g)))
      .sort((a,b)=>((wouldAss(b)?1:0)-(wouldAss(a)?1:0)) ||
                   (cntWkLiberi(b.id)-cntWkLiberi(a.id)) || (a.id-b.id));
    for(const m of cand){
      metti(m.id,g,tipo);
      if(solve(i+1)) return true;
      rimuovi(m.id,g,tipo);
    }
    return false;
  };

  if(solve(0)) return true;   // configurazione valida ed equa trovata → applicata
  rollback(m0);               // nessuna soluzione → ripristina e lascia il ricalcolo
  return false;
}

// `accettaMigliore`: modalità di ripiego. Quando true, se nessun tentativo
// garantisce i weekend liberi a TUTTI, la fase conserva e applica il miglior
// tentativo a copertura valida (quello che soddisfa l'obiettivo di weekend
// liberi al maggior numero di medici).
// `nottiCritiche` (FEEDBACK NOTTI→WEEKEND): giorni la cui notte è rimasta
// scoperta in un tentativo precedente. Per ogni coppia sab-dom che contiene uno
// di quei giorni, i medici oggi eleggibili per quella notte NON dovrebbero
// avere quel weekend riservato: la prenotazione stessa era la causa (probabile)
// del fallimento. L'eleggibilità è calcolata QUI (post Critici+Ambulatorio):
// è un'approssimazione di quella che faseNotti vedrà dopo, sufficiente come
// euristica perché l'evitamento resta soft.
export function faseWeekend(ctx: Ctx, seed: number, accettaMigliore=false, nottiCritiche?: Set<number>): { ok:boolean; blocco:Blocco; parziale?:boolean } {
  const { mark, rollback, snapshot, restore, mrMdc, cntWkLiberi, wkTargetMed, wkPairs, eleggibili } = ctx;
  let evita: Record<number, Set<string>> | undefined;
  if(nottiCritiche && nottiCritiche.size){
    evita = {};
    for(const [s,d] of wkPairs){
      for(const g of [s,d]){
        if(!nottiCritiche.has(g)) continue;
        for(const m of eleggibili(g,"N",mrMdc)){
          if(!evita[m.id]) evita[m.id] = new Set();
          evita[m.id].add(`${s}-${d}`);
        }
      }
    }
  }
  const m0 = mark();
  const scoreWkLiberi = () =>
    mrMdc.reduce((acc,m)=>acc+(cntWkLiberi(m.id)>=wkTargetMed(m.id)?1:0),0);
  const copMax = copWeekendMax(ctx);
  // `migliore` ora è ordinato per (copertura weekend, wk liberi soddisfatti):
  // così un mese con una cella weekend irraggiungibile produce comunque il
  // MIGLIOR tabellone possibile invece di far fallire la fase all'infinito.
  let migliore: { snap: TurniMese; blocco: Blocco; cop: number; score: number } | null = null;
  for(let att=0; att<ENG.TRIES; att++){
    rollback(m0);
    const rng = mkRng(seed + att*7919);
    const { blocco, tuttiOk } = assegnaWkLiberi(ctx, rng, evita);
    if(!tuttiOk && !accettaMigliore) continue;
    coperturaWeekend(ctx, blocco);
    if(!validaWeekendRegole(ctx)) continue;          // le REGOLE restano un gate rigido
    const cop = copWeekend(ctx);
    if(cop>=copMax && tuttiOk) return { ok:true, blocco };   // soluzione completa → subito
    if(accettaMigliore){                              // copertura e/o wk liberi parziali
      const sc = scoreWkLiberi();
      if(!migliore || cop>migliore.cop || (cop===migliore.cop && sc>migliore.score))
        migliore = { snap:snapshot(), blocco, cop, score:sc };
    }
  }
  if(accettaMigliore && migliore){
    rollback(m0);
    restore(migliore.snap);                         // applica il miglior ripiego trovato
    return { ok:true, blocco:migliore.blocco, parziale:true };
  }
  rollback(m0);
  return { ok:false, blocco:null };
}

// ═══════════════════════════════════════════════════════════════════════════
// FASE 4 — NOTTI (+ controllo finale dei weekend liberi)
// ═══════════════════════════════════════════════════════════════════════════
// Oltre a ok/ko la fase dichiara `nottiScoperte`: i giorni con notte ancora
// scoperta (ma colmabile: needEff≥1) nel miglior parziale. L'orchestratore li
// accumula e li passa alla fase Weekend al retry (feedback mirato, invece del
// rimescolamento cieco che sperava di risolvere il conflitto per fortuna).
export function faseNotti(ctx: Ctx, seed: number, blocco: Blocco): { ok:boolean; nottiScoperte:number[] } {
  const { mark, rollback, snapshot, restore, giorniArr, cf, eleggibili, mrMdc, byN, add, isWk, cntWkLiberi, wkTargetMed, needEff } = ctx;
  const isBloc = (id:number,g:number) => blocco?.[id]?.has?.(g) ?? false;
  const m0 = mark();
  const nottiCoperte = () => giorniArr.reduce((n,g)=>n+(cf(g,"N")>=1?1:0),0);
  let bestSnap: TurniMese | null = null, bestCop = nottiCoperte();   // best-effort: miglior parziale
  for(let att=0; att<ENG.TRIES; att++){
    rollback(m0);
    const rng = mkRng(seed + att*104729);
    const scoperti = giorniArr.filter(g=>cf(g,"N")<1);
    const ordin = scoperti.map(g=>({g,e:eleggibili(g,"N",mrMdc).length}))
                          .sort((a,b)=>a.e-b.e || rng()-0.5);
    for(const {g} of ordin){
      if(cf(g,"N")>=1) continue;
      const pool = byN(eleggibili(g,"N",mrMdc));
      // Sui weekend: prima chi NON ha il weekend riservato; a parità, chi ha
      // PIÙ weekend liberi (può "spenderne" uno restando sopra l'obiettivo).
      const ch = isWk(g)
        ? pool.slice().sort((a,b)=>
            ((isBloc(a.id,g)?1:0)-(isBloc(b.id,g)?1:0)) ||
            (cntWkLiberi(b.id)-cntWkLiberi(a.id)))[0]
        : pool[0];
      if(ch) add(ch.id,g,"N");
    }
    const cop = nottiCoperte();
    if(cop>bestCop){ bestCop=cop; bestSnap=snapshot(); }   // conserva il parziale migliore
    // needEff: una notte STRUTTURALMENTE impossibile non fa fallire la fase.
    let ok=true; for(const g of giorniArr) if(cf(g,"N")<1 && needEff(g,"N")>=1) ok=false;
    if(!ok) continue;                       // notti non coperte → nuovo tentativo
    // ── CONTROLLO WEEKEND LIBERI (dopo le notti) ────────────────────────────
    if(mrMdc.some(m=>cntWkLiberi(m.id)<wkTargetMed(m.id))) riequilibraWeekendLiberi(ctx);
    if(mrMdc.every(m=>cntWkLiberi(m.id)>=wkTargetMed(m.id))) return { ok:true, nottiScoperte:[] };
  }
  rollback(m0);                       // best-effort: lascia il maggior numero di notti coperte
  if(bestSnap) restore(bestSnap);
  // Fallimento per equità weekend (notti tutte coperte) → lista vuota: in quel
  // caso il feedback non deve restringere nulla.
  const nottiScoperte = giorniArr.filter(g=>cf(g,"N")<1 && needEff(g,"N")>=1);
  return { ok:false, nottiScoperte };
}

// ═══════════════════════════════════════════════════════════════════════════
// FASE 5 — DIURNI FERIALI (copertura minima)
// ═══════════════════════════════════════════════════════════════════════════
export function faseDiurni(ctx: Ctx, seed: number){
  const { mark, rollback, snapshot, restore, ndim, feriali, ml, mrMdc, byL, add, canR, mdcOk, cf,
          nmn, npn, haM, haP, haN, haQ, cnt, eleggibili, haAss, canAssDist, checkRegolaN, maxAssSett, needEff } = ctx;
  const nSett  = (g:number) => Math.floor((g-1)/7);
  const assInS = (id:number,s:number) => { let n=0; for(let g=1;g<=ndim;g++) if(nSett(g)===s&&haAss(id,g)) n++; return n; };
  const m0 = mark();
  const scoreDiurni = () => feriali.reduce((s,g)=>s+Math.min(cf(g,"M"),nmn(g).mn)+Math.min(cf(g,"P"),npn(g).mn),0);
  let bestSnap: TurniMese | null = null, bestSc = scoreDiurni();   // best-effort: miglior parziale

  for(let att=0; att<ENG.TRIES; att++){
    rollback(m0);
    const rng = mkRng(seed + att*1299709);

    // 5A — M del ML, dalle più critiche, fino all'obiettivo
    for(const m of ml){
      const giorniML = feriali.filter(g=>!haQ(m.id,g)&&canR(m,g,"M")&&mdcOk(m,g,"M")&&!haM(m.id,g));
      const ord = giorniML.map(g=>({g,e:eleggibili(g,"M",[...ml,...mrMdc]).length}))
                          .sort((a,b)=>a.e-b.e || rng()-0.5);
      for(const {g} of ord){
        if(cnt(m.id)>=m.obiettivo) break;
        if(!canR(m,g,"M")||!mdcOk(m,g,"M")||haM(m.id,g)||haQ(m.id,g)) continue;
        if(cf(g,"M")>=nmn(g).mx) continue;
        add(m.id,g,"M");
      }
    }

    // 5B — completa mattine al minimo, preferendo consecutive per lo stesso medico
    for(const g of feriali){
      let at=0;
      while(cf(g,"M")<nmn(g).mn && at<20){
        at++;
        const base=[...ml,...mrMdc].filter(m=>!haM(m.id,g)&&canR(m,g,"M")&&mdcOk(m,g,"M")&&!haQ(m.id,g));
        if(base.length===0) break;
        const consec = base.filter(m=>haM(m.id,g-1)||haM(m.id,g+1));
        const scelta = (consec.length?byL(consec):byL(base))[0];
        if(!scelta) break;
        add(scelta.id,g,"M");
      }
    }

    // 5C — pomeriggi al minimo, preferendo gli associati (max maxAssSett/settimana)
    for(const g of feriali){
      let at=0;
      while(cf(g,"P")<npn(g).mn && at<20){
        at++;
        const baseP = mrMdc.filter(m=>!haP(m.id,g)&&!haN(m.id,g)&&canR(m,g,"P")&&mdcOk(m,g,"P"));
        if(baseP.length===0) break;
        const ass = baseP.filter(m=>haM(m.id,g)&&assInS(m.id,nSett(g))<maxAssSett&&canR(m,g,"ASS")&&canAssDist(m.id,g));
        const scelta = (ass.length?byL(ass):byL(baseP))[0];
        if(!scelta) break;
        add(scelta.id,g,"P");
      }
    }

    let ok=true;
    // needEff: i feriali strutturalmente impossibili non fanno fallire la fase.
    for(const g of feriali) if(cf(g,"M")<needEff(g,"M")||cf(g,"P")<needEff(g,"P")) ok=false;
    const sc=scoreDiurni();
    if(sc>bestSc){ bestSc=sc; bestSnap=snapshot(); }   // conserva il parziale migliore
    if(!checkRegolaN()) ok=false;
    if(ok) return true;
  }
  rollback(m0);                       // best-effort: lascia il maggior numero di diurni coperti
  if(bestSnap) restore(bestSnap);
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDAZIONE GLOBALE (controllo finale della prima generazione)
// ═══════════════════════════════════════════════════════════════════════════
export function validazioneGlobale(ctx: Ctx){
  const { giorniArr, cf, nmn, npn, mrMdc, cntWkLiberi, isMar, isH, medici, gt, checkRegolaN, wkTargetMed, lavoraGiorno, MAX_CONSEC, trailingPrev, needEff, SPEC } = ctx;
  const probs: string[]=[];
  // I buchi si dichiarano sempre rispetto al fabbisogno PIENO (onestà in UI),
  // ma quelli sotto la capacità statica vengono marcati IMPOSSIBILE.
  const imp = (g:number,f:"M"|"P"|"N",mn:number) => needEff(g,f)<mn ? " (IMPOSSIBILE)" : "";
  for(const g of giorniArr){
    if(cf(g,"M")<nmn(g).mn) probs.push(`G${g}: mattine ${cf(g,"M")}/${nmn(g).mn}${imp(g,"M",nmn(g).mn)}`);
    if(cf(g,"P")<npn(g).mn) probs.push(`G${g}: pomeriggi ${cf(g,"P")}/${npn(g).mn}${imp(g,"P",npn(g).mn)}`);
    if(cf(g,"N")<1)          probs.push(`G${g}: notte mancante${imp(g,"N",1)}`);
  }
  for(const g of giorniArr){
    if(isMar(g)&&!isH(g) && !medici.some(m=>gt(m.id,g).some(s=>["A"].includes(s.tipo))))
      probs.push(`Martedì ${g}: ambulatorio mancante`);
  }
  // RETE DI SICUREZZA: una A AUTOMATICA su un medico non abilitato non è mai valida.
  for(const m of medici){
    if(m.ambulatorio) continue;
    for(const g of giorniArr)
      if(gt(m.id,g).some(s=>!s.man&&["A"].includes(s.tipo)))
        probs.push(`${m.nome.split(" ").pop()}: ambulatorio G${g} a medico non abilitato`);
  }
  // Controllo finale dei weekend liberi (dopo le notti), con obiettivo per-medico.
  for(const m of mrMdc){ const w=cntWkLiberi(m.id), t=wkTargetMed(m.id); if(w<t) probs.push(`${m.nome.split(" ").pop()}: ${w}/${t} wk liberi`); }
  if(!checkRegolaN()) probs.push("Violazione Regola N / distanza associati");
  // Controllo MAX giorni consecutivi di lavoro (per ogni medico attivo).
  // TOLLERANZA AI MANUALI: se il superamento esiste già nella sola sequenza
  // dei giorni lavorati MANUALMENTE (runMan), è una scelta dell'utente e non
  // un difetto del generatore → non viene segnalato. Si segnala solo quando
  // la corsa supera il massimo per colpa di (almeno) un turno automatico.
  for(const m of medici){
    if(m.stato==="MPS") continue;
    // CONTINUITÀ: la corsa parte dai giorni lavorati alla fine del mese
    // precedente (immovibili → contano anche per runMan).
    let run=trailingPrev(m.id), runMan=trailingPrev(m.id);
    for(let g=1;g<=giorniArr.length;g++){
      const lav    = lavoraGiorno(m.id,g);
      const lavMan = gt(m.id,g).some(s=>!SPEC.includes(s.tipo)&&s.man);
      run    = lav    ? run+1    : 0;
      runMan = lavMan ? runMan+1 : 0;
      if(run>MAX_CONSEC && runMan<=MAX_CONSEC){
        probs.push(`${m.nome.split(" ").pop()}: >${MAX_CONSEC} giorni consecutivi (fino a g${g})`);
        break;
      }
    }
  }
  return probs;
}
