PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL CHECK(end_date >= start_date),
  priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 3),
  success_criteria TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL CHECK(estimated_minutes >= 0),
  source_review_id INTEGER REFERENCES reviews(id),
  improvement TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS plan_versions (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(plan_id, version)
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 3),
  tags TEXT NOT NULL DEFAULT '',
  estimated_minutes INTEGER NOT NULL CHECK(estimated_minutes >= 0),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS completion_records (
  task_id INTEGER PRIMARY KEY REFERENCES tasks(id),
  completed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS executions (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL CHECK(ended_at >= started_at),
  actual_minutes INTEGER NOT NULL CHECK(actual_minutes >= 0),
  blocked_reason TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL CHECK(to_date >= from_date),
  reflection TEXT NOT NULL,
  improvement TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_next_plan_per_review ON plans(source_review_id) WHERE source_review_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_by_plan ON tasks(plan_id, deleted_at, due_date, id);
CREATE INDEX IF NOT EXISTS executions_by_task ON executions(task_id, deleted_at);
