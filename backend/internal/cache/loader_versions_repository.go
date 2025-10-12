package cache

import (
	"database/sql"
	"time"
)

// LoaderVersion represents a cached loader version
type LoaderVersion struct {
	LoaderType   string
	Version      string
	Stable       bool
	BuildNumber  *int
	MavenCoords  string
	CachedAt     time.Time
}

// LoaderVersionsRepository handles loader version caching
type LoaderVersionsRepository struct {
	db *sql.DB
}

// NewLoaderVersionsRepository creates a new loader versions repository
func NewLoaderVersionsRepository(db *sql.DB) *LoaderVersionsRepository {
	return &LoaderVersionsRepository{db: db}
}

// GetAll retrieves all cached versions for a loader type
func (r *LoaderVersionsRepository) GetAll(loaderType string) ([]*LoaderVersion, error) {
	rows, err := r.db.Query(`
		SELECT loader_type, version, stable, build_number, maven_coords, cached_at
		FROM loader_versions
		WHERE loader_type = ?
		ORDER BY cached_at DESC
	`, loaderType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var versions []*LoaderVersion
	for rows.Next() {
		var v LoaderVersion
		var stable int
		var buildNumber sql.NullInt64
		var cachedAt int64

		err := rows.Scan(&v.LoaderType, &v.Version, &stable, &buildNumber, &v.MavenCoords, &cachedAt)
		if err != nil {
			return nil, err
		}

		v.Stable = stable == 1
		if buildNumber.Valid {
			bn := int(buildNumber.Int64)
			v.BuildNumber = &bn
		}
		v.CachedAt = time.Unix(cachedAt, 0)

		versions = append(versions, &v)
	}

	return versions, rows.Err()
}

// SaveBatch stores multiple loader versions in a transaction
func (r *LoaderVersionsRepository) SaveBatch(loaderType string, versions []*LoaderVersion) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Clear existing versions for this loader type
	if _, err := tx.Exec("DELETE FROM loader_versions WHERE loader_type = ?", loaderType); err != nil {
		return err
	}

	// Insert new versions
	stmt, err := tx.Prepare(`
		INSERT INTO loader_versions (loader_type, version, stable, build_number, maven_coords, cached_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now().Unix()
	for _, v := range versions {
		stable := 0
		if v.Stable {
			stable = 1
		}

		var buildNumber interface{}
		if v.BuildNumber != nil {
			buildNumber = *v.BuildNumber
		}

		if _, err := stmt.Exec(loaderType, v.Version, stable, buildNumber, v.MavenCoords, now); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetCacheAge returns how old the cache is for a loader type
func (r *LoaderVersionsRepository) GetCacheAge(loaderType string) (time.Duration, error) {
	var cachedAt int64
	err := r.db.QueryRow(`
		SELECT MAX(cached_at) FROM loader_versions WHERE loader_type = ?
	`, loaderType).Scan(&cachedAt)

	if err == sql.ErrNoRows || cachedAt == 0 {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}

	age := time.Since(time.Unix(cachedAt, 0))
	return age, nil
}

// DeleteByType removes all versions for a loader type
func (r *LoaderVersionsRepository) DeleteByType(loaderType string) error {
	_, err := r.db.Exec("DELETE FROM loader_versions WHERE loader_type = ?", loaderType)
	return err
}
