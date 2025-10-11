package db

import (
	"database/sql"
	"fmt"
	"log"
)

// Migration represents a database migration
type Migration struct {
	Version int
	Name    string
	SQL     string
}

var migrations = []Migration{
	{
		Version: 1,
		Name:    "create_schema_version",
		SQL: `
			CREATE TABLE IF NOT EXISTS schema_version (
				version INTEGER PRIMARY KEY,
				applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);
		`,
	},
	{
		Version: 2,
		Name:    "create_global_settings",
		SQL: `
			CREATE TABLE IF NOT EXISTS global_settings (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				updated_at INTEGER NOT NULL
			);
			
			-- Create indexes
			CREATE INDEX IF NOT EXISTS idx_global_settings_updated_at 
			ON global_settings(updated_at DESC);
		`,
	},
	{
		Version: 3,
		Name:    "create_profiles",
		SQL: `
			CREATE TABLE IF NOT EXISTS profiles (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				description TEXT,
				icon TEXT,
				game_version TEXT NOT NULL,
				loader_type TEXT NOT NULL,
				loader_version TEXT,
				game_directory TEXT NOT NULL,
				
				-- Settings (NULL = inherit from global)
				java_path TEXT,
				memory_min INTEGER,
				memory_max INTEGER,
				resolution_width INTEGER,
				resolution_height INTEGER,
				fullscreen INTEGER,
				
				-- Profile-specific
				jvm_args TEXT,
				game_args TEXT,
				
				-- Modpack info
				modpack_id TEXT,
				modpack_source TEXT,
				
				-- Metadata
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				last_played INTEGER,
				total_play_time INTEGER DEFAULT 0
			);
			
			-- Create indexes
			CREATE INDEX IF NOT EXISTS idx_profiles_game_version ON profiles(game_version);
			CREATE INDEX IF NOT EXISTS idx_profiles_last_played ON profiles(last_played DESC);
			CREATE INDEX IF NOT EXISTS idx_profiles_updated_at ON profiles(updated_at DESC);
		`,
	},
}

func runMigrations(db *sql.DB) error {
	log.Println("[DB] Running migrations...")

	// Get current schema version
	currentVersion := getCurrentVersion(db)
	log.Printf("[DB] Current schema version: %d", currentVersion)

	// Apply pending migrations
	for _, migration := range migrations {
		if migration.Version <= currentVersion {
			continue
		}

		log.Printf("[DB] Applying migration %d: %s", migration.Version, migration.Name)

		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("failed to begin transaction: %w", err)
		}

		// Execute migration SQL
		if _, err := tx.Exec(migration.SQL); err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to execute migration %d: %w", migration.Version, err)
		}

		// Update schema version
		if _, err := tx.Exec("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", migration.Version); err != nil {
			tx.Rollback()
			return fmt.Errorf("failed to update schema version: %w", err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("failed to commit migration: %w", err)
		}

		log.Printf("[DB] Migration %d applied successfully", migration.Version)
	}

	log.Printf("[DB] Migrations complete. Current version: %d", len(migrations))
	return nil
}

func getCurrentVersion(db *sql.DB) int {
	var version int
	err := db.QueryRow("SELECT COALESCE(MAX(version), 0) FROM schema_version").Scan(&version)
	if err != nil {
		// Table might not exist yet
		return 0
	}
	return version
}
