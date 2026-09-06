jest.mock('../../src/config/database', () => ({
  query: jest.fn()
}));

jest.mock('../../src/models/BrokerConnection', () => ({
  create: jest.fn(),
  updateStatus: jest.fn(),
  update: jest.fn(),
  findById: jest.fn(),
  calculateNextSync: jest.fn()
}));

jest.mock('../../src/services/tierService', () => ({
  canCreateBrokerConnection: jest.fn()
}));

jest.mock('../../src/services/brokerSync/schwabService', () => ({
  refreshAccessToken: jest.fn(),
  getAccountNumbers: jest.fn()
}));

jest.mock('../../src/utils/timezone', () => ({
  getUserTimezone: jest.fn().mockResolvedValue('America/New_York')
}));

jest.mock('axios');

const axios = require('axios');
const BrokerConnection = require('../../src/models/BrokerConnection');
const TierService = require('../../src/services/tierService');
const schwabService = require('../../src/services/brokerSync/schwabService');
const brokerSyncController = require('../../src/controllers/brokerSync.controller');

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    }
  };
}

describe('brokerSyncController.importSchwabTokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    TierService.canCreateBrokerConnection.mockResolvedValue({ allowed: true });
    BrokerConnection.create.mockResolvedValue({ id: 'conn-schwab-1' });
    BrokerConnection.updateStatus.mockResolvedValue(true);
    BrokerConnection.findById.mockResolvedValue({
      id: 'conn-schwab-1',
      brokerType: 'schwab',
      connectionStatus: 'active',
      accountLabel: 'My Schwab'
    });
  });

  test('blocks free-tier users when Pro is required', async () => {
    TierService.canCreateBrokerConnection.mockResolvedValue({
      allowed: false,
      message: 'Broker sync is a Pro feature'
    });

    const req = {
      user: { id: 'user-1' },
      body: { tokenData: { access_token: 'fake-access' } }
    };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.importSchwabTokens(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.payload.success).toBe(false);
    expect(res.payload.code).toBe('PRO_FEATURE_REQUIRED');
  });

  test('rejects malformed JSON string', async () => {
    const req = {
      user: { id: 'user-1' },
      body: { tokenData: '{ invalid json...' }
    };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.importSchwabTokens(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toMatch(/Invalid JSON/i);
  });

  test('rejects token payload without access or refresh token', async () => {
    const req = {
      user: { id: 'user-1' },
      body: { tokenData: { some_other_key: 'foo' } }
    };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.importSchwabTokens(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.payload.error).toMatch(/must contain at least access_token or refresh_token/i);
  });

  test('successfully imports standard Schwab OAuth token response', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          securitiesAccount: {
            accountNumber: '12345678'
          }
        }
      ]
    });

    const req = {
      user: { id: 'user-1' },
      body: {
        tokenData: {
          access_token: 'valid-access-token',
          refresh_token: 'valid-refresh-token',
          expires_in: 1800,
          token_type: 'Bearer'
        },
        accountLabel: 'Main Schwab Account'
      }
    };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.importSchwabTokens(req, res, next);

    expect(res.statusCode).toBe(201);
    expect(res.payload.success).toBe(true);
    expect(BrokerConnection.create).toHaveBeenCalledWith('user-1', expect.objectContaining({
      brokerType: 'schwab',
      schwabAccessToken: 'valid-access-token',
      schwabRefreshToken: 'valid-refresh-token',
      schwabAccountId: '12345678',
      accountLabel: 'Main Schwab Account'
    }));
    expect(BrokerConnection.updateStatus).toHaveBeenCalledWith('conn-schwab-1', 'active', expect.any(String));
  });

  test('successfully imports schwab-py token file format with nested token object', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          securitiesAccount: {
            accountNumber: '98765432'
          }
        }
      ]
    });

    const schwabPyTokenFile = JSON.stringify({
      creation_timestamp: Math.floor(Date.now() / 1000),
      token: {
        access_token: 'schwabpy-access-token',
        refresh_token: 'schwabpy-refresh-token',
        token_type: 'Bearer',
        expires_in: 1800,
        expires_at: Math.floor(Date.now() / 1000) + 1800,
        scope: ['api']
      }
    });

    const req = {
      user: { id: 'user-1' },
      body: {
        tokenData: schwabPyTokenFile,
        accountLabel: 'Python Synced Schwab'
      }
    };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.importSchwabTokens(req, res, next);

    expect(res.statusCode).toBe(201);
    expect(res.payload.success).toBe(true);
    expect(BrokerConnection.create).toHaveBeenCalledWith('user-1', expect.objectContaining({
      brokerType: 'schwab',
      schwabAccessToken: 'schwabpy-access-token',
      schwabRefreshToken: 'schwabpy-refresh-token',
      schwabAccountId: '98765432'
    }));
  });

  test('automatically refreshes token if access token is expired and refresh token is available', async () => {
    schwabService.refreshAccessToken.mockResolvedValueOnce({
      accessToken: 'freshly-refreshed-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: new Date(Date.now() + 1800 * 1000)
    });

    axios.get.mockResolvedValueOnce({
      data: [
        {
          securitiesAccount: {
            accountNumber: '55554444'
          }
        }
      ]
    });

    const req = {
      user: { id: 'user-1' },
      body: {
        tokenData: {
          access_token: 'expired-token',
          refresh_token: 'still-valid-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) - 1000 // Expired in the past
        }
      }
    };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.importSchwabTokens(req, res, next);

    expect(schwabService.refreshAccessToken).toHaveBeenCalledWith('still-valid-refresh-token');
    expect(BrokerConnection.create).toHaveBeenCalledWith('user-1', expect.objectContaining({
      schwabAccessToken: 'freshly-refreshed-access-token',
      schwabRefreshToken: 'new-refresh-token'
    }));
    expect(res.statusCode).toBe(201);
  });

  test('persists syncStartDate when provided in import payload', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          securitiesAccount: {
            accountNumber: '12345678'
          }
        }
      ]
    });

    const req = {
      user: { id: 'user-1' },
      body: {
        tokenData: {
          access_token: 'valid-access-token',
          refresh_token: 'valid-refresh-token'
        },
        syncStartDate: '2025-01-01'
      }
    };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.importSchwabTokens(req, res, next);

    expect(res.statusCode).toBe(201);
    expect(BrokerConnection.create).toHaveBeenCalledWith('user-1', expect.objectContaining({
      brokerType: 'schwab',
      syncStartDate: '2025-01-01'
    }));
  });
});

