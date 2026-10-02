import { useRef, useState } from "react";
import type { Medico, Regole, Reparto } from "../engine/types";
import { MESI } from "../engine/date";
import { mergeRegole } from "../engine/regole";

// ─── SCHEDA REPARTO (v0.3.44) ─────────────────────────────────────────────────
// Ciò che distingue un reparto dall'altro fuori dalle regole di turno:
// intestazioni (app ed Excel), logo dell'Excel, festività locali. In più
// ESPORTA / IMPORTA CONFIGURAZIONE: un file JSON con regole (scheda reparto
// compresa) ed elenco dei medici, per avviare un altro reparto senza ripartire
// da zero. I turni non viaggiano nel file.

const FORMATO = "turnimedicina-configurazione";

export function RepartoPanel({ regole, medici, onRegole, onMedici, avviso }: {
  regole: Regole;
  medici: Medico[];
  onRegole: (r: Regole) => void;
  onMedici: (m: Medico[]) => void;
  avviso: (txt: string, tp?: string) => void;
}) {
  const rep = regole.reparto;
  const set = (patch: Partial<Reparto>) => onRegole({ ...regole, reparto: { ...rep, ...patch } });
  const fileLogo = useRef<HTMLInputElement>(null);
  const fileConf = useRef<HTMLInputElement>(null);
  const [nuovaData, setNuovaData] = useState({ g: 1, m: 1, nome: "" });

  const LBL: React.CSSProperties = { color: "#2d5a8a", fontSize: "10px", fontFamily: "monospace" };
  const inp: React.CSSProperties = {
    background: "#030810", border: "1px solid #1e3a5f", color: "#e2f0ff", borderRadius: "6px",
    padding: "5px 8px", fontSize: "11px", fontFamily: "monospace", boxSizing: "border-box", width: "100%",
  };
  const btn = (bg: string, fg: string, bd: string): React.CSSProperties => ({
    background: bg, color: fg, border: `1px solid ${bd}`, borderRadius: "6px", padding: "5px 11px",
    cursor: "pointer", fontSize: "11px", fontWeight: 700, fontFamily: "monospace",
  });
  const campo = (lbl: string, val: string, on: (v: string) => void, ph = "") => (
    <label style={{ display: "block", marginBottom: "8px" }}>
      <div style={LBL}>{lbl}</div>
      <input value={val} placeholder={ph} onChange={e => on(e.target.value)} style={inp} />
    </label>
  );

  const caricaLogo = (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) { avviso("Il logo deve essere un'immagine PNG o JPEG.", "err"); return; }
    if (f.size > 500_000) { avviso("Logo troppo grande: massimo 500 KB.", "err"); return; }
    const fr = new FileReader();
    fr.onload = () => { set({ logo: String(fr.result) }); avviso("✓ Logo caricato: comparirà nell'Excel."); };
    fr.readAsDataURL(f);
  };

  const aggiungiFestivo = () => {
    const data = `${String(nuovaData.m).padStart(2, "0")}-${String(nuovaData.g).padStart(2, "0")}`;
    const giorniMese = new Date(2024, nuovaData.m, 0).getDate();   // 2024 bisestile: 29 febbraio ammesso
    if (nuovaData.g < 1 || nuovaData.g > giorniMese) { avviso("Data non valida.", "err"); return; }
    if (rep.festiviLocali.some(f => f.data === data)) { avviso("Questa data è già nell'elenco.", "warn"); return; }
    set({ festiviLocali: [...rep.festiviLocali, { data, nome: nuovaData.nome.trim() }].sort((a, b) => a.data.localeCompare(b.data)) });
    setNuovaData({ ...nuovaData, nome: "" });
  };

  const esporta = () => {
    const dati = { formato: FORMATO, versione: 1, esportato: new Date().toISOString(), regole, medici };
    const blob = new Blob([JSON.stringify(dati, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `configurazione-${(rep.unita || "reparto").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    avviso("✓ Configurazione esportata (regole, scheda reparto, medici). I turni non sono inclusi.");
  };

  const importa = (f: File | undefined) => {
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const d = JSON.parse(String(fr.result));
        if (d?.formato !== FORMATO || !d.regole) throw new Error("non è un file di configurazione di questa app");
        const nuove = mergeRegole(d.regole);
        const conMedici = Array.isArray(d.medici) && d.medici.length > 0;
        const msg = `Importare la configurazione di «${nuove.reparto.unita}»?\n\n`
          + `• Regole e scheda reparto verranno sostituite.\n`
          + (conMedici ? `• Elenco medici (${d.medici.length}): verrà chiesto a parte.\n` : "")
          + `• I turni già inseriti NON vengono toccati.`;
        if (!window.confirm(msg)) return;
        onRegole(nuove);
        if (conMedici && window.confirm(`Sostituire anche l'elenco dei medici con quello del file (${d.medici.length} medici)?\n\nAnnulla = tieni i medici attuali.`)) {
          onMedici(d.medici.filter((m: Medico) => m && typeof m.id === "number" && typeof m.nome === "string"));
        }
        avviso("✓ Configurazione importata.");
      } catch (e) {
        avviso("Importazione non riuscita: " + (e as Error).message, "err");
      }
    };
    fr.readAsText(f);
  };

  const logoTxt = rep.logo === undefined ? "predefinito" : rep.logo === "" ? "nessuno" : "personalizzato";

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "0 14px" }}>
        <div>
          <div style={{ ...LBL, color: "#60a5fa", fontWeight: 700, marginBottom: "6px" }}>Intestazione dell'app</div>
          {campo("Azienda", rep.azienda, v => set({ azienda: v }))}
          {campo("Presidio", rep.presidio, v => set({ presidio: v }))}
          {campo("Unità operativa (titolo)", rep.unita, v => set({ unita: v }))}
        </div>
        <div>
          <div style={{ ...LBL, color: "#60a5fa", fontWeight: 700, marginBottom: "6px" }}>Intestazione dell'Excel</div>
          {[0, 1, 2].map(i => campo(`Riga ${i + 1}`, rep.righeExcel[i] ?? "", v => {
            const r = [...rep.righeExcel]; while (r.length < 3) r.push(""); r[i] = v; set({ righeExcel: r });
          }))}
          {campo("Sigla sopra la griglia", rep.siglaExcel, v => set({ siglaExcel: v }), "es. MEDICINA")}
        </div>
      </div>

      <div style={{ ...LBL, color: "#60a5fa", fontWeight: 700, margin: "6px 0" }}>Logo dell'Excel ({logoTxt})</div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
        {rep.logo && <img src={rep.logo} alt="logo" style={{ maxHeight: "36px", maxWidth: "260px", background: "#fff", borderRadius: "4px", padding: "2px" }} />}
        <button style={btn("#052e16", "#34d399", "#059669")} onClick={() => fileLogo.current?.click()}>Carica logo…</button>
        {rep.logo !== undefined && <button style={btn("#081120", "#94a3b8", "#2f5a8a")} onClick={() => set({ logo: undefined })}>Usa predefinito</button>}
        {rep.logo !== "" && <button style={btn("#1a0606", "#f87171", "#7f1d1d")} onClick={() => set({ logo: "" })}>Nessun logo</button>}
        <input ref={fileLogo} type="file" accept="image/png,image/jpeg" style={{ display: "none" }}
          onChange={e => { caricaLogo(e.target.files?.[0]); e.target.value = ""; }} />
        <span style={{ ...LBL, fontSize: "9px" }}>PNG o JPEG, max 500 KB; consigliata un'immagine larga e bassa (banner).</span>
      </div>

      <div style={{ ...LBL, color: "#60a5fa", fontWeight: 700, marginBottom: "6px" }}>Festività locali</div>
      <div style={{ ...LBL, fontSize: "9px", marginBottom: "6px" }}>
        Valgono come un festivo nazionale: fabbisogno festivo, niente ambulatorio, notte del giorno prima prefestiva.
      </div>
      {rep.festiviLocali.length === 0 && <div style={{ ...LBL, marginBottom: "6px" }}>Nessuna festività locale.</div>}
      {rep.festiviLocali.map(f => {
        const [mm, gg] = f.data.split("-").map(Number);
        return (
          <div key={f.data} style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
            <span style={{ color: "#fbbf24", fontFamily: "monospace", fontSize: "11px", width: "110px" }}>{gg} {MESI[mm - 1].toLowerCase()}</span>
            <span style={{ color: "#e2f0ff", fontFamily: "monospace", fontSize: "11px", flex: 1 }}>{f.nome || "—"}</span>
            <button style={btn("#1a0606", "#f87171", "#7f1d1d")}
              onClick={() => set({ festiviLocali: rep.festiviLocali.filter(x => x.data !== f.data) })}>Togli</button>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: "6px", alignItems: "flex-end", flexWrap: "wrap", margin: "6px 0 14px" }}>
        <label><div style={LBL}>Giorno</div>
          <input type="number" min={1} max={31} value={nuovaData.g} onChange={e => setNuovaData({ ...nuovaData, g: +e.target.value || 1 })} style={{ ...inp, width: "60px" }} /></label>
        <label><div style={LBL}>Mese</div>
          <select value={nuovaData.m} onChange={e => setNuovaData({ ...nuovaData, m: +e.target.value })} style={{ ...inp, width: "120px" }}>
            {MESI.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select></label>
        <label style={{ flex: "1 1 160px" }}><div style={LBL}>Nome (facoltativo)</div>
          <input value={nuovaData.nome} placeholder="es. San Matteo, patrono" onChange={e => setNuovaData({ ...nuovaData, nome: e.target.value })} style={inp} /></label>
        <button style={btn("#052e16", "#34d399", "#059669")} onClick={aggiungiFestivo}>+ Aggiungi</button>
      </div>

      <div style={{ ...LBL, color: "#60a5fa", fontWeight: 700, marginBottom: "6px" }}>Configurazione</div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <button style={btn("#0f766e", "#fff", "#0f766e")} onClick={esporta}>⇩ Esporta configurazione</button>
        <button style={btn("#081120", "#5eead4", "#0f766e")} onClick={() => fileConf.current?.click()}>⇧ Importa configurazione…</button>
        <input ref={fileConf} type="file" accept="application/json,.json" style={{ display: "none" }}
          onChange={e => { importa(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      <div style={{ ...LBL, fontSize: "9px", lineHeight: 1.6, marginTop: "6px" }}>
        Il file contiene regole, ambulatori, scheda reparto ed elenco dei medici, non i turni.
        Serve ad avviare un altro reparto partendo da questa configurazione. Contiene i nomi dei medici:
        condividilo solo con chi deve averli.
      </div>
    </div>
  );
}
