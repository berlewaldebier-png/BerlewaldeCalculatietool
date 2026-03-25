from __future__ import annotations

import streamlit as st

from .state import run_generation, set_feedback


def render_step_5(state: dict, plan: dict) -> None:
    st.markdown(
        "<div class='section-text'>Rond de jaarvoorbereiding af. De wizard zet de geselecteerde onderdelen klaar voor het doeljaar en maakt, indien gekozen, nieuwe conceptberekeningen aan.</div>",
        unsafe_allow_html=True,
    )
    st.markdown(
        "<div class='section-text'><strong>Na afronden kijk je verder in:</strong> Productie, Vaste kosten, Tarieven en heffingen, Producten & verpakking, Verkoopstrategie en Nieuwe berekening.</div>",
        unsafe_allow_html=True,
    )

    if st.button("Afronden", key="nieuw_jaar_finalize", type="primary", use_container_width=True):
        result = run_generation(state, plan)
        st.session_state["nieuw_jaar_last_result"] = {
            "source_year": plan["source_year"],
            "target_year": plan["target_year"],
            "open_actions": list(result["open_actions"]),
            "berekeningen": int(result["berekeningen"]),
            "verpakkingsonderdelen": int(result["verpakkingsonderdelen"]),
            "verkoopstrategie": int(result["verkoopstrategie"]),
            "vaste_kosten": int(result["vaste_kosten"]),
            "tarieven": bool(result["tarieven"]),
            "productie": bool(result["productie"]),
        }
        summary_parts = [
            f"Productie {'klaar' if result['productie'] else 'niet aangepast'}",
            f"{result['vaste_kosten']} vaste-kostenregels",
            f"Tarieven {'gekopieerd' if result['tarieven'] else 'niet aangepast'}",
            f"{result['verpakkingsonderdelen']} verpakkingsonderdelen",
            f"{result['verkoopstrategie']} strategieen",
            f"{result['berekeningen']} conceptberekeningen",
        ]
        message = "Nieuw jaar voorbereid: " + ", ".join(summary_parts) + "."
        if result["open_actions"]:
            message += " Open acties: " + " ".join(result["open_actions"])
        set_feedback(message, "success")
        st.rerun()
