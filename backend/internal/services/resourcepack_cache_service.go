package services

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"hyenimc/backend/internal/cache"
	"hyenimc/backend/internal/domain"
)

// ResourcePackCacheService handles resource pack caching logic
type ResourcePackCacheService struct {
	repo    *cache.ResourcePackRepository
	dataDir string
}

// NewResourcePackCacheService creates a new resource pack cache service
func NewResourcePackCacheService(repo *cache.ResourcePackRepository, dataDir string) *ResourcePackCacheService {
	return &ResourcePackCacheService{
		repo:    repo,
		dataDir: dataDir,
	}
}

// SyncResourcePacks synchronizes the resource pack cache with the file system
func (s *ResourcePackCacheService) SyncResourcePacks(ctx context.Context, profileID string, packsDir string) ([]*domain.ResourcePack, error) {
	// Get cached packs
	cachedPacks, err := s.repo.ListByProfile(profileID)
	if err != nil {
		return nil, fmt.Errorf("failed to get cached resource packs: %w", err)
	}

	// Create a map for quick lookup
	cacheMap := make(map[string]*domain.ResourcePack)
	for _, pack := range cachedPacks {
		cacheMap[pack.FileName] = pack
	}

	// Scan packs directory
	entries, err := os.ReadDir(packsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []*domain.ResourcePack{}, nil
		}
		return nil, fmt.Errorf("failed to read resource packs directory: %w", err)
	}

	var result []*domain.ResourcePack
	foundFiles := make(map[string]bool)

	for _, entry := range entries {
		fileName := entry.Name()
		foundFiles[fileName] = true
		filePath := filepath.Join(packsDir, fileName)

		// Get file info
		info, err := entry.Info()
		if err != nil {
			continue
		}

		// Skip if not a zip or directory
		isDir := entry.IsDir()
		if !isDir && !strings.HasSuffix(fileName, ".zip") {
			continue
		}

		// Check if file is in cache and unchanged
		cached, exists := cacheMap[fileName]
		if exists && cached.LastModified.Unix() == info.ModTime().Unix() {
			result = append(result, cached)
			continue
		}

		// File is new or modified, parse and update cache
		pack, err := s.parseResourcePack(profileID, filePath, info, isDir)
		if err != nil {
			// If parsing fails, create a minimal entry
			pack = &domain.ResourcePack{
				ID:           uuid.New().String(),
				ProfileID:    profileID,
				FileName:     fileName,
				FilePath:     filePath,
				FileSize:     info.Size(),
				IsDirectory:  isDir,
				Enabled:      false, // Must be manually enabled
				LastModified: info.ModTime(),
				CreatedAt:    time.Now(),
				UpdatedAt:    time.Now(),
			}
		}

		// Save to cache
		if err := s.repo.Save(pack); err != nil {
			return nil, fmt.Errorf("failed to save resource pack to cache: %w", err)
		}

		result = append(result, pack)
	}

	// Remove cached packs that no longer exist on disk
	for fileName, cached := range cacheMap {
		if !foundFiles[fileName] {
			s.repo.Delete(cached.ID)
		}
	}

	return result, nil
}

// parseResourcePack extracts metadata from a resource pack
func (s *ResourcePackCacheService) parseResourcePack(profileID, filePath string, info os.FileInfo, isDirectory bool) (*domain.ResourcePack, error) {
	// Calculate file hash (skip for directories)
	var hash string
	var err error
	if !isDirectory {
		hash, err = calculateFileHash(filePath)
		if err != nil {
			return nil, err
		}
	}

	pack := &domain.ResourcePack{
		ID:           uuid.New().String(),
		ProfileID:    profileID,
		FileName:     filepath.Base(filePath),
		FilePath:     filePath,
		FileHash:     hash,
		FileSize:     info.Size(),
		IsDirectory:  isDirectory,
		Enabled:      false,
		LastModified: info.ModTime(),
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	// Try to extract pack.mcmeta
	metadata, err := extractPackMeta(filePath, isDirectory)
	if err == nil && metadata != nil {
		pack.PackFormat = metadata.PackFormat
		pack.Description = metadata.Description
	}

	return pack, nil
}

// PackMetadata represents pack.mcmeta contents
type PackMetadata struct {
	PackFormat  int
	Description string
}

// extractPackMeta reads pack.mcmeta from resource pack
func extractPackMeta(path string, isDirectory bool) (*PackMetadata, error) {
	if isDirectory {
		// Read pack.mcmeta from directory
		metaPath := filepath.Join(path, "pack.mcmeta")
		data, err := os.ReadFile(metaPath)
		if err != nil {
			return nil, err
		}
		return parsePackMeta(data)
	}

	// Read pack.mcmeta from ZIP
	r, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	for _, file := range r.File {
		if file.Name == "pack.mcmeta" {
			rc, err := file.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()

			data, err := io.ReadAll(rc)
			if err != nil {
				return nil, err
			}

			return parsePackMeta(data)
		}
	}

	return nil, fmt.Errorf("pack.mcmeta not found")
}

func parsePackMeta(data []byte) (*PackMetadata, error) {
	var meta struct {
		Pack struct {
			PackFormat  int    `json:"pack_format"`
			Description string `json:"description"`
		} `json:"pack"`
	}

	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, err
	}

	return &PackMetadata{
		PackFormat:  meta.Pack.PackFormat,
		Description: meta.Pack.Description,
	}, nil
}

// GetResourcePacks retrieves resource packs with automatic cache refresh
func (s *ResourcePackCacheService) GetResourcePacks(ctx context.Context, profileID string, packsDir string, forceRefresh bool) ([]*domain.ResourcePack, error) {
	if forceRefresh {
		return s.SyncResourcePacks(ctx, profileID, packsDir)
	}

	// Try cache first
	packs, err := s.repo.ListByProfile(profileID)
	if err != nil {
		return nil, err
	}

	// If cache is empty, do a full sync
	if len(packs) == 0 {
		return s.SyncResourcePacks(ctx, profileID, packsDir)
	}

	// Quick check: detect if file system has changed
	needsSync, err := s.checkIfSyncNeeded(profileID, packsDir, packs)
	if err != nil {
		// On error, return cached data (better than failing)
		return packs, nil
	}

	if needsSync {
		return s.SyncResourcePacks(ctx, profileID, packsDir)
	}

	return packs, nil
}

// checkIfSyncNeeded performs a quick check to see if file system differs from cache
func (s *ResourcePackCacheService) checkIfSyncNeeded(profileID string, packsDir string, cachedPacks []*domain.ResourcePack) (bool, error) {
	// Check if packs directory exists
	entries, err := os.ReadDir(packsDir)
	if err != nil {
		if os.IsNotExist(err) {
			// Directory doesn't exist but we have cached packs = needs sync
			return len(cachedPacks) > 0, nil
		}
		return false, err
	}

	// Count actual resource pack files in directory (zip or directories)
	actualFiles := make(map[string]os.FileInfo)
	for _, entry := range entries {
		fileName := entry.Name()
		isDir := entry.IsDir()
		
		// Only zip files or directories
		if !isDir && !strings.HasSuffix(fileName, ".zip") {
			continue
		}
		
		info, err := entry.Info()
		if err != nil {
			continue
		}
		actualFiles[fileName] = info
	}

	// Quick check 1: Different number of files
	if len(actualFiles) != len(cachedPacks) {
		return true, nil
	}

	// Quick check 2: Check if all cached files still exist with same modification time
	for _, cached := range cachedPacks {
		actual, exists := actualFiles[cached.FileName]
		if !exists {
			// Cached file no longer exists
			return true, nil
		}

		// Check modification time
		if actual.ModTime().Unix() != cached.LastModified.Unix() {
			return true, nil
		}
	}

	// All checks passed, cache is up to date
	return false, nil
}

// ToggleResourcePack enables or disables a resource pack
func (s *ResourcePackCacheService) ToggleResourcePack(ctx context.Context, packID string, enabled bool) error {
	return s.repo.UpdateEnabled(packID, enabled)
}
