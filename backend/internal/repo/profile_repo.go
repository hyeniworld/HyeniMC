package repo

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"hyenimc/backend/internal/domain"
)

// ProfileRepository handles profile persistence
type ProfileRepository struct {
	dataDir string
}

// NewProfileRepository creates a new profile repository
func NewProfileRepository(dataDir string) (*ProfileRepository, error) {
	profilesDir := filepath.Join(dataDir, "profiles")
	if err := os.MkdirAll(profilesDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create profiles directory: %w", err)
	}
	return &ProfileRepository{dataDir: dataDir}, nil
}

// Save saves a profile to disk
func (r *ProfileRepository) Save(profile *domain.Profile) error {
	profilesDir := filepath.Join(r.dataDir, "profiles")
	filePath := filepath.Join(profilesDir, profile.ID+".json")
	
	data, err := json.MarshalIndent(profile, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal profile: %w", err)
	}
	
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return fmt.Errorf("failed to write profile file: %w", err)
	}
	
	return nil
}

// Get retrieves a profile by ID
func (r *ProfileRepository) Get(id string) (*domain.Profile, error) {
	profilesDir := filepath.Join(r.dataDir, "profiles")
	filePath := filepath.Join(profilesDir, id+".json")
	
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("profile not found: %s", id)
		}
		return nil, fmt.Errorf("failed to read profile file: %w", err)
	}
	
	var profile domain.Profile
	if err := json.Unmarshal(data, &profile); err != nil {
		return nil, fmt.Errorf("failed to unmarshal profile: %w", err)
	}
	
	return &profile, nil
}

// List retrieves all profiles
func (r *ProfileRepository) List() ([]*domain.Profile, error) {
	profilesDir := filepath.Join(r.dataDir, "profiles")
	
	entries, err := os.ReadDir(profilesDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []*domain.Profile{}, nil
		}
		return nil, fmt.Errorf("failed to read profiles directory: %w", err)
	}
	
	var profiles []*domain.Profile
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		
		id := strings.TrimSuffix(entry.Name(), ".json")
		profile, err := r.Get(id)
		if err != nil {
			continue // Skip corrupted profiles
		}
		profiles = append(profiles, profile)
	}
	
	return profiles, nil
}

// Delete removes a profile from disk
func (r *ProfileRepository) Delete(id string) error {
	profilesDir := filepath.Join(r.dataDir, "profiles")
	filePath := filepath.Join(profilesDir, id+".json")
	
	if err := os.Remove(filePath); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("profile not found: %s", id)
		}
		return fmt.Errorf("failed to delete profile file: %w", err)
	}
	
	return nil
}

// Update updates an existing profile
func (r *ProfileRepository) Update(profile *domain.Profile) error {
	// Check if profile exists
	if _, err := r.Get(profile.ID); err != nil {
		return err
	}
	
	profile.UpdatedAt = time.Now()
	return r.Save(profile)
}
