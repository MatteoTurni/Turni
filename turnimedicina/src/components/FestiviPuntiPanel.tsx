import { useState } from "react";
import type { Regole } from "../engine/types";
import { MESI } from "../engine/date";
import { allineaFestiviPiano, festiviPianoDefault, dataPianoValida, type FestivitaPiano, type PuntiFest } from "../engine/pianoFestivi";

// ─── FESTIVITÀ E PUNTI DEL PIANO FESTIVI (v0.3.60) ────────────────────────────
// L'elenco delle festività che entrano nel sorteggio della sezione Festivi, con
// i punti dei tre turni e la stella dei superfestivi. Le feste locali del
// reparto ci sono sempre: si aggiungono e si tolgono dalla scheda reparto.

const dataTxt = (d: string) => d === "pasqua" ? "Pasqua" : d === "pasquetta" ? "lunedì dopo Pasqua" : `${+d.slice(3)} ${MESI[+d.slice(0, 2) - 1].toLowerCase()}`;
const ordine = (d: string) => d === "pasqua" ? "04-00" : d === "pasquetta" ? "04-01" : d;

export function FestiviPuntiPanel({ regole, onRegole, avviso }: {
  regole: Regole;
  onRegole: (r: Regole) => void;
  avviso: (txt: string, tp?: string) => void;
}) {
  const lista = allineaFestiviPiano(regole.festiviPiano, regole.reparto.festiviLocali);
  const [nuova, setNuova] = useState({ g: 1, m: 1, nome: "" });
  const salva = (l: FestivitaPiano[]) => onRegole({ ...regole, festiviPiano: l });
  const mod = (id: string, patch: Partial<FestivitaPiano>) => salva(lista.map(f => f.id === id ? { ...f, ...patch } : f));
  const punti = (f: FestivitaPiano, k: keyof PuntiFest, v: number) => mod(f.id, { punti: { ...f.punti, [k]: v } });

  const LBL: React.CSSProperties = { color: "#64748b", fontSize: "10px", fontFamily: "monospace", lineHeight: 1.6 };
  const INP: React.CSSProperties = { background: "#ffffff", border: "1px solid #cbd5e1", color: "#1d4ed8", borderRadius: "6px", padding: "4px 6px", fontSize: "12px", fontFamily: "monospace" };
  const TH: React.CSSProperties = { ...LBL, textAlign: "center", padding: "3px 5px", fontWeight: 700 };
  const btn: React.CSSProperties = { background: "#f1f5f9", color: "#1d4ed8", border: "1px solid #cbd5e1", borderRadius: "6px", padding: "5px 11px", cursor: "pointer", fontSize: "11px", fontWeight: 700, fontFamily: "monospace" };
  const pt = (f: FestivitaPiano, k: keyof PuntiFest) => f.soloGiorno && k !== "giorno"
    ? <span style={{ ...LBL, display: "block", textAlign: "center" }}>—</span>
    : <input type="number" min={0} max={20} step={0.5} value={f.punti[k]} aria-label={`${f.nome}: ${k}`}
        onChange={e => { const v = parseFloat(e.target.value); punti(f, k, Math.max(0, Math.min(20, isFinite(v) ? v : 0))); }}
        style={{ ...INP, width: "50px", textAlign: "center" }} />;

  const aggiungi = () => {
    const data = String(nuova.m).padStart(2, "0") + "-" + String(nuova.g).padStart(2, "0");
    if (!dataPianoValida(data)) { avviso("Data non valida.", "err"); return; }
    if (lista.some(f => f.data === data)) { avviso("Quel giorno è già nell'elenco.", "warn"); return; }
    salva([...lista, { id: "extra-" + data, nome: nuova.nome.trim().slice(0, 60) || "Festività", data, sup: false, punti: { nottePrima: 1, giorno: 1, notte: 1 } }]);
    setNuova({ ...nuova, nome: "" });
  };

  return (
    <div>
      <div style={{ ...LBL, fontSize: "9px", marginBottom: "10px" }}>
        Le festività del sorteggio della sezione <b>Festivi</b>. Ogni festività ha tre turni — notte prima, giorno (12 ore), notte — e ciascuno i suoi punti;
        ★ = superfestivo. I valori di partenza vengono dal sondaggio del reparto (scala da 1 a 3). Non cambiano la generazione dei mesi.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={{ ...TH, textAlign: "left" }}>Festività</th><th style={TH}>Quando</th><th style={TH}>★</th>
            <th style={TH}>Notte prima</th><th style={TH}>Giorno</th><th style={TH}>Notte</th><th />
          </tr></thead>
          <tbody>
            {[...lista].sort((a, b) => ordine(a.data).localeCompare(ordine(b.data))).map(f => {
              const locale = f.id.startsWith("locale-");
              return (
                <tr key={f.id}>
                  <td style={{ padding: "2px 4px 2px 0" }}>
                    <input value={f.nome} onChange={e => mod(f.id, { nome: e.target.value.slice(0, 60) })} aria-label="Nome della festività"
                      style={{ ...INP, color: "#0f172a", width: "150px" }} />
                  </td>
                  <td style={{ ...LBL, padding: "2px 6px", whiteSpace: "nowrap" }}>{dataTxt(f.data)}{f.soloGiorno ? <><br />solo giorno</> : ""}</td>
                  <td style={{ textAlign: "center", padding: "2px 6px" }}>
                    <input type="checkbox" checked={f.sup} disabled={!!f.soloGiorno} onChange={e => mod(f.id, { sup: e.target.checked })} title="Superfestivo" style={{ accentColor: "#b45309", cursor: "pointer" }} />
                  </td>
                  <td style={{ padding: "2px 4px" }}>{pt(f, "nottePrima")}</td>
                  <td style={{ padding: "2px 4px" }}>{pt(f, "giorno")}</td>
                  <td style={{ padding: "2px 4px" }}>{pt(f, "notte")}</td>
                  <td style={{ padding: "2px 4px" }}>
                    {locale
                      ? <span style={{ ...LBL, fontSize: "9px" }} title="Festa locale: si toglie dalla scheda reparto">locale</span>
                      : <button onClick={() => salva(lista.filter(x => x.id !== f.id))} title="Togli dal sorteggio"
                          style={{ background: "#fff1f2", color: "#be123c", border: "1px solid #fecdd3", borderRadius: "4px", padding: "2px 7px", cursor: "pointer", fontSize: "10px", fontWeight: 700, fontFamily: "monospace" }}>✕</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginTop: "10px" }}>
        <select value={nuova.g} onChange={e => setNuova({ ...nuova, g: +e.target.value })} style={INP} aria-label="Giorno">
          {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
        </select>
        <select value={nuova.m} onChange={e => setNuova({ ...nuova, m: +e.target.value })} style={INP} aria-label="Mese">
          {MESI.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
        </select>
        <input value={nuova.nome} placeholder="nome della festività" onChange={e => setNuova({ ...nuova, nome: e.target.value })} style={{ ...INP, color: "#0f172a", width: "190px" }} />
        <button onClick={aggiungi} style={btn}>➕ Aggiungi</button>
        <button onClick={() => { salva(allineaFestiviPiano(festiviPianoDefault(), regole.reparto.festiviLocali)); avviso("Festività e punti riportati ai valori del sondaggio."); }} style={btn}>Valori del sondaggio</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "14px" }}>
        <input type="number" min={1} max={5} value={regole.pianoFestiviAnni}
          onChange={e => onRegole({ ...regole, pianoFestiviAnni: Math.max(1, Math.min(5, Math.round(+e.target.value) || 1)) })}
          style={{ ...INP, width: "52px", textAlign: "center" }} />
        <div>
          <div style={{ ...LBL, color: "#0f172a", fontWeight: 700 }}>Anni riletti</div>
          <div style={{ ...LBL, fontSize: "9px" }}>Quanti anni di mesi salvati la sezione Festivi rilegge per il saldo di partenza e per le festività già fatte.</div>
        </div>
      </div>
    </div>
  );
}
