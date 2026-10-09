# Backend

Node.js + Express 5 + Prisma 6 (MySQL) + Socket.io API, plus the WhatsApp bot, for Shifter Online.

> **Full documentation:** [`docs/SHIFTER_ONLINE_MASTER_DOCUMENT.md`](../docs/SHIFTER_ONLINE_MASTER_DOCUMENT.md) - architecture, every feature and how it works, all REST endpoints, Socket.io events, background jobs, data model, settings, deployment state and known risks. Start there.

Deployed on a Hostinger VPS via CloudPanel (PM2). Deploy manually: SSH in and run `~/deploy.sh` (`git pull` + `npm ci` + `prisma generate` + PM2 restart in place).

## Setup

1. Create a MySQL database and set `DATABASE_URL` (and the other variables listed in the master document, Part 13.2) in `.env`.
2. Install dependencies: `npm install`
3. Apply the schema. Migrations under `prisma/migrations/` and the SQL under `sql/` are **applied by hand** on each database (then `prisma migrate resolve --applied <name>`); never assume dev and prod match - run `npx prisma migrate status` first.
4. Start the dev server: `npm run dev` (default `http://localhost:5000`, `PORT` in `.env`).

## Scripts

- `npm run dev` - start with nodemon (auto-restart)
- `npm start` - start normally
- `npm test` - Jest (154 test files under `src/**/__tests__`)
- `npm run prisma:generate` - regenerate the Prisma client after schema changes
- `npm run prisma:studio` - open Prisma Studio (DB GUI)
- `scripts/` holds seed, simulation and flow-test scripts (order-flow tests, 100x500 dispatch simulation, slab pricing seed, admin password reset).

## Layout

`src/routes` (8 routers) -> `src/controllers` (79) -> `src/services` (69 business-logic modules) -> Prisma. Real-time lives in `src/sockets`, the WhatsApp bot in `src/whatsapp`, background jobs in `src/server.js`.
