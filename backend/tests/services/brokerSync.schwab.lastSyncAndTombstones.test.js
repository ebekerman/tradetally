/**
 * Tests for Schwab sync with lastSyncAt consideration and deleted trades tombstone suppression.
 */

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn()
}));

const db = require('../../src/config/database');
const schwabService = require('../../src/services/brokerSync/schwabService');
const BrokerConnection = require('../../src/models/BrokerConnection');
const BrokerSyncDeletedTrade = require('../../src/models/BrokerSyncDeletedTrade');
const Trade = require('../../src/models/Trade');

describe('Schwab lastSyncAt and Deleted Trade Suppression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('schwabService.resolveEffectiveStartDate', () => {
    test('uses 7-day overlap before lastSyncAt when lastSyncAt is provided', () => {
      const connection = {
        lastSyncAt: '2026-09-08T12:00:00Z',
        syncStartDate: null
      };

      const startDate = schwabService.resolveEffectiveStartDate(connection);
      expect(startDate).toBe('2026-09-01');
    });

    test('clamps incremental start to connection.syncStartDate floor when floor is later', () => {
      const connection = {
        lastSyncAt: '2026-09-05T12:00:00Z', // 7 days prior is 2026-08-29
        syncStartDate: '2026-09-01'
      };

      const startDate = schwabService.resolveEffectiveStartDate(connection);
      expect(startDate).toBe('2026-09-01');
    });

    test('keeps incremental start when it is after syncStartDate floor', () => {
      const connection = {
        lastSyncAt: '2026-09-15T12:00:00Z', // 7 days prior is 2026-09-08
        syncStartDate: '2026-01-01'
      };

      const startDate = schwabService.resolveEffectiveStartDate(connection);
      expect(startDate).toBe('2026-09-08');
    });

    test('falls back to syncStartDate floor when lastSyncAt is null', () => {
      const connection = {
        lastSyncAt: null,
        syncStartDate: '2026-01-01'
      };

      const startDate = schwabService.resolveEffectiveStartDate(connection);
      expect(startDate).toBe('2026-01-01');
    });

    test('returns null (for all history scan) when both lastSyncAt and syncStartDate are null', () => {
      const connection = {
        lastSyncAt: null,
        syncStartDate: null
      };

      const startDate = schwabService.resolveEffectiveStartDate(connection);
      expect(startDate).toBeNull();
    });

    test('respects explicit options.startDate provided by caller', () => {
      const connection = {
        lastSyncAt: '2026-09-08T12:00:00Z',
        syncStartDate: '2026-01-01'
      };

      const startDate = schwabService.resolveEffectiveStartDate(connection, {
        startDate: '2026-08-15'
      });
      expect(startDate).toBe('2026-08-15');
    });
  });

  describe('schwabService.isDeletedTrade', () => {
    const sampleTombstone = {
      id: 'del-1',
      user_id: 'user-1',
      broker_connection_id: 'conn-1',
      broker: 'schwab',
      symbol: 'AAPL',
      side: 'long',
      trade_date: '2026-09-02',
      entry_price: 150.00,
      exit_price: 155.00,
      quantity: 10,
      account_identifier: '****1234',
      order_ids: ['order-exit-999', 'order-entry-111'],
      execution_data: []
    };

    test('matches and suppresses incoming trade by execution orderId', () => {
      const incomingTrade = {
        symbol: 'AAPL',
        side: 'long',
        quantity: 10,
        tradeDate: '2026-09-02',
        executionData: [
          { orderId: 'order-exit-999', datetime: '2026-09-02T15:00:00Z', type: 'exit' }
        ]
      };

      expect(schwabService.isDeletedTrade(incomingTrade, [sampleTombstone])).toBe(true);
    });

    test('matches and suppresses incoming trade by signature when orderId is absent', () => {
      const incomingTrade = {
        symbol: 'AAPL',
        side: 'long',
        quantity: 10,
        entryPrice: 150.00,
        exitPrice: 155.00,
        tradeDate: '2026-09-02',
        accountIdentifier: '****1234',
        executionData: []
      };

      expect(schwabService.isDeletedTrade(incomingTrade, [sampleTombstone])).toBe(true);
    });

    test('does not suppress a different trade with different symbol or date', () => {
      const differentSymbol = {
        symbol: 'MSFT',
        side: 'long',
        quantity: 10,
        tradeDate: '2026-09-02',
        executionData: [{ orderId: 'order-different-123' }]
      };

      const differentDate = {
        symbol: 'AAPL',
        side: 'long',
        quantity: 10,
        entryPrice: 150.00,
        exitPrice: 155.00,
        tradeDate: '2026-09-05',
        executionData: []
      };

      expect(schwabService.isDeletedTrade(differentSymbol, [sampleTombstone])).toBe(false);
      expect(schwabService.isDeletedTrade(differentDate, [sampleTombstone])).toBe(false);
    });
  });

  describe('schwabService.isDuplicateTrade with orphan closing fill', () => {
    test('matches orphan closing trade with existing open trade in DB and marks for update', () => {
      const existingOpenTrade = {
        id: 'trade-open-1',
        symbol: 'TSLA',
        side: 'long',
        quantity: 50,
        entry_price: 200.00,
        exit_price: null,
        entry_time: '2026-08-20T14:30:00Z',
        exit_time: null,
        trade_date: '2026-08-20',
        executions: [
          { orderId: 'ord-entry-1', datetime: '2026-08-20T14:30:00Z', price: 200, quantity: 50, type: 'entry' }
        ]
      };

      const incomingClosingTrade = {
        symbol: 'TSLA',
        side: 'long',
        quantity: 50,
        entryPrice: null, // Opened before sync window
        exitPrice: 220.00,
        entryTime: null,
        exitTime: '2026-09-05T15:30:00Z',
        tradeDate: '2026-09-05',
        executionData: [
          { orderId: 'ord-exit-2', datetime: '2026-09-05T15:30:00Z', price: 220, quantity: 50, type: 'exit' }
        ]
      };

      const isDup = schwabService.isDuplicateTrade(incomingClosingTrade, [existingOpenTrade]);
      expect(isDup).toBe(false);
      expect(incomingClosingTrade.isUpdate).toBe(true);
      expect(incomingClosingTrade.existingTradeId).toBe('trade-open-1');
      expect(incomingClosingTrade.entryPrice).toBe(200.00);
      expect(incomingClosingTrade.executionData).toHaveLength(2);
    });
  });

  describe('BrokerSyncDeletedTrade model', () => {
    test('extractOrderIds extracts orderId from various execution shapes', () => {
      const execs = [
        { orderId: '12345' },
        { order_id: '67890' },
        { orderId: '12345' }, // Duplicate
        { type: 'entry' } // Missing orderId
      ];

      const ids = BrokerSyncDeletedTrade.extractOrderIds(execs);
      expect(ids).toEqual(['12345', '67890']);
    });

    test('clearForConnection deletes tombstones for connection', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 3 });

      const count = await BrokerSyncDeletedTrade.clearForConnection('conn-1');
      expect(count).toBe(3);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/DELETE\s+FROM\s+broker_sync_deleted_trades\s+WHERE\s+broker_connection_id\s*=\s*\$1/i),
        ['conn-1']
      );
    });
  });

  describe('BrokerConnection.clearLastSync', () => {
    test('resets last_sync_at to NULL and clears failure counters', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{
          id: 'conn-1',
          user_id: 'user-1',
          broker_type: 'schwab',
          connection_status: 'active',
          last_sync_at: null,
          last_sync_status: null
        }]
      });

      const updated = await BrokerConnection.clearLastSync('conn-1');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('last_sync_at = NULL'),
        ['conn-1']
      );
      expect(updated.lastSyncAt).toBeNull();
    });
  });

  describe('Trade.delete tombstone recording', () => {
    test('records tombstone when deleting a trade with broker_connection_id', async () => {
      const sampleTrade = {
        id: 'trade-del-1',
        user_id: 'user-1',
        broker_connection_id: 'conn-1',
        broker: 'schwab',
        symbol: 'AAPL',
        side: 'long',
        trade_date: '2026-09-02',
        entry_price: 150.00,
        exit_price: 155.00,
        quantity: 10,
        account_identifier: '****1234',
        executions: [{ orderId: 'ord-123', type: 'exit' }]
      };

      db.withTransaction.mockImplementation(async (cb) => cb(db));
      // 1. DELETE FROM job_queue
      db.query.mockResolvedValueOnce({ rows: [] });
      // 2. SELECT trade before deletion
      db.query.mockResolvedValueOnce({ rows: [sampleTrade] });
      // 3. INSERT into broker_sync_deleted_trades
      db.query.mockResolvedValueOnce({ rows: [{ id: 'tombstone-1' }] });
      // 4. DELETE FROM trades
      db.query.mockResolvedValueOnce({ rows: [{ id: 'trade-del-1' }] });

      const res = await Trade.delete('trade-del-1', 'user-1', { skipOptionGrouping: true });
      expect(res).toEqual({ id: 'trade-del-1' });

      // Verify tombstone insertion query was called
      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/INSERT INTO broker_sync_deleted_trades/i),
        expect.arrayContaining(['user-1', 'conn-1', 'schwab', 'AAPL', 'long'])
      );
    });

    test('does not record tombstone when trade has no broker association', async () => {
      const manualTrade = {
        id: 'trade-manual-1',
        user_id: 'user-1',
        broker_connection_id: null,
        broker: null,
        symbol: 'NVDA'
      };

      db.withTransaction.mockImplementation(async (cb) => cb(db));
      // 1. DELETE FROM job_queue
      db.query.mockResolvedValueOnce({ rows: [] });
      // 2. SELECT trade before deletion
      db.query.mockResolvedValueOnce({ rows: [manualTrade] });
      // 3. DELETE FROM trades
      db.query.mockResolvedValueOnce({ rows: [{ id: 'trade-manual-1' }] });

      const res = await Trade.delete('trade-manual-1', 'user-1', { skipOptionGrouping: true });
      expect(res).toEqual({ id: 'trade-manual-1' });

      // Verify tombstone insertion was NOT called
      const insertCalls = db.query.mock.calls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('INSERT INTO broker_sync_deleted_trades')
      );
      expect(insertCalls).toHaveLength(0);
    });

    test('records tombstones during bulkDeleteTrades for broker-synced trades', async () => {
      const tradeController = require('../../src/controllers/trade.controller');
      const validUuid = '11111111-2222-3333-4444-555555555555';
      const sampleBrokerTrade = {
        id: validUuid,
        user_id: 'user-1',
        broker_connection_id: 'conn-1',
        broker: 'schwab',
        symbol: 'SPY',
        side: 'short',
        trade_date: '2026-09-01',
        quantity: 20,
        entry_price: 500,
        exit_price: 490,
        executions: [{ orderId: 'ord-spy-1' }]
      };

      const req = {
        user: { id: 'user-1' },
        body: { tradeIds: [validUuid] }
      };
      let resPayload = null;
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(data => { resPayload = data; return res; })
      };
      const next = jest.fn();

      db.withTransaction.mockImplementation(async (cb) => cb(db));

      // 1. ownedResult lookup
      db.query.mockResolvedValueOnce({ rows: [{ id: validUuid }] });
      // 2. withTransaction: SELECT * FROM trades WHERE id = ANY(...) AND (broker_connection_id IS NOT NULL OR broker IS NOT NULL)
      db.query.mockResolvedValueOnce({ rows: [sampleBrokerTrade] });
      // 3. withTransaction: INSERT INTO broker_sync_deleted_trades
      db.query.mockResolvedValueOnce({ rows: [{ id: 'tomb-spy' }] });
      // 4. withTransaction: DELETE FROM job_queue
      db.query.mockResolvedValueOnce({ rows: [] });
      // 5. withTransaction: DELETE FROM trades
      db.query.mockResolvedValueOnce({ rows: [{ id: validUuid }] });

      await tradeController.bulkDeleteTrades(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(resPayload.deletedCount).toBe(1);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringMatching(/INSERT INTO broker_sync_deleted_trades/i),
        expect.arrayContaining(['user-1', 'conn-1', 'schwab', 'SPY', 'short'])
      );
    });
  });
});
