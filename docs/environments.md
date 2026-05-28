# Environments: Local / T / P

## Local

- Frontend: `http://localhost:3000`
- Backend: `http://127.0.0.1:8000`
- Dev tooling is toegestaan (`/api/meta/dev/*`), inclusief reset/seed helpers.

Seed/reset (local/dev):
- Script: `C:\Users\hansh\.codex\CalculatieTool\scripts\dev_reset_and_seed.ps1`
- Vereist: `TEST_USERNAME`, `TEST_PASSWORD`

## Test (T)

Doel: zo dicht mogelijk bij productie, maar met veilige testdata.

Richtlijnen:
- Geen temp admin credentials
- Geen `/api/meta/dev/*` destructive tooling
- Seed gebeurt via migraties + gecontroleerde seed pipeline (of separate test fixtures)
- CI draait volledig tegen T of tegen een ephemeral seeded DB

## Production (P)

Richtlijnen:
- Strikte auth + role boundaries
- Audit logging aan op kritieke acties (activaties, kostprijs commit, offerte definitief, year commit)
- Backups + rollback plan verplicht

