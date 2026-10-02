import { describe, it, expect, afterEach } from "vitest";
import { setRegole, getRegole, mergeRegole, REGOLE_DEFAULT } from "../regole";
import { isHol, isFestivo } from "../date";
import { costruisciWorkbook } from "../../export/excel";

// ── SCHEDA REPARTO (v0.3.44) ─────────────────────────────────────────────────
const dft = () => JSON.parse(JSON.stringify(REGOLE_DEFAULT));
afterEach(() => { setRegole(dft()); });

describe("scheda reparto nelle regole", () => {
  it("senza scheda (salvataggi vecchi) valgono i valori storici, patrono compreso", () => {
    const { reparto: _r, ...vecchie } = dft();
    const r = mergeRegole(vecchie);
    expect(r.reparto.unita).toBe("U.O.C. Medicina Interna");
    expect(r.reparto.siglaExcel).toBe("MEDICINA");
    expect(r.reparto.festiviLocali.map(f => f.data)).toEqual(["09-08"]);
    expect(r.reparto.logo).toBeUndefined();
  });
  it("sanifica: date non valide e doppioni scartati, logo non immagine scartato", () => {
    const r = mergeRegole({ ...dft(), reparto: { ...dft().reparto,
      logo: "javascript:alert(1)",
      festiviLocali: [{ data: "06-24", nome: "San Giovanni" }, { data: "06-24", nome: "doppio" }, { data: "13-01", nome: "x" }, { data: "1-5", nome: "y" }] } });
    expect(r.reparto.festiviLocali).toEqual([{ data: "06-24", nome: "San Giovanni" }]);
    expect(r.reparto.logo).toBeUndefined();
    expect(mergeRegole({ ...dft(), reparto: { ...dft().reparto, logo: "" } }).reparto.logo).toBe("");
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(mergeRegole({ ...dft(), reparto: { ...dft().reparto, logo: png } }).reparto.logo).toBe(png);
  });
});

describe("festività locali configurabili", () => {
  it("di default l'8 settembre è festivo (patrono storico)", () => {
    setRegole(dft());
    expect(isHol(2026, 8, 8)).toBe(true);
  });
  it("cambiando il patrono cambia il festivo, anche dopo che la data era già stata consultata", () => {
    setRegole(dft());
    expect(isHol(2026, 8, 8)).toBe(true);
    expect(isHol(2026, 8, 21)).toBe(false);
    setRegole({ ...dft(), reparto: { ...dft().reparto, festiviLocali: [{ data: "09-21", nome: "San Matteo" }] } });
    expect(isHol(2026, 8, 8)).toBe(false);
    expect(isHol(2026, 8, 21)).toBe(true);
    expect(isFestivo(2026, 8, 21)).toBe(true);
    setRegole({ ...dft(), reparto: { ...dft().reparto, festiviLocali: [] } });
    expect(isHol(2026, 8, 21)).toBe(false);
    expect(isHol(2026, 7, 15)).toBe(true);                 // i nazionali restano
  });
});

describe("Excel con la scheda reparto", () => {
  const medici = [{ id: 1, nome: "X. UNO", codice: "1", stato: "MR" as const, obiettivo: 25, ambulatorio: false }];
  it("intestazione e sigla dalla scheda; nessun logo se richiesto", () => {
    setRegole({ ...dft(), reparto: { ...dft().reparto, righeExcel: ["Ospedale Prova", "Seconda riga", ""], siglaExcel: "CARDIOLOGIA", logo: "" } });
    const wb = costruisciWorkbook(2026, 9, 31, medici, {});
    const ws = wb.getWorksheet("Foglio1")!;
    expect(ws.getCell(2, 1).value).toBe("Ospedale Prova");
    expect(ws.getCell(3, 1).value).toBe("Seconda riga");
    expect(ws.getCell(6, 1).value).toBe("CARDIOLOGIA");
    expect(ws.getImages().length).toBe(0);
  });
  it("logo predefinito di default", () => {
    setRegole(dft());
    const ws = costruisciWorkbook(2026, 9, 31, medici, {}).getWorksheet("Foglio1")!;
    expect(ws.getCell(6, 1).value).toBe("MEDICINA");
    expect(ws.getImages().length).toBe(1);
  });
});
