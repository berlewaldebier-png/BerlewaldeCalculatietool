"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import type { BasisData, QuoteChannel } from "@/components/offerte-samenstellen/types";
import { Field } from "@/components/offerte-samenstellen/OfferteSamenstellenParts";

type DouanoCompany = {
  company_id: number;
  name: string;
  public_name?: string;
  status?: string;
  is_customer?: boolean;
};

type CustomerSalesSummary = {
  company_id: number;
  year: number;
  invoices_count: number;
  lines_count: number;
  revenue_ex: number;
  mapped_liters: number;
  mapped_lines: number;
  unmapped_lines: number;
  top_skus: Array<{
    sku_id: string;
    sku_name: string;
    units: number;
    revenue_ex: number;
    liters: number;
  }>;
};

function euro(value: number) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value || 0);
}

export function BasisStep({
  year,
  basis,
  setBasis,
  customerSummary,
  customerSummaryError,
  isCustomerSummaryLoading,
  onNext,
  onSave,
  isSaving,
}: {
  year: number;
  basis: BasisData;
  setBasis: React.Dispatch<React.SetStateAction<BasisData>>;
  customerSummary: CustomerSalesSummary | null;
  customerSummaryError: string | null;
  isCustomerSummaryLoading: boolean;
  onNext: () => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  const [companies, setCompanies] = useState<DouanoCompany[]>([]);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadCompanies() {
      setCompaniesError(null);
      try {
        const response = await fetch("/api/integrations/douano/companies?only_customers=true&limit=2000", {
          cache: "no-store",
          credentials: "include",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = typeof (payload as any)?.detail === "string" ? (payload as any).detail : response.statusText;
          throw new Error(detail || "Laden van klanten faalde.");
        }
        const items = Array.isArray((payload as any)?.items) ? ((payload as any).items as DouanoCompany[]) : [];
        if (!cancelled) setCompanies(items);
      } catch (err) {
        if (cancelled) return;
        setCompanies([]);
        setCompaniesError(err instanceof Error ? err.message : "Laden van klanten faalde.");
      }
    }
    void loadCompanies();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!dropdownRef.current) return;
      if (dropdownRef.current.contains(event.target as Node)) return;
      setIsCompanyDropdownOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filteredCompanies = useMemo(() => {
    const q = String(basis.klantNaam ?? "").trim().toLowerCase();
    if (!q) return companies.slice(0, 25);
    return companies
      .filter((company) => {
        const name = String(company.name ?? "").toLowerCase();
        const pub = String(company.public_name ?? "").toLowerCase();
        return name.includes(q) || pub.includes(q);
      })
      .slice(0, 25);
  }, [companies, basis.klantNaam]);

  return (
    <section className="cpq-card">
      <div className="cpq-card-header">
        <div>
          <h2 className="cpq-card-title">Basisgegevens</h2>
          <p className="cpq-card-subtitle">Vul klant, kanaal en context van de offerte in.</p>
        </div>
      </div>

      <div className="cpq-form-grid">
        <div className="cpq-field" ref={dropdownRef} style={{ position: "relative" }}>
          <div className="cpq-label">Klant</div>
          <input
            className="cpq-input"
            value={basis.klantNaam}
            placeholder="Zoek klant of vul vrije tekst..."
            onFocus={() => setIsCompanyDropdownOpen(true)}
            onChange={(e) => {
              const value = e.target.value;
              setBasis((prev) => ({ ...prev, klantNaam: value, klantId: null }));
              setIsCompanyDropdownOpen(true);
            }}
          />
          {companiesError ? (
            <div className="cpq-alert cpq-alert-warn" style={{ marginTop: 8 }}>
              Klantenlijst niet geladen: {companiesError}
            </div>
          ) : null}
          {isCompanyDropdownOpen && filteredCompanies.length > 0 ? (
            <div
              style={{
                position: "absolute",
                zIndex: 20,
                marginTop: 6,
                width: "100%",
                maxHeight: 280,
                overflow: "auto",
                border: "1px solid rgba(15,23,42,0.12)",
                borderRadius: 12,
                background: "white",
                boxShadow: "0 10px 22px rgba(15,23,42,0.08)",
              }}
              role="listbox"
              aria-label="Zoekresultaten klanten"
            >
              {filteredCompanies.map((company) => {
                const label = String(company.name ?? "").trim();
                return (
                  <button
                    key={company.company_id}
                    type="button"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      background: "transparent",
                      border: 0,
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      setBasis((prev) => ({ ...prev, klantNaam: label, klantId: company.company_id }));
                      setIsCompanyDropdownOpen(false);
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{label || `Klant ${company.company_id}`}</div>
                    {company.public_name ? (
                      <div style={{ opacity: 0.7, fontSize: 12 }}>{company.public_name}</div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <Field label="Contactpersoon" value={basis.contactpersoon} onChange={(v) => setBasis((prev) => ({ ...prev, contactpersoon: v }))} />
        <Field label="Offertenaam" value={basis.offerteNaam} onChange={(v) => setBasis((prev) => ({ ...prev, offerteNaam: v }))} />
        <Field label="Geldig tot" value={basis.geldigTot} onChange={(v) => setBasis((prev) => ({ ...prev, geldigTot: v }))} />
      </div>

      {basis.klantId ? (
        <div style={{ marginTop: 14 }}>
          <div className="cpq-label" style={{ marginBottom: 8 }}>
            Klant snapshot ({year})
          </div>
          {customerSummaryError ? (
            <div className="cpq-alert cpq-alert-warn">Snapshot laden faalde: {customerSummaryError}</div>
          ) : isCustomerSummaryLoading ? (
            <div className="cpq-alert">Snapshot wordt geladen...</div>
          ) : !customerSummary ? (
            <div className="cpq-alert cpq-alert-warn">Geen snapshot gevonden voor deze klant in {year}.</div>
          ) : (
            <div className="cpq-intro-summary-card">
              <div className="cpq-intro-summary-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                <div className="cpq-intro-summary-metric">
                  <div className="cpq-intro-summary-metric-label">Verkochte liters (gemapt)</div>
                  <div className="cpq-intro-summary-metric-value">
                    {Math.round(customerSummary.mapped_liters).toLocaleString("nl-NL")} L
                  </div>
                </div>
                <div className="cpq-intro-summary-metric">
                  <div className="cpq-intro-summary-metric-label">Omzet (invoice)</div>
                  <div className="cpq-intro-summary-metric-value">{euro(customerSummary.revenue_ex)}</div>
                </div>
                <div className="cpq-intro-summary-metric">
                  <div className="cpq-intro-summary-metric-label">Facturen</div>
                  <div className="cpq-intro-summary-metric-value">
                    {customerSummary.invoices_count.toLocaleString("nl-NL")}
                  </div>
                </div>
              </div>
              <div className="cpq-muted" style={{ marginTop: 10 }}>
                Alleen gemappte SKUs tellen mee voor liters & contributie.
                {customerSummary.unmapped_lines > 0
                  ? ` (${customerSummary.unmapped_lines} ongemappte regels in ${year})`
                  : ""}
              </div>

              {customerSummary.top_skus.length > 0 ? (
                <div style={{ marginTop: 14 }}>
                  <div className="cpq-intro-card-title">Top SKUs (liters)</div>
                  <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    {customerSummary.top_skus.map((row) => (
                      <div
                        key={row.sku_id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: "8px 10px",
                          border: "1px solid rgba(15,23,42,0.08)",
                          borderRadius: 12,
                          background: "rgba(248,250,252,0.6)",
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{row.sku_name}</div>
                        <div style={{ textAlign: "right", fontSize: 12, opacity: 0.85 }}>
                          {Math.round(row.liters).toLocaleString("nl-NL")} L · {euro(row.revenue_ex)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <div className="cpq-form-row">
        <div className="cpq-label">Kanaal</div>
        <div className="cpq-toggle-strip" role="group" aria-label="Kanaal">
          {(["Horeca", "Retail", "Events"] as QuoteChannel[]).map((kanaal) => (
            <button
              key={kanaal}
              type="button"
              onClick={() => setBasis((prev) => ({ ...prev, kanaal }))}
              className={`cpq-toggle${basis.kanaal === kanaal ? " active" : ""}`}
            >
              {kanaal}
            </button>
          ))}
        </div>
      </div>

      <div className="cpq-form-row">
        <label className="cpq-field">
          <div className="cpq-label">Opmerking</div>
          <textarea
            value={basis.opmerking}
            onChange={(e) => setBasis((prev) => ({ ...prev, opmerking: e.target.value }))}
            className="cpq-textarea"
          />
        </label>
      </div>

      <div className="cpq-actions cpq-actions-split">
        <button onClick={onSave} className="cpq-button cpq-button-secondary" type="button" disabled={isSaving}>
          {isSaving ? "Opslaan..." : "Opslaan"}
        </button>
        <button onClick={onNext} className="cpq-button cpq-button-primary" type="button">
          Verder naar offerte maken
        </button>
      </div>
    </section>
  );
}

