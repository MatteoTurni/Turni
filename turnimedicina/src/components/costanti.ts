// ─── COSTANTI DI PRESENTAZIONE ────────────────────────────────────────────────
// Colori per stato medico e per tipo di turno + elenchi dei tipi selezionabili.
// Sono dettagli della UI: il motore non li conosce.

export const SC: Record<string, { bg: string; t: string; b: string }> = {
  MR:  { bg:"#0a1628", t:"#60a5fa", b:"#1d4ed8" },
  ML:  { bg:"#2a1a06", t:"#fbbf24", b:"#b45309" },
  MDC: { bg:"#061a0e", t:"#34d399", b:"#059669" },
  MPS: { bg:"#1a0628", t:"#c084fc", b:"#7c3aed" },
};

export const KC: Record<string, { bg: string; t: string; b: string }> = {
  M:    { bg:"#0f2744", t:"#93c5fd", b:"#2563eb" },
  P:    { bg:"#1e1044", t:"#a78bfa", b:"#6d28d9" },
  N:    { bg:"#051a12", t:"#4ade80", b:"#16a34a" },
  A:    { bg:"#062010", t:"#6ee7b7", b:"#10b981" },
  A2:   { bg:"#042010", t:"#86efac", b:"#22c55e" },
  L:    { bg:"#261a02", t:"#fde68a", b:"#d97706" },
  "1":  { bg:"#0f2744", t:"#93c5fd", b:"#2563eb" },
  "2":  { bg:"#1e1044", t:"#a78bfa", b:"#6d28d9" },
  "3":  { bg:"#051a12", t:"#4ade80", b:"#16a34a" },
  ANA:  { bg:"#2a0e06", t:"#fb923c", b:"#c2410c" },
  "104":{ bg:"#2a0e06", t:"#fca5a5", b:"#dc2626" },
  per11:{ bg:"#261602", t:"#fde68a", b:"#ca8a04" },
  X:    { bg:"#111",    t:"#4b5563", b:"#1f2937" },
};

// Tipi selezionabili nel CellModal e tipi che ammettono la variante sottolineata.
export const TM = ["M","P","N","L","A","AII","A2","1","2","3","104","ANA","per11","X"];
export const TS = ["M","P","1","2","3"];
