package settings

import (
	"database/sql"
	"fmt"
	"time"
)

// Repository handles global settings persistence
type Repository struct {
	db *sql.DB
}

// NewRepository creates a new settings repository
func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

// Get retrieves a setting value by key
func (r *Repository) Get(key string) (string, error) {
	var value string
	err := r.db.QueryRow("SELECT value FROM global_settings WHERE key = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil // Key not found, return empty string
	}
	if err != nil {
		return "", fmt.Errorf("failed to get setting %s: %w", key, err)
	}
	return value, nil
}

// Set stores a setting value
func (r *Repository) Set(key, value string) error {
	now := time.Now().Unix()
	_, err := r.db.Exec(`
		INSERT INTO global_settings (key, value, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at
	`, key, value, now)
	
	if err != nil {
		return fmt.Errorf("failed to set setting %s: %w", key, err)
	}
	return nil
}

// GetAll retrieves all settings as a map
func (r *Repository) GetAll() (map[string]string, error) {
	rows, err := r.db.Query("SELECT key, value FROM global_settings")
	if err != nil {
		return nil, fmt.Errorf("failed to get all settings: %w", err)
	}
	defer rows.Close()

	settings := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("failed to scan setting: %w", err)
		}
		settings[key] = value
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating settings: %w", err)
	}

	return settings, nil
}

// SetBatch stores multiple settings in a transaction
func (r *Repository) SetBatch(settings map[string]string) error {
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	now := time.Now().Unix()
	stmt, err := tx.Prepare(`
		INSERT INTO global_settings (key, value, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for key, value := range settings {
		if _, err := stmt.Exec(key, value, now); err != nil {
			return fmt.Errorf("failed to set setting %s: %w", key, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// Delete removes a setting
func (r *Repository) Delete(key string) error {
	_, err := r.db.Exec("DELETE FROM global_settings WHERE key = ?", key)
	if err != nil {
		return fmt.Errorf("failed to delete setting %s: %w", key, err)
	}
	return nil
}

// Clear removes all settings
func (r *Repository) Clear() error {
	_, err := r.db.Exec("DELETE FROM global_settings")
	if err != nil {
		return fmt.Errorf("failed to clear settings: %w", err)
	}
	return nil
}
