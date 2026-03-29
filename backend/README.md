# Nieuwe backend

Deze backend vormt de weblaag bovenop de bestaande Python-logica.

## Starten

Voor de standaard lokale start gebruik je het projectscript vanuit de repo-root:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\hansh\.codex\CalculatieTool\scripts\start_new_ui.ps1
```

Handmatig:

```powershell
cd backend
uvicorn app.main:app --reload
```

## Huidige status

- metadata routes voor navigatie en dashboard
- data read/write endpoints bovenop een providerlaag
- bestaande businesslogica blijft in Python

## Storage providers

De backend ondersteunt nu:

- `json` als standaard/fallback
- `postgres` als nieuwe opslagprovider

Zet hiervoor environment variables, bijvoorbeeld:

```powershell
$env:CALCULATIETOOL_BACKEND_STORAGE_PROVIDER = "postgres"
$env:CALCULATIETOOL_POSTGRES_HOST = "10.10.1.10"
$env:CALCULATIETOOL_POSTGRES_PORT = "5432"
$env:CALCULATIETOOL_POSTGRES_DB = "calculatietool"
$env:CALCULATIETOOL_POSTGRES_USER = "calculatietool_app"
$env:CALCULATIETOOL_POSTGRES_PASSWORD = "VUL_HIER_JE_WACHTWOORD_IN"
```

Of maak lokaal een niet-geversioneerd bestand:

- [backend\\.env.local.ps1.example](C:\Users\hansh\.codex\CalculatieTool\backend\.env.local.ps1.example)

kopieer dit naar:

- `backend\.env.local.ps1`

Dan laadt [start_new_ui.ps1](C:\Users\hansh\.codex\CalculatieTool\scripts\start_new_ui.ps1) deze waarden automatisch mee voor de backend.

Daarna kun je de huidige JSON-data inladen in PostgreSQL via:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\hansh\.codex\CalculatieTool\scripts\bootstrap_postgres.ps1
```

De API exposeert ook:

- `GET /api/data/storage-status`
- `POST /api/data/bootstrap-postgres`

Voor de voorbereide auth-laag:

- `GET /api/auth/status`
- `GET /api/auth/users`
- `POST /api/auth/bootstrap-admin`

Deze laag staat klaar, maar wordt nog niet afgedwongen zolang auth uit staat.

Volgende stap:

- de nieuwe UI gecontroleerd laten draaien op PostgreSQL
- auth, users en rollen verder afmaken
