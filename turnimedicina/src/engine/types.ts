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
  /** true = dopo una notte, il 2° giorno (g+2) può essere di nuovo una Notte
   *  (N-libero-N) già nella generazione DI BASE e nella validazione, non solo
   *  nell'ultima chance. Il tetto maxNottiConsec sulle catene a passo 2 resta
   *  sempre attivo. false = comportamento storico (a g+2 al massimo un P). */
  notteLiberoNotte: boolean;
  /** true = RIPOSO ESTESO: dopo una Notte anche il 2° giorno (g+2) deve essere
   *  COMPLETAMENTE libero (nessun turno, oppure solo codici SPEC: X, ANA,
   *  per11, 104, L). Vieta quindi anche la P a g+2. È più stringente di tutto:
   *  quando attivo neutralizza notteLiberoNotte e la deroga relaxN dell'ultima
   *  chance (vincolo duro). false = comportamento storico (a g+2 max un P). */
  riposoEsteso: boolean;
  maxConsec: number;
  wkTarget: number;
  maxAssSett: number;
  /** CATENA DI CONTINUITÀ delle mattine (v0.3.17): nei tratti di giorni SENZA
   *  una mattina del ML, un unico medico "portatore" prende le mattine per
   *  blocchi di ~N giorni, con passaggio di consegne (l'ultima mattina
   *  dell'uscente coincide con la prima dell'entrante) e affiancamento ai
   *  bordi col ML — sempre ENTRO il fabbisogno MINIMO. Preferenza SOFT:
   *  nessuna cella dipende dalla catena per essere coperta. 0 = disattivata. */
  blocchiMattina: number;
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

/** Vincoli sondabili dalla diagnosi CAUSALE (v0.3.13). */
export type CausaVincolo = "ambMove" | "ambOff" | "regN" | "maxNotti" | "nottiConsec" | "maxConsec" | "obiettivo";

/** Analisi causale di UNA finestra di giorni con buchi (v0.3.13).
 *  esito: "locale"       = la finestra si copre già riorganizzando i suoi turni
 *                          (il buco nasce dai vincoli globali o dalla ricerca);
 *         "vincolo"      = uno o più rilassamenti SINGOLI (in `vincoli`) la
 *                          rendono copribile: quelli sono la causa;
 *         "combinazione" = risolvibile solo rilassando più vincoli insieme;
 *         "struttura"    = incopribile anche senza alcun vincolo del motore
 *                          (deficit materiale: assenze/manuali).
 *  nucleo: celle il cui SACRIFICIO sblocca tutto il resto della finestra — il
 *  "vero problema", che può non coincidere con le celle dichiarate scoperte. */
export interface CausaCluster {
  lo: number; hi: number;
  celle: CellaScoperta[];        // buchi M/P/N analizzati nella finestra
  ambGiorni: number[];           // giorni d'ambulatorio SENZA A nella finestra
  esito: "locale" | "vincolo" | "combinazione" | "struttura";
  vincoli: CausaVincolo[];
  nucleo: CellaScoperta[];
  /** false = le celle del nucleo sono ALTERNATIVE (ognuna da sola sblocca il
   *  resto); true = vanno sacrificate INSIEME (set minimo, deficit profondo). */
  nucleoCongiunto: boolean;
  motivo: string;                // frase principale, leggibile
  dettagli: string[];            // righe aggiuntive (motivi ambulatorio, suggerimenti, costi weekend)
}

/** Risultato completo della diagnosi causale. `completa:false` = budget di
 *  tempo esaurito prima di analizzare tutto (i cluster presenti restano validi). */
export interface DiagnosiCausale { cluster: CausaCluster[]; completa: boolean; ms: number; }

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
  /** Diagnosi CAUSALE (v0.3.13): calcolata in rifinituraFinale solo quando il
   *  tabellone rilasciato ha buchi o ambulatori scoperti. Opzionale: i
   *  consumatori esistenti la ignorano. */
  causale?: DiagnosiCausale;
}
