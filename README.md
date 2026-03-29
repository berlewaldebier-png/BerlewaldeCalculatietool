# Berlewalde Calculatie Tool

De primaire applicatie draait nu als webstack:

- frontend: `Next.js + TypeScript`
- backend: `FastAPI`
- opslag: tijdelijk JSON

De oude Streamlit-app is uitgefaseerd als hoofdroute en bestaat alleen nog als legacy ingang met verwijzing.

## Starten

Gebruik:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\hansh\.codex\CalculatieTool\scripts\start_new_ui.ps1
```

Daarna:

- frontend: `http://localhost:3000`
- backend: `http://127.0.0.1:8000`

## Regressiechecks

Gebruik:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\hansh\.codex\CalculatieTool\scripts\run_regression_checks.ps1
```

Meer context:

- [REGRESSIECHECKS.md](C:\Users\hansh\.codex\CalculatieTool\REGRESSIECHECKS.md)
- [MIGRATIE_UI.md](C:\Users\hansh\.codex\CalculatieTool\MIGRATIE_UI.md)

## Status

Afgeronde migratiefasen:

- Fase 0: basis bevriezen
- Fase 1: design system voor tabellen/forms
- Fase 2: stamdata in nieuwe UI
- Fase 3: verkoopstrategie en prijsvoorstel
- Fase 4: nieuwe kostprijsberekening
- Fase 5: inkoopfacturen, recept hercalculatie, nieuw jaar voorbereiden
- Fase 6: regressiechecks en golden scenarios

Volgende grote stappen:

- Fase 8: PostgreSQL verder afronden en regressiechecks daarop uitbreiden
- Fase 9: auth-basis klaarzetten, later login/rollen afdwingen en eventueel 2FA

## Legacy

De oude Streamlit-route bestaat nog alleen als verwijspagina in [app.py](C:\Users\hansh\.codex\CalculatieTool\app.py). De oude Streamlit UI-bestanden onder `pages/` en `components/` zijn verwijderd. Nieuwe functionele wijzigingen horen in de webstack thuis:

- frontend: [frontend](C:\Users\hansh\.codex\CalculatieTool\frontend)
- backend: [backend](C:\Users\hansh\.codex\CalculatieTool\backend)
