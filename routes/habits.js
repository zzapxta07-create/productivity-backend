import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Recalculate streak for a habit
async function updateStreak(habitId) {
  const { rows: logs } = await pool.query(
    `SELECT date_key, completed FROM habit_logs WHERE habit_id = $1
     ORDER BY date_key DESC LIMIT 60`,
    [habitId]
  );
  let streak = 0;
  for (const log of logs) {
    if (log.completed) streak++;
    else break;
  }
  await pool.query('UPDATE habits SET streak = $1 WHERE id = $2', [streak, habitId]);
}

// GET /api/habits
router.get('/', async (req, res) => {
  try {
    const { rows: habits } = await pool.query(
      'SELECT * FROM habits WHERE user_id = $1 AND active = TRUE ORDER BY area_id, created_at',
      [req.userId]
    );

    // Attach last 7 days logs for each habit
    const enriched = await Promise.all(habits.map(async (h) => {
      const { rows: logs } = await pool.query(
        `SELECT to_char(date_key, 'YYYY-MM-DD') AS date_key, completed
         FROM habit_logs
         WHERE habit_id = $1 AND date_key >= CURRENT_DATE - INTERVAL '6 days'
         ORDER BY date_key DESC`,
        [h.id]
      );
      const todayLog = logs.find(l => l.completed);
      return { ...h, today_completed: todayLog?.completed || false, recent_logs: logs };
    }));

    res.json({ data: enriched });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/habits
router.post('/', async (req, res) => {
  try {
    const { area_id, name, frequency, target_minutes } = req.body;
    const { rows: [habit] } = await pool.query(
      `INSERT INTO habits (user_id, area_id, name, frequency, target_minutes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.userId, area_id || null, name, frequency || 'daily', target_minutes || 0]
    );
    res.status(201).json({ data: habit });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// PUT /api/habits/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, area_id, frequency, target_minutes, active } = req.body;
    const { rows: [habit] } = await pool.query(
      `UPDATE habits SET name=$1, area_id=$2, frequency=$3, target_minutes=$4, active=$5
       WHERE id=$6 AND user_id=$7 RETURNING *`,
      [name, area_id || null, frequency || 'daily', target_minutes || 0, active !== false, req.params.id, req.userId]
    );
    if (!habit) return res.status(404).json({ error: 'Hábito no encontrado' });
    res.json({ data: habit });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// DELETE /api/habits/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(
      'UPDATE habits SET active = FALSE WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]
    );
    res.json({ data: { ok: true } });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/habits/:id/log
router.post('/:id/log', async (req, res) => {
  try {
    const { date_key, date, completed, notes } = req.body;
    const logDate = date_key || date;

    // Verify ownership
    const { rows: [habit] } = await pool.query(
      'SELECT id FROM habits WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]
    );
    if (!habit) return res.status(404).json({ error: 'Hábito no encontrado' });

    const { rows: [log] } = await pool.query(
      `INSERT INTO habit_logs (habit_id, date_key, completed, notes)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (habit_id, date_key) DO UPDATE SET
         completed = EXCLUDED.completed, notes = EXCLUDED.notes
       RETURNING habit_id, to_char(date_key, 'YYYY-MM-DD') AS date_key, completed, notes`,
      [req.params.id, logDate, completed !== false, notes || null]
    );

    await updateStreak(req.params.id);
    res.json({ data: log });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

export default router;
