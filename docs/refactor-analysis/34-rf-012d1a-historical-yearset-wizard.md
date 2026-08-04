# RF-012D1A — Historische Jaarset in wizardweergave

## Uitkomst

RF-012D1A voegt aan het definitieve Jaarsetdossier een tweede, alleen-lezen weergave toe. `Jaarsetoverzicht` behoudt het in RF-012D1 opgeleverde dossier. `Wizardweergave` gebruikt dezelfde centrale lijst met 14 stappen als de actieve route `Nieuw jaar voorbereiden`, maar zet bron- en doeljaar vast op de geselecteerde definitieve generatie.

Voor Jaarset 2026 betekent dit bronjaar 2025 en doeljaar 2026. De afzonderlijke actie `Nieuw jaar voorbereiden` blijft bronjaar 2026 en doeljaar 2027 openen. De historische weergave bevat geen formulier en kan niet opslaan, activeren, afronden, herstellen of verwijderen.

## Bewijs en bronkwaliteit

De oorspronkelijke conceptwizard is niet meer aanwezig in `new_year_drafts`. Daarom presenteert deze slice niet alsof alle oude invoervelden exact zijn teruggevonden. Iedere stap toont één van vier bronkwaliteiten:

- `exact`: rechtstreeks bewaard en tegen de definitieve generatie gecontroleerd;
- `derived_exact`: uitsluitend samengesteld uit bevroren bronnen, zonder kostprijs opnieuw te berekenen;
- `reconstructed`: een herkenbare latere toestand, niet de exacte invoer op het oorspronkelijke wizardmoment;
- `not_retained`: de afzonderlijke historische invoer is niet bewaard en wordt niet ingevuld met actuele defaults.

De read-only controle van de ontwikkeldata vond:

- één bewaarde berekeningsbatch voor 2025→2026;
- 103 oorspronkelijke presentatieregels;
- 74 unieke stabiele SKU-ID's;
- acht SKU's die in de oude presentatie dubbel voorkwamen, samen 29 extra verwijzingen;
- nul conflicterende financiële duplicaten;
- 74 exacte matches met de definitieve 2026-generatie op zes decimalen;
- nul materiële verschillen;
- vijf definitieve SKU-regels buiten de oude batch: drie expliciet herstelde exacte doeljaarankers en twee catalogusregels waarvoor geen kostprijs vereist is.

De 2026 productie- en driverregel is na de oude wizardbatch bijgewerkt. Deze waarden worden daarom zichtbaar als `gereconstrueerd`. De Planwaarden en maandverdeling komen uit het onveranderlijke Plancontract. Tarieven, vaste kosten en verpakkingsprijzen zijn op hetzelfde bewaarmoment als de oude berekeningsbatch vastgelegd en worden als exact gemarkeerd. Een afzonderlijke receptsnapshot en oorspronkelijke initialisatie-checkboxes zijn niet bewaard.

## Veiligheidsgrenzen

De nieuwe backendreader:

- accepteert uitsluitend een gereed `active` of `superseded` Jaarsetdossier met de exacte generatie/runbinding;
- start de aanvullende PostgreSQL-transactie met `SET TRANSACTION READ ONLY`;
- initialiseert geen schema;
- groepeert oude presentatieregels op stabiele `sku_id`;
- blokkeert bij conflicterende duplicaten, een financieel verschil of onverklaarde ontbrekende lineage;
- roept geen kostprijsformule en geen mutatie-endpoint aan.

Deze slice bevat geen schemawijziging, migratie, backfill, dataherstel, herberekening of wijziging van een opgeslagen record. Het later bewerkbaar herstellen van een Jaarset blijft buiten scope en vereist een apart ontwerp, autorisatiepad en tests.

## Gewijzigde grenzen

- Backendprojectie: `backend/app/domain/historical_yearset_wizard_service.py`
- Admin-only read endpoint: `GET /api/meta/commercial-yearsets/{operational_year}/historical-wizard`
- Gedeelde 14-stappenbron: `frontend/src/components/nieuw-jaar/nieuwJaarWizardSteps.ts`
- Historische UI: `frontend/src/components/HistoricalYearsetWizard.tsx`
- Jaarsettoggle: `frontend/src/components/YearsetDossier.tsx`

## Beschermende tests

De contracttests bewaken:

- exact dedupliceren zonder financieel verlies;
- fail-closed gedrag bij conflicterende dubbele regels;
- fail-closed gedrag bij afwijking van het definitieve dossier;
- uitsluitend toegestane exacte doeljaarankers en niet-kostprijscatalogusregels buiten de oude batch;
- het zichtbaar onderscheiden van exacte en later gereconstrueerde bronnen;
- een strict read-only reader zonder DDL of DML;
- admin-only routebescherming;
- hergebruik van één 14-stappencontract en afwezigheid van frontendmutaties.

## Handmatige acceptatie

1. Open `/beheer/jaarsets/2026` en controleer dat `Jaarsetoverzicht` standaard actief is.
2. Kies `Wizardweergave` en controleer bronjaar 2025, doeljaar 2026 en exact 14 stappen.
3. Controleer in stap 9: 103 oorspronkelijke regels, 74 unieke SKU's en 74 exacte matches.
4. Controleer dat gereconstrueerde of niet-bewaarde bronnen expliciet zo zijn gemarkeerd.
5. Loop met `Vorige` en `Volgende` door de stappen; er mag geen opslag-, activatie-, herstel- of verwijderactie zijn.
6. Ga terug naar `Jaarsetoverzicht`; de oorspronkelijke dossierweergave moet ongewijzigd beschikbaar zijn.
7. Kies afzonderlijk `Nieuw jaar voorbereiden`; deze actie moet nog steeds 2026→2027 openen.

## Uitgesloten vervolgwerk

- RF-012D2: `Kostprijs beheren` op de actieve commerciële generatie aansluiten.
- RF-012D3: volledige planning-anchor- en factuur/brouw/LOT-kostprijshistorie tonen.
- Historische Jaarset herstellen of opnieuw activeren.
- Niet-bewaarde oude wizardinvoer reconstrueren of raden.
