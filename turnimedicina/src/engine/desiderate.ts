// ═══════════════════════════════════════════════════════════════════════════
// DESIDERATE (v0.3.64) — licenze, permessi ed esclusioni chieste dai medici
// ═══════════════════════════════════════════════════════════════════════════
// Raccolta con un Modulo Google, un mese alla volta:
//  1) l'app genera lo script Apps Script del modulo (mese, giorni, elenco dei
//     medici): chi organizza lo incolla su script.google.com e lo esegue;
//  2) ogni medico accede con la sua email Google, sceglie il proprio nome
//     dall'elenco (tutti i medici dell'app) e segna i giorni in una griglia a
//     caselle con tutto il mese su una riga, come nel calendario (v0.3.65):
//     una riga per voce (L, ANA, 104, p11, a37 e le esclusioni a parole:
//     Libero, No mattina, No pomeriggio, No notte), una colonna per giorno.
//     Vede e può modificare solo la propria risposta; le risposte le vede
//     solo chi ha creato il modulo;
//  3) chi organizza scarica le risposte dal foglio (CSV, o copia e incolla) e
//     le importa nella sezione Desiderate, che le inserisce nel mese come turni
//     MANUALI: solo nelle celle libere, saltando e segnalando le altre.
// Logica pura: niente localStorage, niente rete.
import type { Medico, TurniAll, TurniMese } from "./types";
import { MESI, dimOf, dowOf, isFestivo, isHol } from "./date";
import { LICENZE } from "./turni";
import { getRegole } from "./regole";
import { festiviPianoDefault, festivitaAnno, iso } from "./pianoFestivi";
import { togliInseriti, meseGenerato, type TurnoInserito } from "./festiviApp";

/** Righe della griglia del modulo, nell'ordine. Le licenze compaiono col
 *  loro codice (p11 e a37 sono le etichette brevi dell'app per per11 e art37);
 *  le esclusioni a parole, perché il medico capisca cosa sceglie. */
export const CODICI_MODULO = ["L", "ANA", "104", "p11", "a37", "Libero", "No mattina", "No pomeriggio", "No notte"] as const;
/** Etichetta del modulo → codice dell'app (confronto in minuscolo). Valgono
 *  anche i codici dell'app (X, Xm…), per i fogli preparati a mano. */
const DA_MODULO: Record<string, string> = {
  l: "L", ana: "ANA", "104": "104", p11: "per11", a37: "art37",
  libero: "X", "no mattina": "Xm", "no pomeriggio": "Xp", "no notte": "Xn",
  x: "X", xm: "Xm", xp: "Xp", xn: "Xn", per11: "per11", art37: "art37",
};
const codiceApp = (v: string) => Object.prototype.hasOwnProperty.call(DA_MODULO, v.toLowerCase()) ? DA_MODULO[v.toLowerCase()] : undefined;
/** Ordine fisso dei codici di un giorno (quello delle voci del modulo), così
 *  il foglio di oggi e quello della v0.3.64 danno lo stesso risultato. */
const ORDINE: string[] = CODICI_MODULO.map(v => DA_MODULO[v.toLowerCase()]);
const SIGNIFICATO: Record<string, string> = {
  L: "licenza (ferie)", ANA: "permesso", "104": "legge 104", p11: "art. 11", a37: "art. 37",
  Libero: "non lavoro tutto il giorno", "No mattina": "non lavoro di mattina", "No pomeriggio": "non lavoro di pomeriggio", "No notte": "non lavoro di notte",
};
const GG = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];

/** Come compare il medico nell'elenco del modulo: nome e matricola. */
export const etichettaMedico = (m: Medico) => m.codice ? `${m.nome} (${m.codice})` : m.nome;
/** Colonna della griglia per il giorno g (v0.3.65): "1 mer", "4 sab 🔵",
 *  "5 dom 🔴", "8 mer 🔴". Nel modulo non ci sono colori: i pallini dicono
 *  domeniche e festivi (rosso) e sabati (blu). */
export const etichettaGiorno = (anno: number, mese: number, g: number) => {
  const d = dowOf(anno, mese, g);
  return `${g} ${GG[d]}${isFestivo(anno, mese, g) ? " 🔴" : d === 5 ? " 🔵" : ""}`;
};
export const titoloModulo = (anno: number, mese: number) => `Desiderate ${MESI[mese]} ${anno}`;
/** Festività del mese col nome (nazionali, Pasqua e locali del reparto), per
 *  la riga sopra la griglia. Il nome perde la parte fra parentesi. */
export function festiviDelMese(anno: number, mese: number): { g: number; nome: string }[] {
  const nomi = new Map<string, string>();
  for (const f of festivitaAnno(festiviPianoDefault(getRegole().reparto.festiviLocali), anno))
    if (!f.soloGiorno && !nomi.has(f.date)) nomi.set(f.date, f.name.replace(/\s*\([^()]*\)\s*$/, "") || f.name);
  const out: { g: number; nome: string }[] = [];
  for (let g = 1; g <= dimOf(anno, mese); g++) {
    const nome = nomi.get(iso(anno, mese + 1, g));
    if (nome || isHol(anno, mese, g)) out.push({ g, nome: nome || "festivo" });
  }
  return out;
}

// ── 1) LO SCRIPT DEL MODULO ──────────────────────────────────────────────────
/** Testo dello script Apps Script che crea modulo e foglio delle risposte. */
export function scriptModulo(anno: number, mese: number, medici: Medico[]): string {
  const nd = dimOf(anno, mese);
  const titolo = titoloModulo(anno, mese);
  const giorni = Array.from({ length: nd }, (_, i) => etichettaGiorno(anno, mese, i + 1));
  const fest = festiviDelMese(anno, mese);
  const aiuto = fest.length ? `Festivi: ${fest.map(f => `${f.nome} (${f.g})`).join(", ")} · scorri di lato →` : "Scorri di lato per vedere tutti i giorni →";
  const J = (v: unknown) => JSON.stringify(v);
  const legenda = CODICI_MODULO.map(c => `• ${c} = ${SIGNIFICATO[c]}`).join("\\n");
  return `/**
 * ${titolo} — creato da TurniMedicina.
 *
 * Crea in automatico:
 *  1) il Google Modulo "${titolo}": ogni medico accede con la sua email Google,
 *     sceglie il proprio nome e segna i giorni di licenza, permesso o esclusione;
 *  2) un Google Foglio collegato con le risposte.
 *
 * COME USARLO
 *  1. Apri https://script.google.com → "Nuovo progetto"
 *  2. Cancella il testo che c'è, incolla TUTTO questo script, premi l'icona del dischetto (Salva)
 *  3. In alto scegli la funzione "creaModulo" e premi "Esegui"
 *  4. Concedi i permessi (Avanzate → Vai a … (non sicuro) → Consenti)
 *  5. In basso, nel "Registro di esecuzione", trovi i link del modulo e del foglio
 *
 * QUANDO TUTTI HANNO RISPOSTO
 *  - Nel modulo, scheda "Risposte": spegni "Accetta risposte".
 *  - Nel foglio delle risposte: File → Scarica → Valori separati da virgola (.csv),
 *    poi nell'app, sezione Desiderate, "Importa risposte".
 */

const TITOLO = ${J(titolo)};
const MEDICI = ${J(medici.map(etichettaMedico))};
// la griglia: tutto il mese su una riga, come nel calendario
const MESE = ${J(`${MESI[mese]} ${anno}`)};
const VOCI = ${J(CODICI_MODULO)};
const GIORNI = ${J(giorni)};
const AIUTO = ${J(aiuto)};

function creaModulo() {
  // ---------- 1) IL MODULO ----------
  const form = FormApp.create(TITOLO);
  form.setDescription(
    'Segna i giorni di ${MESI[mese].toLowerCase()} ${anno} in cui chiedi una licenza, un permesso o di non lavorare.\\n\\n' +
    'COME FARE\\n' +
    '1. Accedi con il tuo account Google (è obbligatorio).\\n' +
    '2. Scegli il TUO nome dall\\'elenco.\\n' +
    '3. Nella griglia ogni riga è una voce e ogni colonna un giorno: spunta i giorni che ti servono. I giorni senza spunte restano liberi.\\n' +
    'I giorni sono tutti su una riga, come nel calendario: scorri di lato (col telefono girato se ne vedono di più). 🔴 domeniche e festivi · 🔵 sabati\\n\\n' +
    'CODICI\\n${legenda}\\n\\n' +
    'Puoi spuntare più voci «No» nello stesso giorno: No mattina + No pomeriggio = lavoro solo di notte. ' +
    'Una licenza o un permesso valgono già tutto il giorno: non serve spuntare altro.\\n\\n' +
    'Le desiderate entrano nei turni come vincoli. ' +
    'Le risposte le vede solo chi organizza i turni; fino alla chiusura puoi riaprire il link e modificare la tua.'
  );
  form.setConfirmationMessage('Grazie! Fino alla chiusura puoi riaprire il link e modificare la tua risposta.');

  safe(function () {
    if (FormApp.EmailCollectionType && form.setEmailCollectionType) {
      form.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED);
    } else {
      form.setCollectEmail(true);
    }
  }, 'accesso con email', 'in Impostazioni → Risposte scegli «Raccogli indirizzi email: Verificati»');
  safe(function () { form.setLimitOneResponsePerUser(true); }, 'una risposta per persona');
  safe(function () { form.setAllowResponseEdits(true); }, 'modifica delle risposte');
  safe(function () { form.setShowLinkToRespondAgain(false); }, 'link per rispondere di nuovo');

  form.addListItem()
    .setTitle('Chi sei?')
    .setHelpText('Scegli il tuo nome: inserisci solo le tue desiderate.')
    .setChoiceValues(MEDICI)
    .setRequired(true);

  form.addCheckboxGridItem()
    .setTitle(MESE)
    .setHelpText(AIUTO)
    .setRows(VOCI)
    .setColumns(GIORNI)
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('Note (facoltative)')
    .setRequired(false);

  // i moduli creati da script possono nascere "non pubblicati": lo pubblico subito
  safe(function () { form.setPublished(true); }, 'pubblicazione del modulo',
       'apri il modulo e premi «Pubblica» in alto a destra');
  safe(function () { form.setAcceptingResponses(true); }, 'accettazione delle risposte');

  // ---------- 2) IL FOGLIO DELLE RISPOSTE ----------
  const ss = SpreadsheetApp.create(TITOLO + ' — risposte');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  // ---------- 3) I LINK ----------
  let link = form.getPublishedUrl();
  try { link = form.shortenFormUrl(link); } catch (e) {}
  try {
    if (form.isPublished && !form.isPublished())
      Logger.log('⚠ Il modulo non risulta pubblicato: aprilo e premi «Pubblica» in alto a destra, altrimenti il link non accetta risposte.');
  } catch (e) {}
  Logger.log('✅ FATTO!');
  Logger.log('Link da mandare ai colleghi:  ' + link);
  Logger.log('Link per modificare il modulo: ' + form.getEditUrl());
  Logger.log('Foglio delle risposte: ' + ss.getUrl());
}

function safe(fn, cosa, comeFare) {
  try { fn(); }
  catch (e) {
    Logger.log('⚠ Impostazione non applicata (' + cosa + '): ' +
               (comeFare || 'attivala a mano in Impostazioni → Risposte del modulo') + '.');
  }
}
`;
}

// ── 2) LETTURA DELLE RISPOSTE ────────────────────────────────────────────────
/** Testo CSV (virgole, campi fra virgolette) o incollato dal foglio (tabulazioni) → righe. */
export function leggiTabella(testo: string): string[][] {
  const t = testo.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const prima = t.split("\n", 1)[0] || "";
  const sep = prima.includes("\t") ? "\t" : prima.split(";").length > prima.split(",").length ? ";" : ",";
  const righe: string[][] = []; let riga: string[] = [], campo = "", virg = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (virg) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else virg = false; }
      else campo += c;
    } else if (c === '"' && campo === "") virg = true;
    else if (c === sep) { riga.push(campo); campo = ""; }
    else if (c === "\n") { riga.push(campo); righe.push(riga); riga = []; campo = ""; }
    else campo += c;
  }
  if (campo !== "" || riga.length) { riga.push(campo); righe.push(riga); }
  return righe.filter(r => r.some(x => x.trim() !== ""));
}

/** Codici di un giorno → codici da scrivere nella cella (stessi nomi dell'app). */
export function normalizzaGiorno(codici: string[]): { tipi: string[]; avviso: string } {
  const lic = codici.filter(c => LICENZE.includes(c));
  const esc = codici.filter(c => ["X", "Xm", "Xp", "Xn"].includes(c));
  if (lic.length > 1) return { tipi: [], avviso: `due licenze o permessi nello stesso giorno (${lic.join(" e ")}): giorno non inserito` };
  if (lic.length === 1) return { tipi: lic, avviso: esc.length ? `con ${lic[0]} le esclusioni (${esc.join("+")}) non servono: inserito solo ${lic[0]}` : "" };
  if (esc.includes("X")) return { tipi: ["X"], avviso: "" };
  const parz = ["Xm", "Xp", "Xn"].filter(c => esc.includes(c));
  return { tipi: parz.length === 3 ? ["X"] : parz, avviso: "" };   // Xm+Xp+Xn = X, come nella finestra della cella
}

export interface RispostaDes {
  id: number;
  email: string;
  quando: string;
  /** giorno → codici da inserire (già sistemati). */
  giorni: Record<number, string[]>;
  note: string;
  /** Avvisi sui singoli giorni (codici sistemati o scartati). */
  avvisi: string[];
}
export interface EsitoLettura {
  /** Mese scritto nel titolo della griglia (null se non trovato). */
  meseLetto: { anno: number; mese: number } | null;
  risposte: RispostaDes[];
  /** Problemi che non bloccano la lettura (medico non riconosciuto, doppioni…). */
  problemi: string[];
  /** Errore che blocca: file non riconosciuto o di un altro mese. */
  errore: string;
}

/** Legge le risposte del modulo per il mese (anno, mese 0-11). */
export function leggiRisposte(testo: string, anno: number, mese: number, medici: Medico[]): EsitoLettura {
  const esito: EsitoLettura = { meseLetto: null, risposte: [], problemi: [], errore: "" };
  const tab = leggiTabella(testo);
  if (tab.length < 1) { esito.errore = "Il file è vuoto."; return esito; }
  const intest = tab[0].map(h => h.trim());
  const col = (re: RegExp) => intest.findIndex(h => re.test(h));
  const cChi = col(/^chi sei/i), cEmail = col(/e-?mail/i), cNote = col(/^note/i), cQuando = col(/cronolog|timestamp|data e ora|^data$/i);
  // Le intestazioni della griglia sono «Titolo [riga]». Due formati:
  //  - dalla v0.3.65 una riga per voce: «Dicembre 2026 [No mattina]», con i
  //    giorni spuntati nella cella ("1 mar, 5 sab 🔵");
  //  - moduli della v0.3.64 una riga per giorno: «Desiderate Dicembre 2026
  //    [1 mar]», con le voci spuntate nella cella ("L, No notte").
  const vociCol: { c: number; voce: string; codice: string }[] = [];
  const giorniCol: { c: number; g: number }[] = [];
  const reMese = new RegExp(`(${MESI.join("|")})\\s+(\\d{4})`, "i");
  intest.forEach((h, c) => {
    const dentro = c === cChi ? undefined : /\[([^\]]*)\]\s*$/.exec(h)?.[1].trim();
    if (dentro) {
      const codice = codiceApp(dentro), g = /^(\d{1,2})\b/.exec(dentro);
      if (codice) vociCol.push({ c, voce: dentro, codice });
      else if (g) giorniCol.push({ c, g: +g[1] });
    }
    const mm = reMese.exec(h);
    if (mm && !esito.meseLetto) esito.meseLetto = { anno: +mm[2], mese: MESI.findIndex(x => x.toLowerCase() === mm[1].toLowerCase()) };
  });
  if (cChi < 0 || (!giorniCol.length && !vociCol.length)) { esito.errore = "Non sembra il foglio delle risposte del modulo Desiderate: mancano la domanda «Chi sei?» o la griglia dei giorni."; return esito; }
  if (esito.meseLetto && (esito.meseLetto.anno !== anno || esito.meseLetto.mese !== mese)) {
    esito.errore = `Queste risposte sono di ${MESI[esito.meseLetto.mese]} ${esito.meseLetto.anno}, non di ${MESI[mese]} ${anno}: scegli il mese giusto.`;
    return esito;
  }
  const nd = dimOf(anno, mese);
  const perEtichetta = new Map(medici.map(m => [etichettaMedico(m).toLowerCase(), m]));
  const trova = (v: string): Medico | undefined => {
    const s = v.trim().toLowerCase(); if (!s) return undefined;
    const esatto = perEtichetta.get(s); if (esatto) return esatto;
    const matr = /\(([^()]+)\)\s*$/.exec(s)?.[1]?.trim();
    if (matr) { const m = medici.find(x => x.codice && x.codice.toLowerCase() === matr); if (m) return m; }
    const nome = s.replace(/\s*\([^()]*\)\s*$/, "");
    return medici.find(x => x.nome.toLowerCase() === nome);
  };
  const viste = new Map<number, RispostaDes>();
  for (const riga of tab.slice(1)) {
    const cella = (c: number) => (c >= 0 && c < riga.length ? riga[c] : "").trim();
    const email = cella(cEmail), chi = cella(cChi);
    const m = trova(chi);
    if (!m) { esito.problemi.push(`Risposta${email ? " di " + email : ""}: medico «${chi || "(vuoto)"}» non riconosciuto, non importata.`); continue; }
    const r: RispostaDes = { id: m.id, email, quando: cella(cQuando), giorni: {}, note: cella(cNote), avvisi: [] };
    const valori = (c: number) => cella(c).split(/\s*[,;]\s*/).map(x => x.trim()).filter(Boolean);
    const codici: Record<number, string[]> = {}, ignoti: Record<number, string[]> = {};
    const metti = (g: number, cod: string) => { const v = (codici[g] ||= []); if (!v.includes(cod)) v.push(cod); };
    for (const { c, g } of giorniCol) {                       // formato 0.3.64: le voci di un giorno
      if (g < 1 || g > nd) continue;
      for (const x of valori(c)) { const cod = codiceApp(x); if (cod) metti(g, cod); else (ignoti[g] ||= []).push(x); }
    }
    for (const { c, voce, codice } of vociCol)                // formato 0.3.65: i giorni di una voce
      for (const x of valori(c)) {
        const g = +(/^(\d{1,2})\b/.exec(x)?.[1] ?? 0);
        if (g >= 1 && g <= nd) metti(g, codice);
        else r.avvisi.push(`${voce}: giorno «${x}» non riconosciuto, ignorato`);
      }
    for (const g of [...new Set([...Object.keys(codici), ...Object.keys(ignoti)].map(Number))].sort((a, b) => a - b)) {
      if (ignoti[g]) r.avvisi.push(`giorno ${g}: codice ${ignoti[g].join(", ")} sconosciuto, ignorato`);
      const n = normalizzaGiorno((codici[g] || []).sort((a, b) => ORDINE.indexOf(a) - ORDINE.indexOf(b)));
      if (n.avviso) r.avvisi.push(`giorno ${g}: ${n.avviso}`);
      if (n.tipi.length) r.giorni[g] = n.tipi;
    }
    const prima = viste.get(m.id);
    if (prima) esito.problemi.push(`${m.nome}: due risposte (${prima.email || "senza email"} e ${email || "senza email"}), vale l'ultima.`);
    viste.set(m.id, r);                                     // l'ultima riga del foglio vince
  }
  esito.risposte = medici.map(m => viste.get(m.id)).filter((r): r is RispostaDes => !!r);
  return esito;
}

// ── 3) DAI MODULI AL MESE ────────────────────────────────────────────────────
export interface SaltatoDes { id: number; g: number; tipi: string[]; motivo: string }
export interface EsitoInserimentoDes { blocco: string; turni: TurniMese; inseriti: TurnoInserito[]; saltati: SaltatoDes[]; tolti: number }

/** Scrive le desiderate nel mese come turni manuali, solo nelle celle libere.
 *  `prec`: turni scritti da un'importazione precedente dello stesso mese, che
 *  vengono tolti prima (Sostituisci). Non modifica `turniAll`. */
export function inserisciDesiderate(risposte: RispostaDes[], turniAll: TurniAll, chiave: string, prec: TurnoInserito[] = []): EsitoInserimentoDes {
  const base = togliInseriti(turniAll[chiave], prec);
  if (meseGenerato(base.turni))
    return { blocco: "Il mese è già stato generato: le desiderate entrano solo nei mesi nuovi. Togli prima i turni dell'app (Rimuovi App) oppure inseriscile a mano.", turni: turniAll[chiave] || {}, inseriti: [], saltati: [], tolti: 0 };
  const T = base.turni;
  const out: EsitoInserimentoDes = { blocco: "", turni: T, inseriti: [], saltati: [], tolti: base.tolti };
  for (const r of risposte) for (const [gS, tipi] of Object.entries(r.giorni)) {
    const g = +gS, c = T[r.id]?.[g]?.t || [];
    if (c.length) {
      const uguale = c.length === tipi.length && tipi.every(t => c.some(s => s.tipo === t));
      out.saltati.push({ id: r.id, g, tipi, motivo: uguale ? "già presente" : "cella occupata (" + c.map(s => s.tipo).join("+") + ")" });
      continue;
    }
    ((T[r.id] ||= {})[g] = { t: tipi.map(tipo => ({ tipo, sott: false, man: true })) });
    out.inseriti.push({ id: r.id, g, tipi: [...tipi] });
  }
  return out;
}

/** Per giorno: quanti medici chiedono qualcosa e quanti tutto il giorno (licenza o X). */
export function assenzePerGiorno(risposte: RispostaDes[], nd: number): { qualcosa: number; intera: number }[] {
  const out = Array.from({ length: nd + 1 }, () => ({ qualcosa: 0, intera: 0 }));
  for (const r of risposte) for (const [gS, tipi] of Object.entries(r.giorni)) {
    const g = +gS; if (g < 1 || g > nd) continue;
    out[g].qualcosa++;
    if (tipi.some(t => t === "X" || LICENZE.includes(t))) out[g].intera++;
  }
  return out;
}

// ── STATO SALVATO (solo su questo dispositivo: contiene le email) ─────────────
export interface MeseDesiderate {
  importato: string;                 // data e ora dell'importazione
  risposte: RispostaDes[];
  problemi: string[];
  /** Turni scritti nel mese dall'ultimo inserimento (per Sostituisci e Togli). */
  inseriti: TurnoInserito[] | null;
}
export type StatoDesiderate = Record<string, MeseDesiderate>;

export function mergeStatoDesiderate(x: unknown): StatoDesiderate {
  const out: StatoDesiderate = {};
  if (!x || typeof x !== "object") return out;
  const str = (v: unknown) => typeof v === "string" ? v : "";
  for (const [k, v] of Object.entries(x)) {
    if (!/^\d{4}-\d\d$/.test(k) || !v || typeof v !== "object") continue;
    const m = v as Partial<MeseDesiderate>;
    const risposte: RispostaDes[] = (Array.isArray(m.risposte) ? m.risposte : []).filter(r => r && Number.isInteger(r.id)).map(r => {
      const giorni: Record<number, string[]> = {};
      for (const [g, t] of Object.entries(r.giorni || {})) if (Number.isInteger(+g) && Array.isArray(t)) giorni[+g] = t.filter(c => typeof c === "string");
      return { id: r.id, email: str(r.email), quando: str(r.quando), giorni, note: str(r.note), avvisi: Array.isArray(r.avvisi) ? r.avvisi.filter(a => typeof a === "string") : [] };
    });
    const inseriti = Array.isArray(m.inseriti)
      ? m.inseriti.filter(t => t && Number.isInteger(t.id) && Number.isInteger(t.g) && Array.isArray(t.tipi)).map(t => ({ id: t.id, g: t.g, tipi: t.tipi.filter(c => typeof c === "string") }))
      : null;
    out[k] = { importato: str(m.importato), risposte, problemi: Array.isArray(m.problemi) ? m.problemi.filter(p => typeof p === "string") : [], inseriti };
  }
  return out;
}
