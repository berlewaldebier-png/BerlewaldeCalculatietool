"use client";

import type { DealContext } from "@/components/offerte-samenstellen/types";

type Props = {
  value: DealContext;
  onChange: (next: DealContext) => void;
  targetVolumeLiters: number | null;
  onChangeTargetVolumeLiters: (next: number | null) => void;
  agreementVolumeLiters: number | null;
  onChangeAgreementVolumeLiters: (next: number | null) => void;
};

function toNumberOrNull(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

export function DealContextBar({
  value,
  onChange,
  targetVolumeLiters,
  onChangeTargetVolumeLiters,
  agreementVolumeLiters,
  onChangeAgreementVolumeLiters,
}: Props) {
  const options: Array<{ id: DealContext; title: string; meta: string }> = [
    { id: "growth", title: "Groei-afspraak", meta: "Vorig jaar → nieuw doel" },
    { id: "agreement", title: "Nieuwe afspraak", meta: "Nieuwe prijs op run-rate" },
    { id: "one_off", title: "One-off offerte", meta: "Eenmalige aanvraag" },
  ];

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Deal-context
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`rounded-2xl border p-4 text-left transition ${
              value === option.id
                ? "border-blue-300 bg-blue-50 shadow-sm"
                : "border-slate-200 bg-white hover:border-blue-200"
            }`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`h-3 w-3 rounded-full border ${
                  value === option.id
                    ? "border-blue-600 bg-blue-600"
                    : "border-slate-300 bg-white"
                }`}
              />

              <div>
                <div className="text-sm font-semibold text-slate-900">
                  {option.title}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{option.meta}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {value === "growth" ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block">
            <div className="mb-1.5 text-sm font-medium text-slate-700">
              Doelvolume (L)
            </div>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              inputMode="decimal"
              placeholder="Bijv. 3000"
              value={targetVolumeLiters ?? ""}
              onChange={(e) =>
                onChangeTargetVolumeLiters(toNumberOrNull(e.target.value))
              }
            />
            <div className="mt-1.5 text-xs text-slate-500">
              Nieuwe voorwaarden gelden alleen voor extra liters boven de historische baseline.
            </div>
          </label>
        </div>
      ) : null}

      {value === "agreement" ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block">
            <div className="mb-1.5 text-sm font-medium text-slate-700">
              Contractvolume (L)
            </div>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              inputMode="decimal"
              placeholder="Bijv. 5000"
              value={agreementVolumeLiters ?? ""}
              onChange={(e) =>
                onChangeAgreementVolumeLiters(toNumberOrNull(e.target.value))
              }
            />
            <div className="mt-1.5 text-xs text-slate-500">
              Nieuwe voorwaarden gelden voor het volledige toekomstige contractvolume.
            </div>
          </label>
        </div>
      ) : null}

      <div className="mt-3 text-xs text-slate-500">
        Let op: we passen nooit prijzen retroactief toe op reeds gefactureerde liters.
      </div>
    </div>
  );
}

