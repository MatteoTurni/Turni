// Valutatore UNIFORME: rilegge i turni salvati da sweep di motori diversi e
// li giudica tutti con QUESTO motore (metrica unica) + conteggi fisici.
import type { Medico, TurniMese, Regole } from "../src/engine/types";
import { dimOf } from "../src/engine/date";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../src/engine/regole";
import { ENG } from "../src/engine/state";
import { misuraTabellone } from "../src/engine/genera";
import * as fs from "node:fs";

interface ScenCfg {
  nome: string; anno: number; mese: number; medici: Medico[]; ex: TurniMese;
  regole?: Partial<Regole>; prevT?: TurniMese | null;
}
// ─── SCENARI ─────────────────────────────────────────────────────────────────
const mediciBase = (): Medico[] => [
  { id:1,  nome:"BALDI",      codice:"1",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:2,  nome:"RENIS",      codice:"2",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:3,  nome:"GENTILE",    codice:"3",  stato:"MDC", obiettivo:21, ambulatorio:false },
  { id:4,  nome:"DELGATTO",   codice:"4",  stato:"ML",  obiettivo:25, ambulatorio:false },
  { id:5,  nome:"CIAMPA",     codice:"5",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:6,  nome:"SPUGNARDI",  codice:"6",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:7,  nome:"STEFANUCCI", codice:"7",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:8,  nome:"LEZZI",      codice:"8",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:9,  nome:"GIORDANO",   codice:"9",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:10, nome:"CASILLI",    codice:"10", stato:"MPS", obiettivo:0,  ambulatorio:false },
  { id:11, nome:"SCUDERI",    codice:"11", stato:"MPS", obiettivo:0,  ambulatorio:false },
];
function conAssenze(assenze: Record<number,[number,number][]>, tipo="L"): TurniMese {
  const T: TurniMese = {};
  for(const idS in assenze){
    const id=+idS;
    for(const [da,a] of assenze[idS as any]){
      for(let g=da; g<=a; g++) (T[id] ||= {})[g] = { t:[{ tipo, sott:false, man:true }] };
    }
  }
  return T;
}

function scenari(): ScenCfg[] {
  const S: ScenCfg[] = [];
  // 1) reale agosto 2026 dallo snapshot dell'utente
  const snap = JSON.parse(fs.readFileSync("scenario_agosto2026.json", "utf8"));
  S.push({ nome:"ago26-reale", anno:snap.anno, mese:snap.mese, medici:snap.medici, ex:snap.ex });
  // 2) giugno 2026 pieno organico, nessuna assenza
  S.push({ nome:"giu26-vuoto", anno:2026, mese:5, medici:mediciBase(), ex:{} });
  // 3) marzo 2026 due settimane di ferie sfalsate
  S.push({ nome:"mar26-ferie", anno:2026, mese:2, medici:mediciBase(),
           ex: conAssenze({1:[[2,8]], 5:[[9,15]], 7:[[16,22]], 9:[[9,15]]}) });
  // 4) agosto 2026 sintetico difficile: quindicine sovrapposte, 5 medici via
  S.push({ nome:"ago26-sint", anno:2026, mese:7, medici:mediciBase(),
           ex: conAssenze({1:[[1,15]], 2:[[10,24]], 5:[[16,31]], 7:[[1,15]], 9:[[16,31]]}) });
  // 5) dicembre 2026: festivi di Natale + ferie
  S.push({ nome:"dic26-fest", anno:2026, mese:11, medici:mediciBase(),
           ex: conAssenze({2:[[21,31]], 7:[[24,31]], 1:[[28,31]]}) });
  // 6) febbraio 2027 (mese corto)
  S.push({ nome:"feb27-corto", anno:2027, mese:1, medici:mediciBase(), ex: conAssenze({5:[[8,14]]}) });
  // 7) organico ridotto: 2 MR in meno
  S.push({ nome:"giu26-ridotto", anno:2026, mese:5,
           medici: mediciBase().filter(m=>![7,9].includes(m.id)), ex:{} });
  // 8) luglio 2026 senza MPS in organico
  S.push({ nome:"lug26-noMPS", anno:2026, mese:6,
           medici: mediciBase().filter(m=>m.stato!=="MPS"), ex: conAssenze({2:[[6,19]]}) });
  // 9) aprile 2027 (Pasqua/Pasquetta) con ferie attorno a Pasqua
  S.push({ nome:"apr27-pasqua", anno:2027, mese:3, medici:mediciBase(),
           ex: conAssenze({1:[[1,11]], 6:[[1,11]]}) });
  // 10) regola notte-libero-notte attiva (agosto reale)
  S.push({ nome:"ago26-nLn", anno:snap.anno, mese:snap.mese, medici:snap.medici, ex:snap.ex,
           regole:{ notteLiberoNotte:true } });
  // 11) riposo esteso attivo
  S.push({ nome:"giu26-ripEst", anno:2026, mese:5, medici:mediciBase(), ex:{}, regole:{ riposoEsteso:true } });
  // 12) obiettivo 3 weekend liberi
  S.push({ nome:"giu26-wk3", anno:2026, mese:5, medici:mediciBase(), ex:{}, regole:{ wkTarget:3 } });
  // 13) ambulatorio 3 giorni a settimana
  S.push({ nome:"giu26-amb3", anno:2026, mese:5, medici:mediciBase(), ex:{}, regole:{ giorniAmb:[0,2,4] } });
  // 14) fabbisogno alto (3 mattine, 2 pomeriggi minimi nei feriali)
  S.push({ nome:"giu26-fabbAlto", anno:2026, mese:5, medici:mediciBase(), ex:{},
           regole:{ fabb:{ fer:{mMin:3,mMax:3,pMin:2,pMax:2}, sab:{mMin:2,mMax:2,pMin:1,pMax:1}, fest:{mMin:1,mMax:1,pMin:1,pMax:1} } as any } });
  // 15) continuità: notti manuali a fine mese precedente
  {
    const prevT: TurniMese = { 1:{30:{t:[{tipo:"N",sott:false,man:true}]}}, 5:{29:{t:[{tipo:"N",sott:false,man:true}]}} };
    S.push({ nome:"lug26-prevN", anno:2026, mese:6, medici:mediciBase(), ex:{}, prevT });
  }
  // 16) obiettivi bassi (part-time diffuso)
  {
    const med = mediciBase().map(m=>({...m, obiettivo: m.stato==="MPS"?0:15}));
    S.push({ nome:"giu26-obj15", anno:2026, mese:5, medici:med, ex:{} });
  }
  // 17) un MR assente tutto il mese + un altro mezzo mese
  S.push({ nome:"set26-lungodeg", anno:2026, mese:8, medici:mediciBase(),
           ex: conAssenze({1:[[1,30]], 2:[[1,15]]}) });
  // 18) manuali fitti: notti e associati pre-piazzati dall'utente
  {
    const ex: TurniMese = {};
    const put=(id:number,g:number,tipo:string)=>{ (ex[id] ||= {})[g]={t:[...(ex[id]?.[g]?.t||[]),{tipo,sott:false,man:true}]}; };
    put(1,3,"N"); put(1,10,"N"); put(5,6,"N"); put(7,7,"M"); put(7,7,"P"); put(9,14,"N"); put(2,20,"N");
    put(6,12,"M"); put(6,12,"P");
    S.push({ nome:"ott26-manuali", anno:2026, mese:9, medici:mediciBase(), ex });
  }
  return S;
}


const [,, inFile, outFile] = process.argv;
const rows = JSON.parse(fs.readFileSync(inFile, "utf8"));
const byName: Record<string, ScenCfg> = {};
for(const sc of scenari()) byName[sc.nome]=sc;
const out: any[] = [];
for(const r of rows){
  const sc = byName[r.scen];
  const ndim = dimOf(sc.anno, sc.mese);
  setRegole(mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), ...(sc.regole||{}) } as any));
  ENG.PREV = sc.prevT ? { ndim: sc.mese===0?dimOf(sc.anno-1,11):dimOf(sc.anno,sc.mese-1), T: sc.prevT } : null;
  const m = misuraTabellone(sc.anno, sc.mese, ndim, sc.medici, r.turni);
  out.push({ scen:r.scen, rep:r.rep, ms:r.ms, viol:r.viol.length,
             s:m.s, buchi:m.buchi, wkDef:m.wkDef, wkScarto:m.wkScarto,
             lavIso:m.lavIso, quickPM:m.quickPM,
             wkLibMin:r.wkLibMin, transMean:r.transMean, sforo:r.sforo });
}
fs.writeFileSync(outFile, JSON.stringify(out,null,1));
console.log("scritto", outFile, out.length, "righe");
