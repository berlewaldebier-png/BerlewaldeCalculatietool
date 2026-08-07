# RF-012D2 — Actief kostprijsoverzicht op de commerciële jaarset

## Uitkomst

`Kostprijs beheren` gebruikt voor het blok **Actieve kostprijzen** niet langer de losse legacy-activaties, kostprijsversies en UI-afleidingen. De leidende bron is nu uitsluitend de ene actieve, gereed gemarkeerde commerciële generatie met haar exacte reconciliatierun en hashes.

De bestaande kostprijswizards en de lijst met concept-/definitieve berekeningen zijn niet herschreven. RF-012D2 vervangt alleen het actuele overzicht. Varianten, facturen, brouwmomenten en LOT-historie volgen afzonderlijk in RF-012D3.

## SSOT- en presentatiegrens

De backend retourneert één regel per stabiele `sku_id`. Een duplicaat in de actieve generatie wordt niet samengevoegd op naam, maar laat de projectie gesloten falen. De primaire groepering gebruikt de canonieke Beer-ID:

- rechtstreeks en expliciet aan een Beer gekoppelde bier-, bundel- of andere SKU's staan eenmaal onder die Beer;
- onafhankelijke diensten, artikelen en samengestelde producten staan in eigen groepen;
- een gedeelde BOM- of oude presentatiereferentie maakt geen extra financiële SKU-regel;
- labels bepalen nooit financiële identiteit of eigendom.

Binnen iedere groep staat `Doos 24 × 33cl` eerst, daarna een bestaand fust en vervolgens de overige concrete SKU's. Ontbreekt een fust werkelijk, dan wordt geen verzonnen fustregel gemaakt. De contractstatussen blijven wel afzonderlijk beschikbaar:

- geldige actieve kostprijs: bedrag uit de actieve generatie;
- `Kostprijs ontbreekt`: kostprijs is vereist maar ongeldig, niet gereed of niet positief;
- `Niet geactiveerd`: concrete SKU bestaat in een expliciete catalogusprojectie maar behoort niet tot de actieve generatie;
- `n.v.t.`: voor de SKU is volgens de vastgelegde policy geen kostprijs vereist.

## Methode en herkomst

Kostmethode en versieherkomst worden niet langer in één label samengevoegd. De kostmethode komt van de expliciet gekoppelde bron-kostprijsversie, bijvoorbeeld `Inkoop` of `Eigen productie`. De herkomst komt uit de generatie-lineage, bijvoorbeeld `Overgenomen en herberekend uit 2025` of `Hersteld uit exact vastgelegd doeljaaranker`.

Daardoor blijft bijvoorbeeld Weizen herkenbaar als een inkoopproduct, terwijl tegelijk zichtbaar is dat de actieve 2026-planningskostprijs uit 2025 is overgenomen en herberekend. Dat betekent niet dat in 2026 al een nieuwe factuur is geregistreerd.

## Read-only en autorisatie

De nieuwe route is:

`GET /api/meta/commercial-yearsets/active/cost-overview`

De route vereist `costs:view`, zodat iedere rol die volgens de goedgekeurde rolmatrix kostprijzen mag zien dezelfde projectie krijgt. Zowel de actieve-dossierreader als de aanvullende legacy-schaduwcontrole starten met `SET TRANSACTION READ ONLY`. Geen read-pad initialiseert schema's.

Het overzicht heeft geen POST-, PUT-, PATCH- of DELETE-aanroep. Openen, zoeken, sorteren of uitklappen kan daarom geen kostprijs activeren, rebaselinen of wijzigen.

## Shadow parity

De oude activatielijst is niet langer leidend, maar wordt tijdens de overgang alleen op unieke SKU-scope vergeleken. De response rapporteert uitsluitend aantallen voor:

- actieve generatie;
- legacy-activaties;
- overlap;
- alleen in de generatie;
- alleen in legacy.

Een verschil wordt zichtbaar gemeld, zonder identifiers of bedragen te loggen en zonder een fallback naar de oude bron. Dit voorkomt dat een bekende afwijking ongemerkt opnieuw financiële autoriteit krijgt.

## Controle op ontwikkeldata

De read-only controle van de actieve 2026-context gaf:

| Controle | Resultaat |
|---|---:|
| Unieke generatie-SKU's | 79 |
| Geldige vereiste kostprijzen | 77 |
| Kostprijs ontbreekt | 0 |
| Kostprijs niet van toepassing | 2 |
| Legacy actieve SKU's | 77 |
| Alleen in generatie | 2 |
| Alleen in legacy | 0 |
| Zichtbare groepen | 16 |

De 16 groepen bestaan uit 13 canonieke biergroepen en drie onafhankelijke groepen: Diensten, Overige artikelen en Samengestelde producten. Blond bevat zeven SKU's in één groep; `Doos 24 × 33cl` en `Fust 20L` staan vooraan. De samengestelde Blond-producten behouden hun type **Samengesteld product**. Juweel gebruikt de expliciete herstelde doeljaarlineage. Weizen behoudt kostmethode **Inkoop** en toont daarnaast **Overgenomen en herberekend uit 2025**.

## Beschermende tests

De tests bewaken:

- één zichtbare regel per fysieke SKU;
- canonieke Beer-groepering en onafhankelijke niet-biergroepen;
- vaste presentatievolgorde van doos 24 × 33cl, fust en overige SKU's;
- afzonderlijke states voor geldig, ontbrekend, niet geactiveerd en `n.v.t.`;
- Weizen-methode en herberekeningsherkomst;
- fail-closed gedrag bij dubbele SKU-ID's of een niet-actieve generatie;
- exacte generatie/run/hash-binding;
- read-only SQL zonder schema-initialisatie;
- `costs:view`-autorisatie;
- frontendgebruik van uitsluitend de nieuwe GET-route;
- toegankelijke groepknoppen en afwezigheid van frontendmutaties.

De volledige baseline telde 290 Python-tests; alle slaagden, 40 waren volgens bestaande voorwaarden overgeslagen. Frontend typecheck, lint, build, pricing-, workflow- en contracttests slaagden. De build behield de reeds bekende lint- en `typedRoutes`-waarschuwingen.

## Handmatige acceptatie

1. Open **Kostprijs beheren** en controleer de badge **Actieve jaarset 2026** en **79 SKU's**.
2. Open **Berlewalde Blond** en controleer dat er zeven unieke regels zijn.
3. Controleer dat `Doos 24 × 33cl` eerst staat en `Fust 20L` daarna.
4. Controleer dat `Doos 12 × 33cl` en de geschenkdoos als **Samengesteld product** staan.
5. Controleer dat kostmethode **Inkoop** apart staat van **Overgenomen en herberekend uit 2025**.
6. Open **Berlewalde het Juweel** en controleer drie unieke SKU's met geldige bedragen.
7. Open **Berlewalde Weizen** en controleer het gescheiden methode-/herkomstlabel.
8. Zoek op een bier- of SKU-naam en test de drie sorteertoetsen.
9. Controleer op mobiel dat de groepen bedienbaar blijven en de brede tabel binnen haar eigen kader horizontaal scrolt.
10. Klik **Jaarset bekijken** en controleer dat `/beheer/jaarsets/2026` opent.
11. Controleer dat alleen bekijken, zoeken, sorteren en uitklappen geen opslag- of activatieactie toont.

## Data- en rollbackimpact

RF-012D2 bevat geen schemawijziging, migratie, backfill, dataherstel, herberekening, activatie of wijziging van een opgeslagen kostprijs. Rollback is uitsluitend het terugdraaien van deze applicatie-commit; er is geen database-rollback nodig.

## Volgende slice

RF-012D3 voegt read-only varianten- en kostprijshistorie toe: het vaste planningsanker plus latere factuur-, brouwmoment- en LOT-kostprijzen. RF-012D3 mag bekijken niet gebruiken om impliciet te rebaselinen of te activeren.
