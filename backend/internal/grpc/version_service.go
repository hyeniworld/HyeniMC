package grpc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	pb "hyenimc/backend/gen/launcher"
)

type versionServiceServer struct {
	pb.UnimplementedVersionServiceServer
	mu          sync.RWMutex
	cachedAt    time.Time
	cacheTtl    time.Duration
	cached      []*pb.MinecraftVersion
}

func NewVersionServiceServer() pb.VersionServiceServer {
	return &versionServiceServer{cacheTtl: 10 * time.Minute}
}

type mojangManifest struct {
	Versions []struct {
		Id          string    `json:"id"`
		Type        string    `json:"type"`
		Url         string    `json:"url"`
		ReleaseTime time.Time `json:"releaseTime"`
	} `json:"versions"`
}

func (s *versionServiceServer) fetchMinecraftVersions(ctx context.Context) ([]*pb.MinecraftVersion, error) {
	// serve from cache if fresh
	s.mu.RLock()
	if s.cached != nil && time.Since(s.cachedAt) < s.cacheTtl {
		out := make([]*pb.MinecraftVersion, len(s.cached))
		copy(out, s.cached)
		s.mu.RUnlock()
		return out, nil
	}
	s.mu.RUnlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://launchermeta.mojang.com/mc/game/version_manifest.json", nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch manifest: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("manifest status: %s", resp.Status)
	}

	var man mojangManifest
	if err := json.NewDecoder(resp.Body).Decode(&man); err != nil {
		return nil, fmt.Errorf("decode manifest: %w", err)
	}

	versions := make([]*pb.MinecraftVersion, 0, len(man.Versions))
	for _, v := range man.Versions {
		versions = append(versions, &pb.MinecraftVersion{
			Id:          v.Id,
			Type:        v.Type,
			Url:         v.Url,
			ReleaseTime: v.ReleaseTime.Unix(),
		})
	}
	// sort by release time desc
	sort.Slice(versions, func(i, j int) bool { return versions[i].ReleaseTime > versions[j].ReleaseTime })

	s.mu.Lock()
	s.cached = versions
	s.cachedAt = time.Now()
	s.mu.Unlock()

	out := make([]*pb.MinecraftVersion, len(versions))
	copy(out, versions)
	return out, nil
}

func (s *versionServiceServer) ListMinecraftVersions(ctx context.Context, req *pb.ListMinecraftVersionsRequest) (*pb.ListMinecraftVersionsResponse, error) {
	versions, err := s.fetchMinecraftVersions(ctx)
	if err != nil {
		return nil, err
	}
	// filter by type if specified
	if req.GetType() != "" && req.GetType() != "all" {
		filtered := make([]*pb.MinecraftVersion, 0, len(versions))
		for _, v := range versions {
			if v.Type == req.GetType() {
				filtered = append(filtered, v)
			}
		}
		versions = filtered
	}
	return &pb.ListMinecraftVersionsResponse{Versions: versions}, nil
}

func (s *versionServiceServer) ListLoaderVersions(ctx context.Context, req *pb.ListLoaderVersionsRequest) (*pb.ListLoaderVersionsResponse, error) {
	// TODO: implement real datasource; return empty list for now
	return &pb.ListLoaderVersionsResponse{Versions: []*pb.LoaderVersion{}}, nil
}

func (s *versionServiceServer) CheckCompatibility(ctx context.Context, req *pb.CheckCompatibilityRequest) (*pb.CheckCompatibilityResponse, error) {
	// TODO: implement real check; optimistic compatible for now
	return &pb.CheckCompatibilityResponse{Compatible: true, Reason: ""}, nil
}
