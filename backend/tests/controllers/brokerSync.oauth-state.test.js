// Schwab OAuth flow must persist the `state` token server-side on init so the
// callback can recover the initiating userId from the DB rather than trusting
// a client-supplied state payload. This test verifies both halves of the flow.

jest.mock('../../src/config/database', () => ({
  query: jest.fn()
}));
jest.mock('../../src/models/BrokerConnection', () => ({
  create: jest.fn().mockResolvedValue({ id: 'connection-1' }),
  update: jest.fn().mockResolvedValue(),
  updateStatus: jest.fn().mockResolvedValue(),
  updateBrokerMetadata: jest.fn().mockResolvedValue(),
  findById: jest.fn().mockResolvedValue({ id: 'connection-1', brokerType: 'tradestation' }),
  findByUserId: jest.fn().mockResolvedValue([]),
  calculateNextSync: jest.fn().mockReturnValue(new Date('2026-10-11T09:00:00Z'))
}));
jest.mock('../../src/utils/timezone', () => ({
  getUserTimezone: jest.fn().mockResolvedValue('America/New_York')
}));
jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}));

const db = require('../../src/config/database');
const BrokerConnection = require('../../src/models/BrokerConnection');
const axios = require('axios');
const brokerSyncController = require('../../src/controllers/brokerSync.controller');
const schwabService = require('../../src/services/brokerSync/schwabService');
const tradestationService = require('../../src/services/brokerSync/tradestationService');

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    redirectedTo: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
    redirect(url) { this.redirectedTo = url; return this; }
  };
}

describe('Schwab OAuth state — server-side binding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SCHWAB_CLIENT_ID = 'client';
    process.env.SCHWAB_CLIENT_SECRET = 'secret';
    process.env.SCHWAB_REDIRECT_URI = 'https://example.com/cb';
    process.env.FRONTEND_URL = 'https://example.com';
    tradestationService.config.clientId = 'ts-client';
    tradestationService.config.clientSecret = 'ts-secret';
    tradestationService.config.redirectUri = 'https://example.com/api/broker-sync/connections/tradestation/callback';
  });

  test('initSchwabOAuth INSERTs a random state bound to the caller userId', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const req = { user: { id: 'user-123' } };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.initSchwabOAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO oauth_pending_states/);
    expect(params[0]).toMatch(/^[a-f0-9]{64}$/); // 32-byte hex token
    expect(params[1]).toBe('user-123');
    expect(params[2]).toBe('schwab');
    expect(params[3]).toBeInstanceOf(Date);
    expect(JSON.parse(params[4])).toMatchObject({ platform: 'web' });

    // authUrl must include the state as-is (no client-readable base64 payload)
    const stateParam = new URL(res.payload.authUrl).searchParams.get('state');
    expect(stateParam).toBe(params[0]);
  });

  test('handleSchwabCallback rejects a state that does not match any row', async () => {
    // UPDATE ... RETURNING * returns no rows -> invalid/expired/reused state.
    // Follow-up context SELECT also returns no rows, so this falls back to web.
    db.query.mockResolvedValueOnce({ rows: [] });
    db.query.mockResolvedValueOnce({ rows: [] });

    const req = { query: { code: 'auth-code', state: 'deadbeef' } };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.handleSchwabCallback(req, res, next);

    expect(res.redirectedTo).toBe('https://example.com/settings/broker-sync?error=invalid_state');
    expect(BrokerConnection.create).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('handleSchwabCallback derives userId from the DB row, never from the client state', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ user_id: 'real-user-from-db', context: { platform: 'web' } }] });
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }
    });
    axios.get.mockResolvedValueOnce({
      data: [{ securitiesAccount: { accountNumber: '12345678' } }]
    });

    const req = {
      query: {
        code: 'auth-code',
        // Even if the attacker supplies a state that *looks* like a different
        // userId, the controller must use what the DB returned.
        state: 'any-arbitrary-token'
      }
    };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.handleSchwabCallback(req, res, next);

    expect(BrokerConnection.create).toHaveBeenCalledTimes(1);
    const [userId] = BrokerConnection.create.mock.calls[0];
    expect(userId).toBe('real-user-from-db');
  });

  test('the state lookup UPDATE requires consumed_at IS NULL (no replay)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    db.query.mockResolvedValueOnce({ rows: [] });

    const req = { query: { code: 'x', state: 'y' } };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.handleSchwabCallback(req, res, next);

    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch(/consumed_at IS NULL/);
    expect(sql).toMatch(/expires_at > NOW\(\)/);
    expect(sql).toMatch(/SET consumed_at = NOW\(\)/);
  });

  test('handleSchwabCallback redirects iOS flows back to the app URL scheme', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ user_id: 'real-user-from-db', context: { platform: 'ios' } }] });
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }
    });
    axios.get.mockResolvedValueOnce({
      data: [{ securitiesAccount: { accountNumber: '12345678' } }]
    });

    const req = { query: { code: 'auth-code', state: 'ios-state-token' } };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.handleSchwabCallback(req, res, next);

    expect(res.redirectedTo).toBe('tradetally://broker-sync?success=schwab');
  });

  test('initBrokerOAuth INSERTs state for direct OAuth brokers', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const req = {
      user: { id: 'user-123' },
      params: { broker: 'tradestation' },
      body: { platform: 'ios' }
    };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.initBrokerOAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO oauth_pending_states/);
    expect(params[1]).toBe('user-123');
    expect(params[2]).toBe('tradestation');
    expect(JSON.parse(params[4])).toMatchObject({ environment: null, platform: 'ios' });
    expect(new URL(res.payload.authUrl).searchParams.get('state')).toBe(params[0]);
  });

  test('handleBrokerOAuthCallback derives userId from state row for direct OAuth brokers', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ user_id: 'real-user-from-db', context: { platform: 'ios' } }] });
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'ReadAccount' }
    });
    axios.get.mockResolvedValueOnce({
      data: { Accounts: [{ AccountID: 'TS1234' }] }
    });

    const req = {
      params: { broker: 'tradestation' },
      query: { code: 'auth-code', state: 'state-token' }
    };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.handleBrokerOAuthCallback(req, res, next);

    expect(BrokerConnection.create).toHaveBeenCalledWith(
      'real-user-from-db',
      expect.objectContaining({
        brokerType: 'tradestation',
        oauthAccessToken: 'AT',
        oauthRefreshToken: 'RT',
        externalAccountId: 'TS1234'
      })
    );
    expect(res.redirectedTo).toBe('tradetally://broker-sync?success=tradestation');
  });
});

describe('Schwab account exclusions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns only redacted account identifiers and marks excluded accounts', async () => {
    BrokerConnection.findById.mockResolvedValueOnce({
      id: 'connection-1',
      userId: 'user-1',
      brokerType: 'schwab',
      excluded_account_identifiers: ['****1111']
    });
    const ensureTokenSpy = jest.spyOn(schwabService, 'ensureValidToken')
      .mockResolvedValue({ accessToken: 'access-token', needsReauth: false });
    const accountsSpy = jest.spyOn(schwabService, 'getAccountNumbers')
      .mockResolvedValue([
        { accountNumber: '11111111', hashValue: 'hash-1' },
        { accountNumber: '22222222', hashValue: 'hash-2' }
      ]);
    const req = { user: { id: 'user-1' }, params: { id: 'connection-1' } };
    const res = createRes();
    const next = jest.fn();

    try {
      await brokerSyncController.getConnectionAccounts(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.payload.data).toEqual({
        accounts: [
          { account_identifier: '****1111', excluded: true },
          { account_identifier: '****2222', excluded: false }
        ],
        excluded_account_identifiers: ['****1111']
      });
      expect(JSON.stringify(res.payload)).not.toContain('11111111');
      expect(JSON.stringify(res.payload)).not.toContain('hash-1');
      expect(BrokerConnection.updateBrokerMetadata).toHaveBeenCalledWith(
        'connection-1',
        {
          schwab_accounts: [
            { account_identifier: '****1111' },
            { account_identifier: '****2222' }
          ]
        }
      );
    } finally {
      ensureTokenSpy.mockRestore();
      accountsSpy.mockRestore();
    }
  });

  test('normalizes and saves exclusions without changing unrelated settings', async () => {
    BrokerConnection.findById
      .mockResolvedValueOnce({
        id: 'connection-1',
        userId: 'user-1',
        brokerType: 'schwab',
        excluded_account_identifiers: []
      })
      .mockResolvedValueOnce({
        id: 'connection-1',
        userId: 'user-1',
        brokerType: 'schwab',
        excluded_account_identifiers: ['****1111']
      });
    const req = {
      user: { id: 'user-1' },
      params: { id: 'connection-1' },
      body: { excluded_account_identifiers: [' ****1111 ', '****1111', ''] }
    };
    const res = createRes();
    const next = jest.fn();

    await brokerSyncController.updateConnection(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(BrokerConnection.updateBrokerMetadata).toHaveBeenCalledWith(
      'connection-1',
      { excluded_account_identifiers: ['****1111'] }
    );
    expect(res.payload.data.excluded_account_identifiers).toEqual(['****1111']);
  });
});

describe('Schwab OAuth code exchange — manual redirect URL paste', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SCHWAB_CLIENT_ID = 'client';
    process.env.SCHWAB_CLIENT_SECRET = 'secret';
    process.env.SCHWAB_REDIRECT_URI = 'https://127.0.0.1:8081/api/broker-sync/connections/schwab/callback';
  });

  describe('extractSchwabOAuthParams', () => {
    const { extractSchwabOAuthParams } = brokerSyncController;

    test('extracts code and decodes %40 to @ from full redirect URL', () => {
      const result = extractSchwabOAuthParams(
        'https://127.0.0.1:8081/api/broker-sync/connections/schwab/callback?code=C0.abc123xyz%40&session=sess99&state=mystate'
      );
      expect(result.code).toBe('C0.abc123xyz@');
      expect(result.state).toBe('mystate');
      expect(result.error).toBeNull();
    });

    test('extracts code from query string only', () => {
      const result = extractSchwabOAuthParams('?code=C0.mycode%40&session=abc');
      expect(result.code).toBe('C0.mycode@');
    });

    test('extracts code when candidate starts with C0. directly', () => {
      const result = extractSchwabOAuthParams('C0.rawcode123%40');
      expect(result.code).toBe('C0.rawcode123@');
    });

    test('detects error in query parameters', () => {
      const result = extractSchwabOAuthParams(
        'https://127.0.0.1:8081/callback?error=access_denied&error_description=User+denied'
      );
      expect(result.error).toBe('access_denied');
      expect(result.errorDescription).toBe('User denied');
      expect(result.code).toBeNull();
    });

    test('returns null code for invalid text', () => {
      const result = extractSchwabOAuthParams('hello world');
      expect(result.code).toBeNull();
    });
  });

  describe('exchangeSchwabCode controller', () => {
    test('rejects request when no valid code can be found', async () => {
      const req = {
        user: { id: 'user-123' },
        body: { redirectUrl: 'https://example.com/no-code' }
      };
      const res = createRes();
      const next = jest.fn();

      await brokerSyncController.exchangeSchwabCode(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(res.payload.error).toMatch(/Could not find a valid Schwab authorization code/);
    });

    test('rejects request when Schwab reported an error in the redirect URL', async () => {
      const req = {
        user: { id: 'user-123' },
        body: { redirectUrl: 'https://127.0.0.1/?error=access_denied&error_description=User+cancelled' }
      };
      const res = createRes();
      const next = jest.fn();

      await brokerSyncController.exchangeSchwabCode(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(res.payload.error).toMatch(/User cancelled/);
    });

    test('successfully exchanges code from pasted redirect URL and activates connection', async () => {
      axios.post.mockResolvedValueOnce({
        data: { access_token: 'AT-123', refresh_token: 'RT-456', expires_in: 1800 }
      });
      axios.get.mockResolvedValueOnce({
        data: [{ securitiesAccount: { accountNumber: '87654321' } }]
      });
      BrokerConnection.findByUserId.mockResolvedValueOnce([]);
      BrokerConnection.findById.mockResolvedValueOnce({
        id: 'conn-schwab-1',
        brokerType: 'schwab',
        connectionStatus: 'active'
      });

      const req = {
        user: { id: 'user-123' },
        body: {
          redirectUrl: 'https://127.0.0.1:8081/api/broker-sync/connections/schwab/callback?code=C0.abc999%40&session=xyz',
          accountLabel: 'My Schwab'
        }
      };
      const res = createRes();
      const next = jest.fn();

      await brokerSyncController.exchangeSchwabCode(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.payload.success).toBe(true);

      // Verify token exchange call with decoded code
      expect(axios.post).toHaveBeenCalledTimes(1);
      const [tokenUrl, body, config] = axios.post.mock.calls[0];
      expect(tokenUrl).toBe('https://api.schwabapi.com/v1/oauth/token');
      expect(body.get('code')).toBe('C0.abc999@');
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('redirect_uri')).toBe(process.env.SCHWAB_REDIRECT_URI);

      // Verify connection creation and status update
      expect(BrokerConnection.create).toHaveBeenCalledWith('user-123', expect.objectContaining({
        brokerType: 'schwab',
        schwabAccessToken: 'AT-123',
        schwabRefreshToken: 'RT-456',
        accountLabel: 'My Schwab'
      }));
      expect(BrokerConnection.updateStatus).toHaveBeenCalledWith('connection-1', 'active', expect.any(String));
    });

    test('preserves existing connection settings when updating/re-authenticating', async () => {
      axios.post.mockResolvedValueOnce({
        data: { access_token: 'AT-new', refresh_token: 'RT-new', expires_in: 1800 }
      });
      axios.get.mockResolvedValueOnce({
        data: [{ securitiesAccount: { accountNumber: '87654321' } }]
      });
      BrokerConnection.findByUserId.mockResolvedValueOnce([{
        id: 'existing-schwab',
        brokerType: 'schwab',
        accountLabel: 'Original Label',
        autoSyncEnabled: true,
        syncFrequency: 'hourly',
        syncTime: '09:00:00',
        syncStartDate: '2025-01-01'
      }]);
      BrokerConnection.findById.mockResolvedValueOnce({
        id: 'existing-schwab',
        brokerType: 'schwab',
        connectionStatus: 'active'
      });

      const req = {
        user: { id: 'user-123' },
        body: {
          redirectUrl: 'https://127.0.0.1:8081/cb?code=C0.newcode%40'
          // no settings passed, must preserve existing
        }
      };
      const res = createRes();
      const next = jest.fn();

      await brokerSyncController.exchangeSchwabCode(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(BrokerConnection.create).toHaveBeenCalledWith('user-123', expect.objectContaining({
        accountLabel: 'Original Label',
        autoSyncEnabled: true,
        syncFrequency: 'hourly',
        syncStartDate: '2025-01-01'
      }));
    });
  });
});
