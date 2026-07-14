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

## Reproduceerbare ontwikkelbaseline

De ondersteunde runtimes zijn Node.js 22 en Python 3.11 (zie `.nvmrc` en
`.python-version`). De officiële Python-testrunner is de ingebouwde `unittest`
runner; pytest is geen onderdeel van de baseline.

Voer vanuit de repository-root uit:

```powershell
.\.venv\Scripts\python.exe scripts\check_unittest_discovery.py
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Voer daarna vanuit `frontend` uit:

```powershell
npm ci
npm run lint
npm run typecheck
npm run build
npm run test:pricing
```

Deze baseline gebruikt lokaal geen seed-, reset- of migratiecommando's.
End-to-endtests blijven zichtbaar in CI, maar zijn conform het goedgekeurde
roadmap-slice RF-001 niet blokkerend totdat RF-003 het testharnas voor een
bewaakte, uitsluitend wegwerpbare database heeft vastgelegd. Bekende E2E-afwijkingen
worden dus niet stil overgeslagen en mogen ook niet met appwijzigingen binnen
RF-001 worden weggewerkt.

De ESLint-baseline gebruikt de Next.js core-web-vitals- en TypeScript-regels. Vier
reeds repository-brede schuldcategorieën zijn tijdelijk uitgezonderd:
`no-explicit-any`, `no-unused-vars`, `no-require-imports` en
`no-unescaped-entities`. Bestaande hook-, image- en toegankelijkheidsmeldingen
blijven zichtbaar als waarschuwingen. Het oplossen of aanscherpen daarvan hoort
in een afzonderlijk goedgekeurd refactor-slice; RF-001 verandert geen appcode om
de lintbaseline kunstmatig groen te maken.

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
