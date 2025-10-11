package grpc

import (
	"context"
	"log"

	pb "hyenimc/backend/gen/launcher"
	settingssvc "hyenimc/backend/internal/settings"
)

// Global settings service instance for use by other gRPC services
var globalSettingsService *settingssvc.Service

type settingsServiceServer struct {
	pb.UnimplementedSettingsServiceServer
	service *settingssvc.Service
}

// NewSettingsServiceServer creates a new settings service server
func NewSettingsServiceServer(service *settingssvc.Service) pb.SettingsServiceServer {
	globalSettingsService = service // Store globally for other services
	return &settingsServiceServer{service: service}
}

func (s *settingsServiceServer) GetSettings(ctx context.Context, _ *pb.GetSettingsRequest) (*pb.GetSettingsResponse, error) {
	globalSettings, err := s.service.Get()
	if err != nil {
		log.Printf("[Settings] Failed to get settings: %v", err)
		return nil, err
	}

	return &pb.GetSettingsResponse{
		Settings: &pb.GlobalSettings{
			Download: &pb.DownloadSettings{
				RequestTimeoutMs: globalSettings.DownloadTimeoutMs,
				MaxRetries:       globalSettings.DownloadMaxRetries,
				MaxParallel:      globalSettings.DownloadMaxParallel,
			},
			Java: &pb.JavaSettings{
				JavaPath:  globalSettings.JavaPath,
				MemoryMin: globalSettings.MemoryMin,
				MemoryMax: globalSettings.MemoryMax,
			},
			Resolution: &pb.ResolutionSettings{
				Width:      globalSettings.ResolutionWidth,
				Height:     globalSettings.ResolutionHeight,
				Fullscreen: globalSettings.Fullscreen,
			},
			Cache: &pb.CacheSettings{
				Enabled:   globalSettings.CacheEnabled,
				MaxSizeGb: globalSettings.CacheMaxSizeGB,
				TtlDays:   globalSettings.CacheTTLDays,
			},
		},
	}, nil
}

func (s *settingsServiceServer) UpdateSettings(ctx context.Context, in *pb.UpdateSettingsRequest) (*pb.UpdateSettingsResponse, error) {
	pbSettings := in.GetSettings()
	if pbSettings == nil {
		log.Println("[Settings] No settings provided")
		return &pb.UpdateSettingsResponse{Ok: false}, nil
	}

	globalSettings := &settingssvc.GlobalSettings{
		JavaPath:  pbSettings.Java.JavaPath,
		MemoryMin: pbSettings.Java.MemoryMin,
		MemoryMax: pbSettings.Java.MemoryMax,
		
		ResolutionWidth:  pbSettings.Resolution.Width,
		ResolutionHeight: pbSettings.Resolution.Height,
		Fullscreen:       pbSettings.Resolution.Fullscreen,
		
		DownloadTimeoutMs:  pbSettings.Download.RequestTimeoutMs,
		DownloadMaxRetries: pbSettings.Download.MaxRetries,
		DownloadMaxParallel: pbSettings.Download.MaxParallel,
		
		CacheEnabled:   pbSettings.Cache.Enabled,
		CacheMaxSizeGB: pbSettings.Cache.MaxSizeGb,
		CacheTTLDays:   pbSettings.Cache.TtlDays,
	}

	if err := s.service.Update(globalSettings); err != nil {
		log.Printf("[Settings] Failed to update settings: %v", err)
		return &pb.UpdateSettingsResponse{Ok: false}, err
	}

	log.Println("[Settings] Settings updated successfully")
	return &pb.UpdateSettingsResponse{Ok: true}, nil
}

func (s *settingsServiceServer) ResetCache(ctx context.Context, _ *pb.ResetCacheRequest) (*pb.UpdateSettingsResponse, error) {
	if err := s.service.Reset(); err != nil {
		log.Printf("[Settings] Failed to reset settings: %v", err)
		return &pb.UpdateSettingsResponse{Ok: false}, err
	}

	log.Println("[Settings] Settings reset to defaults")
	return &pb.UpdateSettingsResponse{Ok: true}, nil
}

// currentDownloadSettings returns current download settings for use by other services
func currentDownloadSettings() *pb.DownloadSettings {
	if globalSettingsService == nil {
		log.Println("[Settings] Settings service not initialized, using defaults")
		return &pb.DownloadSettings{
			RequestTimeoutMs: 3000,
			MaxRetries:       5,
			MaxParallel:      10,
		}
	}

	globalSettings, err := globalSettingsService.Get()
	if err != nil {
		log.Printf("[Settings] Failed to get download settings, using defaults: %v", err)
		return &pb.DownloadSettings{
			RequestTimeoutMs: 3000,
			MaxRetries:       5,
			MaxParallel:      10,
		}
	}

	return &pb.DownloadSettings{
		RequestTimeoutMs: globalSettings.DownloadTimeoutMs,
		MaxRetries:       globalSettings.DownloadMaxRetries,
		MaxParallel:      globalSettings.DownloadMaxParallel,
	}
}
