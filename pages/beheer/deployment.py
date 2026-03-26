from __future__ import annotations

from typing import Callable

import streamlit as st

from components.breadcrumb import render_breadcrumb
from components.page_ui import close_main_card, open_main_card, render_page_header


def show_deployment_instructie_page(on_back: Callable[[], None]) -> None:
    """Toont een stappenplan voor deployment vanuit de testbranch."""
    render_breadcrumb("Deployment instructie", on_back, home_label="Beheer")
    open_main_card()
    render_page_header("Deployment instructie", "Alleen voor de testomgeving")

    st.markdown("### Stap 1. Werk vastleggen op `codex/calculatietest`")
    st.code(
        "git add .\n"
        "git commit -m \"Beschrijving van de wijziging\"\n"
        "git push",
        language="powershell",
    )

    st.markdown("### Stap 2. Productiedata terughalen naar test")
    st.code(
        "git checkout codex/calculatietest\n"
        "git checkout main -- data\n"
        "git commit -m \"Sync productiedata from main\"\n"
        "git push",
        language="powershell",
    )

    st.markdown("### Stap 3. Regressiecheck")
    st.markdown(
        "- Controleer inloggen en homepagina.\n"
        "- Controleer `Productie`, `Vaste kosten`, `Tarieven en heffingen` en `Producten & verpakking`.\n"
        "- Controleer `Nieuwe kostprijsberekening`, `Inkoopfacturen`, `Verkoopstrategie` en `Prijsvoorstel maken`.\n"
        "- Gebruik minimaal één bekend scenario, bijvoorbeeld `IPA 2025`."
    )

    st.markdown("### Stap 4. Testbranch naar productie brengen")
    st.code(
        "git checkout main\n"
        "git pull origin main\n"
        "git merge codex/calculatietest\n"
        "git push origin main",
        language="powershell",
    )

    st.markdown("### Stap 5. Production deploy controleren")
    st.markdown(
        "- Controleer de productie-app na deployment.\n"
        "- Loop dezelfde smoke test nog één keer kort door."
    )

    if st.button("Terug naar beheer", key="deployment_back"):
        on_back()
    close_main_card()
