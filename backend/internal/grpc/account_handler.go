package grpc

import (
	"context"

	pb "hyenimc/backend/gen/launcher"
	"hyenimc/backend/internal/services"
)

// AccountHandler implements the AccountService gRPC service
type AccountHandler struct {
	pb.UnimplementedAccountServiceServer
	accountService *services.AccountService
}

// NewAccountHandler creates a new account handler
func NewAccountHandler(accountService *services.AccountService) *AccountHandler {
	return &AccountHandler{
		accountService: accountService,
	}
}

// SaveMicrosoftAccount saves a Microsoft account
func (h *AccountHandler) SaveMicrosoftAccount(ctx context.Context, req *pb.SaveMicrosoftAccountRequest) (*pb.SaveAccountResponse, error) {
	accountID, err := h.accountService.SaveMicrosoftAccount(
		ctx,
		req.Name,
		req.Uuid,
		req.AccessToken,
		req.RefreshToken,
		req.ExpiresAt,
		req.SkinUrl,
	)

	if err != nil {
		return nil, err
	}

	return &pb.SaveAccountResponse{
		AccountId: accountID,
	}, nil
}

// AddOfflineAccount adds an offline account
func (h *AccountHandler) AddOfflineAccount(ctx context.Context, req *pb.AddOfflineAccountRequest) (*pb.SaveAccountResponse, error) {
	accountID, err := h.accountService.AddOfflineAccount(ctx, req.Username)
	if err != nil {
		return nil, err
	}

	return &pb.SaveAccountResponse{
		AccountId: accountID,
	}, nil
}

// GetAccount retrieves an account by ID
func (h *AccountHandler) GetAccount(ctx context.Context, req *pb.GetAccountRequest) (*pb.AccountResponse, error) {
	account, err := h.accountService.GetAccount(ctx, req.AccountId)
	if err != nil {
		return nil, err
	}

	return &pb.AccountResponse{
		Id:        account.ID,
		Name:      account.Name,
		Uuid:      account.UUID,
		Type:      account.Type,
		SkinUrl:   account.SkinURL,
		LastUsed:  account.LastUsed,
		CreatedAt: account.CreatedAt.Unix(),
		UpdatedAt: account.UpdatedAt.Unix(),
	}, nil
}

// GetAllAccounts retrieves all accounts
func (h *AccountHandler) GetAllAccounts(ctx context.Context, req *pb.GetAllAccountsRequest) (*pb.GetAllAccountsResponse, error) {
	accounts, err := h.accountService.GetAllAccounts(ctx)
	if err != nil {
		return nil, err
	}

	var accountResponses []*pb.AccountResponse
	for _, account := range accounts {
		accountResponses = append(accountResponses, &pb.AccountResponse{
			Id:        account.ID,
			Name:      account.Name,
			Uuid:      account.UUID,
			Type:      account.Type,
			SkinUrl:   account.SkinURL,
			LastUsed:  account.LastUsed,
			CreatedAt: account.CreatedAt.Unix(),
			UpdatedAt: account.UpdatedAt.Unix(),
		})
	}

	return &pb.GetAllAccountsResponse{
		Accounts: accountResponses,
	}, nil
}

// GetAccountTokens retrieves decrypted tokens
func (h *AccountHandler) GetAccountTokens(ctx context.Context, req *pb.GetAccountTokensRequest) (*pb.AccountTokensResponse, error) {
	tokens, err := h.accountService.GetAccountTokens(ctx, req.AccountId)
	if err != nil {
		return nil, err
	}

	return &pb.AccountTokensResponse{
		AccessToken:  tokens.AccessToken,
		RefreshToken: tokens.RefreshToken,
		ExpiresAt:    tokens.ExpiresAt,
	}, nil
}

// UpdateAccountTokens updates account tokens
func (h *AccountHandler) UpdateAccountTokens(ctx context.Context, req *pb.UpdateAccountTokensRequest) (*pb.UpdateAccountTokensResponse, error) {
	err := h.accountService.UpdateAccountTokens(
		ctx,
		req.AccountId,
		req.AccessToken,
		req.RefreshToken,
		req.ExpiresAt,
	)

	if err != nil {
		return &pb.UpdateAccountTokensResponse{Success: false}, err
	}

	return &pb.UpdateAccountTokensResponse{Success: true}, nil
}

// UpdateLastUsed updates last used timestamp
func (h *AccountHandler) UpdateLastUsed(ctx context.Context, req *pb.UpdateLastUsedRequest) (*pb.UpdateLastUsedResponse, error) {
	err := h.accountService.UpdateLastUsed(ctx, req.AccountId)
	if err != nil {
		return &pb.UpdateLastUsedResponse{Success: false}, err
	}

	return &pb.UpdateLastUsedResponse{Success: true}, nil
}

// RemoveAccount removes an account
func (h *AccountHandler) RemoveAccount(ctx context.Context, req *pb.RemoveAccountRequest) (*pb.RemoveAccountResponse, error) {
	err := h.accountService.RemoveAccount(ctx, req.AccountId)
	if err != nil {
		return &pb.RemoveAccountResponse{Success: false}, err
	}

	return &pb.RemoveAccountResponse{Success: true}, nil
}
