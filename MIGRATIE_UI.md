# UI-migratie naar webstack

De actieve richting voor deze testomgeving is:

- frontend: Next.js + TypeScript + React
- backend: FastAPI
- businesslogica: bestaande Python-code behouden
- opslag: PostgreSQL als primaire opslag, met JSON alleen nog als legacy/bootstrap

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
- Fase 8: klaar als PostgreSQL-first basis

## Bewuste keuze

De Streamlit-app is volledig uitgefaseerd. De verdere investering gaat volledig naar de nieuwe webstack.

## Wat Fase 7 concreet heeft gedaan

- de Next.js/FastAPI-stack is de primaire applicatie geworden
- de oude Streamlit UI-laag onder `pages/` en `components/` is uit de repo verwijderd
- de oude Streamlit-ingang is uit de repo verwijderd
- regressiechecks zijn vastgelegd en draaibaar vanuit scripts
- projectdocumentatie is bijgewerkt naar de webstack

## Fase 8 status

De PostgreSQL-migratie staat nu als werkende basis:

- backend draait PostgreSQL-first
- lokale backend-config kan via `backend/.env.local.ps1`
- bestaande datasets zijn gebootstrapt naar PostgreSQL
- regressiechecks lopen via de actieve PostgreSQL-backed API
- JSON is teruggebracht tot legacy/bootstrap-pad

## Volgende fases

- Fase 9: auth-basis staat klaar; login en afdwingen volgen later
- daarna: UI/UX verder verfijnen, oude businesslogica gericht refactoren en blijven valideren
