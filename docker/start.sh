#!/bin/sh

# Wait for database to be ready and accepting queries
echo "[WAIT] Waiting for database connection..."
node <<'EOF'
const { Pool } = require('/app/backend/node_modules/pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'tradetally',
  user: process.env.DB_USER || 'trader',
  password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 3000,
});

async function waitForDb() {
  const maxAttempts = 30;
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('[OK] Database connection established and accepting queries');
      await pool.end();
      process.exit(0);
    } catch (err) {
      console.log(`   Database not ready (attempt ${i}/${maxAttempts}: ${err.message}), waiting...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  console.error('[ERROR] Timed out waiting for database connection');
  await pool.end();
  process.exit(1);
}

waitForDb();
EOF

if [ $? -ne 0 ]; then
  echo "[FATAL] Could not connect to database. Exiting."
  exit 1
fi

# Set environment variables for mobile support
export RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"

# Expose selected runtime config values to the static frontend bundle.
node <<'EOF' > /usr/share/nginx/html/runtime-config.js
const config = {
  VITE_POSTHOG_ENABLED: process.env.VITE_POSTHOG_ENABLED || '',
  VITE_POSTHOG_KEY: process.env.VITE_POSTHOG_KEY || '',
  VITE_POSTHOG_HOST: process.env.VITE_POSTHOG_HOST || '',
};

process.stdout.write(`window.__APP_CONFIG__ = Object.freeze(${JSON.stringify(config)});\n`);
EOF

# Ensure writable runtime directories exist for mounted volumes.
mkdir -p \
  /app/backend/uploads/trades \
  /app/backend/uploads/diary \
  /app/backend/uploads/avatars \
  /app/backend/src/data/backups \
  /app/backend/src/logs
chown -R appuser:appgroup /app/backend/uploads /app/backend/src/data /app/backend/src/logs

# Start backend as non-root user (migrations will run automatically)
echo "[START] Starting TradeTally backend..."
cd /app/backend && su-exec appuser node src/server.js &
BACKEND_PID=$!

# Monitor backend process; if it exits, stop nginx so the container exits and orchestrator restarts it
(
  while kill -0 "$BACKEND_PID" 2>/dev/null; do
    sleep 2
  done
  echo "[FATAL] Backend process (PID $BACKEND_PID) exited unexpectedly. Stopping container..."
  nginx -s stop 2>/dev/null
  kill -s TERM 1 2>/dev/null
  exit 1
) &

# Wait for backend to start
sleep 5

# Start nginx
nginx -g "daemon off;"
