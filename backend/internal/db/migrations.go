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
	{
		Version: 4,
		Name:    "create_profile_mods_cache",
		SQL: `
			CREATE TABLE IF NOT EXISTS profile_mods (
				id TEXT PRIMARY KEY,
				profile_id TEXT NOT NULL,
				file_name TEXT NOT NULL,
				file_path TEXT NOT NULL,
				file_hash TEXT,
				file_size INTEGER,
				mod_id TEXT,
				name TEXT,
				version TEXT,
				description TEXT,
				authors TEXT,
				enabled INTEGER DEFAULT 1,
				source TEXT,
				last_modified INTEGER,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
			);
			
			CREATE INDEX IF NOT EXISTS idx_profile_mods_profile ON profile_mods(profile_id);
			CREATE INDEX IF NOT EXISTS idx_profile_mods_hash ON profile_mods(file_hash);
			CREATE INDEX IF NOT EXISTS idx_profile_mods_mod_id ON profile_mods(mod_id);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_mods_unique ON profile_mods(profile_id, file_name);
		`,
	},
	{
		Version: 5,
		Name:    "create_profile_resourcepacks_cache",
		SQL: `
			CREATE TABLE IF NOT EXISTS profile_resourcepacks (
				id TEXT PRIMARY KEY,
				profile_id TEXT NOT NULL,
				file_name TEXT NOT NULL,
				file_path TEXT NOT NULL,
				file_hash TEXT,
				file_size INTEGER,
				is_directory INTEGER DEFAULT 0,
				pack_format INTEGER,
				description TEXT,
				enabled INTEGER DEFAULT 0,
				last_modified INTEGER,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
			);
			
			CREATE INDEX IF NOT EXISTS idx_profile_resourcepacks_profile ON profile_resourcepacks(profile_id);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_resourcepacks_unique ON profile_resourcepacks(profile_id, file_name);
		`,
	},
	{
		Version: 6,
		Name:    "create_profile_shaderpacks_cache",
		SQL: `
			CREATE TABLE IF NOT EXISTS profile_shaderpacks (
				id TEXT PRIMARY KEY,
				profile_id TEXT NOT NULL,
				file_name TEXT NOT NULL,
				file_path TEXT NOT NULL,
				file_hash TEXT,
				is_directory INTEGER DEFAULT 0,
				enabled INTEGER DEFAULT 0,
				last_modified INTEGER,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
			);
			
			CREATE INDEX IF NOT EXISTS idx_profile_shaderpacks_profile ON profile_shaderpacks(profile_id);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_shaderpacks_unique ON profile_shaderpacks(profile_id, file_name);
		`,
	},
	{
		Version: 7,
		Name:    "create_mod_updates_cache",
		SQL: `
			CREATE TABLE IF NOT EXISTS mod_updates (
				mod_id TEXT PRIMARY KEY,
				profile_id TEXT NOT NULL,
				current_version TEXT,
				latest_version TEXT,
				update_available INTEGER DEFAULT 0,
				changelog TEXT,
				checked_at INTEGER,
				FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
			);
			
			CREATE INDEX IF NOT EXISTS idx_mod_updates_profile ON mod_updates(profile_id);
			CREATE INDEX IF NOT EXISTS idx_mod_updates_available ON mod_updates(update_available, profile_id);
		`,
	},
	{
		Version: 8,
		Name:    "fix_profile_game_directories",
		SQL: `
			-- Fix existing profiles with incorrect game_directory
			-- Extract base path and reconstruct with profile ID
			-- This handles both forward and backslashes
			UPDATE profiles
			SET game_directory = 
				CASE 
					WHEN game_directory LIKE '%/data/instances/%' 
						THEN REPLACE(SUBSTR(game_directory, 1, INSTR(game_directory, '/data/')), '/data', '') || 'instances/' || id
					WHEN game_directory LIKE '%\data\instances\%' 
						THEN REPLACE(SUBSTR(game_directory, 1, INSTR(game_directory, '\data\')), '\data', '') || 'instances\' || id
					ELSE game_directory
				END
			WHERE game_directory LIKE '%/data/instances/%' OR game_directory LIKE '%\data\instances\%';
		`,
	},
	{
		Version: 9,
		Name:    "clean_invalid_mod_cache",
		SQL: `
			-- Remove non-.jar files from mod cache (these were cached incorrectly)
			DELETE FROM profile_mods
			WHERE file_name NOT LIKE '%.jar' AND file_name NOT LIKE '%.jar.disabled';
		`,
	},
	{
		Version: 10,
		Name:    "create_api_cache",
		SQL: `
			CREATE TABLE IF NOT EXISTS api_cache (
				cache_key TEXT PRIMARY KEY,
				cache_type TEXT NOT NULL,
				response_data TEXT NOT NULL,
				cached_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL
			);
			
			CREATE INDEX IF NOT EXISTS idx_api_cache_type ON api_cache(cache_type);
			CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at);
		`,
	},
	{
		Version: 11,
		Name:    "create_loader_versions_cache",
		SQL: `
			CREATE TABLE IF NOT EXISTS loader_versions (
				loader_type TEXT NOT NULL,
				version TEXT NOT NULL,
				stable INTEGER DEFAULT 0,
				build_number INTEGER,
				maven_coords TEXT,
				cached_at INTEGER NOT NULL,
				PRIMARY KEY (loader_type, version)
			);
			
			CREATE INDEX IF NOT EXISTS idx_loader_versions_type ON loader_versions(loader_type, stable DESC);
			CREATE INDEX IF NOT EXISTS idx_loader_versions_cached ON loader_versions(cached_at);
		`,
	},
	{
		Version: 12,
		Name:    "create_java_installations_cache",
		SQL: `
			CREATE TABLE IF NOT EXISTS java_installations (
				id TEXT PRIMARY KEY,
				path TEXT NOT NULL UNIQUE,
				version TEXT NOT NULL,
				vendor TEXT,
				architecture TEXT,
				is_valid INTEGER DEFAULT 1,
				detected_at INTEGER NOT NULL
			);
			
			CREATE INDEX IF NOT EXISTS idx_java_installations_version ON java_installations(version);
			CREATE INDEX IF NOT EXISTS idx_java_installations_detected ON java_installations(detected_at DESC);
		`,
	},
	{
		Version: 13,
		Name:    "create_profile_stats",
		SQL: `
			CREATE TABLE IF NOT EXISTS profile_stats (
				profile_id TEXT PRIMARY KEY,
				last_launched_at INTEGER,
				total_play_time INTEGER DEFAULT 0,
				launch_count INTEGER DEFAULT 0,
				crash_count INTEGER DEFAULT 0,
				last_crash_at INTEGER,
				FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
			);
			
			CREATE INDEX IF NOT EXISTS idx_profile_stats_last_launched ON profile_stats(last_launched_at DESC);
			CREATE INDEX IF NOT EXISTS idx_profile_stats_play_time ON profile_stats(total_play_time DESC);
		`,
	},
	{
		Version: 14,
		Name:    "add_mod_source_metadata",
		SQL: `
			-- Add source metadata columns for multi-source support
			ALTER TABLE profile_mods ADD COLUMN source_mod_id TEXT;
			ALTER TABLE profile_mods ADD COLUMN source_file_id TEXT;
			
			-- Create index for source lookups (useful for update checks)
			CREATE INDEX IF NOT EXISTS idx_profile_mods_source ON profile_mods(source, source_mod_id);
		`,
	},
	{
		Version: 15,
		Name:    "add_favorite_and_server_address",
		SQL: `
			-- Add favorite and server_address columns to profiles
			ALTER TABLE profiles ADD COLUMN favorite INTEGER DEFAULT 0;
			ALTER TABLE profiles ADD COLUMN server_address TEXT;
			
			-- Create indexes for efficient sorting and filtering
			CREATE INDEX IF NOT EXISTS idx_profiles_favorite ON profiles(favorite);
			CREATE INDEX IF NOT EXISTS idx_profiles_server_address ON profiles(server_address);
		`,
	},
	{
		Version: 16,
		Name:    "create_accounts",
		SQL: `
			CREATE TABLE IF NOT EXISTS accounts (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				uuid TEXT NOT NULL,
				type TEXT NOT NULL CHECK(type IN ('microsoft', 'offline')),
				encrypted_data TEXT,
				iv TEXT,
				auth_tag TEXT,
				skin_url TEXT,
				last_used INTEGER NOT NULL,
				device_id TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			
			CREATE INDEX IF NOT EXISTS idx_accounts_last_used ON accounts(last_used DESC);
			CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type);
			CREATE INDEX IF NOT EXISTS idx_accounts_device_id ON accounts(device_id);
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
