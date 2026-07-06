import type { Medico, Risultato, TurniMese } from "./types";
import { dowOf, isHol } from "./date";
import { cloneT, pulisciT, SPEC } from "./turni";
import { ENG } from "./state";
import { makeCtx } from "./ctx";
import { faseCritici, faseAmbulatorio, faseWeekend, faseNotti, faseDiurni,
         riequilibraWeekendLiberi, riparaBuchi, validazioneGlobale, type Blocco } from "./fasi";

// ═══════════════════════════════════════════════════════════════════════════
// PULSANTE 1 — GENERA COPERTURA MINIMA
// Ordine fasi: Critici → Ambulatorio → Weekend → Notti → Diurni.
// Ogni fase con retry. Se fallisce: backtracking alla fase precedente con un
// seed diverso. Mai accettata una soluzione incompleta senza segnalarlo.
// ═══════════════════════════════════════════════════════════════════════════
export function generaCoperturaMinima(
  anno:number, mese:number, ndim:number, medici:Medico[], ex:TurniMese,
  wkTargetOverride?:number|Record<number,number>|null, relaxN?:boolean,
): Risultato {
  const T = cloneT(ex);
  const ctx = makeCtx(anno, mese, ndim, medici, T, wkTargetOverride, relaxN);
  let blocco: Blocco = null;

  // La fase Weekend può risultare impossibile da soddisfare alla perfezione:
  // dopo alcuni fallimenti SPECIFICI si passa alla modalità di ripiego
  // (accetta il miglior risultato a copertura valida e prosegue).
  const MAX_FALLIMENTI_WK = 4;
  let fallimentiWk = 0;

  // FEEDBACK NOTTI→WEEKEND: unione dei giorni con notte rimasta scoperta nei
  // tentativi precedenti. Al retry la fase Weekend evita (soft) di riservare
  // quei weekend proprio ai medici eleggibili per quelle notti: la causa
  // tipica del fallimento delle Notti è che i pochi candidati alla notte del
  // sabato/domenica hanno tutti quel weekend prenotato come libero.
  const nottiCritiche = new Set<number>();

  const fasi = [
    { nome:"Critici",     run:(seed:number)=>faseCritici(ctx,seed) },
    { nome:"Ambulatorio", run:(_seed:number)=>faseAmbulatorio(ctx) },
    { nome:"Weekend",     run:(seed:number)=>{
        const accettaMigliore = fallimentiWk>=MAX_FALLIMENTI_WK;
        const r=faseWeekend(ctx,seed,accettaMigliore,nottiCritiche);
        blocco=r.blocco;
        if(!r.ok) fallimentiWk++;   // conta i fallimenti della sola fase Weekend
        return r.ok;
      } },
    { nome:"Notti",       run:(seed:number)=>{
        const r=faseNotti(ctx,seed,blocco);
        for(const g of r.nottiScoperte) nottiCritiche.add(g);
        return r.ok;
      } },
    { nome:"Diurni",      run:(seed:number)=>faseDiurni(ctx,seed) },
  ];

  const snaps: number[] = [];          // mark() per fase (undo-log, non più copie)
  const seeds = fasi.map((_,i)=>(i+1)*1000003);
  const MAX_BT = ENG.BT;
  let i=0, backtracks=0;

  // ── BEST-EFFORT ────────────────────────────────────────────────────────────
  // Conserviamo sempre la configurazione col punteggio più alto incontrata
  // (copia PIENA: deve sopravvivere ai rollback dell'undo-log).
  const scoreOf = () => {
    let s=0;
    for(let g=1;g<=ndim;g++){
      let m=0,p=0,n=0;
      for(const med of medici){
        for(const sh of ctx.gt(med.id,g)){
          if(["M","A","AII","A2","1"].includes(sh.tipo)) m++;
          else if(["P","2"].includes(sh.tipo)) p++;
          else if(["N","3"].includes(sh.tipo)) n++;
        }
      }
      s += Math.min(m,ctx.nmn(g).mn)+Math.min(p,ctx.npn(g).mn)+Math.min(n,1);
    }
    return s;
  };
  let bestSnap = ctx.snapshot(), bestScore = scoreOf();
  const considera = () => { const sc=scoreOf(); if(sc>bestScore){ bestScore=sc; bestSnap=ctx.snapshot(); } };

  while(i<fasi.length){
    snaps[i] = ctx.mark();
    const ok = fasi[i].run(seeds[i]);
    considera();                       // registra eventuali miglioramenti parziali
    if(ok){ i++; continue; }
    backtracks++;
    if(backtracks>MAX_BT) break;
    if(i===0){ seeds[0]+=backtracks*97; ctx.rollback(snaps[0]); continue; }
    // Annulla la fase e torna DUE fasi indietro (non una sola): un fallimento può
    // derivare da scelte fatte due fasi prima (es. Notti che fallisce per colpa
    // dell'Ambulatorio). I rollback vanno sempre ALL'INDIETRO nel log → validi.
    const iFail = i;
    i = Math.max(0, i - 2);
    ctx.rollback(snaps[i]);
    // Nuovo seme a TUTTE le fasi da rieseguire, non solo a quella di
    // ripartenza. Prima, un fallimento delle Notti riportava all'Ambulatorio
    // (che il seme lo IGNORA) e rieseguiva Weekend e Notti con gli stessi semi
    // di prima: un loop identico che bruciava i backtrack senza esplorare
    // nulla. Ora ogni retry esplora davvero (e il feedback nottiCritiche
    // cambia comunque l'esito della fase Weekend anche a parità di seme).
    for(let k=i;k<=iFail;k++) seeds[k]+=backtracks*97;
  }

  const completato = i>=fasi.length;
  if(!completato){
    // Modalità di ripiego: si parte dal miglior parziale e si esegue una passata
    // in avanti di tutte le fasi (senza backtracking) così che ciascuna riempia
    // il riempibile; poi si ripristina la configurazione complessivamente migliore.
    ctx.restore(bestSnap);
    for(let k=0;k<fasi.length;k++){ try{ fasi[k].run(seeds[k]+777); }catch(_){} considera(); }
    ctx.restore(bestSnap);
  }

  const problemi = validazioneGlobale(ctx);
  return { turni:pulisciT(T), ok:(completato && problemi.length===0), parziale:!completato, problemi };
}

// ═══════════════════════════════════════════════════════════════════════════
// ULTIMA CHANCE — rete di sicurezza per i mesi difficili (es. estate)
// ═══════════════════════════════════════════════════════════════════════════
export function scoreCopertura(anno:number, mese:number, ndim:number, medici:Medico[], turni:TurniMese){
  // Solo lettura: makeCtx non muta T alla creazione e cf/nmn/npn sono pure →
  // niente più copia difensiva (prima: JSON.parse(JSON.stringify)).
  const c = makeCtx(anno, mese, ndim, medici, turni);
  let s=0;
  for(let g=1; g<=ndim; g++)
    s += Math.min(c.cf(g,"M"),c.nmn(g).mn)
       + Math.min(c.cf(g,"P"),c.npn(g).mn)
       + Math.min(c.cf(g,"N"),1);
  return s;
}
// Deficit complessivo di weekend liberi (Σ max(0, target − effettivi)).
// Usato come spareggio: a parità di copertura, il tabellone che ha "pagato"
// meno weekend è preferibile a prescindere dal conteggio grezzo dei problemi.
export function deficitWeekend(anno:number, mese:number, ndim:number, medici:Medico[], turni:TurniMese){
  const c = makeCtx(anno, mese, ndim, medici, turni);
  let d=0;
  for(const m of c.mrMdc) d += Math.max(0, c.wkTargetMed(m.id)-c.cntWkLiberi(m.id));
  return d;
}
export function scegliMigliore(anno:number, mese:number, ndim:number, medici:Medico[], a:Risultato, b:Risultato){
  if(a.ok !== b.ok) return a.ok ? a : b;                         // un "ok" batte un parziale
  const sa=scoreCopertura(anno,mese,ndim,medici,a.turni);
  const sb=scoreCopertura(anno,mese,ndim,medici,b.turni);
  if(sa !== sb) return sa>sb ? a : b;                            // più copertura
  // A PARITÀ DI COPERTURA: prima il deficit weekend, POI i problemi residui.
  // Prima decideva subito problemi.length: un tabellone aggressivo con un
  // avviso in meno batteva quello normale anche avendo speso più weekend
  // senza coprire nulla in più — proprio il confronto che P1 vuole evitare.
  const wa=deficitWeekend(anno,mese,ndim,medici,a.turni);
  const wb=deficitWeekend(anno,mese,ndim,medici,b.turni);
  if(wa !== wb) return wa<wb ? a : b;                            // meno weekend pagati
  return (a.problemi.length<=b.problemi.length) ? a : b;         // meno problemi residui
}

// ─── FASE DI RIEMPIMENTO D'EMERGENZA (solo ultima chance) ───────────────────
// Ultimo tentativo sui buchi RIMASTI dopo tutte le fasi. Ignora il blocco dei
// weekend liberi ma rispetta i vincoli DURI. Ciò che resta scoperto è
// realmente impossibile.
export function riempimentoEmergenza(anno:number, mese:number, ndim:number, medici:Medico[], turni:TurniMese, relaxN?:boolean){
  const c = makeCtx(anno, mese, ndim, medici, turni, null, relaxN);
  const { giorniArr, isWk, cf, nmn, npn, canR, mdcOk, add, haQ, haM, haP,
          cntWkLiberi, mrMdc, isMar, isH, gt, cnt, canAssDist } = c;
  const cand = (g:number,f:string) => mrMdc.filter(m=>!haQ(m.id,g)&&canR(m,g,f)&&mdcOk(m,g,f));
  // weekend: prima chi ha PIÙ weekend liberi (li può spendere); feriali: prima i meno carichi
  const ordina = (arr:Medico[],g:number) => arr.slice().sort((a,b)=>
    isWk(g) ? ((cntWkLiberi(b.id)-cntWkLiberi(a.id)) || (cnt(a.id)-cnt(b.id)))
            : (cnt(a.id)-cnt(b.id)));
  for(const g of giorniArr){
    let guard: number;
    // AMBULATORIO (martedì feriale) scoperto: assegna un medico d'ambulatorio libero.
    if(isMar(g)&&!isH(g) && !medici.some(m=>gt(m.id,g).some(s=>["A","AII","A2"].includes(s.tipo)))){
      const ambPool = mrMdc.filter(m=>m.ambulatorio && !haQ(m.id,g) && canR(m,g,"M"))
                            .sort((a,b)=>cnt(a.id)-cnt(b.id));
      if(ambPool.length) add(ambPool[0].id,g,"A");
    }
    guard=0; while(cf(g,"N")<1        && guard++<15){ const p=ordina(cand(g,"N"),g); if(!p.length) break; add(p[0].id,g,"N"); }
    // Sui giorni di WEEKEND, se mancano sia M sia P, prova PRIMA il turno
    // ASSOCIATO (M+P allo stesso medico).
    if(isWk(g)){
      guard=0;
      while(cf(g,"M")<nmn(g).mn && cf(g,"P")<npn(g).mn && guard++<5){
        const p = ordina(cand(g,"M").filter(m=>!haM(m.id,g)&&!haP(m.id,g)&&canR(m,g,"P")&&mdcOk(m,g,"P")&&canAssDist(m.id,g)),g);
        if(!p.length) break;
        add(p[0].id,g,"M"); add(p[0].id,g,"P");
        if(!haM(p[0].id,g)) break;   // guardie di add() hanno rifiutato: evita loop sterile
      }
    }
    guard=0; while(cf(g,"M")<nmn(g).mn && guard++<15){ const p=ordina(cand(g,"M"),g); if(!p.length) break; add(p[0].id,g,"M"); }
    guard=0; while(cf(g,"P")<npn(g).mn && guard++<15){ const p=ordina(cand(g,"P"),g); if(!p.length) break; add(p[0].id,g,"P"); }
    // fallback P: chi ha già la M oggi può fare anche il P (associato),
    // ma solo se non viola la distanza minima tra associati.
    if(cf(g,"P")<npn(g).mn){
      const assoc = mrMdc.filter(m=>haM(m.id,g)&&!haP(m.id,g)&&canR(m,g,"P")&&mdcOk(m,g,"P")&&canAssDist(m.id,g));
      const p=ordina(assoc,g); if(p.length) add(p[0].id,g,"P");
    }
  }
  return pulisciT(turni);
}

// Ricalcola i problemi residui dopo l'emergenza; marca come IMPOSSIBILE i buchi rimasti.
export function problemiResidui(anno:number, mese:number, ndim:number, medici:Medico[], turni:TurniMese, relaxN?:boolean){
  const c = makeCtx(anno, mese, ndim, medici, turni, null, relaxN);
  const P: string[] = [];
  for(let g=1; g<=ndim; g++){
    if(c.cf(g,"M")<c.nmn(g).mn) P.push(`G${g}: mattine ${c.cf(g,"M")}/${c.nmn(g).mn} (IMPOSSIBILE)`);
    if(c.cf(g,"P")<c.npn(g).mn) P.push(`G${g}: pomeriggi ${c.cf(g,"P")}/${c.npn(g).mn} (IMPOSSIBILE)`);
    if(c.cf(g,"N")<1)           P.push(`G${g}: notte mancante (IMPOSSIBILE)`);
    if(c.isMar(g)&&!c.isH(g)&&!medici.some(m=>c.gt(m.id,g).some(s=>["A","AII","A2"].includes(s.tipo))))
      P.push(`G${g}: ambulatorio mancante`);
  }
  // Stessa rete di sicurezza della validazione globale.
  for(const m of medici){
    if(m.ambulatorio) continue;
    for(let g=1; g<=ndim; g++)
      if(c.gt(m.id,g).some(s=>!s.man&&["A","AII","A2"].includes(s.tipo)))
        P.push(`${m.nome.split(" ").pop()}: ambulatorio G${g} a medico non abilitato`);
  }
  // Anche l'ultima chance deve dichiarare i weekend liberi mancanti (con
  // l'obiettivo ADATTIVO, non quello ridotto usato per generare).
  for(const m of c.mrMdc){
    const w=c.cntWkLiberi(m.id), t=c.wkTargetMed(m.id);
    if(w<t) P.push(`${m.nome.split(" ").pop()}: ${w}/${t} wk liberi`);
  }
  if(!c.checkRegolaN()) P.push("Violazione Regola N / distanza associati");
  return P;
}
// Conta i soli buchi di COPERTURA (mattine/pomeriggi/notti), esclusi gli avvisi non-copertura.
export function buchiCopertura(problemi: string[]){
  return problemi.filter(p=>p.includes("mattine")||p.includes("pomeriggi")||p.includes("notte")).length;
}

export function generaConUltimaChance(anno:number, mese:number, ndim:number, medici:Medico[], ex:TurniMese, maxMs=2000): Risultato {
  const tFine = Date.now() + maxMs;
  // Dopo l'emergenza (che spende weekend liberi di proposito) si tenta di
  // RECUPERARE l'equità: riequilibrio dei weekend con obiettivo ADATTIVO.
  // NB: qui relaxN resta quello della generazione — su un tabellone generato
  // rilassato la validazione stretta interna a validaWeekend fallirebbe SEMPRE
  // e il recupero non potrebbe mai applicarsi. Il rilassamento è uno strumento
  // di GENERAZIONE; il giudizio finale (sotto) è sempre stretto.
  const recuperaWeekend = (turni:TurniMese, relaxN:boolean) => {
    try{
      const c = makeCtx(anno, mese, ndim, medici, turni, null, relaxN);
      if(c.mrMdc.some(m=>c.cntWkLiberi(m.id)<c.wkTargetMed(m.id))) riequilibraWeekendLiberi(c);
    }catch(_){}
  };
  // Buchi rimasti dopo il riempimento greedy → tentativo col backtracking
  // (riparaBuchi): il greedy giorno-per-giorno può fallire dove una
  // riorganizzazione della finestra riesce.
  const riparaResidui = (turni:TurniMese, relaxN:boolean, seed:number) => {
    try{ riparaBuchi(makeCtx(anno, mese, ndim, medici, turni, null, relaxN), seed, ENG.REBAL_NODES); }catch(_){}
  };

  // 1) Generazione normale: tutto immutato (obiettivo adattivo ≈2, regola N STRETTA).
  const rNorm = generaCoperturaMinima(anno, mese, ndim, medici, ex);
  if(rNorm.ok) return rNorm;                                     // mesi facili: finisce qui

  // TARGET GRADUATO: prima il passo A abbassava l'obiettivo weekend a 1 PER
  // TUTTI — drastico, e pagato anche da medici estranei al problema. Qui si
  // identifica il collo di bottiglia dai buchi WEEKEND del run normale: il
  // target scende a 1 solo per i medici disponibili (non assenti con manuali)
  // in quei giorni, cioè quelli tra cui la copertura e i weekend liberi sono
  // davvero in conflitto. Se il collo non è sui weekend (mappa vuota) si
  // ricade sul vecchio comportamento globale.
  const targetGraduato = (() => {
    try{
      const c = makeCtx(anno, mese, ndim, medici, rNorm.turni);
      const map: Record<number,number> = {};
      for(const g of c.giorniArr){
        if(!c.isWk(g)) continue;
        if(!(["M","P","N"] as const).some(f=>c.cf(g,f)<c.needEff(g,f))) continue;
        for(const m of c.mrMdc)
          if(!c.gt(m.id,g).some(s=>s.man && SPEC.includes(s.tipo))) map[m.id]=1;
      }
      return Object.keys(map).length ? map : null;
    }catch(_){ return null; }
  })();

  // 2) ULTIMA CHANCE — passo A: obiettivo ridotto (graduato o globale=1),
  //    regola N ANCORA STRETTA. MULTI-SEME: il primo giro con SALT=0 replica
  //    il vecchio comportamento deterministico (mai peggio di prima), i
  //    successivi esplorano finché resta budget; si tiene il migliore.
  const saltPrec = ENG.SALT;
  let rUlt!: Risultato;
  try{
    for(let k=0; k<8; k++){
      ENG.SALT = k===0 ? 0 : (Math.imul(0x9E3779B9, k)>>>0);
      const rA = generaCoperturaMinima(anno, mese, ndim, medici, ex, targetGraduato ?? 1, false);
      riempimentoEmergenza(anno, mese, ndim, medici, rA.turni, false);
      riparaResidui(rA.turni, false, 5741+k);
      recuperaWeekend(rA.turni, false);
      rA.problemi = problemiResidui(anno, mese, ndim, medici, rA.turni, false);
      rA.ok = rA.problemi.length===0; rA.parziale = !rA.ok;
      rUlt = (k===0) ? rA : scegliMigliore(anno, mese, ndim, medici, rUlt, rA);
      if(rUlt.ok || buchiCopertura(rUlt.problemi)===0 || Date.now()>=tFine) break;
    }
  }finally{ ENG.SALT = saltPrec; }
  let problemi = rUlt.problemi;

  // 3) Passo B (SOLO SE resta un buco di copertura reale): si rilassa la Regola N
  //    — a g+2 dopo una notte è ammessa anche una Notte — e si riprova da capo.
  //    Si tiene la versione rilassata solo se copre DAVVERO di più.
  if(buchiCopertura(problemi) > 0){
    const rRel = generaCoperturaMinima(anno, mese, ndim, medici, ex, targetGraduato ?? 1, true);
    riempimentoEmergenza(anno, mese, ndim, medici, rRel.turni, true);
    riparaResidui(rRel.turni, true, 7451);
    recuperaWeekend(rRel.turni, true);
    // FIX SEMANTICA "ok" (v0.3.0): i problemi residui del ramo rilassato vengono
    // valutati con la validazione STRETTA (relaxN=false), come il ramo A e come
    // rNorm. Prima si usava problemiResidui(..., true): un tabellone che viola
    // la Regola N stretta (notte→libero→notte) poteva risultare ok:true e
    // vincere scegliMigliore contro un rNorm con un solo avviso di equità —
    // un confronto mele-contro-pere. Il conteggio dei BUCHI (buchiCopertura)
    // non cambia: le voci di copertura non dipendono da relaxN. Cambia il
    // verdetto: un tabellone rilassato adottato porterà con sé la voce
    // "Violazione Regola N", quindi ok:false e l'avviso onesto in UI.
    // relaxN resta SOLO strumento di generazione (generaCoperturaMinima,
    // riempimentoEmergenza, recuperaWeekend qui sopra).
    const problemiRel = problemiResidui(anno, mese, ndim, medici, rRel.turni, false);
    if(buchiCopertura(problemiRel) < buchiCopertura(problemi)){
      rUlt.turni = rRel.turni;
      problemi   = problemiRel;
    }
  }

  rUlt.problemi = problemi;
  rUlt.ok       = problemi.length === 0;
  rUlt.parziale = !rUlt.ok;

  // 4) Tiene il migliore (per copertura); i buchi residui sono realmente impossibili.
  return scegliMigliore(anno, mese, ndim, medici, rNorm, rUlt);
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-TENTATIVO — molti run con sale casuale diverso, si tiene il migliore
// ═══════════════════════════════════════════════════════════════════════════
export function generaMigliorTentativo(anno:number, mese:number, ndim:number, medici:Medico[], ex:TurniMese, maxMs=12000): Risultato {
  // Valuta un tabellone con la validazione STRETTA. Punteggio GERARCHICO:
  // buchi di copertura (1000) > violazioni di regola (500) > deficit weekend
  // liberi (10) > avvisi minori (1). A parità di duro decide il SOFT (equità:
  // varianza notti ×100, carichi ×10, wk liberi ×5, −2 per wk libero extra).
  const misura = (turni:TurniMese) => {
    const c = makeCtx(anno, mese, ndim, medici, turni);
    const probs = validazioneGlobale(c);
    // I buchi si contano sul fabbisogno EFFICACE (needEff): le celle
    // strutturalmente impossibili sono un offset costante fra tutti i
    // candidati e sporcavano solo il confronto — nei giorni difficili il
    // punteggio non distingueva più il tabellone che copre il COPRIBILE.
    // In probs (e quindi in UI) restano dichiarate col fabbisogno pieno.
    let s = 0, buchi = 0, wkDef = 0;
    for(let g=1; g<=ndim; g++){
      if(c.cf(g,"M")<c.needEff(g,"M")) buchi++;
      if(c.cf(g,"P")<c.needEff(g,"P")) buchi++;
      if(c.cf(g,"N")<c.needEff(g,"N")) buchi++;
    }
    for(const m of c.mrMdc) wkDef += Math.max(0, c.wkTargetMed(m.id)-c.cntWkLiberi(m.id));
    s = buchi*1000 + (!c.checkRegolaN()?500:0) + wkDef*10 + probs.length;
    const varOf = (a:number[]) => { if(a.length<2) return 0; const mu=a.reduce((x,y)=>x+y,0)/a.length; return a.reduce((q,v)=>q+(v-mu)*(v-mu),0)/a.length; };
    const notti   = c.mrMdc.map(m2=>c.cntN(m2.id));
    const carichi = c.att.map(m2=>c.cnt(m2.id));
    const wkLib   = c.mrMdc.map(m2=>c.cntWkLiberi(m2.id));
    const wkExtra = c.mrMdc.reduce((q,m2)=>q+Math.max(0,c.cntWkLiberi(m2.id)-c.wkTargetMed(m2.id)),0);
    const soft = varOf(notti)*100 + varOf(carichi)*10 + varOf(wkLib)*5 - wkExtra*2;
    return { s, soft, probs, buchi, wkDef };
  };
  const wrap = (turni:TurniMese, m:{probs:string[]}): Risultato =>
    ({ turni:pulisciT(turni), ok:m.probs.length===0, parziale:m.probs.length>0, problemi:m.probs });

  const BT=ENG.BT, TR=ENG.TRIES, CN=ENG.CLUSTER_NODES, RN=ENG.REBAL_NODES;   // budget originali
  // holder-oggetto (e non due `let`): le assegnazioni avvengono dentro registra()
  // e il control-flow di TS non le vedrebbe, stringendo i tipi a `null`.
  const best: { turni: TurniMese|null; m: ReturnType<typeof misura>|null } = { turni:null, m:null };
  // ── ADOZIONE ASIMMETRICA (P1) ──────────────────────────────────────────
  // I tabelloni AGGRESSIVI (ultima chance: spende weekend liberi di proposito)
  // non competono col punteggio pieno: vengono adottati SOLO se riducono
  // strettamente i buchi colmabili — la ragione per cui esistono. Prima
  // entravano in gara alla pari: a parità di buchi potevano vincere per un
  // wkDef o un soft marginalmente migliori, e nei mesi con celle impossibili
  // NON provate da capCell (impossibilità cumulative/combinatorie → needEff
  // pieno → buchi>0 → l'ultima chance scatta comunque) il tabellone rilasciato
  // era quasi sempre quello aggressivo, senza alcun guadagno di copertura.
  // A parità di buchi l'adozione resta possibile solo se il punteggio duro
  // migliora (es. sana una violazione di Regola N) SENZA pagare in weekend.
  const registra = (turni:TurniMese, soloSeCopreDiPiu=false) => {
    const m = misura(turni);
    const adotta = best.m===null
      || (soloSeCopreDiPiu
            ? (m.buchi < best.m.buchi ||
               (m.buchi === best.m.buchi && m.s < best.m.s && m.wkDef <= best.m.wkDef))
            : (m.s < best.m.s || (m.s === best.m.s && m.soft < best.m.soft)));
    if(adotta){ best.m=m; best.turni=turni; }
    return best.m!.s===0;
  };

  // ── RICERCA A DUE STADI ─────────────────────────────────────────────────
  // STADIO 1 (≈55% del tempo): molti random restart ECONOMICI.
  // STADIO 2 (tempo restante): restart PROFONDI per i mesi difficili.
  const t0 = Date.now();
  let t = 0, perfetto = false, tPerfetto = 0, deep = false, stallo = 0;
  ENG.BT=6; ENG.TRIES=3; ENG.CLUSTER_NODES=8000; ENG.REBAL_NODES=15000;
  const fineStadio1 = t0 + maxMs*0.55;
  // ── OTTIMIZZAZIONE POST-PERFETTO ─────────────────────────────────────────
  // Il primo perfetto non chiude la ricerca: si continua a campionare e
  // registra() tiene il perfetto con il punteggio soft migliore, con limiti:
  //   • al massimo OTTIM_MS dopo il primo perfetto (e mai oltre maxMs);
  //   • stop anticipato se il soft non migliora da STALLO_MAX tentativi.
  const OTTIM_MS   = Math.min(4000, maxMs*0.4);
  const STALLO_MAX = 60;
  while(true){
    const now = Date.now();
    if(now - t0 >= maxMs) break;
    if(perfetto){
      if(now - tPerfetto >= OTTIM_MS) break;
      if(stallo >= STALLO_MAX) break;
    } else if(!deep && now >= fineStadio1){
      // STADIO 2: restart profondi (solo finché non c'è un perfetto)
      ENG.BT=15; ENG.TRIES=8; ENG.CLUSTER_NODES=40000; ENG.REBAL_NODES=80000;
      deep = true;
    }
    ENG.SALT = (((Math.random()*0x100000000)>>>0) ^ Math.imul(++t,2654435761))>>>0;
    let r: Risultato; try{ r = generaCoperturaMinima(anno, mese, ndim, medici, ex); }catch(_){ continue; }
    const softPrima = best.m ? best.m.soft : Infinity;
    const isPerf = registra(r.turni);
    if(isPerf && !perfetto){ perfetto=true; tPerfetto=Date.now(); stallo=0; }
    else if(perfetto){ stallo = (best.m!.soft < softPrima) ? 0 : stallo+1; }
  }

  ENG.BT=BT; ENG.TRIES=TR; ENG.CLUSTER_NODES=CN; ENG.REBAL_NODES=RN; ENG.SALT=0;

  // ── RIPARAZIONE LOCALE (LNS) ────────────────────────────────────────────
  // Prima dell'ultima chance: si prova a RIPARARE il miglior tentativo invece
  // di rigenerare da capo. Svuota una finestra di ±2 giorni attorno a ogni
  // buco colmabile e la risolve con risolviCluster a budget pieno, lasciando
  // intatto tutto il resto del tabellone. Lavora su una copia: si adotta solo
  // se registra() la giudica migliore (i buchi possono solo diminuire, il
  // costo massimo è qualche weekend libero — che il recupero finale sotto e
  // il peso 1000-contro-10 di misura rendono comunque un buon affare). Se la
  // riparazione chiude tutti i buchi, l'ultima chance non scatta nemmeno.
  if(!perfetto && best.m && best.m.buchi>0){
    try{
      const copia = cloneT(best.turni!);
      const c = makeCtx(anno, mese, ndim, medici, copia);
      if(riparaBuchi(c, 424243, ENG.REBAL_NODES)) registra(copia);
    }catch(_){ /* si tiene il best già trovato */ }
  }

  // ── ULTIMA CHANCE, FUORI DAL LOOP — una sola esecuzione, deterministica, e
  // solo se il miglior tentativo ha buchi COLMABILI (misura conta già i buchi
  // sul fabbisogno efficace: le celle strutturalmente impossibili non
  // scatenano più l'ultima chance, che spende weekend liberi di proposito e
  // sui mesi difficili peggiorava solo l'equità senza poter coprire nulla).
  if(!perfetto && best.m && best.m.buchi>0){
    try{
      // budget residuo del multi-tentativo, con un pavimento minimo per non
      // strozzare l'ultima chance quando il loop ha consumato tutto
      const r = generaConUltimaChance(anno, mese, ndim, medici, ex, Math.max(1200, t0 + maxMs - Date.now()));
      // soloSeCopreDiPiu: se i buchi erano in realtà impossibili l'ultima
      // chance non li chiude → non vince, e si rilascia il best "normale".
      registra(r.turni, true);
    }catch(_){ /* si tiene il best già trovato */ }
  }

  // ── RECUPERO WEEKEND FINALE ─────────────────────────────────────────────
  // Weekend liberi mancanti → ultimo riequilibrio col BUDGET NODI PIENO.
  // Gira anche in presenza di buchi (che ora possono essere solo strutturali
  // o realmente incolmabili): prima la condizione buchi===0 lo saltava
  // proprio nei mesi difficili, dove serviva di più. Lavora su una copia:
  // si adotta solo se registra() la giudica migliore.
  if(!perfetto && best.m && best.m.wkDef>0){
    try{
      const copia = cloneT(best.turni!);
      const c = makeCtx(anno, mese, ndim, medici, copia);
      if(riequilibraWeekendLiberi(c)) registra(copia);
    }catch(_){ /* si tiene il best già trovato */ }
  }

  return wrap(best.turni!, best.m!);
}

// ═══════════════════════════════════════════════════════════════════════════
// PULSANTE 2 — COMPLETA OBIETTIVI MENSILI
// ═══════════════════════════════════════════════════════════════════════════
export function completaObiettivi(anno:number, mese:number, ndim:number, medici:Medico[], ex:TurniMese){
  const T = cloneT(ex);
  const ctx = makeCtx(anno, mese, ndim, medici, T);
  const { feriali, ml, mrMdc, byL, add, canR, mdcOk, cf, nmn, npn,
          haM, haP, haN, haQ, cnt, haAss, canAssDist, maxAssSett } = ctx;
  const nSett  = (g:number) => Math.floor((g-1)/7);
  const assInS = (id:number,s:number) => { let n=0; for(let g=1;g<=ndim;g++) if(nSett(g)===s&&haAss(id,g)) n++; return n; };

  // ── M: privilegia sequenze di mattine consecutive ──
  for(const m of byL([...ml,...mrMdc])){
    let progress=true;
    while(cnt(m.id)<m.obiettivo && progress){
      progress=false;
      const cand = feriali.filter(g=>!haQ(m.id,g)&&cf(g,"M")<nmn(g).mx&&canR(m,g,"M")&&mdcOk(m,g,"M"));
      if(cand.length===0) break;
      cand.sort((a,b)=>{
        const ca=(haM(m.id,a-1)||haM(m.id,a+1))?0:1;
        const cb=(haM(m.id,b-1)||haM(m.id,b+1))?0:1;
        return ca-cb || a-b;
      });
      add(m.id,cand[0],"M"); progress=true;
    }
  }

  // ── P: solo nei giorni in cui il medico ha già una M (turno associato) ──
  for(const m of byL(mrMdc)){
    for(const g of feriali){
      if(cnt(m.id)>=m.obiettivo) break;
      if(!haM(m.id,g)) continue;
      if(haP(m.id,g)||haN(m.id,g)) continue;
      if(cf(g,"P")>=npn(g).mx) continue;
      if(assInS(m.id,nSett(g))>=maxAssSett) continue;
      if(!canR(m,g,"ASS")||!mdcOk(m,g,"P")||!canAssDist(m.id,g)) continue;
      add(m.id,g,"P");
    }
  }

  // ── 2ª PASSATA: completa i feriali mancanti fino all'obiettivo mensile ──
  // I P possono essere assegnati anche da soli. Si assegna ai medici ancora
  // sotto obiettivo (i più "scoperti" per primi) privilegiando i giorni sotto
  // il minimo giornaliero.
  const sottoMin = (g:number,f:string) => f==="M" ? cf(g,"M")<nmn(g).mn : cf(g,"P")<npn(g).mn;
  let prog2 = true, guard = 0;
  while(prog2 && guard++ < 1000){
    prog2 = false;
    const pool = [...ml, ...mrMdc]
      .filter(m=>cnt(m.id)<m.obiettivo)
      .sort((a,b)=>(b.obiettivo-cnt(b.id))-(a.obiettivo-cnt(a.id)));
    for(const m of pool){
      if(cnt(m.id)>=m.obiettivo) continue;

      // 1) Mattina su un feriale libero, entro il massimo giornaliero.
      const candM = feriali.filter(g=>!haQ(m.id,g)&&cf(g,"M")<nmn(g).mx&&canR(m,g,"M")&&mdcOk(m,g,"M"));
      if(candM.length){
        candM.sort((a,b)=>((sottoMin(a,"M")?0:1)-(sottoMin(b,"M")?0:1)) || a-b);
        add(m.id,candM[0],"M"); prog2=true; continue;
      }

      // 2) Pomeriggio: associato (se quel giorno ha già la M) oppure da solo.
      if(m.stato!=="ML"){
        const candP = feriali.filter(g=>{
          if(haP(m.id,g)||haN(m.id,g)) return false;
          if(cf(g,"P")>=npn(g).mx) return false;
          if(!mdcOk(m,g,"P")) return false;
          if(haM(m.id,g)) return canR(m,g,"ASS") && assInS(m.id,nSett(g))<maxAssSett; // associato
          return canR(m,g,"P");                                                      // singolo
        });
        if(candP.length){
          candP.sort((a,b)=>((sottoMin(a,"P")?0:1)-(sottoMin(b,"P")?0:1)) || a-b);
          add(m.id,candP[0],"P"); prog2=true; continue;
        }
      }
    }
  }

  return { turni: pulisciT(T) };
}

// ═══════════════════════════════════════════════════════════════════════════
// ROTAZIONE AMBULATORIO — indice successivo derivato dal tabellone ACCETTATO
// La UI lo chiama sul risultato adottato e persiste il valore: la rotazione
// avanza SOLO in base a ciò che è stato davvero pubblicato, non ai tentativi
// scartati. Semantica: l'ultimo martedì feriale con una A automatica determina
// il prossimo punto di partenza (indice dell'assegnatario + 1). Nessuna A
// automatica nel mese → l'indice resta quello di partenza.
// ═══════════════════════════════════════════════════════════════════════════
export function calcAmbRotNext(turni:TurniMese, medici:Medico[], anno:number, mese:number, ndim:number, start:number){
  const ab = medici.filter(m=>m.ambulatorio);
  if(ab.length===0) return start;
  let next = ((start % ab.length) + ab.length) % ab.length;
  for(let g=1; g<=ndim; g++){
    if(dowOf(anno,mese,g)!==1 || isHol(anno,mese,g)) continue;   // solo martedì feriali
    for(let i=0;i<ab.length;i++){
      if((turni[ab[i].id]?.[g]?.t||[]).some(s=>s.tipo==="A" && !s.man)){ next=(i+1)%ab.length; break; }
    }
  }
  return next;
}
