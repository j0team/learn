# learn

Desktop learning app: Vite + React frontend in `src/`, Bun server in `server/`, Electron shell in `electron/`.

PRs follow the shared standard: https://github.com/j0team/pr-standard/blob/main/STANDARD.md (definition of done, root-cause fixes, review handling). This file adds what is specific to this repo.

## Checks

Run before every PR and before pushing review fixes:

- `npm run lint`
- `npm run build`
- `npm test`
- If `electron/` changed: `npm run app` builds the desktop app.

## PR rules

- PRs target `main`.
- Size limit excludes: tests (`*.test.*`), `package-lock.json`.
