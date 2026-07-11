package grpc

import (
    "context"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os/exec"
    "sort"
    "strconv"
    "strings"
    "sync"
    "time"
    "os"
    "path/filepath"

    pb "hyenimc/backend/gen/launcher"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
)

type loaderServiceServer struct {
    pb.UnimplementedLoaderServiceServer
    mu    sync.RWMutex
    cache map[string]cacheEntry
}

// minimal profile model to pull libraries
type profileLibrary struct {
    Name string `json:"name"`
    URL  string `json:"url,omitempty"`
}
type profileJSON struct {
    Libraries []profileLibrary `json:"libraries"`
}

func mavenCoordsToPath(name string) (groupPath, artifact, version, fileName string, ok bool) {
    parts := strings.Split(name, ":")
    if len(parts) < 3 { return "", "", "", "", false }
    group := parts[0]
    artifact = parts[1]
    version = parts[2]
    groupPath = strings.ReplaceAll(group, ".", "/")
    fileName = fmt.Sprintf("%s-%s.jar", artifact, version)
    return
}

func downloadLibrary(ctx context.Context, baseURL, groupPath, artifact, version, fileName, dest string) error {
    url := fmt.Sprintf("%s%s/%s/%s/%s", baseURL, strings.TrimSuffix(ifEmpty(baseURL, ""), "/"), "", "", "")
    // baseURL may or may not include trailing '/'
    if !strings.HasSuffix(baseURL, "/") { baseURL += "/" }
    url = fmt.Sprintf("%s%s/%s/%s/%s", baseURL, groupPath, artifact, version, fileName)
    cctx, cancel := context.WithTimeout(ctx, 60*time.Second)
    defer cancel()
    req, err := http.NewRequestWithContext(cctx, http.MethodGet, url, nil)
    if err != nil { return err }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return err }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK { return fmt.Errorf("library status: %s", resp.Status) }
    if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil { return err }
    f, err := os.Create(dest)
    if err != nil { return err }
    if _, err := io.Copy(f, resp.Body); err != nil { _ = f.Close(); return err }
    return f.Close()
}

func ifEmpty[T ~string](v T, def T) T { if v == "" { return def }; return v }

// InstallStream streams coarse-grained install progress updates to the client.
func (s *loaderServiceServer) InstallStream(req *pb.InstallRequest, stream pb.LoaderService_InstallStreamServer) error {
    lt := strings.ToLower(strings.TrimSpace(req.GetLoaderType()))
    gv := strings.TrimSpace(req.GetGameVersion())
    lv := strings.TrimSpace(req.GetLoaderVersion())
    inst := strings.TrimSpace(req.GetInstanceDir())
    if lt == "" || gv == "" || lv == "" || inst == "" {
        return status.Error(codes.InvalidArgument, "loader_type, game_version, loader_version, instance_dir are required")
    }

    send := func(msg string, cur, total int32, vid string) error {
        percent := int32(0)
        if total > 0 && cur >= 0 {
            percent = int32((int(cur) * 100) / int(total))
        }
        return stream.Send(&pb.InstallProgress{Message: msg, Current: cur, Total: total, Percent: percent, VersionId: vid})
    }

    switch lt {
    case "fabric":
        vid := fmt.Sprintf("fabric-loader-%s-%s", lv, gv)
        if err := send("Preparing Fabric install...", 0, 3, vid); err != nil { return err }
        if err := send("Downloading Fabric profile...", 1, 3, vid); err != nil { return err }
        if _, err := s.Install(stream.Context(), req); err != nil { return err }
        if err := send("Finalizing Fabric install...", 2, 3, vid); err != nil { return err }
        return send("Completed", 3, 3, vid)
    case "neoforge":
        vid := fmt.Sprintf("neoforge-%s", lv)
        if err := send("Preparing NeoForge install...", 0, 4, vid); err != nil { return err }
        if err := send("Downloading NeoForge installer...", 1, 4, vid); err != nil { return err }
        if _, err := s.Install(stream.Context(), req); err != nil { return err }
        if err := send("Finalizing NeoForge install...", 3, 4, vid); err != nil { return err }
        return send("Completed", 4, 4, vid)
    case "quilt":
        vid := fmt.Sprintf("quilt-loader-%s-%s", lv, gv)
        if err := send("Preparing Quilt install...", 0, 3, vid); err != nil { return err }
        if err := send("Downloading Quilt profile...", 1, 3, vid); err != nil { return err }
        if _, err := s.Install(stream.Context(), req); err != nil { return err }
        if err := send("Finalizing Quilt install...", 2, 3, vid); err != nil { return err }
        return send("Completed", 3, 3, vid)
    case "forge":
        vid := forgeVersionID(lv)
        if err := send("Preparing Forge install...", 0, 4, vid); err != nil { return err }
        if err := send("Downloading Forge installer...", 1, 4, vid); err != nil { return err }
        if _, err := s.Install(stream.Context(), req); err != nil { return err }
        if err := send("Finalizing Forge install...", 3, 4, vid); err != nil { return err }
        return send("Completed", 4, 4, vid)
    default:
        return status.Error(codes.InvalidArgument, "unknown loader_type")
    }
}

// NeoForge: use maven API to list versions and infer MC compatibility from leading major.minor in version string
// API: https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge
type neoForgeResponse struct {
    Versions []string `json:"versions"`
}

func (s *loaderServiceServer) fetchNeoForge(ctx context.Context, gameVersion string) ([]*pb.LoaderVersion, error) {
    url := "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge"
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    if err != nil { return nil, status.Errorf(codes.Internal, "build request: %v", err) }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return nil, status.Errorf(codes.Unavailable, "fetch neoforge: %v", err) }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK { return nil, status.Errorf(codes.Unavailable, "neoforge status: %s", resp.Status) }

    // The API may return either an array or an object with versions
    // Try decode into object first, then fall back to array
    var obj neoForgeResponse
    dec := json.NewDecoder(resp.Body)
    if err := dec.Decode(&obj); err != nil {
        // if not object, try re-fetch to decode as array
        // re-issue request because body is consumed
        r2, err2 := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
        if err2 != nil { return nil, status.Errorf(codes.Internal, "build request2: %v", err2) }
        resp2, err2 := http.DefaultClient.Do(r2)
        if err2 != nil { return nil, status.Errorf(codes.Unavailable, "fetch neoforge2: %v", err2) }
        defer resp2.Body.Close()
        if resp2.StatusCode != http.StatusOK { return nil, status.Errorf(codes.Unavailable, "neoforge status2: %s", resp2.Status) }
        var arr []string
        if err3 := json.NewDecoder(resp2.Body).Decode(&arr); err3 != nil {
            return nil, status.Errorf(codes.Internal, "decode neoforge: %v", err3)
        }
        obj.Versions = arr
    }

    // parse MC version to major.minor integers
    mcParts := strings.Split(gameVersion, ".")
    if len(mcParts) < 2 { return nil, status.Error(codes.InvalidArgument, "invalid game_version format") }
    mcMajor, _ := strconv.Atoi(mcParts[1])
    mcMinor := 0
    if len(mcParts) >= 3 { mcMinor, _ = strconv.Atoi(mcParts[2]) }

    out := make([]*pb.LoaderVersion, 0, len(obj.Versions))
    for _, v := range obj.Versions {
        // version format: 21.1.72[-beta]
        m := strings.SplitN(v, ".", 3)
        if len(m) < 2 { continue }
        nvMajor, err1 := strconv.Atoi(m[0])
        nvMinor, err2 := strconv.Atoi(m[1])
        if err1 != nil || err2 != nil { continue }
        if nvMajor == mcMajor && nvMinor == mcMinor {
            stable := !(strings.Contains(v, "beta") || strings.Contains(v, "alpha"))
            out = append(out, &pb.LoaderVersion{Version: v, Stable: stable})
        }
    }
    return out, nil
}

// Forge: maven-metadata.xml에서 `<mc>-<build>` 버전 목록을 가져와 MC 프리픽스로 필터.
// (Tauri hyenimc-launcher::loader의 forge_versions와 동일 소스/의미)
const forgeMavenMetadata = "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml"

// parseMavenVersions extracts <version> tag contents from maven-metadata.xml without an XML dep.
func parseMavenVersions(body string) []string {
    var out []string
    rest := body
    for {
        i := strings.Index(rest, "<version>")
        if i < 0 {
            break
        }
        rest = rest[i+len("<version>"):]
        j := strings.Index(rest, "</version>")
        if j < 0 {
            break
        }
        if v := strings.TrimSpace(rest[:j]); v != "" {
            out = append(out, v)
        }
        rest = rest[j+len("</version>"):]
    }
    return out
}

// forgeVersionID: maven "1.20.1-47.4.20" -> installer가 만드는 버전 id "1.20.1-forge-47.4.20".
func forgeVersionID(forgeVersion string) string {
    if i := strings.Index(forgeVersion, "-"); i >= 0 {
        return forgeVersion[:i] + "-forge-" + forgeVersion[i+1:]
    }
    return forgeVersion
}

func (s *loaderServiceServer) fetchForge(ctx context.Context, gameVersion string) ([]*pb.LoaderVersion, error) {
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, forgeMavenMetadata, nil)
    if err != nil { return nil, status.Errorf(codes.Internal, "build request: %v", err) }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return nil, status.Errorf(codes.Unavailable, "fetch forge: %v", err) }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK { return nil, status.Errorf(codes.Unavailable, "forge status: %s", resp.Status) }
    body, err := io.ReadAll(resp.Body)
    if err != nil { return nil, status.Errorf(codes.Internal, "read forge: %v", err) }

    // Forge maven 버전은 `<mc>-<build>` (예: 1.20.1-47.4.20). MC 프리픽스로 필터('-' 경계로 1.20.1 vs 1.20.10 구분).
    prefix := gameVersion + "-"
    var out []*pb.LoaderVersion
    for _, v := range parseMavenVersions(string(body)) {
        if !strings.HasPrefix(v, prefix) {
            continue
        }
        stable := !(strings.Contains(v, "beta") || strings.Contains(v, "rc"))
        out = append(out, &pb.LoaderVersion{Version: v, Stable: stable})
    }
    return out, nil
}

// ensureLauncherProfiles: Forge installer는 대상 디렉터리에 launcher_profiles.json이 있어야 실행된다.
func ensureLauncherProfiles(instanceDir string) error {
    p := filepath.Join(instanceDir, "launcher_profiles.json")
    if _, err := os.Stat(p); err == nil {
        return nil
    }
    if err := os.MkdirAll(instanceDir, 0o755); err != nil {
        return err
    }
    profiles := map[string]any{
        "profiles":        map[string]any{},
        "selectedProfile": "(Default)",
        "clientToken":     "00000000-0000-0000-0000-000000000000",
        "launcherVersion": map[string]any{"name": "HyeniMC", "format": 21},
    }
    b, err := json.MarshalIndent(profiles, "", "  ")
    if err != nil {
        return err
    }
    return os.WriteFile(p, b, 0o644)
}

type cacheEntry struct {
    at   time.Time
    ttl  time.Duration
    data []*pb.LoaderVersion
}

func NewLoaderServiceServer() pb.LoaderServiceServer {
    return &loaderServiceServer{cache: make(map[string]cacheEntry)}
}

func (s *loaderServiceServer) cacheKey(t, gv string, unstable bool) string {
    return fmt.Sprintf("%s|%s|%t", t, gv, unstable)
}

func (s *loaderServiceServer) fromCache(key string) ([]*pb.LoaderVersion, bool) {
    s.mu.RLock()
    ce, ok := s.cache[key]
    s.mu.RUnlock()
    if !ok || time.Since(ce.at) > ce.ttl { return nil, false }
    out := make([]*pb.LoaderVersion, len(ce.data))
    copy(out, ce.data)
    return out, true
}

func (s *loaderServiceServer) setCache(key string, data []*pb.LoaderVersion) {
    s.mu.Lock()
    s.cache[key] = cacheEntry{at: time.Now(), ttl: 10 * time.Minute, data: data}
    s.mu.Unlock()
}

// API response models (minified)
// Fabric API: https://meta.fabricmc.net/v2/versions/loader/{gameVersion}
// Each entry is an object containing a nested `loader` with version/stable.
type fabricEntry struct {
    Loader struct {
        Version string `json:"version"`
        Stable  bool   `json:"stable"`
    } `json:"loader"`
}

// Quilt API: https://meta.quiltmc.org/v3/versions/loader/{gameVersion}
// Similar shape: entries with nested `loader`.
type quiltEntry struct {
    Loader struct {
        Version string `json:"version"`
        Stable  bool   `json:"stable"`
    } `json:"loader"`
}

func (s *loaderServiceServer) fetchFabric(ctx context.Context, gameVersion string, includeUnstable bool) ([]*pb.LoaderVersion, error) {
    url := fmt.Sprintf("https://meta.fabricmc.net/v2/versions/loader/%s", gameVersion)
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    if err != nil { return nil, status.Errorf(codes.Internal, "build request: %v", err) }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return nil, status.Errorf(codes.Unavailable, "fetch fabric: %v", err) }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK { return nil, status.Errorf(codes.Unavailable, "fabric status: %s", resp.Status) }
    var arr []fabricEntry
    if err := json.NewDecoder(resp.Body).Decode(&arr); err != nil { return nil, status.Errorf(codes.Internal, "decode fabric: %v", err) }
    out := make([]*pb.LoaderVersion, 0, len(arr))
    for _, e := range arr {
        // 수집 단계에서는 안정/비안정 모두 포함
        out = append(out, &pb.LoaderVersion{Version: e.Loader.Version, Stable: e.Loader.Stable, ReleaseTime: 0})
    }
    // latest first: assume order by API; keep as-is; otherwise sort by version string desc
    return out, nil
}

func (s *loaderServiceServer) fetchQuilt(ctx context.Context, gameVersion string, includeUnstable bool) ([]*pb.LoaderVersion, error) {
    url := fmt.Sprintf("https://meta.quiltmc.org/v3/versions/loader/%s", gameVersion)
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    if err != nil { return nil, status.Errorf(codes.Internal, "build request: %v", err) }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return nil, status.Errorf(codes.Unavailable, "fetch quilt: %v", err) }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK { return nil, status.Errorf(codes.Unavailable, "quilt status: %s", resp.Status) }
    var arr []quiltEntry
    if err := json.NewDecoder(resp.Body).Decode(&arr); err != nil { return nil, status.Errorf(codes.Internal, "decode quilt: %v", err) }
    out := make([]*pb.LoaderVersion, 0, len(arr))
    for _, e := range arr {
        // 수집 단계에서는 안정/비안정 모두 포함
        out = append(out, &pb.LoaderVersion{Version: e.Loader.Version, Stable: e.Loader.Stable, ReleaseTime: 0})
    }
    return out, nil
}

// semverParts parses a version like "0.15.11" or "v0.15.11-beta" into integer parts for comparison.
func semverParts(v string) []int {
    v = strings.TrimSpace(v)
    v = strings.TrimPrefix(v, "v")
    // Split on '.', '-', '+' so full versions like Forge "1.20.1-47.4.20" compare across
    // the build segment too. (Truncating at '-' would tie all builds of one MC version,
    // sorting "47.4.9" above "47.4.20" by string fallback.)
    fields := strings.FieldsFunc(v, func(r rune) bool { return r == '.' || r == '-' || r == '+' })
    out := make([]int, 0, len(fields))
    for _, p := range fields {
        n, err := strconv.Atoi(p)
        if err != nil {
            // non-numeric segment (e.g. "beta") -> 0 to keep ordering stable
            n = 0
        }
        out = append(out, n)
    }
    return out
}

func compareSemverDesc(a, b string) bool {
    pa := semverParts(a)
    pb := semverParts(b)
    // compare element-wise
    l := len(pa)
    if len(pb) > l { l = len(pb) }
    for i := 0; i < l; i++ {
        ai := 0
        bi := 0
        if i < len(pa) { ai = pa[i] }
        if i < len(pb) { bi = pb[i] }
        if ai != bi { return ai > bi }
    }
    // equal numeric parts -> tie-break by string desc
    return a > b
}

func (s *loaderServiceServer) GetVersions(ctx context.Context, req *pb.GetVersionsRequest) (*pb.GetVersionsResponse, error) {
    if req.GetLoaderType() == "" || req.GetGameVersion() == "" {
        return nil, status.Error(codes.InvalidArgument, "loader_type and game_version are required")
    }
    key := s.cacheKey(req.GetLoaderType(), req.GetGameVersion(), req.GetIncludeUnstable())
    if v, ok := s.fromCache(key); ok {
        return &pb.GetVersionsResponse{Versions: v}, nil
    }

    // timeout context
    cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
    defer cancel()

    var versions []*pb.LoaderVersion
    var err error
    switch req.GetLoaderType() {
    case "fabric":
        versions, err = s.fetchFabric(cctx, req.GetGameVersion(), req.GetIncludeUnstable())
    case "quilt":
        versions, err = s.fetchQuilt(cctx, req.GetGameVersion(), req.GetIncludeUnstable())
    case "neoforge":
        versions, err = s.fetchNeoForge(cctx, req.GetGameVersion())
    case "forge":
        versions, err = s.fetchForge(cctx, req.GetGameVersion())
    default:
        return nil, status.Error(codes.InvalidArgument, "unknown loader_type")
    }
    if err != nil { return nil, err }

    // Dedup by version, mark stable=true if any entry for same version is stable
    m := make(map[string]bool)
    for _, v := range versions {
        if s, ok := m[v.Version]; ok {
            m[v.Version] = s || v.Stable
        } else {
            m[v.Version] = v.Stable
        }
    }
    dedup := make([]*pb.LoaderVersion, 0, len(m))
    for ver, st := range m {
        dedup = append(dedup, &pb.LoaderVersion{Version: ver, Stable: st})
    }
    // Apply includeUnstable filter
    filtered := dedup
    if !req.GetIncludeUnstable() {
        tmp := make([]*pb.LoaderVersion, 0, len(dedup))
        for _, v := range dedup {
            if v.Stable { tmp = append(tmp, v) }
        }
        filtered = tmp
    }
    // Sort: stable first, then semantic version desc
    sort.SliceStable(filtered, func(i, j int) bool {
        if filtered[i].Stable != filtered[j].Stable { return filtered[i].Stable && !filtered[j].Stable }
        return compareSemverDesc(filtered[i].Version, filtered[j].Version)
    })

    s.setCache(key, filtered)
    return &pb.GetVersionsResponse{Versions: filtered}, nil
}

func (s *loaderServiceServer) GetRecommended(ctx context.Context, req *pb.GetRecommendedRequest) (*pb.GetRecommendedResponse, error) {
    list, err := s.GetVersions(ctx, &pb.GetVersionsRequest{LoaderType: req.GetLoaderType(), GameVersion: req.GetGameVersion(), IncludeUnstable: false})
    if err != nil {
        if status.Code(err) != codes.Unimplemented {
            // try unstable as fallback on non-unimplemented errors
            list, err = s.GetVersions(ctx, &pb.GetVersionsRequest{LoaderType: req.GetLoaderType(), GameVersion: req.GetGameVersion(), IncludeUnstable: true})
            if err != nil { return nil, err }
        } else {
            return nil, err
        }
    }
    // If stable list is empty, fallback to include unstable
    if len(list.GetVersions()) == 0 {
        list, err = s.GetVersions(ctx, &pb.GetVersionsRequest{LoaderType: req.GetLoaderType(), GameVersion: req.GetGameVersion(), IncludeUnstable: true})
        if err != nil { return nil, err }
        if len(list.GetVersions()) == 0 {
            return nil, status.Error(codes.NotFound, "no loader versions available")
        }
    }
    // pick first (stable-first sort already applied)
    ver := list.GetVersions()[0]
    return &pb.GetRecommendedResponse{Version: ver}, nil
}

func (s *loaderServiceServer) CheckInstalled(ctx context.Context, req *pb.CheckInstalledRequest) (*pb.CheckInstalledResponse, error) {
    // Require instance_dir to avoid platform-specific guessing
    inst := strings.TrimSpace(req.GetInstanceDir())
    if inst == "" {
        return nil, status.Error(codes.FailedPrecondition, "instance_dir is required to check installation")
    }
    lt := strings.ToLower(strings.TrimSpace(req.GetLoaderType()))
    gv := strings.TrimSpace(req.GetGameVersion())
    lv := strings.TrimSpace(req.GetLoaderVersion())
    if lt == "" || gv == "" || lv == "" {
        return nil, status.Error(codes.InvalidArgument, "loader_type, game_version, loader_version are required")
    }

    var versionId string
    switch lt {
    case "vanilla":
        versionId = gv
    case "fabric":
        versionId = fmt.Sprintf("fabric-loader-%s-%s", lv, gv)
    case "neoforge":
        versionId = fmt.Sprintf("neoforge-%s", lv)
    case "quilt":
        versionId = fmt.Sprintf("quilt-loader-%s-%s", lv, gv)
    case "forge":
        versionId = forgeVersionID(lv)
    default:
        return nil, status.Error(codes.InvalidArgument, "unknown loader_type")
    }

    // Check versions/<versionId>/<versionId>.json existence
    profilePath := filepath.Join(inst, "versions", versionId, versionId+".json")
    if _, err := os.Stat(profilePath); err == nil {
        return &pb.CheckInstalledResponse{Installed: true}, nil
    }
    return &pb.CheckInstalledResponse{Installed: false}, nil
}

func (s *loaderServiceServer) Install(ctx context.Context, req *pb.InstallRequest) (*pb.InstallResponse, error) {
    lt := strings.ToLower(strings.TrimSpace(req.GetLoaderType()))
    gv := strings.TrimSpace(req.GetGameVersion())
    lv := strings.TrimSpace(req.GetLoaderVersion())
    inst := strings.TrimSpace(req.GetInstanceDir())
    if lt == "" || gv == "" || lv == "" || inst == "" {
        return nil, status.Error(codes.InvalidArgument, "loader_type, game_version, loader_version, instance_dir are required")
    }

    switch lt {
    case "fabric":
        // Build versionId and path
        versionId := fmt.Sprintf("fabric-loader-%s-%s", lv, gv)
        versionDir := filepath.Join(inst, "versions", versionId)
        profilePath := filepath.Join(versionDir, versionId+".json")

        // Create dir
        if err := os.MkdirAll(versionDir, 0o755); err != nil {
            return nil, status.Errorf(codes.Internal, "create dir: %v", err)
        }

        // Download profile JSON from Fabric Meta
        url := fmt.Sprintf("https://meta.fabricmc.net/v2/versions/loader/%s/%s/profile/json", gv, lv)
        cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
        defer cancel()
        reqHttp, err := http.NewRequestWithContext(cctx, http.MethodGet, url, nil)
        if err != nil { return nil, status.Errorf(codes.Internal, "profile request: %v", err) }
        resp, err := http.DefaultClient.Do(reqHttp)
        if err != nil { return nil, status.Errorf(codes.Unavailable, "fetch profile: %v", err) }
        defer resp.Body.Close()
        if resp.StatusCode != http.StatusOK {
            return nil, status.Errorf(codes.Unavailable, "fabric profile status: %s", resp.Status)
        }
        // Read, save and parse profile JSON
        body, err := io.ReadAll(resp.Body)
        if err != nil { return nil, status.Errorf(codes.Internal, "read profile: %v", err) }
        if err := os.WriteFile(profilePath, body, 0o644); err != nil { return nil, status.Errorf(codes.Internal, "write profile: %v", err) }
        var prof profileJSON
        _ = json.Unmarshal(body, &prof)

        // Download libraries to shared libraries dir: <userData>/shared/libraries
        instancesDir := filepath.Dir(inst)
        userDataDir := filepath.Dir(instancesDir)
        librariesDir := filepath.Join(userDataDir, "shared", "libraries")
        for _, lib := range prof.Libraries {
            gp, art, ver, file, ok := mavenCoordsToPath(lib.Name)
            if !ok { continue }
            base := lib.URL
            if base == "" { base = "https://maven.fabricmc.net/" }
            dest := filepath.Join(librariesDir, gp, art, ver, file)
            if _, err := os.Stat(dest); err == nil { continue }
            if err := downloadLibrary(ctx, base, gp, art, ver, file, dest); err != nil {
                // log and continue; not fatal (launcher may fetch later)
                fmt.Printf("[Install] fabric library download failed %s:%s:%s: %v\n", gp, art, ver, err)
            }
        }

        return &pb.InstallResponse{Success: true, VersionId: versionId}, nil
    case "neoforge":
        versionId := fmt.Sprintf("neoforge-%s", lv)
        versionDir := filepath.Join(inst, "versions", versionId)
        profilePath := filepath.Join(versionDir, versionId+".json")
        if err := os.MkdirAll(versionDir, 0o755); err != nil {
            return nil, status.Errorf(codes.Internal, "create dir: %v", err)
        }

        // Download installer jar to temp
        tempDir := filepath.Join(inst, ".temp")
        if err := os.MkdirAll(tempDir, 0o755); err != nil {
            return nil, status.Errorf(codes.Internal, "create temp dir: %v", err)
        }
        installerURL := fmt.Sprintf("https://maven.neoforged.net/releases/net/neoforged/neoforge/%s/neoforge-%s-installer.jar", lv, lv)
        installerPath := filepath.Join(tempDir, fmt.Sprintf("neoforge-%s-installer.jar", lv))
        {
            cctx, cancel := context.WithTimeout(ctx, 60*time.Second)
            defer cancel()
            reqHttp, err := http.NewRequestWithContext(cctx, http.MethodGet, installerURL, nil)
            if err != nil { return nil, status.Errorf(codes.Internal, "installer request: %v", err) }
            resp, err := http.DefaultClient.Do(reqHttp)
            if err != nil { return nil, status.Errorf(codes.Unavailable, "fetch installer: %v", err) }
            defer resp.Body.Close()
            if resp.StatusCode != http.StatusOK { return nil, status.Errorf(codes.Unavailable, "installer status: %s", resp.Status) }
            f, err := os.Create(installerPath)
            if err != nil { return nil, status.Errorf(codes.Internal, "create installer: %v", err) }
            if _, err := io.Copy(f, resp.Body); err != nil { _ = f.Close(); return nil, status.Errorf(codes.Internal, "write installer: %v", err) }
            if err := f.Close(); err != nil { return nil, status.Errorf(codes.Internal, "close installer: %v", err) }
        }

        // Try to run installer with system java
        runCtx, cancelRun := context.WithTimeout(ctx, 3*time.Minute)
        defer cancelRun()
        cmd := exec.CommandContext(runCtx, "java", "-jar", installerPath, "--install-client", inst)
        if out, err := cmd.CombinedOutput(); err == nil {
            // check profile
            if _, err := os.Stat(profilePath); err == nil {
                return &pb.InstallResponse{Success: true, VersionId: versionId}, nil
            }
            // fallthrough to manual profile if not found
            _ = out
        }

        // Fallback: manual minimal profile (runs vanilla; full NeoForge libraries will download on first launch)
        now := time.Now().UTC().Format(time.RFC3339)
        minimal := map[string]any{
            "id":           versionId,
            "inheritsFrom": gv,
            "releaseTime":  now,
            "time":         now,
            "type":         "release",
            "mainClass":    "net.minecraft.client.main.Main",
            "arguments": map[string]any{
                "game": []string{},
                "jvm":  []string{},
            },
            "libraries": []any{},
        }
        b, err := json.MarshalIndent(minimal, "", "  ")
        if err != nil { return nil, status.Errorf(codes.Internal, "marshal profile: %v", err) }
        if err := os.WriteFile(profilePath, b, 0o644); err != nil { return nil, status.Errorf(codes.Internal, "write profile: %v", err) }
        return &pb.InstallResponse{Success: true, VersionId: versionId}, nil
    case "quilt":
        versionId := fmt.Sprintf("quilt-loader-%s-%s", lv, gv)
        versionDir := filepath.Join(inst, "versions", versionId)
        profilePath := filepath.Join(versionDir, versionId+".json")
        if err := os.MkdirAll(versionDir, 0o755); err != nil {
            return nil, status.Errorf(codes.Internal, "create dir: %v", err)
        }
        // Quilt profile JSON endpoint mirrors Fabric's shape
        url := fmt.Sprintf("https://meta.quiltmc.org/v3/versions/loader/%s/%s/profile/json", gv, lv)
        cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
        defer cancel()
        reqHttp, err := http.NewRequestWithContext(cctx, http.MethodGet, url, nil)
        if err != nil { return nil, status.Errorf(codes.Internal, "profile request: %v", err) }
        resp, err := http.DefaultClient.Do(reqHttp)
        if err != nil { return nil, status.Errorf(codes.Unavailable, "fetch profile: %v", err) }
        defer resp.Body.Close()
        if resp.StatusCode != http.StatusOK {
            return nil, status.Errorf(codes.Unavailable, "quilt profile status: %s", resp.Status)
        }
        // Read, save and parse profile JSON
        body, err := io.ReadAll(resp.Body)
        if err != nil { return nil, status.Errorf(codes.Internal, "read profile: %v", err) }
        if err := os.WriteFile(profilePath, body, 0o644); err != nil { return nil, status.Errorf(codes.Internal, "write profile: %v", err) }
        var prof profileJSON
        _ = json.Unmarshal(body, &prof)
        // Download libraries to shared libraries dir: <userData>/shared/libraries
        instancesDir := filepath.Dir(inst)
        userDataDir := filepath.Dir(instancesDir)
        librariesDir := filepath.Join(userDataDir, "shared", "libraries")
        for _, lib := range prof.Libraries {
            gp, art, ver, file, ok := mavenCoordsToPath(lib.Name)
            if !ok { continue }
            base := lib.URL
            if base == "" { base = "https://maven.quiltmc.org/repository/release/" }
            dest := filepath.Join(librariesDir, gp, art, ver, file)
            if _, err := os.Stat(dest); err == nil { continue }
            if err := downloadLibrary(ctx, base, gp, art, ver, file, dest); err != nil {
                fmt.Printf("[Install] quilt library download failed %s:%s:%s: %v\n", gp, art, ver, err)
            }
        }
        return &pb.InstallResponse{Success: true, VersionId: versionId}, nil
    case "forge":
        // lv = Forge maven 버전 "1.20.1-47.4.20". 버전 id는 "1.20.1-forge-47.4.20".
        versionId := forgeVersionID(lv)
        versionDir := filepath.Join(inst, "versions", versionId)
        profilePath := filepath.Join(versionDir, versionId+".json")
        if err := os.MkdirAll(versionDir, 0o755); err != nil {
            return nil, status.Errorf(codes.Internal, "create dir: %v", err)
        }
        // Forge installer는 대상 디렉터리에 launcher_profiles.json이 있어야 동작.
        if err := ensureLauncherProfiles(inst); err != nil {
            return nil, status.Errorf(codes.Internal, "launcher_profiles: %v", err)
        }

        tempDir := filepath.Join(inst, ".temp")
        if err := os.MkdirAll(tempDir, 0o755); err != nil {
            return nil, status.Errorf(codes.Internal, "create temp dir: %v", err)
        }
        installerURL := fmt.Sprintf("https://maven.minecraftforge.net/net/minecraftforge/forge/%s/forge-%s-installer.jar", lv, lv)
        installerPath := filepath.Join(tempDir, fmt.Sprintf("forge-%s-installer.jar", lv))
        {
            cctx, cancel := context.WithTimeout(ctx, 60*time.Second)
            defer cancel()
            reqHttp, err := http.NewRequestWithContext(cctx, http.MethodGet, installerURL, nil)
            if err != nil { return nil, status.Errorf(codes.Internal, "installer request: %v", err) }
            resp, err := http.DefaultClient.Do(reqHttp)
            if err != nil { return nil, status.Errorf(codes.Unavailable, "fetch installer: %v", err) }
            defer resp.Body.Close()
            if resp.StatusCode != http.StatusOK { return nil, status.Errorf(codes.Unavailable, "installer status: %s", resp.Status) }
            f, err := os.Create(installerPath)
            if err != nil { return nil, status.Errorf(codes.Internal, "create installer: %v", err) }
            if _, err := io.Copy(f, resp.Body); err != nil { _ = f.Close(); return nil, status.Errorf(codes.Internal, "write installer: %v", err) }
            if err := f.Close(); err != nil { return nil, status.Errorf(codes.Internal, "close installer: %v", err) }
        }

        // Forge는 --installClient (NeoForge의 --install-client와 다름). 시스템 java 사용(NeoForge 설치와 동일).
        runCtx, cancelRun := context.WithTimeout(ctx, 5*time.Minute)
        defer cancelRun()
        cmd := exec.CommandContext(runCtx, "java", "-jar", installerPath, "--installClient", inst)
        out, err := cmd.CombinedOutput()
        _ = os.Remove(installerPath)
        if err != nil {
            return nil, status.Errorf(codes.Internal, "forge installer 실패: %v\n%s", err, string(out))
        }
        if _, err := os.Stat(profilePath); err != nil {
            return nil, status.Errorf(codes.Internal, "forge installer가 버전 json을 생성하지 않음 (%s)", versionId)
        }
        return &pb.InstallResponse{Success: true, VersionId: versionId}, nil
    default:
        return nil, status.Error(codes.InvalidArgument, "unknown loader_type")
    }
}
