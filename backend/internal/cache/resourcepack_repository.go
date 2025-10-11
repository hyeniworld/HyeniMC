package cache

import (
	"database/sql"
	"fmt"
	"time"

	"hyenimc/backend/internal/domain"
)

// ResourcePackRepository handles resource pack cache persistence
type ResourcePackRepository struct {
	db *sql.DB
}

// NewResourcePackRepository creates a new resource pack repository
func NewResourcePackRepository(db *sql.DB) *ResourcePackRepository {
	return &ResourcePackRepository{db: db}
}

// Save inserts or updates a resource pack in the cache
func (r *ResourcePackRepository) Save(pack *domain.ResourcePack) error {
	_, err := r.db.Exec(`
		INSERT OR REPLACE INTO profile_resourcepacks (
			id, profile_id, file_name, file_path, file_hash, file_size,
			is_directory, pack_format, description, enabled,
			last_modified, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		pack.ID, pack.ProfileID, pack.FileName, pack.FilePath, pack.FileHash, pack.FileSize,
		boolToInt(pack.IsDirectory), pack.PackFormat, pack.Description, boolToInt(pack.Enabled),
		pack.LastModified.Unix(), pack.CreatedAt.Unix(), pack.UpdatedAt.Unix(),
	)
	
	return err
}

// Get retrieves a resource pack by ID
func (r *ResourcePackRepository) Get(id string) (*domain.ResourcePack, error) {
	var pack domain.ResourcePack
	var isDirectory, enabled int
	var lastModified, createdAt, updatedAt int64
	
	err := r.db.QueryRow(`
		SELECT id, profile_id, file_name, file_path, file_hash, file_size,
			is_directory, pack_format, description, enabled,
			last_modified, created_at, updated_at
		FROM profile_resourcepacks WHERE id = ?
	`, id).Scan(
		&pack.ID, &pack.ProfileID, &pack.FileName, &pack.FilePath, &pack.FileHash, &pack.FileSize,
		&isDirectory, &pack.PackFormat, &pack.Description, &enabled,
		&lastModified, &createdAt, &updatedAt,
	)
	
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("resource pack not found: %s", id)
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

// ListByProfile retrieves all resource packs for a profile
func (r *ResourcePackRepository) ListByProfile(profileID string) ([]*domain.ResourcePack, error) {
	rows, err := r.db.Query(`
		SELECT id, profile_id, file_name, file_path, file_hash, file_size,
			is_directory, pack_format, description, enabled,
			last_modified, created_at, updated_at
		FROM profile_resourcepacks WHERE profile_id = ?
		ORDER BY file_name ASC
	`, profileID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var packs []*domain.ResourcePack
	for rows.Next() {
		var pack domain.ResourcePack
		var isDirectory, enabled int
		var lastModified, createdAt, updatedAt int64
		
		err := rows.Scan(
			&pack.ID, &pack.ProfileID, &pack.FileName, &pack.FilePath, &pack.FileHash, &pack.FileSize,
			&isDirectory, &pack.PackFormat, &pack.Description, &enabled,
			&lastModified, &createdAt, &updatedAt,
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

// Delete removes a resource pack from the cache
func (r *ResourcePackRepository) Delete(id string) error {
	_, err := r.db.Exec("DELETE FROM profile_resourcepacks WHERE id = ?", id)
	return err
}

// DeleteByProfile removes all resource packs for a profile
func (r *ResourcePackRepository) DeleteByProfile(profileID string) error {
	_, err := r.db.Exec("DELETE FROM profile_resourcepacks WHERE profile_id = ?", profileID)
	return err
}

// UpdateEnabled toggles a resource pack's enabled status
func (r *ResourcePackRepository) UpdateEnabled(id string, enabled bool) error {
	_, err := r.db.Exec(`
		UPDATE profile_resourcepacks SET enabled = ?, updated_at = ? WHERE id = ?
	`, boolToInt(enabled), time.Now().Unix(), id)
	return err
}

// GetByFileName retrieves a resource pack by profile ID and file name
func (r *ResourcePackRepository) GetByFileName(profileID, fileName string) (*domain.ResourcePack, error) {
	var pack domain.ResourcePack
	var isDirectory, enabled int
	var lastModified, createdAt, updatedAt int64
	
	err := r.db.QueryRow(`
		SELECT id, profile_id, file_name, file_path, file_hash, file_size,
			is_directory, pack_format, description, enabled,
			last_modified, created_at, updated_at
		FROM profile_resourcepacks WHERE profile_id = ? AND file_name = ?
	`, profileID, fileName).Scan(
		&pack.ID, &pack.ProfileID, &pack.FileName, &pack.FilePath, &pack.FileHash, &pack.FileSize,
		&isDirectory, &pack.PackFormat, &pack.Description, &enabled,
		&lastModified, &createdAt, &updatedAt,
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
