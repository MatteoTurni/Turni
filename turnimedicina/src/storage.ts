import type { Medico, Regole, TurniAll, TurniMese } from "./engine/types";
import { mergeRegole } from "./engine/regole";
import { mkKey } from "./engine/date";

// ─── STORAGE ──────────────────────────────────────────────────────────────────
// UNICO punto dell'app che tocca localStorage. Il motore non lo importa mai:
// regole, contesto del mese precedente e rotazione ambulatorio gli vengono
// iniettati dalla UI (setRegole / setPrevContext / setAmbRotStart).

export const SK         = "medicina_v26";
export const SK_AMB_ROT = "medicina_amb_rotation"; // rotazione ambulatorio
export const SK_REGOLE  = "medicina_regole_v1";

export interface StatoSalvato {
  anno?: number;
  mese?: number;
  medici?: Medico[];
  turniAll: TurniAll;
}

// Migrazione: i vecchi turni unici "MP"/"AP" salvati in precedenza vengono
// convertiti in due turni distinti nella stessa giornata (M+P oppure A+P).
export function migraTurni(turni: TurniMese): TurniMese {
  if(!turni||typeof turni!=="object") return turni;
  for(const id in turni){
    const giorni=turni[id]; if(!giorni) continue;
    for(const g in giorni){
      const cell=giorni[g];
      if(!cell||!Array.isArray(cell.t)) continue;
      const out=[];
      for(const s of cell.t){
        if(s.tipo==="MP"){ out.push({...s,tipo:"M"}); out.push({...s,tipo:"P"}); }
        else if(s.tipo==="AP"){ out.push({...s,tipo:"A"}); out.push({...s,tipo:"P"}); }
        else out.push(s);
      }
      cell.t=out;
    }
  }
  return turni;
}

export function loadS(): StatoSalvato | null {
  try{
    const r=localStorage.getItem(SK); if(!r) return null;
    const s=JSON.parse(r); if(!s) return null;
    // Nuovo formato: turniAll = { "AAAA-MM": { [idMedico]: { [giorno]: {t} } } }.
    if(s.turniAll && typeof s.turniAll==="object"){
      for(const k in s.turniAll) s.turniAll[k]=migraTurni(s.turniAll[k]);
    } else if(s.turni && typeof s.turni==="object"){
      // Vecchio formato "piatto": si assegna al mese salvato in precedenza.
      const key=mkKey(s.anno ?? 2026, s.mese ?? 5);
      s.turniAll={ [key]: migraTurni(s.turni) };
    } else {
      s.turniAll={};
    }
    delete s.turni;
    return s;
  }catch{ return null; }
}
export function saveS(s: StatoSalvato){ try{ localStorage.setItem(SK,JSON.stringify(s)); }catch{} }

export function loadRegole(): Regole {
  try{
    const r=localStorage.getItem(SK_REGOLE); if(!r) return mergeRegole(null);
    return mergeRegole(JSON.parse(r)||{});
  }catch{ return mergeRegole(null); }
}
export function saveRegole(r: Regole){ try{ localStorage.setItem(SK_REGOLE,JSON.stringify(r)); }catch{} }

export function loadAmbRot(): { nextIdx: number } {
  try{ const r=localStorage.getItem(SK_AMB_ROT); return r?JSON.parse(r):{nextIdx:0}; }catch{ return {nextIdx:0}; }
}
export function saveAmbRot(s: { nextIdx: number }){ try{ localStorage.setItem(SK_AMB_ROT,JSON.stringify(s)); }catch{} }
