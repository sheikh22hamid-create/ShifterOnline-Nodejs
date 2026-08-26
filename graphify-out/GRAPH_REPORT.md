# Graph Report - Shifter Online  (2026-08-26)

## Corpus Check
- Corpus is ~2,902 words - fits in a single context window. You may not need a graph.

## Summary
- 127 nodes · 129 edges · 16 communities (13 shown, 3 thin omitted)
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.84)
- Token cost: 258,967 input · 0 output

## Community Hubs (Navigation)
- Frontend Lint & Type Tooling
- Frontend README & Vite Setup
- Frontend Package & Scripts
- Backend Package Metadata
- Backend Express App
- Backend README & DB Setup
- Backend Runtime Dependencies
- Social/Brand Icon Sprite Sheet
- Backend NPM Scripts
- Vite Branding Asset
- Frontend App Entry Point
- React Branding Asset
- App Favicon
- Hero Banner Image

## God Nodes (most connected - your core abstractions)
1. `Backend README` - 11 edges
2. `Frontend README` - 9 edges
3. `scripts` - 6 edges
4. `Shared Icon Sprite Sheet (icons.svg)` - 6 edges
5. `scripts` - 5 edges
6. `Prisma` - 5 edges
7. `Bluesky Icon (bluesky-icon symbol)` - 5 edges
8. `frontend/index.html (Vite entry HTML)` - 4 edges
9. `@vitejs/plugin-react` - 3 edges
10. `@vitejs/plugin-react-swc` - 3 edges

## Surprising Connections (you probably didn't know these)
- `src/main.jsx entry script` --conceptually_related_to--> `React`  [INFERRED]
  frontend/index.html → frontend/README.md
- `frontend/index.html (Vite entry HTML)` --conceptually_related_to--> `Vite`  [INFERRED]
  frontend/index.html → frontend/README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Node.js + Express + Prisma + MySQL Backend Stack** — backend_readme_nodejs, backend_readme_express, backend_readme_prisma, backend_readme_mysql [EXTRACTED 1.00]
- **Alternative Vite React Plugin Options (Oxc vs SWC)** — frontend_readme_vitejs_plugin_react, frontend_readme_oxc, frontend_readme_vitejs_plugin_react_swc, frontend_readme_swc [EXTRACTED 1.00]
- **React App Bootstrap via Vite Entry HTML** — frontend_index_root_div, frontend_index_main_jsx, frontend_readme_react, frontend_readme_vite [INFERRED 0.75]

## Communities (16 total, 3 thin omitted)

### Community 0 - "Frontend Lint & Type Tooling"
Cohesion: 0.11
Nodes (19): eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks (+11 more)

### Community 1 - "Frontend README & Vite Setup"
Cohesion: 0.16
Nodes (16): frontend/index.html (Vite entry HTML), favicon.svg, src/main.jsx entry script, #root div mount point, Frontend README, ESLint, HMR (Hot Module Replacement), Oxc (+8 more)

### Community 2 - "Frontend Package & Scripts"
Cohesion: 0.13
Nodes (14): dependencies, react, react-dom, name, private, scripts, build, dev (+6 more)

### Community 3 - "Backend Package Metadata"
Cohesion: 0.14
Nodes (13): author, description, devDependencies, nodemon, prisma, keywords, license, main (+5 more)

### Community 4 - "Backend Express App"
Cohesion: 0.14
Nodes (10): app, cors, express, userRoutes, prisma, { PrismaClient }, express, prisma (+2 more)

### Community 5 - "Backend README & DB Setup"
Cohesion: 0.24
Nodes (12): Backend README, DATABASE_URL Environment Variable, npm run dev (nodemon auto-restart), Express, MySQL, Node.js, PORT Environment Variable, Prisma (+4 more)

### Community 6 - "Backend Runtime Dependencies"
Cohesion: 0.22
Nodes (9): dependencies, cors, dotenv, express, @prisma/client, cors, dotenv, express (+1 more)

### Community 7 - "Social/Brand Icon Sprite Sheet"
Cohesion: 0.48
Nodes (7): Bluesky Icon (bluesky-icon symbol), Discord Icon (discord-icon symbol), Documentation Icon (documentation-icon symbol), GitHub Icon (github-icon symbol), Shared Icon Sprite Sheet (icons.svg), Social/Community Icon (social-icon symbol), X (Twitter) Icon (x-icon symbol)

### Community 8 - "Backend NPM Scripts"
Cohesion: 0.33
Nodes (6): scripts, dev, prisma:generate, prisma:migrate, prisma:studio, start

### Community 9 - "Vite Branding Asset"
Cohesion: 0.67
Nodes (3): Frontend Application, Vite, Vite Logo (SVG)

### Community 11 - "React Branding Asset"
Cohesion: 1.00
Nodes (3): Frontend Application (Shifter Online), React (JavaScript Framework), React Logo (react.svg)

## Knowledge Gaps
- **65 isolated node(s):** `name`, `version`, `description`, `main`, `start` (+60 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `Frontend Lint & Type Tooling` to `Frontend Package & Scripts`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `dependencies` connect `Backend Runtime Dependencies` to `Backend Package Metadata`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `scripts` connect `Backend NPM Scripts` to `Backend Package Metadata`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `Shared Icon Sprite Sheet (icons.svg)` (e.g. with `Documentation Icon (documentation-icon symbol)` and `Bluesky Icon (bluesky-icon symbol)`) actually correct?**
  _`Shared Icon Sprite Sheet (icons.svg)` has 6 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _65 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Frontend Lint & Type Tooling` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._
- **Should `Frontend Package & Scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._