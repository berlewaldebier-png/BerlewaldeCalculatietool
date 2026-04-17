"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DatasetTableEditor } from "@/components/DatasetTableEditor";
import { NestedCollectionEditor } from "@/components/NestedCollectionEditor";
import { API_BASE_URL } from "@/lib/api";

type GenericRecord = Record<string, unknown>;

type ProductenVerpakkingWorkspaceProps = {
  verpakkingsonderdelen: GenericRecord[];
  basisproducten: GenericRecord[];
  samengesteldeProducten: GenericRecord[];
  catalogusproducten: GenericRecord[];
  verpakkingsonderdeelPrijzen: GenericRecord[];
  bieren: GenericRecord[];
};

type SortDirection = "asc" | "desc";

type YearOverviewRow = {
  jaar: number;
  aantalOnderdelen: number;
  ingevuld: number;
};

type CostOverviewRow = {
  id: string;
  naam: string;
  type: string;
  costs: Record<number, number>;
};

function determineDefaultYear(prijsRows: GenericRecord[]) {
  const years = prijsRows
    .map((row) => Number(row.jaar ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  return years.length > 0 ? Math.max(...years) : new Date().getFullYear();
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function createLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildPriceRows(
  verpakkingsonderdelen: GenericRecord[],
  verpakkingsonderdeelPrijzen: GenericRecord[]
) {
  const descriptionById = new Map(
    verpakkingsonderdelen.map((row) => [String(row.id ?? ""), String(row.omschrijving ?? "")])
  );

  return verpakkingsonderdeelPrijzen.map((row) => ({
    id: String(row.id ?? ""),
    verpakkingsonderdeel_id: String(row.verpakkingsonderdeel_id ?? ""),
    omschrijving:
      descriptionById.get(String(row.verpakkingsonderdeel_id ?? "")) ??
      String(row.omschrijving ?? ""),
    jaar: Number(row.jaar ?? new Date().getFullYear()),
    prijs_per_stuk: Number(row.prijs_per_stuk ?? 0)
  }));
}

function findPreviousPriceYear(rows: GenericRecord[], selectedYear: number) {
  const previousYears = rows
    .map((row) => Number(row.jaar ?? 0))
    .filter((year) => Number.isFinite(year) && year > 0 && year < selectedYear);

  return previousYears.length > 0 ? Math.max(...previousYears) : null;
}

function getNextDuplicateYear(existingYears: number[], sourceYear: number) {
  let candidate = sourceYear + 1;
  const yearSet = new Set(existingYears);
  while (yearSet.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

function DuplicateIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9h10v10H9z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 7V5h6v2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l1 12h8l1-12" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 11v5M14 11v5" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="svg-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      style={{
        transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 120ms ease"
      }}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SortIcon({ direction }: { direction: SortDirection | null }) {
  return (
    <svg viewBox="0 0 24 24" className="svg-icon" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="m8 10 4-4 4 4" opacity={direction === "desc" ? 0.35 : 1} />
      <path strokeLinecap="round" strokeLinejoin="round" d="m16 14-4 4-4-4" opacity={direction === "asc" ? 0.35 : 1} />
    </svg>
  );
}

export function ProductenVerpakkingWorkspace({
  verpakkingsonderdelen,
  basisproducten,
  samengesteldeProducten,
  catalogusproducten,
  verpakkingsonderdeelPrijzen,
  bieren
}: ProductenVerpakkingWorkspaceProps) {
  const router = useRouter();
  const verpakkingsonderdelenRows = Array.isArray(verpakkingsonderdelen) ? verpakkingsonderdelen : [];
  const basisproductenRows = Array.isArray(basisproducten) ? basisproducten : [];
  const samengesteldeProductenRows = Array.isArray(samengesteldeProducten)
    ? samengesteldeProducten
    : [];
  const catalogusproductenRows = Array.isArray(catalogusproducten) ? catalogusproducten : [];
  const verpakkingsonderdeelPrijsRows = Array.isArray(verpakkingsonderdeelPrijzen)
    ? verpakkingsonderdeelPrijzen
    : [];
  const bierenRows = Array.isArray(bieren) ? bieren : [];

  const [activeTab, setActiveTab] = useState<
    "onderdelen" | "basis" | "samengesteld" | "catalogus" | "jaarprijzen" | "kostenoverzicht"
  >("onderdelen");
  const [priceStatus, setPriceStatus] = useState("");
  const [isSavingPrices, setIsSavingPrices] = useState(false);
  const [yearOverviewSort, setYearOverviewSort] = useState<{ key: keyof YearOverviewRow; direction: SortDirection }>({
    key: "jaar",
    direction: "desc"
  });
  const [costOverviewSort, setCostOverviewSort] = useState<{ key: "type" | "naam" | number; direction: SortDirection }>({
    key: "type",
    direction: "asc"
  });

  const defaultYear = useMemo(
    () => determineDefaultYear(verpakkingsonderdeelPrijsRows),
    [verpakkingsonderdeelPrijsRows]
  );

  const [expandedPriceYear, setExpandedPriceYear] = useState<number | null>(null);

  const packagingComponentOptions = useMemo(
    () =>
      verpakkingsonderdelenRows.map((row) => {
        const id = String(row.id ?? "");
        return {
          value: id,
          label: String(row.omschrijving ?? ""),
          payload: {
            omschrijving: String(row.omschrijving ?? ""),
            verpakkingsonderdeel_id: id
          }
        };
      }),
    [verpakkingsonderdelenRows]
  );

  const basisproductOptions = useMemo(
    () => [
      ...basisproductenRows.map((row) => {
        const id = String(row.id ?? "");
        const inhoud = Number(row.inhoud_per_eenheid_liter ?? 0);
        return {
          value: id,
          label: String(row.omschrijving ?? ""),
          payload: {
            omschrijving: String(row.omschrijving ?? ""),
            basisproduct_id: id,
            inhoud_per_eenheid_liter: inhoud
          }
        };
      }),
      ...verpakkingsonderdelenRows
        .filter((row) => Boolean(row.beschikbaar_voor_samengesteld))
        .map((row) => {
          const id = String(row.id ?? "");
          const componentRef = `verpakkingsonderdeel:${id}`;
          return {
            value: componentRef,
            label: String(row.omschrijving ?? ""),
            payload: {
              omschrijving: String(row.omschrijving ?? ""),
              basisproduct_id: componentRef,
              inhoud_per_eenheid_liter: 0
            }
          };
      })
    ],
    [basisproductenRows, verpakkingsonderdelenRows]
  );

  const bierOptions = useMemo(
    () =>
      bierenRows
        .filter((row) => row && typeof row === "object")
        .map((row) => {
          const id = String((row as any).id ?? "");
          return {
            value: id,
            label: String((row as any).biernaam ?? (row as any).naam ?? id),
            payload: { bier_id: id }
          };
        })
        .filter((row) => row.value),
    [bierenRows]
  );

  const usageByComponentId = useMemo(() => {
    const usage = new Map<string, number>();
    basisproductenRows.forEach((basisproduct) => {
      const onderdelen = Array.isArray(basisproduct.onderdelen)
        ? (basisproduct.onderdelen as GenericRecord[])
        : [];
      onderdelen.forEach((onderdeel) => {
        const componentId = String(onderdeel.verpakkingsonderdeel_id ?? "");
        if (!componentId) {
          return;
        }
        usage.set(componentId, (usage.get(componentId) ?? 0) + 1);
      });
    });
    samengesteldeProductenRows.forEach((samengesteldProduct) => {
      const basisproducten = Array.isArray(samengesteldProduct.basisproducten)
        ? (samengesteldProduct.basisproducten as GenericRecord[])
        : [];
      basisproducten.forEach((onderdeel) => {
        const basisproductId = String(onderdeel.basisproduct_id ?? "");
        if (!basisproductId.startsWith("verpakkingsonderdeel:")) {
          return;
        }
        const componentId = basisproductId.replace("verpakkingsonderdeel:", "");
        if (!componentId) {
          return;
        }
        usage.set(componentId, (usage.get(componentId) ?? 0) + 1);
      });
    });
    return usage;
  }, [basisproductenRows, samengesteldeProductenRows]);

  const packagingPriceRows = useMemo(
    () => buildPriceRows(verpakkingsonderdelenRows, verpakkingsonderdeelPrijsRows),
    [verpakkingsonderdelenRows, verpakkingsonderdeelPrijsRows]
  );

  const [allPriceRows, setAllPriceRows] = useState<GenericRecord[]>(packagingPriceRows);

  useEffect(() => {
    setAllPriceRows(packagingPriceRows);
  }, [packagingPriceRows]);

  const availablePriceYears = useMemo(() => {
    const years = new Set<number>();
    allPriceRows.forEach((row) => {
      const year = Number(row.jaar ?? 0);
      if (Number.isFinite(year) && year > 0) {
        years.add(year);
      }
    });
    return [...years].sort((left, right) => right - left);
  }, [allPriceRows]);

  const latestOverviewYears = useMemo(() => availablePriceYears.slice(0, 5), [availablePriceYears]);

  const componentPriceByYear = useMemo(() => {
    const result = new Map<number, Map<string, number>>();
    allPriceRows.forEach((row) => {
      const year = Number(row.jaar ?? 0);
      const componentId = String(row.verpakkingsonderdeel_id ?? "");
      if (!year || !componentId) {
        return;
      }
      if (!result.has(year)) {
        result.set(year, new Map<string, number>());
      }
      result.get(year)?.set(componentId, Number(row.prijs_per_stuk ?? 0));
    });
    return result;
  }, [allPriceRows]);

  const basisProductCostByYear = useMemo(() => {
    const result = new Map<number, Map<string, number>>();

    latestOverviewYears.forEach((year) => {
      const componentPrices = componentPriceByYear.get(year) ?? new Map<string, number>();
      const yearCosts = new Map<string, number>();

      basisproductenRows.forEach((basisproduct) => {
        const basisproductId = String(basisproduct.id ?? "");
        const onderdelen = Array.isArray(basisproduct.onderdelen)
          ? (basisproduct.onderdelen as GenericRecord[])
          : [];

        const total = onderdelen.reduce((sum, onderdeel) => {
          const componentId = String(onderdeel.verpakkingsonderdeel_id ?? "");
          const quantity = Number(onderdeel.hoeveelheid ?? 0);
          return sum + (componentPrices.get(componentId) ?? 0) * quantity;
        }, 0);

        yearCosts.set(basisproductId, total);
      });

      result.set(year, yearCosts);
    });

    return result;
  }, [basisproductenRows, componentPriceByYear, latestOverviewYears]);

  const costOverviewRows = useMemo<CostOverviewRow[]>(() => {
    function resolveCompositeCost(
      row: GenericRecord,
      year: number,
      stack = new Set<string>()
    ): number {
      const compositeId = String(row.id ?? "");
      if (compositeId && stack.has(compositeId)) {
        return 0;
      }

      const nextStack = new Set(stack);
      if (compositeId) {
        nextStack.add(compositeId);
      }

      const componentPrices = componentPriceByYear.get(year) ?? new Map<string, number>();
      const basisCosts = basisProductCostByYear.get(year) ?? new Map<string, number>();
      const onderdelen = Array.isArray(row.basisproducten)
        ? (row.basisproducten as GenericRecord[])
        : [];

      return onderdelen.reduce((sum, onderdeel) => {
        const basisproductId = String(onderdeel.basisproduct_id ?? "");
        const aantal = Number(onderdeel.aantal ?? 0);

        if (basisproductId.startsWith("verpakkingsonderdeel:")) {
          const componentId = basisproductId.replace("verpakkingsonderdeel:", "");
          return sum + (componentPrices.get(componentId) ?? 0) * aantal;
        }

        if (basisCosts.has(basisproductId)) {
          return sum + (basisCosts.get(basisproductId) ?? 0) * aantal;
        }

        const nestedComposite = samengesteldeProductenRows.find(
          (candidate) => String(candidate.id ?? "") === basisproductId
        );
        if (nestedComposite) {
          return sum + resolveCompositeCost(nestedComposite, year, nextStack) * aantal;
        }

        return sum;
      }, 0);
    }

    const basisRows = basisproductenRows.map((row) => ({
      id: `basis:${String(row.id ?? "")}`,
      naam: String(row.omschrijving ?? ""),
      type: "Basisproduct",
      costs: Object.fromEntries(
        latestOverviewYears.map((year) => [
          year,
          basisProductCostByYear.get(year)?.get(String(row.id ?? "")) ?? 0
        ])
      )
    }));

    const compositeRows = samengesteldeProductenRows.map((row) => ({
      id: `samengesteld:${String(row.id ?? "")}`,
      naam: String(row.omschrijving ?? ""),
      type: "Samengesteld",
      costs: Object.fromEntries(
        latestOverviewYears.map((year) => [year, resolveCompositeCost(row, year)])
      )
    }));

    const typeOrder = new Map<string, number>([
      ["Basisproduct", 0],
      ["Samengesteld", 1]
    ]);

    return [...basisRows, ...compositeRows].sort((left, right) => {
      const directionFactor = costOverviewSort.direction === "asc" ? 1 : -1;

      if (costOverviewSort.key === "type") {
        const typeDiff = (typeOrder.get(left.type) ?? 99) - (typeOrder.get(right.type) ?? 99);
        if (typeDiff !== 0) {
          return typeDiff * directionFactor;
        }
        return left.naam.localeCompare(right.naam, "nl-NL");
      }

      if (costOverviewSort.key === "naam") {
        return left.naam.localeCompare(right.naam, "nl-NL") * directionFactor;
      }

      return ((left.costs[costOverviewSort.key] ?? 0) - (right.costs[costOverviewSort.key] ?? 0)) * directionFactor;
    });
  }, [
    basisProductCostByYear,
    basisproductenRows,
    componentPriceByYear,
    costOverviewSort,
    latestOverviewYears,
    samengesteldeProductenRows
  ]);

  const yearOverviewRows = useMemo<YearOverviewRow[]>(() => {
      const rows = availablePriceYears.map((year) => {
        const yearRows = allPriceRows.filter((row) => Number(row.jaar ?? 0) === year);
        const pricedCount = yearRows.filter((row) => Number(row.prijs_per_stuk ?? 0) > 0).length;
        return {
          jaar: year,
          aantalOnderdelen: verpakkingsonderdelenRows.length,
          ingevuld: pricedCount
        };
      });

      return [...rows].sort((left, right) => {
        const directionFactor = yearOverviewSort.direction === "asc" ? 1 : -1;
        if (yearOverviewSort.key === "jaar") {
          return (left.jaar - right.jaar) * directionFactor;
        }
        if (yearOverviewSort.key === "aantalOnderdelen") {
          return (left.aantalOnderdelen - right.aantalOnderdelen) * directionFactor;
        }
        return (left.ingevuld - right.ingevuld) * directionFactor;
      });
    },
    [allPriceRows, availablePriceYears, verpakkingsonderdelenRows.length, yearOverviewSort]
  );

  const expandedYearRows = useMemo(() => {
    if (!expandedPriceYear) {
      return [];
    }

    const existingByComponentId = new Map(
      allPriceRows
        .filter((row) => Number(row.jaar ?? 0) === expandedPriceYear)
        .map((row) => [String(row.verpakkingsonderdeel_id ?? ""), row])
    );

    return verpakkingsonderdelenRows
      .map((onderdeel) => {
        const componentId = String(onderdeel.id ?? "");
        const existing = existingByComponentId.get(componentId);
        return {
          id: String(existing?.id ?? ""),
          verpakkingsonderdeel_id: componentId,
          omschrijving: String(onderdeel.omschrijving ?? ""),
          jaar: expandedPriceYear,
          prijs_per_stuk: Number(existing?.prijs_per_stuk ?? 0)
        };
      })
      .sort((left, right) =>
        String(left.omschrijving).localeCompare(String(right.omschrijving), "nl-NL")
      );
  }, [allPriceRows, expandedPriceYear, verpakkingsonderdelenRows]);

  function mergeYearRows(targetYear: number, rowsForYear: GenericRecord[]) {
    setAllPriceRows((current) => {
      const otherYears = current.filter((row) => Number(row.jaar ?? 0) !== targetYear);
      return [...otherYears, ...rowsForYear];
    });
  }

  function updateExpandedYearPrice(componentId: string, value: number) {
    if (!expandedPriceYear) {
      return;
    }

    const rowsForYear = expandedYearRows.map((row) =>
      String(row.verpakkingsonderdeel_id ?? "") === componentId
        ? { ...row, prijs_per_stuk: value }
        : row
    );
    mergeYearRows(expandedPriceYear, rowsForYear);
  }

  async function persistPriceRows(nextRows: GenericRecord[], successMessage: string) {
    setPriceStatus("");
    setIsSavingPrices(true);

    try {
      const payload = nextRows
        .map((row) => ({
          id: String(row.id ?? ""),
          verpakkingsonderdeel_id: String(row.verpakkingsonderdeel_id ?? ""),
          jaar: Number(row.jaar ?? 0),
          prijs_per_stuk: Number(row.prijs_per_stuk ?? 0)
        }))
        .filter((row) => row.verpakkingsonderdeel_id && row.jaar > 0);

      const response = await fetch(`${API_BASE_URL}/data/dataset/packaging-component-prices`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("Opslaan mislukt");
      }

      setAllPriceRows(payload);
      setPriceStatus(successMessage);
      router.refresh();
    } catch {
      setPriceStatus("Opslaan van jaarprijzen mislukt.");
    } finally {
      setIsSavingPrices(false);
    }
  }

  async function saveExpandedYearPrices() {
    if (!expandedPriceYear) {
      return;
    }

    await persistPriceRows(allPriceRows, `Jaarprijzen voor ${expandedPriceYear} opgeslagen.`);
  }

  async function duplicatePriceYear(sourceYear: number) {
    const targetYear = getNextDuplicateYear(availablePriceYears, sourceYear);
    const rowsToCopy = allPriceRows
      .filter((row) => Number(row.jaar ?? 0) === sourceYear)
      .map((row) => ({
        id: createLocalId(),
        verpakkingsonderdeel_id: String(row.verpakkingsonderdeel_id ?? ""),
        jaar: targetYear,
        prijs_per_stuk: Number(row.prijs_per_stuk ?? 0)
      }));

    const existingIds = new Set(rowsToCopy.map((row) => String(row.verpakkingsonderdeel_id ?? "")));
    verpakkingsonderdelenRows.forEach((onderdeel) => {
      const componentId = String(onderdeel.id ?? "");
      if (!existingIds.has(componentId)) {
        rowsToCopy.push({
          id: createLocalId(),
          verpakkingsonderdeel_id: componentId,
          jaar: targetYear,
          prijs_per_stuk: 0
        });
      }
    });

    await persistPriceRows(
      [...allPriceRows, ...rowsToCopy],
      `Jaarlaag ${sourceYear} gedupliceerd naar ${targetYear}.`
    );
    setExpandedPriceYear(targetYear);
  }

  async function deletePriceYear(targetYear: number) {
    await persistPriceRows(
      allPriceRows.filter((row) => Number(row.jaar ?? 0) !== targetYear),
      `Jaarlaag ${targetYear} verwijderd.`
    );

    if (expandedPriceYear === targetYear) {
      const remainingYears = availablePriceYears.filter((year) => year !== targetYear);
      setExpandedPriceYear(remainingYears[0] ?? null);
    }
  }

  function toggleYearOverviewSort(key: keyof YearOverviewRow) {
    setYearOverviewSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "jaar" ? "desc" : "asc" }
    );
  }

  function toggleCostOverviewSort(key: "type" | "naam" | number) {
    setCostOverviewSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "type" ? "asc" : "desc" }
    );
  }

  return (
    <section className="stack" style={{ gap: "1rem" }}>
      <section className="module-card">
        <div className="module-card-header">
          <div className="module-card-title">Producten &amp; verpakkingen</div>
          <div className="module-card-text">
            Stamdata en jaarprijzen zijn nu uit elkaar getrokken. In de eerste drie tabs beheer je
            de structuur; in de tab jaarprijzen beheer je prijsverschillen per jaar.
          </div>
        </div>

        <div className="tab-strip">
          <button
            type="button"
            className={`tab-button ${activeTab === "onderdelen" ? "active" : ""}`}
            onClick={() => setActiveTab("onderdelen")}
          >
            Verpakkingsonderdelen
          </button>
          <button
            type="button"
            className={`tab-button ${activeTab === "basis" ? "active" : ""}`}
            onClick={() => setActiveTab("basis")}
          >
            Afvuleenheden
          </button>
          <button
            type="button"
            className={`tab-button ${activeTab === "samengesteld" ? "active" : ""}`}
            onClick={() => setActiveTab("samengesteld")}
          >
            Afvulsamenstellingen
          </button>
          <button
            type="button"
            className={`tab-button ${activeTab === "catalogus" ? "active" : ""}`}
            onClick={() => setActiveTab("catalogus")}
          >
            Verkoopbare artikelen
          </button>
          <button
            type="button"
            className={`tab-button ${activeTab === "jaarprijzen" ? "active" : ""}`}
            onClick={() => setActiveTab("jaarprijzen")}
          >
            Jaarprijzen
          </button>
          <button
            type="button"
            className={`tab-button ${activeTab === "kostenoverzicht" ? "active" : ""}`}
            onClick={() => setActiveTab("kostenoverzicht")}
          >
            Kostenoverzicht
          </button>
        </div>
      </section>

      {activeTab === "onderdelen" ? (
        <DatasetTableEditor
          endpoint="/data/dataset/packaging-components"
          initialRows={verpakkingsonderdelenRows.map((row) => {
            const componentId = String(row.id ?? "");
            return {
              id: componentId,
              component_key: String(row.component_key ?? ""),
              omschrijving: String(row.omschrijving ?? ""),
              beschikbaar_voor_samengesteld: Boolean(row.beschikbaar_voor_samengesteld),
              in_gebruik: Boolean(usageByComponentId.get(componentId))
            };
          })}
          addRowTemplate={{
            id: "",
            component_key: "",
            omschrijving: "",
            beschikbaar_voor_samengesteld: false,
            in_gebruik: false
          }}
          columns={[
            { key: "omschrijving", label: "Omschrijving", width: "320px" },
            {
              key: "beschikbaar_voor_samengesteld",
              label: "Beschikbaar voor samengesteld",
              type: "checkbox",
              width: "220px"
            },
            {
              key: "in_gebruik",
              label: "In gebruik",
              type: "checkbox",
              width: "160px",
              readOnly: true
            }
          ]}
          title="Verpakkingsonderdelen"
          description="Stamgegevens van losse verpakkingsonderdelen. Prijzen beheer je apart per jaar."
        />
      ) : null}

      {activeTab === "basis" ? (
        <NestedCollectionEditor
          endpoint="/data/dataset/base-product-masters"
          initialRows={basisproductenRows}
          addRowTemplate={{
            id: "",
            omschrijving: "",
            inhoud_per_eenheid_liter: 0,
            onderdelen: []
          }}
          fields={[
            { key: "omschrijving", label: "Omschrijving" },
            {
              key: "inhoud_per_eenheid_liter",
              label: "Inhoud per eenheid (liter)",
              type: "number",
              readOnly: true
            }
          ]}
          nestedKey="onderdelen"
          nestedLabel="Onderdelen"
          nestedRowTemplate={{
            hoeveelheid: 1,
            omschrijving: "",
            verpakkingsonderdeel_id: ""
          }}
          nestedFields={[
            {
              key: "verpakkingsonderdeel_id",
              label: "Verpakkingsonderdeel",
              type: "select",
              options: ({ nestedRows, nestedIndex, nestedRow }) => {
                const selectedIds = new Set(
                  nestedRows
                    .filter((_, index) => index !== nestedIndex)
                    .map((row) => String(row.verpakkingsonderdeel_id ?? ""))
                    .filter(Boolean)
                );
                const currentId = String(nestedRow.verpakkingsonderdeel_id ?? "");
                return packagingComponentOptions.filter(
                  (option) => option.value === currentId || !selectedIds.has(option.value)
                );
              },
              resetOnSelect: true,
              preserveOnSelect: ["hoeveelheid"]
            },
            { key: "omschrijving", label: "Omschrijving", readOnly: true },
            { key: "hoeveelheid", label: "Hoeveelheid", type: "number" }
          ]}
          compactSummaryColumns={[
            { key: "omschrijving", label: "Naam" },
            { key: "inhoud_per_eenheid_liter", label: "Liter", type: "number" },
            { key: "onderdelen", label: "Onderdelen", type: "count" }
          ]}
          title="Basisproducten"
          description="Afvuleenheden met unieke verpakkingsonderdelen per eenheid."
        />
      ) : null}

      {activeTab === "samengesteld" ? (
        <NestedCollectionEditor
          endpoint="/data/dataset/composite-product-masters"
          initialRows={samengesteldeProductenRows}
          addRowTemplate={{
            id: "",
            omschrijving: "",
            basisproducten: [],
            totale_inhoud_liter: 0
          }}
          fields={[
            { key: "omschrijving", label: "Omschrijving" },
            {
              key: "totale_inhoud_liter",
              label: "Totale inhoud (liter)",
              type: "number",
              readOnly: true
            }
          ]}
          nestedKey="basisproducten"
          nestedLabel="Basisproducten"
          nestedRowTemplate={{
            aantal: 1,
            omschrijving: "",
            basisproduct_id: "",
            totale_inhoud_liter: 0,
            inhoud_per_eenheid_liter: 0
          }}
          nestedFields={[
            {
              key: "basisproduct_id",
              label: "Basisproduct / onderdeel",
              type: "select",
              options: ({ nestedRows, nestedIndex, nestedRow }) => {
                const selectedIds = new Set(
                  nestedRows
                    .filter((_, index) => index !== nestedIndex)
                    .map((row) => String(row.basisproduct_id ?? ""))
                    .filter(Boolean)
                );
                const currentId = String(nestedRow.basisproduct_id ?? "");
                return basisproductOptions.filter(
                  (option) => option.value === currentId || !selectedIds.has(option.value)
                );
              },
              resetOnSelect: true,
              preserveOnSelect: ["aantal"]
            },
            { key: "omschrijving", label: "Omschrijving", readOnly: true },
            {
              key: "inhoud_per_eenheid_liter",
              label: "Inhoud per eenheid (liter)",
              type: "number",
              readOnly: true
            },
            { key: "aantal", label: "Aantal", type: "number" },
            {
              key: "totale_inhoud_liter",
              label: "Totale inhoud (liter)",
              type: "number",
              readOnly: true
            }
          ]}
          nestedComputedFields={[
            {
              targetKey: "totale_inhoud_liter",
              leftKey: "aantal",
              rightKey: "inhoud_per_eenheid_liter"
            }
          ]}
          parentAggregates={[
            {
              targetKey: "totale_inhoud_liter",
              sourceKey: "totale_inhoud_liter"
            }
          ]}
          compactSummaryColumns={[
            { key: "omschrijving", label: "Naam" },
            { key: "totale_inhoud_liter", label: "Liter", type: "number" },
            { key: "basisproducten", label: "Onderdelen", type: "count" }
          ]}
          title="Afvulsamenstellingen"
          description="Afvulsamenstellingen (dozen/combi's) opgebouwd uit afvuleenheden en eventueel bouwstenen."
        />
      ) : null}

      {activeTab === "catalogus" ? (
        <NestedCollectionEditor
          endpoint="/data/dataset/catalog-products"
          initialRows={catalogusproductenRows}
          addRowTemplate={{
            id: "",
            code: "",
            naam: "",
            kind: "giftpack",
            actief: true,
            bom_lines: [],
          }}
          fields={[
            { key: "naam", label: "Naam" },
            { key: "code", label: "Code" },
            {
              key: "kind",
              label: "Type",
              type: "select",
              options: [
                { value: "giftpack", label: "Geschenkverpakking" },
                { value: "dienst", label: "Dienst" },
                { value: "catalog", label: "Overig" },
              ],
            },
            { key: "actief", label: "Actief", type: "checkbox" },
          ]}
          nestedKey="bom_lines"
          nestedLabel="Regels"
          nestedRowTemplate={{
            id: "",
            line_kind: "beer",
            quantity: 1,
            bier_id: "",
            product_id: "",
            product_type: "basis",
            packaging_component_id: "",
            omschrijving: "",
            unit_cost_ex: null,
          }}
          nestedFields={[
            {
              key: "line_kind",
              label: "Soort",
              type: "select",
              options: [
                { value: "beer", label: "Bier" },
                { value: "packaging_component", label: "Verpakkingsonderdeel" },
                { value: "labor", label: "Loon" },
                { value: "other", label: "Overig" },
              ],
              resetOnSelect: true,
              preserveOnSelect: ["quantity"],
            },
            {
              key: "beer_choice",
              label: "Onderdeel",
              type: "select",
              visible: ({ nestedRow }) => String((nestedRow as any).line_kind ?? "") === "beer",
              options: () => {
                const packagingOptions: { id: string; label: string; product_type: "basis" | "samengesteld" }[] = [
                  ...basisproductenRows.map((row) => ({
                    id: String((row as any).id ?? ""),
                    label: String((row as any).omschrijving ?? ""),
                    product_type: "basis" as const
                  })),
                  ...samengesteldeProductenRows.map((row) => ({
                    id: String((row as any).id ?? ""),
                    label: String((row as any).omschrijving ?? ""),
                    product_type: "samengesteld" as const
                  }))
                ].filter((row) => row.id && row.label);

                const out: any[] = [];
                for (const b of bierOptions) {
                  for (const p of packagingOptions) {
                    out.push({
                      value: `${b.value}|${p.product_type}|${p.id}`,
                      label: `${b.label} - ${p.label}`,
                      payload: {
                        bier_id: b.value,
                        product_type: p.product_type,
                        product_id: p.id
                      }
                    });
                  }
                }
                return out;
              },
            },
            {
              key: "packaging_component_id",
              label: "Onderdeel",
              type: "select",
              visible: ({ nestedRow }) => String((nestedRow as any).line_kind ?? "") === "packaging_component",
              options: () => packagingComponentOptions,
            },
            {
              key: "omschrijving",
              label: "Omschrijving",
              type: "text",
              visible: ({ nestedRow }) => {
                const kind = String((nestedRow as any).line_kind ?? "");
                return kind === "labor" || kind === "other";
              },
            },
            {
              key: "unit_cost_ex",
              label: "Kostprijs (ex)",
              type: "number",
              visible: ({ nestedRow }) => {
                const kind = String((nestedRow as any).line_kind ?? "");
                return kind === "labor" || kind === "other";
              },
            },
            { key: "quantity", label: "Aantal", type: "number" },
          ]}
          compactSummaryColumns={[
            { key: "naam", label: "Naam" },
            { key: "kind", label: "Type" },
            { key: "bom_lines", label: "Regels", type: "count" },
          ]}
          title="Verkoopbare artikelen"
          description="Verkoopbare artikelen zoals giftpacks en diensten. Voeg regels toe (bier, verpakkingsonderdeel, loon, overig)."
        />
      ) : null}

      {activeTab === "jaarprijzen" ? (
        <section className="module-card">
          <div className="module-card-header">
            <div className="module-card-title">Jaarprijzen verpakkingsonderdelen</div>
            <div className="module-card-text">
              Beheer per jaar een complete prijslaag voor alle verpakkingsonderdelen. Klik op een
              jaarregel om de onderliggende onderdelen en prijzen te openen.
            </div>
          </div>

          <div className="editor-toolbar">
            <div className="editor-toolbar-meta">
              <span className="editor-pill">{availablePriceYears.length} jaarlagen</span>
              <span className="muted">
                Nieuwe jaren maak je aan door een bestaande jaarlaag te dupliceren.
              </span>
            </div>
          </div>

          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="table-sort-button"
                      onClick={() => toggleYearOverviewSort("jaar")}
                    >
                      Jaar
                      <SortIcon direction={yearOverviewSort.key === "jaar" ? yearOverviewSort.direction : null} />
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="table-sort-button"
                      onClick={() => toggleYearOverviewSort("aantalOnderdelen")}
                    >
                      Aantal onderdelen
                      <SortIcon
                        direction={
                          yearOverviewSort.key === "aantalOnderdelen" ? yearOverviewSort.direction : null
                        }
                      />
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="table-sort-button"
                      onClick={() => toggleYearOverviewSort("ingevuld")}
                    >
                      Ingevuld
                      <SortIcon
                        direction={yearOverviewSort.key === "ingevuld" ? yearOverviewSort.direction : null}
                      />
                    </button>
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {yearOverviewRows.length === 0 ? (
                  <tr>
                    <td className="dataset-empty" colSpan={4}>
                      Voeg eerst verpakkingsonderdelen toe en maak daarna een eerste jaarlaag aan.
                    </td>
                  </tr>
                ) : null}
                {yearOverviewRows.map((row) => {
                  const isExpanded = expandedPriceYear === row.jaar;
                  return (
                    <Fragment key={row.jaar}>
                      <tr
                        onClick={() =>
                          setExpandedPriceYear((current) => (current === row.jaar ? null : row.jaar))
                        }
                        style={{ cursor: "pointer" }}
                      >
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
                            <ChevronIcon expanded={isExpanded} />
                            <strong>{row.jaar}</strong>
                          </div>
                        </td>
                        <td>{row.aantalOnderdelen}</td>
                        <td>{row.ingevuld}</td>
                        <td>
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.55rem" }}>
                            <button
                              type="button"
                              className="icon-button-table icon-button-neutral"
                              aria-label={`Dupliceer jaar ${row.jaar}`}
                              title={`Dupliceer jaar ${row.jaar}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                void duplicatePriceYear(row.jaar);
                              }}
                            >
                              <DuplicateIcon />
                            </button>
                            <button
                              type="button"
                              className="icon-button-table"
                              aria-label={`Verwijder jaar ${row.jaar}`}
                              title={`Verwijder jaar ${row.jaar}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                void deletePriceYear(row.jaar);
                              }}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr>
                          <td colSpan={4} style={{ background: "rgba(248, 251, 255, 0.9)" }}>
                            <div className="dataset-editor-scroll" style={{ marginTop: "0.2rem" }}>
                              <table className="dataset-editor-table wizard-table-compact">
                                <thead>
                                  <tr>
                                    <th>Verpakkingsonderdeel</th>
                                    <th>Prijs per stuk</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedYearRows.map((detailRow) => (
                                    <tr key={String(detailRow.verpakkingsonderdeel_id ?? "")}>
                                      <td>
                                        <div className="dataset-input dataset-input-readonly">
                                          {String(detailRow.omschrijving ?? "")}
                                        </div>
                                      </td>
                                      <td>
                                        <div className="currency-input-wrapper">
                                          <span className="currency-input-prefix">€</span>
                                          <input
                                            className="dataset-input"
                                            type="number"
                                            step="0.0001"
                                            value={String(detailRow.prijs_per_stuk ?? 0)}
                                            onChange={(event) =>
                                              updateExpandedYearPrice(
                                                String(detailRow.verpakkingsonderdeel_id ?? ""),
                                                event.target.value === ""
                                                  ? 0
                                                  : Number(event.target.value)
                                              )
                                            }
                                          />
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="editor-actions" style={{ marginTop: "0.85rem" }}>
                              <div className="editor-actions-group">
                                <span className="muted">
                                  Pas de prijzen aan en sla deze jaarlaag daarna op.
                                </span>
                              </div>
                              <div className="editor-actions-group">
                                <button
                                  type="button"
                                  className="editor-button"
                                  onClick={() => {
                                    void saveExpandedYearPrices();
                                  }}
                                  disabled={isSavingPrices}
                                >
                                  {isSavingPrices ? "Opslaan..." : `Jaar ${row.jaar} opslaan`}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="editor-actions">
            <div className="editor-actions-group">
              {priceStatus ? <span className="editor-status">{priceStatus}</span> : null}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "kostenoverzicht" ? (
        <section className="module-card">
          <div className="module-card-header">
            <div className="module-card-title">Kostenoverzicht</div>
            <div className="module-card-text">
              Overzicht van de totale productkosten op basis van de hoogste 5 bekende jaarlagen.
            </div>
          </div>

          <div className="editor-toolbar">
            <div className="editor-toolbar-meta">
              <span className="editor-pill">{costOverviewRows.length} producten</span>
              <span className="muted">
                {latestOverviewYears.length > 0
                  ? `Getoond: ${latestOverviewYears.join(", ")}`
                  : "Voeg eerst jaarprijzen toe om productkosten te kunnen zien."}
              </span>
            </div>
          </div>

          <div className="dataset-editor-scroll">
            <table className="dataset-editor-table">
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="table-sort-button"
                      onClick={() => toggleCostOverviewSort("naam")}
                    >
                      Product
                      <SortIcon direction={costOverviewSort.key === "naam" ? costOverviewSort.direction : null} />
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="table-sort-button"
                      onClick={() => toggleCostOverviewSort("type")}
                    >
                      Type
                      <SortIcon direction={costOverviewSort.key === "type" ? costOverviewSort.direction : null} />
                    </button>
                  </th>
                  {latestOverviewYears.map((year) => (
                    <th key={year}>
                      <button
                        type="button"
                        className="table-sort-button"
                        onClick={() => toggleCostOverviewSort(year)}
                      >
                        {year}
                        <SortIcon
                          direction={costOverviewSort.key === year ? costOverviewSort.direction : null}
                        />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {costOverviewRows.length === 0 ? (
                  <tr>
                    <td className="dataset-empty" colSpan={Math.max(3, latestOverviewYears.length + 2)}>
                      Voeg eerst producten en jaarprijzen toe om het kostenoverzicht te tonen.
                    </td>
                  </tr>
                ) : null}
                {costOverviewRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="dataset-input dataset-input-readonly">{row.naam}</div>
                    </td>
                    <td>
                      <div className="dataset-input dataset-input-readonly">{row.type}</div>
                    </td>
                    {latestOverviewYears.map((year) => (
                      <td key={`${row.id}:${year}`}>
                        <div className="dataset-input dataset-input-readonly">
                          {formatCurrency(Number(row.costs[year] ?? 0))}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </section>
  );
}
