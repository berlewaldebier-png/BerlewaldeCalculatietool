from __future__ import annotations

from copy import deepcopy
from typing import Any
from uuid import uuid4

import streamlit as st

from components.table_ui import format_currency_cell_value
from utils.storage import (
    add_bier,
    create_recalculatie_from_berekening,
    bereken_basisproduct_kostprijs,
    bereken_directe_vaste_kosten_per_liter,
    bereken_samengesteld_product_kostprijs,
    calculate_total_vaste_kosten,
    create_empty_berekening,
    finalize_berekening,
    get_batchgrootte_eigen_productie_l,
    get_berekening_by_id,
    get_productiegegevens_for_year,
    get_tarieven_heffingen_for_year,
    get_vaste_kosten_for_year,
    load_basisproducten_for_year,
    load_samengestelde_producten,
    load_samengestelde_producten_for_year,
    save_berekening_as_concept,
    update_bier,
)


TOTAL_STEPS = 4
CALCULATION_OPTIONS = ["Eigen productie", "Inkoop"]
BELASTINGSOORT_OPTIONS = ["Accijns", "Verbruiksbelasting", "Geen"]
TARIEF_ACCIJNS_OPTIONS = ["Hoog", "Laag"]
BTW_TARIEF_OPTIONS = ["9%", "21%"]
INGREDIENT_OPTIONS = ["Mout", "Gist", "Hop", "Kruiden", "Overig"]
EENHEID_OPTIONS = ["KG", "L", "CL", "MM", "GR", "ST"]
HERCALCULATIE_REDENEN = [
    "Prijswijziging",
    "Receptafwijking",
    "Prijs en receptafwijking",
]


def format_euro_per_liter(value: float | int | None) -> str:
    """Formatteert een eurobedrag per liter voor de UI."""
    if value is None:
        return "Nog niet berekend"
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return "Nog niet berekend"
    return f"{format_currency_cell_value(amount)} per L"


def format_number(value: float | int | None, decimals: int = 2) -> str:
    """Formatteert een getal veilig voor read-only weergave."""
    try:
        amount = float(value or 0.0)
    except (TypeError, ValueError):
        amount = 0.0
    return f"{amount:.{decimals}f}".replace(".", ",")


def calculate_variabele_kosten_per_liter_from_record(record: dict[str, Any]) -> float | None:
    """Berekent variabele kosten per liter vanuit de huidige berekening."""
    calculation_type = str(
        record.get("soort_berekening", {}).get("type", "Eigen productie")
        or "Eigen productie"
    )
    if calculation_type == "Inkoop":
        totals = get_inkoop_record_totals(record)
        totaal_liters = float(totals.get("totaal_liters", 0.0) or 0.0)
        if totaal_liters <= 0:
            return None
        totaal_subfactuurbedrag = float(
            totals.get("totaal_subfactuurbedrag", 0.0) or 0.0
        )
        totale_extra_kosten = float(totals.get("totale_extra_kosten", 0.0) or 0.0)
        return (totaal_subfactuurbedrag + totale_extra_kosten) / totaal_liters

    if calculation_type != "Eigen productie":
        return None

    jaar = int(record.get("basisgegevens", {}).get("jaar", 0) or 0)
    batchgrootte = get_batchgrootte_eigen_productie_l(jaar)
    if batchgrootte is None or batchgrootte <= 0:
        return None

    rows = get_record_ingredient_rows(record)
    totale_kosten_recept = sum(calculate_kosten_recept(row) for row in rows)
    return totale_kosten_recept / batchgrootte


def calculate_accijns_for_product(
    *,
    liters_per_product: float | int | None,
    batchgrootte_l: float | int | None,
    tarief_per_hl: float | int | None,
    alcoholpercentage: float | int | None,
    belastingsoort: str,
) -> float:
    """Berekent accijns voor Ã©Ã©n product via de vereenvoudigde formule."""
    if str(belastingsoort or "").strip().lower() != "accijns":
        return 0.0

    try:
        liters_value = float(liters_per_product or 0.0)
        tarief_value = float(tarief_per_hl or 0.0)
        alcohol_value = float(alcoholpercentage or 0.0)
    except (TypeError, ValueError):
        return 0.0

    if (
        liters_value <= 0
        or tarief_value <= 0
        or alcohol_value <= 0
    ):
        return 0.0

    del batchgrootte_l
    return (tarief_value * alcohol_value / 100.0) * liters_value


def calculate_accijns_for_inkoop_product(
    *,
    verpakkingseenheid_l: float | int | None,
    ingekochte_liters_van_soort: float | int | None,
    tarief_per_hl: float | int | None,
    alcoholpercentage: float | int | None,
    belastingsoort: str,
) -> float:
    """Berekent accijns voor inkoop via de vereenvoudigde formule."""
    if str(belastingsoort or "").strip().lower() != "accijns":
        return 0.0

    try:
        verpakkingseenheid_value = float(verpakkingseenheid_l or 0.0)
        tarief_value = float(tarief_per_hl or 0.0)
        alcohol_value = float(alcoholpercentage or 0.0)
    except (TypeError, ValueError):
        return 0.0

    if (
        verpakkingseenheid_value <= 0
        or tarief_value <= 0
        or alcohol_value <= 0
    ):
        return 0.0

    del ingekochte_liters_van_soort
    return (tarief_value * alcohol_value / 100.0) * verpakkingseenheid_value


def calculate_indirecte_vaste_kosten_per_inkoop_liter(year: int | str) -> float | None:
    """Berekent indirecte vaste kosten per ingekochte liter voor een jaar."""
    productiegegevens = get_productiegegevens_for_year(year)
    inkoop_liters = productiegegevens.get("hoeveelheid_inkoop_l")
    try:
        inkoop_liters_value = float(inkoop_liters or 0.0)
    except (TypeError, ValueError):
        return None

    if inkoop_liters_value <= 0:
        return None

    indirecte_records = []
    for record in get_vaste_kosten_for_year(year):
        kostensoort = str(record.get("kostensoort", "") or "").strip().lower()
        if kostensoort not in {"indirect", "indirecte kosten"}:
            continue
        indirecte_records.append(record)

    totaal_indirect = calculate_total_vaste_kosten(indirecte_records)
    return totaal_indirect / inkoop_liters_value


def _build_product_cost_row(
    *,
    product_name: str,
    liters_per_product: float,
    verpakkingskosten: float,
    biernaam: str,
    soort: str,
    variabele_kosten_per_liter: float | None,
    directe_vaste_kosten_per_liter: float | None,
    accijns: float,
) -> dict[str, Any]:
    """Bouwt Ã©Ã©n read-only productregel voor stap 4."""
    variabele_kosten = max(float(variabele_kosten_per_liter or 0.0), 0.0) * max(
        float(liters_per_product or 0.0),
        0.0,
    )
    vaste_directe_kosten = max(float(directe_vaste_kosten_per_liter or 0.0), 0.0) * max(
        float(liters_per_product or 0.0),
        0.0,
    )

    return {
        "biernaam": biernaam or "-",
        "soort": soort or "-",
        "verpakking": product_name or "-",
        "variabele_kosten": variabele_kosten,
        "verpakkingskosten": max(float(verpakkingskosten or 0.0), 0.0),
        "vaste_directe_kosten": vaste_directe_kosten,
        "accijns": max(float(accijns or 0.0), 0.0),
        "liters_per_product": max(float(liters_per_product or 0.0), 0.0),
    }


def _build_step_4_product_tables_for_inkoop(
    *,
    record: dict[str, Any],
    biernaam: str,
    soort: str,
    jaar: int,
    alcoholpercentage: float,
    belastingsoort: str,
    tarief_accijns: str,
) -> dict[str, Any]:
    """Bouwt stap-4-tabellen op basis van de inkoopregels."""
    variabele_kosten_per_liter = calculate_variabele_kosten_per_liter_from_record(record)
    indirecte_vaste_kosten_per_liter = calculate_indirecte_vaste_kosten_per_inkoop_liter(jaar)
    tarieven_record = get_tarieven_heffingen_for_year(jaar) or {}
    tarief_key = "tarief_hoog" if tarief_accijns == "Hoog" else "tarief_laag"
    tarief_value = tarieven_record.get(tarief_key)

    samengestelde_lookup = {
        str(product.get("id", "") or ""): product
        for product in load_samengestelde_producten_for_year(jaar)
        if str(product.get("id", "") or "")
    }
    basisproduct_lookup = {
        str(product.get("id", "") or ""): product
        for product in load_basisproducten_for_year(jaar)
        if str(product.get("id", "") or "")
    }

    aggregated_products: dict[str, dict[str, Any]] = {}
    product_order: list[str] = []

    for factuur in get_record_inkoop_facturen(record):
        rows = factuur.get("factuurregels", [])
        if not isinstance(rows, list):
            rows = []
        toegerekende_extra_kosten = calculate_toegerekende_extra_kosten_per_row(
            factuur.get("verzendkosten", 0.0),
            factuur.get("overige_kosten", 0.0),
            len(rows),
        )
        for row in rows:
            normalized_row = normalize_inkoop_row(row)
            product_id = str(normalized_row.get("eenheid", "") or "")
            if not product_id:
                continue
            if product_id not in aggregated_products:
                aggregated_products[product_id] = {
                    "aantal": 0.0,
                    "liters": 0.0,
                    "totale_kosten": 0.0,
                }
                product_order.append(product_id)

            row_total = float(normalized_row.get("subfactuurbedrag", 0.0) or 0.0) + float(
                toegerekende_extra_kosten or 0.0
            )
            aggregated_products[product_id]["aantal"] += float(
                normalized_row.get("aantal", 0.0) or 0.0
            )
            aggregated_products[product_id]["liters"] += float(
                normalized_row.get("liters", 0.0) or 0.0
            )
            aggregated_products[product_id]["totale_kosten"] += row_total

    samengestelde_rows: list[dict[str, Any]] = []
    basisproducten_rows: list[dict[str, Any]] = []

    for samengesteld_product_id in product_order:
        aggregated = aggregated_products.get(samengesteld_product_id, {})
        samengesteld_product = samengestelde_lookup.get(samengesteld_product_id)
        if not samengesteld_product:
            continue

        kostprijs = bereken_samengesteld_product_kostprijs(
            samengesteld_product=samengesteld_product,
            variabele_kosten_per_liter=variabele_kosten_per_liter,
            year=jaar,
        )
        totaal_aantal = float(aggregated.get("aantal", 0.0) or 0.0)
        totaal_liters = float(aggregated.get("liters", 0.0) or 0.0)
        totale_kosten = float(aggregated.get("totale_kosten", 0.0) or 0.0)
        prijs_per_eenheid = totale_kosten / totaal_aantal if totaal_aantal > 0 else 0.0
        liters_per_product = float(kostprijs.get("inhoud_liter", 0.0) or 0.0)
        samengestelde_rows.append(
            {
                "biernaam": biernaam or "-",
                "soort": soort or "-",
                "verpakking": str(samengesteld_product.get("omschrijving", "") or "-"),
                "variabele_kosten": prijs_per_eenheid,
                "verpakkingskosten": 0.0,
                "vaste_directe_kosten": max(float(indirecte_vaste_kosten_per_liter or 0.0), 0.0)
                * max(liters_per_product, 0.0),
                "accijns": calculate_accijns_for_inkoop_product(
                    verpakkingseenheid_l=liters_per_product,
                    ingekochte_liters_van_soort=totaal_liters,
                    tarief_per_hl=tarief_value,
                    alcoholpercentage=alcoholpercentage,
                    belastingsoort=belastingsoort,
                ),
                "liters_per_product": max(liters_per_product, 0.0),
            }
        )

        for basisproduct_ref in samengesteld_product.get("basisproducten", []):
            if not isinstance(basisproduct_ref, dict):
                continue
            basisproduct_id = str(basisproduct_ref.get("basisproduct_id", "") or "")
            basisproduct = basisproduct_lookup.get(basisproduct_id)
            if not basisproduct:
                continue

            kostprijs_basis = bereken_basisproduct_kostprijs(
                basisproduct=basisproduct,
                variabele_kosten_per_liter=variabele_kosten_per_liter,
                year=jaar,
            )
            aantal = float(basisproduct_ref.get("aantal", 1.0) or 1.0)
            basisproduct_liters_per_eenheid = float(
                kostprijs_basis.get("inhoud_liter", 0.0) or 0.0
            )
            liters_per_product = basisproduct_liters_per_eenheid
            aandeel_in_samengesteld = (
                (basisproduct_liters_per_eenheid / float(kostprijs.get("inhoud_liter", 0.0) or 0.0))
                if float(kostprijs.get("inhoud_liter", 0.0) or 0.0) > 0
                else 0.0
            )
            if aantal <= 0:
                continue

            basisproducten_rows.append(
                {
                    "biernaam": biernaam or "-",
                    "soort": soort or "-",
                    "verpakking": str(basisproduct.get("omschrijving", "") or "-"),
                    "variabele_kosten": prijs_per_eenheid * aandeel_in_samengesteld,
                    "verpakkingskosten": 0.0,
                    "vaste_directe_kosten": max(float(indirecte_vaste_kosten_per_liter or 0.0), 0.0)
                    * max(liters_per_product, 0.0),
                    "accijns": calculate_accijns_for_inkoop_product(
                        verpakkingseenheid_l=liters_per_product,
                        ingekochte_liters_van_soort=totaal_liters,
                        tarief_per_hl=tarief_value,
                        alcoholpercentage=alcoholpercentage,
                        belastingsoort=belastingsoort,
                    ),
                    "liters_per_product": max(liters_per_product, 0.0),
                }
            )

    return {
        "basisproducten": basisproducten_rows,
        "samengestelde_producten": samengestelde_rows,
        "variabele_kosten_per_liter": variabele_kosten_per_liter,
        "directe_vaste_kosten_per_liter": indirecte_vaste_kosten_per_liter,
        "batchgrootte_l": None,
        "tarieven_record": tarieven_record,
        "tarief_type": tarief_accijns,
    }


def build_step_4_product_tables(record: dict[str, Any]) -> dict[str, Any]:
    """Bouwt alle read-only producttabellen voor stap 4."""
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    soort_berekening = record.get("soort_berekening", {})
    if not isinstance(soort_berekening, dict):
        soort_berekening = {}

    biernaam = str(basisgegevens.get("biernaam", "") or "")
    soort = str(soort_berekening.get("type", "Eigen productie") or "Eigen productie")
    jaar = int(basisgegevens.get("jaar", 0) or 0)
    alcoholpercentage = float(basisgegevens.get("alcoholpercentage", 0.0) or 0.0)
    belastingsoort = str(basisgegevens.get("belastingsoort", "Accijns") or "Accijns")
    tarief_accijns = str(basisgegevens.get("tarief_accijns", "Hoog") or "Hoog")

    if soort == "Inkoop":
        return _build_step_4_product_tables_for_inkoop(
            record=record,
            biernaam=biernaam,
            soort=soort,
            jaar=jaar,
            alcoholpercentage=alcoholpercentage,
            belastingsoort=belastingsoort,
            tarief_accijns=tarief_accijns,
        )

    variabele_kosten_per_liter = calculate_variabele_kosten_per_liter_from_record(record)
    directe_vaste_kosten_per_liter = bereken_directe_vaste_kosten_per_liter(jaar)
    batchgrootte = get_batchgrootte_eigen_productie_l(jaar)
    tarieven_record = get_tarieven_heffingen_for_year(jaar) or {}
    tarief_key = "tarief_hoog" if tarief_accijns == "Hoog" else "tarief_laag"
    tarief_value = tarieven_record.get(tarief_key)

    basisproducten_rows: list[dict[str, Any]] = []
    for basisproduct in load_basisproducten_for_year(jaar):
        kostprijs = bereken_basisproduct_kostprijs(
            basisproduct=basisproduct,
            variabele_kosten_per_liter=variabele_kosten_per_liter,
            year=jaar,
        )
        basisproducten_rows.append(
            _build_product_cost_row(
                product_name=str(basisproduct.get("omschrijving", "") or ""),
                liters_per_product=float(kostprijs.get("inhoud_liter", 0.0) or 0.0),
                verpakkingskosten=float(kostprijs.get("verpakkingskosten", 0.0) or 0.0),
                biernaam=biernaam,
                soort=soort,
                variabele_kosten_per_liter=variabele_kosten_per_liter,
                directe_vaste_kosten_per_liter=directe_vaste_kosten_per_liter,
                accijns=calculate_accijns_for_product(
                    liters_per_product=kostprijs.get("inhoud_liter"),
                    batchgrootte_l=batchgrootte,
                    tarief_per_hl=tarief_value,
                    alcoholpercentage=alcoholpercentage,
                    belastingsoort=belastingsoort,
                ),
            )
        )

    samengestelde_rows: list[dict[str, Any]] = []
    for samengesteld_product in load_samengestelde_producten_for_year(jaar):
        kostprijs = bereken_samengesteld_product_kostprijs(
            samengesteld_product=samengesteld_product,
            variabele_kosten_per_liter=variabele_kosten_per_liter,
            year=jaar,
        )
        samengestelde_rows.append(
            _build_product_cost_row(
                product_name=str(samengesteld_product.get("omschrijving", "") or ""),
                liters_per_product=float(kostprijs.get("inhoud_liter", 0.0) or 0.0),
                verpakkingskosten=float(kostprijs.get("verpakkingskosten", 0.0) or 0.0),
                biernaam=biernaam,
                soort=soort,
                variabele_kosten_per_liter=variabele_kosten_per_liter,
                directe_vaste_kosten_per_liter=directe_vaste_kosten_per_liter,
                accijns=calculate_accijns_for_product(
                    liters_per_product=kostprijs.get("inhoud_liter"),
                    batchgrootte_l=batchgrootte,
                    tarief_per_hl=tarief_value,
                    alcoholpercentage=alcoholpercentage,
                    belastingsoort=belastingsoort,
                ),
            )
        )

    return {
        "basisproducten": basisproducten_rows,
        "samengestelde_producten": samengestelde_rows,
        "variabele_kosten_per_liter": variabele_kosten_per_liter,
        "directe_vaste_kosten_per_liter": directe_vaste_kosten_per_liter,
        "batchgrootte_l": batchgrootte,
        "tarieven_record": tarieven_record,
        "tarief_type": tarief_accijns,
    }


def init_page_state() -> None:
    """Initialiseert de basis-state voor Nieuwe kostprijsberekening."""
    defaults = {
        "nieuwe_berekening_view_mode": "overview",
        "nieuwe_berekening_allow_empty_wizard": False,
        "nieuwe_berekening_step": 1,
        "nieuwe_berekening_overview_year": "Alles",
        "nieuwe_berekening_feedback": None,
        "active_berekening": create_empty_berekening(),
        "nb_ingredient_row_ids": [],
        "nb_ingredient_edit_row_id": None,
        "nb_ingredient_edit_row_id_pending": None,
        "nb_ingredient_delete_confirm_row_id": None,
        "nb_inkoop_row_ids": [],
        "nb_inkoop_edit_row_id": None,
        "nb_inkoop_edit_row_id_pending": None,
        "nb_inkoop_delete_confirm_row_id": None,
        "nb_force_hydrate_inkoop_step_3": False,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def get_active_berekening() -> dict[str, Any]:
    """Geeft de actieve berekening terug."""
    record = st.session_state.get("active_berekening")
    if not isinstance(record, dict):
        record = create_empty_berekening()
        st.session_state["active_berekening"] = record
    return deepcopy(record)


def is_recalculatie_record(record: dict[str, Any] | None = None) -> bool:
    """Geeft terug of de actieve berekening een hercalculatie is."""
    source_record = record if isinstance(record, dict) else get_active_berekening()
    return str(source_record.get("calculation_variant", "origineel") or "origineel") == "hercalculatie"


def get_hercalculatie_basis_rows(record: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Geeft de vastgelegde initiÃ«le ingredientregels van een hercalculatie terug."""
    source_record = record if isinstance(record, dict) else get_active_berekening()
    hercalculatie_basis = source_record.get("hercalculatie_basis", {})
    if not isinstance(hercalculatie_basis, dict):
        return []
    rows = hercalculatie_basis.get("ingredienten_regels", [])
    if not isinstance(rows, list):
        return []
    return [normalize_ingredient_row(row) for row in rows if isinstance(row, dict)]


def has_linked_facturen(record: dict[str, Any] | None = None) -> bool:
    """Geeft terug of een inkoopberekening gekoppelde facturen heeft."""
    source_record = record if isinstance(record, dict) else get_active_berekening()
    calculation_type = str(
        source_record.get("soort_berekening", {}).get("type", "Eigen productie")
        or "Eigen productie"
    )
    if calculation_type != "Inkoop":
        return False

    for factuur in get_record_inkoop_facturen(source_record):
        if not isinstance(factuur, dict):
            continue
        factuurregels = factuur.get("factuurregels", [])
        if not isinstance(factuurregels, list):
            factuurregels = []
        if (
            str(factuur.get("factuurnummer", "") or "").strip()
            or str(factuur.get("factuurdatum", "") or "").strip()
            or float(factuur.get("verzendkosten", 0.0) or 0.0) != 0.0
            or float(factuur.get("overige_kosten", 0.0) or 0.0) != 0.0
            or len(factuurregels) > 0
        ):
            return True
    return False


def get_total_steps_for_record(record: dict[str, Any] | None = None) -> int:
    """Geeft het actuele aantal wizardstappen terug voor een berekening."""
    source_record = record if isinstance(record, dict) else get_active_berekening()
    return 5 if has_linked_facturen(source_record) or is_recalculatie_record(source_record) else TOTAL_STEPS


def set_active_berekening(record: dict[str, Any]) -> None:
    """Zet de actieve berekening terug in session_state."""
    st.session_state["active_berekening"] = deepcopy(record)


def set_feedback(message: str) -> None:
    """Slaat een eenmalige feedbackmelding op."""
    st.session_state["nieuwe_berekening_feedback"] = message


def render_feedback() -> None:
    """Toont een feedbackmelding precies een keer."""
    message = st.session_state.pop("nieuwe_berekening_feedback", None)
    if message:
        st.success(message)


def normalize_ingredient_row(row: dict[str, Any] | None = None) -> dict[str, Any]:
    """Normaliseert Ã©Ã©n ingrediÃ«ntregel voor opslag en rendering."""
    source = row if isinstance(row, dict) else {}

    def _float_value(key: str) -> float:
        try:
            return float(source.get(key, 0.0) or 0.0)
        except (TypeError, ValueError):
            return 0.0

    return {
        "id": str(source.get("id", "") or uuid4()),
        "ingrediÃ«nt": str(
            source.get("ingrediÃ«nt", "")
            or source.get("ingrediënt", "")
            or source.get("ingrediÃƒÂ«nt", "")
            or source.get("ingredient", "")
            or ""
        ),
        "ingrediënt": str(
            source.get("ingrediënt", "")
            or source.get("ingrediÃ«nt", "")
            or source.get("ingrediÃƒÂ«nt", "")
            or source.get("ingredient", "")
            or ""
        ),
        "omschrijving": str(source.get("omschrijving", "") or ""),
        "hoeveelheid": _float_value("hoeveelheid"),
        "eenheid": str(source.get("eenheid", "") or ""),
        "prijs": _float_value("prijs"),
        "benodigd_in_recept": _float_value("benodigd_in_recept"),
    }


def normalize_inkoop_row(row: dict[str, Any] | None = None) -> dict[str, Any]:
    """Normaliseert Ã©Ã©n inkoopregel voor opslag en rendering."""
    source = row if isinstance(row, dict) else {}

    def _float_value(key: str) -> float:
        try:
            return float(source.get(key, 0.0) or 0.0)
        except (TypeError, ValueError):
            return 0.0

    normalized = {
        "id": str(source.get("id", "") or uuid4()),
        "aantal": _float_value("aantal"),
        "eenheid": str(source.get("eenheid", "") or ""),
        "liters": _float_value("liters"),
        "subfactuurbedrag": _float_value("subfactuurbedrag"),
    }
    normalized["liters"] = calculate_inkoop_row_liters(normalized)
    return normalized


def normalize_inkoop_factuur(factuur: dict[str, Any] | None = None) -> dict[str, Any]:
    """Normaliseert Ã©Ã©n inkoopfactuur voor opslag en berekening."""
    source = factuur if isinstance(factuur, dict) else {}
    raw_rows = source.get("factuurregels", [])
    if not isinstance(raw_rows, list):
        raw_rows = []

    return {
        "id": str(source.get("id", "") or uuid4()),
        "factuurnummer": str(source.get("factuurnummer", "") or ""),
        "factuurdatum": str(source.get("factuurdatum", "") or ""),
        "verzendkosten": float(source.get("verzendkosten", 0.0) or 0.0),
        "overige_kosten": float(source.get("overige_kosten", 0.0) or 0.0),
        "factuurregels": [
            normalize_inkoop_row(row)
            for row in raw_rows
            if isinstance(row, dict)
        ],
    }


def get_record_inkoop_facturen(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Haalt alle inkoopfacturen veilig uit een berekening."""
    invoer = record.get("invoer", {})
    if not isinstance(invoer, dict):
        return []
    inkoop = invoer.get("inkoop", {})
    if not isinstance(inkoop, dict):
        return []

    facturen = inkoop.get("facturen", [])
    if isinstance(facturen, list) and facturen:
        return [
            normalize_inkoop_factuur(factuur)
            for factuur in facturen
            if isinstance(factuur, dict)
        ]

    primary_factuur = normalize_inkoop_factuur(
        {
            "factuurnummer": inkoop.get("factuurnummer", ""),
            "factuurdatum": inkoop.get("factuurdatum", ""),
            "verzendkosten": inkoop.get("verzendkosten", 0.0),
            "overige_kosten": inkoop.get("overige_kosten", 0.0),
            "factuurregels": inkoop.get("factuurregels", []),
        }
    )
    if (
        primary_factuur["factuurdatum"]
        or primary_factuur["verzendkosten"] != 0.0
        or primary_factuur["overige_kosten"] != 0.0
        or primary_factuur["factuurregels"]
    ):
        return [primary_factuur]
    return []


def set_record_inkoop_facturen(
    record: dict[str, Any],
    facturen: list[dict[str, Any]],
) -> None:
    """Schrijft alle inkoopfacturen terug en spiegelt de eerste factuur naar stap 3."""
    invoer = record.get("invoer", {})
    if not isinstance(invoer, dict):
        invoer = {}
    inkoop = invoer.get("inkoop", {})
    if not isinstance(inkoop, dict):
        inkoop = {}

    normalized_facturen = [
        normalize_inkoop_factuur(factuur)
        for factuur in facturen
        if isinstance(factuur, dict)
    ]
    if not normalized_facturen:
        normalized_facturen = [normalize_inkoop_factuur()]

    primary_factuur = normalized_facturen[0]
    inkoop["facturen"] = normalized_facturen
    inkoop["factuurnummer"] = str(primary_factuur.get("factuurnummer", "") or "")
    inkoop["factuurdatum"] = str(primary_factuur.get("factuurdatum", "") or "")
    inkoop["verzendkosten"] = float(primary_factuur.get("verzendkosten", 0.0) or 0.0)
    inkoop["overige_kosten"] = float(primary_factuur.get("overige_kosten", 0.0) or 0.0)
    inkoop["factuurregels"] = [
        normalize_inkoop_row(row)
        for row in primary_factuur.get("factuurregels", [])
        if isinstance(row, dict)
    ]
    inkoop["notities"] = str(inkoop.get("notities", "") or "")
    invoer["inkoop"] = inkoop
    record["invoer"] = invoer


def get_inkoop_record_totals(record: dict[str, Any]) -> dict[str, float]:
    """Berekent totalen over alle inkoopfacturen samen."""
    totaal_liters = 0.0
    totaal_subfactuurbedrag = 0.0
    totale_extra_kosten = 0.0

    for factuur in get_record_inkoop_facturen(record):
        rows = factuur.get("factuurregels", [])
        if not isinstance(rows, list):
            rows = []
        totaal_liters += sum(float(row.get("liters", 0.0) or 0.0) for row in rows)
        totaal_subfactuurbedrag += sum(
            float(row.get("subfactuurbedrag", 0.0) or 0.0) for row in rows
        )
        totale_extra_kosten += float(factuur.get("verzendkosten", 0.0) or 0.0)
        totale_extra_kosten += float(factuur.get("overige_kosten", 0.0) or 0.0)

    return {
        "totaal_liters": totaal_liters,
        "totaal_subfactuurbedrag": totaal_subfactuurbedrag,
        "totale_extra_kosten": totale_extra_kosten,
    }


def calculate_inkoop_row_liters(row: dict[str, Any]) -> float:
    """Berekent liters voor een inkoopregel op basis van gekozen samengesteld product."""
    product_id = str(row.get("eenheid", "") or "")
    try:
        aantal = float(row.get("aantal", 0.0) or 0.0)
    except (TypeError, ValueError):
        aantal = 0.0

    if product_id and aantal > 0:
        for product in load_samengestelde_producten():
            if str(product.get("id", "") or "") != product_id:
                continue
            try:
                inhoud_per_eenheid = float(product.get("totale_inhoud_liter", 0.0) or 0.0)
            except (TypeError, ValueError):
                inhoud_per_eenheid = 0.0
            if inhoud_per_eenheid > 0:
                return inhoud_per_eenheid * aantal
            break

    try:
        return float(row.get("liters", 0.0) or 0.0)
    except (TypeError, ValueError):
        return 0.0


def calculate_prijs_per_eenheid(row: dict[str, Any]) -> float:
    """Berekent de prijs per eenheid voor een ingrediÃ«ntregel."""
    hoeveelheid = float(row.get("hoeveelheid", 0.0) or 0.0)
    prijs = float(row.get("prijs", 0.0) or 0.0)
    if hoeveelheid <= 0:
        return 0.0
    return prijs / hoeveelheid


def calculate_kosten_recept(row: dict[str, Any]) -> float:
    """Berekent de receptkosten voor een ingrediÃ«ntregel."""
    benodigd = float(row.get("benodigd_in_recept", 0.0) or 0.0)
    if benodigd <= 0:
        return 0.0
    return calculate_prijs_per_eenheid(row) * benodigd


def calculate_toegerekende_extra_kosten_per_row(
    verzendkosten: float | int | None,
    overige_kosten: float | int | None,
    aantal_regels: int,
) -> float:
    """Berekent gelijk verdeelde extra kosten per actieve inkoopregel."""
    if aantal_regels <= 0:
        return 0.0

    try:
        totaal = float(verzendkosten or 0.0) + float(overige_kosten or 0.0)
    except (TypeError, ValueError):
        return 0.0

    return totaal / float(aantal_regels)


def calculate_inkoop_prijs_per_eenheid(
    row: dict[str, Any],
    toegerekende_extra_kosten: float | int | None,
) -> float:
    """Berekent prijs per eenheid voor een inkoopregel."""
    aantal = float(row.get("aantal", 0.0) or 0.0)
    subfactuurbedrag = float(row.get("subfactuurbedrag", 0.0) or 0.0)
    extra = float(toegerekende_extra_kosten or 0.0)
    if aantal <= 0:
        return 0.0
    return (subfactuurbedrag + extra) / aantal


def calculate_inkoop_prijs_per_liter(
    row: dict[str, Any],
    toegerekende_extra_kosten: float | int | None,
) -> float:
    """Berekent prijs per liter voor een inkoopregel."""
    liters = float(row.get("liters", 0.0) or 0.0)
    subfactuurbedrag = float(row.get("subfactuurbedrag", 0.0) or 0.0)
    extra = float(toegerekende_extra_kosten or 0.0)
    if liters <= 0:
        return 0.0
    return (subfactuurbedrag + extra) / liters


def get_ingredient_key(row_id: str, field: str) -> str:
    """Bouwt een stabiele widgetkey voor een ingrediÃ«ntveld."""
    return f"nb_ingredient_{field}_{row_id}"


def ingredient_widget_keys(row_id: str) -> list[str]:
    """Geeft alle widgetkeys terug voor Ã©Ã©n ingrediÃ«ntregel."""
    return [
        get_ingredient_key(row_id, "ingredient"),
        get_ingredient_key(row_id, "omschrijving"),
        get_ingredient_key(row_id, "hoeveelheid"),
        get_ingredient_key(row_id, "eenheid"),
        get_ingredient_key(row_id, "prijs"),
        get_ingredient_key(row_id, "benodigd"),
    ]


def get_inkoop_key(row_id: str, field: str) -> str:
    """Bouwt een stabiele widgetkey voor een inkoopveld."""
    return f"nb_inkoop_{field}_{row_id}"


def inkoop_widget_keys(row_id: str) -> list[str]:
    """Geeft alle widgetkeys terug voor Ã©Ã©n inkoopregel."""
    return [
        get_inkoop_key(row_id, "aantal"),
        get_inkoop_key(row_id, "eenheid"),
        get_inkoop_key(row_id, "subfactuurbedrag"),
    ]


def hydrate_ingredient_row_widgets(
    row: dict[str, Any],
    *,
    overwrite: bool = False,
) -> None:
    """Vult widgetstate voor een ingrediÃ«ntregel vanuit de actieve berekening."""
    normalized = normalize_ingredient_row(row)
    row_id = normalized["id"]
    widget_values = {
        get_ingredient_key(row_id, "ingredient"): normalized["ingrediÃ«nt"],
        get_ingredient_key(row_id, "omschrijving"): normalized["omschrijving"],
        get_ingredient_key(row_id, "hoeveelheid"): float(normalized["hoeveelheid"]),
        get_ingredient_key(row_id, "eenheid"): normalized["eenheid"],
        get_ingredient_key(row_id, "prijs"): float(normalized["prijs"]),
        get_ingredient_key(row_id, "benodigd"): float(
            normalized["benodigd_in_recept"]
        ),
    }
    for key, value in widget_values.items():
        if overwrite or key not in st.session_state:
            st.session_state[key] = value


def hydrate_inkoop_row_widgets(
    row: dict[str, Any],
    *,
    overwrite: bool = False,
) -> None:
    """Vult widgetstate voor een inkoopregel vanuit de actieve berekening."""
    normalized = normalize_inkoop_row(row)
    row_id = normalized["id"]
    widget_values = {
        get_inkoop_key(row_id, "aantal"): float(normalized["aantal"]),
        get_inkoop_key(row_id, "eenheid"): normalized["eenheid"],
        get_inkoop_key(row_id, "subfactuurbedrag"): float(normalized["subfactuurbedrag"]),
    }
    for key, value in widget_values.items():
        if overwrite or key not in st.session_state:
            st.session_state[key] = value


def collect_ingredient_row_from_widgets(row_id: str) -> dict[str, Any]:
    """Leest een ingrediÃ«ntregel terug uit de widgetstate."""
    return normalize_ingredient_row(
        {
            "id": row_id,
            "ingrediÃ«nt": st.session_state.get(get_ingredient_key(row_id, "ingredient"), ""),
            "omschrijving": st.session_state.get(get_ingredient_key(row_id, "omschrijving"), ""),
            "hoeveelheid": st.session_state.get(get_ingredient_key(row_id, "hoeveelheid"), 0.0),
            "eenheid": st.session_state.get(get_ingredient_key(row_id, "eenheid"), ""),
            "prijs": st.session_state.get(get_ingredient_key(row_id, "prijs"), 0.0),
            "benodigd_in_recept": st.session_state.get(
                get_ingredient_key(row_id, "benodigd"),
                0.0,
            ),
        }
    )


def collect_inkoop_row_from_widgets(row_id: str) -> dict[str, Any]:
    """Leest een inkoopregel terug uit de widgetstate."""
    return normalize_inkoop_row(
        {
            "id": row_id,
            "aantal": st.session_state.get(get_inkoop_key(row_id, "aantal"), 0.0),
            "eenheid": st.session_state.get(get_inkoop_key(row_id, "eenheid"), ""),
            "subfactuurbedrag": st.session_state.get(
                get_inkoop_key(row_id, "subfactuurbedrag"),
                0.0,
            ),
        }
    )


def merge_ingredient_row_into_record_rows(
    record_rows: list[dict[str, Any]],
    row: dict[str, Any],
) -> list[dict[str, Any]]:
    """Voegt een ingrediÃ«ntregel toe aan de recordlijst of werkt hem bij."""
    normalized_row = normalize_ingredient_row(row)
    row_id = normalized_row["id"]
    updated_rows: list[dict[str, Any]] = []
    found = False

    for existing in record_rows:
        normalized_existing = normalize_ingredient_row(existing)
        if normalized_existing["id"] == row_id:
            updated_rows.append(normalized_row)
            found = True
        else:
            updated_rows.append(normalized_existing)

    if not found:
        updated_rows.append(normalized_row)

    return updated_rows


def merge_inkoop_row_into_record_rows(
    record_rows: list[dict[str, Any]],
    row: dict[str, Any],
) -> list[dict[str, Any]]:
    """Voegt een inkoopregel toe aan de recordlijst of werkt hem bij."""
    normalized_row = normalize_inkoop_row(row)
    row_id = normalized_row["id"]
    updated_rows: list[dict[str, Any]] = []
    found = False

    for existing in record_rows:
        normalized_existing = normalize_inkoop_row(existing)
        if normalized_existing["id"] == row_id:
            updated_rows.append(normalized_row)
            found = True
        else:
            updated_rows.append(normalized_existing)

    if not found:
        updated_rows.append(normalized_row)

    return updated_rows


def get_record_ingredient_rows(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Haalt ingrediÃ«ntregels veilig uit een berekening."""
    invoer = record.get("invoer", {})
    if not isinstance(invoer, dict):
        return []
    ingredienten = invoer.get("ingredienten", {})
    if not isinstance(ingredienten, dict):
        return []
    rows = ingredienten.get("regels", [])
    if not isinstance(rows, list):
        return []
    return [normalize_ingredient_row(row) for row in rows if isinstance(row, dict)]


def get_record_inkoop_rows(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Haalt de regels van de hoofd-factuur veilig uit een berekening."""
    facturen = get_record_inkoop_facturen(record)
    if not facturen:
        return []
    rows = facturen[0].get("factuurregels", [])
    if not isinstance(rows, list):
        return []
    return [normalize_inkoop_row(row) for row in rows if isinstance(row, dict)]


def set_record_ingredient_rows(record: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    """Schrijft ingrediÃ«ntregels terug naar de berekening."""
    invoer = record.get("invoer", {})
    if not isinstance(invoer, dict):
        invoer = {}
    ingredienten = invoer.get("ingredienten", {})
    if not isinstance(ingredienten, dict):
        ingredienten = {}
    ingredienten["regels"] = [normalize_ingredient_row(row) for row in rows]
    ingredienten["notities"] = str(ingredienten.get("notities", "") or "")
    invoer["ingredienten"] = ingredienten
    record["invoer"] = invoer


def set_record_inkoop_rows(record: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    """Schrijft de regels van de hoofd-factuur terug naar de berekening."""
    facturen = get_record_inkoop_facturen(record)
    if facturen:
        facturen[0]["factuurregels"] = [normalize_inkoop_row(row) for row in rows]
    else:
        facturen = [
            normalize_inkoop_factuur(
                {
                    "factuurregels": rows,
                }
            )
        ]
    set_record_inkoop_facturen(record, facturen)


def apply_current_inkoop_meta_to_record(record: dict[str, Any]) -> dict[str, Any]:
    """Schrijft de huidige inkoop-meta uit widgetstate naar de actieve berekening."""
    facturen = get_record_inkoop_facturen(record)
    if facturen:
        primary_factuur = normalize_inkoop_factuur(facturen[0])
    else:
        primary_factuur = normalize_inkoop_factuur()
    if "nb_inkoop_verzendkosten" in st.session_state:
        primary_factuur["verzendkosten"] = float(
            st.session_state.get("nb_inkoop_verzendkosten", 0.0) or 0.0
        )
    if "nb_inkoop_overige_kosten" in st.session_state:
        primary_factuur["overige_kosten"] = float(
            st.session_state.get("nb_inkoop_overige_kosten", 0.0) or 0.0
        )
    if "nb_inkoop_factuurdatum" in st.session_state:
        primary_factuur["factuurdatum"] = str(
            st.session_state.get("nb_inkoop_factuurdatum", "") or ""
        )
    if facturen:
        facturen[0] = primary_factuur
    else:
        facturen = [primary_factuur]
    set_record_inkoop_facturen(record, facturen)
    if "nb_input_inkoop_notities" in st.session_state:
        record["invoer"]["inkoop"]["notities"] = str(
            st.session_state.get("nb_input_inkoop_notities", "") or ""
        )
    return record


def sync_active_inkoop_state_from_widgets() -> dict[str, Any]:
    """Synchroniseert alleen stap 3 inkoop veilig terug naar de actieve berekening."""
    record = get_active_berekening()
    record = apply_current_inkoop_meta_to_record(record)
    rows = collect_all_inkoop_rows_from_state(record)
    set_record_inkoop_rows(record, rows)
    set_active_berekening(record)
    return record


def get_step_3_rows_for_view(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Geeft de actuele ingrediÃ«ntregels terug inclusief een bewerkte rij."""
    record_rows = get_record_ingredient_rows(record)
    editing_row_id = str(st.session_state.get("nb_ingredient_edit_row_id", "") or "")
    if not editing_row_id:
        return record_rows

    widget_keys_present = all(
        key in st.session_state for key in ingredient_widget_keys(editing_row_id)
    )
    if not widget_keys_present:
        return record_rows

    editing_row = collect_ingredient_row_from_widgets(editing_row_id)
    return merge_ingredient_row_into_record_rows(record_rows, editing_row)


def get_step_3_inkoop_rows_for_view(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Geeft de actuele inkoopregels terug inclusief een bewerkte rij."""
    record_rows = get_record_inkoop_rows(record)
    editing_row_id = str(st.session_state.get("nb_inkoop_edit_row_id", "") or "")
    if not editing_row_id:
        return record_rows

    widget_keys_present = all(
        key in st.session_state for key in inkoop_widget_keys(editing_row_id)
    )
    if not widget_keys_present:
        return record_rows

    editing_row = collect_inkoop_row_from_widgets(editing_row_id)
    return merge_inkoop_row_into_record_rows(record_rows, editing_row)


def collect_all_inkoop_rows_from_state(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Leest alle actuele inkoopregels veilig uit record + widgetstate."""
    record_rows = get_record_inkoop_rows(record)
    record_rows_by_id = {str(row.get("id", "")): normalize_inkoop_row(row) for row in record_rows}
    row_ids = st.session_state.get("nb_inkoop_row_ids", [])
    editing_row_id = str(st.session_state.get("nb_inkoop_edit_row_id", "") or "")

    if not isinstance(row_ids, list) or not row_ids:
        return record_rows

    collected_rows: list[dict[str, Any]] = []
    for raw_row_id in row_ids:
        row_id = str(raw_row_id or "")
        if not row_id:
            continue

        widget_keys_present = all(key in st.session_state for key in inkoop_widget_keys(row_id))
        is_existing_record_row = row_id in record_rows_by_id
        should_read_from_widgets = (
            row_id == editing_row_id
            or not is_existing_record_row
        )

        if should_read_from_widgets and widget_keys_present:
            collected_rows.append(collect_inkoop_row_from_widgets(row_id))
            continue

        existing_row = record_rows_by_id.get(row_id)
        if existing_row is not None:
            collected_rows.append(existing_row)

    return collected_rows


def has_step_3_widget_state() -> bool:
    """Controleert of stap 3-widgetstate aanwezig is."""
    calculation_type = str(
        st.session_state.get("nb_soort_type", "Eigen productie") or "Eigen productie"
    )
    if calculation_type == "Inkoop":
        row_ids = st.session_state.get("nb_inkoop_row_ids", [])
        if isinstance(row_ids, list) and row_ids:
            return True
        if "nb_inkoop_verzendkosten" in st.session_state:
            return True
        if "nb_inkoop_overige_kosten" in st.session_state:
            return True
        editing_row_id = str(st.session_state.get("nb_inkoop_edit_row_id", "") or "")
        if editing_row_id:
            return any(key in st.session_state for key in inkoop_widget_keys(editing_row_id))
        return False

    row_ids = st.session_state.get("nb_ingredient_row_ids", [])
    if isinstance(row_ids, list) and row_ids:
        return True

    editing_row_id = str(st.session_state.get("nb_ingredient_edit_row_id", "") or "")
    if editing_row_id:
        return any(key in st.session_state for key in ingredient_widget_keys(editing_row_id))

    return False


def update_step_3_record_from_widgets(record: dict[str, Any]) -> dict[str, Any]:
    """Synchroniseert stap 3 veilig terug naar de actieve berekening."""
    current_type = str(
        record.get("soort_berekening", {}).get("type", "Eigen productie")
        or "Eigen productie"
    )
    if not has_step_3_widget_state():
        return record

    if current_type == "Eigen productie":
        rows = get_step_3_rows_for_view(record)
        set_record_ingredient_rows(record, rows)
        return record

    if current_type == "Inkoop":
        record = apply_current_inkoop_meta_to_record(record)
        rows = collect_all_inkoop_rows_from_state(record)
        set_record_inkoop_rows(record, rows)

    return record


def load_record_into_widget_state(record: dict[str, Any]) -> None:
    """Laadt de actieve berekening in de widgetlaag."""
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    soort_berekening = record.get("soort_berekening", {})
    if not isinstance(soort_berekening, dict):
        soort_berekening = {}
    invoer = record.get("invoer", {})
    if not isinstance(invoer, dict):
        invoer = {}

    ingredienten = invoer.get("ingredienten", {})
    if not isinstance(ingredienten, dict):
        ingredienten = {}
    inkoop = invoer.get("inkoop", {})
    if not isinstance(inkoop, dict):
        inkoop = {}

    st.session_state["nb_basis_jaar"] = int(basisgegevens.get("jaar", 0) or 0) or None
    st.session_state["nb_basis_biernaam"] = str(basisgegevens.get("biernaam", "") or "")
    st.session_state["nb_basis_stijl"] = str(basisgegevens.get("stijl", "") or "")
    st.session_state["nb_basis_alcoholpercentage"] = float(
        basisgegevens.get("alcoholpercentage", 0.0) or 0.0
    )
    st.session_state["nb_basis_belastingsoort"] = str(
        basisgegevens.get("belastingsoort", "Accijns") or "Accijns"
    )
    st.session_state["nb_basis_tarief_accijns"] = str(
        basisgegevens.get("tarief_accijns", "Hoog") or "Hoog"
    )
    st.session_state["nb_basis_btw_tarief"] = str(
        basisgegevens.get("btw_tarief", "21%") or "21%"
    )
    berekening_type = str(
        soort_berekening.get("type", "Eigen productie") or "Eigen productie"
    )
    st.session_state["nb_soort_type"] = (
        berekening_type if berekening_type in CALCULATION_OPTIONS else CALCULATION_OPTIONS[0]
    )
    st.session_state["nb_input_ingredienten_notities"] = str(
        ingredienten.get("notities", "") or ""
    )
    st.session_state["nb_input_inkoop_notities"] = str(inkoop.get("notities", "") or "")
    st.session_state["nb_inkoop_factuurdatum"] = str(inkoop.get("factuurdatum", "") or "")
    st.session_state["nb_inkoop_verzendkosten"] = float(
        inkoop.get("verzendkosten", 0.0) or 0.0
    )
    st.session_state["nb_inkoop_overige_kosten"] = float(
        inkoop.get("overige_kosten", 0.0) or 0.0
    )

    ingredient_rows = get_record_ingredient_rows(record)
    st.session_state["nb_ingredient_row_ids"] = [row["id"] for row in ingredient_rows]
    inkoop_rows = get_record_inkoop_rows(record)
    st.session_state["nb_inkoop_row_ids"] = [row["id"] for row in inkoop_rows]
    st.session_state["nb_ingredient_edit_row_id"] = None
    st.session_state["nb_ingredient_delete_confirm_row_id"] = None
    st.session_state["nb_inkoop_edit_row_id"] = None
    st.session_state["nb_inkoop_delete_confirm_row_id"] = None


def hydrate_step_1_widget_state(record: dict[str, Any]) -> None:
    """Hydrateert alleen de widgetstate van stap 1 vanuit de actieve berekening."""
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    bier_snapshot = record.get("bier_snapshot", {})
    if not isinstance(bier_snapshot, dict):
        bier_snapshot = {}

    values = {
        "nb_basis_jaar": int(basisgegevens.get("jaar", 0) or 0) or None,
        "nb_basis_biernaam": str(
            basisgegevens.get("biernaam", bier_snapshot.get("biernaam", "")) or ""
        ),
        "nb_basis_stijl": str(
            basisgegevens.get("stijl", bier_snapshot.get("stijl", "")) or ""
        ),
        "nb_basis_alcoholpercentage": float(
            basisgegevens.get(
                "alcoholpercentage",
                bier_snapshot.get("alcoholpercentage", 0.0),
            )
            or 0.0
        ),
        "nb_basis_belastingsoort": str(
            basisgegevens.get(
                "belastingsoort",
                bier_snapshot.get("belastingsoort", "Accijns"),
            )
            or "Accijns"
        ),
        "nb_basis_tarief_accijns": str(
            basisgegevens.get(
                "tarief_accijns",
                bier_snapshot.get("tarief_accijns", "Hoog"),
            )
            or "Hoog"
        ),
        "nb_basis_btw_tarief": str(
            basisgegevens.get(
                "btw_tarief",
                bier_snapshot.get("btw_tarief", "21%"),
            )
            or "21%"
        ),
    }
    for key, value in values.items():
        if key not in st.session_state:
            st.session_state[key] = value


def hydrate_step_2_widget_state(record: dict[str, Any]) -> None:
    """Hydrateert alleen de widgetstate van stap 2 vanuit de actieve berekening."""
    soort_berekening = record.get("soort_berekening", {})
    if not isinstance(soort_berekening, dict):
        soort_berekening = {}
    berekening_type = str(
        soort_berekening.get("type", "Eigen productie") or "Eigen productie"
    )
    if "nb_soort_type" not in st.session_state:
        st.session_state["nb_soort_type"] = (
            berekening_type
            if berekening_type in CALCULATION_OPTIONS
            else CALCULATION_OPTIONS[0]
        )


def clear_step_1_widget_state() -> None:
    """Verwijdert widgetstate van stap 1 zodat deze opnieuw kan hydrateren."""
    for key in [
        "nb_basis_jaar",
        "nb_basis_biernaam",
        "nb_basis_stijl",
        "nb_basis_alcoholpercentage",
        "nb_basis_belastingsoort",
        "nb_basis_tarief_accijns",
        "nb_basis_btw_tarief",
    ]:
        st.session_state.pop(key, None)


def clear_step_2_widget_state() -> None:
    """Verwijdert widgetstate van stap 2 zodat deze opnieuw kan hydrateren."""
    st.session_state.pop("nb_soort_type", None)


def clear_step_3_inkoop_widget_state() -> None:
    """Verwijdert widgetstate van stap 3 voor inkoop zodat deze opnieuw kan hydrateren."""
    keys_to_remove = [
        key
        for key in list(st.session_state.keys())
        if key.startswith("nb_inkoop_")
    ]
    keys_to_remove.append("nb_input_inkoop_notities")

    for key in keys_to_remove:
        st.session_state.pop(key, None)

    st.session_state["nb_force_hydrate_inkoop_step_3"] = True


def hydrate_step_3_inkoop_widget_state(
    record: dict[str, Any],
    *,
    overwrite: bool = False,
) -> None:
    """Hydrateert de top-level widgetstate van stap 3 voor inkoop."""
    invoer = record.get("invoer", {})
    if not isinstance(invoer, dict):
        invoer = {}
    inkoop = invoer.get("inkoop", {})
    if not isinstance(inkoop, dict):
        inkoop = {}

    values = {
        "nb_input_inkoop_notities": str(inkoop.get("notities", "") or ""),
        "nb_inkoop_factuurdatum": str(inkoop.get("factuurdatum", "") or ""),
        "nb_inkoop_verzendkosten": float(inkoop.get("verzendkosten", 0.0) or 0.0),
        "nb_inkoop_overige_kosten": float(inkoop.get("overige_kosten", 0.0) or 0.0),
        "nb_inkoop_row_ids": [row["id"] for row in get_record_inkoop_rows(record)],
        "nb_inkoop_edit_row_id": None,
        "nb_inkoop_delete_confirm_row_id": None,
    }
    for key, value in values.items():
        if overwrite or key not in st.session_state:
            st.session_state[key] = value


def load_record_into_editor(record: dict[str, Any], *, step: int | None = None) -> None:
    """Opent een berekening in de wizard."""
    set_active_berekening(record)
    st.session_state["nieuwe_berekening_view_mode"] = "wizard"
    requested_step = step or int(record.get("last_completed_step", 1) or 1)
    st.session_state["nieuwe_berekening_step"] = min(
        requested_step,
        get_total_steps_for_record(record),
    )
    load_record_into_widget_state(record)


def ensure_step_1_widget_state(record: dict[str, Any]) -> None:
    """Hydrateert stap 1 als de keys ontbreken."""
    if all(
        key in st.session_state
        for key in [
            "nb_basis_jaar",
            "nb_basis_biernaam",
            "nb_basis_stijl",
            "nb_basis_alcoholpercentage",
            "nb_basis_belastingsoort",
            "nb_basis_tarief_accijns",
            "nb_basis_btw_tarief",
        ]
    ):
        return
    hydrate_step_1_widget_state(record)


def ensure_step_2_widget_state(record: dict[str, Any]) -> None:
    """Hydrateert stap 2 als de key ontbreekt."""
    ensure_step_1_widget_state(record)
    if "nb_soort_type" not in st.session_state:
        hydrate_step_2_widget_state(record)


def ensure_step_3_widget_state(record: dict[str, Any]) -> None:
    """Hydrateert stap 3-data als de keys ontbreken."""
    ensure_step_2_widget_state(record)
    force_hydrate_inkoop = bool(
        st.session_state.pop("nb_force_hydrate_inkoop_step_3", False)
    )
    if "nb_input_ingredienten_notities" not in st.session_state:
        st.session_state["nb_input_ingredienten_notities"] = str(
            record.get("invoer", {}).get("ingredienten", {}).get("notities", "") or ""
        )
    hydrate_step_3_inkoop_widget_state(record, overwrite=force_hydrate_inkoop)

    record_rows = get_record_ingredient_rows(record)
    record_row_ids = [row["id"] for row in record_rows]
    if st.session_state.get("nb_ingredient_row_ids") != record_row_ids:
        st.session_state["nb_ingredient_row_ids"] = record_row_ids

    editing_row_id = str(st.session_state.get("nb_ingredient_edit_row_id", "") or "")
    if editing_row_id:
        for row in record_rows:
            if row["id"] == editing_row_id:
                hydrate_ingredient_row_widgets(row)
                break

    record_inkoop_rows = get_record_inkoop_rows(record)
    record_inkoop_row_ids = [row["id"] for row in record_inkoop_rows]
    if force_hydrate_inkoop or st.session_state.get("nb_inkoop_row_ids") != record_inkoop_row_ids:
        hydrate_step_3_inkoop_widget_state(record, overwrite=True)

    editing_inkoop_row_id = str(st.session_state.get("nb_inkoop_edit_row_id", "") or "")
    if editing_inkoop_row_id:
        for row in record_inkoop_rows:
            if row["id"] == editing_inkoop_row_id:
                hydrate_inkoop_row_widgets(row)
                break


def sync_active_berekening_from_widgets() -> dict[str, Any]:
    """Synchroniseert widgetinput terug naar de actieve berekening."""
    record = get_active_berekening()
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    soort_berekening = record.get("soort_berekening", {})
    if not isinstance(soort_berekening, dict):
        soort_berekening = {}
    invoer = record.get("invoer", {})
    if not isinstance(invoer, dict):
        invoer = {}
    ingredienten = invoer.get("ingredienten", {})
    if not isinstance(ingredienten, dict):
        ingredienten = {}
    inkoop = invoer.get("inkoop", {})
    if not isinstance(inkoop, dict):
        inkoop = {}

    if "nb_basis_jaar" in st.session_state:
        basisgegevens["jaar"] = int(st.session_state.get("nb_basis_jaar") or 0)
    if "nb_basis_biernaam" in st.session_state:
        basisgegevens["biernaam"] = str(st.session_state.get("nb_basis_biernaam", "") or "")
    if "nb_basis_stijl" in st.session_state:
        basisgegevens["stijl"] = str(st.session_state.get("nb_basis_stijl", "") or "")
    if "nb_basis_alcoholpercentage" in st.session_state:
        basisgegevens["alcoholpercentage"] = float(
            st.session_state.get("nb_basis_alcoholpercentage", 0.0) or 0.0
        )
    if "nb_basis_belastingsoort" in st.session_state:
        basisgegevens["belastingsoort"] = str(
            st.session_state.get("nb_basis_belastingsoort", "Accijns") or "Accijns"
        )
    if "nb_basis_tarief_accijns" in st.session_state:
        basisgegevens["tarief_accijns"] = str(
            st.session_state.get("nb_basis_tarief_accijns", "Hoog") or "Hoog"
        )
    if "nb_basis_btw_tarief" in st.session_state:
        basisgegevens["btw_tarief"] = str(
            st.session_state.get("nb_basis_btw_tarief", "21%") or "21%"
        )
    if "nb_soort_type" in st.session_state:
        soort_berekening["type"] = str(
            st.session_state.get("nb_soort_type", "Eigen productie") or "Eigen productie"
        )
    if "nb_input_ingredienten_notities" in st.session_state:
        ingredienten["notities"] = str(
            st.session_state.get("nb_input_ingredienten_notities", "") or ""
        )
    if "nb_hercalculatie_reden" in st.session_state:
        record["hercalculatie_reden"] = str(
            st.session_state.get("nb_hercalculatie_reden", "") or ""
        )
    if "nb_input_inkoop_notities" in st.session_state:
        inkoop["notities"] = str(st.session_state.get("nb_input_inkoop_notities", "") or "")

    ingredienten.setdefault("regels", [])
    inkoop.setdefault("regels", [])

    record["basisgegevens"] = basisgegevens
    record["soort_berekening"] = soort_berekening
    record["invoer"] = {
        "ingredienten": ingredienten,
        "inkoop": inkoop,
    }
    record = update_step_3_record_from_widgets(record)
    record["bier_snapshot"] = {
        "biernaam": str(basisgegevens.get("biernaam", "") or ""),
        "stijl": str(basisgegevens.get("stijl", "") or ""),
        "alcoholpercentage": float(basisgegevens.get("alcoholpercentage", 0.0) or 0.0),
        "belastingsoort": str(basisgegevens.get("belastingsoort", "Accijns") or "Accijns"),
        "tarief_accijns": str(basisgegevens.get("tarief_accijns", "Hoog") or "Hoog"),
        "btw_tarief": str(basisgegevens.get("btw_tarief", "21%") or "21%"),
    }
    record["last_completed_step"] = max(
        int(record.get("last_completed_step", 1) or 1),
        int(st.session_state.get("nieuwe_berekening_step", 1) or 1),
    )
    set_active_berekening(record)
    return record


def save_active_as_concept() -> bool:
    """Slaat de actieve berekening op als concept."""
    record = sync_active_berekening_from_widgets()
    saved = save_berekening_as_concept(record)
    if not saved:
        st.error("Opslaan van de berekening is niet gelukt.")
        return False
    set_active_berekening(saved)
    if str(saved.get("soort_berekening", {}).get("type", "")) == "Inkoop":
        st.session_state["nb_force_hydrate_inkoop_step_3"] = True
    set_feedback("Concept opgeslagen.")
    return True


def build_resultaat_snapshot(record: dict[str, Any]) -> dict[str, Any]:
    """Bouwt een eenvoudige resultaat_snapshot op voor afronden."""
    jaar = int(record.get("basisgegevens", {}).get("jaar", 0) or 0)
    calculation_type = str(
        record.get("soort_berekening", {}).get("type", "Eigen productie")
        or "Eigen productie"
    )
    variabele_kosten_per_liter = calculate_variabele_kosten_per_liter_from_record(record)
    directe_vaste_kosten_per_liter = (
        calculate_indirecte_vaste_kosten_per_inkoop_liter(jaar)
        if calculation_type == "Inkoop"
        else bereken_directe_vaste_kosten_per_liter(jaar)
    )
    step_4_tables = build_step_4_product_tables(record)

    return {
        "integrale_kostprijs_per_liter": (
            (variabele_kosten_per_liter or 0.0)
            + (directe_vaste_kosten_per_liter or 0.0)
            if variabele_kosten_per_liter is not None
            else None
        ),
        "variabele_kosten_per_liter": variabele_kosten_per_liter,
        "directe_vaste_kosten_per_liter": directe_vaste_kosten_per_liter,
        "producten": {
            "basisproducten": step_4_tables["basisproducten"],
            "samengestelde_producten": step_4_tables["samengestelde_producten"],
        },
    }


def finalize_active_berekening() -> bool:
    """Rondt de actieve berekening af als definitief."""
    record = sync_active_berekening_from_widgets()
    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}

    bier_id = str(record.get("bier_id", "") or "")
    if bier_id:
        update_bier(
            bier_id=bier_id,
            biernaam=str(basisgegevens.get("biernaam", "") or ""),
            stijl=str(basisgegevens.get("stijl", "") or ""),
            alcoholpercentage=float(basisgegevens.get("alcoholpercentage", 0.0) or 0.0),
            belastingsoort=str(basisgegevens.get("belastingsoort", "Accijns") or "Accijns"),
            tarief_accijns=str(basisgegevens.get("tarief_accijns", "Hoog") or "Hoog"),
            btw_tarief=str(basisgegevens.get("btw_tarief", "21%") or "21%"),
        )
    else:
        bier = add_bier(
            biernaam=str(basisgegevens.get("biernaam", "") or ""),
            stijl=str(basisgegevens.get("stijl", "") or ""),
            alcoholpercentage=float(basisgegevens.get("alcoholpercentage", 0.0) or 0.0),
            belastingsoort=str(basisgegevens.get("belastingsoort", "Accijns") or "Accijns"),
            tarief_accijns=str(basisgegevens.get("tarief_accijns", "Hoog") or "Hoog"),
            btw_tarief=str(basisgegevens.get("btw_tarief", "21%") or "21%"),
        )
        if bier:
            record["bier_id"] = str(bier.get("id", "") or "")

    record["bier_snapshot"] = {
        "biernaam": str(basisgegevens.get("biernaam", "") or ""),
        "stijl": str(basisgegevens.get("stijl", "") or ""),
        "alcoholpercentage": float(basisgegevens.get("alcoholpercentage", 0.0) or 0.0),
        "belastingsoort": str(basisgegevens.get("belastingsoort", "Accijns") or "Accijns"),
        "tarief_accijns": str(basisgegevens.get("tarief_accijns", "Hoog") or "Hoog"),
        "btw_tarief": str(basisgegevens.get("btw_tarief", "21%") or "21%"),
    }
    record["resultaat_snapshot"] = build_resultaat_snapshot(record)
    record["last_completed_step"] = get_total_steps_for_record(record)

    finalized = finalize_berekening(record)
    if not finalized:
        st.error("Afronden van de berekening is niet gelukt.")
        return False

    set_active_berekening(finalized)
    st.session_state["nieuwe_berekening_view_mode"] = "overview"
    st.session_state["nieuwe_berekening_step"] = 1
    set_feedback("Berekening afgerond.")
    return True


def start_new_berekening() -> None:
    """Start een nieuwe berekening."""
    st.session_state["nieuwe_berekening_allow_empty_wizard"] = True
    load_record_into_editor(create_empty_berekening(), step=1)


def start_recalculatie_berekening(berekening_id: str) -> None:
    """Start een hercalculatie op basis van een bestaande definitieve berekening."""
    record = get_berekening_by_id(berekening_id)
    if not record:
        st.warning("De geselecteerde berekening is niet gevonden.")
        return
    recalculatie = create_recalculatie_from_berekening(
        record,
        reason="Hercalculatie",
    )
    st.session_state["nieuwe_berekening_allow_empty_wizard"] = True
    load_record_into_editor(recalculatie, step=1)


def start_edit_berekening(berekening_id: str) -> None:
    """Opent een bestaande berekening in de wizard."""
    record = get_berekening_by_id(berekening_id)
    if not record:
        st.warning("De geselecteerde berekening is niet gevonden.")
        return
    st.session_state["nieuwe_berekening_allow_empty_wizard"] = True
    load_record_into_editor(record, step=int(record.get("last_completed_step", 1) or 1))


def return_to_overview(*, skip_sync: bool = False) -> None:
    """Gaat terug naar het overzicht."""
    if not skip_sync:
        sync_active_berekening_from_widgets()
    st.session_state["nieuwe_berekening_allow_empty_wizard"] = False
    st.session_state["nieuwe_berekening_view_mode"] = "overview"
    st.session_state["nieuwe_berekening_step"] = 1


def save_current_ingredient_row() -> None:
    """Slaat de huidige bewerkte ingrediÃ«ntregel op in de actieve berekening."""
    record = get_active_berekening()
    row_id = str(st.session_state.get("nb_ingredient_edit_row_id", "") or "")
    if not row_id:
        return

    rows = get_record_ingredient_rows(record)
    updated_rows = merge_ingredient_row_into_record_rows(
        rows,
        collect_ingredient_row_from_widgets(row_id),
    )
    set_record_ingredient_rows(record, updated_rows)
    set_active_berekening(record)
    st.session_state["nb_ingredient_row_ids"] = [row["id"] for row in updated_rows]
    st.session_state["nb_ingredient_edit_row_id"] = None
    st.session_state["nb_ingredient_delete_confirm_row_id"] = None


def save_current_inkoop_row() -> None:
    """Slaat de huidige bewerkte inkoopregel op in de actieve berekening."""
    row_id = str(st.session_state.get("nb_inkoop_edit_row_id", "") or "")
    if not row_id:
        return
    record = sync_active_inkoop_state_from_widgets()
    rows = get_record_inkoop_rows(record)
    updated_rows = merge_inkoop_row_into_record_rows(
        rows,
        collect_inkoop_row_from_widgets(row_id),
    )
    set_record_inkoop_rows(record, updated_rows)
    set_active_berekening(record)
    st.session_state["nb_inkoop_row_ids"] = [row["id"] for row in updated_rows]
    st.session_state["nb_inkoop_edit_row_id"] = None
    st.session_state["nb_inkoop_delete_confirm_row_id"] = None


def start_edit_ingredient_row(record: dict[str, Any], row_id: str) -> None:
    """Zet Ã©Ã©n ingrediÃ«ntregel in bewerkmodus."""
    for row in get_record_ingredient_rows(record):
        if row["id"] != row_id:
            continue
        hydrate_ingredient_row_widgets(row, overwrite=True)
        st.session_state["nb_ingredient_edit_row_id"] = row_id
        st.session_state["nb_ingredient_delete_confirm_row_id"] = None
        break


def start_edit_inkoop_row(record: dict[str, Any], row_id: str) -> None:
    """Zet Ã©Ã©n inkoopregel in bewerkmodus."""
    for row in get_record_inkoop_rows(record):
        if row["id"] != row_id:
            continue
        hydrate_inkoop_row_widgets(row, overwrite=True)
        st.session_state["nb_inkoop_edit_row_id"] = row_id
        st.session_state["nb_inkoop_delete_confirm_row_id"] = None
        break


def add_new_ingredient_row(record: dict[str, Any]) -> None:
    """Voegt een lege ingrediÃ«ntregel toe en opent die direct in bewerkmodus."""
    new_row = normalize_ingredient_row()
    rows = get_record_ingredient_rows(record)
    rows.append(new_row)
    set_record_ingredient_rows(record, rows)
    set_active_berekening(record)
    st.session_state["nb_ingredient_row_ids"] = [row["id"] for row in rows]
    st.session_state["nb_ingredient_edit_row_id"] = new_row["id"]
    st.session_state["nb_ingredient_delete_confirm_row_id"] = None
    hydrate_ingredient_row_widgets(new_row, overwrite=True)


def add_new_inkoop_row(record: dict[str, Any]) -> None:
    """Voegt een lege inkoopregel toe en opent die direct in bewerkmodus."""
    del record
    record = sync_active_inkoop_state_from_widgets()
    new_row = normalize_inkoop_row()
    rows = get_record_inkoop_rows(record)
    rows.append(new_row)
    set_record_inkoop_rows(record, rows)
    set_active_berekening(record)
    st.session_state["nb_inkoop_row_ids"] = [row["id"] for row in rows]
    st.session_state["nb_inkoop_edit_row_id"] = new_row["id"]
    st.session_state["nb_inkoop_delete_confirm_row_id"] = None
    hydrate_inkoop_row_widgets(new_row, overwrite=True)


def delete_ingredient_row(record: dict[str, Any], row_id: str) -> None:
    """Verwijdert Ã©Ã©n ingrediÃ«ntregel uit de actieve berekening."""
    rows = [row for row in get_record_ingredient_rows(record) if row["id"] != row_id]
    set_record_ingredient_rows(record, rows)
    set_active_berekening(record)
    st.session_state["nb_ingredient_row_ids"] = [row["id"] for row in rows]
    if st.session_state.get("nb_ingredient_edit_row_id") == row_id:
        st.session_state["nb_ingredient_edit_row_id"] = None
    st.session_state["nb_ingredient_delete_confirm_row_id"] = None


def delete_inkoop_row(record: dict[str, Any], row_id: str) -> None:
    """Verwijdert Ã©Ã©n inkoopregel uit de actieve berekening."""
    del record
    record = sync_active_inkoop_state_from_widgets()
    rows = [row for row in get_record_inkoop_rows(record) if row["id"] != row_id]
    set_record_inkoop_rows(record, rows)
    set_active_berekening(record)
    st.session_state["nb_inkoop_row_ids"] = [row["id"] for row in rows]
    if st.session_state.get("nb_inkoop_edit_row_id") == row_id:
        st.session_state["nb_inkoop_edit_row_id"] = None
    st.session_state["nb_inkoop_delete_confirm_row_id"] = None


