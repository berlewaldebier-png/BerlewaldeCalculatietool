# SKU-aanpak — Model & Terminologie (Phase 0)

Status: **agreed** (May 2026)

Doel: van “bier-gedreven” naar **SKU-gedreven** als single source of truth voor selectie en pricing in de hele app.

## UI-terminologie (user-facing)
- We tonen in de UI consequent: **Verkoopbaar artikel**
- “SKU” blijft een intern technisch begrip (id’s, API, logs).

### Subtypes (labels in UI)
- **Bier**
- **Product** (merch, giftsets, glaswerk, etc.)
- **Dienst** (proeverij, workshop, etc.)

## Eenheden (UoM)
Minimale set:
- `stuk`
- `pakket`
- `uur`

Defaults:
- Bier → `stuk`
- Product → `stuk`
- Giftset/bundel → `pakket`
- Dienst → `uur`

## Liters (optioneel)
- `content_liter` is **optioneel**.
- Alleen relevant voor:
  - Bier (en bier-gerelateerde formats/verpakkingen)
  - Bundles/giftsets: liters zijn **afleidbaar** uit samenstelling (BOM) wanneer componenten liters hebben.
- Voor Product/Dienst zonder liters is `content_liter = 0` of leeg toegestaan en mag selectie/pricing niet blokkeren.

## Pricing method per verkoopbaar artikel
We onderscheiden 2 methoden:

### 1) `cost_plus` (default)
Voor:
- Bier
- Product (merch, giftset, glaswerk)

Gedrag:
- `kostprijs` is input/afleiding (kostprijsbeheer + activatie).
- Verkoopstrategie/adviesprijzen bepalen verkoopprijzen o.b.v. opslag / marge.
- Offerte selecteert alleen artikelen met **actieve kostprijs**.

### 2) `manual_rate`
Voor:
- Dienst

Gedrag:
- 1 tarief per dienst (niet per kanaal).
- Offerte kan later alsnog een afwijkende prijs toestaan per offerte.
- Selectie in offerte vereist: dienst is “afgerond” (valid record), niet per se liters.

## Single source of truth
Target richting:
- Centrale lijst `skus` (met `articles`) voedt selectors in:
  - Offerte
  - Verkoopstrategie
  - Adviesprijzen
  - Overige product selectors

“Actief/selecteerbaar” (initieel):
- `cost_plus`: alleen als er een actieve `kostprijsproductactivering` is voor `(sku, jaar)`.
- `manual_rate`: alleen als dienst “afgerond” is (tarief aanwezig).

