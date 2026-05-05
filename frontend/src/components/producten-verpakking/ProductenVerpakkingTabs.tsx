"use client";

type TabKey = "verkoopbaar" | "verpakking" | "afvuleenheden" | "jaarprijzen" | "glasmaten";

export function ProductenVerpakkingTabs({
  activeTab,
  setActiveTab,
}: {
  activeTab: TabKey;
  setActiveTab: (next: TabKey) => void;
}) {
  return (
    <div className="tab-row">
      <button
        type="button"
        className={`tab-button ${activeTab === "verkoopbaar" ? "active" : ""}`}
        onClick={() => setActiveTab("verkoopbaar")}
      >
        Verkoopbare artikelen
      </button>
      <button
        type="button"
        className={`tab-button ${activeTab === "verpakking" ? "active" : ""}`}
        onClick={() => setActiveTab("verpakking")}
      >
        Verpakkingsonderdelen
      </button>
      <button
        type="button"
        className={`tab-button ${activeTab === "afvuleenheden" ? "active" : ""}`}
        onClick={() => setActiveTab("afvuleenheden")}
      >
        Afvuleenheden
      </button>
      <button
        type="button"
        className={`tab-button ${activeTab === "jaarprijzen" ? "active" : ""}`}
        onClick={() => setActiveTab("jaarprijzen")}
      >
        Jaarprijzen
      </button>
      <button
        type="button"
        className={`tab-button ${activeTab === "glasmaten" ? "active" : ""}`}
        onClick={() => setActiveTab("glasmaten")}
      >
        Glasmaten
      </button>

      <div className="tab-spacer" />
    </div>
  );
}

