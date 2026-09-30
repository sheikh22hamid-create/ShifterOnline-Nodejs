import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from './models/User.js';
import { verifyAdminToken } from './adminAuth.js';
import { normalizeMobile, isValidMobile, isValidEmail } from './validation.js';

const ADMIN_JWT_EXPIRES_IN = '24h';

function formatUser(doc) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email || '',
    mobile: doc.mobile || '',
    status: doc.status || 'Pending',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastLoginAt: doc.lastLoginAt || null,
  };
}

export const adminRouter = Router();

// ==========================================
// 1. ADMIN AUTHENTICATION
// ==========================================

adminRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '').trim();

  let expectedEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  let expectedPassword = String(process.env.ADMIN_PASSWORD || '').trim();

  // Strip accidental wrapping quotes from .env
  expectedEmail = expectedEmail.replace(/^["']|["']$/g, '');
  expectedPassword = expectedPassword.replace(/^["']|["']$/g, '');

  if (!expectedEmail || !expectedPassword) {
    console.error('ADMIN_EMAIL or ADMIN_PASSWORD not configured in server/.env');
    return res.status(500).json({ message: 'Admin authentication is not configured properly on the server.' });
  }

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  if (email !== expectedEmail || password !== expectedPassword) {
    return res.status(401).json({ message: 'Invalid Admin credentials. Please check your email and password.' });
  }

  const token = jwt.sign(
    { sub: 'admin', role: 'admin', email: expectedEmail },
    process.env.JWT_SECRET,
    { expiresIn: ADMIN_JWT_EXPIRES_IN }
  );

  return res.status(200).json({
    token,
    admin: {
      email: expectedEmail,
      role: 'admin',
      name: 'Super Admin',
    },
  });
});

adminRouter.get('/me', verifyAdminToken, (req, res) => {
  return res.status(200).json({
    admin: {
      email: req.admin.email,
      role: req.admin.role,
      name: 'Super Admin',
    },
  });
});

// ==========================================
// 2. DASHBOARD STATS
// ==========================================

adminRouter.get('/stats', verifyAdminToken, async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalUsers, pendingUsers, completedUsers, todayUsers] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ $or: [{ status: 'Pending' }, { status: { $exists: false } }, { status: null }] }),
      User.countDocuments({ status: 'Completed' }),
      User.countDocuments({ createdAt: { $gte: todayStart } }),
    ]);

    return res.status(200).json({
      totalUsers,
      pendingUsers,
      completedUsers,
      todayUsers,
    });
  } catch (err) {
    console.error('Error fetching admin stats:', err);
    return res.status(500).json({ message: 'Failed to retrieve dashboard statistics.' });
  }
});

// ==========================================
// 3. USERS SHEET / TABLE CRUD OPERATIONS
// ==========================================

// List users with search, filter by status, sort, pagination
adminRouter.get('/users', verifyAdminToken, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '10', 10)));
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const sortBy = String(req.query.sortBy || 'createdAt');
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

    const conditions = [];

    if (status === 'Pending') {
      conditions.push({ $or: [{ status: 'Pending' }, { status: { $exists: false } }, { status: null }] });
    } else if (status === 'Completed') {
      conditions.push({ status: 'Completed' });
    }

    if (search) {
      const searchRegex = new RegExp(search.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i');
      conditions.push({
        $or: [
          { name: searchRegex },
          { email: searchRegex },
          { mobile: searchRegex },
        ],
      });
    }

    const filter = conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : { $and: conditions }) : {};

    const total = await User.countDocuments(filter);
    const usersDoc = await User.find(filter)
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.status(200).json({
      users: usersDoc.map(formatUser),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    console.error('Error fetching users:', err);
    return res.status(500).json({ message: 'Failed to retrieve users.' });
  }
});

// Get single user by ID
adminRouter.get('/users/:id', verifyAdminToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    return res.status(200).json({ user: formatUser(user) });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to retrieve user details.' });
  }
});

// Admin create user
adminRouter.post('/users', verifyAdminToken, async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const rawMobile = String(req.body?.mobile ?? '').trim();
  const rawEmail = String(req.body?.email ?? '').trim();
  const password = String(req.body?.password ?? '');
  const status = req.body?.status === 'Completed' ? 'Completed' : 'Pending';

  if (!name) {
    return res.status(400).json({ message: 'Name is required.' });
  }
  if (!rawMobile) {
    return res.status(400).json({ message: 'Mobile number is required.' });
  }
  if (!isValidMobile(rawMobile)) {
    return res.status(400).json({ message: 'Please enter a valid 10-digit mobile number.' });
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
    const existingMobile = await User.findOne({ mobile: normalizedMobile });
    if (existingMobile) {
      return res.status(409).json({ message: 'A user with this mobile number already exists.' });
    }

    if (normalizedEmail) {
      const existingEmail = await User.findOne({ email: normalizedEmail });
      if (existingEmail) {
        return res.status(409).json({ message: 'A user with this email already exists.' });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      mobile: normalizedMobile,
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      passwordHash,
      status,
      lastLoginAt: null,
    });

    return res.status(201).json({
      message: 'User created successfully.',
      user: formatUser(user),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'A user with this mobile number or email already exists.' });
    }
    console.error('admin create user error:', err);
    return res.status(500).json({ message: 'Unable to create user.' });
  }
});

// Admin update user
adminRouter.put('/users/:id', verifyAdminToken, async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const rawMobile = String(req.body?.mobile ?? '').trim();
  const rawEmail = String(req.body?.email ?? '').trim();
  const status = req.body?.status === 'Completed' ? 'Completed' : 'Pending';
  const password = req.body?.password ? String(req.body.password) : null;

  if (!name) {
    return res.status(400).json({ message: 'Name is required.' });
  }
  if (!rawMobile) {
    return res.status(400).json({ message: 'Mobile number is required.' });
  }
  if (!isValidMobile(rawMobile)) {
    return res.status(400).json({ message: 'Please enter a valid 10-digit mobile number.' });
  }

  const normalizedMobile = normalizeMobile(rawMobile);
  let normalizedEmail = null;

  if (rawEmail) {
    if (!isValidEmail(rawEmail)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    normalizedEmail = rawEmail.toLowerCase();
  }

  if (password && password.length < 8) {
    return res.status(400).json({ message: 'New password must be at least 8 characters.' });
  }

  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Check if mobile changed and taken
    if (normalizedMobile !== user.mobile) {
      const duplicateMobile = await User.findOne({ mobile: normalizedMobile, _id: { $ne: user._id } });
      if (duplicateMobile) {
        return res.status(409).json({ message: 'This mobile number is already taken by another user.' });
      }
      user.mobile = normalizedMobile;
    }

    // Check if email changed and taken
    if (normalizedEmail !== user.email) {
      if (normalizedEmail) {
        const duplicateEmail = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
        if (duplicateEmail) {
          return res.status(409).json({ message: 'This email is already taken by another user.' });
        }
      }
      user.email = normalizedEmail;
    }

    user.name = name;
    user.status = status;

    if (password) {
      user.passwordHash = await bcrypt.hash(password, 10);
    }

    await user.save();

    return res.status(200).json({
      message: 'User updated successfully.',
      user: formatUser(user),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'This mobile number or email is already taken by another user.' });
    }
    console.error('admin update user error:', err);
    return res.status(500).json({ message: 'Unable to update user.' });
  }
});

// Admin fast toggle/update status
adminRouter.patch('/users/:id/status', verifyAdminToken, async (req, res) => {
  const status = req.body?.status;
  if (status !== 'Pending' && status !== 'Completed') {
    return res.status(400).json({ message: 'Status must be either "Pending" or "Completed".' });
  }

  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    user.status = status;
    await user.save();

    return res.status(200).json({
      message: `User status changed to ${status}.`,
      user: formatUser(user),
    });
  } catch (err) {
    console.error('admin update user status error:', err);
    return res.status(500).json({ message: 'Unable to update status.' });
  }
});

// Admin delete user
adminRouter.delete('/users/:id', verifyAdminToken, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json({ message: 'User deleted successfully.' });
  } catch (err) {
    console.error('admin delete user error:', err);
    return res.status(500).json({ message: 'Unable to delete user.' });
  }
});
