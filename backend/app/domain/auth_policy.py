from __future__ import annotations

from typing import Any


ROLE_ADMIN = "admin"
ROLE_MANAGEMENT = "management"
ROLE_BREWER = "brewer"
ROLE_SALES = "sales"
ROLE_LEGACY_USER = "user"

ASSIGNABLE_ROLES = (ROLE_ADMIN, ROLE_MANAGEMENT, ROLE_BREWER, ROLE_SALES)
SUPPORTED_ROLES = (*ASSIGNABLE_ROLES, ROLE_LEGACY_USER)

CAP_ADMIN = "admin:all"
CAP_USERS_VIEW = "users:view"
CAP_USERS_MANAGE = "users:manage"
CAP_COSTS_VIEW = "costs:view"
CAP_COSTS_DRAFT = "costs:draft"
CAP_COSTS_ACTIVATE = "costs:activate"
CAP_QUOTES_MANAGE = "quotes:manage"
CAP_DOUANO_SYNC = "douano:sync"
CAP_CALCULATION_SETTINGS_MANAGE = "calculation-settings:manage"
CAP_PRODUCT_MAPPINGS_MANAGE = "product-mappings:manage"
CAP_FORECAST_VIEW = "forecast:view"
CAP_FORECAST_MANAGE = "forecast:manage"

ALL_CAPABILITIES = frozenset(
    {
        CAP_ADMIN,
        CAP_USERS_VIEW,
        CAP_USERS_MANAGE,
        CAP_COSTS_VIEW,
        CAP_COSTS_DRAFT,
        CAP_COSTS_ACTIVATE,
        CAP_QUOTES_MANAGE,
        CAP_DOUANO_SYNC,
        CAP_CALCULATION_SETTINGS_MANAGE,
        CAP_PRODUCT_MAPPINGS_MANAGE,
        CAP_FORECAST_VIEW,
        CAP_FORECAST_MANAGE,
    }
)

ROLE_CAPABILITIES: dict[str, frozenset[str]] = {
    ROLE_ADMIN: ALL_CAPABILITIES,
    ROLE_MANAGEMENT: frozenset(
        {
            CAP_USERS_VIEW,
            CAP_COSTS_VIEW,
            CAP_COSTS_DRAFT,
            CAP_COSTS_ACTIVATE,
            CAP_QUOTES_MANAGE,
            CAP_CALCULATION_SETTINGS_MANAGE,
            CAP_FORECAST_VIEW,
            CAP_FORECAST_MANAGE,
        }
    ),
    ROLE_BREWER: frozenset({CAP_COSTS_VIEW, CAP_COSTS_DRAFT}),
    ROLE_SALES: frozenset({CAP_COSTS_VIEW, CAP_QUOTES_MANAGE}),
    # Compatibility for existing persisted users. New assignments use `sales`.
    ROLE_LEGACY_USER: frozenset({CAP_COSTS_VIEW, CAP_QUOTES_MANAGE}),
}

ROLE_LABELS: dict[str, str] = {
    ROLE_ADMIN: "Administrator",
    ROLE_MANAGEMENT: "Management (CEO/CFO)",
    ROLE_BREWER: "Brouwer",
    ROLE_SALES: "Sales",
    ROLE_LEGACY_USER: "Gebruiker (legacy)",
}


def normalize_role(role: Any) -> str:
    # Role matching intentionally remains case-sensitive. RF-002 established
    # this as part of the current authorization contract.
    return str(role or "").strip()


def capabilities_for_role(role: Any) -> tuple[str, ...]:
    return tuple(sorted(ROLE_CAPABILITIES.get(normalize_role(role), frozenset())))


def has_capability(subject: dict[str, Any] | str | None, capability: str) -> bool:
    role = subject.get("role", "") if isinstance(subject, dict) else subject
    return str(capability or "") in ROLE_CAPABILITIES.get(normalize_role(role), frozenset())


def enrich_session(session: dict[str, Any]) -> dict[str, Any]:
    enriched = dict(session)
    enriched["capabilities"] = list(capabilities_for_role(session.get("role", "")))
    return enriched


def is_supported_role(role: Any) -> bool:
    return normalize_role(role) in SUPPORTED_ROLES
