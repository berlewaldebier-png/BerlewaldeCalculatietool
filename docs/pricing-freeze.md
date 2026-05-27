# Pricing freeze (offertes)

## Doel

Historische offertes mogen niet “stil” veranderen doordat kostprijzen, activaties, tarieven of verkoopprijzen later wijzigen.

## Gedrag

- Status `concept`:
  - Mag aangepast worden.
  - Slaat de volledige draft snapshot op (incl. per-product kosten/prijs) voor reproduceerbaarheid.
- Status `definitief`:
  - Wordt immutabel: een definitieve offerte kan niet meer aangepast of teruggezet worden.
  - Voor wijzigingen moet de gebruiker een nieuwe offerte/draft maken (copy/duplicate flow volgt).

## Rationale

Dit voorkomt:
- stille prijsdrift bij herberekeningen of gewijzigde activaties
- support issues (“waarom is mijn oude offerte anders?”)

