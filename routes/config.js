import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

async function getOrResetConfig(userId) {
  let { rows: [cfg] } = await pool.query(
    'SELECT * FROM user_config WHERE user_id = $1', [userId]
  );

  if (!cfg) {
    const { rows: [newCfg] } = await pool.query(
      'INSERT INTO user_config (user_id) VALUES ($1) RETURNING *', [userId]
    );
    return newCfg;
  }

  // Auto-reset if config_month is a past month
  const cfgMonth   = new Date(cfg.config_month);
  const now        = new Date();
  const thisMonth  = new Date(now.getFullYear(), now.getMonth(), 1);

  if (cfgMonth < thisMonth) {
    const { rows: [reset] } = await pool.query(
      `UPDATE user_config SET
         ups_used                = FALSE,
         special_days_used_count = 0,
         replan_days_used_count  = 0,
         config_month            = DATE_TRUNC('month', CURRENT_DATE)
       WHERE user_id = $1 RETURNING *`,
      [userId]
    );
    return reset;
  }
  return cfg;
}

// GET /api/config
router.get('/', async (req, res) => {
  try {
    const cfg = await getOrResetConfig(req.userId);
    res.json({ data: cfg });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/config/ups/use
router.post('/ups/use', async (req, res) => {
  try {
    const cfg = await getOrResetConfig(req.userId);
    if (cfg.ups_used) return res.status(400).json({ error: 'UPS ya usado este mes' });

    const { rows: [updated] } = await pool.query(
      'UPDATE user_config SET ups_used = TRUE WHERE user_id = $1 RETURNING *',
      [req.userId]
    );
    res.json({ data: updated });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/config/special-day/use
router.post('/special-day/use', async (req, res) => {
  try {
    const cfg = await getOrResetConfig(req.userId);
    if (cfg.special_days_used_count >= cfg.special_days_total) {
      return res.status(400).json({ error: 'Días especiales agotados' });
    }
    const { rows: [updated] } = await pool.query(
      `UPDATE user_config SET special_days_used_count = special_days_used_count + 1
       WHERE user_id = $1 RETURNING *`,
      [req.userId]
    );
    res.json({ data: updated });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// POST /api/config/replan/use
router.post('/replan/use', async (req, res) => {
  try {
    const cfg = await getOrResetConfig(req.userId);
    if (cfg.replan_days_used_count >= cfg.replan_days_total) {
      return res.status(400).json({ error: 'Días de replanificación agotados' });
    }
    const { rows: [updated] } = await pool.query(
      `UPDATE user_config SET replan_days_used_count = replan_days_used_count + 1
       WHERE user_id = $1 RETURNING *`,
      [req.userId]
    );
    res.json({ data: updated });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

export default router;
