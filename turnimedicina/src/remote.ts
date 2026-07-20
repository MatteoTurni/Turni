import type { Regole } from "./engine/types";
import type { StatoSalvato } from "./storage";

// ─── REMOTE (v0.3.15 — Cloudflare) ────────────────────────────────────────────
// UNICO punto dell'app che tocca la rete. Sincronizza lo stato con l'endpoint
// /api/stato servito dallo STESSO sito su Cloudflare Pages (vedi _worker.js o
// functions/api/stato.ts), che legge/scrive su Workers KV.
//
// Niente da configurare qui: stesso dominio → niente URL, niente chiavi API.
//
// Modalità:
//   • default → SOLA LETTURA in UI (il tabellone si vede, non si tocca).
//   • aprire una volta il link con "#modifica" in fondo → questo browser passa
//     in modalità modifica (memorizzata in localStorage, il tag sparisce
//     dall'URL). Con "#lettura" si torna indietro.
//   NB: non è una protezione — chiunque conosca il trucco può modificare.
//   Serve solo a evitare modifiche accidentali di chi consulta.
//
// In sviluppo locale (vite, senza /api) le fetch falliscono in silenzio e
// l'app si comporta come sempre col solo localStorage.

const API = "/api/stato";

export const remotoConfigurato = () => true;

// ── Modalità modifica ────────────────────────────────────────────────────────
const SK_EDIT = "medicina_modifica";
let edit = false;
try{
  let hash = location.hash;
  if(/[#&]modifica\b/.test(hash)){ localStorage.setItem(SK_EDIT,"1"); hash = hash.replace(/[#&]modifica\b/,""); }
  if(/[#&]lettura\b/.test(hash)) { localStorage.removeItem(SK_EDIT);  hash = hash.replace(/[#&]lettura\b/,"");  }
  if(hash !== location.hash)
    history.replaceState(null, "", location.pathname + location.search + (hash==="#"?"":hash));
  edit = localStorage.getItem(SK_EDIT) === "1";
}catch{ edit = true; /* ambienti senza localStorage: non si blocca nulla */ }

/** true → questo browser è in modalità modifica (link #modifica aperto almeno una volta). */
export const puoModificare = () => edit;

// ── Dati ─────────────────────────────────────────────────────────────────────
export interface DatiRemoti {
  stato?:  StatoSalvato;
  regole?: Partial<Regole>;
  ambRot?: { nextIdx: number };
}

/** Scarica lo stato condiviso. null = endpoint assente / rete giù (fallback locale). */
export async function caricaRemoto(): Promise<DatiRemoti | null> {
  try{
    const r = await fetch(API, { headers: { "Accept": "application/json" } });
    if(!r.ok) return null;
    const j = await r.json();
    const out: DatiRemoti = {};
    if(j.stato)  out.stato  = j.stato as StatoSalvato;
    if(j.regole) out.regole = j.regole as Partial<Regole>;
    if(j.ambRot) out.ambRot = j.ambRot as { nextIdx:number };
    return out;
  }catch{ return null; }
}

// ── Scrittura con debounce per riga ──────────────────────────────────────────
// Le modifiche in UI arrivano a raffica (ogni click su una cella salva tutto):
// si accorpa e si spedisce al massimo una richiesta per riga ogni 800 ms.
// (Il piano gratuito di Workers KV ammette 1000 scritture/giorno: più che
// sufficienti, ma inutile sprecarle.)
const timers: Record<string, ReturnType<typeof setTimeout>> = {};
const pendenti: Record<string, unknown> = {};

export function salvaRemoto(id: "stato"|"regole"|"ambRot", dati: unknown){
  if(!edit) return;
  pendenti[id] = dati;
  clearTimeout(timers[id]);
  timers[id] = setTimeout(async ()=>{
    try{
      await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, dati: pendenti[id] }),
      });
    }catch{ /* offline o dev locale: la copia in localStorage resta valida */ }
  }, 800);
}
