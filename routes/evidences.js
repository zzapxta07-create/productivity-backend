import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { getBogotaMinutes } from '../utils/bogotaTime.js';

const router = Router();
router.use(authenticate);

// POST /api/evidences
router.post('/', async (req, res) => {
  try {
    const { block_id, slot_index, q1, q2, q3, focus_level, no_hice, reason } = req.body;

    // Verify ownership
    const { rows: [block] } = await pool.query(
      `SELECT b.*, d.id AS day_id, d.user_id FROM blocks b
       JOIN days d ON b.day_id = d.id WHERE b.id = $1`,
      [block_id]
    );
    if (!block || block.user_id !== req.userId) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    // Upsert evidence
    const { rows: [evidence] } = await pool.query(
      `INSERT INTO evidences (day_id, block_id, slot_index, q1, q2, q3, focus_level, no_hice, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (block_id, slot_index) DO UPDATE SET
         q1 = EXCLUDED.q1, q2 = EXCLUDED.q2, q3 = EXCLUDED.q3,
         focus_level = EXCLUDED.focus_level, no_hice = EXCLUDED.no_hice,
         reason = EXCLUDED.reason, submitted_at = NOW()
       RETURNING *`,
      [block.day_id, block_id, slot_index,
       q1 || null, q2 || null, q3 || null,
       focus_level || null, no_hice || false, reason || null]
    );

    // Remove old penalty for this slot, then re-add if no_hice
    await pool.query(
      'DELETE FROM penalties WHERE block_id = $1 AND slot_index = $2',
      [block_id, slot_index]
    );
    if (no_hice) {
      const dur    = block.end_minutes - block.start_minutes;
      const points = Math.max(8, Math.floor(dur / 60) * 8);
      await pool.query(
        `INSERT INTO penalties (day_id, block_id, slot_index, points, reason)
         VALUES ($1, $2, $3, $4, 'no_hice')
         ON CONFLICT (day_id, block_id, slot_index) DO UPDATE SET points = EXCLUDED.points`,
        [block.day_id, block_id, slot_index, points]
      );
    }

    // Check if all evidences complete
    const { rows: nonOtrosBlocks } = await pool.query(
      `SELECT * FROM blocks WHERE day_id = $1 AND area_id != 'OTROS'`,
      [block.day_id]
    );
    let allComplete = nonOtrosBlocks.length > 0;
    for (const b of nonOtrosBlocks) {
      const maxSlot = Math.floor((b.end_minutes - b.start_minutes) / 60);
      if (maxSlot < 1) continue;
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS cnt FROM evidences WHERE block_id = $1',
        [b.id]
      );
      if (rows[0].cnt < maxSlot) { allComplete = false; break; }
    }
    if (allComplete && nonOtrosBlocks.length > 0) {
      await pool.query('UPDATE days SET all_evidences_complete = TRUE WHERE id = $1', [block.day_id]);
    }

    res.json({ data: evidence });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// GET /api/evidences/pending — slots pendientes en el día activo
router.get('/pending', async (req, res) => {
  try {
    const nowMinutes = getBogotaMinutes();

    const { rows: [day] } = await pool.query(
      `SELECT * FROM days WHERE user_id = $1 ORDER BY date_key DESC LIMIT 1`,
      [req.userId]
    );
    if (!day) return res.json({ data: [] });

    const { rows: blocks } = await pool.query(
      `SELECT * FROM blocks WHERE day_id = $1 AND area_id != 'OTROS' ORDER BY start_minutes`,
      [day.id]
    );

    const pending = [];
    for (const block of blocks) {
      const elapsed    = nowMinutes - block.start_minutes;
      if (elapsed < 60) continue;
      const latestSlot = Math.floor(elapsed / 60);

      for (let slot = 1; slot <= latestSlot; slot++) {
        const { rows } = await pool.query(
          'SELECT id FROM evidences WHERE block_id = $1 AND slot_index = $2',
          [block.id, slot]
        );
        if (rows.length === 0) pending.push({ block, slot_index: slot });
      }
    }
    res.json({ data: pending });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

export default router;
