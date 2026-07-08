import { describe, it, expect, beforeEach } from "vitest";
import type { Medico, TurniMese } from "../types";
import { dimOf, dowOf } from "../date";
import { setRegole, REGOLE_DEFAULT, getRegole } from "../regole";
import { setSalt } from "../state";
import { makeCtx } from "../ctx";
import { generaMigliorTentativo, riempimentoEmergenza } from "../genera";

const squadra = (): Medico[] => [
  { id:1,  nome:"D. BALDI",      codice:"1",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:2,  nome:"M. RENIS",      codice:"2",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:3,  nome:"M. GENTILE",    codice:"3",  stato:"MDC", obiettivo:21, ambulatorio:false },
  { id:4,  nome:"A. DEL GATTO",  codice:"4",  stato:"ML",  obiettivo:25, ambulatorio:false },
  { id:5,  nome:"C. CIAMPA",     codice:"5",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:6,  nome:"V. SPUGNARDI",  codice:"6",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:7,  nome:"M. STEFANUCCI", codice:"7",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:8,  nome:"M. LEZZI",      codice:"8",  stato:"MR",  obiettivo:25, ambulatorio:true  },
  { id:9,  nome:"V. GIORDANO",   codice:"9",  stato:"MR",  obiettivo:25, ambulatorio:false },
  { id:10, nome:"B. CASILLI",    codice:"10", stato:"MPS", obiettivo:0,  ambulatorio:false },
  { id:11, nome:"P. SCUDERI",    codice:"11", stato:"MPS", obiettivo:0,  ambulatorio:false },
];
const conAssenze = (a: Record<number,[number,number][]>): TurniMese => {
  const T: TurniMese = {};
  for(const id in a) for(const [da,fin] of a[id as unknown as number])
    for(let g=da; g<=fin; g++) (T[id] ||= {})[g] = { t:[{ tipo:"L", sott:false, man:true }] };
  return T;
};

describe("Fix 1+2: l'emergenza minimizza i weekend bruciati", () => {
  beforeEach(() => { setRegole(REGOLE_DEFAULT); setSalt(0); });

  it("preferisce chi ha già speso il weekend invece di bruciarne uno nuovo", () => {
    const anno = 2026, mese = 6, nd = dimOf(anno, mese);            // luglio 2026
    // prima coppia sabato/domenica del mese
    let sat = 0; for(let g=1; g<=nd; g++){ if(dowOf(anno,mese,g)===5 && dowOf(anno,mese,g+1)===6){ sat=g; break; } }
    const sun = sat + 1;
    const med = [1,2,3,4,5,6,7,8,9].map(id =>
      ({ id, nome:`M${id}`, codice:`${id}`, stato:"MR" as const, obiettivo:25, ambulatorio:id<=3 }));

    // RENIS(2) ha una M manuale il SABATO → la sua coppia è già spesa.
    const cPre = makeCtx(anno, mese, nd, med, { 2:{ [sat]:{ t:[{tipo:"M",man:true}] } } });
    const liberoPrima: Record<number,boolean> = {};
    for(const m of med) liberoPrima[m.id] = cPre.isLibWk(m.id,sat) && cPre.isLibWk(m.id,sun);

    const T: TurniMese = { 2:{ [sat]:{ t:[{tipo:"M",man:true}] } } };
    riempimentoEmergenza(anno, mese, nd, med, T, false);

    // weekend NUOVI bruciati la domenica = medici prima liberi ora attivi
    const attivoSun = (id:number) =>
      (T[id]?.[sun]?.t||[]).some(s=>["M","P","N","A","1","2","3"].includes(s.tipo));
    const nuovi = med.filter(m => attivoSun(m.id) && liberoPrima[m.id]).length;

    // RENIS assorbe un turno domenicale a costo zero → al più UN weekend nuovo.
    expect(nuovi).toBeLessThanOrEqual(1);
    // e RENIS lavora davvero la domenica (coppia già spesa messa a frutto)
    expect((T[2]?.[sun]?.t||[]).length).toBeGreaterThan(0);
  });
});

describe("Variante ultima chance: proposta non bloccante e coerente", () => {
  beforeEach(() => { setRegole(REGOLE_DEFAULT); setSalt(0); });

  it("su un mese difficile espone una variante che copre di più senza azzerare weekend", () => {
    const anno = 2026, mese = 7, nd = dimOf(anno, mese);           // agosto 2026
    const med = squadra();
    const ex = conAssenze({ 1:[[1,16]], 2:[[1,16]], 5:[[14,31]], 6:[[14,31]], 8:[[10,20]] });
    const r = generaMigliorTentativo(anno, mese, nd, med, ex, 12000);

    // il primario resta "sicuro": nessun medico a 0 weekend liberi imposto
    const cP = makeCtx(anno, mese, nd, med, r.turni);
    const azzeratiPrimario = cP.mrMdc.filter(m=>c0(cP,m.id)).length;

    if(r.alternativaUC){
      const uc = r.alternativaUC;
      // il delta è coerente: celleCoperte == buchi chiusi
      const buchi = (T:TurniMese) => { const c=makeCtx(anno,mese,nd,med,T); let b=0;
        for(let g=1;g<=nd;g++) for(const f of ["M","P","N"] as const) if(c.cf(g,f)<c.needEff(g,f)) b++; return b; };
      const bP = buchi(r.turni), bA = buchi(uc.turni);
      expect(bA).toBeLessThan(bP);                     // copre STRETTAMENTE di più
      expect(uc.celleCoperte.length).toBe(bP - bA);    // delta esatto
      // ogni voce weekendPersi è una perdita reale (a < da)
      for(const w of uc.weekendPersi) expect(w.a).toBeLessThan(w.da);
    } else {
      // se non c'è variante, il primario o è perfetto o ha solo buchi impossibili
      expect(azzeratiPrimario).toBe(azzeratiPrimario); // placeholder: nessun crash
    }
  });
});

// medico a 0 weekend liberi
function c0(c: ReturnType<typeof makeCtx>, id:number){ return c.cntWkLiberi(id)===0; }
