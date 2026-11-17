import { useMemo, useRef, useState } from "react";
import type { Medico, TurniAll, TurniMese } from "../engine/types";
import { MESI, dimOf, dowOf, isFestivo, mkKey } from "../engine/date";
import { meseGenerato, togliInseriti } from "../engine/festiviApp";
import {
  scriptModulo, leggiRisposte, inserisciDesiderate, assenzePerGiorno, titoloModulo,
  type StatoDesiderate, type SaltatoDes,
} from "../engine/desiderate";
import { Badge } from "./Badge";

// ─── SEZIONE DESIDERATE (v0.3.64) ─────────────────────────────────────────────
// Raccolta di licenze, permessi ed esclusioni con un Modulo Google (ogni medico
// accede con la sua email e vede solo la propria risposta), poi importazione
// delle risposte e inserimento nel mese come turni MANUALI.
// Le risposte (con le email) restano solo su questo dispositivo.

const GG = ["L", "M", "M", "G", "V", "S", "D"];

export function DesideratePanel({ medici, turniAll, onTurniMese, stato, onStato, annoIniziale, meseIniziale, pianoFestiviDaInserire, avviso }: {
  medici: Medico[];
  turniAll: TurniAll;
  onTurniMese: (chiave: string, T: TurniMese) => void;
  stato: StatoDesiderate;
  onStato: (s: StatoDesiderate) => void;
  annoIniziale: number;
  meseIniziale: number;
  /** Mesi ("AAAA-MM") in cui il piano festivi ha turni non ancora inseriti. */
  pianoFestiviDaInserire: string[];
  avviso: (txt: string, tp?: string) => void;
}) {
  const [anno, setAnno] = useState(annoIniziale);
  const [mese, setMese] = useState(meseIniziale);
  const [incolla, setIncolla] = useState("");
  const [vediScript, setVediScript] = useState(false);
  const [confTogli, setConfTogli] = useState(false);
  const [saltati, setSaltati] = useState<SaltatoDes[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scriptRef = useRef<HTMLTextAreaElement>(null);

  const chiave = mkKey(anno, mese), nd = dimOf(anno, mese);
  const giorni = Array.from({ length: nd }, (_, i) => i + 1);
  const dati = stato[chiave];
  const risposte = useMemo(() => (dati?.risposte || []).filter(r => medici.some(m => m.id === r.id)), [dati, medici]);
  const script = useMemo(() => scriptModulo(anno, mese, medici), [anno, mese, medici]);
  const generato = meseGenerato(turniAll[chiave]);
  // prova a vuoto: quali celle verrebbero saltate inserendo adesso
  const prova = useMemo(() => dati ? inserisciDesiderate(risposte, turniAll, chiave, dati.inseriti || []) : null, [dati, risposte, turniAll, chiave]);
  const conflitto = new Map((prova?.saltati || []).map(s => [s.id + "|" + s.g, s.motivo]));
  const conteggi = assenzePerGiorno(risposte, nd);
  const nome = (id: number) => medici.find(m => m.id === id)?.nome ?? "(medico eliminato)";
  const senzaRisposta = medici.filter(m => !risposte.some(r => r.id === m.id));
  const nCelle = risposte.reduce((n, r) => n + Object.keys(r.giorni).length, 0);
  const meseTxt = `${MESI[mese]} ${anno}`;

  // ── stili (come la sezione Festivi)
  const LBL: React.CSSProperties = { color: "#64748b", fontSize: "10px", fontFamily: "monospace", lineHeight: 1.6 };
  const BOX: React.CSSProperties = { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "14px", marginBottom: "12px" };
  const TIT: React.CSSProperties = { color: "#1d4ed8", fontSize: "10px", fontFamily: "monospace", fontWeight: 700, letterSpacing: ".04em", marginBottom: "6px" };
  const SOTTO: React.CSSProperties = { fontWeight: 400, color: "#64748b", letterSpacing: 0 };
  const INP: React.CSSProperties = { background: "#ffffff", border: "1px solid #cbd5e1", color: "#0f172a", borderRadius: "6px", padding: "5px 7px", fontSize: "12px", fontFamily: "monospace" };
  const btn = (bg: string, fg: string, bd: string, off = false): React.CSSProperties => ({
    background: off ? "#e2e8f0" : bg, color: off ? "#94a3b8" : fg, border: `1px solid ${off ? "#e2e8f0" : bd}`, borderRadius: "6px", padding: "7px 13px",
    cursor: off ? "not-allowed" : "pointer", fontSize: "11px", fontWeight: 700, fontFamily: "monospace",
  });
  const TH: React.CSSProperties = { background: "#f1f5f9", border: "1px solid #e2e8f0", padding: "3px 2px", textAlign: "center", fontSize: "9px", color: "#64748b", fontFamily: "monospace", whiteSpace: "nowrap" };
  const TD: React.CSSProperties = { border: "1px solid #e2e8f0", padding: "2px", textAlign: "center", fontSize: "10px", fontFamily: "monospace", color: "#0f172a", minWidth: "26px", height: "26px" };
  const sfondo = (g: number) => isFestivo(anno, mese, g) ? "#fff1f2" : dowOf(anno, mese, g) === 5 ? "#eef2ff" : undefined;

  // ── azioni
  const copiaScript = async () => {
    try { await navigator.clipboard.writeText(script); avviso("✓ Script copiato: incollalo su script.google.com."); }
    catch { setVediScript(true); setTimeout(() => { scriptRef.current?.select(); }, 50); avviso("Copia non riuscita: selezionato il testo, premi Ctrl+C (o Cmd+C).", "warn"); }
  };
  const importa = (testo: string) => {
    const e = leggiRisposte(testo, anno, mese, medici);
    if (e.errore) { avviso(e.errore, "err"); return; }
    if (!e.risposte.length) { avviso("Nessuna risposta riconosciuta nel file.", "warn"); return; }
    onStato({ ...stato, [chiave]: { importato: new Date().toISOString(), risposte: e.risposte, problemi: e.problemi, inseriti: dati?.inseriti ?? null } });
    setIncolla(""); setSaltati(null);
    avviso(`✓ ${e.risposte.length} rispost${e.risposte.length === 1 ? "a" : "e"} di ${meseTxt} importat${e.risposte.length === 1 ? "a" : "e"}${e.problemi.length ? `, ${e.problemi.length} da controllare` : ""}.`, e.problemi.length ? "warn" : "ok");
  };
  const daFile = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => importa(String(r.result || ""));
    r.readAsText(f, "utf-8");
  };
  const inserisci = () => {
    if (!dati) return;
    const e = inserisciDesiderate(risposte, turniAll, chiave, dati.inseriti || []);
    if (e.blocco) { avviso(e.blocco, "err"); return; }
    onTurniMese(chiave, e.turni);
    onStato({ ...stato, [chiave]: { ...dati, inseriti: e.inseriti } });
    setSaltati(e.saltati);
    const n = e.inseriti.length, s = e.saltati.length;
    avviso(`${s ? "" : "✓ "}${meseTxt}: ${n} giorn${n === 1 ? "o inserito" : "i inseriti"} come manuali${s ? `, ${s} saltat${s === 1 ? "o" : "i"}` : ""}.`, s ? "warn" : "ok");
  };
  const togli = () => {
    if (!dati?.inseriti) return;
    if (!confTogli) { setConfTogli(true); setTimeout(() => setConfTogli(false), 3500); return; }
    setConfTogli(false);
    const r = togliInseriti(turniAll[chiave], dati.inseriti);
    onTurniMese(chiave, r.turni);
    onStato({ ...stato, [chiave]: { ...dati, inseriti: null } });
    setSaltati(null);
    avviso(`${meseTxt}: ${r.tolti} giorni delle desiderate tolti dal mese.`);
  };
  const dimentica = () => {
    const { [chiave]: _via, ...resto } = stato;
    onStato(resto); setSaltati(null);
    avviso(`Risposte di ${meseTxt} cancellate da questo dispositivo. I turni già inseriti nel mese restano.`);
  };

  return (
    <div className="np" style={{ padding: "16px", maxWidth: "1180px" }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a", fontFamily: "monospace", marginBottom: "6px" }}>Desiderate</div>
      <div style={{ ...LBL, marginBottom: "12px", maxWidth: "900px" }}>
        Ogni medico segna licenze, permessi ed esclusioni del mese in un <b>Modulo Google</b>: accede con la sua email, sceglie il suo nome e vede solo la propria risposta.
        Poi importi le risposte qui e le inserisci nel mese come turni <b>manuali</b>. Ordine consigliato: prima il piano festivi, poi le desiderate, poi la generazione del mese.
      </div>

      {/* ── MESE ── */}
      <div style={{ ...BOX, display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-end" }}>
        <label><div style={LBL}>Mese</div>
          <select value={mese} onChange={e => { setMese(+e.target.value); setSaltati(null); }} style={INP}>{MESI.map((m, i) => <option key={i} value={i}>{m}</option>)}</select></label>
        <label><div style={LBL}>Anno</div>
          <input type="number" value={anno} onChange={e => { const v = Math.round(+e.target.value); if (v >= 2000 && v <= 2100) { setAnno(v); setSaltati(null); } }} style={{ ...INP, width: "80px" }} /></label>
        <div style={{ ...LBL, flex: 1, minWidth: "240px" }}>
          {dati ? <>Risposte importate il {new Date(dati.importato).toLocaleString("it-IT")}: <b>{risposte.length}</b> su {medici.length} medici.</> : <>Nessuna risposta importata per {meseTxt}.</>}
          {generato && <span style={{ color: "#be123c" }}> · Il mese è già generato: le desiderate entrano solo nei mesi nuovi.</span>}
        </div>
      </div>

      {/* ── 1 · MODULO ── */}
      <div style={BOX}>
        <div style={TIT}>1 · PREPARA IL MODULO <span style={SOTTO}>· «{titoloModulo(anno, mese)}», {medici.length} medici nell'elenco, {nd} giorni</span></div>
        <div style={{ ...LBL, marginBottom: "10px" }}>
          Copia lo script, apri <b>script.google.com</b> → «Nuovo progetto», cancella il testo che c'è, incolla, salva, scegli la funzione <b>creaModulo</b> e premi <b>Esegui</b>.
          Concedi i permessi; nel «Registro di esecuzione» trovi il link da mandare ai colleghi e quello del foglio delle risposte.
          Il modulo chiede l'accesso con l'email Google; ognuno sceglie il proprio nome dall'elenco di tutti i medici dell'app. Una risposta a testa, modificabile fino alla chiusura.
          Nel modulo le esclusioni sono scritte a parole (Libero, No mattina, No pomeriggio, No notte) e se ne può spuntare più d'una nello stesso giorno; qui tornano X, Xm, Xp e Xn.
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={copiaScript} style={btn("#1d4ed8", "#fff", "#1d4ed8")}>Copia lo script</button>
          <button onClick={() => setVediScript(v => !v)} style={btn("#ffffff", "#1d4ed8", "#cbd5e1")}>{vediScript ? "Nascondi lo script" : "Mostra lo script"}</button>
        </div>
        {vediScript && <textarea ref={scriptRef} readOnly value={script} aria-label="Script del modulo"
          style={{ ...INP, width: "100%", height: "260px", marginTop: "10px", fontSize: "10px", whiteSpace: "pre" }} />}
      </div>

      {/* ── 2 · IMPORTA ── */}
      <div style={BOX}>
        <div style={TIT}>2 · IMPORTA LE RISPOSTE</div>
        <div style={{ ...LBL, marginBottom: "10px" }}>
          Quando tutti hanno risposto: nel modulo spegni «Accetta risposte»; nel foglio delle risposte <b>File → Scarica → Valori separati da virgola (.csv)</b> e caricalo qui,
          oppure seleziona tutto il foglio, copia e incolla nel riquadro. Una nuova importazione sostituisce la precedente di {meseTxt}. Le risposte, con le email, restano solo su questo dispositivo.
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-start" }}>
          <button onClick={() => fileRef.current?.click()} style={btn("#1d4ed8", "#fff", "#1d4ed8")}>Carica il file CSV…</button>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" style={{ display: "none" }} onChange={e => { daFile(e.target.files?.[0]); e.target.value = ""; }} />
          <textarea value={incolla} onChange={e => setIncolla(e.target.value)} placeholder="…oppure incolla qui il foglio delle risposte" aria-label="Incolla le risposte"
            style={{ ...INP, flex: 1, minWidth: "260px", height: "38px" }} />
          <button onClick={() => importa(incolla)} disabled={!incolla.trim()} style={btn("#ffffff", "#1d4ed8", "#cbd5e1", !incolla.trim())}>Leggi</button>
        </div>
      </div>

      {/* ── 3 · ANTEPRIMA ── */}
      {dati && (
        <div style={BOX}>
          <div style={TIT}>3 · ANTEPRIMA <span style={SOTTO}>· {risposte.length} risposte, {nCelle} giorni segnati</span></div>
          {senzaRisposta.length > 0 && <div style={{ ...LBL, fontSize: "11px", color: "#b45309" }}>Non hanno risposto: {senzaRisposta.map(m => m.nome).join(", ")}.</div>}
          {dati.problemi.map((p, i) => <div key={i} style={{ ...LBL, fontSize: "11px", color: "#be123c" }}>✗ {p}</div>)}
          {risposte.flatMap(r => r.avvisi.map((a, i) => <div key={r.id + "-" + i} style={{ ...LBL, fontSize: "11px", color: "#b45309" }}>⚠ {nome(r.id)}, {a}</div>))}
          <div style={{ overflowX: "auto", marginTop: "10px" }}>
            <table style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr><th style={{ ...TH, textAlign: "left", padding: "3px 8px" }}>{meseTxt}</th>
                  {giorni.map(g => <th key={g} style={{ ...TH, background: sfondo(g) ?? TH.background, color: isFestivo(anno, mese, g) ? "#dc2626" : TH.color }}>{g}<br />{GG[dowOf(anno, mese, g)]}</th>)}</tr>
              </thead>
              <tbody>
                {risposte.map(r => (
                  <tr key={r.id}>
                    <td style={{ ...TD, textAlign: "left", padding: "2px 8px", whiteSpace: "nowrap", fontWeight: 700 }} title={r.email}>{nome(r.id)}</td>
                    {giorni.map(g => {
                      const t = r.giorni[g], k = conflitto.get(r.id + "|" + g);
                      return <td key={g} title={k ? `Non verrà inserito: ${k}` : undefined}
                        style={{ ...TD, background: sfondo(g), outline: k && k !== "già presente" ? "2px solid #dc2626" : undefined, outlineOffset: "-2px" }}>
                        {t?.map((c, i) => <div key={i}><Badge tipo={c} man /></div>)}
                      </td>;
                    })}
                  </tr>
                ))}
                <tr>
                  <td style={{ ...TD, textAlign: "left", padding: "2px 8px", color: "#64748b", fontSize: "9px" }}>assenti tutto il giorno</td>
                  {giorni.map(g => { const n = conteggi[g].intera; return <td key={g} style={{ ...TD, background: sfondo(g), color: n >= 3 ? "#be123c" : n ? "#0f172a" : "#cbd5e1", fontWeight: n >= 3 ? 700 : 400 }}>{n || "·"}</td>; })}
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ ...LBL, marginTop: "6px" }}>Bordo rosso = la cella nel mese è già occupata (per esempio da un turno del piano festivi): quel giorno non verrà inserito. Passa il mouse sulla cella per il motivo, sul nome per l'email.</div>
          {risposte.some(r => r.note) && <div style={{ marginTop: "8px" }}>
            <div style={{ ...LBL, fontWeight: 700 }}>Note</div>
            {risposte.filter(r => r.note).map(r => <div key={r.id} style={{ ...LBL, fontSize: "11px", color: "#0f172a" }}><b>{nome(r.id)}</b>: {r.note}</div>)}
          </div>}
        </div>
      )}

      {/* ── 4 · NEL MESE ── */}
      {dati && (
        <div style={BOX}>
          <div style={TIT}>4 · NEL MESE <span style={SOTTO}>· {dati.inseriti ? `inseriti ${dati.inseriti.length} giorni` : "non ancora inserite"}</span></div>
          {pianoFestiviDaInserire.includes(chiave) && <div style={{ ...LBL, fontSize: "11px", color: "#b45309", marginBottom: "6px" }}>
            ⚠ Il piano festivi ha turni in {meseTxt} non ancora inseriti: conviene inserirli prima (Festivi → Nei mesi), così i conflitti con le desiderate si vedono qui.</div>}
          <div style={{ ...LBL, marginBottom: "10px" }}>
            Scrive le desiderate nel tabellone come turni <b>manuali</b>, solo nelle celle libere: dove c'è già qualcosa il giorno si salta e viene elencato.
            «Sostituisci» toglie i giorni inseriti l'ultima volta e mette quelli dell'importazione attuale; quelli cambiati a mano nel frattempo non si toccano.
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button onClick={inserisci} disabled={generato || !risposte.length} style={btn("#1d4ed8", "#fff", "#1d4ed8", generato || !risposte.length)}
              title={generato ? "Il mese è già generato" : ""}>{dati.inseriti ? "Sostituisci nel mese" : "Inserisci nel mese"}</button>
            {dati.inseriti && <button onClick={togli} style={btn(confTogli ? "#be123c" : "#fff1f2", confTogli ? "#fff" : "#be123c", "#fecdd3")}>{confTogli ? "Conferma: togli dal mese" : "Togli dal mese"}</button>}
            <button onClick={dimentica} style={btn("#ffffff", "#64748b", "#cbd5e1")}>Cancella le risposte importate</button>
          </div>
          {saltati && saltati.length > 0 && <div style={{ marginTop: "10px" }}>
            {saltati.map(s => <div key={s.id + "-" + s.g} style={{ ...LBL, fontSize: "11px", color: s.motivo === "già presente" ? "#64748b" : "#be123c" }}>
              {s.motivo === "già presente" ? "·" : "✗"} {nome(s.id)}, {s.g} {MESI[mese].toLowerCase()}: {s.tipi.join("+")} — {s.motivo}</div>)}
          </div>}
        </div>
      )}
    </div>
  );
}
