# UI-migratie naar webstack

De actieve richting voor deze testomgeving is:

- frontend: Next.js + TypeScript + React
- backend: FastAPI
- businesslogica: bestaande Python-code behouden
- opslag: tijdelijk JSON, later PostgreSQL

## Wat is nu aangemaakt

- `backend/`
  - FastAPI entrypoint
  - meta routes
  - data read/write routes
  - wrapper naar bestaande `utils/storage.py`
- `frontend/`
  - Next.js app shell
  - verticale navigatie
  - routes voor alle huidige hoofdmodules
  - nieuwe flows voor:
    - kostprijsberekening
    - inkoopfacturen
    - recept hercalculatie
    - nieuw jaar voorbereiden

## Fase-status

- Fase 0: klaar
- Fase 1: klaar
- Fase 2: klaar
- Fase 3: klaar
- Fase 4: klaar
- Fase 5: klaar
- Fase 6: klaar
- Fase 7: klaar

## Bewuste keuze

De Streamlit-app is niet langer de primaire route. [app.py](C:\Users\hansh\.codex\CalculatieTool\app.py) is nu alleen nog een legacy ingang met doorverwijzing naar de nieuwe web-UI. De verdere investering gaat volledig naar de nieuwe stack.

## Wat Fase 7 concreet heeft gedaan

- de Next.js/FastAPI-stack is de primaire applicatie geworden
- de oude Streamlit-ingang verwijst alleen nog door naar de nieuwe startroute
- de oude Streamlit UI-laag onder `pages/` en `components/` is uit de repo verwijderd
- regressiechecks zijn vastgelegd en draaibaar vanuit scripts
- projectdocumentatie is bijgewerkt naar de webstack

## Fase 8 status

De eerste PostgreSQL-mijlpaal staat nu:

- backend ondersteunt `json` en `postgres` als storage provider
- lokale backend-config kan via `backend/.env.local.ps1`
- bestaande datasets zijn gebootstrapt naar PostgreSQL
- de nieuwe UI draait al tegen de PostgreSQL-provider

Wat nog openstaat binnen Fase 8:

- regressiechecks uitbreiden zodat ze ook de PostgreSQL-route expliciet meenemen
- eventueel van generieke dataset-opslag naar een verder genormaliseerd datamodel groeien
- beslissen wanneer JSON alleen nog fallback/export is

## Volgende fases

- Fase 8: verder afronden van de PostgreSQL-migratie
- Fase 9: auth-basis staat klaar; login en afdwingen volgen later
