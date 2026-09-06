-- Track manually deleted trades from broker sync to prevent automatic reimporting.
CREATE TABLE IF NOT EXISTS broker_sync_deleted_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_connection_id UUID REFERENCES broker_connections(id) ON DELETE CASCADE,
  broker VARCHAR(50) NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  side VARCHAR(10),
  trade_date VARCHAR(20),
  entry_time TIMESTAMP WITH TIME ZONE,
  exit_time TIMESTAMP WITH TIME ZONE,
  quantity NUMERIC,
  entry_price NUMERIC,
  exit_price NUMERIC,
  account_identifier VARCHAR(100),
  order_ids TEXT[] DEFAULT '{}',
  execution_data JSONB DEFAULT '[]',
  deleted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_broker_sync_deleted_trades_user
  ON broker_sync_deleted_trades(user_id, broker);

CREATE INDEX IF NOT EXISTS idx_broker_sync_deleted_trades_conn
  ON broker_sync_deleted_trades(broker_connection_id);

CREATE INDEX IF NOT EXISTS idx_broker_sync_deleted_trades_order_ids
  ON broker_sync_deleted_trades USING GIN(order_ids);
