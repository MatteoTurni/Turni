// ─── PROVE "COSA SERVIREBBE" IN PARALLELO (v0.3.47) ──────────────────────────
// Le prove della diagnosi dei weekend liberi sono generazioni complete: in
// sequenza durerebbero ~20 s. Qui si distribuiscono su più worker (stesso
// genWorker della generazione), ognuno con la sua coda. Senza Worker si
// ripiega sul calcolo sequenziale a piccoli passi, per non bloccare la pagina.
import type { Medico, TurniMese } from "./engine/types";
import { getRegole } from "./engine/regole";
import { ENG } from "./engine/state";
import { specProveWeekend, eseguiProva, componiEsito, type EsitoProvaWeekend } from "./engine/diagnosiWeekend";
import type { MsgProva } from "./genWorker";

const RIPETIZIONI = 2, MS_PROVA = 2200;

export function provaWeekendParallelo(anno:number, mese:number, ndim:number, medici:Medico[], turni:TurniMese): Promise<EsitoProvaWeekend> {
  const t0 = Date.now();
  const spec = specProveWeekend(anno, mese, ndim, medici, turni, 4);
  const jobs = spec.flatMap((sp,i)=>Array.from({ length: RIPETIZIONI }, ()=>({ i, sp })));
  const ris: { deficit:number; buchi:number }[][] = spec.map(()=>[]);
  return new Promise(resolve => {
    let next = 0, fatti = 0, chiuso = false;
    const fine = () => { if(chiuso) return; chiuso = true; for(const w of workers) w.terminate(); resolve(componiEsito(spec, ris.map(r=>r.length?r:[{ deficit:Infinity, buchi:Infinity }]), Date.now()-t0)); };
    const workers: Worker[] = [];
    const nW = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    const seq = () => {                                   // ripiego senza Worker: un job per volta
      if(next>=jobs.length) return fine();
      const j = jobs[next++];
      ris[j.i].push(eseguiProva(anno, mese, ndim, medici, turni, j.sp, MS_PROVA));
      setTimeout(seq, 0);
    };
    const avvia = (w: Worker) => {
      if(next>=jobs.length) return;
      const job = next++;
      const msg: MsgProva = { tipo:"prova", anno, mese, ndim, medici, turni, regole:getRegole(), prev:ENG.PREV, ambRot:ENG.AMB_ROT_START, spec:jobs[job].sp, ms:MS_PROVA, job };
      w.postMessage(msg);
    };
    try{
      for(let k=0; k<nW; k++){
        const w = new Worker(new URL("./genWorker.ts", import.meta.url), { type: "module" });
        workers.push(w);
        w.onmessage = (ev: MessageEvent) => {
          const d = ev.data as { tipo:string; job:number; deficit?:number; buchi?:number };
          if(d.tipo==="provato") ris[jobs[d.job].i].push({ deficit:d.deficit!, buchi:d.buchi! });
          if(d.tipo==="provato" || d.tipo==="errore"){ if(++fatti>=jobs.length) fine(); else avvia(w); }
        };
        w.onerror = () => { if(++fatti>=jobs.length) fine(); else avvia(w); };
        avvia(w);
      }
    }catch(_){ for(const w of workers) w.terminate(); workers.length = 0; next = 0; setTimeout(seq, 0); return; }
    setTimeout(fine, 60000);                             // guardia
  });
}
