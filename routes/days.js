import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { getAppDayKey, getBogotaDatetime } from '../utils/bogotaTime.js';

const router = Router();
router.use(authenticate);

// ─── helpers ────────────────────────────────────────────────────────────────

async function getDayFull(dayId) {
  const { rows: [day] } = await pool.query('SELECT * FROM days WHERE id = $1', [dayId]);
  if (!day) return null;

  const { rows: blocks } = await pool.query(
    `SELECT b.*, p.name AS project_name
     FROM blocks b
     LEFT JOIN projects p ON b.project_id = p.id
     WHERE b.day_id = $1
     ORDER BY b.sort_order, b.start_minutes`,
    [dayId]
  );
  const { rows: evidences } = await pool.query('SELECT * FROM evidences WHERE day_id = $1', [dayId]);
  const { rows: penalties } = await pool.query('SELECT * FROM penalties WHERE day_id = $1', [dayId]);

  return { ...day, blocks, evidences, penalties };
}

function computeScore(day, blocks, penalties) {
  if (day.status === 'lost') return 0;
  let score = 0;
  if (day.entered_on_time)        score += 15;
  if (day.ritual_complete)        score += 15;

  const areaMins = { NEGOCIO: 0, SEGUNDA: 0, ESTUDIO: 0, EJERCICIO: 0 };
  for (const b of blocks) {
    const dur = b.end_minutes - b.start_minutes;
    if (areaMins[b.area_id] !== undefined) areaMins[b.area_id] += dur;
  }
  if (areaMins.NEGOCIO   >= 300) score += 15;
  if (areaMins.SEGUNDA   >=  60) score += 10;
  if (areaMins.ESTUDIO   >= 180) score += 10;
  if (areaMins.EJERCICIO >=  30) score += 10;

  if (day.all_evidences_complete) score += 15;
  if (day.close_complete)         score += 10;

  const pen = penalties.reduce((acc, p) => acc + p.points, 0);
  return Math.max(0, score - pen);
}

// ─── routes ─────────────────────────────────────────────────────────────────

// GET /api/days/today
router.get('/today', async (req, res) => {
  try {
    const dateKey = getAppDayKey();

    let { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, dateKey]
    );

    if (!day) {
      const { rows: [newDay] } = await pool.query(
        `INSERT INTO days (user_id, date_key, phase, entered_on_time)
         VALUES ($1, $2, 'yesterday', TRUE) RETURNING *`,
        [req.userId, dateKey]
      );
      day = newDay;
    }

    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// GET /api/days (list)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 ORDER BY date_key DESC',
      [req.userId]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// GET /api/days/:dateKey
router.get('/:dateKey', async (req, res) => {
  try {
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, req.params.dateKey]
    );
    if (!day) return res.status(404).json({ error: 'Día no encontrado' });
    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// PUT /api/days/:dateKey/phase
router.put('/:dateKey/phase', async (req, res) => {
  try {
    const { phase } = req.body;
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, req.params.dateKey]
    );
    if (!day) return res.status(404).json({ error: 'Día no encontrado' });

    await pool.query('UPDATE days SET phase = $1 WHERE id = $2', [phase, day.id]);
    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// PUT /api/days/:dateKey/ritual
router.put('/:dateKey/ritual', async (req, res) => {
  try {
    const { phrase, photo_path } = req.body;
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, req.params.dateKey]
    );
    if (!day) return res.status(404).json({ error: 'Día no encontrado' });

    await pool.query(
      `UPDATE days SET daily_phrase = $1, ritual_photo_path = $2,
       ritual_complete = TRUE, phase = 'planner' WHERE id = $3`,
      [phrase, photo_path || null, day.id]
    );
    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// PUT /api/days/:dateKey/close
router.put('/:dateKey/close', async (req, res) => {
  try {
    const { emotional_state, close_photo_path, project_progress } = req.body;
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, req.params.dateKey]
    );
    if (!day) return res.status(404).json({ error: 'Día no encontrado' });

    // Update project progress
    if (project_progress && typeof project_progress === 'object') {
      for (const [pid, progress] of Object.entries(project_progress)) {
        await pool.query(
          `UPDATE projects SET progress = $1, done = ($1 >= 100), updated_at = NOW()
           WHERE id = $2 AND user_id = $3`,
          [progress, parseInt(pid), req.userId]
        );
      }
    }

    const { rows: blocks }    = await pool.query('SELECT * FROM blocks WHERE day_id = $1', [day.id]);
    const { rows: penalties } = await pool.query('SELECT * FROM penalties WHERE day_id = $1', [day.id]);

    const draftDay = { ...day, close_complete: true, status: 'complete' };
    const score = computeScore(draftDay, blocks, penalties);

    await pool.query(
      `UPDATE days SET close_complete = TRUE, close_time = NOW(), close_photo_path = $1,
       emotional_state = $2, status = 'complete', score = $3, phase = 'day_complete' WHERE id = $4`,
      [close_photo_path || null, emotional_state || null, score, day.id]
    );
    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// GET /api/days/:dateKey/summary
router.get('/:dateKey/summary', async (req, res) => {
  try {
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, req.params.dateKey]
    );
    if (!day) return res.json({ data: null });
    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/days/:dateKey/start  ← "Comenzar día" button
router.post('/:dateKey/start', async (req, res) => {
  try {
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, req.params.dateKey]
    );
    if (!day) return res.status(404).json({ error: 'Día no encontrado' });

    await pool.query(
      `UPDATE days SET phase = 'ritual', entered_on_time = TRUE WHERE id = $1`,
      [day.id]
    );
    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/days/:dateKey/ups/use
router.post('/:dateKey/ups/use', async (req, res) => {
  try {
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, req.params.dateKey]
    );
    if (!day) return res.status(404).json({ error: 'Día no encontrado' });

    await pool.query('UPDATE user_config SET ups_used = TRUE WHERE user_id = $1', [req.userId]);
    await pool.query(
      `UPDATE days SET used_ups = TRUE, entered_on_time = TRUE, phase = 'yesterday' WHERE id = $1`,
      [day.id]
    );
    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/days/:dateKey/lose
router.post('/:dateKey/lose', async (req, res) => {
  try {
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, req.params.dateKey]
    );
    if (!day) return res.status(404).json({ error: 'Día no encontrado' });

    await pool.query(
      `UPDATE days SET status = 'lost', phase = 'day_lost', score = 0, global_penalty = 150 WHERE id = $1`,
      [day.id]
    );
    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/days/:dateKey/continue-late
router.post('/:dateKey/continue-late', async (req, res) => {
  try {
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, req.params.dateKey]
    );
    if (!day) return res.status(404).json({ error: 'Día no encontrado' });

    await pool.query(
      `UPDATE days SET entered_on_time = FALSE, phase = 'yesterday' WHERE id = $1`,
      [day.id]
    );
    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/days/:dateKey/confirm-planning
router.post('/:dateKey/confirm-planning', async (req, res) => {
  try {
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, req.params.dateKey]
    );
    if (!day) return res.status(404).json({ error: 'Día no encontrado' });

    await pool.query(`UPDATE days SET phase = 'ritual' WHERE id = $1`, [day.id]);
    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/days/:dateKey/recover
router.post('/:dateKey/recover', async (req, res) => {
  try {
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, req.params.dateKey]
    );
    if (!day) return res.status(404).json({ error: 'Día no encontrado' });

    const { rows: blocks } = await pool.query('SELECT id FROM blocks WHERE day_id = $1', [day.id]);
    const phase = blocks.length > 0 ? 'dashboard' : 'planner';

    await pool.query(
      `UPDATE days SET status = 'in_progress', phase = $1, global_penalty = 0,
       ritual_complete = TRUE WHERE id = $2`,
      [phase, day.id]
    );
    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/days/:dateKey/special-day
router.post('/:dateKey/special-day', async (req, res) => {
  try {
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, req.params.dateKey]
    );
    if (!day) return res.status(404).json({ error: 'Día no encontrado' });

    await pool.query(`UPDATE days SET is_special_day = TRUE WHERE id = $1`, [day.id]);
    await pool.query(
      `UPDATE user_config SET special_days_used_count = special_days_used_count + 1 WHERE user_id = $1`,
      [req.userId]
    );
    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

export default router;
