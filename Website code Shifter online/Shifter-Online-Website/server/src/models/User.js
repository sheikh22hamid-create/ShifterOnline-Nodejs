import { Schema, model } from 'mongoose';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: EMAIL_RE,
    },
    passwordHash: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

export const User = model('User', userSchema);
