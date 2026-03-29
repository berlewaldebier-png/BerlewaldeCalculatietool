from __future__ import annotations

import json
import math
import os
from urllib import error, request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
API_BASE_URL = os.getenv("CALCULATIETOOL_API_BASE_URL", "http://127.0.0.1:8000/api").rstrip("/")


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str


def load_json(name: str) -> Any:
    path = DATA_DIR / name
    return json.loads(path.read_text(encoding="utf-8-sig"))


def api_get(path: str) -> Any:
    req = request.Request(f"{API_BASE_URL}{path}", method="GET")
    with request.urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def assert_close(actual: float, expected: float, label: str, tolerance: float = 1e-9) -> None:
    if not math.isclose(actual, expected, rel_tol=tolerance, abs_tol=tolerance):
        raise AssertionError(f"{label}: verwacht {expected}, kreeg {actual}")


def find_berekening(
    rows: list[dict[str, Any]], *, biernaam: str, jaar: int, soort: str, status: str
) -> dict[str, Any]:
    for row in rows:
        basis = row.get("basisgegevens", {})
        calculation_type = row.get("soort_berekening", {})
        if (
            str(basis.get("biernaam", "") or "") == biernaam
            and int(basis.get("jaar", 0) or 0) == jaar
            and str(calculation_type.get("type", "") or "") == soort
            and str(row.get("status", "") or "") == status
        ):
            return row
    raise AssertionError(f"Berekening niet gevonden: {biernaam} {jaar} {soort} {status}")


def check_datasets_present() -> CheckResult:
    required = [
        "berekeningen.json",
        "bieren.json",
        "prijsvoorstellen.json",
        "productie.json",
        "vaste_kosten.json",
        "tarieven_heffingen.json",
        "verkoopprijzen.json",
        "verpakkingsonderdelen.json",
        "basisproducten.json",
        "samengestelde_producten.json",
    ]
    missing = [name for name in required if not (DATA_DIR / name).exists()]
    if missing:
        return CheckResult("datasets_present", False, f"Ontbrekend: {', '.join(missing)}")
    return CheckResult("datasets_present", True, "Alle kernbestanden aanwezig")


def check_storage_provider() -> CheckResult:
    try:
        status = api_get("/data/storage-status")
        provider = str(status.get("provider", "") or "")
        enabled = bool(status.get("postgres_enabled", False))
        configured = bool(status.get("postgres_configured", False))
        if provider != "postgres":
            raise AssertionError(f"provider is '{provider}' in plaats van 'postgres'")
        if not enabled or not configured:
            raise AssertionError("postgres-status is niet volledig actief/geconfigureerd")
        return CheckResult("storage_provider", True, "Backend draait op PostgreSQL-provider")
    except error.URLError as exc:
        return CheckResult("storage_provider", False, f"API niet bereikbaar: {exc}")
    except Exception as exc:
        return CheckResult("storage_provider", False, str(exc))


def check_ipa_inkoop() -> CheckResult:
    try:
        rows = api_get("/data/berekeningen")
        ipa = find_berekening(
            rows,
            biernaam="Berlewalde Ipa",
            jaar=2025,
            soort="Inkoop",
            status="definitief",
        )
        inkoop = ((ipa.get("invoer", {}) or {}).get("inkoop", {}) or {})
        facturen = inkoop.get("facturen", []) or []
        if len(facturen) != 2:
            raise AssertionError(f"verwacht 2 facturen, kreeg {len(facturen)}")

        total_liters = 0.0
        total_amount = 0.0
        total_extra = 0.0
        for factuur in facturen:
            total_extra += float(factuur.get("verzendkosten", 0.0) or 0.0)
            total_extra += float(factuur.get("overige_kosten", 0.0) or 0.0)
            for regel in factuur.get("factuurregels", []) or []:
                total_liters += float(regel.get("liters", 0.0) or 0.0)
                total_amount += float(regel.get("subfactuurbedrag", 0.0) or 0.0)

        snapshot = ipa.get("resultaat_snapshot", {}) or {}
        assert_close(total_liters, 4029.5, "IPA liters")
        assert_close(total_amount, 11552.28, "IPA subfacturen")
        assert_close(total_extra, 300.0, "IPA extra kosten")
        assert_close(
            float(snapshot.get("integrale_kostprijs_per_liter", 0.0) or 0.0),
            2.9747106754353307,
            "IPA integrale kostprijs",
        )
        assert_close(
            float(snapshot.get("variabele_kosten_per_liter", 0.0) or 0.0),
            2.9413773421019975,
            "IPA variabele kostprijs",
        )
        assert_close(
            float(snapshot.get("directe_vaste_kosten_per_liter", 0.0) or 0.0),
            0.03333333333333333,
            "IPA directe vaste kosten",
        )
        return CheckResult("ipa_inkoop", True, "IPA 2025 inkoop klopt inclusief 2 facturen")
    except Exception as exc:
        return CheckResult("ipa_inkoop", False, str(exc))


def check_goudkoorts_eigen_productie() -> CheckResult:
    try:
        rows = api_get("/data/berekeningen")
        goudkoorts = find_berekening(
            rows,
            biernaam="Berlewalde Goudkoorts",
            jaar=2025,
            soort="Eigen productie",
            status="definitief",
        )
        ingredienten = (
            (((goudkoorts.get("invoer", {}) or {}).get("ingredienten", {}) or {}).get("regels", []))
            or []
        )
        if len(ingredienten) != 1:
            raise AssertionError(f"verwacht 1 ingrediëntregel, kreeg {len(ingredienten)}")
        ingredient = ingredienten[0]
        if str(ingredient.get("omschrijving", "") or "") != "Honing":
            raise AssertionError("verwacht ingrediënt 'Honing'")

        snapshot = goudkoorts.get("resultaat_snapshot", {}) or {}
        producten = snapshot.get("producten", {}) or {}
        basisproducten = producten.get("basisproducten", []) or []
        samengestelde = producten.get("samengestelde_producten", []) or []
        assert_close(
            float(snapshot.get("integrale_kostprijs_per_liter", 0.0) or 0.0),
            0.1,
            "Goudkoorts integrale kostprijs",
        )
        assert_close(
            float(snapshot.get("variabele_kosten_per_liter", 0.0) or 0.0),
            0.1,
            "Goudkoorts variabele kostprijs",
        )
        if len(basisproducten) < 3:
            raise AssertionError("verwacht minstens 3 basisproducten in snapshot")
        if len(samengestelde) < 4:
            raise AssertionError("verwacht minstens 4 samengestelde producten in snapshot")
        return CheckResult(
            "goudkoorts_eigen_productie",
            True,
            "Goudkoorts 2025 eigen productie en productsnapshot kloppen",
        )
    except Exception as exc:
        return CheckResult("goudkoorts_eigen_productie", False, str(exc))


def check_prijsvoorstel() -> CheckResult:
    try:
        rows = api_get("/data/prijsvoorstellen")
        voorstel = next(
            row for row in rows if str(row.get("offertenummer", "") or "") == "202603001"
        )
        if str(voorstel.get("klantnaam", "") or "") != "Berendhaus":
            raise AssertionError("klantnaam prijsvoorstel is niet Berendhaus")
        if int(voorstel.get("jaar", 0) or 0) != 2025:
            raise AssertionError("prijsvoorstel jaar is niet 2025")
        if str(voorstel.get("kanaal", "") or "") != "horeca":
            raise AssertionError("prijsvoorstel kanaal is niet horeca")
        if len(voorstel.get("product_rows", []) or []) != 6:
            raise AssertionError("verwacht 6 product_rows")
        if len(voorstel.get("staffels", []) or []) != 1:
            raise AssertionError("verwacht 1 staffel")
        return CheckResult(
            "prijsvoorstel_berendhaus",
            True,
            "Prijsvoorstel 202603001 is aanwezig met de verwachte kernwaarden",
        )
    except Exception as exc:
        return CheckResult("prijsvoorstel_berendhaus", False, str(exc))


def check_jaarbasis() -> CheckResult:
    try:
        productie = api_get("/data/productie")
        vaste_kosten = api_get("/data/vaste-kosten")
        tarieven = api_get("/data/tarieven-heffingen")
        if "2025" not in productie or "2026" not in productie:
            raise AssertionError("productie mist jaar 2025 of 2026")
        if "2025" not in vaste_kosten:
            raise AssertionError("vaste_kosten mist jaar 2025")
        if not any(int(row.get("jaar", 0) or 0) == 2025 for row in tarieven):
            raise AssertionError("tarieven_heffingen mist jaar 2025")
        return CheckResult("jaarbasis", True, "Jaarbasis 2025/2026 aanwezig in kernbestanden")
    except Exception as exc:
        return CheckResult("jaarbasis", False, str(exc))


def main() -> int:
    results = [
        check_datasets_present(),
        check_storage_provider(),
        check_ipa_inkoop(),
        check_goudkoorts_eigen_productie(),
        check_prijsvoorstel(),
        check_jaarbasis(),
    ]

    print("Regressiecheck resultaten")
    print("=========================")
    failures = 0
    for result in results:
        status = "OK" if result.ok else "FAIL"
        print(f"[{status}] {result.name}: {result.detail}")
        if not result.ok:
            failures += 1

    if failures:
        print("")
        print(f"Afgerond met {failures} fout(en).")
        return 1

    print("")
    print("Alle regressiechecks geslaagd.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
