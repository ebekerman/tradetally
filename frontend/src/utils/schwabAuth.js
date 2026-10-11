/**
 * Schwab OAuth Helper Utilities
 * Helper to extract authorization code and state from redirect URL or manual input
 */

export function extractSchwabOAuthParams(input) {
  if (!input || typeof input !== 'string') {
    return { code: null, state: null, error: null, errorDescription: null }
  }
  const trimmed = input.trim()
  if (!trimmed) {
    return { code: null, state: null, error: null, errorDescription: null }
  }

  let parsedCode = null
  let parsedState = null
  let parsedError = null
  let parsedErrorDescription = null

  // 1. Try URL parsing
  try {
    const urlStr = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : (trimmed.includes('?') || trimmed.includes('/'))
        ? `https://dummy.local/${trimmed.replace(/^\/+/, '')}`
        : null

    if (urlStr) {
      const parsed = new URL(urlStr)
      parsedCode = parsed.searchParams.get('code')
      parsedState = parsed.searchParams.get('state')
      parsedError = parsed.searchParams.get('error')
      parsedErrorDescription = parsed.searchParams.get('error_description')
    }
  } catch (_) {}

  // 2. Try URLSearchParams on query part
  if (!parsedCode && !parsedError) {
    const queryIdx = trimmed.indexOf('?')
    const queryPart = queryIdx !== -1 ? trimmed.slice(queryIdx + 1) : trimmed
    try {
      const searchParams = new URLSearchParams(queryPart)
      if (searchParams.has('code')) parsedCode = searchParams.get('code')
      if (searchParams.has('state')) parsedState = searchParams.get('state')
      if (searchParams.has('error')) parsedError = searchParams.get('error')
      if (searchParams.has('error_description')) parsedErrorDescription = searchParams.get('error_description')
    } catch (_) {}
  }

  // 3. Fallback regex search for code, state, or error
  if (!parsedCode && !parsedError) {
    const codeMatch = trimmed.match(/[?&]code=([^&#]+)/)
    if (codeMatch) {
      try { parsedCode = decodeURIComponent(codeMatch[1]) } catch (_) { parsedCode = codeMatch[1] }
    }
    const stateMatch = trimmed.match(/[?&]state=([^&#]+)/)
    if (stateMatch) {
      try { parsedState = decodeURIComponent(stateMatch[1]) } catch (_) { parsedState = stateMatch[1] }
    }
    const errorMatch = trimmed.match(/[?&]error=([^&#]+)/)
    if (errorMatch) {
      try { parsedError = decodeURIComponent(errorMatch[1]) } catch (_) { parsedError = errorMatch[1] }
    }
  }

  // 4. Raw candidate Schwab code (must start with C0. or C1.)
  if (!parsedCode && !parsedError) {
    if ((trimmed.startsWith('C0.') || trimmed.startsWith('C1.')) && !trimmed.includes('&') && !trimmed.includes('=')) {
      try { parsedCode = decodeURIComponent(trimmed) } catch (_) { parsedCode = trimmed }
    }
  }

  // 5. Ensure any percent-encoded characters like %40 are decoded to @
  if (parsedCode && parsedCode.includes('%40')) {
    try {
      parsedCode = decodeURIComponent(parsedCode)
    } catch (_) {
      parsedCode = parsedCode.replace(/%40/g, '@')
    }
  }

  return {
    code: parsedCode,
    state: parsedState,
    error: parsedError,
    errorDescription: parsedErrorDescription
  }
}
