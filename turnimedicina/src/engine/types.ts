// ─── TIPI DEL DOMINIO ─────────────────────────────────────────────────────────
export type Stato = "MR" | "ML" | "MDC" | "MPS";

export interface Medico {
  id: number;
  nome: string;
  codice: string;
  stato: Stato;
  obiettivo: number;
  /** Abilitato ad ALMENO un ambulatorio. Storico (pre-v0.3.36): unica
   *  abilitazione, vale per l'ambulatorio "A" quando `ambulatori` è assente. */
  ambulatorio: boolean;
  /** Ambulatori (id di Regole.ambulatori) a cui il medico è abilitato
   *  (v0.3.36). Assente = storico: `ambulatorio` vale per l'ambulatorio "A". */
  ambulatori?: string[];
}

export interface Turno {
  tipo: string;
  sott?: boolean;
  man?: boolean;
  /** Solo per A/Ap: id dell'ambulatorio (Regole.ambulatori). Assente = "A". */
  amb?: string;
  /** Solo per i turni PS 1/2/3 (v0.3.45): svolto in ALTRO OSPEDALE. Vale come
   *  sempre per chi lo fa (punti, riposo, notti) ma non affianca mai l'MDC.
   *  In tabellone ed Excel la sigla ha un asterisco (es. "3*"). */
  est?: boolean;
}

/** Turni PS validi per affiancare l'MDC (v0.3.45), per codice: ordinario e
 *  ALPI (sottolineato). I turni in altro ospedale non sono mai validi. */
export type AffiancamentoPS = Record<"1"|"2"|"3", { ord: boolean; alpi: boolean }>;

export interface Cella { t: Turno[]; }

/** Turni di UN mese: [idMedico][giorno] → { t: Turno[] } */
export type TurniMese = Record<string, Record<string, Cella>>;

/** Tutti i mesi salvati, chiave "AAAA-MM" (vedi mkKey) */
export type TurniAll = Record<string, TurniMese>;

export interface FasciaFabb { mMin: number; mMax: number; pMin: number; pMax: number; }

export type FasciaAmb = "M"|"P"|"MP";

/** Un ambulatorio del reparto (v0.3.36). */
export interface Ambulatorio {
  id: string;
  nome: string;
  /** Etichetta breve mostrata in tabellone ed Excel (pomeriggio: sigla + "p"). */
  sigla: string;
  /** Giorno della settimana (0=Lun … 4=Ven) → fascia. Assente = niente
   *  ambulatorio quel giorno. I festivi sono sempre esclusi. */
  giorni: Partial<Record<number, FasciaAmb>>;
  /** SETTIMANE DEL MESE (v0.3.43), per giorno della settimana (0=Lun … 4=Ven).
   *  Se presente per un giorno, SOSTITUISCE `giorni[dw]`: la fascia si sceglie
   *  per occorrenza nel mese ("1".."5" = 1°…5° quel giorno del mese, "U" =
   *  l'ultimo). Esempi: 2° e 4° giovedì; primo e ultimo martedì; 2° giovedì di
   *  mattina e 4° di pomeriggio. Se la 4ª (o 5ª) occorrenza è anche l'ultima,
   *  le fasce si uniscono. Assente = ogni settimana con `giorni[dw]`. */
  settimane?: Partial<Record<number, Partial<Record<OccAmb, FasciaAmb>>>>;
}
/** Occorrenza di un giorno della settimana nel mese: 1ª…5ª o ultima. */
export type OccAmb = "1"|"2"|"3"|"4"|"5"|"U";

/** Festività locale a data fissa (es. il santo patrono), "MM-GG". */
export interface FestivoLocale { data: string; nome: string; }
/** SCHEDA REPARTO (v0.3.44): ciò che distingue un reparto dall'altro fuori
 *  dalle regole di turno — intestazioni di app ed Excel, logo, festività
 *  locali. */
export interface Reparto {
  /** Riga piccola in alto nell'app (azienda · presidio). */
  azienda: string;
  presidio: string;
  /** Titolo dell'app e del riepilogo (es. "U.O.C. Medicina Interna"). */
  unita: string;
  /** Excel: le righe di intestazione sotto il logo e la sigla sopra la griglia. */
  righeExcel: string[];
  siglaExcel: string;
  /** Logo dell'Excel: assente = quello predefinito; "" = nessun logo;
   *  altrimenti data URL (PNG o JPEG) caricato dall'utente. */
  logo?: string;
  festiviLocali: FestivoLocale[];
}

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
  /** true = MATTINA AL 2° GIORNO: dopo una Notte, al 2° giorno (g+2) è ammessa
   *  anche una Mattina (M/A/1), non solo un Pomeriggio. Storicamente la M a
   *  g+2 è sempre stata vietata; questa regola la sblocca in generazione,
   *  in add() e in validazione. Ortogonale a notteLiberoNotte (che riguarda la
   *  N a g+2): possono essere attive insieme. Neutralizzata da riposoEsteso,
   *  che tiene g+2 completamente libero e vince su tutto.
   *  false = comportamento storico (a g+2 niente M). */
  mattinaDopoNotte: boolean;
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
  /** Ambulatori del reparto (v0.3.36), ciascuno coi suoi giorni e fasce.
   *  Lista vuota = nessun ambulatorio. Gli abilitati stanno sul Medico. */
  ambulatori: Ambulatorio[];
  /** @deprecated solo in INGRESSO (salvataggi pre-v0.3.36): mergeRegole li
   *  converte nell'ambulatorio "A" quando `ambulatori` è assente. */
  giorniAmb?: number[];
  /** @deprecated vedi giorniAmb. */
  fasceAmb?: Partial<Record<number, FasciaAmb>>;
  fabb: { fer: FasciaFabb; sab: FasciaFabb; fest: FasciaFabb };
  reparto: Reparto;
  /** Turni PS che valgono come compagno dell'MDC (v0.3.45). */
  psAff: AffiancamentoPS;
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
 *                          (deficit materiale: assenze/manuali) — DIMOSTRATO;
 *         "indeterminato"= analisi non conclusa (tempo/tetto nodi): nessun
 *                          verdetto forte (v0.3.37).
 *  nucleo: celle il cui SACRIFICIO sblocca tutto il resto della finestra — il
 *  "vero problema", che può non coincidere con le celle dichiarate scoperte. */
export interface CausaCluster {
  lo: number; hi: number;
  celle: CellaScoperta[];        // buchi M/P/N analizzati nella finestra
  ambGiorni: number[];           // giorni d'ambulatorio SENZA A nella finestra
  esito: "locale" | "vincolo" | "combinazione" | "struttura" | "indeterminato";
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
