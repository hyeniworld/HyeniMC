package grpc

import (
	"context"

	pb "hyenimc/backend/gen/launcher"
	"google.golang.org/protobuf/types/known/emptypb"
)

type healthServiceServer struct{
	pb.UnimplementedHealthServiceServer
}

func NewHealthServiceServer() pb.HealthServiceServer {
	return &healthServiceServer{}
}

func (s *healthServiceServer) Check(ctx context.Context, _ *emptypb.Empty) (*pb.HealthStatus, error) {
	return &pb.HealthStatus{Status: "SERVING"}, nil
}
