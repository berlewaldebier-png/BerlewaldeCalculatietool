# Regressiechecks

Deze set hoort bij de nieuwe Next.js/FastAPI-migratie en helpt om snelle regressies te vangen voordat wijzigingen naar een stabielere omgeving gaan.

## Automatisch script

Voer uit:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\hansh\.codex\CalculatieTool\scripts\run_regression_checks.ps1
```

Het script controleert nu:

- actieve backend-provider = `postgres`
- `Berlewalde Ipa` 2025 `Inkoop` definitief
  - 2 facturen
  - 4029,5 liter
  - EUR 11.552,28 subfacturen
  - EUR 300 extra kosten
  - integrale kostprijs per liter `2.9747106754353307`
- `Berlewalde Goudkoorts` 2025 `Eigen productie` definitief
  - 1 ingrediëntregel `Honing`
  - integrale kostprijs per liter `0.1`
  - productsnapshot aanwezig
- prijsvoorstel `202603001`
  - klant `Berendhaus`
  - jaar `2025`
  - kanaal `horeca`
  - 6 productregels
  - 1 staffel
- jaarbasis aanwezig in:
  - dataset `productie`
  - dataset `vaste_kosten`
  - dataset `tarieven_heffingen`

De checks lopen dus via de draaiende FastAPI-backend en de actieve PostgreSQL-provider, niet meer via lokale JSON-bestanden.

## Handmatige checklist

Loop voor een release of grotere refactor minimaal dit na in de nieuwe UI:

1. `Productie`
   - laden, wijzigen, opslaan
2. `Vaste kosten`
   - regels toevoegen/verwijderen/opslaan
3. `Producten & verpakking`
   - verpakkingsonderdelen laden en opslaan
   - basisproducten en samengestelde producten openen
4. `Nieuwe kostprijsberekening`
   - bestaande record openen
   - wizardstappen doorlopen
   - samenvatting tonen
5. `Inkoopfacturen`
   - definitief inkoopbier selecteren
   - factuurregel aanpassen
   - opslaan
6. `Recept hercalculatie`
   - bronberekening kiezen
   - concept-hercalculatie starten
7. `Nieuw jaar voorbereiden`
   - bronjaar en doeljaar kiezen
   - preview bekijken
   - jaarset genereren
8. `Verkoopstrategie` en `Prijsvoorstel`
   - record openen
   - kernvelden aanpassen
   - opslaan

## Golden scenarios

Gebruik deze drie scenario's als vaste referentie:

- `Berlewalde Ipa` 2025 `Inkoop`
- `Berlewalde Goudkoorts` 2025 `Eigen productie`
- `Prijsvoorstel 202603001`

Als één van deze drie scenario's onverwacht afwijkt, eerst onderzoeken voordat verdere migratiestappen doorgaan.
