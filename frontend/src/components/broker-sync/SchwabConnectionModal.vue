<template>
  <div class="fixed inset-0 z-50 overflow-y-auto">
    <div class="flex min-h-full items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="fixed inset-0 bg-black/60 transition-opacity" @click="emit('close')"></div>

      <!-- Modal Card -->
      <div class="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700">
        <!-- Header -->
        <div class="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center space-x-3">
            <div class="w-9 h-9 bg-primary-100 dark:bg-primary-950/60 border border-primary-200 dark:border-primary-800 rounded-lg flex items-center justify-center shadow-sm">
              <span class="text-primary-700 dark:text-primary-300 font-bold text-sm">CS</span>
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ props.isUpdate ? 'Update Schwab Tokens' : 'Connect Charles Schwab' }}
            </h3>
          </div>
          <button
            type="button"
            @click="emit('close')"
            class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Mode Selector Tabs (Available in both connect and update modes) -->
        <div class="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/60 px-6 pt-3">
          <button
            type="button"
            class="pb-3 px-3 text-sm font-medium border-b-2 transition-colors flex items-center space-x-2"
            :class="activeTab === 'oauth'
              ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400 font-semibold'
              : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'"
            @click="activeTab = 'oauth'"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            <span>Browser Login (OAuth)</span>
          </button>
          <button
            type="button"
            class="pb-3 px-3 text-sm font-medium border-b-2 transition-colors flex items-center space-x-2 ml-4"
            :class="activeTab === 'file'
              ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400 font-semibold'
              : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'"
            @click="activeTab = 'file'"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Import Token File (JSON)</span>
          </button>
        </div>

        <!-- Body -->
        <div class="p-6">
          <!-- Error Alert -->
          <div v-if="localError || props.error" class="mb-6 p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg">
            <div class="flex">
              <svg class="h-5 w-5 text-red-500 dark:text-red-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
              </svg>
              <p class="ml-3 text-sm text-red-800 dark:text-red-200">{{ localError || props.error }}</p>
            </div>
          </div>

          <!-- TAB 1: File / JSON Import -->
          <div v-if="activeTab === 'file'" class="space-y-4">
            <!-- Setup Instructions Banner -->
            <div class="p-4 bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/30 dark:border-amber-500/35 rounded-lg text-xs space-y-1.5">
              <h4 class="text-sm font-semibold text-amber-900 dark:text-amber-200 flex items-center space-x-2">
                <svg class="w-4 h-4 text-amber-600 dark:text-amber-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Token Import Instructions</span>
              </h4>
              <p class="text-amber-800 dark:text-amber-100 leading-relaxed">
                Import your Schwab OAuth credentials directly without browser redirection. TradeTally encrypts tokens at rest with AES-256-GCM.
              </p>
              <ul class="text-amber-800 dark:text-amber-100 space-y-1 list-disc list-inside">
                <li>Compatible with <strong>schwab-py</strong> <code class="bg-amber-200/50 dark:bg-amber-900/40 px-1 py-0.5 rounded font-mono">token.json</code> files.</li>
                <li>Compatible with raw Schwab Developer API OAuth token responses.</li>
                <li>If the access token is expired, TradeTally will automatically refresh it using your refresh token.</li>
              </ul>
            </div>

            <form @submit.prevent="handleImportSubmit" class="space-y-4">
              <!-- File Drag & Drop / Selector -->
              <div>
                <label class="label mb-1">Schwab Token File (JSON)</label>

                <!-- Hidden file input -->
                <input
                  ref="fileInputRef"
                  type="file"
                  accept=".json,application/json"
                  class="hidden"
                  @change="onFileChange"
                />

                <!-- Dropzone -->
                <div
                  v-if="!selectedFileName"
                  class="border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors"
                  :class="isDragging
                    ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-950/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500 bg-gray-50/80 dark:bg-gray-900/60'"
                  @dragover.prevent="isDragging = true"
                  @dragleave.prevent="isDragging = false"
                  @drop.prevent="onDrop"
                  @click="fileInputRef?.click()"
                >
                  <svg class="mx-auto h-9 w-9 text-gray-400 dark:text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                    <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  <div class="mt-2 text-sm text-gray-700 dark:text-gray-200">
                    <span class="font-medium text-primary-600 dark:text-primary-400 hover:underline">
                      Click to choose file
                    </span>
                    or drag and drop
                  </div>
                  <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Select your <span class="font-mono font-medium">token.json</span> file
                  </p>
                </div>

                <!-- Selected File Display -->
                <div
                  v-else
                  class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50/80 dark:bg-gray-900/60 flex items-center justify-between"
                >
                  <div class="flex items-center space-x-3 overflow-hidden">
                    <div class="w-8 h-8 rounded bg-primary-100 dark:bg-primary-950/60 border border-primary-200 dark:border-primary-800 flex items-center justify-center flex-shrink-0">
                      <svg class="w-4 h-4 text-primary-600 dark:text-primary-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd" />
                      </svg>
                    </div>
                    <div class="truncate">
                      <p class="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {{ selectedFileName }}
                      </p>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        {{ formatFileSize(selectedFileSize) }}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    class="text-sm text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 ml-3"
                    @click="clearSelectedFile"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <!-- Paste JSON Directly Toggle -->
              <div class="pt-1">
                <button
                  type="button"
                  class="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline flex items-center space-x-1"
                  @click="showPasteArea = !showPasteArea"
                >
                  <span>{{ showPasteArea ? 'Hide JSON text editor' : 'Or paste JSON content directly' }}</span>
                  <svg class="w-3.5 h-3.5 transition-transform" :class="showPasteArea ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                <div v-if="showPasteArea" class="mt-2">
                  <textarea
                    v-model="rawJsonInput"
                    rows="5"
                    class="input font-mono text-xs w-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 border border-gray-300 dark:border-gray-600 focus:border-primary-500 focus:ring-primary-500"
                    placeholder='{ "access_token": "...", "refresh_token": "...", "expires_in": 1800 }'
                    @input="onJsonTextInput"
                  ></textarea>
                </div>
              </div>

              <!-- Token Preview Badges -->
              <div v-if="parsedTokenSummary" class="p-3 bg-gray-50/80 dark:bg-gray-900/60 rounded-lg text-xs space-y-1.5 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200">
                <div class="font-medium text-gray-800 dark:text-gray-200">Detected Credentials:</div>
                <div class="flex flex-wrap gap-2 pt-0.5">
                  <span
                    class="px-2 py-0.5 rounded-full font-medium"
                    :class="parsedTokenSummary.hasAccessToken
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'"
                  >
                    Access Token: {{ parsedTokenSummary.hasAccessToken ? 'Present' : 'Missing (Will Refresh)' }}
                  </span>
                  <span
                    class="px-2 py-0.5 rounded-full font-medium"
                    :class="parsedTokenSummary.hasRefreshToken
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'"
                  >
                    Refresh Token: {{ parsedTokenSummary.hasRefreshToken ? 'Present' : 'None' }}
                  </span>
                </div>
                <div v-if="parsedTokenSummary.expiresInfo" class="text-gray-600 dark:text-gray-300">
                  Status: {{ parsedTokenSummary.expiresInfo }}
                </div>
              </div>

              <!-- Optional Account Label -->
              <div>
                <label for="schwabAccountLabel" class="label">Account Label</label>
                <input
                  id="schwabAccountLabel"
                  v-model="form.accountLabel"
                  type="text"
                  class="input"
                  placeholder="e.g., Schwab Main Account"
                />
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Optional label to identify this Schwab connection
                </p>
              </div>

              <!-- Auto-sync Settings -->
              <div class="p-4 bg-gray-50/80 dark:bg-gray-900/60 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3">
                <div class="flex items-center justify-between">
                  <div>
                    <label class="block text-sm font-medium text-gray-900 dark:text-white">
                      Auto-Sync
                    </label>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      Automatically sync trades periodically
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    v-model="form.autoSyncEnabled"
                    class="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                </div>

                <div v-if="form.autoSyncEnabled" class="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-3">
                  <div>
                    <label class="label text-xs">Sync Frequency</label>
                    <select v-model="form.syncFrequency" class="input text-sm">
                      <option value="hourly">Hourly</option>
                      <option value="every_4_hours">Every 4 hours</option>
                      <option value="every_6_hours">Every 6 hours</option>
                      <option value="every_12_hours">Every 12 hours</option>
                      <option value="daily">Daily</option>
                    </select>
                  </div>
                </div>
              </div>

              <!-- Sync Range -->
              <div>
                <label class="label">Sync Trades From</label>
                <div class="mb-2 flex flex-wrap gap-2">
                  <button
                    v-for="preset in syncRangePresets"
                    :key="preset.id"
                    type="button"
                    :class="[
                      'rounded-full border px-3 py-1 text-sm transition-colors',
                      activePreset === preset.id
                        ? 'border-primary-600 bg-primary-600 text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
                    ]"
                    @click="applySyncRangePreset(preset.id)"
                  >
                    {{ preset.label }}
                  </button>
                </div>
                <input
                  v-if="activePreset === 'custom'"
                  v-model="form.syncStartDate"
                  type="date"
                  class="input"
                  :max="todayIso"
                />
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Trades prior to this date will be ignored during import and future syncs.
                </p>
              </div>

              <!-- Buttons -->
              <div class="flex justify-end space-x-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  @click="emit('close')"
                  class="btn-secondary"
                  :disabled="props.loading"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="btn-primary"
                  :disabled="props.loading || (!parsedTokenData && !rawJsonInput.trim())"
                >
                  <span v-if="props.loading" class="flex items-center">
                    <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Importing...
                  </span>
                  <span v-else>
                    {{ props.isUpdate ? 'Update Tokens' : 'Import & Connect' }}
                  </span>
                </button>
              </div>
            </form>
          </div>

          <!-- TAB 2: Browser OAuth Login -->
          <div v-else-if="activeTab === 'oauth'" class="space-y-4">
            <!-- Mode Explainer Banner -->
            <div class="p-4 bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/30 dark:border-amber-500/35 rounded-lg text-xs space-y-1.5">
              <div class="font-semibold text-sm text-amber-900 dark:text-amber-200 flex items-center space-x-2">
                <svg class="w-4 h-4 text-amber-600 dark:text-amber-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{{ props.isUpdate ? 'Re-authenticate Charles Schwab' : 'Connect Charles Schwab (OAuth)' }}</span>
              </div>
              <p class="text-amber-800 dark:text-amber-100 leading-relaxed">
                Schwab developer tokens expire every 7 days. Open the Schwab login URL in a new window, sign in to approve access, and paste the redirect URL below.
              </p>
            </div>

            <!-- Step 1: Open Login URL -->
            <div class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-3 bg-gray-50/80 dark:bg-gray-900/60">
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2.5">
                  <span class="w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold shrink-0">1</span>
                  <span class="text-sm font-semibold text-gray-900 dark:text-white">Open Schwab Login</span>
                </div>
                <span v-if="authUrlLoading" class="text-xs text-gray-500 dark:text-gray-400 flex items-center">
                  <div class="animate-spin rounded-full h-3 w-3 border-b-2 border-primary-600 mr-1.5"></div>
                  Generating URL...
                </span>
              </div>
              <p class="text-xs text-gray-700 dark:text-gray-200">
                Click to open Charles Schwab in a new window and sign in:
              </p>

              <div class="flex flex-wrap gap-2.5 pt-0.5">
                <!-- If URL is ready, render native anchor so popup blockers never interfere -->
                <a
                  v-if="currentAuthUrl"
                  :href="currentAuthUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn-primary text-xs py-2 px-3.5 inline-flex items-center space-x-1.5 no-underline font-medium shadow-sm"
                >
                  <span>Open Schwab Login</span>
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>

                <!-- If URL still loading, button that triggers handler with synchronous pre-open -->
                <button
                  v-else
                  type="button"
                  class="btn-primary text-xs py-2 px-3.5 inline-flex items-center space-x-1.5 font-medium shadow-sm"
                  :disabled="authUrlLoading"
                  @click="openAuthUrlInBrowser"
                >
                  <div v-if="authUrlLoading" class="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white mr-1.5"></div>
                  <span>{{ authUrlLoading ? 'Generating Link...' : 'Open Schwab Login' }}</span>
                  <svg v-if="!authUrlLoading" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>

                <button
                  type="button"
                  class="btn-secondary text-xs py-2 px-3.5 inline-flex items-center space-x-1.5 font-medium shadow-sm"
                  @click="copyAuthUrlToClipboard"
                >
                  <svg class="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span>{{ copiedAuthUrl ? 'URL Copied!' : 'Copy Login URL' }}</span>
                </button>
              </div>

              <!-- Collapsible URL Details -->
              <div class="pt-1">
                <button
                  type="button"
                  class="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 font-medium hover:underline flex items-center space-x-1"
                  @click="showAuthUrlDetails = !showAuthUrlDetails"
                >
                  <span>{{ showAuthUrlDetails ? 'Hide URL details' : 'View full URL / callback details' }}</span>
                  <svg class="w-3.5 h-3.5 transition-transform" :class="showAuthUrlDetails ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div v-if="showAuthUrlDetails" class="mt-2 p-2.5 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded-md font-mono text-xs break-all text-gray-800 dark:text-gray-200 space-y-1 shadow-inner">
                  <div class="font-sans font-medium text-gray-500 dark:text-gray-400">Authorization URL:</div>
                  <div class="select-all">{{ currentAuthUrl || 'Generating URL on request...' }}</div>
                </div>
              </div>
            </div>

            <!-- Step 2: Paste Redirect URL -->
            <div class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-3 bg-gray-50/80 dark:bg-gray-900/60">
              <div class="flex items-center space-x-2.5">
                <span class="w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs font-bold shrink-0">2</span>
                <span class="text-sm font-semibold text-gray-900 dark:text-white">Paste Redirect URL</span>
              </div>

              <!-- Redirect Notice Box -->
              <div class="p-3 bg-blue-500/10 dark:bg-blue-500/15 border border-blue-500/25 dark:border-blue-500/35 rounded-md text-xs text-blue-900 dark:text-blue-100 leading-relaxed">
                <strong>Expected behavior:</strong> After signing in, Schwab redirects your browser to a local callback address. If your browser displays <span class="font-semibold underline">&quot;This site can&apos;t be reached&quot;</span> or a blank page, that is completely expected! Copy the entire address from your browser&apos;s address bar and paste it below:
              </div>

              <div>
                <textarea
                  v-model="pastedRedirectUrl"
                  rows="3"
                  class="input font-mono text-xs w-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 border border-gray-300 dark:border-gray-600 rounded-lg focus:border-primary-500 focus:ring-primary-500"
                  placeholder="https://127.0.0.1:8081/api/broker-sync/connections/schwab/callback?code=C0.xxxx@&session=..."
                  @input="onRedirectUrlInput"
                ></textarea>
              </div>

              <!-- Live Detection Indicator -->
              <div v-if="pastedCodeInfo" class="space-y-1.5">
                <div
                  v-if="pastedCodeInfo.code"
                  class="p-2.5 bg-green-500/10 dark:bg-green-500/15 border border-green-500/30 rounded-md flex items-center justify-between text-xs text-green-900 dark:text-green-200"
                >
                  <div class="flex items-center space-x-2 overflow-hidden truncate">
                    <svg class="w-4 h-4 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                    <span class="font-semibold">Authorization code detected</span>
                    <span class="font-mono text-green-800 dark:text-green-300 truncate">({{ maskCode(pastedCodeInfo.code) }})</span>
                  </div>
                  <button type="button" @click="clearPastedUrl" class="text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100 underline text-xs ml-2 font-medium">Clear</button>
                </div>

                <div
                  v-else-if="pastedCodeInfo.error"
                  class="p-2.5 bg-red-500/10 dark:bg-red-500/15 border border-red-500/30 rounded-md flex items-center space-x-2 text-xs text-red-900 dark:text-red-200"
                >
                  <svg class="w-4 h-4 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                  <span>Schwab reported an error: {{ pastedCodeInfo.errorDescription || pastedCodeInfo.error }}</span>
                </div>

                <div
                  v-else-if="pastedRedirectUrl.trim()"
                  class="p-2.5 bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/30 rounded-md flex items-center space-x-2 text-xs text-amber-900 dark:text-amber-200"
                >
                  <svg class="w-4 h-4 text-amber-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                  <span>No code found. Please ensure you copied the full redirect URL containing <code class="font-mono bg-amber-200/50 dark:bg-amber-900/40 px-1 py-0.5 rounded">code=...</code>.</span>
                </div>
              </div>
            </div>

            <!-- Optional Settings for OAuth Connection -->
            <div class="space-y-3">
              <button
                v-if="props.isUpdate"
                type="button"
                class="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white flex items-center space-x-1 font-medium"
                @click="showUpdateSettings = !showUpdateSettings"
              >
                <span>{{ showUpdateSettings ? 'Hide sync settings' : 'Edit sync settings (optional)' }}</span>
                <svg class="w-3.5 h-3.5 transition-transform" :class="showUpdateSettings ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              <div v-if="!props.isUpdate || showUpdateSettings" class="space-y-4 pt-1">
                <!-- Optional Account Label -->
                <div>
                  <label for="schwabOAuthAccountLabel" class="label">Account Label</label>
                  <input
                    id="schwabOAuthAccountLabel"
                    v-model="form.accountLabel"
                    type="text"
                    class="input"
                    placeholder="e.g., Schwab Main Account"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Optional label to identify this Schwab connection
                  </p>
                </div>

                <!-- Auto-sync Settings -->
                <div class="p-4 bg-gray-50/80 dark:bg-gray-900/60 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3">
                  <div class="flex items-center justify-between">
                    <div>
                      <label class="block text-sm font-medium text-gray-900 dark:text-white">
                        Auto-Sync
                      </label>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        Automatically sync trades periodically
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      v-model="form.autoSyncEnabled"
                      class="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                  </div>

                  <div v-if="form.autoSyncEnabled" class="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-3">
                    <div>
                      <label class="label text-xs">Sync Frequency</label>
                      <select v-model="form.syncFrequency" class="input text-sm">
                        <option value="hourly">Hourly</option>
                        <option value="every_4_hours">Every 4 hours</option>
                        <option value="every_6_hours">Every 6 hours</option>
                        <option value="every_12_hours">Every 12 hours</option>
                        <option value="daily">Daily</option>
                      </select>
                    </div>
                  </div>
                </div>

                <!-- Sync Range -->
                <div>
                  <label class="label">Sync Trades From</label>
                  <div class="mb-2 flex flex-wrap gap-2">
                    <button
                      v-for="preset in syncRangePresets"
                      :key="preset.id"
                      type="button"
                      :class="[
                        'rounded-full border px-3 py-1 text-sm transition-colors',
                        activePreset === preset.id
                          ? 'border-primary-600 bg-primary-600 text-white'
                          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
                      ]"
                      @click="applySyncRangePreset(preset.id)"
                    >
                      {{ preset.label }}
                    </button>
                  </div>
                  <input
                    v-if="activePreset === 'custom'"
                    v-model="form.syncStartDate"
                    type="date"
                    class="input"
                    :max="todayIso"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Trades prior to this date will be ignored during import and future syncs.
                  </p>
                </div>
              </div>
            </div>

            <!-- Buttons -->
            <div class="flex flex-col space-y-2 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div class="flex justify-end space-x-3">
                <button
                  type="button"
                  @click="emit('close')"
                  class="btn-secondary"
                  :disabled="props.loading"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="btn-primary"
                  :disabled="props.loading || !pastedCodeInfo?.code"
                  @click.prevent="handleExchangeSubmit"
                >
                  <span v-if="props.loading" class="flex items-center">
                    <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Connecting...
                  </span>
                  <span v-else>
                    {{ props.isUpdate ? 'Update Tokens' : 'Connect Account' }}
                  </span>
                </button>
              </div>

              <!-- Fallback Direct Window Redirect -->
              <div class="flex justify-end pt-1">
                <button
                  type="button"
                  class="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline"
                  :disabled="props.loading"
                  @click="handleOAuthSubmit"
                >
                  Connect with Schwab Login
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, watch } from 'vue'
import api from '@/services/api'
import { useBrokerSyncStore } from '@/stores/brokerSync'
import { extractSchwabOAuthParams } from '@/utils/schwabAuth'
import { syncRangePresets, applyPresetToForm, resolveActivePreset, todayIso } from '@/utils/syncRangePresets'

const props = defineProps({
  loading: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: null
  },
  isUpdate: {
    type: Boolean,
    default: false
  },
  existingConnection: {
    type: Object,
    default: null
  },
  authUrl: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close', 'import', 'oauth', 'exchangeCode'])

const activeTab = ref(props.isUpdate ? 'oauth' : 'file')
const isDragging = ref(false)
const fileInputRef = ref(null)
const selectedFileName = ref('')
const selectedFileSize = ref(0)
const rawJsonInput = ref('')
const showPasteArea = ref(false)
const parsedTokenData = ref(null)
const parsedTokenSummary = ref(null)
const localError = ref('')

// OAuth interactive state
const currentAuthUrl = ref(props.authUrl || '')
const authUrlLoading = ref(false)
const copiedAuthUrl = ref(false)
const showAuthUrlDetails = ref(false)
const showUpdateSettings = ref(false)
const pastedRedirectUrl = ref('')
const pastedCodeInfo = ref(null)

const form = reactive({
  accountLabel: '',
  autoSyncEnabled: false,
  syncFrequency: 'daily',
  syncTime: '06:00:00',
  syncStartDate: null
})

const activePreset = ref(resolveActivePreset(form.syncStartDate))

onMounted(() => {
  if (props.existingConnection) {
    if (props.existingConnection.accountLabel) form.accountLabel = props.existingConnection.accountLabel
    if (props.existingConnection.autoSyncEnabled !== undefined) form.autoSyncEnabled = Boolean(props.existingConnection.autoSyncEnabled)
    if (props.existingConnection.syncFrequency) form.syncFrequency = props.existingConnection.syncFrequency
    if (props.existingConnection.syncTime) form.syncTime = props.existingConnection.syncTime
    if (props.existingConnection.syncStartDate) {
      form.syncStartDate = props.existingConnection.syncStartDate
      activePreset.value = resolveActivePreset(props.existingConnection.syncStartDate)
    }
  }

  if (activeTab.value === 'oauth' && !currentAuthUrl.value) {
    loadAuthUrl()
  }
})

watch(activeTab, (newTab) => {
  if (newTab === 'oauth' && !currentAuthUrl.value) {
    loadAuthUrl()
  }
})

function maskCode(code) {
  if (!code) return ''
  if (code.length <= 12) return code
  return code.slice(0, 6) + '...' + code.slice(-4)
}

function onRedirectUrlInput() {
  localError.value = ''
  if (!pastedRedirectUrl.value.trim()) {
    pastedCodeInfo.value = null
    return
  }
  pastedCodeInfo.value = extractSchwabOAuthParams(pastedRedirectUrl.value)
}

function clearPastedUrl() {
  pastedRedirectUrl.value = ''
  pastedCodeInfo.value = null
}

async function loadAuthUrl() {
  if (currentAuthUrl.value) return currentAuthUrl.value

  authUrlLoading.value = true
  try {
    const payload = {
      accountLabel: form.accountLabel.trim() || null,
      autoSyncEnabled: form.autoSyncEnabled,
      syncFrequency: form.syncFrequency,
      syncTime: form.syncTime,
      syncStartDate: form.syncStartDate
    }

    let url = null
    try {
      const store = useBrokerSyncStore()
      if (store && typeof store.initSchwabOAuth === 'function') {
        url = await store.initSchwabOAuth(payload)
      }
    } catch (_) {
      // Store unavailable (e.g. outside Pinia context in tests)
    }

    if (!url) {
      const response = await api.post('/broker-sync/connections/schwab/init', payload)
      url = response.data?.authUrl
    }

    if (url) {
      currentAuthUrl.value = url
      return url
    }
  } catch (err) {
    const msg = err.response?.data?.error || err.message || 'Failed to generate authorization URL'
    localError.value = msg
  } finally {
    authUrlLoading.value = false
  }
  return null
}

async function openAuthUrlInBrowser() {
  let url = currentAuthUrl.value
  if (url) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }

  // Pre-open window synchronously during user click to prevent browser popup blockers from blocking async open
  let popup = null
  try {
    popup = window.open('about:blank', '_blank')
  } catch (_) {}

  url = await loadAuthUrl()
  if (url) {
    if (popup && !popup.closed) {
      popup.location.href = url
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  } else if (popup && !popup.closed) {
    popup.close()
  }
}

async function copyAuthUrlToClipboard() {
  localError.value = ''
  let url = currentAuthUrl.value
  if (!url) {
    url = await loadAuthUrl()
  }
  if (!url) {
    localError.value = 'Failed to generate authorization URL. Please check connection and try again.'
    return
  }

  let copied = false
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url)
      copied = true
    } catch (_) {}
  }

  if (!copied) {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = url
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      copied = document.execCommand('copy')
      document.body.removeChild(textarea)
    } catch (_) {}
  }

  if (copied) {
    copiedAuthUrl.value = true
    setTimeout(() => { copiedAuthUrl.value = false }, 2500)
  }
}

function applySyncRangePreset(presetId) {
  activePreset.value = presetId
  applyPresetToForm(form, presetId)
}

function handleOAuthSubmit() {
  emit('oauth', {
    accountLabel: form.accountLabel.trim() || null,
    autoSyncEnabled: form.autoSyncEnabled,
    syncFrequency: form.syncFrequency,
    syncTime: form.syncTime,
    syncStartDate: form.syncStartDate
  })
}

function handleExchangeSubmit() {
  localError.value = ''
  const info = pastedCodeInfo.value || extractSchwabOAuthParams(pastedRedirectUrl.value)
  if (!info || !info.code) {
    localError.value = 'Please paste a valid redirect URL or authorization code from Schwab.'
    return
  }

  emit('exchangeCode', {
    redirectUrl: pastedRedirectUrl.value.trim(),
    code: info.code,
    state: info.state,
    accountLabel: form.accountLabel.trim() || null,
    autoSyncEnabled: form.autoSyncEnabled,
    syncFrequency: form.syncFrequency,
    syncTime: form.syncTime,
    syncStartDate: form.syncStartDate
  })
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  return (bytes / 1024).toFixed(1) + ' KB'
}

function clearSelectedFile() {
  selectedFileName.value = ''
  selectedFileSize.value = 0
  parsedTokenData.value = null
  parsedTokenSummary.value = null
  localError.value = ''
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

function analyzeTokenObject(obj) {
  if (!obj || typeof obj !== 'object') return null

  // Support schwab-py format where token is nested
  const token = obj.token && typeof obj.token === 'object' ? obj.token : obj

  const hasAccessToken = Boolean(token.access_token || token.accessToken)
  const hasRefreshToken = Boolean(token.refresh_token || token.refreshToken)

  if (!hasAccessToken && !hasRefreshToken) {
    return null
  }

  let expiresInfo = ''
  const expiresAt = token.expires_at ?? token.expiresAt ?? obj.expires_at
  const expiresIn = token.expires_in ?? token.expiresIn ?? obj.expires_in

  if (expiresAt) {
    const expDate = new Date(typeof expiresAt === 'number' && expiresAt < 1e11 ? expiresAt * 1000 : expiresAt)
    if (!isNaN(expDate.getTime())) {
      const isPast = expDate.getTime() < Date.now()
      expiresInfo = isPast
        ? `Expired at ${expDate.toLocaleTimeString()} (will auto-refresh if refresh token is valid)`
        : `Valid until ${expDate.toLocaleTimeString()}`
    }
  } else if (expiresIn) {
    expiresInfo = `Valid for ~${Math.round(expiresIn / 60)} minutes`
  }

  return {
    hasAccessToken,
    hasRefreshToken,
    expiresInfo
  }
}

function processTokenContent(text) {
  localError.value = ''
  try {
    const parsed = JSON.parse(text)
    const summary = analyzeTokenObject(parsed)

    if (!summary) {
      localError.value = 'File parsed, but no access_token or refresh_token fields were found.'
      parsedTokenSummary.value = null
      parsedTokenData.value = null
      return false
    }

    parsedTokenData.value = parsed
    parsedTokenSummary.value = summary
    return true
  } catch (err) {
    localError.value = 'Failed to parse JSON: ' + err.message
    parsedTokenSummary.value = null
    parsedTokenData.value = null
    return false
  }
}

function onFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  loadFile(file)
}

function onDrop(e) {
  isDragging.value = false
  const file = e.dataTransfer.files?.[0]
  if (!file) return
  loadFile(file)
}

function loadFile(file) {
  selectedFileName.value = file.name
  selectedFileSize.value = file.size
  const reader = new FileReader()
  reader.onload = (event) => {
    const content = event.target.result
    processTokenContent(content)
  }
  reader.onerror = () => {
    localError.value = 'Failed to read file'
  }
  reader.readAsText(file)
}

function onJsonTextInput() {
  if (!rawJsonInput.value.trim()) {
    parsedTokenData.value = null
    parsedTokenSummary.value = null
    localError.value = ''
    return
  }
  processTokenContent(rawJsonInput.value)
}

function handleImportSubmit() {
  localError.value = ''

  const tokenData = parsedTokenData.value || (rawJsonInput.value.trim() ? JSON.parse(rawJsonInput.value.trim()) : null)

  if (!tokenData) {
    localError.value = 'Please select a valid token JSON file or paste JSON token content.'
    return
  }

  emit('import', {
    tokenData,
    accountLabel: form.accountLabel.trim() || null,
    autoSyncEnabled: form.autoSyncEnabled,
    syncFrequency: form.syncFrequency,
    syncTime: form.syncTime,
    syncStartDate: form.syncStartDate
  })
}
</script>
