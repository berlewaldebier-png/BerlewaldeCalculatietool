# RF-009G navigation and form-action inventory

## Classification

This inventory records the bounded RF-009G adoption. It does not authorize navigation or save-behaviour changes outside these named screens.

| Interface | Evidence | Existing effect | RF-009G outcome | Classification |
|---|---|---|---|---|
| Tarieven en heffingen | `frontend/src/app/(app)/instellingen/bedrijf/page.tsx` links directly to `/tarieven-heffingen` | The tariff editor had no explicit way back to its known settings entry point | Add a semantic `Terug naar Bedrijfsinstellingen` link to `/instellingen/bedrijf`; it performs no write | Observed |
| Artikelkostprijsberekening | `ArticleKostprijsWizard`, `KostprijsBeheerWorkspace.returnToLanding` | `Terug` calls the known landing callback; `Volgende` only changes the step; `Opslaan` persists; `Afronden` persists and may activate | Keep every handler and order; clarify `Terug` as `Terug naar Kostprijs beheren`; adopt the shared leading/trailing action bar | Observed |
| Product samenstellen | `ProductSamenstellenWizard` footer and its save handlers | `Terug` uses browser history because the wizard has several entry routes; `Volgende` only changes step; `Opslaan & verder` persists and opens the result step | Preserve browser history and every handler; clarify the destination uncertainty as `Terug naar vorige pagina`; label the persisting continuation `Opslaan en doorgaan`; adopt the shared action bar | Observed |

## Contract protected by tests

- Leading actions occur before trailing actions in DOM and keyboard order.
- `Vorige` only changes the local wizard step.
- `Volgende` only changes the local wizard step and sends no mutation request.
- `Opslaan en doorgaan` retains the existing save-and-open-result handler.
- Page and wizard back actions send no mutation request.
- The tariff back link has the explicit `/instellingen/bedrijf` destination.
- Product composition retains browser-history navigation because its parent depends on its entry route.

## Explicit exclusions

- `BerekeningenWizard`, `InkoopFacturenManager`, `NieuwJaarWizard` and `JaarAfsluitenWizard` are not adopted in RF-009G. Their draft, activation, finalization and dirty-state semantics require workflow-specific characterization before adding or moving actions.
- No browser-history action is replaced when multiple valid parent routes exist.
- No new cancel action, confirmation dialog, autosave, dirty-state guard or persistence call is introduced.
- No routes, API contracts, business rules, calculations, permissions or data models change.

## Confidence and limitation

- The listed handlers and destinations are directly observed in source code: **confirmed**.
- Whether every user enters Tarieven en heffingen from Bedrijfsinstellingen is **unknown**; the sidebar also exposes it as a top-level Kostenstructuur route. The explicit link is therefore a known parent shortcut, not a claim about browser history.
- High-risk wizard adoption remains deferred until its unsaved-change and finalization behavior is separately approved.
