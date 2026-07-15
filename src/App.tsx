import { Routes, Route } from 'react-router-dom'
import { AuthGate } from './components/AuthGate'
import { AppShell } from './components/AppShell'
import { EmptyState } from './components/ui'
import Softphone from './pages/Softphone'
import Agents from './pages/Agents'
import Queues from './pages/Queues'

function ComingSoon({ title }: { title: string }) {
  return <EmptyState title={title} hint="This page lands in a later step of the current run." />
}

export default function App() {
  return (
    <Routes>
      <Route element={<AuthGate />}>
        <Route element={<AppShell />}>
          {/* Softphone is the home page (nav routes it at /) and also answers
              /softphone so deep links work. */}
          <Route index element={<Softphone />} />
          <Route path="softphone" element={<Softphone />} />
          <Route path="agents" element={<Agents />} />
          <Route path="queues" element={<Queues />} />
          <Route path="wallboard" element={<ComingSoon title="Wallboard" />} />
        </Route>
      </Route>
    </Routes>
  )
}
