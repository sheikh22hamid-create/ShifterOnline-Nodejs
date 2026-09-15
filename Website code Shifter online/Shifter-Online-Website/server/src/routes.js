import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from './models/User.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JWT_EXPIRES_IN = '7d';

function toPublicUser(doc) {
  return { id: doc._id.toString(), name: doc.name, email: doc.email };
}

function signToken(userId) {
  return jwt.sign({ sub: userId.toString() }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export const authRouter = Router();

authRouter.post('/signup', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  if (!name) {
    return res.status(400).json({ message: 'Name is required.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  try {
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'This email is already registered. Try logging in instead.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });
    const token = signToken(user._id);
    return res.status(201).json({ token, user: toPublicUser(user) });
  } catch (err) {
    if (err.code === 11000) {
      // Race: another request created the same email between our check and insert.
      return res.status(409).json({ message: 'This email is already registered. Try logging in instead.' });
    }
    console.error('signup error:', err);
    return res.status(500).json({ message: 'Unable to create account right now. Please try again.' });
  }
});

authRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
    const token = signToken(user._id);
    return res.status(200).json({ token, user: toPublicUser(user) });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ message: 'Unable to log in right now. Please try again.' });
  }
});

authRouter.get('/me', async (req, res) => {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }
    return res.status(200).json({ user: toPublicUser(user) });
  } catch {
    return res.status(401).json({ message: 'Session expired. Please log in again.' });
  }
});
