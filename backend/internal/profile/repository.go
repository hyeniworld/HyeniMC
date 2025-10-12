package profile

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"hyenimc/backend/internal/domain"
)

// Repository handles profile persistence in SQLite
type Repository struct {
	db *sql.DB
}

// NewRepository creates a new profile repository
func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

// Save inserts or updates a profile
func (r *Repository) Save(profile *domain.Profile) error {
	jvmArgs, _ := json.Marshal(profile.JvmArgs)
	gameArgs, _ := json.Marshal(profile.GameArgs)
	
	// Convert nullable fields to sql.NullXXX
	var javaPath sql.NullString
	if profile.JavaPath != "" {
		javaPath = sql.NullString{String: profile.JavaPath, Valid: true}
	}
	
	var memoryMin, memoryMax sql.NullInt32
	if profile.Memory.Min > 0 {
		memoryMin = sql.NullInt32{Int32: profile.Memory.Min, Valid: true}
	}
	if profile.Memory.Max > 0 {
		memoryMax = sql.NullInt32{Int32: profile.Memory.Max, Valid: true}
	}
	
	var resWidth, resHeight sql.NullInt32
	if profile.Resolution.Width > 0 {
		resWidth = sql.NullInt32{Int32: profile.Resolution.Width, Valid: true}
	}
	if profile.Resolution.Height > 0 {
		resHeight = sql.NullInt32{Int32: profile.Resolution.Height, Valid: true}
	}
	
	// Fullscreen: -1 = not set (use global), 0 = false, 1 = true
	var fullscreenVal sql.NullInt32
	if profile.Fullscreen {
		fullscreenVal = sql.NullInt32{Int32: 1, Valid: true}
	} else {
		// Only set to 0 if explicitly false, otherwise leave NULL for global inherit
		// We'll use a special marker: if it was never touched, it stays NULL
		fullscreenVal = sql.NullInt32{Int32: 0, Valid: true}
	}
	
	var serverAddr sql.NullString
	if profile.ServerAddress != "" {
		serverAddr = sql.NullString{String: profile.ServerAddress, Valid: true}
	}
	
	_, err := r.db.Exec(`
		INSERT INTO profiles (
			id, name, description, icon, game_version, loader_type, loader_version,
			game_directory, java_path, memory_min, memory_max, resolution_width,
			resolution_height, fullscreen, jvm_args, game_args, modpack_id,
			modpack_source, created_at, updated_at, last_played, total_play_time,
			favorite, server_address
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			description = excluded.description,
			icon = excluded.icon,
			game_version = excluded.game_version,
			loader_type = excluded.loader_type,
			loader_version = excluded.loader_version,
			game_directory = excluded.game_directory,
			java_path = excluded.java_path,
			memory_min = excluded.memory_min,
			memory_max = excluded.memory_max,
			resolution_width = excluded.resolution_width,
			resolution_height = excluded.resolution_height,
			fullscreen = excluded.fullscreen,
			jvm_args = excluded.jvm_args,
			game_args = excluded.game_args,
			modpack_id = excluded.modpack_id,
			modpack_source = excluded.modpack_source,
			updated_at = excluded.updated_at,
			last_played = excluded.last_played,
			total_play_time = excluded.total_play_time,
			favorite = excluded.favorite,
			server_address = excluded.server_address
	`,
		profile.ID, profile.Name, profile.Description, profile.Icon,
		profile.GameVersion, profile.LoaderType, profile.LoaderVersion,
		profile.GameDirectory, javaPath, memoryMin, memoryMax, resWidth, resHeight,
		fullscreenVal, jvmArgs, gameArgs, profile.ModpackID, profile.ModpackSource,
		profile.CreatedAt.Unix(), profile.UpdatedAt.Unix(),
		nullTime(profile.LastPlayed), profile.TotalPlayTime,
		profile.Favorite, serverAddr,
	)
	
	if err != nil {
		return fmt.Errorf("failed to save profile: %w", err)
	}
	return nil
}

// Get retrieves a profile by ID
func (r *Repository) Get(id string) (*domain.Profile, error) {
	var profile domain.Profile
	var jvmArgs, gameArgs []byte
	var javaPath sql.NullString
	var memoryMin, memoryMax sql.NullInt32
	var resWidth, resHeight sql.NullInt32
	var fullscreenVal sql.NullInt32
	var createdAt, updatedAt int64
	var lastPlayed sql.NullInt64
	
	var serverAddr sql.NullString
	
	err := r.db.QueryRow(`
		SELECT id, name, description, icon, game_version, loader_type, loader_version,
			game_directory, java_path, memory_min, memory_max, resolution_width,
			resolution_height, fullscreen, jvm_args, game_args, modpack_id,
			modpack_source, created_at, updated_at, last_played, total_play_time,
			favorite, server_address
		FROM profiles WHERE id = ?
	`, id).Scan(
		&profile.ID, &profile.Name, &profile.Description, &profile.Icon,
		&profile.GameVersion, &profile.LoaderType, &profile.LoaderVersion,
		&profile.GameDirectory, &javaPath, &memoryMin, &memoryMax, &resWidth, &resHeight,
		&fullscreenVal, &jvmArgs, &gameArgs, &profile.ModpackID,
		&profile.ModpackSource, &createdAt, &updatedAt, &lastPlayed, &profile.TotalPlayTime,
		&profile.Favorite, &serverAddr,
	)
	
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("profile not found: %s", id)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get profile: %w", err)
	}
	
	// Convert nullable fields
	if javaPath.Valid {
		profile.JavaPath = javaPath.String
	}
	if memoryMin.Valid {
		profile.Memory.Min = memoryMin.Int32
	}
	if memoryMax.Valid {
		profile.Memory.Max = memoryMax.Int32
	}
	if resWidth.Valid {
		profile.Resolution.Width = resWidth.Int32
	}
	if resHeight.Valid {
		profile.Resolution.Height = resHeight.Int32
	}
	if fullscreenVal.Valid {
		profile.Fullscreen = fullscreenVal.Int32 > 0
	}
	if serverAddr.Valid {
		profile.ServerAddress = serverAddr.String
	}
	
	json.Unmarshal(jvmArgs, &profile.JvmArgs)
	json.Unmarshal(gameArgs, &profile.GameArgs)
	
	profile.CreatedAt = time.Unix(createdAt, 0)
	profile.UpdatedAt = time.Unix(updatedAt, 0)
	if lastPlayed.Valid {
		profile.LastPlayed = time.Unix(lastPlayed.Int64, 0)
	}
	
	return &profile, nil
}

// List retrieves all profiles
func (r *Repository) List() ([]*domain.Profile, error) {
	rows, err := r.db.Query(`
		SELECT id, name, description, icon, game_version, loader_type, loader_version,
			game_directory, java_path, memory_min, memory_max, resolution_width,
			resolution_height, fullscreen, jvm_args, game_args, modpack_id,
			modpack_source, created_at, updated_at, last_played, total_play_time,
			favorite, server_address
		FROM profiles
		ORDER BY last_played DESC, created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to list profiles: %w", err)
	}
	defer rows.Close()
	
	var profiles []*domain.Profile
	for rows.Next() {
		var profile domain.Profile
		var jvmArgs, gameArgs []byte
		var javaPath sql.NullString
		var serverAddr sql.NullString
		var memoryMin, memoryMax sql.NullInt32
		var resWidth, resHeight sql.NullInt32
		var fullscreenVal sql.NullInt32
		var createdAt, updatedAt int64
		var lastPlayed sql.NullInt64
		
		err := rows.Scan(
			&profile.ID, &profile.Name, &profile.Description, &profile.Icon,
			&profile.GameVersion, &profile.LoaderType, &profile.LoaderVersion,
			&profile.GameDirectory, &javaPath, &memoryMin, &memoryMax, &resWidth, &resHeight,
			&fullscreenVal, &jvmArgs, &gameArgs, &profile.ModpackID,
			&profile.ModpackSource, &createdAt, &updatedAt, &lastPlayed, &profile.TotalPlayTime,
			&profile.Favorite, &serverAddr,
		)
		if err != nil {
			continue
		}
		
		// Convert nullable fields
		if javaPath.Valid {
			profile.JavaPath = javaPath.String
		}
		if memoryMin.Valid {
			profile.Memory.Min = memoryMin.Int32
		}
		if memoryMax.Valid {
			profile.Memory.Max = memoryMax.Int32
		}
		if resWidth.Valid {
			profile.Resolution.Width = resWidth.Int32
		}
		if resHeight.Valid {
			profile.Resolution.Height = resHeight.Int32
		}
		if fullscreenVal.Valid {
			profile.Fullscreen = fullscreenVal.Int32 > 0
		}
		if serverAddr.Valid {
			profile.ServerAddress = serverAddr.String
		}
		
		json.Unmarshal(jvmArgs, &profile.JvmArgs)
		json.Unmarshal(gameArgs, &profile.GameArgs)
		
		profile.CreatedAt = time.Unix(createdAt, 0)
		profile.UpdatedAt = time.Unix(updatedAt, 0)
		if lastPlayed.Valid {
			profile.LastPlayed = time.Unix(lastPlayed.Int64, 0)
		}
		
		profiles = append(profiles, &profile)
	}
	
	return profiles, nil
}

// Delete removes a profile
func (r *Repository) Delete(id string) error {
	result, err := r.db.Exec("DELETE FROM profiles WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("failed to delete profile: %w", err)
	}
	
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("profile not found: %s", id)
	}
	
	return nil
}

// Update updates an existing profile
func (r *Repository) Update(profile *domain.Profile) error {
	profile.UpdatedAt = time.Now()
	return r.Save(profile)
}

// Helper functions
func nullTime(t time.Time) sql.NullInt64 {
	if t.IsZero() {
		return sql.NullInt64{Valid: false}
	}
	return sql.NullInt64{Int64: t.Unix(), Valid: true}
}
