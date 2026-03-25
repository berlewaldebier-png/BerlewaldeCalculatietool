from __future__ import annotations

import streamlit as st

from components.table_ui import render_read_only_table_cell, render_table_headers


def render_component_overview(plan: dict) -> None:
    """Toont een compact overzicht van de jaarafhankelijke onderdelen."""
    render_table_headers(["Onderdeel", "Bron", "Doel", "Actie"], [1.8, 1.0, 1.0, 2.2])
    for item in plan["steps"]:
        cols = st.columns([1.8, 1.0, 1.0, 2.2])
        with cols[0]:
            render_read_only_table_cell(item["label"])
        with cols[1]:
            render_read_only_table_cell("Bekend" if item["source_exists"] else "Ontbreekt")
        with cols[2]:
            render_read_only_table_cell("Bekend" if item["target_exists"] else "Ontbreekt")
        with cols[3]:
            render_read_only_table_cell("Dupliceren" if item["copy"] else "Later handmatig")
