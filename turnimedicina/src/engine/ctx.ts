import type { Medico, Turno, TurniMese } from "./types";
import { dowOf, isSabN, isDomN, isFestivo } from "./date";
import { isMatt, isPom, isNot, vt, SPEC, cloneT } from "./turni";
import { getRegole } from "./regole";
import { pesoWeekend } from "./bilancio";
import { ENG } from "./state";

// ─── CONTEXT FACTORY: helper condivisi tra i due generatori ───────────────────
//
// PERFORMANCE (v0.3.0) — due cambi strutturali, semantica invariata:
//
// 1) CONTATORI INCREMENTALI. cnt(id)/cntN(id) erano O(31·turni) e venivano
//    chiamati dentro ogni sort byL/byN: costo dominante insieme agli snapshot.
//    Ora ogni mutazione passa dall'unico scrittore st(), che aggiorna due mappe
//    per-medico (carico pesato e notti). cnt/cntN diventano O(1).
//
// 2) SNAPSHOT A UNDO-LOG. snapshot/restore con JSON.parse(JSON.stringify)
//    dentro i loop di retry era l'altra voce di costo dominante. Ora:
//      • mark()          → segnalibro O(1) (posizione nel log delle mutazioni)
//      • rollback(mark)  → disfa SOLO le celle toccate dopo il mark
//      • snapshot()      → copia piena VELOCE (cloneT), usata di rado: solo per
//                          conservare un "best" fuori dal filo delle mutazioni
//      • restore(snap)   → riallinea T allo snapshot APPLICANDO UN DIFF via
//                          st(): resta un'operazione registrata nel log, quindi
//                          i mark precedenti restano validi e i contatori
//                          restano coerenti.
//    I pattern non-LIFO del motore (bestSnap ripristinati "in avanti" a fine
//    fase) usano snapshot()/restore(); i ripristini "all'indietro" dei loop di
//    retry usano mark()/rollback(), che è la stragrande maggioranza dei casi.
//
// INVARIANTE: gli array `t` delle celle sono immutabili — st() sostituisce
// sempre l'intero array. L'undo-log può quindi salvare il riferimento al
// vecchio array senza copiarlo.

export type Ctx = ReturnType<typeof makeCtx>;

export function makeCtx(
  anno: number, mese: number, ndim: number, medici: Medico[], T: TurniMese,
  // `wkTargetOverride`: numero → obiettivo GLOBALE (come prima, usato dal
  // vecchio passo A dell'ultima chance); mappa id→n → obiettivo ridotto SOLO
  // per quei medici (ultima chance GRADUATA), gli altri restano all'adattivo.
  wkTargetOverride?: number | Record<number,number> | null, relaxN?: boolean,
){
  const REG = getRegole();

  // ── REGOLA CONFIGURABILE notte→libero→notte (v0.3.11) ──────────────────────
  // Con REG.notteLiberoNotte attiva, la semantica di relaxN (a g+2 dopo una
  // notte è ammessa anche una Notte) diventa la regola NORMALE del reparto:
  // vale per la generazione di base, per add(), per checkRegolaN e per la
  // validazione (un N-libero-N non è più una violazione). Il parametro
  // relaxN dell'ultima chance resta un'eccezione locale come prima; qui si
  // calcola l'OR una sola volta, prima che le closure lo catturino.
  // RIPOSO ESTESO (v0.3.16): g+2 dopo una notte completamente libero (solo
  // SPEC). Regola più stringente di tutte: quando attiva NEUTRALIZZA sia
  // notteLiberoNotte sia il relaxN dell'ultima chance (vincolo duro).
  const strictN2 = REG.riposoEsteso === true;
  relaxN = (!!relaxN || REG.notteLiberoNotte === true) && !strictN2;

  // ── contatori incrementali per-medico ──────────────────────────────────────
  const cellVal = (a: Turno[]) => { let v=0; for(const s of a) v+=vt(s.tipo,!!s.sott); return v; };
  // Notti ai fini del TETTO maxNotti e dell'equità (byN, varianza soft): una
  // notte affatica il medico ovunque sia fatta → contano N e 3, COMPRESE le
  // varianti sottolineate (v0.3.11; prima i sottolineati erano esclusi). Il
  // peso nel carico/bilancio resta invariato (vt: sottolineato = 0).
  const cellNot = (a: Turno[]) => { let v=0; for(const s of a) if(isNot(s.tipo)) v++; return v; };
  // CARICO WEEKEND (v0.3.19) — usa la metrica UNICA pesoWeekend (vedi bilancio),
  // così il contatore riassuntivo e l'equità soft byWk restano SEMPRE identici.
  // Include sabato (mattina esclusa), domenica/festivi, e la notte PREFESTIVA.
  const cellWkVal = (g: number, a: Turno[]) => pesoWeekend(anno, mese, ndim, g, a);
  const cntMap  = new Map<number, number>();
  const cntNMap = new Map<number, number>();
  const cntWkMap= new Map<number, number>();
  // Contatori di FABBISOGNO per giorno (solo turni reali M/P/N, solo medici
  // della lista — stessa semantica della vecchia cf, che iterava `medici`).
  const inMedici = new Set(medici.map(m=>m.id));
  const cfM = new Array<number>(ndim+3).fill(0);
  const cfP = new Array<number>(ndim+3).fill(0);
  const cfN = new Array<number>(ndim+3).fill(0);
  const cellMPN = (a: Turno[]) => { let m=0,p=0,n=0; for(const s of a){ if(s.tipo==="M")m++; else if(s.tipo==="P")p++; else if(s.tipo==="N")n++; } return [m,p,n] as const; };
  for(const idS in T){
    const id=+idS; const gi=T[idS]; if(!gi) continue;
    let v=0,n=0,wk=0;
    for(const gS in gi){
      const g=+gS; if(g<1||g>ndim) continue;   // come i vecchi cnt/cntN: solo 1..ndim
      const c=gi[gS]?.t; if(!c) continue;
      v+=cellVal(c); n+=cellNot(c); wk+=cellWkVal(g,c);
      if(inMedici.has(id)){ const [dm,dp,dn]=cellMPN(c); cfM[g]+=dm; cfP[g]+=dp; cfN[g]+=dn; }
    }
    cntMap.set(id,v); cntNMap.set(id,n); cntWkMap.set(id,wk);
  }
  const aggCf = (id:number,g:number,a:Turno[],segno:1|-1) => {
    if(!inMedici.has(id) || g<1 || g>ndim) return;
    const [dm,dp,dn]=cellMPN(a);
    cfM[g]+=segno*dm; cfP[g]+=segno*dp; cfN[g]+=segno*dn;
  };

  // ── undo-log delle mutazioni ────────────────────────────────────────────────
  type Undo = { id:number; g:number; prev: Turno[] | undefined };
  const log: Undo[] = [];

  const gt = (id:number,g:number): Turno[] => T[id]?.[g]?.t||[];
  const st = (id:number,g:number,a:Turno[]) => {
    const prev = T[id]?.[g]?.t;
    log.push({ id, g, prev });
    cntMap.set(id,(cntMap.get(id)||0) + cellVal(a) - (prev?cellVal(prev):0));
    cntNMap.set(id,(cntNMap.get(id)||0) + cellNot(a) - (prev?cellNot(prev):0));
    cntWkMap.set(id,(cntWkMap.get(id)||0) + cellWkVal(g,a) - (prev?cellWkVal(g,prev):0));
    if(prev) aggCf(id,g,prev,-1);
    aggCf(id,g,a,1);
    if(!T[id])T[id]={};
    T[id][g]={t:a};
  };

  const mark = () => log.length;
  const rollback = (m:number) => {
    while(log.length>m){
      const e=log.pop()!;
      const cur = T[e.id]?.[e.g]?.t;
      cntMap.set(e.id,(cntMap.get(e.id)||0) + (e.prev?cellVal(e.prev):0) - (cur?cellVal(cur):0));
      cntNMap.set(e.id,(cntNMap.get(e.id)||0) + (e.prev?cellNot(e.prev):0) - (cur?cellNot(cur):0));
      cntWkMap.set(e.id,(cntWkMap.get(e.id)||0) + (e.prev?cellWkVal(e.g,e.prev):0) - (cur?cellWkVal(e.g,cur):0));
      if(cur) aggCf(e.id,e.g,cur,-1);
      if(e.prev) aggCf(e.id,e.g,e.prev,1);
      if(e.prev===undefined){ if(T[e.id]) delete T[e.id][e.g]; }
      else T[e.id][e.g]={t:e.prev};
    }
  };

  const snapshot = () => cloneT(T);
  const eqCell = (a?:Turno[], b?:Turno[]) => {
    const x=a||[], y=b||[];
    if(x===y) return true;
    if(x.length!==y.length) return false;
    for(let i=0;i<x.length;i++){
      if(x[i].tipo!==y[i].tipo || !!x[i].sott!==!!y[i].sott || !!x[i].man!==!!y[i].man) return false;
    }
    return true;
  };
  const restore = (snap: TurniMese) => {
    // Diff-apply: ogni cella diversa viene riscritta via st() (quindi registrata
    // nel log e contabilizzata). I mark presi prima restano validi.
    const ids = new Set([...Object.keys(T), ...Object.keys(snap)]);
    for(const idS of ids){
      const id=+idS;
      const gs = new Set([...Object.keys(T[idS]||{}), ...Object.keys(snap[idS]||{})]);
      for(const gS of gs){
        const g=+gS;
        const cur = T[idS]?.[gS]?.t;
        const tgt = snap[idS]?.[gS]?.t;
        if(!eqCell(cur,tgt)) st(id,g, tgt ? tgt : []);
      }
    }
  };

  const add = (id:number,g:number,tipo:string,man=false) => {
    const c=gt(id,g);
    if(c.some(s=>s.tipo===tipo)) return;
    // GUARDIE DI SICUREZZA (solo inserimenti AUTOMATICI; i manuali sono inviolabili).
    // Garantiscono che NESSUNA fase — base, ultima chance o emergenza — possa
    // produrre un tabellone che viola i vincoli duri.
    if(!man){
      // 1) Distanza associati: non creare una GIORNATA PIENA (mattina+pomeriggio,
      //    inclusi i codici PS 1/2) troppo vicina a un'altra. Copre anche il caso
      //    di una P automatica aggiunta a un "1" manuale (→ 1+P) e viceversa.
      const nc=[...c,{tipo}];
      const assocPrima = c.some(s=>isMatt(s.tipo)) && c.some(s=>isPom(s.tipo));
      const assocDopo  = nc.some(s=>isMatt(s.tipo)) && nc.some(s=>isPom(s.tipo));
      if(assocDopo && !assocPrima && !canAssDist(id,g)) return;
      // 2) Riposo post-notte (Regola N): non aggiungere turni che rompono una notte adiacente.
      if(!SPEC.includes(tipo)){
        if(postN1(id,g)) return;                                 // g+1 di una notte: deve restare libero
        if(postN2(id,g) && violaG2(tipo)) return;                // g+2 di una notte: solo P (o N se relaxN; NULLA col riposo esteso)
        if(isNot(tipo) && !canNConsec(id,g)) return;             // max notti di fila (catena a passo 2): mai oltre il tetto in automatico
        // 3) MAX GIORNI CONSECUTIVI DI LAVORO: se questo turno rende "lavorato" un
        //    giorno finora libero e la sequenza risultante di giorni lavorati
        //    supererebbe MAX_CONSEC, non lo si aggiunge.
        const giaLavora = c.some(s=>!SPEC.includes(s.tipo));
        if(!giaLavora && runConsec(id,g) > MAX_CONSEC) return;
      }
    }
    st(id,g,[...c,{tipo,sott:false,man}]);
  };

  const haX = (id:number,g:number) => gt(id,g).some(s=>s.tipo==="X");
  const haM = (id:number,g:number) => gt(id,g).some(s=>isMatt(s.tipo));
  const haP = (id:number,g:number) => gt(id,g).some(s=>isPom(s.tipo));
  const haN = (id:number,g:number) => gt(id,g).some(s=>isNot(s.tipo));
  const haQ = (id:number,g:number) => gt(id,g).some(s=>s.tipo!=="X");
  // O(1): letti dai contatori incrementali (prima O(31·turni) dentro ogni sort).
  const cnt = (id:number) => cntMap.get(id) || 0;
  const cntN= (id:number) => cntNMap.get(id) || 0;
  const cntWk= (id:number) => cntWkMap.get(id) || 0;

  const dw   = (g:number) => dowOf(anno,mese,g);
  const isS  = (g:number) => isSabN(dw(g));
  const isD  = (g:number) => isDomN(dw(g));
  const isH  = (g:number) => isFestivo(anno,mese,g);
  const isSp = (g:number) => isD(g)||isH(g);
  const isWk = (g:number) => dw(g)>=5||isH(g);
  // Notte "festiva" ai fini dell'equità weekend: sabato/domenica/festivo, oppure
  // la notte PREFESTIVA (il giorno dopo è domenica o festivo infrasettimanale).
  const isNotteFest = (g:number) => isWk(g) || (g+1<=ndim && isSp(g+1));
  const isFer= (g:number) => !isWk(g);
  // Giorni di ambulatorio dal pannello Regole (era il martedì hardcoded).
  const AMB_DW = new Set(REG.giorniAmb ?? [1]);
  const isAmb= (g:number) => AMB_DW.has(dw(g));

  // Fabbisogni giornalieri dal pannello Regole.
  const FB  = REG.fabb;
  const nmn = (g:number) => isSp(g)?{mn:FB.fest.mMin,mx:FB.fest.mMax}:isS(g)?{mn:FB.sab.mMin,mx:FB.sab.mMax}:{mn:FB.fer.mMin,mx:FB.fer.mMax};
  const npn = (g:number) => isSp(g)?{mn:FB.fest.pMin,mx:FB.fest.pMax}:isS(g)?{mn:FB.sab.pMin,mx:FB.sab.pMax}:{mn:FB.fer.pMin,mx:FB.fer.pMax};

  // ── CONTINUITÀ COL MESE PRECEDENTE ─────────────────────────────────────────
  // gtB estende gt ai giorni g ≤ 0 mappandoli sulla coda del mese M-1 letta da
  // ENG.PREV (g=0 → ultimo giorno di M-1, g=-1 → penultimo, ...). Finestra di
  // lettura TAIL giorni: 7 = MAX_CONSEC massimo ragionevole, copre anche le
  // finestre più corte di Regola N (2) e associati (2). Oltre la finestra (o
  // senza mese precedente salvato) si assume riposo, come prima.
  const prev = ENG.PREV;
  const TAIL = 7;
  const gtB  = (id:number,g:number): Turno[] => {
    if(g>=1) return gt(id,g);
    if(!prev || g < 1-TAIL) return [];
    const pg = prev.ndim + g;
    if(pg < 1) return [];
    return prev.T[id]?.[pg]?.t || [];
  };
  const haNB   = (id:number,g:number) => gtB(id,g).some(s=>isNot(s.tipo));
  // GIORNATA PIENA ai fini della DISTANZA associati: mattina+pomeriggio INCLUSI
  // i codici PS 1/2 (v0.3.2). 1+P, M+2 e 1+2 non coprono il reparto e non
  // contano nel fabbisogno né nella quota maxAssSett, ma per il medico sono
  // comunque una giornata intera di lavoro (in PS anziché in reparto): vanno
  // quindi distanziati come un M+P reale. haAssB è usata SOLO da canAssDist e
  // dal ramo distanza di checkRegolaN; l'associato "reale" resta haAss.
  const haAssB = (id:number,g:number) => { const sh=gtB(id,g); return sh.some(s=>isMatt(s.tipo))&&sh.some(s=>isPom(s.tipo)); };

  // Fabbisogno giornaliero: si contano SOLO i turni M, P, N — comprese le loro
  // varianti sottolineate, che condividono lo stesso `tipo`. Sono ESCLUSI tutti
  // gli altri codici (1, 2, 3, A, ANA, per11, 104, L, X, ...).
  // I turni M/P/N dei medici MPS CONTANO nel fabbisogno: un turno reale copre
  // il reparto indipendentemente dallo stato di chi lo fa.
  // O(1): letto dai contatori per-giorno aggiornati in st/rollback (prima era
  // O(medici·turni) e veniva chiamato in tutti i loop di riempimento e score).
  const cf = (g:number,f:string) => {
    if(g<1||g>ndim) return 0;
    return f==="M" ? cfM[g] : f==="P" ? cfP[g] : f==="N" ? cfN[g] : 0;
  };

  // ── REGOLA N ──────────────────────────────────────────────
  const CODICI_ANTE_N = ["ANA","L","per11","X","104"];
  const hasAnteN = (id:number,g:number) => { if(g>=ndim) return false; return gt(id,g+1).some(s=>CODICI_ANTE_N.includes(s.tipo)); };
  // CONTINUITÀ: g-1 e g-2 possono cadere nel mese precedente (g=1,2).
  const postN1 = (id:number,g:number) => haNB(id,g-1);   // g è il giorno DOPO una notte (=g+1)
  const postN2 = (id:number,g:number) => haNB(id,g-2);   // g è due giorni DOPO una notte (=g+2)
  // hasAnteN (ANA/L/per11/X/104 in g+1) vincola SOLO la Notte (vedi canN).
  const canLav = (id:number,g:number) => !postN1(id,g);
  // Un turno non-SPEC di questo tipo viola il g+2 di una notte?
  // Storico: M sempre, N salvo relaxN, P mai. Riposo esteso: qualsiasi cosa.
  const violaG2 = (tipo:string) => strictN2 || isMatt(tipo) || (!relaxN&&isNot(tipo));
  const canMatt= (id:number,g:number) => canLav(id,g) && !postN2(id,g);          // M vietata a g+1 e g+2 di una notte
  const canPom = (id:number,g:number) => !postN1(id,g) && !(strictN2&&postN2(id,g)); // P vietata a g+1 (e a g+2 col riposo esteso)
  const canAss = (id:number,g:number) => canMatt(id,g) && canPom(id,g);          // associato: vietato g+1 e g+2

  // ── MAX NOTTI "DI FILA" (a passo 2) ─────────────────────────────────────────
  // Una CATENA di notti = notti distanziate di 2 giorni, cioè con un solo giorno
  // libero in mezzo (N, libero, N, libero, N…). È la spaziatura più fitta
  // possibile: la Regola N tiene sempre libero il giorno DOPO la notte, e solo il
  // relaxN (ultima chance, oppure regola notteLiberoNotte attiva) ammette la N
  // successiva già a g+2 (in modalità stretta le notti stanno ad almeno 3 giorni). Due notti a 3+ giorni (≥2 liberi
  // in mezzo) NON fanno catena: è una pausa vera. Tetto configurabile dal pannello
  // Regole; 0 non ha senso (vieterebbe ogni notte) → minimo effettivo 1.
  const MAX_NOTTI_CONSEC = Math.max(1, REG.maxNottiConsec);
  // Lunghezza della catena a passo 2 che passerebbe per g SE g fosse una notte.
  // Guarda a ritroso (g-2,g-4,…, anche nella coda del mese precedente via haNB) e
  // in avanti (g+2,g+4,…): il motore non mette sempre le notti in ordine.
  const catenaNotti = (id:number,g:number) => {
    let n = 1;
    for(let k=g-2; k>=1-TAIL && haNB(id,k); k-=2) n++;
    for(let k=g+2; k<=ndim   && haN(id,k);  k+=2) n++;
    return n;
  };
  const canNConsec = (id:number,g:number) => catenaNotti(id,g) <= MAX_NOTTI_CONSEC;

  const canN   = (id:number,g:number) => {
    // Tetto notti di fila: non superare MAX_NOTTI_CONSEC notti nella stessa catena
    // a passo 2 (vale sia in normale sia in relaxN, dove le catene fitte nascono).
    if(!canNConsec(id,g)) return false;
    // relaxN (ultima chance, o regola notteLiberoNotte): g+2 dopo una notte può essere anche
    // una Notte, non solo un Pomeriggio. Resta fermo il vincolo g+1 libero e M vietata a g+2.
    if(postN1(id,g)||(!relaxN&&postN2(id,g))) return false;
    if(hasAnteN(id,g)) return false;                               // ANA/L/per11/X/104 in g+1 bloccano la Notte in g
    if(g+1<=ndim){ const sh1=gt(id,g+1); if(sh1.some(s=>!SPEC.includes(s.tipo))) return false; }      // g+1 libero
    if(g+2<=ndim){ const sh2=gt(id,g+2); if(sh2.some(s=>!SPEC.includes(s.tipo)&&violaG2(s.tipo))) return false; } // g+2 max P (o N se relaxN; NULLA col riposo esteso)
    return true;
  };

  // ── TURNI ASSOCIATI: distanza minima 2 giorni completi ─────
  const haAss = (id:number,g:number) => { if(g<1||g>ndim) return false; const sh=gt(id,g); return sh.some(s=>isMatt(s.tipo)&&s.tipo!=="1")&&sh.some(s=>isPom(s.tipo)&&s.tipo!=="2"); };
  // CONTINUITÀ: per g=1,2 la finestra g-2..g+2 legge anche la coda di M-1.
  const canAssDist = (id:number,g:number) => { for(let k=g-2;k<=Math.min(ndim,g+2);k++){ if(k===g) continue; if(haAssB(id,k)) return false; } return true; };

  const MAX_NOTTI = REG.maxNotti;
  const maxAssSett = REG.maxAssSett;

  // ── MAX GIORNI CONSECUTIVI DI LAVORO ──────────────────────────────────────
  const MAX_CONSEC = REG.maxConsec;
  // Catena di continuità mattine: lunghezza-obiettivo dei blocchi. Cappata a
  // MAX_CONSEC (un blocco più lungo del massimo di giorni lavorabili di fila
  // sarebbe comunque irrealizzabile). 0 = catena disattivata.
  const BLOCCO_M = Math.max(0, Math.min(REG.blocchiMattina ?? 0, MAX_CONSEC));
  const lavoraGiorno = (id:number,g:number) => g<=ndim && gtB(id,g).some(s=>!SPEC.includes(s.tipo));
  const runConsec = (id:number,g:number) => {
    let n=1;
    for(let k=g-1;k>=1-TAIL && lavoraGiorno(id,k);k--) n++;
    for(let k=g+1;k<=ndim   && lavoraGiorno(id,k);k++) n++;
    return n;
  };
  // Giorni consecutivi lavorati alla FINE del mese precedente.
  const trailingPrev = (id:number) => { let n=0; for(let k=0;k>=1-TAIL && lavoraGiorno(id,k);k--) n++; return n; };
  const canConsec = (id:number,g:number) => lavoraGiorno(id,g) || runConsec(id,g) <= MAX_CONSEC;

  // ── CAPACITÀ STATICA DI CELLA / FABBISOGNO EFFICACE ────────────────────────
  // capCell(g,f): quanti medici possono coprire la cella sotto i SOLI vincoli
  // IMMOVIBILI (stato, X, assenze manuali, notte manuale nello stesso giorno,
  // notti immovibili adiacenti — manuali o del mese precedente). Se cap è
  // sotto il fabbisogno minimo la cella è STRUTTURALMENTE impossibile: nessun
  // seed potrà mai coprirla. needEff = min(fabbisogno, cap) è il criterio di
  // SUCCESSO delle fasi: una cella impossibile non deve far fallire la fase
  // (e con essa il blocco weekend, le notti, ecc.) — resta però dichiarata
  // come buco nella validazione finale. Sui mesi normali cap ≥ fabbisogno e
  // needEff coincide col minimo: comportamento invariato.
  // Nota: si guarda SOLO ciò che è manuale/immovibile → memoizzabile (i turni
  // automatici non entrano mai nel calcolo).
  const manNight = (id:number,g:number) => g>=1
    ? gt(id,g).some(s=>isNot(s.tipo)&&s.man)
    : gtB(id,g).some(s=>isNot(s.tipo));            // mese precedente: tutto immovibile
  const capMemo = new Map<string,number>();
  const capCell = (g:number,f:"M"|"P"|"N") => {
    const k=f+g; const hit=capMemo.get(k); if(hit!==undefined) return hit;
    let n=0;
    for(const m of medici){
      const sh = gt(m.id,g);
      if(sh.some(s=>s.man&&s.tipo===f)){ n++; continue; }   // cella già coperta da un manuale (anche MPS)
      if(m.stato==="MPS") continue;
      if(haX(m.id,g)) continue;
      if(sh.some(s=>s.man&&["L","ANA","per11","104"].includes(s.tipo))) continue;
      if(f!=="N" && sh.some(s=>s.man&&isNot(s.tipo))) continue;   // notte manuale oggi → niente M/P
      if(manNight(m.id,g-1)) continue;                            // g+1 di una notte immovibile
      if(f==="M" && manNight(m.id,g-2)) continue;                 // M vietata a g+2 di una notte
      if(m.stato==="ML" && (f!=="M" || isSp(g))) continue;        // ML: solo mattine feriali/sabato
      n++;
    }
    capMemo.set(k,n); return n;
  };
  const needEff = (g:number,f:"M"|"P"|"N") =>
    Math.min(f==="M" ? nmn(g).mn : f==="P" ? npn(g).mn : 1, capCell(g,f));

  const canR = (m:Medico,g:number,f:string) => {
    if(m.stato==="MPS") return false;
    if(haX(m.id,g))     return false;
    if(gt(m.id,g).some(s=>s.man&&["L","ANA","per11","104"].includes(s.tipo))) return false;
    // OBIETTIVO RAGGIUNTO: un medico già ad obiettivo non riceve altri turni
    // AUTOMATICI (i turni manuali restano intatti).
    if(cnt(m.id) >= m.obiettivo) return false;
    if(!canConsec(m.id,g)) return false;
    if(f==="N"){
      if(m.stato==="ML") return false;
      if(cntN(m.id)>=MAX_NOTTI) return false;
      if(haQ(m.id,g)) return false;
      return canN(m.id,g);
    }
    if(haN(m.id,g)) return false;
    if(f==="ASS"){ if(m.stato==="ML") return false; return canAss(m.id,g)&&canAssDist(m.id,g); }
    // DISTANZA GIORNATE PIENE (v0.3.2): se aggiungere questa fascia COMPLETA la
    // giornata (l'altra metà è già presente, inclusi i codici PS 1/2 e la A),
    // il medico è eleggibile solo se rispetta la distanza. Specchia la guardia
    // di add(): senza questo filtro i pool sceglievano candidati che add()
    // rifiutava in silenzio, lasciando buchi colmabili da altri medici.
    if(f==="M"){ if(!canMatt(m.id,g)) return false; if(m.stato==="ML"&&isSp(g)) return false; if(haP(m.id,g)&&!haM(m.id,g)&&!canAssDist(m.id,g)) return false; return true; }
    if(f==="P"){ if(m.stato==="ML") return false; if(haM(m.id,g)&&!haP(m.id,g)&&!canAssDist(m.id,g)) return false; return canPom(m.id,g); }
    return false;
  };

  // Un medico MDC (Decreto Calabria) non può restare SOLO in turno.
  const mdcOk = (m:Medico,g:number,f:string) => {
    if(m.stato!=="MDC") return true;
    const COMP = f==="M" ? ["M","A","1"]
               : f==="P" ? ["P","2"]
               : f==="N" ? ["N","3"] : [];
    for(const a of medici){
      if(a.id===m.id) continue;
      if(gt(a.id,g).some(s=>COMP.includes(s.tipo))) return true;
    }
    return false;
  };

  const byL = (a:Medico[]) => [...a].sort((x,y)=>cnt(x.id)-cnt(y.id));
  const byN = (a:Medico[]) => [...a].sort((x,y)=>cntN(x.id)-cntN(y.id));
  // EQUITÀ WEEKEND (v0.3.19): meno carico weekend prima; a parità, meno carico
  // totale (byL). Soft, analogo a byN per le notti.
  const byWk= (a:Medico[]) => [...a].sort((x,y)=>(cntWk(x.id)-cntWk(y.id))||(cnt(x.id)-cnt(y.id)));

  const att = medici.filter(m=>m.stato!=="MPS");
  const ml  = att.filter(m=>m.stato==="ML");
  const mdc = att.filter(m=>m.stato==="MDC");
  const mr  = att.filter(m=>m.stato==="MR");
  const mrMdc = [...mr,...mdc];
  const ambilitati = medici.filter(m=>m.ambulatorio);

  const giorniArr = Array.from({length:ndim},(_,i)=>i+1);
  const feriali = giorniArr.filter(g=>isFer(g));
  const weekend = giorniArr.filter(g=>isWk(g));
  const wkPairs: [number,number][] = []; for(let g=1;g<=ndim;g++) if(isS(g)&&g+1<=ndim&&isD(g+1)) wkPairs.push([g,g+1]);
  // ── PORTATORI DI CARICO WEEKEND (v0.3.22) ─────────────────────────────────
  // Popolazione su cui ha senso misurare l'EQUITÀ del carico weekend: i medici
  // che possono davvero riceverne. Includere chi è strutturalmente a zero
  // (l'ML, e l'MDC quando i minimi festivi valgono 1) aggiunge alla varianza
  // una costante enorme e SMORZA i delta fra tabelloni — era uno dei motivi per
  // cui il selettore non distingueva un weekend equo da uno sbilanciato.
  //
  //  · ML  → niente P, niente N, niente M festiva ⇒ solo mattine di sabato,
  //          che pesano 0 ⇒ mai portatore.
  //  · MDC → il Decreto Calabria gli vieta di restare solo: può prendere uno
  //          slot weekend di peso > 0 solo se su quella fascia c'è posto per un
  //          collega (max ≥ 2). La notte è 1/giorno ⇒ per lui è sempre esclusa.
  //  · MR  → sempre portatore.
  /** Peso "weekend" di UNO slot (stessa metrica di pesoWeekend, per fascia). */
  const pesoSlot = (g:number, f:"M"|"P"|"N") => {
    const fest = isSp(g);                                  // domenica o festivo
    const sab  = isS(g) && !fest;
    const pre  = g<ndim && isSp(g+1);                       // notte prefestiva
    if(f==="N") return (sab||fest||pre) ? 2 : 0;
    if(f==="P") return (sab||fest) ? 1 : 0;
    return fest ? 1 : 0;                                    // mattina: solo festivo
  };
  // Indisponibilità IMMOVIBILE nel giorno g: X o un'assenza inserita a mano.
  // Solo turni manuali → la popolazione dei portatori è la STESSA per tutti i
  // tabelloni a confronto, che è ciò che rende la forchetta un metro comparabile.
  const bloccatoMan = (id:number,g:number) =>
    gt(id,g).some(s=>s.tipo==="X" || (s.man && ["L","ANA","per11","104"].includes(s.tipo)));
  const puoPortareWk = (m:Medico) => {
    if(m.stato==="ML")    return false;
    if(m.obiettivo<=0)    return false;
    const mdcOnly = m.stato==="MDC";
    // L'affiancamento dell'MDC può arrivare anche da un MPS: gli MPS lavorano i
    // codici PS 1/2/3, che mdcOk accetta come compatibili con M/P/N. Quindi con
    // un MPS in organico l'MDC può fare ANCHE la notte di weekend (peso 2), pur
    // essendo la notte di reparto 1/giorno. Ignorarlo escludeva dall'equità un
    // medico che porta una quota piena — ad agosto 2026 l'MDC ne porta 6 su 51.
    // Affiancamento MANUALE disponibile a g sulla fascia f: un collega che ha
    // GIÀ un turno compatibile inserito a mano. Solo turni MANUALI: così la
    // capacità è IDENTICA per tutti i tabelloni a confronto, che è ciò che
    // rende la forchetta un metro comparabile.
    const COMP:Record<string,string[]> = { M:["M","A","1"], P:["P","2"], N:["N","3"] };
    const affMan = (id:number, g:number, f:"M"|"P"|"N") =>
      medici.some(a => a.id!==id && gt(a.id,g).some(s => s.man && COMP[f].includes(s.tipo)));
    for(let g=1;g<=ndim;g++){
      if(bloccatoMan(m.id,g)) continue;
      if(!mdcOnly && (pesoSlot(g,"M")>0 || pesoSlot(g,"P")>0 || pesoSlot(g,"N")>0)) return true;
      if(!mdcOnly) continue;
      if(pesoSlot(g,"N")>0 && affMan(m.id,g,"N")) return true;
      if(pesoSlot(g,"M")>0 && (nmn(g).mx>=2 || affMan(m.id,g,"M"))) return true;
      if(pesoSlot(g,"P")>0 && (npn(g).mx>=2 || affMan(m.id,g,"P"))) return true;
    }
    return false;
  };

  // ── CAPACITÀ E PAVIMENTO DI CARICO WEEKEND (v0.3.22) ──────────────────────
  // Sapere SE un medico può lavorare nei weekend non basta: conta QUANTO può
  // portarne. Un MDC affiancabile in un solo weekend è "portatore", ma la sua
  // capacità è 2 punti, non la quota intera — contarlo per una quota piena
  // abbassa la forchetta di tutti gli altri e gli affibbia una penalità fissa
  // che nessun tabellone può togliere.
  //
  //  · wkCapacita(id) = TETTO: quanti punti weekend potrebbe al massimo
  //    prendere. Stima OTTIMISTICA (ignora riposi, tetto notti, conflitti fra
  //    giorni): si sbaglia dalla parte prudente, mai vincolando troppo.
  //  · wkPavimento(id) = PAVIMENTO: i punti che ha già per TURNI MANUALI e che
  //    nessuna generazione può togliergli.
  const COMPF:Record<string,string[]> = { M:["M","A","1"], P:["P","2"], N:["N","3"] };
  const affManC = (id:number, g:number, f:"M"|"P"|"N") =>
    medici.some(a => a.id!==id && gt(a.id,g).some(s => s.man && COMPF[f].includes(s.tipo)));
  const wkCapacita = (m:Medico) => {
    if(m.stato==="ML" || m.obiettivo<=0) return 0;
    const mdcOnly = m.stato==="MDC";
    let cap = 0;
    for(let g=1;g<=ndim;g++){
      if(bloccatoMan(m.id,g)) continue;
      // notte (esclusiva col resto della giornata) …
      const pN = pesoSlot(g,"N");
      const viaN = (pN>0 && (!mdcOnly || affManC(m.id,g,"N"))) ? pN : 0;
      // … oppure mattina+pomeriggio (forma ad associato)
      let viaMP = 0;
      for(const f of ["M","P"] as const){
        const p = pesoSlot(g,f); if(p<=0) continue;
        const cap2 = f==="M" ? nmn(g).mx>=2 : npn(g).mx>=2;
        if(!mdcOnly || cap2 || affManC(m.id,g,f)) viaMP += p;
      }
      cap += Math.max(viaN, viaMP);
    }
    return cap;
  };
  const wkPavimento = (id:number) => {
    let n = 0;
    for(let g=1;g<=ndim;g++){
      const man = gt(id,g).filter(s=>s.man);
      if(man.length) n += cellWkVal(g, man);
    }
    return n;
  };

  // ── QUOTA EQUA DI CARICO WEEKEND (v0.3.23) ────────────────────────────────
  // Stessa aritmetica del `wkScarto` di misuraTabellone, ma calcolabile DURANTE
  // la generazione: il carico weekend ancora da assegnare è noto (slot weekend
  // scoperti × peso), quindi W = già assegnato + residuo. Verificato esatto su
  // agosto 2026 (W=51 a ogni fase). Il livello x di riempimento dà la forchetta
  // [lo,hi] per medico; le fasi ordinano i candidati per RESIDUO hi−carico.
  const wkPortatoriL = mrMdc.filter(puoPortareWk);
  let _tet: number[]|null = null, _pav: number[]|null = null;
  const wkQuota = () => {
    const ids = wkPortatoriL.map(m=>m.id);
    const val = wkPortatoriL.map(m=>cntWk(m.id));
    // tetto e pavimento dipendono SOLO dai manuali ⇒ calcolati una volta sola.
    if(!_tet){ _tet = wkPortatoriL.map(m=>wkCapacita(m)); _pav = wkPortatoriL.map((m,i)=>Math.min(wkPavimento(m.id), _tet![i])); }
    const tet = _tet, pav = _pav!;
    let resto = 0;
    for(let g=1; g<=ndim; g++) for(const f of ["M","P","N"] as const){
      const p = pesoSlot(g,f); if(p<=0) continue;
      resto += p * Math.max(0, needEff(g,f) - cf(g,f));
    }
    const W = val.reduce((a,b)=>a+b,0) + resto;
    const out: Record<number,{lo:number;hi:number}> = {};
    if(ids.length<2){ ids.forEach((id,i)=>out[id]={lo:val[i],hi:val[i]}); return out; }
    const somma = (x:number) => pav.reduce((q,pv,i)=>q+Math.min(tet[i], Math.max(pv, x)), 0);
    let x = 0; const xMax = Math.max(0, ...tet);
    while(x < xMax && somma(x+1) <= W) x++;
    const xHi = somma(x)===W ? x : x+1;
    ids.forEach((id,i)=>{
      out[id] = { lo: Math.min(tet[i], Math.max(pav[i], x)), hi: Math.min(tet[i], Math.max(pav[i], xHi)) };
    });
    return out;
  };
  /** Ordina i candidati per MAGGIOR residuo rispetto alla propria quota alta.
   *  Chi non è portatore finisce in fondo. Un medico inchiodato dai manuali ha
   *  quota = pavimento ⇒ residuo 0 ⇒ esce dalla competizione senza spostare la
   *  forchetta degli altri. */
  const byWkQuota = (a:Medico[], q?:Record<number,{lo:number;hi:number}>) => {
    const Q = q ?? wkQuota();
    const res = (id:number) => (Q[id] ? Q[id].hi - cntWk(id) : -99);
    return [...a].sort((x,y)=>(res(y.id)-res(x.id)) || (cntWk(x.id)-cntWk(y.id)) || (cnt(x.id)-cnt(y.id)));
  };

  // Obiettivo di weekend liberi per medico. Normalmente ADATTIVO al mese:
  // 2 con ≥4 coppie sab-dom, 1 con 3, 0 con ≤2. Un override NUMERICO (vecchio
  // passo A dell'ultima chance) sostituisce l'adattivo per tutti; un override
  // a MAPPA agisce solo in wkTargetMed, e qui resta l'adattivo come base.
  const wkTarget = (typeof wkTargetOverride === "number")
    ? Math.max(0, Math.min(wkTargetOverride, wkPairs.length))
    : Math.max(0, Math.min(REG.wkTarget, wkPairs.length - 2));

  const eleggibili = (g:number,f:string,base:Medico[]) => base.filter(m=>!haQ(m.id,g)&&canR(m,g,f)&&mdcOk(m,g,f));

  // ── Verifica Regola N + distanza associati su tutto il mese ────────────────
  // TOLLERANZA AI MANUALI (v0.3.1): una violazione composta ESCLUSIVAMENTE da
  // turni manuali (o del mese precedente, immovibili per definizione) è una
  // scelta dell'utente, inviolabile: NON è un difetto del generatore e non deve
  // far fallire le fasi (prima un solo conflitto manuale-manuale rendeva
  // validaWeekend/faseDiurni strutturalmente false e degradava TUTTA la
  // generazione). Se anche un solo turno AUTOMATICO è coinvolto la violazione
  // resta piena: le guardie di add() non dovrebbero mai permetterlo, questo è
  // il controllo di sicurezza.
  const checkRegolaN = () => {
    // La giornata piena in g è interamente manuale? (mese precedente: sempre sì)
    // Include i codici 1/2: essendo inseribili solo manualmente, contribuiscono
    // sempre come `man` e non rendono mai "colpa del motore" un conflitto.
    const assManTot = (id:number,k:number) => {
      if(k<1) return true;
      const sh=gt(id,k);
      return sh.filter(s=>isMatt(s.tipo)).every(s=>s.man)
          && sh.filter(s=>isPom(s.tipo)).every(s=>s.man);
    };
    for(const m of medici){
      if(m.stato==="MPS") continue;
      // CONTINUITÀ: notti a cavallo del bordo. La N di M-1 è immovibile → conta
      // solo il conflitto con turni AUTOMATICI del mese corrente.
      if(haNB(m.id,0)){
        const sh1=gt(m.id,1); if(sh1.some(s=>!SPEC.includes(s.tipo)&&!s.man)) return false;
        if(ndim>=2){ const sh2=gt(m.id,2); if(sh2.some(s=>!SPEC.includes(s.tipo)&&!s.man&&violaG2(s.tipo))) return false; }
      }
      if(haNB(m.id,-1)){
        const sh1=gt(m.id,1); if(sh1.some(s=>!SPEC.includes(s.tipo)&&!s.man&&violaG2(s.tipo))) return false;
      }
      for(let g=1;g<=ndim;g++){
        const nSh = gt(m.id,g).find(s=>isNot(s.tipo));
        if(nSh){
          const nMan = !!nSh.man;
          // ANA/L/per11/X/104 in g+1 bloccano la Notte in g: quei codici sono
          // sempre manuali → conflitto manuale-manuale se anche la N lo è.
          if(hasAnteN(m.id,g) && !nMan) return false;
          if(g+1<=ndim){
            const sh1=gt(m.id,g+1);
            if(sh1.some(s=>!SPEC.includes(s.tipo)&&(!s.man||!nMan))) return false;
          }
          if(g+2<=ndim){
            const sh2=gt(m.id,g+2);
            const offend=sh2.filter(s=>!SPEC.includes(s.tipo)&&violaG2(s.tipo)); // relaxN: N ammessa a g+2; riposo esteso: tutto vietato
            if(offend.some(s=>!s.man||!nMan)) return false;
            const pomP=sh2.filter(s=>isPom(s.tipo)&&!isMatt(s.tipo)&&!isNot(s.tipo));
            if(pomP.length>1 && (!nMan || pomP.some(s=>!s.man))) return false;
          }
        }
        if(haAssB(m.id,g) && !canAssDist(m.id,g)){
          let colpaMotore = !assManTot(m.id,g);
          if(!colpaMotore){
            for(let k=g-2;k<=Math.min(ndim,g+2);k++){
              if(k===g) continue;
              if(haAssB(m.id,k) && !assManTot(m.id,k)){ colpaMotore=true; break; }
            }
          }
          if(colpaMotore) return false;
        }
      }
    }
    return true;
  };

  // ── Weekend liberi reali ──
  const isLibWk = (id:number,g:number) => { if(g<1||g>ndim) return true; const sh=gt(id,g); return sh.length===0||sh.every(s=>SPEC.includes(s.tipo)); };
  const cntWkLiberi = (id:number) => { let n=0; for(const [s,d] of wkPairs) if(isLibWk(id,s)&&isLibWk(id,d)) n++; return n; };
  // ── Obiettivo PER-MEDICO di weekend liberi ─────────────────────────────────
  // I turni MANUALI sui weekend non sono spostabili: l'obiettivo del medico è
  // min(wkTarget, weekend senza manuali), così i manuali non bloccano la generazione.
  const haManNonSpec = (id:number,g:number) => gt(id,g).some(s=>s.man && !SPEC.includes(s.tipo));
  const maxWkLiberi  = (id:number) => wkPairs.filter(([s,d])=>!haManNonSpec(id,s)&&!haManNonSpec(id,d)).length;
  const wkTargetMed  = (id:number) => {
    const ov = (wkTargetOverride && typeof wkTargetOverride === "object") ? wkTargetOverride[id] : undefined;
    const base = ov != null ? Math.max(0, Math.min(ov, wkPairs.length)) : wkTarget;
    return Math.min(base, maxWkLiberi(id));
  };

  return {
    ndim, medici, T, gt, st, add, haX, haM, haP, haN, haQ, cnt, cntN, cntWk,
    dw, isS, isD, isH, isSp, isWk, isNotteFest, isFer, isAmb, nmn, npn, SPEC, cf,
    canLav, canMatt, canPom, canAss, canN, haAss, canAssDist, canR, mdcOk, byL, byN, byWk, needEff,
    canConsec, runConsec, lavoraGiorno, MAX_CONSEC, MAX_NOTTI, maxAssSett, trailingPrev, BLOCCO_M,
    att, ml, mdc, mr, mrMdc, ambilitati, giorniArr, feriali, weekend, wkPairs,
    pesoSlot, wkPortatori: wkPortatoriL, wkCapacita, wkPavimento, wkQuota, byWkQuota,
    eleggibili, mark, rollback, snapshot, restore, checkRegolaN, isLibWk, cntWkLiberi, wkTarget, maxWkLiberi, wkTargetMed,
    relaxN: !!relaxN,
  };
}
