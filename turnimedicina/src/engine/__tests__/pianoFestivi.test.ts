import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import type { Medico, TurniAll, TurniMese } from "../types";
import { mergeRegole, REGOLE_DEFAULT, setRegole } from "../regole";
import {
  festiviPianoDefault, festivitaPeriodo, festivitaAnno, buildShifts, generaPiano, verificaPiano, periodoOk, periodoSuccessivo,
  easter, allineaFestiviPiano, sanaFestiviPiano, type CfgPiano,
} from "../pianoFestivi";
import {
  statoFestiviDefault, mergeStatoFestivi, leggiTurniFestivi, automaticiFestivi, datiSorteggio, sorteggia, riepilogoPiano,
  controlliPiano, prossimoPeriodo, periodoSaldoOk, mesiDelPiano, meseGenerato, inserisciPiano, togliInseriti, type PianoSalvato, type TurnoInserito,
} from "../festiviApp";

// ── v0.3.60: piano festivi ────────────────────────────────────────────────────
const lista = festiviPianoDefault([{ data:"09-08", nome:"Santa Maria dell'Olmo" }]);
const med = (id:number, stato:Medico["stato"]="MR", noNotti=false): Medico =>
  ({ id, nome:`X. M${id}`, codice:String(id), stato, obiettivo:25, ambulatorio:false, ...(noNotti ? { noNotti:true } : {}) });
const cella = (...tipi:string[]) => ({ t: tipi.map(tipo=>({ tipo, sott:false, man:false })) });

describe("piano festivi: stesso sorteggio dello strumento originale", () => {
  const rif = JSON.parse(fs.readFileSync("src/engine/__tests__/fixtures/pianoFestivi_riferimento.json", "utf8"));
  // i riferimenti sono stati calcolati coi punti dello strumento originale: 24 e 31 dicembre a 1 (dalla v0.3.66 valgono 2)
  const lista = festiviPianoDefault([{ data:"09-08", nome:"Santa Maria dell'Olmo" }])
    .map(f => f.soloGiorno ? { ...f, punti:{ ...f.punti, giorno:1 } } : f);
  for(const [i, caso] of rif.casi.entries()){
    it(`caso ${i+1}: ${caso.start} → ${caso.end}${caso.cfg.onCall.enabled ? " con reperibilità" : ""}`, () => {
      const r = generaPiano({ ...caso.cfg, holidays: festivitaPeriodo(lista, caso.start, caso.end) });
      expect(r.assignments.map(a=>[a.date,a.tipo,a.doctor,a.onCall,a.points,a.onCallPoints])).toEqual(caso.atteso.turni);
      expect(r.score).toBe(caso.atteso.score);
      expect(r.totals).toEqual(caso.atteso.totals);
      expect([r.spreadBefore, r.spreadAfter]).toEqual([caso.atteso.scartoPrima, caso.atteso.scartoDopo]);
    });
  }
});

describe("piano festivi: festività e turni", () => {
  it("anno solare: 15 festività, 39 turni, le notti condivise valgono il punteggio più alto", () => {
    const f = festivitaPeriodo(lista, "2027-01-01", "2027-12-31");
    expect(f.length).toBe(15);
    expect(f.filter(h=>h.sup).map(h=>h.name)).toEqual(["Capodanno","Pasqua","Natale","Santo Stefano"]);
    const t = buildShifts(f);
    expect(t.length).toBe(39);
    const notteNatale = t.find(s=>s.date==="2027-12-25" && s.tipo==="notturno")!;
    expect(notteNatale.holNames).toEqual(["Natale","Santo Stefano"]);
    expect(notteNatale.points).toBe(3);                      // notte di Natale 3, notte prima di S. Stefano 3
    expect(t.find(s=>s.date==="2027-12-24" && s.tipo==="diurno")!.points).toBe(2);   // vigilia: solo diurno, 2 punti
    expect(t.find(s=>s.date==="2027-12-31" && s.tipo==="diurno")!.points).toBe(2);   // San Silvestro: solo diurno, 2 punti
    expect(t.some(s=>s.date==="2027-12-31" && s.tipo==="notturno")).toBe(false);     // è la notte prima del Capodanno dopo
    expect(easter(2027)).toBe("2027-03-28");
  });
  it("a cavallo di due anni i nomi prendono l'anno; la notte di un festivo prima dell'inizio resta al periodo precedente", () => {
    const f = festivitaPeriodo(lista, "2026-12-26", "2027-06-30");
    expect(f[0].name).toBe("Santo Stefano 2026");
    expect(f[0].base).toBe("Santo Stefano");
    expect(f[0].skipNottePrima).toBe(true);
    expect(buildShifts(f).some(s=>s.date==="2026-12-25")).toBe(false);
    expect(periodoOk("2027-01-01","2028-01-01")).not.toBe("");
    expect(periodoOk("2027-01-01","2027-12-31")).toBe("");
    expect(periodoSuccessivo({ start:"2027-01-01", end:"2027-12-31" })).toEqual({ start:"2028-01-01", end:"2028-12-31" });
  });
  it("le feste locali del reparto entrano nell'elenco e ne escono con la scheda reparto", () => {
    expect(festiviPianoDefault().length).toBe(14);
    const conPatrono = allineaFestiviPiano(festiviPianoDefault(), [{ data:"09-08", nome:"Patrono" }]);
    expect(festivitaAnno(conPatrono, 2027).find(h=>h.date==="2027-09-08")!.slots).toEqual({ nottePrima:1, giorno:1, notte:1 });
    expect(allineaFestiviPiano(conPatrono, []).length).toBe(14);
    expect(allineaFestiviPiano(conPatrono, [{ data:"12-25", nome:"doppione" }]).filter(f=>f.data==="12-25").length).toBe(1);
  });
  it("regole: elenco predefinito, punti salvati, vecchi campi dei superfestivi scartati", () => {
    const d = mergeRegole({});
    expect(d.festiviPiano.length).toBe(15);
    expect(d.pianoFestiviAnni).toBe(2);
    const vecchie = mergeRegole({ superfestivi:[{ id:"natale", nome:"Natale", data:"12-25" }], superfestiviAttivi:true, superfestiviAnni:4, alternanzaNataleCapodanno:true } as any) as any;
    expect(vecchie.superfestivi).toBeUndefined();
    expect(vecchie.superfestiviAttivi).toBeUndefined();
    expect(vecchie.alternanzaNataleCapodanno).toBeUndefined();
    expect(vecchie.pianoFestiviAnni).toBe(4);                // gli anni di storico passano alla sezione Festivi
    const mod = JSON.parse(JSON.stringify(REGOLE_DEFAULT));
    mod.festiviPiano[0].punti.giorno = 2.5; mod.festiviPiano.push({ id:"x", nome:"Doppione", data:"12-25", sup:false, punti:{ nottePrima:1, giorno:1, notte:1 } });
    const m = mergeRegole(mod);
    expect(m.festiviPiano[0].punti.giorno).toBe(2.5);
    expect(m.festiviPiano.filter(f=>f.data==="12-25").length).toBe(1);
    expect(sanaFestiviPiano([{ data:"13-40" }, { data:"02-30" }, { data:"pasqua", punti:{ giorno:"3" } }])!.map(f=>[f.data,f.punti.giorno])).toEqual([["pasqua",3]]);
    expect(sanaFestiviPiano("x")).toBeNull();
  });
  it("v0.3.66: il giorno del 24 e del 31 dicembre vale 2; gli elenchi salvati prima passano da 1 a 2 una volta sola", () => {
    const giorno = (r:{ festiviPiano:{ data:string; punti:{ giorno:number } }[] }, data:string) => r.festiviPiano.find(f=>f.data===data)!.punti.giorno;
    const d = mergeRegole({});
    expect([giorno(d,"12-24"), giorno(d,"12-31"), d.festiviPianoRev]).toEqual([2, 2, 1]);
    // salvataggio di prima: 24 e 31 a 1, senza revisione → 2; gli altri punti restano
    const prima = JSON.parse(JSON.stringify(REGOLE_DEFAULT));
    delete prima.festiviPianoRev;
    for (const f of prima.festiviPiano) if (f.soloGiorno) f.punti.giorno = 1;
    prima.festiviPiano.find((f:any)=>f.id==="natale").punti.giorno = 2.5;
    const m = mergeRegole(prima);
    expect([giorno(m,"12-24"), giorno(m,"12-31"), giorno(m,"12-25"), m.festiviPianoRev]).toEqual([2, 2, 2.5, 1]);
    // un valore già cambiato a mano prima (1,5) non si tocca
    const amano = JSON.parse(JSON.stringify(prima)); amano.festiviPiano.find((f:any)=>f.data==="12-24").punti.giorno = 1.5;
    expect(giorno(mergeRegole(amano),"12-24")).toBe(1.5);
    // dopo la revisione, un 1 rimesso a mano resta 1 (anche dopo un nuovo salvataggio)
    const dopo = JSON.parse(JSON.stringify(m)); dopo.festiviPiano.find((f:any)=>f.data==="12-31").punti.giorno = 1;
    expect(giorno(mergeRegole(JSON.parse(JSON.stringify(mergeRegole(dopo)))),"12-31")).toBe(1);
  });
});

describe("piano festivi: chi fa solo turni di giorno", () => {
  it("nessuna notte e nessuna reperibilità di notte, con e senza reperibilità", () => {
    for(const rep of [false, true]){
      const doctors = ["1","2","3","4","5","6","7","8","9","10"];
      const cfg: CfgPiano = { doctors, holidays: festivitaPeriodo(lista, "2027-01-01", "2027-12-31"), maxShifts: 6, minSuper: 1,
        soloDiurni: ["3","7"], onCall: { enabled: rep, weightPct: 40, maxPer: 6, eligible: doctors }, baseSeed: 7, attempts: 120 };
      const r = generaPiano(cfg);
      for(const d of ["3","7"]){
        expect(r.assignments.filter(a=>a.doctor===d && a.tipo==="notturno")).toEqual([]);
        expect(r.assignments.filter(a=>a.onCall===d && a.tipo==="notturno")).toEqual([]);
        expect(r.assignments.some(a=>a.doctor===d)).toBe(true);        // i turni di giorno li fanno
      }
      expect(verificaPiano(r, cfg)).toEqual([]);
      expect(r.assignments.every(a=>a.doctor)).toBe(true);
    }
  });
});

describe("sezione Festivi: lettura dai mesi salvati", () => {
  const medici = [med(1), med(2), med(3), med(4,"MDC"), med(5,"MPS")];
  // dicembre 2026: vigilia, Natale, S. Stefano, S. Silvestro (e la notte del 31 → Capodanno 2027)
  const dic: TurniMese = {
    1: { 24: cella("N"), 26: cella("M","P") },                 // notte prima di Natale (3) + giorno di S. Stefano (2)
    2: { 25: cella("M"), 8: cella("P") },                      // mezza giornata di Natale (1,5) + mezza Immacolata (1)
    3: { 25: cella("P"), 24: cella("M","P") },                 // mezza giornata di Natale (1,5) + vigilia (2)
    4: { 25: cella("N") },                                     // notte di Natale = notte prima di S. Stefano (3)
    5: { 26: { t:[{ tipo:"3", sott:true, man:true }] }, 7: cella("N") },   // PS notte sottolineato a S. Stefano (2) + notte prima dell'Immacolata (1)
  };
  const tutti: TurniAll = { "2026-12": dic };
  it("notti per intero, giorno intero con mattina e pomeriggio, metà con uno solo; PS e sottolineati contano", () => {
    const letti = leggiTurniFestivi(tutti, medici, lista, "2026-12-01", "2026-12-31");
    const di = (date:string, tipo:string) => letti.find(t=>t.date===date && t.tipo===tipo)!;
    expect(di("2026-12-24","notturno").chi).toEqual([{ id:1, quota:1 }]);
    expect(di("2026-12-25","diurno").chi).toEqual([{ id:2, quota:0.5 }, { id:3, quota:0.5 }]);
    expect(di("2026-12-26","diurno").chi).toEqual([{ id:1, quota:1 }]);
    expect(di("2026-12-26","notturno").chi).toEqual([{ id:5, quota:1 }]);
    expect(di("2026-12-08","notturno").fonte).toBeNull();     // nessuno in tabellone
    expect(letti.some(t=>t.date==="2026-12-31" && t.tipo==="notturno")).toBe(false);   // appartiene al Capodanno successivo
  });
  it("saldo = punti fatti, tolto il minimo; storico = chi ha fatto la festività l'ultima volta; precedenza a chi è senza superfestivo", () => {
    const st = { ...statoFestiviDefault(new Date(2026,10,16)), periodo:{ start:"2027-01-01", end:"2027-12-31" } };
    const a = automaticiFestivi(st, tutti, medici, lista, 2, [1,2,3,4,5]);
    expect(a.origine).toBe("mesi");
    expect(a.punti).toEqual({ 1:5, 2:2.5, 3:3.5, 4:3, 5:3 });
    expect(a.saldo).toEqual({ 1:2.5, 2:0, 3:1, 4:0.5, 5:0.5 });
    expect(a.storico[1].sort()).toEqual(["Natale","Santo Stefano"]);
    expect(a.storico[4].sort()).toEqual(["Natale","Santo Stefano"]);    // la notte condivisa vale per entrambe
    expect(a.storico[3].sort()).toEqual(["Natale","Vigilia di Natale"]);
    expect(a.storico[2].sort()).toEqual(["Immacolata","Natale"]);
    expect(a.precedenza).toEqual([]);                                   // tutti hanno fatto un superfestivo
    const senza4 = automaticiFestivi(st, { "2026-12": { ...dic, 4:{} } }, medici, lista, 2, [1,2,3,4,5]);
    expect(senza4.precedenza).toEqual([4]);
    // partecipanti diversi: il minimo si calcola fra chi partecipa
    expect(automaticiFestivi(st, tutti, medici, lista, 2, [1,4]).saldo).toEqual({ 1:2, 4:0 });
    // senza mesi salvati: tutto a zero, nessuna precedenza
    const vuoto = automaticiFestivi(st, {}, medici, lista, 2, [1,2,3]);
    expect(vuoto.saldo).toEqual({ 1:0, 2:0, 3:0 });
    expect(vuoto.precedenza).toEqual([]);
    expect(vuoto.nMese).toBe(0);
  });
  it("lo storico guarda indietro gli anni chiesti e prende l'ultima volta", () => {
    const st = { ...statoFestiviDefault(), periodo:{ start:"2027-01-01", end:"2027-12-31" } };
    const due: TurniAll = { "2026-12": { 1:{ 25:cella("M","P") } }, "2025-12": { 2:{ 25:cella("M","P") }, 3:{ 26:cella("M","P") } } };
    const a2 = automaticiFestivi(st, due, medici, lista, 2, [1,2,3]);
    expect(a2.storico[1]).toEqual(["Natale"]);
    expect(a2.storico[2]).toEqual([]);                         // il Natale 2025 è superato da quello 2026
    expect(a2.storico[3]).toEqual(["Santo Stefano"]);          // nel 2026 nessun dato: vale il 2025
    expect(a2.punti[2]).toBe(3);                               // ma i punti dei due anni si sommano
    const a1 = automaticiFestivi(st, due, medici, lista, 1, [1,2,3]);
    expect(a1.storico[3]).toEqual([]);
    expect(a1.punti[2]).toBe(0);
  });
});

describe("sezione Festivi: dal pannello al piano", () => {
  const medici = [med(1), med(2), med(3,"MR",true), med(4,"MDC"), med(5,"MPS"), med(6,"ML"), med(7), med(8), med(9), med(10)];
  const st0 = { ...statoFestiviDefault(new Date(2026,10,16)), esclusi:[6], preferenze:{ 2:{ "Natale":"giorno" as const, "Inesistente":"any" as const } }, saldoMan:{ 1:4 }, precMan:{ 7:true } };
  it("periodo predefinito: l'anno solare successivo", () => {
    expect(st0.periodo).toEqual({ start:"2027-01-01", end:"2027-12-31" });
  });
  it("partecipanti, esentati, correzioni a mano e preferenze arrivano al sorteggio", () => {
    const auto = automaticiFestivi(st0, {}, medici, lista, 2, medici.filter(m=>m.id!==6).map(m=>m.id));
    const d = datiSorteggio(st0, medici, lista, auto);
    expect(d.cfg.doctors).toEqual(["1","2","3","4","5","7","8","9","10"]);
    expect(d.cfg.soloDiurni).toEqual(["3"]);                   // dalla scheda del medico
    expect(d.cfg.saldo!["1"]).toBe(4);
    expect(d.cfg.superPrio).toEqual(["7"]);
    expect(d.cfg.preferences).toEqual({ "2": { "Natale":"giorno" } });
    const forzato = datiSorteggio({ ...st0, soloGiorno:{ 3:false, 5:true } }, medici, lista, auto);
    expect(forzato.cfg.soloDiurni).toEqual(["5"]);             // la scelta a mano vince sulla scheda
    const { piano } = sorteggia(d, st0, "2026-11-16T10:00:00.000Z");
    expect(piano.turni.length).toBe(39);
    expect(piano.turni.every(t=>t.medico!=null && t.medico!==6)).toBe(true);
    expect(piano.turni.filter(t=>t.medico===3 && t.tipo==="notturno")).toEqual([]);
    expect(piano.turni.find(t=>t.date==="2027-12-25" && t.tipo==="diurno")!.medico).toBe(2);   // preferenza rispettata
    expect([piano.richieste, piano.richiesteOk]).toEqual([1,1]);
    const righe = riepilogoPiano(piano);
    expect(righe.reduce((s,r)=>s+r.turni,0)).toBe(39);
    expect(righe.find(r=>r.id===1)!.saldo).toBe(4);
    const c = controlliPiano(piano, d.soloGiorno, id=>`M${id}`);
    expect(c.filter(x=>!x.ok)).toEqual([]);
    // stesso seme → stesso piano; altro seme → un'altra variante
    expect(sorteggia(d, st0, "x").piano.turni).toEqual(piano.turni);
    const altro = sorteggia(datiSorteggio({ ...st0, seme:2 }, medici, lista, auto), { ...st0, seme:2 }, "x").piano;
    expect(altro.turni.map(t=>t.medico)).not.toEqual(piano.turni.map(t=>t.medico));
  });
  it("periodo successivo: il piano va in archivio e il saldo riparte da lì", () => {
    const ids = medici.filter(m=>m.id!==6).map(m=>m.id);
    const d = datiSorteggio(st0, medici, lista, automaticiFestivi(st0, {}, medici, lista, 2, ids));
    const { piano } = sorteggia(d, st0, "x");
    const st1 = prossimoPeriodo({ ...st0, piano });
    expect(st1.periodo).toEqual({ start:"2028-01-01", end:"2028-12-31" });
    expect(st1.piano).toBeNull();
    expect(st1.archivio.length).toBe(1);
    expect(st1.saldoMan).toEqual({});
    expect(st1.preferenze).toEqual({});
    // nessun mese salvato: i punti si leggono dal piano, più il saldo di partenza di allora
    const a = automaticiFestivi(st1, {}, medici, lista, 2, ids);
    expect(a.origine).toBe("piano");
    expect(a.nPiano).toBe(39);
    const righe = riepilogoPiano(piano), mn = Math.min(...righe.map(r=>r.totale));
    for(const r of righe) expect(a.saldo[r.id]).toBeCloseTo(r.totale - mn, 5);
    expect(a.storico[2]).toContain("Natale");
    // un mese salvato vince sul piano: a Natale 2027 di giorno ha lavorato il medico 9, non il 2
    const reale: TurniAll = { "2027-12": { 9:{ 25:cella("M","P") } } };
    const b = automaticiFestivi(st1, reale, medici, lista, 2, ids);
    expect(b.letti.find(t=>t.date==="2027-12-25" && t.tipo==="diurno")!.chi).toEqual([{ id:9, quota:1 }]);
    expect(b.punti[9]).toBe(a.punti[9] + 3);
    expect(b.punti[2]).toBe(a.punti[2] - 3);
  });
  it("stato salvato guasto o di una versione futura: si riparte dai valori validi", () => {
    const oggi = new Date(2026,10,16);
    expect(mergeStatoFestivi(null, oggi)).toEqual(statoFestiviDefault(oggi));
    const m = mergeStatoFestivi({ periodo:{ start:"2027-01-01", end:"2029-01-01" }, maxShifts:"x", esclusi:[1,"a",1], preferenze:{ 2:{ Natale:"giorno", Pasqua:"boh" } },
      piano:{ periodo:{ start:"2027-01-01", end:"2027-12-31" }, turni:[{ date:"2027-12-25", tipo:"diurno", medico:2, punti:3 }, { date:"x" }] }, archivio:"no" }, oggi);
    expect(m.periodo).toEqual({ start:"2027-01-01", end:"2027-12-31" });   // più di 12 mesi: scartato
    expect(m.maxShifts).toBe(5);
    expect(m.esclusi).toEqual([1]);
    expect(m.preferenze).toEqual({ 2:{ Natale:"giorno" } });
    expect((m.piano as PianoSalvato).turni.length).toBe(1);
    expect(m.archivio).toEqual([]);
  });
});

// ── v0.3.61: dal piano ai mesi ────────────────────────────────────────────────
describe("sezione Festivi: il piano nei mesi", () => {
  const medici = [med(1), med(2), med(3,"MR",true), med(4,"MDC"), med(5,"MPS"), med(7), med(8), med(9), med(10), med(11)];
  const st = statoFestiviDefault(new Date(2026,10,16));
  const ids = medici.map(m=>m.id);
  const { piano } = sorteggia(datiSorteggio(st, medici, lista, automaticiFestivi(st, {}, medici, lista, 2, ids)), st, "2026-11-16T10:00:00.000Z");
  const man = (...tipi:string[]) => ({ t: tipi.map(tipo=>({ tipo, sott:false, man:true })) });
  const diDic = piano.turni.filter(t=>t.date.startsWith("2027-12"));

  it("mesi del piano: anche il dicembre prima, per la notte di Capodanno", () => {
    const mesi = mesiDelPiano(piano);
    expect(mesi[0]).toEqual({ chiave:"2026-12", anno:2026, mese:11, turni:1 });
    expect(mesi.reduce((n,m)=>n+m.turni,0)).toBe(39);
    expect(mesi.find(m=>m.chiave==="2027-12")!.turni).toBe(diDic.length);
  });
  it("notte → N manuale; giorno → M e P manuali allo stesso medico; il resto del mese non si tocca", () => {
    const ferie: TurniAll = { "2027-12": { 99: { 3: man("L") } } };
    const e = inserisciPiano(piano, ferie, "2027-12");
    expect(e.blocco).toBe("");
    expect(e.saltati).toEqual([]);
    expect(e.inseriti.length).toBe(diDic.length);
    for(const t of diDic){
      const c = e.turni[t.medico!][+t.date.slice(8)].t;
      expect(c.map(s=>s.tipo)).toEqual(t.tipo==="notturno" ? ["N"] : ["M","P"]);
      expect(c.every(s=>s.man && !s.sott)).toBe(true);
    }
    expect(e.turni[99][3].t[0].tipo).toBe("L");
    expect(ferie["2027-12"][1]).toBeUndefined();              // l'originale non viene modificato
    expect(meseGenerato(e.turni)).toBe(false);
  });
  it("tutto il piano inserito e riletto dai mesi: stessi medici, stessi punti", () => {
    let tutti: TurniAll = {};
    for(const m of mesiDelPiano(piano)) tutti = { ...tutti, [m.chiave]: inserisciPiano(piano, tutti, m.chiave).turni };
    const letti = leggiTurniFestivi(tutti, medici, lista, "2027-01-01", "2027-12-31");
    expect(letti.length).toBe(39);
    for(const t of piano.turni){
      const l = letti.find(x=>x.date===t.date && x.tipo===t.tipo)!;
      expect(l.fonte).toBe("mese");
      expect(l.chi).toEqual([{ id:t.medico, quota:1 }]);
    }
  });
  it("cella occupata o turno che urta uno già presente: si salta e si segnala", () => {
    const natale = diDic.find(t=>t.date==="2027-12-25" && t.tipo==="diurno")!, vigiliaN = diDic.find(t=>t.date==="2027-12-24" && t.tipo==="notturno")!;
    const sStefanoN = diDic.find(t=>t.date==="2027-12-26" && t.tipo==="notturno")!, immG = diDic.find(t=>t.date==="2027-12-08" && t.tipo==="diurno")!;
    const T: TurniAll = { "2027-12": {
      [natale.medico!]: { 25: man("L") },                     // in ferie a Natale
      [vigiliaN.medico!]: { 25: man("M") },                   // lavora il giorno dopo la notte
      [sStefanoN.medico!]: { 27: man("X") },                  // una X il giorno dopo non urta
      [immG.medico!]: { 7: man("N") },                        // smonta dalla notte del 7
    } };
    const e = inserisciPiano(piano, T, "2027-12");
    const motivi = Object.fromEntries(e.saltati.map(x=>[x.date+" "+x.tipo, x.motivo]));
    expect(motivi["2027-12-25 diurno"]).toBe("cella occupata (L)");
    expect(motivi["2027-12-24 notturno"]).toBe("il giorno dopo ha già un turno");
    expect(motivi["2027-12-08 diurno"]).toBe("il giorno prima ha una notte");
    expect(motivi["2027-12-07 notturno"]).toBe("la notte è già di un altro medico");   // la notte del 7 messa a mano
    expect(e.saltati.length).toBe(4);
    expect(e.turni[sStefanoN.medico!][26].t.map(s=>s.tipo)).toEqual(["N"]);
    expect(e.turni[natale.medico!][25].t.map(s=>s.tipo)).toEqual(["L"]);
    expect(e.inseriti.length).toBe(diDic.length - 4);
    // a cavallo di mese: la notte del 31/12/2026 non entra se il medico lavora il 1° gennaio
    const capN = piano.turni.find(t=>t.date==="2026-12-31")!;
    const e2 = inserisciPiano(piano, { "2027-01": { [capN.medico!]: { 1: man("P") } } }, "2026-12");
    expect(e2.saltati.map(x=>x.motivo)).toEqual(["il giorno dopo ha già un turno"]);
  });
  it("turno già di un altro medico: non si raddoppia", () => {
    setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));
    const natN = diDic.find(t=>t.date==="2027-12-25" && t.tipo==="notturno")!, natG = diDic.find(t=>t.date==="2027-12-25" && t.tipo==="diurno")!;
    const vigG = diDic.find(t=>t.date==="2027-12-24" && t.tipo==="diurno")!;
    const libero = ids.find(id=>![natN.medico, natG.medico, vigG.medico].includes(id) && !diDic.some(t=>t.medico===id && ["2027-12-24","2027-12-25","2027-12-26"].includes(t.date)))!;
    // Natale (sabato festivo: una mattina, un pomeriggio, una notte): un altro ha già la notte e il pomeriggio
    const e = inserisciPiano(piano, { "2027-12": { [libero]: { 25: man("P") }, 99: { 25: man("N") } } }, "2027-12", [], medici);
    const motivi = Object.fromEntries(e.saltati.map(x=>[x.date+" "+x.tipo, x.motivo]));
    expect(motivi["2027-12-25 notturno"]).toBe("la notte è già di un altro medico");
    expect(motivi["2027-12-25 diurno"]).toBe(`il pomeriggio è già di X. M${libero}`);
    // vigilia (venerdì feriale: fino a tre mattine e due pomeriggi): un altro di mattina non impedisce l'inserimento
    const e2 = inserisciPiano(piano, { "2027-12": { [libero]: { 24: man("M") } } }, "2027-12", [], medici);
    expect(e2.saltati.filter(x=>x.date==="2027-12-24" && x.tipo==="diurno")).toEqual([]);
    expect(e2.turni[vigG.medico!][24].t.map(s=>s.tipo)).toEqual(["M","P"]);
  });
  it("solo mesi nuovi: in un mese già generato non scrive nulla", () => {
    const gen: TurniAll = { "2027-12": { 1: { 2: { t:[{ tipo:"M", sott:false, man:false }] } } } };
    const e = inserisciPiano(piano, gen, "2027-12");
    expect(e.blocco).toMatch(/già stato generato/);
    expect(e.inseriti).toEqual([]);
    expect(e.turni).toBe(gen["2027-12"]);
  });
  it("nuovo sorteggio: i turni scritti prima escono, entrano i nuovi; quelli toccati a mano restano", () => {
    const e1 = inserisciPiano(piano, {}, "2027-12");
    const st2 = { ...st, seme: 5 };
    const piano2 = sorteggia(datiSorteggio(st2, medici, lista, automaticiFestivi(st2, {}, medici, lista, 2, ids)), st2, "x").piano;
    expect(piano2.turni.map(t=>t.medico)).not.toEqual(piano.turni.map(t=>t.medico));
    // l'utente nel frattempo ha aggiunto ferie a un medico libero e cambiato un turno del piano
    const T1: TurniMese = JSON.parse(JSON.stringify(e1.turni));
    const vig = diDic.find(t=>t.date==="2027-12-24" && t.tipo==="diurno")!;
    T1[vig.medico!][24] = man("ANA");                          // al posto di M+P ha messo un permesso
    const e2 = inserisciPiano(piano2, { "2027-12": T1 }, "2027-12", e1.inseriti);
    expect(e2.tolti).toBe(diDic.length - 1);                   // tutti tranne quello cambiato a mano
    expect(e2.turni[vig.medico!][24].t.map(s=>s.tipo)).toEqual(["ANA"]);
    for(const t of piano2.turni.filter(x=>x.date.startsWith("2027-12"))){
      const c = e2.turni[t.medico!]?.[+t.date.slice(8)]?.t.map(s=>s.tipo) || [];
      const saltato = e2.saltati.some(x=>x.date===t.date && x.tipo===t.tipo);
      expect(saltato || c.join()===(t.tipo==="notturno" ? "N" : "M,P")).toBe(true);
    }
    // nessun turno del vecchio piano resta dove il nuovo non lo conferma
    let turniTot = 0; for(const id in e2.turni) for(const g in e2.turni[id]) turniTot += e2.turni[id][g].t.filter(s=>s.tipo!=="ANA").length;
    expect(turniTot).toBe(e2.inseriti.reduce((n,x)=>n+x.tipi.length,0));
    // «Togli»: il mese torna com'era
    const via = togliInseriti(e1.turni, e1.inseriti);
    expect(via.tolti).toBe(diDic.length);
    expect(Object.values(via.turni).every(gi=>Object.keys(gi).length===0)).toBe(true);
  });
  it("stato salvato: i turni inseriti si conservano, quelli guasti si scartano", () => {
    const ins: TurnoInserito[] = [{ id:1, g:25, tipi:["M","P"] }];
    const m = mergeStatoFestivi({ inseriti:{ "2027-12":{ generato:"x", turni:[...ins, { id:"a", g:1, tipi:["N"] }, { id:2, g:3, tipi:["L"] }] }, "boh":{ turni:[] } } });
    expect(m.inseriti).toEqual({ "2027-12":{ generato:"x", turni: ins } });
    expect(mergeStatoFestivi({}).inseriti).toEqual({});
  });
});

describe("turni associati: la giornata festiva del piano conta come le altre", () => {
  it("mattina e pomeriggio manuali in una festività consumano il tetto settimanale e mensile", async () => {
    const { makeCtx } = await import("../ctx");
    setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));
    const manC = (...tipi:string[]) => ({ t: tipi.map(tipo=>({ tipo, sott:false, man:true })) });
    // dicembre 2027: Natale sabato 25, settimana 20–26
    const c = makeCtx(2027, 11, 31, [{ ...med(1), maxAssMese: 1 }, med(2)], { 1: { 25: manC("M","P"), 21: manC("M","P") } });
    expect(c.assInSett(1, 25)).toBe(2);
    expect(c.assInMese(1)).toBe(2);
    expect(c.canAssMese(1)).toBe(false);
  });
});

// ── v0.3.63: periodo dei punti del saldo scelto a mano ─────────────────────────
describe("sezione Festivi: periodo dei punti del saldo", () => {
  const medici = [med(1), med(2), med(3)];
  const ids = [1, 2, 3];
  const cella2 = (...tipi:string[]) => ({ t: tipi.map(tipo=>({ tipo, sott:false, man:true })) });
  // Natale 2025 al medico 1 (giorno, 3 punti); Ferragosto 2026 al medico 2 (notte, 2 punti); Natale 2026 al medico 3 (giorno, 3 punti)
  const tutti: TurniAll = {
    "2025-12": { 1: { 25: cella2("M","P") } },
    "2026-08": { 2: { 15: cella2("N") } },
    "2026-12": { 3: { 25: cella2("M","P") } },
  };
  const base = { ...statoFestiviDefault(new Date(2026,10,16)), periodo:{ start:"2027-01-01", end:"2027-12-31" } };
  it("automatico: gli ultimi anni (qui 2), come prima", () => {
    const a = automaticiFestivi(base, tutti, medici, lista, 2, ids);
    expect(a.origine).toBe("mesi");
    expect(a.errPeriodoSaldo).toBe("");
    expect(a.punti).toEqual({ 1:3, 2:2, 3:3 });
  });
  it("scelto a mano: contano solo i punti fra le due date", () => {
    const a = automaticiFestivi({ ...base, periodoSaldo:{ start:"2026-01-01", end:"2026-12-31" } }, tutti, medici, lista, 2, ids);
    expect(a.origine).toBe("scelto");
    expect([a.da, a.a]).toEqual(["2026-01-01", "2026-12-31"]);
    expect(a.punti).toEqual({ 1:0, 2:2, 3:3 });
    expect(a.saldo).toEqual({ 1:0, 2:2, 3:3 });
    const solo = automaticiFestivi({ ...base, periodoSaldo:{ start:"2026-08-01", end:"2026-08-31" } }, tutti, medici, lista, 2, ids);
    expect(solo.punti).toEqual({ 1:0, 2:2, 3:0 });
  });
  it("lo storico e la precedenza non cambiano col periodo dei punti", () => {
    const auto = automaticiFestivi({ ...base, minSuper:1 }, tutti, medici, lista, 2, ids);
    const scelto = automaticiFestivi({ ...base, minSuper:1, periodoSaldo:{ start:"2026-08-01", end:"2026-08-31" } }, tutti, medici, lista, 2, ids);
    expect(scelto.storico).toEqual(auto.storico);
    expect(scelto.precedenza).toEqual(auto.precedenza);
  });
  it("con un piano precedente il periodo scelto non somma il suo saldo", () => {
    const st0 = { ...base, periodo:{ start:"2026-01-01", end:"2026-12-31" } };
    const { piano } = sorteggia(datiSorteggio({ ...st0, saldoMan:{ 1:10 } }, medici, lista, automaticiFestivi(st0, {}, medici, lista, 2, ids)), { ...st0, saldoMan:{ 1:10 } }, "x");
    const st1 = prossimoPeriodo({ ...st0, piano });
    const auto = automaticiFestivi(st1, {}, medici, lista, 2, ids);
    expect(auto.origine).toBe("piano");
    expect(auto.riporto[1]).toBe(10);
    const scelto = automaticiFestivi({ ...st1, periodoSaldo:{ start:"2026-01-01", end:"2026-12-31" } }, {}, medici, lista, 2, ids);
    expect(scelto.origine).toBe("scelto");
    expect(scelto.riporto).toEqual({ 1:0, 2:0, 3:0 });
    // i mesi non salvati si leggono ancora dal piano: tutte le festività del 2026, compresa
    // la notte prima di Capodanno (31/12/2025), che appartiene a Capodanno 2026
    expect(scelto.nPiano).toBe(piano.turni.filter(t=>t.medico!=null).length);
    for(const r of riepilogoPiano(piano)) expect(scelto.punti[r.id]).toBeCloseTo(r.punti, 5);
  });
  it("periodo non valido: vale l'automatico e si segnala", () => {
    const dopo = automaticiFestivi({ ...base, periodoSaldo:{ start:"2026-06-01", end:"2027-02-01" } }, tutti, medici, lista, 2, ids);
    expect(dopo.errPeriodoSaldo).toMatch(/prima dell'inizio del piano \(01\/01\/2027\)/);
    expect(dopo.origine).toBe("mesi");
    expect(dopo.punti).toEqual({ 1:3, 2:2, 3:3 });
    expect(periodoSaldoOk({ start:"2026-05-01", end:"2026-04-01" }, "2027-01-01")).toMatch(/prima di quella di inizio/);
  });
  it("si salva, si sanifica e si azzera passando al periodo successivo", () => {
    expect(statoFestiviDefault().periodoSaldo).toBeNull();
    expect(mergeStatoFestivi({ periodoSaldo:{ start:"2026-01-01", end:"2026-12-31" } }).periodoSaldo).toEqual({ start:"2026-01-01", end:"2026-12-31" });
    expect(mergeStatoFestivi({ periodoSaldo:{ start:"2026-12-31", end:"2026-01-01" } }).periodoSaldo).toBeNull();
    expect(mergeStatoFestivi({ periodoSaldo:{ start:"boh", end:"2026-01-01" } }).periodoSaldo).toBeNull();
    expect(prossimoPeriodo({ ...base, periodoSaldo:{ start:"2026-01-01", end:"2026-12-31" } }).periodoSaldo).toBeNull();
  });
});
