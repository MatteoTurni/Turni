// ─── TIPI DEL DOMINIO ─────────────────────────────────────────────────────────
export type Stato = "MR" | "ML" | "MDC" | "MPS";

export interface Medico {
  id: number;
  nome: string;
  codice: string;
  stato: Stato;
  obiettivo: number;
  ambulatorio: boolean;
}

export interface Turno {
  tipo: string;
  sott?: boolean;
  man?: boolean;
}

export interface Cella { t: Turno[]; }

/** Turni di UN mese: [idMedico][giorno] → { t: Turno[] } */
export type TurniMese = Record<string, Record<string, Cella>>;

/** Tutti i mesi salvati, chiave "AAAA-MM" (vedi mkKey) */
export type TurniAll = Record<string, TurniMese>;

export interface FasciaFabb { mMin: number; mMax: number; pMin: number; pMax: number; }

export interface Regole {
  maxNotti: number;
  maxConsec: number;
  wkTarget: number;
  maxAssSett: number;
  fabb: { fer: FasciaFabb; sab: FasciaFabb; fest: FasciaFabb };
}

export interface Risultato {
  turni: TurniMese;
  ok: boolean;
  parziale: boolean;
  problemi: string[];
}
