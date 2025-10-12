package grpc

import (
	"context"
	"database/sql"
	"fmt"

	"hyenimc/backend/internal/cache"
	"hyenimc/backend/internal/services"

	pb "hyenimc/backend/gen/launcher"
)

// cacheServiceServer provides cache management with API proxying
type cacheServiceServer struct {
	pb.UnimplementedCacheServiceServer
	
	// Repositories
	apiCacheRepo        *cache.APICacheRepository
	loaderVersionsRepo  *cache.LoaderVersionsRepository
	javaRepo            *cache.JavaInstallationsRepository
	profileStatsRepo    *cache.ProfileStatsRepository
	
	// Services
	minecraftVersions *services.MinecraftVersionsService
	loaderVersions    *services.LoaderVersionsService
	modrinthCache     *services.ModrinthCacheService
	curseforgeCache   *services.CurseForgeCacheService
}

// NewCacheServiceServer creates a new cache service server
func NewCacheServiceServer(db *sql.DB, curseforgeAPIKey string) pb.CacheServiceServer {
	// Initialize repositories
	apiCacheRepo := cache.NewAPICacheRepository(db)
	loaderVersionsRepo := cache.NewLoaderVersionsRepository(db)
	javaRepo := cache.NewJavaInstallationsRepository(db)
	profileStatsRepo := cache.NewProfileStatsRepository(db)
	
	// Initialize services
	minecraftVersions := services.NewMinecraftVersionsService(apiCacheRepo)
	loaderVersions := services.NewLoaderVersionsService(loaderVersionsRepo)
	modrinthCache := services.NewModrinthCacheService(apiCacheRepo)
	curseforgeCache := services.NewCurseForgeCacheService(apiCacheRepo, curseforgeAPIKey)
	
	return &cacheServiceServer{
		apiCacheRepo:       apiCacheRepo,
		loaderVersionsRepo: loaderVersionsRepo,
		javaRepo:           javaRepo,
		profileStatsRepo:   profileStatsRepo,
		minecraftVersions:  minecraftVersions,
		loaderVersions:     loaderVersions,
		modrinthCache:      modrinthCache,
		curseforgeCache:    curseforgeCache,
	}
}

// GetMinecraftVersions retrieves Minecraft versions (cached)
func (s *cacheServiceServer) GetMinecraftVersions(ctx context.Context, req *pb.GetMinecraftVersionsRequest) (*pb.GetMinecraftVersionsResponse, error) {
	manifest, err := s.minecraftVersions.GetVersions(req.ForceRefresh)
	if err != nil {
		return nil, err
	}
	
	var versions []*pb.MinecraftVersionInfo
	for _, v := range manifest.Versions {
		// Filter by type if requested
		if req.ReleasesOnly && v.Type != "release" {
			continue
		}
		
		versions = append(versions, &pb.MinecraftVersionInfo{
			Id:          v.ID,
			Type:        v.Type,
			ReleaseTime: v.ReleaseTime.Unix(),
		})
	}
	
	return &pb.GetMinecraftVersionsResponse{
		LatestRelease:  manifest.Latest.Release,
		LatestSnapshot: manifest.Latest.Snapshot,
		Versions:       versions,
	}, nil
}

// GetLatestMinecraftVersion retrieves the latest Minecraft release version
func (s *cacheServiceServer) GetLatestMinecraftVersion(ctx context.Context, req *pb.GetLatestMinecraftVersionRequest) (*pb.GetLatestMinecraftVersionResponse, error) {
	version, err := s.minecraftVersions.GetLatestRelease(req.ForceRefresh)
	if err != nil {
		return nil, err
	}
	
	return &pb.GetLatestMinecraftVersionResponse{
		Version: version,
	}, nil
}

// GetFabricVersions retrieves Fabric loader versions (cached)
func (s *cacheServiceServer) GetFabricVersions(ctx context.Context, req *pb.GetLoaderVersionsRequest) (*pb.GetLoaderVersionsResponse, error) {
	versions, err := s.loaderVersions.GetFabricVersions(req.ForceRefresh)
	if err != nil {
		return nil, err
	}
	
	return s.convertLoaderVersions(versions), nil
}

// GetNeoForgeVersions retrieves NeoForge loader versions (cached)
func (s *cacheServiceServer) GetNeoForgeVersions(ctx context.Context, req *pb.GetLoaderVersionsRequest) (*pb.GetLoaderVersionsResponse, error) {
	versions, err := s.loaderVersions.GetNeoForgeVersions(req.ForceRefresh)
	if err != nil {
		return nil, err
	}
	
	return s.convertLoaderVersions(versions), nil
}

// GetQuiltVersions retrieves Quilt loader versions (cached)
func (s *cacheServiceServer) GetQuiltVersions(ctx context.Context, req *pb.GetLoaderVersionsRequest) (*pb.GetLoaderVersionsResponse, error) {
	versions, err := s.loaderVersions.GetQuiltVersions(req.ForceRefresh)
	if err != nil {
		return nil, err
	}
	
	return s.convertLoaderVersions(versions), nil
}

// SearchModrinthMods searches Modrinth with caching
func (s *cacheServiceServer) SearchModrinthMods(ctx context.Context, req *pb.SearchModrinthRequest) (*pb.SearchModrinthResponse, error) {
	data, err := s.modrinthCache.SearchMods(req.Query, int(req.Limit), int(req.Offset), req.Facets, req.ForceRefresh)
	if err != nil {
		return nil, err
	}
	
	return &pb.SearchModrinthResponse{
		JsonData: string(data),
	}, nil
}

// GetModrinthProject gets project details with caching
func (s *cacheServiceServer) GetModrinthProject(ctx context.Context, req *pb.GetModrinthProjectRequest) (*pb.GetModrinthProjectResponse, error) {
	data, err := s.modrinthCache.GetProject(req.ProjectId, req.ForceRefresh)
	if err != nil {
		return nil, err
	}
	
	return &pb.GetModrinthProjectResponse{
		JsonData: string(data),
	}, nil
}

// GetModrinthVersions gets project versions with caching
func (s *cacheServiceServer) GetModrinthVersions(ctx context.Context, req *pb.GetModrinthVersionsRequest) (*pb.GetModrinthVersionsResponse, error) {
	data, err := s.modrinthCache.GetProjectVersions(req.ProjectId, req.GameVersion, req.Loaders, req.ForceRefresh)
	if err != nil {
		return nil, err
	}
	
	return &pb.GetModrinthVersionsResponse{
		JsonData: string(data),
	}, nil
}

// GetModrinthCategories gets categories with caching
func (s *cacheServiceServer) GetModrinthCategories(ctx context.Context, req *pb.GetModrinthCategoriesRequest) (*pb.GetModrinthCategoriesResponse, error) {
	data, err := s.modrinthCache.GetCategories(req.ForceRefresh)
	if err != nil {
		return nil, err
	}
	
	return &pb.GetModrinthCategoriesResponse{
		JsonData: string(data),
	}, nil
}

// SearchCurseForgeMods searches CurseForge with caching
func (s *cacheServiceServer) SearchCurseForgeMods(ctx context.Context, req *pb.SearchCurseForgeRequest) (*pb.SearchCurseForgeResponse, error) {
	data, err := s.curseforgeCache.SearchMods(
		req.Query,
		req.GameVersion,
		int(req.ModLoaderType),
		int(req.PageSize),
		int(req.Index),
		req.ForceRefresh,
	)
	if err != nil {
		return nil, err
	}
	
	return &pb.SearchCurseForgeResponse{
		JsonData: string(data),
	}, nil
}

// GetCurseForgeMod gets mod details with caching
func (s *cacheServiceServer) GetCurseForgeMod(ctx context.Context, req *pb.GetCurseForgeModRequest) (*pb.GetCurseForgeModResponse, error) {
	data, err := s.curseforgeCache.GetMod(req.ModId, req.ForceRefresh)
	if err != nil {
		return nil, err
	}
	
	return &pb.GetCurseForgeModResponse{
		JsonData: string(data),
	}, nil
}

// GetCurseForgeFiles gets mod files with caching
func (s *cacheServiceServer) GetCurseForgeFiles(ctx context.Context, req *pb.GetCurseForgeFilesRequest) (*pb.GetCurseForgeFilesResponse, error) {
	data, err := s.curseforgeCache.GetModFiles(
		req.ModId,
		req.GameVersion,
		int(req.ModLoaderType),
		req.ForceRefresh,
	)
	if err != nil {
		return nil, err
	}
	
	return &pb.GetCurseForgeFilesResponse{
		JsonData: string(data),
	}, nil
}

// GetJavaInstallations retrieves all detected Java installations
func (s *cacheServiceServer) GetJavaInstallations(ctx context.Context, req *pb.GetJavaInstallationsRequest) (*pb.GetJavaInstallationsResponse, error) {
	installations, err := s.javaRepo.GetAll()
	if err != nil {
		return nil, err
	}
	
	var pbInstallations []*pb.JavaInstallation
	for _, inst := range installations {
		pbInstallations = append(pbInstallations, &pb.JavaInstallation{
			Id:           inst.ID,
			Path:         inst.Path,
			Version:      inst.Version,
			Vendor:       inst.Vendor,
			Architecture: inst.Architecture,
			IsValid:      inst.IsValid,
			DetectedAt:   inst.DetectedAt.Unix(),
		})
	}
	
	return &pb.GetJavaInstallationsResponse{
		Installations: pbInstallations,
	}, nil
}

// RefreshJavaInstallations triggers a re-scan of Java installations
func (s *cacheServiceServer) RefreshJavaInstallations(ctx context.Context, req *pb.RefreshJavaInstallationsRequest) (*pb.RefreshJavaInstallationsResponse, error) {
	// Note: Actual Java detection logic should be implemented separately
	// For now, just return current installations
	return &pb.RefreshJavaInstallationsResponse{
		Installations: []*pb.JavaInstallation{},
	}, fmt.Errorf("Java detection not implemented yet")
}

// GetProfileStats retrieves profile statistics
func (s *cacheServiceServer) GetProfileStats(ctx context.Context, req *pb.GetProfileStatsRequest) (*pb.GetProfileStatsResponse, error) {
	stats, err := s.profileStatsRepo.Get(req.ProfileId)
	if err != nil {
		return nil, err
	}
	
	pbStats := &pb.ProfileStats{
		ProfileId:     stats.ProfileID,
		TotalPlayTime: stats.TotalPlayTime,
		LaunchCount:   int32(stats.LaunchCount),
		CrashCount:    int32(stats.CrashCount),
	}
	
	if stats.LastLaunchedAt != nil {
		pbStats.LastLaunchedAt = stats.LastLaunchedAt.Unix()
	}
	if stats.LastCrashAt != nil {
		pbStats.LastCrashAt = stats.LastCrashAt.Unix()
	}
	
	return &pb.GetProfileStatsResponse{
		Stats: pbStats,
	}, nil
}

// RecordProfileLaunch records a profile launch
func (s *cacheServiceServer) RecordProfileLaunch(ctx context.Context, req *pb.RecordProfileLaunchRequest) (*pb.RecordProfileLaunchResponse, error) {
	err := s.profileStatsRepo.RecordLaunch(req.ProfileId)
	if err != nil {
		return &pb.RecordProfileLaunchResponse{Success: false}, err
	}
	
	return &pb.RecordProfileLaunchResponse{Success: true}, nil
}

// RecordProfilePlayTime records play time for a profile
func (s *cacheServiceServer) RecordProfilePlayTime(ctx context.Context, req *pb.RecordProfilePlayTimeRequest) (*pb.RecordProfilePlayTimeResponse, error) {
	err := s.profileStatsRepo.RecordPlayTime(req.ProfileId, req.Seconds)
	if err != nil {
		return &pb.RecordProfilePlayTimeResponse{Success: false}, err
	}
	
	return &pb.RecordProfilePlayTimeResponse{Success: true}, nil
}

// RecordProfileCrash records a profile crash
func (s *cacheServiceServer) RecordProfileCrash(ctx context.Context, req *pb.RecordProfileCrashRequest) (*pb.RecordProfileCrashResponse, error) {
	err := s.profileStatsRepo.RecordCrash(req.ProfileId)
	if err != nil {
		return &pb.RecordProfileCrashResponse{Success: false}, err
	}
	
	return &pb.RecordProfileCrashResponse{Success: true}, nil
}

// InvalidateCache invalidates specific cache entries
func (s *cacheServiceServer) InvalidateCache(ctx context.Context, req *pb.InvalidateCacheRequest) (*pb.InvalidateCacheResponse, error) {
	var err error
	
	switch req.CacheType {
	case "minecraft":
		err = s.minecraftVersions.InvalidateCache()
	case "fabric":
		err = s.loaderVersions.InvalidateCache("fabric")
	case "neoforge":
		err = s.loaderVersions.InvalidateCache("neoforge")
	case "quilt":
		err = s.loaderVersions.InvalidateCache("quilt")
	case "modrinth":
		if req.CacheKey != "" {
			err = s.modrinthCache.InvalidateProject(req.CacheKey)
		} else {
			err = s.modrinthCache.InvalidateSearch()
		}
	case "curseforge":
		if req.CacheKey != "" {
			err = s.curseforgeCache.InvalidateMod(req.CacheKey)
		} else {
			err = s.curseforgeCache.InvalidateSearch()
		}
	default:
		return &pb.InvalidateCacheResponse{Success: false}, fmt.Errorf("unknown cache type: %s", req.CacheType)
	}
	
	if err != nil {
		return &pb.InvalidateCacheResponse{Success: false}, err
	}
	
	return &pb.InvalidateCacheResponse{Success: true}, nil
}

// ClearExpiredCache removes all expired cache entries
func (s *cacheServiceServer) ClearExpiredCache(ctx context.Context, req *pb.ClearExpiredCacheRequest) (*pb.ClearExpiredCacheResponse, error) {
	err := s.apiCacheRepo.CleanExpired()
	if err != nil {
		return &pb.ClearExpiredCacheResponse{DeletedCount: 0}, err
	}
	
	// Note: We don't track how many were deleted, so return 0
	return &pb.ClearExpiredCacheResponse{DeletedCount: 0}, nil
}

// convertLoaderVersions converts domain loader versions to protobuf
func (s *cacheServiceServer) convertLoaderVersions(versions []*cache.LoaderVersion) *pb.GetLoaderVersionsResponse {
	var pbVersions []*pb.LoaderVersionInfo
	for _, v := range versions {
		pbVersion := &pb.LoaderVersionInfo{
			Version:     v.Version,
			Stable:      v.Stable,
			MavenCoords: v.MavenCoords,
		}
		
		if v.BuildNumber != nil {
			pbVersion.BuildNumber = int32(*v.BuildNumber)
		}
		
		pbVersions = append(pbVersions, pbVersion)
	}
	
	return &pb.GetLoaderVersionsResponse{
		Versions: pbVersions,
	}
}
