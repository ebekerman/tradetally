/**
 * Broker Sync Deleted Trade Model
 * Tracks trades manually deleted by the user to prevent broker sync reimporting them.
 */

const db = require('../config/database');

class BrokerSyncDeletedTrade {
  /**
   * Extract unique order IDs from trade execution data
   * @param {Array|string} executions
   * @returns {string[]}
   */
  static extractOrderIds(executions) {
    if (!executions) return [];
    let list = executions;
    if (typeof list === 'string') {
      try {
        list = JSON.parse(list);
      } catch {
        return [];
      }
    }
    if (!Array.isArray(list)) return [];

    const orderIds = new Set();
    for (const exec of list) {
      if (exec?.orderId) {
        orderIds.add(String(exec.orderId).trim());
      }
      if (exec?.order_id) {
        orderIds.add(String(exec.order_id).trim());
      }
    }
    return Array.from(orderIds).filter(Boolean);
  }

  /**
   * Record deleted broker trade(s)
   * @param {Array} trades
   * @param {string} userId
   * @param {object} [client] - Optional db client for transaction support
   */
  static async recordDeletedTrades(trades, userId, client = null) {
    if (!Array.isArray(trades) || trades.length === 0) return [];
    const queryRunner = client || db;

    const recorded = [];
    for (const trade of trades) {
      // Only record trades that were associated with a broker connection or specific broker
      const hasBroker = trade.broker_connection_id || trade.broker;
      if (!hasBroker) continue;

      const orderIds = this.extractOrderIds(trade.executions);
      let executionsJson = [];
      if (Array.isArray(trade.executions)) {
        executionsJson = trade.executions;
      } else if (typeof trade.executions === 'string') {
        try {
          executionsJson = JSON.parse(trade.executions);
        } catch {
          executionsJson = [];
        }
      }

      const tradeDate = trade.trade_date
        ? (trade.trade_date instanceof Date ? trade.trade_date.toISOString().slice(0, 10) : String(trade.trade_date).slice(0, 10))
        : null;

      const query = `
        INSERT INTO broker_sync_deleted_trades (
          user_id,
          broker_connection_id,
          broker,
          symbol,
          side,
          trade_date,
          entry_time,
          exit_time,
          quantity,
          entry_price,
          exit_price,
          account_identifier,
          order_ids,
          execution_data
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
        RETURNING *
      `;

      const values = [
        userId || trade.user_id,
        trade.broker_connection_id || null,
        String(trade.broker || 'schwab').toLowerCase(),
        trade.symbol || '',
        trade.side || null,
        tradeDate,
        trade.entry_time || null,
        trade.exit_time || null,
        trade.quantity != null ? trade.quantity : null,
        trade.entry_price != null ? trade.entry_price : null,
        trade.exit_price != null ? trade.exit_price : null,
        trade.account_identifier || null,
        orderIds,
        JSON.stringify(executionsJson)
      ];

      const res = await queryRunner.query(query, values);
      if (res.rows[0]) {
        recorded.push(res.rows[0]);
      }
    }

    return recorded;
  }

  /**
   * Get all recorded deleted trades for a connection / broker
   * @param {string} userId
   * @param {string} [connectionId]
   * @param {string} [broker]
   * @returns {Promise<Array>}
   */
  static async getDeletedTradesForConnection(userId, connectionId = null, broker = 'schwab') {
    let query = `
      SELECT id, user_id, broker_connection_id, broker, symbol, side, trade_date,
             entry_time, exit_time, quantity, entry_price, exit_price,
             account_identifier, order_ids, execution_data, deleted_at
      FROM broker_sync_deleted_trades
      WHERE user_id = $1
    `;
    const params = [userId];

    if (connectionId) {
      params.push(connectionId, String(broker || '').toLowerCase());
      query += ` AND (broker_connection_id = $2 OR LOWER(broker) = $3)`;
    } else if (broker) {
      params.push(String(broker).toLowerCase());
      query += ` AND LOWER(broker) = $2`;
    }

    query += ` ORDER BY deleted_at DESC`;

    const res = await db.query(query, params);
    return res.rows;
  }

  /**
   * Clear all deleted trade tombstones for a specific connection
   * Called when a user explicitly deletes all imported trades to restart fresh.
   * @param {string} connectionId
   * @param {object} [client]
   */
  static async clearForConnection(connectionId, client = null) {
    const queryRunner = client || db;
    const query = `
      DELETE FROM broker_sync_deleted_trades
      WHERE broker_connection_id = $1
      RETURNING id
    `;
    const res = await queryRunner.query(query, [connectionId]);
    return res.rowCount;
  }
}

module.exports = BrokerSyncDeletedTrade;
