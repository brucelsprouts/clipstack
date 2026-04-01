/// Database layer for ClipStack.
///
/// All persistence happens here via rusqlite with a bundled SQLite.
/// The connection is held in Tauri's managed state behind a Mutex so it
/// is safe to call from any Tauri command (which may run on multiple threads).
use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::path::Path;

// ─── Data types ──────────────────────────────────────────────────────────────

/// The kind of content a clip holds.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ClipKind {
    Text,
    Image,
    Html,
}

impl ClipKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ClipKind::Text => "text",
            ClipKind::Image => "image",
            ClipKind::Html => "html",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "image" => ClipKind::Image,
            "html" => ClipKind::Html,
            _ => ClipKind::Text,
        }
    }
}

/// A single clipboard entry returned to the frontend.
/// camelCase serialization so `created_at` becomes `createdAt` in JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: i64,
    pub kind: ClipKind,
    /// Plain text content OR base64-encoded PNG for images.
    pub content: String,
    /// Unix timestamp in milliseconds.
    pub created_at: i64,
    pub pinned: bool,
    /// Short human-readable label used for search and display.
    pub preview: String,
}

// ─── DB wrapper ──────────────────────────────────────────────────────────────

pub struct Database {
    conn: Connection,
}

impl Database {
    /// Open (or create) the SQLite database at the given path and run migrations.
    pub fn open(path: &Path) -> SqlResult<Self> {
        let conn = Connection::open(path)?;

        // Performance tuning: WAL mode for better concurrent reads, memory-mapped I/O.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        let db = Self { conn };
        db.run_migrations()?;
        Ok(db)
    }

    // ── Migrations ────────────────────────────────────────────────────────────

    fn run_migrations(&self) -> SqlResult<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS clips (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                kind       TEXT    NOT NULL DEFAULT 'text',
                content    TEXT    NOT NULL,
                preview    TEXT    NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                pinned     INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_clips_created_at ON clips (created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_clips_pinned     ON clips (pinned DESC, created_at DESC);
            ",
        )?;

        // Idempotent migration: add sort_order column used for drag-to-reorder.
        // ALTER TABLE fails gracefully if the column already exists.
        let _ = self.conn.execute_batch(
            "ALTER TABLE clips ADD COLUMN sort_order REAL DEFAULT 0.0;",
        );
        // Seed sort_order from created_at so default ordering is preserved.
        let _ = self.conn.execute_batch(
            "UPDATE clips SET sort_order = CAST(created_at AS REAL) WHERE sort_order IS NULL OR sort_order = 0.0;",
        );

        Ok(())
    }

    // ── Insert ────────────────────────────────────────────────────────────────

    /// Insert a new clip. Returns the row id.
    pub fn insert_clip(&self, kind: &ClipKind, content: &str, preview: &str) -> SqlResult<i64> {
        let now = chrono::Utc::now().timestamp_millis();
        let sort_order = now as f64;
        self.conn.execute(
            "INSERT INTO clips (kind, content, preview, created_at, pinned, sort_order)
             VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            params![kind.as_str(), content, preview, now, sort_order],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    // ── Query ─────────────────────────────────────────────────────────────────

    /// Load clips ordered by pinned-first, then newest-first.
    /// Applies the optional search query against the preview text.
    pub fn get_clips(&self, search: Option<&str>, limit: u32) -> SqlResult<Vec<Clip>> {
        let rows: Vec<Clip> = if let Some(q) = search.filter(|s| !s.trim().is_empty()) {
            let pattern = format!("%{}%", q.replace('%', "\\%").replace('_', "\\_"));
            let mut stmt = self.conn.prepare(
                "SELECT id, kind, content, created_at, pinned, preview
                 FROM clips
                 WHERE preview LIKE ?1 ESCAPE '\\'
                 ORDER BY pinned DESC, sort_order DESC
                 LIMIT ?2",
            )?;
            let result: Vec<Clip> = stmt
                .query_map(params![pattern, limit], map_clip_row)?
                .filter_map(|r| r.ok())
                .collect();
            result
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT id, kind, content, created_at, pinned, preview
                 FROM clips
                 ORDER BY pinned DESC, sort_order DESC
                 LIMIT ?1",
            )?;
            let result: Vec<Clip> = stmt
                .query_map(params![limit], map_clip_row)?
                .filter_map(|r| r.ok())
                .collect();
            result
        };
        Ok(rows)
    }

    /// Check whether the most-recently inserted clip has the same content.
    /// Used to avoid storing duplicate consecutive copies.
    pub fn last_clip_content(&self) -> SqlResult<Option<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT content FROM clips ORDER BY created_at DESC LIMIT 1",
        )?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    // ── Mutate ────────────────────────────────────────────────────────────────

    pub fn toggle_pin(&self, id: i64) -> SqlResult<()> {
        self.conn.execute(
            "UPDATE clips SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn delete_clip(&self, id: i64) -> SqlResult<()> {
        self.conn
            .execute("DELETE FROM clips WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Reorder a group of clips by assigning new sort_order values.
    /// `ordered_ids` is the desired order (first = top of list, highest sort_order).
    /// Uses fractional indexing within the group's current sort_order range so
    /// clips outside the group are unaffected.
    pub fn reorder_clips(&self, ordered_ids: &[i64]) -> SqlResult<()> {
        if ordered_ids.is_empty() {
            return Ok(());
        }
        // Find the current min/max sort_order in this group.
        let placeholders: String = ordered_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!(
            "SELECT COALESCE(MIN(sort_order), 0.0), COALESCE(MAX(sort_order), 1.0) FROM clips WHERE id IN ({})",
            placeholders
        );
        let (min_order, max_order): (f64, f64) = {
            let mut stmt = self.conn.prepare(&query)?;
            stmt.query_row(rusqlite::params_from_iter(ordered_ids), |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?
        };
        // If all values are identical, spread them 1.0 apart.
        let range = if (max_order - min_order).abs() < 1.0 { ordered_ids.len() as f64 } else { max_order - min_order };
        let step = range / ordered_ids.len() as f64;
        for (i, &id) in ordered_ids.iter().enumerate() {
            let order = max_order - (i as f64 * step);
            self.conn.execute(
                "UPDATE clips SET sort_order = ?1 WHERE id = ?2",
                params![order, id],
            )?;
        }
        Ok(())
    }

    pub fn delete_all_clips(&self) -> SqlResult<()> {
        self.conn.execute_batch("DELETE FROM clips;")?;
        Ok(())
    }

    /// Prune oldest non-pinned clips beyond `max` total entries.
    /// A `max` of 0 means unlimited — pruning is skipped.
    pub fn prune_to_limit(&self, max: u32) -> SqlResult<()> {
        if max == 0 {
            return Ok(());
        }
        self.conn.execute(
            "DELETE FROM clips
             WHERE pinned = 0
               AND id NOT IN (
                   SELECT id FROM clips
                   WHERE pinned = 0
                   ORDER BY created_at DESC
                   LIMIT ?1
               )",
            params![max],
        )?;
        Ok(())
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    /// Upsert a settings key/value pair.
    pub fn set_setting(&self, key: &str, value: &str) -> SqlResult<()> {
        self.conn.execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
        ))?;
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> SqlResult<Option<String>> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

fn map_clip_row(row: &rusqlite::Row<'_>) -> SqlResult<Clip> {
    let id: i64 = row.get(0)?;
    let kind_str: String = row.get(1)?;
    let content: String = row.get(2)?;
    let created_at: i64 = row.get(3)?;
    let pinned: bool = row.get::<_, i64>(4)? != 0;
    let preview: String = row.get(5)?;
    Ok(Clip {
        id,
        kind: ClipKind::from_str(&kind_str),
        content,
        created_at,
        pinned,
        preview,
    })
}
