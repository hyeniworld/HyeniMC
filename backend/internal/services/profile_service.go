package services

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"hyenimc/backend/internal/domain"
	"hyenimc/backend/internal/profile"
)

// ProfileService implements profile management business logic
type ProfileService struct {
	repo    *profile.Repository
	dataDir string
}

// NewProfileService creates a new profile service (using SQLite)
func NewProfileService(repo *profile.Repository, dataDir string) *ProfileService {
	return &ProfileService{
		repo:    repo,
		dataDir: dataDir,
	}
}

// CreateProfile creates a new profile
func (s *ProfileService) CreateProfile(ctx context.Context, req *domain.CreateProfileRequest) (*domain.Profile, error) {
	// Validate input
	if req.Name == "" {
		return nil, fmt.Errorf("profile name is required")
	}
	if req.GameVersion == "" {
		return nil, fmt.Errorf("game version is required")
	}
	if req.LoaderType == "" {
		return nil, fmt.Errorf("loader type is required")
	}

	// Create profile with empty memory settings
	// Memory will inherit from global settings at launch time
	profileID := uuid.New().String()
	
	// GameDirectory should be: {dataDir}/../instances/{profile-id}
	// dataDir is typically: C:\Users\xxx\AppData\Roaming\HyeniMC\data
	// instances is at: C:\Users\xxx\AppData\Roaming\HyeniMC\instances
	parentDir := filepath.Dir(s.dataDir) // Remove "data" from path
	gameDir := filepath.Join(parentDir, "instances", profileID)
	
	profile := &domain.Profile{
		ID:            profileID,
		Name:          req.Name,
		Description:   req.Description,
		Icon:          req.Icon,
		GameVersion:   req.GameVersion,
		LoaderType:    req.LoaderType,
		LoaderVersion: req.LoaderVersion,
		GameDirectory: gameDir,
		JvmArgs:       []string{},
		Memory: domain.Memory{
			Min: 0, // 0 means inherit from global settings
			Max: 0, // 0 means inherit from global settings
		},
		GameArgs:      []string{},
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
		TotalPlayTime: 0,
	}

	// Create game directory (and subdirectories) if they don't exist
	if err := os.MkdirAll(gameDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create game directory: %w", err)
	}

	// Create essential subdirectories
	for _, subdir := range []string{"mods", "config", "resourcepacks", "shaderpacks", "saves"} {
		if err := os.MkdirAll(filepath.Join(gameDir, subdir), 0755); err != nil {
			return nil, fmt.Errorf("failed to create %s directory: %w", subdir, err)
		}
	}

	// Save profile
	if err := s.repo.Save(profile); err != nil {
		return nil, fmt.Errorf("failed to save profile: %w", err)
	}

	return profile, nil
}

// GetProfile retrieves a profile by ID
func (s *ProfileService) GetProfile(ctx context.Context, id string) (*domain.Profile, error) {
	profile, err := s.repo.Get(id)
	if err != nil {
		return nil, err
	}
	
	// Auto-fix invalid memory settings from old data
	if profile.Memory.Min > 0 && profile.Memory.Max > 0 && profile.Memory.Min > profile.Memory.Max {
		profile.Memory.Max = profile.Memory.Min
		// Save the corrected values
		if updateErr := s.repo.Update(profile); updateErr != nil {
			// Log but don't fail - return the corrected profile anyway
			fmt.Printf("Warning: Failed to save corrected memory settings for profile %s: %v\n", id, updateErr)
		}
	}
	
	return profile, nil
}

// ListProfiles retrieves all profiles
func (s *ProfileService) ListProfiles(ctx context.Context) ([]*domain.Profile, error) {
	profiles, err := s.repo.List()
	if err != nil {
		return nil, err
	}
	
	// Auto-fix invalid memory settings from old data for all profiles
	for _, profile := range profiles {
		if profile.Memory.Min > 0 && profile.Memory.Max > 0 && profile.Memory.Min > profile.Memory.Max {
			profile.Memory.Max = profile.Memory.Min
			// Save the corrected values
			if updateErr := s.repo.Update(profile); updateErr != nil {
				// Log but don't fail - return the corrected profile anyway
				fmt.Printf("Warning: Failed to save corrected memory settings for profile %s: %v\n", profile.ID, updateErr)
			}
		}
	}
	
	return profiles, nil
}

// UpdateProfile updates an existing profile
func (s *ProfileService) UpdateProfile(ctx context.Context, id string, updates map[string]interface{}) (*domain.Profile, error) {
	profile, err := s.repo.Get(id)
	if err != nil {
		return nil, err
	}

	// Apply updates
	if name, ok := updates["name"].(string); ok && name != "" {
		profile.Name = name
	}
	if desc, ok := updates["description"].(string); ok {
		profile.Description = desc
	}
	if icon, ok := updates["icon"].(string); ok {
		profile.Icon = icon
	}
	if gameVersion, ok := updates["gameVersion"].(string); ok && gameVersion != "" {
		profile.GameVersion = gameVersion
	}
	if loaderType, ok := updates["loaderType"].(string); ok && loaderType != "" {
		profile.LoaderType = loaderType
	}
	if loaderVersion, ok := updates["loaderVersion"].(string); ok {
		profile.LoaderVersion = loaderVersion
	}
	if javaPath, ok := updates["javaPath"].(string); ok {
		profile.JavaPath = javaPath
	}
	if serverAddr, ok := updates["serverAddress"].(string); ok {
		profile.ServerAddress = serverAddr
	}
	if favorite, ok := updates["favorite"].(bool); ok {
		profile.Favorite = favorite
	}
	if gameDir, ok := updates["gameDirectory"].(string); ok {
		profile.GameDirectory = gameDir
	}
	
	// Handle JVM arguments
	if jvmArgs, ok := updates["jvmArgs"].([]interface{}); ok {
		args := make([]string, 0, len(jvmArgs))
		for _, arg := range jvmArgs {
			if str, ok := arg.(string); ok {
				args = append(args, str)
			}
		}
		profile.JvmArgs = args
	}
	
	// Handle game arguments
	if gameArgs, ok := updates["gameArgs"].([]interface{}); ok {
		args := make([]string, 0, len(gameArgs))
		for _, arg := range gameArgs {
			if str, ok := arg.(string); ok {
				args = append(args, str)
			}
		}
		profile.GameArgs = args
	}
	
	// Handle resolution settings (both nested and flat formats)
	if resolution, ok := updates["resolution"].(map[string]interface{}); ok {
		if width, ok := resolution["width"].(float64); ok {
			profile.Resolution.Width = int32(width)
		}
		if height, ok := resolution["height"].(float64); ok {
			profile.Resolution.Height = int32(height)
		}
	}
	// Also check flat format (from gRPC)
	if resWidth, ok := updates["resolutionWidth"].(float64); ok {
		profile.Resolution.Width = int32(resWidth)
	}
	if resHeight, ok := updates["resolutionHeight"].(float64); ok {
		profile.Resolution.Height = int32(resHeight)
	}
	
	// Handle fullscreen setting
	if fullscreen, ok := updates["fullscreen"].(bool); ok {
		profile.Fullscreen = fullscreen
	}
	
	// Handle memory settings (support both minMemory/maxMemory and memory.min/memory.max formats)
	if minMemory, ok := updates["minMemory"].(float64); ok {
		profile.Memory.Min = int32(minMemory)
	}
	if maxMemory, ok := updates["maxMemory"].(float64); ok {
		profile.Memory.Max = int32(maxMemory)
	}
	// Also check nested memory object
	if memory, ok := updates["memory"].(map[string]interface{}); ok {
		if min, ok := memory["min"].(float64); ok {
			profile.Memory.Min = int32(min)
		}
		if max, ok := memory["max"].(float64); ok {
			profile.Memory.Max = int32(max)
		}
	}

	// Validate memory settings: ensure min <= max (only if both are set)
	if profile.Memory.Min > 0 && profile.Memory.Max > 0 && profile.Memory.Min > profile.Memory.Max {
		// Auto-adjust: set max to min
		profile.Memory.Max = profile.Memory.Min
	}

	profile.UpdatedAt = time.Now()

	if err := s.repo.Update(profile); err != nil {
		return nil, fmt.Errorf("failed to update profile: %w", err)
	}

	return profile, nil
}

// DeleteProfile deletes a profile by ID
func (s *ProfileService) DeleteProfile(ctx context.Context, id string) error {
	return s.repo.Delete(id)
}

// sanitizeName creates a safe directory name from a profile name
func sanitizeName(name string) string {
	name = strings.ToLower(name)
	name = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		return '-'
	}, name)
	return name
}
