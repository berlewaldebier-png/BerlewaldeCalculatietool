# Break-even (v2) – Acceptatie checklist (jaar 2025)

Doel: controleren dat Break-even (v2) correct break-even liters/omzet berekent op basis van **gerealiseerde Douano factuurregels** (SSOT) + **verkoopstrategie (sell‑in)** + **kostprijs activaties (as‑of datum)**.

URL: `/break-even-v2`

## A. Voorwaarden (data)

1. Douano sync is gedaan:
   - Sales invoices + invoice lines aanwezig.
   - Producten aanwezig.
2. Productkoppeling is (grotendeels) gevuld:
   - Ongekoppelde regels zijn toegestaan, maar moeten als waarschuwing zichtbaar zijn.
3. Kostprijzen zijn geactiveerd voor 2025:
   - `kostprijsproductactiveringen` bevat SKU’s die verkocht zijn.
4. Verkoopstrategie is minimaal aanwezig:
   - `jaarstrategie` voor 2025 bestaat.
   - Optioneel: overrides (verpakking/product) als je die gebruikt.

## B. API checks (SSOT)

1. Endpoint geeft resultaat terug:
   - `GET /api/integrations/douano/sales-by-sku?year=2025&basis=invoice`
   - Verwacht: `result.items[]` met `sku_id`, `units`, `net_revenue_ex`, `cost_total_ex`, `fixed_total_ex`.
2. Unmapped wordt apart gerapporteerd:
   - Verwacht: `result.unmapped.total_net_revenue_ex` ≥ 0.

## C. UI checks (basisvariant)

1. Kanaal-kaart:
   - “Actief kanaal” default = `horeca`.
   - Kanaalmix default effectief 100% horeca (normaliseerknop werkt).
2. Resultaat-cards (jaar 2025):
   - “Verkochte liters” > 0 (als er bier verkocht is).
   - “Gewogen contributie / L” > 0 (anders waarschuwing).
   - “Break-even liters” en “Break-even omzet (bier)” zijn > 0 bij normale data.
   - “Margin of safety” is plausibel (kan negatief als jaar verliesgevend is).
3. Waarschuwingen:
   - Als er unmapped omzet is: waarschuwing met bedrag + verwijzing naar productkoppeling.
4. Tabel “Gerealiseerde verkoop (per SKU)” (bier/liters):
   - Kolommen vullen voor top 5 SKU’s:
     - Stuks > 0, Liters > 0, Mix% (som ~ 100% over liter-rows).
     - Sell‑in (strategie) > 0 (tenzij strategie ontbreekt → dan warning op row).
     - Variabel/L ≥ 0, Contributie/L plausibel.
     - Bijdrage totaal ≈ Contributie/L × Liters (controle met rekenmachine).
5. Tabel “Non-bier (per stuk)” (merch/glaswerk):
   - Alleen zichtbaar als er non‑liter SKU’s in sales zitten.
   - Mix% som ~ 100% over unit-rows.

## D. Scenario checks (scenario-variant)

Maak scenario vanuit basis 2025 en controleer:

1. Prijsaanpassing +2%:
   - Gewogen sell‑in/L stijgt.
   - Break-even liters daalt (mits contributie/L stijgt).
   - Delta-cards tonen logisch teken.
2. Variabel +3%:
   - Gewogen variabel/L stijgt.
   - Break-even liters stijgt.
3. Vaste kosten +EUR:
   - Break-even liters stijgt lineair.
4. Mix shift:
   - Voeg volume/mix aanpassing toe op een SKU met hoge contributie/L:
     - Gewogen contributie/L stijgt.
     - Break-even liters daalt.

## E. Consistentie checks

1. Verkoopstrategie SKU-first:
   - Zet een sell‑in prijs override op een beer×format (product override) en sla op.
   - Herlaad `/api/data/verkoopprijzen`:
     - De override bestaat en heeft (bij voorkeur) `sku_id` gevuld.
   - In break-even v2 zie je dat sell‑in (strategie) van die SKU verandert.

## F. Exit criteria (P0 “goed genoeg”)

- Basis 2025 laadt zonder errors.
- Unmapped omzet is zichtbaar.
- Cards en tabellen vullen, scenario’s werken, delta’s kloppen richting.

