package domain

import "time"

// Profile represents a game instance configuration
type Profile struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Description     string     `json:"description,omitempty"`
	Icon            string     `json:"icon,omitempty"`
	GameVersion     string     `json:"gameVersion"`
	LoaderType      string     `json:"loaderType"`
	LoaderVersion   string     `json:"loaderVersion,omitempty"`
	GameDirectory   string     `json:"gameDirectory"`
	JavaPath        string     `json:"javaPath,omitempty"`
	JvmArgs         []string   `json:"jvmArgs"`
	Memory          Memory     `json:"memory"`
	GameArgs        []string   `json:"gameArgs"`
	Resolution      Resolution `json:"resolution,omitempty"`
	Fullscreen      bool       `json:"fullscreen,omitempty"`
	ModpackID       string     `json:"modpackId,omitempty"`
	ModpackSource   string     `json:"modpackSource,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	LastPlayed      time.Time  `json:"lastPlayed,omitempty"`
	TotalPlayTime   int64      `json:"totalPlayTime"`
	AuthRequired    bool       `json:"authRequired,omitempty"`
	SPAEnabled      bool       `json:"spaEnabled,omitempty"`
	ServerAddress   string     `json:"serverAddress,omitempty"`
}

// Memory represents JVM memory settings
type Memory struct {
	Min int32 `json:"min"`
	Max int32 `json:"max"`
}

// Resolution represents game window resolution
type Resolution struct {
	Width  int32 `json:"width"`
	Height int32 `json:"height"`
}

// CreateProfileRequest represents the data needed to create a profile
type CreateProfileRequest struct {
	Name          string `json:"name"`
	Description   string `json:"description,omitempty"`
	GameVersion   string `json:"gameVersion"`
	LoaderType    string `json:"loaderType"`
	LoaderVersion string `json:"loaderVersion,omitempty"`
	Icon          string `json:"icon,omitempty"`
}
