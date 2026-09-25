import type { Medico, TurniMese } from "./types";
import { DF } from "./date";
import { isMatt, isPom, isNot, isEscl, isAmbT, ambIdDi, type SlotAmb } from "./turni";
import { ENG, mkRng, shuf, scaduto } from "./state";
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
// `stats` (v0.3.37, opzionale): dopo la chiamata dice se un fallimento è
// DIMOSTRATO (albero esplorato per intero: `tagliato` false) o solo PROBABILE
// (tetto nodi o scadenza raggiunti). La diagnosi causale lo usa per non
// affermare un'impossibilità che non ha verificato.
export function risolviCluster(ctx: Ctx, cells: {g:number;f:string;need:number}[], rng: ()=>number, limiteNodi: number,
                               stats?: { tagliato: boolean }){
  const { cf, mrMdc, ml, add, gt, st, haM, haP, haQ, canR, mdcOk, pesoSlot, byWkQuota,
          wkPairs, isLibWk, cntWkLiberi, wkTargetMed, cnt, cntWk, wkQuota, wkPavimento } = ctx;
  // ── COSTO IN WEEKEND LIBERI (v0.3.25) ──────────────────────────────────────
  // Il cluster assegna anche sabati, domeniche/festivi e notti prefestive, ma
  // lo faceva SENZA sapere quanto costano in weekend liberi: la fase Weekend
  // gira dopo e trova il conto già pagato. byWkQuota bilancia il CARICO di
  // weekend (quante ore pesanti porta ciascuno), che è un'altra cosa: due
  // tabelloni con lo stesso carico possono avere zero o tre medici sotto
  // obiettivo, a seconda di COME i turni si spalmano sulle coppie sab-dom.
  //
  // Qui si aggiunge il criterio mancante, lo stesso già usato da
  // riempimentoEmergenza (costoWk/azzeraWk):
  //   1. prima chi in quella coppia LAVORA GIÀ — assegnarglielo costa zero
  //      weekend liberi, perché il suo è comunque perso;
  //   2. poi chi ha più margine rispetto al proprio obiettivo (slack), così a
  //      pagare è chi può permetterselo.
  // Vale solo per i giorni che appartengono a una coppia sab-dom: sui festivi
  // isolati e sui feriali partnerWk è null e l'ordine resta quello di prima.
  const partnerWk = (g:number): number|null => { for(const [s,d] of wkPairs){ if(s===g) return d; if(d===g) return s; } return null; };
  const costoWk = (id:number,g:number) => { const p=partnerWk(g); if(p===null) return 0; return (isLibWk(id,g)&&isLibWk(id,p))?1:0; };
  const slackWk = (id:number) => cntWkLiberi(id) - wkTargetMed(id);
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

  let nodi = 0, tagliato = false;
  const solve = (): boolean => {
    if(++nodi > limiteNodi){ tagliato = true; return false; }
    // DEADLINE: il tetto ai nodi limita la COMBINATORIA, non il TEMPO — su
    // cluster grandi 200k nodi possono costare decine di secondi. Controllo
    // periodico (ogni 256 nodi: costo irrilevante) e abort come per il tetto.
    if((nodi & 255)===0 && scaduto()){ tagliato = true; return false; }
    // scegli la casella ancora scoperta col minor numero di candidati (MRV)
    let target:{g:number;f:string;need:number}|null=null, best=Infinity, bestCand:Medico[]|null=null;
    for(const c of cells){
      if(remaining(c)<=0) continue;
      const cand = candidati(c.g,c.f);
      if(cand.length < best){ best=cand.length; target=c; bestCand=cand; if(best===0) break; }
    }
    if(!target) return true;             // tutte le caselle del cluster coperte
    if(bestCand!.length===0) return false; // vicolo cieco → backtrack
    // EQUITÀ WEEKEND NEI CRITICI (v0.3.23): sulle celle che PESANO (sabato,
    // festivo, notte prefestiva) i candidati non si esplorano in ordine casuale
    // ma per RESIDUO rispetto alla propria quota. La randomizzazione resta come
    // tie-break (shuf a monte + sort stabile), quindi il multi-tentativo
    // continua a esplorare. Sulle celle di peso 0 nulla cambia: shuf puro.
    let ordine = pesoSlot(target.g, target.f as "M"|"P"|"N") > 0
      ? byWkQuota(shuf(bestCand!,rng))
      : shuf(bestCand!,rng);
    // Costo in weekend liberi (v0.3.25): raffina l'ordine sulle celle che
    // cadono in una coppia sab-dom. Resta un ORDINE di esplorazione, non un
    // filtro: nessun candidato viene escluso, quindi il backtracking conserva
    // la stessa capacità di trovare soluzioni di prima.
    // PROTEZIONE DI CHI HA GIÀ CARICO WEEKEND MANUALE (v0.3.29). Il criterio
    // costoWk metteva PRIMO chi ha la coppia "già spesa" — cioè proprio il
    // medico coi turni weekend inseriti A MANO, i cui weekend non sono
    // riservabili come liberi (misurato: 10/10 run gli davano un altro slot,
    // 3-5/10 oltre la sua quota equa). Ora un candidato con PAVIMENTO manuale
    // (wkPavimento>0) che con questo slot supererebbe la propria quota alta
    // scivola in fondo alla fila: resta candidato (nessun filtro, la
    // copertura non cala), ma si usa solo se nessun altro può. La condizione
    // sul pavimento è essenziale: applicata a TUTTI, la regola riordinava i
    // mesi senza manuali weekend e bruciava coppie libere (wkDef +0.6
    // misurato su set26); così ristretta, quei mesi restano byte per byte
    // identici e cambia solo il caso segnalato.
    if(partnerWk(target.g)!==null){
      const Q = wkQuota();
      const peso = pesoSlot(target.g, target.f as "M"|"P"|"N");
      const sopraQ = peso>0
        ? (id:number) => (wkPavimento(id)>0 && Q[id] && cntWk(id)+peso > Q[id].hi ? 1 : 0)
        : (_id:number) => 0;
      ordine = ordine.slice().sort((a,b)=>
        (sopraQ(a.id)-sopraQ(b.id)) ||
        (costoWk(a.id,target!.g)-costoWk(b.id,target!.g)) || (slackWk(b.id)-slackWk(a.id)));
    }
    // Sforo obiettivo sulla NOTTE (v0.3.26): la notte vale 2 punti, così un
    // medico a obiettivo-1 finirebbe a obiettivo+1. A parità di tutto il resto
    // si prova PRIMA chi non sfora. È solo ordine di esplorazione: chi sforerebbe
    // resta candidato e il backtracking lo userà se necessario, quindi la
    // probabilità di copertura non cala.
    if(target.f==="N")
      ordine = ordine.slice().sort((a,b)=>
        ((cnt(a.id)+2>a.obiettivo?1:0)-(cnt(b.id)+2>b.obiettivo?1:0)));
    for(const m of ordine){
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
  const ok = solve();
  if(stats) stats.tagliato = tagliato;
  return ok;
}

export function faseCritici(ctx: Ctx, seed: number){
  const { giorniArr, ndim, cf, eleggibili, mrMdc, ml, byL, add, haM, haP, haQ, canR, mdcOk, needEff,
          pesoSlot, byWkQuota } = ctx;

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
  // ── DOMANDA CONCORRENTE SULLA NOTTE (v0.3.25) ─────────────────────────────
  // Per M e P il margine "eleggibili − fabbisogno" misura davvero la strettezza
  // della cella: i medici che coprono la mattina del 20 non sono gli stessi che
  // servono per la mattina del 21, e coprire l'una non impedisce di coprire
  // l'altra. Per la NOTTE non è così: è una sola al giorno, prende il medico per
  // l'intera giornata e il riposo post-notte lo toglie anche da g+1 e (di norma)
  // g+2. Le notti dei giorni vicini pescano quindi dallo STESSO pool e si
  // escludono a vicenda: "4 eleggibili per 1 notte" sembra comodo, ma se nella
  // finestra ±2 ci sono 5 notti ancora scoperte quei 4 medici devono bastare
  // per cinque celle che si escludono, e la cella è strettissima.
  //
  // La criticità della notte si misura perciò sulla DOMANDA CONCORRENTE domN =
  // notti ancora scoperte (e colmabili) in [g−2, g+2], non sul fabbisogno 1.
  // La soglia è più severa (≤1 invece di ≤2) perché domN vale fino a 5: con la
  // soglia ≤2 anche un mese comodo (7 eleggibili, 5 notti in finestra ⇒ 2)
  // sarebbe finito tutto dentro un unico cluster, e il tetto ai nodi avrebbe
  // fatto ripiegare sul greedy proprio dove prima il motore era perfetto.
  //
  // La regola storica su elig−need resta in OR: una notte stretta di suo entra
  // nei cluster come sempre. Cambia solo QUALI celle il backtracking vede
  // insieme, mai quali turni sono ammissibili.
  const domN = (g:number) => {
    let n=0;
    for(let k=Math.max(1,g-2); k<=Math.min(ndim,g+2); k++)
      if(needEff(k,"N")>=1 && cf(k,"N")<1) n++;
    return n;
  };
  const critici = celle.filter(c=>c.elig - c.need <= 2 || (c.f==="N" && c.elig - domN(c.g) <= 1));
  if(critici.length===0) return true;

  // 2) raggruppa in CLUSTER (componenti connesse 1D: giorni a distanza ≤2)
  const giorniCritici = [...new Set(critici.map(c=>c.g))].sort((a,b)=>a-b);
  const compDi: Record<number,number> = {};
  let nc = 0;
  for(let i=0;i<giorniCritici.length;i++){
    if(i>0 && giorniCritici[i]-giorniCritici[i-1] <= 2) compDi[giorniCritici[i]] = compDi[giorniCritici[i-1]];
    else compDi[giorniCritici[i]] = nc++;
  }
  // CHIUSURA DELLO SPAN (v0.3.24): i giorni NON critici incastrati fra due
  // giorni critici della stessa componente entrano comunque nel cluster.
  // Senza questo il solver risolveva 25, 27 e 28 senza sapere che anche il 26
  // vuole una notte, e sceglieva liberamente una combinazione che — via
  // riposoEsteso/notteLiberoNotte — la rendeva impossibile: su agosto 2026 la
  // notte del 26 arrivava a faseNotti con ZERO eleggibili nell'82% dei run.
  // Il giorno incastrato non è "critico" per elig-need, ma è comunque una
  // VARIABILE del sottoproblema che il cluster sta risolvendo: escluderlo
  // significa risolvere il cluster sbagliato. Nessuna componente nuova viene
  // creata e la soglia di criticità resta invariata: cambia solo QUALI celle
  // il backtracking vede insieme.
  for(let comp=0; comp<nc; comp++){
    const gg = giorniCritici.filter(g=>compDi[g]===comp);
    for(let g=gg[0]; g<=gg[gg.length-1]; g++) if(compDi[g]===undefined) compDi[g]=comp;
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
      const ord = pesoSlot(c.g, c.f as "M"|"P"|"N") > 0 ? byWkQuota : byL;
      return ord(base.filter(m=>{
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
    if(scaduto()) break;               // DEADLINE: le finestre restanti si saltano
    // Celle della finestra col fabbisogno EFFICACE (needEff è stabile rispetto
    // allo svuotamento: capCell guarda solo manuali/immovibili).
    const cells: {g:number;f:string;need:number}[]=[];
    for(let g=lo;g<=hi;g++) for(const f of FASCE){ const need=needEff(g,f); if(need>0) cells.push({g,f,need}); }
    if(cells.length===0) continue;
    const soliPrima = soliMdc(lo,hi);
    // Svuota i turni AUTOMATICI M/P/N della finestra (manuali, ambulatorio e
    // codici speciali intatti). Liberare i vicini del buco è ciò che dà al
    // solver i gradi di libertà che i riempimenti greedy avevano consumato.
    // Con `viaAmb` si liberano anche le A/Ap AUTOMATICHE della finestra.
    const svuota = (viaAmb:boolean) => {
      for(let g=lo;g<=hi;g++) for(const m of medici){
        const c=gt(m.id,g);
        const resto=c.filter(s=>s.man || !(["M","P","N"].includes(s.tipo) || (viaAmb && isAmbT(s.tipo))));
        if(resto.length!==c.length) st(m.id,g,resto);
      }
    };
    const accetta = () => [...soliMdc(lo,hi)].every(k=>soliPrima.has(k));
    let fatto = false;
    for(let att=0; att<3 && !fatto; att++){
      if(scaduto()) break;
      const m0=mark();
      svuota(false);
      const rng=mkRng(seed + lo*2654435761 + att*7919);
      if(risolviCluster(ctx,cells,rng,limiteNodi) && accetta()){ riparato=fatto=true; break; }
      rollback(m0);   // soluzione incompleta o nuova violazione MDC → finestra intatta
    }
    // ── AMBULATORIO RIASSEGNABILE (v0.3.37) ──────────────────────────────────
    // L'ambulatorio viene deciso per PRIMO e poi congelato: capita che proprio
    // il suo assegnatario sia l'unico medico che chiuderebbe il buco (misurato:
    // settembre con una lunga assenza, giorno 30 interamente scoperto, coperto
    // del tutto spostando la A del 29 a un altro abilitato). Se la finestra
    // resta bucata, si liberano anche le A/Ap AUTOMATICHE della finestra e si
    // prova ogni riassegnazione legale (stesso predicato della fase), con al
    // più 6 risoluzioni complete. È la stessa sonda "ambMove" della diagnosi
    // causale: dove la diagnosi dice "basta riassegnare l'ambulatorio", ora ci
    // prova il motore da solo. Transazionale come sopra.
    if(!fatto && !scaduto()){
      const slotAuto: {g:number; sl:SlotAmb}[] = [];
      for(let g=lo;g<=hi;g++) for(const m of medici) for(const s of gt(m.id,g))
        if(isAmbT(s.tipo) && !s.man) slotAuto.push({ g, sl:{ amb:ambIdDi(s), cod:s.tipo } });
      if(slotAuto.length){
        const m0=mark();
        svuota(true);
        const rng=mkRng(seed + lo*2654435761 + 104729);
        let solves = 0;
        const piazza = (i:number): boolean => {
          if(scaduto() || solves>=6) return false;
          if(i>=slotAuto.length){ solves++; return risolviCluster(ctx,cells,rng,limiteNodi) && accetta(); }
          const { g, sl } = slotAuto[i];
          for(const m of ctx.byL(medici.filter(x=>ambAssegnabile(ctx,x,g,sl)))){
            const m1=mark();
            ctx.add(m.id,g,sl.cod,false,sl.amb);
            if(!ctx.haSlot(m.id,g,sl)){ rollback(m1); continue; }
            if(piazza(i+1)) return true;
            rollback(m1);
          }
          return false;
        };
        if(piazza(0)) riparato=fatto=true;
        else rollback(m0);
      }
    }
  }
  return riparato;
}

// ═══════════════════════════════════════════════════════════════════════════
// ML FINO ALL'OBIETTIVO (v0.3.37)
// ═══════════════════════════════════════════════════════════════════════════
// L'ML può fare SOLO mattine non festive (lun–sab): per arrivare all'obiettivo
// deve avere tutte quelle disponibili. Le fasi gliele danno per prime, ma altri
// passaggi (cluster critici sui sabati, riempimenti per carico) possono
// assegnare prima una mattina a un collega che avrebbe potuto fare altro.
// Qui, a tabellone finito, per ogni ML sotto obiettivo e ogni sua mattina
// possibile: se c'è posto entro il MASSIMO del giorno la si aggiunge; se la
// fascia è piena, un collega gli CEDE la sua mattina automatica (mai un
// manuale, mai un altro ML), purché nessun MDC resti solo. La copertura non
// cambia mai (scambio 1 a 1). Restituisce quante mattine ha dato all'ML.
export function completaML(ctx: Ctx): number {
  const { ml, medici, giorniArr, isSp, gt, st, add, canR, mdcOk, haQ, cf, nmn, cnt, mark, rollback, byL } = ctx;
  let dati = 0;
  for(const m of ml){
    for(const g of giorniArr){
      if(cnt(m.id) >= m.obiettivo) break;
      if(isSp(g) || haQ(m.id,g) || !canR(m,g,"M")) continue;
      if(cf(g,"M") < nmn(g).mx){
        if(!mdcOk(m,g,"M")) continue;
        add(m.id,g,"M");
        if(gt(m.id,g).some(s=>s.tipo==="M"&&!s.man)) dati++;
        continue;
      }
      // Fascia piena: scambio con un collega (il più carico cede per primo).
      const cedenti = byL(medici.filter(x=>x.id!==m.id && x.stato!=="ML" && x.stato!=="MPS"
                          && gt(x.id,g).some(s=>s.tipo==="M"&&!s.man&&!s.sott))).reverse();
      for(const x of cedenti){
        const m0 = mark();
        st(x.id,g, gt(x.id,g).filter(s=>!(s.tipo==="M"&&!s.man&&!s.sott)));
        const mdcSoloDopo = medici.some(d=>d.stato==="MDC" && gt(d.id,g).some(s=>isMatt(s.tipo)) && !mdcOk(d,g,"M"));
        if(!mdcSoloDopo && canR(m,g,"M")){
          add(m.id,g,"M");
          if(gt(m.id,g).some(s=>s.tipo==="M"&&!s.man)){ dati++; break; }
        }
        rollback(m0);
      }
    }
  }
  return dati;
}

// ═══════════════════════════════════════════════════════════════════════════
// MDC SOLO IN AMBULATORIO (v0.3.37)
// ═══════════════════════════════════════════════════════════════════════════
// La fase ambulatorio gira per PRIMA, a tabellone vuoto: non può sapere se
// l'MDC a cui dà una A/Ap avrà un collega nella stessa fascia. Col pomeriggio
// (fascia di norma con un solo medico di reparto) capita che resti solo — il
// fuzz l'ha trovato con il P di reparto scoperto per assenze. Qui, a tabellone
// finito, l'ambulatorio di un MDC rimasto solo passa a un altro abilitato che
// può prenderlo (stesso predicato della fase). Restituisce quante ne sistema.
export function sistemaMdcAmb(ctx: Ctx): number {
  const { medici, giorniArr, gt, st, add, mdcOk, haSlot, mark, rollback, byL } = ctx;
  let fatti = 0;
  for(const m of medici){
    if(m.stato!=="MDC") continue;
    for(const g of giorniArr) for(const s of gt(m.id,g)){
      if(s.man || !isAmbT(s.tipo)) continue;
      const f = s.tipo==="A" ? "M" : "P";
      if(mdcOk(m,g,f)) continue;
      const sl: SlotAmb = { amb: ambIdDi(s), cod: s.tipo };
      const m0 = mark();
      st(m.id,g, gt(m.id,g).filter(x=>x!==s));
      let ok = false;
      // Un altro MDC resterebbe solo allo stesso modo: si cerca fra gli altri.
      for(const x of byL(medici.filter(x=>x.id!==m.id && x.stato!=="MDC" && ambAssegnabile(ctx,x,g,sl)))){
        add(x.id,g,sl.cod,false,sl.amb);
        if(haSlot(x.id,g,sl)){ ok = true; break; }
      }
      if(ok) fatti++; else rollback(m0);
    }
  }
  return fatti;
}

/** Turni AUTOMATICI di un MDC rimasto senza colleghi nella stessa fascia. */
export function mdcSoli(ctx: Ctx): { m: Medico; g: number; f: "M"|"P"|"N" }[] {
  const out: { m: Medico; g: number; f: "M"|"P"|"N" }[] = [];
  for(const m of ctx.medici){
    if(m.stato!=="MDC") continue;
    for(const g of ctx.giorniArr) for(const s of ctx.gt(m.id,g)){
      if(s.man) continue;
      const f = isMatt(s.tipo) ? "M" : isPom(s.tipo) ? "P" : isNot(s.tipo) ? "N" : null;
      if(f && !ctx.mdcOk(m,g,f)) out.push({ m, g, f });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// TAPPABUCHI FINALE (v0.3.37) — copertura PARZIALE dei buchi residui
// ═══════════════════════════════════════════════════════════════════════════
// riparaBuchi lavora per finestre ed è TUTTO-O-NIENTE: se la finestra contiene
// anche una sola cella davvero incopribile (tipicamente: tutti i medici
// disponibili hanno già raggiunto l'obiettivo, o il tetto notti), il solver
// fallisce e la finestra resta com'era — comprese le celle che si potevano
// coprire. Misurato sull'harness: giorni interi vuoti (M, P e N) ai bordi del
// mese dove un ML e un MDC liberi avrebbero coperto le due mattine, o un MR
// libero mattina e pomeriggio.
// Qui si riempie cella per cella ciò che è riempibile con un inserimento
// LEGALE (canR, mdcOk, guardie di add): prima le notti, poi mattine e
// pomeriggi. Vincolo di progetto: il tabellone principale non SPENDE weekend
// liberi — un candidato che per quello slot scenderebbe sotto il proprio
// obiettivo di weekend liberi è escluso (quelle coperture restano materia
// della variante d'ultima chance, che decide l'utente). Il chiamante adotta il
// risultato solo se il punteggio migliora.
export function tappaBuchi(ctx: Ctx): number {
  const { giorniArr, cf, needEff, ml, mrMdc, canR, mdcOk, add, gt, haQ, haM, haP,
          wkPairs, isLibWk, cntWkLiberi, wkTargetMed, byL, byWkQuota, pesoSlot } = ctx;
  const partner = (g:number): number|null => { for(const [s,d] of wkPairs){ if(s===g) return d; if(d===g) return s; } return null; };
  // Assegnare lo slot brucerebbe una coppia sab-dom ancora libera e porterebbe
  // il medico sotto il suo obiettivo di weekend liberi?
  const costaWeekend = (id:number,g:number) => {
    const p = partner(g);
    if(p===null || !isLibWk(id,g) || !isLibWk(id,p)) return false;
    return cntWkLiberi(id) - 1 < wkTargetMed(id);
  };
  const libera = (m:Medico,g:number,f:string) =>
    f==="N" ? !haQ(m.id,g)
    : f==="M" ? !haM(m.id,g) && (!haP(m.id,g) || canR(m,g,"ASS"))
    :           !haP(m.id,g) && (!haM(m.id,g) || canR(m,g,"ASS"));
  let messi = 0;
  for(const f of ["N","M","P"] as const){
    for(const g of giorniArr){
      let guard = 0;
      while(cf(g,f) < needEff(g,f) && guard++ < 4){
        const base = f==="M" ? [...ml,...mrMdc] : mrMdc;
        const pool = base.filter(m=>canR(m,g,f) && mdcOk(m,g,f) && libera(m,g,f) && !costaWeekend(m.id,g));
        // A parità di tutto, prima chi NON supera l'obiettivo (una notte vale 2).
        const sfora = (m:Medico) => ctx.cnt(m.id) + (f==="N" ? 2 : 1) > m.obiettivo ? 1 : 0;
        const ord = (pesoSlot(g,f)>0 ? byWkQuota(pool) : byL(pool)).sort((a,b)=>sfora(a)-sfora(b));
        let ok = false;
        for(const m of ord){
          add(m.id,g,f);
          if(gt(m.id,g).some(s=>s.tipo===f && !s.man)){ ok = true; messi++; break; }
        }
        if(!ok) break;
      }
    }
  }
  return messi;
}

// ═══════════════════════════════════════════════════════════════════════════
// FASE 2 — AMBULATORI nei giorni/fasce configurati (REGOLE.ambulatori, default
// un ambulatorio il martedì mattina), poi CONGELATO.
// Rotazione round-robin: l'indice di partenza è INIETTATO (ENG.AMB_ROT_START)
// e avanzato solo LOCALMENTE. Niente più localStorage nel motore: la
// persistenza dell'indice, calcolata dal SOLO tabellone accettato, è compito
// della UI (vedi calcAmbRotNext in genera.ts). Questo chiude anche il bug di
// equità per cui la rotazione avanzava nei tentativi scartati dal multi-tentativo.
// ═══════════════════════════════════════════════════════════════════════════
// Il medico m può prendere lo slot d'ambulatorio `sl` nel giorno g? Vincoli
// DURI soltanto (l'obiettivo mensile, morbido, lo decide il chiamante). Unica
// fonte per la fase ambulatorio, la riparazione dei buchi e la diagnosi
// causale (v0.3.37): prima erano tre copie che potevano divergere.
export function ambAssegnabile(ctx: Ctx, m: Medico, g: number, sl: SlotAmb): boolean {
  const { gt, abilitatoAmb, escluso, haN, canConsec, canMatt, canPom, canAssDist } = ctx;
  const cod = sl.cod, fascia: "M"|"P" = cod==="A" ? "M" : "P";
  if(m.stato==="MPS") return false;
  if(!abilitatoAmb(m, sl.amb)) return false;              // solo gli abilitati a QUESTO ambulatorio
  if(fascia==="P" && m.stato==="ML") return false;         // l'ML non fa pomeriggi: niente Ap
  if(escluso(m.id,g,fascia)) return false;                // la A è di MATTINA (la blocca Xm), la Ap di POMERIGGIO (Xp)
  if(gt(m.id,g).some(s=>["L","ANA","per11","104"].includes(s.tipo))) return false;
  if(haN(m.id,g)) return false;
  // Regola N: la A (mattina) è vietata a g+1 e g+2 di una notte, la Ap
  // (pomeriggio) segue le regole del P.
  if(fascia==="M" ? !canMatt(m.id,g) : !canPom(m.id,g)) return false;
  if(!canConsec(m.id,g)) return false;
  const tt=gt(m.id,g).filter(s=>!isEscl(s.tipo)&&!["L","ANA","per11","104"].includes(s.tipo));
  if(tt.length===0) return true;
  // Unica eccezione: l'altro slot d'ambulatorio dello STESSO giorno (A+Ap =
  // giornata piena d'ambulatorio), nel rispetto della distanza associati.
  return tt.every(s=>isAmbT(s.tipo)&&s.tipo!==cod) && canAssDist(m.id,g);
}

export function faseAmbulatorio(ctx: Ctx){
  const { giorniArr, ambSlots, haSlot, gt, add, medici, ambilitati, cnt } = ctx;
  const n = ambilitati.length;
  let nextIdx = n>0 ? ((ENG.AMB_ROT_START % n) + n) % n : 0;
  let ok=true;
  // Carico d'ambulatorio del mese: slot A/Ap (mattina e pomeriggio contano
  // ciascuno uno), manuali compresi.
  const cntAmbMese = (id:number) => {
    let k=0; for(const gg of giorniArr) for(const s of gt(id,gg)) if(isAmbT(s.tipo)) k++;
    return k;
  };
  for(const g of giorniArr){
    // FASCE (v0.3.35) e PIÙ AMBULATORI (v0.3.36): ogni slot (ambulatorio,
    // A|Ap) si tratta a sé; uno slot già coperto (manuale o automatico) si
    // salta. Due ambulatori nella stessa fascia vanno per forza a medici
    // diversi: un medico non può avere due A (o due Ap) nello stesso giorno.
    for(const sl of ambSlots(g)){
    const cod = sl.cod;
    if(medici.some(m=>haSlot(m.id,g,sl))) continue;

    const canAmb = (m: Medico, ignoraObiettivo=false) => {
      // Vincolo MORBIDO: superabile nel 2° passaggio, quando l'alternativa
      // sarebbe lasciare l'ambulatorio scoperto.
      if(!ignoraObiettivo && m.obiettivo>0 && cnt(m.id)>=m.obiettivo) return false;
      return ambAssegnabile(ctx, m, g, sl);
    };

    // La A automatica va SOLO agli abilitati: 1° passaggio rispettando
    // l'obiettivo; 2° passaggio IGNORANDO l'obiettivo (vincolo morbido); se
    // nessun abilitato è disponibile per vincoli DURI la fase FALLISCE e
    // l'orchestratore rimescola le notti dei Critici con un seed nuovo.
    // ── ORDINE DEI CANDIDATI: CARICO PRIMA, ROTAZIONE COME SPAREGGIO (v0.3.34) ─
    // Il round-robin puro contava POSIZIONI nella lista, non ambulatori davvero
    // fatti. Due conseguenze, entrambe misurate:
    //   • le A MANUALI non consumano un giro — il `continue` in cima al ciclo
    //     salta il giorno senza avanzare nextIdx — quindi chi ne ha già una
    //     resta in coda alla pari con chi non ne ha nessuna;
    //   • con 4 abilitati, 4 martedì e una A manuale su un abilitato, quello
    //     prendeva SEMPRE 2 ambulatori su 4 e un altro restava a 0, per ogni
    //     valore del cursore di rotazione.
    // Ora la chiave primaria è il CARICO EFFETTIVO del mese (A manuali
    // comprese); la distanza dal cursore è il solo spareggio. Quando i carichi
    // sono pari — il caso tipico del primo giorno del mese, tutti a zero —
    // l'ordine coincide con quello di prima: la rotazione FRA MESI è intatta,
    // dentro il mese vince l'equità.
    const ordine = Array.from({length:n},(_,off)=>(nextIdx+off)%n)
      .sort((a,b)=> (cntAmbMese(ambilitati[a].id)-cntAmbMese(ambilitati[b].id))
                 || (((a-nextIdx+n)%n)-((b-nextIdx+n)%n)));

    let assegnato=false;
    for(const ignoraObiettivo of [false,true]){
      if(assegnato || n===0) break;
      for(const idx of ordine){
        const m=ambilitati[idx];
        if(!canAmb(m,ignoraObiettivo)) continue;
        add(m.id,g,cod,false,sl.amb);
        // Le guardie di add() possono rifiutare in silenzio: verificare SEMPRE
        // che la A sia stata davvero inserita prima di dichiarare successo.
        if(!haSlot(m.id,g,sl)) continue;
        nextIdx=(idx+1)%n;
        assegnato=true; break;
      }
    }
    if(!assegnato) ok=false;
    }
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
  // ── CAPACITÀ DI LIBERI PER WEEKEND (v0.3.26) ──────────────────────────────
  // Ogni weekend va comunque COPERTO: sabato ~2M+1P+1N, domenica ~1M+1P+1N,
  // cioè un numero minimo di medici DEVE lavorarlo. Riservare come "libero" a
  // più medici di quanti il weekend può cederne era la causa reale del deficit
  // (misurata: 81 run su 150 con un weekend riservato poi bruciato da
  // coperturaWeekend): le prenotazioni si accumulavano su weekend che poi non
  // potevano restare liberi. Qui si stima quanti medici il weekend può cedere e
  // si CAPPA il numero di prenotazioni per coppia, così i liberi si posano solo
  // dove è davvero possibile tenerli.
  const capLiberi = (sab:number, dom:number): number => {
    // platea = medici NON già vincolati da turni manuali su quel weekend
    const platea = mrMdc.filter(m=>!isManocc(m,[sab,dom]));
    // lavoratori minimi stimati sul weekend: sabato 3 (M+P assoc, M, N),
    // domenica 2 (M+P, N), con ~1 sovrapposizione ⇒ ~4 distinti.
    const minLav = 4;
    return Math.max(0, platea.length - minLav);
  };
  const cap: Record<string,number>={}; for(const [s,d] of wkPairs) cap[`${s}-${d}`]=capLiberi(s,d);
  let tuttiOk=true;
  for(const m of ordine){
    const tgt = wkTargetMed(m.id);   // obiettivo per-medico (ridotto dai manuali)
    const cand = shuf(wkPairs.filter(p=>!isManocc(m,p)),rng)
                  .sort((a,b)=>((daEvitare(m,a)?1:0)-(daEvitare(m,b)?1:0))
                            || (carico[`${a[0]}-${a[1]}`]-carico[`${b[0]}-${b[1]}`]));
    let n=0;
    for(const [s,d] of cand){
      if(n>=tgt) break;
      const k=`${s}-${d}`;
      if(carico[k]>=cap[k]) continue;   // weekend già saturo di liberi: non riservare qui
      blocco[m.id].add(s); blocco[m.id].add(d);
      carico[k]++; n++;
    }
    if(n<tgt) tuttiOk=false; // impossibile riservare i weekend richiesti a questo medico
  }
  return { blocco, tuttiOk };
}

export function coperturaWeekend(ctx: Ctx, blocco: Blocco){
  const { giorniArr, isWk, isSp, isS, haAss, medici, mrMdc, ml, byWk, add, pesoSlot,
          canR, mdcOk, canAssDist, canAssSett, cf, nmn, npn, haM, haP, haQ, cntWkLiberi, cntWk, wkQuota } = ctx;
  const isBloc = (id:number,g:number) => blocco?.[id]?.has(g) ?? false;
  // EQUITÀ (v0.3.19): i candidati sono ordinati per MINOR carico weekend (byWk)
  // invece che per carico totale, così i turni di weekend si distribuiscono più
  // equamente. Il rispetto dei weekend riservati resta prioritario (pick).
  const poolWk = (g:number,f:string,base:Medico[]) => byWk(base.filter(m=>!haQ(m.id,g)&&canR(m,g,f)&&mdcOk(m,g,f)));
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
        const poolAss = poolWk(g,"M",mrMdc).filter(m=>canR(m,g,"P")&&mdcOk(m,g,"P")&&canAssDist(m.id,g)&&canAssSett(m.id,g));
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
        const poolAss = poolWk(g,"M",mrMdc).filter(m=>canR(m,g,"P")&&mdcOk(m,g,"P")&&canAssDist(m.id,g)&&canAssSett(m.id,g));
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

export function validaWeekend(ctx: Ctx){
  // NB: il controllo dei weekend liberi NON è qui: è nella validazione globale
  // finale (dopo le notti), perché le notti possono occupare weekend liberi.
  const { giorniArr, isWk, cf, ambMancanti, checkRegolaN, needEff } = ctx;
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
    if(ambMancanti(g).length) return false;
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
    if((nodi & 1023)===0 && scaduto()) return false;   // DEADLINE (vedi risolviCluster)
    if(i>=cells.length) return obiettivoOk() && validaWeekend(ctx);
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
  let migliore: { snap: TurniMese; blocco: Blocco; score: number } | null = null;
  for(let att=0; att<ENG.TRIES; att++){
    if(att>0 && scaduto()) break;      // DEADLINE: almeno un tentativo, sempre
    rollback(m0);
    const rng = mkRng(seed + att*7919);
    const { blocco, tuttiOk } = assegnaWkLiberi(ctx, rng, evita);
    if(!tuttiOk && !accettaMigliore) continue;
    coperturaWeekend(ctx, blocco);
    if(validaWeekend(ctx)){
      if(tuttiOk) return { ok:true, blocco };       // soluzione completa → subito
      if(accettaMigliore){                          // copertura ok, ma wk liberi parziali
        const sc = scoreWkLiberi();
        if(!migliore || sc>migliore.score) migliore = { snap:snapshot(), blocco, score:sc };
      }
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
  const { mark, rollback, snapshot, restore, giorniArr, cf, eleggibili, mrMdc, byN, add, isWk, cntWkLiberi, wkTargetMed, needEff, cntWk, cntN, isNotteFest, pesoSlot, wkQuota } = ctx;
  const isBloc = (id:number,g:number) => blocco?.[id]?.has?.(g) ?? false;
  const m0 = mark();
  const nottiCoperte = () => giorniArr.reduce((n,g)=>n+(cf(g,"N")>=1?1:0),0);
  let bestSnap: TurniMese | null = null, bestCop = nottiCoperte();   // best-effort: miglior parziale
  for(let att=0; att<ENG.TRIES; att++){
    if(att>0 && scaduto()) break;      // DEADLINE: almeno un tentativo, sempre
    rollback(m0);
    const rng = mkRng(seed + att*104729);
    const scoperti = giorniArr.filter(g=>cf(g,"N")<1);
    // elegN(g): insieme degli id eleggibili alla notte di g, calcolato on-demand
    // dallo stato CORRENTE (l'eleggibilità cambia man mano che si assegna).
    const elegN = (g:number) => new Set(eleggibili(g,"N",mrMdc).map(m=>m.id));
    const ordin = scoperti.map(g=>({g,e:eleggibili(g,"N",mrMdc).length}))
                          .sort((a,b)=>a.e-b.e || rng()-0.5);
    for(const {g} of ordin){
      if(cf(g,"N")>=1) continue;
      const elig = eleggibili(g,"N",mrMdc);
      const pool = byN(elig);
      // ── VALORE MENO VINCOLANTE (v0.3.22) ────────────────────────────────────
      // La domanda futura di un candidato = in quanti ALTRI giorni-notte ancora
      // scoperti è eleggibile. Assegnare oggi il medico con domanda futura MINIMA
      // (chi serve a pochi altri giorni: sta per andare in Licenza, o è già
      // carico) LIBERA i "specialisti" per i giorni che dipendono solo da loro —
      // è ciò che apre le notti-cruna dell'ultima settimana (26-N in agosto).
      // Ricalcolato ad ogni assegnazione: O(giorni·medici), trascurabile.
      const futDemand = (id:number) => {
        let d=0;
        for(const g2 of scoperti){ if(g2===g || cf(g2,"N")>=1) continue; if(elegN(g2).has(id)) d++; }
        return d;
      };
      // Notti di weekend/prefestive (v0.3.19): 1) rispetta i weekend riservati;
      // 2) EQUITÀ — meno carico weekend prima (la notte pesa 2); 3) valore meno
      // vincolante; 4) a parità, più weekend liberi; 5) meno notti (ordine byN).
      // Notti feriali: prima il valore meno vincolante, poi byN.
      const ch = isNotteFest(g)
        ? pool.slice().sort((a,b)=>
            ((isBloc(a.id,g)?1:0)-(isBloc(b.id,g)?1:0)) ||
            (cntWk(a.id)-cntWk(b.id)) ||
            (futDemand(a.id)-futDemand(b.id)) ||
            (cntWkLiberi(b.id)-cntWkLiberi(a.id)))[0]
        : pool.slice().sort((a,b)=>
            (futDemand(a.id)-futDemand(b.id)) || (cntN(a.id)-cntN(b.id)))[0];
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
// FASE 5A-bis — CATENA DI CONTINUITÀ DELLE MATTINE (v0.3.40, era v0.3.17)
// ═══════════════════════════════════════════════════════════════════════════
// Nei giorni in cui l'ML non fa la mattina (assenze, domeniche, festivi, o
// tutto il mese senza ML) UNA SOLA CATENA di blocchi dà continuità:
//  · il primo blocco parte dall'ULTIMA mattina dell'ML (lo affianca);
//  · ogni blocco dura ~K giorni e il successivo INIZIA nel suo ultimo giorno
//    (passaggio di consegne: uscente ed entrante insieme di mattina);
//  · l'ultimo blocco accompagna la PRIMA mattina dell'ML al rientro.
// Tutto ENTRO IL FABBISOGNO MINIMO dei feriali (2 mattine: ML+catena ai bordi,
// uscente+entrante ai cambi): la catena non aggiunge mattine, decide solo CHI
// occupa slot che la 5B riempirebbe comunque. Preferenza morbida: ogni
// inserimento passa da canR/add; se un anello non si può fare si salta e la
// catena riparte appena possibile. I weekend/festivi non si assegnano qui
// (fase weekend già chiusa): la catena si ADATTA a chi vi fa la mattina.
// Chi entra: chi può reggere più mattine di fila; se il portatore si ferma
// all'improvviso, prima chi ha fatto la mattina o il pomeriggio del giorno
// prima (continuità minima). K=0 → fase disattivata.
export function catenaContinuita(ctx: Ctx){
  const { ndim, ml, mrMdc, isFer, gt, gtB, haQ, canR, mdcOk, cf, nmn, byL, add, BLOCCO_M } = ctx;
  const K = BLOCCO_M;
  if(K<=0 || mrMdc.length===0) return;
  const mlM    = (g:number) => g>=1 && g<=ndim && ml.some(m=>gt(m.id,g).some(s=>s.tipo==="M"));
  const valido = (m:Medico,g:number) => !haQ(m.id,g) && canR(m,g,"M") && mdcOk(m,g,"M");
  const metti  = (m:Medico,g:number) => { add(m.id,g,"M"); return gt(m.id,g).some(s=>s.tipo==="M"); };
  const spazio = (g:number) => nmn(g).mn - cf(g,"M");
  const haMat  = (m:Medico,g:number) => gtB(m.id,g).some(s=>s.tipo==="M");
  const haPom  = (m:Medico,g:number) => gtB(m.id,g).some(s=>s.tipo==="P"||s.tipo==="Ap");
  // Quante mattine feriali di fila (fino a cap) m può reggere da `da`, finché
  // i giorni restano senza ML; i weekend non contano né interrompono.
  const orizzonte = (m:Medico, da:number, cap:number) => {
    let n=0;
    for(let x=da; x<=ndim && n<cap; x++){
      if(mlM(x)) break;
      if(!isFer(x)) continue;
      if(!valido(m,x)) break;
      n++;
    }
    return n;
  };
  // Scelta dell'entrante in g. `rottura`: il portatore si è fermato senza
  // passaggio di consegne → prima la continuità minima (M o P ieri).
  const scegli = (g:number, escludi:Medico|null, rottura:boolean): Medico[] => {
    const cand = byL(mrMdc.filter(m=>(!escludi || m.id!==escludi.id) && valido(m,g)))
      .map(m=>({ m, o: orizzonte(m,g,K), c: haMat(m,g-1)?2:haPom(m,g-1)?1:0 }));
    cand.sort((a,b)=> rottura ? (b.c-a.c) || (b.o-a.o) : (b.o-a.o) || (b.c-a.c));   // byL stabile a parità
    return cand.map(x=>x.m);
  };
  let carrier: Medico|null = null, blocco = 0;
  for(let g=1; g<=ndim; g++){
    if(mlM(g)){
      // Rientro dell'ML: l'ultimo portatore lo affianca (entro il minimo).
      if(carrier && isFer(g) && spazio(g)>=1 && valido(carrier,g)) metti(carrier,g);
      carrier = null; blocco = 0;
      continue;
    }
    const chi = mrMdc.filter(m=>gt(m.id,g).some(s=>s.tipo==="M"));
    if(!isFer(g) || spazio(g)<=0){
      // Weekend/festivo (deciso dalla fase weekend) o minimo già pieno: la
      // catena segue chi c'è, preferendo chi prosegue.
      if(carrier && chi.some(m=>m.id===carrier!.id)) blocco++;
      else { const c2 = chi.find(m=>haMat(m,g-1)) ?? chi[0] ?? null; carrier = c2; blocco = c2 ? 1 : 0; }
      continue;
    }
    if(carrier && chi.some(m=>m.id===carrier!.id)){ blocco++; continue; }   // già di mattina (manuale)
    if(carrier && valido(carrier,g)){
      if(blocco < K-1){ if(metti(carrier,g)){ blocco++; continue; } }
      else {
        // Ultimo giorno del blocco = PASSAGGIO DI CONSEGNE: uscente + entrante.
        if(metti(carrier,g)){
          let preso = false;
          if(spazio(g)>=1) for(const m of scegli(g, carrier, false)) if(orizzonte(m,g,2)>=2 && metti(m,g)){ carrier = m; blocco = 1; preso = true; break; }
          if(!preso) blocco++;               // nessun entrante: l'uscente prosegue (canR decide fin dove)
          continue;
        }
      }
    }
    // Inizio tratto o portatore fermo: nuovo portatore.
    const inizio: boolean = carrier===null;
    let nuovo: Medico|null = null;
    for(const m of scegli(g, carrier, !inizio)) if(metti(m,g)){ nuovo = m; break; }
    if(nuovo){
      blocco = 1;
      // Inizio tratto: il nuovo affianca anche l'ULTIMA mattina dell'ML (ieri).
      if(inizio && mlM(g-1) && isFer(g-1) && spazio(g-1)>=1 && valido(nuovo,g-1) && metti(nuovo,g-1)) blocco = 2;
      carrier = nuovo;
    } else { carrier = null; blocco = 0; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FASE 5 — DIURNI FERIALI (copertura minima)
// ═══════════════════════════════════════════════════════════════════════════
export function faseDiurni(ctx: Ctx, seed: number){
  const { mark, rollback, snapshot, restore, ndim, feriali, ml, mrMdc, byL, add, canR, mdcOk, cf, gt,
          nmn, npn, haM, haP, haN, haQ, cnt, eleggibili, canAssDist, canAssSett, checkRegolaN, needEff } = ctx;
  const m0 = mark();
  const scoreDiurni = () => feriali.reduce((s,g)=>s+Math.min(cf(g,"M"),nmn(g).mn)+Math.min(cf(g,"P"),npn(g).mn),0);
  let bestSnap: TurniMese | null = null, bestSc = scoreDiurni();   // best-effort: miglior parziale

  for(let att=0; att<ENG.TRIES; att++){
    if(att>0 && scaduto()) break;      // DEADLINE: almeno un tentativo, sempre
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

    // 5A-bis — catena di continuità nei tratti senza mattine del ML.
    // Deterministica ma sensibile all'esito (randomizzato) della 5A: viene
    // quindi rieseguita a ogni tentativo, dentro il rollback.
    catenaContinuita(ctx);

    // 5B — completa le mattine residue al minimo (le corsie della catena ne
    // coprono la gran parte; qui restano i buchi dove una corsia era ferma).
    // PRIORITÀ ALLA CONTINUITÀ, in quest'ordine:
    //  1. un medico che ha una M VERA sia a g-1 sia a g+1 → riempiendo g
    //     salda DUE frammenti in un blocco unico (massimo guadagno);
    //  2. un medico con M vera adiacente (g-1 o g+1) → estende il suo blocco;
    //  3. altrimenti il più scarico (byL) — un nuovo anello.
    // Le opzioni 1/2 evitano di introdurre un medico estraneo che creerebbe
    // una mattina orfana, che era la causa principale della frammentazione.
    const haMR = (id:number,g:number) => gt(id,g).some(s=>s.tipo==="M");
    for(const g of feriali){
      let at=0;
      while(cf(g,"M")<nmn(g).mn && at<20){
        at++;
        const base=[...ml,...mrMdc].filter(m=>!haM(m.id,g)&&canR(m,g,"M")&&mdcOk(m,g,"M")&&!haQ(m.id,g));
        if(base.length===0) break;
        const salda  = base.filter(m=>haMR(m.id,g-1)&&haMR(m.id,g+1));
        const estende= base.filter(m=>haMR(m.id,g-1)||haMR(m.id,g+1));
        const scelta = (salda.length?byL(salda):estende.length?byL(estende):byL(base))[0];
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
        const ass = baseP.filter(m=>haM(m.id,g)&&canAssSett(m.id,g)&&canR(m,g,"ASS")&&canAssDist(m.id,g));
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
  const { giorniArr, cf, nmn, npn, mrMdc, cntWkLiberi, ambMancanti, medici, gt, checkRegolaN, wkTargetMed, lavoraGiorno, MAX_CONSEC, trailingPrev, needEff, SPEC } = ctx;
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
    for(const sl of ambMancanti(g))
      probs.push(`${DF[ctx.dw(g)]} ${g}: ${ctx.slotLbl(sl)} mancante`);
  }
  // RETE DI SICUREZZA: una A AUTOMATICA su un medico non abilitato non è mai valida.
  for(const m of medici){
    for(const g of giorniArr)
      if(gt(m.id,g).some(s=>!s.man&&isAmbT(s.tipo)&&!ctx.abilitatoAmb(m,ambIdDi(s))))
        probs.push(`${m.nome.split(" ").pop()}: ambulatorio G${g} a medico non abilitato`);
  }
  // Controllo finale dei weekend liberi (dopo le notti), con obiettivo per-medico.
  for(const m of mrMdc){ const w=cntWkLiberi(m.id), t=wkTargetMed(m.id); if(w<t) probs.push(`${m.nome.split(" ").pop()}: ${w}/${t} wk liberi`); }
  if(!checkRegolaN()) probs.push("Violazione Regola N / distanza associati");
  // MDC (Decreto Calabria) mai solo in turno (v0.3.37): era verificato solo
  // all'inserimento; ora anche sul tabellone finito, per i turni automatici.
  for(const x of mdcSoli(ctx))
    probs.push(`${x.m.nome.split(" ").pop()}: MDC da solo in turno (${x.f==="M"?"mattina":x.f==="P"?"pomeriggio":"notte"}) G${x.g}`);
  // Tetto di giornate piene per settimana (v0.3.37): segnalato solo se nella
  // settimana c'è almeno una giornata piena con un turno AUTOMATICO (quelle
  // tutte manuali sono una scelta dell'utente, come per gli altri controlli).
  {
    const { settDi, inizioSett, assInSett, maxAssSett, pienaReale, gtB, ndim } = ctx;
    for(const m of medici){
      if(m.stato==="MPS") continue;
      for(let w=settDi(1); w<=settDi(ndim); w++){
        const da = inizioSett(1) + 7*(w - settDi(1));   // lunedì della settimana w (anche ≤ 0)
        const n = assInSett(m.id, Math.max(1,da));
        if(n<=maxAssSett) continue;
        let auto=false;
        for(let k=Math.max(1,da); k<da+7 && k<=ndim; k++){ const sh=gtB(m.id,k); if(pienaReale(sh) && sh.some(s=>!s.man&&(isMatt(s.tipo)||isPom(s.tipo)))) auto=true; }
        if(auto) probs.push(`${m.nome.split(" ").pop()}: ${n} giornate piene (M+P) nella settimana del ${Math.max(1,da)} (max ${maxAssSett})`);
      }
    }
  }
  // Controllo MAX giorni consecutivi di lavoro (per ogni medico attivo).
  // TOLLERANZA AI MANUALI: se il superamento esiste già nella sola sequenza
  // dei giorni lavorati MANUALMENTE (runMan), è una scelta dell'utente e non
  // un difetto del generatore → non viene segnalato. Si segnala solo quando
  // la corsa supera il massimo per colpa di (almeno) un turno automatico.
  for(const m of medici){
    // ESENZIONE ML (v0.3.30): l'ML è fuori dal tetto dei consecutivi, come già
    // dall'obiettivo di weekend liberi. Senza questa riga il cancello di canConsec
    // lo lascerebbe passare ma la validazione finale scarterebbe comunque il
    // tentativo, e l'esenzione non avrebbe alcun effetto visibile.
    if(m.stato==="MPS" || m.stato==="ML") continue;
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
