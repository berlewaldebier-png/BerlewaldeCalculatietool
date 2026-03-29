"use client";

import { useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type JsonDatasetEditorProps = {
  endpoint: string;
  initialData: unknown;
  title?: string;
  description?: string;
};

export function JsonDatasetEditor({
  endpoint,
  initialData,
  title,
  description
}: JsonDatasetEditorProps) {
  const initialText = useMemo(
    () => JSON.stringify(initialData, null, 2),
    [initialData]
  );
  const [value, setValue] = useState(initialText);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setStatus("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      setStatus("JSON is ongeldig. Controleer de inhoud en probeer opnieuw.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(parsed)
      });

      if (!response.ok) {
        throw new Error("Opslaan mislukt");
      }

      setStatus("Opgeslagen.");
    } catch {
      setStatus("Opslaan mislukt.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="module-card">
      {title ? (
        <div className="module-card-header">
          <div className="module-card-title">{title}</div>
          {description ? <div className="module-card-text">{description}</div> : null}
        </div>
      ) : null}
      <textarea
        className="json-editor"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        spellCheck={false}
      />
      <div className="json-editor-actions">
        <button type="button" className="editor-button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Opslaan..." : "Opslaan"}
        </button>
        {status ? <span className="muted">{status}</span> : null}
      </div>
    </section>
  );
}
