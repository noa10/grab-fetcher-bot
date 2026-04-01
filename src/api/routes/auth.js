const express = require('express');
const router = express.Router();
const User = require('../../models/User');
const PasswordReset = require('../../models/PasswordReset');
const logger = require('../../utils/logger');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }

  if (req.path.startsWith('/api/') || req.headers['content-type']?.includes('application/json')) {
    return res.status(401).json({ success: false, error: 'Unauthorized', message: 'Authentication required' });
  }

  return res.redirect('/login');
}

async function ensureDefaultAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';

  const existing = await User.findOne({ username });
  if (!existing) {
    await User.create({ username, password, role: 'admin' });
    logger.api('Default admin user created');
  }
}

router.get('/login', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }

  const getLoginHTML = require('../login-template');
  res.send(getLoginHTML());
});

router.post('/login', async (req, res) => {
  try {
    const { username, password, rememberMe } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    const user = await User.findOne({ username: username.toLowerCase(), isActive: true });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    user.lastLogin = new Date();
    await user.save();

    req.session.userId = user._id.toString();
    req.session.username = user.username;

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

router.post('/logout', (req, res) => {
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

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ success: false, message: 'Username is required' });
    }

    const user = await User.findOne({ username: username.toLowerCase(), isActive: true });
    if (!user) {
      return res.json({ success: true, message: 'If the username exists, a reset code has been generated' });
    }

    const reset = await PasswordReset.createToken(user.username);

    res.json({
      success: true,
      message: 'Reset code generated',
      resetCode: reset.token,
      note: 'This code expires in 15 minutes. In production, this would be sent via email.'
    });
  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Failed to process request' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { username, token, newPassword } = req.body;

    if (!username || !token || !newPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const reset = await PasswordReset.verifyToken(username.toLowerCase(), token.toUpperCase());
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
