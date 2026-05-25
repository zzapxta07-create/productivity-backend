import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// POST /api/evidences — one per block (slot_index always 0)
router.post('/', async (req, res) => {
  try {
    const { block_id, q1, q2, q3, focus_level, no_hice, reason, photo_data } = req.body;

    const { rows: [block] } = await pool.query(
      `SELECT b.*, d.id AS day_id, d.user_id FROM blocks b
       JOIN days d ON b.day_id = d.id WHERE b.id = $1`,
      [block_id]
    );
    if (!block || block.user_id !== req.userId) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { rows: [evidence] } = await pool.query(
      `INSERT INTO evidences (day_id, block_id, slot_index, q1, q2, q3, focus_level, no_hice, reason, photo_data)
       VALUES ($1, $2, 0, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (block_id, slot_index) DO UPDATE SET
         q1 = EXCLUDED.q1, q2 = EXCLUDED.q2, q3 = EXCLUDED.q3,
         focus_level = EXCLUDED.focus_level, no_hice = EXCLUDED.no_hice,
         reason = EXCLUDED.reason, photo_data = EXCLUDED.photo_data, submitted_at = NOW()
       RETURNING *`,
      [block.day_id, block_id,
       q1 || null, q2 || null, q3 || null,
       focus_level || null, no_hice || false, reason || null, photo_data || null]
    );

    // Check all_evidences_complete (1 evidence per non-OTROS block)
    const { rows: nonOtros } = await pool.query(
      `SELECT id FROM blocks WHERE day_id = $1 AND area_id != 'OTROS'`,
      [block.day_id]
    );
    let allComplete = nonOtros.length > 0;
    for (const b of nonOtros) {
      const { rows } = await pool.query(
        'SELECT id FROM evidences WHERE block_id = $1 LIMIT 1', [b.id]
      );
      if (rows.length === 0) { allComplete = false; break; }
    }
    if (allComplete) {
      await pool.query('UPDATE days SET all_evidences_complete = TRUE WHERE id = $1', [block.day_id]);
    }

    res.json({ data: evidence });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// GET /api/evidences/pending — blocks that ended without evidence
router.get('/pending', async (req, res) => {
  try {
    const { rows: [day] } = await pool.query(
      `SELECT * FROM days WHERE user_id = $1 ORDER BY date_key DESC LIMIT 1`,
      [req.userId]
    );
    if (!day) return res.json({ data: [] });

    const { rows: blocks } = await pool.query(
      `SELECT b.*, p.name AS project_name FROM blocks b
       LEFT JOIN projects p ON b.project_id = p.id
       WHERE b.day_id = $1 AND b.area_id != 'OTROS'
       ORDER BY b.start_minutes`,
      [day.id]
    );

    const pending = [];
    for (const block of blocks) {
      const { rows } = await pool.query(
        'SELECT id FROM evidences WHERE block_id = $1 LIMIT 1', [block.id]
      );
      if (rows.length === 0) pending.push(block);
    }

    res.json({ data: pending });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

export default router;
