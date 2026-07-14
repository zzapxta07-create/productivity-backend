import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

function getMondayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

async function getPlanWithBlocks(planId) {
  const { rows: [plan] } = await pool.query(
    'SELECT * FROM weekly_plans WHERE id = $1', [planId]
  );
  if (!plan) return null;
  const { rows: blocks } = await pool.query(
    `SELECT wb.*, p.name AS project_name
     FROM weekly_plan_blocks wb
     LEFT JOIN projects p ON wb.project_id = p.id
     WHERE wb.plan_id = $1
     ORDER BY wb.day_of_week, wb.sort_order, wb.start_minutes`,
    [planId]
  );
  return { ...plan, blocks };
}

// GET /api/weekly-plans/week/:weekDate
router.get('/week/:weekDate', async (req, res) => {
  try {
    const weekStart = getMondayOf(req.params.weekDate);
    let { rows: [plan] } = await pool.query(
      'SELECT * FROM weekly_plans WHERE user_id = $1 AND week_start = $2',
      [req.userId, weekStart]
    );
    if (!plan) {
      const { rows: [created] } = await pool.query(
        'INSERT INTO weekly_plans (user_id, week_start) VALUES ($1, $2) RETURNING *',
        [req.userId, weekStart]
      );
      plan = created;
    }
    const full = await getPlanWithBlocks(plan.id);
    res.json({ data: full });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// PUT /api/weekly-plans/:id
router.put('/:id', async (req, res) => {
  try {
    const { notes } = req.body;
    const { rows: [plan] } = await pool.query(
      `UPDATE weekly_plans SET notes = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3 RETURNING *`,
      [notes ?? null, req.params.id, req.userId]
    );
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
    const full = await getPlanWithBlocks(plan.id);
    res.json({ data: full });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/weekly-plans/:id/blocks
router.post('/:id/blocks', async (req, res) => {
  try {
    const { rows: [plan] } = await pool.query(
      'SELECT id FROM weekly_plans WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });

    const { day_of_week, area_id, project_id, start_time, end_time,
            start_minutes, end_minutes, notes, sort_order } = req.body;

    const { rows: [block] } = await pool.query(
      `INSERT INTO weekly_plan_blocks
         (plan_id, day_of_week, area_id, project_id, start_time, end_time,
          start_minutes, end_minutes, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [plan.id, day_of_week, area_id, project_id || null,
       start_time, end_time, start_minutes, end_minutes,
       notes || null, sort_order ?? 0]
    );
    const full = await getPlanWithBlocks(plan.id);
    res.status(201).json({ data: { block, plan: full } });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// PUT /api/weekly-plans/blocks/:blockId
router.put('/blocks/:blockId', async (req, res) => {
  try {
    const { rows: [wb] } = await pool.query(
      `SELECT wb.*, wp.user_id, wp.id AS plan_id
       FROM weekly_plan_blocks wb
       JOIN weekly_plans wp ON wb.plan_id = wp.id
       WHERE wb.id = $1`,
      [req.params.blockId]
    );
    if (!wb) return res.status(404).json({ error: 'Bloque no encontrado' });
    if (wb.user_id !== req.userId) return res.status(403).json({ error: 'Acceso denegado' });

    const { area_id, start_time, end_time, start_minutes, end_minutes } = req.body;

    // Same field-omission-vs-explicit-null distinction as PUT /api/blocks/:id.
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

    if (sets.length > 0) {
      params.push(req.params.blockId);
      await pool.query(
        `UPDATE weekly_plan_blocks SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params
      );
    }
    const full = await getPlanWithBlocks(wb.plan_id);
    res.json({ data: full });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// DELETE /api/weekly-plans/blocks/:blockId
router.delete('/blocks/:blockId', async (req, res) => {
  try {
    const { rows: [wb] } = await pool.query(
      `SELECT wb.*, wp.user_id, wp.id AS plan_id
       FROM weekly_plan_blocks wb
       JOIN weekly_plans wp ON wb.plan_id = wp.id
       WHERE wb.id = $1`,
      [req.params.blockId]
    );
    if (!wb) return res.status(404).json({ error: 'Bloque no encontrado' });
    if (wb.user_id !== req.userId) return res.status(403).json({ error: 'Acceso denegado' });

    await pool.query('DELETE FROM weekly_plan_blocks WHERE id = $1', [req.params.blockId]);
    const full = await getPlanWithBlocks(wb.plan_id);
    res.json({ data: full });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

export default router;
