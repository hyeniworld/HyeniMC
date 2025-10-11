package cache

import (
	"database/sql"
	"fmt"
	"time"

	"hyenimc/backend/internal/domain"
)

// ShaderPackRepository handles shader pack cache persistence
type ShaderPackRepository struct {
	db *sql.DB
}

// NewShaderPackRepository creates a new shader pack repository
func NewShaderPackRepository(db *sql.DB) *ShaderPackRepository {
	return &ShaderPackRepository{db: db}
}

// Save inserts or updates a shader pack in the cache
func (r *ShaderPackRepository) Save(pack *domain.ShaderPack) error {
	_, err := r.db.Exec(`
		INSERT OR REPLACE INTO profile_shaderpacks (
			id, profile_id, file_name, file_path, file_hash,
			is_directory, enabled, last_modified, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		pack.ID, pack.ProfileID, pack.FileName, pack.FilePath, pack.FileHash,
		boolToInt(pack.IsDirectory), boolToInt(pack.Enabled),
		pack.LastModified.Unix(), pack.CreatedAt.Unix(), pack.UpdatedAt.Unix(),
	)
	
	return err
}

// Get retrieves a shader pack by ID
func (r *ShaderPackRepository) Get(id string) (*domain.ShaderPack, error) {
	var pack domain.ShaderPack
	var isDirectory, enabled int
	var lastModified, createdAt, updatedAt int64
	
	err := r.db.QueryRow(`
		SELECT id, profile_id, file_name, file_path, file_hash,
			is_directory, enabled, last_modified, created_at, updated_at
		FROM profile_shaderpacks WHERE id = ?
	`, id).Scan(
		&pack.ID, &pack.ProfileID, &pack.FileName, &pack.FilePath, &pack.FileHash,
		&isDirectory, &enabled, &lastModified, &createdAt, &updatedAt,
	)
	
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("shader pack not found: %s", id)
	}
	if err != nil {
		return nil, err
	}
	
	pack.IsDirectory = isDirectory > 0
	pack.Enabled = enabled > 0
	pack.LastModified = time.Unix(lastModified, 0)
	pack.CreatedAt = time.Unix(createdAt, 0)
	pack.UpdatedAt = time.Unix(updatedAt, 0)
	
	return &pack, nil
}

// ListByProfile retrieves all shader packs for a profile
func (r *ShaderPackRepository) ListByProfile(profileID string) ([]*domain.ShaderPack, error) {
	rows, err := r.db.Query(`
		SELECT id, profile_id, file_name, file_path, file_hash,
			is_directory, enabled, last_modified, created_at, updated_at
		FROM profile_shaderpacks WHERE profile_id = ?
		ORDER BY file_name ASC
	`, profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var packs []*domain.ShaderPack
	for rows.Next() {
		var pack domain.ShaderPack
		var isDirectory, enabled int
		var lastModified, createdAt, updatedAt int64
		
		err := rows.Scan(
			&pack.ID, &pack.ProfileID, &pack.FileName, &pack.FilePath, &pack.FileHash,
			&isDirectory, &enabled, &lastModified, &createdAt, &updatedAt,
		)
		if err != nil {
			return nil, err
		}
		
		pack.IsDirectory = isDirectory > 0
		pack.Enabled = enabled > 0
		pack.LastModified = time.Unix(lastModified, 0)
		pack.CreatedAt = time.Unix(createdAt, 0)
		pack.UpdatedAt = time.Unix(updatedAt, 0)
		
		packs = append(packs, &pack)
	}
	
	return packs, nil
}

// Delete removes a shader pack from the cache
func (r *ShaderPackRepository) Delete(id string) error {
	_, err := r.db.Exec("DELETE FROM profile_shaderpacks WHERE id = ?", id)
	return err
}

// DeleteByProfile removes all shader packs for a profile
func (r *ShaderPackRepository) DeleteByProfile(profileID string) error {
	_, err := r.db.Exec("DELETE FROM profile_shaderpacks WHERE profile_id = ?", profileID)
	return err
}

// UpdateEnabled toggles a shader pack's enabled status
func (r *ShaderPackRepository) UpdateEnabled(id string, enabled bool) error {
	_, err := r.db.Exec(`
		UPDATE profile_shaderpacks SET enabled = ?, updated_at = ? WHERE id = ?
	`, boolToInt(enabled), time.Now().Unix(), id)
	return err
}

// GetByFileName retrieves a shader pack by profile ID and file name
func (r *ShaderPackRepository) GetByFileName(profileID, fileName string) (*domain.ShaderPack, error) {
	var pack domain.ShaderPack
	var isDirectory, enabled int
	var lastModified, createdAt, updatedAt int64
	
	err := r.db.QueryRow(`
		SELECT id, profile_id, file_name, file_path, file_hash,
			is_directory, enabled, last_modified, created_at, updated_at
		FROM profile_shaderpacks WHERE profile_id = ? AND file_name = ?
	`, profileID, fileName).Scan(
		&pack.ID, &pack.ProfileID, &pack.FileName, &pack.FilePath, &pack.FileHash,
		&isDirectory, &enabled, &lastModified, &createdAt, &updatedAt,
	)
	
	if err == sql.ErrNoRows {
		return nil, nil // Not an error, just not found
	}
	if err != nil {
		return nil, err
	}
	
	pack.IsDirectory = isDirectory > 0
	pack.Enabled = enabled > 0
	pack.LastModified = time.Unix(lastModified, 0)
	pack.CreatedAt = time.Unix(createdAt, 0)
	pack.UpdatedAt = time.Unix(updatedAt, 0)
	
	return &pack, nil
}
