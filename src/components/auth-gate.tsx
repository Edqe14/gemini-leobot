import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { authBaseUrl, authClient } from '@/lib/auth-client';

type AuthState = 'loading' | 'authenticated' | 'unauthenticated';

type AuthGateProps = {
  children: (context: { userName: string }) => ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const location = useLocation();
  const [authState, setAuthState] = useState<AuthState>('loading');
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
          callbackURL: `${window.location.origin}${location.pathname}`,
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
            Login with Google to continue.
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

  return <>{children({ userName })}</>;
}
