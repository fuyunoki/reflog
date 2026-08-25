-- REFLOG の記録を保存する。
--
-- 進捗は 1 行 1 プレイヤーの JSON として持つ。
-- 中身（PlayerProgress）の形はドメイン側が決めるので、
-- サーバはそれを解釈せず、そのまま預かるだけにしてある。
-- これにより、ゲームの仕様が変わってもマイグレーションが要らない。

CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,  -- 'github:<numeric id>'
  username    TEXT NOT NULL,
  avatar_url  TEXT,
  created_at  TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  player_id  TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,      -- PlayerProgress の JSON
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
