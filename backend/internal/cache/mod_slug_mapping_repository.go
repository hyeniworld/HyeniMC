package cache

import (
	"database/sql"
	"fmt"
	"time"
)

type ModSlugMapping struct {
	Slug        string
	Source      string // 'modrinth' or 'curseforge'
	ProjectID   string
	ProjectName string
	ResolvedVia string // 'known', 'slug_lookup', 'search'
	Confidence  int
	HitCount    int
	CreatedAt   time.Time
	LastUsed    time.Time
}

type ModSlugMappingRepository struct {
	db *sql.DB
}

func NewModSlugMappingRepository(db *sql.DB) *ModSlugMappingRepository {
	return &ModSlugMappingRepository{db: db}
}

// GetMapping retrieves a mapping from the cache
func (r *ModSlugMappingRepository) GetMapping(slug, source string) (*ModSlugMapping, error) {
	query := `
		SELECT slug, source, project_id, project_name, resolved_via, confidence, hit_count, created_at, last_used
		FROM mod_slug_mappings
		WHERE slug = ? AND source = ?
	`

	var mapping ModSlugMapping
	var createdAt, lastUsed int64

	err := r.db.QueryRow(query, slug, source).Scan(
		&mapping.Slug,
		&mapping.Source,
		&mapping.ProjectID,
		&mapping.ProjectName,
		&mapping.ResolvedVia,
		&mapping.Confidence,
		&mapping.HitCount,
		&createdAt,
		&lastUsed,
	)

	if err == sql.ErrNoRows {
		return nil, nil // Not found
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get mapping: %w", err)
	}

	mapping.CreatedAt = time.Unix(createdAt, 0)
	mapping.LastUsed = time.Unix(lastUsed, 0)

	return &mapping, nil
}

// SaveMapping saves or updates a mapping
func (r *ModSlugMappingRepository) SaveMapping(mapping *ModSlugMapping) error {
	now := time.Now().Unix()

	query := `
		INSERT INTO mod_slug_mappings (slug, source, project_id, project_name, resolved_via, confidence, hit_count, created_at, last_used)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(slug, source) DO UPDATE SET
			project_id = excluded.project_id,
			project_name = excluded.project_name,
			resolved_via = excluded.resolved_via,
			confidence = excluded.confidence,
			hit_count = mod_slug_mappings.hit_count + 1,
			last_used = excluded.last_used
	`

	_, err := r.db.Exec(query,
		mapping.Slug,
		mapping.Source,
		mapping.ProjectID,
		mapping.ProjectName,
		mapping.ResolvedVia,
		mapping.Confidence,
		1, // Initial hit count
		now,
		now,
	)

	if err != nil {
		return fmt.Errorf("failed to save mapping: %w", err)
	}

	return nil
}

// UpdateLastUsed increments hit count and updates last_used timestamp
func (r *ModSlugMappingRepository) UpdateLastUsed(slug, source string) error {
	now := time.Now().Unix()

	query := `
		UPDATE mod_slug_mappings
		SET hit_count = hit_count + 1, last_used = ?
		WHERE slug = ? AND source = ?
	`

	_, err := r.db.Exec(query, now, slug, source)
	if err != nil {
		return fmt.Errorf("failed to update last used: %w", err)
	}

	return nil
}

// GetTopMappings returns most used mappings (for statistics/debugging)
func (r *ModSlugMappingRepository) GetTopMappings(source string, limit int) ([]*ModSlugMapping, error) {
	query := `
		SELECT slug, source, project_id, project_name, resolved_via, confidence, hit_count, created_at, last_used
		FROM mod_slug_mappings
		WHERE source = ?
		ORDER BY hit_count DESC
		LIMIT ?
	`

	rows, err := r.db.Query(query, source, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to get top mappings: %w", err)
	}
	defer rows.Close()

	var mappings []*ModSlugMapping
	for rows.Next() {
		var mapping ModSlugMapping
		var createdAt, lastUsed int64

		err := rows.Scan(
			&mapping.Slug,
			&mapping.Source,
			&mapping.ProjectID,
			&mapping.ProjectName,
			&mapping.ResolvedVia,
			&mapping.Confidence,
			&mapping.HitCount,
			&createdAt,
			&lastUsed,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan mapping: %w", err)
		}

		mapping.CreatedAt = time.Unix(createdAt, 0)
		mapping.LastUsed = time.Unix(lastUsed, 0)

		mappings = append(mappings, &mapping)
	}

	return mappings, nil
}

// ClearLowConfidenceMappings removes unreliable mappings (optional cleanup)
func (r *ModSlugMappingRepository) ClearLowConfidenceMappings(minConfidence int) error {
	query := `
		DELETE FROM mod_slug_mappings
		WHERE confidence < ? AND resolved_via = 'search'
	`

	_, err := r.db.Exec(query, minConfidence)
	if err != nil {
		return fmt.Errorf("failed to clear low confidence mappings: %w", err)
	}

	return nil
}
