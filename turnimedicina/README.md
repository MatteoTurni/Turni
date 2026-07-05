# TurniMedicina 0.3.0

Pianificazione turni per la U.O.C. Medicina Interna. Da questa versione il
progetto è un'app Vite + React + TypeScript modulare (prima: singolo TSX da
2300 righe).

## Avvio

```bash
npm install
npm run dev        # sviluppo su http://localhost:5173
npm run build      # build di produzione (tsc + vite)
npm test           # suite Vitest del motore (ambiente node, nessun browser)
```

## Struttura

```
src/
  engine/            MOTORE — puro: zero React, zero DOM, zero localStorage
    types.ts         tipi del dominio (Medico, Turno, TurniMese, Regole, ...)
    date.ts          festivi dinamici (Pasqua Gauss/Meeus), dowOf/dimOf, mkKey
    turni.ts         isMatt/isPom/isNot/vt, SPEC, cloneT/pulisciT
    regole.ts        REGOLE_DEFAULT, mergeRegole, setRegole/getRegole
    state.ts         ENG (sale, budget, PREV, rotazione amb.), mkRng/shuf
    ctx.ts           makeCtx: guardie, Regola N, contatori, undo-log
    fasi.ts          Critici, Ambulatorio, Weekend, Notti, Diurni, validazione
    genera.ts        orchestratore, ultima chance, multi-tentativo, obiettivi
    index.ts         API pubblica (import unico anche per un futuro Worker)
    __tests__/       suite Vitest (invarianti su mesi sintetici)
  storage.ts         UNICO punto che tocca localStorage (stato, regole, rotazione)
  export/excel.ts    export .xlsx (xlsx-js-style ora è una dipendenza, non CDN)
  components/        Badge, CellModal, DocModal, CovDots, costanti colore
  App.tsx            shell UI (calendario, medici, regole)
```

## Cosa è cambiato rispetto a 0.2.9

### 1. Motore isolato (iniezione delle dipendenze)

Il motore non legge più nulla da solo: la UI gli inietta tutto prima di ogni
generazione.

- **Regole**: `setRegole(loadRegole())` al bootstrap e a ogni modifica dal
  pannello. `makeCtx` le legge a ogni creazione di contesto, come prima.
- **Continuità mese precedente**: `setPrevContext(turniAll, anno, mese)`
  (invariato nella sostanza, ora in `engine/state.ts`).
- **Rotazione ambulatorio**: `faseAmbulatorio` non legge/scrive più
  localStorage ad ogni assegnazione. La UI passa l'indice di partenza con
  `setAmbRotStart()`; a generazione conclusa ricalcola l'indice successivo
  **dal solo tabellone accettato** con `calcAmbRotNext()` e lo persiste.
  Effetto collaterale voluto: i tentativi scartati dal multi-tentativo non
  fanno più avanzare la rotazione (prima avanzava decine di volte per ogni
  click di ①, iniquamente).

L'isolamento è verificato in modo formale: il typecheck del motore usa solo
`lib: ["ES2020"]` — qualunque riferimento a DOM/localStorage non compilerebbe.

### 2. Suite di test (Vitest, `npm test`)

- `base.test.ts` — Pasqua/festivi per anni noti, mergeRegole, vt, cloneT.
- `ctx.test.ts` — contatori incrementali vs ricalcolo brute-force dopo 500
  mutazioni casuali; mark/rollback e snapshot/restore (inclusa la validità dei
  mark dopo un restore); Regola N stretta/rilassata, continuità di bordo,
  guardie di `add()`.
- `genera.test.ts` — invarianti su mesi sintetici con validatori
  **indipendenti** (non riusano il codice del ctx): giugno pieno → `ok:true` e
  tutti gli invarianti; marzo con 2 settimane di ferie sfalsate → copertura
  piena; **agosto difficile** (5 medici via, quindicine sovrapposte) → vincoli
  duri sempre rispettati e `ok` coerente con la validazione stretta
  (regressione del fix 4); continuità N a cavallo di mese; completaObiettivi;
  calcAmbRotNext.
- `storage.test.ts` — migrazione MP/AP.

### 3. Performance del motore

Due cambi strutturali in `makeCtx`, semantica invariata:

- **Contatori incrementali**: `cnt(id)`, `cntN(id)` e ora anche `cf(g,f)` sono
  O(1), aggiornati dall'unico scrittore `st()` (e dal rollback). Prima
  `cnt` era O(31·turni) dentro ogni sort `byL` e `cf` O(medici·turni) in tutti
  i loop di riempimento.
- **Snapshot a undo-log**: `mark()`/`rollback(mark)` disfano solo le celle
  toccate (i ripristini "all'indietro" dei loop di retry, cioè quasi tutti).
  `snapshot()`/`restore(snap)` restano per i pattern non-LIFO (i `bestSnap`
  ripristinati "in avanti"): `snapshot()` è una `cloneT` strutturale veloce e
  `restore` applica un **diff via `st()`**, quindi resta registrato nel log,
  i mark precedenti restano validi e i contatori restano coerenti.
  Invariante su cui tutto poggia: gli array `t` delle celle sono immutabili
  (`st` sostituisce sempre l'intero array; mai mutazioni in place).

Misure nel container di sviluppo (stessi budget "stadio 1", stessa sequenza di
semi, 3 s a scenario): `generaCoperturaMinima` **×2–3 più veloce** (giugno
facile ~10→~20 run/s; agosto difficile ~36→~100 run/s) → il multi-tentativo
esplora 2–3 volte più configurazioni nello stesso tempo. Il profilo post-fix
mostra che il tempo va ormai in `canR`/`canN`/`mdcOk` (la ricerca vera):
rollback+restore <2%.

### 4. Fix: semantica "ok" coerente nell'ultima chance

In `generaConUltimaChance`, i problemi residui del ramo **rilassato** (passo B)
erano calcolati con `problemiResidui(..., relaxN=true)`: un tabellone che viola
la Regola N stretta (notte→libero→notte) poteva risultare `ok:true` e vincere
`scegliMigliore` contro un `rNorm` con un solo avviso di equità. Ora **entrambi
i rami sono giudicati con la validazione stretta** (`relaxN=false`); il
conteggio dei buchi di copertura, usato per decidere se adottare il ramo
rilassato, non cambia (non dipende da relaxN). Il rilassamento resta solo uno
strumento di *generazione* (`generaCoperturaMinima`, `riempimentoEmergenza`,
`recuperaWeekend`). Un tabellone rilassato adottato porta quindi con sé la voce
"Violazione Regola N", `ok:false` e l'avviso onesto in UI.

## Note di migrazione

- I dati in localStorage (chiavi `medicina_v26`, `medicina_regole_v1`,
  `medicina_amb_rotation`) sono riusati così come sono: nessuna migrazione.
- L'export Excel importa `xlsx-js-style` dal bundle (niente più CDN a runtime:
  funziona offline).
- Il motore è pronto per il Web Worker: basta importare da `src/engine` in un
  file worker e passare messaggi con `{anno, mese, ndim, medici, ex, regole,
  prev, ambRotStart}` → `setRegole/setPrevContext/setAmbRotStart` +
  `generaMigliorTentativo`.
- Verifica svolta senza rete: typecheck completo di engine/storage/export con
  tsc e test eseguiti in node. La parte JSX (App/componenti) è una trasposizione
  meccanica del TSX 0.2.9: alla prima `npm install` conviene un `npm run build`
  per il typecheck completo con `@types/react`.
