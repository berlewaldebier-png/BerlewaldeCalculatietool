from __future__ import annotations

from fastapi import HTTPException, Request

from app.domain import auth_policy, auth_service


COST_DRAFT_DATASETS = frozenset({"kostprijsversies", "bieren"})
CALCULATION_SETTINGS_DATASETS = frozenset({"cost-management-settings", "cost-pools"})


def _forbidden() -> HTTPException:
    return HTTPException(status_code=403, detail="Geen rechten.")


def get_current_session(request: Request) -> dict:
    if not auth_service.auth_enabled():
        if not auth_service.auth_bypass_allowed():
            raise HTTPException(
                status_code=503,
                detail="Authenticatie is niet veilig geconfigureerd.",
            )
        token = request.cookies.get(auth_service.SESSION_COOKIE_NAME, "")
        session = auth_service.verify_session_token(token) if token else None
        if session:
            return auth_policy.enrich_session(session)
        if request.cookies.get(auth_service.LOGGED_OUT_COOKIE_NAME, "") == "1":
            raise HTTPException(status_code=401, detail="Niet ingelogd.")
        return auth_policy.enrich_session(
            {"username": "local-admin", "display_name": "Local admin", "role": "admin"}
        )
    token = request.cookies.get(auth_service.SESSION_COOKIE_NAME, "")
    session = auth_service.verify_session_token(token)
    if not session:
        raise HTTPException(status_code=401, detail="Niet ingelogd.")
    return auth_policy.enrich_session(session)


def require_user(request: Request) -> dict:
    return get_current_session(request)


def require_admin(request: Request) -> dict:
    session = get_current_session(request)
    if not auth_policy.has_capability(session, auth_policy.CAP_ADMIN):
        raise _forbidden()
    return session


def _require_capability(request: Request, capability: str) -> dict:
    session = get_current_session(request)
    if not auth_policy.has_capability(session, capability):
        raise _forbidden()
    return session


def require_users_view(request: Request) -> dict:
    return _require_capability(request, auth_policy.CAP_USERS_VIEW)


def require_users_manage(request: Request) -> dict:
    return _require_capability(request, auth_policy.CAP_USERS_MANAGE)


def require_cost_activation(request: Request) -> dict:
    return _require_capability(request, auth_policy.CAP_COSTS_ACTIVATE)


def require_cost_draft(request: Request) -> dict:
    return _require_capability(request, auth_policy.CAP_COSTS_DRAFT)


def require_quotes_manage(request: Request) -> dict:
    return _require_capability(request, auth_policy.CAP_QUOTES_MANAGE)


def require_douano_sync(request: Request) -> dict:
    return _require_capability(request, auth_policy.CAP_DOUANO_SYNC)


def require_product_mappings_manage(request: Request) -> dict:
    return _require_capability(request, auth_policy.CAP_PRODUCT_MAPPINGS_MANAGE)


def require_dataset_mutation(dataset_name: str, request: Request) -> dict:
    session = get_current_session(request)
    if auth_policy.has_capability(session, auth_policy.CAP_ADMIN):
        return session
    if dataset_name in COST_DRAFT_DATASETS and auth_policy.has_capability(
        session, auth_policy.CAP_COSTS_DRAFT
    ):
        return session
    if dataset_name in CALCULATION_SETTINGS_DATASETS and auth_policy.has_capability(
        session, auth_policy.CAP_CALCULATION_SETTINGS_MANAGE
    ):
        return session
    raise _forbidden()

