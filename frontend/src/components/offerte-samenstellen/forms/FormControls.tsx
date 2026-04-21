import { useMemo, useState } from "react";

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "date" | "number";
  min?: string;
  required?: boolean;
};

type SelectOption = {
  label: string;
  value: string;
};

type SelectFieldProps = {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
};

type BooleanFieldProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

type MultiSelectItem = {
  id: string;
  label: string;
};

type MultiSelectFieldProps = {
  label: string;
  items: MultiSelectItem[];
  selected: string[];
  onToggle: (id: string) => void;
};

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  min,
  required,
}: FieldProps) {
  return (
    <label className="cpq-field">
      <div className="cpq-label">
        {label}
        {required ? " *" : ""}
      </div>
      <input
        type={type}
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cpq-input"
        placeholder={placeholder}
      />
    </label>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
}: SelectFieldProps) {
  return (
    <label className="cpq-field">
      <div className="cpq-label">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cpq-select"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function BooleanField({
  label,
  checked,
  onChange,
}: BooleanFieldProps) {
  return (
    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

export function MultiSelectField({
  label,
  items,
  selected,
  onToggle,
}: MultiSelectFieldProps) {
  return (
    <div className="cpq-field">
      <div className="cpq-label">{label}</div>
      <div className="space-y-2">
        {items.map((item) => (
          <label
            key={item.id}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3"
          >
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={() => onToggle(item.id)}
            />
            <span className="text-sm">{item.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function SearchableMultiSelectField({
  label,
  items,
  selected,
  onToggle,
}: MultiSelectFieldProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filteredItems = useMemo(
    () =>
      items.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase())),
    [items, query]
  );

  const selectedItems = items.filter((item) => selected.includes(item.id));

  return (
    <div className="cpq-field cpq-multiselect-field">
      <div className="cpq-label">{label}</div>
      <button
        type="button"
        className="cpq-multiselect-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span>
          {selectedItems.length > 0
            ? `${selectedItems.length} product${selectedItems.length === 1 ? "" : "en"} geselecteerd`
            : "Kies producten"}
        </span>
        <span className={`cpq-multiselect-chevron${open ? " open" : ""}`}>⌄</span>
      </button>
      {open ? (
        <div className="cpq-multiselect-popover">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Zoek bier of verpakking..."
            className="cpq-input"
          />
          <div className="cpq-multiselect-meta">
            <span>
              {filteredItems.length} resultaat{filteredItems.length === 1 ? "" : "en"}
            </span>
            <button
              type="button"
              className="cpq-multiselect-close"
              onClick={() => setOpen(false)}
            >
              Klaar
            </button>
          </div>
          <div className="cpq-multiselect-results">
            {filteredItems.length === 0 ? (
              <div className="px-2 py-2 text-sm text-slate-500">Geen producten gevonden.</div>
            ) : (
              filteredItems.map((item) => (
                <label key={item.id} className="cpq-multiselect-option">
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={() => onToggle(item.id)}
                  />
                  <span className="cpq-multiselect-option-label">{item.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      ) : null}
      {selectedItems.length > 0 ? (
        <div className="cpq-multiselect-tags">
          {selectedItems.map((item) => (
            <span key={item.id} className="cpq-multiselect-tag">
              {item.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ErrorField({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {text}
    </div>
  );
}

export function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
      {text}
    </div>
  );
}

export function Idea({ text }: { text: string }) {
  return <div className="cpq-idea">{text}</div>;
}
