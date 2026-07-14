import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

async function verifyDayOwnership(dayId, userId) {
  const { rows: [d] } = await pool.query(
    'SELECT id FROM days WHERE id = $1 AND user_id = $2', [dayId, userId]
  );
  return !!d;
}

// POST /api/blocks
router.post('/', async (req, res) => {
  try {
    const { day_id, local_id, area_id, project_id, start_time, end_time, start_minutes, end_minutes, sort_order, notes } = req.body;

    if (!(await verifyDayOwnership(day_id, req.userId))) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { rows: [block] } = await pool.query(
      `INSERT INTO blocks (day_id, local_id, area_id, project_id, start_time, end_time, start_minutes, end_minutes, sort_order, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [day_id, local_id || null, area_id, project_id || null, start_time, end_time, start_minutes, end_minutes, sort_order ?? 0, notes || null]
    );
    res.status(201).json({ data: block });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// DELETE /api/blocks/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [block] } = await pool.query(
      `SELECT b.id, d.user_id FROM blocks b
       JOIN days d ON b.day_id = d.id WHERE b.id = $1`,
      [req.params.id]
    );
    if (!block)                        return res.status(404).json({ error: 'Bloque no encontrado' });
    if (block.user_id !== req.userId)  return res.status(403).json({ error: 'Acceso denegado' });

    await pool.query('DELETE FROM blocks WHERE id = $1', [req.params.id]);
    res.json({ data: { ok: true } });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// PUT /api/blocks/:id  — edit a block's time/area, increment edit counter
router.put('/:id', async (req, res) => {
  try {
    const { rows: [block] } = await pool.query(
      `SELECT b.*, d.user_id, d.id AS the_day_id FROM blocks b
       JOIN days d ON b.day_id = d.id WHERE b.id = $1`,
      [req.params.id]
    );
    if (!block)                       return res.status(404).json({ error: 'Bloque no encontrado' });
    if (block.user_id !== req.userId) return res.status(403).json({ error: 'Acceso denegado' });

    const { area_id, start_time, end_time, start_minutes, end_minutes } = req.body;

    // Build the SET clause dynamically so a field the caller never sent keeps
    // its current value, while an explicit null (e.g. clearing the project)
    // still goes through. COALESCE alone can't tell "omitted" from "set to null".
    const sets   = [];
    const params = [];
    function set(column, value) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    if (area_id)                        set('area_id', area_id);
    if (start_time)                     set('start_time', start_time);
    if (end_time)                       set('end_time', end_time);
    if (start_minutes !== undefined && start_minutes !== null) set('start_minutes', start_minutes);
    if (end_minutes   !== undefined && end_minutes   !== null) set('end_minutes', end_minutes);
    if ('project_id' in req.body)       set('project_id', req.body.project_id ?? null);
    if ('notes' in req.body)            set('notes', req.body.notes ?? null);

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Nada para actualizar' });
    }
    params.push(req.params.id);
    const { rows: [updated] } = await pool.query(
      `UPDATE blocks SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    await pool.query(
      `UPDATE days SET block_edits_count = COALESCE(block_edits_count, 0) + 1 WHERE id = $1`,
      [block.the_day_id]
    );

    // Return updated day so frontend can refresh in one call
    const { rows: [day] } = await pool.query(
      `SELECT d.*,
         (SELECT json_agg(b ORDER BY b.start_minutes)
          FROM blocks b WHERE b.day_id = d.id) AS blocks,
         (SELECT json_agg(e)
          FROM evidences e WHERE e.day_id = d.id) AS evidences
       FROM days d WHERE d.id = $1`,
      [block.the_day_id]
    );

    res.json({ data: { block: updated, day } });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// PUT /api/blocks/reorder
router.put('/reorder', async (req, res) => {
  try {
    const { day_id, block_ids } = req.body;
    if (!(await verifyDayOwnership(day_id, req.userId))) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    for (let i = 0; i < block_ids.length; i++) {
      await pool.query(
        'UPDATE blocks SET sort_order = $1 WHERE id = $2 AND day_id = $3',
        [i, block_ids[i], day_id]
      );
    }
    res.json({ data: { ok: true } });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

export default router;
