import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import { Mic, MicOff, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { initialEdges, initialNodes } from '@/features/flow/nodes';
import { authBaseUrl, authClient } from '@/lib/auth-client';
import { createAgentSocket } from '@/lib/ws-client';

import '@xyflow/react/dist/style.css';

function App() {
  const [authState, setAuthState] = useState<
    'loading' | 'authenticated' | 'unauthenticated'
  >('loading');
  const [userName, setUserName] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let mounted = true;

    authClient
      .getSession()
      .then((session) => {
        if (!mounted) {
          return;
        }

        if (session.data?.user) {
          setUserName(session.data.user.name || session.data.user.email || '');
          setAuthState('authenticated');
          return;
        }

        setAuthState('unauthenticated');
      })
      .catch(() => {
        if (mounted) {
          setAuthState('unauthenticated');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleGoogleLogin = async () => {
    setAuthError('');

    try {
      const response = await fetch(`${authBaseUrl}/sign-in/social`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          provider: 'google',
          callbackURL: window.location.origin,
        }),
      });

      if (!response.ok) {
        throw new Error(`Sign-in request failed (${response.status})`);
      }

      const payload = (await response.json()) as { url?: string };
      if (!payload.url) {
        throw new Error('Provider redirect URL not found in response');
      }

      window.location.href = payload.url;
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : 'Failed to start Google sign in.',
      );
    }
  };

  if (authState === 'loading') {
    return (
      <div className='flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground'>
        <Card className='p-6'>
          <p className='text-sm font-medium'>Loading session...</p>
        </Card>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <div className='flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground'>
        <Card className='w-full max-w-sm p-6'>
          <p className='text-sm font-medium'>Sign in required</p>
          <p className='mt-2 text-xs text-muted-foreground'>
            Login with Google to continue to your creative canvas.
          </p>
          <Button className='mt-4 w-full' onClick={handleGoogleLogin}>
            Login with Google
          </Button>
          {authError ? (
            <p className='mt-2 text-xs text-muted-foreground'>{authError}</p>
          ) : null}
        </Card>
      </div>
    );
  }

  return (
    <AppErrorBoundary>
      <ReactFlowProvider>
        <CreativeAgentCanvas userName={userName} />
      </ReactFlowProvider>
    </AppErrorBoundary>
  );
}

type AppErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class AppErrorBoundary extends Component<
  { children: ReactNode },
  AppErrorBoundaryState
> {
  public constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  public static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error.message,
    };
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div className='flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground'>
          <Card className='max-w-xl p-6'>
            <p className='text-sm font-medium'>React runtime error</p>
            <p className='mt-2 text-xs text-muted-foreground break-all'>
              {this.state.message}
            </p>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

function CreativeAgentCanvas({ userName }: { userName: string }) {
  const [nodes, _setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, _setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [micActive, setMicActive] = useState(false);
  const [connected, setConnected] = useState(false);
  const [projectName, setProjectName] = useState<string>('No active project');
  const socketClientRef = useRef<ReturnType<typeof createAgentSocket> | null>(
    null,
  );

  useEffect(() => {
    const client = createAgentSocket({
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
      onMessage: (message) => {
        if (message.type === 'agent.context.updated') {
          setProjectName('Active project');
        }
      },
    });

    socketClientRef.current = client;

    return () => {
      client.close();
      socketClientRef.current = null;
    };
  }, []);

  const toggleMic = () => {
    const next = !micActive;
    setMicActive(next);

    if (next) {
      socketClientRef.current?.send({
        type: 'gemini.clientContent',
        payload: {
          turns: [
            {
              role: 'user',
              parts: [
                {
                  text: 'Mic activated. Ready for creative tool-call instructions.',
                },
              ],
            },
          ],
          turnComplete: true,
        },
      });
    }
  };

  return (
    <div className='h-screen w-screen bg-background p-6 text-foreground'>
      <Card className='relative h-full w-full overflow-hidden rounded-[2rem] border-2 border-border'>
        <div className='absolute left-6 top-6 z-10'>
          <Badge variant='outline' className='bg-background px-4 py-2 text-sm'>
            {projectName}
          </Badge>
        </div>

        <div className='absolute right-6 top-6 z-10'>
          <Button variant='outline' size='icon' className='rounded-full'>
            <User className='h-5 w-5' />
          </Button>
          <p className='mt-1 text-right text-xs text-muted-foreground'>
            {userName || 'profile'}
          </p>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          className='bg-background'>
          <MiniMap pannable zoomable />
          <Controls />
          <Background gap={24} size={1} />
        </ReactFlow>

        <div className='absolute bottom-6 left-1/2 z-10 -translate-x-1/2'>
          <Button
            variant={micActive ? 'default' : 'outline'}
            className='min-w-28 rounded-2xl'
            onClick={toggleMic}>
            {micActive ? (
              <Mic className='mr-2 h-4 w-4' />
            ) : (
              <MicOff className='mr-2 h-4 w-4' />
            )}
            Mic
          </Button>
          <p className='mt-1 text-center text-xs text-muted-foreground'>
            {connected
              ? 'voice socket connected'
              : 'connecting voice socket...'}
          </p>
        </div>
      </Card>
    </div>
  );
}

export default App;
