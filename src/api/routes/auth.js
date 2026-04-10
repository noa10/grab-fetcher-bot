const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const User = require('../../models/User');
const PasswordReset = require('../../models/PasswordReset');
const logger = require('../../utils/logger');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.path.startsWith('/api/') || req.headers['content-type']?.includes('application/json')) {
      return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
    }
    return res.redirect('/login');
  }

  if (req.session.passwordChangedAt) {
    return next();
  }

  User.findById(req.session.userId).then(user => {
    if (!user) {
      req.session.destroy();
      if (req.path.startsWith('/api/') || req.headers['content-type']?.includes('application/json')) {
        return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
      }
      return res.redirect('/login');
    }

    if (user.passwordChangedAt && req.session.createdAt) {
      const sessionCreated = new Date(req.session.createdAt);
      if (sessionCreated < user.passwordChangedAt) {
        req.session.destroy();
        return res.redirect('/login');
      }
    }

    req.session.passwordChangedAt = user.passwordChangedAt?.toISOString();
    next();
  }).catch(() => {
    req.session.destroy();
    return res.redirect('/login');
  });
}

async function ensureDefaultAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'ADMIN_USERNAME and ADMIN_PASSWORD environment variables are required for first run. ' +
      'Generate secure credentials and set them in your .env file.'
    );
  }

  const existing = await User.findOne({ username });
  if (!existing) {
    await User.create({ username, password, role: 'admin' });
    logger.api('Default admin user created');
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip + ':' + (req.body.username || ''),
  validate: false
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { success: false, message: 'Too many password reset requests. Try again in 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false
});

router.get('/login', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }

  const getLoginHTML = require('../login-template');
  res.send(getLoginHTML());
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password, rememberMe } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    const user = await User.findOne({ username: username.toLowerCase(), isActive: true });
    if (!user) {
      logger.error(`Login failed: user ${username} not found or inactive`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      logger.error(`Login failed: invalid password for user ${username}`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    user.lastLogin = new Date();
    await user.save();

    req.session.userId = user._id.toString();
    req.session.username = user.username;
    req.session.createdAt = new Date().toISOString();
    req.session.passwordChangedAt = user.passwordChangedAt?.toISOString();

    if (rememberMe) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    } else {
      req.session.cookie.maxAge = 24 * 60 * 60 * 1000;
    }

    logger.api(`User ${user.username} logged in`);
    res.json({ success: true, message: 'Login successful' });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

router.post('/logout', requireAuth, (req, res) => {
  const username = req.session?.username;
  req.session.destroy((err) => {
    if (err) {
      logger.error('Logout error:', err);
    }
    if (username) {
      logger.api(`User ${username} logged out`);
    }
    res.json({ success: true });
  });
});

router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ success: false, message: 'Username is required' });
    }

    const user = await User.findOne({ username: username.toLowerCase(), isActive: true });
    if (!user) {
      return res.json({ success: true, message: 'If the username exists, a reset code has been generated' });
    }

    await PasswordReset.createToken(user.username);

    res.json({
      success: true,
      message: 'If the username exists, a reset code has been generated. ' +
               'In a production environment, this would be sent via email.'
    });
  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Failed to process request' });
  }
});

router.post('/reset-password', passwordResetLimiter, async (req, res) => {
  try {
    const { username, token, newPassword } = req.body;

    if (!username || !token || !newPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const reset = await PasswordReset.verifyToken(username.toLowerCase(), token);
    if (!reset) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset code' });
    }

    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.password = newPassword;
    await user.save();

    logger.api(`Password reset for user ${user.username}`);
    res.json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select('-password');
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch user info' });
  }
});

module.exports = { router, requireAuth, ensureDefaultAdmin };
