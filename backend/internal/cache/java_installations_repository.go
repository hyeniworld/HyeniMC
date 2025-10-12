package cache

import (
	"database/sql"
	"time"
)

// JavaInstallation represents a detected Java installation
type JavaInstallation struct {
	ID           string
	Path         string
	Version      string
	Vendor       string
	Architecture string
	IsValid      bool
	DetectedAt   time.Time
}

// JavaInstallationsRepository handles Java installations caching
type JavaInstallationsRepository struct {
	db *sql.DB
}

// NewJavaInstallationsRepository creates a new repository
func NewJavaInstallationsRepository(db *sql.DB) *JavaInstallationsRepository {
	return &JavaInstallationsRepository{db: db}
}

// GetAll retrieves all cached Java installations
func (r *JavaInstallationsRepository) GetAll() ([]*JavaInstallation, error) {
	rows, err := r.db.Query(`
		SELECT id, path, version, vendor, architecture, is_valid, detected_at
		FROM java_installations
		WHERE is_valid = 1
		ORDER BY detected_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var installations []*JavaInstallation
	for rows.Next() {
		var inst JavaInstallation
		var isValid int
		var detectedAt int64
		var vendor, architecture sql.NullString

		err := rows.Scan(&inst.ID, &inst.Path, &inst.Version, &vendor, &architecture, &isValid, &detectedAt)
		if err != nil {
			return nil, err
		}

		inst.IsValid = isValid == 1
		inst.DetectedAt = time.Unix(detectedAt, 0)
		if vendor.Valid {
			inst.Vendor = vendor.String
		}
		if architecture.Valid {
			inst.Architecture = architecture.String
		}

		installations = append(installations, &inst)
	}

	return installations, rows.Err()
}

// Save inserts or updates a Java installation
func (r *JavaInstallationsRepository) Save(inst *JavaInstallation) error {
	isValid := 0
	if inst.IsValid {
		isValid = 1
	}

	_, err := r.db.Exec(`
		INSERT OR REPLACE INTO java_installations 
		(id, path, version, vendor, architecture, is_valid, detected_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, inst.ID, inst.Path, inst.Version, inst.Vendor, inst.Architecture, isValid, time.Now().Unix())

	return err
}

// SaveBatch stores multiple Java installations in a transaction
func (r *JavaInstallationsRepository) SaveBatch(installations []*JavaInstallation) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Clear existing installations
	if _, err := tx.Exec("DELETE FROM java_installations"); err != nil {
		return err
	}

	// Insert new installations
	stmt, err := tx.Prepare(`
		INSERT INTO java_installations 
		(id, path, version, vendor, architecture, is_valid, detected_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now().Unix()
	for _, inst := range installations {
		isValid := 0
		if inst.IsValid {
			isValid = 1
		}

		if _, err := stmt.Exec(inst.ID, inst.Path, inst.Version, inst.Vendor, inst.Architecture, isValid, now); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetByPath retrieves a Java installation by path
func (r *JavaInstallationsRepository) GetByPath(path string) (*JavaInstallation, error) {
	var inst JavaInstallation
	var isValid int
	var detectedAt int64
	var vendor, architecture sql.NullString

	err := r.db.QueryRow(`
		SELECT id, path, version, vendor, architecture, is_valid, detected_at
		FROM java_installations
		WHERE path = ?
	`, path).Scan(&inst.ID, &inst.Path, &inst.Version, &vendor, &architecture, &isValid, &detectedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	inst.IsValid = isValid == 1
	inst.DetectedAt = time.Unix(detectedAt, 0)
	if vendor.Valid {
		inst.Vendor = vendor.String
	}
	if architecture.Valid {
		inst.Architecture = architecture.String
	}

	return &inst, nil
}

// Delete removes a Java installation by path
func (r *JavaInstallationsRepository) Delete(path string) error {
	_, err := r.db.Exec("DELETE FROM java_installations WHERE path = ?", path)
	return err
}

// Clear removes all Java installations
func (r *JavaInstallationsRepository) Clear() error {
	_, err := r.db.Exec("DELETE FROM java_installations")
	return err
}
