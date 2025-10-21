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
	CurseForgeBaseURL = "https://api.curseforge.com/v1"
	
	// TTL for different cache types
	CurseForgeSearchTTL     = 1 * time.Hour
	CurseForgeModTTL        = 6 * time.Hour
	CurseForgeFilesTTL      = 6 * time.Hour
	CurseForgeCategoriesTTL = 24 * time.Hour
	
	// Cache type identifiers
	CacheTypeCurseForgeSearch     = "curseforge_search"
	CacheTypeCurseForgeMod        = "curseforge_mod"
	CacheTypeCurseForgeFiles      = "curseforge_files"
	CacheTypeCurseForgeCategories = "curseforge_categories"
)

// CurseForgeCacheService handles CurseForge API caching
type CurseForgeCacheService struct {
	cacheRepo  *cache.APICacheRepository
	httpClient *http.Client
	apiKey     string
}

// NewCurseForgeCacheService creates a new service
func NewCurseForgeCacheService(cacheRepo *cache.APICacheRepository, apiKey string) *CurseForgeCacheService {
	return &CurseForgeCacheService{
		cacheRepo: cacheRepo,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		apiKey: apiKey,
	}
}

// IsConfigured checks if API key is set
func (s *CurseForgeCacheService) IsConfigured() bool {
	return s.apiKey != ""
}

// SearchMods searches for mods with caching
func (s *CurseForgeCacheService) SearchMods(
	query string,
	gameVersion string,
	modLoaderType int,
	pageSize, index int,
	sortField int,
	sortOrder string,
	forceRefresh bool,
) ([]byte, error) {
	if !s.IsConfigured() {
		return nil, fmt.Errorf("CurseForge API key not configured")
	}

	// Generate cache key from query parameters
	cacheKey := s.generateSearchCacheKey(query, gameVersion, modLoaderType, pageSize, index, sortField, sortOrder)

	// Try cache first
	if !forceRefresh {
		cached, found, err := s.cacheRepo.Get(cacheKey)
		if err == nil && found {
			return cached, nil
		}
	}

	// Build URL
	apiURL := fmt.Sprintf("%s/mods/search", CurseForgeBaseURL)
	params := url.Values{}
	params.Set("gameId", "432")        // Minecraft
	params.Set("classId", "6")         // Mods
	params.Set("searchFilter", query)
	params.Set("pageSize", fmt.Sprintf("%d", pageSize))
	params.Set("index", fmt.Sprintf("%d", index))
	
	// Set sort parameters (default to Popularity/desc if not specified)
	if sortField > 0 {
		params.Set("sortField", fmt.Sprintf("%d", sortField))
	} else {
		params.Set("sortField", "2") // Default: Popularity
	}
	if sortOrder != "" {
		params.Set("sortOrder", sortOrder)
	} else {
		params.Set("sortOrder", "desc") // Default: descending
	}
	
	if gameVersion != "" {
		params.Set("gameVersion", gameVersion)
	}
	if modLoaderType > 0 {
		params.Set("modLoaderType", fmt.Sprintf("%d", modLoaderType))
	}

	// Fetch from API
	fullURL := fmt.Sprintf("%s?%s", apiURL, params.Encode())
	data, err := s.fetchFromAPI(fullURL)
	if err != nil {
		return nil, err
	}

	// Cache the result
	if err := s.cacheRepo.Set(cacheKey, CacheTypeCurseForgeSearch, json.RawMessage(data), CurseForgeSearchTTL); err != nil {
		fmt.Printf("[CurseForgeCache] Warning: failed to cache search: %v\n", err)
	}

	return data, nil
}

// GetMod gets mod details with caching
func (s *CurseForgeCacheService) GetMod(modID string, forceRefresh bool) ([]byte, error) {
	if !s.IsConfigured() {
		return nil, fmt.Errorf("CurseForge API key not configured")
	}

	cacheKey := fmt.Sprintf("curseforge:mod:%s", modID)

	// Try cache first
	if !forceRefresh {
		cached, found, err := s.cacheRepo.Get(cacheKey)
		if err == nil && found {
			return cached, nil
		}
	}

	// Fetch from API
	apiURL := fmt.Sprintf("%s/mods/%s", CurseForgeBaseURL, modID)
	data, err := s.fetchFromAPI(apiURL)
	if err != nil {
		return nil, err
	}

	// Cache the result
	if err := s.cacheRepo.Set(cacheKey, CacheTypeCurseForgeMod, json.RawMessage(data), CurseForgeModTTL); err != nil {
		fmt.Printf("[CurseForgeCache] Warning: failed to cache mod: %v\n", err)
	}

	return data, nil
}

// GetModFiles gets mod files with caching
func (s *CurseForgeCacheService) GetModFiles(
	modID string,
	gameVersion string,
	modLoaderType int,
	forceRefresh bool,
) ([]byte, error) {
	if !s.IsConfigured() {
		return nil, fmt.Errorf("CurseForge API key not configured")
	}

	cacheKey := s.generateFilesCacheKey(modID, gameVersion, modLoaderType)

	// Try cache first
	if !forceRefresh {
		cached, found, err := s.cacheRepo.Get(cacheKey)
		if err == nil && found {
			return cached, nil
		}
	}

	// Build URL
	apiURL := fmt.Sprintf("%s/mods/%s/files", CurseForgeBaseURL, modID)
	params := url.Values{}
	if gameVersion != "" {
		params.Set("gameVersion", gameVersion)
	}
	if modLoaderType > 0 {
		params.Set("modLoaderType", fmt.Sprintf("%d", modLoaderType))
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
	if err := s.cacheRepo.Set(cacheKey, CacheTypeCurseForgeFiles, json.RawMessage(data), CurseForgeFilesTTL); err != nil {
		fmt.Printf("[CurseForgeCache] Warning: failed to cache files: %v\n", err)
	}

	return data, nil
}

// GetCategories gets categories with caching
func (s *CurseForgeCacheService) GetCategories(forceRefresh bool) ([]byte, error) {
	if !s.IsConfigured() {
		return nil, fmt.Errorf("CurseForge API key not configured")
	}

	cacheKey := "curseforge:categories"

	// Try cache first
	if !forceRefresh {
		cached, found, err := s.cacheRepo.Get(cacheKey)
		if err == nil && found {
			return cached, nil
		}
	}

	// Fetch from API
	apiURL := fmt.Sprintf("%s/categories?gameId=432&classId=6", CurseForgeBaseURL)
	data, err := s.fetchFromAPI(apiURL)
	if err != nil {
		return nil, err
	}

	// Cache the result
	if err := s.cacheRepo.Set(cacheKey, CacheTypeCurseForgeCategories, json.RawMessage(data), CurseForgeCategoriesTTL); err != nil {
		fmt.Printf("[CurseForgeCache] Warning: failed to cache categories: %v\n", err)
	}

	return data, nil
}

// InvalidateMod removes mod-related cache
func (s *CurseForgeCacheService) InvalidateMod(modID string) error {
	// Delete mod cache
	if err := s.cacheRepo.Delete(fmt.Sprintf("curseforge:mod:%s", modID)); err != nil {
		return err
	}
	return nil
}

// InvalidateSearch removes all search caches
func (s *CurseForgeCacheService) InvalidateSearch() error {
	return s.cacheRepo.DeleteByType(CacheTypeCurseForgeSearch)
}

// fetchFromAPI fetches data from CurseForge API
func (s *CurseForgeCacheService) fetchFromAPI(url string) ([]byte, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	// Set CurseForge API headers
	req.Header.Set("Accept", "application/json")
	req.Header.Set("x-api-key", s.apiKey)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch from CurseForge: %w", err)
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
func (s *CurseForgeCacheService) generateSearchCacheKey(query, gameVersion string, modLoaderType, pageSize, index, sortField int, sortOrder string) string {
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%d:%d:%d:%d:%s", query, gameVersion, modLoaderType, pageSize, index, sortField, sortOrder)))
	return fmt.Sprintf("curseforge:search:%x", hash[:8])
}

// generateFilesCacheKey creates a unique cache key for files queries
func (s *CurseForgeCacheService) generateFilesCacheKey(modID, gameVersion string, modLoaderType int) string {
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%d", modID, gameVersion, modLoaderType)))
	return fmt.Sprintf("curseforge:files:%s:%x", modID, hash[:8])
}
