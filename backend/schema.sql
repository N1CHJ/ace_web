CREATE TABLE IF NOT EXISTS Users (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS Sessions (id TEXT PRIMARY KEY, user_id INTEGER, exercise TEXT, score INTEGER, advice TEXT, video_url TEXT, overlay_url TEXT, ideal_url TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS Reps (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, rep_number INTEGER, score INTEGER, issues TEXT, FOREIGN KEY(session_id) REFERENCES Sessions(id));
INSERT OR IGNORE INTO Users (id, name) VALUES (1, 'Admin Athlete');
