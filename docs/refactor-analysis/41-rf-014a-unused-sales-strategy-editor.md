# RF-014A — ongebruikte VerkoopstrategieEditor verwijderen

Status: geïmplementeerd in een draft-PR; wacht op handmatige acceptatie.

## Afgebakende kandidaat

Deze slice verwijdert uitsluitend:

- `frontend/src/components/VerkoopstrategieEditor.tsx`.

Het bestand was een generieke client-editor die een willekeurig endpoint en een
volledige lijst verkoopstrategieregels via `PUT` kon vervangen. Het is geen
route, API-contract, databaseobject, export of actief onderdeel van een wizard.

## Evidence van afwezig gebruik

De conclusie is **Observed** met hoge zekerheid:

1. Een hoofdletterongevoelige repositoryzoekopdracht naar bestandsnaam,
   symboolnaam, importpad, `require` en dynamische import vond vóór verwijdering
   alleen de declaratie in het kandidaatbestand zelf.
2. `/verkoopstrategie` importeert `SalesStrategyScreen`, dat de
   RF-012C4A-`ActiveSalesStrategyWorkspace` rendert.
3. `NieuwJaarWizard` importeert bewust de afzonderlijke
   `VerkoopstrategieWorkspace`; deze draftworkflow blijft aanwezig.
4. TypeScript-configuratie, workflow/pricing-contracten, Playwright, CI,
   Next-configuratie en package scripts noemen het kandidaatbestand niet.
5. Het frontendpakket heeft `private: true` en geen `exports`-veld. Het bestand
   is dus geen gepubliceerd componentcontract.
6. Git-historie toont introductie in commit `075f2bf`. De in diezelfde commit
   toegevoegde `/verkoopstrategie`-route gebruikte al
   `VerkoopstrategieWorkspace`. Een historiezoekopdracht vond geen import van
   `VerkoopstrategieEditor` in TypeScript/TSX.

Er is geen runtime-telemetrie nodig voor een module die nooit in een routebundle
of publieke package-export terechtkomt. De draft-PR is het menselijke
reviewvenster; mergen is de expliciete product/repository-goedkeuring.

## Behouden gedrag en veiligheidsgrens

- SCREEN-017 blijft dezelfde actieve jaarsetprojectie en gerichte RF-012C4A-save
  gebruiken.
- De verkoopstrategiestap van Nieuw jaar voorbereiden blijft dezelfde
  `VerkoopstrategieWorkspace` en draft-save gebruiken.
- URL's, API's, rollen, berekeningen, prijsbronnen en foutafhandeling wijzigen
  niet.
- Er is geen databaseverbinding, datamutatie, schemawijziging, migratie,
  backfill of cleanup van opgeslagen records.
- Andere legacy helpers, compatibilityvelden en historische quote-/yearsetpaden
  vallen expliciet buiten deze slice.

Een nieuwe unittest bewaakt dat het bestand en alle runtimeverwijzingen afwezig
blijven en dat beide geldige entrypoints expliciet aanwezig blijven.

## Acceptatie

1. Open `/verkoopstrategie`; de actieve 2026-SKU's en huidige sell-inprijzen
   moeten ongewijzigd laden.
2. Zoek een bestaande SKU en controleer dat lezen en, als Administrator, één
   gerichte save nog werken. Herstel een testwijziging indien nodig.
3. Open Nieuw jaar voorbereiden en navigeer naar Verkoopstrategie; de bestaande
   conceptworkflow moet ongewijzigd laden. Activeren of afronden is niet nodig.
4. Controleer dat er geen nieuwe 404, chunk-load- of modulefout in de browser
   verschijnt.

## Rollback en vervolg

Rollback is een gewone code-revert van dit ene bestand en de bijbehorende
evidence/test; er is geen data- of migratierollback.

Na acceptatie wordt een volgende RF-014-kandidaat opnieuw afzonderlijk bewezen.
De impliciete driejaars sell-in-lookback, quotecompatibiliteit en opgeslagen
historische paden worden door RF-014A niet aangeraakt.
