# RF-010A — Active commercial context golden snapshot

Status: implemented as regression protection; finance/product approval remains pending.

RF-010A changes no calculation, source-selection rule, route, user interface, database schema or persisted record. It adds a reproducible synthetic golden fixture plus a read-only fingerprint baseline for the current development data. RF-010B and later SSOT work must treat this baseline as a gate, not as permission to correct differences.

## Outcome

- **Observed:** the executable synthetic fixture calls the existing `buildCentralSkuIndex`, quote-option, advice-price and break-even derivations. It covers a 2025-to-2026 cost change, an explicit channel price, channel margin, `list` fallback, advice markup/rounding, a manual-rate service, a saved 2025 quote and frozen 2025/2026 break-even plans.
- **Observed:** the private development audit reads PostgreSQL inside `SET TRANSACTION READ ONLY` and verifies `transaction_read_only=on` before selecting data.
- **Observed:** committed private-data protection stores only counts, pseudonymous context keys and SHA-256 fingerprints. Raw IDs, names, customer details and numeric commercial values are not committed.
- **Observed:** the baseline is tied to commit `e055fd2e5b544616ce790e3ea1e999706e2b47f0` and the development capture of 2026-07-20.
- **Inferred:** per-context fingerprints are sufficient to prove exact parity and identify the affected SKU/workflow after a refactor, while a controlled local diagnostic is still required to explain a mismatch.
- **Unknown:** whether every current missing/unready SKU is intentional. Those cases require finance/product investigation and must not be silently normalized in RF-011A or RF-013A.

## Protected contexts

The synthetic CI fixture freezes these current behaviors:

1. Active cost/version/component selection for an explicit year.
2. Channel sell-in resolution, including explicit price, margin and `list` fallback precedence.
3. New Horeca and Retail quote options.
4. Advice-price calculation from sell-in, advice markup, VAT and five-cent rounding.
5. Break-even planning inputs: cost, fixed/variable allocation, sell-in and per-liter contribution.
6. Historical quote year and stored financial nodes without repricing.
7. Frozen active break-even plan rows for both years.
8. Missing/zero values and workflow-to-central-context discrepancy reporting.

The private fingerprint manifest protects every captured context without exposing its financial values:

- central active SKU context per year and SKU;
- new quote output per year, channel and option;
- advice output per year, channel and SKU;
- break-even output per year and SKU;
- saved quote and active plan snapshots;
- discrepancy counts and complete year/context fingerprints.

## Development baseline evidence

All statements below are **Observed** in the read-only 2026-07-20 capture:

| Evidence | 2025 | 2026 |
|---|---:|---:|
| Open SKU activations | 66 | 77 |
| Selling-price records | 55 | 57 |
| Advice-price records | 0 | 4 |
| Central SKU context rows | 72 | 77 |
| New quote options per tested channel | 66 | 54 |
| Break-even planning rows derived by the current path | 66 | 54 |
| Advice output rows | 0 | 220 |
| Persisted order/invoice actual-cost snapshots | 4,350 | 1,782 |
| Actual-cost snapshots marked `missing_cost` | 0 | 940 |

Additional observed totals are 83 SKUs, 61 articles, 16 beers, 57 cost versions, 170 normalized cost rows, one saved historical quote and two active break-even plan snapshots.

No duplicate activation key, unknown activation SKU or unknown activation version was found. However, 35 captured activation/version/SKU combinations have neither a normalized cost row nor a matching stored result-snapshot row. This does not prove that all 35 have no usable final value because current readers have additional version/article fallbacks. It does prove that the supposedly canonical per-SKU cost representation is incomplete for those combinations.

For SKUs present in both paths, the captured central, quote and break-even cost/sell-in outputs produced zero cross-path numeric discrepancies. The lower 2026 quote and break-even count is therefore a readiness/eligibility gap, not a changed numeric value among the shared rows. Its intendedness is **Unknown** and blocks an automatic source switch.

The 940 persisted 2026 order/invoice lines marked `missing_cost` are **Observed** and align with the previously reported “LOT niet gekoppeld” / missing-cost behavior in Omzet & Marge. Whether every individual line should have been costed is **Unknown**, but the aggregate is a current-defect candidate with direct margin-reporting impact. RF-010A freezes it; RF-010B must classify exact/unknown/ambiguous LOT cases before RF-011B or any repair slice changes resolution.

## Confidentiality and safety boundary

The raw capture is intentionally not a repository fixture. Pseudonymization alone does not make cost and selling prices non-sensitive.

`scripts/capture_active_commercial_context.py` therefore:

- accepts only `local`, `dev` or `development`;
- accepts loopback by default;
- requires an explicit flag for an IP-literal private development host;
- rejects production-like environments and unverified hostnames;
- requires acknowledgement that its stdout contains commercial values;
- starts and verifies a read-only transaction;
- writes nothing to the database or filesystem.

Its stdout must be piped directly into the local TypeScript fingerprint runner. Never redirect it into a file, attach it to a ticket, paste it into a task, or commit it.

## Commands

The normal CI-safe regression gate is:

```powershell
Set-Location frontend
npm.cmd run test:pricing
```

After that compilation has succeeded, the private parity audit is run locally from `frontend`:

```powershell
$env:RF010A_PRIVATE_CAPTURE_STDIN = "1"
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. ..\backend\.env.local.ps1
..\.venv\Scripts\python.exe ..\scripts\capture_active_commercial_context.py `
  --baseline-commit e055fd2e5b544616ce790e3ea1e999706e2b47f0 `
  --captured-at 2026-07-20 `
  --allow-private-development-host `
  --acknowledge-commercial-values |
  node .\.tmp\pricing-tests\scripts\activeCommercialContextGolden.contracttest.js
```

Expected output contains only `private active commercial context audit OK ...`; a mismatch fails without printing financial values.

## Approval checklist

Finance/product should not approve individual secret prices in GitHub. Approval means confirming the meaning and coverage of the contexts and reviewing any mismatch locally with an authorized person.

- [ ] The saved 2025 quote must retain its stored year and financial snapshot when reopened.
- [ ] Brand-new quotes use the selected operational year and existing channel-price precedence.
- [ ] Advice price remains derived from sell-in plus channel advice markup, VAT and current rounding.
- [ ] Break-even uses the same shared-SKU cost and Horeca sell-in values captured here.
- [ ] The absence of 2025 advice rows is understood and either accepted as historical state or separately investigated.
- [ ] The 35 non-canonical activation/cost relationships are investigated before choosing the RF-011A source.
- [ ] The 2026 difference between 77 central rows and 54 quote/break-even rows is classified as intentional or a current defect.
- [ ] The 940 persisted 2026 actual lines marked `missing_cost` are classified through RF-010B; they are not accepted as correct merely because their hashes are reproducible.
- [ ] No historical quote, plan, cost version, activation or actual sales snapshot may be rewritten to make parity pass.

## Rollback and next dependency

Rollback removes only the new test, fixtures, capture utility and documentation. There is no data rollback or migration.

RF-010A is technically reproducible but remains `pending-human-approval`. RF-010B may add the planning-anchor versus actual-LOT snapshot next, but RF-011A must not select a central source until RF-010A and RF-010B findings are approved or explicitly classified.
