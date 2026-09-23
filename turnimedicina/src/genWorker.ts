// ─── WORKER DI GENERAZIONE ────────────────────────────────────────────────────
// Ogni worker è un thread con la PROPRIA copia dei moduli del motore (ENG,
// REGOLE, ...): niente stato condiviso, niente lock. La UI gli inietta via
// messaggio tutto ciò che sul main thread viene iniettato prima di generare
// (regole correnti, coda del mese precedente, rotazione ambulatorio) più un
// saltSeed UNICO per worker: entra nello XOR di ogni SALT del loop di ricerca,
// così K worker esplorano K sequenze di semi diverse — mai gli stessi tentativi.
//
// Protocollo (worker → main):
//   { tipo:"best",      turni, s, soft, buchi }   a ogni tabellone migliore
//   { tipo:"progresso", tentativi, s }            ogni ~25 tentativi
//   { tipo:"fine",      turni, tentativi, conteggi }  best finale del worker
//                                                 (conteggi: diagnosi empirica)
//   { tipo:"errore",    msg }                     eccezione irrecuperabile
//
// Secondo compito (v0.3.37): la RIFINITURA finale. Messaggio
//   { tipo:"rifinisci", ...contesto, bestT, cand }  →  { tipo:"rifinito", risultato }
// Prima girava sul thread principale e nei mesi difficili (riparazione,
// variante d'ultima chance, diagnosi causale) congelava la pagina per 4-7 s.
import { cercaMigliorTentativo, rifinituraFinale, rifinisciCandidati } from "./engine/genera";
import type { MisuraTab } from "./engine/genera";
import { setRegole } from "./engine/regole";
import { ENG } from "./engine/state";
import type { Medico, TurniMese, Regole } from "./engine/types";

export interface MsgRifinisci {
  tipo:"rifinisci";
  anno:number; mese:number; ndim:number;
  medici:Medico[]; ex:TurniMese;
  regole:Regole;
  prev: null | { ndim:number; T:TurniMese };
  ambRot:number;
  bestT:TurniMese;
  cand:{ turni:TurniMese; m:MisuraTab }[];
}

export interface MsgAvvio {
  anno:number; mese:number; ndim:number;
  medici:Medico[]; ex:TurniMese;
  regole:Regole;
  prev: null | { ndim:number; T:TurniMese };
  ambRot:number;
  saltSeed:number;
  maxMs:number;
}

// `self` in un module worker: si evita la lib "webworker" nel tsconfig con un
// cast locale — il file è comunque compilato da Vite come bundle separato.
const ws = self as unknown as { postMessage(m:unknown):void; onmessage: ((e:MessageEvent)=>void)|null };

ws.onmessage = (e: MessageEvent) => {
  if((e.data as { tipo?:string })?.tipo === "rifinisci"){
    const q = e.data as MsgRifinisci;
    try{
      setRegole(q.regole);
      ENG.PREV = q.prev ?? null;
      ENG.AMB_ROT_START = q.ambRot ?? 0;
      const res = rifinituraFinale(q.anno, q.mese, q.ndim, q.medici, q.ex, q.bestT, 2000);
      const out = rifinisciCandidati(q.anno, q.mese, q.ndim, q.medici, q.ex, q.bestT, q.cand, res, Date.now() + 1800);
      ws.postMessage({ tipo:"rifinito", risultato: out });
    }catch(err){
      ws.postMessage({ tipo:"errore", msg:String((err as Error)?.message ?? err) });
    }
    return;
  }
  const p = e.data as MsgAvvio;
  try{
    setRegole(p.regole);
    ENG.PREV = p.prev ?? null;
    ENG.AMB_ROT_START = p.ambRot ?? 0;
    const r = cercaMigliorTentativo(p.anno, p.mese, p.ndim, p.medici, p.ex, p.maxMs, {
      saltSeed: p.saltSeed,
      onMiglioramento: (turni, m) => ws.postMessage({ tipo:"best", turni, s:m.s, soft:m.soft, buchi:m.buchi }),
      onProgresso:     (tentativi, s) => ws.postMessage({ tipo:"progresso", tentativi, s }),
    });
    ws.postMessage({ tipo:"fine", turni:r.turni, tentativi:r.tentativi, conteggi:r.conteggi });
  }catch(err){
    ws.postMessage({ tipo:"errore", msg:String((err as Error)?.message ?? err) });
  }
};
