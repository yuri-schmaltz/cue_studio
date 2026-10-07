-- Migração 2 (A18). Adiciona tabelas do Director.

CREATE TABLE IF NOT EXISTS briefings (
  project_id TEXT PRIMARY KEY,
  intent TEXT,
  audience TEXT,
  duration_sec INTEGER,
  references_json TEXT,
  updated_at REAL NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS director_state (
  project_id TEXT PRIMARY KEY,
  current_step TEXT NOT NULL CHECK(current_step IN ('briefing','scenes','options','review')),
  skill TEXT,
  format TEXT CHECK(format IN ('mp4','webm','mov')),
  workflow TEXT CHECK(workflow IN ('basic','expert')),
  updated_at REAL NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_briefings_project ON briefings(project_id);