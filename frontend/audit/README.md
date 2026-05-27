# Playwright maturity audit (read-only)

Doel: reproduceerbare end-user maturity audit uitvoeren zonder data-mutaties.

## Run

```powershell
cd C:\Users\hansh\.codex\CalculatieTool\frontend
$env:TEST_USERNAME="admin"
$env:TEST_PASSWORD="admin"
npx playwright test
```

## Output

- Screenshots worden opgeslagen in `audit/artifacts/`.
- Testresultaten worden opgeslagen in `test-results/` (Playwright default).

## Regels (read-only)

- Geen muterende acties: niet “Opslaan”, niet “Activeren”, geen drafts aanmaken/verwijderen.
- Alleen navigatie + laden + foutpaden (offline/throttle) + form-validatie zonder submit.

