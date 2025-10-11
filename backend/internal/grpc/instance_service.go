package grpc

import (
	"context"
	"sync"
	"time"

	pb "hyenimc/backend/gen/launcher"
)

// instanceServiceServer provides log streaming (skeleton)
type instanceServiceServer struct {
	pb.UnimplementedInstanceServiceServer
	mu         sync.RWMutex
	subs       map[string]map[chan *pb.LogLine]struct{} // profile_id -> subscribers
	stateSubs  map[string]map[chan *pb.StateEvent]struct{} // profile_id -> state subscribers
}

func NewInstanceServiceServer() pb.InstanceServiceServer {
	return &instanceServiceServer{
		subs:      make(map[string]map[chan *pb.LogLine]struct{}),
		stateSubs: make(map[string]map[chan *pb.StateEvent]struct{}),
	}
}

func (s *instanceServiceServer) Launch(ctx context.Context, req *pb.LaunchRequest) (*pb.LaunchResponse, error) {
	// Skeleton: return ok with pid 0; real launch is handled by TS currently
	return &pb.LaunchResponse{ProfileId: req.GetProfileId(), Pid: 0}, nil
}

func (s *instanceServiceServer) Stop(ctx context.Context, req *pb.StopRequest) (*pb.StopResponse, error) {
	// Skeleton: no-op
	return &pb.StopResponse{Success: true}, nil
}

func (s *instanceServiceServer) StreamLogs(req *pb.LogsRequest, stream pb.InstanceService_StreamLogsServer) error {
	pid := req.ProfileId
	ch := make(chan *pb.LogLine, 512)

	s.mu.Lock()
	if s.subs[pid] == nil {
		s.subs[pid] = make(map[chan *pb.LogLine]struct{})
	}
	s.subs[pid][ch] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.subs[pid], ch)
		close(ch)
		if len(s.subs[pid]) == 0 {
			delete(s.subs, pid)
		}
		s.mu.Unlock()
	}()

	// initial heartbeat
	_ = stream.Send(&pb.LogLine{Timestamp: time.Now().UnixMilli(), Level: "INFO", Message: "log-stream-ready", Source: "instance", ProfileId: pid})

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stream.Context().Done():
			return nil
		case line := <-ch:
			if line == nil {
				return nil
			}
			if err := stream.Send(line); err != nil {
				return nil
			}
		case <-ticker.C:
			_ = stream.Send(&pb.LogLine{Timestamp: time.Now().UnixMilli(), Level: "DEBUG", Message: "heartbeat", Source: "instance", ProfileId: pid})
		}
	}
}

func (s *instanceServiceServer) PublishLog(ctx context.Context, line *pb.LogLine) (*pb.Ack, error) {
	// Route to specific profile subscribers if profile_id present, else broadcast to all
	s.mu.RLock()
	if line.ProfileId != "" {
		if group, ok := s.subs[line.ProfileId]; ok {
			for ch := range group {
				select {
				case ch <- line:
				default:
				}
			}
		}
	} else {
		for _, group := range s.subs {
			for ch := range group {
				select {
				case ch <- line:
				default:
				}
			}
		}
	}
	s.mu.RUnlock()
	return &pb.Ack{Ok: true}, nil
}

func (s *instanceServiceServer) StreamState(req *pb.StateRequest, stream pb.InstanceService_StreamStateServer) error {
	pid := req.ProfileId
	ch := make(chan *pb.StateEvent, 64)

	s.mu.Lock()
	if s.stateSubs[pid] == nil {
		s.stateSubs[pid] = make(map[chan *pb.StateEvent]struct{})
	}
	s.stateSubs[pid][ch] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.stateSubs[pid], ch)
		close(ch)
		if len(s.stateSubs[pid]) == 0 {
			delete(s.stateSubs, pid)
		}
		s.mu.Unlock()
	}()

	// initial heartbeat
	_ = stream.Send(&pb.StateEvent{ProfileId: pid, State: "idle"})

	ticker := time.NewTicker(30 * time.Second)
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
			_ = stream.Send(&pb.StateEvent{ProfileId: pid, State: "heartbeat"})
		}
	}
}

func (s *instanceServiceServer) PublishState(ctx context.Context, ev *pb.StateEvent) (*pb.Ack, error) {
	s.mu.RLock()
	if ev.GetProfileId() != "" {
		if group, ok := s.stateSubs[ev.GetProfileId()]; ok {
			for ch := range group {
				select {
				case ch <- ev:
				default:
				}
			}
		}
	} else {
		for _, group := range s.stateSubs {
			for ch := range group {
				select {
				case ch <- ev:
				default:
				}
			}
		}
	}
	s.mu.RUnlock()
	return &pb.Ack{Ok: true}, nil
}
