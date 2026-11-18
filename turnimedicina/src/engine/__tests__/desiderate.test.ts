import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniAll } from "../types";
import { setRegole, REGOLE_DEFAULT } from "../regole";
import { MESI, dowOf, isHol } from "../date";
import {
  scriptModulo, etichettaMedico, etichettaGiorno, titoloModulo, festiviDelMese, leggiTabella, normalizzaGiorno, leggiRisposte,
  inserisciDesiderate, assenzePerGiorno, mergeStatoDesiderate, CODICI_MODULO,
} from "../desiderate";
import { togliInseriti } from "../festiviApp";

// ── v0.3.64: desiderate raccolte con un Modulo Google ─────────────────────────
// ── v0.3.65: nel modulo tutto il mese su una riga (una riga per voce, una colonna per giorno)
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
  it("crea il modulo con accesso via email, elenco dei medici e griglia voci × giorni, tutto il mese su una riga", () => {
    const r = eseguiScript(scriptModulo(anno, mese, medici));
    expect(r.titolo).toBe("Desiderate Dicembre 2027");
    expect(r.impostazioni).toEqual({ email:"VERIFIED", una:true, modifica:true, ancora:false, pubblicato:true, accetta:true });
    expect(r.voci.length).toBe(3);
    const [elenco, griglia, note] = r.voci;
    expect(elenco).toMatchObject({ tipo:"elenco", titolo:"Chi sei?", obbligatoria:true });
    expect(elenco.scelte).toEqual(["Medico A (101)", "Medico B (102)", "Medico C (103)", "Medico D", "Medico E (105)"]);
    expect(griglia).toMatchObject({ tipo:"griglia", titolo:"Dicembre 2027", obbligatoria:false });
    expect(griglia.righe).toEqual(["L","ANA","104","p11","a37","Libero","No mattina","No pomeriggio","No notte"]);
    expect(griglia.righe).toEqual([...CODICI_MODULO]);
    expect(griglia.colonne.length).toBe(31);
    expect(griglia.colonne.slice(0,6)).toEqual(["1 mer", "2 gio", "3 ven", "4 sab 🔵", "5 dom 🔴", "6 lun"]);
    expect(griglia.colonne[7]).toBe("8 mer 🔴");                                     // Immacolata
    expect(griglia.colonne.slice(23,27)).toEqual(["24 ven", "25 sab 🔴", "26 dom 🔴", "27 lun"]);   // Natale di sabato: rosso
    expect(griglia.aiuto).toBe("Festivi: Immacolata (8), Natale (25), Santo Stefano (26) · scorri di lato →");
    expect(note).toMatchObject({ tipo:"testo", obbligatoria:false });
    expect(r.destinazione).toEqual(["SHEET", "ID1"]);
    expect(r.descrizione).toMatch(/No mattina \+ No pomeriggio/);
    expect(r.descrizione).toMatch(/ogni riga è una voce e ogni colonna un giorno/);
    expect(r.descrizione).toMatch(/tutti su una riga, come nel calendario: scorri di lato/);
    expect(r.descrizione).toMatch(/🔴 domeniche e festivi · 🔵 sabati/);
    expect(r.log.some((l:string)=>/Link da mandare ai colleghi:\s+https:\/\/docs\.google\.com\/forms\/x\/breve/.test(l))).toBe(true);
  });
  it("nomi con apostrofi e virgolette non rompono lo script", () => {
    const strani = [{ ...med(1), nome:"D'Amico \"Gigi\"" }];
    const r = eseguiScript(scriptModulo(2028, 1, strani));
    expect(r.voci[0].scelte).toEqual(["D'Amico \"Gigi\" (101)"]);
    expect(r.voci[1].colonne.length).toBe(29);                                     // febbraio bisestile
    expect(r.voci[1].aiuto).toBe("Scorri di lato per vedere tutti i giorni →");    // nessun festivo
  });
  it("sopra la griglia i festivi del mese col nome: Pasqua e Pasquetta, la festa locale del reparto", () => {
    expect(festiviDelMese(2028, 3)).toEqual([{ g:16, nome:"Pasqua" }, { g:17, nome:"Lunedì dell'Angelo" }, { g:25, nome:"Liberazione" }]);
    // la patrona (Regole → Reparto): il nome perde la parte fra parentesi, l'apostrofo non rompe lo script
    const r = eseguiScript(scriptModulo(2027, 8, medici));
    expect(r.voci[1].aiuto).toBe("Festivi: Madonna dell'Olmo (8) · scorri di lato →");
    expect(r.voci[1].colonne[7]).toBe("8 mer 🔴");
    // tolta la festa locale dalle Regole, l'8 settembre è un mercoledì qualsiasi
    setRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), reparto: { ...REGOLE_DEFAULT.reparto, festiviLocali: [] } });
    expect(festiviDelMese(2027, 8)).toEqual([]);
    expect(etichettaGiorno(2027, 8, 8)).toBe("8 mer");
  });
});

// Foglio delle risposte come lo scarica Google: CSV, intestazioni «Titolo [riga]», caselle spuntate separate da ", ".
// Le desiderate di prova si scrivono giorno per giorno ({ 10:"No mattina, No pomeriggio" }) e diventano il foglio
// del modulo di oggi (una colonna per voce, coi giorni spuntati) o di quello della v0.3.64 (una colonna per giorno, con le voci).
type Formato = "nuovo" | "0.3.64";
interface Risp { quando?:string; email:string; chi:string; giorni:Record<number,string>; note?:string }
const GIORNI = Array.from({ length:31 }, (_,i)=>i+1);
const etichetta064 = (g:number) => `${g} ${["lun","mar","mer","gio","ven","sab","dom"][dowOf(anno,mese,g)]}${isHol(anno,mese,g) ? " (festivo)" : ""}`;
const vociDi = (s?:string) => (s ?? "").split(",").map(x=>x.trim()).filter(Boolean);
function csv(risposte: Risp[], f: Formato = "nuovo"): string {
  const intest = ["Informazioni cronologiche", "Indirizzo email", "Chi sei?",
    ...(f === "nuovo" ? CODICI_MODULO.map(v=>`${MESI[mese]} ${anno} [${v}]`) : GIORNI.map(g=>`${titoloModulo(anno,mese)} [${etichetta064(g)}]`)),
    "Note (facoltative)"];
  const righe = risposte.map(r => [r.quando ?? "x", r.email, r.chi,
    ...(f === "nuovo" ? CODICI_MODULO.map(v=>GIORNI.filter(g=>vociDi(r.giorni[g]).includes(v)).map(g=>etichettaGiorno(anno,mese,g)).join(", "))
                      : GIORNI.map(g=>r.giorni[g] ?? "")),
    r.note ?? ""]);
  return [intest, ...righe].map(r=>r.map(x=>/[",\n]/.test(x) ? `"${x.replace(/"/g,'""')}"` : x).join(",")).join("\r\n");
}
const FORMATI: Formato[] = ["nuovo", "0.3.64"];
const scenario: Risp[] = [
  { quando:"01/11/2027 10:00:00", email:"a@x.it", chi:"Medico A (101)", giorni:{ 3:"L", 4:"L", 10:"No mattina, No pomeriggio", 12:"p11", 13:"a37", 20:"L, No notte" } },
  { quando:"01/11/2027 11:00:00", email:"b@x.it", chi:"Medico B (102)", giorni:{ 25:"No mattina, Libero", 26:"No notte, No mattina, No pomeriggio", 31:"ANA, L" }, note:"vorrei Natale libero" },
  { quando:"01/11/2027 12:00:00", email:"c@x.it", chi:"Medico Z (999)", giorni:{ 1:"L" } },
  { quando:"01/11/2027 13:00:00", email:"d@x.it", chi:"Medico D", giorni:{ 7:"104" } },
  { quando:"02/11/2027 09:00:00", email:"a2@x.it", chi:"Medico A (101)", giorni:{ 5:"L", 6:"ANA" } },
];

describe("desiderate: lettura delle risposte", () => {
  it("CSV con virgolette e incollato con tabulazioni danno lo stesso risultato", () => {
    const tab = leggiTabella(csv([{ quando:"01/11/2027 10:00:00", email:"a@x.it", chi:"Medico A (101)", giorni:{ 3:"L", 4:"L", 10:"No mattina, No pomeriggio" }, note:"ciao, grazie" }]));
    expect(tab[0][3]).toBe("Dicembre 2027 [L]");
    expect(tab[1][2]).toBe("Medico A (101)");
    expect(tab[1][3]).toBe("3 ven, 4 sab 🔵");
    expect(tab[1][9]).toBe("10 ven");                                               // No mattina
    expect(tab[1][12]).toBe("ciao, grazie");
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
  it.each(FORMATI)("foglio %s: riconosce i medici, sistema i codici, segnala i doppioni; l'ultima risposta vince", (f) => {
    const e = leggiRisposte(csv(scenario, f), anno, mese, medici);
    expect(e.errore).toBe("");
    expect(e.meseLetto).toEqual({ anno, mese });
    expect(e.risposte.map(r=>r.id)).toEqual([1,2,4]);
    const [a, b, d] = e.risposte;
    expect(a.email).toBe("a2@x.it");                                               // vince l'ultima riga
    expect(a.giorni).toEqual({ 5:["L"], 6:["ANA"] });
    expect(a.avvisi).toEqual([]);
    expect(b.giorni).toEqual({ 25:["X"], 26:["X"] });
    expect(b.avvisi).toEqual(["giorno 31: due licenze o permessi nello stesso giorno (L e ANA): giorno non inserito"]);
    expect(b.note).toBe("vorrei Natale libero");
    expect(d.giorni).toEqual({ 7:["104"] });
    expect(e.problemi.some(p=>/Medico Z \(999\).*non riconosciuto/.test(p))).toBe(true);
    expect(e.problemi.some(p=>/Medico A: due risposte \(a@x\.it e a2@x\.it\), vale l'ultima/.test(p))).toBe(true);
    // la prima risposta di A, da sola: p11 e a37 diventano per11 e art37, la licenza assorbe l'esclusione
    const e1 = leggiRisposte(csv([scenario[0]], f), anno, mese, medici);
    expect(e1.risposte[0].giorni).toEqual({ 3:["L"], 4:["L"], 10:["Xm","Xp"], 12:["per11"], 13:["art37"], 20:["L"] });
    expect(e1.risposte[0].avvisi).toEqual(["giorno 20: con L le esclusioni (Xn) non servono: inserito solo L"]);
  });
  it("i due fogli (modulo di oggi e della v0.3.64) danno esattamente lo stesso risultato, anche coi codici scritti in un altro ordine", () => {
    expect(leggiRisposte(csv(scenario, "nuovo"), anno, mese, medici)).toEqual(leggiRisposte(csv(scenario, "0.3.64"), anno, mese, medici));
  });
  it("foglio 0.3.64: codici sconosciuti segnalati; vanno bene anche i codici dell'app (fogli preparati a mano)", () => {
    const e = leggiRisposte(csv([{ email:"a@x.it", chi:"Medico A (101)", giorni:{ 3:"Xm, Xp", 4:"X", 5:"L", 6:"QQ, L" } }], "0.3.64"), anno, mese, medici);
    expect(e.risposte[0].giorni).toEqual({ 3:["Xm","Xp"], 4:["X"], 5:["L"], 6:["L"] });
    expect(e.risposte[0].avvisi).toEqual(["giorno 6: codice QQ sconosciuto, ignorato"]);
  });
  it("foglio di oggi: un giorno illeggibile si segnala; vanno bene anche colonne coi codici dell'app", () => {
    const t = ["Chi sei?,Dicembre 2027 [L],Dicembre 2027 [Xm],Dicembre 2027 [Xp]", 'Medico A (101),"3 ven, boh, 40",10 ven,"10 ven, 11 sab 🔵"'].join("\n");
    const e = leggiRisposte(t, anno, mese, medici);
    expect(e.errore).toBe("");
    expect(e.risposte[0].giorni).toEqual({ 3:["L"], 10:["Xm","Xp"], 11:["Xp"] });
    expect(e.risposte[0].avvisi).toEqual(["L: giorno «boh» non riconosciuto, ignorato", "L: giorno «40» non riconosciuto, ignorato"]);
  });
  it("dal modulo creato dallo script al foglio delle risposte, e di nuovo nell'app", () => {
    const g = eseguiScript(scriptModulo(anno, mese, medici)).voci[1];
    // come fa Google: una colonna per riga della griglia, «Titolo [riga]»; nella cella le colonne spuntate, separate da ", "
    const spunte: Record<string, number[]> = { "L":[24], "a37":[8], "Libero":[31], "No mattina":[2, 9], "No pomeriggio":[2] };
    const testa = ["Informazioni cronologiche", "Indirizzo email", "Chi sei?", ...g.righe.map((v:string)=>`${g.titolo} [${v}]`), "Note (facoltative)"];
    const riga = ["x", "c@x.it", "Medico C (103)", ...g.righe.map((v:string)=>(spunte[v] || []).map(n=>g.colonne[n-1]).join(", ")), ""];
    const e = leggiRisposte([testa, riga].map(r=>r.map(x=>x.includes(",") ? `"${x}"` : x).join(",")).join("\n"), anno, mese, medici);
    expect(e.errore).toBe("");
    expect(e.risposte).toHaveLength(1);
    expect(e.risposte[0]).toMatchObject({ id:3, email:"c@x.it", giorni:{ 2:["Xm","Xp"], 8:["art37"], 9:["Xm"], 24:["L"], 31:["X"] }, avvisi:[] });
  });
  it("riconosce il medico anche se il nome nell'app è cambiato ma la matricola no", () => {
    const rinominato = medici.map(m=>m.id===1 ? { ...m, nome:"Medico Aa" } : m);
    const e = leggiRisposte(csv([{ email:"a@x.it", chi:"Medico A (101)", giorni:{ 3:"L" } }]), anno, mese, rinominato);
    expect(e.risposte[0].id).toBe(1);
  });
  it.each(FORMATI)("foglio %s di un altro mese: errore, niente importato", (f) => {
    const e = leggiRisposte(csv([{ email:"a@x.it", chi:"Medico A (101)", giorni:{ 3:"L" } }], f), anno, 10, medici);
    expect(e.errore).toMatch(/sono di Dicembre 2027, non di Novembre 2027/);
    expect(e.risposte).toEqual([]);
  });
  it("file non riconosciuto o vuoto: errore", () => {
    expect(leggiRisposte("a,b,c\n1,2,3", anno, mese, medici).errore).toMatch(/Non sembra il foglio/);
    expect(leggiRisposte("Chi sei?,Note\nMedico A (101),ciao", anno, mese, medici).errore).toMatch(/Non sembra il foglio/);
    expect(leggiRisposte("", anno, mese, medici).errore).toMatch(/vuoto/);
  });
});

describe("desiderate: inserimento nel mese", () => {
  const e = leggiRisposte(csv([
    { email:"a@x.it", chi:"Medico A (101)", giorni:{ 3:"L", 10:"No mattina, No pomeriggio", 25:"L" } },
    { email:"b@x.it", chi:"Medico B (102)", giorni:{ 24:"Libero", 25:"ANA" } },
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
    const nuove = leggiRisposte(csv([{ email:"a@x.it", chi:"Medico A (101)", giorni:{ 4:"L" } }]), anno, mese, medici).risposte;
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
