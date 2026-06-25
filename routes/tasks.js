import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// GET /api/tasks
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM tasks WHERE user_id = $1
       ORDER BY completed ASC, due_date ASC NULLS LAST, created_at DESC`,
      [req.userId]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks
router.post('/', async (req, res) => {
  try {
    const { title, due_date } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title requerido' });
    const { rows: [task] } = await pool.query(
      'INSERT INTO tasks (user_id, title, due_date) VALUES ($1,$2,$3) RETURNING *',
      [req.userId, title.trim(), due_date || null]
    );
    res.status(201).json({ data: task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tasks/:id
router.put('/:id', async (req, res) => {
  try {
    const { title, due_date, completed } = req.body;
    const { rows: [task] } = await pool.query(
      `UPDATE tasks SET
         title        = COALESCE($1, title),
         due_date     = $2,
         completed    = COALESCE($3, completed),
         completed_at = CASE WHEN $3 = TRUE THEN NOW() WHEN $3 = FALSE THEN NULL ELSE completed_at END
       WHERE id = $4 AND user_id = $5 RETURNING *`,
      [title?.trim() || null, due_date ?? null, completed ?? null, req.params.id, req.userId]
    );
    if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
    res.json({ data: task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    res.json({ data: { ok: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
