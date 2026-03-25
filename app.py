import base64
from pathlib import Path

import streamlit as st

from components.page_ui import close_main_card, open_main_card, render_page_header
from components.theme import apply_app_theme
from pages.inkoop_facturen import show_inkoop_facturen_page
from pages.nieuw_jaar_flow import show_nieuw_jaar_voorbereiden_page
from pages.nieuwe_berekening import show_nieuwe_berekening_page
from pages.prijsvoorstel_flow import show_prijsvoorstel_page
from pages.producten_verpakking import show_producten_verpakking_page
from pages.productie import show_productie_page
from pages.tarieven_heffingen import show_tarieven_heffingen_page
from pages.vaste_kosten import show_vaste_kosten_page
from pages.verkoopstrategie_flow import show_verkoopstrategie_page
from utils.storage import get_concept_berekeningen, get_concept_prijsvoorstellen


PAGE_HOME = "home"
PAGE_PRODUCTIE = "productie"
PAGE_VASTE_KOSTEN = "vaste_kosten"
PAGE_NIEUWE_BEREKENING = "nieuwe_berekening"
PAGE_INKOOP_FACTUREN = "inkoop_facturen"
PAGE_VERKOOPSTRATEGIE = "verkoopstrategie"
PAGE_NIEUW_JAAR_VOORBEREIDEN = "nieuw_jaar_voorbereiden"
PAGE_TARIEVEN_HEFFINGEN = "tarieven_heffingen"
PAGE_PRODUCTEN_VERPAKKING = "producten_verpakking"
PAGE_PRIJSVOORSTEL = "prijsvoorstel"

LOGOUT_ICON = "\u21AA"
HEADER_LOGO_PATH = Path(
    r"C:\Users\hansh\OneDrive - Brouwerij Berlewalde\Gedeelde documenten - Berlewalde\Brouwerij Berlewalde\04 - Verkoop & Marketing\02 - Marketing en promo\01 - Interne promotiemateriaal\1. Logo\berlewalde-met-slogan.svg"
)


def init_session_state() -> None:
    """Zet basiswaarden in session_state als die nog niet bestaan."""
    if "logged_in" not in st.session_state:
        st.session_state["logged_in"] = False
    if "username" not in st.session_state:
        st.session_state["username"] = ""
    if "page" not in st.session_state:
        st.session_state["page"] = PAGE_HOME


@st.cache_data(show_spinner=False)
def _load_header_logo_data_uri() -> str:
    """Laadt het headerlogo als data-URI."""
    if not HEADER_LOGO_PATH.exists():
        return ""
    svg_bytes = HEADER_LOGO_PATH.read_bytes()
    encoded = base64.b64encode(svg_bytes).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def set_page(page_name: str) -> None:
    """Wijzigt de actieve pagina en herlaadt de interface."""
    st.session_state["page"] = page_name
    st.rerun()


def logout() -> None:
    """Reset de sessie naar de standaardstatus."""
    st.session_state["logged_in"] = False
    st.session_state["username"] = ""
    st.session_state["page"] = PAGE_HOME
    st.rerun()


def render_app_header() -> None:
    """Toont een globale app-header boven de pagina-inhoud."""
    logo_data_uri = _load_header_logo_data_uri()
    logo_markup = (
        f"<img class='app-shell-logo' src='{logo_data_uri}' alt='Berlewalde logo' />"
        if logo_data_uri
        else "<div class='app-shell-user'>Berlewalde calculatie tool</div>"
    )

    st.markdown("<div class='app-shell-header-anchor'></div>", unsafe_allow_html=True)
    _, center_col, right_col = st.columns([1.4, 1.2, 1.4], vertical_alignment="center")
    with center_col:
        st.markdown(f"<div class='app-shell-brand'>{logo_markup}</div>", unsafe_allow_html=True)
    with right_col:
        user_col, edit_col, logout_col = st.columns([4.2, 1, 1], vertical_alignment="center")
        with user_col:
            username = st.session_state.get("username") or "admin"
            st.markdown(f"<div class='app-shell-user'>{username}</div>", unsafe_allow_html=True)
        with edit_col:
            if st.button(":material/edit:", key="header_edit_profile", help="Profiel bewerken"):
                st.toast("Profiel bewerken volgt later.")
        with logout_col:
            if st.button(LOGOUT_ICON, key="header_logout", help="Uitloggen"):
                logout()


def render_home_card(title: str, description: str, key: str) -> bool:
    """Toont een rustige, volledig klikbare homekaart."""
    st.markdown("<div class='home-card-shell'>", unsafe_allow_html=True)
    clicked = st.button(title, key=key)
    st.markdown("</div>", unsafe_allow_html=True)
    return clicked


def render_home_section(title: str, description: str) -> None:
    """Toont een consistente sectiekop op de homepagina."""
    st.markdown("<div class='home-section'>", unsafe_allow_html=True)
    st.markdown(f"<div class='home-section-title'>{title}</div>", unsafe_allow_html=True)
    st.markdown(f"<div class='home-section-text'>{description}</div>", unsafe_allow_html=True)


def render_home_footer() -> None:
    """Toont de vaste footer van de homepagina."""
    st.markdown(
        """
        <div class='home-footer'>
            <div class='home-footer-title'>Berlewalde calculatie tool</div>
            <div class='home-footer-text'>Kostprijzen, verkoopstrategie en prijsvoorstellen op één centrale plek.</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_action_bar() -> None:
    """Toont een compacte dashboardbalk met open acties."""
    concept_berekeningen = len(get_concept_berekeningen())
    concept_prijsvoorstellen = len(get_concept_prijsvoorstellen())
    jaar_resultaat = st.session_state.get("nieuw_jaar_last_result", {})
    jaar_open_actions = (
        list(jaar_resultaat.get("open_actions", []))
        if isinstance(jaar_resultaat, dict)
        else []
    )
    open_jaaracties = len(jaar_open_actions)
    totaal_open = concept_berekeningen + concept_prijsvoorstellen + open_jaaracties
    jaaractie_toelichting = ""
    if open_jaaracties and isinstance(jaar_resultaat, dict):
        target_year = jaar_resultaat.get("target_year")
        open_actions_text = " ".join(str(action) for action in jaar_open_actions)
        jaaractie_toelichting = (
            "<div class='action-bar-text' style='margin-top:0.75rem;margin-bottom:0;'>"
            f"Laatste jaarvoorbereiding {target_year}: {open_jaaracties} open acties. "
            f"{open_actions_text}"
            "</div>"
        )

    st.markdown(
        f"""
        <div class='action-bar'>
            <div class='action-bar-title'>Actiebar</div>
            <div class='action-bar-text'>Er staan momenteel {totaal_open} open acties klaar om verder af te ronden.</div>
            <div class='action-bar-grid'>
                <div class='action-bar-item'>
                    <div class='action-bar-label'>Concept berekeningen</div>
                    <div class='action-bar-value'>{concept_berekeningen}</div>
                </div>
                <div class='action-bar-item'>
                    <div class='action-bar-label'>Concept prijsvoorstellen</div>
                    <div class='action-bar-value'>{concept_prijsvoorstellen}</div>
                </div>
                <div class='action-bar-item'>
                    <div class='action-bar-label'>Open jaaracties</div>
                    <div class='action-bar-value'>{open_jaaracties}</div>
                </div>
                <div class='action-bar-item'>
                    <div class='action-bar-label'>Totaal open acties</div>
                    <div class='action-bar-value'>{totaal_open}</div>
                </div>
            </div>
            {jaaractie_toelichting}
        </div>
        """,
        unsafe_allow_html=True,
    )


def show_login() -> None:
    """Toont het login-scherm en verwerkt de vaste inloggegevens."""
    _, center, _ = st.columns([1.2, 1.6, 1.2])

    with center:
        open_main_card()
        render_page_header("Inloggen", "Berlewalde calculatie tool")

        with st.form("login_form"):
            username = st.text_input("Gebruikersnaam")
            password = st.text_input("Wachtwoord", type="password")
            submitted = st.form_submit_button("Inloggen")

        if submitted:
            if username == "admin" and password == "admin":
                st.session_state["logged_in"] = True
                st.session_state["username"] = username
                st.session_state["page"] = PAGE_HOME
                st.success("Succesvol ingelogd.")
                st.rerun()
            else:
                st.error("Onjuiste gebruikersnaam of wachtwoord.")

        close_main_card()


def show_home() -> None:
    """Toont de landingspagina na succesvolle login."""
    st.markdown("<div class='home-main'>", unsafe_allow_html=True)
    render_action_bar()

    render_home_section(
        "Beheer",
        "Onderhoud de vaste gegevens waarop berekeningen en voorstellen steunen.",
    )
    beheer_cols = st.columns(3, gap="large")
    with beheer_cols[0]:
        if render_home_card(
            "🏭 Productie",
            "Beheer productiegegevens per jaar als basis voor vaste kosten en kostprijzen.",
            "home_productie",
        ):
            set_page(PAGE_PRODUCTIE)
    with beheer_cols[1]:
        if render_home_card(
            "💰 Vaste kosten",
            "Leg vaste kosten per productiejaar vast en houd de jaarbasis actueel.",
            "home_vaste_kosten",
        ):
            st.session_state.pop("vaste_kosten_selected_year", None)
            set_page(PAGE_VASTE_KOSTEN)
    with beheer_cols[2]:
        if render_home_card(
            "⚖️ Tarieven en heffingen",
            "Beheer accijnzen en overige heffingen die in berekeningen worden gebruikt.",
            "home_tarieven_heffingen",
        ):
            set_page(PAGE_TARIEVEN_HEFFINGEN)

    beheer_cols_2 = st.columns(3, gap="large")
    with beheer_cols_2[0]:
        if render_home_card(
            "📦 Producten & verpakking",
            "Onderhoud verpakkingsonderdelen, basisproducten en samengestelde producten.",
            "home_producten_verpakking",
        ):
            set_page(PAGE_PRODUCTEN_VERPAKKING)
    with beheer_cols_2[1]:
        st.write("")
    with beheer_cols_2[2]:
        st.write("")
    st.markdown("</div>", unsafe_allow_html=True)

    st.markdown("<div class='home-section-divider'></div>", unsafe_allow_html=True)
    render_home_section(
        "Calculatie",
        "Werk kostprijzen uit, beheer inkoopfacturen en bereid een nieuw jaar gecontroleerd voor.",
    )
    calc_cols = st.columns(3, gap="large")
    with calc_cols[0]:
        if render_home_card(
            "🧮 Nieuwe berekening",
            "Bereken kostprijzen voor eigen productie of inkoop en werk concepten verder uit.",
            "home_nieuwe_berekening",
        ):
            st.session_state.pop("nieuwe_berekening_selected_year", None)
            st.session_state.pop("nieuwe_berekening_selected_bier_id", None)
            st.session_state.pop("nieuwe_berekening_loaded_key", None)
            st.session_state["nieuwe_berekening_view_mode"] = "overview"
            st.session_state["nieuwe_berekening_mode"] = "new"
            st.session_state["nieuwe_berekening_step"] = 1
            set_page(PAGE_NIEUWE_BEREKENING)
    with calc_cols[1]:
        if render_home_card(
            "🧾 Inkoopfacturen",
            "Voeg extra inkoopfacturen toe aan bestaande inkoopberekeningen en houd gemiddelden actueel.",
            "home_inkoop_facturen",
        ):
            set_page(PAGE_INKOOP_FACTUREN)
    with calc_cols[2]:
        if render_home_card(
            "🎇 Nieuw jaar voorbereiden",
            "Maak concepten voor een nieuw jaar aan op basis van een bestaand bronjaar.",
            "home_nieuw_jaar_voorbereiden",
        ):
            set_page(PAGE_NIEUW_JAAR_VOORBEREIDEN)
    st.markdown("</div>", unsafe_allow_html=True)

    st.markdown("<div class='home-section-divider'></div>", unsafe_allow_html=True)
    render_home_section(
        "Commercieel",
        "Stel marges vast, werk productprijzen uit en maak prijsvoorstellen voor klanten.",
    )
    comm_cols = st.columns(3, gap="large")
    with comm_cols[0]:
        if render_home_card(
            "📊 Verkoopstrategie",
            "Beheer standaardmarges per verpakkingstype en bekijk de afgeleide adviesprijzen per bier.",
            "home_verkoopstrategie",
        ):
            set_page(PAGE_VERKOOPSTRATEGIE)
    with comm_cols[1]:
        if render_home_card(
            "🤝 Prijsvoorstel maken",
            "Werk een commercieel prijsvoorstel uit op basis van kostprijs, kanaal en verpakking.",
            "home_prijsvoorstel",
        ):
            st.session_state["prijsvoorstel_view_mode"] = "overview"
            set_page(PAGE_PRIJSVOORSTEL)
    with comm_cols[2]:
        st.write("")
    st.markdown("</div>", unsafe_allow_html=True)

    st.markdown("</div>", unsafe_allow_html=True)
    render_home_footer()


def show_productie() -> None:
    """Toont de uitgewerkte productiepagina."""
    show_productie_page(on_back=lambda: set_page(PAGE_HOME), on_logout=logout)


def show_vaste_kosten() -> None:
    """Toont de uitgewerkte pagina voor vaste kosten."""
    show_vaste_kosten_page(on_back=lambda: set_page(PAGE_HOME), on_logout=logout)


def show_nieuwe_berekening() -> None:
    """Toont de pagina voor Nieuwe berekening."""
    show_nieuwe_berekening_page(on_back=lambda: set_page(PAGE_HOME), on_logout=logout)


def show_producten_verpakking() -> None:
    """Toont de pagina voor Producten & verpakking."""
    show_producten_verpakking_page(on_back=lambda: set_page(PAGE_HOME), on_logout=logout)


def show_inkoop_facturen() -> None:
    """Toont de pagina voor Inkoopfacturen."""
    show_inkoop_facturen_page(on_back=lambda: set_page(PAGE_HOME), on_logout=logout)


def show_tarieven_heffingen() -> None:
    """Toont de pagina voor Tarieven en heffingen."""
    show_tarieven_heffingen_page(on_back=lambda: set_page(PAGE_HOME), on_logout=logout)


def show_prijsvoorstel() -> None:
    """Toont de pagina voor Prijsvoorstel maken."""
    show_prijsvoorstel_page(on_back=lambda: set_page(PAGE_HOME), on_logout=logout)


def show_verkoopstrategie() -> None:
    """Toont de pagina voor Verkoopstrategie."""
    show_verkoopstrategie_page(on_back=lambda: set_page(PAGE_HOME), on_logout=logout)


def show_nieuw_jaar_voorbereiden() -> None:
    """Toont de wizard voor Nieuw jaar voorbereiden."""
    show_nieuw_jaar_voorbereiden_page(on_back=lambda: set_page(PAGE_HOME), on_logout=logout)


def route_page() -> None:
    """Centrale router op basis van de actieve pagina in session_state."""
    page = st.session_state.get("page", PAGE_HOME)

    routes = {
        PAGE_HOME: show_home,
        PAGE_PRODUCTIE: show_productie,
        PAGE_VASTE_KOSTEN: show_vaste_kosten,
        PAGE_NIEUWE_BEREKENING: show_nieuwe_berekening,
        PAGE_INKOOP_FACTUREN: show_inkoop_facturen,
        PAGE_TARIEVEN_HEFFINGEN: show_tarieven_heffingen,
        PAGE_PRODUCTEN_VERPAKKING: show_producten_verpakking,
        PAGE_PRIJSVOORSTEL: show_prijsvoorstel,
        PAGE_VERKOOPSTRATEGIE: show_verkoopstrategie,
        PAGE_NIEUW_JAAR_VOORBEREIDEN: show_nieuw_jaar_voorbereiden,
    }
    routes.get(page, show_home)()


def main() -> None:
    """Startpunt van de applicatie."""
    apply_app_theme()
    init_session_state()

    if st.session_state["logged_in"]:
        render_app_header()
        route_page()
    else:
        show_login()


if __name__ == "__main__":
    main()
