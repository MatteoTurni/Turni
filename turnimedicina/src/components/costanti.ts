// ─── COSTANTI DI PRESENTAZIONE ────────────────────────────────────────────────
// Colori per stato medico e per tipo di turno + elenchi dei tipi selezionabili.
// Sono dettagli della UI: il motore non li conosce.

export const SC: Record<string, { bg: string; t: string; b: string }> = {
  MR:  { bg:"#eff6ff", t:"#1d4ed8", b:"#bfdbfe" },
  ML:  { bg:"#fffbeb", t:"#b45309", b:"#fde68a" },
  MDC: { bg:"#ecfdf5", t:"#047857", b:"#a7f3d0" },
  MPS: { bg:"#faf5ff", t:"#7e22ce", b:"#e9d5ff" },
};

// Turni: pieni (fondo saturo, lettera bianca); gli automatici sono più chiari (opacità nel Badge).
export const KC: Record<string, { bg: string; t: string; b: string }> = {
  M:    { bg:"#2563eb", t:"#ffffff", b:"#2563eb" },
  P:    { bg:"#7c3aed", t:"#ffffff", b:"#7c3aed" },
  N:    { bg:"#059669", t:"#ffffff", b:"#059669" },
  A:    { bg:"#0d9488", t:"#ffffff", b:"#0d9488" },
  // Ambulatorio di POMERIGGIO: stesso verde acqua della A con bordo viola (fascia P).
  Ap:   { bg:"#0d9488", t:"#ffffff", b:"#7c3aed" },
  L:    { bg:"#d97706", t:"#ffffff", b:"#d97706" },
  "1":  { bg:"#2563eb", t:"#ffffff", b:"#1e40af" },
  "2":  { bg:"#7c3aed", t:"#ffffff", b:"#5b21b6" },
  "3":  { bg:"#059669", t:"#ffffff", b:"#065f46" },
  ANA:  { bg:"#ea580c", t:"#ffffff", b:"#ea580c" },
  "104":{ bg:"#dc2626", t:"#ffffff", b:"#dc2626" },
  per11:{ bg:"#ca8a04", t:"#ffffff", b:"#ca8a04" },
  art37:{ bg:"#c026d3", t:"#ffffff", b:"#c026d3" },   // Art.37 (v0.3.49)
  X:    { bg:"#e2e8f0", t:"#475569", b:"#cbd5e1" },
  // Esclusioni PARZIALI: tinta tenue della fascia che bloccano, così si
  // riconoscono a colpo d'occhio senza confondersi con un turno vero.
  Xm:   { bg:"#eff6ff", t:"#2563eb", b:"#bfdbfe" },
  Xp:   { bg:"#f5f3ff", t:"#7c3aed", b:"#ddd6fe" },
  Xn:   { bg:"#ecfdf5", t:"#059669", b:"#a7f3d0" },
};

// Tipi selezionabili nel CellModal e tipi che ammettono la variante sottolineata.
export const TM = ["M","P","N","L","A","Ap","1","2","3","104","ANA","per11","art37","X","Xm","Xp","Xn"];
// TS (v0.3.33): la N è sottolineabile come M e P — la variante sottolineata è
// lo STRAORDINARIO (lavoro reale che non scala l'obiettivo: vt=0), l'analogo
// per il reparto di quello che 1/2/3 sottolineati sono per il PS (ALPI).
export const TS = ["M","P","N","1","2","3"];
