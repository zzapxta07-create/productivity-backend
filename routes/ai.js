import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const WEBHOOK_URL = process.env.N8N_WEBHOOK_AI;

// POST /api/ai/chat
router.post('/chat', async (req, res) => {
  try {
    if (!WEBHOOK_URL) {
      return res.status(503).json({ error: 'AI no configurado. Agregá N8N_WEBHOOK_AI en Railway.' });
    }

    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Mensaje vacío' });

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: req.userId,
        message: message.trim(),
        history,
      }),
      signal: AbortSignal.timeout(45000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`n8n error ${response.status}: ${text}`);
    }

    const data = await response.json();
    // n8n AI Agent returns { output } or { response } or plain string
    const reply = data?.output || data?.response || data?.text || data?.message
      || (typeof data === 'string' ? data : JSON.stringify(data));

    res.json({ data: { response: reply } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
