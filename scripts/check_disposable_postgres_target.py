from __future__ import annotations

from disposable_postgres_guard import (
    assert_disposable_database_url,
    database_url_from_environment,
)


def main() -> None:
    target = assert_disposable_database_url(database_url_from_environment())
    print(
        "Disposable PostgreSQL target confirmed: "
        f"host={target.host} database={target.database}"
    )


if __name__ == "__main__":
    main()
