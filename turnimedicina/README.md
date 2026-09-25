# TurniMedicina 0.3.41

## Novità 0.3.41 — notti uguali fra gli MR anche nei mesi con molte assenze

Caso segnalato (ottobre 2026, molte assenze ed esclusioni): spesso un MR
finiva a 3 notti mentre altri a 5. Il riequilibrio notti (0.3.38) poteva
passare una notte al medico rimasto indietro solo se era libero, o cedendo il
suo turno di QUEL giorno; ma per fare la notte serve libero anche il giorno
dopo (riposo), e quasi sempre il ricevente lavorava. Ora:
- SCAMBIO COMPLETO: chi cede la notte si libera il giorno della notte e quello
  dopo, quindi prende i turni di giorno automatici del ricevente in quei due
  giorni (e la mattina del secondo giorno dopo, vietata dopo una notte).
  Copertura identica, ogni inserimento passa da tutte le regole;
- anche l'MDC può cedere la sua notte (fatta accanto a un «3» di un MPS) a un
  MR rimasto indietro di almeno una notte: una notte dell'MDC toglie una notte
  agli MR e poteva lasciarne uno a -1/-2.
Come prima, la mossa si tiene solo se copertura, regole, weekend e punteggio
non peggiorano.

Misurato: ottobre (`harness/ottobre.ts`, 10 generazioni) un MR a 3 notti in
9 generazioni su 10 → 0 su 10 (tutti a 4-5, forbice 1,8 → 1,0, il minimo);
120 mesi casuali (`harness/confronto.ts`) forbice notti fra MR 0,42 → 0,38,
pomeriggi 2,78 → 2,58, totali 3,97 → 3,88, nient'altro peggiora;
`harness/nottiregole.ts` 0 violazioni, copertura identica; fuzz 0 violazioni
nuove.


## Novità 0.3.40 — continuità delle mattine nei giorni senza ML

La regola "Continuità mattine (blocchi)" ora segue l'idea del reparto: nei
giorni in cui l'ML non fa la mattina (assenze, domeniche, festivi) UNA SOLA
CATENA di blocchi dà continuità. Il primo blocco parte dall'ultima mattina
dell'ML (lo affianca), ogni blocco dura ~N giorni e il successivo inizia
nell'ultimo giorno del precedente (passaggio di consegne), l'ultimo accompagna
la prima mattina dell'ML al rientro. Se il portatore si ferma all'improvviso,
entra di preferenza chi ha fatto la mattina o il pomeriggio del giorno prima;
se nessuno può, la catena riparte appena possibile. Prima: due corsie
sfalsate, aggancio all'ML e passaggio di consegne solo "se c'era spazio".

È un VALORE AGGIUNTO, mai un vincolo:
- la catena usa solo le mattine MINIME dei feriali (ML + catena ai bordi,
  uscente + entrante ai cambi): non aggiunge turni; weekend e festivi restano
  alla loro fase, la catena si adatta a chi vi fa la mattina;
- nel punteggio un passaggio senza continuità pesa poco (8, 4 se c'è almeno
  il pomeriggio del giorno prima), solo con la regola accesa;
- una rifinitura (`rifinisciContinuita`) sposta o scambia una mattina a favore
  di chi dà continuità SOLO se nient'altro peggiora: copertura, regole,
  weekend liberi, carico weekend, ogni altro termine del punteggio ed
  equilibrio mattine/pomeriggi fra gli MR.

Misurato (`harness/finale.ts`, 18 scenari × 4, tabellone completato, 0.3.39 →
0.3.40): nei giorni senza ML continuità piena 33% → 42%, nessuna continuità
50% → 42%; violazioni 0, buchi 1,32 → 1,22, carico weekend 1,01 → 0,99,
equilibrio M/P 4,18 → 4,06; weekend liberi mancanti 0,68 → 0,71 (solo nello
scenario con obiettivi insufficienti, dove il nuovo tabellone copre più celle:
buchi 14 → 12,5), giorni isolati 7,7 → 8,0 al mese. Esempio del reparto
(gennaio 2025, ML assente 8-9, 15-18, 20-21; `harness/catena.ts`): continuità
piena 11/19 → 14/19 passaggi.

Confronto con la 0.3.39 su 120 mesi CASUALI (`harness/confronto.ts`: squadra,
assenze dell'ML, ferie, esclusioni, manuali, regole e ambulatori variabili;
stessi semi, stesso tempo): continuità piena nei giorni senza ML 46,8% →
51,5% (migliora in 56 mesi, peggiora in 8), nessuna continuità 37,1% →
31,6%; invariati errori, buchi, weekend liberi (mancanti 1,73 → 1,69),
carico weekend (fuori forchetta 0,98 → 0,99; forbice fra MR 0,89 → 0,86),
weekend lavorati, notti, mattine/pomeriggi e obiettivi. Unico effetto
negativo: la forbice delle sole notti di sabato/domenica/festivi fra MR
1,21 → 1,27 (in 11 mesi su 120 +1 notte), compensata nel carico weekend
complessivo, che resta equilibrato.

Provati e scartati: preferenza di continuità dentro "Completa obiettivi"
(nessun effetto misurabile: le mattine feriali dei giorni senza ML sono già
della catena, le domeniche non le assegna) e peso della continuità più alto
(20-80: più continuità ma mattine/pomeriggi meno equilibrati; con anche
l'equilibrio M/P nel punteggio la continuità torna al livello di peso 8).


## Novità 0.3.39 — "Completa obiettivi": MR e MDC serviti a turno

Caso segnalato (gennaio 2026 vuoto): dopo "Completa obiettivi" un MR aveva 11
pomeriggi e 27/27 turni, un altro 5 pomeriggi e 17/27. Causa: gli MR venivano
riempiti uno alla volta fino all'obiettivo; nei mesi in cui i posti feriali
non bastano (e le mattine sono in gran parte di ML e MDC) il primo servito
prendeva quasi tutti i pomeriggi liberi e gli ultimi restavano indietro.
Ora, dopo l'ML (invariato, per primo), MR e MDC ricevono UN turno alla volta,
a chi è più lontano dal suo obiettivo: l'MDC è alla pari degli MR (prima era
servito per primo e arrivava a obiettivo a spese degli MR). Per gli MR la
fascia è scelta per equilibrio mattine/pomeriggi; l'MDC in questa passata fa
mattine, i pomeriggi da secondo medico nelle passate successive. Nessun turno
viene spostato.

MDC: alla pari invece che per primo o per ultimo (gennaio, obiettivo MR 27:
MR in media 20,9 / 21,7 / 22,3, MDC 20,7 / 15,3 / 11,0 su 21). "Per ultimo"
scartato: nei mesi con posti appena sufficienti lasciava posti inutilizzati
(le mattine andavano agli MR, all'MDC restavano pomeriggi in cui sarebbe
stato solo). Con obiettivi realistici per il mese (≤ 20 a gennaio) le tre
varianti danno lo stesso risultato: tutti a obiettivo.

Misurato: gennaio (`harness/gennaio.ts`, 4 generazioni) forbice dei
pomeriggi fra MR 8,5 → 2,5, dei totali 8,0 → 1,3, turni assegnati identici;
MR 21-23 su 27, MDC 14-16 su 21 (prima 17-27 e 20-21).
Tabellone finale (`harness/finale.ts`, 72 mesi, 0.3.38 → 0.3.39): forbice dei
totali MR 3,4 → 1,1, dei pomeriggi 4,2 → 2,2, scarto M/P 6,0 → 4,2, punti
sotto obiettivo MR 12,4 → 11,1, MDC 0,6 → 2,1; errori, buchi, weekend,
consegne P→M (43%) e continuità M→M (97,6%) invariati; blocchi di mattine
2,26 → 2,17.
Configurazioni casuali (180): 0 violazioni nuove. Test in `analisi038.test.ts`.


## Novità 0.3.38 — equità di notti e di mattine/pomeriggi fra gli MR

**Notti fra gli MR.** La fase notti sceglie prima il medico "meno vincolante"
(serve a coprire le notti difficili) e solo a parità quello con meno notti; il
punteggio misurava la varianza su MR+MDC, con l'MDC quasi sempre a 0 (fa la
notte solo accanto a un «3» di un MPS). Esito: fra MR presenti tutto il mese
capitava 3 contro 5 notti. Ora:
- il punteggio confronta le notti dei soli MR con la stessa quota per tutti
  (la media; le ferie non la spostano, per scelta del reparto) (`scartoNotti`);
- un passaggio di rifinitura (`riequilibraNotti`) sposta una notte automatica
  da chi è sopra quota a chi è sotto, direttamente o con uno scambio (il
  ricevente cede la sua M/P di quel giorno); ogni mossa rispetta tutte le
  regole e si tiene solo se copertura, weekend liberi ed equilibrio weekend
  non peggiorano.
Tabellone finale (18 scenari × 4): forbice di notti fra MR presenti tutto il
mese 1,17 → 0,75 per mese; `harness/nottiregole.ts` (tutte le combinazioni
delle regole della notte, 600 prove): 0 violazioni nuove, copertura identica.

**Rientri rapidi P→M neutri.** Dalla 0.3.28 il punteggio penalizzava (peso 4)
il pomeriggio seguito dalla mattina il giorno dopo, e la compattazione cercava
di eliminarlo. Per il reparto è un passaggio di consegne utile: peso 0.

**Equilibrio mattine / pomeriggi fra gli MR** (`riequilibraMP`, MDC e ML
esclusi). Due MR che lavorano lo stesso giorno feriale, uno
di mattina e l'altro di pomeriggio, si scambiano la fascia (A conta come
mattina, Ap come pomeriggio) se avvicina entrambi alla quota di mattine della
squadra: copertura, carichi e giorni lavorati identici. Scambio rifiutato se
viola regole, peggiora copertura/weekend/punteggio (blocchi di mattine
compresi) o spezza la continuità. Solo in generazione. Verifica sul tabellone finale (`harness/finale.ts`,
18 scenari × 4, 0.3.37 / senza scambio / con scambio): violazioni 0/0/0, buchi
e weekend invariati, scarto M/P 8,96 / 8,75 / 6,73, forbice della quota di
mattine fra MR 32% / 32% / 25%, continuità M→M 97,7 / 97,7 / 97,9%, giorni
isolati 9,3 / 9,5 / 9,6 al mese.

**"Completa obiettivi": fascia scelta per equilibrio.** Nessun turno viene
spostato; cambia solo la SCELTA al momento di assegnare. Prima ogni MR
riceveva solo mattine nella prima passata (i pomeriggi venivano dopo, per chi
restava indietro). Ora a ogni turno di un MR si sceglie la fascia in cui è più
indietro rispetto alla quota di mattine della squadra (poi l'altra, se non ci
sono posti legali), e i pomeriggi si danno di preferenza attaccati ad altri
giorni lavorati. Ordine dei medici, ML, MDC e passate successive invariati.
Tabellone finale (72 mesi, con scambio): scarto M/P 6,73 → 6,00, forbice
della quota di mattine 25% → 22%, giorni isolati 9,6 → 7,7 al mese, punti
sotto obiettivo degli MR 13,3 → 12,4; continuità M→M 97,9 → 97,7%, blocchi di
mattine 2,30 → 2,26; errori, buchi, weekend invariati.

Provato anche "a monte" (tetto alle mattine di ciascuno dentro "Completa
obiettivi", notti scelte prima per numero di notti): da solo riduce poco lo
squilibrio (mattine/pomeriggi -5%, notti 20,7 → 15,3 contro 11-12 del
riequilibrio) e sulle notti toccherebbe il criterio che apre le notti
difficili. Non adottato.

**MDC e pomeriggi.** Verificato che la possibilità dell'MDC di fare il
pomeriggio accanto a un collega è usata correttamente: in generazione l'MDC
non può coprire il minimo di un pomeriggio (1 medico: sarebbe solo), quindi
fa mattine (dove il minimo è 2 e conta davvero); nei weekend e festivi il
massimo è 1 per fascia, quindi niente pomeriggi salvo un «2» di un MPS. In
"Completa obiettivi" l'MDC prende pomeriggi come secondo medico (3-5 al mese
negli scenari di prova). Totale posti mancanti invariato: è il fabbisogno
massimo del pannello Regole a limitare, non l'MDC.

Regole della notte (`harness/nottiregole.ts`): `riequilibraNotti` provato con
tutte le combinazioni di max notti (3-6), notti di fila (1-3), notte-libero-
notte, riposo esteso e mattina dopo la notte, su 5 scenari (anche con notti
del mese precedente e notti manuali): 600 prove, 425 notti spostate, 0
violazioni nuove, copertura identica, manuali intatti.

Test: `analisi038.test.ts`. Harness: `harness/equita.ts`, `harness/nottiregole.ts`, `harness/mp.ts`, `harness/continuita.ts`, `harness/finale.ts`; gli scenari sono ora
in `harness/scenari.ts`, condivisi.

## Novità 0.3.37 — analisi di generazione e diagnosi

Revisione completa del motore di generazione e della diagnosi, con ogni
intervento misurato su `harness/sim.ts` (18 scenari × 3 ripetizioni, stessi
semi e stesso tempo, contro la 0.3.36; validatori indipendenti: 0 violazioni).

**Risultati complessivi** (54 generazioni, verifica finale): buchi di copertura
92 → 71, mesi perfetti 41 → 43, weekend liberi mancanti 39 → 35, tempo −21%,
violazioni 0 → 0. Costo: sforo obiettivi 25 → 35 punti totali e penalità
"soft" +2%, quasi tutti in `giu26-obj15` (obiettivi insufficienti: le celle in
più coperte finiscono a chi è già a obiettivo, e un buco vale più di uno
sforo). Nell'app la pagina non si congela più a fine generazione (da 5,8–8,7 s
a ~0,04 s).

**Verifica per ablazione**: ogni intervento della rifinitura è stato spento uno
alla volta. Il tappabuchi vale 10 buchi su 71, l'ambulatorio mobile 2 (caso
settembre con lunga assenza), `completaML` porta l'ML a 25/25 (senza: 15–23/25),
`sistemaMdcAmb` evita l'MDC solo con l'ambulatorio. Due micro-ottimizzazioni e
una modifica al punteggio dei tentativi, senza effetto misurabile, sono state
tolte. La generazione di base (`harness/det.ts`) dà un'impronta IDENTICA alla
0.3.36.

Motore:
- **Calendario memorizzato** (`date.ts`): giorno della settimana e festivi
  venivano ricalcolati milioni di volte (quasi metà del tempo nei mesi
  difficili). Generazione 2,2× più veloce, impronta deterministica IDENTICA.
- **Tappabuchi finale** (`tappaBuchi`): la riparazione per finestre è
  tutto-o-niente e lasciava giorni interi vuoti ai bordi del mese pur con
  medici disponibili. Ora le celle coperibili si coprono una a una, senza mai
  togliere weekend liberi a nessuno (quelle coperture restano all'ultima chance).
- **Ambulatorio riassegnabile nella riparazione**: se il titolare della A è
  l'unico che chiuderebbe un buco, `riparaBuchi` prova a spostare la A a un
  altro abilitato (settembre con lunga assenza: 3 buchi → 0).
- **"Max turni associati / settimana" è una regola vera**: prima era solo una
  preferenza di una fase, con settimane a blocchi di 7 giorni dal giorno 1
  (con limite 1, 4 tabelloni su 5 lo superavano). Ora vale per ogni
  inserimento, su settimane lunedì–domenica, ed è segnalata in validazione.
- Predicato unico `ambAssegnabile` per fase ambulatorio, riparazione e diagnosi.
- Correzioni: `restore` ignorava l'ambulatorio di A/Ap; il "miglior parziale"
  contava A/Ap e codici PS come copertura di reparto.

Diagnosi:
- **Mai più verdetti "strutturali" non verificati**: se il tempo finiva, la
  diagnosi ripiegava su "mancano materialmente i medici" (falso con obiettivi
  insufficienti). Il risolutore ora dice se il fallimento è dimostrato; se no
  l'esito è "indeterminato".
- **Bilancio del mese**: se gli obiettivi non bastano al fabbisogno, la
  diagnosi lo dice con i numeri (nuovo riquadro) e la sonda degli obiettivi
  va per prima.

Interfaccia:
- Rifinitura finale in un Web Worker (ripiego sul thread principale).
- "Completa obiettivi" dice chi resta sotto obiettivo e perché, invece di
  "completati!" in ogni caso.

Collaudo a configurazioni casuali (`harness/fuzz.ts` + validatori indipendenti
`harness/validatori.ts`): 180 configurazioni casuali di squadra, regole,
assenze, esclusioni, manuali, mese precedente e ambulatori; generazione completa
+ "Completa obiettivi". Configurazioni con violazioni: 87 nella 0.3.36 → 3,
tutte segnalate in validazione e strutturali (MDC unico abilitato disponibile
per un ambulatorio di pomeriggio senza colleghi). Il fuzz ha trovato due
difetti già presenti nella 0.3.36, ora corretti:
- **Due turni nella stessa fascia** (ambulatorio + reparto: A+M, Ap+P): lo
  "scambio compensato" del riequilibrio weekend saltava il controllo. Ora
  `canR` e `add` rifiutano sempre un secondo turno nella stessa fascia.
- **MDC da solo con l'ambulatorio**: la fase ambulatorio gira a tabellone
  vuoto. Ora la rifinitura sposta l'ambulatorio a un altro abilitato non MDC
  (`sistemaMdcAmb`); se l'unico abilitato libero è un MDC, l'ambulatorio resta
  a lui e la validazione segnala l'MDC rimasto solo.

ML e giorni consecutivi (`harness/mlconsec.ts`): con il tetto da 7 a 2 l'ML
lavora gli stessi turni (sequenze fino a 6 giorni), mai segnalato; MR e MDC
restano sempre entro il tetto.

**ML fino all'obiettivo.** L'ML fa solo mattine non festive (lun–sab), quindi
ogni mattina che perde è un turno che non recupera. Tre punti gliene toglievano:
la compattazione (spostava la sua mattina "isolata", es. lunedì 1 giugno prima
del festivo del 2: ML a 24/25 con la mattina libera), le fasi che davano il
sabato ad altri prima di lui, e "Completa obiettivi", che serviva prima i meno
carichi e non guardava i sabati. Ora la compattazione non gli toglie turni, un
passaggio finale (`completaML`) gli dà le mattine libere o gliele fa cedere da
un collega (mai manuali, copertura invariata, nessun MDC lasciato solo) e il
pulsante 2 lo serve per primo. Vale anche per la variante "ultima chance"
(`UC`) della rifinitura. Misurato: da 23-24/25 (e 15-23/25 con due ML)
a 25/25 in tutti i casi di prova. Gli harness `sim.ts`/`stress.ts` ora esentano
l'ML dal controllo dei consecutivi, come il motore.

Test: `analisi037.test.ts`. Harness: `harness/multiamb.ts` (stress più ambulatori).

## Novità 0.3.36 — più ambulatori, ciascuno coi suoi abilitati

Il pannello **Regole → Ambulatori** sostituisce "Giorni di ambulatorio": ora è
un elenco di ambulatori (aggiungi / elimina), ognuno con

- **nome** e **sigla** (quella che compare in tabellone ed Excel: `DIA` di
  mattina, `DIAp` di pomeriggio);
- **giorni e fascia**: per ogni giorno feriale —, Mattina, Pomeriggio o
  Mattina + pomeriggio;
- **medici abilitati**, modificabili anche dalla scheda del medico (una
  casella per ambulatorio).

Il generatore assegna ogni ambulatorio solo ai suoi abilitati. L'equità è
misurata sul **totale** degli ambulatori fatti (chi è abilitato a più
ambulatori non ne fa di più), con un unico cursore di rotazione fra mesi.
Due ambulatori nella stessa fascia dello stesso giorno vanno a medici diversi.
Un ambulatorio senza abilitati resta scoperto ed è segnalato col suo nome.

Dati: ogni A/Ap porta l'id del suo ambulatorio (`Turno.amb`); le abilitazioni
stanno su `Medico.ambulatori`. **Compatibilità**: le regole salvate prima
(giorniAmb/fasceAmb) diventano l'ambulatorio "Ambulatorio" (sigla `A`); i
medici col vecchio flag vi risultano abilitati; le A/Ap già in tabellone gli
appartengono. A regole di default l'impronta deterministica (`harness/det.ts`)
è identica alla 0.3.35. Test: `piuAmbulatori.test.ts`.


## Novità 0.3.35 — ambulatorio anche di pomeriggio

Nel pannello **Regole → Giorni di ambulatorio**, per ogni giorno selezionato
si sceglie ora la fascia:

- **Mattina** (default, comportamento storico): turno `A`;
- **Pomeriggio**: nuovo turno `Ap` (ambulatorio di pomeriggio);
- **Mattina + pomeriggio**: sia `A` sia `Ap`, due slot distinti assegnati con
  la stessa rotazione/equità fra gli abilitati — di norma a due medici diversi
  (lo stesso medico prende entrambi solo se nessun collega è disponibile, e
  sempre nel rispetto della distanza fra giornate piene).

La `Ap` si comporta come un pomeriggio per tutte le regole (Regola N, Xp,
distanza associati, affiancamento MDC) ma, come la `A`, non conta nel
fabbisogno di reparto. Pesa 1 sull'obiettivo, si inserisce anche a mano dal
CellModal e compare nella riga di copertura con un quadratino per slot
(`A?`/`Ap?` se scoperto). Il fabbisogno del mese conta 2 slot nei giorni
mattina + pomeriggio. Regole salvate prima della 0.3.35: tutto resta di
mattina. Test: `ambulatorioFasce.test.ts`.


## Novità 0.3.34 — equità degli ambulatori con A manuali

`faseAmbulatorio` distribuiva le A con un round-robin che contava POSIZIONI
nella lista degli abilitati, non ambulatori davvero fatti. Il giorno con una A
MANUALE veniva saltato dal `continue` in cima al ciclo SENZA far avanzare
`nextIdx`, quindi il manuale non consumava alcun giro: chi ne aveva già uno
rientrava in gara alla pari con chi non ne aveva nessuno. (Anche
`calcAmbRotNext` conta le sole A automatiche, quindi il manuale era invisibile
pure alla rotazione fra mesi.)

Caso reale, settembre 2026: 4 abilitati, 4 martedì (l'8 è il patrono) e una A
manuale su Renis il giorno 1. Risultato: **Renis prendeva sempre 2 ambulatori
su 4 e un altro restava a 0, per OGNI valore del cursore di rotazione** — esito
deterministico, non sfortuna.

Ora la chiave primaria dell'ordinamento è il CARICO EFFETTIVO del mese (A
manuali comprese) e la distanza dal cursore è il solo spareggio. A carichi pari
— il caso tipico del primo giorno del mese, tutti a zero — l'ordine coincide
con quello di prima: la rotazione FRA MESI resta intatta, dentro il mese vince
l'equità.

Misure — scenario reale, 6 run appaiati (pipeline completa, tutti gli indici
di rotazione):

| | prima | dopo |
|---|---|---|
| ripartizione | sempre 2/1/1/0 | **sempre 1/1/1/1** |
| spread max−min | 2,00 | **0,00** |
| `wkScarto` medio | 2,50 | **1,50** |
| soft medio | 692 | **689** |
| copertura completa | 6/6 | 6/6 |

Rotazione su 12 mesi consecutivi senza manuali (cursore riportato di mese in
mese come fa la UI): 13/13/13/12 prima e dopo, `max−min = 1`. Con ambulatorio
3 giorni a settimana (`giorniAmb: [0,2,4]`), 6 mesi: 19/19/18/18 in entrambi.
Dove era già equo la patch non cambia nulla.

Nessun aumento dei fallimenti di fase: su 40 restart deterministici per
scenario, gli ambulatori mancanti restano identici prima e dopo.

Un caso resta a spread 2 ed è CORRETTO: in agosto 2026 il giorno 25 ha due
abilitati bloccati da una `L` manuale, quindi la seconda A può andare solo a chi
ne ha già una. Lì la patch è un no-op esatto — i risultati coincidono
bit-a-bit con quelli di prima.

Test: `equitaAmbulatorio.test.ts` (3 casi). Il caso «A manuale» FALLISCE sul
motore pre-0.3.34 e passa dopo: fissa esattamente la regressione.

## Novità 0.3.33 — straordinari e ALPI nel riepilogo, mattina a g+2

### 1. Sottolineatura anche sulla N

`TS` in `src/components/costanti.ts` include ora la `N`. Il motore era già
pronto: `vt("N", sott)` vale 0, quindi una N sottolineata è lavoro reale che NON
scala l'obiettivo mensile — la semantica dello straordinario. Continua invece a
contare per il tetto `maxNotti`, per l'equità delle notti e per i festivi
lavorati: una notte affatica comunque, sottolineata o no.

### 2. Riepilogo del medico

Due contatori nuovi in `src/engine/bilancio.ts`, speculari fra loro:

| | cosa conta | pesi |
|---|---|---|
| `alpiMedico` | turni di PS SOTTOLINEATI | 1 e 2 → 1, il 3 → 2 |
| `straordinariMedico` | turni di reparto SOTTOLINEATI | M e P → 1, la N → 2 |

Sono DISGIUNTI per costruzione: `STRAORD` usa i tipi esatti `M`/`P`/`N`, quindi
l'ambulatorio (`A`) non è straordinario e i codici PS finiscono solo in ALPI.
In entrambi il peso è quello della versione PIENA (`vt(tipo, false)`): il turno
c'è stato, non conta l'obiettivo che non scala.

Nuovo ordine, in card e in «Copia riepilogo»: **turni totali → straordinari →
PS (di cui ALPI) → festivi lavorati → weekend liberi → ambulatorio → permessi**.
Il blocco M/P/N resta attaccato al totale, di cui è la scomposizione. «Weekend
lavorati» è ora «Festivi lavorati» (solo etichetta: la metrica `pesoWeekend` è
invariata). L'ALPI compare accanto al PS solo quando è > 0.

### 3. Regola della notte: nuova opzione «Mattina» a g+2

Nuova regola configurabile `mattinaDopoNotte`: due giorni dopo una notte è
ammessa anche una Mattina (M, A o 1), non solo il Pomeriggio. Innestata nei
QUATTRO punti che decidono la cosa, così generazione, inserimento manuale e
validazione dicono la stessa cosa:

- `violaG2` — cosa vìola il g+2 di una notte (usato da `canN` e da `checkRegolaN`)
- `canMatt` — la M a g+2
- il calcolo di capacità in `ctx` (`f==="M" && manNight(g-2)`)
- `opzioni` in `diagnosi.ts`, per la diagnosi delle impossibilità certificate

È ORTOGONALE a `notteLiberoNotte` (che riguarda la N a g+2): possono stare
accese insieme. `riposoEsteso` le neutralizza entrambe, come già faceva.

Il pannello Regole ha ora un box **REGOLA DELLA NOTTE** a tendina che raccoglie
tutto quanto riguarda le notti: `maxNotti` e `maxNottiConsec` (migrati da
«Limiti per medico») più i tre toggle sotto «Cosa è ammesso due giorni dopo la
notte (g+2)». La riga di riepilogo resta sempre visibile:
`g+1 sempre libero · a g+2 P · M · N · max 5 notti/mese, 2 di fila`.
Accendere un toggle spegne quelli in conflitto (tabella `TOGGLE_NOTTE`, campo
`spegne`), così il pannello non mostra mai due regole che si annullano.

### Verifiche

- **154/154 test** (140 preesistenti + 14 nuovi: `mattinaDopoNotte.test.ts`,
  `contatoriRiepilogo.test.ts`), build e typecheck puliti.
- **Impronta deterministica identica alla 0.3.32**: `harness/det.ts` genera 100
  tabelloni con SALT fissi (2 mesi × 2 valori di `maxConsec` × 25 restart),
  senza fasi a tempo, e confronta l'hash di ognuno — `a26ddccbd5410baa` in
  entrambi i rami. A regole di default la modifica è un no-op PROVATO.
  L'impronta deterministica è preferita a `harness/sim.ts` per questo confronto:
  sim usa budget a wall-clock e ha una varianza run-to-run che renderebbe il
  raffronto inconcludente.

## Novità 0.3.32 — rifinitura multipla, uno per worker

`generaParallelo` sceglieva il vincitore fra i tabelloni GREZZI dei worker e
rifiniva solo quello. Ma `rifinituraFinale` (LNS + recupero weekend +
equalizzatore di carico + compattazione) è un hill-climb PATH-DEPENDENT: il
grezzo migliore non produce affatto il tabellone FINALE migliore. Ora si
conserva il best di OGNI worker e si rifiniscono tutti, tenendo il migliore
DOPO la rifinitura (`rifinisciCandidati`, stesso metro gerarchico `cmpMis`).

Uno per worker e non i top-K globali: i top-K globali arrivano quasi sempre
dallo stesso worker e sono quasi-cloni fra loro (misurato: nessun guadagno).
I best dei worker sono per costruzione punti di partenza DIVERSI (saltSeed
distinti).

`rifinisciCandidati` è MONOTONA per costruzione: parte dal risultato del
primario e lo sostituisce solo se `cmpMis` è strettamente migliore. Nella
stessa esecuzione non può quindi peggiorare l'esito. Due guardie: si esce
subito se il primario rifinito ha buchi (con i buchi la rifinitura attiva
l'ultima chance, e moltiplicarla ×4 non è accettabile), e `limite` è un muro di
wall-clock — ogni rifinitura riceve solo il tempo che resta, così il budget
promesso al chiamante resta un tetto reale.

Misure — settembre 2026 reale (scenario dell'utente), `maxConsec:5`, 24 run,
confronto primario→finale NELLA STESSA esecuzione (privo del rumore delle fasi
a budget di tempo):

| | primario | finale |
|---|---|---|
| scarto carico weekend medio | 1,42 | **1,21** |
| run con `wkScarto ≤ 1` | 14/24 (58%) | **17/24 (71%)** |
| run migliorati / peggiorati | — | **5 / 0** |
| costo rifinitura | ~200 ms | ~600 ms |

Nota sul soft: in 2 dei 5 run migliorati il soft SALE mentre `wkScarto` scende
(es. 643→741 con scarto 2→1). È corretto: `cmpMis` mette l'equità weekend prima
dell'organicità, ed è la stessa gerarchia usata da `registra()` e `prova()`.

Su 16 run appaiati a parità di seme (vecchio comportamento vs nuovo):
`wkScarto` medio 1,44 → 1,06, soft medio 667 → 633, run con `wkScarto ≤ 1`
da 9/16 a 13/16.

Regressione `harness/sim.ts` (18 scenari × 2): **0 violazioni, 18 migliorati,
0 peggiorati**, `wkScarto` totale 47 → 37, soft medio 680 → 674.
Harness dedicato allo scenario: `harness/set26.ts` + `scenario_settembre2026.json`.

### Vicoli ciechi documentati (misurati e scartati)

Il caso di partenza era: un tabellone di settembre 2026 ottimo per equità
weekend usciva solo dopo moltissime generazioni. Diagnosi: `wkScarto=2` in
pratica sempre, `wkScarto=1` raro. Cose provate e BOCCIATE dai numeri:

- **Budget pieno dopo il primo perfetto.** `OTTIM_MS = min(4000, maxMs*0.4)`
  spegne metà dei worker a 4-5,6 s su 9,5 (telemetria). Alzarlo a `maxMs`: su 7
  run appaiati scarto weekend IDENTICO (1,29 vs 1,29), soft PEGGIORE (654 vs
  639), +50% di CPU. La ricerca satura presto: conta più la diversità fra
  worker che la profondità di uno solo. Tetto lasciato invariato.
- **Riparazione dei near-miss** (`riequilibraWeekendLiberi` sui tabelloni con
  `buchi=0 && wkDef>0`, dentro `registra`): 25 riparati su 705, tasso `s=0` da
  16,6% a 19,3%, zero effetto sullo scarto weekend.
- **Ordinamento quota-aware** in `coperturaWeekend` e `faseNotti` (penalizzare
  `cntWk + pesoSlot > quota.hi`): distribuzione di `wkScarto` invariata su 300
  restart.
- **Ridistribuzione CP di tutti gli slot weekend** sul tabellone finito
  (svuota e ri-risolve con MRV + branch&bound): 6.000-9.000 foglie complete
  raggiunte, **zero valide** — a feriali fissi ogni distribuzione con
  `wkScarto ≤ 1` viola i weekend liberi. La struttura weekend non è
  riparabile a posteriori, deve uscire giusta dalla ricerca: è il motivo per
  cui l'intervento è finito sulla SELEZIONE dei candidati e non su una nuova
  fase di riparazione.
- **Scambio compensato di partecipazione weekend** (due medici si scambiano
  due interi weekend, liberi invariati): a somma zero, tutti i weekend valgono
  ~2 punti a testa.

## Novità 0.3.31 — festività locale del santo patrono (8 settembre)

L'8 settembre (Madonna dell'Olmo, patrona di Cava de' Tirreni) è ora trattato
come un festivo a tutti gli effetti. L'innesto è UNICO — `isHol` in
`src/engine/date.ts` — perché tutto il resto del motore e della UI si appoggia
già a quel predicato:

```ts
const FESTIVI_LOCALI = new Set([
  "09-08", // Madonna dell'Olmo — patrona di Cava de' Tirreni
]);
export function isHolLocale(m,d){ … }          // chiave "MM-GG", senza anno
export function isHol(y,m,d){ return holSet(y).has(…) || isHolLocale(m,d); }
```

Scelte di progetto:
- `holSet` NON è stato toccato: resta l'elenco delle sole festività NAZIONALI,
  con la sua cache per anno (che così non va mai invalidata). La separazione è
  verificata da un test (`holSet(2026)` non contiene `2026-09-08`).
- Chiave `"MM-GG"` senza anno: la data è fissa, la stessa riga vale per ogni
  anno futuro senza manutenzione. Aggiungere un'altra festa locale = una
  stringa in più nel Set (le feste patronali MOBILI non sono supportate:
  servirebbe una chiave completa `"AAAA-MM-GG"`).
- `date.ts` resta PURO (nessun import nuovo): la variante configurabile da
  pannello (campo in `Regole` + UI + persistenza) è stata valutata e scartata
  per ora — l'unico manutentore è chi fa il deploy, e la data non cambia.
  Se un giorno servisse, l'upgrade tocca solo `isHolLocale`, non i chiamanti.

Effetti automatici (nessun altro file modificato): fabbisogno FESTIVO (1M/1P
invece di 2-3 / 1-2), ambulatorio soppresso, notte del 7 settembre PREFESTIVA
(peso 2), mattina dell'8 con peso 1 nell'equità dei festivi, colonna colorata
in griglia ed export Excel.

Test: nuovo `src/engine/__tests__/festivoLocale.test.ts` (8 test, suite a 140).
I due test di generazione asseriscono INVARIANTI DURI (tetti massimi, divieto
di ambulatorio nei festivi) e verificano i minimi solo se `r.ok`: con budget a
tempo il tabellone non è deterministico, e assertire `r.ok` misura la CPU
invece del codice. Stabilità verificata 12/12 run.

Misure A/B (harness/patrono.ts, motore con e senza la data locale):
- `set26-vuoto` (settembre 2026 pieno organico, 6 run/lato): buchi 0 → 0,
  violazioni 0 → 0. Unico effetto: l'ambulatorio del martedì 8 sparisce
  (A@8 6/6 → 0/6).
- `set27-mercoledì` e `set30-domenica` (controlli): invariati. Nel 2030 l'8
  cade di domenica ed era già festivo — nessun doppio conteggio.
- `set26-lungodeg` (scenario duro: un MR assente tutto il mese + uno per metà,
  20 run/lato + campione di conferma da 12): copertura INVARIATA (buchi 0.10 e
  0.17 su entrambi i lati), ma **equità weekend peggiore**: wkScarto 0.25 →
  2.05 (conferma: 0.33 → 2.08), wkDef 0.25 → 0.55. Causa: il festivo in più
  toglie ~3 slot al mese (fabbisogno ridotto + ambulatorio chiuso) mentre gli
  obiettivi restano a 25, quindi su un organico già sottile il carico migra sui
  weekend e la forchetta si allarga. Costo dichiarato e ACCETTATO: l'8 settembre
  è un dato di calendario, non un parametro da tarare.

Nota non correlata: `organicita.test.ts` ("la generazione resta senza
violazioni…", giugno 2026, budget 2000 ms) fallisce sporadicamente sotto carico
per lo stesso motivo — assertisce `r.ok` su una ricerca a tempo. In isolamento
6/6 run puliti. È flakiness PREESISTENTE, indipendente da questa versione.

---

## Novità 0.3.29 — carico weekend di chi ha turni weekend manuali

Problema segnalato e riprodotto (harness/wkman.ts): a un medico con 6 turni
weekend inseriti a mano la generazione aggiungeva quasi sempre altri slot
weekend (10/10 run), portandolo oltre la sua quota equa di carico in 3-5 run
su 10. Cause: i suoi weekend non sono riservabili come liberi (wkTargetMed
ridotto dai manuali) e il criterio di risparmio dei weekend liberi (costoWk,
v0.3.25) mette primo proprio chi ha la coppia sab-dom "già spesa".

Interventi, tutti verificati A/B con METRO DI GIUDIZIO UNICO (i tabelloni di
entrambe le versioni rivalutati dallo stesso valutatore, harness/eval.ts):

1. **Fix capacità fantasma M/P** (stessa classe del fix Notte v0.3.27): il
   "compagno" manuale che rende ammissibile uno slot festivo per l'MDC può
   saturare lui stesso il fabbisogno massimo (festivi 1/1): quello slot non
   aggiunge capacità a nessuno. wkCapacita/puoPortareWk ora lo riconoscono:
   niente più quote mai realizzabili che falsavano la forchetta d'equità.
2. **Protezione di chi ha carico weekend manuale**: negli ordinamenti dei
   cluster critici e del riempimento d'emergenza, un candidato con pavimento
   manuale (wkPavimento>0) che con lo slot supererebbe la propria quota alta
   scivola in fondo alla fila (mai un filtro: resta candidato se è l'unico).
   La condizione sul pavimento è essenziale: applicata a tutti bruciava
   coppie libere nei mesi senza manuali (misurato e scartato).
3. **Equalizzatore con scambio compensato**: se il ricevente è bloccato dal
   tetto dell'obiettivo, cede al donatore un suo slot feriale e prende lo
   slot weekend — i carichi restano invariati e il carico weekend migra.
4. wkQuota memoizzata nel ctx (invalidata dall'unico scrittore) e
   wkPavimento memoizzato: costo degli ordinamenti nuovi trascurabile.

Esito (18 scenari × 6 run, metro unico): violazioni 0=0, buchi identici,
wkDef −0.03, wkScarto −0.13 medio (punte: −1.5 obiettivi bassi, −0.83
notte-libero-notte), wkLibMin +0.02, nessun peggioramento ≥0.3 su alcuno
scenario. Scenario segnalato: 0/10 run sopra quota (prima 3-5/10). Percorsi
scartati perché misurati peggiori: quota "senior" al costoWk globale, quota
come spareggio senza condizione sul pavimento.

---

## Novità 0.3.28

### 1. Budget di tempo REALE (deadline dura del motore)

`maxMs` era rispettato solo FRA i restart/le iterazioni: un singolo run a
budget pieno (BT=60, TRIES=20, 200k nodi) su un mese molto vincolato durava
minuti. Misurato sull'harness multi-scenario: `generaConUltimaChance` >4 min
su organico ridotto, `riparaBuchi` da solo 37 s con obiettivi bassi, e la
ricerca sforava il budget di 3-5×. Ora `ENG.DEADLINE` (epoch ms, 0=off) viene
impostata dagli entry-point a tempo (`cercaMigliorTentativo`,
`generaConUltimaChance`, i passi di `rifinituraFinale`) dentro try/finally, e
i loop costosi la controllano periodicamente abortendo in best-effort: stessi
risultati quando il tempo basta, tabellone migliore-fin-lì quando non basta.
Sui tre scenari patologici: da >4-10 min a 5-13 s totali, zero regressioni
sulla suite e sull'harness.

### 2. Organicità dei turni (lavIso / quickPM + compattaTurni)

Problema misurato: anche nei mesi facili il tabellone conteneva ~12-16 giorni
di lavoro ISOLATI (libero-lavoro-libero) e ~10-15 liberi "bucati" fra due
giorni lavorati. Tre interventi, tutti SOFT (mai un buco o una violazione in
cambio):

- `misuraTabellone` conta `lavIso` (giorni lavorati isolati, Notti escluse) e
  `quickPM` (rientri rapidi P→M) e li aggiunge al punteggio soft con pesi
  bassi (10 e 4, sotto sforo=40 e wkScarto=60).
- ADOZIONE GERARCHICA: a punteggio duro pari decide prima `wkScarto` (equità
  del carico weekend), poi il soft — l'organicità non può mai comprare un
  punto di iniquità weekend (senza questo strato: +0.12 wkScarto medio
  misurato).
- `compattaTurni` (rifinitura): hill-climb transazionale che sposta singoli
  slot M/P automatici dei feriali dai frammenti verso i blocchi (stessa
  disciplina di riequilibraCaricoWeekend, mdcOk incluso). Toccando solo
  feriali non-festivi, carico weekend e weekend liberi restano invariati.

Verificato su 18 scenari × 5-24 run con validatori INDIPENDENTI dal ctx
(harness/sim.ts): 0 violazioni, buchi/wkDef/notti invariati, giorni isolati
−8 in media (12.6→4.2 su dicembre, 14.3→3.0 su febbraio), liberi bucati
−3.8, transizioni lavoro/riposo −1.7 per medico. Nuova suite:
`__tests__/organicita.test.ts`.

---

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
    turni.ts         isMatt/isPom/isNot/vt, SPEC, esclusioni (X, Xm/Xp/Xn), cloneT/pulisciT
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
