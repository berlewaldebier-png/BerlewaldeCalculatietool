# Core User Flows (Business-critical)

Doel: dit zijn de flows die altijd stabiel moeten zijn (UX, data, performance, recovery).

## Auth

- Login: `GET /login`, `POST /api/auth/login`
- Status/me: `GET /api/auth/status`, `GET /api/auth/me`
- Logout: `POST /api/auth/logout`

## Kostprijs / pricing

- Kostprijs beheren: `GET /kostprijs-beheren` (en gerelateerde componenten)
- Nieuwe kostprijsberekening: `GET /nieuwe-kostprijsberekening`
- Activaties: `GET /api/data/kostprijsproductactiveringen`

## Break-even & omzet

- Break-even v2: `GET /break-even`
- Omzet & marge: `GET /omzet-en-marge`
- Douano integratie: `GET /api/integrations/douano/*`

## Productkoppeling / unmapped

- Productkoppeling: `GET /beheer/productkoppeling`
- Unmapped rules: UI kaart + services onder `backend/app/domain/douano_unmapped_*`

## Offertes

- Offerte samenstellen: `GET /offerte-samenstellen`
- Drafts: `quote_drafts` via `backend/app/domain/quote_drafts_storage.py`

## Nieuw jaar voorbereiden

- Wizard: `GET /nieuw-jaar-voorbereiden`
- Backend: `POST /api/meta/prepare-new-year`

