import type { Medico, TurniMese, CellaScoperta, CausaVincolo, CausaCluster, DiagnosiCausale } from "./types";
import { DF, dowOf } from "./date";
import { cloneT } from "./turni";
import { ENG, mkRng } from "./state";
import { getRegole, setRegole } from "./regole";
import { makeCtx } from "./ctx";
import { risolviCluster } from "./fasi";

// ─── DIAGNOSI CAUSALE (v0.3.13) ───────────────────────────────────────────────
// Le due diagnosi esistenti guardano gli ESTREMI del problema: quella STATICA
// certifica le impossibilità di singola cella/giornata (ignorando di proposito
// i vincoli multi-giorno), quella EMPIRICA conta il SINTOMO finale (quale cella
// resta bucata nei tentativi). Nessuna risponde alla domanda "qual è il VERO
// blocco?", che quasi sempre sta nell'interazione fra giorni: la notte di g-1
// che consuma l'unico candidato per la M di g, l'ambulatorio che non può cadere
// il giorno dopo una notte, il tetto notti che strozza un intero cluster.
//
// Qui si fa un'ANALISI CONTROFATTUALE PER FINESTRE, usando il solver a
// backtracking risolviCluster come oracolo di fattibilità:
//
//   1. CLUSTER, NON GIORNI. I buchi (celle M/P/N sotto minimo + ambulatori
//      mancanti) vengono raggruppati in finestre ±2 giorni fuse — l'orizzonte
//      dei vincoli multi-giorno (Regola N, distanza associati).
//   2. SONDE DI RILASSAMENTO. Ogni finestra viene svuotata dei turni AUTOMATICI
//      e risolta da capo più volte, ogni volta rilassando UN SOLO vincolo:
//      riassegnare la A a un altro abilitato → togliere l'obbligo di
//      ambulatorio → Regola N a g+2 → tetto notti/mese → notti ravvicinate →
//      giorni consecutivi → obiettivi mensili. Il/i rilassamenti che rendono la
//      finestra risolvibile SONO la causa. Se la finestra si risolve già senza
//      rilassare nulla, la causa non è locale (conflitto coi weekend liberi o
//      limiti della ricerca); se non si risolve nemmeno rilassando tutto, il
//      deficit è materiale (assenze/turni manuali/notti a cavallo del mese).
//   3. NUCLEO DEL PROBLEMA. Per le finestre infeasibili si prova a SACRIFICARE
//      una cella alla volta: se rinunciando alla notte di ven 13 tutto il resto
//      (inclusa la cella dichiarata scoperta) si copre, il verdetto è "il
//      problema reale non è la mattina di sab 14 ma la notte di ven 13".
//   4. AMBULATORIO. Quando la A è impiazzabile, si spiega PERCHÉ ogni abilitato
//      è indisponibile (riposo post-notte, assenza, giornata occupata, ...).
//
// Modulo in sola lettura per il chiamante: ogni sonda lavora su una COPIA del
// tabellone (cloneT) con un contesto proprio. Le sonde sui limiti numerici
// (maxNotti, maxNottiConsec, maxConsec) passano da setRegole con ripristino
// in `finally`: il motore legge le regole a ogni makeCtx, quindi l'override è
// visibile solo dentro la singola sonda. Budget di TEMPO e di NODI espliciti:
// una prova d'infeasibilità può bruciare l'intero tetto nodi, e la diagnosi
// non deve mai rallentare percettibilmente la generazione.
//
// NB epistemico: il solver è esatto entro il tetto nodi. Un "non risolvibile"
// con nodi esauriti è un'evidenza forte ma non una dimostrazione (a differenza
// dei certificati statici): per questo il pannello parla di causa PROBABILE.

const FASCE = ["M", "P", "N"] as const;
const FL: Record<"M" | "P" | "N", string> = { M: "la mattina", P: "il pomeriggio", N: "la notte" };

interface Mod {
  ambMove?: boolean;      // A automatiche della finestra libere di cambiare assegnatario
  ambOff?: boolean;       // nessun obbligo di coprire l'ambulatorio (A auto rimosse)
  relaxN?: boolean;       // Regola N: ammessa N a g+2 (notte-libero-notte)
  maxNotti?: boolean;     // tetto notti/mese → illimitato
  nottiConsec?: boolean;  // tetto notti ravvicinate → illimitato
  maxConsec?: boolean;    // max giorni lavorativi consecutivi → illimitato
  obiettivo?: boolean;    // obiettivi mensili → illimitati
  drops?: CellaScoperta[];// riduce di 1 il fabbisogno di queste celle (per il nucleo)
}

interface EsitoProva {
  ok: boolean;
  /** Medici che nella soluzione trovata perdono weekend liberi vs il tabellone attuale. */
  wk?: { nome: string; da: number; a: number }[];
  /** Giorni d'ambulatorio della finestra SENZA alcun abilitato disponibile. */
  ambBloccati?: number[];
  /** Per ogni giorno bloccato: perché ciascun abilitato è indisponibile. */
  ambMotivi?: string[];
}

export function diagnosiCausale(
  anno: number, mese: number, ndim: number, medici: Medico[], turni: TurniMese,
  opz?: { maxMs?: number; nodi?: number },
): DiagnosiCausale {
  const t0 = Date.now();
  const maxMs = opz?.maxMs ?? 1200;
  const nodi = opz?.nodi ?? Math.min(30000, ENG.CLUSTER_NODES);
  // Scadenza CORRENTE: il loop principale la imposta PER FINESTRA (sotto-budget
  // equo), così una prima finestra ostica non può divorare tutto il tempo e
  // lasciare inesplorate le successive (che spesso sono le più importanti).
  let fineCorr = t0 + maxMs;
  const scaduto = () => Date.now() >= fineCorr;
  const fineTot = () => Date.now() >= t0 + maxMs;
  const REG0 = getRegole();
  const gL = (g: number) => `${DF[dowOf(anno, mese, g)].slice(0, 3)} ${g}`;
  const cellaLbl = (c: CellaScoperta) => `${FL[c.f]} di ${gL(c.g)}`;

  // ── 1) Stato attuale: celle scoperte COLMABILI + ambulatori mancanti ───────
  // needEff esclude da sé le celle certificate impossibili dalla statica (che
  // hanno già la loro spiegazione): qui si analizzano solo i buchi "misteriosi".
  const c0 = makeCtx(anno, mese, ndim, medici, turni);
  const scoperte: CellaScoperta[] = [];
  for (let g = 1; g <= ndim; g++) for (const f of FASCE)
    if (c0.cf(g, f) < c0.needEff(g, f)) scoperte.push({ g, f });
  const ambMancanti = c0.giorniArr.filter(g => c0.isAmb(g) && !c0.isH(g)
    && !medici.some(m => c0.gt(m.id, g).some(s => s.tipo === "A")));
  const semi = [...new Set([...scoperte.map(c => c.g), ...ambMancanti])].sort((a, b) => a - b);
  if (semi.length === 0) return { cluster: [], completa: true, ms: Date.now() - t0 };

  // ── 2) Finestre ±2 attorno ai buchi, fuse (tetto 10 giorni, come riparaBuchi)
  const finestre: [number, number][] = [];
  for (const g of semi) {
    const lo = Math.max(1, g - 2), hi = Math.min(ndim, g + 2);
    const last = finestre[finestre.length - 1];
    if (last && lo <= last[1] + 1 && Math.max(hi, last[1]) - last[0] + 1 <= 10) last[1] = Math.max(hi, last[1]);
    else finestre.push([lo, hi]);
  }

  // Perché un abilitato NON può prendere la A in g (primo motivo bloccante).
  type C = ReturnType<typeof makeCtx>;
  const motivoNoA = (ctx: C, m: Medico, g: number): string => {
    if (m.stato === "MPS") return "MPS (fuori generazione)";
    if (ctx.haX(m.id, g)) return "escluso (X)";
    if (ctx.gt(m.id, g).some(s => ["L", "ANA", "per11", "104"].includes(s.tipo))) return "assente";
    if (ctx.haN(m.id, g)) return "notte quel giorno";
    if (!ctx.canLav(m.id, g)) return "riposo obbligatorio (notte il giorno prima)";
    if (!ctx.canMatt(m.id, g)) return "mattina vietata (notte due giorni prima)";
    if (!ctx.canConsec(m.id, g)) return "supererebbe i giorni consecutivi";
    return "giornata già occupata (turni manuali)";
  };

  // ── 3) La SONDA: svuota la finestra, applica il rilassamento, risolvi ──────
  const prova = (lo: number, hi: number, mod: Mod): EsitoProva => {
    const tocca = mod.maxNotti || mod.nottiConsec || mod.maxConsec;
    if (tocca) setRegole({
      ...REG0,
      maxNotti: mod.maxNotti ? 999 : REG0.maxNotti,
      maxNottiConsec: mod.nottiConsec ? 999 : REG0.maxNottiConsec,
      maxConsec: mod.maxConsec ? 999 : REG0.maxConsec,
    });
    try {
      const meds = mod.obiettivo ? medici.map(m => ({ ...m, obiettivo: 9999 })) : medici;
      const ctx = makeCtx(anno, mese, ndim, meds, cloneT(turni), null, mod.relaxN);
      // Svuota gli AUTOMATICI M/P/N della finestra; con ambMove/ambOff anche le
      // A automatiche (i manuali restano fatti immovibili, come sempre).
      const viaA = mod.ambMove || mod.ambOff;
      for (let g = lo; g <= hi; g++) for (const m of meds) {
        const cc = ctx.gt(m.id, g);
        const keep = cc.filter(s => s.man || !(s.tipo === "M" || s.tipo === "P" || s.tipo === "N" || (viaA && s.tipo === "A")));
        if (keep.length !== cc.length) ctx.st(m.id, g, keep);
      }
      // Celle da coprire (needEff è stabile: guarda solo manuali/immovibili).
      const cells: { g: number; f: string; need: number }[] = [];
      for (let g = lo; g <= hi; g++) for (const f of FASCE) {
        let need = ctx.needEff(g, f);
        if (mod.drops) need -= mod.drops.filter(d => d.g === g && d.f === f).length;
        if (need > 0) cells.push({ g, f, need });
      }
      // Ambulatori della finestra ancora senza A (obbligo, salvo ambOff).
      const daA: number[] = [];
      if (!mod.ambOff) {
        for (let g = lo; g <= hi; g++)
          if (ctx.isAmb(g) && !ctx.isH(g) && !meds.some(m => ctx.gt(m.id, g).some(s => s.tipo === "A")))
            daA.push(g);
      }
      const puoA = (m: Medico, g: number) =>
        m.ambulatorio && m.stato !== "MPS" && !ctx.haX(m.id, g)
        && !ctx.gt(m.id, g).some(s => ["L", "ANA", "per11", "104"].includes(s.tipo))
        && !ctx.haN(m.id, g) && ctx.canMatt(m.id, g) && ctx.canConsec(m.id, g)
        && ctx.gt(m.id, g).filter(s => s.tipo !== "X" && !["L", "ANA", "per11", "104"].includes(s.tipo)).length === 0;
      const ambBloccati = daA.filter(g => !meds.some(m => puoA(m, g)));
      if (ambBloccati.length) {
        const ambMotivi = ambBloccati.map(g => {
          const det = meds.filter(m => m.ambulatorio)
            .map(m => `${m.nome.split(" ").pop()}: ${motivoNoA(ctx, m, g)}`).join("; ");
          return `Ambulatorio di ${gL(g)} senza abilitati disponibili — ${det}`;
        });
        return { ok: false, ambBloccati, ambMotivi };
      }
      // Piazzamento COMBINATORIO delle A (di solito 0-1 giorni, raram. 2): per
      // ogni assegnatario possibile si tenta il solve dell'intera finestra.
      // Così "l'assegnatario sbagliato della A" non maschera una finestra
      // risolvibile, e viceversa la A non viene sacrificata mai.
      let solves = 0;
      const rng = mkRng(0xD1A6 + lo * 2654435761);
      const piazza = (i: number): boolean => {
        if (scaduto() || solves >= 6) return false;
        if (i >= daA.length) { solves++; return risolviCluster(ctx, cells, rng, nodi); }
        const g = daA[i];
        for (const m of meds) {
          if (!puoA(m, g)) continue;
          ctx.add(m.id, g, "A");
          if (!ctx.gt(m.id, g).some(s => s.tipo === "A" && !s.man)) continue;
          if (piazza(i + 1)) return true;
          ctx.st(m.id, g, ctx.gt(m.id, g).filter(s => !(s.tipo === "A" && !s.man)));
        }
        return false;
      };
      if (!piazza(0)) return { ok: false };
      // Costo in weekend liberi della soluzione trovata vs il tabellone attuale.
      const wk: { nome: string; da: number; a: number }[] = [];
      for (const m of c0.mrMdc) {
        const da = c0.cntWkLiberi(m.id), a = ctx.cntWkLiberi(m.id);
        if (a < da) wk.push({ nome: m.nome.split(" ").pop() as string, da, a });
      }
      return { ok: true, wk };
    } finally { if (tocca) setRegole(REG0); }
  };

  // Etichette e suggerimenti per i rilassamenti.
  const ETI: Record<CausaVincolo, string> = {
    ambMove: "l'assegnatario dell'ambulatorio",
    ambOff: "l'obbligo di coprire l'ambulatorio",
    regN: "il riposo a g+2 dopo la notte (Regola N stretta)",
    maxNotti: `il tetto di ${REG0.maxNotti} notti/mese per medico`,
    nottiConsec: `il tetto di ${REG0.maxNottiConsec} notti ravvicinate`,
    maxConsec: `il massimo di ${REG0.maxConsec} giorni lavorativi consecutivi`,
    obiettivo: "gli obiettivi mensili già raggiunti dai medici disponibili",
  };
  const HINT: Record<CausaVincolo, string> = {
    ambMove: "Suggerimento: assegna manualmente la A di quel giorno a un altro abilitato e rigenera.",
    ambOff: "Suggerimento: copri l'ambulatorio in altro modo o sposta il giorno d'ambulatorio (pannello Regole).",
    regN: "Suggerimento: attivare \u00ABnotte-libero-notte\u00BB dal pannello Regole sbloccherebbe questi giorni.",
    maxNotti: "Suggerimento: alzare il tetto notti/mese dal pannello Regole sbloccherebbe questi giorni.",
    nottiConsec: "Suggerimento: alzare il tetto di notti ravvicinate dal pannello Regole sbloccherebbe questi giorni.",
    maxConsec: "Suggerimento: alzare il massimo di giorni consecutivi dal pannello Regole sbloccherebbe questi giorni.",
    obiettivo: "Suggerimento: alzare l'obiettivo mensile dei medici coinvolti sbloccherebbe questi giorni.",
  };

  // ── 4) Analisi di ogni finestra ────────────────────────────────────────────
  const cluster: CausaCluster[] = [];
  let completa = true;

  for (let iw = 0; iw < finestre.length; iw++) {
    const [lo, hi] = finestre[iw];
    if (fineTot()) { completa = false; break; }
    // Sotto-budget della finestra: quota equa del tempo residuo sulle finestre
    // rimanenti (minimo 250ms), mai oltre la scadenza globale.
    const residuo = t0 + maxMs - Date.now();
    fineCorr = Math.min(t0 + maxMs, Date.now() + Math.max(250, residuo / (finestre.length - iw)));
    const celleFin = scoperte.filter(c => c.g >= lo && c.g <= hi);
    const ambFin = ambMancanti.filter(g => g >= lo && g <= hi);
    const header = lo === hi ? gL(lo) : `${gL(lo)}\u2013${gL(hi)}`;
    const dettagli: string[] = [];
    const haAmbFin = (() => { for (let g = lo; g <= hi; g++) if (c0.isAmb(g) && !c0.isH(g)) return true; return false; })();

    const base = prova(lo, hi, {});
    if (base.ambMotivi) dettagli.push(...base.ambMotivi);

    let esito: CausaCluster["esito"];
    const vincoli: CausaVincolo[] = [];
    const nucleo: CellaScoperta[] = [];
    let nucleoCongiunto = false;
    let motivo = "";

    if (base.ok) {
      // La finestra si copre così com'è: il problema NON è locale.
      esito = "locale";
      motivo = `${header}: copribile riorganizzando i soli turni di questi giorni \u2014 il buco non nasce qui ma dall'interazione col resto del mese (weekend liberi da garantire, scelte delle fasi a monte). Rigenerare, o accettare la variante d'ultima chance se proposta, pu\u00F2 bastare.`;
      if (base.wk && base.wk.length)
        dettagli.push(`Coprirla toglierebbe weekend liberi a: ${base.wk.map(w => `${w.nome} (${w.da}\u2192${w.a})`).join(", ")}.`);
    } else {
      // Sonde a rilassamento singolo, in ordine di specificit\u00E0.
      const sonde: [CausaVincolo, Mod][] = [
        ["ambMove", { ambMove: true }],
        ["ambOff", { ambOff: true }],
        ["regN", { relaxN: true }],
        ["maxNotti", { maxNotti: true }],
        ["nottiConsec", { nottiConsec: true }],
        ["maxConsec", { maxConsec: true }],
        ["obiettivo", { obiettivo: true }],
      ];
      for (const [k, mod] of sonde) {
        if (scaduto()) { completa = false; break; }
        if ((k === "ambMove" || k === "ambOff") && !haAmbFin) continue;
        if (k === "ambOff" && vincoli.includes("ambMove")) continue;  // implicato
        if (k === "regN" && REG0.notteLiberoNotte) continue;          // gi\u00E0 attivo
        if (prova(lo, hi, mod).ok) vincoli.push(k);
      }

      if (vincoli.length) esito = "vincolo";
      else if (!scaduto() && prova(lo, hi, { ambOff: haAmbFin, relaxN: true, maxNotti: true, nottiConsec: true, maxConsec: true, obiettivo: true }).ok) esito = "combinazione";
      else esito = "struttura";

      // NUCLEO: quale cella (o insieme minimo di celle), sacrificata, sblocca
      // tutto il resto? Candidate: solo celle NON già coperte da turni MANUALI
      // (i manuali sono immovibili: non c'è nulla da sacrificare lì), ordinate
      // per vicinanza ai buchi con le notti prima (il colpevole classico).
      // DUE LIVELLI: si cerca SEMPRE prima sotto le regole PIENE — se un
      // singolo sacrificio basta già con le regole normali, quello È il
      // problema reale, anche quando l'esito della finestra intera è
      // "struttura". Solo se sotto le regole piene non si trova nulla si
      // ripiega sui vincoli tutti rilassati (nucleoRilassato=true: il
      // messaggio deve qualificarlo).
      const TUTTI: Mod = { ambOff: haAmbFin, relaxN: true, maxNotti: true, nottiConsec: true, maxConsec: true, obiettivo: true };
      const covMan = (g: number, f: "M" | "P" | "N") =>
        medici.reduce((n, m) => n + c0.gt(m.id, g).filter(s => s.man && s.tipo === f).length, 0);
      const candCells: CellaScoperta[] = [];
      for (let g = lo; g <= hi; g++) for (const f of FASCE)
        if (c0.needEff(g, f) > covMan(g, f)) candCells.push({ g, f });
      const dist = (c: CellaScoperta) => Math.min(
        ...celleFin.map(s => Math.abs(s.g - c.g)),
        ...ambFin.map(a => Math.abs(a - c.g)),
        99);
      candCells.sort((a, b) => (dist(a) - dist(b)) || ((a.f === "N" ? 0 : 1) - (b.f === "N" ? 0 : 1)) || (a.g - b.g));
      const cand = candCells.slice(0, 12);
      const stessa = (a: CellaScoperta, b: CellaScoperta) => a.g === b.g && a.f === b.f;
      let nucleoRilassato = false;
      // 1° passo — sacrifici SINGOLI sotto regole piene: ogni cella che DA SOLA
      // sblocca il resto è un'ALTERNATIVA (fino a 3). È il caso classico "la M
      // di sabato non entra perché la vera stretta è la notte di venerdì".
      for (const c of cand) {
        if (scaduto()) { completa = false; break; }
        if (nucleo.length >= 3) break;
        if (prova(lo, hi, { drops: [c] }).ok) nucleo.push(c);
      }
      // 1b — per l'esito "struttura", stessi singoli sotto vincoli rilassati.
      if (nucleo.length === 0 && esito === "struttura" && !scaduto()) {
        for (const c of cand) {
          if (scaduto()) { completa = false; break; }
          if (nucleo.length >= 3) break;
          if (prova(lo, hi, { ...TUTTI, drops: [c] }).ok) { nucleo.push(c); nucleoRilassato = true; }
        }
      }
      // 2° passo — se nessun singolo basta, il deficit è più profondo: ricerca
      // GREEDY di un insieme minimo di sacrifici (max 3). A ogni giro si prova
      // ad aggiungere una cella al set corrente; se nessuna aggiunta risolve,
      // si fissa la candidata di testa e si riprova con set più grande. Una
      // passata di MINIMIZZAZIONE finale toglie i sacrifici superflui.
      if (nucleo.length === 0 && !scaduto()) {
        const cfgS: Mod = esito === "struttura" ? TUTTI : {};
        nucleoRilassato = esito === "struttura";
        let set: CellaScoperta[] = [], risolto = false;
        for (let giro = 0; giro < 3 && !risolto && !scaduto(); giro++) {
          let trovata = false;
          for (const c of cand) {
            if (set.some(x => stessa(x, c))) continue;
            if (scaduto()) break;
            if (prova(lo, hi, { ...cfgS, drops: [...set, c] }).ok) { set.push(c); risolto = trovata = true; break; }
          }
          if (!trovata) {
            const next = cand.find(c => !set.some(x => stessa(x, c)));
            if (!next) break;
            set.push(next);
          }
        }
        if (risolto) {
          for (let i = set.length - 1; i >= 0 && set.length > 1; i--) {
            if (scaduto()) break;
            const senza = set.filter((_, j) => j !== i);
            if (prova(lo, hi, { ...cfgS, drops: senza }).ok) set = senza;
          }
          nucleo.push(...set);
          nucleoCongiunto = true;
        } else nucleoRilassato = false;
      }

      // ── Messaggio ────────────────────────────────────────────────────────
      const parti: string[] = [];
      // Enumerazione COMPATTA delle celle scoperte: oltre 2 si riassume.
      const scoperteLbl = celleFin.length === 0
        ? `l'ambulatorio di ${ambFin.map(gL).join(", ")}`
        : celleFin.length <= 2 ? celleFin.map(cellaLbl).join(" e ")
        : `le ${celleFin.length} celle scoperte di questi giorni`;
      const qual = nucleoRilassato ? " (una volta alleggeriti i vincoli del motore)" : "";
      let nucleoFrase = "";
      if (nucleoCongiunto && nucleo.length > 1) {
        nucleoFrase = `il deficit \u00E8 pi\u00F9 profondo di una cella: il sacrificio minimo che salva tutto il resto${qual} \u00E8 rinunciare, insieme, a: ${nucleo.map(cellaLbl).join(" + ")}`;
      } else if (nucleo.length) {
        const nucleoAltrove = nucleo.filter(n => !celleFin.some(s => stessa(s, n)));
        if (nucleoAltrove.length) {
          nucleoFrase = `il problema reale non \u00E8 ${scoperteLbl} ma ${cellaLbl(nucleoAltrove[0])}: rinunciando a quella sola cella, tutto il resto della finestra si copre${qual}` +
            (nucleoAltrove.length > 1 ? ` (in alternativa: ${nucleoAltrove.slice(1).map(cellaLbl).join(", ")})` : "");
        } else {
          nucleoFrase = `il collo di bottiglia \u00E8 proprio ${nucleo.map(cellaLbl).join(" / ")}: sacrificando quella sola cella il resto si copre${qual}`;
        }
      }
      // Per gli esiti "vincolo"/"combinazione" il nucleo apre il messaggio (\u00E8
      // l'informazione pi\u00F9 actionable); per "struttura" lo chiude, dopo il
      // verdetto d'incopribilit\u00E0 (cos\u00EC le due frasi non si contraddicono).
      if (nucleoFrase && esito !== "struttura") parti.push(nucleoFrase);
      if (esito === "vincolo") {
        if (vincoli[0] === "ambMove")
          parti.push(`basta RIASSEGNARE l'ambulatorio (${ambFinLbl(ambFin, lo, hi, c0, gL)}) a un altro abilitato perch\u00E9 l'intera finestra si copra`);
        else if (vincoli[0] === "ambOff")
          parti.push(`il blocco \u00E8 l'ambulatorio (${ambFinLbl(ambFin, lo, hi, c0, gL)}): con qualunque assegnatario, coprirlo rende il resto incopribile`);
        else
          parti.push(`vincolo determinante: ${vincoli.map(k => ETI[k]).join("; ")}`);
        for (const k of vincoli) dettagli.push(HINT[k]);
      } else if (esito === "combinazione") {
        parti.push("nessun vincolo da solo spiega il buco: solo rilassandone pi\u00F9 d'uno insieme la finestra si copre \u2014 giorni al limite, valuta di alleggerire i turni manuali");
      } else {
        parti.push("incopribile anche ignorando TUTTI i vincoli del motore: in questi giorni mancano materialmente i medici (assenze, turni manuali, notti a cavallo del mese)");
      }
      if (nucleoFrase && esito === "struttura") parti.push(nucleoFrase);
      motivo = `${header}: ${parti.join(" \u2014 ")}.`;
    }

    cluster.push({ lo, hi, celle: celleFin, ambGiorni: ambFin, esito, vincoli, nucleo, nucleoCongiunto, motivo, dettagli });
  }

  return { cluster, completa, ms: Date.now() - t0 };
}

// Etichetta dei giorni d'ambulatorio rilevanti della finestra: quelli MANCANTI
// se ce ne sono, altrimenti tutti i giorni d'ambulatorio della finestra.
function ambFinLbl(
  ambFin: number[], lo: number, hi: number,
  c0: { isAmb: (g: number) => boolean; isH: (g: number) => boolean },
  gL: (g: number) => string,
) {
  if (ambFin.length) return ambFin.map(gL).join(", ");
  const tutti: number[] = [];
  for (let g = lo; g <= hi; g++) if (c0.isAmb(g) && !c0.isH(g)) tutti.push(g);
  return tutti.map(gL).join(", ") || "\u2014";
}
