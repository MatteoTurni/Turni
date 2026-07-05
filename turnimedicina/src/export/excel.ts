import XLSX from "xlsx-js-style";
import type { Medico, TurniMese } from "../engine/types";
import { MESI, dowOf, isFestivo } from "../engine/date";

// ─── EXPORT EXCEL ─────────────────────────────────────────────────────────────
// xlsx-js-style (fork di SheetJS CON supporto agli stili) ora è una dipendenza
// del progetto: niente più caricamento da CDN a runtime (funziona anche offline
// e non dipende dalla disponibilità di jsdelivr). Layout identico al modello
// dell'ospedale: intestazione, griglia bordata, colonne festivi in arancione.

export function esportaExcel(anno: number, mese: number, nd: number, medici: Medico[], turni: TurniMese){
  const NCOL = nd + 1;                       // colonna A (nomi) + un giorno per colonna
  const enc  = (r:number,c:number) => XLSX.utils.encode_cell({ r, c });
  const thin = { style:"thin", color:{ rgb:"FF000000" } };
  const BORD = { top:thin, bottom:thin, left:thin, right:thin };
  const ORANGE = "FFFFC000";                 // festivi/domeniche, come nel modello
  const blank = (): (string|number|null)[] => new Array(NCOL).fill(null);
  const dlIt  = ["L","M","M","G","V","S","D"];

  // ---------- contenuti (AOA), stesso impianto del modello ----------
  const wsData: (string|number|null)[][] = [];
  wsData.push(blank());                                              // r0  (riga 1): fascia logo, alta e vuota
  const h1=blank(); h1[16]="Azienda Ospedaliero-Universitaria  "; wsData.push(h1);                                   // r1
  const h2=blank(); h2[16]="San Giovanni di Dio e Ruggi d\u2019Aragona  -  Salerno"; wsData.push(h2);                // r2
  const h3=blank(); h3[16]="Presidio Ospedaliero \u201cSanta Maria Incoronata dell\u2019Olmo\u201d"; wsData.push(h3); // r3
  wsData.push(blank());                                             // r4  (riga 5): spaziatore
  const rMed=blank(); rMed[0]="MEDICINA"; wsData.push(rMed);        // r5  (riga 6)

  const rNum=blank(); rNum[0]=anno;                                 // r6  (riga 7): anno + numeri giorno
  for(let g=1;g<=nd;g++) rNum[g]=g;
  wsData.push(rNum);

  const rDow=blank(); rDow[0]=MESI[mese].toLowerCase();             // r7  (riga 8): mese + lettere giorno
  for(let g=1;g<=nd;g++) rDow[g]=dlIt[dowOf(anno,mese,g)];
  wsData.push(rDow);

  const firstMed = wsData.length;                                   // r8+ : una riga per medico
  for(const med of medici){
    const row = blank();
    row[0] = med.nome + (med.codice ? "  " + med.codice : "");
    for(let g=1;g<=nd;g++){
      const ts = (turni[med.id]?.[g]?.t||[]).filter(s=>s.tipo!=="X");
      if(ts.length>0) row[g] = ts.map(s=>s.tipo).join("+");
    }
    wsData.push(row);
  }
  const lastRow = wsData.length - 1;

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!ref"] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:lastRow,c:NCOL-1} });

  // ---------- stili ----------
  const setStyle = (r:number,c:number,st:object) => { const ref=enc(r,c); if(!ws[ref]) ws[ref]={t:"s",v:""}; ws[ref].s=st; };

  // intestazione ospedale (righe 2-4, colonna Q)
  for(let r=1;r<=3;r++) setStyle(r,16,{ font:{name:"Arial",sz:12}, alignment:{horizontal:"left"} });
  // MEDICINA
  setStyle(5,0,{ font:{name:"Arial",sz:12,bold:true} });

  // griglia: numeri giorno (r6), lettere giorno (r7), righe medici → bordo, font, fondo festivi
  const GRID_TOP = 6;
  for(let r=GRID_TOP;r<=lastRow;r++){
    const isNum = (r===6), isDow = (r===7), isMed = (r>=firstMed);
    for(let c=0;c<=nd;c++){
      const festivo = c>=1 && isFestivo(anno,mese,c);
      let font;
      if(c===0)            font={name:"Arial",  sz:12, bold:isDow};   // colonna A (mese / nomi)
      else if(isNum||isDow)font={name:"Arial",  sz:12, bold:isDow};   // numeri / lettere giorno
      else                 font={name:"Calibri",sz:12, bold:true};    // celle turno
      const st: Record<string,unknown> = {
        font,
        border: BORD,
        alignment: { horizontal:(c===0 && isMed)?"left":"center", vertical:"center" },
      };
      if(festivo) st.fill = { patternType:"solid", fgColor:{ rgb:ORANGE } };
      setStyle(r,c,st);
    }
  }

  // ---------- dimensioni ----------
  ws["!cols"] = [{ wch:26 }, ...Array.from({length:NCOL-1},()=>({ wch:6.3 }))];
  const rows: {hpt:number}[] = [];
  rows[0] = { hpt:42 };                       // fascia logo
  rows[4] = { hpt:6 };                        // spaziatore
  for(let r=GRID_TOP;r<=lastRow;r++) rows[r] = { hpt:23 };
  ws["!rows"] = rows;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Foglio1");

  const wbout = XLSX.write(wb, { bookType:"xlsx", type:"array", cellStyles:true });
  const blob = new Blob([wbout], { type:"application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `turni_${MESI[mese].toLowerCase()}_${anno}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
