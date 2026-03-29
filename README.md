# Berlewalde Calculatie Tool

De primaire applicatie draait nu als webstack:

- frontend: `Next.js + TypeScript`
- backend: `FastAPI`
- opslag: `PostgreSQL` als primaire opslag

De oude Streamlit-app is volledig uitgefaseerd. De primaire route is nu de Next.js/FastAPI-webstack.

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
- Fase 7: Streamlit uitfaseren
- Fase 8: PostgreSQL als primaire opslag activeren

Volgende grote stappen:

- Fase 9: auth-basis klaarzetten, later login/rollen afdwingen en eventueel 2FA
- UI/UX-logica verder verfijnen en businesslogica blijven toetsen

## Legacy

De oude Streamlit UI-bestanden onder `pages/` en `components/` zijn verwijderd. JSON-bestanden bestaan nog alleen voor legacy/bootstrap-doeleinden en zijn niet meer de actieve primaire opslag. Nieuwe functionele wijzigingen horen in de webstack thuis:

- frontend: [frontend](C:\Users\hansh\.codex\CalculatieTool\frontend)
- backend: [backend](C:\Users\hansh\.codex\CalculatieTool\backend)
