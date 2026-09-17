# Backend

Node.js + Express + Prisma (MySQL) API.

Deployed on a Hostinger VPS via CloudPanel. Deploy manually by SSHing in and running `deploy.sh` (`~/deploy.sh` for the `shifter`/`shifterdev` site users), which does `git pull` + `npm ci` + `prisma generate` + a PM2 restart in place.

## Setup

1. Create a MySQL database and update `DATABASE_URL` in `.env`.
2. Install dependencies:
   ```
   npm install
   ```
3. Run migrations to create tables:
   ```
   npm run prisma:migrate
   ```
4. Start the dev server:
   ```
   npm run dev
   ```

Server runs on `http://localhost:5000` by default (see `PORT` in `.env`).

## Scripts

- `npm run dev` — start with nodemon (auto-restart)
- `npm start` — start normally
- `npm run prisma:generate` — regenerate Prisma client after schema changes
- `npm run prisma:migrate` — create/apply a migration
- `npm run prisma:studio` — open Prisma Studio (DB GUI)
