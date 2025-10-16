package services

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/google/uuid"

	"hyenimc/backend/internal/account"
	"hyenimc/backend/internal/domain"
)

// AccountService implements account management business logic
type AccountService struct {
	repo          *account.Repository
	encryptionKey []byte
	deviceID      string
}

// NewAccountService creates a new account service
func NewAccountService(repo *account.Repository, encryptionKey []byte, deviceID string) *AccountService {
	return &AccountService{
		repo:          repo,
		encryptionKey: encryptionKey,
		deviceID:      deviceID,
	}
}

// SaveMicrosoftAccount saves a Microsoft account with encrypted tokens
func (s *AccountService) SaveMicrosoftAccount(
	ctx context.Context,
	name string,
	uuid string,
	accessToken string,
	refreshToken string,
	expiresAt int64,
	skinURL string,
) (string, error) {
	// Format UUID
	formattedUUID := formatUUID(uuid)
	accountID := formattedUUID

	// Encrypt sensitive data
	tokens := domain.DecryptedTokens{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresAt:    expiresAt,
	}

	tokensJSON, err := json.Marshal(tokens)
	if err != nil {
		return "", fmt.Errorf("failed to marshal tokens: %w", err)
	}

	encrypted, iv, authTag, err := s.encrypt(string(tokensJSON))
	if err != nil {
		return "", fmt.Errorf("failed to encrypt tokens: %w", err)
	}

	now := time.Now()
	acc := &domain.Account{
		ID:            accountID,
		Name:          name,
		UUID:          formattedUUID,
		Type:          "microsoft",
		EncryptedData: encrypted,
		IV:            iv,
		AuthTag:       authTag,
		SkinURL:       skinURL,
		LastUsed:      now.Unix(),
		DeviceID:      s.deviceID,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	if err := s.repo.Save(acc); err != nil {
		return "", fmt.Errorf("failed to save account: %w", err)
	}

	return accountID, nil
}

// AddOfflineAccount adds an offline account
func (s *AccountService) AddOfflineAccount(ctx context.Context, username string) (string, error) {
	accountID := uuid.New().String()
	offlineUUID := generateOfflineUUID(username)

	now := time.Now()
	acc := &domain.Account{
		ID:        accountID,
		Name:      username,
		UUID:      offlineUUID,
		Type:      "offline",
		LastUsed:  now.Unix(),
		DeviceID:  s.deviceID,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := s.repo.Save(acc); err != nil {
		return "", fmt.Errorf("failed to save offline account: %w", err)
	}

	return accountID, nil
}

// GetAccount retrieves an account by ID
func (s *AccountService) GetAccount(ctx context.Context, id string) (*domain.Account, error) {
	acc, err := s.repo.Get(id)
	if err != nil {
		return nil, err
	}

	// Verify device ID matches
	if acc.DeviceID != s.deviceID {
		return nil, fmt.Errorf("account not accessible from this device")
	}

	return acc, nil
}

// GetAllAccounts retrieves all accounts for the current device
func (s *AccountService) GetAllAccounts(ctx context.Context) ([]*domain.Account, error) {
	return s.repo.List(s.deviceID)
}

// GetAccountTokens decrypts and returns Microsoft account tokens
func (s *AccountService) GetAccountTokens(ctx context.Context, accountID string) (*domain.DecryptedTokens, error) {
	acc, err := s.GetAccount(ctx, accountID)
	if err != nil {
		return nil, err
	}

	if acc.Type != "microsoft" || acc.EncryptedData == "" {
		return nil, fmt.Errorf("not a Microsoft account or no tokens available")
	}

	decrypted, err := s.decrypt(acc.EncryptedData, acc.IV, acc.AuthTag)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt tokens: %w", err)
	}

	var tokens domain.DecryptedTokens
	if err := json.Unmarshal([]byte(decrypted), &tokens); err != nil {
		return nil, fmt.Errorf("failed to unmarshal tokens: %w", err)
	}

	return &tokens, nil
}

// UpdateAccountTokens updates Microsoft account tokens
func (s *AccountService) UpdateAccountTokens(
	ctx context.Context,
	accountID string,
	accessToken string,
	refreshToken string,
	expiresAt int64,
) error {
	acc, err := s.GetAccount(ctx, accountID)
	if err != nil {
		return err
	}

	if acc.Type != "microsoft" {
		return fmt.Errorf("not a Microsoft account")
	}

	// Encrypt new tokens
	tokens := domain.DecryptedTokens{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresAt:    expiresAt,
	}

	tokensJSON, err := json.Marshal(tokens)
	if err != nil {
		return fmt.Errorf("failed to marshal tokens: %w", err)
	}

	encrypted, iv, authTag, err := s.encrypt(string(tokensJSON))
	if err != nil {
		return fmt.Errorf("failed to encrypt tokens: %w", err)
	}

	acc.EncryptedData = encrypted
	acc.IV = iv
	acc.AuthTag = authTag
	acc.LastUsed = time.Now().Unix()
	acc.UpdatedAt = time.Now()

	return s.repo.Save(acc)
}

// UpdateLastUsed updates the last used timestamp
func (s *AccountService) UpdateLastUsed(ctx context.Context, accountID string) error {
	return s.repo.UpdateLastUsed(accountID, time.Now().Unix())
}

// RemoveAccount removes an account
func (s *AccountService) RemoveAccount(ctx context.Context, accountID string) error {
	// Verify device ID before deleting
	acc, err := s.GetAccount(ctx, accountID)
	if err != nil {
		return err
	}

	if acc.DeviceID != s.deviceID {
		return fmt.Errorf("account not accessible from this device")
	}

	return s.repo.Delete(accountID)
}

// encrypt encrypts data using AES-256-GCM
func (s *AccountService) encrypt(plaintext string) (encrypted, iv, authTag string, err error) {
	block, err := aes.NewCipher(s.encryptionKey)
	if err != nil {
		return "", "", "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", "", "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", "", "", err
	}

	ciphertext := gcm.Seal(nil, nonce, []byte(plaintext), nil)

	// GCM returns ciphertext + authTag combined
	// Split them: last 16 bytes are authTag
	authTagBytes := ciphertext[len(ciphertext)-16:]
	encryptedBytes := ciphertext[:len(ciphertext)-16]

	return hex.EncodeToString(encryptedBytes),
		hex.EncodeToString(nonce),
		hex.EncodeToString(authTagBytes),
		nil
}

// decrypt decrypts data using AES-256-GCM
func (s *AccountService) decrypt(encryptedHex, ivHex, authTagHex string) (string, error) {
	encrypted, err := hex.DecodeString(encryptedHex)
	if err != nil {
		return "", err
	}

	nonce, err := hex.DecodeString(ivHex)
	if err != nil {
		return "", err
	}

	authTag, err := hex.DecodeString(authTagHex)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(s.encryptionKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	// Combine encrypted data and auth tag
	ciphertext := append(encrypted, authTag...)

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

// Helper functions

func formatUUID(uuid string) string {
	// Remove any existing hyphens
	clean := ""
	for _, r := range uuid {
		if r != '-' {
			clean += string(r)
		}
	}

	// If it's 32 characters (no hyphens), add them
	if len(clean) == 32 {
		return fmt.Sprintf("%s-%s-%s-%s-%s",
			clean[0:8],
			clean[8:12],
			clean[12:16],
			clean[16:20],
			clean[20:32],
		)
	}

	// Otherwise return as-is
	return uuid
}

func generateOfflineUUID(username string) string {
	hash := sha256.Sum256([]byte("OfflinePlayer:" + username))
	hashStr := hex.EncodeToString(hash[:16])

	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hashStr[0:8],
		hashStr[8:12],
		hashStr[12:16],
		hashStr[16:20],
		hashStr[20:32],
	)
}
