type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
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

export function Field({ label, value, onChange, placeholder }: FieldProps) {
  return (
    <label className="cpq-field">
      <div className="cpq-label">{label}</div>
      <input
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

export function Idea({ text }: { text: string }) {
  return <div className="cpq-idea">{text}</div>;
}
