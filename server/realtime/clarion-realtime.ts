import { DurableObject } from 'cloudflare:workers'
import type { Bindings } from '../types'
import { applyPresence, snapshotMessage, type PresenceState, type PresenceEvent } from './presence'

/**
 * One instance per org (addressed by idFromName(organization_id)). Realtime presence hub.
 * Presence state is persisted to `ctx.storage` (SQLite-backed DO) so a woken instance
 * restores its roster instead of broadcasting empty state after hibernation eviction.
 */
export class ClarionRealtime extends DurableObject<Bindings> {
  private state: PresenceState = {}

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<PresenceState>('presence')) ?? {}
    })
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.endsWith('/socket')) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
      const identity = url.searchParams.get('identity')
      const pair = new WebSocketPair()
      const [client, server] = [pair[0], pair[1]]
      this.ctx.acceptWebSocket(server)
      // Attach the route-supplied identity (never client-supplied) so
      // webSocketClose can clean up; attachments survive hibernation.
      if (identity) server.serializeAttachment({ identity })
      server.send(snapshotMessage(this.state))
      return new Response(null, { status: 101, webSocket: client })
    }
    if (url.pathname.endsWith('/presence') && req.method === 'POST') {
      const body: unknown = await req.json()
      if (
        typeof body !== 'object' || body === null ||
        typeof (body as Record<string, unknown>).identity !== 'string' ||
        typeof (body as Record<string, unknown>).status !== 'string'
      ) {
        return new Response('bad request', { status: 400 })
      }
      const b = body as Record<string, unknown>
      const e: PresenceEvent = {
        identity: b.identity as string,
        status: b.status as string,
        at: typeof b.at === 'number' ? b.at : Date.now(),
      }
      this.state = applyPresence(this.state, e)
      await this.persist()
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
        await this.persist()
        this.broadcast(snapshotMessage(this.state))
      }
    } catch { /* ignore malformed frames */ }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as { identity?: string } | null
    const identity = attachment?.identity
    if (identity) {
      this.state = applyPresence(this.state, { identity, status: 'offline', at: Date.now() })
      await this.persist()
      this.broadcast(snapshotMessage(this.state))
    }
    try { ws.close() } catch { /* already closed */ }
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put('presence', this.state)
  }

  private broadcast(msg: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg) } catch { /* drop dead socket */ }
    }
  }
}
