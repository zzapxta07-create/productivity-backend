import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Credenciales requeridas' });

    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    // Ensure user_config exists
    await pool.query(
      'INSERT INTO user_config (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
      [user.id]
    );

    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });
    res.json({ data: { token, user: { id: user.id, username: user.username } } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// PUT /api/auth/password
router.put('/password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Contraseñas requeridas' });

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    if (!rows[0] || !(await bcrypt.compare(current_password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.userId]);
    res.json({ data: { ok: true } });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/auth/register (solo para setup inicial — deshabilitar en producción)
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Datos requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, hash]
    );
    await pool.query('INSERT INTO user_config (user_id) VALUES ($1)', [rows[0].id]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username ya existe' });
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

export default router;
