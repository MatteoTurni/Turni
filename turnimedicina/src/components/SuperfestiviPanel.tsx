import { useState } from "react";
import type { Regole, Superfestivo } from "../engine/types";
import { MESI } from "../engine/date";

// ─── SUPERFESTIVI (v0.3.57) ───────────────────────────────────────────────────
// Elenco dei superfestivi (equità fra gli anni) e alternanza Natale/Capodanno.
// Per ognuno contano la notte prima, la mattina, il pomeriggio e la notte.

const etichetta = (sf: Superfestivo) => {
  if (sf.data === "pasqua") return "Pasqua (mobile)";
  if (sf.data === "pasquetta") return "Pasquetta (mobile)";
  const [mm, gg] = sf.data.split("-").map(Number);
  return `${gg} ${MESI[mm - 1].toLowerCase()}`;
};

export function SuperfestiviPanel({ regole, onRegole, avviso }: {
  regole: Regole;
  onRegole: (r: Regole) => void;
  avviso: (txt: string, tp?: string) => void;
}) {
  const lista = regole.superfestivi;
  const [nuovo, setNuovo] = useState({ tipo: "fissa", g: 1, m: 1, nome: "" });
  const LBL: React.CSSProperties = { color: "#2d5a8a", fontSize: "10px", fontFamily: "monospace" };
  const inp: React.CSSProperties = {
    background: "#030810", border: "1px solid #1e3a5f", color: "#e2f0ff", borderRadius: "6px",
    padding: "5px 8px", fontSize: "11px", fontFamily: "monospace", boxSizing: "border-box", width: "100%",
  };
  const btn = (bg: string, fg: string, bd: string): React.CSSProperties => ({
    background: bg, color: fg, border: `1px solid ${bd}`, borderRadius: "6px", padding: "5px 11px",
    cursor: "pointer", fontSize: "11px", fontWeight: 700, fontFamily: "monospace",
  });

  const aggiungi = () => {
    let data = nuovo.tipo;
    if (nuovo.tipo === "fissa") {
      const giorniMese = new Date(2024, nuovo.m, 0).getDate();
      if (nuovo.g < 1 || nuovo.g > giorniMese) { avviso("Data non valida.", "err"); return; }
      data = `${String(nuovo.m).padStart(2, "0")}-${String(nuovo.g).padStart(2, "0")}`;
    }
    if (lista.some(x => x.data === data)) { avviso("Questo superfestivo è già nell'elenco.", "warn"); return; }
    const nome = nuovo.nome.trim() || (data === "pasquetta" ? "Pasquetta" : data === "pasqua" ? "Pasqua" : "");
    onRegole({ ...regole, superfestivi: [...lista, { id: "sf-" + data, nome, data }] });
    setNuovo({ ...nuovo, nome: "" });
  };

  const attivi = regole.superfestiviAttivi;
  return (
    <div>
      <label style={{ display: "flex", gap: "8px", alignItems: "flex-start", cursor: "pointer", marginBottom: "10px" }}>
        <input type="checkbox" checked={attivi}
          onChange={e => onRegole({ ...regole, superfestiviAttivi: e.target.checked })} style={{ marginTop: "2px" }} />
        <span>
          <span style={{ ...LBL, color: "#e2eeff", fontWeight: 700 }}>Equità dei superfestivi attiva</span>
          <div style={{ ...LBL, fontSize: "9px" }}>Spenta: l'elenco resta, ma il motore tratta questi giorni come festivi normali.</div>
        </span>
      </label>
      <div style={{ opacity: attivi ? 1 : 0.45 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
        <input type="number" min={1} max={5} value={regole.superfestiviAnni} disabled={!attivi}
          onChange={e => onRegole({ ...regole, superfestiviAnni: Math.max(1, Math.min(5, Math.floor(+e.target.value || 1))) })}
          style={{ ...inp, width: "52px", textAlign: "center" }} />
        <div>
          <div style={{ ...LBL, color: "#e2eeff", fontWeight: 700 }}>Anni precedenti da considerare</div>
          <div style={{ ...LBL, fontSize: "9px" }}>L'anno scorso conta per intero, quello prima a metà, poi un terzo… (da 1 a 5).</div>
        </div>
      </div>
      <div style={{ ...LBL, fontSize: "9px", marginBottom: "8px" }}>
        Per ogni superfestivo contano quattro turni: la notte prima, la mattina, il pomeriggio e la notte. Il motore
        evita di ridare a un medico lo stesso identico turno degli anni scorsi e, se possibile, lo stesso superfestivo;
        pareggia i superfestivi fatti negli anni considerati. Lo storico viene dai mesi salvati: per gli anni scorsi basta
        inserire a mano i turni di quei giorni nel calendario (es. dicembre dell'anno scorso).
      </div>
      {lista.length === 0 && <div style={{ ...LBL, marginBottom: "6px" }}>Nessun superfestivo: l'equità fra gli anni è spenta.</div>}
      {lista.map(sf => (
        <div key={sf.id} style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "4px" }}>
          <span style={{ color: "#fbbf24", fontFamily: "monospace", fontSize: "11px", width: "130px" }}>{etichetta(sf)}</span>
          <span style={{ color: "#e2f0ff", fontFamily: "monospace", fontSize: "11px", flex: 1 }}>{sf.nome || "—"}</span>
          <button style={btn("#1a0606", "#f87171", "#7f1d1d")}
            onClick={() => onRegole({ ...regole, superfestivi: lista.filter(x => x.id !== sf.id) })}>Togli</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: "6px", alignItems: "flex-end", flexWrap: "wrap", margin: "6px 0 12px" }}>
        <label><div style={LBL}>Tipo</div>
          <select value={nuovo.tipo} onChange={e => setNuovo({ ...nuovo, tipo: e.target.value })} style={{ ...inp, width: "120px" }}>
            <option value="fissa">Data fissa</option>
            <option value="pasqua">Pasqua</option>
            <option value="pasquetta">Pasquetta</option>
          </select></label>
        {nuovo.tipo === "fissa" && <>
          <label><div style={LBL}>Giorno</div>
            <input type="number" min={1} max={31} value={nuovo.g} onChange={e => setNuovo({ ...nuovo, g: +e.target.value || 1 })} style={{ ...inp, width: "60px" }} /></label>
          <label><div style={LBL}>Mese</div>
            <select value={nuovo.m} onChange={e => setNuovo({ ...nuovo, m: +e.target.value })} style={{ ...inp, width: "120px" }}>
              {MESI.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select></label>
        </>}
        <label style={{ flex: "1 1 140px" }}><div style={LBL}>Nome (facoltativo)</div>
          <input value={nuovo.nome} placeholder="es. Santo Stefano" onChange={e => setNuovo({ ...nuovo, nome: e.target.value })} style={inp} /></label>
        <button style={btn("#052e16", "#34d399", "#059669")} onClick={aggiungi}>+ Aggiungi</button>
      </div>
      <label style={{ display: "flex", gap: "8px", alignItems: "flex-start", cursor: "pointer" }}>
        <input type="checkbox" checked={regole.alternanzaNataleCapodanno}
          onChange={e => onRegole({ ...regole, alternanzaNataleCapodanno: e.target.checked })} style={{ marginTop: "2px" }} />
        <span>
          <span style={{ ...LBL, color: "#e2eeff", fontWeight: 700 }}>Alternanza Natale / Capodanno</span>
          <div style={{ ...LBL, fontSize: "9px" }}>Chi lavora a Natale (notte del 24 o il 25) non lavora a Capodanno (notte del 31 o l'1), e viceversa, se possibile.</div>
        </span>
      </label>
      </div>
    </div>
  );
}
