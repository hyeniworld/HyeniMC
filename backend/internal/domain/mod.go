package domain

import "time"

// Mod represents a cached mod file
type Mod struct {
	ID            string    `json:"id"`
	ProfileID     string    `json:"profileId"`
	FileName      string    `json:"fileName"`
	FilePath      string    `json:"filePath"`
	FileHash      string    `json:"fileHash"`
	FileSize      int64     `json:"fileSize"`
	ModID         string    `json:"modId"`         // modrinth/curseforge ID
	Name          string    `json:"name"`
	Version       string    `json:"version"`
	Description   string    `json:"description"`
	Authors       []string  `json:"authors"`
	Enabled       bool      `json:"enabled"`
	Source        string    `json:"source"`        // "modrinth", "curseforge", "local"
	SourceModID   string    `json:"sourceModId"`   // Platform-specific mod ID for update checks
	SourceFileID  string    `json:"sourceFileId"`  // Platform-specific file/version ID
	LastModified  time.Time `json:"lastModified"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// ResourcePack represents a cached resource pack
type ResourcePack struct {
	ID           string    `json:"id"`
	ProfileID    string    `json:"profileId"`
	FileName     string    `json:"fileName"`
	FilePath     string    `json:"filePath"`
	FileHash     string    `json:"fileHash"`
	FileSize     int64     `json:"fileSize"`
	IsDirectory  bool      `json:"isDirectory"`
	PackFormat   int       `json:"packFormat"`
	Description  string    `json:"description"`
	Enabled      bool      `json:"enabled"`
	LastModified time.Time `json:"lastModified"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// ShaderPack represents a cached shader pack
type ShaderPack struct {
	ID           string    `json:"id"`
	ProfileID    string    `json:"profileId"`
	FileName     string    `json:"fileName"`
	FilePath     string    `json:"filePath"`
	FileHash     string    `json:"fileHash"`
	IsDirectory  bool      `json:"isDirectory"`
	Enabled      bool      `json:"enabled"`
	LastModified time.Time `json:"lastModified"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// ModUpdate represents cached mod update information
type ModUpdate struct {
	ModID           string    `json:"modId"`
	ProfileID       string    `json:"profileId"`
	CurrentVersion  string    `json:"currentVersion"`
	LatestVersion   string    `json:"latestVersion"`
	UpdateAvailable bool      `json:"updateAvailable"`
	Changelog       string    `json:"changelog"`
	CheckedAt       time.Time `json:"checkedAt"`
}
