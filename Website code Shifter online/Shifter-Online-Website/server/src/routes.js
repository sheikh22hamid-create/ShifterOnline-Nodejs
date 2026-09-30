import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from './models/User.js';
import { normalizeMobile, isValidMobile, isValidEmail } from './validation.js';

const JWT_EXPIRES_IN = '7d';

function toPublicUser(doc) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    mobile: doc.mobile || '',
    email: doc.email || '',
    status: doc.status || 'Pending',
    createdAt: doc.createdAt,
    lastLoginAt: doc.lastLoginAt || null,
  };
}

function signToken(userId) {
  return jwt.sign({ sub: userId.toString() }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export const authRouter = Router();

// ==========================================
// USER SIGNUP (Mobile required, Email optional)
// ==========================================
authRouter.post('/signup', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const rawMobile = String(req.body?.mobile ?? '').trim();
  const rawEmail = String(req.body?.email ?? '').trim();
  const password = String(req.body?.password ?? '');

  if (!name) {
    return res.status(400).json({ message: 'Name is required.' });
  }

  if (!rawMobile) {
    return res.status(400).json({ message: 'Mobile number is required.' });
  }

  if (!isValidMobile(rawMobile)) {
    return res.status(400).json({ message: 'Please enter a valid 10-digit mobile number (e.g. 9876543210).' });
  }

  const normalizedMobile = normalizeMobile(rawMobile);
  let normalizedEmail = null;

  if (rawEmail) {
    if (!isValidEmail(rawEmail)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    normalizedEmail = rawEmail.toLowerCase();
  }

  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  try {
    // Check if mobile number is already registered
    const existingMobile = await User.findOne({ mobile: normalizedMobile });
    if (existingMobile) {
      return res.status(409).json({ message: 'This mobile number is already registered. Try logging in instead.' });
    }

    // Check if email is already registered (if provided)
    if (normalizedEmail) {
      const existingEmail = await User.findOne({ email: normalizedEmail });
      if (existingEmail) {
        return res.status(409).json({ message: 'This email is already registered. Try logging in instead.' });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      mobile: normalizedMobile,
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      passwordHash,
      status: 'Pending',
      lastLoginAt: new Date(),
    });

    const token = signToken(user._id);
    return res.status(201).json({ token, user: toPublicUser(user) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'An account with this mobile number or email already exists.' });
    }
    console.error('signup error:', err);
    return res.status(500).json({ message: 'Unable to create account right now. Please try again.' });
  }
});

// ==========================================
// USER LOGIN (Supports both Mobile and Email)
// ==========================================
authRouter.post('/login', async (req, res) => {
  const identifier = String(
    req.body?.identifier ||
    req.body?.emailOrMobile ||
    req.body?.email ||
    req.body?.mobile ||
    ''
  ).trim();
  const password = String(req.body?.password ?? '');

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Mobile number / Email and password are required.' });
  }

  try {
    const normalizedMobile = normalizeMobile(identifier);
    const normalizedEmail = identifier.toLowerCase();

    // Query user by either mobile or email
    const queryConditions = [];
    if (normalizedMobile) {
      queryConditions.push({ mobile: normalizedMobile });
      queryConditions.push({ mobile: identifier });
    }
    if (identifier.includes('@') || !normalizedMobile) {
      queryConditions.push({ email: normalizedEmail });
    } else {
      queryConditions.push({ email: normalizedEmail });
    }

    const user = await User.findOne({ $or: queryConditions });

    if (!user) {
      return res.status(401).json({ message: 'Invalid mobile number/email or password.' });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ message: 'Invalid mobile number/email or password.' });
    }

    user.lastLoginAt = new Date();
    await user.save();

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
