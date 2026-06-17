"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { parseOptionalNumberFromInput } from "@/components/berekeningen/berekeningenWizardUtils";

type GenericRecord = Record<string, unknown>;
type BerekeningSubjectType = "bier" | "artikel" | "dienst";

export function BasisStep({
  current,
  productieJaren,
  bieren,
  onCreateStyle,
  updateCurrent,
}: {
  current: GenericRecord;
  productieJaren: number[];
  bieren?: GenericRecord[];
  onCreateStyle?: (name: string) => Promise<{ id: string; name: string }>;
  updateCurrent: (updater: (draft: GenericRecord) => void) => void;
}) {
  const basis = (current.basisgegevens as GenericRecord) ?? {};
  const subjectType = (String((basis as any).sku_type ?? "bier").trim() || "bier") as BerekeningSubjectType;
  const belastingsoort = String((basis as any).belastingsoort ?? "Accijns");
  const styleOptions = useMemo(
    () =>
      (Array.isArray(bieren) ? bieren : [])
        .map((row) => {
          const name = String((row as any)?.stijl ?? (row as any)?.style ?? "").trim();
          return { id: name ? `style:${name.toLowerCase()}` : "", name };
        })
        .filter((row) => row.name)
        .filter((row, index, arr) => arr.findIndex((candidate) => candidate.name.toLowerCase() === row.name.toLowerCase()) === index)
        .sort((a, b) => a.name.localeCompare(b.name, "nl-NL")),
    [bieren]
  );

  return (
    <div className="wizard-form-grid">
      <label className="nested-field">
        <span>Type</span>
        <select
          className="dataset-input"
          value={subjectType}
          onChange={(event) =>
            updateCurrent((draft) => {
              const nextType = event.target.value;
              const prevType = String(((draft.basisgegevens as GenericRecord) as any).sku_type ?? "bier");
              (draft.basisgegevens as GenericRecord).sku_type = nextType;
              if (nextType !== "bier") {
                (draft.soort_berekening as GenericRecord).type = "Inkoop";
                const nextUom = nextType === "dienst" ? "uur" : "stuk";
                if (!String(((draft.basisgegevens as GenericRecord) as any).uom ?? "").trim() || prevType === "bier") {
                  (draft.basisgegevens as GenericRecord).uom = nextUom;
                }
                const regels =
                  ((((draft.invoer as GenericRecord).inkoop as GenericRecord).factuurregels as GenericRecord[]) ?? []);
                regels.forEach((regel) => {
                  (regel as any).eenheid = String(((draft.basisgegevens as GenericRecord) as any).uom ?? nextUom);
                  (regel as any).liters = 0;
                  (regel as any).afvulkosten_fust = null;
                });
              }
            })
          }
        >
          <option value="bier">Bier</option>
          <option value="artikel">Artikel</option>
          <option value="dienst">Dienst</option>
        </select>
      </label>

      <label className="nested-field">
        <span>{subjectType === "bier" ? "Biernaam" : "Artikel"}</span>
        <input
          className="dataset-input"
          type="text"
          value={String((basis as any).biernaam ?? "")}
          onChange={(event) =>
            updateCurrent((draft) => {
              (draft.basisgegevens as GenericRecord).biernaam = event.target.value;
            })
          }
        />
      </label>

      <label className="nested-field">
        <span>Jaar</span>
        <select
          className="dataset-input"
          value={String((basis as any).jaar ?? "")}
          onChange={(event) =>
            updateCurrent((draft) => {
              (draft.basisgegevens as GenericRecord).jaar = Number(event.target.value);
            })
          }
        >
          <option value="" disabled>
            Kies productiejaar...
          </option>
          {productieJaren.map((year) => (
            <option key={year} value={String(year)}>
              {year}
            </option>
          ))}
        </select>
      </label>

      <label className="nested-field">
        <span>{subjectType === "bier" ? "Stijl" : "Categorie"}</span>
        {subjectType === "bier" ? (
          <CreatableStyleCombobox
            value={String((basis as any).stijl ?? "")}
            options={styleOptions}
            onChange={(value) =>
              updateCurrent((draft) => {
                const basisgegevens = draft.basisgegevens as GenericRecord;
                basisgegevens.stijl = value;
              })
            }
            onCreate={onCreateStyle}
          />
        ) : (
          <input
            className="dataset-input"
            type="text"
            value={String((basis as any).stijl ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => {
                (draft.basisgegevens as GenericRecord).stijl = event.target.value;
              })
            }
          />
        )}
      </label>

      {subjectType === "bier" ? (
        <label className="nested-field">
          <span>Alcoholpercentage</span>
          <input
            className="dataset-input"
            type="number"
            step="any"
            value={String((basis as any).alcoholpercentage ?? "")}
            onChange={(event) =>
              updateCurrent((draft) => {
                (draft.basisgegevens as GenericRecord).alcoholpercentage = parseOptionalNumberFromInput(event.target.value);
              })
            }
          />
        </label>
      ) : null}

      <label className="nested-field">
        <span>BTW-tarief</span>
        <input
          className="dataset-input"
          type="text"
          value={String((basis as any).btw_tarief ?? "")}
          onChange={(event) =>
            updateCurrent((draft) => {
              (draft.basisgegevens as GenericRecord).btw_tarief = event.target.value;
            })
          }
        />
      </label>

      {subjectType === "bier" ? (
        <>
          <label className="nested-field">
            <span>Belastingsoort</span>
            <select
              className="dataset-input"
              value={belastingsoort}
              onChange={(event) =>
                updateCurrent((draft) => {
                  const basisgegevens = draft.basisgegevens as GenericRecord;
                  (basisgegevens as any).belastingsoort = event.target.value;
                  if (event.target.value === "Verbruiksbelasting") {
                    (basisgegevens as any).tarief_accijns = "";
                  } else if (String((basisgegevens as any).tarief_accijns ?? "").trim() === "") {
                    (basisgegevens as any).tarief_accijns = "Hoog";
                  }
                })
              }
            >
              <option value="Accijns">Accijns</option>
              <option value="Verbruiksbelasting">Verbruiksbelasting</option>
            </select>
          </label>
          {belastingsoort === "Accijns" ? (
            <label className="nested-field">
              <span>Tarief accijns</span>
              <select
                className="dataset-input"
                value={String((basis as any).tarief_accijns ?? "Hoog")}
                onChange={(event) =>
                  updateCurrent((draft) => {
                    (draft.basisgegevens as GenericRecord).tarief_accijns = event.target.value;
                  })
                }
              >
                <option value="Hoog">Hoog</option>
                <option value="Laag">Laag</option>
              </select>
            </label>
          ) : null}
        </>
      ) : null}

      <label className="nested-field">
        <span>Status</span>
        <input className="dataset-input" value={String((current as any).status ?? "concept")} readOnly />
      </label>
    </div>
  );
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function CreatableStyleCombobox({
  value,
  options,
  onChange,
  onCreate,
}: {
  value: string;
  options: Array<{ id: string; name: string }>;
  onChange: (value: string, styleId?: string) => void;
  onCreate?: (name: string) => Promise<{ id: string; name: string }>;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");

  const exact = useMemo(() => {
    const q = normalize(value);
    if (!q) return null;
    return options.find((option) => normalize(option.name) === q) ?? null;
  }, [options, value]);

  const filtered = useMemo(() => {
    const q = normalize(value);
    if (!q) return options;
    return options.filter((option) => normalize(option.name).includes(q));
  }, [options, value]);

  const canCreate = Boolean(value.trim()) && !exact;
  const items = [...filtered.map((option) => ({ type: "option" as const, option })), ...(canCreate ? [{ type: "create" as const }] : [])];

  useEffect(() => {
    function onDocumentPointerDown(event: MouseEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentPointerDown);
    return () => document.removeEventListener("mousedown", onDocumentPointerDown);
  }, []);

  function selectOption(option: { id: string; name: string }) {
    onChange(option.name, option.id);
    setMessage("Bestaande stijl geselecteerd.");
    setMessageTone("success");
    setOpen(false);
    setActiveIndex(-1);
  }

  async function createOption() {
    const name = value.trim();
    if (!name || busy) return;
    if (exact) {
      selectOption(exact);
      return;
    }
    if (!onCreate) {
      setMessage("Nieuwe stijl wordt opgeslagen bij Opslaan.");
      setMessageTone("success");
      setOpen(false);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const created = await onCreate(name);
      onChange(created.name || name, created.id);
      setMessage("Nieuwe stijl opgeslagen.");
      setMessageTone("success");
      setOpen(false);
      setActiveIndex(-1);
    } catch (error) {
      setMessage(String((error as any)?.message ?? "Nieuwe stijl opslaan mislukt."));
      setMessageTone("error");
    } finally {
      setBusy(false);
    }
  }

  function activate(delta: number) {
    if (!open) {
      setOpen(true);
      return;
    }
    if (!items.length) return;
    setActiveIndex((current) => {
      const next = current + delta;
      if (next < 0) return items.length - 1;
      if (next >= items.length) return 0;
      return next;
    });
  }

  function commitActive() {
    const item = items[activeIndex];
    if (!item) {
      if (exact) selectOption(exact);
      else void createOption();
      return;
    }
    if (item.type === "option") selectOption(item.option);
    else void createOption();
  }

  return (
    <div className="creatable-combobox" ref={rootRef}>
      <div className="creatable-combobox__control">
        <input
          className="dataset-input creatable-combobox__input"
          value={value}
          autoComplete="off"
          placeholder="Typ of selecteer een stijl..."
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
            setMessage("");
            setMessageTone("success");
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              activate(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              activate(-1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              commitActive();
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <button type="button" className="creatable-combobox__arrow" onClick={() => setOpen((current) => !current)} aria-label="Stijlen tonen">
          v
        </button>
      </div>
      {open ? (
        <div className="creatable-combobox__dropdown" role="listbox">
          {filtered.map((option, index) => (
            <button
              key={option.id || option.name}
              type="button"
              className={`creatable-combobox__item${activeIndex === index ? " active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
            >
              {option.name}
            </button>
          ))}
          {canCreate ? (
            <>
              {filtered.length ? <div className="creatable-combobox__divider" /> : null}
              <button
                type="button"
                className={`creatable-combobox__item creatable-combobox__item-create${activeIndex === filtered.length ? " active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void createOption()}
                disabled={busy}
              >
                + Nieuwe stijl "{value.trim()}"
                <span>Geen exacte match. Druk op Enter om op te slaan.</span>
              </button>
            </>
          ) : null}
          {!filtered.length && !canCreate ? <div className="creatable-combobox__empty">Typ een stijl om te zoeken of aan te maken.</div> : null}
        </div>
      ) : null}
      {message ? <div className={messageTone === "error" ? "form-error" : "form-success"}>{message}</div> : null}
    </div>
  );
}

