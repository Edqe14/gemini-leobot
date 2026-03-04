import { Component, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { CanvasPage } from '@/pages/canvas-page';
import { DebugMonitorPage } from '@/pages/debug-monitor-page';

function App() {
  return (
    <AppErrorBoundary>
      <Routes>
        <Route path='/' element={<CanvasPage />} />
        <Route path='/debug' element={<DebugMonitorPage />} />
        <Route path='*' element={<Navigate to='/' replace />} />
      </Routes>
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
            <p className='mt-2 break-all text-xs text-muted-foreground'>
              {this.state.message}
            </p>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default App;
