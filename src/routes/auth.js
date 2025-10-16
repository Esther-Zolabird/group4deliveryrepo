const express = require('express');
const bcrypt = require('bcrypt');
const { run, get, all } = require('../../db');

module.exports = function(io) {
  const router = express.Router();

  router.get('/login', (req, res) => {
    res.render('auth/login');
  });

  router.post('/login', async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const user = await get('SELECT * FROM users WHERE email = ? AND active = 1', [email]);
      if (!user) return res.render('auth/login', { error: 'Invalid credentials' });
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.render('auth/login', { error: 'Invalid credentials' });
      req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
      return res.redirect('/');
    } catch (e) { next(e); }
  });

  router.get('/register', (req, res) => {
    res.render('auth/register');
  });

  router.post('/register', async (req, res, next) => {
    try {
      const { name, email, password, role } = req.body;
      if (!name || !email || !password || !role) {
        return res.render('auth/register', { error: 'All fields are required' });
      }
      if (!['manager','rider'].includes(role)) {
        return res.render('auth/register', { error: 'Invalid role' });
      }
      if (role === 'manager') {
        const wh = await get('SELECT * FROM manager_whitelist WHERE email = ?', [email]);
        if (!wh) {
          return res.render('auth/register', { error: 'This email is not authorized for manager registration' });
        }
      }
      const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) {
        return res.render('auth/register', { error: 'Email already registered' });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const result = await run('INSERT INTO users (name, email, password_hash, role, active) VALUES (?, ?, ?, ?, 1)', [name, email, passwordHash, role]);
      req.session.user = { id: result.id, name, email, role };
      res.redirect('/');
    } catch (e) { next(e); }
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  return { router };
};
