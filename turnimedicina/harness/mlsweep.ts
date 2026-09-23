import { dimOf } from "../src/engine/date";
import { SPEC } from "../src/engine/turni";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { generaMigliorTentativo } from "../src/engine/genera";
const med:any=[{id:1,nome:"BALDI",codice:"1",stato:"MR",obiettivo:25,ambulatorio:false},{id:2,nome:"RENIS",codice:"2",stato:"MR",obiettivo:25,ambulatorio:true},{id:3,nome:"GENTILE",codice:"3",stato:"MDC",obiettivo:21,ambulatorio:false},{id:4,nome:"DELGATTO",codice:"4",stato:"ML",obiettivo:25,ambulatorio:false},{id:5,nome:"CIAMPA",codice:"5",stato:"MR",obiettivo:25,ambulatorio:true},{id:6,nome:"SPUGNARDI",codice:"6",stato:"MR",obiettivo:25,ambulatorio:true},{id:7,nome:"STEFANUCCI",codice:"7",stato:"MR",obiettivo:25,ambulatorio:false},{id:8,nome:"LEZZI",codice:"8",stato:"MR",obiettivo:25,ambulatorio:true},{id:9,nome:"GIORDANO",codice:"9",stato:"MR",obiettivo:25,ambulatorio:false},{id:10,nome:"CASILLI",codice:"10",stato:"MPS",obiettivo:0,ambulatorio:false},{id:11,nome:"SCUDERI",codice:"11",stato:"MPS",obiettivo:0,ambulatorio:false}];
const run=(T:any,id:number,nd:number)=>{let r=0,mx=0;for(let g=1;g<=nd;g++){if((T[id]?.[g]?.t||[]).some((s:any)=>!SPEC.includes(s.tipo))){r++;mx=Math.max(mx,r);}else r=0;}return mx;};
const cntM=(T:any,id:number,nd:number)=>{let n=0;for(let g=1;g<=nd;g++)if((T[id]?.[g]?.t||[]).some((s:any)=>!SPEC.includes(s.tipo)))n++;return n;};
const MESI:[number,number][]=[[2026,5],[2026,7],[2026,11],[2027,1]];
for(const mc of [7,5,4,3]){
  for(const [a,me] of MESI){
    const nd=dimOf(a,me); const rows:string[]=[];
    for(const salt of [1,7,42,99]){
      setRegole(mergeRegole({...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), maxConsec:mc} as any));
      ENG.PREV=null; setSalt(salt); setAmbRotStart(salt%4);
      const r=generaMigliorTentativo(a,me,nd,med,{},5000);
      let altriMax=0; for(const m of med) if(m.stato!=="ML"&&m.stato!=="MPS") altriMax=Math.max(altriMax,run(r.turni,m.id,nd));
      rows.push(`s${salt}:ML(${cntM(r.turni,4,nd)}m,run${run(r.turni,4,nd)}) altri_run${altriMax}${altriMax>mc?" ⚠":""}`);
    }
    console.log(`mc=${mc} ${a}-${me+1}  ${rows.join("  ")}`);
  }
}
