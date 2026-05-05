"use client";

import React from "react";

import type { BuilderBlock } from "@/components/offerte-samenstellen/types";

export function BuilderBlockCard({
  block,
  onEdit,
  onRemove,
}: {
  block: BuilderBlock;
  onEdit: (block: BuilderBlock) => void;
  onRemove: (blockId: string) => void;
}) {
  return (
    <section className={`cpq-block ${block.tone}`}>
      <div className="cpq-block-row">
        <div className="cpq-block-icon">{block.icon}</div>
        <div className="cpq-block-body">
          <div className="cpq-block-title">{block.title}</div>
          <div className="cpq-block-subtitle">{block.subtitle}</div>
          <ul className="cpq-block-list">
            {block.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {block.impact ? <div className="cpq-block-impact">{block.impact}</div> : null}
        </div>
        <div className="cpq-block-actions">
          <button type="button" className="cpq-button cpq-button-secondary" onClick={() => onEdit(block)}>
            Bewerken
          </button>
          <button type="button" className="cpq-button cpq-button-secondary" onClick={() => onRemove(block.id)}>
            Verwijderen
          </button>
        </div>
      </div>
    </section>
  );
}

