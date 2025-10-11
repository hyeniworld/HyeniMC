package settings

import "fmt"

// Default setting values
const (
	// Java settings
	DefaultJavaPath    = ""
	DefaultMemoryMin   = 1024
	DefaultMemoryMax   = 4096

	// Resolution settings
	DefaultResolutionWidth  = 854
	DefaultResolutionHeight = 480
	DefaultFullscreen       = false

	// Download settings
	DefaultDownloadTimeoutMs  = 3000
	DefaultDownloadMaxRetries = 5
	DefaultDownloadMaxParallel = 10

	// Cache settings
	DefaultCacheEnabled   = true
	DefaultCacheMaxSizeGB = 10
	DefaultCacheTTLDays   = 30
)

// Setting keys
const (
	KeyJavaPath    = "java.path"
	KeyMemoryMin   = "java.memory_min"
	KeyMemoryMax   = "java.memory_max"

	KeyResolutionWidth  = "resolution.width"
	KeyResolutionHeight = "resolution.height"
	KeyFullscreen       = "resolution.fullscreen"

	KeyDownloadTimeoutMs  = "download.timeout_ms"
	KeyDownloadMaxRetries = "download.max_retries"
	KeyDownloadMaxParallel = "download.max_parallel"

	KeyCacheEnabled   = "cache.enabled"
	KeyCacheMaxSizeGB = "cache.max_size_gb"
	KeyCacheTTLDays   = "cache.ttl_days"
)

// GetDefaultSettings returns a map of default settings
func GetDefaultSettings() map[string]string {
	return map[string]string{
		KeyJavaPath:    DefaultJavaPath,
		KeyMemoryMin:   itoa(DefaultMemoryMin),
		KeyMemoryMax:   itoa(DefaultMemoryMax),
		
		KeyResolutionWidth:  itoa(DefaultResolutionWidth),
		KeyResolutionHeight: itoa(DefaultResolutionHeight),
		KeyFullscreen:       btoa(DefaultFullscreen),
		
		KeyDownloadTimeoutMs:  itoa(DefaultDownloadTimeoutMs),
		KeyDownloadMaxRetries: itoa(DefaultDownloadMaxRetries),
		KeyDownloadMaxParallel: itoa(DefaultDownloadMaxParallel),
		
		KeyCacheEnabled:   btoa(DefaultCacheEnabled),
		KeyCacheMaxSizeGB: itoa(DefaultCacheMaxSizeGB),
		KeyCacheTTLDays:   itoa(DefaultCacheTTLDays),
	}
}

func itoa(i int) string {
	return fmt.Sprintf("%d", i)
}

func btoa(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
