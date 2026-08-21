# RF-014B — ongebruikte RF-011A frontend-resolver verwijderen

Status: geïmplementeerd in een draft-PR; wacht op handmatige acceptatie.

## Afgebakende kandidaat

Deze slice verwijdert één deprecated featurepad:

- `frontend/src/features/commercial-context/activeCommercialContextResolver.ts`;
- de exclusieve synthetische contracttest voor dat bestand;
- uitsluitend de twee TypeScript-configuratieregels en één test-runneraanroep
  die nodig waren om dat exclusieve contract uit te voeren.

De resolver was in RF-011A een read-only karakteriseringsmodel voor een
toekomstige centrale commerciële context. Hij had geen route- of
opslagadapter. De geaccepteerde RF-012C-slices hebben daarna afzonderlijke,
backendgebonden contexten ingevoerd voor offertes, Break-even,
Verkoopstrategie en Adviesprijzen.

## Evidence van afwezig gebruik

De conclusie is **Observed** met hoge zekerheid:

1. Een actuele import-/symboolzoekopdracht vindt buiten het kandidaatbestand
   alleen zijn eigen contracttest en `tsconfig.pricing.json`.
2. Git-historie vanaf RF-011A vindt uitsluitend de introductiecommit en geen
   latere runtime-import.
3. De historische RF-011A-documentatie zegt expliciet dat geen scherm op de
   resolver was aangesloten en dat een toekomstige adapter nog ontbrak.
4. Nieuwe offertes gebruiken `/quotes/commercial-context` en
   `quoteCommercialContext.ts`.
5. Break-even gebruikt de backend read-modelroute plus
   `breakEvenCommercialContext.ts`.
6. SCREEN-017 en SCREEN-018 gebruiken de actieve RF-012C4A/B-projecties.
7. Het private frontendpakket heeft geen publieke componentexports.

De draft-PR is het menselijke reviewvenster. Mergen is de expliciete
repository-/productgoedkeuring voor dit ene featurepad.

## Bewust behouden

- `quoteCommercialContext.ts` en ondersteuning voor bestaande historische
  offertes;
- `breakEvenCommercialContext.ts` en Plan/Forecast/Actual-contracten;
- `activeCommercialContextPlanning.ts`, omdat de canonieke
  jaarovergangsplanner `selectPlanningCostCandidate` nog gebruikt;
- gedeelde types en utilities met resterende callers;
- `activeCommercialContextShadow.ts`, als afzonderlijke RF-014-kandidaat die
  pas na deze slice opnieuw op callers wordt onderzocht;
- alle backend authority-, dossier-, cost-, pricing- en LOT-services.

Er is geen databaseverbinding, datamutatie, schemawijziging, migratie,
backfill, formulewijziging of verwijdering van historische records.

## Regressiebescherming en acceptatie

Nieuwe structurele tests bewaken dat de resolver, symbolen, exclusieve test en
pricingconfiguratie afwezig blijven. Ze bewaken tegelijk de actuele offerte-,
Break-even- en jaarovergangspaden.

Handmatig:

1. Open een nieuwe offerte en controleer dat de actieve 2026-producten laden.
2. Open een bestaande historische offerte en controleer dat opgeslagen regels
   en prijzen ongewijzigd blijven.
3. Open Break-even 2026 en controleer Plan, Forecast en Actual.
4. Open Verkoopstrategie en Adviesprijzen kort.
5. Controleer de browserconsole op nieuwe module-, chunk- of 404-fouten.

## Rollback en vervolg

Rollback is een gewone code-revert van het resolverpad en zijn exclusieve
testconfiguratie. Er is geen data- of migratierollback.

Na acceptatie onderzoekt RF-014C `activeCommercialContextShadow.ts` opnieuw.
Het wordt alleen verwijderd wanneer de RF-014B-baseline bevestigt dat geen
runtime- of noodzakelijke testcaller resteert.
