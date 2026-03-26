from __future__ import annotations

from typing import Callable

import streamlit as st

from components.breadcrumb import render_breadcrumb
from components.page_ui import close_main_card, open_main_card, render_page_header


def show_handleiding_page(on_back: Callable[[], None]) -> None:
    """Toont een eerste werkhandleiding voor de app."""
    render_breadcrumb("Handleiding", on_back, home_label="Beheer")
    open_main_card()
    render_page_header("Handleiding", "Eerste werkinstructie voor dagelijks gebruik")

    tab_werkinstructie, tab_berekeningen = st.tabs(
        ["Werkinstructie", "Berekeningen & bronnen"]
    )

    with tab_werkinstructie:
        st.markdown("### 1. Jaarbasis op orde brengen")
        st.markdown(
            "- Controleer `Productie`, `Vaste kosten`, `Tarieven en heffingen` en `Producten & verpakking` voor het juiste jaar.\n"
            "- Gebruik `Nieuw jaar voorbereiden` als je een nieuw jaar wilt klaarzetten op basis van een bestaand bronjaar."
        )

        st.markdown("### 2. Kostprijs uitwerken")
        st.markdown(
            "- Gebruik `Nieuwe kostprijsberekening` voor nieuwe kostprijsberekeningen.\n"
            "- Gebruik `Recept hercalculeren` voor bestaande eigen productie-bieren."
        )

        st.markdown("### 3. Inkoopfacturen bijhouden")
        st.markdown(
            "- Voeg extra facturen toe via `Inkoopfacturen` als een bier op inkoop is gebaseerd.\n"
            "- Controleer daarna of de gemiddelde inkoopprijs per liter nog klopt."
        )

        st.markdown("### 4. Verkoop en prijsvoorstellen")
        st.markdown(
            "- Stel marges vast in `Verkoopstrategie`.\n"
            "- Maak daarna prijsvoorstellen via `Prijsvoorstel maken`."
        )

        st.markdown("### 5. Werkafspraak")
        st.markdown(
            "- Rond alleen definitieve records af als de invoer gecontroleerd is.\n"
            "- Gebruik de testomgeving eerst voor grotere wijzigingen."
        )

    with tab_berekeningen:
        st.markdown("### Nieuwe kostprijsberekening")
        st.markdown(
            "- `Gemiddelde inkoop per liter`\n"
            "  komt uit de variabele kosten per liter.\n"
            "- Bij `Inkoop` is dat:\n"
            "  `(totaal subbedragen + totale extra kosten) / totaal liters`.\n"
            "- Bij `Eigen productie` is dat:\n"
            "  `totale receptkosten / batchgrootte in liters`."
        )
        st.markdown(
            "**Bronnen**\n"
            "- `Inkoopfacturen` of stap 3 inkoopregels\n"
            "- `Productie` voor batchgrootte / inkoopliters\n"
            "- `Vaste kosten`\n"
            "- `Tarieven en heffingen`\n"
            "- `Producten & verpakking`"
        )

        st.markdown("### Indirecte en integrale kostprijs")
        st.markdown(
            "- `Gemiddelde indirecte kosten per liter`\n"
            "  wordt berekend uit de vaste kosten van het gekozen jaar.\n"
            "- Bij `Inkoop` gebruikt de app de indirecte vaste kosten gedeeld door totale ingekochte liters.\n"
            "- Bij `Eigen productie` gebruikt de app de directe vaste kosten per liter uit hetzelfde jaar.\n"
            "- `Gemiddelde integrale kostprijs per liter` =\n"
            "  `gemiddelde inkoop per liter + gemiddelde indirecte/directe vaste kosten per liter`."
        )

        st.markdown("### Productkostprijs in stap 4")
        st.markdown(
            "- Per verpakking of product telt de app op:\n"
            "  `variabele kosten + verpakkingskosten + vaste directe kosten + accijns`.\n"
            "- Voor basisproducten gebruikt de app de jaarproducten van `Producten & verpakking`.\n"
            "- Voor samengestelde producten telt de app de bouwstenen uit datzelfde jaar mee."
        )

        st.markdown("### Accijns en belasting")
        st.markdown(
            "- De belasting hangt af van:\n"
            "  `belastingsoort`, `tarief accijns`, `alcoholpercentage` en `liters per product`.\n"
            "- De tarieven komen uit `Tarieven en heffingen` van het gekozen jaar."
        )

        st.markdown("### Verkoopstrategie")
        st.markdown(
            "- `Marges per jaar` bewaart marges per verpakkingstype en kanaal.\n"
            "- `Overzicht bieren` kan productspecifieke afwijkingen bevatten.\n"
            "- Een prijsvoorstel kijkt eerst naar een productspecifieke strategie en anders naar de verpakkings- of jaarstrategie."
        )

        st.markdown("### Prijsvoorstel maken")
        st.markdown(
            "- `Op basis van liters` gebruikt staffels per bier.\n"
            "- `Op basis van producten` gebruikt producten/verpakkingen van het gekozen bier.\n"
            "- Voor `Inkoop` wordt per verpakking van het gekozen jaar de hoogste integrale kostprijs gebruikt.\n"
            "- Voor `Eigen productie` wordt per verpakking van het gekozen jaar de laatst bekende integrale kostprijs gebruikt."
        )

        st.markdown("### Belangrijkste databronnen")
        st.markdown(
            "- `data/berekeningen.json`: kostprijsberekeningen en gekoppelde facturen\n"
            "- `data/bieren.json`: centrale bierlijst\n"
            "- `data/verkoopprijzen.json`: verkoopstrategie en product-/verpakkingsmarges\n"
            "- `data/prijsvoorstellen.json`: prijsvoorstellen\n"
            "- `data/productie.json`: productievolumes\n"
            "- `data/vaste_kosten.json`: vaste kosten per jaar\n"
            "- `data/tarieven_heffingen.json`: accijns/verbruiksbelasting\n"
            "- `data/verpakkingsonderdelen.json`, `data/basisproducten.json`, `data/samengestelde_producten.json`: jaarproducten en verpakking"
        )

    if st.button("Terug naar beheer", key="handleiding_back"):
        on_back()
    close_main_card()
