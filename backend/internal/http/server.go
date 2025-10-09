package http

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"hyenimc/backend/internal/domain"
	"hyenimc/backend/internal/services"
)

// Server represents the HTTP server
type Server struct {
	profileService *services.ProfileService
	mux            *http.ServeMux
}

// NewServer creates a new HTTP server
func NewServer(profileService *services.ProfileService) *Server {
	s := &Server{
		profileService: profileService,
		mux:            http.NewServeMux(),
	}
	s.setupRoutes()
	return s
}

func (s *Server) setupRoutes() {
	s.mux.HandleFunc("/api/profiles", s.handleProfiles)
	s.mux.HandleFunc("/api/profiles/", s.handleProfile)
	s.mux.HandleFunc("/health", s.handleHealth)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Enable CORS for local development
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	log.Printf("[HTTP] %s %s", r.Method, r.URL.Path)
	s.mux.ServeHTTP(w, r)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) handleProfiles(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		s.listProfiles(w, r)
	case "POST":
		s.createProfile(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleProfile(w http.ResponseWriter, r *http.Request) {
	// Extract profile ID from path
	path := strings.TrimPrefix(r.URL.Path, "/api/profiles/")
	id := strings.Split(path, "/")[0]

	if id == "" {
		http.Error(w, "Profile ID required", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case "GET":
		s.getProfile(w, r, id)
	case "PATCH":
		s.updateProfile(w, r, id)
	case "DELETE":
		s.deleteProfile(w, r, id)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) createProfile(w http.ResponseWriter, r *http.Request) {
	var req domain.CreateProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	profile, err := s.profileService.CreateProfile(r.Context(), &req)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create profile: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(profile)
}

func (s *Server) listProfiles(w http.ResponseWriter, r *http.Request) {
	profiles, err := s.profileService.ListProfiles(r.Context())
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to list profiles: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profiles)
}

func (s *Server) getProfile(w http.ResponseWriter, r *http.Request, id string) {
	profile, err := s.profileService.GetProfile(r.Context(), id)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get profile: %v", err), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profile)
}

func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request, id string) {
	var updates map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	profile, err := s.profileService.UpdateProfile(r.Context(), id, updates)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to update profile: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profile)
}

func (s *Server) deleteProfile(w http.ResponseWriter, r *http.Request, id string) {
	if err := s.profileService.DeleteProfile(r.Context(), id); err != nil {
		http.Error(w, fmt.Sprintf("Failed to delete profile: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
