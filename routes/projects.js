import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// GET /api/projects
router.get('/', async (req, res) => {
  try {
    const { area, archived } = req.query;
    let query = 'SELECT * FROM projects WHERE user_id = $1';
    const params = [req.userId];

    if (area)     { query += ` AND area_id = $${params.push(area)}`; }
    if (archived !== undefined) { query += ` AND archived = $${params.push(archived === 'true')}`; }
    else          { query += ' AND archived = FALSE'; }

    query += ' ORDER BY priority NULLS LAST, deadline NULLS LAST, created_at DESC';

    const { rows } = await pool.query(query, params);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/projects
router.post('/', async (req, res) => {
  try {
    const { area_id, name, type, progress, done, deadline, milestone_percent, milestone_date, priority, notes } = req.body;
    const { rows: [project] } = await pool.query(
      `INSERT INTO projects (user_id, area_id, name, type, progress, done, deadline, milestone_percent, milestone_date, priority, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.userId, area_id, name, type || 'percent', progress || 0, done || false,
       deadline || null, milestone_percent || null, milestone_date || null, priority || null, notes || null]
    );
    res.status(201).json({ data: project });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// PUT /api/projects/:id
router.put('/:id', async (req, res) => {
  try {
    const { rows: [existing] } = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]
    );
    if (!existing) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const { area_id, name, type, progress, done, deadline, milestone_percent, milestone_date, priority, archived, notes } = req.body;
    const { rows: [project] } = await pool.query(
      `UPDATE projects SET area_id=$1, name=$2, type=$3, progress=$4, done=$5, deadline=$6,
       milestone_percent=$7, milestone_date=$8, priority=$9, archived=$10, notes=$11
       WHERE id=$12 AND user_id=$13 RETURNING *`,
      [area_id, name, type, progress, done, deadline || null,
       milestone_percent || null, milestone_date || null, priority || null, archived || false, notes || null,
       req.params.id, req.userId]
    );
    res.json({ data: project });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// PUT /api/projects/:id/progress
router.put('/:id/progress', async (req, res) => {
  try {
    const { progress, done } = req.body;
    const { rows: [project] } = await pool.query(
      `UPDATE projects SET
         progress = COALESCE($1, progress),
         done     = COALESCE($2, done),
         updated_at = NOW()
       WHERE id = $3 AND user_id = $4 RETURNING *`,
      [progress ?? null, done ?? null, req.params.id, req.userId]
    );
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ data: project });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Proyecto no encontrado' });
    res.json({ data: { ok: true } });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

export default router;
