# Matiks Hackathon Client (`client/`)

React 19 + Vite + Tailwind CSS v4 frontend implementing the **USAR-FOSS UFC Design System** (Showcase Mode for Team Lobby, Projector Leaderboard, and Admin Command Center; 60fps Reflex Mode for the 2-Minute Sprint Arena).

## Scripts

- `npm run dev` — Launch the Vite development server on `http://localhost:5173` (proxies `/api` and `/health` to `http://localhost:3001`).
- `npm run build` — Build production static assets into `dist/`.
- `npm test` — Run the frontend unit test suite (`tests/clientSuite.test.mjs`) covering `api.js`, `sse.js`, `soundFx.js`, and SSE fault tolerance.
- `npm run lint` — Run `oxlint` across the client codebase.
