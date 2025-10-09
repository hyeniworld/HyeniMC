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

	// Create profile
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
			Min: 2048,
			Max: 4096,
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
