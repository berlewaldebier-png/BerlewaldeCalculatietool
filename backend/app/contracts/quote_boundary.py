from __future__ import annotations

from typing import Any, Literal, TypedDict, cast


QuoteRecord = dict[str, Any]


class QuoteListResponse(TypedDict):
    items: list[QuoteRecord]


class QuoteDeleteResponse(TypedDict, total=False):
    deleted: int
    ok: bool


class ContractDeviation(TypedDict):
    path: str
    expected: str
    actual: str
    kind: Literal["type", "legacy_alias"]


def quote_list_response(items: list[QuoteRecord]) -> QuoteListResponse:
    """Wrap storage rows without copying, filtering or normalizing them."""

    return {"items": items}


def adapt_quote_delete_response(
    payload: dict[str, Any],
) -> tuple[QuoteDeleteResponse, tuple[ContractDeviation, ...]]:
    """Expose a typed view while retaining the backend payload byte-semantically.

    Storage currently returns an integer row count under ``deleted``. Historical
    callers declared an ``ok`` boolean, so that alias remains tolerated and is
    surfaced as a deviation instead of being converted or rejected.
    """

    deviations: list[ContractDeviation] = []
    if "deleted" in payload and (isinstance(payload["deleted"], bool) or not isinstance(payload["deleted"], int)):
        deviations.append(
            {
                "path": "$.deleted",
                "expected": "integer",
                "actual": _value_kind(payload["deleted"]),
                "kind": "type",
            }
        )
    if "deleted" not in payload and isinstance(payload.get("ok"), bool):
        deviations.append(
            {
                "path": "$.ok",
                "expected": "deleted integer",
                "actual": "legacy ok boolean",
                "kind": "legacy_alias",
            }
        )

    return cast(QuoteDeleteResponse, payload), tuple(deviations)


def _value_kind(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__
