import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import pool from '../db.js';

const router = Router();
router.use(authenticate);

const WEBHOOK_COACH  = process.env.N8N_WEBHOOK_COACH;
const WEBHOOK_CHAT   = process.env.N8N_WEBHOOK_CHAT;
const WEBHOOK_WEEKLY = process.env.N8N_WEBHOOK_WEEKLY;

async function callWebhook(url, data) {
  if (!url) throw new Error('Webhook no configurado');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Webhook error: ${res.status}`);
  return await res.json();
}

function areaMinutes(blocks) {
  const mins = { NEGOCIO: 0, SEGUNDA: 0, ESTUDIO: 0, EJERCICIO: 0, OTROS: 0 };
  for (const b of blocks) {
    const dur = b.end_minutes - b.start_minutes;
    if (mins[b.area_id] !== undefined) mins[b.area_id] += dur;
  }
  return mins;
}

// POST /api/ai/coach — coach de cierre de día
router.post('/coach', async (req, res) => {
  try {
    const { date_key } = req.body;
    const { rows: [day] } = await pool.query(
      'SELECT * FROM days WHERE user_id = $1 AND date_key = $2',
      [req.userId, date_key]
    );
    if (!day) return res.status(404).json({ error: 'Día no encontrado' });

    const { rows: blocks }    = await pool.query('SELECT * FROM blocks WHERE day_id = $1', [day.id]);
    const { rows: penalties } = await pool.query('SELECT * FROM penalties WHERE day_id = $1', [day.id]);
    const { rows: evidences } = await pool.query('SELECT * FROM evidences WHERE day_id = $1', [day.id]);

    const areas = areaMinutes(blocks);
    const payload = {
      date:               day.date_key,
      score:              day.score,
      ritual_complete:    day.ritual_complete,
      emotional_state:    day.emotional_state,
      all_evidences:      day.all_evidences_complete,
      daily_phrase:       day.daily_phrase,
      areas: {
        NEGOCIO:   { minutes: areas.NEGOCIO,   target: 300, met: areas.NEGOCIO   >= 300 },
        SEGUNDA:   { minutes: areas.SEGUNDA,   target: 60,  met: areas.SEGUNDA   >= 60  },
        ESTUDIO:   { minutes: areas.ESTUDIO,   target: 180, met: areas.ESTUDIO   >= 180 },
        EJERCICIO: { minutes: areas.EJERCICIO, target: 30,  met: areas.EJERCICIO >= 30  },
      },
      penalties_total: penalties.reduce((s, p) => s + p.points, 0),
      blocks_count:    blocks.length,
      evidences_count: evidences.length,
    };

    const result = await callWebhook(WEBHOOK_COACH, payload);
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/chat — asistente del dashboard
router.post('/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    // Get today's context
    const { rows: [day] } = await pool.query(
      `SELECT * FROM days WHERE user_id = $1 ORDER BY date_key DESC LIMIT 1`,
      [req.userId]
    );
    const blocks = day
      ? (await pool.query('SELECT * FROM blocks WHERE day_id = $1 ORDER BY start_minutes', [day.id])).rows
      : [];
    const areas = areaMinutes(blocks);

    // Recent scores (last 7 days)
    const { rows: recent } = await pool.query(
      `SELECT date_key, score, status FROM days WHERE user_id = $1
       ORDER BY date_key DESC LIMIT 7`,
      [req.userId]
    );

    const payload = {
      message,
      history,
      context: {
        today: day ? {
          date:          day.date_key,
          score_live:    day.score || 0,
          phase:         day.phase,
          areas_minutes: areas,
          areas_targets: { NEGOCIO: 300, SEGUNDA: 60, ESTUDIO: 180, EJERCICIO: 30 },
        } : null,
        recent_days: recent.map(d => ({ date: d.date_key, score: d.score, status: d.status })),
      },
    };

    const result = await callWebhook(WEBHOOK_CHAT, payload);
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/weekly — resumen semanal
router.post('/weekly', async (req, res) => {
  try {
    const { rows: days } = await pool.query(
      `SELECT d.*, array_agg(row_to_json(b)) FILTER (WHERE b.id IS NOT NULL) AS blocks
       FROM days d
       LEFT JOIN blocks b ON b.day_id = d.id
       WHERE d.user_id = $1 AND d.date_key >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY d.id
       ORDER BY d.date_key DESC`,
      [req.userId]
    );

    if (days.length === 0) return res.json({ data: { message: 'No hay datos suficientes aún.' } });

    const avgScore = days.filter(d => d.score).reduce((s, d, _, a) => s + d.score / a.length, 0);
    const best  = [...days].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    const worst = [...days].sort((a, b) => (a.score || 0) - (b.score || 0))[0];

    const payload = {
      week_days: days.map(d => ({
        date:            d.date_key,
        score:           d.score,
        status:          d.status,
        emotional_state: d.emotional_state,
        areas:           areaMinutes(d.blocks || []),
        ritual:          d.ritual_complete,
        all_evidences:   d.all_evidences_complete,
      })),
      stats: {
        avg_score: Math.round(avgScore),
        best_day:  best?.date_key,
        worst_day: worst?.date_key,
        complete_days: days.filter(d => d.status === 'complete').length,
        lost_days:     days.filter(d => d.status === 'lost').length,
      },
    };

    const result = await callWebhook(WEBHOOK_WEEKLY, payload);
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
