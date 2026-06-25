import { Router } from 'express';
import pool from '../db.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const DEFAULTS = [
  { id: 'NEGOCIO',   label: 'Negocio Principal',  color: '#3B82F6', emoji: '🏛', min_minutes: 300 },
  { id: 'SEGUNDA',   label: 'Segunda Empresa',     color: '#A855F7', emoji: '⚔',  min_minutes: 60  },
  { id: 'ESTUDIO',   label: 'Estudio Individual',  color: '#F59E0B', emoji: '📖', min_minutes: 180 },
  { id: 'EJERCICIO', label: 'Ejercicio',            color: '#10B981', emoji: '🛡', min_minutes: 30  },
  { id: 'OTROS',     label: 'Otros',               color: '#6B7280', emoji: '◆',  min_minutes: 0   },
];

async function getUserOverrides(userId) {
  const { rows: [cfg] } = await pool.query(
    'SELECT areas_config FROM user_config WHERE user_id = $1', [userId]
  );
  return cfg?.areas_config || {};
}

// GET /api/areas
router.get('/', async (req, res) => {
  try {
    const overrides = await getUserOverrides(req.userId);
    const areas = DEFAULTS.map(d => ({ ...d, ...(overrides[d.id] || {}) }));
    res.json({ data: areas });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

// PUT /api/areas
router.put('/', async (req, res) => {
  try {
    const { areas } = req.body;
    if (!Array.isArray(areas)) return res.status(400).json({ error: 'areas must be array' });

    const config = {};
    for (const a of areas) {
      if (!a.id) continue;
      config[a.id] = {
        label:       a.label,
        color:       a.color,
        emoji:       a.emoji,
        min_minutes: Number(a.min_minutes) || 0,
      };
    }

    await pool.query(
      'INSERT INTO user_config (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
      [req.userId]
    );
    await pool.query(
      'UPDATE user_config SET areas_config = $1 WHERE user_id = $2',
      [JSON.stringify(config), req.userId]
    );

    const result = DEFAULTS.map(d => ({ ...d, ...(config[d.id] || {}) }));
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: 'Error interno', details: err.message });
  }
});

export default router;
