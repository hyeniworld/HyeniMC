package services

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"hyenimc/backend/internal/cache"
	"hyenimc/backend/internal/domain"
)

// ModCacheService handles mod caching logic
type ModCacheService struct {
	repo    *cache.ModRepository
	dataDir string
}

// NewModCacheService creates a new mod cache service
func NewModCacheService(repo *cache.ModRepository, dataDir string) *ModCacheService {
	return &ModCacheService{
		repo:    repo,
		dataDir: dataDir,
	}
}

// SyncMods synchronizes the mod cache with the file system
func (s *ModCacheService) SyncMods(ctx context.Context, profileID string, modsDir string) ([]*domain.Mod, error) {
	// Get cached mods
	cachedMods, err := s.repo.ListByProfile(profileID)
	if err != nil {
		return nil, fmt.Errorf("failed to get cached mods: %w", err)
	}

	// Create a map for quick lookup
	cacheMap := make(map[string]*domain.Mod)
	for _, mod := range cachedMods {
		cacheMap[mod.FileName] = mod
	}

	// Scan mods directory
	entries, err := os.ReadDir(modsDir)
	if err != nil {
		if os.IsNotExist(err) {
			// Mods directory doesn't exist yet, return empty list
			return []*domain.Mod{}, nil
		}
		return nil, fmt.Errorf("failed to read mods directory: %w", err)
	}

	var result []*domain.Mod
	var modsToSave []*domain.Mod // Collect mods to save in batch
	foundFiles := make(map[string]bool)

	// First pass: scan all files
	for _, entry := range entries {
		fileName := entry.Name()
		
		// Skip directories
		if entry.IsDir() {
			continue
		}
		
		// Only process .jar and .jar.disabled files
		if !strings.HasSuffix(fileName, ".jar") && !strings.HasSuffix(fileName, ".jar.disabled") {
			log.Printf("[ModCache] Skipping non-jar file: %s", fileName)
			continue
		}

		foundFiles[fileName] = true
		filePath := filepath.Join(modsDir, fileName)

		// Get file info
		info, err := entry.Info()
		if err != nil {
			continue
		}

		// Check if file is in cache and unchanged
		cached, exists := cacheMap[fileName]
		if exists && cached.LastModified.Unix() == info.ModTime().Unix() {
			// File unchanged, use cache
			result = append(result, cached)
			continue
		}

		// File is new or modified, parse and update cache
		mod, err := s.parseModFile(profileID, filePath, info)
		if err != nil {
			// If parsing fails, create a minimal entry
			mod = &domain.Mod{
				ID:           uuid.New().String(),
				ProfileID:    profileID,
				FileName:     fileName,
				FilePath:     filePath,
				FileSize:     info.Size(),
				Enabled:      !strings.HasSuffix(fileName, ".disabled"),
				Source:       "local",
				LastModified: info.ModTime(),
				CreatedAt:    time.Now(),
				UpdatedAt:    time.Now(),
			}
		}

		modsToSave = append(modsToSave, mod)
		result = append(result, mod)
	}

	// Second pass: save all new/modified mods to cache in one transaction
	if len(modsToSave) > 0 {
		if err := s.repo.BatchSave(modsToSave); err != nil {
			// Log error but don't fail - still return the scanned results
			fmt.Printf("Warning: failed to batch save mods to cache: %v\n", err)
		}
	}

	// Remove cached mods that no longer exist on disk
	for fileName, cached := range cacheMap {
		if !foundFiles[fileName] {
			s.repo.Delete(cached.ID)
		}
	}

	return result, nil
}

// parseModFile extracts metadata from a JAR file
func (s *ModCacheService) parseModFile(profileID, filePath string, info os.FileInfo) (*domain.Mod, error) {
	// Calculate file hash
	hash, err := calculateFileHash(filePath)
	if err != nil {
		return nil, err
	}

	mod := &domain.Mod{
		ID:           uuid.New().String(),
		ProfileID:    profileID,
		FileName:     filepath.Base(filePath),
		FilePath:     filePath,
		FileHash:     hash,
		FileSize:     info.Size(),
		Enabled:      !strings.HasSuffix(filepath.Base(filePath), ".disabled"),
		Source:       "local",
		LastModified: info.ModTime(),
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	// Try to load source metadata from unified metadata (priority) or legacy .meta.json
	modsDir := filepath.Dir(filePath)
	fileName := filepath.Base(filePath)
	
	// 1. Try unified metadata first
	if unified, err := loadUnifiedMetadata(modsDir); err == nil {
		if modMeta, exists := unified.Mods[fileName]; exists {
			mod.Source = modMeta.Source
			mod.SourceModID = modMeta.SourceModID
			mod.SourceFileID = modMeta.SourceFileID
		} else {
			// 2. Fallback to legacy .meta.json
			metaPath := filePath + ".meta.json"
			if metaData, err := loadMetadataFile(metaPath); err == nil {
				mod.Source = metaData.Source
				mod.SourceModID = metaData.SourceModID
				mod.SourceFileID = metaData.SourceFileID
			}
		}
	} else {
		// If unified metadata doesn't exist, try legacy
		metaPath := filePath + ".meta.json"
		if metaData, err := loadMetadataFile(metaPath); err == nil {
			mod.Source = metaData.Source
			mod.SourceModID = metaData.SourceModID
			mod.SourceFileID = metaData.SourceFileID
		}
	}

	// Try to extract metadata from JAR
	metadata, err := extractModMetadata(filePath)
	if err == nil && metadata != nil {
		mod.ModID = metadata.ModID
		mod.Name = metadata.Name
		mod.Version = metadata.Version
		mod.Description = metadata.Description
		mod.Authors = metadata.Authors
	}

	return mod, nil
}

// ModMetadata represents extracted mod information
type ModMetadata struct {
	ModID       string
	Name        string
	Version     string
	Description string
	Authors     []string
}

// extractModMetadata reads mod metadata from JAR file
func extractModMetadata(jarPath string) (*ModMetadata, error) {
	r, err := zip.OpenReader(jarPath)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	// Try Fabric/Quilt mod.json
	for _, file := range r.File {
		if file.Name == "fabric.mod.json" || file.Name == "quilt.mod.json" {
			return parseFabricModJSON(file)
		}
	}

	// Try NeoForge/Forge mods.toml (NeoForge uses neoforge.mods.toml)
	for _, file := range r.File {
		if file.Name == "META-INF/neoforge.mods.toml" || file.Name == "META-INF/mods.toml" {
			return parseForgeModsTOML(file)
		}
	}

	return nil, fmt.Errorf("no mod metadata found")
}

func parseFabricModJSON(file *zip.File) (*ModMetadata, error) {
	rc, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	var data map[string]interface{}
	if err := json.NewDecoder(rc).Decode(&data); err != nil {
		return nil, err
	}

	metadata := &ModMetadata{
		ModID:       getStringField(data, "id"),
		Name:        getStringField(data, "name"),
		Version:     getStringField(data, "version"),
		Description: getStringField(data, "description"),
	}

	// Extract authors
	if authors, ok := data["authors"].([]interface{}); ok {
		for _, author := range authors {
			if str, ok := author.(string); ok {
				metadata.Authors = append(metadata.Authors, str)
			} else if obj, ok := author.(map[string]interface{}); ok {
				if name, ok := obj["name"].(string); ok {
					metadata.Authors = append(metadata.Authors, name)
				}
			}
		}
	}

	return metadata, nil
}

func parseForgeModsTOML(file *zip.File) (*ModMetadata, error) {
	rc, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()

	data, err := io.ReadAll(rc)
	if err != nil {
		return nil, err
	}

	content := string(data)
	metadata := &ModMetadata{}
	
	// Simple TOML parser for [[mods]] section
	// Note: Only parse the FIRST [[mods]] section, as it contains the main mod info
	lines := strings.Split(content, "\n")
	inModsSection := false
	foundFirstModsSection := false
	
	for _, line := range lines {
		line = strings.TrimSpace(line)
		
		// Skip comments and empty lines
		if strings.HasPrefix(line, "#") || line == "" {
			continue
		}
		
		// Check for [[mods]] section
		if strings.HasPrefix(line, "[[mods]]") {
			if foundFirstModsSection {
				// We've already processed the first [[mods]] section, stop here
				break
			}
			inModsSection = true
			foundFirstModsSection = true
			continue
		}
		
		// Check for other sections (like [[dependencies.*]])
		if strings.HasPrefix(line, "[[") && strings.HasSuffix(line, "]]") {
			// We've hit another section, stop parsing
			if inModsSection {
				break
			}
			continue
		}
		
		// Only parse within [[mods]] section
		if !inModsSection {
			continue
		}
		
		// Parse key=value
		if strings.Contains(line, "=") {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) != 2 {
				continue
			}
			
			key := strings.TrimSpace(parts[0])
			value := strings.TrimSpace(parts[1])
			
			// Remove quotes
			value = strings.Trim(value, `"'`)
			
			// Handle variable substitution
			if strings.Contains(value, "${") {
				value = "unknown"
			}
			
			switch key {
			case "modId":
				metadata.ModID = value
			case "displayName":
				metadata.Name = value
			case "version":
				metadata.Version = value
			case "description":
				metadata.Description = value
			case "authors":
				metadata.Authors = []string{value}
			}
		}
	}
	
	return metadata, nil
}

func getStringField(data map[string]interface{}, key string) string {
	if val, ok := data[key].(string); ok {
		return val
	}
	return ""
}

func calculateFileHash(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}

	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

// GetMods retrieves mods with automatic cache refresh
func (s *ModCacheService) GetMods(ctx context.Context, profileID string, modsDir string, forceRefresh bool) ([]*domain.Mod, error) {
	if forceRefresh {
		return s.SyncMods(ctx, profileID, modsDir)
	}

	// Try cache first
	mods, err := s.repo.ListByProfile(profileID)
	if err != nil {
		return nil, err
	}

	// Filter out invalid entries (non-.jar files that might have been cached incorrectly)
	validMods := make([]*domain.Mod, 0, len(mods))
	for _, mod := range mods {
		if strings.HasSuffix(mod.FileName, ".jar") || strings.HasSuffix(mod.FileName, ".jar.disabled") {
			validMods = append(validMods, mod)
		}
	}

	// If cache is empty, do a full sync
	if len(validMods) == 0 {
		return s.SyncMods(ctx, profileID, modsDir)
	}

	// Quick check: detect if file system has changed
	needsSync, err := s.checkIfSyncNeeded(profileID, modsDir, validMods)
	if err != nil {
		log.Printf("[ModCache] Warning: failed to check if sync needed: %v", err)
		// On error, return cached data (better than failing)
		return validMods, nil
	}

	if needsSync {
		log.Printf("[ModCache] File system changes detected, syncing mods for profile %s", profileID)
		return s.SyncMods(ctx, profileID, modsDir)
	}

	return validMods, nil
}

// checkIfSyncNeeded performs a quick check to see if file system differs from cache
func (s *ModCacheService) checkIfSyncNeeded(profileID string, modsDir string, cachedMods []*domain.Mod) (bool, error) {
	// Check if mods directory exists
	entries, err := os.ReadDir(modsDir)
	if err != nil {
		if os.IsNotExist(err) {
			// Directory doesn't exist but we have cached mods = needs sync
			return len(cachedMods) > 0, nil
		}
		return false, err
	}

	// Count actual .jar files in directory
	actualJarFiles := make(map[string]os.FileInfo)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		fileName := entry.Name()
		if strings.HasSuffix(fileName, ".jar") || strings.HasSuffix(fileName, ".jar.disabled") {
			info, err := entry.Info()
			if err != nil {
				continue
			}
			actualJarFiles[fileName] = info
		}
	}

	// Quick check 1: Different number of files
	if len(actualJarFiles) != len(cachedMods) {
		log.Printf("[ModCache] File count mismatch: %d actual vs %d cached", len(actualJarFiles), len(cachedMods))
		return true, nil
	}

	// Quick check 2: Check if all cached files still exist with same modification time
	for _, cached := range cachedMods {
		actual, exists := actualJarFiles[cached.FileName]
		if !exists {
			// Cached file no longer exists
			log.Printf("[ModCache] Cached file missing: %s", cached.FileName)
			return true, nil
		}

		// Check modification time
		if actual.ModTime().Unix() != cached.LastModified.Unix() {
			log.Printf("[ModCache] File modified: %s (cache: %v, actual: %v)", 
				cached.FileName, cached.LastModified, actual.ModTime())
			return true, nil
		}
	}

	// All checks passed, cache is up to date
	return false, nil
}

// ToggleMod enables or disables a mod
func (s *ModCacheService) ToggleMod(ctx context.Context, modID string, enabled bool) error {
	mod, err := s.repo.Get(modID)
	if err != nil {
		return err
	}

	// Rename file to toggle .disabled extension
	oldFileName := filepath.Base(mod.FilePath)
	newPath := mod.FilePath
	if enabled && strings.HasSuffix(mod.FilePath, ".disabled") {
		newPath = strings.TrimSuffix(mod.FilePath, ".disabled")
	} else if !enabled && !strings.HasSuffix(mod.FilePath, ".disabled") {
		newPath = mod.FilePath + ".disabled"
	}

	if newPath != mod.FilePath {
		if err := os.Rename(mod.FilePath, newPath); err != nil {
			return fmt.Errorf("failed to rename mod file: %w", err)
		}

		mod.FilePath = newPath
		mod.FileName = filepath.Base(newPath)
		mod.Enabled = enabled
		mod.UpdatedAt = time.Now()

		if err := s.repo.Save(mod); err != nil {
			return fmt.Errorf("failed to update mod cache: %w", err)
		}

		// Update unified metadata
		modsDir := filepath.Dir(mod.FilePath)
		newFileName := filepath.Base(newPath)
		
		unified, err := loadUnifiedMetadata(modsDir)
		if err == nil && unified != nil {
			// Rename metadata key
			if metadata, exists := unified.Mods[oldFileName]; exists {
				unified.Mods[newFileName] = metadata
				delete(unified.Mods, oldFileName)
				
				if saveErr := saveUnifiedMetadata(modsDir, unified); saveErr != nil {
					log.Printf("[ModCacheService] Failed to update unified metadata: %v", saveErr)
				} else {
					log.Printf("[ModCacheService] Updated unified metadata: %s -> %s", oldFileName, newFileName)
				}
			}
		}
	}

	return nil
}

// SourceMetadata represents source information stored in .meta.json files
type SourceMetadata struct {
	Source       string `json:"source"`
	SourceModID  string `json:"sourceModId"`
	SourceFileID string `json:"sourceFileId"`
	InstalledAt  string `json:"installedAt"`
}

// UnifiedMetadata represents the unified .hyenimc-metadata.json structure
type UnifiedMetadata struct {
	Version   int                       `json:"version"`
	Source    string                    `json:"source"`
	Mods      map[string]SourceMetadata `json:"mods"`
}

// loadUnifiedMetadata loads metadata from .hyenimc-metadata.json
func loadUnifiedMetadata(modsDir string) (*UnifiedMetadata, error) {
	metaPath := filepath.Join(modsDir, ".hyenimc-metadata.json")
	data, err := os.ReadFile(metaPath)
	if err != nil {
		return nil, err
	}

	var unified UnifiedMetadata
	if err := json.Unmarshal(data, &unified); err != nil {
		return nil, err
	}

	return &unified, nil
}

// saveUnifiedMetadata saves metadata to .hyenimc-metadata.json
func saveUnifiedMetadata(modsDir string, unified *UnifiedMetadata) error {
	metaPath := filepath.Join(modsDir, ".hyenimc-metadata.json")
	data, err := json.MarshalIndent(unified, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(metaPath, data, 0644)
}

// loadMetadataFile loads source metadata from .meta.json file (legacy)
func loadMetadataFile(path string) (*SourceMetadata, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var metadata SourceMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return nil, err
	}

	return &metadata, nil
}
