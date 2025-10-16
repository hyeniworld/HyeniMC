package settings

import (
	"fmt"
	"strconv"
)

// Service handles settings business logic
type Service struct {
	repo *Repository
}

// NewService creates a new settings service
func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// GlobalSettings represents all global settings
type GlobalSettings struct {
	JavaPath    string
	MemoryMin   int32
	MemoryMax   int32
	
	ResolutionWidth  int32
	ResolutionHeight int32
	Fullscreen       bool
	
	DownloadTimeoutMs  int32
	DownloadMaxRetries int32
	DownloadMaxParallel int32
	
	CacheEnabled   bool
	CacheMaxSizeGB int32
	CacheTTLDays   int32
}

// Get retrieves all global settings
func (s *Service) Get() (*GlobalSettings, error) {
	all, err := s.repo.GetAll()
	if err != nil {
		return nil, err
	}

	// If no settings exist, initialize with defaults
	if len(all) == 0 {
		defaults := GetDefaultSettings()
		if err := s.repo.SetBatch(defaults); err != nil {
			return nil, fmt.Errorf("failed to initialize default settings: %w", err)
		}
		all = defaults
	}

	return &GlobalSettings{
		JavaPath:    all[KeyJavaPath],
		MemoryMin:   parseInt32(all[KeyMemoryMin], DefaultMemoryMin),
		MemoryMax:   parseInt32(all[KeyMemoryMax], DefaultMemoryMax),
		
		ResolutionWidth:  parseInt32(all[KeyResolutionWidth], DefaultResolutionWidth),
		ResolutionHeight: parseInt32(all[KeyResolutionHeight], DefaultResolutionHeight),
		Fullscreen:       parseBool(all[KeyFullscreen], DefaultFullscreen),
		
		DownloadTimeoutMs:  parseInt32(all[KeyDownloadTimeoutMs], DefaultDownloadTimeoutMs),
		DownloadMaxRetries: parseInt32(all[KeyDownloadMaxRetries], DefaultDownloadMaxRetries),
		DownloadMaxParallel: parseInt32(all[KeyDownloadMaxParallel], DefaultDownloadMaxParallel),
		
		CacheEnabled:   parseBool(all[KeyCacheEnabled], DefaultCacheEnabled),
		CacheMaxSizeGB: parseInt32(all[KeyCacheMaxSizeGB], DefaultCacheMaxSizeGB),
		CacheTTLDays:   parseInt32(all[KeyCacheTTLDays], DefaultCacheTTLDays),
	}, nil
}

// Update updates global settings
func (s *Service) Update(settings *GlobalSettings) error {
	// Validate memory settings: ensure min <= max
	if settings.MemoryMin > settings.MemoryMax {
		// Auto-adjust: set max to min
		settings.MemoryMax = settings.MemoryMin
	}
	
	values := map[string]string{
		KeyJavaPath:    settings.JavaPath,
		KeyMemoryMin:   fmt.Sprintf("%d", settings.MemoryMin),
		KeyMemoryMax:   fmt.Sprintf("%d", settings.MemoryMax),
		
		KeyResolutionWidth:  fmt.Sprintf("%d", settings.ResolutionWidth),
		KeyResolutionHeight: fmt.Sprintf("%d", settings.ResolutionHeight),
		KeyFullscreen:       fmt.Sprintf("%t", settings.Fullscreen),
		
		KeyDownloadTimeoutMs:  fmt.Sprintf("%d", settings.DownloadTimeoutMs),
		KeyDownloadMaxRetries: fmt.Sprintf("%d", settings.DownloadMaxRetries),
		KeyDownloadMaxParallel: fmt.Sprintf("%d", settings.DownloadMaxParallel),
		
		KeyCacheEnabled:   fmt.Sprintf("%t", settings.CacheEnabled),
		KeyCacheMaxSizeGB: fmt.Sprintf("%d", settings.CacheMaxSizeGB),
		KeyCacheTTLDays:   fmt.Sprintf("%d", settings.CacheTTLDays),
	}

	return s.repo.SetBatch(values)
}

// Reset resets all settings to defaults
func (s *Service) Reset() error {
	if err := s.repo.Clear(); err != nil {
		return err
	}
	return s.repo.SetBatch(GetDefaultSettings())
}

// Helper functions
func parseInt32(s string, defaultValue int32) int32 {
	if s == "" {
		return defaultValue
	}
	i, err := strconv.ParseInt(s, 10, 32)
	if err != nil {
		return defaultValue
	}
	return int32(i)
}

func parseBool(s string, defaultValue bool) bool {
	if s == "" {
		return defaultValue
	}
	b, err := strconv.ParseBool(s)
	if err != nil {
		return defaultValue
	}
	return b
}
