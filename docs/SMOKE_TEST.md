# Smoke test (dev) — SKU model

Deze checklist is bedoeld voor een snelle “werkt alles nog?” ronde na grote modelwijzigingen (SKU/Article/BOM).

## Prereqs

- Backend draait op `http://127.0.0.1:8000`
- Frontend draait op `http://localhost:3000`
- Log in als admin via `http://localhost:3000/login`

## 1) Hard reset + seed

1. Ga naar Swagger: `http://127.0.0.1:8000/docs`
2. Run:
   - `POST /api/meta/dev/hard-reset`
   - `POST /api/meta/dev/seed-sku-foundation?year=2025&with_demo=true`

Verwacht:
- Seed response met `articles`, `skus`, `bom_lines`, `bieren`, `packaging_component_prices`
- Demo bundle “Geschenkset 4 bieren”

## 2) Offerte

1. Open `http://localhost:3000/offerte-samenstellen`
2. Kies kanaal (Horeca/Retail) en voeg product toe
3. Opslaan concept (draft) werkt

Verwacht:
- Productpicker toont alleen “ready” items (actieve kostprijs + liters + sell-in)

## 3) Break-even

1. Open `http://localhost:3000/break-even`
2. Maak basisconfig → Opslaan
3. Activeer basis voor offertes → Opslaan

Verwacht:
- Opslaan werkt zonder 404
- Statusmeldingen tonen succes/fout

## 4) Verkoopstrategie

1. Open `http://localhost:3000/verkoopstrategie`
2. Je ziet formats (Fles/Doos/Fust) in de lijst
3. Pas opslag% aan → Opslaan

Verwacht:
- Opslaan werkt
- Geen lege productlijst na hard reset + seed

## 5) Adviesprijzen

1. Open `http://localhost:3000/adviesprijzen`
2. Vul opslag per kanaal → Opslaan

Verwacht:
- Opslaan werkt zonder 404

## 6) Producten & verpakking

1. Open `http://localhost:3000/producten-verpakking`
2. Tabs:
   - Verpakkingsonderdelen
   - Afvuleenheden
   - Afvulsamenstellingen
   - Verkoopbare artikelen
   - Jaarprijzen
3. Controleer:
   - Jaarprijzen opslaan werkt
   - “Verkoopbare artikelen” toont demo bundle

## 7) Scenario analyse

1. Open `http://localhost:3000/scenario-analyse`
2. Selecteer product → voer override in → compare

Verwacht:
- Producten zichtbaar en refs stabiel (`sku:...`)

