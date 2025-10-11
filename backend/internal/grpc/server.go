package grpc

import (
	"fmt"
	"log"
	"net"

	pb "hyenimc/backend/gen/launcher"
	"hyenimc/backend/internal/services"

	grpclib "google.golang.org/grpc"
)

// StartGRPCServer starts the gRPC server, prints the chosen address to stdout, and serves forever.
// If addr is empty, it will use 127.0.0.1:0 to pick a free port.
func StartGRPCServer(addr string, profileSvc *services.ProfileService) error {
	if addr == "" {
		addr = "127.0.0.1:0"
	}

	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to listen: %w", err)
	}

	// Print the chosen address for Electron Main to capture via stdout
	fmt.Println(lis.Addr().String())
	log.Printf("gRPC server listening on %s", lis.Addr().String())

	server := grpclib.NewServer()

	// Register services
	pb.RegisterProfileServiceServer(server, NewProfileServiceServer(profileSvc))
	pb.RegisterDownloadServiceServer(server, NewDownloadServiceServer())
	pb.RegisterInstanceServiceServer(server, NewInstanceServiceServer())

	if err := server.Serve(lis); err != nil {
		return fmt.Errorf("failed to serve gRPC: %w", err)
	}
	return nil
}
