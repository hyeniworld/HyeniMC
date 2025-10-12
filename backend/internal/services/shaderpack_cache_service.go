package services

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"hyenimc/backend/internal/cache"
	"hyenimc/backend/internal/domain"
)

// ShaderPackCacheService handles shader pack caching logic
type ShaderPackCacheService struct {
	repo    *cache.ShaderPackRepository
	dataDir string
}

// NewShaderPackCacheService creates a new shader pack cache service
func NewShaderPackCacheService(repo *cache.ShaderPackRepository, dataDir string) *ShaderPackCacheService {
	return &ShaderPackCacheService{
		repo:    repo,
		dataDir: dataDir,
	}
}

// SyncShaderPacks synchronizes the shader pack cache with the file system
func (s *ShaderPackCacheService) SyncShaderPacks(ctx context.Context, profileID string, shadersDir string) ([]*domain.ShaderPack, error) {
	// Get cached packs
	cachedPacks, err := s.repo.ListByProfile(profileID)
	if err != nil {
		return nil, fmt.Errorf("failed to get cached shader packs: %w", err)
	}

	// Create a map for quick lookup
	cacheMap := make(map[string]*domain.ShaderPack)
	for _, pack := range cachedPacks {
		cacheMap[pack.FileName] = pack
	}

	// Scan shaders directory
	entries, err := os.ReadDir(shadersDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []*domain.ShaderPack{}, nil
		}
		return nil, fmt.Errorf("failed to read shader packs directory: %w", err)
	}

	var result []*domain.ShaderPack
	foundFiles := make(map[string]bool)

	for _, entry := range entries {
		fileName := entry.Name()
		foundFiles[fileName] = true
		filePath := filepath.Join(shadersDir, fileName)

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

		// File is new or modified, create/update cache entry
		pack := &domain.ShaderPack{
			ID:           uuid.New().String(),
			ProfileID:    profileID,
			FileName:     fileName,
			FilePath:     filePath,
			IsDirectory:  isDir,
			Enabled:      false, // Must be manually enabled
			LastModified: info.ModTime(),
			CreatedAt:    time.Now(),
			UpdatedAt:    time.Now(),
		}

		// Calculate hash for zip files
		if !isDir {
			hash, err := calculateFileHash(filePath)
			if err == nil {
				pack.FileHash = hash
			}
		}

		// Save to cache
		if err := s.repo.Save(pack); err != nil {
			return nil, fmt.Errorf("failed to save shader pack to cache: %w", err)
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

// GetShaderPacks retrieves shader packs with automatic cache refresh
func (s *ShaderPackCacheService) GetShaderPacks(ctx context.Context, profileID string, shadersDir string, forceRefresh bool) ([]*domain.ShaderPack, error) {
	if forceRefresh {
		return s.SyncShaderPacks(ctx, profileID, shadersDir)
	}

	// Try cache first
	packs, err := s.repo.ListByProfile(profileID)
	if err != nil {
		return nil, err
	}

	// If cache is empty, do a full sync
	if len(packs) == 0 {
		return s.SyncShaderPacks(ctx, profileID, shadersDir)
	}

	// Quick check: detect if file system has changed
	needsSync, err := s.checkIfSyncNeeded(profileID, shadersDir, packs)
	if err != nil {
		// On error, return cached data (better than failing)
		return packs, nil
	}

	if needsSync {
		return s.SyncShaderPacks(ctx, profileID, shadersDir)
	}

	return packs, nil
}

// checkIfSyncNeeded performs a quick check to see if file system differs from cache
func (s *ShaderPackCacheService) checkIfSyncNeeded(profileID string, shadersDir string, cachedPacks []*domain.ShaderPack) (bool, error) {
	// Check if shaders directory exists
	entries, err := os.ReadDir(shadersDir)
	if err != nil {
		if os.IsNotExist(err) {
			// Directory doesn't exist but we have cached packs = needs sync
			return len(cachedPacks) > 0, nil
		}
		return false, err
	}

	// Count actual shader pack files in directory (zip or directories)
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

// ToggleShaderPack enables or disables a shader pack
func (s *ShaderPackCacheService) ToggleShaderPack(ctx context.Context, packID string, enabled bool) error {
	return s.repo.UpdateEnabled(packID, enabled)
}
