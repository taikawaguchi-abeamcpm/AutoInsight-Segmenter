import { LogIn, ShieldCheck } from 'lucide-react';
import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useState } from 'react';
import { completeOnboarding, getAuthSession, signIn, signOut } from '../../services/auth/authApi';
import type { AuthSession } from '../../types/auth';
import { Button, Card, Field } from '../common/ui';

type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'error';

const AuthSessionContext = createContext<AuthSession | null>(null);

export const useAuthSession = () => useContext(AuthSessionContext);

export const AuthGate = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const nextSession = await getAuthSession();
      setSession(nextSession);
      setStatus(nextSession ? 'authenticated' : 'anonymous');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Authentication check failed.');
      setStatus('error');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  if (status === 'loading') {
    return (
      <AuthLayout>
        <Card className="auth-panel">
          <ShieldCheck aria-hidden="true" />
          <h1>会員情報を確認しています</h1>
          <p>認証状態と登録済みプロフィールを読み込んでいます。</p>
        </Card>
      </AuthLayout>
    );
  }

  if (status === 'error') {
    return (
      <AuthLayout>
        <Card className="auth-panel">
          <ShieldCheck aria-hidden="true" />
          <h1>認証状態を確認できません</h1>
          <p>{errorMessage}</p>
          <div className="actions">
            <Button type="button" onClick={refresh}>
              再試行
            </Button>
            <Button type="button" variant="secondary" onClick={signIn}>
              <LogIn aria-hidden="true" />
              ログイン
            </Button>
          </div>
        </Card>
      </AuthLayout>
    );
  }

  if (!session) {
    return (
      <AuthLayout>
        <Card className="auth-panel">
          <ShieldCheck aria-hidden="true" />
          <h1>AutoInsight Segmenter</h1>
          <p>Microsoft Entra External IDでログインして、分析ワークスペースを開始します。</p>
          <Button type="button" onClick={signIn}>
            <LogIn aria-hidden="true" />
            ログイン / 会員登録
          </Button>
        </Card>
      </AuthLayout>
    );
  }

  if (session.onboardingRequired) {
    return (
      <AuthLayout>
        <OnboardingForm session={session} onCompleted={(nextSession) => setSession(nextSession)} />
      </AuthLayout>
    );
  }

  return <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>;
};

const AuthLayout = ({ children }: { children: ReactNode }) => <main className="auth-layout">{children}</main>;

const OnboardingForm = ({
  session,
  onCompleted
}: {
  session: AuthSession;
  onCompleted: (session: AuthSession) => void;
}) => {
  const [displayName, setDisplayName] = useState(session.user.displayName || '');
  const [tenantName, setTenantName] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    try {
      onCompleted(await completeOnboarding({ displayName, tenantName, acceptedTerms }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Registration could not be completed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="auth-panel onboarding-panel">
      <ShieldCheck aria-hidden="true" />
      <h1>会員登録</h1>
      <p>初回利用に必要なプロフィールとワークスペースを作成します。</p>
      <form className="onboarding-form" onSubmit={submit}>
        <Field label="表示名">
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
        </Field>
        <Field label="組織 / ワークスペース名">
          <input value={tenantName} onChange={(event) => setTenantName(event.target.value)} required />
        </Field>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
          />
          <span>利用規約とプライバシーポリシーに同意します。</span>
        </label>
        {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
        <div className="actions">
          <Button type="submit" disabled={submitting}>
            登録して開始
          </Button>
          <Button type="button" variant="secondary" onClick={signOut}>
            ログアウト
          </Button>
        </div>
      </form>
    </Card>
  );
};
