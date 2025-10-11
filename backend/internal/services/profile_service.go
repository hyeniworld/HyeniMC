package services

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"hyenimc/backend/internal/domain"
	"hyenimc/backend/internal/repo"

	"github.com/google/uuid"
)

// ProfileService implements profile management business logic
type ProfileService struct {
	repo    *repo.ProfileRepository
	dataDir string
}

// NewProfileService creates a new profile service
func NewProfileService(dataDir string) (*ProfileService, error) {
	repo, err := repo.NewProfileRepository(dataDir)
	if err != nil {
		return nil, err
	}
	return &ProfileService{
		repo:    repo,
		dataDir: dataDir,
	}, nil
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
	profile := &domain.Profile{
		ID:            uuid.New().String(),
		Name:          req.Name,
		Description:   req.Description,
		Icon:          req.Icon,
		GameVersion:   req.GameVersion,
		LoaderType:    req.LoaderType,
		LoaderVersion: req.LoaderVersion,
		GameDirectory: filepath.Join(s.dataDir, "instances", sanitizeName(req.Name)),
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

	// Save profile
	if err := s.repo.Save(profile); err != nil {
		return nil, fmt.Errorf("failed to save profile: %w", err)
	}

	return profile, nil
}

// GetProfile retrieves a profile by ID
func (s *ProfileService) GetProfile(ctx context.Context, id string) (*domain.Profile, error) {
	return s.repo.Get(id)
}

// ListProfiles retrieves all profiles
func (s *ProfileService) ListProfiles(ctx context.Context) ([]*domain.Profile, error) {
	return s.repo.List()
}

// UpdateProfile updates an existing profile
func (s *ProfileService) UpdateProfile(ctx context.Context, id string, updates map[string]interface{}) (*domain.Profile, error) {
	profile, err := s.repo.Get(id)
	if err != nil {
		return nil, err
	}

	fmt.Printf("[ProfileService] Updating profile %s with updates: %+v\n", id, updates)
	fmt.Printf("[ProfileService] Current memory: min=%d, max=%d\n", profile.Memory.Min, profile.Memory.Max)

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
	
	// Handle resolution settings
	if resolution, ok := updates["resolution"].(map[string]interface{}); ok {
		if width, ok := resolution["width"].(float64); ok {
			profile.Resolution.Width = int32(width)
		}
		if height, ok := resolution["height"].(float64); ok {
			profile.Resolution.Height = int32(height)
		}
	}
	
	// Handle fullscreen setting
	if fullscreen, ok := updates["fullscreen"].(bool); ok {
		profile.Fullscreen = fullscreen
	}
	
	// Handle memory settings (support both minMemory/maxMemory and memory.min/memory.max formats)
	if minMemory, ok := updates["minMemory"].(float64); ok {
		fmt.Printf("[ProfileService] Setting min memory from minMemory: %f -> %d\n", minMemory, int32(minMemory))
		profile.Memory.Min = int32(minMemory)
	}
	if maxMemory, ok := updates["maxMemory"].(float64); ok {
		fmt.Printf("[ProfileService] Setting max memory from maxMemory: %f -> %d\n", maxMemory, int32(maxMemory))
		profile.Memory.Max = int32(maxMemory)
	}
	// Also check nested memory object
	if memory, ok := updates["memory"].(map[string]interface{}); ok {
		if min, ok := memory["min"].(float64); ok {
			fmt.Printf("[ProfileService] Setting min memory from memory.min: %f -> %d\n", min, int32(min))
			profile.Memory.Min = int32(min)
		}
		if max, ok := memory["max"].(float64); ok {
			fmt.Printf("[ProfileService] Setting max memory from memory.max: %f -> %d\n", max, int32(max))
			profile.Memory.Max = int32(max)
		}
	}

	fmt.Printf("[ProfileService] After updates, memory: min=%d, max=%d\n", profile.Memory.Min, profile.Memory.Max)

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
