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
  maxNottiConsec: number;   // max notti "di fila" (a passo 2: N-libero-N-libero-N…)
  maxConsec: number;
  wkTarget: number;
  maxAssSett: number;
  /** Giorni della settimana con ambulatorio (0=Lun … 4=Ven, festivi sempre
   *  esclusi). Default [1] = martedì. Lista vuota = nessun ambulatorio. */
  giorniAmb: number[];
  fabb: { fer: FasciaFabb; sab: FasciaFabb; fest: FasciaFabb };
}

/** Una cella di copertura scoperta (giorno + fascia). */
export interface CellaScoperta { g: number; f: "M" | "P" | "N"; }

/** Un medico che, nella variante di ultima chance, perde weekend liberi. */
export interface WeekendPerso { id: number; nome: string; da: number; a: number; }

/** Variante prodotta dall'ultima chance, offerta come alternativa NON adottata
 *  d'ufficio: copre strettamente più celle del tabellone primario, ma può
 *  costare weekend liberi. La UI la propone; l'utente decide se applicarla. */
export interface AlternativaUC {
  turni: TurniMese;
  problemi: string[];
  celleCoperte: CellaScoperta[];   // buchi COLMABILI del primario chiusi qui
  weekendPersi: WeekendPerso[];    // medici che perdono weekend liberi vs primario
}

/** Diagnosi EMPIRICA della generazione (v0.3.10): per ogni cella "g-f", in
 *  quanti tentativi del multi-tentativo è rimasta scoperta. Una cella bucata
 *  nel tabellone finale con conteggio === tentativi non è MAI stata coperta
 *  da nessun tentativo: quasi certamente impossibile per il motore (la prova
 *  formale, dove esiste, arriva da diagnosiStatica). Solo telemetria in
 *  lettura: non influenza in alcun modo la ricerca. */
export interface DiagnosiGen { tentativi:number; conteggi: Record<string, number>; }

export interface Risultato {
  turni: TurniMese;
  ok: boolean;
  parziale: boolean;
  problemi: string[];
  /** Presente solo quando esiste una variante di ultima chance che copre di più
   *  del primario. Opzionale: i consumatori esistenti la ignorano. */
  alternativaUC?: AlternativaUC;
  /** Presente solo per le generazioni multi-tentativo (pulsante ①). */
  diagnosi?: DiagnosiGen;
}
