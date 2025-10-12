package cache

import (
	"database/sql"
	"time"
)

// ProfileStats represents profile usage statistics
type ProfileStats struct {
	ProfileID      string
	LastLaunchedAt *time.Time
	TotalPlayTime  int64 // in seconds
	LaunchCount    int
	CrashCount     int
	LastCrashAt    *time.Time
}

// ProfileStatsRepository handles profile statistics
type ProfileStatsRepository struct {
	db *sql.DB
}

// NewProfileStatsRepository creates a new repository
func NewProfileStatsRepository(db *sql.DB) *ProfileStatsRepository {
	return &ProfileStatsRepository{db: db}
}

// Get retrieves stats for a profile
func (r *ProfileStatsRepository) Get(profileID string) (*ProfileStats, error) {
	var stats ProfileStats
	var lastLaunched, lastCrash sql.NullInt64

	err := r.db.QueryRow(`
		SELECT profile_id, last_launched_at, total_play_time, launch_count, crash_count, last_crash_at
		FROM profile_stats
		WHERE profile_id = ?
	`, profileID).Scan(
		&stats.ProfileID,
		&lastLaunched,
		&stats.TotalPlayTime,
		&stats.LaunchCount,
		&stats.CrashCount,
		&lastCrash,
	)

	if err == sql.ErrNoRows {
		// Return empty stats
		return &ProfileStats{
			ProfileID:     profileID,
			TotalPlayTime: 0,
			LaunchCount:   0,
			CrashCount:    0,
		}, nil
	}
	if err != nil {
		return nil, err
	}

	if lastLaunched.Valid {
		t := time.Unix(lastLaunched.Int64, 0)
		stats.LastLaunchedAt = &t
	}
	if lastCrash.Valid {
		t := time.Unix(lastCrash.Int64, 0)
		stats.LastCrashAt = &t
	}

	return &stats, nil
}

// RecordLaunch records a profile launch
func (r *ProfileStatsRepository) RecordLaunch(profileID string) error {
	now := time.Now().Unix()

	_, err := r.db.Exec(`
		INSERT INTO profile_stats (profile_id, last_launched_at, launch_count)
		VALUES (?, ?, 1)
		ON CONFLICT(profile_id) DO UPDATE SET
			last_launched_at = ?,
			launch_count = launch_count + 1
	`, profileID, now, now)

	return err
}

// RecordPlayTime adds play time to a profile
func (r *ProfileStatsRepository) RecordPlayTime(profileID string, seconds int64) error {
	_, err := r.db.Exec(`
		INSERT INTO profile_stats (profile_id, total_play_time)
		VALUES (?, ?)
		ON CONFLICT(profile_id) DO UPDATE SET
			total_play_time = total_play_time + ?
	`, profileID, seconds, seconds)

	return err
}

// RecordCrash records a profile crash
func (r *ProfileStatsRepository) RecordCrash(profileID string) error {
	now := time.Now().Unix()

	_, err := r.db.Exec(`
		INSERT INTO profile_stats (profile_id, crash_count, last_crash_at)
		VALUES (?, 1, ?)
		ON CONFLICT(profile_id) DO UPDATE SET
			crash_count = crash_count + 1,
			last_crash_at = ?
	`, profileID, now, now)

	return err
}

// GetMostPlayed retrieves profiles sorted by play time
func (r *ProfileStatsRepository) GetMostPlayed(limit int) ([]*ProfileStats, error) {
	rows, err := r.db.Query(`
		SELECT profile_id, last_launched_at, total_play_time, launch_count, crash_count, last_crash_at
		FROM profile_stats
		WHERE total_play_time > 0
		ORDER BY total_play_time DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var statsList []*ProfileStats
	for rows.Next() {
		var stats ProfileStats
		var lastLaunched, lastCrash sql.NullInt64

		err := rows.Scan(
			&stats.ProfileID,
			&lastLaunched,
			&stats.TotalPlayTime,
			&stats.LaunchCount,
			&stats.CrashCount,
			&lastCrash,
		)
		if err != nil {
			return nil, err
		}

		if lastLaunched.Valid {
			t := time.Unix(lastLaunched.Int64, 0)
			stats.LastLaunchedAt = &t
		}
		if lastCrash.Valid {
			t := time.Unix(lastCrash.Int64, 0)
			stats.LastCrashAt = &t
		}

		statsList = append(statsList, &stats)
	}

	return statsList, rows.Err()
}

// GetRecentlyPlayed retrieves recently played profiles
func (r *ProfileStatsRepository) GetRecentlyPlayed(limit int) ([]*ProfileStats, error) {
	rows, err := r.db.Query(`
		SELECT profile_id, last_launched_at, total_play_time, launch_count, crash_count, last_crash_at
		FROM profile_stats
		WHERE last_launched_at IS NOT NULL
		ORDER BY last_launched_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var statsList []*ProfileStats
	for rows.Next() {
		var stats ProfileStats
		var lastLaunched, lastCrash sql.NullInt64

		err := rows.Scan(
			&stats.ProfileID,
			&lastLaunched,
			&stats.TotalPlayTime,
			&stats.LaunchCount,
			&stats.CrashCount,
			&lastCrash,
		)
		if err != nil {
			return nil, err
		}

		if lastLaunched.Valid {
			t := time.Unix(lastLaunched.Int64, 0)
			stats.LastLaunchedAt = &t
		}
		if lastCrash.Valid {
			t := time.Unix(lastCrash.Int64, 0)
			stats.LastCrashAt = &t
		}

		statsList = append(statsList, &stats)
	}

	return statsList, rows.Err()
}

// Delete removes stats for a profile
func (r *ProfileStatsRepository) Delete(profileID string) error {
	_, err := r.db.Exec("DELETE FROM profile_stats WHERE profile_id = ?", profileID)
	return err
}
