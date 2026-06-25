import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// GET /api/notes
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM notes WHERE user_id = $1 ORDER BY date_key DESC, created_at DESC',
      [req.userId]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notes
router.post('/', async (req, res) => {
  try {
    const { date_key, content } = req.body;
    if (!date_key || !content?.trim()) return res.status(400).json({ error: 'date_key y content requeridos' });
    const { rows: [note] } = await pool.query(
      'INSERT INTO notes (user_id, date_key, content) VALUES ($1,$2,$3) RETURNING *',
      [req.userId, date_key, content.trim()]
    );
    res.status(201).json({ data: note });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notes/:id
router.put('/:id', async (req, res) => {
  try {
    const { content, date_key } = req.body;
    const { rows: [note] } = await pool.query(
      `UPDATE notes SET
         content    = COALESCE($1, content),
         date_key   = COALESCE($2, date_key),
         updated_at = NOW()
       WHERE id = $3 AND user_id = $4 RETURNING *`,
      [content?.trim() || null, date_key || null, req.params.id, req.userId]
    );
    if (!note) return res.status(404).json({ error: 'Nota no encontrada' });
    res.json({ data: note });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notes/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    res.json({ data: { ok: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
