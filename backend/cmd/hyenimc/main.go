package main

import (
	"fmt"
	"log"
	"net"
	nethttp "net/http"
	"os"
	"path/filepath"

	"hyenimc/backend/internal/grpc"
	"hyenimc/backend/internal/http"
	"hyenimc/backend/internal/services"

	grpclib "google.golang.org/grpc"
)

func main() {
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

	// Create gRPC handlers
	profileHandler := grpc.NewProfileHandler(profileService)
	_ = profileHandler // Will be used when we add proto-generated servers

	// Setup HTTP server (temporary, will be replaced by gRPC)
	httpServer := http.NewServer(profileService)
	
	// Setup listener
	addr := os.Getenv("HYENIMC_ADDR")
	if addr == "" {
		addr = "127.0.0.1:0" // pick free port
	}

	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	// Print chosen address to stdout for Electron Main to capture
	fmt.Println(lis.Addr().String())
	log.Printf("HTTP server listening on %s", lis.Addr().String())
	log.Printf("Data directory: %s", dataDir)

	// Start HTTP server
	if err := nethttp.Serve(lis, httpServer); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}

	// Setup gRPC server (for future use)
	grpcServer := grpclib.NewServer()
	_ = grpcServer

	// TODO: register proto-generated services
	// launcher.RegisterProfileServiceServer(grpcServer, profileHandler)
	// launcher.RegisterVersionServiceServer(grpcServer, versionHandler)
	// launcher.RegisterDownloadServiceServer(grpcServer, downloadHandler)
	// launcher.RegisterInstanceServiceServer(grpcServer, instanceHandler)
	// launcher.RegisterModServiceServer(grpcServer, modHandler)
}
