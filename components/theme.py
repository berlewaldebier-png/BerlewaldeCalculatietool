from __future__ import annotations

import streamlit as st


APP_THEME_CSS = """
<style>
[data-testid="stSidebar"],
[data-testid="stSidebarCollapsedControl"],
[data-testid="collapsedControl"],
header[data-testid="stHeader"] {
    display: none !important;
}

.stApp {
    background: linear-gradient(180deg, #f7f5ef 0%, #fcfbf8 100%);
    color: #24332b;
}

.block-container {
    padding-top: 0;
    padding-bottom: 2rem;
    max-width: 1450px;
}

.app-shell-header-anchor + div[data-testid="stHorizontalBlock"] {
    min-height: 8.5rem;
    margin: 0 -999rem 1.15rem -999rem;
    padding: 1.15rem 999rem;
    border-bottom: 1px solid #d9ddcf;
    background: #ffffff;
    box-shadow: 0 8px 20px rgba(36, 51, 43, 0.05);
}

.app-shell-brand {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
}

.app-shell-user {
    color: #24332b;
    font-size: 0.96rem;
    font-weight: 600;
    text-align: right;
    white-space: nowrap;
}

.app-shell-logo {
    display: block;
    height: 6.6rem;
    width: auto;
    max-width: min(38rem, 80vw);
    object-fit: contain;
}

.app-shell-header-anchor + div[data-testid="stHorizontalBlock"] div.stButton > button {
    width: auto;
    min-width: 2.7rem;
    min-height: 2.4rem;
    height: 2.4rem;
    padding: 0 0.8rem;
    border-radius: 10px;
    background: #ffffff;
}

.app-shell-header-anchor + div[data-testid="stHorizontalBlock"] div.stButton > button:hover {
    background: #f7f5ef;
}

.main-card {
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid #d9ddcf;
    border-radius: 18px;
    padding: 2rem;
    box-shadow: 0 10px 28px rgba(36, 51, 43, 0.08);
}

.main-card:empty {
    display: none !important;
}

.home-main {
    padding: 1.25rem 0 2rem 0;
}

.action-bar {
    margin-bottom: 1.35rem;
    padding: 1rem 1.2rem;
    border: 1px solid #d6c97e;
    border-radius: 16px;
    background: #eadf9b;
    color: #24332b;
    box-shadow: 0 6px 18px rgba(36, 51, 43, 0.05);
}

.action-bar-title {
    font-size: 1rem;
    font-weight: 700;
    margin-bottom: 0.2rem;
}

.action-bar-text {
    font-size: 0.9rem;
    color: #4e5c52;
    margin-bottom: 0.75rem;
}

.action-bar-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
}

.action-bar-item {
    padding: 0.8rem 0.9rem;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.35);
}

.action-bar-label {
    font-size: 0.82rem;
    color: #5b6b60;
    margin-bottom: 0.15rem;
}

.action-bar-value {
    font-size: 1.35rem;
    font-weight: 700;
    color: #24332b;
    line-height: 1.1;
}

.home-section {
    margin-top: 1.1rem;
    margin-bottom: 0.8rem;
}

.home-section-divider {
    margin-top: 1.1rem;
    padding-top: 0.9rem;
    border-top: 1px solid rgba(201, 206, 194, 0.9);
}

.home-section-title {
    color: #24332b;
    font-size: 1.15rem;
    font-weight: 700;
    margin-bottom: 0.2rem;
}

.home-section-text {
    color: #6a776d;
    font-size: 0.95rem;
    margin-bottom: 0.85rem;
}

.home-card-shell {
    margin-bottom: 0.8rem;
}

.home-card-shell div[data-testid="stButton"] > button {
    width: 100%;
    min-height: 7.4rem;
    height: auto;
    padding: 1.1rem 1.1rem 1rem 1.1rem;
    border-radius: 16px;
    border: 1px solid #d9ddcf;
    background: linear-gradient(180deg, #fbfbf7 0%, #f4f6ef 100%) !important;
    box-shadow: 0 6px 18px rgba(36, 51, 43, 0.04) !important;
    color: #24332b !important;
    text-align: left;
    justify-content: flex-start;
    align-items: flex-start;
    white-space: pre-wrap;
    line-height: 1.45;
    font-size: 0.98rem;
    font-weight: 700;
}

.home-card-shell div[data-testid="stButton"] > button:hover {
    background: linear-gradient(180deg, #f6f7f1 0%, #edf1e5 100%) !important;
    border-color: #bcc6b8 !important;
    box-shadow: 0 10px 22px rgba(36, 51, 43, 0.07) !important;
    color: #1d2922 !important;
}

.home-card-shell div[data-testid="stButton"] > button:focus,
.home-card-shell div[data-testid="stButton"] > button:focus-visible {
    outline: none !important;
    box-shadow: 0 0 0 3px rgba(234, 223, 155, 0.45) !important;
}

.home-footer {
    margin: 1.5rem -999rem -2rem -999rem;
    padding: 1rem 999rem 1.1rem 999rem;
    border-top: 1px solid #d6c97e;
    background: #eadf9b;
    color: #24332b;
}

.home-footer-title {
    font-size: 0.96rem;
    font-weight: 700;
    margin-bottom: 0.2rem;
}

.home-footer-text {
    font-size: 0.86rem;
    color: #4e5c52;
}

.page-title {
    color: #24332b;
    font-size: 2.2rem;
    font-weight: 700;
    margin-bottom: 0.4rem;
}

.page-subtitle {
    color: #5b6b60;
    font-size: 1.05rem;
    margin-bottom: 1.8rem;
}

.section-text {
    color: #5b6b60;
    font-size: 1rem;
    margin-bottom: 1rem;
}

div.stButton > button {
    width: 100%;
    min-height: 3rem;
    border-radius: 12px;
    border: 1px solid #d8ddd2;
    background: #f7f5ef;
    color: #24332b;
    font-weight: 600;
}

div.stButton > button:hover {
    border-color: #c8d0c1;
    background: #f1eee5;
    color: #1b261f;
}

div[data-testid="stForm"] {
    border: 1px solid #d9ddcf;
    border-radius: 16px;
    padding: 1rem;
    background: #ffffff;
}
</style>
"""


def apply_app_theme() -> None:
    """Past de globale Streamlit-configuratie en app-styling toe."""
    st.set_page_config(
        page_title="Berlewalde calculatie tool",
        page_icon="",
        layout="wide",
        initial_sidebar_state="collapsed",
    )
    st.markdown(APP_THEME_CSS, unsafe_allow_html=True)
