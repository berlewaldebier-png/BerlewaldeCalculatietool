"use client";

import Link from "next/link";

export function ProductenVerpakkingHero() {
  return (
    <section className="module-card proposal-hub-hero" style={{ marginTop: 12, marginBottom: 12 }}>
      <div className="proposal-hub-hero-copy">
        <div className="module-card-title">Nieuw samenstellen</div>
        <div className="module-card-text">
          Maak een afvuleenheid (intern) of een verkoopbaar artikel (SKU). Na afronden ga je door naar kostprijsbeheer
          om de kostprijs te activeren of af te ronden.
        </div>
      </div>
      <div className="proposal-hub-hero-actions">
        <Link href="/product-samenstellen" className="cpq-button cpq-button-primary">
          Nieuw samenstellen
        </Link>
      </div>
    </section>
  );
}

