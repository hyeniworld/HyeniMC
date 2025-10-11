package main

import (
	"log"
	"os"
	"path/filepath"

	"hyenimc/backend/internal/grpc"
	"hyenimc/backend/internal/services"
)

func main() {
    // Route standard logger to stdout (default is stderr)
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

	// Create data directory if it doesn't exist
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		log.Fatalf("failed to create data directory: %v", err)
	}

	// Initialize services
	profileService, err := services.NewProfileService(dataDir)
	if err != nil {
		log.Fatalf("failed to create profile service: %v", err)
	}

	// Start gRPC server (prints chosen address to stdout internally)
	addr := os.Getenv("HYENIMC_ADDR")
	if err := grpc.StartGRPCServer(addr, profileService); err != nil {
		log.Fatalf("failed to start gRPC server: %v", err)
	}
	log.Printf("Data directory: %s", dataDir)
}
