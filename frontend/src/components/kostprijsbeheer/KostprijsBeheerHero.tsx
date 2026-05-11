"use client";

export function KostprijsBeheerHero({
  onStartNew,
}: {
  onStartNew: () => void;
}) {
  return (
    <section className="module-card proposal-hub-hero" style={{ marginTop: 12 }}>
      <div className="proposal-hub-hero-copy">
        <div className="module-card-title">Nieuwe kostprijsberekening</div>
        <div className="module-card-text">
          Start direct een nieuwe kostprijswizard. Na afronden kun je de versie activeren zodat deze overal als actieve kostprijs beschikbaar is.
        </div>
        <div className="module-card-text" style={{ marginTop: 8 }}>
          Problemen of onlogische waarden? Bekijk{" "}
          <a href="/beheer/handleiding" className="inline-link">
            Problemen oplossen
          </a>
          .
        </div>
      </div>
      <div className="proposal-hub-hero-actions">
        <button
          type="button"
          className="cpq-button cpq-button-primary"
          onClick={onStartNew}
        >
          Nieuwe kostprijs starten
        </button>
      </div>
    </section>
  );
}

