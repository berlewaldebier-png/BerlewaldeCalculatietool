from __future__ import annotations

from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_ROOT = PROJECT_ROOT / "backend"

for path in (PROJECT_ROOT, BACKEND_ROOT):
    path_text = str(path)
    if path_text not in sys.path:
        sys.path.insert(0, path_text)

from app.domain import dataset_store, postgres_storage  # noqa: E402


def main() -> None:
    postgres_storage.ensure_schema()
    results = dataset_store.bootstrap_postgres_from_json(overwrite=True)

    print("PostgreSQL bootstrap resultaten")
    print("==============================")
    for dataset_name, saved in results.items():
        status = "OK" if saved else "FOUT"
        print(f"[{status}] {dataset_name}")


if __name__ == "__main__":
    main()
