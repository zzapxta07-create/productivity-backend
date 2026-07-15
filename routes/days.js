import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { getAppDayKey, getBogotaDatetime, isLateInBogota } from '../utils/bogotaTime.js';

const router = Router();
router.use(authenticate);

async function seedBlocksFromWeeklyPlan(dayId, userId, dateKey) {
  const d = new Date(dateKey + 'T12:00:00Z');
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  const weekStart = d.toISOString().slice(0, 10);
  const dayOfWeek = dow === 0 ? 6 : dow - 1;

  const { rows: [plan] } = await pool.query(
    'SELECT id FROM weekly_plans WHERE user_id = $1 AND week_start = $2',
    [userId, weekStart]
  );
  if (!plan) return;

  const { rows: templateBlocks } = await pool.query(
    `SELECT * FROM weekly_plan_blocks
     WHERE plan_id = $1 AND day_of_week = $2
     ORDER BY sort_order, start_minutes`,
    [plan.id, dayOfWeek]
  );
  if (templateBlocks.length === 0) return;

  for (let i = 0; i < templateBlocks.length; i++) {
    const b = templateBlocks[i];
    await pool.query(
      `INSERT INTO blocks
         (day_id, area_id, project_id, start_time, end_time,
          start_minutes, end_minutes, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [dayId, b.area_id, b.project_id, b.start_time, b.end_time,
       b.start_minutes, b.end_minutes, b.notes, i]
    );
  }
}

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

const DEFAULT_MIN_MINUTES = { NEGOCIO: 300, SEGUNDA: 60, ESTUDIO: 180, EJERCICIO: 30 };

// Reads the user's customized area minimums (Config screen), falling back to
// defaults — mirrors the merge logic in routes/areas.js.
async function getAreaMinMinutes(userId) {
  const { rows: [cfg] } = await pool.query(
    'SELECT areas_config FROM user_config WHERE user_id = $1', [userId]
  );
  const overrides = cfg?.areas_config || {};
  const result = { ...DEFAULT_MIN_MINUTES };
  for (const id of Object.keys(result)) {
    const v = overrides[id]?.min_minutes;
    if (v !== undefined && v !== null) result[id] = Number(v);
  }
  return result;
}

function computeScore(day, blocks, evidences, minMinutes = DEFAULT_MIN_MINUTES) {
  if (day.status === 'lost') return 0;
  let score = 0;
  if (day.entered_on_time) score += 15;
  if (day.ritual_complete) score += 15;

  const evidencedIds = new Set((evidences || []).filter(e => !e.no_hice).map(e => e.block_id));
  const areaMins = { NEGOCIO: 0, SEGUNDA: 0, ESTUDIO: 0, EJERCICIO: 0 };
  for (const b of blocks) {
    if (b.area_id === 'OTROS') continue;
    if (!evidencedIds.has(b.id)) continue;
    const dur = b.end_minutes - b.start_minutes;
    if (areaMins[b.area_id] !== undefined) areaMins[b.area_id] += dur;
  }
  if (areaMins.NEGOCIO   >= minMinutes.NEGOCIO)   score += 15;
  if (areaMins.SEGUNDA   >= minMinutes.SEGUNDA)   score += 10;
  if (areaMins.ESTUDIO   >= minMinutes.ESTUDIO)   score += 10;
  if (areaMins.EJERCICIO >= minMinutes.EJERCICIO) score += 10;

  if (day.all_evidences_complete) score += 15;
  if (day.close_complete)         score += 10;

  return Math.max(0, score);
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

// POST /api/days/ensure/:dateKey — create day if it doesn't exist, return it
router.post('/ensure/:dateKey', async (req, res) => {
  try {
    const dateKey = req.params.dateKey;
    const { rows: [day] } = await pool.query(
      `INSERT INTO days (user_id, date_key, phase, status)
       VALUES ($1, $2, 'planner', 'in_progress')
       ON CONFLICT (user_id, date_key) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [req.userId, dateKey]
    );
    res.json({ data: day });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// GET /api/days/week/:weekDate — returns all 7 days of the week with blocks
router.get('/week/:weekDate', async (req, res) => {
  try {
    const d = new Date(req.params.weekDate + 'T12:00:00Z');
    const dow = d.getUTCDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setUTCDate(d.getUTCDate() + diff);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const dd = new Date(d);
      dd.setUTCDate(d.getUTCDate() + i);
      const dateKey = dd.toISOString().slice(0, 10);
      const { rows: [day] } = await pool.query(
        'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
        [req.userId, dateKey]
      );
      if (day) {
        const { rows: blocks } = await pool.query(
          `SELECT b.*, p.name AS project_name
           FROM blocks b LEFT JOIN projects p ON b.project_id = p.id
           WHERE b.day_id = $1 ORDER BY b.sort_order, b.start_minutes`,
          [day.id]
        );
        days.push({ ...day, blocks, dateKey });
      } else {
        days.push({ dateKey, blocks: [] });
      }
    }
    res.json({ data: days });
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
    const { phrase, photo_path, ritual_essay } = req.body;
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, req.params.dateKey]
    );
    if (!day) return res.status(404).json({ error: 'Día no encontrado' });

    await pool.query(
      `UPDATE days SET daily_phrase = $1, ritual_photo_path = $2, ritual_essay = $3,
       ritual_complete = TRUE, phase = 'planner' WHERE id = $4`,
      [phrase || null, photo_path || null, ritual_essay || null, day.id]
    );
    res.json({ data: await getDayFull(day.id) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// PUT /api/days/:dateKey/close
router.put('/:dateKey/close', async (req, res) => {
  try {
    const { emotional_state, close_photo_path, project_progress, close_summary } = req.body;
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
    const { rows: evidences } = await pool.query('SELECT * FROM evidences WHERE day_id = $1', [day.id]);
    const minMinutes = await getAreaMinMinutes(req.userId);

    const draftDay = { ...day, close_complete: true, status: 'complete' };
    const score = computeScore(draftDay, blocks, evidences, minMinutes);

    await pool.query(
      `UPDATE days SET close_complete = TRUE, close_time = NOW(), close_photo_path = $1,
       emotional_state = $2, status = 'complete', score = $3, phase = 'day_complete',
       close_summary = $5 WHERE id = $4`,
      [close_photo_path || null, emotional_state || null, score, day.id, close_summary || null]
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

    if (isLateInBogota()) {
      await pool.query(`UPDATE days SET phase = 'ups_prompt' WHERE id = $1`, [day.id]);
    } else {
      await pool.query(
        `UPDATE days SET phase = 'ritual', entered_on_time = TRUE WHERE id = $1`,
        [day.id]
      );
    }
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
      `UPDATE days SET used_ups = TRUE, entered_on_time = TRUE, phase = 'ritual' WHERE id = $1`,
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
      `UPDATE days SET entered_on_time = FALSE, phase = 'ritual' WHERE id = $1`,
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

    const { rows: dayBlocks } = await pool.query(
      'SELECT id FROM blocks WHERE day_id = $1 LIMIT 1', [day.id]
    );
    if (dayBlocks.length === 0) {
      await seedBlocksFromWeeklyPlan(day.id, req.userId, req.params.dateKey);
    }

    const nextPhase = day.ritual_complete ? 'dashboard' : 'ritual';
    await pool.query(`UPDATE days SET phase = $1 WHERE id = $2`, [nextPhase, day.id]);
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
