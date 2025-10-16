package account

import (
	"database/sql"
	"fmt"
	"time"

	"hyenimc/backend/internal/domain"
)

// Repository handles account persistence
type Repository struct {
	db *sql.DB
}

// NewRepository creates a new account repository
func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

// Save creates or updates an account
func (r *Repository) Save(account *domain.Account) error {
	query := `
		INSERT INTO accounts (
			id, name, uuid, type, encrypted_data, iv, auth_tag, 
			skin_url, last_used, device_id, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			uuid = excluded.uuid,
			type = excluded.type,
			encrypted_data = excluded.encrypted_data,
			iv = excluded.iv,
			auth_tag = excluded.auth_tag,
			skin_url = excluded.skin_url,
			last_used = excluded.last_used,
			device_id = excluded.device_id,
			updated_at = excluded.updated_at
	`

	_, err := r.db.Exec(query,
		account.ID,
		account.Name,
		account.UUID,
		account.Type,
		account.EncryptedData,
		account.IV,
		account.AuthTag,
		account.SkinURL,
		account.LastUsed,
		account.DeviceID,
		account.CreatedAt.Unix(),
		account.UpdatedAt.Unix(),
	)

	return err
}

// Get retrieves an account by ID
func (r *Repository) Get(id string) (*domain.Account, error) {
	query := `
		SELECT id, name, uuid, type, encrypted_data, iv, auth_tag, 
		       skin_url, last_used, device_id, created_at, updated_at
		FROM accounts
		WHERE id = ?
	`

	var account domain.Account
	var createdAt, updatedAt int64

	err := r.db.QueryRow(query, id).Scan(
		&account.ID,
		&account.Name,
		&account.UUID,
		&account.Type,
		&account.EncryptedData,
		&account.IV,
		&account.AuthTag,
		&account.SkinURL,
		&account.LastUsed,
		&account.DeviceID,
		&createdAt,
		&updatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("account not found: %s", id)
		}
		return nil, err
	}

	account.CreatedAt = time.Unix(createdAt, 0)
	account.UpdatedAt = time.Unix(updatedAt, 0)

	return &account, nil
}

// List retrieves all accounts for a device, sorted by last used
func (r *Repository) List(deviceID string) ([]*domain.Account, error) {
	query := `
		SELECT id, name, uuid, type, encrypted_data, iv, auth_tag, 
		       skin_url, last_used, device_id, created_at, updated_at
		FROM accounts
		WHERE device_id = ?
		ORDER BY last_used DESC
	`

	rows, err := r.db.Query(query, deviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []*domain.Account

	for rows.Next() {
		var account domain.Account
		var createdAt, updatedAt int64

		err := rows.Scan(
			&account.ID,
			&account.Name,
			&account.UUID,
			&account.Type,
			&account.EncryptedData,
			&account.IV,
			&account.AuthTag,
			&account.SkinURL,
			&account.LastUsed,
			&account.DeviceID,
			&createdAt,
			&updatedAt,
		)

		if err != nil {
			return nil, err
		}

		account.CreatedAt = time.Unix(createdAt, 0)
		account.UpdatedAt = time.Unix(updatedAt, 0)

		accounts = append(accounts, &account)
	}

	return accounts, nil
}

// UpdateLastUsed updates the last used timestamp
func (r *Repository) UpdateLastUsed(id string, lastUsed int64) error {
	query := `
		UPDATE accounts
		SET last_used = ?, updated_at = ?
		WHERE id = ?
	`

	_, err := r.db.Exec(query, lastUsed, time.Now().Unix(), id)
	return err
}

// Delete removes an account
func (r *Repository) Delete(id string) error {
	query := `DELETE FROM accounts WHERE id = ?`
	_, err := r.db.Exec(query, id)
	return err
}
