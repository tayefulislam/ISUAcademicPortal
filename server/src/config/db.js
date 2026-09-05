import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB() {
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(env.mongodbUri);
    console.log(`[db] connected: ${mongoose.connection.name}`);
  } catch (err) {
    console.error('[db] connection error:', err.message);
    process.exit(1);
  }
}
