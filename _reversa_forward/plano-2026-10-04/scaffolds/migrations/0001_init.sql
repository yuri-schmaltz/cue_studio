-- Migração inicial (A18). Cria tabelas fundamentais.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('music-video','short-film','custom')),
  preset_id TEXT,
  updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  index_num INTEGER NOT NULL,
  duration_sec REAL NOT NULL,
  takes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('pending','running','review','done','failed')),
  prompt TEXT NOT NULL,
  thumb TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS queue (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  label TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','preparing','running','awaiting_review','done','failed','cancelled')),
  progress REAL NOT NULL DEFAULT 0,
  expected_sec INTEGER,
  position INTEGER,
  updated_at REAL NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS editor_projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id);
CREATE INDEX IF NOT EXISTS idx_queue_project ON queue(project_id);
CREATE INDEX IF NOT EXISTS idx_queue_state ON queue(state);