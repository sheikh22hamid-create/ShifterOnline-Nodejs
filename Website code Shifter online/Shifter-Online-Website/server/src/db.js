import mongoose from 'mongoose';

let isConnecting = false;

export async function connectDB() {
  if (!process.env.MONGODB_URI) {
    console.error('Missing required environment variable MONGODB_URI.');
    return;
  }

  if (mongoose.connection.readyState === 1) {
    return; // Already connected
  }

  if (isConnecting) return;
  isConnecting = true;

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.MONGODB_DB_NAME ?? 'shifter_online',
      serverSelectionTimeoutMS: 8000,
    });
    console.log('Successfully connected to MongoDB Atlas.');
  } catch (err) {
    console.error('MongoDB connection error (will retry in 5s):', err.message);
    setTimeout(() => {
      isConnecting = false;
      connectDB().catch(() => {});
    }, 5000);
  } finally {
    isConnecting = false;
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Attempting to reconnect...');
  setTimeout(() => connectDB().catch(() => {}), 5000);
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB runtime error:', err.message);
});

export async function disconnectDB() {
  try {
    await mongoose.disconnect();
  } catch (err) {
    console.error('Error disconnecting MongoDB:', err);
  }
}

export default mongoose;
