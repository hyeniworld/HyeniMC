package services

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"hyenimc/backend/internal/cache"
)

const (
	ModrinthBaseURL = "https://api.modrinth.com/v2"
	
	// TTL for different cache types
	ModrinthSearchTTL     = 1 * time.Hour
	ModrinthProjectTTL    = 6 * time.Hour
	ModrinthVersionTTL    = 6 * time.Hour
	ModrinthCategoriesTTL = 24 * time.Hour
	
	// Cache type identifiers
	CacheTypeModrinthSearch     = "modrinth_search"
	CacheTypeModrinthProject    = "modrinth_project"
	CacheTypeModrinthVersions   = "modrinth_versions"
	CacheTypeModrinthVersion    = "modrinth_version"
	CacheTypeModrinthCategories = "modrinth_categories"
)

// ModrinthCacheService handles Modrinth API caching
type ModrinthCacheService struct {
	cacheRepo  *cache.APICacheRepository
	httpClient *http.Client
}

// NewModrinthCacheService creates a new service
func NewModrinthCacheService(cacheRepo *cache.APICacheRepository) *ModrinthCacheService {
	return &ModrinthCacheService{
		cacheRepo: cacheRepo,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// SearchMods searches for mods with caching
func (s *ModrinthCacheService) SearchMods(
	query string,
	limit, offset int,
	facets string,
	forceRefresh bool,
) ([]byte, error) {
	// Generate cache key from query parameters
	cacheKey := s.generateSearchCacheKey(query, limit, offset, facets)

	// Try cache first
	if !forceRefresh {
		cached, found, err := s.cacheRepo.Get(cacheKey)
		if err == nil && found {
			return cached, nil
		}
	}

	// Build URL
	apiURL := fmt.Sprintf("%s/search", ModrinthBaseURL)
	params := url.Values{}
	params.Set("query", query)
	params.Set("limit", fmt.Sprintf("%d", limit))
	params.Set("offset", fmt.Sprintf("%d", offset))
	if facets != "" {
		params.Set("facets", facets)
	}

	// Fetch from API
	fullURL := fmt.Sprintf("%s?%s", apiURL, params.Encode())
	data, err := s.fetchFromAPI(fullURL)
	if err != nil {
		return nil, err
	}

	// Cache the result (raw JSON)
	if err := s.cacheRepo.Set(cacheKey, CacheTypeModrinthSearch, json.RawMessage(data), ModrinthSearchTTL); err != nil {
		fmt.Printf("[ModrinthCache] Warning: failed to cache search: %v\n", err)
	}

	return data, nil
}

// GetProject gets project details with caching
func (s *ModrinthCacheService) GetProject(projectID string, forceRefresh bool) ([]byte, error) {
	cacheKey := fmt.Sprintf("modrinth:project:%s", projectID)

	// Try cache first
	if !forceRefresh {
		cached, found, err := s.cacheRepo.Get(cacheKey)
		if err == nil && found {
			return cached, nil
		}
	}

	// Fetch from API
	apiURL := fmt.Sprintf("%s/project/%s", ModrinthBaseURL, projectID)
	data, err := s.fetchFromAPI(apiURL)
	if err != nil {
		return nil, err
	}

	// Cache the result
	if err := s.cacheRepo.Set(cacheKey, CacheTypeModrinthProject, json.RawMessage(data), ModrinthProjectTTL); err != nil {
		fmt.Printf("[ModrinthCache] Warning: failed to cache project: %v\n", err)
	}

	return data, nil
}

// GetProjectVersions gets project versions with caching
func (s *ModrinthCacheService) GetProjectVersions(
	projectID string,
	gameVersion string,
	loaders string,
	forceRefresh bool,
) ([]byte, error) {
	cacheKey := s.generateVersionsCacheKey(projectID, gameVersion, loaders)

	// Try cache first
	if !forceRefresh {
		cached, found, err := s.cacheRepo.Get(cacheKey)
		if err == nil && found {
			return cached, nil
		}
	}

	// Build URL
	apiURL := fmt.Sprintf("%s/project/%s/version", ModrinthBaseURL, projectID)
	params := url.Values{}
	if gameVersion != "" {
		params.Set("game_versions", gameVersion)
	}
	if loaders != "" {
		params.Set("loaders", loaders)
	}

	// Fetch from API
	fullURL := apiURL
	if len(params) > 0 {
		fullURL = fmt.Sprintf("%s?%s", apiURL, params.Encode())
	}
	data, err := s.fetchFromAPI(fullURL)
	if err != nil {
		return nil, err
	}

	// Cache the result
	if err := s.cacheRepo.Set(cacheKey, CacheTypeModrinthVersions, json.RawMessage(data), ModrinthVersionTTL); err != nil {
		fmt.Printf("[ModrinthCache] Warning: failed to cache versions: %v\n", err)
	}

	return data, nil
}

// GetVersion gets a single version details with caching
func (s *ModrinthCacheService) GetVersion(versionID string, forceRefresh bool) ([]byte, error) {
	cacheKey := fmt.Sprintf("modrinth:version:%s", versionID)

	// Try cache first
	if !forceRefresh {
		cached, found, err := s.cacheRepo.Get(cacheKey)
		if err == nil && found {
			return cached, nil
		}
	}

	// Fetch from API
	apiURL := fmt.Sprintf("%s/version/%s", ModrinthBaseURL, versionID)
	data, err := s.fetchFromAPI(apiURL)
	if err != nil {
		return nil, err
	}

	// Cache the result
	if err := s.cacheRepo.Set(cacheKey, CacheTypeModrinthVersion, json.RawMessage(data), ModrinthVersionTTL); err != nil {
		fmt.Printf("[ModrinthCache] Warning: failed to cache version: %v\n", err)
	}

	return data, nil
}

// GetMultipleProjects gets multiple projects with caching
func (s *ModrinthCacheService) GetMultipleProjects(projectIDs []string, forceRefresh bool) ([]byte, error) {
	// Generate cache key from sorted project IDs
	cacheKey := s.generateMultipleProjectsCacheKey(projectIDs)

	// Try cache first
	if !forceRefresh {
		cached, found, err := s.cacheRepo.Get(cacheKey)
		if err == nil && found {
			return cached, nil
		}
	}

	// Build URL
	apiURL := fmt.Sprintf("%s/projects", ModrinthBaseURL)
	params := url.Values{}
	idsJSON, _ := json.Marshal(projectIDs)
	params.Set("ids", string(idsJSON))

	// Fetch from API
	fullURL := fmt.Sprintf("%s?%s", apiURL, params.Encode())
	data, err := s.fetchFromAPI(fullURL)
	if err != nil {
		return nil, err
	}

	// Cache the result
	if err := s.cacheRepo.Set(cacheKey, CacheTypeModrinthProject, json.RawMessage(data), ModrinthProjectTTL); err != nil {
		fmt.Printf("[ModrinthCache] Warning: failed to cache multiple projects: %v\n", err)
	}

	return data, nil
}

// GetCategories gets categories with caching
func (s *ModrinthCacheService) GetCategories(forceRefresh bool) ([]byte, error) {
	cacheKey := "modrinth:categories"

	// Try cache first
	if !forceRefresh {
		cached, found, err := s.cacheRepo.Get(cacheKey)
		if err == nil && found {
			return cached, nil
		}
	}

	// Fetch from API
	apiURL := fmt.Sprintf("%s/tag/category", ModrinthBaseURL)
	data, err := s.fetchFromAPI(apiURL)
	if err != nil {
		return nil, err
	}

	// Cache the result
	if err := s.cacheRepo.Set(cacheKey, CacheTypeModrinthCategories, json.RawMessage(data), ModrinthCategoriesTTL); err != nil {
		fmt.Printf("[ModrinthCache] Warning: failed to cache categories: %v\n", err)
	}

	return data, nil
}

// InvalidateProject removes project-related cache
func (s *ModrinthCacheService) InvalidateProject(projectID string) error {
	// Delete project cache
	if err := s.cacheRepo.Delete(fmt.Sprintf("modrinth:project:%s", projectID)); err != nil {
		return err
	}
	// Delete versions cache (all variants)
	// Note: This is a simple implementation. For production, you might want to track cache keys
	return nil
}

// InvalidateSearch removes all search caches
func (s *ModrinthCacheService) InvalidateSearch() error {
	return s.cacheRepo.DeleteByType(CacheTypeModrinthSearch)
}

// fetchFromAPI fetches data from Modrinth API
func (s *ModrinthCacheService) fetchFromAPI(url string) ([]byte, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	// Set Modrinth API headers
	req.Header.Set("User-Agent", "HyeniMC/1.0")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch from Modrinth: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	return body, nil
}

// generateSearchCacheKey creates a unique cache key for search queries
func (s *ModrinthCacheService) generateSearchCacheKey(query string, limit, offset int, facets string) string {
	// Create a deterministic cache key
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s:%d:%d:%s", query, limit, offset, facets)))
	return fmt.Sprintf("modrinth:search:%x", hash[:8])
}

// generateVersionsCacheKey creates a unique cache key for versions queries
func (s *ModrinthCacheService) generateVersionsCacheKey(projectID, gameVersion, loaders string) string {
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%s", projectID, gameVersion, loaders)))
	return fmt.Sprintf("modrinth:versions:%s:%x", projectID, hash[:8])
}

// generateMultipleProjectsCacheKey creates a cache key for multiple projects
func (s *ModrinthCacheService) generateMultipleProjectsCacheKey(projectIDs []string) string {
	// Sort IDs for consistency
	idsJSON, _ := json.Marshal(projectIDs)
	hash := sha256.Sum256(idsJSON)
	return fmt.Sprintf("modrinth:projects:%x", hash[:8])
}
