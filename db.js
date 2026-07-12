import pg from 'pg';
import 'dotenv/config';

const { Pool, types } = pg;

// Return DATE columns as plain strings (YYYY-MM-DD), not JS Date objects
types.setTypeParser(1082, (val) => val);

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    })
  : new Pool({
      host:     process.env.DB_HOST     || 'localhost',
      port:     Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME     || 'productivity',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });

export default pool;
