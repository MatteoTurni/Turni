// ═══════════════════════════════════════════════════════════════════════════
// REGRESSIONE A/B — stesso file eseguito su 0.3.29 pura e sulla build con le
// esclusioni parziali. Usa generaCoperturaMinima (deterministica a SALT fisso:
// l'unico Math.random del motore sta nel loop multi-tentativo, che qui non si
// attraversa), quindi due build funzionalmente identiche devono produrre
// tabelloni IDENTICI byte per byte. Scenari ripresi da harness/sim.ts.
// ═══════════════════════════════════════════════════════════════════════════
import type { Medico, TurniMese, Regole } from "../src/engine/types";
import { dimOf } from "../src/engine/date";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { generaCoperturaMinima, misuraTabellone } from "../src/engine/genera";
import * as crypto from "node:crypto";
import * as fs from "node:fs";

interface ScenCfg {
  nome: string; anno: number; mese: number; medici: Medico[]; ex: TurniMese;
  regole?: Partial<Regole>; prevT?: TurniMese | null;
}

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
  const snap = JSON.parse(fs.readFileSync("./scenario_agosto2026.json", "utf8"));
  S.push({ nome:"ago26-reale", anno:snap.anno, mese:snap.mese, medici:snap.medici, ex:snap.ex });
  S.push({ nome:"giu26-vuoto", anno:2026, mese:5, medici:mediciBase(), ex:{} });
  S.push({ nome:"mar26-ferie", anno:2026, mese:2, medici:mediciBase(),
           ex: conAssenze({1:[[2,8]], 5:[[9,15]], 7:[[16,22]], 9:[[9,15]]}) });
  S.push({ nome:"ago26-sint", anno:2026, mese:7, medici:mediciBase(),
           ex: conAssenze({1:[[1,15]], 2:[[10,24]], 5:[[16,31]], 7:[[1,15]], 9:[[16,31]]}) });
  S.push({ nome:"dic26-fest", anno:2026, mese:11, medici:mediciBase(),
           ex: conAssenze({2:[[21,31]], 7:[[24,31]], 1:[[28,31]]}) });
  S.push({ nome:"feb27-corto", anno:2027, mese:1, medici:mediciBase(), ex: conAssenze({5:[[8,14]]}) });
  S.push({ nome:"giu26-ridotto", anno:2026, mese:5,
           medici: mediciBase().filter(m=>![7,9].includes(m.id)), ex:{} });
  S.push({ nome:"lug26-noMPS", anno:2026, mese:6,
           medici: mediciBase().filter(m=>m.stato!=="MPS"), ex: conAssenze({2:[[6,19]]}) });
  S.push({ nome:"apr27-pasqua", anno:2027, mese:3, medici:mediciBase(),
           ex: conAssenze({1:[[1,11]], 6:[[1,11]]}) });
  S.push({ nome:"ago26-nLn", anno:snap.anno, mese:snap.mese, medici:snap.medici, ex:snap.ex,
           regole:{ notteLiberoNotte:true } });
  S.push({ nome:"giu26-ripEst", anno:2026, mese:5, medici:mediciBase(), ex:{}, regole:{ riposoEsteso:true } });
  S.push({ nome:"giu26-wk3", anno:2026, mese:5, medici:mediciBase(), ex:{}, regole:{ wkTarget:3 } });
  S.push({ nome:"giu26-amb3", anno:2026, mese:5, medici:mediciBase(), ex:{}, regole:{ ambulatori:[{ id:"A", nome:"Ambulatorio", sigla:"A", giorni:{ 0:"M", 2:"M", 4:"M" } }] } });
  S.push({ nome:"giu26-fabbAlto", anno:2026, mese:5, medici:mediciBase(), ex:{},
           regole:{ fabb:{ fer:{mMin:3,mMax:3,pMin:2,pMax:2}, sab:{mMin:2,mMax:2,pMin:1,pMax:1}, fest:{mMin:1,mMax:1,pMin:1,pMax:1} } as any } });
  {
    const prevT: TurniMese = { 1:{30:{t:[{tipo:"N",sott:false,man:true}]}}, 5:{29:{t:[{tipo:"N",sott:false,man:true}]}} };
    S.push({ nome:"lug26-prevN", anno:2026, mese:6, medici:mediciBase(), ex:{}, prevT });
  }
  {
    const med = mediciBase().map(m=>({...m, obiettivo: m.stato==="MPS"?0:15}));
    S.push({ nome:"giu26-obj15", anno:2026, mese:5, medici:med, ex:{} });
  }
  S.push({ nome:"set26-lungodeg", anno:2026, mese:8, medici:mediciBase(),
           ex: conAssenze({1:[[1,30]], 2:[[1,15]]}) });
  {
    const ex: TurniMese = {};
    const put=(id:number,g:number,tipo:string)=>{ (ex[id] ||= {})[g]={t:[...(ex[id]?.[g]?.t||[]),{tipo,sott:false,man:true}]}; };
    put(1,3,"N"); put(1,10,"N"); put(5,6,"N"); put(7,7,"M"); put(7,7,"P"); put(9,14,"N"); put(2,20,"N");
    put(6,12,"M"); put(6,12,"P");
    S.push({ nome:"ott26-manuali", anno:2026, mese:9, medici:mediciBase(), ex });
  }
  return S;
}

// ─── Firma canonica di un tabellone ──────────────────────────────────────────
function firma(T: TurniMese, ndim: number, medici: Medico[]): string {
  const parti: string[] = [];
  for(const m of [...medici].sort((a,b)=>a.id-b.id)){
    for(let g=1; g<=ndim; g++){
      const c = (T[m.id]?.[g]?.t || []).map(s=>`${s.tipo}${s.sott?"_":""}${s.man?"!":""}`).sort();
      if(c.length) parti.push(`${m.id}:${g}:${c.join("+")}`);
    }
  }
  return parti.join(";");
}

const SALTS = [1, 7, 13, 42, 99, 1234, 20260803, 777777];

const [,, outFile="/tmp/reg.json", from="0", to="99"] = process.argv;
const out: any[] = [];
const TUTTI = scenari();
for(const sc of TUTTI.slice(+from, +to)){
  const _t0 = Date.now();
  const ndim = dimOf(sc.anno, sc.mese);
  for(const salt of SALTS){
    setRegole(mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), ...(sc.regole||{}) } as any));
    ENG.PREV = sc.prevT ? { ndim: sc.mese===0?dimOf(sc.anno-1,11):dimOf(sc.anno,sc.mese-1), T: sc.prevT } : null;
    ENG.DEADLINE = 0;
    setSalt(salt); setAmbRotStart(salt % 4);
    const r = generaCoperturaMinima(sc.anno, sc.mese, ndim, sc.medici, sc.ex);
    const f = firma(r.turni, ndim, sc.medici);
    const m = misuraTabellone(sc.anno, sc.mese, ndim, sc.medici, r.turni);
    out.push({ scen: sc.nome, salt, ok: r.ok,
               hash: crypto.createHash("sha1").update(f).digest("hex").slice(0,16),
               s: m.s, buchi: m.buchi, wkDef: m.wkDef, wkScarto: m.wkScarto });
  }
  console.error(`  ${sc.nome} ${Date.now()-_t0}ms`);
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log("righe:", out.length, "→", outFile);
