package domain

import "time"

// Account represents a Minecraft account
type Account struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	UUID          string    `json:"uuid"`
	Type          string    `json:"type"` // "microsoft" or "offline"
	EncryptedData string    `json:"encrypted_data,omitempty"`
	IV            string    `json:"iv,omitempty"`
	AuthTag       string    `json:"auth_tag,omitempty"`
	SkinURL       string    `json:"skin_url,omitempty"`
	LastUsed      int64     `json:"last_used"`
	DeviceID      string    `json:"device_id"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// DecryptedTokens represents decrypted Microsoft account tokens
type DecryptedTokens struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"`
}
