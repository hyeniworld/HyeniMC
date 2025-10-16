package grpc

import (
	"context"

	pb "hyenimc/backend/gen/launcher"
	"hyenimc/backend/internal/cache"
	"hyenimc/backend/internal/domain"
	"hyenimc/backend/internal/services"
)

// profileServiceServer adapts internal ProfileService to protobuf ProfileServiceServer
type profileServiceServer struct {
	pb.UnimplementedProfileServiceServer
	service   *services.ProfileService
	statsRepo *cache.ProfileStatsRepository
}

// NewProfileServiceServer creates a new protobuf server backed by internal service
func NewProfileServiceServer(svc *services.ProfileService, statsRepo *cache.ProfileStatsRepository) pb.ProfileServiceServer {
	return &profileServiceServer{
		service:   svc,
		statsRepo: statsRepo,
	}
}

func (s *profileServiceServer) CreateProfile(ctx context.Context, req *pb.CreateProfileRequest) (*pb.Profile, error) {
	p, err := s.service.CreateProfile(ctx, &domain.CreateProfileRequest{
		Name:          req.GetName(),
		Description:   req.GetDescription(),
		GameVersion:   req.GetGameVersion(),
		LoaderType:    req.GetLoaderType(),
		LoaderVersion: req.GetLoaderVersion(),
		Icon:          req.GetIcon(),
	})
	if err != nil {
		return nil, err
	}
	return toPbProfile(p), nil
}

func (s *profileServiceServer) GetProfile(ctx context.Context, req *pb.GetProfileRequest) (*pb.Profile, error) {
	p, err := s.service.GetProfile(ctx, req.GetId())
	if err != nil {
		return nil, err
	}

	// Get stats and update total play time
	pbProfile := toPbProfile(p)
	if stats, err := s.statsRepo.Get(p.ID); err == nil && stats != nil {
		pbProfile.TotalPlayTime = stats.TotalPlayTime
	}

	return pbProfile, nil
}

func (s *profileServiceServer) ListProfiles(ctx context.Context, _ *pb.ListProfilesRequest) (*pb.ListProfilesResponse, error) {
	list, err := s.service.ListProfiles(ctx)
	if err != nil {
		return nil, err
	}
	res := &pb.ListProfilesResponse{Profiles: make([]*pb.Profile, 0, len(list))}
	for _, p := range list {
		pbProfile := toPbProfile(p)

		// Get stats and update total play time
		if stats, err := s.statsRepo.Get(p.ID); err == nil && stats != nil {
			pbProfile.TotalPlayTime = stats.TotalPlayTime
		}

		res.Profiles = append(res.Profiles, pbProfile)
	}
	return res, nil
}

func (s *profileServiceServer) UpdateProfile(ctx context.Context, req *pb.UpdateProfileRequest) (*pb.Profile, error) {
	updates := map[string]interface{}{}
	if patch := req.GetPatch(); patch != nil {
		// Update name only if not empty (required field)
		if patch.Name != "" {
			updates["name"] = patch.Name
		}
		if patch.Description != "" {
			updates["description"] = patch.Description
		}
		if patch.Icon != "" {
			updates["icon"] = patch.Icon
		}
		if patch.GameVersion != "" {
			updates["gameVersion"] = patch.GameVersion
		}
		// Always update loaderType (required field, should never be empty from frontend)
		if patch.LoaderType != "" {
			updates["loaderType"] = patch.LoaderType
			// Update loaderVersion: empty only allowed for vanilla
			if patch.LoaderType == "vanilla" {
				updates["loaderVersion"] = "" // Clear version for vanilla
			} else if patch.LoaderVersion != "" {
				updates["loaderVersion"] = patch.LoaderVersion // Require version for other loaders
			}
		}
		if patch.GameDirectory != "" {
			updates["gameDirectory"] = patch.GameDirectory
		}
		// Always update jvmArgs if provided (including empty array to clear)
		if patch.JvmArgs != nil {
			arr := make([]interface{}, 0, len(patch.JvmArgs))
			for _, v := range patch.JvmArgs {
				arr = append(arr, v)
			}
			updates["jvmArgs"] = arr
		}
		// Always update gameArgs if provided (including empty array to clear)
		if patch.GameArgs != nil {
			arr := make([]interface{}, 0, len(patch.GameArgs))
			for _, v := range patch.GameArgs {
				arr = append(arr, v)
			}
			updates["gameArgs"] = arr
		}
		// Always update memory/java/resolution if provided (0/empty = use global settings)
		if req.GetPatch() != nil {
			updates["minMemory"] = float64(patch.MemoryMin)
			updates["maxMemory"] = float64(patch.MemoryMax)
			updates["javaPath"] = patch.JavaPath
			updates["resolutionWidth"] = float64(patch.ResolutionWidth)
			updates["resolutionHeight"] = float64(patch.ResolutionHeight)
			updates["fullscreen"] = patch.Fullscreen
			updates["favorite"] = patch.Favorite
			updates["serverAddress"] = patch.ServerAddress
		}
	}

	p, err := s.service.UpdateProfile(ctx, req.GetId(), updates)
	if err != nil {
		return nil, err
	}
	return toPbProfile(p), nil
}

func (s *profileServiceServer) DeleteProfile(ctx context.Context, req *pb.DeleteProfileRequest) (*pb.DeleteProfileResponse, error) {
	if err := s.service.DeleteProfile(ctx, req.GetId()); err != nil {
		return nil, err
	}
	return &pb.DeleteProfileResponse{Success: true}, nil
}

func toPbProfile(p *domain.Profile) *pb.Profile {
	var lastPlayed int64
	if !p.LastPlayed.IsZero() {
		lastPlayed = p.LastPlayed.Unix()
	}
	return &pb.Profile{
		Id:               p.ID,
		Name:             p.Name,
		Description:      p.Description,
		Icon:             p.Icon,
		GameVersion:      p.GameVersion,
		LoaderType:       p.LoaderType,
		LoaderVersion:    p.LoaderVersion,
		GameDirectory:    p.GameDirectory,
		JvmArgs:          p.JvmArgs,
		MemoryMin:        p.Memory.Min,
		MemoryMax:        p.Memory.Max,
		GameArgs:         p.GameArgs,
		ModpackId:        p.ModpackID,
		ModpackSource:    p.ModpackSource,
		CreatedAt:        p.CreatedAt.Unix(),
		UpdatedAt:        p.UpdatedAt.Unix(),
		LastPlayed:       lastPlayed,
		TotalPlayTime:    p.TotalPlayTime,
		JavaPath:         p.JavaPath,
		ResolutionWidth:  p.Resolution.Width,
		ResolutionHeight: p.Resolution.Height,
		Fullscreen:       p.Fullscreen,
		Favorite:         p.Favorite,
		ServerAddress:    p.ServerAddress,
	}
}
