"use client";

import { useEffect, useState } from "react";

type GitInfo = {
  enabled: boolean;
  branch: string | null;
  shortSha: string | null;
};

export function DevGitBadge() {
  const [info, setInfo] = useState<GitInfo | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    if (host !== "localhost" && host !== "127.0.0.1") return;

    let cancelled = false;
    fetch("/api/dev/git", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        if (!json || json.enabled === false) return;
        setInfo({
          enabled: true,
          branch: typeof json.branch === "string" ? json.branch : null,
          shortSha: typeof json.shortSha === "string" ? json.shortSha : null
        });
      })
      .catch(() => {
        // Silent: badge is best-effort in dev only.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!info?.enabled) return null;
  const label =
    info.branch && info.shortSha ? `${info.branch}@${info.shortSha}` : info.branch || info.shortSha || "";
  if (!label) return null;

  return (
    <span
      title="Dev: git branch@commit"
      style={{
        fontSize: 12,
        fontWeight: 650,
        color: "#5a6a86",
        background: "#f3f7ff",
        border: "1px solid #d7e1f4",
        borderRadius: 999,
        padding: "6px 10px",
        whiteSpace: "nowrap"
      }}
    >
      DEV {label}
    </span>
  );
}

