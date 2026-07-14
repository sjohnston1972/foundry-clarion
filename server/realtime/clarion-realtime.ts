import { DurableObject } from 'cloudflare:workers'
import type { Bindings } from '../types'
import { applyPresence, snapshotMessage, type PresenceState, type PresenceEvent } from './presence'

/** One instance per org (addressed by idFromName(organization_id)). Realtime presence hub. */
export class ClarionRealtime extends DurableObject<Bindings> {
  private state: PresenceState = {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.endsWith('/socket')) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
      const pair = new WebSocketPair()
      const [client, server] = [pair[0], pair[1]]
      this.ctx.acceptWebSocket(server)
      server.send(snapshotMessage(this.state))
      return new Response(null, { status: 101, webSocket: client })
    }
    if (url.pathname.endsWith('/presence') && req.method === 'POST') {
      const e = (await req.json()) as PresenceEvent
      this.state = applyPresence(this.state, e)
      this.broadcast(snapshotMessage(this.state))
      return new Response('ok')
    }
    return new Response('not found', { status: 404 })
  }

  // Agent softphones may push their own presence over the socket.
  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    try {
      const e = JSON.parse(message) as PresenceEvent
      if (e && typeof e.identity === 'string' && typeof e.status === 'string') {
        this.state = applyPresence(this.state, { identity: e.identity, status: e.status, at: e.at ?? Date.now() })
        this.broadcast(snapshotMessage(this.state))
      }
    } catch { /* ignore malformed frames */ }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try { ws.close() } catch { /* already closed */ }
  }

  private broadcast(msg: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg) } catch { /* drop dead socket */ }
    }
  }
}
