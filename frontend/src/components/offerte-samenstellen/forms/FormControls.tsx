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
