import type { Medico, TurniMese, Regole } from "./types";
import { DF, dowOf, isSabN, isDomN, isFestivo } from "./date";
import { isMatt, isPom, isNot, SPEC } from "./turni";
import { getRegole } from "./regole";

// ─── DIAGNOSI STATICA (v0.3.10) ───────────────────────────────────────────────
// Certificati di IMPOSSIBILITÀ calcolati dai soli fatti IMMOVIBILI del mese:
// turni manuali, X, assenze, stati dei medici, regole correnti. Non guarda mai
// i turni automatici: il verdetto vale per QUALSIASI generazione, presente o
// futura, finché i manuali non cambiano.
//
// Principio di correttezza: la capacità viene sempre SOVRASTIMATA (si ignorano
// i vincoli multi-giorno del motore: distanza associati, max consecutivi,
// catene di notti, riposo dopo notti AUTOMATICHE, coda del mese precedente).
// Se perfino la capacità sovrastimata non basta, l'impossibilità è dimostrata.
// Il viceversa NON vale: una cella senza certificato può comunque risultare
// incopribile per interazioni fra giorni — quella è la parte EMPIRICA
// (DiagnosiGen, accumulata dal multi-tentativo in genera.ts).
//
// Modulo puro e in sola lettura: non modifica i turni, non tocca ENG, non
// influenza in alcun modo la generazione.

export interface CertCella  { g:number; f:"M"|"P"|"N"; disp:number; min:number; motivo:string }
export interface CertGiorno { g:number; richiesti:number; max:number; nomi:string[]; motivo:string }
export interface CertMese   { tipo:"notti"; richieste:number; capacita:number; motivo:string }
export interface DiagnosiStatica { celle:CertCella[]; giorni:CertGiorno[]; mese:CertMese[] }

const gLbl = (anno:number, mese:number, g:number) => `${DF[dowOf(anno,mese,g)].slice(0,3)} ${g}`;

export function diagnosiStatica(
  anno:number, mese:number, ndim:number, medici:Medico[], turni:TurniMese,
  regole?: Regole,
): DiagnosiStatica {
  const REG = regole ?? getRegole();
  const gt  = (id:number,g:number) => turni[id]?.[g]?.t || [];
  // SOLO manuali: i turni automatici non sono fatti immovibili.
  const man = (id:number,g:number) => gt(id,g).filter(s=>s.man);

  const dw   = (g:number) => dowOf(anno,mese,g);
  const isSp = (g:number) => isDomN(dw(g))||isFestivo(anno,mese,g);
  const isS  = (g:number) => isSabN(dw(g));
  const fb   = (g:number) => isSp(g)?REG.fabb.fest:isS(g)?REG.fabb.sab:REG.fabb.fer;

  const haX      = (id:number,g:number) => man(id,g).some(s=>s.tipo==="X");
  const assenza  = (id:number,g:number) => man(id,g).some(s=>["L","ANA","per11","104"].includes(s.tipo));
  // Notte manuale ai fini del riposo: come manNight in ctx, include il codice PS "3".
  const manNotte = (id:number,g:number) => g>=1 && man(id,g).some(s=>isNot(s.tipo));
  const manMside = (id:number,g:number) => man(id,g).some(s=>isMatt(s.tipo));   // M, A, 1
  const manPside = (id:number,g:number) => man(id,g).some(s=>isPom(s.tipo));    // P, 2
  // Copertura del fabbisogno: contano SOLO i tipi esatti M/P/N (come cf in ctx),
  // di CHIUNQUE, MPS compresi.
  const covMan = (g:number,f:"M"|"P"|"N") =>
    medici.reduce((n,m)=>n+(man(m.id,g).some(s=>s.tipo===f)?1:0),0);
  // Compagni manuali per la regola MDC (stesse liste di mdcOk in ctx).
  const compagnoMan = (g:number, f:"M"|"P"|"N", escl:number) => medici.some(m=>{
    if(m.id===escl) return false;
    const COMP = f==="M"?["M","A","1"]:f==="P"?["P","2"]:["N","3"];
    return man(m.id,g).some(s=>COMP.includes(s.tipo));
  });

  // Opzioni statiche di UN medico in UN giorno (capacità sovrastimata: la
  // distanza degli associati e i vincoli multi-giorno automatici sono ignorati
  // DI PROPOSITO — vedi principio di correttezza in testa al file).
  type Opz = "M"|"P"|"MP"|"N";
  const opzioni = (m:Medico, g:number): Opz[] => {
    if(m.stato==="MPS") return [];                         // MPS: mai in generazione
    if(haX(m.id,g) || assenza(m.id,g)) return [];
    if(manNotte(m.id,g)) return [];                        // notte manuale oggi: giornata piena
    if(manNotte(m.id,g-1)) return [];                      // g+1 di una notte immovibile: riposo
    const noM = manNotte(m.id,g-2);                        // g+2 di una notte immovibile: M vietata
    if(noM && REG.riposoEsteso) return [];                 // riposo esteso: g+2 completamente libero
    const hasM = manMside(m.id,g), hasP = manPside(m.id,g);
    if(hasM && hasP) return [];                            // giornata già piena (anche 1+2, 1+P, M+2)
    if(hasM) return ["P"];                                 // completamento a giornata piena
    if(hasP) return noM ? [] : ["M"];
    if(m.stato==="ML") return (isSp(g)||noM) ? [] : ["M"]; // ML: solo mattine feriali/sabato
    if(m.stato==="MDC"){
      const okM = !noM && (fb(g).mMax>=2 || compagnoMan(g,"M",m.id));
      const okP = fb(g).pMax>=2 || compagnoMan(g,"P",m.id);
      const okN = compagnoMan(g,"N",m.id);                 // MDC di notte solo con un "3"/N altrui
      const out:Opz[]=[]; if(okM) out.push("M"); if(okP) out.push("P");
      if(okM&&okP) out.push("MP"); if(okN) out.push("N");
      return out;
    }
    return noM ? ["P","N"] : ["M","P","MP","N"];           // MR
  };

  const celle:  CertCella[]  = [];
  const giorni: CertGiorno[] = [];

  for(let g=1; g<=ndim; g++){
    const needM = Math.max(0, fb(g).mMin - covMan(g,"M"));
    const needP = Math.max(0, fb(g).pMin - covMan(g,"P"));
    const needN = Math.max(0, 1          - covMan(g,"N"));
    const tot = needM+needP+needN;
    if(tot===0) continue;
    const attivi = medici.filter(m=>opzioni(m,g).length>0);
    const nomi = attivi.map(m=>m.nome.split(" ").pop() as string);

    // ── Certificato di CELLA: disponibili per la singola fascia < minimo ──
    const dispF = (f:"M"|"P"|"N") =>
      attivi.filter(m=>opzioni(m,g).some(o=>o===f||(f!=="N"&&o==="MP"))).length;
    for(const [f,need] of [["M",needM],["P",needP],["N",needN]] as ["M"|"P"|"N",number][]){
      if(need<=0) continue;
      const d = dispF(f);
      if(d < need){
        const FL = { M:"le mattine", P:"i pomeriggi", N:"la notte" }[f];
        celle.push({ g, f, disp:d, min:need, motivo:
          d===0 ? `${gLbl(anno,mese,g)}: nessun medico disponibile per ${FL}`
                : `${gLbl(anno,mese,g)}: solo ${d} disponibil${d===1?"e":"i"} per ${FL} (ne servono ${need})` });
      }
    }

    // ── Certificato di GIORNATA: max copertura simultanea < slot richiesti ──
    // DP esatta sui medici: stato (m≤needM, p≤needP, n≤needN), ogni medico
    // sceglie una sola opzione (o nessuna). Stati ≤ 4·3·2: costo trascurabile.
    const key = (a:number,b:number,c:number)=>a*8+b*2+c;
    let best = new Map<number,number>([[key(0,0,0),0]]);
    for(const m of attivi){
      const next = new Map(best);
      for(const [k,v] of best){
        const a=Math.floor(k/8), b=Math.floor((k%8)/2), c=k%2;
        for(const o of opzioni(m,g)){
          const a2=Math.min(needM,a+(o==="M"||o==="MP"?1:0));
          const b2=Math.min(needP,b+(o==="P"||o==="MP"?1:0));
          const c2=Math.min(needN,c+(o==="N"?1:0));
          const k2=key(a2,b2,c2), v2=a2+b2+c2;
          if((next.get(k2)??-1) < v2) next.set(k2,v2);
        }
      }
      best = next;
    }
    const max = Math.max(...best.values());
    if(max < tot){
      const parti = [needM?`M${needM}`:"",needP?`P${needP}`:"",needN?`N1`:""].filter(Boolean).join("+");
      giorni.push({ g, richiesti:tot, max, nomi, motivo:
        `${gLbl(anno,mese,g)}: da generare ${tot} turni (${parti}), i ${attivi.length} medici disponibili (${nomi.join(", ")}) ne coprono al massimo ${max} — lo stesso medico non può fare giorno e notte insieme` });
    }
  }

  // ── Certificato MENSILE: capacità di NOTTI < notti da generare ─────────────
  const richieste = Array.from({length:ndim},(_,i)=>i+1).filter(g=>covMan(g,"N")===0).length;
  let capNotti = 0; const dett:string[]=[];
  for(const m of medici){
    if(m.stato==="MPS"||m.stato==="ML") continue;
    // giorni in cui il medico potrebbe staticamente fare la notte
    let gg = 0;
    for(let g=1;g<=ndim;g++) if(opzioni(m,g).includes("N") && covMan(g,"N")===0) gg++;
    // BUDGET RESIDUO (v0.3.11): le notti MANUALI già presenti (N e 3, anche
    // sottolineate — stessa semantica di cntN in ctx) consumano il tetto
    // maxNotti: al motore restano solo le rimanenti. Fatti immovibili → il
    // certificato resta una sovrastima corretta della capacità.
    let nMan = 0;
    for(let g=1;g<=ndim;g++) nMan += man(m.id,g).filter(s=>isNot(s.tipo)).length;
    const budget = Math.max(0, REG.maxNotti - nMan);
    const c = Math.min(budget, gg);
    capNotti += c;
    if(c<REG.maxNotti) dett.push(`${m.nome.split(" ").pop()} max ${c}${nMan?` (${nMan} nott${nMan===1?"e":"i"} manuali nel mese)`:""}${m.stato==="MDC"?" (MDC: serve un \u00AB3\u00BB in giornata)":""}`);
  }
  const mesi: CertMese[] = [];
  if(richieste > capNotti){
    mesi.push({ tipo:"notti", richieste, capacita:capNotti, motivo:
      `Notti da generare: ${richieste}, capacità massima ${capNotti} (maxNotti ${REG.maxNotti}/medico${dett.length?"; "+dett.join(", "):""}) — almeno ${richieste-capNotti} nott${richieste-capNotti===1?"e resterà scoperta":"i resteranno scoperte"}` });
  }

  return { celle, giorni, mese: mesi };
}
