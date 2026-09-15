import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes.js';
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
app.use('/api/routes', routeRouter);
app.use('/api/geocode', geocodeRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

async function start() {
  try {
    await connectDB();
    console.log('Connected to MongoDB.');
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }

  const server = app.listen(port, () => {
    console.log(`Shifter Online auth server listening on http://localhost:${port}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down...`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
