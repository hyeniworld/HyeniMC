package services

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"hyenimc/backend/internal/cache"
)

const (
	FabricMetaURL   = "https://meta.fabricmc.net/v2/versions/loader"
	NeoForgeMetaURL = "https://launcher-meta.modrinth.com/neo/v0/manifest.json"
	QuiltMetaURL    = "https://meta.quiltmc.org/v3/versions/loader"
	
	LoaderVersionsTTL = 6 * time.Hour
)

// LoaderVersionsService handles loader version caching
type LoaderVersionsService struct {
	cacheRepo *cache.LoaderVersionsRepository
	httpClient *http.Client
}

// NewLoaderVersionsService creates a new service
func NewLoaderVersionsService(cacheRepo *cache.LoaderVersionsRepository) *LoaderVersionsService {
	return &LoaderVersionsService{
		cacheRepo: cacheRepo,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// GetFabricVersions retrieves Fabric loader versions
func (s *LoaderVersionsService) GetFabricVersions(forceRefresh bool) ([]*cache.LoaderVersion, error) {
	return s.getVersions("fabric", FabricMetaURL, s.parseFabricResponse, forceRefresh)
}

// GetNeoForgeVersions retrieves NeoForge loader versions
func (s *LoaderVersionsService) GetNeoForgeVersions(forceRefresh bool) ([]*cache.LoaderVersion, error) {
	return s.getVersions("neoforge", NeoForgeMetaURL, s.parseNeoForgeResponse, forceRefresh)
}

// GetQuiltVersions retrieves Quilt loader versions
func (s *LoaderVersionsService) GetQuiltVersions(forceRefresh bool) ([]*cache.LoaderVersion, error) {
	return s.getVersions("quilt", QuiltMetaURL, s.parseQuiltResponse, forceRefresh)
}

// getVersions is a generic method to get versions with caching
func (s *LoaderVersionsService) getVersions(
	loaderType string,
	url string,
	parser func([]byte) ([]*cache.LoaderVersion, error),
	forceRefresh bool,
) ([]*cache.LoaderVersion, error) {
	// Check cache age
	if !forceRefresh {
		age, err := s.cacheRepo.GetCacheAge(loaderType)
		if err == nil && age < LoaderVersionsTTL {
			// Cache is still fresh
			versions, err := s.cacheRepo.GetAll(loaderType)
			if err == nil && len(versions) > 0 {
				return versions, nil
			}
		}
	}

	// Fetch from API
	resp, err := s.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch %s versions: %w", loaderType, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code for %s: %d", loaderType, resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read %s response: %w", loaderType, err)
	}

	// Parse response
	versions, err := parser(body)
	if err != nil {
		return nil, fmt.Errorf("failed to parse %s response: %w", loaderType, err)
	}

	// Cache the result
	if err := s.cacheRepo.SaveBatch(loaderType, versions); err != nil {
		fmt.Printf("[LoaderVersions] Warning: failed to cache %s versions: %v\n", loaderType, err)
	}

	return versions, nil
}

// parseFabricResponse parses Fabric API response
func (s *LoaderVersionsService) parseFabricResponse(body []byte) ([]*cache.LoaderVersion, error) {
	var apiResponse []struct {
		Separator string `json:"separator"`
		Build     int    `json:"build"`
		Maven     string `json:"maven"`
		Version   string `json:"version"`
		Stable    bool   `json:"stable"`
	}

	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return nil, err
	}

	versions := make([]*cache.LoaderVersion, len(apiResponse))
	for i, item := range apiResponse {
		versions[i] = &cache.LoaderVersion{
			LoaderType:  "fabric",
			Version:     item.Version,
			Stable:      item.Stable,
			BuildNumber: &item.Build,
			MavenCoords: item.Maven,
		}
	}

	return versions, nil
}

// parseNeoForgeResponse parses NeoForge (Modrinth Meta) API response
func (s *LoaderVersionsService) parseNeoForgeResponse(body []byte) ([]*cache.LoaderVersion, error) {
	var apiResponse struct {
		GameVersions []struct {
			ID      string `json:"id"`
			Stable  bool   `json:"stable"`
			Loaders []struct {
				ID     string `json:"id"`
				URL    string `json:"url"`
				Stable bool   `json:"stable"`
			} `json:"loaders"`
		} `json:"gameVersions"`
	}

	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return nil, err
	}

	var versions []*cache.LoaderVersion
	for _, gameVer := range apiResponse.GameVersions {
		for _, loader := range gameVer.Loaders {
			versions = append(versions, &cache.LoaderVersion{
				LoaderType:  "neoforge",
				Version:     loader.ID,
				Stable:      loader.Stable,
				MavenCoords: loader.URL,
			})
		}
	}

	return versions, nil
}

// parseQuiltResponse parses Quilt API response
func (s *LoaderVersionsService) parseQuiltResponse(body []byte) ([]*cache.LoaderVersion, error) {
	var apiResponse []struct {
		Separator string `json:"separator"`
		Build     int    `json:"build"`
		Maven     string `json:"maven"`
		Version   string `json:"version"`
	}

	if err := json.Unmarshal(body, &apiResponse); err != nil {
		return nil, err
	}

	versions := make([]*cache.LoaderVersion, len(apiResponse))
	for i, item := range apiResponse {
		versions[i] = &cache.LoaderVersion{
			LoaderType:  "quilt",
			Version:     item.Version,
			Stable:      true, // Quilt doesn't have stable flag, assume all stable
			BuildNumber: &item.Build,
			MavenCoords: item.Maven,
		}
	}

	return versions, nil
}

// InvalidateCache clears the loader versions cache for a specific loader
func (s *LoaderVersionsService) InvalidateCache(loaderType string) error {
	return s.cacheRepo.DeleteByType(loaderType)
}
