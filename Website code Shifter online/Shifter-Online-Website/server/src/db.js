import mongoose from 'mongoose';

let connectPromise = null;

export function connectDB() {
  if (!process.env.MONGODB_URI) {
    throw new Error(
      'Missing required environment variable MONGODB_URI. Set it in server/.env — see server/.env.example.'
    );
  }

  if (!connectPromise) {
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err.message);
    });

    connectPromise = mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.MONGODB_DB_NAME ?? 'shifter_online',
    });
  }

  return connectPromise;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}

export default mongoose;
