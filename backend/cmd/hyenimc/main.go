package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log"
	"os"
	"path/filepath"

	"hyenimc/backend/internal/account"
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

	// Initialize account service
	encryptionKey := getOrCreateEncryptionKey(dataDir)
	deviceID := generateDeviceID(dataDir)
	accountRepo := account.NewRepository(db.Get())
	accountService := services.NewAccountService(accountRepo, encryptionKey, deviceID)

	// Start gRPC server (prints chosen address to stdout internally)
	addr := os.Getenv("HYENIMC_ADDR")
	if err := grpc.StartGRPCServer(addr, db.Get(), dataDir, profileService, settingsService, accountService); err != nil {
		log.Fatalf("failed to start gRPC server: %v", err)
	}
}

// getOrCreateEncryptionKey gets or creates the encryption key
func getOrCreateEncryptionKey(dataDir string) []byte {
	keyPath := filepath.Join(dataDir, ".key")
	
	// Try to read existing key
	key, err := os.ReadFile(keyPath)
	if err == nil && len(key) == 32 {
		return key
	}
	
	// Generate new key
	key = make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		log.Fatalf("failed to generate encryption key: %v", err)
	}
	
	// Save with restrictive permissions
	if err := os.WriteFile(keyPath, key, 0600); err != nil {
		log.Fatalf("failed to save encryption key: %v", err)
	}
	
	log.Println("[Main] Generated new encryption key")
	return key
}

// generateDeviceID generates a unique device identifier
func generateDeviceID(dataDir string) string {
	deviceIDPath := filepath.Join(dataDir, ".device_id")
	
	// Try to read existing device ID
	if data, err := os.ReadFile(deviceIDPath); err == nil {
		return string(data)
	}
	
	// Generate new device ID based on data directory path
	// This ensures different device ID for different installations
	hash := sha256.Sum256([]byte(dataDir))
	deviceID := hex.EncodeToString(hash[:])
	
	// Save device ID
	if err := os.WriteFile(deviceIDPath, []byte(deviceID), 0600); err != nil {
		log.Printf("Warning: failed to save device ID: %v", err)
	}
	
	log.Printf("[Main] Generated device ID: %s", deviceID[:16]+"...")
	return deviceID
}
