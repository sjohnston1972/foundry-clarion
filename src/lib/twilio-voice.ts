import { Device } from '@twilio/voice-sdk'

export type VoiceToken = { token: string; identity: string; expiresAt: number }

export async function fetchVoiceToken(): Promise<VoiceToken> {
  const res = await fetch('/api/token/voice', { method: 'POST', credentials: 'include' })
  if (!res.ok) throw new Error(`token ${res.status}`)
  return (await res.json()).data as VoiceToken
}

export async function registerDevice(token: string): Promise<Device> {
  const device = new Device(token, { logLevel: 'error' })
  await device.register()
  return device
}

export type PresenceAgent = { identity: string; status: string; at: number }

export function openPresenceSocket(onSnapshot: (agents: PresenceAgent[]) => void): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${proto}//${location.host}/api/realtime/socket`)
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string)
      if (msg.type === 'presence') onSnapshot(msg.agents as PresenceAgent[])
    } catch { /* ignore */ }
  }
  return ws
}
