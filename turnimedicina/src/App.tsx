import { useEffect, useMemo, useRef, useState } from "react";
import type { Medico, Turno, TurniAll, AlternativaUC, DiagnosiGen, DiagnosiCausale } from "./engine/types";
import { diagnosiStatica } from "./engine/diagnosi";
import { MESI, DL, DF, dowOf, dimOf, isFestivo, isSabN, isDomN, mkKey } from "./engine/date";
import { vt, SPEC } from "./engine/turni";
import { REGOLE_DEFAULT, setRegole, getRegole } from "./engine/regole";
import { setPrevContext, setAmbRotStart } from "./engine/state";
import { completaObiettivi, calcAmbRotNext } from "./engine/genera";
import { generaParallelo } from "./generaParallelo";
import { loadS, saveS, loadRegole, saveRegole, loadAmbRot, saveAmbRot } from "./storage";
import { caricaRemoto, salvaRemoto, puoModificare, remotoConfigurato } from "./remote";
import { esportaExcel } from "./export/excel";
import { SC } from "./components/costanti";
import { Badge } from "./components/Badge";
import { CellModal } from "./components/CellModal";
import { DocModal, type DocDraft } from "./components/DocModal";
import { CovDots } from "./components/CovDots";
import { calcolaBilancio, dettaglioFabbisogno, psMedico, riepilogoMedico } from "./engine/bilancio";

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
  const [tab,    setTab]    = useState<"cal"|"medici"|"regole">("cal");
  const [fabbAperto, setFabbAperto] = useState(false);
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
  // ── SYNC REMOTO (v0.3.14) ──────────────────────────────────────────────────
  // editabile: questo browser ha la chiave di modifica (o il remoto non è
  // configurato → comportamento locale identico alle versioni precedenti).
  // remotoOk.current: finché il primo caricamento non è concluso, l'effect di
  // persistenza NON spinge verso il server (eviterebbe di sovrascrivere il
  // remoto con lo stato locale vecchio).
  const editabile = puoModificare();
  const remotoOk  = useRef(!remotoConfigurato());
  const applicaRemoto = (r: NonNullable<Awaited<ReturnType<typeof caricaRemoto>>>, ancheData=true) => {
    if(r.regole){ const m = { ...getRegole(), ...r.regole }; setRegole(m); setRegoleState(m); saveRegole(m); }
    if(r.ambRot) saveAmbRot(r.ambRot);
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
  useEffect(()=>{ setDiagGen(null); setDiagCaus(null); },[anno,mese]);   // la telemetria vale solo per il mese generato

  const showMsg = (txt:string,tp="ok") => { setToast({txt,tp}); setTimeout(()=>setToast(null),3200); };

  // ── Generazione (pulsante ①) ───────────────────────────────────────────────
  // La UI INIETTA nel motore tutto ciò che prima il motore leggeva da solo:
  // coda del mese precedente e indice di rotazione ambulatorio. La rotazione
  // viene poi ricalcolata dal SOLO tabellone accettato e persistita: i tentativi
  // scartati dal multi-tentativo non la fanno più avanzare.
  const generaCopertura = () => {
    setBusy(true);
    setAltUC(null);
    setTimeout(async ()=>{
      try{
        setPrevContext(turniAll,anno,mese);
        const rotStart = loadAmbRot().nextIdx;
        setAmbRotStart(rotStart);
        // GENERAZIONE PARALLELA (v0.3.9): pool di Web Worker, ognuno con la
        // propria sequenza di semi → più tentativi nello stesso tempo e main
        // thread libero. Fallback automatico al percorso sincrono se i Worker
        // non sono disponibili.
        const r = await generaParallelo(anno,mese,nd,medici,turni);
        saveAmbRot({ nextIdx: calcAmbRotNext(r.turni, medici, anno, mese, nd, rotStart) });
        salvaRemoto("ambRot", loadAmbRot());
        setTurni(r.turni);
        if(r.ok) showMsg("✓ Copertura minima completata!");
        else showMsg("⚠ Copertura parziale (mostrato il tabellone migliore): "+r.problemi.slice(0,4).join(" · "),"warn");
        // Variante di ultima chance disponibile → si propone senza applicarla.
        if(r.alternativaUC) setAltUC({ alt:r.alternativaUC, rotStart });
        setDiagGen(r.diagnosi ?? null);
        setDiagCaus(r.causale ?? null);
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
        const r = completaObiettivi(anno,mese,nd,medici,turni);
        setTurni(r.turni);
        showMsg("✓ Obiettivi mensili completati!");
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

  // Conta turni ambulatorio (A) del medico nel mese
  const cntAmb = (id:number) => {
    let n=0;
    for(let g=1;g<=nd;g++) for(const s of gT(id,g)) if(["A"].includes(s.tipo)) n++;
    return n;
  };
  // Conta i permessi (L / ANA / 104 / per11) del medico nel mese, con
  // dettaglio per tipo. X resta fuori: è un'esclusione, non un permesso.
  const PERM = ["L","ANA","104","per11"] as const;
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
  // Riepilogo generale del medico: M/P/N di reparto + carico weekend.
  const rieM  = (id:number) => riepilogoMedico(turni, id, nd, anno, mese);

  // Riepilogo testuale della squadra (Formato B, copiabile): rispecchia le card.
  const riepilogoTesto = () => {
    const out: string[] = [`Riepilogo turni — U.O.C. Medicina Interna — ${MESI[mese]} ${anno}`, ""];
    for(const m of medici){
      const tot=cntM(m.id), r=rieM(m.id), wkLib=cntWkLiberi(m.id);
      const ambN=cntAmb(m.id), psN=cntPS(m.id), pm=cntPerm(m.id);
      const permTxt=PERM.filter(k=>pm.det[k]).map(k=>`${k}${pm.det[k]}`).join("·");
      const mps=m.stato==="MPS";
      out.push(`${m.nome} [${m.stato}]${m.ambulatorio?" · AMB":""}  matr. ${m.codice||"—"}`);
      out.push(`  Turni: ${mps?`${tot}`:`${tot} / ${m.obiettivo}`}`);
      out.push(`  Reparto: M ${r.m} · P ${r.p} · N ${r.n}`);
      out.push(`  Weekend lavorati: ${r.wk}${mps?"":` · liberi: ${wkLib}`}`);
      if(m.ambulatorio) out.push(`  Ambulatorio: ${ambN}`);
      out.push(`  PS: ${psN}`);
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
  const ambMancaApp = (g:number) =>
    (regole.giorniAmb ?? [1]).includes(dowOf(anno,mese,g)) && !metaG(g).h &&
    !medici.some(m=>gT(m.id,g).some(s=>s.tipo==="A"));
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
    showMsg(`Medico ${m.nome} eliminato.`);
  };

  // ── styles ──
  const TH: React.CSSProperties = {background:"#122036",border:"1px solid #1e3a5f",padding:"3px 3px",textAlign:"center",fontFamily:"monospace",fontSize:"9px",color:"#4b7aad",whiteSpace:"nowrap"};

  return (
    <div style={{minHeight:"100vh",background:"#0b1626",color:"#e2f0ff",fontFamily:"monospace"}}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:#0b1626;}
        ::-webkit-scrollbar-thumb{background:#24405f;border-radius:3px;}
        @media print{
          .np{display:none!important;}
          body{background:#fff!important;color:#000!important;}
          table{font-size:6pt!important;border-collapse:collapse!important;}
          td,th{border:.4pt solid #bbb!important;padding:1pt 2pt!important;}
        }
      `}</style>

      {/* TOPBAR */}
      <div className="np" style={{background:"#122036",borderBottom:"1px solid #1e3a5f",padding:"10px 16px",display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:"200px"}}>
          <div style={{fontSize:"8px",color:"#4b7aad",letterSpacing:".15em",textTransform:"uppercase",marginBottom:"3px"}}>
            AOU San Giovanni di Dio e Ruggi d'Aragona · P.O. Santa Maria Incoronata dell'Olmo
          </div>
          <div style={{fontSize:"15px",fontWeight:700,color:"#e2f0ff"}}>
            U.O.C. Medicina Interna
            <span style={{color:"#4b7aad",fontSize:"11px",fontWeight:400,marginLeft:"8px"}}>— Pianificazione Turni</span>
          </div>
        </div>

        <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
          <select value={mese} onChange={e=>setMese(+e.target.value)}
            style={{background:"#081120",border:"1px solid #2f5a8a",color:"#60a5fa",borderRadius:"6px",padding:"6px 9px",fontSize:"12px",fontFamily:"monospace",cursor:"pointer"}}>
            {MESI.map((m,i)=><option key={i} value={i}>{m}</option>)}
          </select>
          <input type="number" value={anno} onChange={e=>setAnno(+e.target.value)}
            style={{background:"#081120",border:"1px solid #2f5a8a",color:"#60a5fa",borderRadius:"6px",padding:"6px 8px",fontSize:"12px",fontFamily:"monospace",width:"78px"}}/>
        </div>

        <div style={{display:"flex",gap:"6px",flexWrap:"wrap",alignItems:"center"}}>
          {!editabile &&
            <span title="Stai consultando il tabellone pubblicato. Per modificare, apri il link con #modifica in fondo."
              style={{background:"#78350f",color:"#fde68a",border:"1px solid #b45309",borderRadius:"6px",
              padding:"6px 10px",fontSize:"10px",fontWeight:700,fontFamily:"monospace",letterSpacing:".08em"}}>
              👁 SOLA LETTURA
            </span>}
          {([
            ["①","Copertura", busy?"#0f1a2a":"#1d4ed8", generaCopertura, busy],
            ["②","Obiettivi", busy?"#0f1a2a":"#6d28d9", generaObiettivi, busy],
            ["⊘","Rimuovi App","#4c1d95", ()=>{ setTurni(p=>{ const n: TurniAll[string]={}; for(const k in p){ n[k]={}; for(const d in p[k]) n[k][d]={t:(p[k][d].t||[]).filter(s=>s.man)}; } return n; }); showMsg("Turni app rimossi."); }, false],
            ["x",confMan?"Conferma ✕":"Rimuovi Man",confMan?"#dc2626":"#7f1d1d", rimuoviManuali, false],
            ["⎙","Excel", printing?"#0f1a2a":"#064e3b", handlePrint, printing],
          ] as [string,string,string,()=>void,boolean][])
            .filter(([,lb])=> editabile || lb==="Excel")
            .map(([ic,lb,cl,fn,ds])=>(
            <button key={lb} onClick={fn} disabled={!!ds} style={{background:ds?"#0f1a2a":cl,color:ds?"#3d5878":"#fff",border:"none",borderRadius:"6px",padding:"7px 12px",cursor:ds?"not-allowed":"pointer",fontSize:"11px",fontWeight:700,fontFamily:"monospace",display:"flex",alignItems:"center",gap:"4px",opacity:ds?.5:1}}>
              <span>{ic}</span><span>{lb}</span>
            </button>
          ))}
        </div>

        {/* Segmented control: un solo contenitore, la pillola dice DOVE sei. */}
        <div style={{display:"flex",gap:0,background:"#0a1524",border:"1px solid #24405f",borderRadius:"9px",padding:"3px"}}>
          {([["cal","Calendario"],["medici","Medici"],["regole","Regole"]] as ["cal"|"medici"|"regole",string][])
            .filter(([t])=> editabile || t==="cal")
            .map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)} aria-selected={tab===t} style={{
              background:tab===t?"#1e3a5f":"transparent", color:tab===t?"#bfdbfe":"#5b7ea8",
              border:"none", borderRadius:"7px", padding:"8px 16px", cursor:"pointer",
              fontSize:"12px", fontWeight:700, fontFamily:"monospace", letterSpacing:".02em",
              boxShadow:tab===t?"inset 0 0 0 1px #3b82f6, 0 2px 8px #00000088":"none",
              transition:"background .12s, color .12s"}}>{l}</button>
          ))}
        </div>
      </div>

      {/* TOAST */}
      {toast&&(
        <div className="np" style={{position:"fixed",top:"66px",right:"16px",zIndex:900,
          background:toast.tp==="err"?"#450a0a":toast.tp==="warn"?"#451a03":"#052e16",
          border:`1px solid ${toast.tp==="err"?"#dc2626":toast.tp==="warn"?"#c2410c":"#16a34a"}`,
          color:"#e2f0ff",borderRadius:"8px",padding:"10px 14px",fontSize:"12px",
          fontFamily:"monospace",boxShadow:"0 8px 24px #000",maxWidth:"300px"}}>
          {toast.txt}
        </div>
      )}

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
            background:"#0b1220",border:"1px solid #c2410c",color:"#e2f0ff",borderRadius:"10px",
            padding:"12px 14px",fontSize:"12px",fontFamily:"monospace",boxShadow:"0 10px 30px #000",
            maxWidth:"440px",width:"calc(100% - 32px)"}}>
            <div style={{fontWeight:700,color:"#fb923c",marginBottom:"6px"}}>
              Variante disponibile (ultima chance)
            </div>
            <div style={{marginBottom:"4px"}}>
              <span style={{color:"#4ade80"}}>+{nc} {nc===1?"cella coperta":"celle coperte"}</span>: {cLbl}
            </div>
            {wp.length>0 && (
              <div style={{marginBottom:"8px",color:azzera?"#fca5a5":"#fbbf24"}}>
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
                style={{background:"#1e3a5f",color:"#94a3b8",border:"1px solid #2f5a8a",borderRadius:"6px",padding:"7px 14px",
                  cursor:"pointer",fontSize:"11px",fontFamily:"monospace"}}>Mantieni sicuro</button>
            </div>
          </div>
        );
      })()}

      {/* PANNELLO DIAGNOSI COPERTURA (v0.3.10) — impossibilità certificate (⊘)
          e celle mai coperte in nessun tentativo (⚠). Solo lettura: aiuta a
          capire PERCHÉ certi buchi restano, senza toccare la generazione. */}
      {tab==="cal" && (nCert>0 || maiCoperte.length>0 || causVis.length>0) && (()=>{
        const FL: Record<string,string> = { M:"mattine", P:"pomeriggi", N:"notte" };
        const gLbl = (g:number)=>`${DF[dowOf(anno,mese,g)].slice(0,3)} ${g}`;
        // "mai coperte" raggruppate per giorno: "Mar 4: mattine · pomeriggi"
        const maiByG = new Map<number,string[]>();
        for(const c of maiCoperte){ const l=maiByG.get(c.g)||[]; l.push(FL[c.f]); maiByG.set(c.g,l); }
        return (
          <div className="np" style={{margin:"8px 12px 0",background:"#0b1220",border:"1px solid #4c1d95",
            borderRadius:"10px",fontFamily:"monospace",fontSize:"11px",color:"#e2f0ff",overflow:"hidden"}}>
            <div onClick={()=>setDiagOpen(o=>!o)} style={{display:"flex",alignItems:"center",gap:"8px",
              padding:"8px 12px",cursor:"pointer",userSelect:"none"}}>
              <span style={{color:"#a78bfa",fontWeight:700}}>Diagnosi copertura</span>
              {nCert>0 && <span style={{color:"#c4b5fd"}}>&#8856; {nCert} impossibil{nCert===1?"e certificata":"i certificate"}</span>}
              {maiCoperte.length>0 && <span style={{color:"#fbbf24"}}>&#9888; {maiCoperte.length} mai copert{maiCoperte.length===1?"a":"e"} in {diagGen?.tentativi} tentativi</span>}
              {causVis.length>0 && <span style={{color:"#34d399"}}>&#9670; {causVis.length} caus{causVis.length===1?"a individuata":"e individuate"}</span>}
              <span style={{marginLeft:"auto",color:"#4b7aad"}}>{diagOpen?"▾":"▸"}</span>
            </div>
            {diagOpen && (
              <div style={{padding:"0 12px 10px",borderTop:"1px solid #1e3a5f"}}>
                {(diagStat.giorni.length>0||diagStat.celle.length>0||diagStat.mese.length>0) && (
                  <div style={{marginTop:"8px"}}>
                    <div style={{color:"#a78bfa",fontWeight:700,fontSize:"10px",marginBottom:"4px"}}>&#8856; CERTIFICATE (dimostrate dai turni manuali e dalle regole — nessuna generazione potrà coprirle)</div>
                    {diagStat.giorni.map((d,i)=><div key={"g"+i} style={{color:"#c4b5fd",margin:"3px 0"}}>&#8226; {d.motivo}</div>)}
                    {diagStat.celle.map((c,i)=><div key={"c"+i} style={{color:"#c4b5fd",margin:"3px 0"}}>&#8226; {c.motivo}</div>)}
                    {diagStat.mese.map((m,i)=><div key={"m"+i} style={{color:"#c4b5fd",margin:"3px 0"}}>&#8226; {m.motivo}</div>)}
                  </div>
                )}
                {maiByG.size>0 && (
                  <div style={{marginTop:"8px"}}>
                    <div style={{color:"#fbbf24",fontWeight:700,fontSize:"10px",marginBottom:"4px"}}>&#9888; MAI COPERTE — scoperte in TUTTI i {diagGen?.tentativi} tentativi: quasi certamente incompatibili con gli altri vincoli (assenze e turni dei giorni vicini)</div>
                    {[...maiByG.entries()].sort((x,y)=>x[0]-y[0]).map(([g,fl])=>
                      <div key={g} style={{color:"#fde68a",margin:"3px 0"}}>&#8226; {gLbl(g)}: {fl.join(" · ")}</div>)}
                  </div>
                )}
                {/* DIAGNOSI CAUSALE (v0.3.13) — il VERO problema dietro i buchi:
                    analisi controfattuale per finestre sull'ultimo tabellone
                    generato. Ogni voce indica il cluster di giorni, la causa
                    (vincolo determinante / conflitto globale / deficit
                    materiale) e, quando trovato, il collo di bottiglia. */}
                {causVis.length>0 && (
                  <div style={{marginTop:"8px"}}>
                    <div style={{color:"#34d399",fontWeight:700,fontSize:"10px",marginBottom:"4px"}}>&#9670; CAUSA PROBABILE — analisi dei giorni attorno ai buchi dell'ultima generazione: qual &#232; il blocco REALE (spesso a monte della cella dichiarata scoperta)</div>
                    {causVis.map((cl,i)=>(
                      <div key={"cs"+i} style={{margin:"3px 0 6px"}}>
                        <div style={{color:"#6ee7b7"}}>&#8226; {cl.motivo}</div>
                        {cl.dettagli.map((d,j)=>
                          <div key={j} style={{color:"#8ad9bd",margin:"2px 0 0 12px",fontSize:"10px"}}>&#8627; {d}</div>)}
                      </div>
                    ))}
                    {diagCaus && !diagCaus.completa && (
                      <div style={{color:"#64748b",fontSize:"9px"}}>Analisi interrotta per limite di tempo: alcune finestre potrebbero non essere state esaminate.</div>
                    )}
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
                <th colSpan={2} style={{...TH,textAlign:"left",padding:"6px 10px",color:"#60a5fa",fontSize:"11px",minWidth:"200px"}}>
                  {MESI[mese].toLowerCase()} {anno}
                </th>
                {giorni.map(g=>{
                  const mt=metaG(g);
                  return <th key={g} style={{...TH,background:mt.h?"#261414":mt.sat||mt.dom?"#191940":"#122036",color:mt.h?"#7f1d1d":mt.sat||mt.dom?"#4c1d95":"#1e3a5f",minWidth:"34px",fontSize:"10px",fontWeight:700}}>{g}</th>;
                })}
                <th style={{...TH,minWidth:"34px",fontSize:"9px"}}>Tot</th>
                <th style={{...TH,minWidth:"34px",fontSize:"9px"}}>Ob.</th>
                <th style={{...TH,minWidth:"28px",fontSize:"9px",color:"#7c3aed"}}>WkL</th>
                <th style={{...TH,minWidth:"28px",fontSize:"9px",color:"#059669"}}>Amb</th>
              </tr>
              <tr>
                <th colSpan={2} style={TH}/>
                {giorni.map(g=>{
                  const mt=metaG(g);
                  return <th key={g} style={{...TH,background:mt.h?"#261414":mt.sat||mt.dom?"#191940":"#122036",color:mt.h?"#ef4444":mt.sat||mt.dom?"#7c3aed":"#1e3a5f",fontSize:"8px"}}>{DL[mt.d]}</th>;
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
                    <td style={{background:"#122036",border:"1px solid #1e3a5f",padding:"3px 8px",whiteSpace:"nowrap",fontWeight:700,fontSize:"10px",color:"#e2eeff",fontFamily:"monospace"}}>{med.nome}</td>
                    <td style={{background:sc.bg,border:"1px solid #1e3a5f",padding:"2px 4px",textAlign:"center",fontFamily:"monospace",fontSize:"8px"}}>
                      {med.codice&&<div style={{color:sc.t,opacity:.6,fontSize:"7px"}}>{med.codice}</div>}
                      <div style={{color:sc.t,fontWeight:700}}>{med.stato}</div>
                    </td>
                    {giorni.map(g=>{
                      const mt=metaG(g);
                      const ct=gT(med.id,g);
                      const hX=ct.some(s=>s.tipo==="X"), vis=ct.filter(s=>s.tipo!=="X");
                      const bg=hX?"#1a1a24":mt.h?"#1c0f0f":mt.sat||mt.dom?"#12142e":"#0b1626";
                      return (
                        <td key={g} onClick={editabile ? ()=>setCella({id:med.id,g}) : undefined}
                          style={{background:bg,border:"1px solid #1e3a5f",padding:"1px 2px",textAlign:"center",cursor:editabile?"pointer":"default",minWidth:"34px",height:"25px",verticalAlign:"middle",transition:"background .08s"}}
                          onMouseEnter={editabile ? e=>e.currentTarget.style.background="#22406b" : undefined}
                          onMouseLeave={editabile ? e=>e.currentTarget.style.background=bg : undefined}>
                          <div style={{display:"flex",gap:"1px",justifyContent:"center",flexWrap:"wrap"}}>
                            {vis.map((s,i)=><Badge key={i} tipo={s.tipo} sott={s.sott} man={s.man}/>)}
                          </div>
                        </td>
                      );
                    })}
                    <td style={{background:ov?"#1a0606":un?"#061a06":"#122036",border:"1px solid #1e3a5f",padding:"2px 5px",textAlign:"center",fontWeight:700,fontSize:"12px",color:ov?"#f87171":un?"#4ade80":"#e2f0ff",fontFamily:"monospace"}}>{tot}</td>
                    <td style={{background:"#122036",border:"1px solid #1e3a5f",padding:"2px 5px",textAlign:"center",color:"#4b7aad",fontSize:"11px",fontFamily:"monospace"}}>{med.stato==="MPS"?"—":med.obiettivo}</td>
                    <td style={{background:"#141033",border:"1px solid #1e3a5f",padding:"2px 4px",textAlign:"center",fontWeight:700,fontSize:"11px",color:wkLib>=2?"#a78bfa":wkLib===1?"#7c3aed":"#4b5563",fontFamily:"monospace"}}>{med.stato==="MPS"?"—":wkLib}</td>
                    <td style={{background:"#0a1a12",border:"1px solid #1e3a5f",padding:"2px 4px",textAlign:"center",fontWeight:700,fontSize:"11px",color:med.ambulatorio?ambN>0?"#34d399":"#065f46":"#1f2937",fontFamily:"monospace"}}>{med.ambulatorio?ambN:"—"}</td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={2} style={{...TH,textAlign:"left",padding:"4px 8px",fontSize:"8px",color:"#3d5878"}}>Copertura M·P·N</td>
                {giorni.map(g=>{
                  const mt=metaG(g);
                  // Giorno d'ambulatorio FERIALE (segue regole.giorniAmb, quindi
                  // anche giorni diversi dal martedì se configurati): quarto
                  // quadratino con il codice del medico che ha la A, o "A?" se
                  // la A manca. undefined = giorno normale, niente quadratino.
                  const ambDay = (regole.giorniAmb ?? [1]).includes(mt.d) && !mt.h;
                  const ambMed = ambDay ? medici.find(m=>gT(m.id,g).some(s=>s.tipo==="A")) : undefined;
                  return (
                    <td key={g} style={{background:"#0b1626",border:"1px solid #1e3a5f",padding:"3px 1px",textAlign:"center",verticalAlign:"top"}}>
                      <CovDots mc={cfApp(g,"M")} pc={cfApp(g,"P")} nc={cfApp(g,"N")} sp={mt.sp} sat={mt.sat} fabb={regole.fabb}
                        diag={{M:diagFlag(g,"M"),P:diagFlag(g,"P"),N:diagFlag(g,"N")}}
                        amb={ambDay ? (ambMed?.codice ?? null) : undefined}/>
                    </td>
                  );
                })}
                <td colSpan={4} style={{background:"#122036",border:"1px solid #1e3a5f"}}/>
              </tr>
              {/* BILANCIO DEL MESE — L+P · S · D · F. Solo F cambia colore: è il
                  verdetto (D ≥ F ⇒ il fabbisogno è copribile). */}
              {(()=>{
                const b = bil;
                const KPI = (lbl:string,val:number,bg:string,col:string,ttl:string,onClick?:()=>void)=>(
                  <td title={ttl} onClick={onClick} style={{background:bg,border:"1px solid #1e3a5f",padding:"2px 3px",
                    textAlign:"center",fontFamily:"monospace",lineHeight:1.15,color:col,
                    cursor:onClick?"pointer":"help",userSelect:"none"}}>
                    <div style={{fontSize:"7px",letterSpacing:".06em",opacity:.8}}>{lbl}{onClick&&" ⓘ"}</div>
                    <div style={{fontSize:"12px",fontWeight:700}}>{val}</div>
                  </td>
                );
                return (
                  <tr>
                    <td colSpan={2+nd} style={{background:"#122036",border:"1px solid #1e3a5f",textAlign:"right",
                      padding:"2px 8px",fontSize:"8px",color:"#3d5878",letterSpacing:".12em",fontFamily:"monospace"}}>
                      BILANCIO MESE ▸
                    </td>
                    {KPI("L+P",b.lp,"#261a02","#fbbf24","Licenze e permessi manuali (L + 104 + p11 + ANA). Gli MPS sono esclusi: non hanno obiettivo.")}
                    {KPI("S",b.s,"#0f2744","#93c5fd","Somma degli obiettivi mensili dei medici.")}
                    {KPI("D",b.d,"#142033","#e2f0ff",`Turni lavorabili in reparto: S − (L+P) − PS. Turni di PS scalati: ${b.ps}.`)}
                    {KPI("F",b.f,b.ok?"#052e16":"#1a0606",b.ok?"#4ade80":"#f87171",
                      "Tocca per il dettaglio del fabbisogno", ()=>setFabbAperto(true))}
                  </tr>
                );
              })()}
            </tbody>
          </table>

          <div className="np" style={{padding:"8px 14px",borderTop:"1px solid #1e3a5f",display:"flex",gap:"6px",flexWrap:"wrap",alignItems:"center",marginTop:"4px"}}>
            <span style={{color:"#3d5878",fontSize:"8px",marginRight:"4px"}}>LEGENDA:</span>
            {[["M","Mattina"],["P","Pomeriggio"],["N","Notte"],["A","Ambulatorio"],["L","Licenza"],["ANA","Permesso"],["104","L.104"],["per11","Art.11"],["X","Escluso"]].map(([tipo,desc])=>(
              <div key={tipo} style={{display:"flex",alignItems:"center",gap:"3px"}}>
                <Badge tipo={tipo} man/><span style={{color:"#4b7aad",fontSize:"8px"}}>{desc}</span>
              </div>
            ))}
            <span style={{color:"#3d5878",fontSize:"8px",marginLeft:"8px"}}>pieno=manuale · semitrasparente=auto</span>
          </div>
        </div>
      )}

      {/* MEDICI */}
      {tab==="medici"&&(
        <div className="np" style={{padding:"16px",maxWidth:"700px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
            <span style={{fontSize:"13px",fontWeight:700,color:"#e2eeff"}}>Gestione Medici</span>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={copiaRiepilogo}
                style={{background:"#0d1930",color:"#a78bfa",border:"1px solid #4c1d95",borderRadius:"6px",padding:"6px 13px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace",fontWeight:700}}>
                📋 Copia riepilogo
              </button>
              <button onClick={()=>setEditDoc({nome:"",codice:"",stato:"MR",obiettivo:25,ambulatorio:false})}
                style={{background:"#052e16",color:"#4ade80",border:"1px solid #16a34a",borderRadius:"6px",padding:"6px 13px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace",fontWeight:700}}>
                ➕ Aggiungi
              </button>
            </div>
          </div>
          {/* Card medici (stile D): un'unica griglia sostituisce riepilogo + righe */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:"8px"}}>
            {medici.map(m=>{
              const sc=SC[m.stato]||{bg:"",t:"",b:""}, tot=cntM(m.id);
              const wkLib=cntWkLiberi(m.id), ambN=cntAmb(m.id), psN=cntPS(m.id), r=rieM(m.id), pm=cntPerm(m.id);
              const permTxt = PERM.filter(k=>pm.det[k]).map(k=>`${k}${pm.det[k]}`).join("·");
              const RIGA: React.CSSProperties = {display:"flex",justifyContent:"space-between",alignItems:"baseline",fontSize:"10px",color:"#4b7aad",padding:"2.5px 0",fontFamily:"monospace"};
              const SEG: React.CSSProperties = {flex:1,textAlign:"center",fontSize:"10px",padding:"4px 0",background:"#0d1930",fontFamily:"monospace"};
              return (
                <div key={m.id} style={{background:"#122036",border:"1px solid #1e3a5f",borderRadius:"8px",padding:"10px 12px",display:"flex",flexDirection:"column"}}>
                  {/* intestazione: nome + badge + azioni */}
                  <div style={{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap",paddingBottom:"7px",marginBottom:"7px",borderBottom:"1px solid #16304f"}}>
                    <span style={{fontWeight:700,color:"#e2eeff",fontSize:"11px",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nome}</span>
                    {m.ambulatorio&&<span style={{background:"#052e16",color:"#34d399",border:"1px solid #059669",borderRadius:"3px",padding:"1px 5px",fontSize:"8px",fontWeight:700}}>AMB</span>}
                    <span style={{background:sc.bg,color:sc.t,border:`1px solid ${sc.b}`,borderRadius:"3px",padding:"1px 6px",fontSize:"9px",fontWeight:700}}>{m.stato}</span>
                    <button onClick={()=>setEditDoc(m)} style={{background:"#1e3a5f",color:"#60a5fa",border:"1px solid #2f5a8a",borderRadius:"4px",padding:"2px 7px",cursor:"pointer",fontSize:"10px"}}>✏</button>
                    <button onClick={()=>eliminaDoc(m)}
                      style={{background:delDoc===m.id?"#7f1d1d":"#1a0606",color:delDoc===m.id?"#fff":"#f87171",border:"1px solid #7f1d1d",borderRadius:"4px",padding:"2px 7px",cursor:"pointer",fontSize:"10px",fontWeight:700,fontFamily:"monospace"}}>
                      {delDoc===m.id?"Conferma ✕":"✕"}
                    </button>
                  </div>
                  {/* turni / obiettivo */}
                  <div style={RIGA}>
                    <span>{m.codice||"—"} · Turni</span>
                    <span style={{color:"#e2eeff",fontWeight:700}}>{tot}{m.stato!=="MPS"&&<span style={{color:"#2d5a8a",fontWeight:400}}> / {m.obiettivo}</span>}</span>
                  </div>
                  {/* blocchetto M/P/N a segmenti */}
                  <div style={{display:"flex",border:"1px solid #16304f",borderRadius:"5px",overflow:"hidden",margin:"6px 0 3px"}}>
                    <span style={{...SEG,color:"#60a5fa"}}><b style={{display:"block",fontSize:"13px"}}>{r.m}</b>M</span>
                    <span style={{...SEG,color:"#c4b5fd",borderLeft:"1px solid #16304f"}}><b style={{display:"block",fontSize:"13px"}}>{r.p}</b>P</span>
                    <span style={{...SEG,color:"#6ee7b7",borderLeft:"1px solid #16304f"}}><b style={{display:"block",fontSize:"13px"}}>{r.n}</b>N</span>
                  </div>
                  <div style={RIGA}><span style={{color:"#e879f9"}}>▦ Weekend lav.</span><b style={{color:"#e879f9"}}>{r.wk}</b></div>
                  {m.stato!=="MPS"&&<div style={RIGA}><span style={{color:"#a78bfa"}}>🗓 Wk liberi</span><b style={{color:"#a78bfa"}}>{wkLib}</b></div>}
                  {m.ambulatorio&&<div style={RIGA}><span style={{color:"#34d399"}}>🏥 Ambulatorio</span><b style={{color:"#34d399"}}>{ambN}</b></div>}
                  <div style={RIGA}><span style={{color:psN>0?"#fb923c":"#3d5878"}}>🚑 PS</span><b style={{color:psN>0?"#fb923c":"#3d5878"}}>{psN}</b></div>
                  <div style={RIGA}>
                    <span style={{color:pm.tot>0?"#fbbf24":"#3d5878"}}>📋 Permessi</span>
                    <b style={{color:pm.tot>0?"#fbbf24":"#3d5878"}}>{pm.tot}{pm.tot>0&&<span style={{color:"#a16207",fontWeight:400}}> {permTxt}</span>}</b>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* REGOLE */}
      {tab==="regole"&&(()=>{
        const numInp = (val:number,onCh:(v:number)=>void) => (
          <input type="number" min={0} max={9} value={val}
            onChange={e=>onCh(Math.max(0,Math.min(9,+e.target.value||0)))}
            style={{width:"52px",background:"#081120",border:"1px solid #2f5a8a",color:"#60a5fa",borderRadius:"6px",padding:"5px 7px",fontSize:"12px",fontFamily:"monospace",textAlign:"center"}}/>
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
        type CampoTop = "maxNotti"|"maxNottiConsec"|"maxConsec"|"wkTarget"|"maxAssSett"|"blocchiMattina";
        const setTop = (campo:CampoTop,v:number) => updRegole({...regole,[campo]:v});
        const LBL: React.CSSProperties = {color:"#2d5a8a",fontSize:"10px",fontFamily:"monospace"};
        const BOX: React.CSSProperties = {background:"#122036",border:"1px solid #1e3a5f",borderRadius:"8px",padding:"14px",marginBottom:"12px"};
        const righe: [Fascia,string][] = [["fer","Feriale"],["sab","Sabato"],["fest","Domenica / Festivo"]];
        const limiti: [CampoTop,string,string][] = [
          ["maxNotti","Max notti / mese","Tetto di notti per medico nel mese. Contano tutte le notti già in tabellone — N e 3, anche sottolineate — più quelle assegnate in automatico."],
          ["maxNottiConsec","Max notti di fila","Notti ravvicinate (una sola notte libera in mezzo: N-libero-N-libero-N) oltre le quali la successiva è vietata. 2 = ammesse due notti così, la terza no."],
          ["maxConsec","Max giorni consecutivi di lavoro","Giorni lavorati di fila oltre i quali serve un giorno libero (vale anche a cavallo di mese)."],
          ["wkTarget","Obiettivo weekend liberi","Resta ADATTIVO al mese: questo è il tetto (2 con ≥4 coppie sab-dom, meno nei mesi corti)."],
          ["maxAssSett","Max turni associati / settimana","Massimo di M+P nella stessa giornata per medico, per settimana."],
          ["blocchiMattina","Continuità mattine (blocchi)","Nei giorni SENZA mattina del ML, un unico medico \"porta\" le mattine per blocchi di ~N giorni, con passaggio di consegne: l'ultima mattina dell'uscente affianca la prima dell'entrante, entro il fabbisogno MINIMO. Preferenza morbida, mai vincolante. 0 = disattivata."],
        ];
        return (
          <div className="np" style={{padding:"16px",maxWidth:"640px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
              <span style={{fontSize:"13px",fontWeight:700,color:"#e2eeff"}}>Regole del reparto</span>
              <button onClick={()=>updRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)))}
                style={{background:"#1a0606",color:"#f87171",border:"1px solid #7f1d1d",borderRadius:"6px",padding:"6px 13px",cursor:"pointer",fontSize:"11px",fontFamily:"monospace",fontWeight:700}}>
                Ripristina default
              </button>
            </div>
            <div style={{...LBL,marginBottom:"12px",lineHeight:1.6}}>
              Le modifiche sono salvate subito e usate dalla PROSSIMA generazione (①/②).
              La <b>Notte</b> resta fissa a 1/giorno: è un invariante dell'algoritmo, non un parametro.
            </div>

            <div style={BOX}>
              <div style={{...LBL,fontWeight:700,marginBottom:"10px",color:"#60a5fa"}}>FABBISOGNO GIORNALIERO (min–max)</div>
              <table style={{borderCollapse:"collapse",fontFamily:"monospace"}}>
                <thead><tr>
                  <th style={{...LBL,textAlign:"left",padding:"4px 14px 4px 0"}}></th>
                  <th style={{...LBL,padding:"4px 8px"}}>Mattine min</th><th style={{...LBL,padding:"4px 8px"}}>max</th>
                  <th style={{...LBL,padding:"4px 8px"}}>Pomeriggi min</th><th style={{...LBL,padding:"4px 8px"}}>max</th>
                </tr></thead>
                <tbody>
                  {righe.map(([k,lbl])=>(
                    <tr key={k}>
                      <td style={{...LBL,color:"#e2eeff",padding:"4px 14px 4px 0"}}>{lbl}</td>
                      <td style={{padding:"4px 8px",textAlign:"center"}}>{numInp(regole.fabb[k].mMin,v=>setFabb(k,"mMin",v))}</td>
                      <td style={{padding:"4px 8px",textAlign:"center"}}>{numInp(regole.fabb[k].mMax,v=>setFabb(k,"mMax",v))}</td>
                      <td style={{padding:"4px 8px",textAlign:"center"}}>{numInp(regole.fabb[k].pMin,v=>setFabb(k,"pMin",v))}</td>
                      <td style={{padding:"4px 8px",textAlign:"center"}}>{numInp(regole.fabb[k].pMax,v=>setFabb(k,"pMax",v))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={BOX}>
              <div style={{...LBL,fontWeight:700,marginBottom:"10px",color:"#60a5fa"}}>GIORNI DI AMBULATORIO</div>
              <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"8px"}}>
                {[0,1,2,3,4].map(d=>{
                  const on = regole.giorniAmb.includes(d);
                  return (
                    <button key={d}
                      onClick={()=>updRegole({...regole,giorniAmb:
                        (on ? regole.giorniAmb.filter(x=>x!==d) : [...regole.giorniAmb,d]).sort((a,b)=>a-b)})}
                      style={{background:on?"#052e16":"#081120",color:on?"#34d399":"#3d5878",
                              border:`1px solid ${on?"#059669":"#1e3a5f"}`,borderRadius:"6px",
                              padding:"7px 13px",cursor:"pointer",fontSize:"11px",fontWeight:700,
                              fontFamily:"monospace"}}>
                      {DF[d]}
                    </button>
                  );
                })}
              </div>
              <div style={{...LBL,fontSize:"9px",lineHeight:1.6}}>
                Nei giorni selezionati (se non festivi) viene generato un turno A con la solita
                rotazione fra i medici abilitati. Nessun giorno selezionato = nessun ambulatorio.
                I festivi restano sempre esclusi.
              </div>
            </div>

            <div style={BOX}>
              <div style={{...LBL,fontWeight:700,marginBottom:"10px",color:"#60a5fa"}}>LIMITI PER MEDICO</div>
              {limiti.map(([k,lbl,hint])=>(
                <div key={k} style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"10px"}}>
                  {numInp(regole[k],v=>setTop(k,v))}
                  <div>
                    <div style={{...LBL,color:"#e2eeff",fontWeight:700}}>{lbl}</div>
                    <div style={{...LBL,fontSize:"9px"}}>{hint}</div>
                  </div>
                </div>
              ))}
              {(()=>{ const on = regole.notteLiberoNotte; return (
                <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"10px"}}>
                  <button onClick={()=>updRegole({...regole,notteLiberoNotte:!on,riposoEsteso:!on?false:regole.riposoEsteso})}
                    style={{width:"52px",background:on?"#052e16":"#081120",color:on?"#34d399":"#3d5878",
                            border:`1px solid ${on?"#059669":"#1e3a5f"}`,borderRadius:"6px",
                            padding:"5px 0",cursor:"pointer",fontSize:"11px",fontWeight:700,
                            fontFamily:"monospace"}}>
                    {on?"ON":"OFF"}
                  </button>
                  <div>
                    <div style={{...LBL,color:"#e2eeff",fontWeight:700}}>Notte → libero → notte</div>
                    <div style={{...LBL,fontSize:"9px"}}>Se attivo, due giorni dopo una notte è ammessa un'altra Notte (invece che al massimo un Pomeriggio) già nella generazione di base, e il pattern non è più segnalato come violazione. Resta il tetto «Max notti di fila». Se spento, la deroga resta usata solo dall'ultima chance. Incompatibile con «Riposo esteso»: attivarne uno spegne l'altro.</div>
                  </div>
                </div>
              );})()}
              {(()=>{ const on = regole.riposoEsteso; return (
                <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"2px"}}>
                  <button onClick={()=>updRegole({...regole,riposoEsteso:!on,notteLiberoNotte:!on?false:regole.notteLiberoNotte})}
                    style={{width:"52px",background:on?"#052e16":"#081120",color:on?"#34d399":"#3d5878",
                            border:`1px solid ${on?"#059669":"#1e3a5f"}`,borderRadius:"6px",
                            padding:"5px 0",cursor:"pointer",fontSize:"11px",fontWeight:700,
                            fontFamily:"monospace"}}>
                    {on?"ON":"OFF"}
                  </button>
                  <div>
                    <div style={{...LBL,color:"#e2eeff",fontWeight:700}}>Riposo esteso dopo la notte</div>
                    <div style={{...LBL,fontSize:"9px"}}>Se attivo, dopo una Notte anche il SECONDO giorno deve restare completamente libero: nessun turno, ammessi solo X, ANA, per11, 104 o L. Vieta quindi anche il Pomeriggio a g+2. È un vincolo duro: prevale su «Notte → libero → notte» e non viene mai derogato, nemmeno dall'ultima chance. Incompatibile con «Notte → libero → notte»: attivarne uno spegne l'altro.</div>
                  </div>
                </div>
              );})()}
            </div>
          </div>
        );
      })()}

      {/* ── DETTAGLIO FABBISOGNO ── si apre toccando il contatore F.
             m/p/n/a sono CONTEGGI di turni; il totale è in unità di vt (notte ×2). */}
      {fabbAperto && (()=>{
        const RIGA = (sig:string, lbl:string, n:number, peso:number, col:string) => (
          <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"6px 0",borderBottom:"1px solid #1e3a5f"}}>
            <span style={{width:"22px",textAlign:"center",fontWeight:700,color:col}}>{sig}</span>
            <span style={{flex:1,color:"#8fb3d9",fontSize:"11px"}}>{lbl}</span>
            <span style={{color:"#e2f0ff",fontWeight:700,fontSize:"13px",minWidth:"28px",textAlign:"right"}}>{n}</span>
            <span style={{color:"#3d5878",fontSize:"10px",minWidth:"52px",textAlign:"right"}}>
              {peso===2 ? `×2 = ${n*2}` : `= ${n}`}
            </span>
          </div>
        );
        return (
          <div onClick={()=>setFabbAperto(false)}
               style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",
                       justifyContent:"center",zIndex:50,padding:"16px"}}>
            <div onClick={e=>e.stopPropagation()}
                 style={{background:"#0d1117",border:"1px solid #2f5a8a",borderRadius:"10px",padding:"16px",
                         width:"100%",maxWidth:"360px",fontFamily:"monospace",boxShadow:"0 10px 40px #000"}}>
              <div style={{fontSize:"8px",letterSpacing:".15em",textTransform:"uppercase",color:"#3d5878"}}>Fabbisogno del mese</div>
              <div style={{fontSize:"15px",fontWeight:700,color:"#e2eeff",marginBottom:"10px"}}>{MESI[mese]} {anno}</div>

              {RIGA("M","Mattine (minimo di copertura)", fab.m, 1, "#60a5fa")}
              {RIGA("P","Pomeriggi (minimo di copertura)", fab.p, 1, "#a78bfa")}
              {RIGA("N","Notti (una per giorno)", fab.n, 2, "#4ade80")}
              {RIGA("A",`Ambulatori (${regole.giorniAmb.length?regole.giorniAmb.map(d=>DF[d].toLowerCase()).join(", ")+" non festivi":"nessun giorno"})`, fab.a, 1, "#34d399")}

              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #1e3a5f"}}>
                <span style={{color:"#8fb3d9",fontSize:"11px"}}>Totale lordo</span>
                <span style={{color:"#e2f0ff",fontWeight:700}}>{bil.fLordo}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid #1e3a5f"}}>
                <span style={{color:"#8fb3d9",fontSize:"11px"}}>− coperti dai medici MPS</span>
                <span style={{color:"#c084fc",fontWeight:700}}>{bil.copertoMPS}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0"}}>
                <span style={{color:"#e2eeff",fontSize:"12px",fontWeight:700}}>F — fabbisogno netto</span>
                <span style={{color:bil.ok?"#4ade80":"#f87171",fontWeight:700,fontSize:"15px"}}>{bil.f}</span>
              </div>

              <div style={{background:bil.ok?"#052e16":"#1a0606",border:`1px solid ${bil.ok?"#166534":"#7f1d1d"}`,
                           borderRadius:"6px",padding:"8px 10px",margin:"6px 0 12px",fontSize:"11px",
                           color:bil.ok?"#4ade80":"#f87171",textAlign:"center",fontWeight:700}}>
                {bil.ok ? `D ${bil.d} ≥ F ${bil.f} · copribile, margine +${bil.d-bil.f}`
                        : `D ${bil.d} < F ${bil.f} · scoperto di ${bil.f-bil.d} turni`}
              </div>

              <div style={{fontSize:"9px",color:"#3d5878",lineHeight:1.6,marginBottom:"12px"}}>
                I conteggi sono in turni; il totale è nell'unità della colonna Ob., dove la notte pesa 2.
                L'ambulatorio non copre la mattina: nei giorni di ambulatorio servono {fab.a>0?"le mattine minime più l'ambulatorio":"le mattine minime"}.
              </div>

              <button onClick={()=>setFabbAperto(false)} style={{width:"100%",background:"#1e3a5f",color:"#bfdbfe",
                border:"1px solid #2f5a8a",borderRadius:"6px",padding:"9px",cursor:"pointer",fontSize:"12px",
                fontWeight:700,fontFamily:"monospace"}}>Chiudi</button>
            </div>
          </div>
        );
      })()}

      {cella   && <CellModal medico={medici.find(x=>x.id===cella.id)} giorno={cella.g} anno={anno} mese={mese}
                             esistenti={gT(cella.id,cella.g)}
                             onSalva={(t)=>sT(cella.id,cella.g,t)}
                             onClose={()=>setCella(null)}/>}
      {editDoc && <DocModal doc={editDoc} onSalva={salvaDoc} onClose={()=>setEditDoc(null)}/>}
    </div>
  );
}
