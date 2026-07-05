import ExcelJS from "exceljs";
import type { Medico, TurniMese } from "../engine/types";
import { MESI, dowOf, isFestivo } from "../engine/date";
import { LOGO_PNG_BASE64 } from "./logo";

// ─── EXPORT EXCEL ─────────────────────────────────────────────────────────────
// Migrato da xlsx-js-style a ExcelJS (v0.3.2): xlsx-js-style non supporta
// l'inserimento di immagini, quindi il logo dell'intestazione non era
// riproducibile. ExcelJS inoltre scrive bordi affidabili su tutte le celle e
// permette di impostare il layout di stampa (orizzontale, adatta a 1 pagina),
// che prima mancava del tutto: era la causa della stampa spezzata/senza bordi.
//
// Layout identico al modello dell'ospedale: banner "Scuola Medica Salernitana"
// sulla fascia alta, intestazione testuale, griglia completamente bordata,
// colonne festivi/domeniche in arancione.

const ORANGE = "FFFFC000";
const THIN: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FF000000" } };
const BORD: Partial<ExcelJS.Borders> = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const DL_IT = ["L", "M", "M", "G", "V", "S", "D"];

// Costruisce il workbook (separato dal download per poterlo testare in Node).
export function costruisciWorkbook(anno: number, mese: number, nd: number, medici: Medico[], turni: TurniMese): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Foglio1", {
    pageSetup: {
      paperSize: 9,                 // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.2, right: 0.2, top: 0.4, bottom: 0.4, header: 0.3, footer: 0.3 },
    },
  });

  // ---------- righe (stesso impianto del modello, 1-based in ExcelJS) ----------
  // r1: fascia logo · r2-r4: intestazione testuale · r5: spaziatore ·
  // r6: MEDICINA · r7: anno + numeri giorno · r8: mese + lettere giorno · r9+: medici
  const hdr = [
    "Azienda Ospedaliero-Universitaria  ",
    "San Giovanni di Dio e Ruggi d\u2019Aragona  -  Salerno",
    "Presidio Ospedaliero \u201cSanta Maria Incoronata dell\u2019Olmo\u201d",
  ];
  hdr.forEach((t, i) => {
    const cell = ws.getCell(2 + i, 17);           // colonna Q, come nel modello
    cell.value = t;
    cell.font = { name: "Arial", size: 12 };
    cell.alignment = { horizontal: "left" };
  });
  const med = ws.getCell(6, 1);
  med.value = "MEDICINA";
  med.font = { name: "Arial", size: 12, bold: true };

  const R_NUM = 7, R_DOW = 8, FIRST_MED = 9;
  ws.getCell(R_NUM, 1).value = anno;
  ws.getCell(R_DOW, 1).value = MESI[mese].toLowerCase();
  for (let g = 1; g <= nd; g++) {
    ws.getCell(R_NUM, 1 + g).value = g;
    ws.getCell(R_DOW, 1 + g).value = DL_IT[dowOf(anno, mese, g)];
  }
  medici.forEach((m, i) => {
    const r = FIRST_MED + i;
    ws.getCell(r, 1).value = m.nome + (m.codice ? "  " + m.codice : "");
    for (let g = 1; g <= nd; g++) {
      const ts = (turni[m.id]?.[g]?.t || []).filter(s => s.tipo !== "X");
      if (ts.length > 0) ws.getCell(r, 1 + g).value = ts.map(s => s.tipo).join("+");
    }
  });
  const lastRow = FIRST_MED + medici.length - 1;

  // ---------- stili griglia: bordo su OGNI cella, font, fondo festivi ----------
  for (let r = R_NUM; r <= lastRow; r++) {
    const isDow = r === R_DOW, isMed = r >= FIRST_MED;
    for (let c = 1; c <= nd + 1; c++) {
      const cell = ws.getCell(r, c);
      cell.border = BORD;
      cell.font = (c === 1 || r === R_NUM || isDow)
        ? { name: "Arial", size: 12, bold: isDow }
        : { name: "Calibri", size: 12, bold: true };
      cell.alignment = { horizontal: (c === 1 && isMed) ? "left" : "center", vertical: "middle" };
      if (c >= 2 && isFestivo(anno, mese, c - 1))
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE } };
    }
  }

  // ---------- dimensioni ----------
  ws.getColumn(1).width = 26;
  for (let c = 2; c <= nd + 1; c++) ws.getColumn(c).width = 6.3;
  ws.getRow(1).height = 45;                      // fascia logo
  ws.getRow(5).height = 6;                       // spaziatore
  for (let r = R_NUM - 1; r <= lastRow; r++) ws.getRow(r).height = 23;

  // ---------- logo (ancorato alla fascia alta, dimensioni del modello) ----------
  // Nel template ufficiale l'immagine è mostrata a ~13.154.025 × 533.400 EMU
  // (≈ 1381 × 56 px). tl usa coordinate frazionarie 0-based di ExcelJS.
  const imgId = wb.addImage({ base64: LOGO_PNG_BASE64, extension: "png" });
  ws.addImage(imgId, { tl: { col: 0.2, row: 0.05 }, ext: { width: 1381, height: 56 } });

  // ---------- area di stampa ----------
  const lastColL = colLetter(nd + 1);
  ws.pageSetup.printArea = `A1:${lastColL}${lastRow}`;

  return wb;
}

function colLetter(n: number): string {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export async function esportaExcel(anno: number, mese: number, nd: number, medici: Medico[], turni: TurniMese): Promise<void> {
  const wb = costruisciWorkbook(anno, mese, nd, medici, turni);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `turni_${MESI[mese].toLowerCase()}_${anno}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
