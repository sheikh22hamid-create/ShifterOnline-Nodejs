import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes.js';
import { adminRouter } from './adminRoutes.js';
import { routeRouter } from './routeCalculation.js';
import { geocodeRouter } from './geocode.js';
import { connectDB, disconnectDB } from './db.js';

if (!process.env.JWT_SECRET) {
  console.error('Missing required environment variable JWT_SECRET. Set it in server/.env — see server/.env.example.');
  process.exit(1);
}

const app = express();
const port = process.env.PORT ?? 4000;
const corsOrigin = process.env.CORS_ORIGIN
  ? (process.env.CORS_ORIGIN.includes(',') ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : process.env.CORS_ORIGIN)
  : ['http://localhost:5173', 'http://localhost:5174'];

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/routes', routeRouter);
app.use('/api/geocode', geocodeRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

async function start() {
  const server = app.listen(port, () => {
    console.log(`Shifter Online server listening on http://localhost:${port}`);
  });

  // Connect to DB in background
  connectDB().catch((err) => {
    console.error('Initial MongoDB connection error:', err.message);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
