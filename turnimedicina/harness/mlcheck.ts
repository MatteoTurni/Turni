import { dimOf } from "../src/engine/date";
import { SPEC } from "../src/engine/turni";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../src/engine/regole";
import { ENG, setSalt, setAmbRotStart } from "../src/engine/state";
import { generaMigliorTentativo } from "../src/engine/genera";
const med:any=[{id:1,nome:"BALDI",codice:"1",stato:"MR",obiettivo:25,ambulatorio:false},{id:2,nome:"RENIS",codice:"2",stato:"MR",obiettivo:25,ambulatorio:true},{id:3,nome:"GENTILE",codice:"3",stato:"MDC",obiettivo:21,ambulatorio:false},{id:4,nome:"DELGATTO",codice:"4",stato:"ML",obiettivo:25,ambulatorio:false},{id:5,nome:"CIAMPA",codice:"5",stato:"MR",obiettivo:25,ambulatorio:true},{id:6,nome:"SPUGNARDI",codice:"6",stato:"MR",obiettivo:25,ambulatorio:true},{id:7,nome:"STEFANUCCI",codice:"7",stato:"MR",obiettivo:25,ambulatorio:false},{id:8,nome:"LEZZI",codice:"8",stato:"MR",obiettivo:25,ambulatorio:true},{id:9,nome:"GIORDANO",codice:"9",stato:"MR",obiettivo:25,ambulatorio:false},{id:10,nome:"CASILLI",codice:"10",stato:"MPS",obiettivo:0,ambulatorio:false},{id:11,nome:"SCUDERI",codice:"11",stato:"MPS",obiettivo:0,ambulatorio:false}];
for(const mc of [7,6,5,4]){
  setRegole(mergeRegole({...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), maxConsec:mc} as any));
  ENG.PREV=null; setSalt(7); setAmbRotStart(1);
  const nd=dimOf(2026,5);
  const r=generaMigliorTentativo(2026,5,nd,med,{},6000);
  let run=0,mx=0,tot=0;
  for(let g=1;g<=nd;g++){ const c=r.turni[4]?.[g]?.t||[]; const lav=c.some((s:any)=>!SPEC.includes(s.tipo));
    if(lav){run++;mx=Math.max(mx,run);tot++;} else run=0; }
  console.log(`maxConsec=${mc}  ML mattine=${tot}  runMax=${mx}  obiettivo=25`);
}
