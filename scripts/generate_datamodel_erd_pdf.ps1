$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$docsDir = Join-Path $root "frontend\public\docs"
New-Item -ItemType Directory -Force -Path $docsDir | Out-Null

$lines = @(
  "Berlewalde CalculatieTool - Compleet Datamodel (ERD)",
  "",
  "Legenda: PK = primary key, FK = foreign key, * = meerdere records",
  "",
  "STAMDATA",
  "+----------------------+        +-------------------------------+",
  "| BIEREN               |        | CHANNELS                      |",
  "| PK id                |        | PK id / code                  |",
  "| biernaam             |        | naam, actief, volgorde        |",
  "| stijl                |        | default_marge_pct             |",
  "| alcoholpercentage    |        | default_factor                |",
  "| belastingsoort       |        +-------------------------------+",
  "| tarief_accijns       |",
  "| btw_tarief           |",
  "+----------------------+",
  "",
  "+------------------------------+    1 --- *   +-------------------------------+",
  "| PACKAGING_COMPONENTS         |--------------| PACKAGING_COMPONENT_PRICES     |",
  "| PK id                        |              | PK id                          |",
  "| omschrijving                 |              | FK verpakkingsonderdeel_id     |",
  "| beschikbaar_voor_samengesteld|              | jaar, prijs_per_stuk           |",
  "+------------------------------+              +-------------------------------+",
  "",
  "+------------------------------+              +------------------------------+",
  "| BASE_PRODUCT_MASTERS         |              | COMPOSITE_PRODUCT_MASTERS    |",
  "| PK id                        |              | PK id                        |",
  "| omschrijving                 |              | omschrijving                 |",
  "| inhoud_per_eenheid_liter     |              | totale_inhoud_liter          |",
  "| basisproducten[]             |              | basisproducten[]             |",
  "+------------------------------+              +------------------------------+",
  "",
  "Relaties stamdata",
  "- PACKAGING_COMPONENTS -> BASE_PRODUCT_MASTERS via gekoppelde onderdelen",
  "- BASE_PRODUCT_MASTERS -> COMPOSITE_PRODUCT_MASTERS via basisproducten[]",
  "- PACKAGING_COMPONENTS kunnen ook direct in COMPOSITE_PRODUCT_MASTERS voorkomen",
  "",
  "KOSTPRIJSVERSIES",
  "+----------------------------------------------+",
  "| KOSTPRIJSVERSIES                             |",
  "| PK id                                        |",
  "| FK bier_id -> BIEREN.id                      |",
  "| jaar                                         |",
  "| versie_nummer                                |",
  "| type (inkoop | productie)                    |",
  "| kostprijs                                    |",
  "| brontype (stam | factuur | hercalculatie)    |",
  "| bron_id                                      |",
  "| effectief_vanaf                              |",
  "| is_actief                                    |",
  "| status (concept | definitief)                |",
  "| bier_snapshot, invoer, resultaat_snapshot    |",
  "| aangemaakt_op, aangepast_op                  |",
  "+----------------------------------------------+",
  "",
  "Regels kostprijsversies",
  "- Een bier kan meerdere kostprijsversies per jaar hebben",
  "- Per bier + jaar is exact 1 definitieve versie actief",
  "- Nieuwe offertes gebruiken altijd de actieve versie",
  "",
  "VERKOOPSTRATEGIE",
  "+-------------------------------+      +------------------------------------+",
  "| SALES_STRATEGY_YEARS          |      | SALES_STRATEGY_PRODUCTS           |",
  "| PK id                         |      | PK id                            |",
  "| year                          |      | FK product_id -> PRODUCTS.id      |",
  "| kanaalmarges                  |      | year, record_type                |",
  "+-------------------------------+      | kanaalmarges / sell_in_margins    |",
  "                                         | sell_in_prices                   |",
  "                                         | sell_out_advice_prices           |",
  "                                         | sell_out_factors                |",
  "                                         +------------------------------------+",
  "",
  "KANAALDEFAULTS komen uit CHANNELS; product- en bieroverrides leven in verkoopprijzen-records.",
  "",
  "MODEL A / CANONIEKE PRODUCTPROJECTIE",
  "+--------------------+      +----------------------+      +---------------------------+",
  "| PRODUCTS           |1---* | PRODUCT_YEARS        |1---* | PRODUCT_YEAR_COMPONENTS   |",
  "| PK id              |      | PK id                |      | PK id                     |",
  "| legacy refs / naam |      | FK product_id        |      | FK product_year_id        |",
  "+--------------------+      | year                 |      | FK component product_id   |",
  "                            +----------------------+      +---------------------------+",
  "",
  "+---------------------------+",
  "| PRODUCT_COMPONENTS        |",
  "| PK id                     |",
  "| FK composite product_id   |",
  "| FK child product_id       |",
  "+---------------------------+",
  "",
  "KOSTPRIJSPROJECTIE",
  "+---------------------------+     1---1  +--------------------------+",
  "| COST_CALCS                |------------| COST_CALC_INPUTS         |",
  "| PK id                     |            | FK cost_calc_id          |",
  "| FK beer_id                |            | payload                  |",
  "| year, version_number      |            +--------------------------+",
  "| calc_type, source_type    |",
  "| source_id, unit_cost      |     1---1  +--------------------------+",
  "| status, is_active         |------------| COST_CALC_RESULTS        |",
  "| effective_from            |            | FK cost_calc_id          |",
  "+---------------------------+            | integral_cost_per_liter  |",
  "                                         | variable_cost_per_liter  |",
  "                                         | direct_fixed_cost_per_l. |",
  "                                         +--------------------------+",
  "",
  "+---------------------------+",
  "| COST_CALC_LINES           |",
  "| PK id                     |",
  "| FK cost_calc_id           |",
  "| FK product_id             |",
  "| source_kind, packaging    |",
  "| unit_cost, liter_cost     |",
  "+---------------------------+",
  "",
  "OFFERTE / PRICING",
  "+---------------------------+        1 --- *    +-----------------------------+",
  "| QUOTES                    |-------------------| QUOTE_LINES                 |",
  "| PK id                     |                   | PK id                       |",
  "| FK beer_id                |                   | FK quote_id                 |",
  "| year, status              |                   | line_type (product/liter)   |",
  "| quote_type                |                   | FK product_id               |",
  "| channel / pricing_channel |                   | FK cost_version_id          |",
  "| reference_channels[]      |                   | quantity / liters           |",
  "| pricing_method            |                   | discount_pct                |",
  "| offer_level               |                   | cost_at_quote               |",
  "| cost_version_ids[]        |                   | sales_price_at_quote        |",
  "+---------------------------+                   | sell_out_price_at_quote     |",
  "                                                | margin_at_quote             |",
  "                                                | channel_at_quote            |",
  "                                                +-----------------------------+",
  "",
  "+---------------------------+",
  "| QUOTE_STAFFELS            |",
  "| PK id                     |",
  "| FK quote_id               |",
  "| FK product_id             |",
  "| liters, discount_pct      |",
  "+---------------------------+",
  "",
  "Belangrijkste relaties",
  "- BIEREN 1 --- * KOSTPRIJSVERSIES",
  "- BIEREN 1 --- * COST_CALCS (canonieke projectie van kostprijsversies)",
  "- PRODUCTS 1 --- * SALES_STRATEGY_PRODUCTS",
  "- QUOTES 1 --- * QUOTE_LINES",
  "- KOSTPRIJSVERSIES 1 --- * QUOTE_LINES via kostprijsversie_id",
  "",
  "Gedrag in de app",
  "- Kostprijs beheren schrijft kostprijsversies",
  "- Prijsvoorstel leest actieve kostprijsversies",
  "- Offertelines bevriezen prijzen en bewaren de gebruikte kostprijsversie",
  "- Verkoopstrategie leest actieve kostprijsversies voor bier/product overrides"
)

function Escape-PdfText([string]$text) {
  return $text.Replace("\", "\\").Replace("(", "\(").Replace(")", "\)")
}

$linesPerPage = 44
$pages = @()
for ($i = 0; $i -lt $lines.Count; $i += $linesPerPage) {
  $end = [Math]::Min($i + $linesPerPage - 1, $lines.Count - 1)
  $pages += ,($lines[$i..$end])
}

$objects = New-Object System.Collections.Generic.List[string]
$objects.Add("1 0 obj`n<< /Type /Catalog /Pages 2 0 R >>`nendobj`n")

$pageObjectNumbers = @()
$contentObjectNumbers = @()
$nextObject = 3
foreach ($page in $pages) {
  $pageObjectNumbers += $nextObject
  $nextObject += 1
  $contentObjectNumbers += $nextObject
  $nextObject += 1
}

$kids = ($pageObjectNumbers | ForEach-Object { "$_ 0 R" }) -join " "
$objects.Add("2 0 obj`n<< /Type /Pages /Count $($pages.Count) /Kids [$kids] >>`nendobj`n")

for ($index = 0; $index -lt $pages.Count; $index += 1) {
  $pageObj = $pageObjectNumbers[$index]
  $contentObj = $contentObjectNumbers[$index]

  $streamLines = @("BT", "/F1 9 Tf", "30 560 Td", "11 TL")
  $first = $true
  foreach ($line in $pages[$index]) {
    $escaped = Escape-PdfText $line
    if ($first) {
      $streamLines += "($escaped) Tj"
      $first = $false
    } else {
      $streamLines += "T*"
      $streamLines += "($escaped) Tj"
    }
  }
  $streamLines += "ET"
  $stream = ($streamLines -join "`n") + "`n"

  $objects.Add("$pageObj 0 obj`n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 999 0 R >> >> /Contents $contentObj 0 R >>`nendobj`n")
  $objects.Add("$contentObj 0 obj`n<< /Length $($stream.Length) >>`nstream`n$stream" + "endstream`nendobj`n")
}

$objects.Add("999 0 obj`n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`nendobj`n")

$pdf = "%PDF-1.4`n"
$offsets = @()
foreach ($obj in $objects) {
  $offsets += $pdf.Length
  $pdf += $obj
}

$xrefOffset = $pdf.Length
$pdf += "xref`n0 $($objects.Count + 1)`n"
$pdf += "0000000000 65535 f `n"
foreach ($offset in $offsets) {
  $pdf += ('{0:0000000000} 00000 n ' -f $offset) + "`n"
}
$pdf += "trailer`n<< /Size $($objects.Count + 1) /Root 1 0 R >>`nstartxref`n$xrefOffset`n%%EOF`n"

Set-Content -Path (Join-Path $docsDir "datamodel-compleet-erd.pdf") -Value $pdf -Encoding ascii
Set-Content -Path (Join-Path $docsDir "datamodel-compleet-erd.txt") -Value ($lines -join "`r`n") -Encoding utf8
