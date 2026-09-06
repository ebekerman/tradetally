/**
 * Schwab API Integration Service
 * Fetches trade data from Charles Schwab using their Developer API
 *
 * API Documentation: https://developer.schwab.com
 *
 * Note: Schwab requires:
 * 1. Developer account registration at developer.schwab.com
 * 2. App approval (can take a few days)
 * 3. Think or Swim enabled account
 * 4. Manual re-authentication every 7 days (refresh token limitation)
 */

const axios = require('axios');
const Trade = require('../../models/Trade');
const BrokerConnection = require('../../models/BrokerConnection');
const AnalyticsCache = require('../analyticsCache');
const OptionStrategyGroupingService = require('../optionStrategyGroupingService');
const db = require('../../config/database');
const { getUserTimezone } = require('../../utils/timezone');
const { computeTradePnl } = require('../pnlEngine');

const SCHWAB_API_BASE = 'https://api.schwabapi.com/trader/v1';
const TOKEN_REFRESH_BUFFER = 5 * 60 * 1000; // Refresh 5 minutes before expiration

class SchwabService {
  /**
   * Redact account number for privacy - show only last 4 characters
   * @param {string} accountNumber - Full account number
   * @returns {string} - Redacted account number (e.g., "****1234")
   */
  redactAccountNumber(accountNumber) {
    if (!accountNumber) return null;
    const str = String(accountNumber);
    if (str.length <= 4) return str;
    return '****' + str.slice(-4);
  }

  /**
   * Extract date string (YYYY-MM-DD) from various date formats
   * Handles Date objects, ISO strings, date-only strings, and edge cases
   * @param {Date|string|any} dateValue - The date value to extract from
   * @returns {string|null} - Date string in YYYY-MM-DD format, or null if invalid
   */
  _extractDateString(dateValue) {
    if (!dateValue) return null;

    // Handle Date objects
    if (dateValue instanceof Date) {
      return dateValue.toISOString().split('T')[0];
    }

    // Convert to string and handle various formats
    const str = String(dateValue);

    // ISO format: 2025-01-30T10:00:00Z
    if (str.includes('T')) {
      return str.split('T')[0];
    }

    // Date-only format: 2025-01-30
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      return str.slice(0, 10);
    }

    // Try to parse as date
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }

    return null;
  }

  /**
   * Schwab transactions can include both `time` and `tradeDate`. Some responses
   * only provide a date-like `tradeDate`, which is not precise enough for FIFO
   * matching intraday partial exits. Prefer whichever field contains an actual
   * intraday time so buys and sells are processed in execution order.
   */
  _getTransactionTime(tx) {
    const candidates = [tx.time, tx.tradeDate].filter(Boolean);
    const precise = candidates.find(value => this._hasIntradayTime(value));
    return precise || candidates[0] || null;
  }

  _hasIntradayTime(value) {
    if (!value) return false;

    if (value instanceof Date) {
      return value.getUTCHours() !== 0 ||
        value.getUTCMinutes() !== 0 ||
        value.getUTCSeconds() !== 0 ||
        value.getUTCMilliseconds() !== 0;
    }

    const str = String(value);
    const match = str.match(/T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
    if (!match) return false;

    const [, hours, minutes, seconds, milliseconds = '0'] = match;
    return Number(hours) !== 0 ||
      Number(minutes) !== 0 ||
      Number(seconds) !== 0 ||
      Number(milliseconds) !== 0;
  }

  _getTimeValue(value) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }

  _compareTransactionsForMatching(a, b) {
    const aTime = this._getTimeValue(a.time);
    const bTime = this._getTimeValue(b.time);

    if (aTime !== null && bTime !== null && aTime !== bTime) {
      return aTime - bTime;
    }

    if (aTime !== null && bTime === null) return -1;
    if (aTime === null && bTime !== null) return 1;

    // If Schwab only gave date-level timestamps, process openings before
    // closings so same-day scale-outs are not treated as unmatched short sales.
    const effectRank = { OPENING: 0, CLOSING: 1 };
    const aRank = effectRank[a.positionEffect] ?? 2;
    const bRank = effectRank[b.positionEffect] ?? 2;
    if (aRank !== bRank) {
      return aRank - bRank;
    }

    return String(a.orderId || '').localeCompare(String(b.orderId || ''));
  }

  _getPositionKey(tx) {
    const accountIdentifier = tx.accountIdentifier || 'default';
    const instrumentIdentifier = tx.matchingSymbol || tx.symbol;
    return JSON.stringify([accountIdentifier, instrumentIdentifier]);
  }

  _parseSchwabOptionSymbol(symbol) {
    if (!symbol) return null;

    const normalized = String(symbol).toUpperCase().replace(/\s+/g, ' ').trim();
    const compact = normalized.replace(/\s+/g, '');
    const match = normalized.match(/^([A-Z]{1,6})\s+(\d{6})([CP])(\d{8})$/) ||
      compact.match(/^([A-Z]{1,6})(\d{6})([CP])(\d{8})$/);

    if (!match) return null;

    const [, underlyingSymbol, expiry, type, strike] = match;
    const year = 2000 + parseInt(expiry.slice(0, 2), 10);
    const month = parseInt(expiry.slice(2, 4), 10);
    const day = parseInt(expiry.slice(4, 6), 10);

    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }

    return {
      underlyingSymbol,
      expirationDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      optionType: type === 'C' ? 'call' : 'put',
      strikePrice: parseInt(strike, 10) / 1000,
      contractSize: 100
    };
  }

  /**
   * Check if tokens need refresh and refresh if necessary
   * @param {object} connection - BrokerConnection with credentials
   * @returns {Promise<{accessToken: string, needsReauth: boolean}>}
   */
  async ensureValidToken(connection) {
    // Handle missing or invalid expiration date
    if (!connection.schwabTokenExpiresAt) {
      console.log('[SCHWAB] No token expiration date, attempting refresh...');
      try {
        const newTokens = await this.refreshAccessToken(connection.schwabRefreshToken);
        await BrokerConnection.updateSchwabTokens(
          connection.id,
          newTokens.accessToken,
          newTokens.refreshToken,
          newTokens.expiresAt
        );
        return { accessToken: newTokens.accessToken, needsReauth: false };
      } catch (error) {
        console.error('[SCHWAB] Token refresh failed:', error.message);
        await BrokerConnection.updateStatus(connection.id, 'expired', 'Refresh token expired - please re-authenticate');
        return { accessToken: null, needsReauth: true };
      }
    }

    const expiresAt = new Date(connection.schwabTokenExpiresAt);
    const now = new Date();

    // Check if expiration date is invalid
    if (isNaN(expiresAt.getTime())) {
      console.log('[SCHWAB] Invalid token expiration date, attempting refresh...');
      try {
        const newTokens = await this.refreshAccessToken(connection.schwabRefreshToken);
        await BrokerConnection.updateSchwabTokens(
          connection.id,
          newTokens.accessToken,
          newTokens.refreshToken,
          newTokens.expiresAt
        );
        return { accessToken: newTokens.accessToken, needsReauth: false };
      } catch (error) {
        console.error('[SCHWAB] Token refresh failed:', error.message);
        await BrokerConnection.updateStatus(connection.id, 'expired', 'Refresh token expired - please re-authenticate');
        return { accessToken: null, needsReauth: true };
      }
    }

    // Check if token is expired or about to expire
    if (expiresAt.getTime() - now.getTime() < TOKEN_REFRESH_BUFFER) {
      console.log('[SCHWAB] Token expired or expiring soon, refreshing...');

      try {
        const newTokens = await this.refreshAccessToken(connection.schwabRefreshToken);

        // Update connection with new tokens
        await BrokerConnection.updateSchwabTokens(
          connection.id,
          newTokens.accessToken,
          newTokens.refreshToken,
          newTokens.expiresAt
        );

        return { accessToken: newTokens.accessToken, needsReauth: false };
      } catch (error) {
        // Refresh token likely expired (7 day limit)
        console.error('[SCHWAB] Token refresh failed:', error.message);
        await BrokerConnection.updateStatus(connection.id, 'expired', 'Refresh token expired - please re-authenticate');
        return { accessToken: null, needsReauth: true };
      }
    }

    return { accessToken: connection.schwabAccessToken, needsReauth: false };
  }

  /**
   * Refresh the access token using the refresh token
   * @param {string} refreshToken - Current refresh token
   * @returns {Promise<{accessToken: string, refreshToken: string, expiresAt: Date}>}
   */
  async refreshAccessToken(refreshToken) {
    console.log('[SCHWAB] Refreshing access token...');

    const response = await axios.post(
      'https://api.schwabapi.com/v1/oauth/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }),
      {
        auth: {
          username: process.env.SCHWAB_CLIENT_ID,
          password: process.env.SCHWAB_CLIENT_SECRET
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    console.log('[SCHWAB] Token refreshed successfully');

    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt
    };
  }

  /**
   * Get encrypted account numbers (required for all account-specific API calls)
   * @param {string} accessToken - Valid access token
   * @returns {Promise<Array<{accountNumber: string, hashValue: string}>>}
   */
  async getAccountNumbers(accessToken) {
    console.log('[SCHWAB] Fetching encrypted account numbers...');

    const response = await axios.get(
      `${SCHWAB_API_BASE}/accounts/accountNumbers`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    console.log(`[SCHWAB] Found ${response.data?.length || 0} accounts`);
    return response.data || [];
  }

  /**
   * Get account information
   * @param {string} accessToken - Valid access token
   * @returns {Promise<object>}
   */
  async getAccounts(accessToken) {
    console.log('[SCHWAB] Fetching accounts...');

    const response = await axios.get(
      `${SCHWAB_API_BASE}/accounts`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    return response.data;
  }

  /**
   * Get transactions for an account
   * Fetches year by year going backwards until 2 consecutive empty years or 25 years max
   * @param {string} accessToken - Valid access token
   * @param {string} accountHash - Encrypted account hash value
   * @param {string} startDate - Start date (YYYY-MM-DD format) - if provided, uses fixed range
   * @param {string} endDate - End date (YYYY-MM-DD format)
   * @returns {Promise<Array>}
   */
  async getTransactions(accessToken, accountHash, startDate, endDate) {
    console.log(`[SCHWAB] Account hash: ${accountHash?.substring(0, 10)}...`);

    // If specific date range provided, use that with chunking
    if (startDate) {
      return this.getTransactionsForRange(accessToken, accountHash, startDate, endDate);
    }

    // Otherwise, fetch all history by going backwards year by year
    return this.getTransactionsAllHistory(accessToken, accountHash);
  }

  /**
   * Fetch all transaction history by going backwards year by year
   * Stops after 2 consecutive years with no data or 25 years max
   */
  async getTransactionsAllHistory(accessToken, accountHash) {
    const allTransactions = [];
    const maxYears = 25;
    let consecutiveEmptyYears = 0;
    const today = new Date();

    for (let yearOffset = 0; yearOffset < maxYears; yearOffset++) {
      // Calculate year range (going backwards)
      const yearEnd = new Date(today);
      yearEnd.setFullYear(yearEnd.getFullYear() - yearOffset);

      const yearStart = new Date(yearEnd);
      yearStart.setFullYear(yearStart.getFullYear() - 1);
      yearStart.setDate(yearStart.getDate() + 1); // Day after to avoid overlap

      const startStr = yearStart.toISOString().split('T')[0];
      const endStr = yearEnd.toISOString().split('T')[0];

      console.log(`[SCHWAB] Fetching year ${yearOffset + 1}: ${startStr} to ${endStr}...`);

      try {
        const response = await axios.get(
          `${SCHWAB_API_BASE}/accounts/${accountHash}/transactions`,
          {
            params: {
              types: 'TRADE',
              startDate: this.formatDateForApi(startStr),
              endDate: this.formatDateForApi(endStr, true)
            },
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        );

        const count = response.data?.length || 0;
        console.log(`[SCHWAB] Year ${yearOffset + 1}: ${count} transactions`);

        if (count === 0) {
          consecutiveEmptyYears++;
          if (consecutiveEmptyYears >= 2) {
            console.log(`[SCHWAB] 2 consecutive empty years - stopping search`);
            break;
          }
        } else {
          consecutiveEmptyYears = 0;
          allTransactions.push(...response.data);
        }
      } catch (error) {
        // If we get an error (like "no data available"), treat as empty year
        console.error(`[SCHWAB] Year ${yearOffset + 1} fetch error:`, error.response?.data?.message || error.message);
        consecutiveEmptyYears++;
        if (consecutiveEmptyYears >= 2) {
          console.log(`[SCHWAB] 2 consecutive empty/error years - stopping search`);
          break;
        }
      }
    }

    console.log(`[SCHWAB] Total fetched for account: ${allTransactions.length} transactions`);
    return allTransactions;
  }

  /**
   * Fetch transactions for a specific date range (with chunking for ranges > 1 year)
   */
  async getTransactionsForRange(accessToken, accountHash, startDate, endDate) {
    const end = endDate || new Date().toISOString().split('T')[0];
    const chunks = this.getDateChunks(startDate, end);
    let allTransactions = [];

    for (const chunk of chunks) {
      console.log(`[SCHWAB] Fetching transactions from ${chunk.start} to ${chunk.end}...`);

      try {
        const response = await axios.get(
          `${SCHWAB_API_BASE}/accounts/${accountHash}/transactions`,
          {
            params: {
              types: 'TRADE',
              startDate: this.formatDateForApi(chunk.start),
              endDate: this.formatDateForApi(chunk.end, true)
            },
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        );

        const count = response.data?.length || 0;
        console.log(`[SCHWAB] Fetched ${count} transactions for this period`);
        allTransactions = allTransactions.concat(response.data || []);
      } catch (error) {
        console.error('[SCHWAB] Transaction fetch error:', error.response?.status || error.message);
        throw error;
      }
    }

    return allTransactions;
  }

  /**
   * Split date range into chunks of max 1 year each (Schwab API limit)
   */
  getDateChunks(startDate, endDate) {
    const chunks = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    const maxDays = 364;

    let chunkStart = new Date(start);

    while (chunkStart <= end) {
      let chunkEnd = new Date(chunkStart);
      chunkEnd.setDate(chunkEnd.getDate() + maxDays);

      if (chunkEnd > end) {
        chunkEnd = end;
      }

      chunks.push({
        start: chunkStart.toISOString().split('T')[0],
        end: chunkEnd.toISOString().split('T')[0]
      });

      chunkStart = new Date(chunkEnd);
      chunkStart.setDate(chunkStart.getDate() + 1);
    }

    return chunks;
  }

  /**
   * Format date for Schwab API (requires full ISO-8601 with milliseconds)
   * @param {string} dateStr - Date string (YYYY-MM-DD or ISO format)
   * @returns {string} - Formatted date string
   */
  formatDateForApi(dateStr, endOfDay = false) {
    // If already in full ISO format, return as is
    if (dateStr.includes('T') && dateStr.includes('Z')) {
      return dateStr;
    }

    // Convert YYYY-MM-DD to full ISO-8601 format
    const time = endOfDay ? 'T23:59:59.000Z' : 'T00:00:00.000Z';
    const date = new Date(dateStr + time);
    return date.toISOString();
  }

  /**
   * Parse Schwab transactions into TradeTally trade format
   * Matches opening and closing transactions to create complete trades
   * @param {Array} transactions - Raw Schwab transactions
   * @returns {Array} - Parsed trades (matched with entry and exit)
   */
  parseTransactions(transactions) {
    // First, extract valid trade transactions
    const validTransactions = [];
    for (const tx of transactions) {
      const parsed = this.parseTransactionDetails(tx);
      if (parsed) {
        validTransactions.push(parsed);
      }
    }

    console.log(`[SCHWAB] Found ${validTransactions.length} valid trade transactions`);

    // Sort by time (oldest first for FIFO matching)
    validTransactions.sort((a, b) => this._compareTransactionsForMatching(a, b));

    // Match opening and closing transactions using FIFO
    const trades = this.matchTransactions(validTransactions);

    console.log(`[SCHWAB] Matched into ${trades.length} complete trades`);

    return trades;
  }

  /**
   * Match opening and closing transactions into complete trades using FIFO
   * Works across days - open Monday, close Tuesday = one complete trade
   * Then groups multiple executions of the same symbol on the same day
   */
  matchTransactions(transactions) {
    const rawTrades = [];
    // Track open positions by account and instrument. A Schwab login can expose
    // multiple accounts that hold the same symbol, so symbol-only FIFO matching
    // can incorrectly consume an IRA lot for a taxable-account sale (or vice
    // versa).
    const openPositions = {};
    // Track round-trip IDs per account/instrument - increments each time that
    // specific account position goes flat and then re-opens.
    const roundTripCounters = {};
    const roundTripOpeningLots = new Map();

    // Sort all transactions by time
    const sorted = [...transactions].sort((a, b) => this._compareTransactionsForMatching(a, b));

    // Debug: Log position effects we're seeing
    const effectCounts = {};
    for (const tx of sorted) {
      const effect = tx.positionEffect || 'UNKNOWN';
      effectCounts[effect] = (effectCounts[effect] || 0) + 1;
    }
    console.log('[SCHWAB] Position effects found:', effectCounts);

    for (const tx of sorted) {
      const symbol = tx.symbol;
      const positionKey = this._getPositionKey(tx);

      // Handle transactions without positionEffect - try to infer from context
      let positionEffect = tx.positionEffect;
      if (!positionEffect) {
        // For TOS trades that might not have positionEffect, try to infer it
        // If we have open positions for this symbol, assume it's closing
        // Otherwise, assume it's opening
        console.log(`[SCHWAB] Transaction without positionEffect: ${symbol} qty=${tx.quantity} price=${tx.price} - attempting to infer`);

        if (openPositions[positionKey] && openPositions[positionKey].length > 0) {
          positionEffect = 'CLOSING';
          console.log(`[SCHWAB] Inferred as CLOSING (found open positions)`);
        } else {
          positionEffect = 'OPENING';
          console.log(`[SCHWAB] Inferred as OPENING (no open positions)`);
        }
      }

      if (positionEffect === 'OPENING') {
        // Add to open positions queue
        if (!openPositions[positionKey]) {
          openPositions[positionKey] = [];
        }
        // If position was flat (empty queue), this starts a new round-trip
        if (openPositions[positionKey].length === 0) {
          roundTripCounters[positionKey] = (roundTripCounters[positionKey] || 0) + 1;
        }
        const lot = {
          symbol,
          qty: tx.quantity,
          originalQty: tx.quantity,
          price: tx.price,
          time: tx.time,
          commission: tx.commission || 0,
          fees: tx.fees || 0,
          side: tx.side,
          instrumentType: tx.instrumentType,
          optionType: tx.optionType,
          strikePrice: tx.strikePrice,
          expirationDate: tx.expirationDate,
          underlyingSymbol: tx.underlyingSymbol,
          matchingSymbol: tx.matchingSymbol,
          cusip: tx.cusip,
          orderId: tx.orderId,
          accountIdentifier: tx.accountIdentifier,
          roundTripId: roundTripCounters[positionKey],
          positionKey
        };
        openPositions[positionKey].push(lot);

        const rtKey = `${positionKey}|${roundTripCounters[positionKey]}`;
        if (!roundTripOpeningLots.has(rtKey)) {
          roundTripOpeningLots.set(rtKey, []);
        }
        roundTripOpeningLots.get(rtKey).push({ ...lot });
      } else if (positionEffect === 'CLOSING') {
        // Match against open positions using FIFO
        if (!openPositions[positionKey] || openPositions[positionKey].length === 0) {
          // No matching open - position was opened before sync window
          // Use Schwab's netAmount for P&L
          rawTrades.push({
            symbol,
            side: tx.side,
            quantity: tx.quantity,
            entryPrice: null,
            exitPrice: tx.price,
            entryTime: null,
            exitTime: tx.time,
            tradeDate: tx.time.split('T')[0],
            commission: tx.commission || 0,
            fees: tx.fees || 0,
            pnl: tx.netAmount || null,
            broker: 'schwab',
            instrumentType: tx.instrumentType,
            optionType: tx.optionType,
            strikePrice: tx.strikePrice,
            expirationDate: tx.expirationDate,
            underlyingSymbol: tx.underlyingSymbol,
            matchingSymbol: tx.matchingSymbol,
            cusip: tx.cusip,
            accountIdentifier: tx.accountIdentifier,
            roundTripId: 0, // No matching open - unique round-trip
            positionKey,
            executionData: [{
              datetime: tx.time,
              price: tx.price,
              quantity: tx.quantity,
              side: tx.side,
              type: 'exit',
              orderId: tx.orderId
            }]
          });
          continue;
        }

        let remainingCloseQty = tx.quantity;

        while (remainingCloseQty > 0 && openPositions[positionKey] && openPositions[positionKey].length > 0) {
          const openPos = openPositions[positionKey][0];
          const matchQty = Math.min(remainingCloseQty, openPos.qty);

          // Prorate the entry-side costs for this slice and consume them from
          // the lot. Prorating against the remaining qty without decrementing
          // the costs over-counted entry commission on partial exits (a 50/50
          // split of a 100-share lot attributed 0.5 + 1.0 = 1.5x the actual).
          const entryCommission = openPos.qty > 0 ? (openPos.commission || 0) * matchQty / openPos.qty : 0;
          const entryFees = openPos.qty > 0 ? (openPos.fees || 0) * matchQty / openPos.qty : 0;

          // Create matched trade
          const pnl = this.calculatePnL(openPos.price, tx.price, matchQty, openPos.side, openPos.instrumentType);

          rawTrades.push({
            symbol,
            side: openPos.side,
            quantity: matchQty,
            entryPrice: openPos.price,
            exitPrice: tx.price,
            entryTime: openPos.time,
            exitTime: tx.time,
            tradeDate: tx.time.split('T')[0], // Use exit date as trade date
            commission: entryCommission + (tx.commission * matchQty / tx.quantity || 0),
            fees: entryFees + (tx.fees * matchQty / tx.quantity || 0),
            pnl,
            broker: 'schwab',
            instrumentType: openPos.instrumentType,
            optionType: openPos.optionType,
            strikePrice: openPos.strikePrice,
            expirationDate: openPos.expirationDate,
            underlyingSymbol: openPos.underlyingSymbol,
            matchingSymbol: openPos.matchingSymbol,
            cusip: openPos.cusip,
            accountIdentifier: openPos.accountIdentifier,
            roundTripId: openPos.roundTripId,
            positionKey,
            executionData: [
              {
                datetime: openPos.time,
                price: openPos.price,
                quantity: matchQty,
                side: openPos.side,
                type: 'entry',
                orderId: openPos.orderId
              },
              {
                datetime: tx.time,
                price: tx.price,
                quantity: matchQty,
                side: tx.side,
                type: 'exit',
                orderId: tx.orderId
              }
            ]
          });

          remainingCloseQty -= matchQty;
          openPos.qty -= matchQty;
          openPos.commission = Math.max(0, (openPos.commission || 0) - entryCommission);
          openPos.fees = Math.max(0, (openPos.fees || 0) - entryFees);

          if (openPos.qty <= 0) {
            openPositions[positionKey].shift();
          }
        }
      }
    }

    // Identify which round-trips are still open (have remaining open quantity > 0)
    const openRoundTripKeys = new Set();
    const openRoundTripRemainingLots = new Map();

    for (const [positionKey, positions] of Object.entries(openPositions)) {
      for (const pos of positions) {
        if (pos.qty > 0) {
          const rtKey = `${positionKey}|${pos.roundTripId}`;
          openRoundTripKeys.add(rtKey);
          if (!openRoundTripRemainingLots.has(rtKey)) {
            openRoundTripRemainingLots.set(rtKey, []);
          }
          openRoundTripRemainingLots.get(rtKey).push(pos);
        }
      }
    }

    const finalRawTrades = [];
    const partialExitsByRoundTrip = new Map();

    for (const trade of rawTrades) {
      const rtKey = `${trade.positionKey || trade.symbol}|${trade.roundTripId || 0}`;
      if (trade.roundTripId && openRoundTripKeys.has(rtKey)) {
        // This matched trade belongs to a round-trip that is STILL OPEN.
        // Do NOT emit it as a separate closed trade.
        // Collect it as a partial exit for this open round trip.
        if (!partialExitsByRoundTrip.has(rtKey)) {
          partialExitsByRoundTrip.set(rtKey, []);
        }
        partialExitsByRoundTrip.get(rtKey).push(trade);
      } else {
        // Round trip is fully closed or orphan closing
        finalRawTrades.push(trade);
      }
    }

    // Add remaining open positions as single open trades (consolidating entries & partial exits)
    for (const [rtKey, remainingLots] of openRoundTripRemainingLots.entries()) {
      const openingLots = roundTripOpeningLots.get(rtKey) || remainingLots;
      const partialExits = partialExitsByRoundTrip.get(rtKey) || [];

      const firstLot = openingLots[0] || remainingLots[0];
      const remainingQty = remainingLots.reduce((sum, lot) => sum + lot.qty, 0);

      // Aggregate opening executions and calculate weighted average entry price
      let totalEntryQty = 0;
      let totalEntryValue = 0;
      let totalCommission = 0;
      let totalFees = 0;
      let earliestEntryTime = null;

      const executionData = [];

      for (const lot of openingLots) {
        const qty = lot.originalQty || lot.qty;
        totalEntryQty += qty;
        totalEntryValue += lot.price * qty;
        totalCommission += lot.commission || 0;
        totalFees += lot.fees || 0;
        if (!earliestEntryTime || new Date(lot.time) < new Date(earliestEntryTime)) {
          earliestEntryTime = lot.time;
        }
        executionData.push({
          datetime: lot.time,
          price: lot.price,
          quantity: qty,
          side: lot.side,
          type: 'entry',
          orderId: lot.orderId
        });
      }

      const avgEntryPrice = totalEntryQty > 0 ? totalEntryValue / totalEntryQty : firstLot.price;

      // Aggregate partial exits: realized PnL, exit fees, and exit executions
      let totalRealizedPnl = 0;
      const hasPartialExit = partialExits.length > 0;
      const seenExitKeys = new Map();

      for (const exitTrade of partialExits) {
        if (exitTrade.pnl != null) {
          totalRealizedPnl += exitTrade.pnl;
        }
        totalFees += exitTrade.fees || 0;

        const exitExec = exitTrade.executionData?.find(e => e.type === 'exit');
        if (exitExec) {
          const key = `${exitExec.orderId}|${exitExec.datetime}|${exitExec.price}`;
          if (seenExitKeys.has(key)) {
            seenExitKeys.get(key).quantity += exitExec.quantity;
          } else {
            seenExitKeys.set(key, { ...exitExec });
          }
        }
      }

      for (const exitExec of seenExitKeys.values()) {
        executionData.push(exitExec);
      }

      const openTrade = {
        symbol: firstLot.symbol,
        side: firstLot.side,
        quantity: remainingQty,
        entryPrice: Math.round(avgEntryPrice * 10000) / 10000,
        exitPrice: null,
        entryTime: earliestEntryTime,
        exitTime: null,
        tradeDate: earliestEntryTime ? earliestEntryTime.split('T')[0] : firstLot.time.split('T')[0],
        commission: Math.round(totalCommission * 100) / 100,
        fees: Math.round(totalFees * 100) / 100,
        pnl: hasPartialExit ? Math.round(totalRealizedPnl * 100) / 100 : null,
        broker: 'schwab',
        instrumentType: firstLot.instrumentType,
        optionType: firstLot.optionType,
        strikePrice: firstLot.strikePrice,
        expirationDate: firstLot.expirationDate,
        underlyingSymbol: firstLot.underlyingSymbol,
        matchingSymbol: firstLot.matchingSymbol,
        cusip: firstLot.cusip,
        accountIdentifier: firstLot.accountIdentifier,
        roundTripId: firstLot.roundTripId,
        executionData
      };

      console.log(`[SCHWAB] Emitting single open trade for ${rtKey}: qty=${remainingQty}, entryPrice=${openTrade.entryPrice}, partial exits=${partialExits.length}, pnl=${openTrade.pnl}`);
      finalRawTrades.push(openTrade);
    }

    // Log raw trades before grouping
    console.log(`[SCHWAB] Raw matched trades: ${finalRawTrades.length}`);

    // Group trades by symbol and trade date (exit date for closed, entry date for open)
    const trades = this.groupTrades(finalRawTrades);

    // Log summary
    const closedTrades = trades.filter(t => t.exitPrice !== null).length;
    const openTrades = trades.filter(t => t.exitPrice === null).length;
    console.log(`[SCHWAB] After grouping: ${trades.length} trades (${closedTrades} closed, ${openTrades} open)`);

    return trades;
  }

  /**
   * Group multiple executions of the same symbol on the same day into single trades
   * Uses weighted average prices for entries and exits
   */
  groupTrades(rawTrades) {
    const groupedMap = new Map();

    for (const trade of rawTrades) {
      // Create group key:
      // For round trips (roundTripId > 0), group all executions of the round trip together.
      // Do NOT split by tradeDate so multi-day scale-outs remain a single trade.
      // For orphan closing trades without matching open (roundTripId === 0), group by date/time.
      const instrumentKey = trade.instrumentType === 'option'
        ? [
            trade.matchingSymbol || trade.symbol,
            trade.expirationDate || '',
            trade.optionType || '',
            trade.strikePrice ?? ''
          ].join('|')
        : (trade.matchingSymbol || trade.symbol);
      const key = (trade.roundTripId && trade.roundTripId > 0)
        ? `${instrumentKey}|${trade.side}|${trade.accountIdentifier || 'default'}|${trade.roundTripId}`
        : `${instrumentKey}|${trade.tradeDate}|${trade.side}|${trade.accountIdentifier || 'default'}|0|${trade.exitTime || trade.entryTime || ''}`;

      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          symbol: trade.symbol,
          side: trade.side,
          tradeDate: trade.tradeDate,
          broker: trade.broker,
          instrumentType: trade.instrumentType,
          optionType: trade.optionType,
          strikePrice: trade.strikePrice,
          expirationDate: trade.expirationDate,
          underlyingSymbol: trade.underlyingSymbol,
          cusip: trade.cusip,
          accountIdentifier: trade.accountIdentifier,
          roundTripId: trade.roundTripId,
          // Aggregation fields
          totalQuantity: 0,
          totalEntryValue: 0,
          totalExitValue: 0,
          entryQuantity: 0,
          exitQuantity: 0,
          totalCommission: 0,
          totalFees: 0,
          totalPnL: 0,
          hasEntry: false,
          hasExit: false,
          earliestEntryTime: null,
          latestExitTime: null,
          executionData: []
        });
      }

      const group = groupedMap.get(key);

      // Aggregate quantities and values
      group.totalQuantity += trade.quantity;
      group.totalCommission += trade.commission || 0;
      group.totalFees += trade.fees || 0;

      if (trade.entryPrice !== null) {
        group.totalEntryValue += trade.entryPrice * trade.quantity;
        group.entryQuantity += trade.quantity;
        group.hasEntry = true;
        if (!group.earliestEntryTime || new Date(trade.entryTime) < new Date(group.earliestEntryTime)) {
          group.earliestEntryTime = trade.entryTime;
        }
      }

      if (trade.exitPrice !== null) {
        group.totalExitValue += trade.exitPrice * trade.quantity;
        group.exitQuantity += trade.quantity;
        group.hasExit = true;
        if (!group.latestExitTime || new Date(trade.exitTime) > new Date(group.latestExitTime)) {
          group.latestExitTime = trade.exitTime;
        }
      }

      if (trade.pnl !== null) {
        group.totalPnL += trade.pnl;
      }

      // Merge execution data
      if (trade.executionData) {
        group.executionData.push(...trade.executionData);
      }
    }

    // Convert grouped data back to trade format
    const groupedTrades = [];
    for (const group of groupedMap.values()) {
      const entryPrice = group.hasEntry ? Math.round((group.totalEntryValue / group.entryQuantity) * 10000) / 10000 : null;
      const exitPrice = group.hasExit ? Math.round((group.totalExitValue / group.exitQuantity) * 10000) / 10000 : null;

      // Recalculate P&L if we have both entry and exit
      let pnl = group.totalPnL;
      if (group.hasEntry && group.hasExit && entryPrice && exitPrice) {
        pnl = this.calculatePnL(entryPrice, exitPrice, group.totalQuantity, group.side, group.instrumentType);
      }

      // Determine tradeDate: for closed trades, prefer latest exit date; otherwise earliest entry date
      let tradeDate = group.tradeDate;
      if (group.latestExitTime) {
        tradeDate = group.latestExitTime.split('T')[0];
      } else if (group.earliestEntryTime) {
        tradeDate = group.earliestEntryTime.split('T')[0];
      }

      // Deduplicate/consolidate execution entries that were split across matching slices
      const consolidatedExecutions = [];
      const execMap = new Map();
      for (const exec of group.executionData) {
        const execKey = `${exec.type}|${exec.orderId || ''}|${exec.datetime || ''}|${exec.price}`;
        if (execMap.has(execKey)) {
          const existing = execMap.get(execKey);
          existing.quantity += exec.quantity;
          if (exec.fees) existing.fees = (existing.fees || 0) + exec.fees;
          if (exec.commission) existing.commission = (existing.commission || 0) + exec.commission;
          if (exec.realized_pnl != null) existing.realized_pnl = (existing.realized_pnl || 0) + exec.realized_pnl;
          if (exec.gross_realized_pnl != null) existing.gross_realized_pnl = (existing.gross_realized_pnl || 0) + exec.gross_realized_pnl;
        } else {
          const cloned = { ...exec };
          execMap.set(execKey, cloned);
          consolidatedExecutions.push(cloned);
        }
      }

      groupedTrades.push({
        symbol: group.symbol,
        side: group.side,
        quantity: group.totalQuantity,
        entryPrice,
        exitPrice,
        entryTime: group.earliestEntryTime,
        exitTime: group.latestExitTime,
        tradeDate,
        commission: Math.round(group.totalCommission * 100) / 100,
        fees: Math.round(group.totalFees * 100) / 100,
        pnl: pnl !== null ? Math.round(pnl * 100) / 100 : null,
        broker: group.broker,
        instrumentType: group.instrumentType,
        optionType: group.optionType,
        strikePrice: group.strikePrice,
        expirationDate: group.expirationDate,
        underlyingSymbol: group.underlyingSymbol,
        cusip: group.cusip,
        accountIdentifier: group.accountIdentifier,
        roundTripId: group.roundTripId,
        executionData: consolidatedExecutions
      });
    }

    return groupedTrades;
  }

  /**
   * Create a partial trade when we only have one side
   */
  createPartialTrade(tx, side) {
    if (side === 'close') {
      return {
        symbol: tx.symbol,
        side: tx.side,
        quantity: tx.quantity,
        entryPrice: null,
        exitPrice: tx.price,
        entryTime: null,
        exitTime: tx.time,
        tradeDate: tx.time.split('T')[0],
        commission: tx.commission || 0,
        fees: tx.fees || 0,
        pnl: tx.netAmount, // Use Schwab's reported P&L
        broker: 'schwab',
        instrumentType: tx.instrumentType,
        optionType: tx.optionType,
        strikePrice: tx.strikePrice,
        expirationDate: tx.expirationDate,
        underlyingSymbol: tx.underlyingSymbol,
        cusip: tx.cusip
      };
    }
    return null;
  }

  /**
   * Calculate P&L for a matched trade
   */
  calculatePnL(entryPrice, exitPrice, quantity, side, instrumentType) {
    if (!entryPrice || !exitPrice) return null;

    const multiplier = instrumentType === 'option' ? 100 : 1;
    const diff = exitPrice - entryPrice;
    const pnl = side === 'long' ? diff * quantity * multiplier : -diff * quantity * multiplier;

    return Math.round(pnl * 100) / 100;
  }

  /**
   * Parse a single Schwab transaction into structured data
   * @param {object} tx - Raw transaction from Schwab API
   * @returns {object|null} - Parsed transaction details or null if not valid
   */
  parseTransactionDetails(tx) {
    // Only process TRADE type transactions
    if (tx.type !== 'TRADE') {
      // Log non-TRADE transactions to help debug TOS issues
      if (tx.type && tx.transferItems?.[0]?.instrument?.symbol) {
        console.log(`[SCHWAB] Skipping non-TRADE transaction: type=${tx.type}, symbol=${tx.transferItems[0].instrument.symbol}`);
      }
      return null;
    }

    // Get the transfer items (contains instrument and trade details)
    const transferItems = tx.transferItems || [];
    if (transferItems.length === 0) {
      return null;
    }

    // Find the actual security transfer item (not fees/commissions)
    const item = transferItems.find(ti =>
      ti.instrument &&
      ti.instrument.assetType &&
      !ti.feeType
    );

    if (!item) {
      return null;
    }

    const instrument = item.instrument || {};
    const assetType = instrument.assetType?.toUpperCase();

    // Only accept real tradeable securities
    // Added FUTURE to support Think Or Swim futures trades
    const validAssetTypes = ['EQUITY', 'OPTION', 'MUTUAL_FUND', 'ETF', 'INDEX', 'FUTURE', 'COLLECTIVE_INVESTMENT'];
    if (!validAssetTypes.includes(assetType)) {
      // Log what we're skipping to help debug TOS import issues
      console.log(`[SCHWAB] Skipping asset type: ${assetType} for symbol: ${instrument.symbol}`);
      // Skip currencies, cash equivalents, fees, etc.
      return null;
    }

    const rawSymbol = instrument.symbol;
    if (!rawSymbol) {
      return null;
    }
    const matchingSymbol = String(rawSymbol).toUpperCase().replace(/\s+/g, ' ').trim();

    // Skip currency symbols (but allow futures symbols like /ES, /NQ that TOS uses)
    if (matchingSymbol.startsWith('CURRENCY_') || matchingSymbol === 'USD' || matchingSymbol === 'CASH') {
      return null;
    }

    // Log TOS futures symbols for debugging (they typically start with /)
    if (matchingSymbol.startsWith('/')) {
      console.log(`[SCHWAB] Processing TOS futures symbol: ${matchingSymbol}`);
    }

    // Get price and quantity
    const price = parseFloat(item.price) || 0;
    const amount = parseFloat(item.amount) || 0;

    // Skip if no price or quantity (not a real trade)
    if (price === 0 || amount === 0) {
      return null;
    }

    // Determine side from positionEffect and amount
    let side;
    const positionEffect = item.positionEffect;

    // OPENING with positive amount = buy/long entry
    // OPENING with negative amount = short entry
    // CLOSING with positive amount = buy to cover (closing short)
    // CLOSING with negative amount = sell (closing long)
    if (positionEffect === 'OPENING') {
      side = amount > 0 ? 'long' : 'short';
    } else if (positionEffect === 'CLOSING') {
      side = amount > 0 ? 'long' : 'short';
    } else {
      // Default based on amount sign
      side = amount > 0 ? 'long' : 'short';
    }

    // Determine instrument type
    let instrumentType = 'stock';
    let optionType = null;
    let strikePrice = null;
    let expirationDate = null;
    let underlyingSymbol = null;
    let symbol = matchingSymbol;

    if (assetType === 'OPTION') {
      instrumentType = 'option';
      const parsedOption = this._parseSchwabOptionSymbol(matchingSymbol);
      // Parse option details from instrument if available
      optionType = instrument.putCall?.toLowerCase() || parsedOption?.optionType || null;
      strikePrice = instrument.strikePrice ?? parsedOption?.strikePrice ?? null;
      expirationDate = instrument.expirationDate || parsedOption?.expirationDate || null;
      // Normalize: the open-position grouping key is built from the
      // underlying symbol, and the Schwab API's casing is not guaranteed.
      const rawUnderlying = instrument.underlyingSymbol || parsedOption?.underlyingSymbol || null;
      underlyingSymbol = rawUnderlying ? String(rawUnderlying).trim().toUpperCase() : null;
      symbol = underlyingSymbol || matchingSymbol;
    } else if (assetType === 'FUTURE') {
      instrumentType = 'future';
    }

    const quantity = Math.abs(amount);

    // Extract commission from transferItems with feeType = COMMISSION
    let commission = 0;
    let fees = 0;
    for (const ti of transferItems) {
      if (ti.feeType === 'COMMISSION') {
        commission += Math.abs(parseFloat(ti.cost) || 0);
      } else if (ti.feeType) {
        fees += Math.abs(parseFloat(ti.cost) || 0);
      }
    }

    const time = this._getTransactionTime(tx);

    // Net amount from transaction (includes P&L for closing trades)
    const netAmount = tx.netAmount;

    // Return transaction details for matching
    return {
      symbol,
      side,
      quantity,
      price,
      time,
      matchingSymbol,
      positionEffect, // OPENING or CLOSING
      commission,
      fees,
      netAmount,
      instrumentType,
      optionType,
      strikePrice,
      expirationDate,
      underlyingSymbol: instrumentType === 'option' ? underlyingSymbol : null,
      cusip: instrument.cusip,
      orderId: tx.orderId?.toString() || tx.activityId?.toString(),
      accountIdentifier: tx._accountIdentifier // Redacted account identifier (e.g., "****1234")
    };
  }

  /**
   * Sync trades from Schwab
   * @param {object} connection - BrokerConnection with credentials
   * @param {object} options - Sync options
   */
  async syncTrades(connection, options = {}) {
    const { startDate, endDate, syncLogId } = options;

    console.log(`[SCHWAB] Starting sync for connection ${connection.id}`);

    // Resolve starting date floor from connection.syncStartDate
    const connectionStartFloor = connection.syncStartDate
      ? this._extractDateString(connection.syncStartDate)
      : null;

    // Use connection's syncStartDate as a hard floor:
    // If startDate is passed, but earlier than connectionStartFloor, clamp to connectionStartFloor.
    // If startDate is not passed, use connectionStartFloor.
    let effectiveStartDate = startDate || connectionStartFloor;
    if (startDate && connectionStartFloor && startDate < connectionStartFloor) {
      effectiveStartDate = connectionStartFloor;
    }

    if (effectiveStartDate) {
      console.log(`[SCHWAB] Sync starting date floor enforced: ${effectiveStartDate}`);
    }

    // Ensure we have a valid token
    const { accessToken, needsReauth } = await this.ensureValidToken(connection);

    if (needsReauth) {
      throw new Error('Schwab authentication expired. Please re-connect your account.');
    }

    // Update sync log status
    if (syncLogId) {
      await BrokerConnection.updateSyncLog(syncLogId, 'fetching');
    }

    // Get ALL accounts - sync everything the user has access to
    const accounts = await this.getAccountNumbers(accessToken);
    if (!accounts || accounts.length === 0) {
      throw new Error('No Schwab accounts found');
    }

    const schwabAccounts = [...new Set(
      accounts.map(account => this.redactAccountNumber(account.accountNumber)).filter(Boolean)
    )].map(accountIdentifier => ({ account_identifier: accountIdentifier }));
    await BrokerConnection.updateBrokerMetadata(connection.id, {
      schwab_accounts: schwabAccounts
    });

    const excludedAccountIdentifiers = new Set(
      Array.isArray(connection.excluded_account_identifiers)
        ? connection.excluded_account_identifiers
        : []
    );
    const includedAccounts = accounts.filter(account =>
      !excludedAccountIdentifiers.has(this.redactAccountNumber(account.accountNumber))
    );

    console.log(`[SCHWAB] Found ${accounts.length} accounts; syncing ${includedAccounts.length} and excluding ${accounts.length - includedAccounts.length}`);

    // Fetch transactions only from included accounts, tagging each with the account identifier
    let allTransactions = [];
    for (const account of includedAccounts) {
      const redactedAccount = this.redactAccountNumber(account.accountNumber);
      console.log(`[SCHWAB] Fetching transactions for account ${redactedAccount}...`);
      try {
        const transactions = await this.getTransactions(
          accessToken,
          account.hashValue,
          effectiveStartDate || undefined,
          endDate
        );
        // Tag each transaction with the redacted account identifier
        const taggedTransactions = transactions.map(tx => ({
          ...tx,
          _accountIdentifier: redactedAccount
        }));
        console.log(`[SCHWAB] Account ${redactedAccount}: ${transactions.length} transactions`);
        allTransactions = allTransactions.concat(taggedTransactions);
      } catch (error) {
        console.error(`[SCHWAB] Failed to fetch account ${redactedAccount}:`, error.message);
        // Continue with other accounts
      }
    }

    console.log(`[SCHWAB] Total transactions fetched: ${allTransactions.length}`);

    // Update sync log status
    if (syncLogId) {
      await BrokerConnection.updateSyncLog(syncLogId, 'parsing', {
        tradesFetched: allTransactions.length
      });
    }

    // Parse transactions to trades
    let trades = this.parseTransactions(allTransactions);
    console.log(`[SCHWAB] Parsed ${trades.length} trades from ${allTransactions.length} transactions`);

    // Enforce starting date: ignore any trades occurring before effectiveStartDate
    if (effectiveStartDate) {
      const originalCount = trades.length;
      trades = trades.filter(trade => {
        const tradeDateStr = this._extractDateString(trade.tradeDate || trade.entryTime || trade.exitTime);
        if (!tradeDateStr) return true;
        return tradeDateStr >= effectiveStartDate;
      });
      const ignoredCount = originalCount - trades.length;
      if (ignoredCount > 0) {
        console.log(`[SCHWAB] Ignored ${ignoredCount} trades occurring before starting date ${effectiveStartDate}`);
      }
    }

    // Log trade breakdown for debugging TOS issues
    const tradeBreakdown = {
      stocks: trades.filter(t => t.instrumentType === 'stock').length,
      options: trades.filter(t => t.instrumentType === 'option').length,
      futures: trades.filter(t => t.instrumentType === 'future').length,
      tosSymbols: trades.filter(t => t.symbol?.startsWith('/')).length,
      openTrades: trades.filter(t => !t.exitPrice).length,
      closedTrades: trades.filter(t => t.exitPrice).length
    };
    console.log(`[SCHWAB] Trade breakdown:`, tradeBreakdown);

    // Update sync log status
    if (syncLogId) {
      await BrokerConnection.updateSyncLog(syncLogId, 'importing');
    }

    // Import trades with connection ID for tracking
    const result = effectiveStartDate
      ? await this.importTrades(connection.userId, connection.id, trades, { startDate: effectiveStartDate })
      : await this.importTrades(connection.userId, connection.id, trades);

    console.log(`[SCHWAB] Sync complete: ${result.imported} imported, ${result.duplicates} duplicates`);

    return result;
  }

  /**
   * Import parsed trades into the database
   * @param {string} userId - User ID
   * @param {string} connectionId - Broker connection ID for tracking synced trades
   * @param {Array} trades - Parsed trades
   * @param {object} [options] - Additional import options (e.g. startDate floor)
   */
  async importTrades(userId, connectionId, trades, options = {}) {
    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let duplicates = 0;

    const startDateFloor = options.startDate ? this._extractDateString(options.startDate) : null;
    let filteredTrades = trades;
    if (startDateFloor) {
      filteredTrades = trades.filter(t => {
        const dateStr = this._extractDateString(t.tradeDate || t.entryTime || t.exitTime);
        return !dateStr || dateStr >= startDateFloor;
      });
      skipped += (trades.length - filteredTrades.length);
    }

    const existingTrades = await this.getExistingTrades(userId, filteredTrades);

    for (const tradeData of filteredTrades) {
      try {
        // Check for duplicates or trade updates
        const isDuplicate = this.isDuplicateTrade(tradeData, existingTrades);

        if (isDuplicate) {
          duplicates++;
          continue;
        }

        if (tradeData.isUpdate && tradeData.existingTradeId) {
          console.log(`[SCHWAB] Updating existing trade ${tradeData.existingTradeId} with additional executions for ${tradeData.symbol}`);

          const userTimezone = await getUserTimezone(userId);
          const engineResult = computeTradePnl({
            side: tradeData.side,
            instrumentType: tradeData.instrumentType || 'stock',
            contractSize: tradeData.contractSize || (tradeData.instrumentType === 'option' ? 100 : null),
            pointValue: tradeData.pointValue || null,
            fallbackCommission: tradeData.commission != null ? tradeData.commission : null,
            fallbackFees: tradeData.fees != null ? tradeData.fees : null,
            executions: tradeData.executionData || [],
            timezone: userTimezone,
            tradeId: tradeData.existingTradeId
          });

          const agg = engineResult.aggregate;
          const annotatedExecs = engineResult.annotatedExecutions;

          const updateQuery = `
            UPDATE trades
            SET executions = $1::jsonb,
                entry_price = $2,
                exit_price = $3,
                entry_time = $4,
                exit_time = $5,
                trade_date = $6,
                pnl = $7,
                pnl_percent = $8,
                quantity = $9,
                commission = $10,
                fees = $11,
                updated_at = NOW()
            WHERE id = $12 AND user_id = $13
          `;

          await db.query(updateQuery, [
            JSON.stringify(annotatedExecs),
            agg.entry_price != null ? Math.round(agg.entry_price * 1000000) / 1000000 : tradeData.entryPrice,
            agg.is_fully_closed && agg.exit_price != null ? Math.round(agg.exit_price * 1000000) / 1000000 : null,
            agg.entry_time || tradeData.entryTime,
            agg.is_fully_closed ? agg.exit_time : null,
            agg.trade_date || tradeData.tradeDate,
            agg.pnl != null ? Math.round(agg.pnl * 1000000) / 1000000 : null,
            agg.pnl_percent != null ? Math.round(agg.pnl_percent * 1000000) / 1000000 : null,
            Math.round(agg.quantity * 1000000) / 1000000,
            Math.round(agg.commission * 1000000) / 1000000,
            Math.round(agg.fees * 1000000) / 1000000,
            tradeData.existingTradeId,
            userId
          ]);

          // Clean up any legacy split closed trades that shared an entry order ID with this trade
          if (tradeData.executionData?.some(e => e.type === 'entry' && e.orderId)) {
            const entryOrderIds = tradeData.executionData
              .filter(e => e.type === 'entry' && e.orderId)
              .map(e => String(e.orderId));
            
            for (const existing of existingTrades) {
              if (existing.id !== tradeData.existingTradeId && existing.exit_time != null) {
                let exExecs = existing.executions;
                if (typeof exExecs === 'string') {
                  try { exExecs = JSON.parse(exExecs); } catch { exExecs = []; }
                }
                const hasMatchingEntry = exExecs?.some(e => e.type === 'entry' && e.orderId && entryOrderIds.includes(String(e.orderId)));
                if (hasMatchingEntry) {
                  console.log(`[SCHWAB] Removing legacy split closed trade ${existing.id} for ${tradeData.symbol} (merged into ${tradeData.existingTradeId})`);
                  await db.query(`DELETE FROM trades WHERE id = $1 AND user_id = $2`, [existing.id, userId]);
                }
              }
            }
          }

          imported++;
          continue;
        }

        // Add broker connection ID to track synced trades
        tradeData.brokerConnectionId = connectionId;

        // Create trade
        await Trade.create(userId, tradeData, {
          skipAchievements: true,
          skipApiCalls: true,
          skipOptionGrouping: true
        });

        imported++;

        // Add the newly imported trade to existingTrades to prevent duplicates within same batch
        existingTrades.push({
          symbol: tradeData.symbol,
          side: tradeData.side,
          quantity: tradeData.quantity,
          entry_price: tradeData.entryPrice,
          exit_price: tradeData.exitPrice,
          entry_time: tradeData.entryTime,
          exit_time: tradeData.exitTime,
          trade_date: tradeData.tradeDate,
          pnl: tradeData.pnl,
          executions: tradeData.executionData,
          instrument_type: tradeData.instrumentType || 'stock',
          strike_price: tradeData.strikePrice || null,
          expiration_date: tradeData.expirationDate || null,
          option_type: tradeData.optionType || null,
          underlying_symbol: tradeData.underlyingSymbol || null,
          account_identifier: tradeData.accountIdentifier || null
        });
      } catch (error) {
        console.error(`[SCHWAB] Failed to import trade:`, error.message);
        console.error(`[SCHWAB] Trade details:`, {
          symbol: tradeData.symbol,
          quantity: tradeData.quantity,
          entryPrice: tradeData.entryPrice,
          exitPrice: tradeData.exitPrice,
          tradeDate: tradeData.tradeDate
        });
        failed++;
      }
    }

    await OptionStrategyGroupingService.rebuildUserGroupsSafe(userId, 'Schwab broker sync');
    console.log(`[SCHWAB] Invalidating analytics cache for user ${userId}`);
    await AnalyticsCache.invalidate(userId);

    // Per-row creates skip achievements; run one end-of-batch check instead
    if (imported > 0) {
      const AchievementService = require('../achievementService');
      AchievementService.checkAndAwardAchievements(userId).catch(error => {
        console.warn(`[SCHWAB] Failed to check achievements after sync for user ${userId}:`, error.message);
      });
    }

    return { imported, skipped, failed, duplicates };
  }

  /**
   * Get existing trades for duplicate checking
   * Fetches ALL user trades (not just Schwab) to catch CSV imports too
   */
  async getExistingTrades(userId, incomingTrades = []) {
    if (!Array.isArray(incomingTrades) || incomingTrades.length === 0) {
      return [];
    }

    const { minDate, maxDate } = this.getTradeDateRange(incomingTrades);
    const params = [userId];

    let query = `
      SELECT id, symbol, side, quantity, entry_price, exit_price, entry_time, exit_time,
             executions, trade_date, pnl, instrument_type, strike_price,
             expiration_date, option_type, underlying_symbol, account_identifier
      FROM trades
      WHERE user_id = $1
    `;

    if (minDate && maxDate) {
      params.push(minDate, maxDate);
      query += `
        AND trade_date >= $2
        AND trade_date <= $3
      `;
    }

    query += `
      ORDER BY trade_date DESC, entry_time DESC
    `;

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Check if trade is a duplicate
   * Matches against both broker-synced and CSV-imported trades
   */
  isDuplicateTrade(newTrade, existingTrades) {
    // Guard against invalid input
    if (!newTrade || !existingTrades || !Array.isArray(existingTrades)) {
      return false;
    }

    const symbol = newTrade.symbol?.toUpperCase();
    if (!symbol) return false;

    const newTradeDate = newTrade.tradeDate;
    const newQty = parseFloat(newTrade.quantity) || 0;
    const newEntryPrice = parseFloat(newTrade.entryPrice) || 0;
    const newExitPrice = parseFloat(newTrade.exitPrice) || 0;
    const newPnL = parseFloat(newTrade.pnl) || 0;
    const newInstrumentType = newTrade.instrumentType || 'stock';
    const newAccountIdentifier = newTrade.accountIdentifier || null;

    for (const existing of existingTrades) {
      if (!this._tradeSymbolsMatch(newTrade, existing)) continue;

      if (newAccountIdentifier && existing.account_identifier && newAccountIdentifier !== existing.account_identifier) {
        continue;
      }

      const existingInstrumentType = existing.instrument_type || 'stock';
      if (existingInstrumentType !== newInstrumentType) {
        continue;
      }

      if (newInstrumentType === 'option') {
        const optionTypeMatches = !newTrade.optionType || !existing.option_type || newTrade.optionType === existing.option_type;
        const strikeMatches = newTrade.strikePrice == null || existing.strike_price == null ||
          Math.abs(parseFloat(newTrade.strikePrice) - parseFloat(existing.strike_price)) < 0.0001;
        const expirationMatches = !newTrade.expirationDate || !existing.expiration_date ||
          this._extractDateString(newTrade.expirationDate) === this._extractDateString(existing.expiration_date);

        if (!optionTypeMatches || !strikeMatches || !expirationMatches) {
          continue;
        }
      }

      // 1. Check execution data match (by EXIT order ID + datetime) - most reliable
      // IMPORTANT: Only match on EXIT executions, not entry executions.
      // For partial exits (buy 15, sell 5, sell 10 later), all partial trades share
      // the same entry order ID but have different exit order IDs.
      // Matching on ANY execution would incorrectly flag partial exits as duplicates.
      if (newTrade.executionData?.length > 0 && existing.executions) {
        let existingExecs = existing.executions;
        if (typeof existingExecs === 'string') {
          try {
            existingExecs = JSON.parse(existingExecs);
          } catch {
            existingExecs = [];
          }
        }

        // Build a set of EXIT "orderId|datetime" combinations for the new trade
        // Only use exit executions since entry orders are shared across partial exits
        const newExitExecKeys = new Set(
          newTrade.executionData
            .filter(e => e.orderId && e.type === 'exit')
            .map(e => `${e.orderId}|${e.datetime}`)
        );

        // Check if any existing EXIT execution matches both orderId AND datetime
        const hasExitMatch = existingExecs.some(exec =>
          exec.orderId && exec.datetime && exec.type === 'exit' && newExitExecKeys.has(`${exec.orderId}|${exec.datetime}`)
        );

        // Check if existing trade matches the entry executions of the new trade
        const newEntryExecs = newTrade.executionData.filter(e => e.type === 'entry');
        const existingEntryExecs = existingExecs.filter(e => e.type === 'entry');

        const hasEntryMatch = newEntryExecs.some(newEntry =>
          existingEntryExecs.some(exEntry =>
            (newEntry.orderId && exEntry.orderId && String(newEntry.orderId) === String(exEntry.orderId)) ||
            (newEntry.datetime && exEntry.datetime && Math.abs(new Date(newEntry.datetime) - new Date(exEntry.datetime)) < 1000)
          )
        );

        if (hasEntryMatch) {
          const newExitExecs = newTrade.executionData.filter(e => e.type === 'exit');
          const existingExitExecs = existingExecs.filter(e => e.type === 'exit');

          if (
            newTrade.executionData.length > existingExecs.length ||
            newExitExecs.length > existingExitExecs.length ||
            (newTrade.exitPrice != null && !existing.exit_price)
          ) {
            console.log(`[SCHWAB] Trade ${symbol} has new/updated executions vs existing trade ${existing.id} - marked for UPDATE`);
            newTrade.isUpdate = true;
            newTrade.existingTradeId = existing.id;
            return false;
          } else if (newTrade.executionData.length === existingExecs.length && Math.abs((parseFloat(existing.quantity) || 0) - newQty) < 0.001) {
            console.log(`[SCHWAB] Duplicate found by matching entry + execution count: ${symbol}`);
            return true;
          }
        }

        if (hasExitMatch) {
          console.log(`[SCHWAB] Duplicate found by exit order ID + datetime: ${symbol}`);
          return true;
        }
      }

      // 2. Match by date + quantity + prices (for CSV imports)
      const existingDate = this._extractDateString(existing.trade_date);

      if (existingDate === newTradeDate) {
        const existingQty = parseFloat(existing.quantity);
        const existingEntryPrice = parseFloat(existing.entry_price);
        const existingExitPrice = parseFloat(existing.exit_price);

        // Quantity must match exactly
        if (Math.abs(existingQty - newQty) < 0.001) {
          // Entry price within 1%
          const entryPriceMatch = !newEntryPrice || !existingEntryPrice ||
            Math.abs(existingEntryPrice - newEntryPrice) / existingEntryPrice < 0.01;

          // Exit price within 1% (if both have exit)
          const exitPriceMatch = !newExitPrice || !existingExitPrice ||
            Math.abs(existingExitPrice - newExitPrice) / existingExitPrice < 0.01;

          if (entryPriceMatch && exitPriceMatch) {
            console.log(`[SCHWAB] Duplicate found by date/qty/price: ${symbol} on ${newTradeDate}`);
            return true;
          }
        }
      }

      // 3. Match by P&L if available (strong indicator for closed trades)
      if (newPnL && existing.pnl) {
        const existingDateForPnL = this._extractDateString(existing.trade_date);
        const existingPnL = parseFloat(existing.pnl);

        // Same date, same symbol, same P&L (within $0.01)
        if (existingDateForPnL === newTradeDate && Math.abs(existingPnL - newPnL) < 0.02) {
          console.log(`[SCHWAB] Duplicate found by P&L: ${symbol} on ${newTradeDate} ($${newPnL})`);
          return true;
        }
      }
    }

    return false;
  }

  _tradeSymbolsMatch(newTrade, existingTrade) {
    const newSymbol = newTrade.symbol?.toUpperCase();
    const existingSymbol = existingTrade.symbol?.toUpperCase();

    if (!newSymbol || !existingSymbol) return false;
    if (existingSymbol === newSymbol) return true;

    const newInstrumentType = newTrade.instrumentType || newTrade.instrument_type || 'stock';
    const existingInstrumentType = existingTrade.instrument_type || existingTrade.instrumentType || 'stock';
    if (newInstrumentType !== 'option' || existingInstrumentType !== 'option') {
      return false;
    }

    const parsedExisting = this._parseSchwabOptionSymbol(existingSymbol);
    const parsedNew = this._parseSchwabOptionSymbol(newTrade.matchingSymbol || newTrade.symbol);
    const existingUnderlying = existingTrade.underlying_symbol || existingTrade.underlyingSymbol || parsedExisting?.underlyingSymbol || existingSymbol;
    const newUnderlying = newTrade.underlyingSymbol || newTrade.underlying_symbol || parsedNew?.underlyingSymbol || newSymbol;

    return existingUnderlying?.toUpperCase() === newUnderlying?.toUpperCase();
  }

  getTradeDateRange(trades) {
    const dateStrings = trades
      .map(trade => this._extractDateString(trade.tradeDate || trade.exitTime || trade.entryTime))
      .filter(Boolean)
      .sort();

    if (dateStrings.length === 0) {
      return { minDate: null, maxDate: null };
    }

    return {
      minDate: dateStrings[0],
      maxDate: dateStrings[dateStrings.length - 1]
    };
  }

  /**
   * Validate Schwab OAuth setup
   */
  validateConfig() {
    const required = ['SCHWAB_CLIENT_ID', 'SCHWAB_CLIENT_SECRET', 'SCHWAB_REDIRECT_URI'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      return {
        valid: false,
        message: `Missing Schwab configuration: ${missing.join(', ')}`
      };
    }

    return { valid: true };
  }
}

module.exports = new SchwabService();
