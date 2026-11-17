import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniAll } from "../types";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import {
  scriptModulo, etichettaMedico, etichettaGiorno, titoloModulo, leggiTabella, normalizzaGiorno, leggiRisposte,
  inserisciDesiderate, assenzePerGiorno, mergeStatoDesiderate, CODICI_MODULO,
} from "../desiderate";
import { togliInseriti } from "../festiviApp";

// ── v0.3.64: desiderate raccolte con un Modulo Google ─────────────────────────
const med = (id:number, stato:Medico["stato"]="MR", codice=String(100+id)): Medico =>
  ({ id, nome:`Medico ${String.fromCharCode(64+id)}`, codice, stato, obiettivo:25, ambulatorio:false });
const medici = [med(1), med(2), med(3,"MDC"), med(4,"ML",""), med(5,"MPS")];
const anno = 2027, mese = 11;                  // dicembre 2027: 1 = mercoledì, 8 Immacolata, 25 sabato
beforeEach(()=>setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT))));

/** Esegue lo script generato con un Google Modulo simulato e restituisce cosa ha fatto. */
function eseguiScript(src: string) {
  const reg: any = { impostazioni:{}, voci:[], log:[] as string[] };
  const voce = (tipo:string) => { const v: any = { tipo }; const ch = (k:string) => (x:any) => { v[k]=x; return api; }; const api: any = {
    setTitle: ch("titolo"), setHelpText: ch("aiuto"), setChoiceValues: ch("scelte"), setRequired: ch("obbligatoria"), setRows: ch("righe"), setColumns: ch("colonne") };
    reg.voci.push(v); return api; };
  const form: any = {
    setDescription: (d:string)=>{ reg.descrizione = d; }, setConfirmationMessage: (d:string)=>{ reg.conferma = d; },
    setEmailCollectionType: (t:string)=>{ reg.impostazioni.email = t; }, setCollectEmail: ()=>{ throw new Error("vecchia"); },
    setLimitOneResponsePerUser: (b:boolean)=>{ reg.impostazioni.una = b; }, setAllowResponseEdits: (b:boolean)=>{ reg.impostazioni.modifica = b; },
    setShowLinkToRespondAgain: (b:boolean)=>{ reg.impostazioni.ancora = b; }, setPublished: (b:boolean)=>{ reg.impostazioni.pubblicato = b; },
    setAcceptingResponses: (b:boolean)=>{ reg.impostazioni.accetta = b; }, isPublished: ()=>true,
    addListItem: ()=>voce("elenco"), addCheckboxGridItem: ()=>voce("griglia"), addParagraphTextItem: ()=>voce("testo"),
    setDestination: (t:string, id:string)=>{ reg.destinazione = [t, id]; },
    getPublishedUrl: ()=>"https://docs.google.com/forms/x", shortenFormUrl: (u:string)=>u+"/breve", getEditUrl: ()=>"https://docs.google.com/forms/x/edit",
  };
  const FormApp = { create: (t:string)=>{ reg.titolo = t; return form; }, EmailCollectionType:{ VERIFIED:"VERIFIED", DO_NOT_COLLECT:"NO" }, DestinationType:{ SPREADSHEET:"SHEET" } };
  const SpreadsheetApp = { create: (t:string)=>{ reg.foglio = t; return { getId: ()=>"ID1", getUrl: ()=>"https://docs.google.com/spreadsheets/ID1" }; } };
  const Logger = { log: (s:string)=>reg.log.push(s) };
  new Function("FormApp","SpreadsheetApp","Logger", src + "\n;creaModulo();")(FormApp, SpreadsheetApp, Logger);
  return reg;
}

describe("desiderate: lo script del modulo", () => {
  it("crea il modulo con accesso via email, elenco dei medici e griglia a caselle giorni × codici", () => {
    const r = eseguiScript(scriptModulo(anno, mese, medici));
    expect(r.titolo).toBe("Desiderate Dicembre 2027");
    expect(r.impostazioni).toEqual({ email:"VERIFIED", una:true, modifica:true, ancora:false, pubblicato:true, accetta:true });
    const [elenco, griglia, note] = r.voci;
    expect(elenco).toMatchObject({ tipo:"elenco", titolo:"Chi sei?", obbligatoria:true });
    expect(elenco.scelte).toEqual(["Medico A (101)", "Medico B (102)", "Medico C (103)", "Medico D", "Medico E (105)"]);
    expect(griglia).toMatchObject({ tipo:"griglia", titolo:"Desiderate Dicembre 2027", obbligatoria:false, colonne:[...CODICI_MODULO] });
    expect(griglia.righe.length).toBe(31);
    expect(griglia.righe.slice(0,2)).toEqual(["1 mer", "2 gio"]);
    expect(griglia.righe[7]).toBe("8 mer (festivo)");
    expect(griglia.righe[24]).toBe("25 sab (festivo)");
    expect(note).toMatchObject({ tipo:"testo", obbligatoria:false });
    expect(r.destinazione).toEqual(["SHEET", "ID1"]);
    expect(r.descrizione).toMatch(/Xm \+ Xp/);
    expect(r.log.some((l:string)=>/Link da mandare ai colleghi:\s+https:\/\/docs\.google\.com\/forms\/x\/breve/.test(l))).toBe(true);
  });
  it("nomi con apostrofi e virgolette non rompono lo script", () => {
    const strani = [{ ...med(1), nome:"D'Amico \"Gigi\"" }];
    expect(eseguiScript(scriptModulo(2028, 1, strani)).voci[0].scelte).toEqual(["D'Amico \"Gigi\" (101)"]);
    expect(eseguiScript(scriptModulo(2028, 1, strani)).voci[1].righe.length).toBe(29);   // febbraio bisestile
  });
});

// Foglio delle risposte come lo scarica Google (CSV, intestazioni «Titolo [riga]», caselle separate da ", ")
const intest = ["Informazioni cronologiche", "Indirizzo email", "Chi sei?",
  ...Array.from({ length:31 }, (_,i)=>`${titoloModulo(anno,mese)} [${etichettaGiorno(anno,mese,i+1)}]`), "Note (facoltative)"];
const rigaCsv = (quando:string, email:string, chi:string, giorni:Record<number,string>, note="") =>
  [quando, email, chi, ...Array.from({ length:31 }, (_,i)=>giorni[i+1] ?? ""), note];
const csv = (righe:string[][]) => [intest, ...righe].map(r=>r.map(x=>/[",\n]/.test(x) ? `"${x.replace(/"/g,'""')}"` : x).join(",")).join("\r\n");

describe("desiderate: lettura delle risposte", () => {
  it("CSV con virgolette e incollato con tabulazioni danno lo stesso risultato", () => {
    const t = csv([rigaCsv("01/11/2027 10:00:00", "a@x.it", "Medico A (101)", { 3:"L", 10:"Xm, Xp" }, "ciao, grazie")]);
    const tab = leggiTabella(t);
    expect(tab[1][2]).toBe("Medico A (101)");
    expect(tab[1][12]).toBe("Xm, Xp");
    expect(tab[1][34]).toBe("ciao, grazie");
    const tsv = tab.map(r=>r.join("\t")).join("\n");
    expect(leggiTabella(tsv)).toEqual(tab);
  });
  it("sistemazione dei codici di un giorno", () => {
    expect(normalizzaGiorno(["Xm","Xp"])).toEqual({ tipi:["Xm","Xp"], avviso:"" });
    expect(normalizzaGiorno(["Xp","Xm","Xn"]).tipi).toEqual(["X"]);
    expect(normalizzaGiorno(["X","Xm"]).tipi).toEqual(["X"]);
    expect(normalizzaGiorno(["L","Xm"])).toEqual({ tipi:["L"], avviso:"con L le esclusioni (Xm) non servono: inserito solo L" });
    expect(normalizzaGiorno(["L","ANA"]).tipi).toEqual([]);
    expect(normalizzaGiorno(["L","ANA"]).avviso).toMatch(/due licenze/);
  });
  it("riconosce i medici, sistema i codici, segnala doppioni e sconosciuti; l'ultima risposta vince", () => {
    const t = csv([
      rigaCsv("01/11/2027 10:00:00", "a@x.it", "Medico A (101)", { 3:"L", 4:"L", 10:"Xm, Xp", 12:"p11", 13:"a37", 20:"L, Xn" }),
      rigaCsv("01/11/2027 11:00:00", "b@x.it", "Medico B (102)", { 25:"X, Xm", 26:"Xm, Xp, Xn", 31:"L, ANA" }, "vorrei Natale libero"),
      rigaCsv("01/11/2027 12:00:00", "c@x.it", "Medico Z (999)", { 1:"L" }),
      rigaCsv("01/11/2027 13:00:00", "d@x.it", "Medico D", { 7:"104" }),
      rigaCsv("02/11/2027 09:00:00", "a2@x.it", "Medico A (101)", { 5:"L", 6:"QQ, L" }),
    ]);
    const e = leggiRisposte(t, anno, mese, medici);
    expect(e.errore).toBe("");
    expect(e.meseLetto).toEqual({ anno, mese });
    expect(e.risposte.map(r=>r.id)).toEqual([1,2,4]);
    const a = e.risposte[0], b = e.risposte[1], d = e.risposte[2];
    expect(a.email).toBe("a2@x.it");                                      // vince l'ultima riga
    expect(a.giorni).toEqual({ 5:["L"], 6:["L"] });
    expect(a.avvisi).toEqual(["giorno 6: codice QQ sconosciuto, ignorato"]);
    expect(b.giorni).toEqual({ 25:["X"], 26:["X"] });
    expect(b.avvisi[0]).toMatch(/giorno 31: due licenze/);
    expect(b.note).toBe("vorrei Natale libero");
    expect(d.giorni).toEqual({ 7:["104"] });
    expect(e.problemi.some(p=>/Medico Z \(999\).*non riconosciuto/.test(p))).toBe(true);
    expect(e.problemi.some(p=>/Medico A: due risposte \(a@x\.it e a2@x\.it\), vale l'ultima/.test(p))).toBe(true);
    // la prima risposta di A, da sola: codici di app (per11, art37), licenza con esclusione
    const e1 = leggiRisposte(csv([rigaCsv("x","a@x.it","Medico A (101)",{ 12:"p11", 13:"a37", 20:"L, Xn" })]), anno, mese, medici);
    expect(e1.risposte[0].giorni).toEqual({ 12:["per11"], 13:["art37"], 20:["L"] });
  });
  it("riconosce il medico anche se il nome nell'app è cambiato ma la matricola no", () => {
    const rinominato = medici.map(m=>m.id===1 ? { ...m, nome:"Medico Aa" } : m);
    const e = leggiRisposte(csv([rigaCsv("x","a@x.it","Medico A (101)",{ 3:"L" })]), anno, mese, rinominato);
    expect(e.risposte[0].id).toBe(1);
  });
  it("file di un altro mese o non riconosciuto: errore, niente importato", () => {
    expect(leggiRisposte(csv([rigaCsv("x","a@x.it","Medico A (101)",{ 3:"L" })]), anno, 10, medici).errore).toMatch(/sono di Dicembre 2027, non di Novembre 2027/);
    expect(leggiRisposte("a,b,c\n1,2,3", anno, mese, medici).errore).toMatch(/Non sembra il foglio/);
    expect(leggiRisposte("", anno, mese, medici).errore).toMatch(/vuoto/);
  });
});

describe("desiderate: inserimento nel mese", () => {
  const e = leggiRisposte(csv([
    rigaCsv("x","a@x.it","Medico A (101)",{ 3:"L", 10:"Xm, Xp", 25:"L" }),
    rigaCsv("x","b@x.it","Medico B (102)",{ 24:"X", 25:"ANA" }),
  ]), anno, mese, medici);
  const man = (...tipi:string[]) => ({ t: tipi.map(tipo=>({ tipo, sott:false, man:true })) });
  it("come turni manuali, solo nelle celle libere: il piano festivi già inserito resta e il conflitto si segnala", () => {
    const tutti: TurniAll = { "2027-12": { 1: { 25: man("M","P") }, 2: { 24: man("X") } } };   // Natale ad A dal piano; X già messa a B
    const r = inserisciDesiderate(e.risposte, tutti, "2027-12");
    expect(r.blocco).toBe("");
    expect(r.turni[1][3].t).toEqual([{ tipo:"L", sott:false, man:true }]);
    expect(r.turni[1][10].t.map(s=>s.tipo)).toEqual(["Xm","Xp"]);
    expect(r.turni[1][25].t.map(s=>s.tipo)).toEqual(["M","P"]);
    expect(r.saltati).toEqual([
      { id:1, g:25, tipi:["L"], motivo:"cella occupata (M+P)" },
      { id:2, g:24, tipi:["X"], motivo:"già presente" },
    ]);
    expect(r.inseriti).toEqual([{ id:1, g:3, tipi:["L"] }, { id:1, g:10, tipi:["Xm","Xp"] }, { id:2, g:25, tipi:["ANA"] }]);
    expect(tutti["2027-12"][1][3]).toBeUndefined();                       // l'originale non cambia
  });
  it("Sostituisci: via i turni dell'importazione di prima, dentro i nuovi; Togli: il mese torna com'era", () => {
    const r1 = inserisciDesiderate(e.risposte, {}, "2027-12");
    const nuove = leggiRisposte(csv([rigaCsv("x","a@x.it","Medico A (101)",{ 4:"L" })]), anno, mese, medici).risposte;
    const r2 = inserisciDesiderate(nuove, { "2027-12": r1.turni }, "2027-12", r1.inseriti);
    expect(r2.tolti).toBe(5);                                          // A: 3, 10, 25 · B: 24, 25
    expect(Object.keys(r2.turni[1])).toEqual(["4"]);
    expect(Object.keys(r2.turni[2] || {})).toEqual([]);
    const via = togliInseriti(r2.turni, r2.inseriti);
    expect(Object.values(via.turni).every(gi=>Object.keys(gi).length===0)).toBe(true);
  });
  it("in un mese già generato non scrive nulla", () => {
    const gen: TurniAll = { "2027-12": { 3: { 2: { t:[{ tipo:"M", sott:false, man:false }] } } } };
    const r = inserisciDesiderate(e.risposte, gen, "2027-12");
    expect(r.blocco).toMatch(/già stato generato/);
    expect(r.turni).toBe(gen["2027-12"]);
  });
  it("conteggio per giorno e stato salvato", () => {
    const n = assenzePerGiorno(e.risposte, 31);
    expect(n[25]).toEqual({ qualcosa:2, intera:2 });
    expect(n[10]).toEqual({ qualcosa:1, intera:0 });
    const s = mergeStatoDesiderate({ "2027-12": { importato:"x", risposte:e.risposte, problemi:["p"], inseriti:[{ id:1, g:3, tipi:["L"] }] }, boh:{}, "2027-11": { risposte:[{ id:"a" }] } });
    expect(Object.keys(s)).toEqual(["2027-12", "2027-11"]);
    expect(s["2027-12"].risposte).toEqual(e.risposte);
    expect(s["2027-11"]).toEqual({ importato:"", risposte:[], problemi:[], inseriti:null });
    expect(etichettaMedico(med(4,"ML",""))).toBe("Medico D");
  });
});
