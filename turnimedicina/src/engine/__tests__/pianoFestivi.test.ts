import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import type { Medico, TurniAll, TurniMese } from "../types";
import { mergeRegole, REGOLE_DEFAULT } from "../regole";
import {
  festiviPianoDefault, festivitaPeriodo, festivitaAnno, buildShifts, generaPiano, verificaPiano, periodoOk, periodoSuccessivo,
  easter, allineaFestiviPiano, sanaFestiviPiano, type CfgPiano,
} from "../pianoFestivi";
import {
  statoFestiviDefault, mergeStatoFestivi, leggiTurniFestivi, automaticiFestivi, datiSorteggio, sorteggia, riepilogoPiano,
  controlliPiano, prossimoPeriodo, type PianoSalvato,
} from "../festiviApp";

// ── v0.3.60: piano festivi ────────────────────────────────────────────────────
const lista = festiviPianoDefault([{ data:"09-08", nome:"Santa Maria dell'Olmo" }]);
const med = (id:number, stato:Medico["stato"]="MR", noNotti=false): Medico =>
  ({ id, nome:`X. M${id}`, codice:String(id), stato, obiettivo:25, ambulatorio:false, ...(noNotti ? { noNotti:true } : {}) });
const cella = (...tipi:string[]) => ({ t: tipi.map(tipo=>({ tipo, sott:false, man:false })) });

describe("piano festivi: stesso sorteggio dello strumento originale", () => {
  const rif = JSON.parse(fs.readFileSync("src/engine/__tests__/fixtures/pianoFestivi_riferimento.json", "utf8"));
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
    expect(t.find(s=>s.date==="2027-12-24" && s.tipo==="diurno")!.points).toBe(1);   // vigilia: solo diurno
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
    3: { 25: cella("P"), 24: cella("M","P") },                 // mezza giornata di Natale (1,5) + vigilia (1)
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
    expect(a.punti).toEqual({ 1:5, 2:2.5, 3:2.5, 4:3, 5:3 });
    expect(a.saldo).toEqual({ 1:2.5, 2:0, 3:0, 4:0.5, 5:0.5 });
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
