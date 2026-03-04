import { useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import { Mic, MicOff, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { initialEdges, initialNodes } from '@/features/flow/nodes'
import { authClient } from '@/lib/auth-client'
import { createAgentSocket } from '@/lib/ws-client'

import '@xyflow/react/dist/style.css'

function App() {
  return (
    <ReactFlowProvider>
      <CreativeAgentCanvas />
    </ReactFlowProvider>
  )
}

function CreativeAgentCanvas() {
  const [nodes, _setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, _setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [micActive, setMicActive] = useState(false)
  const [connected, setConnected] = useState(false)
  const [projectName, setProjectName] = useState<string>('No active project')
  const [userName, setUserName] = useState<string>('')

  const socketClient = useMemo(() => {
    return createAgentSocket({
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
      onMessage: (message) => {
        if (message.type === 'agent.context.updated') {
          setProjectName('Active project')
        }
      },
    })
  }, [])

  useEffect(() => {
    const load = async () => {
      const session = await authClient.getSession()
      const name = session.data?.user?.name || session.data?.user?.email || ''
      setUserName(name)
    }

    load().catch(() => setUserName(''))

    return () => {
      socketClient.close()
    }
  }, [socketClient])

  const toggleMic = () => {
    const next = !micActive
    setMicActive(next)

    if (next) {
      socketClient.send({
        type: 'gemini.clientContent',
        payload: {
          turns: [
            {
              role: 'user',
              parts: [{ text: 'Mic activated. Ready for creative tool-call instructions.' }],
            },
          ],
          turnComplete: true,
        },
      })
    }
  }

  return (
    <div className="h-screen w-screen bg-background p-6 text-foreground">
      <Card className="relative h-full w-full overflow-hidden rounded-[2rem] border-2 border-border">
        <div className="absolute left-6 top-6 z-10">
          <Badge variant="outline" className="bg-background px-4 py-2 text-sm">
            {projectName}
          </Badge>
        </div>

        <div className="absolute right-6 top-6 z-10">
          <Button variant="outline" size="icon" className="rounded-full">
            <User className="h-5 w-5" />
          </Button>
          <p className="mt-1 text-right text-xs text-muted-foreground">{userName || 'profile'}</p>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          className="bg-background"
        >
          <MiniMap pannable zoomable />
          <Controls />
          <Background gap={24} size={1} />
        </ReactFlow>

        <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2">
          <Button
            variant={micActive ? 'default' : 'outline'}
            className="min-w-28 rounded-2xl"
            onClick={toggleMic}
          >
            {micActive ? <Mic className="mr-2 h-4 w-4" /> : <MicOff className="mr-2 h-4 w-4" />}
            Mic
          </Button>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            {connected ? 'voice socket connected' : 'connecting voice socket...'}
          </p>
        </div>
      </Card>
    </div>
  )
}

export default App
