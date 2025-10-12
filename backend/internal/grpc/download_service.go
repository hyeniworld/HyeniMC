package grpc

import (
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	pb "hyenimc/backend/gen/launcher"
)

// checksumReq represents a checksum request
type checksumReq interface {
	GetAlgo() string
	GetValue() string
}

// fileMeta represents file metadata
type fileMeta struct {
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	Sha1     string `json:"sha1,omitempty"`
	Sha256   string `json:"sha256,omitempty"`
	Updated  int64  `json:"updated_at"`
}

// writeFileMeta writes file metadata to a sidecar file
func writeFileMeta(dest string, c checksumReq) error {
	fi, err := os.Stat(dest)
	if err != nil {
		return err
	}
	meta := fileMeta{Path: dest, Size: fi.Size(), Updated: time.Now().Unix()}
	// prefer provided checksum; otherwise compute sha1
	if c != nil && c.GetValue() != "" {
		switch strings.ToLower(c.GetAlgo()) {
		case "sha1":
			meta.Sha1 = c.GetValue()
		case "sha256":
			meta.Sha256 = c.GetValue()
		}
	}
	if meta.Sha1 == "" && meta.Sha256 == "" {
		if h, err := computeSha1(dest); err == nil {
			meta.Sha1 = h
		}
	}
	b, err := json.MarshalIndent(&meta, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(dest+".meta.json", b, 0o644)
}

// computeSha1 computes the SHA1 checksum of a file
func computeSha1(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha1.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// downloadServiceServer provides progress streaming and managed downloads
type downloadServiceServer struct {
	pb.UnimplementedDownloadServiceServer
	mu    sync.RWMutex
	subs  map[chan *pb.ProgressEvent]struct{}
	tasks map[string]context.CancelFunc
	dlSem chan struct{}
}

func NewDownloadServiceServer() pb.DownloadServiceServer {
	sz := currentDownloadSettings().GetMaxParallel()
	if sz <= 0 {
		sz = 10
	}
	return &downloadServiceServer{
		subs:  make(map[chan *pb.ProgressEvent]struct{}),
		tasks: make(map[string]context.CancelFunc),
		dlSem: make(chan struct{}, sz),
	}
}

func (s *downloadServiceServer) StreamProgress(req *pb.ProgressRequest, stream pb.DownloadService_StreamProgressServer) error {
	// Register a subscriber channel
	ch := make(chan *pb.ProgressEvent, 256)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.subs, ch)
		close(ch)
		s.mu.Unlock()
	}()

	// Optional: initial heartbeat
	_ = stream.Send(&pb.ProgressEvent{Status: "pending"})

	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stream.Context().Done():
			return nil
		case ev := <-ch:
			if ev == nil {
				return nil
			}
			if err := stream.Send(ev); err != nil {
				return nil
			}
		case <-ticker.C:
			_ = stream.Send(&pb.ProgressEvent{Status: "pending"})
		}
	}
}

func (s *downloadServiceServer) PublishProgress(ctx context.Context, ev *pb.ProgressEvent) (*pb.Ack, error) {
	s.broadcast(ev)
	return &pb.Ack{Ok: true}, nil
}

func (s *downloadServiceServer) broadcast(ev *pb.ProgressEvent) {
	s.mu.RLock()
	for ch := range s.subs {
		select {
		case ch <- ev:
		default:
		}
	}
	s.mu.RUnlock()
}

func (s *downloadServiceServer) StartDownload(ctx context.Context, req *pb.DownloadRequest) (*pb.DownloadStarted, error) {
	url := strings.TrimSpace(req.GetUrl())
	dest := strings.TrimSpace(req.GetDestPath())
	if url == "" || dest == "" {
		return nil, fmt.Errorf("url and dest_path are required")
	}
	taskID := req.GetTaskId()
	if taskID == "" {
		taskID = fmt.Sprintf("dl-%d", time.Now().UnixNano())
	}

	dlCtx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	if s.tasks == nil {
		s.tasks = make(map[string]context.CancelFunc)
	}
	s.tasks[taskID] = cancel
	s.mu.Unlock()

	go func() {
		// global concurrency guard
		s.dlSem <- struct{}{}
		defer func() {
			<-s.dlSem
			s.mu.Lock()
			delete(s.tasks, taskID)
			s.mu.Unlock()
		}()
		started := time.Now()
		evBase := &pb.ProgressEvent{TaskId: taskID, Type: req.GetType(), Name: req.GetName(), ProfileId: req.GetProfileId(), FileName: filepath.Base(dest)}
		s.broadcast(&pb.ProgressEvent{TaskId: taskID, Status: "pending", Type: evBase.Type, Name: evBase.Name, ProfileId: evBase.ProfileId, FileName: evBase.FileName})
		maxRetries := int(req.GetMaxRetries())
		if maxRetries <= 0 {
			maxRetries = int(currentDownloadSettings().GetMaxRetries())
			if maxRetries <= 0 {
				maxRetries = 5
			}
		}
		timeoutMs := int(currentDownloadSettings().GetRequestTimeoutMs())
		if timeoutMs <= 0 {
			timeoutMs = 3000
		}
		tmp := dest + ".part"
		// ensure dir
		_ = os.MkdirAll(filepath.Dir(dest), 0o755)

		var total int64 = 0
		var err error
		for attempt := 0; attempt <= maxRetries; attempt++ {
			err = s.downloadOnce(dlCtx, url, tmp, &total, timeoutMs, func(downloaded int64) {
				// emit progress
				percent := int32(0)
				if total > 0 {
					percent = int32((downloaded * 100) / total)
				}
				s.broadcast(&pb.ProgressEvent{TaskId: taskID, Status: "downloading", Type: evBase.Type, Name: evBase.Name, ProfileId: evBase.ProfileId, FileName: evBase.FileName, Total: total, Downloaded: downloaded, Progress: percent})
			})
			if err == nil {
				break
			}
			
			// Check if error is retryable
			if !isRetryableError(err) {
				// Permanent error (404, 403, etc) - fail immediately
				break
			}
			
			// Last attempt - no need to wait
			if attempt >= maxRetries {
				break
			}
			
			// Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
			backoffDelay := time.Duration(1<<uint(attempt)) * time.Second
			maxBackoff := 30 * time.Second
			if backoffDelay > maxBackoff {
				backoffDelay = maxBackoff
			}
			
			s.broadcast(&pb.ProgressEvent{
				TaskId:    taskID,
				Status:    "retrying",
				Error:     fmt.Sprintf("Attempt %d/%d failed: %v. Retrying in %v...", attempt+1, maxRetries+1, err, backoffDelay),
				Type:      evBase.Type,
				Name:      evBase.Name,
				ProfileId: evBase.ProfileId,
				FileName:  evBase.FileName,
			})
			
			select {
			case <-dlCtx.Done():
				err = context.Canceled
				attempt = maxRetries + 1 // Force exit from retry loop
			case <-time.After(backoffDelay):
			}
		}
		if err != nil {
			s.broadcast(&pb.ProgressEvent{TaskId: taskID, Status: "failed", Error: err.Error(), Type: evBase.Type, Name: evBase.Name, ProfileId: evBase.ProfileId, FileName: evBase.FileName})
			return
		}
		// verify checksum if provided
		if c := req.GetChecksum(); c != nil && c.GetValue() != "" {
			if verr := verifyChecksum(tmp, c.GetAlgo(), c.GetValue()); verr != nil {
				_ = os.Remove(tmp)
				s.broadcast(&pb.ProgressEvent{TaskId: taskID, Status: "failed", Error: fmt.Sprintf("checksum mismatch: %v", verr), Type: evBase.Type, Name: evBase.Name, ProfileId: evBase.ProfileId, FileName: evBase.FileName})
				return
			}
		}
		// atomic rename
		if err := os.Rename(tmp, dest); err != nil {
			s.broadcast(&pb.ProgressEvent{TaskId: taskID, Status: "failed", Error: fmt.Sprintf("finalize: %v", err), Type: evBase.Type, Name: evBase.Name, ProfileId: evBase.ProfileId, FileName: evBase.FileName})
			return
		}
		// write sidecar metadata for integrity & cache bookkeeping
		if err := writeFileMeta(dest, req.GetChecksum()); err != nil {
			// non-fatal
			fmt.Printf("[Download] write meta failed for %s: %v\n", dest, err)
		}
		s.broadcast(&pb.ProgressEvent{TaskId: taskID, Status: "completed", Progress: 100, Type: evBase.Type, Name: evBase.Name, ProfileId: evBase.ProfileId, FileName: evBase.FileName})
		_ = started
	}()

	return &pb.DownloadStarted{TaskId: taskID}, nil
}

func (s *downloadServiceServer) Cancel(ctx context.Context, in *pb.DownloadCancel) (*pb.Ack, error) {
	taskID := in.GetTaskId()
	s.mu.Lock()
	cancel, ok := s.tasks[taskID]
	s.mu.Unlock()
	if ok {
		cancel()
		return &pb.Ack{Ok: true}, nil
	}
	return &pb.Ack{Ok: false}, nil
}

// isRetryableError determines if an error should trigger a retry
func isRetryableError(err error) bool {
	if err == nil {
		return false
	}
	
	errStr := err.Error()
	
	// Network errors are retryable
	if strings.Contains(errStr, "connection refused") ||
		strings.Contains(errStr, "connection reset") ||
		strings.Contains(errStr, "timeout") ||
		strings.Contains(errStr, "temporary failure") ||
		strings.Contains(errStr, "no such host") ||
		strings.Contains(errStr, "EOF") {
		return true
	}
	
	// HTTP 5xx errors are retryable (server issues)
	if strings.Contains(errStr, "503") || // Service Unavailable
		strings.Contains(errStr, "502") || // Bad Gateway
		strings.Contains(errStr, "504") || // Gateway Timeout
		strings.Contains(errStr, "500") {  // Internal Server Error
		return true
	}
	
	// HTTP 429 (Rate Limit) is retryable
	if strings.Contains(errStr, "429") {
		return true
	}
	
	// Permanent errors (DO NOT retry)
	if strings.Contains(errStr, "404") || // Not Found
		strings.Contains(errStr, "403") || // Forbidden
		strings.Contains(errStr, "401") || // Unauthorized
		strings.Contains(errStr, "410") {  // Gone
		return false
	}
	
	// Context errors are not retryable
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	
	// Default: retry for unknown errors (conservative approach)
	return true
}

// downloadOnce supports resume if tmp exists and server honors Range.
func (s *downloadServiceServer) downloadOnce(ctx context.Context, url, tmp string, totalOut *int64, timeoutMs int, onProgress func(downloaded int64)) error {
    // resume if possible
    var downloaded int64 = 0
    if fi, err := os.Stat(tmp); err == nil {
        downloaded = fi.Size()
    }
    // apply per-attempt timeout so a single stall won't block others
    toCtx := ctx
    if timeoutMs > 0 {
        var cancel context.CancelFunc
        toCtx, cancel = context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
        defer cancel()
    }
    req, err := http.NewRequestWithContext(toCtx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if downloaded > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", downloaded))
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("bad status: %s", resp.Status)
	}
	// compute total
	if resp.ContentLength > 0 {
		if resp.StatusCode == http.StatusPartialContent {
			*totalOut = downloaded + resp.ContentLength
		} else {
			*totalOut = resp.ContentLength
			downloaded = 0 // server ignored range
		}
	}
	// open file
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	if downloaded > 0 {
		if _, err := f.Seek(downloaded, io.SeekStart); err != nil {
			return err
		}
	}
	buf := make([]byte, 1<<20) // 1MB buffer
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				return werr
			}
			downloaded += int64(n)
			onProgress(downloaded)
		}
		if rerr != nil {
			if errors.Is(rerr, io.EOF) {
				break
			}
			return rerr
		}
	}
	return nil
}

func verifyChecksum(path, algo, wantHex string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	switch strings.ToLower(algo) {
	case "sha1":
		h := sha1.New()
		if _, err := io.Copy(h, f); err != nil {
			return err
		}
		got := hex.EncodeToString(h.Sum(nil))
		if !strings.EqualFold(got, wantHex) {
			return fmt.Errorf("sha1 mismatch: got %s", got)
		}
	case "sha256":
		h := sha256.New()
		if _, err := io.Copy(h, f); err != nil {
			return err
		}
		got := hex.EncodeToString(h.Sum(nil))
		if !strings.EqualFold(got, wantHex) {
			return fmt.Errorf("sha256 mismatch: got %s", got)
		}
	default:
		return fmt.Errorf("unsupported checksum algo: %s", algo)
	}
	return nil
}
