# API Playground (Astro + Tailwind)

    npm install
    npm run dev      # http://localhost:4321
    npm run build    # output statis ke ./dist

- Spec lokal: `public/openapi.json` (di-embed saat build).
- Spec remote: isi input di sidebar, atau buka `/?spec=https://host/openapi.json` (server harus mengizinkan CORS).
- Deep link endpoint: `/#getUser`.
- Ctrl/Cmd+Enter untuk mengirim request.
