package cache

import (
	"database/sql"
	"encoding/json"
	"time"
)

// APICacheRepository handles API response caching
type APICacheRepository struct {
	db *sql.DB
}

// NewAPICacheRepository creates a new API cache repository
func NewAPICacheRepository(db *sql.DB) *APICacheRepository {
	return &APICacheRepository{db: db}
}

// Get retrieves cached API response
func (r *APICacheRepository) Get(cacheKey string) ([]byte, bool, error) {
	var responseData string
	var expiresAt int64

	err := r.db.QueryRow(`
		SELECT response_data, expires_at
		FROM api_cache
		WHERE cache_key = ?
	`, cacheKey).Scan(&responseData, &expiresAt)

	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	// Check if expired
	if time.Now().Unix() > expiresAt {
		// Delete expired entry
		r.Delete(cacheKey)
		return nil, false, nil
	}

	return []byte(responseData), true, nil
}

// Set stores API response in cache
func (r *APICacheRepository) Set(cacheKey, cacheType string, data interface{}, ttl time.Duration) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	now := time.Now().Unix()
	expiresAt := now + int64(ttl.Seconds())

	_, err = r.db.Exec(`
		INSERT OR REPLACE INTO api_cache (cache_key, cache_type, response_data, cached_at, expires_at)
		VALUES (?, ?, ?, ?, ?)
	`, cacheKey, cacheType, string(jsonData), now, expiresAt)

	return err
}

// Delete removes a cached entry
func (r *APICacheRepository) Delete(cacheKey string) error {
	_, err := r.db.Exec("DELETE FROM api_cache WHERE cache_key = ?", cacheKey)
	return err
}

// DeleteByType removes all cached entries of a specific type
func (r *APICacheRepository) DeleteByType(cacheType string) error {
	_, err := r.db.Exec("DELETE FROM api_cache WHERE cache_type = ?", cacheType)
	return err
}

// CleanExpired removes all expired cache entries
func (r *APICacheRepository) CleanExpired() error {
	now := time.Now().Unix()
	_, err := r.db.Exec("DELETE FROM api_cache WHERE expires_at < ?", now)
	return err
}
