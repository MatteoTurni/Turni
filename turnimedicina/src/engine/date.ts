// ─── UTILITY DATE (pure, zero dipendenze) ─────────────────────────────────────
export const MESI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
                     "Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
export const DL = ["L","M","M","G","V","S","D"];
export const DF = ["Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato","Domenica"];

// Festività nazionali italiane — calcolate DINAMICAMENTE per ogni anno, così al
// cambio dell'anno i festivi (oltre alle domeniche, già gestite da isDomN)
// restano corretti. Le feste a data fissa sono uguali ogni anno; il Lunedì
// dell'Angelo (Pasquetta) dipende dalla Pasqua ed è calcolato con l'algoritmo
// di Gauss/Meeus.
export function calcPasqua(y: number): Date {
  const a=y%19, b=Math.floor(y/100), c=y%100;
  const d=Math.floor(b/4), e=b%4, f=Math.floor((b+8)/25);
  const g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7;
  const mm=Math.floor((a+11*h+22*l)/451);
  const mese=Math.floor((h+l-7*mm+114)/31);   // 3 = marzo, 4 = aprile
  const giorno=((h+l-7*mm+114)%31)+1;
  return new Date(y, mese-1, giorno);          // Domenica di Pasqua
}

const _holCache: Record<number, Set<string>> = {};
export function holSet(y: number): Set<string> {
  if(_holCache[y]) return _holCache[y];
  const pad=(n:number)=>String(n).padStart(2,"0");
  const s=new Set([
    `${y}-01-01`, // Capodanno
    `${y}-01-06`, // Epifania
    `${y}-04-25`, // Liberazione
    `${y}-05-01`, // Festa del Lavoro
    `${y}-06-02`, // Festa della Repubblica
    `${y}-08-15`, // Ferragosto
    `${y}-11-01`, // Ognissanti
    `${y}-12-08`, // Immacolata Concezione
    `${y}-12-25`, // Natale
    `${y}-12-26`, // Santo Stefano
  ]);
  const p=calcPasqua(y);
  const lun=new Date(y, p.getMonth(), p.getDate()+1); // Lunedì dell'Angelo (Pasquetta)
  s.add(`${lun.getFullYear()}-${pad(lun.getMonth()+1)}-${pad(lun.getDate())}`);
  _holCache[y]=s;
  return s;
}

export function isHol(y:number,m:number,d:number){ return holSet(y).has(`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`); }
export function dowOf(y:number,m:number,d:number){ return (new Date(y,m,d).getDay()+6)%7; } // 0=Lun..6=Dom
export function dimOf(y:number,m:number)  { return new Date(y,m+1,0).getDate(); }
export function isSabN(n:number)   { return n===5; }
export function isDomN(n:number)   { return n===6; }
export function isFestivo(y:number,m:number,d:number){ return isHol(y,m,d)||isDomN(dowOf(y,m,d)); }

// Chiave del mese: "AAAA-MM" (mese 0-based → +1). I turni sono organizzati per
// mese proprio con questa chiave, così ogni mese ha il suo insieme di turni.
export function mkKey(y:number,m:number){ return `${y}-${String(m+1).padStart(2,"0")}`; }
