import { useEffect, useMemo, useRef, useState } from "react";
import type { Medico, Regole, Turno, TurniAll, AlternativaUC, DiagnosiGen, DiagnosiCausale } from "./engine/types";
import { diagnosiStatica } from "./engine/diagnosi";
import { MESI, DL, DF, dowOf, dimOf, isFestivo, isSabN, isDomN, mkKey } from "./engine/date";
import { vt, SPEC, ambConfigurato, fissaTurni, liberaTurni, isAmbT, abilitatoAmb, abilitatoQualche, slotAmbGiorno, ambIdDi, etichettaTurno } from "./engine/turni";
import { AmbulatoriPanel } from "./components/AmbulatoriPanel";
import { RepartoPanel } from "./components/RepartoPanel";
import { FestiviPanel } from "./components/FestiviPanel";
import { FestiviPuntiPanel } from "./components/FestiviPuntiPanel";
import { DesideratePanel } from "./components/DesideratePanel";
import { mergeStatoFestivi, rimuoviMedicoFestivi, mesiDelPiano, type StatoFestivi } from "./engine/festiviApp";
import type { StatoDesiderate } from "./engine/desiderate";
import { REGOLE_DEFAULT, setRegole, getRegole, mergeRegole } from "./engine/regole";
import { setPrevContext, setAmbRotStart } from "./engine/state";
import { setStoricoFestivi, setStoricoEquita } from "./engine/storico";
import { completaObiettivi, calcAmbRotNext } from "./engine/genera";
import { equilibra, type EsitoEquilibra } from "./engine/equilibra";
import { bilancioNotti, spiegaWeekend, type EsitoProvaWeekend } from "./engine/diagnosiWeekend";
import { provaWeekendParallelo } from "./provaWeekendParallelo";
import { generaParallelo } from "./generaParallelo";
import { loadS, saveS, loadRegole, saveRegole, loadAmbRot, saveAmbRot, loadFestivi, saveFestivi, loadDesiderate, saveDesiderate } from "./storage";
import { caricaRemoto, salvaRemoto, puoModificare, remotoConfigurato } from "./remote";
import { esportaExcel } from "./export/excel";
import { SC, KC } from "./components/costanti";
import { Badge } from "./components/Badge";
import { CellModal } from "./components/CellModal";
import { DocModal, type DocDraft } from "./components/DocModal";
import { CovDots } from "./components/CovDots";
import { calcolaBilancio, dettaglioFabbisogno, psMedico, alpiMedico, straordinariMedico, riepilogoMedico } from "./engine/bilancio";

// ─── DATI INIZIALI ────────────────────────────────────────────────────────────
const MEDICI_INIZIALI: Medico[] = [
  { id:1,  nome:"D. BALDI",      codice:"8109",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:2,  nome:"M. RENIS",      codice:"8199",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:3,  nome:"M. GENTILE",    codice:"8204",  stato:"MDC", obiettivo:21, ambulatorio:false },
  { id:4,  nome:"A. DEL GATTO",  codice:"8205",  stato:"ML",  obiettivo:25, ambulatorio:false },
  { id:5,  nome:"C. CIAMPA",     codice:"12086", stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:6,  nome:"V. SPUGNARDI",  codice:"12088", stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:7,  nome:"M. STEFANUCCI", codice:"12334", stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:8,  nome:"M. LEZZI",      codice:"61334", stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:9,  nome:"V. GIORDANO",   codice:"",      stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:10, nome:"B. CASILLI",    codice:"8175",  stato:"MPS", obiettivo:0,  ambulatorio:false },
  { id:11, nome:"P. SCUDERI",    codice:"60680", stato:"MPS", obiettivo:0,  ambulatorio:false },
];

// Le regole persistite entrano nel motore UNA volta al bootstrap; da qui in poi
// il pannello Regole le aggiorna con updRegole (setRegole + saveRegole).
setRegole(loadRegole());

// ─── APP COMPONENT ────────────────────────────────────────────────────────────
export default function App(){
  const saved = loadS();
  const [anno,   setAnno]   = useState(saved?.anno   ?? 2026);
  const [mese,   setMese]   = useState(saved?.mese   ?? 5);
  const [medici, setMedici] = useState<Medico[]>(saved?.medici ?? MEDICI_INIZIALI);
  // I turni sono salvati PER MESE (chiave "AAAA-MM"): cambiando mese o anno si
  // lavora su un insieme di turni diverso.
  const [turniAll, setTurniAll] = useState<TurniAll>(saved?.turniAll ?? {});
  const [tab,    setTab]    = useState<"cal"|"medici"|"festivi"|"desiderate"|"regole">("cal");
  const [fabbAperto, setFabbAperto] = useState(false);
  // Accordion del box "Regola della notte" (v0.3.33): raccoglie le varianti
  // della Regola N, prima sparse in coda ai limiti per medico.
  const [nottiAperto, setNottiAperto] = useState(false);
  const [cella,  setCella]  = useState<{id:number; g:number}|null>(null);
  const [editDoc,setEditDoc]= useState<DocDraft|null>(null);
  // Conferma eliminazione medico in-app: window.confirm() è bloccato negli
  // iframe sandbox → conferma con un secondo click (si annulla dopo 3.5s).
  const [delDoc, setDelDoc] = useState<number|null>(null);
  // Stessa logica di conferma a due click per "Rimuovi Man" (rimozione di TUTTI
  // i turni manuali del mese): il primo click chiede conferma, il secondo esegue
  // (la richiesta si annulla da sola dopo 3.5s).
  const [confMan, setConfMan] = useState(false);
  // Pannello Regole: stato React specchio delle regole del motore per il re-render.
  const [regole, setRegoleState] = useState(getRegole());
  const updRegole = (next: typeof regole) => { setRegole(next); setRegoleState(next); saveRegole(next); salvaRemoto("regole", next); };
  // SEZIONE FESTIVI (v0.3.60): periodo, scelte e piano sorteggiato; salvati a parte.
  const [festivi, setFestivi] = useState<StatoFestivi>(loadFestivi);
  const updFestivi = (next: StatoFestivi) => { setFestivi(next); saveFestivi(next); salvaRemoto("festivi", next); };
  // SEZIONE DESIDERATE (v0.3.64): solo su questo dispositivo (contiene le email).
  const [desiderate, setDesiderate] = useState<StatoDesiderate>(loadDesiderate);
  const updDesiderate = (next: StatoDesiderate) => { setDesiderate(next); saveDesiderate(next); };
  // ── SYNC REMOTO (v0.3.14) ──────────────────────────────────────────────────
  // editabile: questo browser ha la chiave di modifica (o il remoto non è
  // configurato → comportamento locale identico alle versioni precedenti).
  // remotoOk.current: finché il primo caricamento non è concluso, l'effect di
  // persistenza NON spinge verso il server (eviterebbe di sovrascrivere il
  // remoto con lo stato locale vecchio).
  const editabile = puoModificare();
  const remotoOk  = useRef(!remotoConfigurato());
  const applicaRemoto = (r: NonNullable<Awaited<ReturnType<typeof caricaRemoto>>>, ancheData=true) => {
    if(r.regole){
      // Regole remote salvate prima della v0.3.36 (giorniAmb/fasceAmb, niente
      // ambulatori): si convertono loro, non si tengono gli ambulatori locali.
      const base: Partial<Regole> = { ...getRegole(), ...r.regole };
      if(!Array.isArray(r.regole.ambulatori) && (r.regole.giorniAmb || r.regole.fasceAmb)) delete base.ambulatori;
      const m = mergeRegole(base); setRegole(m); setRegoleState(m); saveRegole(m);
    }
    if(r.ambRot) saveAmbRot(r.ambRot);
    if(r.festivi){ const f = mergeStatoFestivi(r.festivi); setFestivi(f); saveFestivi(f); }
    if(r.stato){
      if(ancheData && r.stato.anno!=null) setAnno(r.stato.anno);
      if(ancheData && r.stato.mese!=null) setMese(r.stato.mese);
      if(r.stato.medici)     setMedici(r.stato.medici);
      if(r.stato.turniAll)   setTurniAll(r.stato.turniAll);
    }
  };
  useEffect(()=>{
    let vivo = true;
    caricaRemoto().then(r=>{ if(!vivo) return; if(r) applicaRemoto(r); remotoOk.current = true; });
    // Sola lettura: i colleghi vedono le modifiche senza ricaricare la pagina.
    // ancheData=false → il refresh non strappa il mese che si sta sfogliando.
    const poll = !editabile ? setInterval(async ()=>{
      const r = await caricaRemoto(); if(vivo && r) applicaRemoto(r, false);
    }, 60000) : undefined;
    return ()=>{ vivo=false; if(poll) clearInterval(poll); };
  },[]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [toast,  setToast]  = useState<{txt:string; tp:string}|null>(null);
  // Variante di ultima chance proposta ma NON ancora applicata (proposta 1 non
  // bloccante): si conserva anche l'indice di rotazione ambulatorio usato alla
  // generazione, per poterlo ricalcolare sul tabellone effettivamente adottato
  // se l'utente applica la variante.
  const [altUC,  setAltUC]  = useState<{alt:AlternativaUC; rotStart:number}|null>(null);
  // DIAGNOSI (v0.3.10) — diagGen: telemetria dell'ULTIMA generazione (per mese
  // corrente; si azzera cambiando mese). diagOpen: pannello espanso/compresso.
  const [diagGen, setDiagGen] = useState<DiagnosiGen|null>(null);
  // DIAGNOSI CAUSALE (v0.3.13): il "vero problema" dietro i buchi dell'ultima
  // generazione (cluster di giorni, vincolo determinante, collo di bottiglia).
  const [diagCaus, setDiagCaus] = useState<DiagnosiCausale|null>(null);
  const [diagOpen, setDiagOpen] = useState(false);
  // DIAGNOSI WEEKEND LIBERI (v0.3.47): prove "cosa servirebbe" dopo una
  // generazione con avvisi sui weekend liberi (in parallelo nei worker).
  const [diagWk, setDiagWk] = useState<{ stato:"incorso"|"fatto"; esito?:EsitoProvaWeekend }|null>(null);
  // La diagnosi in corso si può interrompere (v0.3.51): una nuova generazione
  // o il cambio di mese la fermano subito, così non toglie CPU alla ricerca e
  // i suoi risultati non finiscono su un tabellone diverso.
  const diagWkCtl = useRef<AbortController|null>(null);
  const fermaDiagWk = () => { diagWkCtl.current?.abort(); diagWkCtl.current = null; setDiagWk(null); };
  useEffect(()=>()=>{ diagWkCtl.current?.abort(); },[]);
  // EQUILIBRA (v0.3.42): esito dell'ultimo "Equilibra" + tabellone di prima,
  // per l'Annulla. Si chiude da solo se il tabellone cambia per altre vie.
  const [eqRes, setEqRes] = useState<{esito:EsitoEquilibra; prima:TurniAll[string]}|null>(null);
  const [busy,   setBusy]   = useState(false);
  const [printing, setPrinting] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);

  const nd     = dimOf(anno,mese);
  const giorni = Array.from({length:nd},(_,i)=>i+1);

  // ── Turni del mese/anno attualmente visualizzato ──────────────────────────
  const curKey  = mkKey(anno, mese);
  const turni   = turniAll[curKey] || {};
  const setTurni = (updater: ((cur: TurniAll[string]) => TurniAll[string]) | TurniAll[string]) => {
    setTurniAll(prev=>{
      const cur  = prev[curKey] || {};
      const next = typeof updater==="function" ? updater(cur) : updater;
      return { ...prev, [curKey]: next };
    });
  };

  useEffect(()=>{ saveS({anno,mese,medici,turniAll}); if(remotoOk.current && editabile) salvaRemoto("stato",{anno,mese,medici,turniAll}); },[anno,mese,medici,turniAll]);
  useEffect(()=>{ setDiagGen(null); setDiagCaus(null); fermaDiagWk(); },[anno,mese]);
  useEffect(()=>{ if(eqRes && turni!==eqRes.esito.turni) setEqRes(null); },[turni]);   // la telemetria vale solo per il mese generato

  const showMsg = (txt:string,tp="ok") => { setToast({txt,tp}); setTimeout(()=>setToast(null),3200); };

  // ── Generazione (pulsante ①) ───────────────────────────────────────────────
  // La UI INIETTA nel motore tutto ciò che prima il motore leggeva da solo:
  // coda del mese precedente e indice di rotazione ambulatorio. La rotazione
  // viene poi ricalcolata dal SOLO tabellone accettato e persistita: i tentativi
  // scartati dal multi-tentativo non la fanno più avanzare.
  const generaCopertura = () => {
    fermaDiagWk();                       // la diagnosi precedente non deve rubare CPU alla nuova ricerca
    setBusy(true);
    setAltUC(null);
    setTimeout(async ()=>{
      try{
        setPrevContext(turniAll,anno,mese);
        setStoricoFestivi(turniAll,anno,mese,medici,regole.rotazioneFestiviMesi);
        setStoricoEquita(turniAll,anno,mese,medici,regole.equitaNottiMesi,regole.equitaWeekendMesi);
        const rotStart = loadAmbRot().nextIdx;
        setAmbRotStart(rotStart);
        // GENERAZIONE PARALLELA (v0.3.9): pool di Web Worker, ognuno con la
        // propria sequenza di semi → più tentativi nello stesso tempo e main
        // thread libero. Fallback automatico al percorso sincrono se i Worker
        // non sono disponibili.
        // PULSANTE COPERTURA «SOLO VUOTI» (v0.3.50): i turni automatici
        // presenti diventano temporaneamente manuali, così il motore riempie
        // solo i posti mancanti; poi tornano automatici.
        const fissati = regole.coperturaSoloVuoti ? fissaTurni(turni) : null;
        const r = await generaParallelo(anno,mese,nd,medici,fissati ? fissati.turni : turni);
        if(fissati){
          liberaTurni(r.turni, fissati.auto);
          if(r.alternativaUC) liberaTurni(r.alternativaUC.turni, fissati.auto);
        }
        saveAmbRot({ nextIdx: calcAmbRotNext(r.turni, medici, anno, mese, nd, rotStart) });
        salvaRemoto("ambRot", loadAmbRot());
        setTurni(r.turni);
        if(r.ok) showMsg("✓ Copertura minima completata!");
        else showMsg("⚠ Copertura parziale (mostrato il tabellone migliore): "+r.problemi.slice(0,4).join(" · "),"warn");
        // Variante di ultima chance disponibile → si propone senza applicarla.
        if(r.alternativaUC) setAltUC({ alt:r.alternativaUC, rotStart });
        setDiagGen(r.diagnosi ?? null);
        setDiagCaus(r.causale ?? null);
        // Avvisi sui weekend liberi → prove "cosa servirebbe" in background.
        fermaDiagWk();
        if(r.problemi.some(p=>/wk liberi/.test(p))){
          const ctl = new AbortController(); diagWkCtl.current = ctl;
          setDiagWk({ stato:"incorso" });
          provaWeekendParallelo(anno, mese, nd, medici, r.turni, ctl.signal)
            .then(esito=>{ if(diagWkCtl.current===ctl){ diagWkCtl.current = null; setDiagWk({ stato:"fatto", esito }); } })
            .catch(()=>{ if(diagWkCtl.current===ctl){ diagWkCtl.current = null; setDiagWk(null); } });
        }
      }catch(e){ showMsg("Errore: "+(e as Error).message,"err"); }
      setBusy(false);
    },50);
  };

  // Applica la variante di ultima chance proposta: la adotta come tabellone
  // corrente e RICALCOLA la rotazione ambulatorio sul tabellone effettivamente
  // pubblicato (partendo dallo stesso rotStart della generazione).
  const applicaAltUC = () => {
    if(!altUC) return;
    setTurni(altUC.alt.turni);
    saveAmbRot({ nextIdx: calcAmbRotNext(altUC.alt.turni, medici, anno, mese, nd, altUC.rotStart) });
    salvaRemoto("ambRot", loadAmbRot());
    const nc = altUC.alt.celleCoperte.length;
    setAltUC(null);
    showMsg(`✓ Variante applicata: +${nc} ${nc===1?"cella coperta":"celle coperte"}.`);
  };

  // ── Obiettivi mensili (pulsante ②) ─────────────────────────────────────────
  const generaObiettivi = () => {
    setBusy(true);
    setTimeout(()=>{
      try{
        setPrevContext(turniAll,anno,mese);
        setStoricoFestivi(turniAll,anno,mese,medici,regole.rotazioneFestiviMesi);
        setStoricoEquita(turniAll,anno,mese,medici,regole.equitaNottiMesi,regole.equitaWeekendMesi);
        const r = completaObiettivi(anno,mese,nd,medici,turni);
        setTurni(r.turni);
        if(r.rimasti.length===0) showMsg("✓ Obiettivi mensili completati!");
        else {
          const elenco = r.rimasti.map(x=>`${x.nome.split(" ").pop()} −${x.mancano}`).join(", ");
          const perche = r.postiLiberi===0
            ? "mattine e pomeriggi feriali sono già al massimo previsto (pannello Regole)"
            : "i giorni ancora liberi sono bloccati da riposi, consecutivi o turni già presenti";
          showMsg(`Obiettivi completati dove possibile. Restano sotto: ${elenco} — ${perche}.`,"warn");
        }
      }catch(e){ showMsg("Errore: "+(e as Error).message,"err"); }
      setBusy(false);
    },50);
  };

  // ── Equilibra (pulsante ③, facoltativo) ───────────────────────────────────
  // Scambia turni AUTOMATICI fra gli MR per rendere più equi notti e
  // mattine/pomeriggi. Punti di ciascuno, copertura, regole e weekend restano
  // invariati; manuali e sottolineati non si toccano. Annullabile.
  const equilibraTab = () => {
    setBusy(true);
    setTimeout(()=>{
      try{
        setPrevContext(turniAll,anno,mese);
        setStoricoFestivi(turniAll,anno,mese,medici,regole.rotazioneFestiviMesi);
        setStoricoEquita(turniAll,anno,mese,medici,regole.equitaNottiMesi,regole.equitaWeekendMesi);
        const prima = turni;
        const e = equilibra(anno,mese,nd,medici,turni,{ traGiorni:true });
        if(e.scambiNotti+e.scambiMP===0){ showMsg("Il tabellone è già equilibrato: nessuno scambio possibile senza peggiorare altro."); }
        else { setTurni(e.turni); setEqRes({ esito:e, prima }); }
      }catch(e){ showMsg("Errore: "+(e as Error).message,"err"); }
      setBusy(false);
    },50);
  };

  const handlePrint = async () => {
    setPrinting(true);
    try {
      esportaExcel(anno, mese, nd, medici, turni);
      showMsg("✓ Excel scaricato!");
    } catch(e) {
      showMsg("Errore Excel: " + (e as Error).message, "err");
    }
    setPrinting(false);
  };

  const gT = (id:number,g:number): Turno[] => turni[id]?.[g]?.t||[];
  const sT = (id:number,g:number,a:Turno[]) => setTurni(p=>({...p,[id]:{...(p[id]||{}),[g]:{t:a}}}));
  const cntM = (id:number) => { let t=0; for(let g=1;g<=nd;g++) for(const s of gT(id,g)) t+=vt(s.tipo,s.sott); return t; };

  // Conta weekend liberi del medico nel mese corrente
  const cntWkLiberi = (id:number) => {
    let lib=0;
    for(let g=1;g<=nd;g++){
      const dw=dowOf(anno,mese,g);
      if(dw!==5) continue; // solo sabati
      const dom=g+1;
      if(dom>nd) continue;
      const sabLib = gT(id,g).every(s=>SPEC.includes(s.tipo))||gT(id,g).length===0;
      const domLib = gT(id,dom).every(s=>SPEC.includes(s.tipo))||gT(id,dom).length===0;
      if(sabLib&&domLib) lib++;
    }
    return lib;
  };

  // Conta turni ambulatorio (A mattina + Ap pomeriggio) del medico nel mese
  const cntAmb = (id:number) => {
    let n=0;
    for(let g=1;g<=nd;g++) for(const s of gT(id,g)) if(isAmbT(s.tipo)) n++;
    return n;
  };
  // Conta i permessi (L / ANA / 104 / per11 / art37) del medico nel mese, con
  // dettaglio per tipo. X resta fuori: è un'esclusione, non un permesso.
  const PERM = ["L","ANA","104","per11","art37"] as const;
  const cntPerm = (id:number) => {
    const det: Record<string,number> = {};
    let tot=0;
    for(let g=1;g<=nd;g++) for(const s of gT(id,g))
      if((PERM as readonly string[]).includes(s.tipo)){ det[s.tipo]=(det[s.tipo]||0)+1; tot++; }
    return { tot, det };
  };
  // Turni PS (1/2/3) del medico, pesati come nel bilancio: la notte (3) vale 2.
  // Contati ANCHE i sottolineati (contaSott=true): il riassunto mostra tutti i
  // turni fatti in PS; il bilancio (quota scalata da D) resta ai soli pieni.
  const cntPS = (id:number) => psMedico(turni, id, nd, true);
  // ALPI: la quota di PS svolta in libera professione = i turni PS SOTTOLINEATI
  // (il 3 vale 2). Per costruzione è sempre ≤ cntPS: si mostra come "di cui".
  const cntALPI = (id:number) => alpiMedico(turni, id, nd);
  // Straordinari: M/P/N sottolineati (la N vale 2). Speculare ad ALPI ma per il
  // reparto; come tutti i sottolineati non scala l'obiettivo mensile.
  const cntStra = (id:number) => straordinariMedico(turni, id, nd);
  // Riepilogo generale del medico: M/P/N di reparto + carico weekend.
  const rieM  = (id:number) => riepilogoMedico(turni, id, nd, anno, mese);

  // Riepilogo testuale della squadra (Formato B, copiabile): rispecchia le card.
  const riepilogoTesto = () => {
    const out: string[] = [`Riepilogo turni — ${regole.reparto.unita} — ${MESI[mese]} ${anno}`, ""];
    for(const m of medici){
      const tot=cntM(m.id), r=rieM(m.id), wkLib=cntWkLiberi(m.id);
      const ambN=cntAmb(m.id), psN=cntPS(m.id), pm=cntPerm(m.id);
      const permTxt=PERM.filter(k=>pm.det[k]).map(k=>`${k}${pm.det[k]}`).join("·");
      const mps=m.stato==="MPS";
      const abAmb=abilitatoQualche(m,regole.ambulatori);
      out.push(`${m.nome} [${m.stato}]${abAmb?" · AMB":""}  matr. ${m.codice||"—"}`);
      const straN=cntStra(m.id), alpiN=cntALPI(m.id);
      out.push(`  Turni: ${mps?`${tot}`:`${tot} / ${m.obiettivo}`}`);
      out.push(`  Reparto: M ${r.m} · P ${r.p} · N ${r.n}`);
      out.push(`  Straordinari: ${straN}`);
      out.push(`  PS: ${psN}${alpiN>0?` (di cui ALPI ${alpiN})`:""}`);
      out.push(`  Festivi lavorati: ${r.wk}`);
      if(!mps) out.push(`  Weekend liberi: ${wkLib}`);
      if(abAmb || ambN>0) out.push(`  Ambulatorio: ${ambN}`);
      out.push(`  Permessi: ${pm.tot>0?`${pm.tot} (${permTxt})`:"0"}`);
      out.push("");
    }
    return out.join("\n").trimEnd();
  };
  const copiaRiepilogo = async () => {
    const txt = riepilogoTesto();
    try {
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(txt);
      else { const ta=document.createElement("textarea"); ta.value=txt; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
      showMsg("Riepilogo copiato negli appunti");
    } catch { showMsg("Copia non riuscita", "err"); }
  };

  // Bilancio del mese + dettaglio del fabbisogno (per il pannello su "F").
  const bil = calcolaBilancio(anno,mese,nd,medici,turni,regole);
  const fab = dettaglioFabbisogno(anno,mese,nd,regole);
  const metaG = (g:number) => {
    const d=dowOf(anno,mese,g), h=isFestivo(anno,mese,g);
    return { d, h, sat:isSabN(d), dom:isDomN(d), sp:h||isDomN(d) };
  };
  const cfApp = (g:number,f:string) => {
    let n=0;
    for(const m of medici){
      // Copertura minima giornaliera: SOLO i turni reali M/P/N (A e
      // 1/2/3 esclusi, altrimenti falsano la lettura di cosa manca davvero).
      for(const s of gT(m.id,g)){
        if(f==="M" && s.tipo==="M") n++;
        if(f==="P" && s.tipo==="P") n++;
        if(f==="N" && s.tipo==="N") n++;
      }
    }
    return n;
  };

  // ── DIAGNOSI COPERTURA (v0.3.10) ──────────────────────────────────────────
  // Statica: certificati d'impossibilità dai soli turni MANUALI del mese
  // (diagnosiStatica filtra i manuali da sé: si può passare `turni` intero).
  // Ricalcolata a ogni modifica: vale anche PRIMA di generare.
  const diagStat = useMemo(
    ()=>diagnosiStatica(anno, mese, nd, medici, turni, regole),
    [anno, mese, nd, medici, turni, regole]);
  const minDi = (g:number,f:"M"|"P"|"N") => {
    const mt=metaG(g), fb=mt.sp?regole.fabb.fest:mt.sat?regole.fabb.sab:regole.fabb.fer;
    return f==="M"?fb.mMin:f==="P"?fb.pMin:1;
  };
  // Badge per fascia (solo se la cella è DAVVERO sotto-minimo adesso):
  // ⊘ certificata (cella o giornata) > ⚠ mai coperta in nessun tentativo.
  const diagFlag = (g:number,f:"M"|"P"|"N"): "imp"|"mai"|undefined => {
    if(cfApp(g,f) >= minDi(g,f)) return undefined;
    if(diagStat.celle.some(c=>c.g===g&&c.f===f) || diagStat.giorni.some(d=>d.g===g)) return "imp";
    if(diagGen && diagGen.tentativi>=10 && (diagGen.conteggi[`${g}-${f}`]||0)===diagGen.tentativi) return "mai";
    return undefined;
  };
  // Celle bucate MAI coperte (non già certificate): per il pannello.
  // NOTTI E WEEKEND LIBERI (v0.3.47): bilancio dai soli manuali e spiegazione
  // degli avvisi sul tabellone corrente.
  const bilNotti = useMemo(()=>bilancioNotti(anno, mese, nd, medici, turni, regole), [anno, mese, nd, medici, turni, regole]);
  const spiegaWk = useMemo(()=>spiegaWeekend(anno, mese, nd, medici, turni), [anno, mese, nd, medici, turni, regole]);
  const maiCoperte = useMemo(()=>{
    if(!diagGen || diagGen.tentativi<10) return [] as {g:number;f:"M"|"P"|"N"}[];
    const out:{g:number;f:"M"|"P"|"N"}[]=[];
    for(let g=1;g<=nd;g++) for(const f of ["M","P","N"] as const){
      if(cfApp(g,f)>=minDi(g,f)) continue;
      if(diagStat.celle.some(c=>c.g===g&&c.f===f)||diagStat.giorni.some(d=>d.g===g)) continue;
      if((diagGen.conteggi[`${g}-${f}`]||0)===diagGen.tentativi) out.push({g,f});
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[diagGen, diagStat, turni, regole, nd]);
  const nCert = diagStat.celle.length + diagStat.giorni.length + diagStat.mese.length;
  // Cluster causali ancora ATTUALI: almeno una cella del cluster è tuttora
  // sotto-minimo, oppure uno dei suoi ambulatori è tuttora scoperto. Se
  // l'utente sistema a mano quei giorni, il cluster sparisce da sé.
  // Slot d'ambulatorio richiesti nel giorno g: (ambulatorio, A|Ap).
  const ambSlotsApp = (g:number) => metaG(g).h ? [] : slotAmbGiorno(regole.ambulatori, dowOf(anno,mese,g), g, nd);
  const chiSlot = (g:number, sl:{amb:string;cod:string}) =>
    medici.find(m=>gT(m.id,g).some(s=>s.tipo===sl.cod && ambIdDi(s)===sl.amb));
  const ambMancaApp = (g:number) => ambSlotsApp(g).some(sl=>!chiSlot(g,sl));
  const causVis = !diagCaus ? [] : diagCaus.cluster.filter(cl=>
    cl.celle.some(c=>cfApp(c.g,c.f)<minDi(c.g,c.f)) || cl.ambGiorni.some(ambMancaApp));

  // ── salvataggio dal DocModal (nuovo o modifica) ────────────────────────────
  const salvaDoc = (f: DocDraft) => {
    if(!f.id){ const mx=Math.max(...medici.map(m=>m.id),0); setMedici(p=>[...p,{...f,id:mx+1} as Medico]); }
    else      setMedici(p=>p.map(m=>m.id===f.id?(f as Medico):m));
  };

  const rimuoviManuali = () => {
    if(!confMan){
      setConfMan(true);
      setTimeout(()=>setConfMan(false),3500);
      return;
    }
    setConfMan(false);
    setTurni(p=>{ const n: TurniAll[string]={}; for(const k in p){ n[k]={}; for(const d in p[k]) n[k][d]={t:(p[k][d].t||[]).filter(s=>!s.man)}; } return n; });
    showMsg("Turni manuali rimossi.");
  };

  const eliminaDoc = (m: Medico) => {
    if(delDoc!==m.id){
      setDelDoc(m.id);
      setTimeout(()=>setDelDoc(d=>d===m.id?null:d),3500);
      return;
    }
    setDelDoc(null);
    setMedici(p=>p.filter(x=>x.id!==m.id));
    // Rimuove anche i turni del medico da TUTTI i mesi salvati, per evitare
    // "fantasmi" ereditati da un nuovo medico che riceve lo stesso id (max+1).
    setTurniAll(prev=>{
      const n: TurniAll={};
      for(const k in prev){ const { [m.id]:_scarta, ...resto } = prev[k]; n[k]=resto; }
      return n;
    });
    updFestivi(rimuoviMedicoFestivi(festivi, m.id));
    showMsg(`Medico ${m.nome} eliminato.`);
  };

  // ── styles ──
  const TH: React.CSSProperties = {background:"#f8fafc",border:"1px solid #e2e8f0",padding:"3px 3px",textAlign:"center",fontFamily:"monospace",fontSize:"9px",color:"#64748b",whiteSpace:"nowrap"};

  return (
    <div className="app-root" style={{minHeight:"100vh",background:"#ffffff",color:"#0f172a",fontFamily:"monospace"}}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:#ffffff;}
        ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px;}
        /* BARRA IN ALTO (tema chiaro): fondo blu, testi e comandi chiari */
        .topbar div,.topbar span{color:#ffffff;}
        .topbar .intest div,.topbar .intest span{color:#ffffff!important;}
        .topbar .intest div:first-child{color:rgba(255,255,255,.7)!important;}
        .topbar .intest span{color:rgba(255,255,255,.7)!important;}
        .topbar select,.topbar input{background:rgba(255,255,255,.12)!important;border-color:rgba(255,255,255,.35)!important;color:#ffffff!important;}
        .topbar select option{color:#0f172a;}
        .topbar .cmd{background:rgba(255,255,255,.14)!important;color:#ffffff!important;}
        .topbar .cmd span{color:#ffffff;}
        .topbar .cmd:first-of-type{background:#ffffff!important;color:#1e3a8a!important;}
        .topbar .cmd:first-of-type span{color:#1e3a8a;}
        .topbar .cmd.rosso{background:transparent!important;border:1px solid rgba(255,255,255,.35)!important;}
        .topbar .cmd.rosso span{color:#fecdd3;}
        .topbar .cmd:disabled{opacity:.45!important;}
        .topbar .seg{background:rgba(255,255,255,.12)!important;border-color:rgba(255,255,255,.25)!important;}
        .topbar .seg button{color:rgba(255,255,255,.8)!important;}
        .topbar .seg button[aria-selected=true]{background:#ffffff!important;color:#1e3a8a!important;box-shadow:0 1px 3px rgba(0,0,0,.25)!important;}
        .topbar .sec{border-left-color:rgba(255,255,255,.3)!important;}
        .topbar .sec button{color:rgba(255,255,255,.75)!important;}
        .topbar .sec button[aria-selected=true]{color:#ffffff!important;border-bottom-color:#ffffff!important;}
        @media print{
          .np{display:none!important;}
          body,.app-root{background:#fff!important;color:#000!important;}
          table{font-size:6pt!important;border-collapse:collapse!important;}
          td,th{border:.4pt solid #bbb!important;padding:1pt 2pt!important;}
        }
      `}</style>

      {/* TOPBAR */}
      <div className="np topbar" style={{background:"#1e3a8a",borderBottom:"1px solid #1e3a8a",padding:"10px 16px",display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap"}}>
        <div className="intest" style={{flex:1,minWidth:"200px"}}>
          <div style={{fontSize:"8px",color:"#64748b",letterSpacing:".15em",textTransform:"uppercase",marginBottom:"3px"}}>
            {[regole.reparto.azienda, regole.reparto.presidio].filter(Boolean).join(" · ")}
          </div>
          <div style={{fontSize:"15px",fontWeight:700,color:"#0f172a"}}>
            {regole.reparto.unita || "Reparto"}
            <span style={{color:"#64748b",fontSize:"11px",fontWeight:400,marginLeft:"8px"}}>— Pianificazione Turni</span>
          </div>
        </div>

        {/* Nella sezione Festivi il mese non c'entra: selettore e pulsanti del mese spariscono. */}
        <div style={{display:tab==="festivi"||tab==="desiderate"?"none":"flex",gap:"6px",alignItems:"center"}}>
          <select value={mese} onChange={e=>setMese(+e.target.value)}
            style={{background:"#ffffff",border:"1px solid #cbd5e1",color:"#1d4ed8",borderRadius:"6px",padding:"6px 9px",fontSize:"12px",fontFamily:"monospace",cursor:"pointer"}}>
            {MESI.map((m,i)=><option key={i} value={i}>{m}</option>)}
          </select>
          <input type="number" value={anno} onChange={e=>setAnno(+e.target.value)}
            style={{background:"#ffffff",border:"1px solid #cbd5e1",color:"#1d4ed8",borderRadius:"6px",padding:"6px 8px",fontSize:"12px",fontFamily:"monospace",width:"78px"}}/>
        </div>

        <div style={{display:"flex",gap:"6px",flexWrap:"wrap",alignItems:"center"}}>
          {!editabile &&
            <span title="Stai consultando il tabellone pubblicato. Per modificare, apri il link con #modifica in fondo."
              style={{background:"#fef3c7",color:"#92400e",border:"1px solid #b45309",borderRadius:"6px",
              padding:"6px 10px",fontSize:"10px",fontWeight:700,fontFamily:"monospace",letterSpacing:".08em"}}>
              👁 SOLA LETTURA
            </span>}
          {([
            ["①","Copertura", busy?"#e2e8f0":"#1d4ed8", generaCopertura, busy],
            ["②","Obiettivi", busy?"#e2e8f0":"#6d28d9", generaObiettivi, busy],
            ["③","Equilibra", busy?"#e2e8f0":"#0f766e", equilibraTab, busy],
            ["⊘","Rimuovi App","#6d28d9", ()=>{ setTurni(p=>{ const n: TurniAll[string]={}; for(const k in p){ n[k]={}; for(const d in p[k]) n[k][d]={t:(p[k][d].t||[]).filter(s=>s.man)}; } return n; }); showMsg("Turni app rimossi."); }, false],
            ["x",confMan?"Conferma ✕":"Rimuovi Man",confMan?"#dc2626":"#fecdd3", rimuoviManuali, false],
            ["⎙","Excel", printing?"#e2e8f0":"#047857", handlePrint, printing],
          ] as [string,string,string,()=>void,boolean][])
            .filter(([,lb])=> tab!=="festivi" && tab!=="desiderate" && (editabile || lb==="Excel"))
            .map(([ic,lb,cl,fn,ds])=>(
            <button key={lb} className={"cmd"+(lb.startsWith("Rimuovi")||lb.startsWith("Conferma")?" rosso":"")} onClick={fn} disabled={!!ds} style={{background:ds?"#e2e8f0":cl,color:ds?"#94a3b8":"#fff",border:"none",borderRadius:"6px",padding:"7px 12px",cursor:ds?"not-allowed":"pointer",fontSize:"11px",fontWeight:700,fontFamily:"monospace",display:"flex",alignItems:"center",gap:"4px",opacity:ds?.5:1}}>
              <span>{ic}</span><span>{lb}</span>
            </button>
          ))}
        </div>

        {/* NAVIGAZIONE (v0.3.60): le due sezioni di tutti i giorni in evidenza
            (Calendario, Medici); quelle che servono di rado (Festivi, Regole)
            in un gruppo a parte, più discreto. */}
        <div style={{display:"flex",gap:"10px",alignItems:"center",flexWrap:"wrap"}}>
          <div className="seg" style={{display:"flex",gap:0,background:"#f1f5f9",border:"1px solid #cbd5e1",borderRadius:"9px",padding:"3px"}}>
            {([["cal","Calendario"],["medici","Medici"]] as ["cal"|"medici",string][])
              .filter(([t])=> editabile || t==="cal")
              .map(([t,l])=>(
              <button key={t} onClick={()=>setTab(t)} aria-selected={tab===t} style={{
                background:tab===t?"#e2e8f0":"transparent", color:tab===t?"#1e3a8a":"#64748b",
                border:"none", borderRadius:"7px", padding:"8px 16px", cursor:"pointer",
                fontSize:"12px", fontWeight:700, fontFamily:"monospace", letterSpacing:".02em",
                boxShadow:tab===t?"inset 0 0 0 1px #2563eb, 0 2px 8px #0f172a22":"none",
                transition:"background .12s, color .12s"}}>{l}</button>
            ))}
          </div>
          <div className="sec" style={{display:"flex",gap:"2px",alignItems:"center",borderLeft:"1px solid #cbd5e1",paddingLeft:"10px"}}>
            {([["festivi","Festivi"],["desiderate","Desiderate"],["regole","Regole"]] as ["festivi"|"desiderate"|"regole",string][])
              .filter(([t])=> editabile || (t==="festivi" && !!festivi.piano))
              .map(([t,l])=>(
              <button key={t} onClick={()=>setTab(t)} aria-selected={tab===t} style={{
                background:"transparent", color:tab===t?"#1e3a8a":"#64748b",
                border:"none", borderBottom:`2px solid ${tab===t?"#2563eb":"transparent"}`, padding:"6px 9px", cursor:"pointer",
                fontSize:"11px", fontWeight:tab===t?700:400, fontFamily:"monospace", letterSpacing:".02em",
                transition:"color .12s, border-color .12s"}}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* TOAST */}
      {toast&&(
        <div className="np" style={{position:"fixed",top:"66px",right:"16px",zIndex:900,
          background:toast.tp==="err"?"#fff1f2":toast.tp==="warn"?"#fffbeb":"#ecfdf5",
          border:`1px solid ${toast.tp==="err"?"#dc2626":toast.tp==="warn"?"#c2410c":"#16a34a"}`,
          color:"#0f172a",borderRadius:"8px",padding:"10px 14px",fontSize:"12px",
          fontFamily:"monospace",boxShadow:"0 8px 24px #0f172a26",maxWidth:"300px"}}>
          {toast.txt}
        </div>
      )}

      {/* ESITO EQUILIBRA — prima → dopo per MR, con Annulla */}
      {eqRes&&(()=>{
        const { esito } = eqRes;
        const dopo = new Map(esito.dopo.map(r=>[r.id,r]));
        const cambiati = esito.prima.filter(r=>{ const d=dopo.get(r.id)!; return d.M!==r.M||d.P!==r.P||d.N!==r.N; });
        const td = {padding:"2px 6px",textAlign:"right" as const};
        const freccia = (a:number,b:number) => a===b ? <span>{a}</span> : <span>{a}→<b style={{color:"#0f766e"}}>{b}</b></span>;
        return (
          <div className="np" style={{position:"fixed",bottom:"16px",right:"16px",zIndex:901,
            background:"#ffffff",border:"1px solid #0f766e",color:"#0f172a",borderRadius:"10px",
            padding:"12px 14px",fontSize:"12px",fontFamily:"monospace",boxShadow:"0 10px 30px #0f172a26",
            maxWidth:"440px",width:"calc(100% - 32px)"}}>
            <div style={{fontWeight:700,color:"#0f766e",marginBottom:"6px"}}>
              Equilibrio applicato: {esito.scambiNotti+esito.scambiMP} {esito.scambiNotti+esito.scambiMP===1?"scambio":"scambi"}
            </div>
            <div style={{fontSize:"10px",color:"#64748b",marginBottom:"6px"}}>
              {esito.scambiNotti>0 && <>notti: {esito.scambiNotti} · </>}mattine/pomeriggi: {esito.scambiMP} · celle cambiate: {esito.celle.length}
            </div>
            {cambiati.length>0 && (
              <table style={{borderCollapse:"collapse",marginBottom:"8px",fontSize:"11px"}}>
                <thead><tr style={{color:"#64748b"}}><th style={{textAlign:"left",padding:"2px 6px"}}>MR</th><th style={td}>Mattine</th><th style={td}>Pomeriggi</th><th style={td}>Notti</th></tr></thead>
                <tbody>{cambiati.map(r=>{ const d=dopo.get(r.id)!; return (
                  <tr key={r.id}><td style={{padding:"2px 6px"}}>{r.nome.split(" ").pop()}</td>
                    <td style={td}>{freccia(r.M,d.M)}</td><td style={td}>{freccia(r.P,d.P)}</td><td style={td}>{freccia(r.N,d.N)}</td></tr>); })}</tbody>
              </table>
            )}
            <div style={{fontSize:"10px",color:"#64748b",marginBottom:"9px"}}>
              Celle cambiate evidenziate in verde acqua. Turni totali, copertura, regole e weekend invariati; qualche blocco di mattine può essere più corto di un giorno.
            </div>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={()=>setEqRes(null)}
                style={{background:"#0f766e",color:"#fff",border:"none",borderRadius:"6px",padding:"7px 14px",
                  cursor:"pointer",fontSize:"11px",fontWeight:700,fontFamily:"monospace"}}>Tieni</button>
              <button onClick={()=>{ const p=eqRes.prima; setEqRes(null); setTurni(p); showMsg("Equilibrio annullato."); }}
                style={{background:"#e2e8f0",color:"#64748b",border:"1px solid #cbd5e1",borderRadius:"6px",padding:"7px 14px",
                  cursor:"pointer",fontSize:"11px",fontFamily:"monospace"}}>Annulla</button>
            </div>
          </div>
        );
      })()}

      {/* VARIANTE ULTIMA CHANCE — proposta non bloccante */}
      {altUC&&(()=>{
        const FL: Record<string,string> = { M:"mattina", P:"pomeriggio", N:"notte" };
        const celle = altUC.alt.celleCoperte;
        const nc = celle.length;
        const cLbl = celle.slice(0,4).map(c=>`G${c.g} ${FL[c.f]}`).join(", ") + (nc>4?` +${nc-4}`:"");
        const wp = altUC.alt.weekendPersi;
        const wLbl = wp.slice(0,4).map(w=>`${w.nome.split(" ").pop()} ${w.da}→${w.a}${w.a===0?" ⚠":""}`).join(", ") + (wp.length>4?` +${wp.length-4}`:"");
        const azzera = wp.some(w=>w.a===0);
        return (
          <div className="np" style={{position:"fixed",top:"66px",left:"50%",transform:"translateX(-50%)",zIndex:901,
            background:"#ffffff",border:"1px solid #c2410c",color:"#0f172a",borderRadius:"10px",
            padding:"12px 14px",fontSize:"12px",fontFamily:"monospace",boxShadow:"0 10px 30px #0f172a26",
            maxWidth:"440px",width:"calc(100% - 32px)"}}>
            <div style={{fontWeight:700,color:"#c2410c",marginBottom:"6px"}}>
              Variante disponibile (ultima chance)
            </div>
            <div style={{marginBottom:"4px"}}>
              <span style={{color:"#047857"}}>+{nc} {nc===1?"cella coperta":"celle coperte"}</span>: {cLbl}
            </div>
            {wp.length>0 && (
              <div style={{marginBottom:"8px",color:azzera?"#be123c":"#b45309"}}>
                Costo weekend liberi: {wLbl}
              </div>
            )}
            <div style={{fontSize:"10px",color:"#64748b",marginBottom:"9px"}}>
              Il tabellone mostrato è quello sicuro. Applicando la variante copri più celle spendendo i weekend indicati.
            </div>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={applicaAltUC}
                style={{background:"#c2410c",color:"#fff",border:"none",borderRadius:"6px",padding:"7px 14px",
                  cursor:"pointer",fontSize:"11px",fontWeight:700,fontFamily:"monospace"}}>Applica variante</button>
              <button onClick={()=>setAltUC(null)}
                style={{background:"#e2e8f0",color:"#64748b",border:"1px solid #cbd5e1",borderRadius:"6px",padding:"7px 14px",
                  cursor:"pointer",fontSize:"11px",fontFamily:"monospace"}}>Mantieni sicuro</button>
            </div>
          </div>
        );
      })()}

      {/* PANNELLO DIAGNOSI COPERTURA (v0.3.10) — impossibilità certificate (⊘)
          e celle mai coperte in nessun tentativo (⚠). Solo lettura: aiuta a
          capire PERCHÉ certi buchi restano, senza toccare la generazione. */}
      {tab==="cal" && (nCert>0 || maiCoperte.length>0 || causVis.length>0 || !!diagStat.bilancio || spiegaWk.length>0 || bilNotti.tirato || !!diagWk) && (()=>{
        const FL: Record<string,string> = { M:"mattine", P:"pomeriggi", N:"notte" };
        const gLbl = (g:number)=>`${DF[dowOf(anno,mese,g)].slice(0,3)} ${g}`;
        // "mai coperte" raggruppate per giorno: "Mar 4: mattine · pomeriggi"
        const maiByG = new Map<number,string[]>();
        for(const c of maiCoperte){ const l=maiByG.get(c.g)||[]; l.push(FL[c.f]); maiByG.set(c.g,l); }
        return (
          <div className="np" style={{margin:"8px 12px 0",background:"#ffffff",border:"1px solid #6d28d9",
            borderRadius:"10px",fontFamily:"monospace",fontSize:"11px",color:"#0f172a",overflow:"hidden"}}>
            <div onClick={()=>setDiagOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:"8px",
              padding:"8px 12px",cursor:"pointer",userSelect:"none"}}>
              <span style={{color:"#6d28d9",fontWeight:700}}>Diagnosi</span>
              {diagStat.bilancio && <span style={{color:"#be123c"}}>&#9650; bilancio &#8722;{diagStat.bilancio.servono-diagStat.bilancio.disponibili} turni</span>}
              {nCert>0 && <span style={{color:"#6d28d9"}}>&#8856; {nCert} impossibil{nCert===1?"e certificata":"i certificate"}</span>}
              {maiCoperte.length>0 && <span style={{color:"#b45309"}}>&#9888; {maiCoperte.length} mai copert{maiCoperte.length===1?"a":"e"} in {diagGen?.tentativi} tentativi</span>}
              {causVis.length>0 && <span style={{color:"#047857"}}>&#9670; {causVis.length} caus{causVis.length===1?"a individuata":"e individuate"}</span>}
              {bilNotti.tirato && <span style={{color:"#2563eb"}}>&#9790; notti: margine {bilNotti.margine}</span>}
              {spiegaWk.length>0 && <span style={{color:"#be185d"}}>&#9671; weekend liberi: {spiegaWk.map(x=>`${x.nome} ${x.liberi}/${x.obiettivo}`).join(", ")}</span>}
              {diagWk?.stato==="incorso" && <span style={{color:"#64748b"}}>· analisi in corso…</span>}
              <span style={{marginLeft:"auto",color:"#64748b"}}>{diagOpen?"▾":"▸"}</span>
            </div>
            {diagOpen && (
              <div style={{padding:"0 12px 10px",borderTop:"1px solid #e2e8f0"}}>
                {diagStat.bilancio && (
                  <div style={{marginTop:"8px"}}>
                    <div style={{color:"#be123c",fontWeight:700,fontSize:"10px",marginBottom:"4px"}}>&#9650; BILANCIO DEL MESE — gli obiettivi non bastano a coprire il fabbisogno</div>
                    <div style={{color:"#be123c",margin:"3px 0"}}>&#8226; {diagStat.bilancio.motivo}</div>
                  </div>
                )}
                {(diagStat.giorni.length>0||diagStat.celle.length>0||diagStat.mese.length>0) && (
                  <div style={{marginTop:"8px"}}>
                    <div style={{color:"#6d28d9",fontWeight:700,fontSize:"10px",marginBottom:"4px"}}>&#8856; CERTIFICATE (dimostrate dai turni manuali e dalle regole — nessuna generazione potrà coprirle)</div>
                    {diagStat.giorni.map((d,i)=><div key={"g"+i} style={{color:"#6d28d9",margin:"3px 0"}}>&#8226; {d.motivo}</div>)}
                    {diagStat.celle.map((c,i)=><div key={"c"+i} style={{color:"#6d28d9",margin:"3px 0"}}>&#8226; {c.motivo}</div>)}
                    {diagStat.mese.map((m,i)=><div key={"m"+i} style={{color:"#6d28d9",margin:"3px 0"}}>&#8226; {m.motivo}</div>)}
                  </div>
                )}
                {maiByG.size>0 && (
                  <div style={{marginTop:"8px"}}>
                    <div style={{color:"#b45309",fontWeight:700,fontSize:"10px",marginBottom:"4px"}}>&#9888; MAI COPERTE — scoperte in TUTTI i {diagGen?.tentativi} tentativi: quasi certamente incompatibili con gli altri vincoli (assenze e turni dei giorni vicini)</div>
                    {[...maiByG.entries()].sort((x,y)=>x[0]-y[0]).map(([g,fl])=>
                      <div key={g} style={{color:"#92400e",margin:"3px 0"}}>&#8226; {gLbl(g)}: {fl.join(" · ")}</div>)}
                  </div>
                )}
                {/* DIAGNOSI CAUSALE (v0.3.13) — il VERO problema dietro i buchi:
                    analisi controfattuale per finestre sull'ultimo tabellone
                    generato. Ogni voce indica il cluster di giorni, la causa
                    (vincolo determinante / conflitto globale / deficit
                    materiale) e, quando trovato, il collo di bottiglia. */}
                {causVis.length>0 && (
                  <div style={{marginTop:"8px"}}>
                    <div style={{color:"#047857",fontWeight:700,fontSize:"10px",marginBottom:"4px"}}>&#9670; CAUSA PROBABILE — analisi dei giorni attorno ai buchi dell'ultima generazione: qual &#232; il blocco REALE (spesso a monte della cella dichiarata scoperta)</div>
                    {causVis.map((cl,i)=>(
                      <div key={"cs"+i} style={{margin:"3px 0 6px"}}>
                        <div style={{color:"#047857"}}>&#8226; {cl.motivo}</div>
                        {cl.dettagli.map((d,j)=>
                          <div key={j} style={{color:"#267559",margin:"2px 0 0 12px",fontSize:"10px"}}>&#8627; {d}</div>)}
                      </div>
                    ))}
                    {diagCaus && !diagCaus.completa && (
                      <div style={{color:"#64748b",fontSize:"9px"}}>Analisi interrotta per limite di tempo: alcune finestre potrebbero non essere state esaminate.</div>
                    )}
                  </div>
                )}
                {/* NOTTI E WEEKEND LIBERI (v0.3.47) */}
                {(bilNotti.tirato || spiegaWk.length>0) && (()=>{
                  const obbl = bilNotti.medici.filter(x=>x.minimo>0);
                  return (
                    <div style={{marginTop:"8px"}}>
                      <div style={{color:"#2563eb",fontWeight:700,fontSize:"10px",marginBottom:"4px"}}>&#9790; NOTTI DEL MESE — dai soli turni inseriti a mano</div>
                      <div style={{color:"#1e3a8a",margin:"3px 0"}}>&#8226; Notti di reparto da coprire: <b>{bilNotti.daCoprire}</b> · la squadra ne può fare al massimo <b>{bilNotti.capacita}</b> · margine <b style={{color:bilNotti.tirato?"#be123c":"#1e3a8a"}}>{bilNotti.margine}</b>{bilNotti.tirato?" (mese tirato sulle notti)":""}</div>
                      <div style={{color:"#2563eb",margin:"2px 0 0 12px",fontSize:"10px"}}>
                        &#8627; Al massimo: {bilNotti.medici.map(x=>`${x.nome} ${x.tetto}${x.limite==="obiettivo"?" (obiettivo)":x.limite==="giorni"?" (giorni liberi)":""}${x.manuali.length?` — già ${x.manuali.join(", ")}`:""}`).join(" · ")}
                      </div>
                      {obbl.length>0 && <div style={{color:"#2563eb",margin:"2px 0 0 12px",fontSize:"10px"}}>&#8627; Devono fare almeno: {obbl.map(x=>`${x.nome} ${x.minimo}`).join(" · ")}</div>}
                      {spiegaWk.length>0 && (
                        <div style={{marginTop:"8px"}}>
                          <div style={{color:"#be185d",fontWeight:700,fontSize:"10px",marginBottom:"4px"}}>&#9671; WEEKEND LIBERI MANCANTI — perché i turni di weekend non sono passati a un collega (spostamento diretto, sull'ultimo tabellone)</div>
                          {spiegaWk.map(x=>(
                            <div key={x.id} style={{margin:"3px 0 6px"}}>
                              <div style={{color:"#391329"}}>&#8226; {x.nome}: {x.liberi}/{x.obiettivo} weekend liberi</div>
                              {x.weekend.map(w=>(
                                <div key={w.sab} style={{margin:"2px 0 0 12px",fontSize:"10px",color:"#39132a"}}>
                                  &#8627; sab {w.sab}–dom {w.dom}: {w.turni.map(t=>`${t.tipo} ${t.g===w.sab?"sab":"dom"}${t.man?" (inserito a mano)":""}`).join(", ")}
                                  {w.turni.filter(t=>t.motivi.length).map((t,j)=>(
                                    <div key={j} style={{margin:"1px 0 0 12px",color:"#632c4c"}}>{t.tipo} {t.g===w.sab?"sab":"dom"} — {t.motivi.join(" · ")}</div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {diagWk && (
                  <div style={{marginTop:"8px"}}>
                    <div style={{color:"#0f766e",fontWeight:700,fontSize:"10px",marginBottom:"4px"}}>&#10003; COSA SERVIREBBE — il mese rigenerato con una modifica alla volta (ogni prova ripetuta; indicativo)</div>
                    {diagWk.stato==="incorso" && <div style={{color:"#64748b",margin:"3px 0"}}>Analisi in corso, circa 10–20 secondi…</div>}
                    {diagWk.stato==="fatto" && diagWk.esito && (()=>{
                      const e = diagWk.esito;
                      if(e.base.deficit===0) return <div style={{color:"#0f766e",margin:"3px 0"}}>&#8226; Rigenerando senza modifiche si è trovato un tabellone senza avvisi sui weekend: prova a rigenerare (①).</div>;
                      const ris = e.prove.filter(p=>p.risolve), mig = e.prove.filter(p=>!p.risolve && p.migliora);
                      return (<>
                        {ris.map((p,i)=><div key={"r"+i} style={{color:"#0f766e",margin:"3px 0"}}>&#10003; {p.etichetta}: nessun weekend libero mancante.</div>)}
                        {mig.map((p,i)=><div key={"m"+i} style={{color:"#133928",margin:"3px 0"}}>&#9680; {p.etichetta}: weekend liberi mancanti da {e.base.deficit} a {p.deficit}.</div>)}
                        {ris.length+mig.length===0 && <div style={{color:"#475569",margin:"3px 0"}}>&#8226; Nessuna delle prove elimina l'avviso: il mese è stretto per la combinazione di assenze e turni manuali.</div>}
                        <div style={{color:"#64748b",fontSize:"9px",marginTop:"2px"}}>Sono solo indicazioni: il tabellone non è stato modificato. Prove: {e.prove.map(p=>p.etichetta).join(" · ")}.</div>
                      </>);
                    })()}
                  </div>
                )}
                <div style={{marginTop:"8px",fontSize:"9px",color:"#64748b"}}>
                  I badge &#8856;/&#9888; compaiono anche sulla riga Copertura M&#183;P&#183;N in fondo al calendario. La diagnosi &#232; solo informativa: non cambia come il motore genera.
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* CALENDARIO */}
      {tab==="cal"&&(
        <div ref={calRef} style={{overflowX:"auto"}}>
          <table style={{borderCollapse:"collapse",width:"100%",minWidth:`${200+nd*35}px`,fontSize:"10px"}}>
            <thead>
              <tr>
                <th colSpan={2} style={{...TH,textAlign:"left",padding:"6px 10px",color:"#1d4ed8",fontSize:"11px",minWidth:"200px"}}>
                  {MESI[mese].toLowerCase()} {anno}
                </th>
                {giorni.map(g=>{
                  const mt=metaG(g);
                  return <th key={g} style={{...TH,background:mt.h?"#fff1f2":mt.sat||mt.dom?"#eef2ff":"#f8fafc",color:mt.h?"#dc2626":mt.sat||mt.dom?"#6d28d9":"#334155",minWidth:"34px",fontSize:"10px",fontWeight:700}}>{g}</th>;
                })}
                <th style={{...TH,minWidth:"34px",fontSize:"9px"}}>Tot</th>
                <th style={{...TH,minWidth:"34px",fontSize:"9px"}}>Ob.</th>
                <th style={{...TH,minWidth:"28px",fontSize:"9px",color:"#5412c5"}}>WkL</th>
                <th style={{...TH,minWidth:"28px",fontSize:"9px",color:"#059669"}}>Amb</th>
              </tr>
              <tr>
                <th colSpan={2} style={TH}/>
                {giorni.map(g=>{
                  const mt=metaG(g);
                  return <th key={g} style={{...TH,background:mt.h?"#fff1f2":mt.sat||mt.dom?"#eef2ff":"#f8fafc",color:mt.h?"#dc2626":mt.sat||mt.dom?"#6d28d9":"#94a3b8",fontSize:"8px"}}>{DL[mt.d]}</th>;
                })}
                <th colSpan={4} style={TH}/>
              </tr>
            </thead>
            <tbody>
              {medici.map(med=>{
                const tot=cntM(med.id), sc=SC[med.stato]||{bg:"",t:"",b:""};
                const ov=tot>med.obiettivo&&med.stato!=="MPS", un=tot<med.obiettivo&&med.stato!=="MPS";
                const wkLib=cntWkLiberi(med.id), ambN=cntAmb(med.id);
                return (
                  <tr key={med.id}>
                    <td style={{background:"#f8fafc",border:"1px solid #e2e8f0",padding:"3px 8px",whiteSpace:"nowrap",fontWeight:700,fontSize:"10px",color:"#0f172a",fontFamily:"monospace"}}>{med.nome}</td>
                    <td style={{background:sc.bg,border:"1px solid #e2e8f0",padding:"2px 4px",textAlign:"center",fontFamily:"monospace",fontSize:"8px"}}>
                      {med.codice&&<div style={{color:sc.t,opacity:.6,fontSize:"7px"}}>{med.codice}</div>}
                      <div style={{color:sc.t,fontWeight:700}}>{med.stato}</div>
                    </td>
                    {giorni.map(g=>{
                      const mt=metaG(g);
                      const ct=gT(med.id,g);
                      const hX=ct.some(s=>s.tipo==="X"), vis=ct.filter(s=>s.tipo!=="X");
                      const bg=hX?"#f1f1f4":mt.h?"#fff1f2":mt.sat||mt.dom?"#eef2ff":"#ffffff";
                      const eqCambiata = !!eqRes && eqRes.esito.celle.some(x=>x.id===med.id && x.g===g);
                      return (
                        <td key={g} onClick={editabile ? ()=>setCella({id:med.id,g}) : undefined}
                          style={{background:bg,border:"1px solid #e2e8f0",boxShadow:eqCambiata?"inset 0 0 0 2px #2dd4bf":undefined,padding:"1px 2px",textAlign:"center",cursor:editabile?"pointer":"default",minWidth:"34px",height:"25px",verticalAlign:"middle",transition:"background .08s"}}
                          onMouseEnter={editabile ? e=>e.currentTarget.style.background="#bfdbfe" : undefined}
                          onMouseLeave={editabile ? e=>e.currentTarget.style.background=bg : undefined}>
                          <div style={{display:"flex",gap:"1px",justifyContent:"center",flexWrap:"wrap"}}>
                            {hX && <span style={{color:KC.X.t,fontWeight:700,fontSize:"11px",fontFamily:"monospace"}}>/</span>}
                            {vis.map((s,i)=><Badge key={i} tipo={s.tipo} sott={s.sott} man={s.man} lbl={etichettaTurno(s,regole.ambulatori)}/>)}
                          </div>
                        </td>
                      );
                    })}
                    <td style={{background:ov?"#fff1f2":un?"#f1f9f1":"#f8fafc",border:"1px solid #e2e8f0",padding:"2px 5px",textAlign:"center",fontWeight:700,fontSize:"12px",color:ov?"#be123c":un?"#047857":"#0f172a",fontFamily:"monospace"}}>{tot}</td>
                    <td style={{background:"#f8fafc",border:"1px solid #e2e8f0",padding:"2px 5px",textAlign:"center",color:"#64748b",fontSize:"11px",fontFamily:"monospace"}}>{med.stato==="MPS"?"—":med.obiettivo}</td>
                    <td style={{background:"#f5f3ff",border:"1px solid #e2e8f0",padding:"2px 4px",textAlign:"center",fontWeight:700,fontSize:"11px",color:wkLib>=2?"#6d28d9":wkLib===1?"#5412c5":"#64748b",fontFamily:"monospace"}}>{med.stato==="MPS"?"—":wkLib}</td>
                    <td style={{background:"#ecfdf5",border:"1px solid #e2e8f0",padding:"2px 4px",textAlign:"center",fontWeight:700,fontSize:"11px",color:(abilitatoQualche(med,regole.ambulatori)||ambN>0)?ambN>0?"#047857":"#065f46":"#e2e8f0",fontFamily:"monospace"}}>{(abilitatoQualche(med,regole.ambulatori)||ambN>0)?ambN:"—"}</td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={2} style={{...TH,textAlign:"left",padding:"4px 8px",fontSize:"8px",color:"#94a3b8"}}>Copertura M·P·N</td>
                {giorni.map(g=>{
                  const mt=metaG(g);
                  // Giorno d'ambulatorio FERIALE (segue regole.ambulatori): un
                  // quadratino per slot (ambulatorio × mattina/pomeriggio) con il
                  // codice del medico assegnato, o "sigla?" se manca. undefined =
                  // giorno senza ambulatori, niente quadratino.
                  const sls = ambSlotsApp(g);
                  const ambSlot = sls.length ? sls.map(sl=>{
                    const a = regole.ambulatori.find(x=>x.id===sl.amb);
                    return { cod: sl.cod, sigla: etichettaTurno({tipo:sl.cod,amb:sl.amb}, regole.ambulatori),
                             nome: a?.nome ?? "Ambulatorio", med: chiSlot(g,sl)?.codice ?? null };
                  }) : undefined;
                  return (
                    <td key={g} style={{background:"#ffffff",border:"1px solid #e2e8f0",padding:"3px 1px",textAlign:"center",verticalAlign:"top"}}>
                      <CovDots mc={cfApp(g,"M")} pc={cfApp(g,"P")} nc={cfApp(g,"N")} sp={mt.sp} sat={mt.sat} fabb={regole.fabb}
                        diag={{M:diagFlag(g,"M"),P:diagFlag(g,"P"),N:diagFlag(g,"N")}}
                        amb={ambSlot}/>
                    </td>
                  );
                })}
                <td colSpan={4} style={{background:"#f8fafc",border:"1px solid #e2e8f0"}}/>
              </tr>
              {/* BILANCIO DEL MESE — L+P · S · D · F. Solo F cambia colore: è il
                  verdetto (D ≥ F ⇒ il fabbisogno è copribile). */}
              {(()=>{
                const b = bil;
                const KPI = (lbl:string,val:number,bg:string,col:string,ttl:string,onClick?:()=>void)=>(
                  <td title={ttl} onClick={onClick} style={{background:bg,border:"1px solid #e2e8f0",padding:"2px 3px",
                    textAlign:"center",fontFamily:"monospace",lineHeight:1.15,color:col,
                    cursor:onClick?"pointer":"help",userSelect:"none"}}>
                    <div style={{fontSize:"7px",letterSpacing:".06em",opacity:.8}}>{lbl}{onClick&&" ⓘ"}</div>
                    <div style={{fontSize:"12px",fontWeight:700}}>{val}</div>
                  </td>
                );
                return (
                  <tr>
                    <td colSpan={2+nd} style={{background:"#f8fafc",border:"1px solid #e2e8f0",textAlign:"right",
                      padding:"2px 8px",fontSize:"8px",color:"#94a3b8",letterSpacing:".12em",fontFamily:"monospace"}}>
                      BILANCIO MESE ▸
                    </td>
                    {KPI("L+P",b.lp,"#fbf7ee","#b45309","Licenze e permessi manuali (L + 104 + p11 + ANA). Gli MPS sono esclusi: non hanno obiettivo.")}
                    {KPI("S",b.s,"#eff6ff","#2563eb","Somma degli obiettivi mensili dei medici.")}
                    {KPI("D",b.d,"#f1f5f9","#0f172a",`Turni lavorabili in reparto: S − (L+P) − PS. Turni di PS scalati: ${b.ps}.`)}
                    {KPI("F",b.f,b.ok?"#ecfdf5":"#fff1f2",b.ok?"#047857":"#be123c",
                      "Tocca per il dettaglio del fabbisogno", ()=>setFabbAperto(true))}
                  </tr>
                );
              })()}
            </tbody>
          </table>

          <div className="np" style={{padding:"8px 14px",borderTop:"1px solid #e2e8f0",display:"flex",gap:"6px",flexWrap:"wrap",alignItems:"center",marginTop:"4px"}}>
            <span style={{color:"#94a3b8",fontSize:"8px",marginRight:"4px"}}>LEGENDA:</span>
            {[["M","Mattina"],["P","Pomeriggio"],["N","Notte"],["L","Licenza"],["ANA","Permesso"],["104","L.104"],["per11","Art.11"],["art37","Art.37"],["X","Escluso"],["Xm","No mattina"],["Xp","No pomeriggio"],["Xn","No notte"]].map(([tipo,desc])=>(
              <div key={tipo} style={{display:"flex",alignItems:"center",gap:"3px"}}>
                <Badge tipo={tipo} man/><span style={{color:"#64748b",fontSize:"8px"}}>{desc}</span>
              </div>
            ))}
            {regole.ambulatori.map(a=>(
              <div key={a.id} style={{display:"flex",alignItems:"center",gap:"3px"}}>
                <Badge tipo="A" man lbl={a.sigla}/><Badge tipo="Ap" man lbl={a.sigla+"p"}/>
                <span style={{color:"#64748b",fontSize:"8px"}}>{a.nome} (matt./pom.)</span>
              </div>
            ))}
            <div style={{display:"flex",alignItems:"center",gap:"3px"}}>
              <Badge tipo="3" man lbl="3*"/><span style={{color:"#64748b",fontSize:"8px"}}>PS in altro ospedale</span>
            </div>
            <span style={{color:"#94a3b8",fontSize:"8px",marginLeft:"8px"}}>pieno=manuale · semitrasparente=auto</span>
          </div>
        </div>
      )}

      {/* MEDICI */}
      {tab==="medici"&&(
        <div className="np" style={{padding:"16px",maxWidth:"700px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
            <span style={{fontSize:"13px",fontWeight:700,color:"#0f172a"}}>Gestione Medici</span>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={copiaRiepilogo}
                style={{background:"#f1f5f9",color:"#6d28d9",border:"1px solid #6d28d9",borderRadius:"6px",padding:"6px 13px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace",fontWeight:700}}>
                📋 Copia riepilogo
              </button>
              <button onClick={()=>setEditDoc({nome:"",codice:"",stato:"MR",obiettivo:25,ambulatorio:false})}
                style={{background:"#ecfdf5",color:"#047857",border:"1px solid #16a34a",borderRadius:"6px",padding:"6px 13px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace",fontWeight:700}}>
                ➕ Aggiungi
              </button>
            </div>
          </div>
          {/* Card medici (stile D): un'unica griglia sostituisce riepilogo + righe */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:"8px"}}>
            {medici.map(m=>{
              const sc=SC[m.stato]||{bg:"",t:"",b:""}, tot=cntM(m.id);
              const wkLib=cntWkLiberi(m.id), ambN=cntAmb(m.id), psN=cntPS(m.id), r=rieM(m.id), pm=cntPerm(m.id);
              const straN=cntStra(m.id), alpiN=cntALPI(m.id);
              const permTxt = PERM.filter(k=>pm.det[k]).map(k=>`${k}${pm.det[k]}`).join("·");
              const RIGA: React.CSSProperties = {display:"flex",justifyContent:"space-between",alignItems:"baseline",fontSize:"10px",color:"#64748b",padding:"2.5px 0",fontFamily:"monospace"};
              const SEG: React.CSSProperties = {flex:1,textAlign:"center",fontSize:"10px",padding:"4px 0",background:"#f1f5f9",fontFamily:"monospace"};
              return (
                <div key={m.id} style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:"8px",padding:"10px 12px",display:"flex",flexDirection:"column"}}>
                  {/* intestazione: nome + badge + azioni */}
                  <div style={{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap",paddingBottom:"7px",marginBottom:"7px",borderBottom:"1px solid #e2e8f0"}}>
                    <span style={{fontWeight:700,color:"#0f172a",fontSize:"11px",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nome}</span>
                    {regole.ambulatori.filter(x=>abilitatoAmb(m,x.id)).map(x=>
                      <span key={x.id} title={"Abilitato: "+x.nome} style={{background:"#ecfdf5",color:"#047857",border:"1px solid #059669",borderRadius:"3px",padding:"1px 5px",fontSize:"8px",fontWeight:700}}>{x.sigla}</span>)}
                    {m.noNotti && (m.stato==="MR"||m.stato==="MDC") &&
                      <span title="Esentato dalle notti: il motore non gliene assegna" style={{background:"#f5f3ff",color:"#6d28d9",border:"1px solid #6d28d9",borderRadius:"3px",padding:"1px 5px",fontSize:"8px",fontWeight:700}}>no notti</span>}
                    {!m.noNotti && m.maxNotti!==undefined && m.maxNotti<regole.maxNotti && (m.stato==="MR"||m.stato==="MDC") &&
                      <span title={`Al massimo ${m.maxNotti} notti al mese (scheda medico; nelle Regole ${regole.maxNotti})`} style={{background:"#f5f3ff",color:"#6d28d9",border:"1px solid #6d28d9",borderRadius:"3px",padding:"1px 5px",fontSize:"8px",fontWeight:700}}>max {m.maxNotti} N</span>}
                    <span style={{background:sc.bg,color:sc.t,border:`1px solid ${sc.b}`,borderRadius:"3px",padding:"1px 6px",fontSize:"9px",fontWeight:700}}>{m.stato}</span>
                    <button onClick={()=>setEditDoc(m)} style={{background:"#e2e8f0",color:"#1d4ed8",border:"1px solid #cbd5e1",borderRadius:"4px",padding:"2px 7px",cursor:"pointer",fontSize:"10px"}}>✏</button>
                    <button onClick={()=>eliminaDoc(m)}
                      style={{background:delDoc===m.id?"#fecdd3":"#fff1f2",color:delDoc===m.id?"#fff":"#be123c",border:"1px solid #fecdd3",borderRadius:"4px",padding:"2px 7px",cursor:"pointer",fontSize:"10px",fontWeight:700,fontFamily:"monospace"}}>
                      {delDoc===m.id?"Conferma ✕":"✕"}
                    </button>
                  </div>
                  {/* turni / obiettivo */}
                  <div style={RIGA}>
                    <span>{m.codice||"—"} · Turni</span>
                    <span style={{color:"#0f172a",fontWeight:700}}>{tot}{m.stato!=="MPS"&&<span style={{color:"#64748b",fontWeight:400}}> / {m.obiettivo}</span>}</span>
                  </div>
                  {/* blocchetto M/P/N a segmenti */}
                  <div style={{display:"flex",border:"1px solid #e2e8f0",borderRadius:"5px",overflow:"hidden",margin:"6px 0 3px"}}>
                    <span style={{...SEG,color:"#1d4ed8"}}><b style={{display:"block",fontSize:"13px"}}>{r.m}</b>M</span>
                    <span style={{...SEG,color:"#6d28d9",borderLeft:"1px solid #e2e8f0"}}><b style={{display:"block",fontSize:"13px"}}>{r.p}</b>P</span>
                    <span style={{...SEG,color:"#047857",borderLeft:"1px solid #e2e8f0"}}><b style={{display:"block",fontSize:"13px"}}>{r.n}</b>N</span>
                  </div>
                  {/* ORDINE (v0.3.33): totale → straordinari → PS (di cui ALPI)
                      → festivi lavorati → weekend liberi → il resto. Il blocco
                      M/P/N resta attaccato al totale: ne è la scomposizione. */}
                  <div style={RIGA}>
                    <span style={{color:straN>0?"#be185d":"#94a3b8"}}>⏱ Straordinari</span>
                    <b style={{color:straN>0?"#be185d":"#94a3b8"}}>{straN}</b>
                  </div>
                  <div style={RIGA}>
                    <span style={{color:psN>0?"#c2410c":"#94a3b8"}}>🚑 PS</span>
                    <b style={{color:psN>0?"#c2410c":"#94a3b8"}}>
                      {psN}{alpiN>0&&<span style={{color:"#b45309",fontWeight:400}}> · ALPI {alpiN}</span>}
                    </b>
                  </div>
                  <div style={RIGA}><span style={{color:"#a21caf"}}>▦ Festivi lav.</span><b style={{color:"#a21caf"}}>{r.wk}</b></div>
                  {m.stato!=="MPS"&&<div style={RIGA}><span style={{color:"#6d28d9"}}>🗓 Wk liberi</span><b style={{color:"#6d28d9"}}>{wkLib}</b></div>}
                  {(abilitatoQualche(m,regole.ambulatori)||ambN>0)&&<div style={RIGA}><span style={{color:"#047857"}}>🏥 Ambulatorio</span><b style={{color:"#047857"}}>{ambN}</b></div>}
                  <div style={RIGA}>
                    <span style={{color:pm.tot>0?"#b45309":"#94a3b8"}}>📋 Permessi</span>
                    <b style={{color:pm.tot>0?"#b45309":"#94a3b8"}}>{pm.tot}{pm.tot>0&&<span style={{color:"#a16207",fontWeight:400}}> {permTxt}</span>}</b>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FESTIVI (v0.3.60) */}
      {tab==="festivi"&&(
        <FestiviPanel medici={medici} turniAll={turniAll} regole={regole} stato={festivi} onStato={updFestivi}
          onTurniMese={(k,T)=>setTurniAll(prev=>({...prev,[k]:T}))}
          editabile={editabile} avviso={showMsg} apriRegole={()=>setTab("regole")}/>
      )}

      {/* DESIDERATE (v0.3.64) */}
      {tab==="desiderate"&&editabile&&(
        <DesideratePanel medici={medici} turniAll={turniAll} onTurniMese={(k,T)=>setTurniAll(prev=>({...prev,[k]:T}))}
          stato={desiderate} onStato={updDesiderate} annoIniziale={anno} meseIniziale={mese} avviso={showMsg}
          pianoFestiviDaInserire={festivi.piano ? mesiDelPiano(festivi.piano).map(x=>x.chiave).filter(k=>!festivi.inseriti[k]) : []}/>
      )}

      {/* REGOLE */}
      {tab==="regole"&&(()=>{
        const numInp = (val:number,onCh:(v:number)=>void) => (
          <input type="number" min={0} max={9} value={val}
            onChange={e=>onCh(Math.max(0,Math.min(9,+e.target.value||0)))}
            style={{width:"52px",background:"#ffffff",border:"1px solid #cbd5e1",color:"#1d4ed8",borderRadius:"6px",padding:"5px 7px",fontSize:"12px",fontFamily:"monospace",textAlign:"center"}}/>
        );
        type Fascia = "fer"|"sab"|"fest";
        type CampoFabb = "mMin"|"mMax"|"pMin"|"pMax";
        const setFabb = (fascia:Fascia,campo:CampoFabb,v:number) => {
          const f={...regole.fabb[fascia],[campo]:v};
          // coerenza min ≤ max: alzando il min si trascina il max e viceversa
          if(campo.endsWith("Min") && f[campo.replace("Min","Max") as CampoFabb]<v) f[campo.replace("Min","Max") as CampoFabb]=v;
          if(campo.endsWith("Max") && f[campo.replace("Max","Min") as CampoFabb]>v) f[campo.replace("Max","Min") as CampoFabb]=v;
          updRegole({...regole,fabb:{...regole.fabb,[fascia]:f}});
        };
        type CampoTop = "maxNotti"|"maxNottiConsec"|"maxConsec"|"wkTarget"|"maxAssSett"|"blocchiMattina"|"rotazioneFestiviMesi"|"equitaNottiMesi"|"equitaWeekendMesi";
        const setTop = (campo:CampoTop,v:number) => updRegole({...regole,[campo]:v});
        const LBL: React.CSSProperties = {color:"#64748b",fontSize:"10px",fontFamily:"monospace"};
        const BOX: React.CSSProperties = {background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:"8px",padding:"14px",marginBottom:"12px"};
        const righe: [Fascia,string][] = [["fer","Feriale"],["sab","Sabato"],["fest","Domenica / Festivo"]];
        // maxNotti e maxNottiConsec sono migrati nel box REGOLA DELLA NOTTE
        // (v0.3.33): tutto ciò che riguarda le notti sta ora in un posto solo.
        const NUM_NOTTE: [CampoTop,string,string][] = [
          ["maxNotti","Max notti / mese","Tetto di notti per medico nel mese. Contano tutte le notti già in tabellone — N e 3, anche sottolineate — più quelle assegnate in automatico. Nella scheda di un medico se ne può impostare uno più basso, solo per lui."],
          ["maxNottiConsec","Max notti di fila","Notti ravvicinate (una sola notte libera in mezzo: N-libero-N-libero-N) oltre le quali la successiva è vietata. 2 = ammesse due notti così, la terza no."],
        ];
        // Varianti della Regola N. `spegne` = le regole in conflitto, disattivate
        // quando questa si accende. «Notte» (N a g+2) e «Mattina» (M a g+2) sono
        // ORTOGONALI e convivono; il riposo esteso le neutralizza entrambe.
        type CampoNotte = "notteLiberoNotte"|"mattinaDopoNotte"|"riposoEsteso";
        const TOGGLE_NOTTE: {k:CampoNotte; lbl:string; hint:string; spegne:CampoNotte[]}[] = [
          { k:"notteLiberoNotte", lbl:"Notte — notte → libero → notte", spegne:["riposoEsteso"],
            hint:"Due giorni dopo una notte è ammessa un'altra Notte, già nella generazione di base, e il pattern non è più segnalato come violazione. Resta il tetto «Max notti di fila». Se spento, la deroga resta a disposizione della sola ultima chance." },
          { k:"mattinaDopoNotte", lbl:"Mattina", spegne:["riposoEsteso"],
            hint:"Due giorni dopo una notte è ammessa anche una Mattina (M, A o 1), non solo il Pomeriggio: vale in generazione, nell'inserimento manuale e nella validazione. Indipendente dall'opzione «Notte»: si possono tenere attive entrambe." },
          { k:"riposoEsteso", lbl:"Nulla — riposo esteso", spegne:["notteLiberoNotte","mattinaDopoNotte"],
            hint:"Dopo una Notte anche il SECONDO giorno resta completamente libero: nessun turno, ammessi solo X, ANA, per11, art37, 104 o L. Vieta quindi anche il Pomeriggio. Vincolo duro: prevale sulle altre due opzioni e non viene mai derogato, nemmeno dall'ultima chance." },
        ];
        const HINT_BLOCCHI = "Nei giorni SENZA mattina del ML (assenze, domeniche, festivi) una catena di medici dà continuità: il primo affianca l'ultima mattina del ML, ogni blocco dura ~N giorni e il successivo inizia nel suo ultimo giorno (passaggio di consegne), l'ultimo accompagna il rientro del ML. Solo entro il fabbisogno MINIMO; preferenza, mai vincolante: non toglie weekend liberi né altro. 0 = disattivata.";
        const limiti: [CampoTop,string,string][] = [
          ["maxConsec","Max giorni consecutivi di lavoro","Giorni lavorati di fila oltre i quali serve un giorno libero (vale anche a cavallo di mese)."],
          ["wkTarget","Obiettivo weekend liberi","Resta ADATTIVO al mese: questo è il tetto (2 con ≥4 coppie sab-dom, meno nei mesi corti)."],
          ["maxAssSett","Max turni associati / settimana","Massimo di giorni con mattina e pomeriggio (anche di PS o sottolineati) per medico, per settimana."],
        ];
        return (
          <div className="np" style={{padding:"16px",maxWidth:"640px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
              <span style={{fontSize:"13px",fontWeight:700,color:"#0f172a"}}>Regole del reparto</span>
              <button onClick={()=>updRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), reparto: regole.reparto, coperturaSoloVuoti: regole.coperturaSoloVuoti, festiviPiano: regole.festiviPiano })}
                style={{background:"#fff1f2",color:"#be123c",border:"1px solid #fecdd3",borderRadius:"6px",padding:"6px 13px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace",fontWeight:700}}>
                Ripristina default
              </button>
            </div>
            <div style={{...LBL,marginBottom:"12px",lineHeight:1.6}}>
              Le modifiche sono salvate subito e usate dalla PROSSIMA generazione (①/②).
              La <b>Notte</b> resta fissa a 1/giorno: è un invariante dell'algoritmo, non un parametro.
            </div>

            <div style={{...LBL,fontWeight:700,color:"#2563eb",letterSpacing:".08em",margin:"4px 0 8px"}}>DA CONTROLLARE OGNI MESE</div>
            <div style={BOX}>
              <div style={{...LBL,fontWeight:700,marginBottom:"10px",color:"#1d4ed8"}}>LIMITI PER MEDICO</div>
              {limiti.map(([k,lbl,hint])=>(
                <div key={k} style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"10px"}}>
                  {numInp(regole[k],v=>setTop(k,v))}
                  <div>
                    <div style={{...LBL,color:"#0f172a",fontWeight:700}}>{lbl}</div>
                    <div style={{...LBL,fontSize:"9px"}}>{hint}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* ── REGOLA DELLA NOTTE (v0.3.33) ────────────────────────────────
                Tutte le varianti della Regola N in un solo box a tendina. La
                riga di riepilogo resta sempre visibile: dice a colpo d'occhio
                cosa è ammesso a g+2, senza dover aprire nulla. */}
            <div style={BOX}>
              <div onClick={()=>setNottiAperto(v=>!v)}
                   style={{display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",userSelect:"none"}}>
                <span style={{color:"#1d4ed8",fontSize:"11px",width:"12px"}}>{nottiAperto?"▾":"▸"}</span>
                <div style={{flex:1}}>
                  <div style={{...LBL,fontWeight:700,color:"#1d4ed8"}}>REGOLA DELLA NOTTE</div>
                  <div style={{...LBL,fontSize:"9px",marginTop:"2px"}}>
                    g+1 sempre libero · a g+2{" "}
                    <b style={{color:"#0f172a"}}>
                      {regole.riposoEsteso ? "nulla (riposo esteso)"
                        : ["P", regole.mattinaDopoNotte && "M", regole.notteLiberoNotte && "N"]
                            .filter(Boolean).join(" · ")}
                    </b>
                    {" · max "}{regole.maxNotti} notti/mese, {regole.maxNottiConsec} di fila
                  </div>
                </div>
              </div>

              {nottiAperto && (
                <div style={{marginTop:"12px",paddingTop:"12px",borderTop:"1px solid #e2e8f0"}}>
                  <div style={{...LBL,fontSize:"9px",lineHeight:1.6,marginBottom:"12px"}}>
                    Invariante non configurabile: il giorno DOPO una notte (g+1) resta sempre
                    completamente libero. Le opzioni qui sotto riguardano il SECONDO giorno (g+2),
                    dove di base è ammesso il solo Pomeriggio.
                  </div>

                  {NUM_NOTTE.map(([k,lbl,hint])=>(
                    <div key={k} style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"10px"}}>
                      {numInp(regole[k],v=>setTop(k,v))}
                      <div>
                        <div style={{...LBL,color:"#0f172a",fontWeight:700}}>{lbl}</div>
                        <div style={{...LBL,fontSize:"9px"}}>{hint}</div>
                      </div>
                    </div>
                  ))}

                  <div style={{...LBL,fontWeight:700,color:"#1d4ed8",margin:"16px 0 8px"}}>
                    COSA È AMMESSO DUE GIORNI DOPO LA NOTTE (g+2)
                  </div>
                  {TOGGLE_NOTTE.map(({k,lbl,hint,spegne})=>{
                    const on = !!regole[k];
                    return (
                      <div key={k} style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"10px"}}>
                        <button onClick={()=>{
                            const patch: Record<string,boolean> = { [k]: !on };
                            // Accendendo una variante si spengono quelle in
                            // conflitto: il pannello non mostra mai due regole
                            // che si annullano a vicenda.
                            if(!on) for(const alt of spegne) patch[alt] = false;
                            updRegole({...regole,...patch});
                          }}
                          style={{width:"52px",flexShrink:0,background:on?"#ecfdf5":"#ffffff",color:on?"#047857":"#94a3b8",
                                  border:`1px solid ${on?"#059669":"#e2e8f0"}`,borderRadius:"6px",
                                  padding:"5px 0",cursor:"pointer",fontSize:"11px",fontWeight:700,
                                  fontFamily:"monospace"}}>
                          {on?"ON":"OFF"}
                        </button>
                        <div>
                          <div style={{...LBL,color:"#0f172a",fontWeight:700}}>{lbl}</div>
                          <div style={{...LBL,fontSize:"9px"}}>{hint}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={BOX}>
              <div style={{...LBL,fontWeight:700,marginBottom:"10px",color:"#1d4ed8"}}>CONTINUITÀ DELLE MATTINE</div>
              <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
                {numInp(regole.blocchiMattina,v=>setTop("blocchiMattina",v))}
                <div>
                  <div style={{...LBL,color:"#0f172a",fontWeight:700}}>Blocchi di mattine (giorni)</div>
                  <div style={{...LBL,fontSize:"9px"}}>{HINT_BLOCCHI}</div>
                </div>
              </div>
            </div>

            <div style={BOX}>
              <div style={{...LBL,fontWeight:700,marginBottom:"10px",color:"#1d4ed8"}}>FABBISOGNO GIORNALIERO (min–max)</div>
              <table style={{borderCollapse:"collapse",fontFamily:"monospace"}}>
                <thead><tr>
                  <th style={{...LBL,textAlign:"left",padding:"4px 14px 4px 0"}}></th>
                  <th style={{...LBL,padding:"4px 8px"}}>Mattine min</th><th style={{...LBL,padding:"4px 8px"}}>max</th>
                  <th style={{...LBL,padding:"4px 8px"}}>Pomeriggi min</th><th style={{...LBL,padding:"4px 8px"}}>max</th>
                </tr></thead>
                <tbody>
                  {righe.map(([k,lbl])=>(
                    <tr key={k}>
                      <td style={{...LBL,color:"#0f172a",padding:"4px 14px 4px 0"}}>{lbl}</td>
                      <td style={{padding:"4px 8px",textAlign:"center"}}>{numInp(regole.fabb[k].mMin,v=>setFabb(k,"mMin",v))}</td>
                      <td style={{padding:"4px 8px",textAlign:"center"}}>{numInp(regole.fabb[k].mMax,v=>setFabb(k,"mMax",v))}</td>
                      <td style={{padding:"4px 8px",textAlign:"center"}}>{numInp(regole.fabb[k].pMin,v=>setFabb(k,"pMin",v))}</td>
                      <td style={{padding:"4px 8px",textAlign:"center"}}>{numInp(regole.fabb[k].pMax,v=>setFabb(k,"pMax",v))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{...LBL,fontWeight:700,color:"#2563eb",letterSpacing:".08em",margin:"18px 0 8px"}}>IMPOSTAZIONI CHE SI CAMBIANO DI RADO</div>
            <details style={BOX}>
              <summary style={{...LBL,fontWeight:700,color:"#1d4ed8",cursor:"pointer"}}>
                AMBULATORI <span style={{fontWeight:400,color:"#64748b"}}>· {regole.ambulatori.length ? regole.ambulatori.map(a=>a.sigla).join(", ") : "nessuno"}</span>
              </summary>
              <div style={{marginTop:"12px"}}>
              <AmbulatoriPanel ambulatori={regole.ambulatori} medici={medici}
                onAmbulatori={amb=>updRegole({...regole,ambulatori:amb})}
                onMedici={setMedici}/>
              </div>
            </details>

            <details style={BOX}>
              <summary style={{...LBL,fontWeight:700,color:"#1d4ed8",cursor:"pointer"}}>
                EQUITÀ FRA MESI <span style={{fontWeight:400,color:"#64748b"}}>· mesi di memoria: festivi {regole.rotazioneFestiviMesi}, notti {regole.equitaNottiMesi}, weekend liberi {regole.equitaWeekendMesi}</span>
              </summary>
              <div style={{marginTop:"12px"}}>
                <div style={{...LBL,fontSize:"9px",marginBottom:"10px"}}>Mesi salvati da considerare per ciascuna equità. 0 = spenta.</div>
                {([
                  ["rotazioneFestiviMesi","Turni festivi","Chi nei mesi scorsi ha fatto più turni festivi di un tipo (es. notti di sabato, domeniche mattina) ne riceve meno questo mese."],
                  ["equitaNottiMesi","Notti","Quando le notti non si dividono in parti uguali, la notte in più va a chi nei mesi scorsi ne ha fatte meno. Nel mese la differenza fra gli MR non aumenta."],
                  ["equitaWeekendMesi","Weekend liberi","Quando c'è un weekend libero in più da dare, va a chi nei mesi scorsi ne ha avuti meno (ferie comprese)."],
                ] as const).map(([k,lbl,hint])=>(
                  <div key={k} style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"10px"}}>
                    {numInp(regole[k],v=>setTop(k,v))}
                    <div>
                      <div style={{...LBL,color:"#0f172a",fontWeight:700}}>{lbl}</div>
                      <div style={{...LBL,fontSize:"9px"}}>{hint}</div>
                    </div>
                  </div>
                ))}
              </div>
            </details>

            {/* ── FESTIVITÀ E PUNTI DEL PIANO FESTIVI (v0.3.60) ── */}
            <details style={BOX}>
              <summary style={{...LBL,fontWeight:700,color:"#1d4ed8",cursor:"pointer"}}>
                FESTIVITÀ E PUNTI <span style={{fontWeight:400,color:"#64748b"}}>· sezione Festivi: {regole.festiviPiano.length} festività, superfestivi: {regole.festiviPiano.filter(f=>f.sup).map(f=>f.nome).join(", ")||"nessuno"}</span>
              </summary>
              <div style={{marginTop:"12px"}}>
                <FestiviPuntiPanel regole={regole} onRegole={updRegole} avviso={showMsg}/>
              </div>
            </details>

            {/* ── TURNI PS E AFFIANCAMENTO MDC (v0.3.45) ── */}
            <details style={BOX}>
              <summary style={{...LBL,fontWeight:700,color:"#1d4ed8",cursor:"pointer"}}>
                TURNI PS E AFFIANCAMENTO MDC <span style={{fontWeight:400,color:"#64748b"}}>
                  · {(["1","2","3"] as const).every(k=>regole.psAff[k].ord&&regole.psAff[k].alpi) ? "tutti validi" :
                     (["1","2","3"] as const).flatMap(k=>[...(regole.psAff[k].ord?[]:[k]),...(regole.psAff[k].alpi?[]:[k+" ALPI"])]).join(", ")+" non validi"}
                </span>
              </summary>
              <div style={{...LBL,margin:"10px 0",lineHeight:1.6}}>
                L'MDC non può stare solo in turno. Oltre ai turni di reparto (M/A, P/Ap, N), qui scegli quali turni
                PS di un collega lo affiancano: 1 di mattina, 2 di pomeriggio, 3 di notte. I turni PS segnati
                «altro osp.» (in tabellone con l'asterisco, es. 3*) non lo affiancano mai. Per chi li fa valgono
                come sempre: punti, riposo dopo la notte, conteggio notti.
              </div>
              <table style={{borderCollapse:"collapse",fontFamily:"monospace"}}>
                <thead><tr>
                  <th style={{...LBL,textAlign:"left",padding:"4px 14px 4px 0"}}>Codice</th>
                  <th style={{...LBL,padding:"4px 10px"}}>Ordinario</th>
                  <th style={{...LBL,padding:"4px 10px"}}>ALPI (sottolineato)</th>
                  <th style={{...LBL,padding:"4px 10px"}}>Altro ospedale</th>
                </tr></thead>
                <tbody>
                  {([["1","mattina"],["2","pomeriggio"],["3","notte"]] as const).map(([k,lbl])=>(
                    <tr key={k}>
                      <td style={{...LBL,color:"#0f172a",padding:"4px 14px 4px 0"}}><b>{k}</b> {lbl}</td>
                      {(["ord","alpi"] as const).map(c=>{
                        const on = regole.psAff[k][c];
                        return (
                          <td key={c} style={{padding:"4px 10px",textAlign:"center"}}>
                            <button onClick={()=>updRegole({...regole,psAff:{...regole.psAff,[k]:{...regole.psAff[k],[c]:!on}}})}
                              style={{background:on?"#ecfdf5":"#fff1f2",color:on?"#047857":"#be123c",
                                border:`1px solid ${on?"#059669":"#fecdd3"}`,borderRadius:"5px",padding:"3px 10px",
                                cursor:"pointer",fontSize:"10px",fontWeight:700,fontFamily:"monospace",minWidth:"78px"}}>
                              {on?"valido":"non valido"}
                            </button>
                          </td>
                        );
                      })}
                      <td style={{...LBL,padding:"4px 10px",textAlign:"center",color:"#be123c"}}>mai</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <label style={{display:"flex",gap:"8px",alignItems:"flex-start",marginTop:"12px",cursor:"pointer"}}>
                <input type="checkbox" checked={regole.psEstGiornata}
                  onChange={e=>updRegole({...regole,psEstGiornata:e.target.checked})} style={{marginTop:"2px"}}/>
                <span>
                  <span style={{...LBL,color:"#0f172a",fontWeight:700}}>Un turno PS in altro ospedale occupa tutta la giornata</span>
                  <div style={{...LBL,fontSize:"9px"}}>
                    Con 1* (mattina) o 2* (pomeriggio) il medico non riceve turni di reparto né ambulatori in quel giorno.
                    Senza spunta l'altra fascia resta assegnabile, come per un PS in sede.
                  </div>
                </span>
              </label>
            </details>

            <details style={BOX}>
              <summary style={{...LBL,fontWeight:700,color:"#1d4ed8",cursor:"pointer"}}>
                IMPOSTAZIONI PULSANTI <span style={{fontWeight:400,color:"#64748b"}}>· ① Copertura: {regole.coperturaSoloVuoti ? "riempi solo i vuoti" : "ottimizza tutto"}</span>
              </summary>
              <div style={{marginTop:"12px",display:"flex",flexDirection:"column",gap:"10px"}}>
                <div style={{...LBL,color:"#0f172a",fontWeight:700,fontSize:"11px"}}>① Copertura</div>
                {([
                  [false,"Ottimizza tutto","Riempie i posti vuoti e può spostare i turni automatici già presenti (quelli semitrasparenti) per migliorare equilibrio, weekend e notti. Restano fissi solo i turni inseriti a mano."],
                  [true,"Riempi solo i vuoti","Tutti i turni già presenti, anche quelli automatici, restano dove sono: aggiunge turni solo nei posti mancanti, e alla fine i turni automatici restano automatici. Se un posto si potrebbe coprire solo spostando un altro turno, resta scoperto e la diagnosi lo segnala."],
                ] as [boolean,string,string][]).map(([v,lbl,hint])=>(
                  <label key={lbl} style={{display:"flex",gap:"8px",alignItems:"flex-start",cursor:"pointer"}}>
                    <input type="radio" name="coperturaModo" checked={regole.coperturaSoloVuoti===v}
                      onChange={()=>updRegole({...regole,coperturaSoloVuoti:v})} style={{marginTop:"2px"}}/>
                    <span>
                      <span style={{...LBL,color:"#0f172a",fontWeight:700}}>{lbl}</span>
                      <div style={{...LBL,fontSize:"9px"}}>{hint}</div>
                    </span>
                  </label>
                ))}
                <div style={{...LBL,fontSize:"9px"}}>Su un mese vuoto le due modalità si comportano allo stesso modo. «Ripristina default» delle regole non cambia questa scelta.</div>
              </div>
            </details>

            <details style={BOX}>
              <summary style={{...LBL,fontWeight:700,color:"#1d4ed8",cursor:"pointer"}}>
                IMPOSTAZIONI DEL REPARTO <span style={{fontWeight:400,color:"#64748b"}}>· intestazioni, logo, festività locali, esporta/importa (di solito si imposta una volta sola)</span>
              </summary>
              <div style={{marginTop:"12px"}}>
                <RepartoPanel regole={regole} medici={medici} onRegole={updRegole} onMedici={setMedici} avviso={showMsg}/>
              </div>
            </details>
          </div>
        );
      })()}

      {/* ── DETTAGLIO FABBISOGNO ── si apre toccando il contatore F.
             m/p/n/a sono CONTEGGI di turni; il totale è in unità di vt (notte ×2). */}
      {fabbAperto && (()=>{
        const RIGA = (sig:string, lbl:string, n:number, peso:number, col:string) => (
          <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"6px 0",borderBottom:"1px solid #e2e8f0"}}>
            <span style={{width:"22px",textAlign:"center",fontWeight:700,color:col}}>{sig}</span>
            <span style={{flex:1,color:"#475569",fontSize:"11px"}}>{lbl}</span>
            <span style={{color:"#0f172a",fontWeight:700,fontSize:"13px",minWidth:"28px",textAlign:"right"}}>{n}</span>
            <span style={{color:"#94a3b8",fontSize:"10px",minWidth:"52px",textAlign:"right"}}>
              {peso===2 ? `×2 = ${n*2}` : `= ${n}`}
            </span>
          </div>
        );
        return (
          <div onClick={()=>setFabbAperto(false)}
               style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",
                       justifyContent:"center",zIndex:50,padding:"16px"}}>
            <div onClick={e=>e.stopPropagation()}
                 style={{background:"#ffffff",border:"1px solid #cbd5e1",borderRadius:"10px",padding:"16px",
                         width:"100%",maxWidth:"360px",fontFamily:"monospace",boxShadow:"0 10px 40px #0f172a26"}}>
              <div style={{fontSize:"8px",letterSpacing:".15em",textTransform:"uppercase",color:"#94a3b8"}}>Fabbisogno del mese</div>
              <div style={{fontSize:"15px",fontWeight:700,color:"#0f172a",marginBottom:"10px"}}>{MESI[mese]} {anno}</div>

              {RIGA("M","Mattine (minimo di copertura)", fab.m, 1, "#1d4ed8")}
              {RIGA("P","Pomeriggi (minimo di copertura)", fab.p, 1, "#6d28d9")}
              {RIGA("N","Notti (una per giorno)", fab.n, 2, "#047857")}
              {RIGA("A",`Ambulatori (${regole.ambulatori.some(ambConfigurato)
                ? regole.ambulatori.filter(ambConfigurato).map(a=>a.sigla).join(", ")+" · feriali"
                : "nessuno"})`, fab.a, 1, "#047857")}

              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #e2e8f0"}}>
                <span style={{color:"#475569",fontSize:"11px"}}>Totale lordo</span>
                <span style={{color:"#0f172a",fontWeight:700}}>{bil.fLordo}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #e2e8f0"}}>
                <span style={{color:"#475569",fontSize:"11px"}}>− coperti dai medici MPS</span>
                <span style={{color:"#7e22ce",fontWeight:700}}>{bil.copertoMPS}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0"}}>
                <span style={{color:"#0f172a",fontSize:"12px",fontWeight:700}}>F — fabbisogno netto</span>
                <span style={{color:bil.ok?"#047857":"#be123c",fontWeight:700,fontSize:"15px"}}>{bil.f}</span>
              </div>

              <div style={{background:bil.ok?"#ecfdf5":"#fff1f2",border:`1px solid ${bil.ok?"#e7f6ec":"#fecdd3"}`,
                           borderRadius:"6px",padding:"8px 10px",margin:"6px 0 12px",fontSize:"11px",
                           color:bil.ok?"#047857":"#be123c",textAlign:"center",fontWeight:700}}>
                {bil.ok ? `D ${bil.d} ≥ F ${bil.f} · copribile, margine +${bil.d-bil.f}`
                        : `D ${bil.d} < F ${bil.f} · scoperto di ${bil.f-bil.d} turni`}
              </div>

              <div style={{fontSize:"9px",color:"#94a3b8",lineHeight:1.6,marginBottom:"12px"}}>
                I conteggi sono in turni; il totale è nell'unità della colonna Ob., dove la notte pesa 2.
                L'ambulatorio non copre la mattina: nei giorni di ambulatorio servono {fab.a>0?"le mattine minime più l'ambulatorio":"le mattine minime"}.
              </div>

              <button onClick={()=>setFabbAperto(false)} style={{width:"100%",background:"#e2e8f0",color:"#1e3a8a",
                border:"1px solid #cbd5e1",borderRadius:"6px",padding:"9px",cursor:"pointer",fontSize:"12px",
                fontWeight:700,fontFamily:"monospace"}}>Chiudi</button>
            </div>
          </div>
        );
      })()}

      {cella   && <CellModal medico={medici.find(x=>x.id===cella.id)} giorno={cella.g} anno={anno} mese={mese}
                             esistenti={gT(cella.id,cella.g)} ambulatori={regole.ambulatori}
                             onSalva={(t)=>sT(cella.id,cella.g,t)}
                             onClose={()=>setCella(null)}/>}
      {editDoc && <DocModal doc={editDoc} ambulatori={regole.ambulatori} onSalva={salvaDoc} onClose={()=>setEditDoc(null)}/>}
    </div>
  );
}
