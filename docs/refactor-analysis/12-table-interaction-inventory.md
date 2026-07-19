# RF-009F table interaction inventory

## Purpose and classification rule

This inventory records the table families considered by RF-009F. It is not an instruction to make every table sortable. A column is sortable only when its component owns a characterized ordering contract and sorting does not replace a manual, workflow, financial or server-defined order.

Repository scan on 2026-07-19 found 66 frontend source files containing table markup, 11 files containing sorting-related symbols, and four consumers of `DatasetTableEditor`.

Classification labels:

- **Observed:** directly confirmed in the current source or tests.
- **Inferred:** strongly suggested by component and workflow structure but not fully protected by tests.
- **Unknown:** the product meaning of the order cannot be proven safely from the repository.

## Adopted family in RF-009F

| Family | Screens | Source and owner | Interaction type | Sorting owner | RF-009F decision |
| --- | --- | --- | --- | --- | --- |
| Shared editable dataset table | SCREEN-005 `/bieren`; SCREEN-009 `/productie`; SCREEN-012 `/tarieven-heffingen`; SCREEN-006 `/producten-verpakking` → Glasmaten | `frontend/src/components/DatasetTableEditor.tsx`; consumers in the three route pages and `ProductenVerpakkingWorkspace.tsx` | Editable, paginated, local rows before save | Client-side; stable sort over the complete local row objects before pagination | **Adopt.** Make existing sortable headers visible and accessible. Preserve input order until the user selects a column. |

Observed invariants for this family:

- `sortKey` starts empty, so supplied row order is initially preserved.
- A newly selected column starts ascending; selecting it again toggles descending.
- Text, number and checkbox columns use the existing comparators in `frontend/src/lib/tableControls.ts`.
- Stable tie-breaking uses the row's prior index.
- Sorting operates on complete row objects, then pagination slices the result.
- Changing the sort or page size returns to page one.
- Saving serializes the unsorted local `rows` state, so a visual sort does not change persisted row order.
- The action column is not sortable.

RF-009F changes only discoverability and accessibility semantics in this family: visible inactive/active indicators, `aria-sort`, and keyboard-tested activation. It does not change comparison rules, values, saving, deletion, pagination, endpoints or data.

## Existing independently sortable families

| Family/component | Classification | Current owner | RF-009F decision |
| --- | --- | --- | --- |
| `DataTablePro.tsx` | Read-only/display table with optional client query, sorting and pagination — **Observed** | Local `DataTablePro` state and column `sortValue` functions | **Defer.** It has a different default-sort contract and duplicated controls; changing it together with editable grids would widen regression scope. |
| `DouanoProductMappingCard.tsx` | Operational mapping tables — **Observed** | Client state inside the integration component | **Defer.** Preserve integration filtering, mapping and pagination behavior; server-query ownership must be documented separately. |
| `producten-verpakking/YearPricesTab.tsx` | Editable price-year table — **Observed** | Client state inside the tab | **Defer.** Financial values and year ordering require dedicated characterization before adopting a shared contract. |
| `VerkoopbareArtikelenWorkspace.tsx` | Selectable/business workflow table — **Observed** | Client state inside the workspace | **Defer.** Product selection and status meaning are outside this slice. |
| `OmzetgegevensWorkspace.tsx` | Read-only analytics table — **Observed** | Client state inside the workspace | **Defer.** It has many financial columns and filter interactions; RF-009F does not alter financial presentation. |
| `kostprijsbeheer/ActiveKostprijzenSection.tsx` | Read-only expandable financial table — **Observed** | Client state inside the section | **Defer.** Expansion, grouping and active-cost meaning must remain bound together. |

These components may reuse `TableControls.SortButton`, but reuse of a visual control does not make their ordering contract identical. RF-009F therefore keeps backward-compatible defaults and opts in only the adopted family.

## Non-sortable and unadopted families

| Family | Representative sources | Ordering classification | RF-009F decision |
| --- | --- | --- | --- |
| Plain read-only display | `DataTable.tsx`, `CompanyDistanceOverview.tsx`, data-quality tables, `SetupWorkspace.tsx`, `UserManagementTable.tsx` | Supplied order — **Observed**; whether users need an alternative order is generally **Unknown** | Keep unchanged. A later screen-specific slice may add sorting after product confirmation. |
| Editable settings/collections | `NestedCollectionEditor.tsx`, `CostPoolsClient.tsx`, `IncidenteleKostenClient.tsx`, `VasteKostenClient.tsx` | Supplied or grouped order — **Observed**; stable business meaning varies | Keep unchanged. Do not infer that editable automatically means sortable. |
| Cost-price and activation | `KostprijsActivatieClient.tsx`, `ExistingBerekeningenSection.tsx`, `CostpriceModelWorkspace.tsx`, `LotKostenWorkspace.tsx`, `ArticleKostprijsWizardSteps.tsx` | Financial/grouped/version order — **Inferred** from grouping and workflow usage | Explicitly excluded. Requires financial characterization before any order change. |
| Wizards and summaries | `BerekeningenWizard.tsx`, `berekeningen/steps/*`, `nieuw-jaar/steps/*`, `JaarAfsluitenWizard.tsx`, `jaarsetsPanel.tsx` | Step, review or calculation order — **Observed/Inferred** | Explicitly excluded. Sorting could separate related inputs from summary or approval order. |
| BOM and SKU composition | `features/sku-composition/steps/*`, `AfvuleenhedenTable.tsx`, composition tables in `ProductenVerpakkingWorkspace.tsx` | Parent/child, component or manually meaningful order — **Inferred** | Explicitly excluded. No sorting until hierarchy and manual order are characterized. |
| Quotations/CPQ | `offerte-samenstellen/forms/StaffelForm.tsx`, `offerte-samenstellen/steps/BuilderStep.tsx` and quote-related tables | Offer-line, option or tier order — **Observed/Inferred** | Explicitly excluded. Dense CPQ remains a distinct visual/workflow family. |
| Purchase invoices and synchronization | `InkoopFactuurEditor.tsx`, `InkoopFacturenManager.tsx`, `InkoopFacturenWorkspace.tsx`, `DouanoSyncPanel.tsx`, `DouanoUnmappedRulesCard.tsx` | Source-document or integration order — **Inferred/Unknown** | Keep unchanged. Client-versus-server ownership and document-line ordering need separate proof. |
| Analytics/scenarios | `ErpDashboard.tsx`, `ScenarioAnalyseApp.tsx`, `OmzetEnMargeKlantDetail.tsx`, `BreakEvenNextMockup.tsx` | Presentation, time-series or scenario order — **Inferred** | Keep unchanged in RF-009F; RF-012 remains the screen-level adoption path. |

## Contract for future table adoption

A later table family may adopt the shared semantics only after all of the following are explicit:

1. Whether sorting is client-side or server-side.
2. Which columns are sortable and which are not.
3. The unchanged initial order and its business meaning.
4. Null, numeric, date, localized text and tie-breaking behavior.
5. Interaction with filters, expansion, selection, pagination and edits.
6. Whether saving persists the displayed order or the underlying source order.
7. Desktop and mobile behavior, including horizontal scrolling.
8. Keyboard activation and `aria-sort` state.
9. Regression coverage for any financial, workflow, hierarchy or external-integration meaning.

Until those points are proven, the safe classification is **unadopted**, not “missing sorting.”
