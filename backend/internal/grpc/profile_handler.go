package grpc

import (
	"context"

	"hyenimc/backend/internal/domain"
	"hyenimc/backend/internal/services"
)

// ProfileHandler handles gRPC profile requests
type ProfileHandler struct {
	service *services.ProfileService
}

// NewProfileHandler creates a new profile handler
func NewProfileHandler(service *services.ProfileService) *ProfileHandler {
	return &ProfileHandler{service: service}
}

// CreateProfile handles profile creation requests
func (h *ProfileHandler) CreateProfile(ctx context.Context, req *domain.CreateProfileRequest) (*domain.Profile, error) {
	return h.service.CreateProfile(ctx, req)
}

// GetProfile handles get profile requests
func (h *ProfileHandler) GetProfile(ctx context.Context, id string) (*domain.Profile, error) {
	return h.service.GetProfile(ctx, id)
}

// ListProfiles handles list profiles requests
func (h *ProfileHandler) ListProfiles(ctx context.Context) ([]*domain.Profile, error) {
	return h.service.ListProfiles(ctx)
}

// UpdateProfile handles profile update requests
func (h *ProfileHandler) UpdateProfile(ctx context.Context, id string, updates map[string]interface{}) (*domain.Profile, error) {
	return h.service.UpdateProfile(ctx, id, updates)
}

// DeleteProfile handles profile deletion requests
func (h *ProfileHandler) DeleteProfile(ctx context.Context, id string) error {
	return h.service.DeleteProfile(ctx, id)
}
