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
    const { day_id, local_id, area_id, project_id, start_time, end_time, start_minutes, end_minutes, sort_order } = req.body;

    if (!(await verifyDayOwnership(day_id, req.userId))) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { rows: [block] } = await pool.query(
      `INSERT INTO blocks (day_id, local_id, area_id, project_id, start_time, end_time, start_minutes, end_minutes, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [day_id, local_id || null, area_id, project_id || null, start_time, end_time, start_minutes, end_minutes, sort_order ?? 0]
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

    const { area_id, project_id, start_time, end_time, start_minutes, end_minutes } = req.body;

    const { rows: [updated] } = await pool.query(
      `UPDATE blocks SET
         area_id       = COALESCE($1, area_id),
         project_id    = $2,
         start_time    = COALESCE($3, start_time),
         end_time      = COALESCE($4, end_time),
         start_minutes = COALESCE($5, start_minutes),
         end_minutes   = COALESCE($6, end_minutes)
       WHERE id = $7 RETURNING *`,
      [area_id || null, project_id ?? null, start_time || null, end_time || null,
       start_minutes ?? null, end_minutes ?? null, req.params.id]
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
