package main

import (
	"log"
	"os"
	"path/filepath"

	"hyenimc/backend/internal/db"
	"hyenimc/backend/internal/grpc"
	"hyenimc/backend/internal/profile"
	"hyenimc/backend/internal/services"
	"hyenimc/backend/internal/settings"
)

func main() {
	// Keep standard logger on stdout (info logs)
	// File-based port communication doesn't require clean stdout
	log.SetOutput(os.Stdout)

	// Get data directory from environment or use default
	dataDir := os.Getenv("HYENIMC_DATA_DIR")
	if dataDir == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			log.Fatalf("failed to get home directory: %v", err)
		}
		dataDir = filepath.Join(homeDir, ".hyenimc")
	}

	// Create data directory if it doesn't exist (owner-only access)
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		log.Fatalf("failed to create data directory: %v", err)
	}

	log.Printf("[Main] Data directory: %s", dataDir)

	// Initialize database
	if err := db.Initialize(dataDir); err != nil {
		log.Fatalf("failed to initialize database: %v", err)
	}
	defer db.Close()

	// Initialize settings service
	settingsRepo := settings.NewRepository(db.Get())
	settingsService := settings.NewService(settingsRepo)

	// Initialize profile service (SQLite based)
	profileRepo := profile.NewRepository(db.Get())
	profileService := services.NewProfileService(profileRepo, dataDir)

	// Start gRPC server (prints chosen address to stdout internally)
	addr := os.Getenv("HYENIMC_ADDR")
	if err := grpc.StartGRPCServer(addr, db.Get(), dataDir, profileService, settingsService); err != nil {
		log.Fatalf("failed to start gRPC server: %v", err)
	}
}
