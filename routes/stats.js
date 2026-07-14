import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { getAppDayKey } from '../utils/bogotaTime.js';

const router = Router();
router.use(authenticate);

// GET /api/stats/streak — consecutive days (most recent backward) where the
// morning ritual was completed AND at least one time block was scheduled.
router.get('/streak', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.date_key, d.ritual_complete, d.status,
         EXISTS(SELECT 1 FROM blocks b WHERE b.day_id = d.id) AS has_blocks
       FROM days d
       WHERE d.user_id = $1
       ORDER BY d.date_key DESC`,
      [req.userId]
    );

    const todayKey = getAppDayKey();
    let streak = 0;
    for (const d of rows) {
      const dateKey = d.date_key.toString().slice(0, 10);
      const done = d.ritual_complete && d.has_blocks && d.status !== 'lost';
      if (done) { streak++; continue; }
      if (dateKey === todayKey) continue; // today isn't finished yet — doesn't break the streak
      break;
    }

    res.json({ data: { streak } });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// GET /api/stats/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    // Today's score (from in-progress day)
    const { rows: [today] } = await pool.query(
      `SELECT d.*,
        (SELECT COALESCE(SUM(b.end_minutes - b.start_minutes), 0) FROM blocks b WHERE b.day_id = d.id) AS total_mins
       FROM days d WHERE d.user_id = $1 ORDER BY d.date_key DESC LIMIT 1`,
      [req.userId]
    );

    // Last 30 days for streak and weekly score
    const { rows: recent } = await pool.query(
      `SELECT date_key, score, status FROM days
       WHERE user_id = $1 AND date_key >= CURRENT_DATE - INTERVAL '30 days'
       ORDER BY date_key DESC`,
      [req.userId]
    );

    // Current streak (consecutive non-lost days)
    let streak = 0;
    for (const d of recent) {
      if (d.status !== 'lost') streak++;
      else break;
    }

    // Area compliance: % of days meeting each minimum (last 30 days)
    const { rows: areaRows } = await pool.query(
      `SELECT
         SUM(CASE WHEN neg >= 300 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) * 100 AS negocio_pct,
         SUM(CASE WHEN seg >=  60 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) * 100 AS segunda_pct,
         SUM(CASE WHEN est >= 180 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) * 100 AS estudio_pct,
         SUM(CASE WHEN eje >=  30 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0) * 100 AS ejercicio_pct
       FROM (
         SELECT d.id,
           COALESCE(SUM(CASE WHEN b.area_id = 'NEGOCIO'   THEN b.end_minutes - b.start_minutes ELSE 0 END), 0) AS neg,
           COALESCE(SUM(CASE WHEN b.area_id = 'SEGUNDA'   THEN b.end_minutes - b.start_minutes ELSE 0 END), 0) AS seg,
           COALESCE(SUM(CASE WHEN b.area_id = 'ESTUDIO'   THEN b.end_minutes - b.start_minutes ELSE 0 END), 0) AS est,
           COALESCE(SUM(CASE WHEN b.area_id = 'EJERCICIO' THEN b.end_minutes - b.start_minutes ELSE 0 END), 0) AS eje
         FROM days d
         LEFT JOIN blocks b ON b.day_id = d.id
         WHERE d.user_id = $1 AND d.date_key >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY d.id
       ) sub`,
      [req.userId]
    );

    res.json({
      data: {
        today,
        streak,
        recent_days:   recent,
        area_pct:      areaRows[0] || {},
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// GET /api/stats/history?days=30
router.get('/history', async (req, res) => {
  try {
    const daysParam = parseInt(req.query.days);
    const allTime   = !req.query.days || daysParam === 0;

    const { rows } = await pool.query(
      `SELECT d.*,
         json_build_object(
           'NEGOCIO',   COALESCE(SUM(CASE WHEN b.area_id = 'NEGOCIO'   THEN b.end_minutes - b.start_minutes ELSE 0 END), 0),
           'SEGUNDA',   COALESCE(SUM(CASE WHEN b.area_id = 'SEGUNDA'   THEN b.end_minutes - b.start_minutes ELSE 0 END), 0),
           'ESTUDIO',   COALESCE(SUM(CASE WHEN b.area_id = 'ESTUDIO'   THEN b.end_minutes - b.start_minutes ELSE 0 END), 0),
           'EJERCICIO', COALESCE(SUM(CASE WHEN b.area_id = 'EJERCICIO' THEN b.end_minutes - b.start_minutes ELSE 0 END), 0)
         ) AS area_minutes
       FROM days d
       LEFT JOIN blocks b ON b.day_id = d.id
       WHERE d.user_id = $1
         ${allTime ? '' : `AND d.date_key >= CURRENT_DATE - ($2 || ' days')::INTERVAL`}
       GROUP BY d.id
       ORDER BY d.date_key DESC`,
      allTime ? [req.userId] : [req.userId, Math.min(daysParam, 365)]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// GET /api/stats/areas
router.get('/areas', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE neg >= 300)::float / NULLIF(COUNT(*), 0) * 100 AS negocio,
         COUNT(*) FILTER (WHERE seg >=  60)::float / NULLIF(COUNT(*), 0) * 100 AS segunda,
         COUNT(*) FILTER (WHERE est >= 180)::float / NULLIF(COUNT(*), 0) * 100 AS estudio,
         COUNT(*) FILTER (WHERE eje >=  30)::float / NULLIF(COUNT(*), 0) * 100 AS ejercicio
       FROM (
         SELECT d.id,
           COALESCE(SUM(CASE WHEN b.area_id = 'NEGOCIO'   THEN b.end_minutes - b.start_minutes ELSE 0 END), 0) AS neg,
           COALESCE(SUM(CASE WHEN b.area_id = 'SEGUNDA'   THEN b.end_minutes - b.start_minutes ELSE 0 END), 0) AS seg,
           COALESCE(SUM(CASE WHEN b.area_id = 'ESTUDIO'   THEN b.end_minutes - b.start_minutes ELSE 0 END), 0) AS est,
           COALESCE(SUM(CASE WHEN b.area_id = 'EJERCICIO' THEN b.end_minutes - b.start_minutes ELSE 0 END), 0) AS eje
         FROM days d
         LEFT JOIN blocks b ON b.day_id = d.id
         WHERE d.user_id = $1 AND d.status != 'lost'
         GROUP BY d.id
       ) sub`,
      [req.userId]
    );
    res.json({ data: rows[0] || {} });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// GET /api/stats/weekly-chart
router.get('/weekly-chart', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         DATE_TRUNC('week', date_key) AS week_start,
         ROUND(AVG(score))            AS avg_score,
         COUNT(*)                     AS total_days,
         COUNT(*) FILTER (WHERE status = 'complete') AS complete_days
       FROM days
       WHERE user_id = $1 AND date_key >= CURRENT_DATE - INTERVAL '12 weeks'
       GROUP BY 1
       ORDER BY 1`,
      [req.userId]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

export default router;
