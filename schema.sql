-- Schema for productivity-backend
-- Generated from introspection of the production database (2026-07-12)

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE areas (
  id VARCHAR(20) PRIMARY KEY,
  label VARCHAR(100) NOT NULL,
  min_minutes INT DEFAULT 0,
  color VARCHAR(20)
);

CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  area_id VARCHAR(20) REFERENCES areas(id),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) DEFAULT 'percent',
  progress INT DEFAULT 0,
  done BOOLEAN DEFAULT false,
  deadline DATE,
  milestone_percent INT,
  milestone_date DATE,
  priority VARCHAR(10),
  archived BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_projects_user_area ON projects USING btree (user_id, area_id);

CREATE TABLE habits (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  area_id VARCHAR(20) REFERENCES areas(id),
  name VARCHAR(255) NOT NULL,
  frequency VARCHAR(20) DEFAULT 'daily',
  target_minutes INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  streak INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE days (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  date_key DATE NOT NULL,
  phase VARCHAR(30) DEFAULT 'init',
  entered_on_time BOOLEAN,
  used_ups BOOLEAN DEFAULT false,
  is_special_day BOOLEAN DEFAULT false,
  used_replan BOOLEAN DEFAULT false,
  daily_phrase TEXT,
  ritual_complete BOOLEAN DEFAULT false,
  ritual_photo_path TEXT,
  all_evidences_complete BOOLEAN DEFAULT false,
  close_complete BOOLEAN DEFAULT false,
  close_time TIMESTAMPTZ,
  close_photo_path TEXT,
  emotional_state INT,
  status VARCHAR(20) DEFAULT 'in_progress',
  score INT DEFAULT 0,
  global_penalty INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  ritual_photo_data TEXT,
  close_photo_data TEXT,
  block_edits_count INT DEFAULT 0,
  close_summary TEXT,
  ritual_essay TEXT,
  UNIQUE (user_id, date_key)
);
CREATE INDEX idx_days_user_date ON days USING btree (user_id, date_key);

CREATE TABLE blocks (
  id SERIAL PRIMARY KEY,
  day_id INT REFERENCES days(id) ON DELETE CASCADE,
  local_id VARCHAR(20),
  area_id VARCHAR(20) REFERENCES areas(id),
  project_id INT REFERENCES projects(id) ON DELETE SET NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  start_minutes INT NOT NULL,
  end_minutes INT NOT NULL,
  sort_order INT DEFAULT 0,
  notes TEXT
);
CREATE INDEX idx_blocks_day ON blocks USING btree (day_id);

CREATE TABLE evidences (
  id SERIAL PRIMARY KEY,
  day_id INT REFERENCES days(id) ON DELETE CASCADE,
  block_id INT REFERENCES blocks(id) ON DELETE CASCADE,
  slot_index INT NOT NULL,
  q1 TEXT,
  q2 TEXT,
  q3 TEXT,
  focus_level INT,
  no_hice BOOLEAN DEFAULT false,
  reason TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  photo_data TEXT,
  UNIQUE (block_id, slot_index)
);
CREATE INDEX idx_evidences_day_block ON evidences USING btree (day_id, block_id);

CREATE TABLE habit_logs (
  id SERIAL PRIMARY KEY,
  habit_id INT REFERENCES habits(id) ON DELETE CASCADE,
  date_key DATE NOT NULL,
  completed BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (habit_id, date_key)
);
CREATE INDEX idx_habit_logs_habit_date ON habit_logs USING btree (habit_id, date_key);

CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  date_key DATE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_notes_user_date ON notes USING btree (user_id, date_key);

CREATE TABLE penalties (
  id SERIAL PRIMARY KEY,
  day_id INT REFERENCES days(id) ON DELETE CASCADE,
  block_id INT REFERENCES blocks(id) ON DELETE SET NULL,
  slot_index INT,
  points INT NOT NULL,
  reason VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (day_id, block_id, slot_index)
);

CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date DATE,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_tasks_user ON tasks USING btree (user_id, completed);

CREATE TABLE user_config (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  ups_total INT DEFAULT 1,
  ups_used BOOLEAN DEFAULT false,
  special_days_total INT DEFAULT 4,
  special_days_used_count INT DEFAULT 0,
  replan_days_total INT DEFAULT 5,
  replan_days_used_count INT DEFAULT 0,
  config_month DATE DEFAULT date_trunc('month', CURRENT_DATE),
  updated_at TIMESTAMPTZ DEFAULT now(),
  areas_config JSONB
);

CREATE TABLE weekly_plans (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, week_start)
);

CREATE TABLE weekly_plan_blocks (
  id SERIAL PRIMARY KEY,
  plan_id INT REFERENCES weekly_plans(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL,
  area_id VARCHAR(20) REFERENCES areas(id),
  project_id INT REFERENCES projects(id) ON DELETE SET NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  start_minutes INT NOT NULL,
  end_minutes INT NOT NULL,
  notes TEXT,
  sort_order INT DEFAULT 0
);
