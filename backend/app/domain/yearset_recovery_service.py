from __future__ import annotations

import copy
from typing import Any

from app.domain import (
    postgres_storage,
    yearset_blocker_lineage_service,
    yearset_reconciliation_service,
    yearset_recovery_projection,
    yearset_recovery_storage,
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _request_payload(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    return copy.deepcopy(value) if isinstance(value, dict) else {}


def _review_context(
    connection: Any,
    *,
    source_year: int,
    target_year: int,
) -> dict[str, Any]:
    snapshot = yearset_reconciliation_service.read_reconciliation_snapshot(
        connection,
        source_year=int(source_year),
        target_year=int(target_year),
    )
    # A replacement decision is always reviewed against the unmodified legacy
    # evidence, never against a previously approved recovery projection.
    snapshot.pop("approved_recovery_input", None)
    base_plan = yearset_reconciliation_service.build_reconciliation_plan(snapshot)
    worklist = yearset_reconciliation_service.build_blocker_worklist(base_plan)
    sku_ids = {
        _text((row.get("subject") or {}).get("sku_id"))
        for row in worklist.get("work_items", [])
        if isinstance(row, dict)
        and _text((row.get("subject") or {}).get("sku_id"))
    }
    evidence = yearset_blocker_lineage_service.read_lineage_evidence(
        connection,
        source_year=int(source_year),
        target_year=int(target_year),
        sku_ids=sku_ids,
    )
    lineage_review = yearset_blocker_lineage_service.build_lineage_review(
        plan=base_plan,
        worklist=worklist,
        evidence=evidence,
    )
    return {
        "snapshot": snapshot,
        "base_plan": base_plan,
        "lineage_review": lineage_review,
    }


def _projection(
    context: dict[str, Any],
    *,
    request: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    decision = yearset_recovery_projection.build_recovery_decision(
        snapshot=context["snapshot"],
        base_plan=context["base_plan"],
        lineage_review=context["lineage_review"],
        request=request,
    )
    candidate = yearset_reconciliation_service.build_reconciliation_plan(
        {
            **context["snapshot"],
            "approved_recovery_input": decision,
        }
    )
    return decision, candidate


def _public_projection(
    *,
    decision: dict[str, Any],
    candidate: dict[str, Any],
    persisted: bool,
) -> dict[str, Any]:
    payload = decision.get("payload") or {}
    return {
        "version": yearset_recovery_projection.RECOVERY_VERSION,
        "source_year": int(decision.get("source_year", 0) or 0),
        "target_year": int(decision.get("target_year", 0) or 0),
        "decision_id": _text(decision.get("id")),
        "decision_hash": _text(decision.get("decision_hash")),
        "lineage_review_hash": _text(decision.get("lineage_review_hash")),
        "base_manifest_hash": _text(decision.get("base_manifest_hash")),
        "candidate_manifest_hash": _text(candidate.get("manifest_hash")),
        "candidate_validation_hash": _text(candidate.get("validation_hash")),
        "ready": bool(candidate.get("ready")),
        "candidate_summary": copy.deepcopy(candidate.get("summary", {})),
        "candidate_blocker_counts": copy.deepcopy(
            candidate.get("blocker_counts", {})
        ),
        "plan_reconstruction_proof": copy.deepcopy(
            payload.get("plan_proof", {})
        ),
        "excluded_sku_ids": list(payload.get("excluded_sku_ids", [])),
        "exact_target_anchor_sku_ids": [
            _text(row.get("sku_id"))
            for row in payload.get("exact_target_anchor_decisions", [])
            if isinstance(row, dict)
        ],
        "pricing_override_sku_ids": [
            _text(row.get("sku_id"))
            for row in payload.get("pricing_overrides", [])
            if isinstance(row, dict)
        ],
        "persisted": bool(persisted),
        "write_authorized": bool(persisted),
        "legacy_target_untouched": True,
        "consumer_mode": "compatibility_only",
        "data_rewritten": False,
    }


def preview(request: Any) -> dict[str, Any]:
    payload = _request_payload(request)
    source_year = int(payload.get("source_year", 0) or 0)
    target_year = int(payload.get("target_year", 0) or 0)
    if source_year <= 0 or target_year <= source_year:
        raise ValueError("Gebruik expliciet 0 < source_year < target_year.")
    with postgres_storage.connect() as connection:
        try:
            connection.rollback()
        except Exception:
            pass
        with connection.transaction():
            connection.execute(
                "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
            )
            context = _review_context(
                connection,
                source_year=source_year,
                target_year=target_year,
            )
            decision, candidate = _projection(context, request=payload)
            return _public_projection(
                decision=decision,
                candidate=candidate,
                persisted=False,
            )


def approve(
    request: Any,
    *,
    actor: str,
    actor_role: str,
) -> dict[str, Any]:
    if _text(actor_role) != "management":
        raise PermissionError(
            "Alleen Management mag de expliciete jaarset-herstelinput goedkeuren."
        )
    payload = _request_payload(request)
    expected_decision_hash = _text(payload.get("expected_decision_hash"))
    if not expected_decision_hash:
        raise ValueError(
            "expected_decision_hash uit een actuele preview is verplicht."
        )
    source_year = int(payload.get("source_year", 0) or 0)
    target_year = int(payload.get("target_year", 0) or 0)
    if source_year <= 0 or target_year <= source_year:
        raise ValueError("Gebruik expliciet 0 < source_year < target_year.")

    yearset_reconciliation_service.ensure_dependencies()
    with postgres_storage.transaction() as connection:
        yearset_reconciliation_service._lock_snapshot(connection)
        context = _review_context(
            connection,
            source_year=source_year,
            target_year=target_year,
        )
        decision, candidate = _projection(context, request=payload)
        if expected_decision_hash != _text(decision.get("decision_hash")):
            raise yearset_recovery_storage.YearsetRecoveryConflict(
                "De herstelpreview is verouderd; maak eerst een nieuwe preview."
            )
        persisted = yearset_recovery_storage.approve_input(
            input_id=_text(decision.get("id")),
            source_year=source_year,
            target_year=target_year,
            lineage_review_hash=_text(decision.get("lineage_review_hash")),
            base_manifest_hash=_text(decision.get("base_manifest_hash")),
            decision_hash=_text(decision.get("decision_hash")),
            payload=decision.get("payload") or {},
            actor=_text(actor),
            actor_role=_text(actor_role),
            reason=_text(payload.get("reason")),
            connection=connection,
        )
        return {
            **_public_projection(
                decision=decision,
                candidate=candidate,
                persisted=True,
            ),
            "recovery_input": persisted,
        }
