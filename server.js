import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import authRoutes      from './routes/auth.js';
import daysRoutes      from './routes/days.js';
import blocksRoutes    from './routes/blocks.js';
import evidencesRoutes from './routes/evidences.js';
import projectsRoutes  from './routes/projects.js';
import habitsRoutes    from './routes/habits.js';
import statsRoutes     from './routes/stats.js';
import uploadsRoutes   from './routes/uploads.js';
import configRoutes    from './routes/config.js';

const app       = express();
const PORT      = process.env.PORT       || 3001;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

mkdirSync(UPLOAD_DIR, { recursive: true });

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) cb(null, true);
    else cb(new Error('CORS bloqueado'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

app.use('/api/auth',      authRoutes);
app.use('/api/days',      daysRoutes);
app.use('/api/blocks',    blocksRoutes);
app.use('/api/evidences', evidencesRoutes);
app.use('/api/projects',  projectsRoutes);
app.use('/api/habits',    habitsRoutes);
app.use('/api/stats',     statsRoutes);
app.use('/api/uploads',   uploadsRoutes);
app.use('/api/config',    configRoutes);

app.listen(PORT, () => console.log(`Backend running on :${PORT}`));
