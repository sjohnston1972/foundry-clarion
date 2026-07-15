import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import { Card, CardHead, Button, Badge } from '@/components/ui'

function Preview() {
  return (
    <div className="p-8">
      <Card>
        <CardHead title="Design tokens" hint="Vendored from Foundry Workspace" />
        <div className="flex items-center gap-3 px-5 pb-5">
          <Button variant="primary">Primary</Button>
          <Button variant="outline">Outline</Button>
          <Badge tone="accent">Accent badge</Badge>
          <Badge>Neutral badge</Badge>
        </div>
      </Card>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
)
