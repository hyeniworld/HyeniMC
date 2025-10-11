package grpc

import (
	"context"
	"sync"
	"time"

	pb "hyenimc/backend/gen/launcher"
)

// downloadServiceServer provides server-streaming progress events (skeleton)
type downloadServiceServer struct {
	pb.UnimplementedDownloadServiceServer
	mu   sync.RWMutex
	subs map[chan *pb.ProgressEvent]struct{}
}

func NewDownloadServiceServer() pb.DownloadServiceServer {
	return &downloadServiceServer{subs: make(map[chan *pb.ProgressEvent]struct{})}
}

func (s *downloadServiceServer) StreamProgress(req *pb.ProgressRequest, stream pb.DownloadService_StreamProgressServer) error {
	// Register a subscriber channel
	ch := make(chan *pb.ProgressEvent, 256)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.subs, ch)
		close(ch)
		s.mu.Unlock()
	}()

	// Optional: initial heartbeat so clients know stream is alive
	_ = stream.Send(&pb.ProgressEvent{Status: "pending"})

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stream.Context().Done():
			return nil
		case ev := <-ch:
			if ev == nil {
				return nil
			}
			if err := stream.Send(ev); err != nil {
				return nil
			}
		case <-ticker.C:
			// periodic heartbeat
			_ = stream.Send(&pb.ProgressEvent{Status: "pending"})
		}
	}
}

func (s *downloadServiceServer) PublishProgress(ctx context.Context, ev *pb.ProgressEvent) (*pb.Ack, error) {
	// Broadcast to all subscribers (non-blocking)
	s.mu.RLock()
	for ch := range s.subs {
		select {
		case ch <- ev:
		default:
			// drop if subscriber is slow
		}
	}
	s.mu.RUnlock()
	return &pb.Ack{Ok: true}, nil
}
