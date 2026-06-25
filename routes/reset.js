import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// POST /api/reset — wipe all user data, keep account
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const uid = req.userId;

    // Delete leaf tables first, then parents
    await client.query('DELETE FROM notes  WHERE user_id = $1', [uid]);
    await client.query('DELETE FROM tasks  WHERE user_id = $1', [uid]);
    await client.query(
      'DELETE FROM habit_logs WHERE habit_id IN (SELECT id FROM habits WHERE user_id = $1)',
      [uid]
    );
    await client.query('DELETE FROM habits   WHERE user_id = $1', [uid]);
    // days cascade → blocks → evidences, penalties
    await client.query('DELETE FROM days     WHERE user_id = $1', [uid]);
    await client.query('DELETE FROM projects WHERE user_id = $1', [uid]);

    // Reset config
    await client.query(`
      UPDATE user_config SET
        ups_used                = false,
        ups_total               = 1,
        special_days_used_count = 0,
        replan_days_used_count  = 0,
        config_month            = DATE_TRUNC('month', CURRENT_DATE),
        updated_at              = NOW()
      WHERE user_id = $1
    `, [uid]);

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[reset]', err);
    res.status(500).json({ error: 'Error al reiniciar' });
  } finally {
    client.release();
  }
});

export default router;
