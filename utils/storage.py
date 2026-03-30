from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
PRODUCTIE_FILE = DATA_DIR / "productie.json"
VASTE_KOSTEN_FILE = DATA_DIR / "vaste_kosten.json"
BIEREN_FILE = DATA_DIR / "bieren.json"
BEREKENINGEN_FILE = DATA_DIR / "berekeningen.json"
VERKOOPPRIJZEN_FILE = DATA_DIR / "verkoopprijzen.json"
PRIJSVOORSTELLEN_FILE = DATA_DIR / "prijsvoorstellen.json"
TARIEVEN_HEFFINGEN_FILE = DATA_DIR / "tarieven_heffingen.json"
VARIABELE_KOSTEN_FILE = DATA_DIR / "variabele_kosten.json"
VERPAKKINGSONDERDELEN_FILE = DATA_DIR / "verpakkingsonderdelen.json"
BASISPRODUCTEN_FILE = DATA_DIR / "basisproducten.json"
SAMENGESTELDE_PRODUCTEN_FILE = DATA_DIR / "samengestelde_producten.json"
SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX = "verpakkingsonderdeel:"
DEFAULT_BELASTINGSOORT = "Accijns"
DEFAULT_TARIEF_ACCIJNS = "Hoog"
DEFAULT_BTW_TARIEF = "21%"


def _read_local_json_text(file_path: Path, default_content: str) -> str:
    file_path = _ensure_json_file(file_path, default_content)
    return file_path.read_text(encoding="utf-8-sig")


def _write_local_json_text(file_path: Path, raw_content: str, default_content: str) -> None:
    file_path = _ensure_json_file(file_path, default_content)
    file_path.write_text(raw_content, encoding="utf-8")


def _parse_json_content(raw_content: str, default_value: Any) -> Any:
    raw_content = (raw_content or "").strip()
    if not raw_content:
        return default_value

    try:
        data = json.loads(raw_content)
        if isinstance(data, type(default_value)):
            return data
    except json.JSONDecodeError:
        return default_value

    return default_value


def _ensure_json_file(file_path: Path, default_content: str) -> Path:
    """Maakt een JSON-bestand aan met een standaardinhoud indien nodig."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if not file_path.exists():
        file_path.write_text(default_content, encoding="utf-8")

    return file_path


def _load_json_value(file_path: Path, default_value: Any) -> Any:
    """Laadt JSON veilig in en valt terug op een standaardstructuur."""
    default_content = "{}" if isinstance(default_value, dict) else "[]"
    try:
        raw_content = _read_local_json_text(file_path, default_content)
        return _parse_json_content(raw_content, default_value)
    except OSError:
        return default_value


def _save_json_value(file_path: Path, data: Any, default_content: str) -> bool:
    """Slaat JSON veilig op naar schijf."""
    try:
        raw_content = json.dumps(data, indent=2, ensure_ascii=False)
        _write_local_json_text(file_path, raw_content, default_content)
        return True
    except OSError:
        return False


def _now_iso() -> str:
    """Geeft een eenvoudige ISO-timestamp terug."""
    return datetime.now().isoformat()


def ensure_productie_storage() -> Path:
    """Maakt het JSON-bestand voor productie aan."""
    return _ensure_json_file(PRODUCTIE_FILE, "{}")


def ensure_vaste_kosten_storage() -> Path:
    """Maakt het JSON-bestand voor vaste kosten aan."""
    return _ensure_json_file(VASTE_KOSTEN_FILE, "{}")


def ensure_bieren_storage() -> Path:
    """Maakt het JSON-bestand voor bieren aan."""
    return _ensure_json_file(BIEREN_FILE, "[]")


def ensure_berekeningen_storage() -> Path:
    """Maakt het JSON-bestand voor berekeningen aan."""
    return _ensure_json_file(BEREKENINGEN_FILE, "[]")


def ensure_verkoopprijzen_storage() -> Path:
    """Maakt het JSON-bestand voor verkoopprijzen aan."""
    return _ensure_json_file(VERKOOPPRIJZEN_FILE, "[]")


def ensure_prijsvoorstellen_storage() -> Path:
    """Maakt het JSON-bestand voor prijsvoorstellen aan."""
    return _ensure_json_file(PRIJSVOORSTELLEN_FILE, "[]")


def ensure_tarieven_heffingen_storage() -> Path:
    """Maakt het JSON-bestand voor tarieven en heffingen aan."""
    return _ensure_json_file(TARIEVEN_HEFFINGEN_FILE, "[]")


def ensure_variabele_kosten_storage() -> Path:
    """Maakt het JSON-bestand voor variabele kosten aan."""
    return _ensure_json_file(VARIABELE_KOSTEN_FILE, "{}")


def normalize_tarieven_heffingen_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een tarieven-en-heffingenrecord."""
    def _float_value(key: str) -> float:
        try:
            return float(record.get(key, 0.0) or 0.0)
        except (TypeError, ValueError):
            return 0.0

    return {
        "id": str(record.get("id", "") or uuid4()),
        "jaar": int(record.get("jaar", 0) or 0),
        "tarief_hoog": _float_value("tarief_hoog"),
        "tarief_laag": _float_value("tarief_laag"),
        "verbruikersbelasting": _float_value("verbruikersbelasting"),
    }


def load_tarieven_heffingen() -> list[dict[str, Any]]:
    """Laadt alle tarieven en heffingen veilig in."""
    data = _load_json_value(TARIEVEN_HEFFINGEN_FILE, [])
    if not isinstance(data, list):
        return []

    records = [
        normalize_tarieven_heffingen_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    return sorted(records, key=lambda item: int(item.get("jaar", 0) or 0))


def save_tarieven_heffingen(data: list[dict[str, Any]]) -> bool:
    """Slaat alle tarieven en heffingen veilig op."""
    normalized = [
        normalize_tarieven_heffingen_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    normalized = sorted(normalized, key=lambda item: int(item.get("jaar", 0) or 0))
    return _save_json_value(TARIEVEN_HEFFINGEN_FILE, normalized, "[]")


def upsert_tarieven_heffingen_row(record: dict[str, Any]) -> bool:
    """Voegt een tarievenregel toe of werkt een bestaande regel bij."""
    records = load_tarieven_heffingen()
    normalized = normalize_tarieven_heffingen_record(record)
    row_id = normalized["id"]

    updated = False
    for index, existing in enumerate(records):
        if str(existing.get("id", "")) != row_id:
            continue
        records[index] = normalized
        updated = True
        break

    if not updated:
        records.append(normalized)

    return save_tarieven_heffingen(records)


def delete_tarieven_heffingen_row(row_id: str) -> bool:
    """Verwijdert Ã©Ã©n tarievenregel op basis van id."""
    records = load_tarieven_heffingen()
    filtered = [record for record in records if str(record.get("id", "")) != row_id]

    if len(filtered) == len(records):
        return False

    return save_tarieven_heffingen(filtered)


def get_tarieven_heffingen_for_year(year: int | str) -> dict[str, Any] | None:
    """Geeft tarieven en heffingen terug voor een specifiek jaar."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    for record in load_tarieven_heffingen():
        if int(record.get("jaar", 0) or 0) == year_value:
            return record
    return None


def duplicate_tarieven_heffingen_to_year(
    source_year: int | str,
    target_year: int | str,
    *,
    overwrite: bool = False,
) -> bool:
    """Dupliceert tarieven en heffingen van bronjaar naar doeljaar."""
    source_record = get_tarieven_heffingen_for_year(source_year)
    if not source_record:
        return False
    if get_tarieven_heffingen_for_year(target_year) is not None and not overwrite:
        return False
    return upsert_tarieven_heffingen_row(
        {
            **source_record,
            "id": str(uuid4()),
            "jaar": int(target_year),
        }
    )


def _normalize_bier_record(bier: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert bierdata zodat oudere records veilig bruikbaar blijven."""
    legacy_verbruikersbelasting = str(
        bier.get("verbruikersbelasting_accijns", "") or ""
    ).strip()
    belastingsoort = str(
        bier.get("belastingsoort", "") or ""
    ).strip()
    tarief_accijns = str(
        bier.get("tarief_accijns", DEFAULT_TARIEF_ACCIJNS) or DEFAULT_TARIEF_ACCIJNS
    ).strip()
    btw_tarief = str(bier.get("btw_tarief", DEFAULT_BTW_TARIEF) or DEFAULT_BTW_TARIEF)

    if not belastingsoort:
        if legacy_verbruikersbelasting == "Ja":
            belastingsoort = "Accijns"
        elif legacy_verbruikersbelasting == "Nee":
            belastingsoort = "Geen"
        else:
            belastingsoort = DEFAULT_BELASTINGSOORT

    if belastingsoort not in {"Accijns", "Verbruiksbelasting", "Geen"}:
        belastingsoort = DEFAULT_BELASTINGSOORT
    if tarief_accijns not in {"Hoog", "Laag"}:
        tarief_accijns = DEFAULT_TARIEF_ACCIJNS
    if btw_tarief not in {"9%", "21%"}:
        btw_tarief = DEFAULT_BTW_TARIEF

    return {
        "id": str(bier.get("id", "")),
        "biernaam": str(bier.get("biernaam", "")),
        "stijl": str(bier.get("stijl", "")),
        "alcoholpercentage": float(bier.get("alcoholpercentage", 0.0) or 0.0),
        "belastingsoort": belastingsoort,
        "tarief_accijns": tarief_accijns,
        "btw_tarief": btw_tarief,
        "created_at": str(bier.get("created_at", "") or ""),
        "updated_at": str(bier.get("updated_at", "") or ""),
    }


def normalize_bier_record(bier: dict[str, Any]) -> dict[str, Any]:
    """Publieke wrapper voor het normaliseren van bierdata."""
    normalized = _normalize_bier_record(bier)
    normalized["created_at"] = normalized["created_at"] or _now_iso()
    normalized["updated_at"] = normalized["updated_at"] or normalized["created_at"]
    return normalized


def normalize_inkoop_factuur_record(factuur: dict[str, Any] | None) -> dict[str, Any]:
    """Normaliseert een inkoopfactuur met regels."""
    source = factuur if isinstance(factuur, dict) else {}
    factuurregels = source.get("factuurregels", source.get("regels", []))
    if not isinstance(factuurregels, list):
        factuurregels = []

    normalized_rows: list[dict[str, Any]] = []
    for row in factuurregels:
        if not isinstance(row, dict):
            continue
        try:
            aantal = float(row.get("aantal", 0.0) or 0.0)
        except (TypeError, ValueError):
            aantal = 0.0
        try:
            liters = float(row.get("liters", 0.0) or 0.0)
        except (TypeError, ValueError):
            liters = 0.0
        try:
            subfactuurbedrag = float(row.get("subfactuurbedrag", 0.0) or 0.0)
        except (TypeError, ValueError):
            subfactuurbedrag = 0.0

        normalized_rows.append(
            {
                "id": str(row.get("id", "") or uuid4()),
                "aantal": aantal,
                "eenheid": str(row.get("eenheid", "") or ""),
                "liters": liters,
                "subfactuurbedrag": subfactuurbedrag,
            }
        )

    return {
        "id": str(source.get("id", "") or uuid4()),
        "factuurnummer": str(source.get("factuurnummer", "") or ""),
        "factuurdatum": str(source.get("factuurdatum", "") or ""),
        "verzendkosten": float(source.get("verzendkosten", 0.0) or 0.0),
        "overige_kosten": float(source.get("overige_kosten", 0.0) or 0.0),
        "factuurregels": normalized_rows,
    }


def _normalize_ingredient_row_record(row: dict[str, Any] | None) -> dict[str, Any]:
    """Normaliseert een ingrediÃ«ntregel voor opslag in berekeningen."""
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


def _snapshot_float(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _normalize_resultaat_snapshot_product_row(row: dict[str, Any] | None) -> dict[str, Any]:
    source = row if isinstance(row, dict) else {}
    verpakking = str(
        source.get("verpakking", "")
        or source.get("verpakkingseenheid", "")
        or source.get("omschrijving", "")
        or ""
    )
    primaire_kosten = _snapshot_float(
        source.get("primaire_kosten", source.get("variabele_kosten", 0.0))
    )
    verpakkingskosten = _snapshot_float(source.get("verpakkingskosten", 0.0))
    vaste_kosten = _snapshot_float(
        source.get("vaste_kosten", source.get("vaste_directe_kosten", 0.0))
    )
    accijns = _snapshot_float(source.get("accijns", 0.0))
    kostprijs = _snapshot_float(
        source.get("kostprijs", primaire_kosten + verpakkingskosten + vaste_kosten + accijns)
    )
    liters_per_product = source.get(
        "liters_per_product",
        source.get("totale_inhoud_liter", source.get("inhoud_per_eenheid_liter")),
    )

    return {
        "biernaam": str(source.get("biernaam", "") or ""),
        "soort": str(source.get("soort", "") or ""),
        "verpakking": verpakking,
        "verpakkingseenheid": verpakking,
        "primaire_kosten": primaire_kosten,
        "variabele_kosten": primaire_kosten,
        "verpakkingskosten": verpakkingskosten,
        "vaste_kosten": vaste_kosten,
        "vaste_directe_kosten": vaste_kosten,
        "accijns": accijns,
        "kostprijs": kostprijs,
        "liters_per_product": _snapshot_float(liters_per_product),
    }


def _normalize_resultaat_snapshot_producten(
    producten: dict[str, Any] | None,
) -> dict[str, list[dict[str, Any]]]:
    source = producten if isinstance(producten, dict) else {}
    basisproducten = source.get("basisproducten", [])
    samengestelde_producten = source.get("samengestelde_producten", [])

    if not isinstance(basisproducten, list):
        basisproducten = []
    if not isinstance(samengestelde_producten, list):
        samengestelde_producten = []

    return {
        "basisproducten": [
            _normalize_resultaat_snapshot_product_row(row)
            for row in basisproducten
            if isinstance(row, dict)
        ],
        "samengestelde_producten": [
            _normalize_resultaat_snapshot_product_row(row)
            for row in samengestelde_producten
            if isinstance(row, dict)
        ],
    }


def normalize_berekening_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een berekeningrecord voor Nieuwe kostprijsberekening."""
    status = str(record.get("status", "concept") or "concept").strip().lower()
    if status not in {"concept", "definitief"}:
        status = "concept"

    basisgegevens = record.get("basisgegevens", {})
    if not isinstance(basisgegevens, dict):
        basisgegevens = {}
    basisgegevens = {
        "jaar": int(
            basisgegevens.get("jaar", record.get("jaar", 0)) or 0
        ),
        "biernaam": str(
            basisgegevens.get("biernaam", record.get("biernaam", "")) or ""
        ),
        "stijl": str(
            basisgegevens.get("stijl", record.get("stijl", "")) or ""
        ),
        "alcoholpercentage": float(
            basisgegevens.get(
                "alcoholpercentage",
                record.get("alcoholpercentage", 0.0),
            )
            or 0.0
        ),
        "belastingsoort": str(
            basisgegevens.get("belastingsoort", DEFAULT_BELASTINGSOORT)
            or DEFAULT_BELASTINGSOORT
        ),
        "tarief_accijns": str(
            basisgegevens.get("tarief_accijns", DEFAULT_TARIEF_ACCIJNS)
            or DEFAULT_TARIEF_ACCIJNS
        ),
        "btw_tarief": str(
            basisgegevens.get("btw_tarief", DEFAULT_BTW_TARIEF)
            or DEFAULT_BTW_TARIEF
        ),
    }

    soort_berekening = record.get("soort_berekening", {})
    if not isinstance(soort_berekening, dict):
        soort_berekening = {}
    calculation_type = str(
        soort_berekening.get("type", record.get("calculation_type", "")) or ""
    ).strip()
    if calculation_type not in {"Eigen productie", "Inkoop"}:
        calculation_type = "Eigen productie"
    soort_berekening = {"type": calculation_type}

    bier_snapshot = record.get("bier_snapshot", {})
    if not isinstance(bier_snapshot, dict):
        bier_snapshot = {}
    bier_snapshot = {
        "biernaam": str(
            bier_snapshot.get("biernaam", basisgegevens.get("biernaam", "")) or ""
        ),
        "stijl": str(bier_snapshot.get("stijl", basisgegevens.get("stijl", "")) or ""),
        "alcoholpercentage": float(
            bier_snapshot.get(
                "alcoholpercentage",
                basisgegevens.get("alcoholpercentage", 0.0),
            )
            or 0.0
        ),
        "belastingsoort": str(
            bier_snapshot.get(
                "belastingsoort",
                basisgegevens.get("belastingsoort", DEFAULT_BELASTINGSOORT),
            )
            or DEFAULT_BELASTINGSOORT
        ),
        "tarief_accijns": str(
            bier_snapshot.get(
                "tarief_accijns",
                basisgegevens.get("tarief_accijns", DEFAULT_TARIEF_ACCIJNS),
            )
            or DEFAULT_TARIEF_ACCIJNS
        ),
        "btw_tarief": str(
            bier_snapshot.get(
                "btw_tarief",
                basisgegevens.get("btw_tarief", DEFAULT_BTW_TARIEF),
            )
            or DEFAULT_BTW_TARIEF
        ),
    }

    hercalculatie_basis = record.get("hercalculatie_basis", {})
    if not isinstance(hercalculatie_basis, dict):
        hercalculatie_basis = {}
    hercalculatie_basis = {
        "ingredienten_regels": [
            _normalize_ingredient_row_record(row)
            for row in hercalculatie_basis.get("ingredienten_regels", [])
            if isinstance(row, dict)
        ],
    }

    invoer = record.get("invoer", {})
    if not isinstance(invoer, dict):
        invoer = {}
    ingredienten = invoer.get("ingredienten", {})
    if not isinstance(ingredienten, dict):
        ingredienten = {}
    ingredienten = {
        "regels": ingredienten.get("regels", []),
        "notities": str(ingredienten.get("notities", "") or ""),
    }
    if not isinstance(ingredienten["regels"], list):
        ingredienten["regels"] = []

    inkoop = invoer.get("inkoop", {})
    if not isinstance(inkoop, dict):
        inkoop = {}
    raw_facturen = inkoop.get("facturen", [])
    if not isinstance(raw_facturen, list):
        raw_facturen = []

    facturen = [
        normalize_inkoop_factuur_record(factuur)
        for factuur in raw_facturen
        if isinstance(factuur, dict)
    ]

    legacy_primary_factuur = normalize_inkoop_factuur_record(
        {
            "id": str(inkoop.get("primary_factuur_id", "") or ""),
            "factuurnummer": str(inkoop.get("factuurnummer", "") or ""),
            "factuurdatum": str(inkoop.get("factuurdatum", "") or ""),
            "verzendkosten": float(inkoop.get("verzendkosten", 0.0) or 0.0),
            "overige_kosten": float(inkoop.get("overige_kosten", 0.0) or 0.0),
            "factuurregels": inkoop.get("factuurregels", []),
        }
    )

    has_legacy_primary_data = bool(
        legacy_primary_factuur["factuurdatum"]
        or legacy_primary_factuur["verzendkosten"] != 0.0
        or legacy_primary_factuur["overige_kosten"] != 0.0
        or legacy_primary_factuur["factuurregels"]
    )

    if not facturen:
        if has_legacy_primary_data or calculation_type == "Inkoop":
            facturen = [legacy_primary_factuur]
        else:
            facturen = []

    primary_factuur = facturen[0] if facturen else legacy_primary_factuur
    inkoop = {
        "regels": inkoop.get("regels", []),
        "factuurregels": primary_factuur.get("factuurregels", []),
        "factuurnummer": str(primary_factuur.get("factuurnummer", "") or ""),
        "factuurdatum": str(primary_factuur.get("factuurdatum", "") or ""),
        "notities": str(inkoop.get("notities", "") or ""),
        "verzendkosten": float(primary_factuur.get("verzendkosten", 0.0) or 0.0),
        "overige_kosten": float(primary_factuur.get("overige_kosten", 0.0) or 0.0),
        "facturen": facturen,
    }
    if not isinstance(inkoop["regels"], list):
        inkoop["regels"] = []

    resultaat_snapshot = record.get("resultaat_snapshot")
    if resultaat_snapshot is None:
        resultaat_snapshot = {}
    if not isinstance(resultaat_snapshot, dict):
        resultaat_snapshot = {}
    resultaat_snapshot = {
        "integrale_kostprijs_per_liter": resultaat_snapshot.get(
            "integrale_kostprijs_per_liter"
        ),
        "variabele_kosten_per_liter": resultaat_snapshot.get(
            "variabele_kosten_per_liter"
        ),
        "directe_vaste_kosten_per_liter": resultaat_snapshot.get(
            "directe_vaste_kosten_per_liter"
        ),
        "producten": _normalize_resultaat_snapshot_producten(
            resultaat_snapshot.get("producten")
        ),
    }

    jaarovergang = record.get("jaarovergang", {})
    if not isinstance(jaarovergang, dict):
        jaarovergang = {}
    jaarovergang = {
        "bron_berekening_id": str(jaarovergang.get("bron_berekening_id", "") or ""),
        "bron_jaar": int(jaarovergang.get("bron_jaar", 0) or 0),
        "doel_jaar": int(jaarovergang.get("doel_jaar", basisgegevens.get("jaar", 0)) or 0),
        "aangemaakt_via": str(jaarovergang.get("aangemaakt_via", "") or ""),
        "created_at": str(jaarovergang.get("created_at", "") or ""),
    }

    created_at = str(record.get("created_at", "") or "") or _now_iso()
    updated_at = str(record.get("updated_at", "") or "") or created_at
    finalized_at = str(record.get("finalized_at", "") or "")

    return {
        "id": str(record.get("id", "") or uuid4()),
        "bier_id": str(record.get("bier_id", "") or ""),
        "record_type": str(record.get("record_type", "kostprijsberekening") or "kostprijsberekening"),
        "calculation_variant": str(record.get("calculation_variant", "origineel") or "origineel"),
        "bron_berekening_id": str(record.get("bron_berekening_id", "") or ""),
        "hercalculatie_reden": str(record.get("hercalculatie_reden", "") or ""),
        "hercalculatie_notitie": str(record.get("hercalculatie_notitie", "") or ""),
        "hercalculatie_timestamp": str(record.get("hercalculatie_timestamp", "") or ""),
        "hercalculatie_basis": hercalculatie_basis,
        "status": status,
        "basisgegevens": basisgegevens,
        "soort_berekening": soort_berekening,
        "invoer": {
            "ingredienten": ingredienten,
            "inkoop": inkoop,
        },
        "bier_snapshot": bier_snapshot,
        "resultaat_snapshot": resultaat_snapshot if status == "definitief" else {},
        "jaarovergang": jaarovergang,
        "last_completed_step": max(1, int(record.get("last_completed_step", 1) or 1)),
        "created_at": created_at,
        "updated_at": updated_at,
        "finalized_at": finalized_at if status == "definitief" else "",
    }




def init_verpakkingsonderdelen_file() -> Path:
    """Maakt het JSON-bestand voor verpakkingsonderdelen aan."""
    return _ensure_json_file(VERPAKKINGSONDERDELEN_FILE, "[]")


def bereken_prijs_per_stuk(
    hoeveelheid: float | int | None,
    prijs_artikel: float | int | None,
) -> float:
    """Berekent de prijs per stuk veilig."""
    try:
        hoeveelheid_value = float(hoeveelheid or 0.0)
        prijs_value = float(prijs_artikel or 0.0)
    except (TypeError, ValueError):
        return 0.0

    if hoeveelheid_value <= 0 or prijs_value < 0:
        return 0.0

    return prijs_value / hoeveelheid_value


def _fallback_verpakkingsonderdelen_years() -> list[int]:
    years = get_productie_years()
    if years:
        return years
    return [datetime.now().year]


def normalize_verpakkingsonderdeel_record(
    record: dict[str, Any],
    *,
    default_year: int | None = None,
    default_component_key: str | None = None,
    preserve_id: str | None = None,
) -> dict[str, Any]:
    """Normaliseert een verpakkingsonderdeelrecord voor jaargebonden opslag."""
    try:
        hoeveelheid = float(record.get("hoeveelheid", 0.0) or 0.0)
    except (TypeError, ValueError):
        hoeveelheid = 0.0

    try:
        prijs_per_stuk = float(record.get("prijs_per_stuk", 0.0) or 0.0)
    except (TypeError, ValueError):
        prijs_per_stuk = 0.0
    if prijs_per_stuk <= 0:
        try:
            prijs_artikel = float(record.get("prijs_artikel", 0.0) or 0.0)
        except (TypeError, ValueError):
            prijs_artikel = 0.0
        prijs_per_stuk = bereken_prijs_per_stuk(hoeveelheid, prijs_artikel)

    raw_year = record.get("jaar", default_year)
    try:
        jaar = int(raw_year or 0)
    except (TypeError, ValueError):
        jaar = int(default_year or 0)

    component_key = str(
        record.get("component_key")
        or default_component_key
        or record.get("id")
        or uuid4()
    )

    return {
        "id": str(preserve_id or record.get("id") or uuid4()),
        "component_key": component_key,
        "jaar": jaar,
        "omschrijving": str(record.get("omschrijving", "") or ""),
        "hoeveelheid": hoeveelheid,
        "prijs_per_stuk": prijs_per_stuk,
        "beschikbaar_voor_samengesteld": bool(
            record.get("beschikbaar_voor_samengesteld", False)
        ),
    }


def _sort_verpakkingsonderdelen(
    onderdelen: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return sorted(
        onderdelen,
        key=lambda item: (
            int(item.get("jaar", 0) or 0),
            str(item.get("omschrijving", "") or "").lower(),
            str(item.get("component_key", "") or ""),
        ),
    )


def _ensure_unique_verpakkingsonderdeel_ids(
    onderdelen: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    """Zorgt dat elke jaarregel een unieke id heeft."""
    seen_ids: set[str] = set()
    changed = False
    normalized_rows: list[dict[str, Any]] = []

    for onderdeel in onderdelen:
        current = dict(onderdeel)
        onderdeel_id = str(current.get("id", "") or uuid4())
        if onderdeel_id in seen_ids:
            current["id"] = str(uuid4())
            changed = True
        seen_ids.add(str(current.get("id", "") or ""))
        normalized_rows.append(current)

    return _sort_verpakkingsonderdelen(normalized_rows), changed


def _migrate_verpakkingsonderdelen_data(
    data: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    """Migreert legacy verpakkingsonderdelen naar jaargebonden opslag."""
    records = [record for record in data if isinstance(record, dict)]
    if not records:
        return [], False

    looks_legacy = any(
        "jaar" not in record or "component_key" not in record
        for record in records
    )

    migrated: list[dict[str, Any]] = []
    changed = False

    if looks_legacy:
        years = _fallback_verpakkingsonderdelen_years()
        earliest_year = min(years)
        for record in records:
            component_key = str(record.get("id") or uuid4())
            for year in years:
                migrated.append(
                    normalize_verpakkingsonderdeel_record(
                        record,
                        default_year=year,
                        default_component_key=component_key,
                        preserve_id=str(record.get("id")) if year == earliest_year else None,
                    )
                )
        changed = True
    else:
        migrated = [
            normalize_verpakkingsonderdeel_record(record)
            for record in records
        ]

    migrated, unique_changed = _ensure_unique_verpakkingsonderdeel_ids(migrated)
    changed = changed or unique_changed
    return migrated, changed


def load_verpakkingsonderdelen(year: int | str | None = None) -> list[dict[str, Any]]:
    """Laadt alle verpakkingsonderdelen veilig in, optioneel gefilterd op jaar."""
    data = _load_json_value(VERPAKKINGSONDERDELEN_FILE, [])
    records = data if isinstance(data, list) else []
    migrated, changed = _migrate_verpakkingsonderdelen_data(records)
    if changed:
        _save_json_value(VERPAKKINGSONDERDELEN_FILE, migrated, "[]")

    if year is None:
        return migrated

    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return migrated

    return [
        onderdeel
        for onderdeel in migrated
        if int(onderdeel.get("jaar", 0) or 0) == year_value
    ]


def save_verpakkingsonderdelen(data: list[dict[str, Any]]) -> bool:
    """Slaat alle verpakkingsonderdelen veilig op."""
    migrated, _ = _migrate_verpakkingsonderdelen_data(data)
    return _save_json_value(VERPAKKINGSONDERDELEN_FILE, migrated, "[]")


def get_verpakkingsonderdelen_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft verpakkingsonderdelen terug voor Ã©Ã©n geselecteerd jaar."""
    return load_verpakkingsonderdelen(year)


def get_verpakkingsonderdeel_by_component_key(
    component_key: str,
    year: int | str,
    *,
    fallback_to_latest: bool = True,
) -> dict[str, Any] | None:
    """Zoekt een verpakkingsonderdeel op basis van component_key en jaar."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        year_value = 0

    matches = [
        onderdeel
        for onderdeel in load_verpakkingsonderdelen()
        if str(onderdeel.get("component_key", "") or "") == str(component_key or "")
    ]
    if not matches:
        return None

    exact_match = next(
        (
            onderdeel
            for onderdeel in matches
            if int(onderdeel.get("jaar", 0) or 0) == year_value
        ),
        None,
    )
    if exact_match is not None:
        return exact_match

    if not fallback_to_latest:
        return None

    past_matches = [
        onderdeel
        for onderdeel in matches
        if int(onderdeel.get("jaar", 0) or 0) <= year_value
    ]
    if past_matches:
        return sorted(
            past_matches,
            key=lambda item: int(item.get("jaar", 0) or 0),
        )[-1]

    return sorted(matches, key=lambda item: int(item.get("jaar", 0) or 0))[-1]


def add_verpakkingsonderdeel(
    omschrijving: str,
    hoeveelheid: float,
    prijs_per_stuk: float,
    *,
    year: int | str | None = None,
    beschikbaar_voor_samengesteld: bool = False,
) -> dict[str, Any] | None:
    """Voegt een nieuw verpakkingsonderdeel toe."""
    onderdelen = load_verpakkingsonderdelen()
    target_year = int(year) if year is not None else max(_fallback_verpakkingsonderdelen_years())
    onderdeel = normalize_verpakkingsonderdeel_record(
        {
            "omschrijving": omschrijving,
            "hoeveelheid": hoeveelheid,
            "prijs_per_stuk": prijs_per_stuk,
            "beschikbaar_voor_samengesteld": beschikbaar_voor_samengesteld,
        },
        default_year=target_year,
    )
    onderdelen.append(onderdeel)

    if save_verpakkingsonderdelen(onderdelen):
        return onderdeel

    return None


def get_verpakkingsonderdeel_by_id(
    onderdeel_id: str,
    year: int | str | None = None,
) -> dict[str, Any] | None:
    """Haalt een verpakkingsonderdeel op op basis van id, optioneel op jaar."""
    all_onderdelen = load_verpakkingsonderdelen()
    for onderdeel in all_onderdelen:
        if str(onderdeel.get("id")) != onderdeel_id:
            continue
        if year is None:
            return onderdeel
        return get_verpakkingsonderdeel_by_component_key(
            str(onderdeel.get("component_key", "") or ""),
            year,
            fallback_to_latest=False,
        ) or onderdeel

    if year is not None:
        return get_verpakkingsonderdeel_by_component_key(
            onderdeel_id,
            year,
            fallback_to_latest=False,
        )

    return None


def update_verpakkingsonderdeel(
    onderdeel_id: str,
    omschrijving: str,
    hoeveelheid: float,
    prijs_per_stuk: float,
    *,
    year: int | str | None = None,
    beschikbaar_voor_samengesteld: bool = False,
) -> bool:
    """Werkt een bestaand verpakkingsonderdeel bij."""
    onderdelen = load_verpakkingsonderdelen()
    year_value = None
    if year is not None:
        try:
            year_value = int(year)
        except (TypeError, ValueError):
            year_value = None

    for index, onderdeel in enumerate(onderdelen):
        if str(onderdeel.get("id")) != onderdeel_id:
            continue
        if year_value is not None and int(onderdeel.get("jaar", 0) or 0) != year_value:
            continue

        onderdelen[index] = normalize_verpakkingsonderdeel_record(
            {
                **onderdeel,
                "id": onderdeel_id,
                "omschrijving": omschrijving,
                "hoeveelheid": hoeveelheid,
                "prijs_per_stuk": prijs_per_stuk,
                "beschikbaar_voor_samengesteld": beschikbaar_voor_samengesteld,
            }
        )
        return save_verpakkingsonderdelen(onderdelen)

    return False


def delete_verpakkingsonderdeel(
    onderdeel_id: str,
    *,
    year: int | str | None = None,
) -> bool:
    """Verwijdert een verpakkingsonderdeel op basis van id, optioneel binnen Ã©Ã©n jaar."""
    onderdelen = load_verpakkingsonderdelen()

    if year is None:
        filtered = [
            onderdeel
            for onderdeel in onderdelen
            if str(onderdeel.get("id")) != onderdeel_id
        ]
        if len(filtered) == len(onderdelen):
            return False
        return save_verpakkingsonderdelen(filtered)

    onderdeel = get_verpakkingsonderdeel_by_id(onderdeel_id, year)
    if not onderdeel:
        return False

    target_id = str(onderdeel.get("id", "") or "")
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return False

    filtered = [
        record
        for record in onderdelen
        if not (
            str(record.get("id", "") or "") == target_id
            and int(record.get("jaar", 0) or 0) == year_value
        )
    ]
    if len(filtered) == len(onderdelen):
        return False
    return save_verpakkingsonderdelen(filtered)


def duplicate_verpakkingsonderdelen_to_year(
    source_year: int | str,
    target_year: int | str,
    *,
    overwrite: bool = False,
) -> int:
    """Dupliceert alle verpakkingsonderdelen van een bronjaar naar een doeljaar."""
    try:
        source_year_value = int(source_year)
        target_year_value = int(target_year)
    except (TypeError, ValueError):
        return 0

    records = load_verpakkingsonderdelen()
    source_records = [
        record
        for record in records
        if int(record.get("jaar", 0) or 0) == source_year_value
    ]
    if not source_records:
        return 0

    target_by_component = {
        str(record.get("component_key", "") or ""): index
        for index, record in enumerate(records)
        if int(record.get("jaar", 0) or 0) == target_year_value
    }

    changed_count = 0
    for source in source_records:
        component_key = str(source.get("component_key", "") or "")
        normalized = normalize_verpakkingsonderdeel_record(
            source,
            default_year=target_year_value,
            default_component_key=component_key,
        )
        normalized["id"] = str(uuid4())
        normalized["jaar"] = target_year_value

        if component_key in target_by_component:
            if not overwrite:
                continue
            records[target_by_component[component_key]] = normalized
        else:
            records.append(normalized)
        changed_count += 1

    if changed_count > 0:
        save_verpakkingsonderdelen(records)

    return changed_count


def init_basisproducten_file() -> Path:
    """Maakt het JSON-bestand voor basisproducten aan."""
    return _ensure_json_file(BASISPRODUCTEN_FILE, "[]")


def _fallback_producten_year() -> int:
    """Bepaalt het bronjaar voor legacy productdata."""
    years = get_productie_years()
    if years:
        return min(int(year) for year in years)
    return 2025


def _normalize_basisproduct_onderdeel_row(row: dict[str, Any]) -> dict[str, Any]:
    onderdeel_id = str(row.get("verpakkingsonderdeel_id", "") or "")
    gekoppeld_onderdeel = get_verpakkingsonderdeel_by_id(onderdeel_id)
    component_key = str(
        row.get("verpakkingsonderdeel_key")
        or row.get("component_key")
        or (gekoppeld_onderdeel or {}).get("component_key")
        or onderdeel_id
    )
    prijs_per_stuk = float(row.get("prijs_per_stuk", 0.0) or 0.0)
    hoeveelheid = float(row.get("hoeveelheid", 0.0) or 0.0)
    totale_kosten = float(
        row.get("totale_kosten", bereken_basisproduct_regel_kosten(hoeveelheid, prijs_per_stuk))
        or 0.0
    )

    return {
        "verpakkingsonderdeel_id": onderdeel_id,
        "verpakkingsonderdeel_key": component_key,
        "omschrijving": str(row.get("omschrijving", "") or ""),
        "hoeveelheid": hoeveelheid,
        "prijs_per_stuk": prijs_per_stuk,
        "totale_kosten": totale_kosten,
    }


def normalize_basisproduct_record(record: dict[str, Any]) -> dict[str, Any]:
    onderdelen = [
        _normalize_basisproduct_onderdeel_row(row)
        for row in record.get("onderdelen", [])
        if isinstance(row, dict)
    ]
    jaar = int(record.get("jaar", 0) or 0) or _fallback_producten_year()
    return {
        "id": str(record.get("id", "") or uuid4()),
        "jaar": jaar,
        "omschrijving": str(record.get("omschrijving", "") or ""),
        "inhoud_per_eenheid_liter": float(record.get("inhoud_per_eenheid_liter", 0.0) or 0.0),
        "onderdelen": onderdelen,
        "totale_verpakkingskosten": bereken_basisproduct_totaal(onderdelen),
    }


def load_basisproducten(year: int | str | None = None) -> list[dict[str, Any]]:
    """Laadt alle basisproducten veilig in."""
    data = _load_json_value(BASISPRODUCTEN_FILE, [])
    if not isinstance(data, list):
        return []

    normalized = [
        normalize_basisproduct_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    if normalized != data:
        _save_json_value(BASISPRODUCTEN_FILE, normalized, "[]")
    if year is None:
        return normalized
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return []
    return [
        record
        for record in normalized
        if int(record.get("jaar", 0) or 0) == year_value
    ]


def save_basisproducten(data: list[dict[str, Any]]) -> bool:
    """Slaat alle basisproducten veilig op."""
    normalized = [
        normalize_basisproduct_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    return _save_json_value(BASISPRODUCTEN_FILE, normalized, "[]")


def bereken_basisproduct_totaal(onderdelen: list[dict[str, Any]]) -> float:
    """Berekent het totaal van alle gekoppelde verpakkingsonderdelen."""
    totaal = 0.0

    for onderdeel in onderdelen:
        try:
            totaal += float(onderdeel.get("totale_kosten", 0.0) or 0.0)
        except (TypeError, ValueError):
            continue

    return totaal


def bereken_basisproduct_regel_kosten(
    hoeveelheid: float | int | None,
    prijs_per_stuk: float | int | None,
) -> float:
    """Berekent de totale kosten van een gekoppelde onderdeelregel."""
    try:
        hoeveelheid_value = float(hoeveelheid or 0.0)
        prijs_value = float(prijs_per_stuk or 0.0)
    except (TypeError, ValueError):
        return 0.0

    if hoeveelheid_value <= 0 or prijs_value < 0:
        return 0.0

    return hoeveelheid_value * prijs_value


def get_basisproduct_by_id(
    basisproduct_id: str,
    year: int | str | None = None,
) -> dict[str, Any] | None:
    """Haalt een basisproduct op op basis van id, optioneel herleid naar jaar."""
    for basisproduct in load_basisproducten(year):
        if str(basisproduct.get("id")) == basisproduct_id:
            return basisproduct

    return None


def get_beschikbare_basisproducten(
    geselecteerde_basisproduct_ids: set[str] | list[str] | tuple[str, ...],
    current_basisproduct_id: str = "",
    year: int | str | None = None,
) -> list[dict[str, Any]]:
    """Geeft basisproducten terug exclusief al gekozen items, behalve de huidige regel."""
    uitgesloten_ids = {str(basisproduct_id) for basisproduct_id in geselecteerde_basisproduct_ids}
    beschikbare_basisproducten: list[dict[str, Any]] = []

    for basisproduct in load_basisproducten(year):
        basisproduct_id = str(basisproduct.get("id", ""))
        if basisproduct_id == current_basisproduct_id or basisproduct_id not in uitgesloten_ids:
            beschikbare_basisproducten.append(basisproduct)

    return beschikbare_basisproducten


def add_basisproduct(
    omschrijving: str,
    inhoud_per_eenheid_liter: float,
    onderdelen: list[dict[str, Any]],
    *,
    year: int | str | None = None,
) -> dict[str, Any] | None:
    """Voegt een nieuw basisproduct toe."""
    basisproducten = load_basisproducten()
    target_year = int(year) if year is not None else _fallback_producten_year()
    basisproduct = normalize_basisproduct_record(
        {
            "id": str(uuid4()),
            "jaar": target_year,
            "omschrijving": omschrijving,
            "inhoud_per_eenheid_liter": float(inhoud_per_eenheid_liter),
            "onderdelen": onderdelen,
        }
    )
    basisproducten.append(basisproduct)

    if save_basisproducten(basisproducten):
        return basisproduct

    return None


def update_basisproduct(
    basisproduct_id: str,
    omschrijving: str,
    inhoud_per_eenheid_liter: float,
    onderdelen: list[dict[str, Any]],
    *,
    year: int | str | None = None,
) -> bool:
    """Werkt een bestaand basisproduct bij."""
    basisproducten = load_basisproducten()
    year_value = int(year) if year is not None else None

    for index, basisproduct in enumerate(basisproducten):
        if str(basisproduct.get("id")) != basisproduct_id:
            continue
        if year_value is not None and int(basisproduct.get("jaar", 0) or 0) != year_value:
            continue

        basisproducten[index] = normalize_basisproduct_record(
            {
                "id": basisproduct_id,
                "jaar": int(basisproduct.get("jaar", 0) or 0) or year_value or _fallback_producten_year(),
                "omschrijving": omschrijving,
                "inhoud_per_eenheid_liter": float(inhoud_per_eenheid_liter),
                "onderdelen": onderdelen,
            }
        )
        return save_basisproducten(basisproducten)

    return False


def delete_basisproduct(basisproduct_id: str, *, year: int | str | None = None) -> bool:
    """Verwijdert een basisproduct op basis van id."""
    basisproducten = load_basisproducten()
    year_value = int(year) if year is not None else None
    filtered = [
        basisproduct
        for basisproduct in basisproducten
        if not (
            str(basisproduct.get("id")) == basisproduct_id
            and (year_value is None or int(basisproduct.get("jaar", 0) or 0) == year_value)
        )
    ]

    if len(filtered) == len(basisproducten):
        return False

    return save_basisproducten(filtered)


def init_samengestelde_producten_file() -> Path:
    """Maakt het JSON-bestand voor samengestelde producten aan."""
    return _ensure_json_file(SAMENGESTELDE_PRODUCTEN_FILE, "[]")


def _normalize_samengesteld_basisproduct_row(row: dict[str, Any]) -> dict[str, Any]:
    basisproduct_id = str(row.get("basisproduct_id", "") or "")
    aantal = float(row.get("aantal", 0.0) or 0.0)
    return {
        "basisproduct_id": basisproduct_id,
        "omschrijving": str(row.get("omschrijving", "") or ""),
        "aantal": aantal,
        "inhoud_per_eenheid_liter": float(row.get("inhoud_per_eenheid_liter", 0.0) or 0.0),
        "totale_inhoud_liter": float(row.get("totale_inhoud_liter", 0.0) or 0.0),
        "verpakkingskosten_per_eenheid": float(
            row.get("verpakkingskosten_per_eenheid", 0.0) or 0.0
        ),
        "totale_verpakkingskosten": float(
            row.get("totale_verpakkingskosten", 0.0) or 0.0
        ),
}


def _is_samengesteld_verpakkingsonderdeel_ref(item_id: str) -> bool:
    return str(item_id or "").startswith(SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX)


def _resolve_samengesteld_bouwblok_for_year(
    item_id: str,
    year: int | str,
    *,
    basisproducten_lookup: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    item_id = str(item_id or "")
    if _is_samengesteld_verpakkingsonderdeel_ref(item_id):
        onderdeel_id = item_id.removeprefix(SAMENGESTELD_VERPAKKINGSONDERDEEL_PREFIX)
        onderdeel = get_verpakkingsonderdeel_by_id(onderdeel_id, year)
        if not onderdeel:
            return None
        hoeveelheid = float(onderdeel.get("hoeveelheid", 0.0) or 0.0)
        prijs_per_stuk = float(onderdeel.get("prijs_per_stuk", 0.0) or 0.0)
        return {
            "id": item_id,
            "omschrijving": str(onderdeel.get("omschrijving", "") or ""),
            "inhoud_per_eenheid_liter": 0.0,
            "totale_verpakkingskosten": bereken_basisproduct_regel_kosten(
                hoeveelheid,
                prijs_per_stuk,
            ),
        }

    if basisproducten_lookup is not None and item_id in basisproducten_lookup:
        return basisproducten_lookup[item_id]
    base = get_basisproduct_by_id(item_id, year)
    return resolve_basisproduct_for_year(base, year) if base else None


def normalize_samengesteld_product_record(record: dict[str, Any]) -> dict[str, Any]:
    basisproducten = [
        _normalize_samengesteld_basisproduct_row(row)
        for row in record.get("basisproducten", [])
        if isinstance(row, dict)
    ]
    jaar = int(record.get("jaar", 0) or 0) or _fallback_producten_year()
    return {
        "id": str(record.get("id", "") or uuid4()),
        "jaar": jaar,
        "omschrijving": str(record.get("omschrijving", "") or ""),
        "basisproducten": basisproducten,
        "totale_inhoud_liter": bereken_samengesteld_product_totaal_inhoud(basisproducten),
        "totale_verpakkingskosten": bereken_samengesteld_product_totaal_verpakkingskosten(
            basisproducten
        ),
    }


def load_samengestelde_producten(year: int | str | None = None) -> list[dict[str, Any]]:
    """Laadt alle samengestelde producten veilig in."""
    data = _load_json_value(SAMENGESTELDE_PRODUCTEN_FILE, [])
    if not isinstance(data, list):
        return []

    normalized = [
        normalize_samengesteld_product_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    if normalized != data:
        _save_json_value(SAMENGESTELDE_PRODUCTEN_FILE, normalized, "[]")
    if year is None:
        return normalized
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return []
    return [
        record
        for record in normalized
        if int(record.get("jaar", 0) or 0) == year_value
    ]


def save_samengestelde_producten(data: list[dict[str, Any]]) -> bool:
    """Slaat alle samengestelde producten veilig op."""
    normalized = [
        normalize_samengesteld_product_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    return _save_json_value(SAMENGESTELDE_PRODUCTEN_FILE, normalized, "[]")


def bereken_samengesteld_product_totaal_inhoud(
    basisproducten: list[dict[str, Any]],
) -> float:
    """Berekent de totale inhoud van alle gekoppelde basisproducten."""
    totaal = 0.0

    for basisproduct in basisproducten:
        try:
            totaal += float(basisproduct.get("totale_inhoud_liter", 0.0) or 0.0)
        except (TypeError, ValueError):
            continue

    return totaal


def bereken_samengesteld_product_totaal_verpakkingskosten(
    basisproducten: list[dict[str, Any]],
) -> float:
    """Berekent de totale verpakkingskosten van alle gekoppelde basisproducten."""
    totaal = 0.0

    for basisproduct in basisproducten:
        try:
            totaal += float(
                basisproduct.get("totale_verpakkingskosten", 0.0) or 0.0
            )
        except (TypeError, ValueError):
            continue

    return totaal


def resolve_basisproduct_for_year(
    basisproduct: dict[str, Any],
    year: int | str,
) -> dict[str, Any]:
    """Bouwt een jaarafhankelijke weergave van een basisproduct op."""
    normalized = normalize_basisproduct_record(basisproduct)
    resolved_rows: list[dict[str, Any]] = []

    for row in normalized.get("onderdelen", []):
        component_key = str(
            row.get("verpakkingsonderdeel_key")
            or row.get("component_key")
            or row.get("verpakkingsonderdeel_id")
            or ""
        )
        onderdeel = (
            get_verpakkingsonderdeel_by_component_key(
                component_key,
                year,
                fallback_to_latest=False,
            )
            if component_key
            else None
        )
        if onderdeel is None:
            onderdeel = get_verpakkingsonderdeel_by_id(
                str(row.get("verpakkingsonderdeel_id", "") or ""),
                year,
            )

        hoeveelheid = float(row.get("hoeveelheid", 0.0) or 0.0)
        prijs_per_stuk = float((onderdeel or {}).get("prijs_per_stuk", 0.0) or 0.0)
        resolved_rows.append(
            {
                "verpakkingsonderdeel_id": str((onderdeel or {}).get("id", "") or ""),
                "verpakkingsonderdeel_key": component_key,
                "omschrijving": str(
                    (onderdeel or {}).get("omschrijving", row.get("omschrijving", "")) or ""
                ),
                "jaar": int((onderdeel or {}).get("jaar", 0) or 0),
                "hoeveelheid": hoeveelheid,
                "prijs_per_stuk": prijs_per_stuk,
                "totale_kosten": bereken_basisproduct_regel_kosten(hoeveelheid, prijs_per_stuk),
            }
        )

    resolved = {
        **normalized,
        "jaar": int(year),
        "onderdelen": resolved_rows,
        "totale_verpakkingskosten": bereken_basisproduct_totaal(resolved_rows),
    }
    return resolved


def load_basisproducten_for_year(year: int | str) -> list[dict[str, Any]]:
    """Laadt alle basisproducten met jaarafhankelijke verpakkingskosten."""
    return [
        resolve_basisproduct_for_year(basisproduct, year)
        for basisproduct in load_basisproducten(year)
    ]


def resolve_samengesteld_product_for_year(
    samengesteld_product: dict[str, Any],
    year: int | str,
    *,
    basisproducten_lookup: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Bouwt een jaarafhankelijke weergave van een samengesteld product op."""
    normalized = normalize_samengesteld_product_record(samengesteld_product)
    if basisproducten_lookup is None:
        basisproducten_lookup = {
            str(item.get("id", "") or ""): item
            for item in load_basisproducten_for_year(year)
        }

    resolved_rows: list[dict[str, Any]] = []
    for row in normalized.get("basisproducten", []):
        basisproduct_id = str(row.get("basisproduct_id", "") or "")
        basisproduct = _resolve_samengesteld_bouwblok_for_year(
            basisproduct_id,
            year,
            basisproducten_lookup=basisproducten_lookup,
        )

        aantal = float(row.get("aantal", 0.0) or 0.0)
        inhoud_per_eenheid = float(
            (basisproduct or {}).get("inhoud_per_eenheid_liter", 0.0) or 0.0
        )
        verpakkingskosten_per_eenheid = float(
            (basisproduct or {}).get("totale_verpakkingskosten", 0.0) or 0.0
        )
        resolved_rows.append(
            {
                "basisproduct_id": basisproduct_id,
                "omschrijving": str(
                    (basisproduct or {}).get("omschrijving", row.get("omschrijving", "")) or ""
                ),
                "aantal": aantal,
                "inhoud_per_eenheid_liter": inhoud_per_eenheid,
                "totale_inhoud_liter": aantal * inhoud_per_eenheid,
                "verpakkingskosten_per_eenheid": verpakkingskosten_per_eenheid,
                "totale_verpakkingskosten": bereken_basisproduct_regel_kosten(
                    aantal,
                    verpakkingskosten_per_eenheid,
                ),
            }
        )

    return {
        **normalized,
        "jaar": int(year),
        "basisproducten": resolved_rows,
        "totale_inhoud_liter": bereken_samengesteld_product_totaal_inhoud(resolved_rows),
        "totale_verpakkingskosten": bereken_samengesteld_product_totaal_verpakkingskosten(
            resolved_rows
        ),
    }


def load_samengestelde_producten_for_year(year: int | str) -> list[dict[str, Any]]:
    """Laadt alle samengestelde producten met jaarafhankelijke verpakkingskosten."""
    basisproducten_lookup = {
        str(item.get("id", "") or ""): item
        for item in load_basisproducten_for_year(year)
    }
    return [
        resolve_samengesteld_product_for_year(
            samengesteld_product,
            year,
            basisproducten_lookup=basisproducten_lookup,
        )
        for samengesteld_product in load_samengestelde_producten(year)
    ]


def bereken_basisproduct_kostprijs(
    basisproduct: dict[str, Any],
    variabele_kosten_per_liter: float | int | None,
    year: int | str | None = None,
) -> dict[str, float]:
    """Berekent kostprijsregels voor een basisproduct."""
    source_product = (
        resolve_basisproduct_for_year(basisproduct, year)
        if year is not None
        else normalize_basisproduct_record(basisproduct)
    )
    inhoud_liter = max(
        float(source_product.get("inhoud_per_eenheid_liter", 0.0) or 0.0),
        0.0,
    )
    verpakkingskosten = max(
        float(source_product.get("totale_verpakkingskosten", 0.0) or 0.0),
        0.0,
    )
    variabele_kosten = max(float(variabele_kosten_per_liter or 0.0), 0.0)
    vloeistofkosten = variabele_kosten * inhoud_liter

    return {
        "inhoud_liter": inhoud_liter,
        "variabele_kosten_vloeistof": vloeistofkosten,
        "verpakkingskosten": verpakkingskosten,
        "totale_kostprijs": vloeistofkosten + verpakkingskosten,
    }


def bereken_samengesteld_product_kostprijs(
    samengesteld_product: dict[str, Any],
    variabele_kosten_per_liter: float | int | None,
    year: int | str | None = None,
) -> dict[str, float]:
    """Berekent kostprijsregels voor een samengesteld product."""
    source_product = (
        resolve_samengesteld_product_for_year(samengesteld_product, year)
        if year is not None
        else normalize_samengesteld_product_record(samengesteld_product)
    )
    inhoud_liter = max(
        float(source_product.get("totale_inhoud_liter", 0.0) or 0.0),
        0.0,
    )
    verpakkingskosten = max(
        float(source_product.get("totale_verpakkingskosten", 0.0) or 0.0),
        0.0,
    )
    variabele_kosten = max(float(variabele_kosten_per_liter or 0.0), 0.0)
    vloeistofkosten = variabele_kosten * inhoud_liter

    return {
        "inhoud_liter": inhoud_liter,
        "variabele_kosten_vloeistof": vloeistofkosten,
        "verpakkingskosten": verpakkingskosten,
        "totale_kostprijs": vloeistofkosten + verpakkingskosten,
    }


def get_samengesteld_product_by_id(
    samengesteld_product_id: str,
    year: int | str | None = None,
) -> dict[str, Any] | None:
    """Haalt een samengesteld product op op basis van id."""
    for samengesteld_product in load_samengestelde_producten(year):
        if str(samengesteld_product.get("id")) == samengesteld_product_id:
            return samengesteld_product

    return None


def add_samengesteld_product(
    omschrijving: str,
    basisproducten: list[dict[str, Any]],
    *,
    year: int | str | None = None,
) -> dict[str, Any] | None:
    """Voegt een nieuw samengesteld product toe."""
    samengestelde_producten = load_samengestelde_producten()
    target_year = int(year) if year is not None else _fallback_producten_year()
    samengesteld_product = normalize_samengesteld_product_record(
        {
            "id": str(uuid4()),
            "jaar": target_year,
            "omschrijving": omschrijving,
            "basisproducten": basisproducten,
        }
    )
    samengestelde_producten.append(samengesteld_product)

    if save_samengestelde_producten(samengestelde_producten):
        return samengesteld_product

    return None


def update_samengesteld_product(
    samengesteld_product_id: str,
    omschrijving: str,
    basisproducten: list[dict[str, Any]],
    *,
    year: int | str | None = None,
) -> bool:
    """Werkt een bestaand samengesteld product bij."""
    samengestelde_producten = load_samengestelde_producten()
    year_value = int(year) if year is not None else None

    for index, samengesteld_product in enumerate(samengestelde_producten):
        if str(samengesteld_product.get("id")) != samengesteld_product_id:
            continue
        if year_value is not None and int(samengesteld_product.get("jaar", 0) or 0) != year_value:
            continue

        samengestelde_producten[index] = normalize_samengesteld_product_record(
            {
                "id": samengesteld_product_id,
                "jaar": int(samengesteld_product.get("jaar", 0) or 0) or year_value or _fallback_producten_year(),
                "omschrijving": omschrijving,
                "basisproducten": basisproducten,
            }
        )
        return save_samengestelde_producten(samengestelde_producten)

    return False


def delete_samengesteld_product(
    samengesteld_product_id: str,
    *,
    year: int | str | None = None,
) -> bool:
    """Verwijdert een samengesteld product op basis van id."""
    samengestelde_producten = load_samengestelde_producten()
    year_value = int(year) if year is not None else None
    filtered = [
        samengesteld_product
        for samengesteld_product in samengestelde_producten
        if not (
            str(samengesteld_product.get("id")) == samengesteld_product_id
            and (
                year_value is None
                or int(samengesteld_product.get("jaar", 0) or 0) == year_value
            )
        )
    ]

    if len(filtered) == len(samengestelde_producten):
        return False

    return save_samengestelde_producten(filtered)


def load_json_data() -> dict[str, Any]:
    """Laadt productiegegevens veilig in."""
    return _load_json_value(PRODUCTIE_FILE, {})


def save_json_data(data: dict[str, Any]) -> bool:
    """Slaat productiegegevens veilig op."""
    return _save_json_value(PRODUCTIE_FILE, data, "{}")


def load_productiegegevens() -> dict[str, Any]:
    """Laadt productiegegevens via een expliciete helpernaam."""
    return load_json_data()


def save_productiegegevens(data: dict[str, Any]) -> bool:
    """Slaat productiegegevens op via een expliciete helpernaam."""
    return save_json_data(data)


def get_productie_record(year: int | str) -> dict[str, Any] | None:
    """Haalt het productie-record voor een specifiek jaar op."""
    data = load_json_data()
    record = data.get(str(year))
    return record if isinstance(record, dict) else None


def get_productiegegeven_by_year(year: int | str) -> dict[str, Any] | None:
    """Haalt productiegegevens op voor een specifiek jaar."""
    return get_productie_record(year)


def upsert_productie_record(year: int | str, record: dict[str, Any]) -> bool:
    """Voegt een productie-record toe of werkt het bij."""
    data = load_json_data()
    data[str(year)] = record
    return save_json_data(data)


def upsert_productiegegeven(year: int | str, record: dict[str, Any]) -> bool:
    """Voegt productiegegevens toe of werkt ze bij voor een jaar."""
    return upsert_productie_record(year, record)


def delete_productie_record(year: int | str) -> bool:
    """Verwijdert het productie-record van een specifiek jaar."""
    data = load_json_data()
    year_key = str(year)

    if year_key not in data:
        return False

    del data[year_key]
    return save_json_data(data)


def delete_productiegegeven(year: int | str) -> bool:
    """Verwijdert productiegegevens voor een specifiek jaar."""
    return delete_productie_record(year)


def get_productie_years() -> list[int]:
    """Geeft alle beschikbare productie-jaren gesorteerd terug."""
    data = load_json_data()
    years: list[int] = []

    for year in data.keys():
        if year.isdigit():
            years.append(int(year))

    return sorted(years)


def duplicate_productie_to_year(
    source_year: int | str,
    target_year: int | str,
    *,
    overwrite: bool = False,
) -> bool:
    """Dupliceert productiegegevens van bronjaar naar doeljaar."""
    source_record = get_productie_record(source_year)
    if not source_record:
        return False
    if get_productie_record(target_year) is not None and not overwrite:
        return False
    return upsert_productie_record(target_year, deepcopy(source_record))


def is_productiejaar_in_gebruik_bij_vaste_kosten(year: int | str) -> bool:
    """Controleert of een productiejaar al voorkomt in de opslag van vaste kosten."""
    return str(year) in load_vaste_kosten_data()


def get_batchgrootte_eigen_productie_l(year: int | str) -> float | None:
    """Haalt de batchgrootte eigen productie voor een jaar op."""
    record = get_productie_record(year) or {}
    value = record.get("batchgrootte_eigen_productie_l")

    try:
        batchgrootte = float(value)
    except (TypeError, ValueError):
        return None

    return batchgrootte if batchgrootte > 0 else None


def load_vaste_kosten_data() -> dict[str, Any]:
    """Laadt alle opgeslagen vaste kosten veilig in."""
    return _load_json_value(VASTE_KOSTEN_FILE, {})


def save_vaste_kosten_data(data: dict[str, Any]) -> bool:
    """Slaat alle vaste kosten veilig op."""
    return _save_json_value(VASTE_KOSTEN_FILE, data, "{}")


def get_vaste_kosten_record(year: int | str) -> list[dict[str, Any]]:
    """Haalt alle vaste kostenregels voor een specifiek jaar op."""
    data = load_vaste_kosten_data()
    record = data.get(str(year), [])
    return record if isinstance(record, list) else []


def get_vaste_kosten_row_by_id(
    year: int | str,
    row_id: str,
) -> dict[str, Any] | None:
    """Haalt een specifieke vaste-kostenregel op voor een jaar."""
    for record in get_vaste_kosten_record(year):
        if str(record.get("id", "")) == row_id:
            return record

    return None


def upsert_vaste_kosten_record(
    year: int | str,
    records: list[dict[str, Any]],
) -> bool:
    """Vervangt of maakt alle vaste kostenregels voor een jaar aan."""
    data = load_vaste_kosten_data()
    data[str(year)] = records
    return save_vaste_kosten_data(data)


def upsert_vaste_kosten_row(
    year: int | str,
    record: dict[str, Any],
) -> bool:
    """Voegt een vaste-kostenregel toe of werkt deze bij binnen een jaar."""
    records = get_vaste_kosten_record(year)
    row_id = str(record.get("id", ""))
    updated = False

    for index, existing_record in enumerate(records):
        if str(existing_record.get("id", "")) != row_id:
            continue
        records[index] = record
        updated = True
        break

    if not updated:
        records.append(record)

    return upsert_vaste_kosten_record(year, records)


def delete_vaste_kosten_record(year: int | str) -> bool:
    """Verwijdert alle vaste kosten voor een specifiek jaar."""
    data = load_vaste_kosten_data()
    year_key = str(year)

    if year_key not in data:
        return False

    del data[year_key]
    return save_vaste_kosten_data(data)


def delete_vaste_kosten_row(year: int | str, row_id: str) -> bool:
    """Verwijdert een specifieke vaste-kostenregel binnen een jaar."""
    records = get_vaste_kosten_record(year)
    filtered_records = [
        record for record in records if str(record.get("id", "")) != row_id
    ]

    if len(filtered_records) == len(records):
        return False

    return upsert_vaste_kosten_record(year, filtered_records)


def calculate_total_vaste_kosten(records: list[dict[str, Any]]) -> float:
    """Berekent het totaalbedrag van alle vaste kostenregels."""
    return float(
        sum(float(record.get("bedrag_per_jaar", 0.0) or 0.0) for record in records)
    )


def calculate_vaste_kosten_per_liter(
    totale_vaste_kosten: float,
    productie_liters: float | int | None,
) -> float | None:
    """Berekent vaste kosten per geproduceerde liter."""
    if productie_liters is None or float(productie_liters) <= 0:
        return None

    return float(totale_vaste_kosten) / float(productie_liters)


def calculate_vaste_kosten_per_ingekochte_liter(
    totale_vaste_kosten: float,
    inkoop_liters: float | int | None,
) -> float | None:
    """Berekent vaste kosten per ingekochte liter."""
    if inkoop_liters is None or float(inkoop_liters) <= 0:
        return None

    return float(totale_vaste_kosten) / float(inkoop_liters)


def calculate_vaste_kosten_per_totale_liter(
    totale_vaste_kosten: float,
    productie_liters: float | int | None,
    inkoop_liters: float | int | None,
) -> float | None:
    """Berekent vaste kosten per totale liter."""
    productie_value = float(productie_liters or 0.0)
    inkoop_value = float(inkoop_liters or 0.0)
    totale_liters = productie_value + inkoop_value

    if totale_liters <= 0:
        return None

    return float(totale_vaste_kosten) / totale_liters


def get_productiegegevens_for_year(year: int | str) -> dict[str, Any]:
    """Geeft productiegegevens voor een jaar terug met veilige standaardwaarden."""
    record = get_productie_record(year) or {}
    return record if isinstance(record, dict) else {}


def get_vaste_kosten_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft vaste kostenregels voor een jaar terug."""
    return get_vaste_kosten_record(year)


def duplicate_vaste_kosten_to_year(
    source_year: int | str,
    target_year: int | str,
    *,
    overwrite: bool = False,
) -> int:
    """Dupliceert vaste kosten van bronjaar naar doeljaar."""
    data = load_vaste_kosten_data()
    source_rows = data.get(str(source_year), [])
    if not isinstance(source_rows, list) or not source_rows:
        return 0
    if str(target_year) in data and not overwrite:
        return 0
    data[str(target_year)] = deepcopy(source_rows)
    if save_vaste_kosten_data(data):
        return len(source_rows)
    return 0


def get_directe_vaste_kosten_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft alleen directe vaste kostenregels voor een jaar terug."""
    directe_kosten: list[dict[str, Any]] = []

    for record in get_vaste_kosten_for_year(year):
        kostensoort = str(
            record.get("kostensoort", record.get("type_kosten", "")) or ""
        ).strip().lower()
        if kostensoort not in {"direct", "directe kosten"}:
            continue
        directe_kosten.append(record)

    return directe_kosten


def get_vaste_kosten_per_liter_for_year(year: int | str) -> float | None:
    """Berekent vaste kosten per totale liter voor een geselecteerd jaar."""
    productiegegevens = get_productiegegevens_for_year(year)
    totale_vaste_kosten = calculate_total_vaste_kosten(get_vaste_kosten_for_year(year))

    return calculate_vaste_kosten_per_totale_liter(
        totale_vaste_kosten=totale_vaste_kosten,
        productie_liters=productiegegevens.get("hoeveelheid_productie_l"),
        inkoop_liters=productiegegevens.get("hoeveelheid_inkoop_l"),
    )


def bereken_directe_vaste_kosten_per_liter(year: int | str) -> float | None:
    """Berekent directe vaste kosten per productieliter."""
    productiegegevens = get_productiegegevens_for_year(year)
    productie_liters = productiegegevens.get("hoeveelheid_productie_l")

    if productie_liters is None or float(productie_liters) <= 0:
        return None

    totale_directe_vaste_kosten = calculate_total_vaste_kosten(
        get_directe_vaste_kosten_for_year(year)
    )
    return float(totale_directe_vaste_kosten) / float(productie_liters)


def bereken_integrale_kostprijs_basisproduct(
    basisproduct: dict[str, Any],
    variabele_kosten_per_liter: float | int | None,
    vaste_kosten_per_liter: float | int | None,
) -> dict[str, float]:
    """Berekent integrale kostprijsregels voor een basisproduct."""
    kostprijs = bereken_basisproduct_kostprijs(
        basisproduct=basisproduct,
        variabele_kosten_per_liter=variabele_kosten_per_liter,
    )
    vaste_kosten = max(float(vaste_kosten_per_liter or 0.0), 0.0) * float(
        kostprijs["inhoud_liter"]
    )
    return {
        **kostprijs,
        "vaste_kosten": vaste_kosten,
        "integrale_kostprijs": float(kostprijs["totale_kostprijs"]) + vaste_kosten,
    }


def bereken_integrale_kostprijs_samengesteld_product(
    samengesteld_product: dict[str, Any],
    variabele_kosten_per_liter: float | int | None,
    vaste_kosten_per_liter: float | int | None,
) -> dict[str, float]:
    """Berekent integrale kostprijsregels voor een samengesteld product."""
    kostprijs = bereken_samengesteld_product_kostprijs(
        samengesteld_product=samengesteld_product,
        variabele_kosten_per_liter=variabele_kosten_per_liter,
    )
    vaste_kosten = max(float(vaste_kosten_per_liter or 0.0), 0.0) * float(
        kostprijs["inhoud_liter"]
    )
    return {
        **kostprijs,
        "vaste_kosten": vaste_kosten,
        "integrale_kostprijs": float(kostprijs["totale_kostprijs"]) + vaste_kosten,
    }


def load_bieren() -> list[dict[str, Any]]:
    """Laadt alle bieren uit de centrale bierlijst."""
    data = _load_json_value(BIEREN_FILE, [])
    if not isinstance(data, list):
        return []

    normalized_bieren: list[dict[str, Any]] = []
    for bier in data:
        if not isinstance(bier, dict):
            continue
        normalized_bieren.append(normalize_bier_record(bier))

    return normalized_bieren


def get_bieren_met_berekening_voor_jaar(year: int | str) -> list[dict[str, Any]]:
    """Geeft alleen bieren terug waarvoor variabele-kostenregels bestaan in een jaar."""
    try:
        year_key = str(int(year))
    except (TypeError, ValueError):
        return []

    data = load_variabele_kosten_data()
    bier_records = data.get(year_key, {})
    if not isinstance(bier_records, dict):
        return []

    bier_ids_met_data = {
        str(bier_id)
        for bier_id, records in bier_records.items()
        if isinstance(records, list) and len(records) > 0
    }
    if not bier_ids_met_data:
        return []

    return [
        bier
        for bier in load_bieren()
        if str(bier.get("id", "")) in bier_ids_met_data
    ]


def save_bieren(data: list[dict[str, Any]]) -> bool:
    """Slaat de centrale bierlijst veilig op."""
    return _save_json_value(BIEREN_FILE, data, "[]")


def _collect_referenced_bier_ids() -> set[str]:
    """Verzamelt alle bier-id's die nog ergens functioneel worden gebruikt."""
    referenced_ids: set[str] = set()

    for record in load_berekeningen():
        bier_id = str(record.get("bier_id", "") or "").strip()
        if bier_id:
            referenced_ids.add(bier_id)

    for voorstel in load_prijsvoorstellen():
        bier_key = str(voorstel.get("bier_key", "") or "").strip()
        if bier_key:
            referenced_ids.add(bier_key)

        beer_rows = voorstel.get("beer_rows", [])
        if isinstance(beer_rows, list):
            for row in beer_rows:
                if not isinstance(row, dict):
                    continue
                bier_row_key = str(row.get("bier_key", "") or "").strip()
                if bier_row_key:
                    referenced_ids.add(bier_row_key)

    for record in load_verkoopprijzen():
        bier_key = str(record.get("bier_key", "") or "").strip()
        if bier_key:
            referenced_ids.add(bier_key)

    for record in _load_verkoopprijs_records():
        if not isinstance(record, dict):
            continue
        bier_key = str(record.get("bier_key", "") or "").strip()
        if bier_key:
            referenced_ids.add(bier_key)

    variabele_kosten_data = load_variabele_kosten_data()
    for year_records in variabele_kosten_data.values():
        if not isinstance(year_records, dict):
            continue
        for bier_id in year_records.keys():
            bier_id_value = str(bier_id or "").strip()
            if bier_id_value:
                referenced_ids.add(bier_id_value)

    return referenced_ids


def cleanup_unused_bieren() -> bool:
    """Verwijdert bierrecords die nergens meer door de app worden gebruikt."""
    bieren = load_bieren()
    referenced_ids = _collect_referenced_bier_ids()
    filtered = [
        bier
        for bier in bieren
        if str(bier.get("id", "") or "").strip() in referenced_ids
    ]
    if len(filtered) == len(bieren):
        return True
    return save_bieren(filtered)


def get_bier_usage_locations(
    bier_id: str,
    *,
    exclude_berekening_id: str = "",
) -> list[str]:
    """Geeft een compacte lijst terug van plekken waar een bier-id nog wordt gebruikt."""
    bier_key = str(bier_id or "").strip()
    if not bier_key:
        return []

    locations: list[str] = []

    overige_berekeningen = [
        record
        for record in load_berekeningen()
        if str(record.get("bier_id", "") or "").strip() == bier_key
        and str(record.get("id", "") or "").strip() != str(exclude_berekening_id or "").strip()
    ]
    if overige_berekeningen:
        label = "berekening" if len(overige_berekeningen) == 1 else "berekeningen"
        locations.append(f"{len(overige_berekeningen)} {label}")

    prijsvoorstellen = [
        record
        for record in load_prijsvoorstellen()
        if (
            str(record.get("bier_key", "") or "").strip() == bier_key
            or any(
                isinstance(row, dict)
                and str(row.get("bier_key", "") or "").strip() == bier_key
                for row in (record.get("beer_rows", []) if isinstance(record.get("beer_rows", []), list) else [])
            )
        )
    ]
    if prijsvoorstellen:
        label = "prijsvoorstel" if len(prijsvoorstellen) == 1 else "prijsvoorstellen"
        locations.append(f"{len(prijsvoorstellen)} {label}")

    verkoopprijzen = [
        record
        for record in load_verkoopprijzen()
        if str(record.get("bier_key", "") or "").strip() == bier_key
    ]
    if verkoopprijzen:
        label = "verkoopprijs" if len(verkoopprijzen) == 1 else "verkoopprijzen"
        locations.append(f"{len(verkoopprijzen)} {label}")

    productstrategieen = [
        record
        for record in _load_verkoopprijs_records()
        if isinstance(record, dict)
        and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT
        and str(record.get("bier_key", "") or "").strip() == bier_key
    ]
    if productstrategieen:
        label = "productstrategie" if len(productstrategieen) == 1 else "productstrategieën"
        locations.append(f"{len(productstrategieen)} {label}")

    variabele_kosten_jaren = [
        year_key
        for year_key, year_records in load_variabele_kosten_data().items()
        if isinstance(year_records, dict) and bier_key in year_records
    ]
    if variabele_kosten_jaren:
        label = "jaar variabele kosten" if len(variabele_kosten_jaren) == 1 else "jaren variabele kosten"
        locations.append(f"{len(variabele_kosten_jaren)} {label}")

    return locations


def delete_bier_usage_everywhere(
    bier_id: str,
    *,
    exclude_berekening_id: str = "",
) -> bool:
    """Verwijdert alle afgeleide records die nog naar een bier-id verwijzen."""
    bier_key = str(bier_id or "").strip()
    if not bier_key:
        return cleanup_unused_bieren()

    berekeningen = [
        record
        for record in load_berekeningen()
        if not (
            str(record.get("bier_id", "") or "").strip() == bier_key
            and str(record.get("id", "") or "").strip() != str(exclude_berekening_id or "").strip()
        )
    ]
    if not save_berekeningen(berekeningen):
        return False

    prijsvoorstellen = [
        record
        for record in load_prijsvoorstellen()
        if not (
            str(record.get("bier_key", "") or "").strip() == bier_key
            or any(
                isinstance(row, dict)
                and str(row.get("bier_key", "") or "").strip() == bier_key
                for row in (record.get("beer_rows", []) if isinstance(record.get("beer_rows", []), list) else [])
            )
        )
    ]
    if not save_prijsvoorstellen(prijsvoorstellen):
        return False

    verkoopprijzen = [
        record
        for record in load_verkoopprijzen()
        if str(record.get("bier_key", "") or "").strip() != bier_key
    ]
    if not save_verkoopprijzen(verkoopprijzen):
        return False

    verkoop_records = [
        record
        for record in _load_verkoopprijs_records()
        if not (
            isinstance(record, dict)
            and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT
            and str(record.get("bier_key", "") or "").strip() == bier_key
        )
    ]
    if not _save_verkoop_records(verkoop_records):
        return False

    variabele_kosten = load_variabele_kosten_data()
    updated_variabele_kosten: dict[str, Any] = {}
    for year_key, year_records in variabele_kosten.items():
        if not isinstance(year_records, dict):
            continue
        filtered_year_records = {
            key: value
            for key, value in year_records.items()
            if str(key or "").strip() != bier_key
        }
        if filtered_year_records:
            updated_variabele_kosten[year_key] = filtered_year_records
    if not save_variabele_kosten_data(updated_variabele_kosten):
        return False

    return cleanup_unused_bieren()


def add_bier(
    biernaam: str,
    stijl: str,
    alcoholpercentage: float,
    belastingsoort: str = DEFAULT_BELASTINGSOORT,
    tarief_accijns: str = DEFAULT_TARIEF_ACCIJNS,
    btw_tarief: str = DEFAULT_BTW_TARIEF,
) -> dict[str, Any] | None:
    """Voegt een nieuw bier toe aan de centrale bierlijst."""
    bieren = load_bieren()
    bier = normalize_bier_record(
        {
            "id": str(uuid4()),
            "biernaam": biernaam,
            "stijl": stijl,
            "alcoholpercentage": float(alcoholpercentage),
            "belastingsoort": belastingsoort,
            "tarief_accijns": tarief_accijns,
            "btw_tarief": btw_tarief,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
    )
    bieren.append(bier)

    if save_bieren(bieren):
        return bier

    return None


def get_bier_by_id(bier_id: str) -> dict[str, Any] | None:
    """Haalt bierdetails op op basis van het bier-id."""
    for bier in load_bieren():
        if str(bier.get("id")) == bier_id:
            return bier

    return None


def update_bier(
    bier_id: str,
    biernaam: str,
    stijl: str,
    alcoholpercentage: float,
    belastingsoort: str = DEFAULT_BELASTINGSOORT,
    tarief_accijns: str = DEFAULT_TARIEF_ACCIJNS,
    btw_tarief: str = DEFAULT_BTW_TARIEF,
) -> bool:
    """Werkt een bestaand bier bij."""
    bieren = load_bieren()

    for index, bier in enumerate(bieren):
        if str(bier.get("id")) != bier_id:
            continue

        existing_created_at = str(bier.get("created_at", "") or "") or _now_iso()
        bieren[index] = normalize_bier_record(
            {
                "id": bier_id,
                "biernaam": biernaam,
                "stijl": stijl,
                "alcoholpercentage": float(alcoholpercentage),
                "belastingsoort": belastingsoort,
                "tarief_accijns": tarief_accijns,
                "btw_tarief": btw_tarief,
                "created_at": existing_created_at,
                "updated_at": _now_iso(),
            }
        )
        return save_bieren(bieren)

    return False


def load_berekeningen() -> list[dict[str, Any]]:
    """Laadt alle berekeningen voor Nieuwe kostprijsberekening."""
    data = _load_json_value(BEREKENINGEN_FILE, [])
    if not isinstance(data, list):
        return []

    normalized_records: list[dict[str, Any]] = []
    for record in data:
        if not isinstance(record, dict):
            continue
        normalized_records.append(normalize_berekening_record(record))

    return normalized_records


def normalize_verkoopprijs_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een verkoopprijsrecord voor opslag en UI."""

    def _float_value(key: str) -> float:
        try:
            return float(record.get(key, 0.0) or 0.0)
        except (TypeError, ValueError):
            return 0.0

    def _int_value(key: str, default: int = 0) -> int:
        try:
            return int(record.get(key, default) or default)
        except (TypeError, ValueError):
            return default

    try:
        jaar = int(record.get("jaar", 0) or 0)
    except (TypeError, ValueError):
        jaar = 0

    bier_id = str(record.get("bier_id", "") or "")
    biernaam = str(record.get("biernaam", "") or "")
    stijl = str(record.get("stijl", "") or "")
    bier_key = str(record.get("bier_key", "") or "") or (
        bier_id if bier_id else f"{biernaam}|{stijl}"
    )

    created_at = str(record.get("created_at", "") or "") or _now_iso()
    updated_at = str(record.get("updated_at", "") or "") or created_at

    return {
        "id": str(record.get("id", "") or uuid4()),
        "record_type": "product_pricing",
        "bier_id": bier_id,
        "bier_key": bier_key,
        "berekening_id": str(record.get("berekening_id", "") or ""),
        "bron_berekening_id": str(record.get("bron_berekening_id", "") or ""),
        "bron_jaar": _int_value("bron_jaar", jaar),
        "jaar": jaar,
        "biernaam": biernaam,
        "stijl": stijl,
        "product_type": str(record.get("product_type", "") or ""),
        "verpakking": str(record.get("verpakking", "") or ""),
        "product_key": str(record.get("product_key", "") or ""),
        "bron_verkoopprijs_id": str(record.get("bron_verkoopprijs_id", "") or ""),
        "bron_verkoopjaar": _int_value("bron_verkoopjaar", jaar),
        "strategie_type": str(record.get("strategie_type", "") or ""),
        "kostprijs_per_liter": _float_value("kostprijs_per_liter"),
        "particulier_marge_pct": _float_value("particulier_marge_pct"),
        "zakelijk_marge_pct": _float_value("zakelijk_marge_pct"),
        "groothandel_marge_pct": _float_value("groothandel_marge_pct"),
        "particulier_prijs_per_liter": _float_value("particulier_prijs_per_liter"),
        "zakelijk_prijs_per_liter": _float_value("zakelijk_prijs_per_liter"),
        "groothandel_prijs_per_liter": _float_value("groothandel_prijs_per_liter"),
        "adviesprijs_per_liter": _float_value("adviesprijs_per_liter"),
        "created_at": created_at,
        "updated_at": updated_at,
    }


VERKOOPSTRATEGIE_CATEGORIEN = [
    "particulier",
    "zakelijk",
    "retail",
    "horeca",
    "slijterij",
]
VERKOOPSTRATEGIE_RECORD_TYPE_JAAR = "jaarstrategie"
VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT = "verkoopstrategie_product"
VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING = "verkoopstrategie_verpakking"


def _normalize_verpakking_key(value: Any) -> str:
    return str(value or "").strip().lower()


def normalize_verkoopstrategie_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een jaargebonden verkoopstrategie-record voor opslag en UI."""

    def _float_value(value: Any) -> float:
        try:
            return float(value or 0.0)
        except (TypeError, ValueError):
            return 0.0

    try:
        jaar = int(record.get("jaar", 0) or 0)
    except (TypeError, ValueError):
        jaar = 0

    try:
        bron_jaar = int(record.get("bron_jaar", jaar) or jaar)
    except (TypeError, ValueError):
        bron_jaar = jaar

    source_margins = record.get("kanaalmarges", {})
    if not isinstance(source_margins, dict):
        source_margins = {}

    kanaalmarges: dict[str, float] = {}
    for categorie in VERKOOPSTRATEGIE_CATEGORIEN:
        legacy_key = f"{categorie}_marge_pct"
        kanaalmarges[categorie] = _float_value(
            source_margins.get(categorie, record.get(legacy_key, 0.0))
        )

    for categorie, value in source_margins.items():
        if categorie in kanaalmarges:
            continue
        kanaalmarges[str(categorie)] = _float_value(value)

    created_at = str(record.get("created_at", "") or "") or _now_iso()
    updated_at = str(record.get("updated_at", "") or "") or created_at

    return {
        "id": str(record.get("id", "") or uuid4()),
        "record_type": VERKOOPSTRATEGIE_RECORD_TYPE_JAAR,
        "jaar": jaar,
        "bron_jaar": bron_jaar,
        "bron_verkoopstrategie_id": str(
            record.get("bron_verkoopstrategie_id", "") or ""
        ),
        "strategie_type": str(record.get("strategie_type", "") or ""),
        "kanaalmarges": kanaalmarges,
        "created_at": created_at,
        "updated_at": updated_at,
    }


def normalize_verkoopstrategie_product_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een verkoopstrategie op samengesteld-productniveau."""

    def _float_value(value: Any) -> float:
        try:
            return float(value or 0.0)
        except (TypeError, ValueError):
            return 0.0

    try:
        jaar = int(record.get("jaar", 0) or 0)
    except (TypeError, ValueError):
        jaar = 0

    try:
        bron_jaar = int(record.get("bron_jaar", jaar) or jaar)
    except (TypeError, ValueError):
        bron_jaar = jaar

    kanaalmarges_source = record.get("kanaalmarges", {})
    if not isinstance(kanaalmarges_source, dict):
        kanaalmarges_source = {}

    kanaalprijzen_source = record.get("kanaalprijzen", {})
    if not isinstance(kanaalprijzen_source, dict):
        kanaalprijzen_source = {}

    kanaalmarges: dict[str, float] = {}
    kanaalprijzen: dict[str, float | None] = {}
    for categorie in VERKOOPSTRATEGIE_CATEGORIEN:
        legacy_margin_key = f"{categorie}_marge_pct"
        legacy_price_key = f"{categorie}_prijs"
        kanaalmarges[categorie] = _float_value(
            kanaalmarges_source.get(categorie, record.get(legacy_margin_key, 0.0))
        )
        price_value = kanaalprijzen_source.get(categorie, record.get(legacy_price_key))
        if price_value in ("", None):
            kanaalprijzen[categorie] = None
        else:
            kanaalprijzen[categorie] = _float_value(price_value)

    created_at = str(record.get("created_at", "") or "") or _now_iso()
    updated_at = str(record.get("updated_at", "") or "") or created_at

    return {
        "id": str(record.get("id", "") or uuid4()),
        "record_type": VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT,
        "jaar": jaar,
        "bron_jaar": bron_jaar,
        "bier_key": str(record.get("bier_key", "") or ""),
        "biernaam": str(record.get("biernaam", "") or ""),
        "stijl": str(record.get("stijl", "") or ""),
        "product_id": str(record.get("product_id", "") or ""),
        "product_key": str(record.get("product_key", "") or ""),
        "product_type": str(record.get("product_type", "samengesteld") or "samengesteld"),
        "verpakking": str(record.get("verpakking", "") or ""),
        "bron_berekening_id": str(record.get("bron_berekening_id", "") or ""),
        "bron_verkoopstrategie_id": str(record.get("bron_verkoopstrategie_id", "") or ""),
        "strategie_type": str(record.get("strategie_type", "") or ""),
        "kostprijs": _float_value(record.get("kostprijs")),
        "kostprijs_per_liter": _float_value(record.get("kostprijs_per_liter")),
        "kanaalmarges": kanaalmarges,
        "kanaalprijzen": kanaalprijzen,
        "created_at": created_at,
        "updated_at": updated_at,
    }


def normalize_verkoopstrategie_verpakking_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een verkoopstrategie op verpakkingstype-niveau."""

    def _float_value(value: Any) -> float:
        try:
            return float(value or 0.0)
        except (TypeError, ValueError):
            return 0.0

    try:
        jaar = int(record.get("jaar", 0) or 0)
    except (TypeError, ValueError):
        jaar = 0

    try:
        bron_jaar = int(record.get("bron_jaar", jaar) or jaar)
    except (TypeError, ValueError):
        bron_jaar = jaar

    kanaalmarges_source = record.get("kanaalmarges", {})
    if not isinstance(kanaalmarges_source, dict):
        kanaalmarges_source = {}

    kanaalmarges: dict[str, float] = {}
    for categorie in VERKOOPSTRATEGIE_CATEGORIEN:
        legacy_margin_key = f"{categorie}_marge_pct"
        kanaalmarges[categorie] = _float_value(
            kanaalmarges_source.get(categorie, record.get(legacy_margin_key, 0.0))
        )

    created_at = str(record.get("created_at", "") or "") or _now_iso()
    updated_at = str(record.get("updated_at", "") or "") or created_at
    verpakking = str(record.get("verpakking", "") or "")
    verpakking_key = _normalize_verpakking_key(
        record.get("verpakking_key", verpakking)
    )

    return {
        "id": str(record.get("id", "") or uuid4()),
        "record_type": VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING,
        "jaar": jaar,
        "bron_jaar": bron_jaar,
        "product_id": str(record.get("product_id", "") or ""),
        "product_type": str(record.get("product_type", "") or ""),
        "verpakking_key": verpakking_key,
        "verpakking": verpakking,
        "bron_verkoopstrategie_id": str(record.get("bron_verkoopstrategie_id", "") or ""),
        "strategie_type": str(record.get("strategie_type", "") or ""),
        "kanaalmarges": kanaalmarges,
        "created_at": created_at,
        "updated_at": updated_at,
    }


def _load_verkoopprijs_records() -> list[dict[str, Any]]:
    """Laadt alle ruwe records uit verkoopprijzen.json veilig in."""
    data = _load_json_value(VERKOOPPRIJZEN_FILE, [])
    return data if isinstance(data, list) else []


def _normalize_any_verkoop_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een verkooprecord op basis van het type."""
    record_type = str(record.get("record_type", "") or "")
    if record_type == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR:
        return normalize_verkoopstrategie_record(record)
    if record_type == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT:
        return normalize_verkoopstrategie_product_record(record)
    if record_type == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING:
        return normalize_verkoopstrategie_verpakking_record(record)
    return normalize_verkoopprijs_record(record)


def _default_verkoop_kanaalmarges() -> dict[str, float]:
    return {
        categorie: 50.0 for categorie in VERKOOPSTRATEGIE_CATEGORIEN
    }


def _build_verkoopstrategie_packaging_sources() -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []

    for product in load_basisproducten():
        verpakking = str(product.get("omschrijving", "") or "")
        if not verpakking:
            continue
        sources.append(
            {
                "jaar": int(product.get("jaar", 0) or 0),
                "product_id": str(product.get("id", "") or ""),
                "product_type": "basis",
                "verpakking": verpakking,
                "verpakking_key": _normalize_verpakking_key(verpakking),
            }
        )

    for product in load_samengestelde_producten():
        verpakking = str(product.get("omschrijving", "") or "")
        if not verpakking:
            continue
        sources.append(
            {
                "jaar": int(product.get("jaar", 0) or 0),
                "product_id": str(product.get("id", "") or ""),
                "product_type": "samengesteld",
                "verpakking": verpakking,
                "verpakking_key": _normalize_verpakking_key(verpakking),
            }
        )

    return sources


def _pick_verkoopstrategie_seed(
    year: int,
    product_id: str,
    verpakking_key: str,
    records: list[dict[str, Any]],
) -> dict[str, Any] | None:
    verpakking_candidates = [
        record
        for record in records
        if str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
        and int(record.get("jaar", 0) or 0) <= year
        and product_id
        and str(record.get("product_id", "") or "") == product_id
    ]
    if verpakking_candidates:
        return max(verpakking_candidates, key=lambda item: int(item.get("jaar", 0) or 0))

    jaarstrategie_candidates = [
        record
        for record in records
        if str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR
        and int(record.get("jaar", 0) or 0) <= year
    ]
    if jaarstrategie_candidates:
        return max(jaarstrategie_candidates, key=lambda item: int(item.get("jaar", 0) or 0))

    return None


def _ensure_complete_verkoop_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = [
        _normalize_any_verkoop_record(record)
        for record in records
        if isinstance(record, dict)
    ]

    existing_packaging_keys: set[tuple[int, str, str]] = set()
    for record in normalized:
        if str(record.get("record_type", "") or "") != VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING:
            continue
        existing_packaging_keys.add(
            (
                int(record.get("jaar", 0) or 0),
                str(record.get("product_id", "") or ""),
                _normalize_verpakking_key(record.get("verpakking_key", record.get("verpakking", ""))),
            )
        )

    appended: list[dict[str, Any]] = []
    for source in _build_verkoopstrategie_packaging_sources():
        year = int(source.get("jaar", 0) or 0)
        product_id = str(source.get("product_id", "") or "")
        verpakking = str(source.get("verpakking", "") or "")
        verpakking_key = _normalize_verpakking_key(source.get("verpakking_key", verpakking))
        identity = (year, product_id, verpakking_key)
        if identity in existing_packaging_keys:
            continue

        seed = _pick_verkoopstrategie_seed(year, product_id, verpakking_key, normalized)
        appended.append(
            normalize_verkoopstrategie_verpakking_record(
                {
                    "jaar": year,
                    "bron_jaar": int((seed or {}).get("jaar", year) or year),
                    "product_id": product_id,
                    "product_type": str(source.get("product_type", "") or ""),
                    "verpakking": verpakking,
                    "verpakking_key": verpakking_key,
                    "bron_verkoopstrategie_id": str((seed or {}).get("id", "") or ""),
                    "strategie_type": str((seed or {}).get("strategie_type", "handmatig") or "handmatig"),
                    "kanaalmarges": dict((seed or {}).get("kanaalmarges", _default_verkoop_kanaalmarges())),
                }
            )
        )
        existing_packaging_keys.add(identity)

    completed = [*normalized, *appended]

    concrete_packaging_pairs = {
        (
            int(record.get("jaar", 0) or 0),
            _normalize_verpakking_key(record.get("verpakking_key", record.get("verpakking", ""))),
        )
        for record in completed
        if str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
        and str(record.get("product_id", "") or "")
    }

    completed = [
        record
        for record in completed
        if not (
            str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
            and not str(record.get("product_id", "") or "")
            and (
                int(record.get("jaar", 0) or 0),
                _normalize_verpakking_key(record.get("verpakking_key", record.get("verpakking", ""))),
            )
            in concrete_packaging_pairs
        )
    ]

    completed.sort(
        key=lambda item: (
            int(item.get("jaar", 0) or 0),
            0
            if str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR
            else 1
            if str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
            else 2,
            str(item.get("biernaam", "") or "").lower(),
            str(item.get("verpakking_key", item.get("verpakking", "")) or "").lower(),
        )
    )
    return completed


def normalize_any_verkoop_record(record: dict[str, Any]) -> dict[str, Any]:
    """Publieke helper voor het normaliseren van verkooprecords."""
    return _normalize_any_verkoop_record(record)


def ensure_complete_verkoop_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Publieke helper die ontbrekende verpakkingsstrategie-records aanvult."""
    return _ensure_complete_verkoop_records(records)


def _save_verkoop_records(records: list[dict[str, Any]]) -> bool:
    """Slaat gemengde verkooprecords veilig op."""
    normalized = _ensure_complete_verkoop_records(records)
    return _save_json_value(VERKOOPPRIJZEN_FILE, normalized, "[]")


def load_verkoopprijzen() -> list[dict[str, Any]]:
    """Laadt alle verkoopprijzen veilig in."""
    return [
        normalize_verkoopprijs_record(record)
        for record in _load_verkoopprijs_records()
        if isinstance(record, dict)
        and str(record.get("record_type", "") or "") not in {
            VERKOOPSTRATEGIE_RECORD_TYPE_JAAR,
            VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT,
            VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING,
        }
    ]


def load_all_verkoop_records() -> list[dict[str, Any]]:
    """Laadt alle verkoop-gerelateerde records veilig in, inclusief strategie-records."""
    return _ensure_complete_verkoop_records(_load_verkoopprijs_records())


def save_verkoopprijzen(data: list[dict[str, Any]]) -> bool:
    """Slaat alle verkoopprijzen veilig op."""
    strategy_records = [
        *load_verkoopstrategien(),
        *load_verkoopstrategie_producten(),
        *load_verkoopstrategie_verpakkingen(),
    ]
    return _save_verkoop_records([*strategy_records, *data])


def load_verkoopstrategien() -> list[dict[str, Any]]:
    """Laadt alle jaargebonden verkoopstrategieÃ«n veilig in."""
    return [
        normalize_verkoopstrategie_record(record)
        for record in load_all_verkoop_records()
        if isinstance(record, dict)
        and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR
    ]


def get_verkoopstrategie_for_year(year: int | str) -> dict[str, Any] | None:
    """Geeft de verkoopstrategie terug voor Ã©Ã©n jaar."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    for record in load_verkoopstrategien():
        if int(record.get("jaar", 0) or 0) == year_value:
            return record
    return None


def load_verkoopstrategie_producten() -> list[dict[str, Any]]:
    """Laadt alle verkoopstrategieÃ«n op productniveau veilig in."""
    return [
        normalize_verkoopstrategie_product_record(record)
        for record in load_all_verkoop_records()
        if isinstance(record, dict)
        and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT
    ]


def load_verkoopstrategie_verpakkingen() -> list[dict[str, Any]]:
    """Laadt alle verkoopstrategieÃ«n op verpakkingstype veilig in."""
    return [
        normalize_verkoopstrategie_verpakking_record(record)
        for record in load_all_verkoop_records()
        if isinstance(record, dict)
        and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
    ]


def get_verkoopstrategie_verpakkingen_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft alle verpakkingsstrategieÃ«n voor Ã©Ã©n jaar terug."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return []

    return [
        record
        for record in load_verkoopstrategie_verpakkingen()
        if int(record.get("jaar", 0) or 0) == year_value
    ]


def duplicate_verkoopstrategie_verpakkingen_to_year(
    source_year: int | str,
    target_year: int | str,
    *,
    overwrite: bool = False,
) -> int:
    """Dupliceert verpakkingsstrategieÃ«n van bronjaar naar doeljaar."""
    try:
        source_year_value = int(source_year)
        target_year_value = int(target_year)
    except (TypeError, ValueError):
        return 0

    source_records = get_verkoopstrategie_verpakkingen_for_year(source_year_value)
    if not source_records:
        return 0

    target_records = {
        _normalize_verpakking_key(record.get("verpakking_key", "")): record
        for record in get_verkoopstrategie_verpakkingen_for_year(target_year_value)
    }

    copied = 0
    for record in source_records:
        verpakking_key = _normalize_verpakking_key(record.get("verpakking_key", ""))
        if verpakking_key in target_records and not overwrite:
            continue
        saved = add_or_update_verkoopstrategie_verpakking(
            {
                **record,
                "id": str(uuid4()),
                "jaar": target_year_value,
                "bron_jaar": int(record.get("jaar", source_year_value) or source_year_value),
                "bron_verkoopstrategie_id": str(record.get("id", "") or ""),
            }
        )
        if saved:
            copied += 1

    return copied


def get_verkoopstrategie_verpakking(
    year: int | str,
    verpakking_key: str,
) -> dict[str, Any] | None:
    """Geeft Ã©Ã©n verpakkingsstrategie terug voor een jaar en verpakkingstype."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    verpakking_key_value = _normalize_verpakking_key(verpakking_key)
    for record in load_verkoopstrategie_verpakkingen():
        if int(record.get("jaar", 0) or 0) != year_value:
            continue
        if _normalize_verpakking_key(record.get("verpakking_key", "")) != verpakking_key_value:
            continue
        return record
    return None


def get_latest_verkoopstrategie_verpakking_up_to_year(
    year: int | str,
    verpakking_key: str,
) -> dict[str, Any] | None:
    """Geeft de meest recente verpakkingsstrategie terug tot en met een jaar."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    verpakking_key_value = _normalize_verpakking_key(verpakking_key)
    candidates = [
        record
        for record in load_verkoopstrategie_verpakkingen()
        if int(record.get("jaar", 0) or 0) <= year_value
        and _normalize_verpakking_key(record.get("verpakking_key", "")) == verpakking_key_value
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda item: int(item.get("jaar", 0) or 0))


def get_verkoopstrategie_producten_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft alle productstrategieÃ«n voor Ã©Ã©n jaar terug."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return []

    return [
        record
        for record in load_verkoopstrategie_producten()
        if int(record.get("jaar", 0) or 0) == year_value
    ]


def get_verkoopstrategie_product(
    year: int | str,
    bier_key: str,
    product_key: str,
    *,
    only_override: bool = False,
) -> dict[str, Any] | None:
    """Geeft Ã©Ã©n productstrategie terug voor jaar, bier en samengesteld product."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    bier_key_value = str(bier_key or "")
    product_key_value = str(product_key or "")
    for record in load_verkoopstrategie_producten():
        if int(record.get("jaar", 0) or 0) != year_value:
            continue
        if str(record.get("bier_key", "") or "") != bier_key_value:
            continue
        if str(record.get("product_key", "") or "") != product_key_value:
            continue
        if only_override and str(record.get("strategie_type", "") or "") != "uitzondering":
            continue
        return record
    return None


def get_latest_verkoopstrategie_product_up_to_year(
    year: int | str,
    bier_key: str,
    product_key: str,
    *,
    only_override: bool = False,
) -> dict[str, Any] | None:
    """Geeft de meest recente productstrategie terug tot en met een jaar."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    bier_key_value = str(bier_key or "")
    product_key_value = str(product_key or "")
    candidates = [
        record
        for record in load_verkoopstrategie_producten()
        if int(record.get("jaar", 0) or 0) <= year_value
        and str(record.get("bier_key", "") or "") == bier_key_value
        and str(record.get("product_key", "") or "") == product_key_value
        and (
            not only_override
            or str(record.get("strategie_type", "") or "") == "uitzondering"
        )
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda item: int(item.get("jaar", 0) or 0))


def get_effective_verkoopstrategie_for_product(
    year: int | str,
    bier_key: str,
    product_key: str,
    verpakking: str = "",
) -> dict[str, Any] | None:
    """Geeft de meest geschikte strategie voor een product, met fallback op jaarstrategie."""
    product_strategy = get_latest_verkoopstrategie_product_up_to_year(
        year,
        bier_key,
        product_key,
        only_override=True,
    )
    if product_strategy is not None:
        return product_strategy

    if verpakking:
        verpakking_strategy = get_latest_verkoopstrategie_verpakking_up_to_year(
            year,
            verpakking,
        )
        if verpakking_strategy is not None:
            return {
                **verpakking_strategy,
                "record_type": VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT,
                "bier_key": str(bier_key or ""),
                "product_key": str(product_key or ""),
                "product_type": "samengesteld",
                "verpakking": str(verpakking or verpakking_strategy.get("verpakking", "") or ""),
                "biernaam": "",
                "stijl": "",
                "kostprijs": 0.0,
                "kostprijs_per_liter": 0.0,
                "kanaalprijzen": {categorie: None for categorie in VERKOOPSTRATEGIE_CATEGORIEN},
                "bron_verkoopstrategie_id": str(verpakking_strategy.get("id", "") or ""),
            }

    year_strategy = get_latest_verkoopstrategie_up_to_year(year)
    if year_strategy is None:
        return None

    return {
        **year_strategy,
        "record_type": VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT,
        "bier_key": str(bier_key or ""),
        "product_key": str(product_key or ""),
        "product_type": "samengesteld",
        "verpakking": "",
        "biernaam": "",
        "stijl": "",
        "kostprijs": 0.0,
        "kostprijs_per_liter": 0.0,
        "kanaalprijzen": {categorie: None for categorie in VERKOOPSTRATEGIE_CATEGORIEN},
        "bron_verkoopstrategie_id": str(year_strategy.get("id", "") or ""),
    }


def get_latest_verkoopstrategie_up_to_year(year: int | str) -> dict[str, Any] | None:
    """Geeft de meest recente verkoopstrategie terug tot en met een jaar."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    candidates = [
        record
        for record in load_verkoopstrategien()
        if int(record.get("jaar", 0) or 0) <= year_value
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda item: int(item.get("jaar", 0) or 0))


def add_or_update_verkoopstrategie(record: dict[str, Any]) -> dict[str, Any] | None:
    """Voegt een verkoopstrategie toe of werkt die veilig bij op jaar."""
    records = _load_verkoopprijs_records()
    normalized_input = normalize_verkoopstrategie_record(record)
    jaar = int(normalized_input.get("jaar", 0) or 0)
    existing = next(
        (
            normalize_verkoopstrategie_record(item)
            for item in records
            if isinstance(item, dict)
            and str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR
            and int(item.get("jaar", 0) or 0) == jaar
        ),
        None,
    )

    normalized = normalize_verkoopstrategie_record(
        {
            **(existing or {}),
            **normalized_input,
            "id": str(
                (existing or {}).get("id", normalized_input.get("id", "")) or uuid4()
            ),
            "created_at": str(
                (existing or {}).get(
                    "created_at",
                    normalized_input.get("created_at", "") or _now_iso(),
                )
                or _now_iso()
            ),
            "updated_at": _now_iso(),
        }
    )

    filtered_records = [
        record
        for record in records
        if not (
            isinstance(record, dict)
            and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR
            and int(record.get("jaar", 0) or 0) == jaar
        )
    ]
    filtered_records.append(normalized)

    if _save_verkoop_records(filtered_records):
        return normalized
    return None


def delete_verkoopstrategie(verkoopstrategie_id: str) -> bool:
    """Verwijdert Ã©Ã©n verkoopstrategie-record op basis van id."""
    records = _load_verkoopprijs_records()
    filtered = [
        record
        for record in records
        if not (
            isinstance(record, dict)
            and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_JAAR
            and str(record.get("id", "") or "") == str(verkoopstrategie_id or "")
        )
    ]
    if len(filtered) == len(records):
        return False
    return _save_verkoop_records(filtered)


def add_or_update_verkoopstrategie_verpakking(record: dict[str, Any]) -> dict[str, Any] | None:
    """Voegt een verpakkingsstrategie toe of werkt die veilig bij op jaar en verpakking."""
    records = _load_verkoopprijs_records()
    normalized_input = normalize_verkoopstrategie_verpakking_record(record)
    jaar = int(normalized_input.get("jaar", 0) or 0)
    verpakking_key = _normalize_verpakking_key(normalized_input.get("verpakking_key", ""))

    existing = next(
        (
            normalize_verkoopstrategie_verpakking_record(item)
            for item in records
            if isinstance(item, dict)
            and str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
            and int(item.get("jaar", 0) or 0) == jaar
            and _normalize_verpakking_key(item.get("verpakking_key", "")) == verpakking_key
        ),
        None,
    )

    normalized = normalize_verkoopstrategie_verpakking_record(
        {
            **(existing or {}),
            **normalized_input,
            "id": str((existing or {}).get("id", normalized_input.get("id", "")) or uuid4()),
            "created_at": str(
                (existing or {}).get(
                    "created_at",
                    normalized_input.get("created_at", "") or _now_iso(),
                )
                or _now_iso()
            ),
            "updated_at": _now_iso(),
        }
    )

    filtered_records = [
        item
        for item in records
        if not (
            isinstance(item, dict)
            and str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
            and int(item.get("jaar", 0) or 0) == jaar
            and _normalize_verpakking_key(item.get("verpakking_key", "")) == verpakking_key
        )
    ]
    filtered_records.append(normalized)

    if _save_verkoop_records(filtered_records):
        return normalized
    return None


def delete_verkoopstrategie_verpakking(verkoopstrategie_id: str) -> bool:
    """Verwijdert Ã©Ã©n verpakkingsstrategie-record op basis van id."""
    records = _load_verkoopprijs_records()
    filtered = [
        record
        for record in records
        if not (
            isinstance(record, dict)
            and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_VERPAKKING
            and str(record.get("id", "") or "") == str(verkoopstrategie_id or "")
        )
    ]
    if len(filtered) == len(records):
        return False
    return _save_verkoop_records(filtered)


def add_or_update_verkoopstrategie_product(record: dict[str, Any]) -> dict[str, Any] | None:
    """Voegt een productstrategie toe of werkt die veilig bij op jaar, bier en product."""
    records = _load_verkoopprijs_records()
    normalized_input = normalize_verkoopstrategie_product_record(record)
    jaar = int(normalized_input.get("jaar", 0) or 0)
    bier_key = str(normalized_input.get("bier_key", "") or "")
    product_key = str(normalized_input.get("product_key", "") or "")

    existing = next(
        (
            normalize_verkoopstrategie_product_record(item)
            for item in records
            if isinstance(item, dict)
            and str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT
            and int(item.get("jaar", 0) or 0) == jaar
            and str(item.get("bier_key", "") or "") == bier_key
            and str(item.get("product_key", "") or "") == product_key
        ),
        None,
    )

    normalized = normalize_verkoopstrategie_product_record(
        {
            **(existing or {}),
            **normalized_input,
            "id": str(
                (existing or {}).get("id", normalized_input.get("id", "")) or uuid4()
            ),
            "created_at": str(
                (existing or {}).get(
                    "created_at",
                    normalized_input.get("created_at", "") or _now_iso(),
                )
                or _now_iso()
            ),
            "updated_at": _now_iso(),
        }
    )

    filtered_records = [
        item
        for item in records
        if not (
            isinstance(item, dict)
            and str(item.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT
            and int(item.get("jaar", 0) or 0) == jaar
            and str(item.get("bier_key", "") or "") == bier_key
            and str(item.get("product_key", "") or "") == product_key
        )
    ]
    filtered_records.append(normalized)

    if _save_verkoop_records(filtered_records):
        return normalized
    return None


def delete_verkoopstrategie_product(verkoopstrategie_id: str) -> bool:
    """Verwijdert Ã©Ã©n productstrategie-record op basis van id."""
    records = _load_verkoopprijs_records()
    filtered = [
        record
        for record in records
        if not (
            isinstance(record, dict)
            and str(record.get("record_type", "") or "") == VERKOOPSTRATEGIE_RECORD_TYPE_PRODUCT
            and str(record.get("id", "") or "") == str(verkoopstrategie_id or "")
        )
    ]
    if len(filtered) == len(records):
        return False
    if not _save_verkoop_records(filtered):
        return False
    cleanup_unused_bieren()
    return True


def normalize_prijsvoorstel_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normaliseert een prijsvoorstelrecord voor opslag en UI."""

    def _float_value(value: Any) -> float:
        try:
            return float(value or 0.0)
        except (TypeError, ValueError):
            return 0.0

    status = str(record.get("status", "concept") or "concept").strip().lower()
    if status not in {"concept", "definitief"}:
        status = "concept"

    staffels_source = record.get("staffels", [])
    if not isinstance(staffels_source, list):
        staffels_source = []
    staffels: list[dict[str, Any]] = []
    for row in staffels_source:
        if not isinstance(row, dict):
            continue
        staffels.append(
            {
                "id": str(row.get("id", "") or uuid4()),
                "product_id": str(row.get("product_id", "") or ""),
                "product_type": str(row.get("product_type", "") or ""),
                "product_key": str(row.get("product_key", "") or ""),
                "liters": _float_value(row.get("liters")),
                "korting_pct": _float_value(row.get("korting_pct")),
            }
        )

    product_rows_source = record.get("product_rows", [])
    if not isinstance(product_rows_source, list):
        product_rows_source = []
    product_rows: list[dict[str, Any]] = []
    for row in product_rows_source:
        if not isinstance(row, dict):
            continue
        product_rows.append(
            {
                "id": str(row.get("id", "") or uuid4()),
                "bier_key": str(row.get("bier_key", "") or ""),
                "product_id": str(row.get("product_id", "") or ""),
                "product_type": str(row.get("product_type", "") or ""),
                "product_key": str(row.get("product_key", "") or ""),
                "verpakking_label": str(row.get("verpakking_label", "") or ""),
                "aantal": _float_value(row.get("aantal")),
                "korting_pct": _float_value(row.get("korting_pct")),
            }
        )

    beer_rows_source = record.get("beer_rows", [])
    if not isinstance(beer_rows_source, list):
        beer_rows_source = []
    beer_rows: list[dict[str, Any]] = []
    for row in beer_rows_source:
        if not isinstance(row, dict):
            continue
        beer_rows.append(
            {
                "id": str(row.get("id", "") or uuid4()),
                "bier_key": str(row.get("bier_key", "") or ""),
                "product_id": str(row.get("product_id", "") or ""),
                "product_type": str(row.get("product_type", "") or ""),
                "product_key": str(row.get("product_key", "") or ""),
                "liters": _float_value(row.get("liters")),
                "korting_pct": _float_value(row.get("korting_pct")),
            }
        )

    product_bier_keys_source = record.get("product_bier_keys", [])
    if not isinstance(product_bier_keys_source, list):
        product_bier_keys_source = []
    product_bier_keys = [
        str(value or "")
        for value in product_bier_keys_source
        if str(value or "").strip()
    ]

    deleted_product_pairs_source = record.get("deleted_product_pairs", [])
    if not isinstance(deleted_product_pairs_source, list):
        deleted_product_pairs_source = []
    deleted_product_pairs: list[dict[str, Any]] = []
    for item in deleted_product_pairs_source:
        if not isinstance(item, dict):
            continue
        bier_key = str(item.get("bier_key", "") or "")
        product_key = str(item.get("product_key", "") or "")
        if bier_key and product_key:
            deleted_product_pairs.append(
                {
                    "bier_key": bier_key,
                    "product_key": product_key,
                }
            )

    created_at = str(record.get("created_at", "") or "") or _now_iso()
    updated_at = str(record.get("updated_at", "") or "") or created_at
    finalized_at = str(record.get("finalized_at", "") or "")
    if status != "definitief":
        finalized_at = ""

    return {
        "id": str(record.get("id", "") or uuid4()),
        "offertenummer": str(record.get("offertenummer", "") or ""),
        "status": status,
        "klantnaam": str(record.get("klantnaam", "") or ""),
        "contactpersoon": str(record.get("contactpersoon", "") or ""),
        "referentie": str(record.get("referentie", "") or ""),
        "datum_text": str(record.get("datum_text", "") or ""),
        "opmerking": str(record.get("opmerking", "") or ""),
        "jaar": int(record.get("jaar", 0) or 0),
        "voorsteltype": str(record.get("voorsteltype", "") or ""),
        "liters_basis": str(record.get("liters_basis", "een_bier") or "een_bier"),
        "kanaal": str(record.get("kanaal", "") or ""),
        "bier_key": str(record.get("bier_key", "") or ""),
        "product_bier_keys": product_bier_keys,
        "deleted_product_pairs": deleted_product_pairs,
        "staffels": staffels,
        "product_rows": product_rows,
        "beer_rows": beer_rows,
        "last_step": int(record.get("last_step", 1) or 1),
        "created_at": created_at,
        "updated_at": updated_at,
        "finalized_at": finalized_at,
    }


def _prijsvoorstel_prefix(now: datetime | None = None) -> str:
    current = now or datetime.now()
    return current.strftime("%Y%m")


def _extract_offertenummer_seq(offertenummer: str, prefix: str) -> int | None:
    value = str(offertenummer or "").strip()
    if not value.startswith(prefix):
        return None
    suffix = value[len(prefix) :]
    if len(suffix) != 3 or not suffix.isdigit():
        return None
    return int(suffix)


def _assign_missing_offertenummers(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prefix = _prijsvoorstel_prefix()
    used_sequences = {
        seq
        for seq in (
            _extract_offertenummer_seq(str(record.get("offertenummer", "") or ""), prefix)
            for record in records
        )
        if seq is not None
    }
    next_sequence = max(used_sequences, default=0) + 1

    def _sort_key(record: dict[str, Any]) -> tuple[int, str, str, str]:
        status = str(record.get("status", "") or "")
        status_order = 0 if status == "definitief" else 1
        return (
            status_order,
            str(record.get("created_at", "") or ""),
            str(record.get("updated_at", "") or ""),
            str(record.get("id", "") or ""),
        )

    normalized_records: list[dict[str, Any]] = []
    for record in sorted(records, key=_sort_key):
        normalized = normalize_prijsvoorstel_record(record)
        if not str(normalized.get("offertenummer", "") or "").strip():
            while next_sequence in used_sequences:
                next_sequence += 1
            normalized["offertenummer"] = f"{prefix}{next_sequence:03d}"
            used_sequences.add(next_sequence)
            next_sequence += 1
        normalized_records.append(normalized)
    return normalized_records


def get_next_prijsvoorstel_offertenummer() -> str:
    prefix = _prijsvoorstel_prefix()
    next_sequence = max(
        (
            _extract_offertenummer_seq(str(record.get("offertenummer", "") or ""), prefix) or 0
            for record in load_prijsvoorstellen()
        ),
        default=0,
    ) + 1
    return f"{prefix}{next_sequence:03d}"


def load_prijsvoorstellen() -> list[dict[str, Any]]:
    """Laadt alle prijsvoorstellen veilig in."""
    data = _load_json_value(PRIJSVOORSTELLEN_FILE, [])
    if not isinstance(data, list):
        return []
    normalized = [
        normalize_prijsvoorstel_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    if any(not str(record.get("offertenummer", "") or "").strip() for record in normalized):
        normalized = _assign_missing_offertenummers(normalized)
        _save_json_value(PRIJSVOORSTELLEN_FILE, normalized, "[]")
    return normalized


def save_prijsvoorstellen(data: list[dict[str, Any]]) -> bool:
    """Slaat alle prijsvoorstellen veilig op."""
    normalized = [
        normalize_prijsvoorstel_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    normalized = _assign_missing_offertenummers(normalized)
    normalized = sorted(
        normalized,
        key=lambda item: (
            0 if str(item.get("status", "") or "") == "concept" else 1,
            str(item.get("updated_at", "") or ""),
        ),
        reverse=True,
    )
    return _save_json_value(PRIJSVOORSTELLEN_FILE, normalized, "[]")


def get_prijsvoorstel_by_id(prijsvoorstel_id: str) -> dict[str, Any] | None:
    """Geeft Ã©Ã©n prijsvoorstel terug op basis van id."""
    target_id = str(prijsvoorstel_id or "")
    for record in load_prijsvoorstellen():
        if str(record.get("id", "") or "") == target_id:
            return record
    return None


def add_or_update_prijsvoorstel(record: dict[str, Any]) -> dict[str, Any] | None:
    """Voegt een prijsvoorstel toe of werkt een bestaand voorstel bij."""
    records = load_prijsvoorstellen()
    normalized_input = normalize_prijsvoorstel_record(record)
    record_id = str(normalized_input.get("id", "") or uuid4())
    existing = next(
        (
            item for item in records
            if str(item.get("id", "") or "") == record_id
        ),
        None,
    )

    normalized = normalize_prijsvoorstel_record(
        {
            **(existing or {}),
            **normalized_input,
            "id": record_id,
            "offertenummer": str(
                (existing or {}).get("offertenummer", normalized_input.get("offertenummer", "") or "")
            ),
            "created_at": str(
                (existing or {}).get("created_at", normalized_input.get("created_at", "") or _now_iso())
                or _now_iso()
            ),
            "updated_at": _now_iso(),
        }
    )

    updated = False
    for index, item in enumerate(records):
        if str(item.get("id", "") or "") != record_id:
            continue
        records[index] = normalized
        updated = True
        break

    if not updated:
        records.append(normalized)

    if save_prijsvoorstellen(records):
        return normalized
    return None


def save_prijsvoorstel_as_concept(record: dict[str, Any]) -> dict[str, Any] | None:
    """Slaat een prijsvoorstel op als concept."""
    return add_or_update_prijsvoorstel(
        {
            **record,
            "status": "concept",
            "finalized_at": "",
        }
    )


def finalize_prijsvoorstel(record: dict[str, Any]) -> dict[str, Any] | None:
    """Slaat een prijsvoorstel op als definitief."""
    return add_or_update_prijsvoorstel(
        {
            **record,
            "status": "definitief",
            "finalized_at": _now_iso(),
        }
    )


def delete_prijsvoorstel(prijsvoorstel_id: str) -> bool:
    """Verwijdert Ã©Ã©n prijsvoorstelrecord op basis van id."""
    records = load_prijsvoorstellen()
    filtered = [
        record
        for record in records
        if str(record.get("id", "") or "") != str(prijsvoorstel_id or "")
    ]
    if len(filtered) == len(records):
        return False
    if not save_prijsvoorstellen(filtered):
        return False
    cleanup_unused_bieren()
    return True


def get_concept_prijsvoorstellen() -> list[dict[str, Any]]:
    """Geeft alle conceptvoorstellen terug."""
    return [
        record
        for record in load_prijsvoorstellen()
        if str(record.get("status", "") or "") == "concept"
    ]


def get_definitieve_prijsvoorstellen() -> list[dict[str, Any]]:
    """Geeft alle definitieve prijsvoorstellen terug."""
    return [
        record
        for record in load_prijsvoorstellen()
        if str(record.get("status", "") or "") == "definitief"
    ]


def get_verkoopprijs_by_bierjaar(
    bier_id: str,
    year: int | str,
    product_key: str = "",
) -> dict[str, Any] | None:
    """Geeft een verkoopprijsrecord terug voor Ã©Ã©n bier, jaar en optioneel verkoopartikel."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return None

    bier_id_value = str(bier_id or "")
    bier_key_value = bier_id_value
    product_key_value = str(product_key or "")
    for record in load_verkoopprijzen():
        if str(record.get("bier_key", "") or "") != bier_key_value:
            continue
        if int(record.get("jaar", 0) or 0) != year_value:
            continue
        if product_key_value and str(record.get("product_key", "") or "") != product_key_value:
            continue
        return record
    return None


def add_or_update_verkoopprijs(record: dict[str, Any]) -> dict[str, Any] | None:
    """Voegt een verkoopprijs toe of werkt die veilig bij op bier en jaar."""
    records = load_verkoopprijzen()
    normalized_input = normalize_verkoopprijs_record(record)
    bier_key = str(normalized_input.get("bier_key", "") or "")
    jaar = int(normalized_input.get("jaar", 0) or 0)
    product_key = str(normalized_input.get("product_key", "") or "")
    existing = next(
        (
            item
            for item in records
            if str(item.get("bier_key", "") or "") == bier_key
            and int(item.get("jaar", 0) or 0) == jaar
            and str(item.get("product_key", "") or "") == product_key
        ),
        None,
    )

    normalized = normalize_verkoopprijs_record(
        {
            **(existing or {}),
            **normalized_input,
            "id": str(
                (existing or {}).get("id", normalized_input.get("id", "")) or uuid4()
            ),
            "created_at": str(
                (existing or {}).get(
                    "created_at",
                    normalized_input.get("created_at", "") or _now_iso(),
                )
                or _now_iso()
            ),
            "updated_at": _now_iso(),
        }
    )

    updated = False
    for index, item in enumerate(records):
        if str(item.get("id", "") or "") != str(normalized.get("id", "") or ""):
            continue
        records[index] = normalized
        updated = True
        break

    if not updated:
        records.append(normalized)

    if save_verkoopprijzen(records):
        return normalized
    return None


def delete_verkoopprijs(verkoopprijs_id: str) -> bool:
    """Verwijdert Ã©Ã©n verkoopprijsrecord op basis van id."""
    records = load_verkoopprijzen()
    filtered = [
        record
        for record in records
        if str(record.get("id", "") or "") != str(verkoopprijs_id or "")
    ]
    if len(filtered) == len(records):
        return False
    if not save_verkoopprijzen(filtered):
        return False
    cleanup_unused_bieren()
    return True


def get_verkoopprijzen_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft alle verkoopprijzen voor een jaar terug."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return []

    return [
        record
        for record in load_verkoopprijzen()
        if int(record.get("jaar", 0) or 0) == year_value
    ]


def save_berekeningen(data: list[dict[str, Any]]) -> bool:
    """Slaat alle berekeningen veilig op."""
    normalized_records = [
        normalize_berekening_record(record)
        for record in data
        if isinstance(record, dict)
    ]
    return _save_json_value(BEREKENINGEN_FILE, normalized_records, "[]")


def create_empty_berekening() -> dict[str, Any]:
    """Maakt een lege berekening aan met veilige defaults."""
    return normalize_berekening_record(
        {
            "id": str(uuid4()),
            "bier_id": "",
            "record_type": "kostprijsberekening",
            "calculation_variant": "origineel",
            "bron_berekening_id": "",
            "hercalculatie_reden": "",
            "hercalculatie_notitie": "",
            "hercalculatie_timestamp": "",
            "hercalculatie_basis": {
                "ingredienten_regels": [],
            },
            "status": "concept",
            "basisgegevens": {
                "jaar": 0,
                "biernaam": "",
                "stijl": "",
                "alcoholpercentage": 0.0,
                "belastingsoort": DEFAULT_BELASTINGSOORT,
                "tarief_accijns": DEFAULT_TARIEF_ACCIJNS,
                "btw_tarief": DEFAULT_BTW_TARIEF,
            },
            "soort_berekening": {
                "type": "Eigen productie",
            },
            "invoer": {
                "ingredienten": {
                    "regels": [],
                    "notities": "",
                },
                "inkoop": {
                    "regels": [],
                    "factuurregels": [],
                    "factuurdatum": "",
                    "notities": "",
                    "verzendkosten": 0.0,
                    "overige_kosten": 0.0,
                    "facturen": [
                        {
                            "id": str(uuid4()),
                            "factuurdatum": "",
                            "verzendkosten": 0.0,
                            "overige_kosten": 0.0,
                            "factuurregels": [],
                        }
                    ],
                },
            },
            "bier_snapshot": {
                "biernaam": "",
                "stijl": "",
                "alcoholpercentage": 0.0,
                "belastingsoort": DEFAULT_BELASTINGSOORT,
                "tarief_accijns": DEFAULT_TARIEF_ACCIJNS,
                "btw_tarief": DEFAULT_BTW_TARIEF,
            },
            "resultaat_snapshot": {},
            "last_completed_step": 1,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "finalized_at": "",
        }
    )


def create_recalculatie_from_berekening(
    source_record: dict[str, Any],
    *,
    reason: str = "Hercalculatie",
) -> dict[str, Any]:
    """Maakt een nieuwe concept-hercalculatie op basis van een bestaande berekening."""
    cloned = deepcopy(source_record if isinstance(source_record, dict) else {})
    cloned["id"] = str(uuid4())
    cloned["status"] = "concept"
    cloned["record_type"] = "kostprijsberekening"
    cloned["calculation_variant"] = "hercalculatie"
    cloned["bron_berekening_id"] = str(source_record.get("id", "") or "")
    cloned["hercalculatie_reden"] = str(reason or "Hercalculatie")
    cloned["hercalculatie_notitie"] = ""
    cloned["hercalculatie_timestamp"] = _now_iso()
    cloned["hercalculatie_basis"] = {
        "ingredienten_regels": deepcopy(
            source_record.get("invoer", {}).get("ingredienten", {}).get("regels", []),
        ),
    }
    cloned["resultaat_snapshot"] = {}
    cloned["finalized_at"] = ""
    cloned["last_completed_step"] = 1
    cloned["created_at"] = _now_iso()
    cloned["updated_at"] = _now_iso()
    return normalize_berekening_record(cloned)


def get_berekening_by_id(berekening_id: str) -> dict[str, Any] | None:
    """Haalt een berekening op basis van id."""
    for record in load_berekeningen():
        if str(record.get("id", "")) == berekening_id:
            return record
    return None


def add_or_update_berekening(record: dict[str, Any]) -> dict[str, Any] | None:
    """Voegt een berekening toe of werkt een bestaande berekening bij."""
    records = load_berekeningen()
    record_id = str(record.get("id", "") or uuid4())
    existing = next(
        (item for item in records if str(item.get("id", "")) == record_id),
        None,
    )
    normalized = normalize_berekening_record(
        {
            **(existing or {}),
            **record,
            "id": record_id,
            "created_at": (
                str(existing.get("created_at", "") or "")
                if isinstance(existing, dict)
                else str(record.get("created_at", "") or _now_iso())
            ),
            "updated_at": _now_iso(),
        }
    )

    updated = False
    for index, item in enumerate(records):
        if str(item.get("id", "")) != record_id:
            continue
        records[index] = normalized
        updated = True
        break

    if not updated:
        records.append(normalized)

    if save_berekeningen(records):
        return normalized
    return None


def save_berekening_as_concept(record: dict[str, Any]) -> dict[str, Any] | None:
    """Slaat een berekening op als concept."""
    return add_or_update_berekening(
        {
            **record,
            "status": "concept",
            "finalized_at": "",
        }
    )


def finalize_berekening(record: dict[str, Any]) -> dict[str, Any] | None:
    """Rondt een berekening af als definitief record."""
    return add_or_update_berekening(
        {
            **record,
            "status": "definitief",
            "finalized_at": _now_iso(),
        }
    )


def delete_berekening(berekening_id: str) -> bool:
    """Verwijdert een berekening op basis van id."""
    records = load_berekeningen()
    target_record = next(
        (
            record
            for record in records
            if str(record.get("id", "")) == str(berekening_id or "")
        ),
        None,
    )
    if not isinstance(target_record, dict):
        return False

    bier_id = str(target_record.get("bier_id", "") or "").strip()
    bereken_jaar = int(
        target_record.get("basisgegevens", {}).get("jaar", 0) or 0
    )
    filtered = [
        record for record in records if str(record.get("id", "")) != berekening_id
    ]
    if not save_berekeningen(filtered):
        return False

    if bier_id and bereken_jaar > 0:
        has_remaining_year_record = any(
            str(record.get("bier_id", "") or "").strip() == bier_id
            and int(record.get("basisgegevens", {}).get("jaar", 0) or 0) == bereken_jaar
            for record in filtered
            if isinstance(record, dict)
        )
        if not has_remaining_year_record:
            delete_variabele_kosten_record(bereken_jaar, bier_id)

    cleanup_unused_bieren()
    return True


def get_concept_berekeningen() -> list[dict[str, Any]]:
    """Geeft alle conceptberekeningen terug."""
    return [
        record
        for record in load_berekeningen()
        if str(record.get("status", "")) == "concept"
    ]


def get_definitieve_berekeningen() -> list[dict[str, Any]]:
    """Geeft alle definitieve berekeningen terug."""
    return [
        record
        for record in load_berekeningen()
        if str(record.get("status", "")) == "definitief"
    ]


def get_definitieve_berekeningen_for_year(year: int | str) -> list[dict[str, Any]]:
    """Geeft alle definitieve berekeningen voor een jaar terug."""
    try:
        year_value = int(year)
    except (TypeError, ValueError):
        return []

    return [
        record
        for record in get_definitieve_berekeningen()
        if int(record.get("basisgegevens", {}).get("jaar", 0) or 0) == year_value
    ]


def get_integrale_kostprijs_per_liter_for_bier(
    bier_id: str,
    year: int | str | None = None,
) -> float | None:
    """Geeft een afgeleide kostprijs per liter terug voor een specifiek of recent jaar."""
    data = load_variabele_kosten_data()
    beschikbare_jaren: list[int] = []

    for year, bier_records in data.items():
        if not str(year).isdigit() or not isinstance(bier_records, dict):
            continue
        if bier_id in bier_records and isinstance(bier_records.get(bier_id), list):
            beschikbare_jaren.append(int(year))

    if year is not None:
        try:
            target_year = int(year)
        except (TypeError, ValueError):
            return None
        beschikbare_jaren = [jaar for jaar in beschikbare_jaren if jaar == target_year]

    for bereken_jaar in sorted(beschikbare_jaren, reverse=True):
        records = get_variabele_kosten_record(bereken_jaar, bier_id)
        if not records:
            continue

        totale_batchkosten = 0.0
        for record in records:
            prijs_per_eenheid = calculate_price_per_unit(
                record.get("prijs_artikel"),
                record.get("verpakkingsinhoud"),
            )
            kosten_volgens_recept = calculate_kosten_volgens_recept(
                prijs_per_eenheid,
                record.get("benodigde_hoeveelheid_recept"),
                str(record.get("verpakkingsinhoud_eenheid", "")),
                str(record.get("benodigde_hoeveelheid_eenheid", "")),
            )
            if kosten_volgens_recept is None:
                continue
            totale_batchkosten += float(kosten_volgens_recept)

        variabele_kosten_per_liter = calculate_variabele_kosten_per_liter(
            totale_batchkosten,
            get_batchgrootte_eigen_productie_l(bereken_jaar),
        )
        if variabele_kosten_per_liter is not None:
            return variabele_kosten_per_liter

    return None


def load_variabele_kosten_data() -> dict[str, Any]:
    """Laadt alle variabele kosten veilig in."""
    return _load_json_value(VARIABELE_KOSTEN_FILE, {})


def save_variabele_kosten_data(data: dict[str, Any]) -> bool:
    """Slaat alle variabele kosten veilig op."""
    return _save_json_value(VARIABELE_KOSTEN_FILE, data, "{}")


def get_variabele_kosten_record(
    year: int | str,
    bier_id: str,
) -> list[dict[str, Any]]:
    """Haalt alle variabele kostenregels voor een jaar en bier op."""
    data = load_variabele_kosten_data()
    year_data = data.get(str(year), {})
    if not isinstance(year_data, dict):
        return []

    record = year_data.get(bier_id, [])
    return record if isinstance(record, list) else []


def upsert_variabele_kosten_record(
    year: int | str,
    bier_id: str,
    records: list[dict[str, Any]],
) -> bool:
    """Slaat variabele kosten op voor een specifieke combinatie van jaar en bier."""
    data = load_variabele_kosten_data()
    year_key = str(year)

    if year_key not in data or not isinstance(data.get(year_key), dict):
        data[year_key] = {}

    data[year_key][bier_id] = records
    return save_variabele_kosten_data(data)


def delete_variabele_kosten_record(year: int | str, bier_id: str) -> bool:
    """Verwijdert alle variabele kosten voor een specifieke combinatie."""
    data = load_variabele_kosten_data()
    year_key = str(year)

    if year_key not in data or not isinstance(data.get(year_key), dict):
        return False

    if bier_id not in data[year_key]:
        return False

    del data[year_key][bier_id]

    if not data[year_key]:
        del data[year_key]

    return save_variabele_kosten_data(data)


def calculate_price_per_unit(
    prijs_artikel: float | int | None,
    verpakkingsinhoud: float | int | None,
) -> float | None:
    """Berekent de prijs per eenheid."""
    try:
        prijs_value = float(prijs_artikel or 0.0)
        inhoud_value = float(verpakkingsinhoud or 0.0)
    except (TypeError, ValueError):
        return None

    if inhoud_value <= 0 or prijs_value < 0:
        return None

    return prijs_value / inhoud_value


def calculate_kosten_volgens_recept(
    prijs_per_eenheid: float | None,
    benodigde_hoeveelheid_recept: float | int | None,
    verpakkingsinhoud_eenheid: str,
    benodigde_hoeveelheid_eenheid: str,
) -> float | None:
    """Berekent de receptkosten wanneer de eenheden overeenkomen."""
    try:
        benodigde_value = float(benodigde_hoeveelheid_recept or 0.0)
    except (TypeError, ValueError):
        return None

    if (
        prijs_per_eenheid is None
        or benodigde_value < 0
        or verpakkingsinhoud_eenheid != benodigde_hoeveelheid_eenheid
    ):
        return None

    return prijs_per_eenheid * benodigde_value


def calculate_totale_batchkosten(records: list[dict[str, Any]]) -> float:
    """Berekent de som van alle geldige receptkosten."""
    total = 0.0

    for record in records:
        kosten = record.get("kosten_volgens_recept")
        if kosten is None:
            continue

        try:
            total += float(kosten)
        except (TypeError, ValueError):
            continue

    return total


def calculate_variabele_kosten_per_liter(
    totale_batchkosten: float,
    batchgrootte_l: float | int | None,
) -> float | None:
    """Berekent variabele kosten per liter op basis van batchgrootte."""
    if batchgrootte_l is None or float(batchgrootte_l) <= 0:
        return None

    return float(totale_batchkosten) / float(batchgrootte_l)

