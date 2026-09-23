# TurniMedicina v0.3.15 — Memoria condivisa su Cloudflare

## Installazione (UNA volta sola)

**Nel progetto**, partendo dalla 0.3.13:
- sostituisci `src/App.tsx` e `package.json`
- aggiungi `src/remote.ts` e `public/_worker.js` (con le loro cartelle)

**Su Cloudflare** (una volta sola):
1. Dashboard → Storage & Databases → KV → Create namespace (nome a piacere).
2. Progetto Pages → Settings → Bindings → Add → KV namespace:
   - Variable name: `TURNI` (esattamente così)
   - Namespace: quello appena creato

Poi fai un normale deploy (vedi sotto) e verifica: la pagina
`tuosito.pages.dev/api/stato` deve rispondere un JSON tipo
`{"stato":null,...}`. Se dice "KV non collegato", il binding manca oppure
il deploy è stato fatto prima di crearlo → rifai il deploy.

## Aggiornare l'app (ogni volta, ORA E IN FUTURO)

Identico a come hai sempre fatto:

1. `npm run build`
2. trascini `dist/` su Cloudflare Pages

Fine. Il file `_worker.js` finisce da solo dentro `dist/` perché sta in
`public/` (Vite copia tutto il contenuto di public/ nella build). I dati su
KV non si toccano mai: sopravvivono a ogni aggiornamento del sito.

## Uso quotidiano

- Colleghi: link normale → sola lettura, auto-aggiornamento ogni 60 s,
  export Excel disponibile.
- Tu: apri UNA volta `tuosito.pages.dev/#modifica` → quel browser resta in
  modalità modifica (con `#lettura` torni indietro). Non è una password, evita
  solo modifiche accidentali di chi consulta.
- Primo popolamento: apri `#modifica` sul browser dove hai sempre lavorato e
  tocca una cella qualsiasi → l'app pubblica il tuo stato su KV.

## Note

- Privacy: il link è apribile da chiunque lo riceva (nomi dei medici):
  giralo solo al reparto. Per protezione vera in futuro: Cloudflare Access.
- Offline o sviluppo locale (`npm run dev`): l'app funziona come sempre col
  solo localStorage.
- Concorrenza: ultimo-che-scrive-vince; con un solo responsabile in
  #modifica nessun problema.
