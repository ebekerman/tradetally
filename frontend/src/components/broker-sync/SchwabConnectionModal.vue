<template>
  <div class="fixed inset-0 z-50 overflow-y-auto">
    <div class="flex min-h-full items-center justify-center p-4">
      <!-- Backdrop -->
      <div class="fixed inset-0 bg-black/50 transition-opacity" @click="emit('close')"></div>

      <!-- Modal Card -->
      <div class="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg">
        <!-- Header -->
        <div class="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div class="flex items-center space-x-3">
            <div class="w-9 h-9 bg-primary-100 dark:bg-primary-900/30 rounded-lg flex items-center justify-center">
              <span class="text-primary-600 dark:text-primary-400 font-bold text-sm">CS</span>
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
              {{ props.isUpdate ? 'Update Schwab Tokens' : 'Connect Charles Schwab' }}
            </h3>
          </div>
          <button
            @click="emit('close')"
            class="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
            aria-label="Close"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Mode Selector Tabs (only shown if not updating) -->
        <div v-if="!props.isUpdate" class="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 px-6 pt-3">
          <button
            type="button"
            class="pb-3 px-3 text-sm font-medium border-b-2 transition-colors flex items-center space-x-2"
            :class="activeTab === 'file'
              ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400 font-semibold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'"
            @click="activeTab = 'file'"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Import Token File (JSON)</span>
          </button>
          <button
            type="button"
            class="pb-3 px-3 text-sm font-medium border-b-2 transition-colors flex items-center space-x-2 ml-4"
            :class="activeTab === 'oauth'
              ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400 font-semibold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'"
            @click="activeTab = 'oauth'"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            <span>Browser Login (OAuth)</span>
          </button>
        </div>

        <!-- Body -->
        <div class="p-6">
          <!-- Error Alert -->
          <div v-if="localError || props.error" class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div class="flex">
              <svg class="h-5 w-5 text-red-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
              </svg>
              <p class="ml-3 text-sm text-red-700 dark:text-red-300">{{ localError || props.error }}</p>
            </div>
          </div>

          <!-- TAB 1: File / JSON Import -->
          <div v-if="activeTab === 'file'" class="space-y-4">
            <!-- Setup Instructions Banner -->
            <div class="p-4 bg-primary-50 dark:bg-primary-900/20 rounded-lg">
              <h4 class="text-sm font-medium text-primary-800 dark:text-primary-300 mb-1">
                Token Import Instructions
              </h4>
              <p class="text-xs text-primary-700 dark:text-primary-400 mb-2">
                Import your Schwab OAuth credentials directly without browser redirection. TradeTally encrypts tokens at rest with AES-256-GCM.
              </p>
              <ul class="text-xs text-primary-700 dark:text-primary-400 space-y-1 list-disc list-inside">
                <li>Compatible with <strong>schwab-py</strong> <code class="bg-primary-100 dark:bg-primary-800/40 px-1 py-0.5 rounded">token.json</code> files.</li>
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
                    ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-900/10'
                    : 'border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500 bg-gray-50 dark:bg-gray-700/20'"
                  @dragover.prevent="isDragging = true"
                  @dragleave.prevent="isDragging = false"
                  @drop.prevent="onDrop"
                  @click="fileInputRef?.click()"
                >
                  <svg class="mx-auto h-9 w-9 text-gray-400 dark:text-gray-500" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                    <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  <div class="mt-2 text-sm text-gray-600 dark:text-gray-300">
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
                  class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-750 flex items-center justify-between"
                >
                  <div class="flex items-center space-x-3 overflow-hidden">
                    <div class="w-8 h-8 rounded bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
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
                    class="input font-mono text-xs w-full"
                    placeholder='{ "access_token": "...", "refresh_token": "...", "expires_in": 1800 }'
                    @input="onJsonTextInput"
                  ></textarea>
                </div>
              </div>

              <!-- Token Preview Badges -->
              <div v-if="parsedTokenSummary" class="p-3 bg-gray-50 dark:bg-gray-700/40 rounded-lg text-xs space-y-1.5 border border-gray-200 dark:border-gray-700">
                <div class="font-medium text-gray-700 dark:text-gray-200">Detected Credentials:</div>
                <div class="flex flex-wrap gap-2 pt-0.5">
                  <span
                    class="px-2 py-0.5 rounded-full font-medium"
                    :class="parsedTokenSummary.hasAccessToken
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'"
                  >
                    Access Token: {{ parsedTokenSummary.hasAccessToken ? 'Present' : 'Missing (Will Refresh)' }}
                  </span>
                  <span
                    class="px-2 py-0.5 rounded-full font-medium"
                    :class="parsedTokenSummary.hasRefreshToken
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                      : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'"
                  >
                    Refresh Token: {{ parsedTokenSummary.hasRefreshToken ? 'Present' : 'None' }}
                  </span>
                </div>
                <div v-if="parsedTokenSummary.expiresInfo" class="text-gray-500 dark:text-gray-400">
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
              <div class="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg space-y-3">
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

                <div v-if="form.autoSyncEnabled" class="pt-2 border-t border-gray-200 dark:border-gray-600 space-y-3">
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
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
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
            <div class="text-sm text-gray-600 dark:text-gray-300 space-y-2">
              <p>
                You will be redirected to Charles Schwab's official authentication page to log in and approve TradeTally.
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                Note: Schwab requires an approved developer app with thinkorswim enabled.
              </p>
            </div>

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
            <div class="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg space-y-3">
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

              <div v-if="form.autoSyncEnabled" class="pt-2 border-t border-gray-200 dark:border-gray-600 space-y-3">
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
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
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

            <div class="flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                @click="emit('close')"
                class="btn-secondary"
                :disabled="props.loading"
              >
                Cancel
              </button>
              <button
                type="button"
                @click="handleOAuthSubmit"
                class="btn-primary"
                :disabled="props.loading"
              >
                <span v-if="props.loading" class="flex items-center">
                  <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Redirecting...
                </span>
                <span v-else class="flex items-center">
                  <span>Connect with Schwab Login</span>
                  <svg class="w-4 h-4 ml-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
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
  }
})

const emit = defineEmits(['close', 'import', 'oauth'])

const activeTab = ref('file')
const isDragging = ref(false)
const fileInputRef = ref(null)
const selectedFileName = ref('')
const selectedFileSize = ref(0)
const rawJsonInput = ref('')
const showPasteArea = ref(false)
const parsedTokenData = ref(null)
const parsedTokenSummary = ref(null)
const localError = ref('')

const form = reactive({
  accountLabel: '',
  autoSyncEnabled: false,
  syncFrequency: 'daily',
  syncTime: '06:00:00',
  syncStartDate: null
})

const activePreset = ref(resolveActivePreset(form.syncStartDate))

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
