from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Literal, Mapping, Protocol, Sequence

from app.domain.cost_resolution_utils import GenericRecord, number, text


PlanningStatus = Literal[
    "resolved",
    "not_required",
    "missing_anchor",
    "ambiguous_anchor",
    "missing_cost_version",
    "missing_cost_row",
    "ambiguous_cost_row",
    "invalid_cost",
]
ActualStatus = Literal[
    "resolved_exact_lot",
    "resolved_non_lot_sku_cost",
    "no_cost_required",
    "ignored",
    "missing_sku",
    "missing_planning_year",
    "missing_planning_anchor",
    "ambiguous_planning_anchor",
    "missing_lot",
    "unknown_lot",
    "ambiguous_lot_mapping",
    "multiple_lots_per_sales_line",
    "ambiguous_exact_lot",
    "missing_canonical_lot_lineage",
    "ambiguous_direct_lot_cost",
    "missing_cost_version",
    "missing_cost_row",
    "ambiguous_cost_row",
    "invalid_cost",
]


@dataclass(frozen=True)
class CostComponents:
    purchase_ex: float
    packaging_ex: float
    indirect_ex: float
    excise_ex: float
    cost_price_ex: float


def components(row: GenericRecord) -> CostComponents:
    return CostComponents(
        purchase_ex=number(row.get("inkoop", row.get("primaire_kosten"))),
        packaging_ex=number(row.get("verpakkingskosten")),
        indirect_ex=number(row.get("indirecte_kosten", row.get("vaste_kosten"))),
        excise_ex=number(row.get("accijns")),
        cost_price_ex=number(row.get("kostprijs")),
    )


@dataclass(frozen=True)
class PlanningCostResolution:
    status: PlanningStatus
    source: str
    source_id: str = ""
    activation_id: str = ""
    cost_version_id: str = ""
    cost_row_id: str = ""
    effective_at: str = ""
    history_proven: bool = False
    components: CostComponents | None = None
    warnings: tuple[str, ...] = ()
    candidate_source_ids: tuple[str, ...] = ()
    candidate_version_ids: tuple[str, ...] = ()
    candidate_cost_row_ids: tuple[str, ...] = ()

    @property
    def cost_price_ex(self) -> float | None:
        return self.components.cost_price_ex if self.components is not None else None


@dataclass(frozen=True)
class ActualLotCostResolution:
    status: ActualStatus
    source: str
    requested_lot_id: str = ""
    resolved_lot_id: str = ""
    lot_mapping_id: str = ""
    cost_version_id: str = ""
    cost_row_id: str = ""
    components: CostComponents | None = None
    warnings: tuple[str, ...] = ()
    candidate_mapping_ids: tuple[str, ...] = ()
    candidate_lot_ids: tuple[str, ...] = ()
    candidate_version_ids: tuple[str, ...] = ()
    candidate_cost_row_ids: tuple[str, ...] = ()
    candidate_lot_cost_record_ids: tuple[str, ...] = ()

    @property
    def cost_price_ex(self) -> float | None:
        return self.components.cost_price_ex if self.components is not None else None


@dataclass(frozen=True)
class CostResolutionSnapshot:
    activations: tuple[GenericRecord, ...]
    activation_events: tuple[GenericRecord, ...]
    cost_versions: tuple[GenericRecord, ...]
    cost_rows: tuple[GenericRecord, ...]
    planning_anchors: tuple[GenericRecord, ...] = ()
    lot_lineage: tuple[GenericRecord, ...] = ()
    lot_aliases: tuple[GenericRecord, ...] = ()
    skus: tuple[GenericRecord, ...] = ()
    direct_lot_cost_records: tuple[GenericRecord, ...] = ()
    authority_mode: Literal["compatibility", "canonical"] = "compatibility"

    @classmethod
    def from_records(
        cls,
        *,
        activations: Sequence[GenericRecord],
        activation_events: Sequence[GenericRecord],
        cost_versions: Sequence[GenericRecord],
        cost_rows: Sequence[GenericRecord] = (),
        planning_anchors: Sequence[GenericRecord] = (),
        lot_lineage: Sequence[GenericRecord] = (),
        lot_aliases: Sequence[GenericRecord] = (),
        skus: Sequence[GenericRecord] = (),
        direct_lot_cost_records: Sequence[GenericRecord] = (),
        authority_mode: Literal["compatibility", "canonical"] = "compatibility",
    ) -> CostResolutionSnapshot:
        flattened_rows: list[GenericRecord] = [deepcopy(dict(row)) for row in cost_rows]
        explicit_keys = {
            (text(row.get("version_id")), text(row.get("sku_id")), text(row.get("id")))
            for row in flattened_rows
        }
        explicit_pairs = {
            (text(row.get("version_id")), text(row.get("sku_id")))
            for row in flattened_rows
            if text(row.get("version_id")) and text(row.get("sku_id"))
        }
        for version in cost_versions:
            version_id = text(version.get("id"))
            lines = version.get("cost_lines")
            if not isinstance(lines, Sequence) or isinstance(lines, (str, bytes)):
                continue
            for index, row in enumerate(lines):
                if not isinstance(row, Mapping):
                    continue
                normalized: dict[str, Any] = dict(row)
                normalized.setdefault("version_id", version_id)
                normalized.setdefault("id", f"{version_id}:{text(row.get('sku_id'))}:{index}")
                pair = (text(normalized.get("version_id")), text(normalized.get("sku_id")))
                if pair in explicit_pairs:
                    continue
                key = (*pair, text(normalized.get("id")))
                if key not in explicit_keys:
                    flattened_rows.append(normalized)
                    explicit_keys.add(key)
        return cls(
            activations=tuple(deepcopy(dict(row)) for row in activations),
            activation_events=tuple(deepcopy(dict(row)) for row in activation_events),
            cost_versions=tuple(deepcopy(dict(row)) for row in cost_versions),
            cost_rows=tuple(flattened_rows),
            planning_anchors=tuple(
                deepcopy(dict(row)) for row in planning_anchors
            ),
            lot_lineage=tuple(deepcopy(dict(row)) for row in lot_lineage),
            lot_aliases=tuple(deepcopy(dict(row)) for row in lot_aliases),
            skus=tuple(deepcopy(dict(row)) for row in skus),
            direct_lot_cost_records=tuple(
                deepcopy(dict(row)) for row in direct_lot_cost_records
            ),
            authority_mode=authority_mode,
        )


class CostResolutionSnapshotReader(Protocol):
    """Read port only. Implementations must not backfill, activate or persist."""

    def read_cost_resolution_snapshot(self) -> CostResolutionSnapshot: ...


@dataclass(frozen=True)
class CostSelectionShadowInput:
    consumer: Literal["price_proposal", "break_even", "omzet_en_marge"]
    mode: Literal["planning", "actual"]
    sku_id: str
    year: int = 0
    lot_id: str = ""
    current_status: str = ""
    current_cost_version_id: str = ""
    current_cost_row_id: str = ""


@dataclass(frozen=True)
class CostSelectionDifference:
    consumer: str
    mode: str
    sku_id: str
    year: int
    lot_id: str
    field: Literal["status", "cost_version", "cost_row"]
    reason: str
    current_source_id: str = ""
    candidate_source_id: str = ""
