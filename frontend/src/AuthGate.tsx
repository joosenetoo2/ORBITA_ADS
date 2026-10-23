import { useEffect, useState, type FormEvent } from 'react';
import { CircleAlert, Eye, EyeOff, Loader2, LockKeyhole, LogIn } from 'lucide-react';
import App from './App';
import './auth.css';

export type AuthUser = { id: number; username: string; name: string; is_superuser: boolean; groups: string[] };
type AuthSession = { authenticated: boolean; user: AuthUser | null };

function csrfToken() {
  return document.cookie.split('; ').find((part) => part.startsWith('csrftoken='))?.split('=')[1] ?? '';
}

async function authRequest(path: string, init: RequestInit = {}): Promise<AuthSession> {
  const response = await fetch(`/api/v1/auth/${path}/`, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.method === 'POST' ? { 'X-CSRFToken': csrfToken() } : {}),
      ...init.headers
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      body.message ?? (response.status === 403 ? 'Sessão ou proteção CSRF inválida. Atualize a página e tente novamente.' : 'Não foi possível acessar o servidor.')
    );
  }
  return body as AuthSession;
}

export default function AuthGate() {
  const [state, setState] = useState<'loading' | 'anonymous' | 'authenticated' | 'unavailable'>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function checkSession() {
    setState('loading');
    setError('');
    try {
      const session = await authRequest('session');
      setUser(session.user);
      setState(session.authenticated && session.user ? 'authenticated' : 'anonymous');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Servidor indisponível.');
      setState('unavailable');
    }
  }

  useEffect(() => {
    void checkSession();
  }, []);

  useEffect(() => {
    const handleExpiry = () => {
      setUser(null);
      setPassword('');
      setState('anonymous');
      setError('Sua sessão terminou. Entre novamente.');
    };
    window.addEventListener('orbita:auth-expired', handleExpiry);
    return () => window.removeEventListener('orbita:auth-expired', handleExpiry);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await authRequest('login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      setUser(session.user);
      setPassword('');
      setState('authenticated');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha na autenticação.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await authRequest('logout', { method: 'POST' });
      setUser(null);
      setPassword('');
      setState('anonymous');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao encerrar sessão.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'authenticated' && user) {
    return <App user={user} onLogout={signOut} authError={error} />;
  }

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="auth-orbit" aria-hidden="true"></div>
        <div>
          <strong>ÓRBITA</strong>
          <small>ACADÊMICO</small>
        </div>
      </div>

      <main className="auth-card" aria-live={state === 'loading' ? 'polite' : 'off'}>
        {state === 'loading' ? (
          <div className="auth-loading">
            <Loader2 size={32} className="spinning" style={{ color: 'var(--color-secondary)' }} />
            <p>Conectando ao Órbita Acadêmico…</p>
          </div>
        ) : state === 'unavailable' ? (
          <>
            <div className="auth-icon-wrap" style={{ background: 'var(--color-destructive-bg)', color: 'var(--color-destructive)' }}>
              <CircleAlert size={26} />
            </div>
            <h1>Conexão indisponível</h1>
            <p>Não foi possível comunicar com o servidor backend. Verifique se a aplicação está em execução.</p>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="button primary auth-submit" onClick={() => void checkSession()}>
              Tentar novamente
            </button>
          </>
        ) : (
          <>
            <div className="auth-icon-wrap">
              <LockKeyhole size={25} />
            </div>
            <h1>Acesso à plataforma</h1>
            <p>Entre com as credenciais acadêmicas fornecidas pela instituição.</p>

            <form onSubmit={submit}>
              <label>
                Usuário ou e-mail
                <input
                  required
                  type="text"
                  autoComplete="username"
                  placeholder="Seu usuário acadêmico"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoFocus
                />
              </label>

              <label>
                Senha de acesso
                <span className="auth-password">
                  <input
                    required
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Sua senha secreta"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                    title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>

              {error && (
                <div className="auth-error" role="alert">
                  <CircleAlert size={16} />
                  <span>{error}</span>
                </div>
              )}

              <button className="button primary auth-submit" disabled={busy} type="submit">
                {busy ? (
                  <>
                    <Loader2 size={17} className="spinning" />
                    <span>Autenticando…</span>
                  </>
                ) : (
                  <>
                    <LogIn size={17} />
                    <span>Entrar na plataforma</span>
                  </>
                )}
              </button>
            </form>
          </>
        )}
      </main>

      <span className="auth-foot">Órbita Acadêmico · Gestão Inteligente de Horários</span>
    </div>
  );
}
