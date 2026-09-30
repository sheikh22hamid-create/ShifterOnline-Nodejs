import { Schema, model } from 'mongoose';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    mobile: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: false,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['Pending', 'Completed'],
      default: 'Pending',
      index: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

export const User = model('User', userSchema);
