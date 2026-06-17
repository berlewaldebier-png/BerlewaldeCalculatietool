"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import {
  BarChart3,
  Beer,
  BookOpen,
  Calculator,
  ChevronRight,
  FileText,
  Package,
  Search,
  Settings,
  ShoppingCart,
  Users,
  ClipboardList,
  Clock3
} from "lucide-react";

import { API_BASE_URL } from "@/lib/api";
import type { SearchGroup, SearchResponse, SearchResult } from "@/lib/search";

const ICON_BY_TYPE: Record<string, typeof Search> = {
  invoice: FileText,
  order: ShoppingCart,
  customer: Users,
  beer: Beer,
  product: Package,
  recipe: ClipboardList,
  report: BarChart3,
  setting: Settings,
  costprice: Calculator,
  "break-even": Clock3,
  documentation: BookOpen
};

function getIcon(type: string) {
  return ICON_BY_TYPE[type] || FileText;
}

function flattenResults(groups: SearchGroup[]) {
  return groups.flatMap((group) => group.items.map((item) => ({ group, item })));
}

function formatMessage(status: string, query: string) {
  if (!query || query.length < 3) {
    return "Typ minimaal 3 tekens om te zoeken.";
  }
  if (status === "loading") {
    return "Zoeken…";
  }
  return "Geen resultaten gevonden.";
}

export function SmartGlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "empty">("idle");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const results = useMemo(() => (response?.groups || []), [response]);
  const flattened = useMemo(() => flattenResults(results), [results]);
  const activeItem = flattened[activeIndex]?.item;

  useEffect(() => {
    const handleGlobalHotkey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleGlobalHotkey);
    return () => window.removeEventListener("keydown", handleGlobalHotkey);
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    if (!query || query.length < 3) {
      setOpen(query.length >= 3);
      setStatus(query.length === 0 ? "idle" : "empty");
      setResponse(null);
      setActiveIndex(0);
      return () => {
        if (timer) window.clearTimeout(timer);
        active = false;
      };
    }

    setStatus("loading");
    timer = window.setTimeout(() => {
      void fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`, { cache: "no-store" })
        .then((response) => response.json())
        .then((payload: SearchResponse) => {
          if (!active) return;
          setResponse(payload);
          setStatus(payload.groups.length ? "ready" : "empty");
          setOpen(true);
          setActiveIndex(0);
        })
        .catch(() => {
          if (!active) return;
          setResponse(null);
          setStatus("empty");
          setOpen(true);
          setActiveIndex(0);
        });
    }, 300);

    return () => {
      if (timer) window.clearTimeout(timer);
      active = false;
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;

    const handleClick = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && dropdownRef.current?.contains(target)) {
        return;
      }
      if (target instanceof Node && inputRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => Math.min(current + 1, flattened.length - 1));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(current - 1, 0));
        return;
      }

      if (event.key === "Enter" && activeItem) {
        event.preventDefault();
        router.push(activeItem.href as Route);
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, flattened, activeItem, router]);

  const handleSelect = (item: SearchResult) => {
    router.push(item.href as Route);
    setOpen(false);
  };

  const hasGroups = results.length > 0;

  return (
    <div className="dashboard-header__search" style={{ position: "relative" }}>
      <Search size={18} className="dashboard-header__search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Zoek orders, klanten, producten..."
        className="dashboard-header__search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => {
          if (query.length >= 3) {
            setOpen(true);
          }
        }}
        aria-label="Zoeken"
      />
      <span className="dashboard-header__search-kbd" aria-hidden="true">
        Ctrl K
      </span>

      {open ? (
        <div className="dashboard-header__search-dropdown" ref={dropdownRef}>
          {status === "loading" ? (
            <div className="dashboard-header__search-state">Zoeken…</div>
          ) : !hasGroups ? (
            <div className="dashboard-header__search-state">{formatMessage(status, query)}</div>
          ) : (
            <>
              {response?.interpretedAs ? (
                <div className="dashboard-header__search-interpreted">Zoeken naar: {response.interpretedAs}</div>
              ) : null}
              {results.map((group) => (
                <div key={group.type} className="dashboard-header__search-group">
                  <div className="dashboard-header__search-group-label">
                    {group.label}
                    {group.count ? ` · ${group.count}` : ""}
                  </div>
                  <div className="dashboard-header__search-group-items">
                    {group.items.map((item) => {
                      const Icon = getIcon(item.type);
                      const index = flattened.findIndex((entry) => entry.item.id === item.id);
                      const isActive = index === activeIndex;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={
                            isActive
                              ? "dashboard-header__search-item dashboard-header__search-item--active"
                              : "dashboard-header__search-item"
                          }
                          onClick={() => handleSelect(item)}
                          role="option"
                          aria-selected={isActive}
                        >
                          <span className="dashboard-header__search-item-icon" aria-hidden="true">
                            <Icon size={18} />
                          </span>
                          <span className="dashboard-header__search-item-copy">
                            <span className="dashboard-header__search-item-title">{item.title}</span>
                            {item.subtitle ? <span className="dashboard-header__search-item-subtitle">{item.subtitle}</span> : null}
                          </span>
                          {item.meta ? <span className="dashboard-header__search-item-meta">{item.meta}</span> : null}
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                  {group.viewAllHref ? (
                    <button
                      type="button"
                      className="dashboard-header__search-group-all"
                      onClick={() => {
                        router.push((group.viewAllHref ?? "/") as Route);
                        setOpen(false);
                      }}
                    >
                      Bekijk alle resultaten voor {group.label.toLowerCase()}
                    </button>
                  ) : null}
                </div>
              ))}
              <div className="dashboard-header__search-footer">
                <button
                  type="button"
                  className="dashboard-header__search-view-all"
                  onClick={() => {
                    router.push(`/search?q=${encodeURIComponent(query)}`);
                    setOpen(false);
                  }}
                >
                  Bekijk alle resultaten
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
