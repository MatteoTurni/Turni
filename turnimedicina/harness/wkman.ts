// Esperimento: 6 turni weekend MANUALI a un MR → quanti slot weekend AUTO
// riceve comunque, e da quale meccanismo?
import { dimOf } from "../src/engine/date";
import { setRegole, REGOLE_DEFAULT } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { makeCtx } from "../src/engine/ctx";
import { generaMigliorTentativo } from "../src/engine/genera";
import type { Medico, TurniMese } from "../src/engine/types";

const medici = (): Medico[] => [
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

// Giugno 2026: weekend 6-7, 13-14, 20-21, 27-28.
// BALDI: 6 turni weekend inseriti a mano su 3 weekend.
const ex: TurniMese = { 1: {
  6:  { t:[{tipo:"M",sott:false,man:true}] },
  7:  { t:[{tipo:"M",sott:false,man:true}] },
  13: { t:[{tipo:"M",sott:false,man:true}] },
  14: { t:[{tipo:"P",sott:false,man:true}] },
  20: { t:[{tipo:"P",sott:false,man:true}] },
  21: { t:[{tipo:"P",sott:false,man:true}] },
}};

const anno=2026, mese=5, nd=dimOf(anno,mese);
const REPS=+(process.argv[2]||10);
let extra=0, scarti=0;
for(let rep=0; rep<REPS; rep++){
  setRegole(JSON.parse(JSON.stringify(REGOLE_DEFAULT)));
  ENG.PREV=null; setSalt(0); setAmbRotStart(rep%4);
  const r = generaMigliorTentativo(anno, mese, nd, medici(), JSON.parse(JSON.stringify(ex)), +(process.argv[3]||2500));
  const c = makeCtx(anno, mese, nd, medici(), r.turni);
  const righe = c.wkPortatori.map(m=>`${m.nome}:${c.cntWk(m.id)}(cap${c.wkCapacita(m)},pav${c.wkPavimento(m.id)})`).join(" ");
  // slot weekend AUTO di BALDI
  const autoWk: string[] = [];
  for(let g=1;g<=nd;g++) for(const s of (r.turni[1]?.[g]?.t||[]))
    if(!s.man && c.pesoSlot(g, s.tipo==="N"?"N":["M","A"].includes(s.tipo)?"M":s.tipo==="P"?"P":"M" as any)>0)
      autoWk.push(`g${g}:${s.tipo}`);
  const q = c.wkQuota()[1];
  if(autoWk.length) extra++;
  const sopra = c.cntWk(1) - (q?q.hi:0);
  if(sopra>0){
    scarti++;
    const { misuraTabellone, riequilibraCaricoWeekend } = await import("../src/engine/genera");
    const m0 = misuraTabellone(anno, mese, nd, medici(), r.turni);
    const copia = JSON.parse(JSON.stringify(r.turni));
    const c2 = makeCtx(anno, mese, nd, medici(), copia);
    const mig = riequilibraCaricoWeekend(anno, mese, nd, medici(), c2);
    const m1 = misuraTabellone(anno, mese, nd, medici(), copia);
    console.log(`   DEBUG sopra=${sopra} wkScartoPrima=${m0.wkScarto} equalizzatore=${mig} wkScartoDopo=${m1.wkScarto} cntWkBALDIdopo=${(()=>{const cc=makeCtx(anno,mese,nd,medici(),copia);return cc.cntWk(1);})()}`);
  }
  console.log(`#${rep} ok=${r.ok?1:0} BALDI cntWk=${c.cntWk(1)} banda=[${q?.lo},${q?.hi}] autoWkBALDI=[${autoWk.join(",")}] | ${righe}`);
}
console.log(`\nrun con slot weekend AUTO a BALDI: ${extra}/${REPS}; run con BALDI sopra banda: ${scarti}/${REPS}`);

// ── DEBUG: sui run "sopra banda", riprova l'equalizzatore a budget largo ──
export {};
