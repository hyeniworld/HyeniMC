package cache

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"hyenimc/backend/internal/domain"
)

// ModRepository handles mod cache persistence
type ModRepository struct {
	db *sql.DB
}

// NewModRepository creates a new mod repository
func NewModRepository(db *sql.DB) *ModRepository {
	return &ModRepository{db: db}
}

// Save inserts or updates a mod in the cache
func (r *ModRepository) Save(mod *domain.Mod) error {
	authors, _ := json.Marshal(mod.Authors)
	
	_, err := r.db.Exec(`
		INSERT OR REPLACE INTO profile_mods (
			id, profile_id, file_name, file_path, file_hash, file_size,
			mod_id, name, version, description, authors, enabled, source,
			last_modified, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		mod.ID, mod.ProfileID, mod.FileName, mod.FilePath, mod.FileHash, mod.FileSize,
		mod.ModID, mod.Name, mod.Version, mod.Description, string(authors),
		boolToInt(mod.Enabled), mod.Source,
		mod.LastModified.Unix(), mod.CreatedAt.Unix(), mod.UpdatedAt.Unix(),
	)
	
	if err != nil {
		return fmt.Errorf("failed to save profile: %w", err)
	}
	return nil
}

// BatchSave inserts or updates multiple mods in a single transaction
func (r *ModRepository) BatchSave(mods []*domain.Mod) error {
	if len(mods) == 0 {
		return nil
	}

	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT OR REPLACE INTO profile_mods (
			id, profile_id, file_name, file_path, file_hash, file_size,
			mod_id, name, version, description, authors, enabled, source,
			last_modified, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, mod := range mods {
		authors, _ := json.Marshal(mod.Authors)
		_, err := stmt.Exec(
			mod.ID, mod.ProfileID, mod.FileName, mod.FilePath, mod.FileHash, mod.FileSize,
			mod.ModID, mod.Name, mod.Version, mod.Description, string(authors),
			boolToInt(mod.Enabled), mod.Source,
			mod.LastModified.Unix(), mod.CreatedAt.Unix(), mod.UpdatedAt.Unix(),
		)
		if err != nil {
			return fmt.Errorf("failed to save mod %s: %w", mod.FileName, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// Get retrieves a mod by ID
func (r *ModRepository) Get(id string) (*domain.Mod, error) {
	var mod domain.Mod
	var authors string
	var enabled int
	var lastModified, createdAt, updatedAt int64
	
	err := r.db.QueryRow(`
		SELECT id, profile_id, file_name, file_path, file_hash, file_size,
			mod_id, name, version, description, authors, enabled, source,
			last_modified, created_at, updated_at
		FROM profile_mods WHERE id = ?
	`, id).Scan(
		&mod.ID, &mod.ProfileID, &mod.FileName, &mod.FilePath, &mod.FileHash, &mod.FileSize,
		&mod.ModID, &mod.Name, &mod.Version, &mod.Description, &authors, &enabled, &mod.Source,
		&lastModified, &createdAt, &updatedAt,
	)
	
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("mod not found: %s", id)
	}
	if err != nil {
		return nil, err
	}
	
	json.Unmarshal([]byte(authors), &mod.Authors)
	mod.Enabled = enabled > 0
	mod.LastModified = time.Unix(lastModified, 0)
	mod.CreatedAt = time.Unix(createdAt, 0)
	mod.UpdatedAt = time.Unix(updatedAt, 0)
	
	return &mod, nil
}

// ListByProfile retrieves all mods for a profile
func (r *ModRepository) ListByProfile(profileID string) ([]*domain.Mod, error) {
	rows, err := r.db.Query(`
		SELECT id, profile_id, file_name, file_path, file_hash, file_size,
			mod_id, name, version, description, authors, enabled, source,
			last_modified, created_at, updated_at
		FROM profile_mods WHERE profile_id = ?
		ORDER BY file_name ASC
	`, profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var mods []*domain.Mod
	for rows.Next() {
		var mod domain.Mod
		var authors string
		var enabled int
		var lastModified, createdAt, updatedAt int64
		
		err := rows.Scan(
			&mod.ID, &mod.ProfileID, &mod.FileName, &mod.FilePath, &mod.FileHash, &mod.FileSize,
			&mod.ModID, &mod.Name, &mod.Version, &mod.Description, &authors, &enabled, &mod.Source,
			&lastModified, &createdAt, &updatedAt,
		)
		if err != nil {
			return nil, err
		}
		
		json.Unmarshal([]byte(authors), &mod.Authors)
		mod.Enabled = enabled > 0
		mod.LastModified = time.Unix(lastModified, 0)
		mod.CreatedAt = time.Unix(createdAt, 0)
		mod.UpdatedAt = time.Unix(updatedAt, 0)
		
		mods = append(mods, &mod)
	}
	
	return mods, nil
}

// Delete removes a mod from the cache
func (r *ModRepository) Delete(id string) error {
	_, err := r.db.Exec("DELETE FROM profile_mods WHERE id = ?", id)
	return err
}

// DeleteByProfile removes all mods for a profile
func (r *ModRepository) DeleteByProfile(profileID string) error {
	_, err := r.db.Exec("DELETE FROM profile_mods WHERE profile_id = ?", profileID)
	return err
}

// UpdateEnabled toggles a mod's enabled status
func (r *ModRepository) UpdateEnabled(id string, enabled bool) error {
	_, err := r.db.Exec(`
		UPDATE profile_mods SET enabled = ?, updated_at = ? WHERE id = ?
	`, boolToInt(enabled), time.Now().Unix(), id)
	return err
}

// GetByFileName retrieves a mod by profile ID and file name
func (r *ModRepository) GetByFileName(profileID, fileName string) (*domain.Mod, error) {
	var mod domain.Mod
	var authors string
	var enabled int
	var lastModified, createdAt, updatedAt int64
	
	err := r.db.QueryRow(`
		SELECT id, profile_id, file_name, file_path, file_hash, file_size,
			mod_id, name, version, description, authors, enabled, source,
			last_modified, created_at, updated_at
		FROM profile_mods WHERE profile_id = ? AND file_name = ?
	`, profileID, fileName).Scan(
		&mod.ID, &mod.ProfileID, &mod.FileName, &mod.FilePath, &mod.FileHash, &mod.FileSize,
		&mod.ModID, &mod.Name, &mod.Version, &mod.Description, &authors, &enabled, &mod.Source,
		&lastModified, &createdAt, &updatedAt,
	)
	
	if err == sql.ErrNoRows {
		return nil, nil // Not an error, just not found
	}
	if err != nil {
		return nil, err
	}
	
	json.Unmarshal([]byte(authors), &mod.Authors)
	mod.Enabled = enabled > 0
	mod.LastModified = time.Unix(lastModified, 0)
	mod.CreatedAt = time.Unix(createdAt, 0)
	mod.UpdatedAt = time.Unix(updatedAt, 0)
	
	return &mod, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
