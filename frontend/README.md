# Nieuwe web-UI

Deze map bevat de primaire frontend op basis van:

- Next.js
- TypeScript
- React

Doel:

- Streamlit-UI uitfaseren
- bestaande Python-berekeningen behouden
- backend via FastAPI laten praten met de bestaande opslag- en normalisatielaag

## Starten

Voor de standaard lokale start gebruik je het projectscript vanuit de repo-root:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\hansh\.codex\CalculatieTool\scripts\start_new_ui.ps1
```

Handmatig kan ook:

```powershell
cd frontend
npm install
npm run build
npm run start
```

Standaard verwacht de frontend een backend op:

```text
http://localhost:8000/api
```

Dat kun je aanpassen met:

```text
NEXT_PUBLIC_API_BASE_URL
```

## Status

De frontend is nu de primaire UI-laag. De oude Streamlit-app wordt niet meer actief als hoofdroute gebruikt.
