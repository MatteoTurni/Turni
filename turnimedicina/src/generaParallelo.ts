// ─── GENERAZIONE PARALLELA SU WEB WORKER ──────────────────────────────────────
// Orchestratore attorno agli stessi mattoni del percorso sincrono:
//   1. spawna N worker (≈ core disponibili − 1, il main thread resta libero);
//   2. ogni worker esegue cercaMigliorTentativo con un saltSeed diverso →
//      N sequenze di semi DIVERSE, N regioni diverse dello spazio di ricerca;
//   3. il main thread RIVALUTA ogni tabellone ricevuto con misuraTabellone
//      (metro unico e locale: i punteggi dei worker sono solo informativi)
//      e tiene il vincitore;
//   4. sul vincitore esegue UNA SOLA volta rifinituraFinale (LNS, recupero
//      weekend, alternativa di ultima chance) — identica al percorso sincrono.
// Se Worker non è disponibile (o tutti falliscono) si ricade su
// generaMigliorTentativo: il motore resta la stessa identica libreria.
//
// NB su questo modulo: sta FUORI da src/engine/ di proposito — usa API del
// browser (Worker, navigator) e l'engine deve restare puro/testabile in node.
import type { Medico, TurniMese, Risultato } from "./engine/types";
import { generaMigliorTentativo, rifinituraFinale, misuraTabellone } from "./engine/genera";
import { getRegole } from "./engine/regole";
import { ENG } from "./engine/state";
import type { MsgAvvio } from "./genWorker";

export interface ProgressoGen { tentativi:number; s:number; workers:number }

export function generaParallelo(
  anno:number, mese:number, ndim:number, medici:Medico[], ex:TurniMese,
  maxMs=12000, onProgress?:(p:ProgressoGen)=>void,
): Promise<Risultato> {
  // Fallback: ambienti senza Worker (test node, browser antichi).
  if(typeof Worker === "undefined")
    return Promise.resolve(generaMigliorTentativo(anno, mese, ndim, medici, ex, maxMs));

  const nW = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  // Budget: la ricerca nei worker riceve quasi tutto il tempo; si riserva una
  // coda per la rifinitura (che sui mesi difficili include l'ultima chance).
  const msRicerca = Math.max(3000, maxMs - 2500);

  return new Promise<Risultato>((resolve) => {
    let bestT: TurniMese | null = null;
    let bestS = Infinity, bestSoft = Infinity;
    const tentPerW = new Array<number>(nW).fill(0);
    const workers: Worker[] = [];
    let chiusi = 0, risolto = false;

    // Rivaluta sul main thread e adotta se migliore (stesso metro di registra).
    const considera = (turni: TurniMese) => {
      const m = misuraTabellone(anno, mese, ndim, medici, turni);
      if(m.s < bestS || (m.s === bestS && m.soft < bestSoft)){ bestS=m.s; bestSoft=m.soft; bestT=turni; }
    };

    const concludi = () => {
      if(risolto) return; risolto = true;
      clearTimeout(guardia);
      for(const w of workers) w.terminate();
      // Nessun best (tutti i worker in errore) → percorso sincrono completo.
      if(!bestT){ resolve(generaMigliorTentativo(anno, mese, ndim, medici, ex, Math.min(4000, maxMs))); return; }
      resolve(rifinituraFinale(anno, mese, ndim, medici, ex, bestT, 2000));
    };
    // Guardia: se un worker non risponde (tab in background, throttling) non si
    // aspetta per sempre — si conclude col migliore raccolto fin lì.
    const guardia = setTimeout(concludi, msRicerca + 2500);

    for(let i=0; i<nW; i++){
      let w: Worker;
      try{
        w = new Worker(new URL("./genWorker.ts", import.meta.url), { type: "module" });
      }catch(_){ if(++chiusi>=nW) concludi(); continue; }
      workers.push(w);
      w.onmessage = (ev: MessageEvent) => {
        const d = ev.data as { tipo:string; turni?:TurniMese; tentativi?:number };
        if((d.tipo==="best" || d.tipo==="fine") && d.turni) considera(d.turni);
        if(d.tipo==="progresso" || d.tipo==="fine"){
          if(d.tentativi!=null) tentPerW[i]=d.tentativi;
          onProgress?.({ tentativi: tentPerW.reduce((a,b)=>a+b,0), s: bestS===Infinity?-1:bestS, workers: nW });
        }
        if(d.tipo==="fine" || d.tipo==="errore"){ if(++chiusi>=nW) concludi(); }
      };
      w.onerror = () => { if(++chiusi>=nW) concludi(); };
      const payload: MsgAvvio = {
        anno, mese, ndim, medici, ex,
        regole: getRegole(),
        prev: ENG.PREV,
        ambRot: ENG.AMB_ROT_START,
        // Seme di worker: costante golden-ratio × indice XOR rumore vero —
        // distinto per worker E per generazione.
        saltSeed: ((Math.imul(0x9E3779B9, i+1)>>>0) ^ ((Math.random()*0x100000000)>>>0))>>>0,
        maxMs: msRicerca,
      };
      w.postMessage(payload);
    }
  });
}
