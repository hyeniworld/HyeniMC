package db

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"

	_ "modernc.org/sqlite"
)

var (
	instance *sql.DB
	once     sync.Once
	dbPath   string
)

// Initialize initializes the database connection
func Initialize(dataDir string) error {
	var err error
	once.Do(func() {
		// Ensure data directory exists
		if err = os.MkdirAll(dataDir, 0755); err != nil {
			err = fmt.Errorf("failed to create data directory: %w", err)
			return
		}

		// Set database path
		dbPath = filepath.Join(dataDir, "hyenimc.db")
		log.Printf("[DB] Database path: %s", dbPath)

		// Open database with busy_timeout and WAL mode
		instance, err = sql.Open("sqlite", dbPath+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)")
		if err != nil {
			err = fmt.Errorf("failed to open database: %w", err)
			return
		}

		// Test connection
		if err = instance.Ping(); err != nil {
			err = fmt.Errorf("failed to ping database: %w", err)
			return
		}

		// Set connection pool settings for SQLite (reduce concurrency)
		instance.SetMaxOpenConns(1)  // SQLite works best with single writer
		instance.SetMaxIdleConns(1)

		log.Println("[DB] Database connection established")

		// Run migrations
		if err = runMigrations(instance); err != nil {
			err = fmt.Errorf("failed to run migrations: %w", err)
			return
		}
	})
	return err
}

// Get returns the database instance
func Get() *sql.DB {
	if instance == nil {
		panic("database not initialized")
	}
	return instance
}

// Close closes the database connection
func Close() error {
	if instance != nil {
		return instance.Close()
	}
	return nil
}

// GetPath returns the database file path
func GetPath() string {
	return dbPath
}
