import type { Ambulatorio, FasciaAmb, Medico, OccAmb } from "../engine/types";
import { DF } from "../engine/date";
import { abilitatoAmb, ambConfigurato, OCC_AMB } from "../engine/turni";
import { siglaDaNome } from "../engine/regole";

// ─── PANNELLO AMBULATORI (v0.3.36) ────────────────────────────────────────────
// Elenco degli ambulatori del reparto, ciascuno con nome, sigla, giorni/fasce e
// medici abilitati. Gli abilitati stanno sul Medico (campo `ambulatori`): qui
// si modificano per comodità insieme al resto, come dalla scheda del medico.

const FASCE: [FasciaAmb | "", string][] = [["", "—"], ["M", "Mattina"], ["P", "Pomeriggio"], ["MP", "Matt.+Pom."]];
const OCC_LBL: Record<OccAmb, string> = { "1": "1ª", "2": "2ª", "3": "3ª", "4": "4ª", "5": "5ª", U: "Ultima" };

/** Abilitazioni effettive del medico (materializza il vecchio flag). */
export function ambulatoriDi(m: Medico, ambulatori: Ambulatorio[]): string[] {
  return ambulatori.filter(a => abilitatoAmb(m, a.id)).map(a => a.id);
}

/** Medico con la lista di abilitazioni aggiornata (e il flag coerente). */
export function conAbilitazioni(m: Medico, ids: string[]): Medico {
  return { ...m, ambulatori: ids, ambulatorio: ids.length > 0 };
}

export function AmbulatoriPanel({ ambulatori, medici, onAmbulatori, onMedici }: {
  ambulatori: Ambulatorio[];
  medici: Medico[];
  onAmbulatori: (a: Ambulatorio[]) => void;
  onMedici: (m: Medico[]) => void;
}) {
  const LBL: React.CSSProperties = { color: "#2d5a8a", fontSize: "10px", fontFamily: "monospace" };
  const inp: React.CSSProperties = {
    background: "#030810", border: "1px solid #1e3a5f", color: "#e2f0ff", borderRadius: "6px",
    padding: "5px 8px", fontSize: "11px", fontFamily: "monospace", boxSizing: "border-box",
  };
  const upd = (id: string, patch: Partial<Ambulatorio>) =>
    onAmbulatori(ambulatori.map(a => a.id === id ? { ...a, ...patch } : a));
  const setFascia = (a: Ambulatorio, d: number, f: FasciaAmb | "") => {
    const giorni = { ...a.giorni };
    if (f) giorni[d] = f; else delete giorni[d];
    upd(a.id, { giorni });
  };
  // SETTIMANE DEL MESE (v0.3.43): un giorno può valere solo in alcune
  // settimane (2° e 4° giovedì, primo e ultimo martedì…), con fascia propria.
  const perSettimana = (a: Ambulatorio, d: number) => !!a.settimane?.[d];
  const togSettimane = (a: Ambulatorio, d: number) => {
    const settimane = { ...(a.settimane || {}) };
    const giorni = { ...a.giorni };
    if (settimane[d]) {
      // torna a "ogni settimana": riprende la prima fascia scelta, se c'era
      const f = Object.values(settimane[d]!).find(Boolean);
      delete settimane[d];
      if (f) giorni[d] = f; else delete giorni[d];
    } else {
      // passa a "per settimana": la fascia settimanale vale per tutte le occorrenze
      const f = giorni[d];
      settimane[d] = f ? { "1": f, "2": f, "3": f, "4": f, "5": f } : {};
      delete giorni[d];
    }
    upd(a.id, { giorni, settimane });
  };
  const setFasciaOcc = (a: Ambulatorio, d: number, o: OccAmb, f: FasciaAmb | "") => {
    const occ = { ...(a.settimane?.[d] || {}) };
    if (f) occ[o] = f; else delete occ[o];
    upd(a.id, { settimane: { ...(a.settimane || {}), [d]: occ } });
  };
  const aggiungi = () => {
    const id = "amb_" + Date.now().toString(36);
    const nome = `Ambulatorio ${ambulatori.length + 1}`;
    onAmbulatori([...ambulatori, { id, nome, sigla: "A" + (ambulatori.length + 1), giorni: {} }]);
  };
  const elimina = (a: Ambulatorio) => {
    if (!window.confirm(`Eliminare l'ambulatorio "${a.nome}"? I turni già inseriti restano in tabellone.`)) return;
    const resto = ambulatori.filter(x => x.id !== a.id);
    // Le abilitazioni vanno materializzate PRIMA di togliere l'ambulatorio:
    // un medico col vecchio flag resterebbe altrimenti abilitato a nulla.
    onMedici(medici.map(m => {
      const ids = ambulatoriDi(m, ambulatori).filter(x => x !== a.id);
      return Array.isArray(m.ambulatori) || m.ambulatorio ? conAbilitazioni(m, ids) : m;
    }));
    onAmbulatori(resto);
  };
  const togMed = (a: Ambulatorio, m: Medico) => {
    const cur = ambulatoriDi(m, ambulatori);
    const ids = cur.includes(a.id) ? cur.filter(x => x !== a.id) : [...cur, a.id];
    onMedici(medici.map(x => x.id === m.id ? conAbilitazioni(m, ids) : x));
  };
  const candidati = medici.filter(m => m.stato !== "MPS");

  return (
    <div>
      {ambulatori.length === 0 && (
        <div style={{ ...LBL, marginBottom: "10px" }}>Nessun ambulatorio configurato.</div>
      )}
      {ambulatori.map(a => {
        const abil = candidati.filter(m => abilitatoAmb(m, a.id));
        return (
          <div key={a.id} style={{ background: "#0b1626", border: "1px solid #1e3a5f", borderRadius: "8px", padding: "10px", marginBottom: "10px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "10px" }}>
              <div style={{ flex: "1 1 160px" }}>
                <div style={LBL}>Nome</div>
                <input value={a.nome} style={{ ...inp, width: "100%" }}
                  onChange={e => upd(a.id, { nome: e.target.value })}
                  onBlur={e => { if (!e.target.value.trim()) upd(a.id, { nome: "Ambulatorio" }); }} />
              </div>
              <div style={{ width: "80px" }}>
                <div style={LBL}>Sigla</div>
                <input value={a.sigla} maxLength={5} style={{ ...inp, width: "100%", color: "#6ee7b7", fontWeight: 700 }}
                  onChange={e => upd(a.id, { sigla: e.target.value.toUpperCase() })}
                  onBlur={e => { if (!e.target.value.trim()) upd(a.id, { sigla: siglaDaNome(a.nome) }); }} />
              </div>
              <button onClick={() => elimina(a)} title="Elimina ambulatorio"
                style={{ background: "#1a0606", color: "#f87171", border: "1px solid #7f1d1d", borderRadius: "6px", padding: "5px 10px", cursor: "pointer", fontSize: "11px", fontFamily: "monospace" }}>
                Elimina
              </button>
            </div>

            <div style={{ ...LBL, marginBottom: "4px" }}>Giorni e fascia</div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px", alignItems: "flex-start" }}>
              {[0, 1, 2, 3, 4].map(d => {
                const ps = perSettimana(a, d);
                const f = a.giorni[d] ?? "";
                const attivo = ps ? Object.values(a.settimane![d]!).some(Boolean) : !!f;
                const sel = (v: string) => ({ ...inp, padding: "3px", color: v ? "#34d399" : "#3d5878", borderColor: v ? "#059669" : "#1e3a5f" });
                return (
                  <div key={d} style={{ display: "flex", flexDirection: "column", gap: "3px",
                    ...(ps ? { background: "#081120", border: "1px solid #1e3a5f", borderRadius: "6px", padding: "4px" } : {}) }}>
                    <span style={{ ...LBL, color: attivo ? "#34d399" : "#3d5878", fontWeight: 700 }}>{DF[d].slice(0, 3)}</span>
                    {!ps && (
                      <select value={f} onChange={e => setFascia(a, d, e.target.value as FasciaAmb | "")} style={sel(f)}>
                        {FASCE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    )}
                    {ps && OCC_AMB.map(o => {
                      const fo = a.settimane![d]![o] ?? "";
                      return (
                        <label key={o} style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                          <span style={{ ...LBL, width: "38px", color: fo ? "#34d399" : "#3d5878" }}>{OCC_LBL[o]}</span>
                          <select value={fo} onChange={e => setFasciaOcc(a, d, o, e.target.value as FasciaAmb | "")} style={sel(fo)}>
                            {FASCE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </label>
                      );
                    })}
                    <label title="Scegli la fascia per ciascuna settimana del mese (es. 2° e 4° giovedì, primo e ultimo martedì)"
                      style={{ ...LBL, display: "flex", gap: "3px", alignItems: "center", cursor: "pointer", fontSize: "9px" }}>
                      <input type="checkbox" checked={ps} onChange={() => togSettimane(a, d)} style={{ margin: 0 }} />
                      per settimana
                    </label>
                  </div>
                );
              })}
            </div>

            <div style={{ ...LBL, marginBottom: "4px" }}>
              Medici abilitati ({abil.length}){abil.length === 0 && ambConfigurato(a) &&
                <span style={{ color: "#f87171" }}> — nessuno: l'ambulatorio resterà scoperto</span>}
            </div>
            <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
              {candidati.map(m => {
                const on = abilitatoAmb(m, a.id);
                return (
                  <button key={m.id} onClick={() => togMed(a, m)}
                    style={{ background: on ? "#052e16" : "#081120", color: on ? "#34d399" : "#3d5878",
                      border: `1px solid ${on ? "#059669" : "#1e3a5f"}`, borderRadius: "5px",
                      padding: "3px 8px", cursor: "pointer", fontSize: "10px", fontWeight: 700, fontFamily: "monospace" }}>
                    {m.nome}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <button onClick={aggiungi}
        style={{ background: "#052e16", color: "#34d399", border: "1px solid #059669", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", fontSize: "11px", fontWeight: 700, fontFamily: "monospace", marginBottom: "8px" }}>
        + Aggiungi ambulatorio
      </button>
      <div style={{ ...LBL, fontSize: "9px", lineHeight: 1.6 }}>
        Per ogni ambulatorio scegli i giorni (Mattina, Pomeriggio o entrambe) e i medici abilitati.
        Con «per settimana» il giorno vale solo in alcune settimane del mese, ciascuna con la sua
        fascia: es. 2° e 4° giovedì, oppure primo e ultimo martedì («Ultima» = l'ultimo del mese;
        se coincide con la 4ª o la 5ª le fasce si sommano).
        Il generatore assegna ogni ambulatorio solo ai suoi abilitati, bilanciando il TOTALE degli
        ambulatori fra i medici. Due ambulatori nella stessa fascia vanno a medici diversi.
        In tabellone compare la sigla (pomeriggio: sigla + "p"). I festivi restano sempre esclusi.
      </div>
    </div>
  );
}
