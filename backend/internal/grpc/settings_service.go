package grpc

import (
    "context"
    "encoding/json"
    "log"
    "os"
    "path/filepath"
    "sync"

    pb "hyenimc/backend/gen/launcher"
)

var (
    settingsMu   sync.RWMutex
    settings     = &pb.GlobalSettings{
        Download: &pb.DownloadSettings{
            RequestTimeoutMs: 3000,
            MaxRetries:       5,
            MaxParallel:      10,
        },
    }
    settingsPath string
)

func init() {
    userHome, _ := os.UserHomeDir()
    settingsPath = filepath.Join(userHome, "AppData", "Roaming", "HyeniMC", "settings.json")
    loadSettings()
}

func loadSettings() {
    data, err := os.ReadFile(settingsPath)
    if err != nil {
        log.Printf("[Settings] No settings file found, using defaults")
        return
    }
    
    // Parse as map first to handle snake_case JSON
    var settingsMap map[string]map[string]interface{}
    if err := json.Unmarshal(data, &settingsMap); err != nil {
        log.Printf("[Settings] Failed to parse settings: %v", err)
        return
    }
    
    // Helper function to safely get int32 with default
    getInt32 := func(m map[string]interface{}, key string, def int32) int32 {
        if v, ok := m[key]; ok && v != nil {
            if f, ok := v.(float64); ok {
                return int32(f)
            }
        }
        return def
    }
    
    // Helper function to safely get string with default
    getString := func(m map[string]interface{}, key string, def string) string {
        if v, ok := m[key]; ok && v != nil {
            if s, ok := v.(string); ok {
                return s
            }
        }
        return def
    }
    
    // Helper function to safely get bool with default
    getBool := func(m map[string]interface{}, key string, def bool) bool {
        if v, ok := m[key]; ok && v != nil {
            if b, ok := v.(bool); ok {
                return b
            }
        }
        return def
    }
    
    // Convert to protobuf struct with safe defaults
    loaded := &pb.GlobalSettings{
        Download: &pb.DownloadSettings{
            RequestTimeoutMs: getInt32(settingsMap["download"], "request_timeout_ms", 3000),
            MaxRetries:       getInt32(settingsMap["download"], "max_retries", 5),
            MaxParallel:      getInt32(settingsMap["download"], "max_parallel", 10),
        },
        Java: &pb.JavaSettings{
            JavaPath:  getString(settingsMap["java"], "java_path", ""),
            MemoryMin: getInt32(settingsMap["java"], "memory_min", 1024),
            MemoryMax: getInt32(settingsMap["java"], "memory_max", 4096),
        },
        Resolution: &pb.ResolutionSettings{
            Width:      getInt32(settingsMap["resolution"], "width", 854),
            Height:     getInt32(settingsMap["resolution"], "height", 480),
            Fullscreen: getBool(settingsMap["resolution"], "fullscreen", false),
        },
        Cache: &pb.CacheSettings{
            Enabled:   getBool(settingsMap["cache"], "enabled", true),
            MaxSizeGb: getInt32(settingsMap["cache"], "max_size_gb", 10),
            TtlDays:   getInt32(settingsMap["cache"], "ttl_days", 30),
        },
    }
    
    settingsMu.Lock()
    settings = loaded
    settingsMu.Unlock()
    log.Printf("[Settings] Loaded settings from %s", settingsPath)
}

func saveSettings() error {
    settingsMu.RLock()
    defer settingsMu.RUnlock()
    
    // Convert to a map for proper JSON field names
    settingsMap := map[string]interface{}{
        "download": map[string]interface{}{
            "request_timeout_ms": settings.Download.RequestTimeoutMs,
            "max_retries":        settings.Download.MaxRetries,
            "max_parallel":       settings.Download.MaxParallel,
        },
        "java": map[string]interface{}{
            "java_path":  settings.Java.JavaPath,
            "memory_min": settings.Java.MemoryMin,
            "memory_max": settings.Java.MemoryMax,
        },
        "resolution": map[string]interface{}{
            "width":      settings.Resolution.Width,
            "height":     settings.Resolution.Height,
            "fullscreen": settings.Resolution.Fullscreen,
        },
        "cache": map[string]interface{}{
            "enabled":     settings.Cache.Enabled,
            "max_size_gb": settings.Cache.MaxSizeGb,
            "ttl_days":    settings.Cache.TtlDays,
        },
    }
    
    data, err := json.MarshalIndent(settingsMap, "", "  ")
    if err != nil {
        return err
    }
    
    dir := filepath.Dir(settingsPath)
    if err := os.MkdirAll(dir, 0755); err != nil {
        return err
    }
    
    if err := os.WriteFile(settingsPath, data, 0644); err != nil {
        return err
    }
    
    log.Printf("[Settings] Saved settings to %s", settingsPath)
    return nil
}

type settingsServiceServer struct {
    pb.UnimplementedSettingsServiceServer
}

func NewSettingsServiceServer() pb.SettingsServiceServer { return &settingsServiceServer{} }

func (s *settingsServiceServer) GetSettings(ctx context.Context, _ *pb.GetSettingsRequest) (*pb.GetSettingsResponse, error) {
    settingsMu.RLock()
    defer settingsMu.RUnlock()
    
    // Convert to snake_case for frontend compatibility
    out := &pb.GlobalSettings{
        Download: &pb.DownloadSettings{
            RequestTimeoutMs: settings.Download.RequestTimeoutMs,
            MaxRetries:       settings.Download.MaxRetries,
            MaxParallel:      settings.Download.MaxParallel,
        },
        Java: &pb.JavaSettings{
            JavaPath:  settings.Java.JavaPath,
            MemoryMin: settings.Java.MemoryMin,
            MemoryMax: settings.Java.MemoryMax,
        },
        Resolution: &pb.ResolutionSettings{
            Width:      settings.Resolution.Width,
            Height:     settings.Resolution.Height,
            Fullscreen: settings.Resolution.Fullscreen,
        },
        Cache: &pb.CacheSettings{
            Enabled:   settings.Cache.Enabled,
            MaxSizeGb: settings.Cache.MaxSizeGb,
            TtlDays:   settings.Cache.TtlDays,
        },
    }
    
    return &pb.GetSettingsResponse{Settings: out}, nil
}

func (s *settingsServiceServer) UpdateSettings(ctx context.Context, in *pb.UpdateSettingsRequest) (*pb.UpdateSettingsResponse, error) {
    settingsMu.Lock()
    if in.GetSettings() != nil {
        settings = in.GetSettings()
        if settings.Download == nil { settings.Download = &pb.DownloadSettings{} }
        if settings.Download.RequestTimeoutMs <= 0 { settings.Download.RequestTimeoutMs = 3000 }
        if settings.Download.MaxRetries <= 0 { settings.Download.MaxRetries = 5 }
        if settings.Download.MaxParallel <= 0 { settings.Download.MaxParallel = 10 }
    }
    settingsMu.Unlock()
    
    // Save to file
    if err := saveSettings(); err != nil {
        log.Printf("[Settings] Failed to save settings: %v", err)
        return &pb.UpdateSettingsResponse{Ok: false}, err
    }
    
    return &pb.UpdateSettingsResponse{Ok: true}, nil
}

func currentDownloadSettings() *pb.DownloadSettings {
    settingsMu.RLock()
    d := settings.GetDownload()
    out := *d
    settingsMu.RUnlock()
    if out.RequestTimeoutMs <= 0 { out.RequestTimeoutMs = 3000 }
    if out.MaxRetries <= 0 { out.MaxRetries = 5 }
    if out.MaxParallel <= 0 { out.MaxParallel = 10 }
    return &out
}
