# RF-012D3 — Read-only kostprijsvarianten en historie

## Uitkomst

`Kostprijs beheren` heeft nu een afzonderlijk, pas bij openen geladen dossier **Alle varianten / historie**. Per stabiele SKU toont het dossier:

- het actieve planningsanker uit de actieve commerciële generatie;
- de bewezen bronjaar- of doeljaarankerlineage;
- alle bewaarde SKU-kostprijsversies;
- methode, bronjaar, bronsoort, datum, referentie en leverancier;
- inkoop/productie, verpakking, overhead, accijns en totale kostprijs;
- exacte canonieke LOT-koppelingen;
- LOT-bewijs dat nog niet exact aan één canonieke SKU-kostregel is gekoppeld.

Het actieve planningsanker blijft de enige actuele plannings-SSOT. Een latere factuur, brouwmoment, LOT-kostprijs of oud compatibiliteitsanker wordt door alleen bekijken nooit het nieuwe planningsanker.

## Betekenis van de ankerlagen

De actieve generatie bewaart de actuele kostprijs per SKU. Haar `source_anchor_id` heeft bij een herberekende 2026-SKU een andere functie: het verwijst naar het bewezen bronjaaranker waaruit 2026 is opgebouwd. Het is dus geen tweede actuele 2026-bron.

RF-012D3 onderscheidt daarom:

- **bronjaaranker geverifieerd:** de generatie verwijst exact naar hetzelfde bronanker, dezelfde kostversie en dezelfde SKU-kostregel;
- **doeljaaranker geverifieerd:** een in het doeljaar toegevoegde SKU heeft geen bronjaaranker, maar wel een exact gelijk relationeel doeljaaranker;
- **alleen actieve-generatiebewijs:** de actieve waarde bestaat, maar een relationele onderbouwing ontbreekt; dit blijft een zichtbare blokkerende toestand;
- **n.v.t.:** volgens de vastgelegde policy is geen kostprijs vereist.

Een foutieve of dubbele binding laat het volledige historiedossier gesloten falen. Er wordt niet op naam, datumvolgorde of een willekeurige ID gegokt.

## Versies en LOT-lineage

Elke kostversieregel behoudt een eigen relatie tot het actieve anker:

- bronrecord van het actieve anker;
- doeljaarrecord van het actieve anker;
- geregistreerde aanvullende variant;
- vervangen planningsanker na een expliciete rebaseline.

Alleen `canonical_lot_cost_lineage` bewijst een exacte LOT → SKU → kostversie → kostregel-relatie. Een LOT dat alleen op een kostversie staat wordt zichtbaar als **niet exact gekoppeld**. Een direct `lot_cost_records`-record zonder canonieke kostversielijn wordt als bewijs getoond, maar zijn bedrag wordt niet als canonieke kostprijs teruggegeven. De UI vermeldt daarvoor: **Geen bedrag: canonieke kostversielijn ontbreekt**.

Deze grens volgt het RF-011B-contract: ontbrekende of ambigue LOT-lineage mag niet stilzwijgend terugvallen op het planningsanker.

## Read-only en autorisatie

De nieuwe route is:

`GET /api/meta/commercial-yearsets/active/cost-history`

De route vereist `costs:view`. De reader:

1. leest eerst het gevalideerde actieve Jaarsetdossier;
2. start voor historie `SET TRANSACTION READ ONLY`;
3. controleert opnieuw dat dezelfde generatie nog actief is;
4. leest daarna uitsluitend ankers, kostversies, kostregels en LOT-bewijs;
5. initialiseert geen schema en voert geen mutatie uit.

De frontend laadt dit endpoint alleen nadat **Alle varianten / historie** wordt geopend. Er is geen POST-, PUT-, PATCH- of DELETE-aanroep en geen knop voor activeren, herstellen of rebaselinen.

## Controle op ontwikkeldata

| Controle | Resultaat |
|---|---:|
| Actieve SKU-histories | 79 |
| Exacte bronjaarankerbindingen | 66 |
| Exacte doeljaarankerbindingen | 11 |
| Alleen actieve-generatiebewijs | 0 |
| Kostprijs n.v.t. | 2 |
| Bewaarde SKU-kostprijsregels | 170 |
| Aanvullende varianten | 93 |
| Exacte canonieke LOT-koppelingen | 59 |
| LOT-declaraties alleen op versieniveau | 52 |
| Directe LOT-bewijzen zonder canonieke kostversielijn | 17 |
| Historische kostregels met componentafwijking | 8 |

Blond heeft zeven actuele SKU’s. De meeste Blond-formaten tonen meerdere bewaarde versies en exacte LOT-koppelingen. Juweel heeft drie actuele SKU’s en voor elk één exact gekoppelde bronversie/LOT; de bewaarde bronregel van `Doos 24 × 33cl` heeft een componentafwijking en wordt daarom zichtbaar gewaarschuwd zonder het actieve bedrag te veranderen. Weizen behoudt zijn inkoopmethode en bronjaarherkomst; bestaande latere varianten en LOT-bewijzen blijven afzonderlijk zichtbaar.

## Beschermende tests

De contracttests bewaken:

- actieve generatie versus bronanker versus doeljaaranker;
- één historie per stabiele SKU;
- een latere inkoopfactuur als variant zonder automatische rebaseline;
- exacte canonieke LOT-koppeling;
- onopgelost direct LOT-bewijs zonder teruggegeven bedrag;
- componentafwijkingen als zichtbare status;
- fail-closed gedrag bij verkeerde ankerbinding of dubbele kostregel-ID;
- read-only SQL zonder schema-initialisatie;
- `costs:view` op zowel overzicht als historie;
- lazy frontendload, toegankelijke disclosures en afwezigheid van mutatie-aanroepen.

De deterministische Playwright-contracttest is op desktop en mobiel uitgevoerd. Beide varianten bewaken toetsenbordbediening, de lazy GET-route, nul mutatieverzoeken en begrensde mobiele content met lokale horizontale tabelscroll.

## Handmatige acceptatie

1. Open **Kostprijs beheren** en daarna **Alle varianten / historie**.
2. Controleer dat planningsjaar 2026, 170 kostprijsregels, 93 aanvullende varianten en 59 exacte LOT-koppelingen worden gemeld.
3. Zoek op **Berlewalde Blond - Doos 24 × 33cl** en open de SKU.
4. Controleer dat het actieve planningsanker apart boven de bewaarde kostprijsversies staat.
5. Controleer dat bedragen zijn uitgesplitst in inkoop/productie, verpakking, overhead, accijns en totaal.
6. Controleer dat exacte LOTs neutraal zijn en niet-exacte LOT-declaraties een waarschuwing krijgen.
7. Zoek op **Berlewalde het juweel** en controleer de drie afzonderlijke SKU’s zonder dubbele fysieke SKU-regel.
8. Controleer dat de historische componentafwijking van `Doos 24 × 33cl` zichtbaar is, maar het actieve planningsanker ongewijzigd blijft.
9. Test zoeken, Alles openen/sluiten, toetsenbordbediening en horizontaal scrollen op mobiel.
10. Controleer via het netwerkpaneel dat openen alleen GET-aanroepen uitvoert.

## Data- en rollbackimpact

RF-012D3 bevat geen schemawijziging, migratie, backfill, herstel, rebaseline, activatie of berekeningswijziging. Geen opgeslagen bedrag of historische rij is gewijzigd. Rollback bestaat uitsluitend uit het terugdraaien van deze applicatiecommit; een database-rollback is niet nodig.

## Volgende slice

Na acceptatie van RF-012D3 volgt volgens de actuele volgorde RF-012C2B: een expliciete, revisioned Management Forecast die aan generatie, run en Plan-hash is gebonden. Daarna volgen RF-012C3 voor exacte Actual LOT/non-LOT-kosten en RF-012C4 voor verkoopstrategie en adviesprijzen.
