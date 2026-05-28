# Release Gates (T/P readiness)

Doel: elke release is reproduceerbaar, voorspelbaar, en herstelbaar. Deze gates moeten **groen** zijn vóór deploy naar Test (T) en Production (P).

## 1) Basis: build & lint (frontend)

In `C:\Users\hansh\.codex\CalculatieTool\frontend`:

- `npm run build`
- `npm run lint`

## 2) Pricing contract tests (frontend)

In `C:\Users\hansh\.codex\CalculatieTool\frontend`:

- `npm run test:pricing`

## 3) UI smoke / E2E (frontend)

In `C:\Users\hansh\.codex\CalculatieTool\frontend`:

- `npm run test:e2e`

Minimale verwachtingen:
- login werkt met test-user
- kernpagina’s laden (desktop + mobile viewport)
- refresh/back veroorzaakt geen dataverlies zonder warning
- offline/online recovery: duidelijke foutmelding + herstelt na reconnect

## 4) Data health checks (backend)

Doel: data-integriteit issues detecteren vóór gebruikers ze merken.

### Read-only checks (aanrader voor T/P)
- Run de beschikbare `/api/meta/health/*` checks (nog uitbreiden waar nodig).

### Repair runs (alleen op expliciete actie)
- Repairs zijn opt-in (dry-run eerst), bv:
  - `POST /api/meta/repair/kostprijs-activation-sku-mismatches?dry_run=true&year=<jaar>`

## 5) Operational readiness

- “Rollback plan” aanwezig (wat te doen bij mislukte deploy).
- Logging: errors zijn vindbaar (minimaal request-id + route + error class).
- Secrets/config: geen temp admin / dev flags actief in T/P.
