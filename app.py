from __future__ import annotations

from pathlib import Path

import streamlit as st


PROJECT_ROOT = Path(__file__).resolve().parent
START_SCRIPT = PROJECT_ROOT / "scripts" / "start_new_ui.ps1"
REGRESSION_SCRIPT = PROJECT_ROOT / "scripts" / "run_regression_checks.ps1"


def main() -> None:
    st.set_page_config(
        page_title="Berlewalde Calculatie Tool",
        page_icon="B",
        layout="wide",
    )

    st.title("Berlewalde Calculatie Tool")
    st.subheader("Legacy Streamlit ingang")
    st.info(
        "De Streamlit-UI is uitgefaseerd als hoofdapp. "
        "De nieuwe standaard is de Next.js-frontend met FastAPI-backend."
    )

    st.markdown("### Nieuwe standaardroute")
    st.code(
        f"powershell -ExecutionPolicy Bypass -File {START_SCRIPT}",
        language="powershell",
    )
    st.markdown("- Frontend: `http://localhost:3000`")
    st.markdown("- Backend: `http://127.0.0.1:8000`")

    st.markdown("### Regressiechecks")
    st.code(
        f"powershell -ExecutionPolicy Bypass -File {REGRESSION_SCRIPT}",
        language="powershell",
    )

    st.markdown("### Waarom deze pagina nog bestaat")
    st.markdown(
        "- als duidelijke verwijzing voor oude bookmarks\n"
        "- om te voorkomen dat de oude Streamlit-UI per ongeluk nog als primaire app wordt gebruikt\n"
        "- omdat de onderliggende Python-businesslogica nog wel deels in de repo blijft staan"
    )

    st.warning(
        "Wijzigingen en validatie horen vanaf nu in de web-UI te gebeuren. "
        "De oude Streamlit-schermen worden niet meer actief bijgewerkt."
    )


if __name__ == "__main__":
    main()
