package grpc

import (
    "context"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "path/filepath"
    "runtime"
    "strings"
    "sync"
    "time"

    pb "hyenimc/backend/gen/launcher"
)

type assetServiceServer struct {
    pb.UnimplementedAssetServiceServer
}

func NewAssetServiceServer() pb.AssetServiceServer { return &assetServiceServer{} }

type assetIndex struct {
    Objects map[string]struct{
        Hash string `json:"hash"`
        Size int64  `json:"size"`
    } `json:"objects"`
}

func (s *assetServiceServer) PrefetchAssets(ctx context.Context, req *pb.PrefetchAssetsRequest) (*pb.PrefetchAssetsResponse, error) {
    idxURL := strings.TrimSpace(req.GetAssetsIndexUrl())
    baseDir := strings.TrimSpace(req.GetBaseDir())
    if idxURL == "" || baseDir == "" {
        return nil, fmt.Errorf("assets_index_url and base_dir are required")
    }
    maxPar := int(req.GetMaxParallel())
    if maxPar <= 0 {
        maxPar = int(currentDownloadSettings().GetMaxParallel())
        if maxPar <= 0 { maxPar = 10 }
    }

    // fetch index json
    cctx, cancel := context.WithTimeout(ctx, 60*time.Second)
    defer cancel()
    httpReq, err := http.NewRequestWithContext(cctx, http.MethodGet, idxURL, nil)
    if err != nil { return nil, fmt.Errorf("build request: %w", err) }
    resp, err := http.DefaultClient.Do(httpReq)
    if err != nil { return nil, fmt.Errorf("fetch index: %w", err) }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK { return nil, fmt.Errorf("index status: %s", resp.Status) }
    var idx assetIndex
    if err := json.NewDecoder(resp.Body).Decode(&idx); err != nil { return nil, fmt.Errorf("decode index: %w", err) }

    // download objects
    objectsDir := filepath.Join(baseDir, "objects")
    type item struct{ Hash string; Size int64 }
    items := make([]item, 0, len(idx.Objects))
    for _, o := range idx.Objects { items = append(items, item{Hash: o.Hash, Size: o.Size}) }

    sem := make(chan struct{}, maxPar)
    var wg sync.WaitGroup
    var mu sync.Mutex
    var downloaded, skipped int32

    for _, it := range items {
        it := it
        wg.Add(1)
        sem <- struct{}{}
        go func() {
            defer wg.Done(); defer func(){ <-sem }()
            sub := it.Hash[:2]
            url := fmt.Sprintf("https://resources.download.minecraft.net/%s/%s", sub, it.Hash)
            dest := filepath.Join(objectsDir, sub, it.Hash)
            // skip if exists and size matches
            if fi, err := os.Stat(dest); err == nil && fi.Size() == it.Size {
                mu.Lock(); skipped++; mu.Unlock(); return
            }
            if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil { return }
            tmp := dest + ".part"
            // download with retries
            var last error
            for attempt := 0; attempt < 3; attempt++ {
                if err := downloadToFile(ctx, url, tmp); err != nil {
                    last = err
                    time.Sleep(time.Duration(attempt+1) * time.Second)
                    continue
                }
                // finalize
                if err := os.Rename(tmp, dest); err != nil { last = err; continue }
                _ = writeFileMeta(dest, nil)
                mu.Lock(); downloaded++; mu.Unlock()
                last = nil
                break
            }
            if last != nil { _ = os.Remove(tmp) }
        }()
    }
    wg.Wait()

    return &pb.PrefetchAssetsResponse{Total: int32(len(items)), Downloaded: downloaded, Skipped: skipped}, nil
}

func downloadToFile(ctx context.Context, url, dest string) error {
    // Windows antivirus can transiently lock; small retries inside
    req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
    if err != nil { return err }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return err }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK { return fmt.Errorf("status: %s", resp.Status) }
    f, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
    if err != nil { return err }
    defer f.Close()
    if _, err := io.Copy(f, resp.Body); err != nil { return err }
    if runtime.GOOS == "windows" { _ = f.Sync() }
    return nil
}
