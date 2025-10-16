package grpc

import (
	"database/sql"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"

	pb "hyenimc/backend/gen/launcher"
	"hyenimc/backend/internal/cache"
	"hyenimc/backend/internal/services"
	"hyenimc/backend/internal/settings"

	grpclib "google.golang.org/grpc"
)

// StartGRPCServer starts the gRPC server, prints the chosen address to stdout, and serves forever.
// If addr is empty, it will use 127.0.0.1:0 to pick a free port.
func StartGRPCServer(addr string, db *sql.DB, dataDir string, profileSvc *services.ProfileService, settingsSvc *settings.Service, accountSvc *services.AccountService) error {
	if addr == "" {
		addr = "127.0.0.1:0"
	}

	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to listen: %w", err)
	}

	// Write the chosen address to a file for Electron Main to read
	address := lis.Addr().String()
	portFile := filepath.Join(dataDir, ".grpc-port")
	
	// Security: Ensure parent directory exists and has proper permissions
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		log.Printf("Warning: failed to create data directory: %v", err)
	}
	
	// Security: Remove old port file if exists (prevent symlink attacks)
	os.Remove(portFile)
	
	// Write with restrictive permissions (owner read/write only)
	// Format: address|pid for process validation
	content := fmt.Sprintf("%s|%d", address, os.Getpid())
	if err := os.WriteFile(portFile, []byte(content), 0600); err != nil {
		return fmt.Errorf("failed to write port file: %w", err)
	}
	
	// Log server start (all logs go to stderr now)
	log.Printf("gRPC server listening on %s (port file: %s)", address, portFile)

	server := grpclib.NewServer()

	// Get CurseForge API key from environment (optional)
	curseforgeAPIKey := os.Getenv("CURSEFORGE_API_KEY")
	if curseforgeAPIKey == "" {
		log.Printf("Warning: CurseForge API key not set. CurseForge features will be disabled.")
	}

	// Create profile stats repository
	profileStatsRepo := cache.NewProfileStatsRepository(db)
	
	// Register services
	pb.RegisterProfileServiceServer(server, NewProfileServiceServer(profileSvc, profileStatsRepo))
	pb.RegisterDownloadServiceServer(server, NewDownloadServiceServer())
	pb.RegisterInstanceServiceServer(server, NewInstanceServiceServer())
	pb.RegisterVersionServiceServer(server, NewVersionServiceServer())
	pb.RegisterHealthServiceServer(server, NewHealthServiceServer())
	pb.RegisterLoaderServiceServer(server, NewLoaderServiceServer())
	pb.RegisterAssetServiceServer(server, NewAssetServiceServer())
	pb.RegisterSettingsServiceServer(server, NewSettingsServiceServer(settingsSvc))
	pb.RegisterModServiceServer(server, NewModServiceServer(db, dataDir))
	pb.RegisterCacheServiceServer(server, NewCacheServiceServer(db, curseforgeAPIKey))
	pb.RegisterAccountServiceServer(server, NewAccountHandler(accountSvc))

	if err := server.Serve(lis); err != nil {
		return fmt.Errorf("failed to serve gRPC: %w", err)
	}
	return nil
}
