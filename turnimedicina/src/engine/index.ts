// ─── API PUBBLICA DEL MOTORE ──────────────────────────────────────────────────
// Tutto ciò che sta sotto src/engine/ è puro: zero dipendenze da React, DOM e
// localStorage. È quindi testabile con Vitest in ambiente node e spostabile in
// un Web Worker senza modifiche (basta importare da questo file).
export * from "./types";
export { MESI, DL, DF, calcPasqua, holSet, isHol, dowOf, dimOf, isSabN, isDomN, isFestivo, mkKey } from "./date";
export { isMatt, isPom, isNot, vt, SPEC, cloneT, cloneTDeep, pulisciT } from "./turni";
export { REGOLE_DEFAULT, mergeRegole, setRegole, getRegole } from "./regole";
export { ENG, setPrevContext, setAmbRotStart, setSalt, mkRng, shuf } from "./state";
export { makeCtx, type Ctx } from "./ctx";
export { validazioneGlobale, riequilibraWeekendLiberi, riequilibraCaricoWeekend, riparaBuchi } from "./fasi";
export { diagnosiStatica, type DiagnosiStatica, type CertCella, type CertGiorno, type CertMese } from "./diagnosi";
export { diagnosiCausale } from "./diagnosiCausale";
export {
  generaCoperturaMinima, generaConUltimaChance, generaMigliorTentativo,
  cercaMigliorTentativo, rifinituraFinale, misuraTabellone, type MisuraTab, type OpzioniCerca,
  completaObiettivi, riempimentoEmergenza, problemiResidui, buchiCopertura,
  scoreCopertura, scegliMigliore, calcAmbRotNext,
} from "./genera";
