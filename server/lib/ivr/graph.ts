// Re-exports the shared graph model so server code keeps importing from
// 'server/lib/ivr/graph' unchanged. Canonical definition lives in shared/ivr/graph.ts
// (also consumed directly by the client editor via the `@shared/*` alias) so the
// interpreter and the editor can never drift on node/edge shape.
export * from '../../../shared/ivr/graph'
