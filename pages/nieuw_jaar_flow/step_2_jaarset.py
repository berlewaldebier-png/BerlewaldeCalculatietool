from __future__ import annotations

import streamlit as st


def render_step_2(state: dict, plan: dict) -> None:
    st.markdown(
        "<div class='section-text'>Bepaal per onderdeel of de gegevens van het bronjaar worden overgenomen naar het doeljaar. Kies je voor niet overnemen, dan moet je dat onderdeel later handmatig aanvullen.</div>",
        unsafe_allow_html=True,
    )

    key_map = {
        "Productie": "copy_productie",
        "Vaste kosten": "copy_vaste_kosten",
        "Tarieven en heffingen": "copy_tarieven",
        "Verpakkingsonderdelen": "copy_verpakkingsonderdelen",
        "Verkoopstrategie": "copy_verkoopstrategie",
    }

    for item in plan["steps"]:
        label = item["label"]
        state_key = key_map[label]
        left, right = st.columns([1.2, 3.0])
        with left:
            state[state_key] = st.checkbox(
                f"{label} overnemen",
                value=bool(state.get(state_key, True)),
                key=f"nieuw_jaar_{state_key}",
            )
        with right:
            source_status = "bekend" if item["source_exists"] else "ontbreekt"
            target_status = "bekend" if item["target_exists"] else "ontbreekt"
            st.markdown(
                f"<div class='section-text'>{label} bronjaar {plan['source_year']}: <strong>{source_status}</strong> - doeljaar {plan['target_year']}: <strong>{target_status}</strong></div>",
                unsafe_allow_html=True,
            )

    state["overwrite_existing"] = st.checkbox(
        "Bestaande doeljaargegevens overschrijven als die al bestaan",
        value=bool(state.get("overwrite_existing", False)),
    )
