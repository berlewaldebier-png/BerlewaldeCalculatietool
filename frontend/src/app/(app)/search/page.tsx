"use client";

import Link from "next/link";
import type { Route } from "next";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Search as SearchIcon } from "lucide-react";

import { API_BASE_URL } from "@/lib/api";
import type { FullSearchHit, SearchResponse } from "@/lib/search";

function highlightSnippet(text: string, terms: string[]) {
  if (!terms.length) {
    return text;
  }

  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  return text.replace(pattern, "<strong>$1</strong>");
}

export default function SearchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryParam = searchParams.get("q") ?? "";
  const scopeParam = searchParams.get("scope") ?? "";
  const [query, setQuery] = useState(queryParam);
  const [scope, setScope] = useState(scopeParam);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty">("idle");

  useEffect(() => {
    setQuery(queryParam);
    setScope(scopeParam);
  }, [queryParam, scopeParam]);

  useEffect(() => {
    if (!query || query.length < 3) {
      setResponse(null);
      setStatus(query.length === 0 ? "idle" : "empty");
      return;
    }

    setStatus("loading");
    const controller = new AbortController();
    void fetch(
      `${API_BASE_URL}/search?q=${encodeURIComponent(query)}&mode=full${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`,
      { cache: "no-store", signal: controller.signal }
    )
      .then((result) => result.json())
      .then((payload: SearchResponse) => {
        setResponse(payload);
        setStatus(payload.fullResults?.length ? "ready" : "empty");
      })
      .catch(() => {
        setResponse(null);
        setStatus("empty");
      });

    return () => controller.abort();
  }, [query, scope]);

  const highlightTerms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push(`/search?q=${encodeURIComponent(query)}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`);
  };

  return (
    <div className="search-page">
      <div className="search-page__hero">
        <div>
          <p className="search-page__eyebrow">Zoekpagina</p>
          <h1>Zoek in alle records, documenten en helpartikelen</h1>
          <p className="search-page__intro">Gebruik slimme intentieherkenning, gegroepeerde resultaten en een diepere zoekervaring.</p>
        </div>
      </div>

      <form className="search-page__form" onSubmit={handleSubmit}>
        <label htmlFor="search-q" className="search-page__label">
          Zoekterm
        </label>
        <div className="search-page__input-group">
          <SearchIcon size={18} aria-hidden="true" />
          <input
            id="search-q"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Zoek naar facturen, orders, klanten, instellingen, handleidingen..."
            className="search-page__input"
            aria-label="Zoekterm"
          />
          <button type="submit" className="search-page__button">
            Zoek
          </button>
        </div>
      </form>

      {response?.interpretedAs ? <div className="search-page__hint">{response.interpretedAs}</div> : null}

      <div className="search-page__summary">
        {status === "idle" ? (
          <p>Typ minimaal 3 tekens om resultaten te tonen.</p>
        ) : status === "loading" ? (
          <p>Zoeken…</p>
        ) : status === "empty" ? (
          <p>Geen resultaten gevonden voor "{query}".</p>
        ) : (
          <p>{response?.fullResults?.length ?? 0} resultaten gevonden voor "{query}".</p>
        )}
      </div>

      {response?.fullResults?.length ? (
        <div className="search-page__results">
          {response.fullResults.map((hit) => (
            <article key={hit.id} className="search-page__hit">
              <div className="search-page__hit-meta">
                <span className="search-page__hit-category">{hit.category}</span>
                {hit.section ? <span className="search-page__hit-section">{hit.section}</span> : null}
              </div>
              <Link href={hit.href as Route} className="search-page__hit-title">
                {hit.title}
              </Link>
              {hit.subtitle ? <p className="search-page__hit-subtitle">{hit.subtitle}</p> : null}
              <p
                className="search-page__hit-snippet"
                dangerouslySetInnerHTML={{ __html: highlightSnippet(hit.snippet, highlightTerms) }}
              />
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
