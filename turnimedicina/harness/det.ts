// Impronta DETERMINISTICA del motore: generaCoperturaMinima con SALT fissi,
// nessuna fase a tempo. Serve a provare che una modifica è un NO-OP a regole
// invariate: stessa impronta prima e dopo ⇒ nessuna deriva di comportamento.
import type { Medico } from "../src/engine/types";
import { dimOf } from "../src/engine/date";
import { setRegole, REGOLE_DEFAULT, mergeRegole } from "../src/engine/regole";
import { ENG } from "../src/engine/state";
import { generaCoperturaMinima, misuraTabellone } from "../src/engine/genera";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
const files = ["scenario_agosto2026.json","scenario_settembre2026.json"];
const out: string[] = [];
for(const f of files){
  const snap = JSON.parse(fs.readFileSync(f,"utf8"));
  const { anno, mese } = snap; const medici: Medico[] = snap.medici; const ndim = dimOf(anno,mese);
  for(const mc of [5,7]){
    setRegole(mergeRegole({ ...JSON.parse(JSON.stringify(REGOLE_DEFAULT)), maxConsec:mc } as any));
    ENG.PREV=null; ENG.BT=6; ENG.TRIES=3; ENG.CLUSTER_NODES=8000; ENG.REBAL_NODES=15000;
    for(let i=0;i<25;i++){
      ENG.SALT=(Math.imul(i+1,2654435761)>>>0);
      let r; try{ r=generaCoperturaMinima(anno,mese,ndim,medici,snap.ex);}catch(e){ out.push(`${f}/${mc}/${i} ERR`); continue; }
      const m = misuraTabellone(anno,mese,ndim,medici,r.turni);
      out.push(`${f}/${mc}/${i} s=${m.s} wk=${m.wkScarto} soft=${Math.round(m.soft)} `+
               crypto.createHash("sha1").update(JSON.stringify(r.turni)).digest("hex").slice(0,12));
    }
  }
}
const txt = out.join("\n");
console.log("righe:", out.length, "impronta:", crypto.createHash("sha1").update(txt).digest("hex").slice(0,16));
fs.writeFileSync(process.argv[2]||"/tmp/det.txt", txt);
