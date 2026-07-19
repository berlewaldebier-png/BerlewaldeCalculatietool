# RF-009A — UI screen consistency and adoption matrix

## Purpose and decision boundary

This document closes the gap between the route dossiers in `04-screen-inventory.md`, the cross-screen findings in `06-ui-consistency.md`, and the implementation slice described in `09-refactoring-roadmap.md`.

It answers, for every screen:

- what is inconsistent;
- whether the inconsistency is visual, interaction-related, accessibility-related, workflow-related, or possibly intentional;
- which shared UI family should own the correction;
- which changes belong in RF-009 and which must wait for screen-by-screen RF-012 work;
- what must remain unchanged.

**RF-009A is analysis-only.** No application source, styles, routes, permissions, workflows, APIs, calculations, or persisted data are changed by this slice.

## Evidence convention

- **Observed:** confirmed in current source, a current local browser session, or existing tests.
- **Inferred:** strongly suggested but not completely proven for every state or role.
- **Unknown:** runtime state, product intent, or assistive-technology behavior could not be established safely.

Priority:

- **P0:** critical accessibility or reliable-operation issue; prepare the earliest safe primitive slice.
- **P1:** important interaction/responsive inconsistency; implement after the foundation is protected.
- **P2:** material consistency or maintainability issue without an immediate access barrier.
- **P3:** investigate, obtain product confirmation, or defer.
- **Reference:** currently suitable as a comparison surface; do not redesign merely for uniformity.

## Current runtime baseline

The baseline was captured on 2026-07-16 from branch `codex/rf-009-ui-primitives`, based on main commit `03278c2`.

### Safe runtime method

- The local development frontend was opened on port 3001 against the existing development backend.
- Forty-six route URLs were opened using GET-only navigation.
- All non-GET/HEAD/OPTIONS `/api/**` requests were blocked by the audit harness.
- No blocked mutations were observed, so none of the audited pages attempted an automatic write during initial rendering.
- SCREEN-024 requires a meaningful company ID and was not dynamically exercised; its assessment remains source-derived.
- Representative desktop and 390px mobile screenshots were reviewed locally. They were not added to Git because they contain development data and produce large binary diffs.

### Runtime results that materially change priority

| Evidence | Classification | Consequence |
|---|---|---|
| All 46 requested route URLs returned HTTP 200 during the guarded audit. | **Observed.** | The matrix is not based only on unreachable source; the current main branch renders the route inventory in the development setup. |
| `SCREEN-005 /bieren` produced 96 critical axe `label` nodes. | **Observed.** | `DatasetTableEditor` accessible naming is the strongest first shared-family candidate because SCREEN-005/009/012 reuse it. |
| `SCREEN-038 /beheer/lot-kosten` produced 8 critical `label` nodes and 2 critical `select-name` nodes. | **Observed.** | LOT controls need correction, but the screen is too large and workflow-sensitive to be the first primitive adoption. |
| Every representative axe scan produced at least one serious `color-contrast` node; the quote builder produced five. | **Observed.** Exact affected colors and intentional branding remain **Unknown** until token-by-token inspection. | Contrast must be traced to semantic tokens or intentional local palettes before changing colors globally. |
| SCREEN-038 had document width 2247px in a 1440px viewport. | **Observed.** | This is a page-level responsive failure, not merely a table-scroller preference. It belongs in a dedicated high-risk screen slice after table semantics are protected. |
| Mobile screenshots show the standard sidebar expanding into a long full-width navigation block before feature content. | **Observed.** Product direction is now **approved**: retain the desktop sidebar and use a collapsed, user-opened navigation drawer/disclosure on small screens. | Implement the shell change in RF-012 with semantic navigation links, explicit open/close controls, current-page indication, Escape/focus-return behavior and route-by-route regression checks; do not apply a global RF-009 CSS shortcut. |
| SCREEN-006 and SCREEN-038 render dense desktop-scale tables at 390px; SCREEN-005 exposes only the leading columns within its table viewport. | **Observed.** | Table categories need documented mobile behavior. A universal responsive-table conversion would be unsafe. |
| SCREEN-020 remains recognizably responsive and preserves its CPQ identity, but its heading wraps tightly and CPQ controls still lack a dedicated focus rule. | **Observed** for rendering/CSS; actual keyboard perception is **Unknown** until manual focus testing. | Keep CPQ visually separate and schedule its focus/contrast work as its own family. |
| The existing read-only Playwright smoke expects “Break-even analyseren”, while the current H1 is “Break-even analyse”. | **Observed.** | The current smoke baseline is stale and must be corrected in a separately approved test-maintenance change before it can gate UI screenshots reliably. |
| A SmartGlobalSearch hydration warning referenced a changing `caret-color` style. | **Observed** warning; cause is **Unknown** and may involve browser instrumentation. | Investigate before registering an application defect; do not change search behavior based only on this warning. |

### Runtime limitations

- Manual keyboard focus order, dialog focus containment/restoration, screen-reader output, 200–400% zoom and touch behavior were not completed in this slice.
- Axe was run on representative screen families rather than every route and modal state.
- The screenshots show initial route states. Conditional dialogs, validation errors, loading transitions and permission variants were not opened because that would require controlled interaction fixtures.
- Color-contrast findings may originate in the common shell, development badge or feature content. Each affected node must be traced before a token is changed.
- These limitations are recorded as **Unknown**, not treated as evidence that the behavior is correct.

## Shared implementation-family taxonomy

These are adoption families, not permission to implement them all in one PR.

| Family | Responsibility | RF boundary |
|---|---|---|
| **F1 — Focus and semantic tokens** | Visible focus, semantic foreground/background/border states, reduced-motion hook, intentional token exceptions. Approved meanings are neutral/muted for secondary information, blue for information/selection, green for success/active, amber/orange for warning/attention and red for error/destructive. Color must not be the only carrier of meaning. | RF-009, one CSS/component family at a time. Preserve the Berlewalde palette, measure contrast, and adjust only the owning token/component where evidence requires it. |
| **F2 — Accessible name and async status** | Programmatic field names, row/column context, `role=status`/`alert`, loading/busy semantics, predictable message placement and a safe recovery action where one is known. | RF-009, starting with a low-risk shared component. Message placement is consistent by category rather than forced into one absolute page position. |
| **F3 — Tabs, menu, and combobox behavior** | Arrow/Home/End behavior, selected/panel relationships, active descendant, Escape, focus return. | RF-009 after F1/F2 baselines. |
| **F4 — Dialog behavior** | Accessible title, initial focus, tab containment, Escape/outside policy, focus restoration, cancel/no-write. Approved default: Escape cancels every cancelable dialog and never saves; outside click may close read-only/informational dialogs but not forms, destructive/financial confirmations or dialogs with unsaved changes; focus returns to the invoker. Initial focus goes to the first invalid/first form field, the least-destructive action for irreversible work, or the heading for long structured information. | RF-009 one non-destructive dialog family at a time; destructive/financial dialogs require workflow characterization before adopting the approved behavior. |
| **F5 — Table taxonomy** | Separate contracts for read-only analytics, editable datasets, admin tables, wizard tables, and CPQ lines. Working mobile policy: quotations and small operational actions are the first edit candidates; dashboard/forecast/revenue/product summaries are readable; bulk cost, LOT, mapping, year and administration grids remain desktop-first. True two-dimensional data may scroll inside its own table container. | RF-009 defines shared semantics/cells; RF-012 handles page-specific responsive composition. Full quotation editing at 390px remains a narrow product-validation item; do not infer a universal mobile-table conversion. |
| **F6 — Shell and responsive hierarchy** | PageShell variants, mobile navigation, title/breadcrumb placement, content widths and feature breakpoints. Approved direction: the dashboard uses the shared application shell with a distinct operational-overview composition; desktop retains the sidebar and mobile uses a collapsed drawer/disclosure. | RF-012 route-by-route; not an RF-009 primitive sweep. Forecasting and recommended ordering/brewing actions require separate business-rule approval and are not UI-shell work. |
| **F7 — Permission outcome UI** | Typed 401/403 rendering and access-denied recovery under existing styles. | Requires RF-008A; RF-009 renders but does not decide permissions. |
| **F8 — Terminology and product content** | Authoritative Dutch vocabulary and unavailable-feature policy. Approved terms are `Gebruikers`, `Kostprijs beheren` and `Scenario analyseren`. Unavailable affordances are hidden rather than presented as live-looking “Binnenkort” features. | Apply copy changes only in a bounded screen/component slice. Hiding an affordance does not authorize deleting compatibility routes or future implementation seams. Version/deployment copy still requires operations input. |

## Per-screen matrix

### Authentication, global shell, and personal settings

| Screen | Current inconsistency and evidence | Classification / priority | Recommended outcome | Candidate family |
|---|---|---|---|---|
| **SCREEN-001 — Login** `/login` | Separate auth layout is appropriate, but runtime axe found two serious contrast nodes. Success/error text is feature-local; environment-specific default credentials remain mixed into the same component. Source: `LoginForm`. | Visual/accessibility **Observed**; intentional shell variation **Inferred**. **P1**. | Preserve the distinct login composition. Trace the two contrast failures to tokens, give submit/recovery results shared announcement semantics, and separately characterize environment-specific defaults. | F1, F2; environment behavior outside visual consolidation. |
| **SCREEN-002 — Dashboard** `/` | Own sidebar/content frame rather than PageShell; first semantic heading in the audit was chart-oriented rather than a stable page H1. One serious contrast issue and a search hydration warning occurred. | Layout/accessibility **Observed**; product role **approved** as an operational overview rather than a separate analytics shell. **P1**. | Use the shared application shell with a distinct operational-dashboard composition. Add a stable page-name contract and shared status/focus semantics. Future content may summarize revenue, plan variance, forecast, exceptions and recommended actions, but forecasting, stock-out and order/brew rules require separate workflow/data slices. Investigate the hydration warning independently. | F1/F2; F6 in RF-012. |
| **SCREEN-003 — Full search** `/search` | Standalone page frame; request failure is rendered as the same state as no results; global search and full search expose different semantics and recovery. | Interaction/workflow **Observed**. **P1**. | Separate error from empty without changing query rules; share search-status semantics. Decide whether standalone shell is intentional before layout work. | F2/F3; F6 in RF-012. |
| **SCREEN-004 — My account** `/account` | Cohesive form, but async password result is visually rendered without a shared live-status contract. Header advertises 2FA while this screen has no 2FA control. | Accessibility **Observed**; 2FA product intent **Unknown**. **P1/P3**. | Use as a low-risk settings-form reference. Adopt the shared status primitive; do not invent 2FA functionality. | F2; F8 decision. |
| **SCREEN-028 — Calculation settings** `/instellingen` | Runtime heuristic found at least 20 unnamed visible controls. Independent panels save separately and can show partially updated settings. | Accessibility **Observed**; partial-update workflow **Observed**. **P0/P1**. | Add explicit names and status semantics panel by panel. Preserve independent save boundaries until product approves a combined transaction. | F2 first; screen orchestration in RF-012. |
| **SCREEN-029 — Company settings** `/instellingen/bedrijf` | Low-complexity settings form; one serious contrast node in representative scan. Save status is local, although RF-008 centralized its API boundary. | Accessibility/visual **Observed**. **P1 / Reference**. | Use as the first low-risk status-message reference: preserve fields, copy, payload and save behavior; place save feedback consistently with the form actions, announce it, and provide a safe next action when known. Trace contrast to the owning token. | F1/F2. |
| **SCREEN-031 — Notifications** `/instellingen/meldingen` | Static “Binnenkort” cards coexist with a hard-coded global notification badge, implying live functionality. | Content/workflow mismatch **Observed**; product decision **approved**. **P1**. | Hide unavailable notification affordances and the live-looking hard-coded badge. Do not build notifications, remove compatibility paths or invent notification state in RF-009. | F8. |
| **SCREEN-044 — Support** `/support` | Form and context cards are locally implemented; submission/recovery semantics are not shared with other forms. Version context differs from the header version source. | Interaction/content **Observed**; external support delivery behavior **Unknown**. **P2/P3**. | Adopt shared field/status behavior after settings forms. Establish one runtime version source before changing copy. | F2/F8. |

### Master data, products, and cost inputs

| Screen | Current inconsistency and evidence | Classification / priority | Recommended outcome | Candidate family |
|---|---|---|---|---|
| **SCREEN-005 — Beers** `/bieren` | Shared editable dataset table; axe found 96 critical missing-label nodes. Row deletion has no confirmation and whole-grid edits have no dirty-navigation guard. Mobile shows only leading columns inside the table viewport after a long navigation block. | Accessibility **Observed**, workflow risk **Observed**. **P0**. | First shared-family implementation candidate: derive each input name from row identity + column header, announce save results, retain existing focus appearance, table density, pagination, deletion and save semantics. Characterize dirty/delete behavior; do not change it in the naming slice. | F2 first; F5 later. |
| **SCREEN-006 — Products & packaging** `/producten-verpakking` | Five plain-button tabs lack one complete tab contract; search input lacks a programmatic name; local SKU modal lacks a shared focus lifecycle. Mobile view is extremely dense and desktop-scale. | Accessibility/interaction/responsive **Observed**. **P0/P1**. | Name the search control independently; later adopt one tab behavior under existing styling. Treat the modal and mobile composition as separate slices. | F2, then F3/F4; F5/F6 in RF-012. |
| **SCREEN-007 — Compose product wizard** `/product-samenstellen` | Uses a feature-owned wizard-step presentation, native confirmation and many unsaved local fields; no shared dirty-navigation protection. | Workflow/interaction **Observed**. **P2, high regression risk**. | Preserve workflow and visual structure. Characterize step transitions, cancel, deletion and save before adopting shared wizard/dialog behavior. | F4/F5 only after RF-004-style workflow tests; RF-012 screen slice. |
| **SCREEN-008 — Services** `/diensten` | Read-only derived table; mapping failure and empty result are locally expressed, and empty-table behavior is not explicit. | Async/table inconsistency **Observed**. **P2**. | Define an actionable read-only table empty/error contract without introducing editing. | F2/F5. |
| **SCREEN-009 — Production** `/productie` | Reuses DatasetTableEditor; audit sampled 20 unnamed numeric inputs. Additional autofill behavior makes this more workflow-sensitive than Beers. | Accessibility **Observed**. **P0**. | Receive the same naming/status correction as SCREEN-005 through the shared editor. Keep autofill and numeric interpretation unchanged. | F2 via first shared editor slice. |
| **SCREEN-010 — Fixed costs** `/vaste-kosten` | Audit sampled unnamed text/select/number controls. Feature-owned tables, confirmations and status behavior operate on financial inputs. | Accessibility **Observed**; financial workflow risk **high**. **P0 for names, P2 for consolidation**. | Apply name/status primitives only after exact save/delete behavior is characterized. Do not consolidate table or confirmation behavior with non-financial screens in the first UI PR. | F2; F4/F5 later with finance regression tests. |
| **SCREEN-011 — Incidental costs** `/incidentele-kosten` | Multiple editable tables and feature-owned save/delete feedback differ from fixed-cost and dataset-editor flows. | Interaction/table inconsistency **Observed**. **P1/P2**. | Share field naming and status semantics, but retain its separate cost-row model and commit behavior. | F2; F5 later. |
| **SCREEN-012 — Tariffs & levies** `/tarieven-heffingen` | Reuses DatasetTableEditor; audit found eight unnamed visible numeric controls. | Accessibility **Observed**. **P0**. | Migrate together with SCREEN-005/009 through the same row + column naming contract, without changing units, values or save behavior. | F2 via first shared editor slice. |
| **SCREEN-013 — Purchase invoices** `/inkoopfacturen` | Entry table delegates to the large cost wizard; deletion, nested tables, dialogs and async messages use several patterns. | Workflow/dialog/table fragmentation **Observed**. **P2, high financial risk**. | Exclude from early UI primitive adoption. Protect invoice-version selection, wizard entry, cancellation and deletion before any dialog/table replacement. | F4/F5 in later RF-012 slice. |
| **SCREEN-014 — Brew moment** `/recept-hercalculatie` | Two custom confirmation/form dialogs are labelled but do not expose a shared initial-focus, trap, Escape or focus-return implementation. | Accessibility/interaction **Observed**; actual keyboard runtime **Unknown**. **P1**. | Candidate for a later dialog behavior trial only after cancel/no-write and recalculation side effects are characterized. | F4. |
| **SCREEN-015 — Cost-price management** `/nieuwe-kostprijsberekening` | Multiple wizard implementations and confirmation styles coexist. Two serious contrast nodes were found. Some saving/finalizing status now has live semantics, so the original analysis is partly improved. | Mixed implementation **Observed**; partial improvement **Observed**. **P1/P2, high financial risk**. | Preserve the improved saving semantics. Trace contrast, then adopt primitives only inside one tested sub-surface. Never normalize all wizard steps/dialogs in one RF-009 change. | F1/F2 selectively; F4/F5 in RF-012. |
| **SCREEN-016 — Cost activation** `/kostprijs-activatie` | Page is outside the PageShell provider although client code expects shell-header context. Audit found no stable H1 and sampled 20 unnamed checkboxes. Uses native confirmation for activation. | Shell/accessibility/workflow **Observed**. **P0/P1, high financial risk**. | First add explicit checkbox names/group context in a protected slice. Separately decide shell placement and confirmation policy. Do not change activation semantics. | F2; F6/F4 later. |

### Sales, quotations, and analytics

| Screen | Current inconsistency and evidence | Classification / priority | Recommended outcome | Candidate family |
|---|---|---|---|---|
| **SCREEN-017 — Sales strategy** `/verkoopstrategie` | Feature-owned pricing tables, accordions and state controls overlap visually with editor and CPQ families but have distinct financial behavior. | Visual/table duplication **Observed**; intentional density **Inferred**. **P2**. | Preserve the sales-pricing layout. Share only semantic cells, focus and status behavior after pricing parity tests. | F1/F2/F5; RF-012. |
| **SCREEN-018 — Recommended prices** `/adviesprijzen` | Audit found four unnamed number controls; local save/status handling differs from settings and pricing screens. | Accessibility **Observed**; financial risk **medium/high**. **P0/P1**. | Add explicit names and shared status semantics without changing price calculations, rounding, defaults or save granularity. | F2 after pricing fixtures. |
| **SCREEN-019 — Price proposals** `/prijsvoorstellen` | Table actions and native delete confirmation differ from quote-builder dialogs. Permission denial previously surfaced as a generic failure and depends on RF-008A for a typed UI outcome. | Interaction/permission **Observed**. **P1**. | Keep deletion semantics unchanged until characterized. Implement access-denied UI only after RF-008A; later align table action naming. | F7 first dependency; F4/F5 later. |
| **SCREEN-020 — Quote builder** `/offerte-samenstellen` | Distinct CPQ family; five serious contrast nodes, an unnamed customer search input, `.cpq-input/.cpq-select/.cpq-textarea` remove outlines without a replacement focus rule, and several local dialogs lack shared focus lifecycle. Mobile composition remains recognizable but headings wrap tightly. | Accessibility **Observed**; distinct denser CPQ visual family **approved**. **P0/P1, high workflow risk**. | Preserve the CPQ identity and density while sharing accessible names, semantic status, focus and approved dialog behavior. Introduce a CPQ-specific visible focus token after screenshots. Handle option/volume dialogs in their own characterized slice. Treat quotations as the first mobile-edit candidate, subject to confirming whether full editing is required at phone width or primarily tablet/laptop. | F1/F2, then F4/F5; not the first RF-009 family. |
| **SCREEN-021 — Break-even** `/break-even` | Special analytics layout and partial tab semantics. One serious contrast node. Existing smoke test expects obsolete H1 text. | Visual/accessibility/test drift **Observed**. **P1**. | Correct the test baseline separately, preserve analytics density, then complete tab keyboard/panel relationships and contrast tracing. | Test maintenance; F1/F3; RF-012 for layout. |
| **SCREEN-022 — Scenario analyseren** `/scenario-analyse` | Own filter/input controls and browser persistence; analogous analytics interactions are not shared with Break-even. | Interaction/state inconsistency **Observed**. Authoritative UI term **approved**. **P2**. | Use `Scenario analyseren` consistently. Document local-persistence and override semantics before sharing filters/status. Retain scenario-specific behavior. | F2/F5/F8; RF-012. |
| **SCREEN-023 — Revenue & margin** `/omzet-en-marge` | Audit found unnamed customer/date inputs; tables and filter/error behavior differ from other analytics screens. | Accessibility/interaction **Observed**. **P0/P1**. | Name filters, add consistent load/empty/error status, and classify tables as read-only analytics. | F2/F5. |
| **SCREEN-024 — Customer revenue/margin detail** `/omzet-en-marge/[companyId]` | Custom palettes, nested line tables and mapping links. No meaningful company ID was exercised in the runtime audit. | Source-level variation **Observed**; real-data responsive/accessibility behavior **Unknown**. **P2/P3**. | Capture a representative customer snapshot before changing palettes, nested tables or mapping actions. | F1/F5; RF-012 after runtime fixture. |

### Year workflows, administration, and integrations

| Screen | Current inconsistency and evidence | Classification / priority | Recommended outcome | Candidate family |
|---|---|---|---|---|
| **SCREEN-025 — Close year** `/jaar-afsluiten` | Twelve-step financial wizard, native confirmations, editable tables and local draft/final status. No global dirty-navigation guard. | Workflow/dialog inconsistency **Observed**. **P2, very high risk**. | Exclude from early UI consolidation. Protect every confirm/cancel/finalization path before adopting primitives. | RF-012 after workflow/financial characterization. |
| **SCREEN-026 — Prepare new year** `/nieuw-jaar-voorbereiden` | Large conditional wizard with native confirms and feature-owned status. One serious contrast node; mobile shell/content sequence is very long. | Visual/workflow/responsive **Observed**. **P1/P2, very high risk**. | Trace contrast only after snapshot baseline. Defer wizard, table and mobile hierarchy work until business-rule/source-of-truth slices are complete. | F1 narrowly; otherwise RF-012 after RF-010/011/013 dependencies. |
| **SCREEN-027 — Setup/rebuild** `/setup` | Destructive reset uses native confirmation; readiness, dry-run and result status use local patterns. | Destructive interaction **Observed**. **P1/P2**. | Preserve native blocking behavior until reset/no-write/dry-run tests exist. Later adopt shared status and an approved destructive dialog policy. | F2; F4 later. |
| **SCREEN-030 — Cost-management hub** `/instellingen/kostprijsbeheer` | Cohesive navigation-only screen, but its activation CTA can open SCREEN-016 without actionable years. | Workflow link inconsistency **Observed**; visual issue not proven. **P2**. | Keep as a visual reference. Correct the route/parameter workflow in a separately approved screen slice, not via UI primitives. | Reference; RF-012 workflow correction. |
| **SCREEN-032 — Administration hub** `/beheer` | Clear card hub. Permission-aware navigation changed after the original audit, so role-specific card visibility must be revalidated before further consolidation. | Current simplicity **Observed**; cross-role state **Unknown**. **Reference/P3**. | Preserve card pattern; add role screenshots only when RF-008A permission states are implemented. | F7 dependency; otherwise Reference. |
| **SCREEN-033 — Gebruikersbeheer** `/beheer/users` | English “Users” conflicts with the approved Dutch term `Gebruikers`. Edit/deactivate dialogs are labelled but lack shared focus lifecycle. Mobile title is tightly wrapped/partly obstructed by the development badge, and the create-user grid becomes narrow. | Terminology/accessibility/responsive **Observed**; terminology **approved**. **P1**. | Replace visible `Users` terminology with `Gebruikers` in a bounded copy slice. Consider the edit-user dialog as a later non-destructive dialog pilot after save/cancel tests; handle mobile form composition in RF-012. | F4/F6/F8. |
| **SCREEN-034 — Data quality** `/beheer/api` | Partial tab semantics, an unnamed select, panel-local status and a local repair modal. | Accessibility/interaction **Observed**. **P0/P1**. | Name the select independently. Complete tabs after the shared tab contract exists; migrate repair dialog only after dry-run/action tests. | F2, then F3/F4. |
| **SCREEN-035 — API integration** `/beheer/api-integratie` | Audit found unnamed number/search controls. Douano/ORS panels use technical, feature-local status and include external side effects. | Accessibility/status **Observed**; operational risk **high**. **P0/P1**. | Add names and announcements without changing sync/geocode behavior. Do not use this screen as the first async retry or dialog pilot. | F2; later operational screen slice. |
| **SCREEN-036 — Product mapping** `/beheer/productkoppeling` | Plain-button tabs, unnamed filter, several local CPQ-style modals without a shared accessible title/focus lifecycle. One serious contrast node. | Accessibility/interaction **Observed**. **P0/P1**. | Name filter first. Adopt shared tabs after F3 tests; migrate one read-only modal before edit/resolve dialogs. | F2, then F3/F4. |
| **SCREEN-037 — Product classification** `/beheer/productclassificatie` | Incomplete tab semantics and feature-owned editable tables/status. One serious contrast node. Runtime axe did not find the DatasetTableEditor-scale label failure, but keyboard behavior remains incomplete. | Accessibility/interaction **Observed**. **P1**. | Strong candidate for the first tab adoption after F1/F2; preserve edit/reset/save semantics. | F3, then F2/F5. |
| **SCREEN-038 — LOT costs** `/beheer/lot-kosten` | Eight critical label nodes, two critical select-name nodes, serious contrast, 2247px document width at 1440px, severe mobile scaling, multiple file/import forms, tables, native confirms and a custom modal. | Accessibility/responsive/workflow **Observed**. **P0**, but **very high implementation risk**. | Correct field names in a contained slice after import/LOT tests. Then handle page overflow and table/mobile composition as a dedicated RF-012 screen project. Never combine label, import, table and responsive rewrites. | F2 first; F4/F5/F6 later. |
| **SCREEN-039 — Year-set administration** `/beheer/jaarsets` | Mixed year entities in one table; several native confirmations and feature-owned status/action labels. | Interaction/table/workflow **Observed**. **P1/P2**. | Preserve destructive semantics. Classify table as selectable admin data and characterize every action before dialog consolidation. | F2/F5; F4 later. |
| **SCREEN-042 — Developer tools** `/beheer/devtools` | Environment-denial and destructive tool modes share one screen; typed confirmation and local result status differ from setup/reset patterns. | Interaction/permission **Observed**. **P1/P2**. | Share status/access-denied semantics only after RF-008A. Keep destructive confirmation explicit and environment-gated. | F2/F7; F4 later. |

### Static information and compatibility routes

| Screen | Current inconsistency and evidence | Classification / priority | Recommended outcome | Candidate family |
|---|---|---|---|---|
| **SCREEN-040 — Manual** `/beheer/handleiding` | Cohesive static page, but persistence/deployment wording conflicts with SCREEN-041. | Content inconsistency **Observed**. **P3**. | Use as a static-page visual reference; operations owner must reconcile content. | Reference/F8. |
| **SCREEN-041 — Deployment notes** `/beheer/deployment` | Static operational copy describes a persistence transition that conflicts with current PostgreSQL-first documentation. | Operational content mismatch **Observed**. **P3**. | Correct only after the future deployment-environment session; not UI primitive work. | F8/out of current scope. |
| **SCREEN-043 — Changelog** `/changelog` | Cohesive static cards; no material interaction inconsistency identified. | **Observed Reference.** | Preserve as a lightweight-card reference; only adopt global focus/contrast tokens when verified. | Reference/F1. |
| **SCREEN-045 — Legacy break-even alias** `/break-even-next` | Audit still displayed the shared “Laden…” surface during the short observation window. Route exists only for compatibility redirect. | Compatibility behavior **Observed**; redirect timing **Unknown**. **P3**. | Preserve redirect and query compatibility. Improve the shared loading surface, not the alias page. | Shared state surface only. |
| **SCREEN-046 — Legacy proposal alias** `/prijsvoorstel` | Same temporary shared loading presentation before compatibility redirect. | Compatibility behavior **Observed**. **P3**. | Preserve redirect. No screen-specific redesign. | Shared state surface only. |
| **SCREEN-047 — Legacy revenue alias** `/omzetgegevens` | Same temporary shared loading presentation before compatibility redirect. | Compatibility behavior **Observed**. **P3**. | Preserve redirect. No screen-specific redesign. | Shared state surface only. |

## Cross-screen surfaces that require explicit primitive ownership

| Surface | Current inconsistency | Recommendation |
|---|---|---|
| **SCREEN-G01 — Header** | Hard-coded notification count/version; search/breadcrumbs disappear at different widths; account-menu behavior is local. | Separate product content from interaction behavior. Hide the unavailable notification affordance/count; do not build notifications. Header menu/search keyboard work belongs in F3; version ownership remains in F8. |
| **SCREEN-G02 — Smart search** | Good local arrow/Enter/Escape support, but incomplete combobox/listbox relationships and an unresolved hydration warning. | Characterize active-descendant, expansion, selection and Escape before extracting. Investigate hydration warning without changing visible behavior. |
| **SCREEN-G03 — PageShell/navigation** | At mobile width, the full navigation list precedes primary content and makes every standard screen extremely long. | Product direction is approved: retain the desktop sidebar and use a collapsed mobile drawer/disclosure with a labelled menu button, semantic navigation links, current-page state, explicit close, Escape and focus return. Implement in RF-012, not as a global RF-009 CSS edit. |
| **SCREEN-G04 — Account menu** | Menu roles and Escape/outside close exist; arrow-key navigation and focus restoration are not centralized. | Adopt a headless menu contract after focus baseline tests. |
| **SCREEN-S01 — Route loading** | Minimal “Laden…” surface has no shared app-shell context or explicit progress/status semantics. | Introduce status semantics first; visual shell treatment requires design review. |
| **SCREEN-S02/S03 — Error boundaries** | Retry exists, but raw error message/digest presentation differs from feature errors and may disclose internals. | Use RF-008 error metadata to separate user message from diagnostic details; tell the user what failed, what is known about the save outcome and the next safe action. Preserve retry/login actions, but never offer an automatic retry for a non-idempotent write without a proven endpoint guarantee. |

## Recommended RF-009 implementation order

### Proposed RF-009B — Dataset editor accessible naming and status

This is the recommended first implementation slice after human approval.

- **Screens:** SCREEN-005, SCREEN-009, SCREEN-012.
- **Shared owner:** `DatasetTableEditor`.
- **Changes:** row + column accessible names; save/error live-status semantics; explicit busy state relationships where missing; one predictable result area associated with the editor actions; safe recovery copy where the API outcome supports it.
- **Must remain unchanged:** table layout, visible labels, field values, null/number handling, pagination, row order, add/delete behavior, reconciliation API calls, routes and permissions.
- **Message contract:** say what failed, whether the data is known to be saved or unsaved, and what the user can safely do next. Do not infer persistence outcomes or expose raw technical details. Field-validation messages remain with their fields; editor-level save results remain with the editor actions.
- **Regression tests:** axe label result, accessible-name assertions, keyboard Tab sequence, save success/error announcement and placement, recovery action where applicable, duplicate-submit protection, screenshots at desktop and 390px.
- **Explicitly excluded:** delete confirmation, dirty-navigation protection, table redesign, mobile column strategy, permissions, dataset contracts.
- **Expected acceptance:** the 96 critical label nodes on SCREEN-005 are eliminated without a visible or data-behavior change; SCREEN-009/012 receive the same correction through the shared component.

### Proposed follow-on order

1. **RF-009C:** low-risk shared status primitive on SCREEN-004/029, using the approved message hierarchy and recovery-action contract proven in RF-009B.
2. **RF-009D:** tab behavior pilot on SCREEN-037, then SCREEN-006/034/036 where workflow tests permit.
3. **RF-009E:** one non-destructive/read-only dialog behavior pilot; destructive and financial confirmations remain excluded.
4. **RF-009F:** document and implement shared read-only versus editable table semantics; no universal table.
5. **RF-009G:** document and pilot the navigation/form-action contract for `Terug`, `Vorige`, `Annuleren`, `Opslaan`, `Opslaan en sluiten`, `Volgende` and `Afronden`; preserve each workflow's characterized save and cancellation behavior.
6. **RF-012:** adopt approved primitives screen by screen; mobile shell, LOT overflow and large wizard composition remain screen-specific layout/workflow work.

Each follow-on requires its own branch/PR unless the roadmap explicitly approves a combination.

## Product and interaction decisions recorded after review

The following decisions were recorded from the product-owner review on 2026-07-17 and 2026-07-18. They guide later slices but do not authorize implementing all of them in RF-009B.

1. **Dashboard — approved.** The dashboard is an operational overview of the current situation, not a separate analytics shell. It should eventually summarize revenue, variance from plan, forecast, exceptions and useful actions such as an expected stock-out. It uses the shared application shell with a distinct dashboard composition. Forecasting and order/brew recommendations remain separate business-rule work.
2. **Mobile navigation — approved direction.** Retain desktop navigation and use an established collapsed drawer/disclosure pattern on small screens. It is closed by default and must have semantic links, current-page indication, explicit open/close controls, Escape behavior and focus return.
3. **CPQ/quotations — approved.** Preserve the denser, visually distinct quotation family. Share accessibility and interaction contracts without flattening it into the standard editor/card appearance.
4. **Terminology — approved.** Authoritative visible terms are `Gebruikers`, `Kostprijs beheren` and `Scenario analyseren`, using Dutch sentence case.
5. **Dialogs — approved default policy for future characterized adoption.** Escape cancels cancelable dialogs and never saves. Outside click may close informational/read-only dialogs, but not forms, destructive/financial confirmations or dialogs with unsaved changes. Focus is contained, initially placed according to task risk/content, and returned to the invoking control. Every dialog retains an explicit close or cancel action.
6. **Semantic colors — approved.** Preserve the current Berlewalde identity while using neutral/muted, information, success, warning and error/destructive meanings consistently. Measure contrast; do not use color alone; include text or an icon. Exact compliant token values are implementation evidence, not a product-owner hex-code decision.
7. **Unavailable features — approved.** Hide unavailable affordances such as non-functional notifications instead of presenting live-looking “Binnenkort” controls. This does not authorize route deletion or building the feature.
8. **Mobile tables — working policy.** Quotations and small operational actions are the leading mobile-edit candidates. Dashboard, forecast, revenue/margin, product/cost summaries and alerts should be readable on mobile. Bulk cost, LOT, mapping, year and administration grids remain desktop-first, using contained horizontal scrolling when row/column relationships require it. Whether the complete quotation builder must support editing at 390px phone width or primarily tablet/laptop remains **Unknown** and must be confirmed before its RF-012 screen slice.
9. **Messages and recovery — approved.** Use a consistent location by message category: field validation beside the field, form/editor save results beside the relevant action area, page-level load/access failures below the page title, and fatal failures in the error boundary. Where the system knows a safe recovery, state what failed, whether data was saved, and what the user should do. Never invent a persistence outcome or retry a non-idempotent write automatically.
10. **Navigation and action labels — approved direction.** A page with a clear parent uses an explicit destination-oriented back link near the page start rather than ambiguous history. Wizard footers keep `Vorige` separate on the left and completion/continuation actions on the right, with the primary action last. `Volgende` must not imply a save; use `Opslaan en doorgaan` when continuing persists. Apply this contract only after the existing destination, save, cancel and unsaved-change behavior is characterized.

## Completion decision for RF-009A

RF-009A is complete when:

- every route screen has an explicit recommendation or documented intentional exception;
- the first implementation family is bounded and testable;
- high-risk screen redesign work is assigned to RF-012 rather than hidden inside primitive consolidation;
- permission-state UI remains dependent on RF-008A;
- no application code or persisted data has changed;
- the product and interaction decisions above are recorded;
- the user approves RF-009B or requests changes to this matrix.
