import { useMemo, useState } from "react";
import type { Medico, Regole, TurniAll } from "../engine/types";
import {
  allineaFestiviPiano, buildShifts, periodoOk, fmtIt, hasSlot, iso, type RuoloPref, type RuoloFest,
} from "../engine/pianoFestivi";
import {
  type StatoFestivi, type PianoSalvato, automaticiFestivi, datiSorteggio, sorteggia, riepilogoPiano, controlliPiano,
  prossimoPeriodo, esenteNotti,
} from "../engine/festiviApp";
import { SC } from "./costanti";

// ─── SEZIONE FESTIVI (v0.3.60) ────────────────────────────────────────────────
// Il sorteggio dei turni festivi su un periodo (fino a 12 mesi): medici presi
// dall'elenco dell'app, saldo/storico/precedenze letti dai mesi salvati e
// correggibili a mano, piano stampabile. Il piano NON tocca i tabelloni.

const RUOLI: [RuoloPref, string][] = [["any", "qualsiasi turno"], ["nottePrima", "notte prima"], ["giorno", "giorno"], ["notte", "notte"]];
const num = (v: number) => String(Math.round(v * 100) / 100).replace(".", ",");
const dataBreve = (d: string) => fmtIt(d).slice(0, 9);                       // "ven 25/12"
const periodoTxt = (p: { start: string; end: string }) => `${fmtIt(p.start).slice(4)} – ${fmtIt(p.end).slice(4)}`;

export function FestiviPanel({ medici, turniAll, regole, stato, onStato, editabile, avviso, apriRegole }: {
  medici: Medico[];
  turniAll: TurniAll;
  regole: Regole;
  stato: StatoFestivi;
  onStato: (s: StatoFestivi) => void;
  editabile: boolean;
  avviso: (txt: string, tp?: string) => void;
  apriRegole: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confNext, setConfNext] = useState(false);
  const [nuovaPref, setNuovaPref] = useState<{ id: number | null; festa: string; ruolo: RuoloPref }>({ id: null, festa: "", ruolo: "any" });

  const lista = useMemo(() => allineaFestiviPiano(regole.festiviPiano, regole.reparto.festiviLocali), [regole.festiviPiano, regole.reparto.festiviLocali]);
  const errPeriodo = periodoOk(stato.periodo.start, stato.periodo.end);
  const idPart = medici.filter(m => !stato.esclusi.includes(m.id)).map(m => m.id);
  const chiavePart = idPart.join(",");
  const auto = useMemo(() => automaticiFestivi(stato, turniAll, medici, lista, regole.pianoFestiviAnni, idPart),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stato.periodo.start, stato.minSuper, stato.archivio, stato.piano, turniAll, medici, lista, regole.pianoFestiviAnni, chiavePart]);
  const dati = useMemo(() => datiSorteggio(stato, medici, lista, auto), [stato, medici, lista, auto]);
  const turniPeriodo = useMemo(() => buildShifts(dati.feste), [dati.feste]);
  const tipiFesta = useMemo(() => [...new Set(dati.feste.map(h => h.base))], [dati.feste]);

  const nome = (id: number | null) => id == null ? "—" : (medici.find(m => m.id === id)?.nome ?? "(medico eliminato)");
  const set = (patch: Partial<StatoFestivi>) => onStato({ ...stato, ...patch });
  const senza = <T,>(o: Record<number, T>, id: number) => { const { [id]: _via, ...resto } = o; return resto; };

  // ── stili (stessa veste del pannello Regole)
  const LBL: React.CSSProperties = { color: "#4b7aad", fontSize: "10px", fontFamily: "monospace", lineHeight: 1.6 };
  const BOX: React.CSSProperties = { background: "#122036", border: "1px solid #1e3a5f", borderRadius: "8px", padding: "14px", marginBottom: "12px" };
  const TIT: React.CSSProperties = { color: "#60a5fa", fontSize: "10px", fontFamily: "monospace", fontWeight: 700, cursor: "pointer", letterSpacing: ".04em" };
  const SOTTO: React.CSSProperties = { fontWeight: 400, color: "#4b7aad", letterSpacing: 0 };
  const INP: React.CSSProperties = { background: "#081120", border: "1px solid #2f5a8a", color: "#e2f0ff", borderRadius: "6px", padding: "5px 7px", fontSize: "12px", fontFamily: "monospace" };
  const btn = (bg: string, fg: string, bd: string, off = false): React.CSSProperties => ({
    background: off ? "#0f1a2a" : bg, color: off ? "#3d5878" : fg, border: `1px solid ${off ? "#1e3a5f" : bd}`, borderRadius: "6px", padding: "7px 13px",
    cursor: off ? "not-allowed" : "pointer", fontSize: "11px", fontWeight: 700, fontFamily: "monospace",
  });
  const chip = (on: boolean, col = "#60a5fa"): React.CSSProperties => ({
    background: on ? "#0d2240" : "#0a1524", color: on ? col : "#3d5878", border: `1px solid ${on ? col : "#1e3a5f"}`, borderRadius: "999px",
    padding: "4px 10px", cursor: "pointer", fontSize: "11px", fontFamily: "monospace", fontWeight: on ? 700 : 400, textDecoration: on ? "none" : "line-through",
  });
  const TH: React.CSSProperties = { background: "#0d1930", border: "1px solid #1e3a5f", padding: "5px 7px", textAlign: "left", fontSize: "10px", color: "#4b7aad", fontFamily: "monospace", whiteSpace: "nowrap" };
  const TD: React.CSSProperties = { border: "1px solid #16304f", padding: "5px 7px", fontSize: "11px", fontFamily: "monospace", color: "#e2f0ff", whiteSpace: "nowrap" };
  const numInp = (val: number, min: number, max: number, on: (v: number) => void, w = "58px", step = 1) => (
    <input type="number" min={min} max={max} step={step} value={val}
      onChange={e => { const v = parseFloat(e.target.value); on(Math.max(min, Math.min(max, isFinite(v) ? v : min))); }}
      style={{ ...INP, width: w, textAlign: "center", color: "#60a5fa" }} />
  );

  // ── sorteggio
  const genera = (seme: number) => {
    if (errPeriodo) { avviso(errPeriodo, "err"); return; }
    if (dati.partecipanti.length < 2) { avviso("Servono almeno due medici nel sorteggio.", "err"); return; }
    if (!turniPeriodo.length) { avviso("Nel periodo scelto non ci sono festività.", "warn"); return; }
    setBusy(true);
    setTimeout(() => {
      try {
        const st = { ...stato, seme };
        const { piano } = sorteggia(datiSorteggio(st, medici, lista, auto), st, new Date().toISOString());
        onStato({ ...st, piano });
        const scoperti = piano.turni.filter(t => t.medico == null).length;
        avviso(scoperti ? `Piano generato, ma ${scoperti} turni sono rimasti senza medico.` : "✓ Piano festivi generato.", scoperti ? "warn" : "ok");
      } catch (e) { avviso("Errore: " + (e as Error).message, "err"); }
      setBusy(false);
    }, 40);
  };
  const preparaProssimo = () => {
    if (!confNext) { setConfNext(true); setTimeout(() => setConfNext(false), 3500); return; }
    setConfNext(false);
    const next = prossimoPeriodo(stato);
    onStato(next);
    avviso(`✓ Nuovo periodo: ${periodoTxt(next.periodo)}. Saldo e storico riletti.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const piano = stato.piano;
  const righe = piano ? riepilogoPiano(piano) : [];
  const controlli = piano ? controlliPiano(piano, dati.soloGiorno, id => nome(id)) : [];
  const pianoAltroPeriodo = !!piano && (piano.periodo.start !== stato.periodo.start || piano.periodo.end !== stato.periodo.end);
  const scarto = righe.length ? Math.max(...righe.map(r => r.totale)) - Math.min(...righe.map(r => r.totale)) : 0;
  const note = (t: PianoSalvato["turni"][number]) => [t.sup ? "★ superfestivo" : "", t.condiviso ? "notte condivisa" : "", t.pref ? "♥ richiesto" : "", t.storico && !t.pref ? "↻ già fatta l'ultima volta" : ""].filter(Boolean).join(" · ");

  // ── tabella del piano (a schermo e in stampa)
  const tabellaPiano = (p: PianoSalvato, stampa: boolean) => (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead><tr>{["Data", "Turno", "Festività", "Punti", "Medico", ...(p.repOn ? ["Reperibile"] : []), "Note"].map(h => <th key={h} style={stampa ? undefined : TH}>{h}</th>)}</tr></thead>
      <tbody>
        {p.turni.map(t => (
          <tr key={t.date + t.tipo} style={!stampa && t.sup ? { background: "#1a1430" } : undefined}>
            <td style={stampa ? undefined : TD}>{fmtIt(t.date)}</td>
            <td style={stampa ? undefined : { ...TD, color: t.tipo === "notturno" ? "#4ade80" : "#93c5fd" }}>{t.tipo === "notturno" ? "notte" : "giorno"}</td>
            <td style={stampa ? undefined : { ...TD, whiteSpace: "normal" }}>{t.nomi.join(" / ")}</td>
            <td style={stampa ? undefined : { ...TD, textAlign: "center" }}>{num(t.punti)}</td>
            <td style={stampa ? undefined : { ...TD, fontWeight: 700, color: t.medico == null ? "#f87171" : "#e2f0ff" }}>{t.medico == null ? "NESSUNO" : nome(t.medico)}</td>
            {p.repOn && <td style={stampa ? undefined : { ...TD, color: "#a78bfa" }}>{nome(t.reperibile)}</td>}
            <td style={stampa ? undefined : { ...TD, color: "#4b7aad", fontSize: "10px", whiteSpace: "normal" }}>{stampa ? [t.sup ? "superfestivo" : "", t.condiviso ? "notte condivisa" : ""].filter(Boolean).join(", ") : note(t)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const tabellaRiepilogo = (p: PianoSalvato, stampa: boolean) => {
    const conSaldo = righe.some(r => r.saldo !== 0);
    const cols = ["Medico", ...(conSaldo ? ["Saldo iniziale"] : []), "Punti", ...(p.repOn ? ["Reperib.", "Punti rep."] : []), ...(conSaldo || p.repOn ? ["Totale"] : []), "Turni", "Giorno", "Notte", "Superfestivi", ...(p.richieste ? ["Richiesti"] : [])];
    const c: React.CSSProperties = { ...TD, textAlign: "center" };
    return (
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr>{cols.map(h => <th key={h} style={stampa ? undefined : TH}>{h}</th>)}</tr></thead>
        <tbody>
          {righe.map(r => (
            <tr key={r.id}>
              <td style={stampa ? undefined : { ...TD, fontWeight: 700 }}>{nome(r.id)}</td>
              {conSaldo && <td style={stampa ? undefined : c}>{num(r.saldo)}</td>}
              <td style={stampa ? undefined : c}>{num(r.punti)}</td>
              {p.repOn && <><td style={stampa ? undefined : c}>{r.nRep}</td><td style={stampa ? undefined : c}>{num(r.puntiRep)}</td></>}
              {(conSaldo || p.repOn) && <td style={stampa ? undefined : { ...c, color: "#fbbf24", fontWeight: 700 }}>{num(r.totale)}</td>}
              <td style={stampa ? undefined : c}>{r.turni}</td>
              <td style={stampa ? undefined : c}>{r.diurni}</td>
              <td style={stampa ? undefined : c}>{r.notturni}</td>
              <td style={stampa ? undefined : { ...c, color: r.superfestivi < p.minSuper ? "#f87171" : "#e2f0ff" }}>{r.superfestivi}</td>
              {p.richieste > 0 && <td style={stampa ? undefined : c}>{r.pref}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const risultato = piano && (
    <>
      <div className="np" style={BOX}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#e2eeff", fontFamily: "monospace" }}>Piano festivi {periodoTxt(piano.periodo)}</span>
          <span style={LBL}>{piano.turni.length} turni · {num(piano.turni.reduce((s, t) => s + t.punti, 0))} punti{piano.generato ? ` · sorteggiato il ${new Date(piano.generato).toLocaleDateString("it-IT")}` : ""}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => window.print()} style={btn("#064e3b", "#fff", "#065f46")}>⎙ Stampa / PDF</button>
        </div>
        {pianoAltroPeriodo && editabile &&
          <div style={{ ...LBL, color: "#fbbf24", marginBottom: "8px" }}>Questo piano è del periodo {periodoTxt(piano.periodo)}: il periodo impostato sopra è diverso. «Genera turni» lo sostituisce.</div>}
        <div style={{ overflowX: "auto" }}>{tabellaPiano(piano, false)}</div>
      </div>
      <div className="np" style={BOX}>
        <div style={{ ...TIT, cursor: "default", marginBottom: "8px" }}>RIEPILOGO PER MEDICO <span style={SOTTO}>· fra chi ha più punti e chi ne ha meno: {num(scarto)}</span></div>
        <div style={{ overflowX: "auto" }}>{tabellaRiepilogo(piano, false)}</div>
      </div>
      <div className="np" style={BOX}>
        <div style={{ ...TIT, cursor: "default", marginBottom: "8px" }}>VERIFICA</div>
        {controlli.map((c, i) => (
          <div key={i} style={{ ...LBL, fontSize: "11px", color: c.ok ? "#86efac" : "#fca5a5" }}>{c.ok ? "✓" : "✗"} {c.testo}</div>
        ))}
        {editabile && (
          <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
            <button onClick={preparaProssimo} style={btn(confNext ? "#b45309" : "#0d1930", confNext ? "#fff" : "#fbbf24", "#b45309")}>
              {confNext ? "Conferma: passa al periodo successivo" : "Prepara il prossimo periodo"}
            </button>
            <span style={LBL}>Archivia questo piano e propone il periodo che segue: saldo, storico e precedenze si rileggono da soli. Prima, se vuoi tenerla, stampa questa versione.</span>
          </div>
        )}
      </div>
      {/* versione per la stampa: nero su bianco, senza controlli */}
      <div className="fp-print">
        <div style={{ fontSize: "9pt" }}>{[regole.reparto.azienda, regole.reparto.presidio].filter(Boolean).join(" · ")}</div>
        <h1 style={{ fontSize: "14pt", margin: "2pt 0 8pt" }}>{regole.reparto.unita || "Reparto"} — Turni festivi {periodoTxt(piano.periodo)}</h1>
        {tabellaPiano(piano, true)}
        <h2 style={{ fontSize: "11pt", margin: "12pt 0 4pt" }}>Riepilogo per medico</h2>
        {tabellaRiepilogo(piano, true)}
        <div style={{ fontSize: "8pt", marginTop: "6pt" }}>I punti pesano i turni: notte prima, giorno (12 ore) e notte di ogni festività hanno ciascuno il loro valore; una notte condivisa fra due festività vale il più alto.</div>
      </div>
    </>
  );

  const STILE = (
    <style>{`
      .fp-print{display:none;}
      @media print{
        .fp-print{display:block!important;color:#000;font-family:Arial,Helvetica,sans-serif;padding:0;}
        .fp-print table{font-size:9pt!important;width:100%;}
        .fp-print td,.fp-print th{border:.5pt solid #777!important;padding:2.5pt 5pt!important;text-align:left;}
        .fp-print th{background:#eee!important;}
        .fp-print tr{break-inside:avoid;}
      }
    `}</style>
  );

  // ── sola lettura: i colleghi vedono soltanto il piano
  if (!editabile) return (
    <div style={{ padding: "16px", maxWidth: "980px" }}>
      {STILE}
      {piano ? risultato : <div className="np" style={{ ...LBL, fontSize: "12px" }}>Il piano dei turni festivi non è ancora stato pubblicato.</div>}
    </div>
  );

  const nPref = dati.partecipanti.reduce((n, m) => n + Object.keys(dati.cfg.preferences?.[String(m.id)] || {}).length, 0);
  const nSuper = turniPeriodo.filter(t => t.isSuper).length;
  const puntiTot = turniPeriodo.reduce((s, t) => s + t.points, 0);
  const manSaldo = dati.partecipanti.some(m => stato.saldoMan[m.id] != null);
  const ruoliDi = (festa: string): [RuoloPref, string][] => {
    const h = dati.feste.find(x => x.name === festa);
    if (!h) return RUOLI;
    return RUOLI.filter(([r]) => r === "any" || (hasSlot(h, r as RuoloFest) && !(r === "nottePrima" && h.skipNottePrima)));
  };
  const elencoPref = dati.partecipanti.flatMap(m => Object.entries(stato.preferenze[m.id] || {}).filter(([f]) => dati.feste.some(h => h.name === f)).map(([f, r]) => ({ m, f, r })));
  const annoProssimo = new Date().getFullYear() + 1;

  return (
    <div style={{ padding: "16px", maxWidth: "980px" }}>
      {STILE}
      <div className="np">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#e2eeff", fontFamily: "monospace" }}>Turni festivi</span>
        </div>
        <div style={{ ...LBL, marginBottom: "12px" }}>
          Sorteggio dei turni festivi e superfestivi su un periodo, da fare <b>prima</b> di generare i mesi e di inserire ferie e permessi.
          Distribuisce i <b>punti</b>, non il numero di turni. Il piano resta qui: non modifica i tabelloni dei mesi.
        </div>

        {/* ── PERIODO E LIMITI ── */}
        <div style={BOX}>
          <div style={{ ...TIT, cursor: "default", marginBottom: "10px" }}>PERIODO E LIMITI</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "flex-end" }}>
            <label><div style={LBL}>Dal</div>
              <input type="date" value={stato.periodo.start} onChange={e => e.target.value && set({ periodo: { ...stato.periodo, start: e.target.value } })} style={INP} /></label>
            <label><div style={LBL}>Al</div>
              <input type="date" value={stato.periodo.end} onChange={e => e.target.value && set({ periodo: { ...stato.periodo, end: e.target.value } })} style={INP} /></label>
            <button onClick={() => set({ periodo: { start: iso(annoProssimo, 1, 1), end: iso(annoProssimo, 12, 31) } })} style={btn("#0d1930", "#60a5fa", "#2f5a8a")}>Anno {annoProssimo}</button>
            <label><div style={LBL}>Max turni per medico</div>{numInp(stato.maxShifts, 1, 20, v => set({ maxShifts: Math.round(v) }))}</label>
            <label><div style={LBL}>Min superfestivi per medico</div>{numInp(stato.minSuper, 0, 5, v => set({ minSuper: Math.round(v) }))}</label>
          </div>
          {errPeriodo
            ? <div style={{ ...LBL, color: "#f87171", marginTop: "8px", fontSize: "11px" }}>{errPeriodo}</div>
            : <div style={{ ...LBL, marginTop: "8px" }}>
                {dati.feste.length} festività · {turniPeriodo.length} turni ({nSuper} superfestivi) · {num(puntiTot)} punti
                {dati.partecipanti.length > 0 && <> · in media {num(turniPeriodo.length / dati.partecipanti.length)} turni e {num(puntiTot / dati.partecipanti.length)} punti a testa</>}
                {dati.partecipanti.length * stato.maxShifts < turniPeriodo.length &&
                  <span style={{ color: "#f87171" }}> · con {dati.partecipanti.length} medici e al massimo {stato.maxShifts} turni non si coprono tutti</span>}
              </div>}
        </div>

        {/* ── MEDICI DEL SORTEGGIO ── */}
        <div style={BOX}>
          <div style={{ ...TIT, cursor: "default", marginBottom: "4px" }}>MEDICI DEL SORTEGGIO <span style={SOTTO}>· {dati.partecipanti.length} su {medici.length}</span></div>
          <div style={{ ...LBL, marginBottom: "8px" }}>Sono i medici dell'app. Tocca un nome per toglierlo dal sorteggio o rimetterlo.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {medici.map(m => {
              const on = !stato.esclusi.includes(m.id);
              return <button key={m.id} onClick={() => set({ esclusi: on ? [...stato.esclusi, m.id] : stato.esclusi.filter(x => x !== m.id) })}
                style={chip(on, SC[m.stato]?.t)} title={on ? "Nel sorteggio: tocca per toglierlo" : "Fuori dal sorteggio: tocca per rimetterlo"}>{m.nome} <span style={{ fontSize: "8px", opacity: .8 }}>{m.stato}</span></button>;
            })}
          </div>
          <div style={{ ...LBL, margin: "12px 0 6px" }}>Solo turni di giorno, niente notti (chi è «esentato dalle notti» nella scheda lo è già; tocca per cambiare):</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {dati.partecipanti.map(m => {
              const on = dati.soloGiorno.has(m.id), base = esenteNotti(m);
              return <button key={m.id} onClick={() => set({ soloGiorno: !on === base ? senza(stato.soloGiorno, m.id) : { ...stato.soloGiorno, [m.id]: !on } })}
                style={{ ...chip(on, "#c4b5fd"), textDecoration: "none" }}>{on ? "☀ " : ""}{m.nome}</button>;
            })}
          </div>
        </div>

        {/* ── SALDO E PRECEDENZE ── */}
        <details style={BOX} open>
          <summary style={TIT}>SALDO PUNTI DI PARTENZA <span style={SOTTO}>· {manSaldo ? "con correzioni a mano" : "letto in automatico"}</span></summary>
          <div style={{ ...LBL, margin: "8px 0" }}>
            {auto.origine === "piano"
              ? <>Riparte dal saldo del piano precedente e aggiunge i punti fatti dal {fmtIt(auto.da).slice(4)}: </>
              : <>Punti dei turni festivi fatti dal {fmtIt(auto.da).slice(4)} al {fmtIt(auto.a).slice(4)} ({regole.pianoFestiviAnni} ann{regole.pianoFestiviAnni === 1 ? "o" : "i"}): </>}
            {auto.nMese + auto.nPiano === 0
              ? <b style={{ color: "#fbbf24" }}>nessun turno festivo trovato nei mesi salvati — si parte alla pari, oppure scrivi i saldi a mano.</b>
              : <><b style={{ color: "#93c5fd" }}>{auto.nMese}</b> turni letti dai mesi salvati{auto.nPiano > 0 && <>, <b style={{ color: "#93c5fd" }}>{auto.nPiano}</b> dal piano (mese non ancora salvato)</>}. I mesi non salvati non contano.</>}
            {" "}Contano solo le differenze: chi parte più alto riceve meno carico. Notti per intero; il giorno vale intero con mattina e pomeriggio, metà con uno solo.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: "8px" }}>
            {dati.partecipanti.map(m => {
              const man = stato.saldoMan[m.id] != null;
              return (
                <div key={m.id} style={{ background: "#0d1930", border: `1px solid ${man ? "#b45309" : "#16304f"}`, borderRadius: "6px", padding: "7px 8px" }}>
                  <div style={{ ...LBL, color: "#e2eeff", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.nome}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                    {numInp(dati.saldo[m.id], -99, 99, v => set({ saldoMan: { ...stato.saldoMan, [m.id]: v } }), "64px", 0.5)}
                    {man
                      ? <button onClick={() => set({ saldoMan: senza(stato.saldoMan, m.id) })} title={`Torna al valore automatico (${num(auto.saldo[m.id] ?? 0)})`}
                          style={{ ...btn("#0d1930", "#fbbf24", "#b45309"), padding: "3px 7px" }}>↺ {num(auto.saldo[m.id] ?? 0)}</button>
                      : <span style={{ ...LBL, fontSize: "9px" }}>auto</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
            <button onClick={() => set({ saldoMan: {} })} style={btn("#0d1930", "#60a5fa", "#2f5a8a", !manSaldo)} disabled={!manSaldo}>Tutti automatici</button>
            <button onClick={() => set({ saldoMan: Object.fromEntries(dati.partecipanti.map(m => [m.id, 0])) })} style={btn("#0d1930", "#60a5fa", "#2f5a8a")}>Tutti a zero</button>
          </div>
          <div style={{ ...LBL, margin: "14px 0 6px" }}>Precedenza sui superfestivi — chi ne è rimasto senza nel periodo precedente (tocca per cambiare):</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {dati.partecipanti.map(m => {
              const on = dati.precedenza.has(m.id), base = auto.precedenza.includes(m.id);
              return <button key={m.id} onClick={() => set({ precMan: !on === base ? senza(stato.precMan, m.id) : { ...stato.precMan, [m.id]: !on } })}
                style={{ ...chip(on, "#fbbf24"), textDecoration: "none" }}>{on ? "★ " : ""}{m.nome}</button>;
            })}
          </div>
        </details>

        {/* ── STORICO ── */}
        <details style={BOX}>
          <summary style={TIT}>FESTIVITÀ GIÀ FATTE <span style={SOTTO}>· {dati.partecipanti.filter(m => dati.storico[m.id].length).length} medici con storico{Object.keys(stato.storicoMan).length ? ", con correzioni a mano" : ""}</span></summary>
          <div style={{ ...LBL, margin: "8px 0" }}>
            Chi ha coperto ciascuna festività l'ultima volta (letto dai mesi salvati degli ultimi {regole.pianoFestiviAnni} ann{regole.pianoFestiviAnni === 1 ? "o" : "i"}): il sorteggio evita di ridargli la stessa.
            Vale per il tipo di festività, di qualsiasi anno. Spunta o togli a mano dove serve.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={TH}>Medico</th>
                {tipiFesta.map(f => <th key={f} style={{ ...TH, writingMode: "vertical-rl", transform: "rotate(180deg)", textAlign: "left", padding: "6px 3px", height: "118px", verticalAlign: "bottom" }}>{f}</th>)}
                <th style={TH}></th>
              </tr></thead>
              <tbody>
                {dati.partecipanti.map(m => {
                  const man = stato.storicoMan[m.id] != null, mio = dati.storico[m.id];
                  return (
                    <tr key={m.id}>
                      <td style={{ ...TD, fontWeight: 700 }}>{m.nome}</td>
                      {tipiFesta.map(f => (
                        <td key={f} style={{ ...TD, textAlign: "center", padding: "3px" }}>
                          <input type="checkbox" checked={mio.includes(f)} title={`${m.nome} · ${f}`} style={{ accentColor: "#60a5fa", cursor: "pointer" }}
                            onChange={e => set({ storicoMan: { ...stato.storicoMan, [m.id]: e.target.checked ? [...mio, f] : mio.filter(x => x !== f) } })} />
                        </td>
                      ))}
                      <td style={{ ...TD, border: "none" }}>
                        {man && <button onClick={() => set({ storicoMan: senza(stato.storicoMan, m.id) })} title="Torna alla lettura automatica" style={{ ...btn("#0d1930", "#fbbf24", "#b45309"), padding: "2px 7px" }}>↺</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>

        {/* ── PREFERENZE ── */}
        <details style={BOX}>
          <summary style={TIT}>PREFERENZE <span style={SOTTO}>· {nPref ? `${nPref} richiest${nPref === 1 ? "a" : "e"}` : "nessuna"}</span></summary>
          <div style={{ ...LBL, margin: "8px 0" }}>
            Chi vorrebbe un turno preciso di una festività. Il sorteggio cerca di darglielo: le preferenze battono lo storico, non i vincoli. Valgono per questo periodo soltanto.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
            <select value={nuovaPref.id ?? ""} onChange={e => setNuovaPref({ ...nuovaPref, id: e.target.value ? +e.target.value : null })} style={INP}>
              <option value="">medico…</option>
              {dati.partecipanti.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
            <select value={nuovaPref.festa} onChange={e => setNuovaPref({ ...nuovaPref, festa: e.target.value, ruolo: "any" })} style={INP}>
              <option value="">festività…</option>
              {dati.feste.map(h => <option key={h.name} value={h.name}>{h.name} ({dataBreve(h.date)})</option>)}
            </select>
            <select value={nuovaPref.ruolo} onChange={e => setNuovaPref({ ...nuovaPref, ruolo: e.target.value as RuoloPref })} style={INP}>
              {ruoliDi(nuovaPref.festa).map(([r, l]) => <option key={r} value={r}>{l}</option>)}
            </select>
            <button disabled={nuovaPref.id == null || !nuovaPref.festa} style={btn("#052e16", "#4ade80", "#16a34a", nuovaPref.id == null || !nuovaPref.festa)}
              onClick={() => { const id = nuovaPref.id!; set({ preferenze: { ...stato.preferenze, [id]: { ...(stato.preferenze[id] || {}), [nuovaPref.festa]: nuovaPref.ruolo } } }); setNuovaPref({ id, festa: "", ruolo: "any" }); }}>➕ Aggiungi</button>
          </div>
          {elencoPref.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
              {elencoPref.map(({ m, f, r }) => (
                <span key={m.id + f} style={{ background: "#0d1930", border: "1px solid #2f5a8a", borderRadius: "999px", padding: "4px 6px 4px 10px", fontSize: "11px", fontFamily: "monospace", color: "#e2f0ff" }}>
                  <b>{m.nome}</b> · {f} · <span style={{ color: "#f0abfc" }}>{RUOLI.find(x => x[0] === r)?.[1]}</span>
                  <button title="Togli la richiesta" onClick={() => { const { [f]: _via, ...resto } = stato.preferenze[m.id]; set({ preferenze: { ...stato.preferenze, [m.id]: resto } }); }}
                    style={{ background: "transparent", border: "none", color: "#f87171", cursor: "pointer", fontWeight: 700, marginLeft: "6px" }}>✕</button>
                </span>
              ))}
            </div>
          )}
        </details>

        {/* ── REPERIBILITÀ ── */}
        <details style={BOX}>
          <summary style={TIT}>REPERIBILITÀ <span style={SOTTO}>· {stato.reperibilita.enabled ? `accesa, ${stato.reperibilita.weightPct}% dei punti, al massimo ${stato.reperibilita.maxPer} a testa` : "spenta"}</span></summary>
          <div style={{ ...LBL, margin: "8px 0" }}>
            Aggiunge a ogni turno un medico <b>reperibile</b> di riserva. Pesa una frazione dei punti del turno ed entra nell'equità del carico totale. Resta nel piano e nella stampa.
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "10px" }}>
            <input type="checkbox" checked={stato.reperibilita.enabled} onChange={e => set({ reperibilita: { ...stato.reperibilita, enabled: e.target.checked } })} style={{ accentColor: "#60a5fa" }} />
            <span style={{ ...LBL, color: "#e2eeff", fontSize: "11px" }}>Assegna un reperibile per ogni turno</span>
          </label>
          {stato.reperibilita.enabled && <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", marginBottom: "10px" }}>
              <label><div style={LBL}>Peso (% dei punti del turno)</div>{numInp(stato.reperibilita.weightPct, 0, 100, v => set({ reperibilita: { ...stato.reperibilita, weightPct: Math.round(v) } }), "64px", 5)}</label>
              <label><div style={LBL}>Tetto per medico</div>{numInp(stato.reperibilita.maxPer, 1, 99, v => set({ reperibilita: { ...stato.reperibilita, maxPer: Math.round(v) } }))}</label>
            </div>
            <div style={{ ...LBL, marginBottom: "6px" }}>Medici idonei alla reperibilità (tocca per includere o escludere):</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {dati.partecipanti.map(m => {
                const on = !stato.reperibilita.nonIdonei.includes(m.id);
                return <button key={m.id} style={chip(on, "#a78bfa")}
                  onClick={() => set({ reperibilita: { ...stato.reperibilita, nonIdonei: on ? [...stato.reperibilita.nonIdonei, m.id] : stato.reperibilita.nonIdonei.filter(x => x !== m.id) } })}>{m.nome}</button>;
              })}
            </div>
          </>}
        </details>

        {/* ── FESTIVITÀ DEL PERIODO ── */}
        <details style={BOX}>
          <summary style={TIT}>FESTIVITÀ E PUNTI DEL PERIODO <span style={SOTTO}>· {dati.feste.length} festività, {num(puntiTot)} punti</span></summary>
          <div style={{ ...LBL, margin: "8px 0" }}>
            Ogni festività ha tre turni — <b>notte prima</b>, <b>giorno</b> (12 ore), <b>notte</b> — ciascuno coi suoi punti. Una notte condivisa fra due festività consecutive è un turno solo e vale il più alto.
            Punti e superfestivi (★) si cambiano nelle <button onClick={apriRegole} style={{ background: "none", border: "none", color: "#60a5fa", cursor: "pointer", fontFamily: "monospace", fontSize: "10px", textDecoration: "underline", padding: 0 }}>Regole</button>.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse" }}>
              <thead><tr>{["Data", "Festività", "Notte prima", "Giorno", "Notte"].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
              <tbody>
                {dati.feste.map(h => (
                  <tr key={h.name} style={h.sup ? { background: "#1a1430" } : undefined}>
                    <td style={TD}>{fmtIt(h.date)}</td>
                    <td style={{ ...TD, fontWeight: h.sup ? 700 : 400 }}>{h.sup ? "★ " : ""}{h.name}</td>
                    <td style={{ ...TD, textAlign: "center", color: "#4ade80" }}>{h.soloGiorno ? "—" : h.skipNottePrima ? "(periodo prima)" : num(h.slots.nottePrima)}</td>
                    <td style={{ ...TD, textAlign: "center", color: "#93c5fd" }}>{num(h.slots.giorno)}</td>
                    <td style={{ ...TD, textAlign: "center", color: "#4ade80" }}>{h.soloGiorno ? "—" : num(h.slots.notte)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {/* ── AZIONI ── */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", margin: "16px 0" }}>
          <button onClick={() => genera(stato.seme)} disabled={busy} style={{ ...btn("#1d4ed8", "#fff", "#1d4ed8", busy), padding: "9px 18px", fontSize: "12px" }}>{busy ? "Sorteggio in corso…" : "Genera turni"}</button>
          <button onClick={() => genera(stato.seme + 1)} disabled={busy || !piano} style={{ ...btn("#0d1930", "#60a5fa", "#2f5a8a", busy || !piano), padding: "9px 14px" }}>Rigenera (altra variante)</button>
          {piano && <span style={LBL}>variante n. {piano.seme}</span>}
        </div>
      </div>

      {risultato}
    </div>
  );
}
