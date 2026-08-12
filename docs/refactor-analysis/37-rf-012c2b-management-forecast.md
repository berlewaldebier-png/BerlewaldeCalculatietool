# RF-012C2B — Expliciete Management Forecast

Datum: 2026-08-12

Classificatie: additieve data-evolutie en afzonderlijk goedgekeurde gedragsuitbreiding

Afhankelijkheden: RF-012C2, RF-012D1, RF-012D1A, RF-012D2 en RF-012D3

## Uitkomst

RF-012C2B maakt Forecast expliciet beheerbaar zonder Plan, Actual, kostprijzen of historische verkoopregels te wijzigen.

- **Plan** blijft de onveranderlijke, hash-gecontroleerde jaarset uit de actieve commerciële generatie.
- **Actual** blijft uitsluitend gebaseerd op gefactureerde transacties. Niet-geregistreerde orders worden niet als backlog verondersteld.
- **Forecast** start vanuit de bestaande Actual-plus-resterend-Plan-projectie en kan daarna alleen via een nieuwe geauditte Management-revisie veranderen.
- Management en Administrator mogen een revisie opslaan; alleen rollen met `forecast:view` zien Break-even.
- Iedere revisie is exact gebonden aan `generation_id`, reconciliation `run_id`, `plan_id`, `plan_contract_hash` en operationeel jaar.

Dit is geen wijziging van de jaarsetberekening, kostprijsformule, LOT-resolutie, verkoopstrategie of adviesprijsbron. Die resterende onderwerpen blijven RF-012C3 en RF-012C4.

## Maandbeleid

De editor toont twaalf kalendermaanden van het actieve jaar:

1. Een maand vóór de Actual-cutoff is verstreken en blijft exact gelijk aan Actual.
2. De cutoffmaand wordt pas verstreken op de laatste kalenderdag van die maand.
3. In een lopende maand mogen Forecast-omzet, variabele kosten, liters en eenheden niet lager worden dan de reeds gefactureerde Actual-waarden.
4. Toekomstige maanden zijn expliciete Management-invoer.
5. Contributie is niet vrij invoerbaar: de backend dwingt `omzet - variabele kosten` af.
6. Negatieve contributie is toegestaan. Een tegenvallende Forecast mag niet door een kunstmatige positieve-resultaatregel worden geblokkeerd.
7. Een verstreken maand met negatieve Actual-totalen door creditnota's blijft exact negatief; de UI en backend zetten die historische waarden niet stil naar nul om.

Jaarwaarden worden door de backend uit de twaalf geaccepteerde maandregels opgeteld. De browser is dus niet de financiële bron voor totalen.

## Persistente autoriteit

De automatische startup-initialisatie voegt uitsluitend de tabel `commercial_forecast_revisions` en drie indexen toe. De tabel is append-only op inhoudsniveau:

- een nieuwe opslag maakt een nieuwe rij met oplopend revisienummer;
- de vorige actieve rij verandert alleen van status `active` naar `superseded`;
- revisierijen worden niet verwijderd of inhoudelijk overschreven;
- vier foreign keys gebruiken `ON DELETE RESTRICT` voor generatie, run, Plan en voorgaande revisie;
- een gedeeltelijke unieke index staat maximaal één actieve revisie per generatie toe;
- een inhoudshash beschermt binding, peildatum, jaartotalen en maandregels tegen stille wijziging.

De write-transactie gebruikt een advisory lock, row locks en optimistic concurrency op de verwachte actieve revisie. Vlak voor de insert worden de actieve generatie, run, readiness, blockerstatus, Plan-identiteit en Plan-hash opnieuw gecontroleerd. Een tweede tabblad met verouderde informatie krijgt daarom HTTP 409 en moet verversen.

## UI en performance

Het bestaande Break-even read model bevat de benodigde actuele maandregels al. De Forecast-editor gebruikt die serverrespons direct en doet bij het openen geen tweede volledige analyse-request. Revisiehistorie wordt pas geladen wanneer de gebruiker het historieblok opent. Na opslaan bouwt de API de bevestigingsworkspace uit de gevalideerde invoer en de opgeslagen revisie; een tweede dure backend-herberekening binnen hetzelfde POST-request is niet nodig.

De tabel heeft op smalle schermen een eigen horizontaal scrollgebied. In de 390 px controle bleef het nieuwe paneel binnen de viewport; de tabel behield alle kolommen via lokale horizontale scroll. Alle 48 numerieke maandvelden hebben een unieke toegankelijke naam. Verstreken maanden waren read-only.

## API en rechten

- `GET /api/integrations/break-even/analysis-read-model`: `forecast:view`.
- `GET /api/integrations/break-even/management-forecast`: `forecast:view` en alleen gebruikt voor de lazy historie/zelfstandige refresh.
- `POST /api/integrations/break-even/management-forecast`: `forecast:manage`.
- Management: bekijken en reviseren.
- Administrator: bekijken en reviseren via de bestaande volledige capabilityset.
- Brewer en Sales: geen Break-even-navigatie of Forecast-capability.

De POST vereist een reden van minimaal tien tekens en registreert gebruiker, rol en tijdstip. Opslaan toont eerst een bevestiging en daarna de bestaande pending/success/error-feedback.

## Dataveiligheid

De migratie is automatisch en additief via `CREATE TABLE/INDEX IF NOT EXISTS`. Er is:

- geen wijziging van Beer-, SKU-, kostprijs-, LOT-, offerte-, jaarset- of verkoopdata;
- geen backfill;
- geen historische herwaardering;
- geen cascade-delete;
- geen automatische Forecast-revisie bij startup of paginalaad.

De read-only ontwikkelcontrole na startup bevestigde:

| Controle | Resultaat |
|---|---:|
| Nieuwe forecasttabellen | 1 |
| Forecast-revisierijen | 0 |
| Actieve revisies | 0 |
| Foreign keys met `ON DELETE RESTRICT` | 4 |

Er is tijdens de automatische browsercontrole niet op Opslaan gedrukt.

## Testbescherming

De contracttests beschermen onder meer:

- exact twaalf maanden en backend-afgeleide jaartotalen;
- verstreken maanden gelijk aan Actual;
- de Actual-ondergrens in de lopende maand;
- contributie-identiteit inclusief toegestane negatieve contributie;
- de laatste-dag-van-de-maandregel;
- stale generation/run/Plan/revision-afwijzing vóór opslag;
- auditvelden en append-only schema-eigenschappen;
- inhoudshashcontrole bij het actieve Break-even read model;
- afzonderlijke view/manage-capabilities en route-afhankelijkheden;
- geen tweede initiële analysefetch en lazy revisiehistorie;
- runtime-DDL-inventaris, startup-integratie, typecheck, lint, build en bestaande financiële/workflowcontracten.

## Rollout en rollback

Rollout is één applicatiebranch en één automatische additieve schema-initialisatie. De tabel blijft leeg totdat een bevoegde gebruiker bewust een revisie bevestigt.

Applicatierollback bestaat uit het terugdraaien van deze branch. De additieve lege of gevulde tabel mag bij rollback blijven staan en wordt door de oude applicatie genegeerd. De tabel automatisch verwijderen is nadrukkelijk geen rollbackstap; dat zou auditdata kunnen verwijderen en hoort alleen in een later afzonderlijk goedgekeurde destructieve cleanup.

## Handmatige acceptatie

1. Open Break-even als Management of Administrator en controleer dat Plan, Huidig en de initiële Forecast ongewijzigd zichtbaar zijn.
2. Controleer dat verstreken maanden niet bewerkbaar zijn en de lopende/toekomstige maanden wel.
3. Verlaag in de lopende maand een cumulatieve invoer onder Actual en controleer dat opslaan met een duidelijke fout wordt geweigerd.
4. Leg desgewenst één bewuste testrevisie vast met een concrete reden. Controleer daarna het groene succesbericht, het gewijzigde Forecast-resultaat en de revisiehistorie.
5. Open vóór een tweede opslag twee tabbladen. Na opslaan in het eerste moet het verouderde tweede tabblad met een conflict en verversadvies stoppen.
6. Controleer een Brewer- en Sales-account: Break-even hoort niet in de navigatie te staan en directe API-toegang hoort 403 te geven.

De bestaande waarschuwing over ontbrekende kostprijsbronnen is geen RF-012C2B-regressie. Exacte LOT/non-LOT Actual-kostresolutie volgt in RF-012C3.
