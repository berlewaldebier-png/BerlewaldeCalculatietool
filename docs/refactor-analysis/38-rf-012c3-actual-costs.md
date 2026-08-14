# RF-012C3 — Exacte Actual-kosten voor Omzet en Marge

Datum: 2026-08-12

Classificatie: gedragsrefactor van kostprijsselectie met bescherming van bestaande snapshots; geen schema- of datamigratie

Afhankelijkheden: RF-010B, RF-011B, RF-013A, RF-013B, RF-013C en RF-012C2

## Uitkomst

RF-012C3 laat nieuwe of opnieuw te beoordelen Actual-regels in **Omzet en Marge** dezelfde canonieke PostgreSQL-autoriteiten gebruiken als de eerder goedgekeurde planning-/LOT-resolver:

- een LOT-plichtige bier-SKU krijgt alleen een kostprijs via een exacte canonieke SKU/LOT-koppeling;
- de transactiedatum kiest niet tussen meerdere LOT-kostprijzen;
- een alias is alleen geldig wanneer die expliciet en SKU-gebonden naar de canonieke LOT verwijst;
- een non-LOT-product dat wel een kostprijs nodig heeft, gebruikt het vastgelegde planninganker van die SKU en het transactiekalenderjaar;
- `no_cost_required`, `ignored` en een ontbrekende kostprijs zijn verschillende statussen;
- onbekende, ontbrekende, bijna-gelijke of dubbelzinnige LOT's krijgen nooit stilzwijgend de planningkostprijs;
- meerdere LOT's op één transactie/SKU-verkoopregel worden niet gereduceerd tot de grootste of nieuwste LOT. De regel stopt zichtbaar als `multiple_lots_per_sales_line` totdat een expliciete regelverdeling is vastgelegd.

De gekozen canonieke kostprijscomponenten worden in de bestaande snapshot-payload bewaard. Daardoor worden variabele kosten en accijns niet achteraf uit een concurrerende legacy-activatielijst afgeleid.

## Autoriteiten en grenzen

`PostgresCostResolutionSnapshotReader` leest in één expliciet read-only transactie:

- `cost_versions` en `cost_version_sku_rows` voor onveranderlijke financiële regels;
- `planning_cost_anchors` voor non-LOT-planningkosten;
- `canonical_lot_cost_lineage` en de RF-013B ambiguity-manifestregels voor LOT-kosten;
- `lot_alias_mappings` voor expliciete externe/interne LOT-koppelingen;
- `skus` voor SKU-soort, eigenaar en LOT-beleid;
- `lot_cost_records` uitsluitend als zichtbaar ongekoppeld bewijs, nooit als automatische financiële vervanger.

De resolver vereist exact één actieve commerciële jaarset. Geen of meer dan één actieve jaarset stopt de herberekening fail-closed.

## Bestaande snapshots en dataveiligheid

Er is geen tabel, kolom, constraint, index, backfill of migratie toegevoegd. Tijdens implementatie en verificatie is geen verkoop-, LOT-, SKU-, kostprijs- of snapshotregel geschreven.

Het opslagbeleid maakt onderscheid tussen normale synchronisatie en een expliciete gerichte onderhoudsactie:

1. Een normale Douano-synchronisatie beoordeelt alleen voorlopige/onopgeloste snapshots vanaf het actieve commerciële jaar opnieuw.
2. Bestaande opgeloste snapshots worden niet automatisch vervangen.
3. Regels vóór het actieve jaar worden ook niet ingevoegd wanneer hun historische snapshot ontbreekt. Daardoor ontstaat geen stille historische herwaardering door een gewone sync.
4. Een bestaande expliciete onderhoudsactie voor een aangewezen LOT, productmapping of uitzonderingsregel mag de doelregels wel opnieuw vastleggen. Dat is een bewuste correctie, geen achtergrondherwaardering.
5. Paginaweergave leest een aanwezige snapshot letterlijk. Zij berekent bestaande historie niet opnieuw bij openen.

Rollback is daarom een applicatierollback: de branch terugdraaien. Er is geen databaseschema om terug te draaien en geen datacleanup toegestaan.

## Read-only ontwikkelaudit

De privacyveilige audit toont alleen aantallen en geen identifiers of bedragen.

| Controle | Resultaat |
|---|---:|
| Factuursnapshots onderzocht | 3.080 |
| Actief commercieel jaar | 2026 |
| Door normale sync beschermde/finalized snapshots | 2.360 |
| Voor normale sync opnieuw te beoordelen 2026-snapshots | 720 |
| Daarvan exact canoniek oplosbaar op basis van de opgeslagen snapshot-LOT | 495 |
| Dubbelzinnige canonieke LOT-lijn | 100 |
| Onbekende LOT | 75 |
| Ontbrekend non-LOT-planninganker | 33 |
| Ontbrekende SKU | 14 |
| Ontbrekende verplichte LOT | 3 |
| Transactie/SKU-sleutels met meerdere LOT's | 24 |

De 495 is een bovengrens voordat de actuele transactieallocaties worden toegepast: een deel kan onder de 24 multi-LOT-sleutels vallen en stopt dan bewust als onopgelost. De audit schrijft niets en bevat `contains_identifiers_or_amounts: false`.

## Zichtbare statussen en herstelactie

De klantdetailregels tonen groene bevestiging voor een exacte LOT of geldig non-LOT-anker en rode, specifieke herstelstatussen voor onder meer:

- LOT ontbreekt of is onbekend;
- LOT-koppeling of canonieke LOT-kostprijs is dubbelzinnig;
- meerdere LOT's zijn op één verkoopregel aanwezig;
- een losse LOT-bron mist canonieke versie/SKU-lijn;
- planninganker, kostprijsversie of SKU-kostprijsregel ontbreekt;
- de gevonden kostprijs is ongeldig.

De melding benoemt de eerstvolgende actie (LOT koppelen, regel per LOT verdelen, mapping herstellen of planninganker activeren). Er is geen generieke fallback verborgen achter een groen bedrag.

## Testbescherming

De contracttests beschermen:

- planning uitsluitend via het persistente jaar/SKU-anker;
- Actual uitsluitend via persistente exacte LOT-lijn;
- onbekende en dubbelzinnige LOT zonder planningfallback;
- non-LOT-kosten via het juiste jaaranker;
- canonieke componenten in de snapshots;
- meerdere LOT's op één verkoopregel als fail-closed status;
- bescherming van finalized snapshots;
- geen nieuwe historische snapshot door normale sync;
- het verschil tussen normale sync en expliciete gerichte correctie;
- unittest-discovery, volledige Python-suite, frontend typecheck/lint/build en bestaande pricing-, workflow- en contracttests.

## Handmatige acceptatie na merge

1. Open **Omzet en Marge** zonder synchronisatie en controleer dat bestaande historische bedragen gelijk blijven.
2. Open een klant en vervolgens een factuur/order. Controleer dat bestaande snapshotregels en hun LOT-status normaal laden.
3. Start daarna één normale Douano-synchronisatie voor 2026. Gebruik geen brede expliciete correctieactie als acceptatietest.
4. Controleer een bekende exact gekoppelde 2026 LOT: deze moet een groene exacte-LOT-status en dezelfde canonieke kostprijsversie als het kostprijshistoriedossier tonen.
5. Controleer een non-LOT-product met kostprijs: dit moet het 2026 planninganker tonen. `no_cost_required` moet apart zichtbaar blijven.
6. Controleer een onbekende/dubbelzinnige/multi-LOT-regel: er mag geen kostprijsbedrag uit het planninganker verschijnen; de rode melding moet een herstelactie geven.
7. Controleer dat 2025-totalen en eerder opgeloste 2026-snapshots niet door de normale sync veranderen.

## Resterend werk

- Het verdelen en gewogen waarderen van één verkoopregel over meerdere exacte LOT's vereist een afzonderlijk goedgekeurd datacontract. RF-012C3 kiest tot die tijd veilig voor zichtbaar onopgelost.
- De aangetroffen ambiguïteiten, ontbrekende ankers en ongekoppelde LOT-bewijzen zijn datakwaliteitswerk; deze slice repareert of verwijdert die gegevens niet automatisch.
- Verkoopstrategie en Adviesprijzen schakelen in RF-012C4 afzonderlijk over op de actieve generatie en dezelfde SKU-prijsautoriteit.
