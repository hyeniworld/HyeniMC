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
	MinecraftVersionsURL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
	MinecraftVersionsTTL = 24 * time.Hour
	MinecraftCacheKey    = "minecraft:versions"
	MinecraftCacheType   = "minecraft_versions"
)

// MinecraftVersionManifest represents the Mojang version manifest
type MinecraftVersionManifest struct {
	Latest struct {
		Release  string `json:"release"`
		Snapshot string `json:"snapshot"`
	} `json:"latest"`
	Versions []MinecraftVersion `json:"versions"`
}

// MinecraftVersion represents a single Minecraft version
type MinecraftVersion struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	URL         string    `json:"url"`
	Time        time.Time `json:"time"`
	ReleaseTime time.Time `json:"releaseTime"`
}

// MinecraftVersionsService handles Minecraft version caching
type MinecraftVersionsService struct {
	cacheRepo *cache.APICacheRepository
	httpClient *http.Client
}

// NewMinecraftVersionsService creates a new service
func NewMinecraftVersionsService(cacheRepo *cache.APICacheRepository) *MinecraftVersionsService {
	return &MinecraftVersionsService{
		cacheRepo: cacheRepo,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// GetVersions retrieves Minecraft versions (from cache or API)
func (s *MinecraftVersionsService) GetVersions(forceRefresh bool) (*MinecraftVersionManifest, error) {
	// Try cache first
	if !forceRefresh {
		cached, found, err := s.cacheRepo.Get(MinecraftCacheKey)
		if err == nil && found {
			var manifest MinecraftVersionManifest
			if err := json.Unmarshal(cached, &manifest); err == nil {
				return &manifest, nil
			}
		}
	}

	// Fetch from API
	manifest, err := s.fetchFromAPI()
	if err != nil {
		return nil, err
	}

	// Cache the result
	if err := s.cacheRepo.Set(MinecraftCacheKey, MinecraftCacheType, manifest, MinecraftVersionsTTL); err != nil {
		// Log but don't fail
		fmt.Printf("[MinecraftVersions] Warning: failed to cache: %v\n", err)
	}

	return manifest, nil
}

// GetReleaseVersions returns only release versions
func (s *MinecraftVersionsService) GetReleaseVersions(forceRefresh bool) ([]string, error) {
	manifest, err := s.GetVersions(forceRefresh)
	if err != nil {
		return nil, err
	}

	var releases []string
	for _, v := range manifest.Versions {
		if v.Type == "release" {
			releases = append(releases, v.ID)
		}
	}

	return releases, nil
}

// GetLatestRelease returns the latest release version
func (s *MinecraftVersionsService) GetLatestRelease(forceRefresh bool) (string, error) {
	manifest, err := s.GetVersions(forceRefresh)
	if err != nil {
		return "", err
	}

	return manifest.Latest.Release, nil
}

// fetchFromAPI fetches versions from Mojang API
func (s *MinecraftVersionsService) fetchFromAPI() (*MinecraftVersionManifest, error) {
	resp, err := s.httpClient.Get(MinecraftVersionsURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch Minecraft versions: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var manifest MinecraftVersionManifest
	if err := json.Unmarshal(body, &manifest); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &manifest, nil
}

// InvalidateCache clears the Minecraft versions cache
func (s *MinecraftVersionsService) InvalidateCache() error {
	return s.cacheRepo.Delete(MinecraftCacheKey)
}
