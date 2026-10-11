import { shallowMount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SchwabConnectionModal from '@/components/broker-sync/SchwabConnectionModal.vue'

describe('SchwabConnectionModal', () => {
  it('renders modal with file import tab by default', () => {
    const wrapper = shallowMount(SchwabConnectionModal, {
      props: {
        loading: false,
        error: null,
        isUpdate: false
      }
    })

    expect(wrapper.text()).toContain('Connect Charles Schwab')
    expect(wrapper.text()).toContain('Import Token File (JSON)')
    expect(wrapper.text()).toContain('Browser Login (OAuth)')
    expect(wrapper.text()).toContain('token.json')
  })

  it('renders update title when isUpdate is true', () => {
    const wrapper = shallowMount(SchwabConnectionModal, {
      props: {
        loading: false,
        error: null,
        isUpdate: true
      }
    })

    expect(wrapper.text()).toContain('Update Schwab Tokens')
    expect(wrapper.find('button[type="submit"]').text()).toBe('Update Tokens')
  })

  it('emits close event when close button is clicked', async () => {
    const wrapper = shallowMount(SchwabConnectionModal, {
      props: {
        loading: false,
        error: null
      }
    })

    await wrapper.find('button[aria-label="Close"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('emits oauth event with form payload when OAuth tab is active and Connect button is clicked', async () => {
    const wrapper = shallowMount(SchwabConnectionModal, {
      props: {
        loading: false,
        error: null
      }
    })

    // Click OAuth tab
    const oauthTab = wrapper.findAll('button').find(b => b.text().includes('Browser Login'))
    await oauthTab.trigger('click')

    // Click "This Year" preset
    const ytdPresetBtn = wrapper.findAll('button').find(b => b.text().includes('This Year'))
    await ytdPresetBtn.trigger('click')

    // Find and click Connect with Schwab Login
    const connectBtn = wrapper.findAll('button').find(b => b.text().includes('Connect with Schwab Login'))
    await connectBtn.trigger('click')

    expect(wrapper.emitted('oauth')).toHaveLength(1)
    const payload = wrapper.emitted('oauth')[0][0]
    expect(payload).toHaveProperty('syncStartDate')
    expect(payload.syncStartDate).toMatch(/^\d{4}-01-01$/)
    expect(payload).toHaveProperty('accountLabel', null)
    expect(payload).toHaveProperty('autoSyncEnabled', false)
  })

  it('emits import event with syncStartDate when token data is provided', async () => {
    const wrapper = shallowMount(SchwabConnectionModal, {
      props: {
        loading: false,
        error: null
      }
    })

    // Click "Last 30 Days" preset
    const preset30d = wrapper.findAll('button').find(b => b.text().includes('Last 30 Days'))
    await preset30d.trigger('click')

    // Toggle paste area and type json
    const pasteToggle = wrapper.findAll('button').find(b => b.text().includes('paste JSON'))
    await pasteToggle.trigger('click')

    const textarea = wrapper.find('textarea')
    await textarea.setValue(JSON.stringify({ access_token: 'test-token', refresh_token: 'test-refresh' }))

    await wrapper.find('form').trigger('submit.prevent')

    expect(wrapper.emitted('import')).toHaveLength(1)
    const payload = wrapper.emitted('import')[0][0]
    expect(payload).toHaveProperty('syncStartDate')
    expect(payload.syncStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(payload.tokenData).toEqual(expect.objectContaining({ access_token: 'test-token' }))
  })

  it('detects authorization code when redirect URL is pasted and emits exchangeCode on submit', async () => {
    const wrapper = shallowMount(SchwabConnectionModal, {
      props: {
        loading: false,
        error: null,
        isUpdate: true,
        existingConnection: {
          accountLabel: 'Main Schwab',
          autoSyncEnabled: true,
          syncFrequency: 'hourly',
          syncStartDate: '2025-01-01'
        }
      }
    })

    // In update mode, OAuth tab is active by default
    expect(wrapper.text()).toContain('Open Schwab Login')
    expect(wrapper.text()).toContain('Paste Redirect URL')

    // Submit button should be disabled before pasting valid URL
    const submitBtn = wrapper.find('button[type="submit"]')
    expect(submitBtn.attributes('disabled')).toBeDefined()

    // Paste full redirect URL with percent-encoded code
    const textarea = wrapper.find('textarea')
    await textarea.setValue('https://127.0.0.1:8081/api/broker-sync/connections/schwab/callback?code=C0.mycode123%40&session=abc&state=statetoken')

    // Live feedback badge appears
    expect(wrapper.text()).toContain('Authorization code detected')

    // Submit button is now enabled
    expect(submitBtn.attributes('disabled')).toBeUndefined()
    await submitBtn.trigger('click')

    expect(wrapper.emitted('exchangeCode')).toHaveLength(1)
    const payload = wrapper.emitted('exchangeCode')[0][0]
    expect(payload.code).toBe('C0.mycode123@')
    expect(payload.state).toBe('statetoken')
    expect(payload.redirectUrl).toContain('https://127.0.0.1:8081')
    expect(payload.accountLabel).toBe('Main Schwab')
    expect(payload.autoSyncEnabled).toBe(true)
    expect(payload.syncFrequency).toBe('hourly')
  })

  it('displays warning when invalid text without code is pasted', async () => {
    const wrapper = shallowMount(SchwabConnectionModal, {
      props: {
        loading: false,
        error: null,
        isUpdate: true
      }
    })

    const textarea = wrapper.find('textarea')
    await textarea.setValue('https://example.com/some/random/page')

    expect(wrapper.text()).toContain('No code found')
    const submitBtn = wrapper.find('button[type="submit"]')
    expect(submitBtn.attributes('disabled')).toBeDefined()
  })

  it('displays error notice when Schwab error is in pasted redirect URL', async () => {
    const wrapper = shallowMount(SchwabConnectionModal, {
      props: {
        loading: false,
        error: null,
        isUpdate: true
      }
    })

    const textarea = wrapper.find('textarea')
    await textarea.setValue('https://127.0.0.1:8081/callback?error=access_denied&error_description=User+cancelled')

    expect(wrapper.text()).toContain('Schwab reported an error: User cancelled')
  })

  it('allows switching between tabs when in update mode', async () => {
    const wrapper = shallowMount(SchwabConnectionModal, {
      props: {
        loading: false,
        error: null,
        isUpdate: true
      }
    })

    // Both tabs should be available
    expect(wrapper.text()).toContain('Browser Login (OAuth)')
    expect(wrapper.text()).toContain('Import Token File (JSON)')

    // Click Import Token File tab
    const fileTab = wrapper.findAll('button').find(b => b.text().includes('Import Token File'))
    await fileTab.trigger('click')

    expect(wrapper.text()).toContain('token.json')
  })
})
