# Maturity audit (read-only) - Berlewalde CalculatieTool

Datum: 2026-05-27  
Scope: UX maturity + data model + kostprijs/pricing betrouwbaarheid + resilience/recovery.  
Werkwijze: end-user gedrag via Playwright (Edge) + code/schema review.  

## Bewijs / artifacts

Screenshots (gemaakt tijdens Playwright audit runs):
- `C:\Users\hansh\.codex\CalculatieTool\frontend\audit\artifacts\01-login-form.png`
- `C:\Users\hansh\.codex\CalculatieTool\frontend\audit\artifacts\02-home.png`
- `C:\Users\hansh\.codex\CalculatieTool\frontend\audit\artifacts\03-break-even-v2.png`
- `C:\Users\hansh\.codex\CalculatieTool\frontend\audit\artifacts\04-omzet-en-marge.png`
- `C:\Users\hansh\.codex\CalculatieTool\frontend\audit\artifacts\05-kostprijs-beheren.png`
- `C:\Users\hansh\.codex\CalculatieTool\frontend\audit\artifacts\06-productkoppeling.png`
- `C:\Users\hansh\.codex\CalculatieTool\frontend\audit\artifacts\07-nieuw-jaar-voorbereiden.png`
- `C:\Users\hansh\.codex\CalculatieTool\frontend\audit\artifacts\08-offerte-samenstellen.png`
- `C:\Users\hansh\.codex\CalculatieTool\frontend\audit\artifacts\11-offline-break-even.png`
- `C:\Users\hansh\.codex\CalculatieTool\frontend\audit\artifacts\12-recovered-break-even.png`
- `C:\Users\hansh\.codex\CalculatieTool\frontend\audit\artifacts\13-login-invalid.png`

Playwright run-status:
- `C:\Users\hansh\.codex\CalculatieTool\frontend\test-results\.last-run.json`

## Test setup

- URL: `http://localhost:3000`
- Login gebruikt: `admin/admin` (tijdelijke local login; UI copy noemt dit expliciet).
  - Bron: `C:\Users\hansh\.codex\CalculatieTool\frontend\src\components\LoginForm.tsx`
  - Backend: temp admin is toegestaan via `authenticate_local_temp_admin` (zie `C:\Users\hansh\.codex\CalculatieTool\backend\app\api\routes\auth.py`)
  - Temp admin credentials staan hardcoded in `C:\Users\hansh\.codex\CalculatieTool\backend\app\domain\auth_service.py`
- Playwright runner:
  - Config: `C:\Users\hansh\.codex\CalculatieTool\frontend\playwright.config.ts`
  - Tests: `C:\Users\hansh\.codex\CalculatieTool\frontend\tests\e2e\app.smoke.spec.ts` en `...\audit.maturity.spec.ts`

Read-only regels gevolgd:
- Geen "Opslaan", geen "Activeren", geen drafts creeren/verwijderen.
- Alleen navigatie, refresh/back, offline/recovery, en form-validatie zonder mutaties.

## Executive summary

**Overall maturity score (1–5): 3.0 / 5**

Sterktes:
- Kern journeys zijn bereikbaar en renderen op desktop en mobile emulatie (Playwright runs slagen).
- Centralized prijslogica als pure functies (`frontend/src/lib/pricingEngine.ts`).
- Duidelijke scheiding tussen “kostprijsversies” en “activaties” (table-backed) met per-year scoping.

Grootste risico’s:
- Data integrity rond activaties (SKU ↔ kostprijsversie) is historisch een bron van silent corruption geweest.
- Veel pagina’s hangen aan een grote `bootstrap` call (veel datasets tegelijk); 1 failing dataset kan hele pagina blokkeren.
- Auth is “prepared” mode met auth disabled by default; dat kan verwarrend zijn richting T/P als het niet hard afgedwongen wordt.

## Top 10 risks for real users (prioriteit)

1. **Critical — Activatie mismatch kan reporting/costing corrupt maken**
   - Symptoom: meerdere SKUs krijgen dezelfde (verkeerde) kostprijsversie.
   - Betrokken: `kostprijs_sku_activations`, `cost_versions`.
   - Verificatie: audit endpoint/repair scripts en UI warnings.

2. **High — Bootstrap coupling (single point of failure)**
   - Veel routes doen 1 grote `/api/meta/bootstrap` met veel datasets (bijv. break-even, offerte, nieuw jaar).

3. **High — Resilience bij DB/connectivity issues**
   - Offline test laat zien dat pagina kan falen; recovery werkt na reload, maar UX kan onduidelijk zijn.
   - Evidence: offline screenshot `11-offline-break-even.png`, recovery `12-recovered-break-even.png`.

4. **High — Historische consistentie van offertes**
   - Risico: oude drafts tonen “nieuwe” kostprijzen als ze live uit activaties blijven resolven.
   - Verificatie nodig: quote payload vs recalculatie gedrag.

5. **Medium — Auth/onboarding maturity**
   - UI noemt “tijdelijke login admin/admin” — dit moet in T/P vervangen worden door echte user lifecycle.

6. **Medium — Error messaging: server component exceptions**
   - Als bootstrap/SSR faalt krijg je vaak een generieke server error overlay.

7. **Medium — Mobile UX**
   - Mobile emulatie laadt routes; maar ergonomie (tabs/modals/tables) nog handmatig te beoordelen.

8. **Low/Medium — Encoding artifacts in UI tekst**
   - Voorbeeld: “scenarioâ€™s” in break-even subtitle (`break-even-v2/page.tsx`).

9. **Low — Security posture naar T/P**
   - Auth secret is local default; in non-local moet dit strict enforced worden (is al zo, maar deployment checklist nodig).

10. **Low — Regression risk zonder E2E “edge” suite**
   - Basis smoke is er; uitbreiden met edge cases rond drafts/activeren/year copy.

## UX findings by user flow (wat getest is)

### Flow: Login

Steps:
1) Open `/login`  
2) Login met `admin/admin`

Worked well:
- Snelle feedback; button tekst verandert naar “Inloggen...”.

Friction/risk:
- Copy zegt “tijdelijke login”; voor T/P is dit verwarrend tenzij duidelijk in onboarding.

Error path:
- Wrong credentials toont `.login-error` (screenshot `13-login-invalid.png`).

### Flow: Break-even analyseren (`/break-even-v2`)

Happy path:
- Page rendert en heading zichtbaar (screenshot `03-break-even-v2.png`).

Offline/recovery:
- Offline reload levert failure state (screenshot `11-offline-break-even.png`).
- Terug online + reload herstelt (screenshot `12-recovered-break-even.png`).

Risico:
- Als Douano/DB faalt kan de UX hangen in “laden” zonder duidelijke actie.

### Flow: Omzet & marge (`/omzet-en-marge`)

- Page rendert (screenshot `04-omzet-en-marge.png`).
- Niet verder doorgeklikt (read-only + geen company-id selectie) — handmatige verificatie aanbevolen.

### Flow: Kostprijs beheren (`/nieuwe-kostprijsberekening`)

- Page rendert (screenshot `05-kostprijs-beheren.png`).
- Refresh/back gedrag getest (screenshot `10-back-behavior.png`).

Risico:
- Deep links en wizard state moeten deterministisch blijven bij refresh/back (E2E uit te breiden).

### Flow: Productkoppeling (`/beheer/productkoppeling`)

- Page rendert (screenshot `06-productkoppeling.png`).
- Niet gemuteerd; geen mappings aangepast.

### Flow: Nieuw jaar voorbereiden (`/nieuw-jaar-voorbereiden`)

- Page rendert (screenshot `07-nieuw-jaar-voorbereiden.png`).
- Geen dry-run/apply uitgevoerd (mutatie).

### Flow: Offerte samenstellen (`/offerte-samenstellen`)

- Page rendert (screenshot `08-offerte-samenstellen.png`).
- Geen “opslaan”/draft acties uitgevoerd (mutatie).

## Data model & database findings (evidence-based)

### Table-backed datasets (Phase G)

Geïdentificeerd via schema creators in `backend/app/domain/*_storage.py`:
- `cost_versions` + `cost_version_sku_rows` (`backend/app/domain/cost_versions_storage.py`)
- `kostprijs_sku_activations` + events (`backend/app/domain/kostprijs_activation_storage.py`)
- `quote_drafts` (`backend/app/domain/quote_drafts_storage.py`)
- `new_year_drafts` (`backend/app/domain/new_year_drafts_storage.py`)
- Douano sync (`backend/app/domain/douano_sync_storage.py`) + unmapped (`douano_unmapped_rule_storage.py`)

### Integrity risks

- Activations table heeft unieke index voor “1 actieve activation per (sku,jaar)” maar (in schema snippet) geen FK constraints op `sku_id` of `kostprijsversie_id`.
  - Bron: `backend/app/domain/kostprijs_activation_storage.py`
- Daardoor blijft server-side validatie cruciaal.

## Cost pricing findings

### Waar wordt kostprijs berekend?

- Snapshot/calculatie helpers: `frontend/src/lib/kostprijsSnapshotEngine.ts`
  - Packaging cost resolvers + fixed cost per liter + accijns integratie.
- Pure pricing engine (sell-in, margin, offer totals): `frontend/src/lib/pricingEngine.ts`

### Live vs persisted

- Persisted: `cost_versions.payload` + normalized `cost_version_sku_rows` in DB.
- Active mapping: `kostprijsproductactiveringen` dataset (`kostprijs_sku_activations` table-backed).

### Historische betrouwbaarheid (risico)

Onzeker (moet worden gevalideerd in extra E2E):
- Of quote drafts “frozen” kosten opslaan of live resolven bij heropenen.
- Aanbevolen test: maak draft, wijzig activatie, heropen draft en vergelijk.

## Maturity scoring (1–5)

- Overall product maturity: **3.0**
- UX & navigation: **3.0**
- Error handling & recovery: **2.5**
- Form validation: **3.0**
- State management: **3.0**
- Data model quality: **3.0**
- Database architecture: **3.5**
- Pricing/costing reliability: **3.0**
- Mobile responsiveness: **3.0** (basis load ok; UX detail nog te reviewen)
- Accessibility: **2.0** (niet uitgebreid getest)
- Security/privacy basics: **3.0** (sessie-cookie, rate limit; T/P checklist nodig)
- Maintainability: **3.5**
- Test coverage / regression risk: **3.0** (smoke + audit suite aanwezig, uitbreiden met edge cases)

## Quick wins (<1 day)

- Fix encoding in UI strings (bijv. break-even subtitle “scenarioâ€™s”).
- Voeg UI “Retry” CTA toe bij bootstrap/data load failures.
- Voeg duidelijke banner toe wanneer auth “prepared/disabled” is (om T/P verwarring te voorkomen).

## Medium improvements (1–3 days)

- Voeg E2E scenarios toe:
  - Quote draft: save/reopen + verify freeze behavior.
  - Kostprijs deep link: `?mode=wizard-edit&selected_id=...` + refresh/back.
  - Nieuw jaar: dry-run preview (geen apply) + verify summary consistency.
- Voeg “data health” audit endpoints toe aan UI (read-only) met link naar repair flows.

## Larger refactors

- DB constraints (FKs) waar mogelijk voor activations ↔ SKUs ↔ cost_versions.
- Bootstrap opsplitsen (lazy/route-level data) i.p.v. 1 mega-call.

## Manual test plan (aanvulling)

1) Maak offerte-draft, refresh tijdens save, heropen via `?draft=...`.
2) Activeer nieuwe kostprijsversie voor 1 SKU, heropen oude offerte en check drift.
3) Nieuw jaar voorbereiden: dry-run vergelijken met apply (in aparte test DB).
