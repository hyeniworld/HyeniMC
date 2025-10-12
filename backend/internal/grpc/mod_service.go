package grpc

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"path/filepath"
	"sort"
	"strings"

	"hyenimc/backend/internal/cache"
	"hyenimc/backend/internal/domain"
	"hyenimc/backend/internal/profile"
	"hyenimc/backend/internal/services"

	pb "hyenimc/backend/gen/launcher"
)

// modServiceServer provides mod management with caching
type modServiceServer struct {
	pb.UnimplementedModServiceServer
	modCacheService *services.ModCacheService
	profileRepo     *profile.Repository
	dataDir         string
}

// NewModServiceServer creates a new mod service server
func NewModServiceServer(db *sql.DB, dataDir string) pb.ModServiceServer {
	modRepo := cache.NewModRepository(db)
	modCacheService := services.NewModCacheService(modRepo, dataDir)
	profileRepo := profile.NewRepository(db)

	return &modServiceServer{
		modCacheService: modCacheService,
		profileRepo:     profileRepo,
		dataDir:         dataDir,
	}
}

// ListMods retrieves all mods for a profile (cache-first)
func (s *modServiceServer) ListMods(ctx context.Context, req *pb.ListModsRequest) (*pb.ListModsResponse, error) {
	// Get profile to find actual game directory
	prof, err := s.profileRepo.Get(req.ProfileId)
	if err != nil {
		return nil, fmt.Errorf("failed to get profile: %w", err)
	}

	modsDir := filepath.Join(prof.GameDirectory, "mods")
	log.Printf("[ModService] ListMods for profile %s, modsDir: %s, forceRefresh: %v", req.ProfileId, modsDir, req.ForceRefresh)

	mods, err := s.modCacheService.GetMods(ctx, req.ProfileId, modsDir, req.ForceRefresh)
	if err != nil {
		return nil, fmt.Errorf("failed to get mods: %w", err)
	}

	log.Printf("[ModService] Found %d mods", len(mods))

	// Sort mods alphabetically by name (case-insensitive)
	sort.Slice(mods, func(i, j int) bool {
		nameI := mods[i].Name
		nameJ := mods[j].Name
		if nameI == "" {
			nameI = mods[i].FileName
		}
		if nameJ == "" {
			nameJ = mods[j].FileName
		}
		return strings.ToLower(nameI) < strings.ToLower(nameJ)
	})

	pbMods := make([]*pb.Mod, len(mods))
	for i, mod := range mods {
		pbMods[i] = domainModToPb(mod)
	}

	return &pb.ListModsResponse{Mods: pbMods}, nil
}

// ToggleMod enables or disables a mod
func (s *modServiceServer) ToggleMod(ctx context.Context, req *pb.ToggleModRequest) (*pb.ToggleModResponse, error) {
	if err := s.modCacheService.ToggleMod(ctx, req.ModId, req.Enabled); err != nil {
		return &pb.ToggleModResponse{Success: false}, err
	}

	return &pb.ToggleModResponse{Success: true}, nil
}

// RefreshModCache forces a full re-scan of mods directory
func (s *modServiceServer) RefreshModCache(ctx context.Context, req *pb.RefreshModCacheRequest) (*pb.RefreshModCacheResponse, error) {
	// Get profile to find actual game directory
	prof, err := s.profileRepo.Get(req.ProfileId)
	if err != nil {
		return nil, fmt.Errorf("failed to get profile: %w", err)
	}

	modsDir := filepath.Join(prof.GameDirectory, "mods")
	log.Printf("[ModService] RefreshModCache for profile %s, modsDir: %s", req.ProfileId, modsDir)

	mods, err := s.modCacheService.SyncMods(ctx, req.ProfileId, modsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to refresh mod cache: %w", err)
	}

	log.Printf("[ModService] Refreshed cache with %d mods", len(mods))
	return &pb.RefreshModCacheResponse{TotalMods: int32(len(mods))}, nil
}

// Stubs for online operations (to be implemented later)
func (s *modServiceServer) SearchMods(ctx context.Context, req *pb.SearchModsRequest) (*pb.SearchModsResponse, error) {
	// TODO: Implement Modrinth/CurseForge search
	return &pb.SearchModsResponse{Results: []*pb.Mod{}}, nil
}

func (s *modServiceServer) GetMod(ctx context.Context, req *pb.GetModRequest) (*pb.Mod, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented")
}

func (s *modServiceServer) GetModVersions(ctx context.Context, req *pb.GetModVersionsRequest) (*pb.GetModVersionsResponse, error) {
	// TODO: Implement
	return &pb.GetModVersionsResponse{}, nil
}

func (s *modServiceServer) InstallMod(ctx context.Context, req *pb.InstallModRequest) (*pb.InstallModResponse, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented")
}

func (s *modServiceServer) RemoveMod(ctx context.Context, req *pb.RemoveModRequest) (*pb.RemoveModResponse, error) {
	// TODO: Implement
	return &pb.RemoveModResponse{Success: false}, nil
}

func (s *modServiceServer) CheckUpdates(ctx context.Context, req *pb.CheckUpdatesRequest) (*pb.CheckUpdatesResponse, error) {
	// TODO: Implement
	return &pb.CheckUpdatesResponse{}, nil
}

func (s *modServiceServer) UpdateMod(ctx context.Context, req *pb.UpdateModRequest) (*pb.UpdateModResponse, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented")
}

// Helper to convert domain.Mod to pb.Mod
func domainModToPb(mod *domain.Mod) *pb.Mod {
	return &pb.Mod{
		Id:           mod.ID,
		ProfileId:    mod.ProfileID,
		Name:         mod.Name,
		Version:      mod.Version,
		FileName:     mod.FileName,
		FilePath:     mod.FilePath,
		FileHash:     mod.FileHash,
		FileSize:     mod.FileSize,
		ModId:        mod.ModID,
		Description:  mod.Description,
		Authors:      mod.Authors,
		Enabled:      mod.Enabled,
		Source:       mod.Source,
		LastModified: mod.LastModified.Unix(),
		CreatedAt:    mod.CreatedAt.Unix(),
		UpdatedAt:    mod.UpdatedAt.Unix(),
	}
}
