import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, LockKeyhole, ShieldCheck, UsersRound } from 'lucide-react';
import AdminWorkspace from './AdminWorkspace';
import LearnerWorkspace from './LearnerWorkspace';
import { isPortalAuthEnabled } from '../lib/auth-config';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type AccountRole = 'super_admin' | 'student' | 'parent';

async function resolvePortalRole(userId: string): Promise<AccountRole> {
  if (!supabase) {
    throw new Error('School database is not configured.');
  }

  const { data, error } = await supabase
    .from('user_accounts')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    throw new Error('Could not verify this account’s school access.');
  }

  if (
    data?.role === 'super_admin'
    || data?.role === 'student'
    || data?.role === 'parent'
  ) {
    return data.role;
  }
  throw new Error('This account does not have active school portal access.');
}

function PasswordChangePanel({
  busy,
  notice,
  purpose,
  onSubmit,
}: {
  busy: boolean;
  notice: string;
  purpose: 'first-login' | 'recovery';
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [formNotice, setFormNotice] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormNotice('');
    if (password !== confirmation) {
      setFormNotice('The passwords do not match.');
      return;
    }
    onSubmit(password);
  }

  return (
    <main className="page-shell">
      <header className="brand-header">
        <div className="brand-lockup" aria-label="Wisdom Source School">
          <span className="brand-monogram" aria-hidden="true">WS</span>
          <span className="brand-name">
            <strong>Wisdom Source School</strong>
            <span>Secure account setup</span>
          </span>
        </div>
      </header>
      <section className="password-change-card" aria-labelledby="password-change-heading">
        <div className="login-heading">
          <div className="login-icon"><LockKeyhole size={20} aria-hidden="true" /></div>
          <div>
            <span className="eyebrow">{purpose === 'recovery' ? 'Password recovery' : 'First sign-in'}</span>
            <h1 id="password-change-heading">
              {purpose === 'recovery' ? 'Choose a new password' : 'Choose a private password'}
            </h1>
          </div>
        </div>
        <p className="access-note">
          {purpose === 'recovery'
            ? 'Choose a new password that only you know. Use at least 12 characters.'
            : 'Before continuing, replace the temporary password with one only you know. Use at least 12 characters.'}
        </p>
        <form onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="new-password">New password</label>
          <input
            autoComplete="new-password"
            className="text-field"
            id="new-password"
            maxLength={128}
            minLength={12}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <label className="field-label password-label" htmlFor="confirm-password">
            Confirm new password
          </label>
          <input
            autoComplete="new-password"
            className="text-field"
            id="confirm-password"
            maxLength={128}
            minLength={12}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            type="password"
            value={confirmation}
          />
          <button className="sign-in-button" disabled={busy} type="submit">
            <span>{busy ? 'Updating password…' : 'Change password securely'}</span>
            <ArrowRight size={17} aria-hidden="true" />
          </button>
          {(formNotice || notice) && (
            <p className="form-notice" role="alert">{formNotice || notice}</p>
          )}
        </form>
      </section>
    </main>
  );
}

export default function App() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [accountRole, setAccountRole] = useState<AccountRole | null>(null);
  const [notice, setNotice] = useState('');
  const [workspaceNotice, setWorkspaceNotice] = useState('');
  const [requiresPasswordChange, setRequiresPasswordChange] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordChangeNotice, setPasswordChangeNotice] = useState('');
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [isRequestingRecovery, setIsRequestingRecovery] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [showRecoveryForm, setShowRecoveryForm] = useState(false);
  const authEnabled = isPortalAuthEnabled(
    isSupabaseConfigured,
    import.meta.env.VITE_AUTH_ENABLED,
  );

  useEffect(() => {
    let cancelled = false;

    if (!authEnabled || !supabase) {
      setIsCheckingSession(false);
      return undefined;
    }
    const { data: authSubscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        setIsPasswordRecovery(true);
        setRequiresPasswordChange(false);
        setAccountRole(null);
        setPasswordChangeNotice('');
      }
    });

    async function restoreSession() {
      if (!authEnabled || !supabase) {
        setIsCheckingSession(false);
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (error) {
        if (!cancelled) {
          setNotice('Could not verify your sign-in session. Please try again.');
          setIsCheckingSession(false);
        }
        return;
      }

      if (data.session?.user.app_metadata.must_change_password === true) {
        if (!cancelled) setRequiresPasswordChange(true);
      } else if (data.session?.user.id) {
        try {
          const role = await resolvePortalRole(data.session.user.id);
          if (!cancelled) setAccountRole(role);
        } catch {
          let signOutFailed = false;
          try {
            const { error: signOutError } = await supabase.auth.signOut();
            signOutFailed = Boolean(signOutError);
          } catch {
            signOutFailed = true;
          }
          if (!cancelled) {
            setNotice(signOutFailed
              ? 'Portal access could not be verified or cleared. Close this browser and contact the school.'
              : 'This account no longer has portal access. Please contact the school.');
          }
        }
      }
      if (!cancelled) setIsCheckingSession(false);
    }

    void restoreSession();
    return () => {
      cancelled = true;
      authSubscription.subscription.unsubscribe();
    };
  }, [authEnabled]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');

    if (!supabase || !authEnabled) {
      setNotice('Secure sign-in is not available yet. Do not enter real school credentials.');
      return;
    }

    setIsSigningIn(true);
    try {
      const { data, error } = await supabase.functions.invoke('login-by-id', {
        body: { loginId, password },
      });
      if (error || !data?.session?.access_token || !data?.session?.refresh_token) {
        setNotice('We could not sign you in. Check your login ID and password, or contact the school.');
        return;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (sessionError) {
        setNotice('We could not complete sign-in. Please try again or contact the school.');
        return;
      }
      if (!sessionData.user?.id) {
        const { error: signOutError } = await supabase.auth.signOut();
        setNotice(signOutError
          ? 'Portal access could not be verified or cleared. Close this browser and contact the school.'
          : 'We could not verify your school account. Please contact the school.');
        return;
      }

      if (sessionData.user.app_metadata.must_change_password === true) {
        setRequiresPasswordChange(true);
      } else {
        const role = await resolvePortalRole(sessionData.user.id);
        setAccountRole(role);
      }
    } catch {
      if (supabase) {
        let signOutFailed = false;
        try {
          const { error: signOutError } = await supabase.auth.signOut();
          signOutFailed = Boolean(signOutError);
        } catch {
          signOutFailed = true;
        }
        setNotice(signOutFailed
          ? 'Portal access could not be verified or cleared. Close this browser and contact the school.'
          : 'Portal access could not be verified. Please contact the school.');
      } else {
        setNotice('Sign-in is temporarily unavailable. Please try again later.');
      }
    } finally {
      setIsSigningIn(false);
      setPassword('');
    }
  }

  async function handleSignOut() {
    if (!supabase) {
      setNotice('School database is not configured.');
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      setWorkspaceNotice('Sign-out could not be confirmed. Close this browser and contact the school.');
      return;
    }
    setAccountRole(null);
    setLoginId('');
    setWorkspaceNotice('');
    setNotice('');
  }

  async function handlePasswordChange(newPassword: string) {
    if (!supabase) {
      setPasswordChangeNotice('School database is not configured.');
      return;
    }
    setIsChangingPassword(true);
    setPasswordChangeNotice('');
    try {
      const { error } = await supabase.functions.invoke('change-password', {
        body: { newPassword },
      });
      if (error) {
        setPasswordChangeNotice('Your password could not be changed. Please try again or contact the school.');
        return;
      }

      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setPasswordChangeNotice('Your password was updated, but this session could not be cleared. Close this browser and contact the school.');
        return;
      }
      setRequiresPasswordChange(false);
      setIsPasswordRecovery(false);
      setAccountRole(null);
      setLoginId('');
      setPassword('');
      setShowRecoveryForm(false);
      setRecoveryEmail('');
      setNotice('Your password has been changed. Sign in again with your new password.');
    } catch {
      setPasswordChangeNotice('Your password could not be changed. Please try again or contact the school.');
    } finally {
      setIsChangingPassword(false);
    }
  }

  async function requestPasswordRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !authEnabled || isRequestingRecovery) return;
    setIsRequestingRecovery(true);
    setRecoveryNotice('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail.trim(), {
        redirectTo: `${window.location.origin}/`,
      });
      if (error) {
        setRecoveryNotice('Password recovery is temporarily unavailable. Contact the school administrator.');
        return;
      }
      setRecoveryNotice('If this email belongs to a school administrator account, password recovery instructions will be sent.');
    } catch {
      setRecoveryNotice('Password recovery is temporarily unavailable. Contact the school administrator.');
    } finally {
      setIsRequestingRecovery(false);
    }
  }

  if (requiresPasswordChange || isPasswordRecovery) {
    return (
      <PasswordChangePanel
        busy={isChangingPassword}
        notice={passwordChangeNotice}
        purpose={isPasswordRecovery ? 'recovery' : 'first-login'}
        onSubmit={(newPassword) => void handlePasswordChange(newPassword)}
      />
    );
  }

  if (accountRole) {
    if (accountRole === 'super_admin') {
      return (
        <AdminWorkspace
          notice={workspaceNotice}
          onSignOut={() => void handleSignOut()}
        />
      );
    }
    return (
      <LearnerWorkspace
        notice={workspaceNotice}
        onSignOut={() => void handleSignOut()}
        role={accountRole}
      />
    );
  }

  return (
    <main className="page-shell">
      <header className="brand-header">
        <div className="brand-lockup" aria-label="Wisdom Source School">
          <span className="brand-monogram" aria-hidden="true">WS</span>
          <span className="brand-name">
            <strong>Wisdom Source School</strong>
            <span>School Portal</span>
          </span>
        </div>
        <span className="environment-badge">
          <span className="badge-dot" aria-hidden="true" />
          Secure setup in progress
        </span>
      </header>

      <section className="portal-grid" aria-labelledby="welcome-heading">
        <div className="welcome-panel">
          <div className="welcome-content">
            <span className="eyebrow">Wisdom Source School</span>
            <h1 id="welcome-heading">A clearer view of every school day.</h1>
            <p className="welcome-copy">
              A private place for school leadership, students, and families to stay connected
              to learning.
            </p>
            <div className="trust-note">
              <ShieldCheck size={19} strokeWidth={1.8} aria-hidden="true" />
              <span>School records are designed to be protected by individual accounts.</span>
            </div>
          </div>
          <div className="welcome-decoration" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <div className="decoration-star star-one">✳</div>
            <div className="decoration-star star-two">✳</div>
          </div>
          <span className="welcome-footer">Learning · Growth · Community</span>
        </div>

        <div className="login-panel">
          <div className="login-heading">
            <div className="login-icon"><UsersRound size={20} aria-hidden="true" /></div>
            <div>
              <span className="eyebrow">Welcome</span>
              <h2>Sign in to your portal</h2>
            </div>
          </div>

          <p className="login-instructions">
            Students use their serial; parents use their own login ID; administrators
            use their approved account identifier.
          </p>

          <form onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="login-id">Login ID or admin email</label>
            <input
              autoComplete="username"
              className="text-field"
              id="login-id"
              disabled={!authEnabled || isSigningIn}
              maxLength={254}
              onChange={(event) => setLoginId(event.target.value)}
              placeholder={authEnabled ? 'Enter your login ID' : 'Available after secure setup'}
              required
              value={loginId}
            />

            <label className="field-label password-label" htmlFor="password">Password</label>
            <div className="password-wrap">
              <input
                autoComplete="current-password"
                className="text-field"
                disabled={!authEnabled || isSigningIn}
                id="password"
                maxLength={1024}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={authEnabled ? 'Enter your password' : 'Available after secure setup'}
                required
                type="password"
                value={password}
              />
            </div>

            <button className="sign-in-button" disabled={!authEnabled || isSigningIn || isCheckingSession} type="submit">
              <span>
                {isCheckingSession
                  ? 'Checking session…'
                  : isSigningIn ? 'Signing in…' : 'Continue securely'}
              </span>
              <ArrowRight size={17} aria-hidden="true" />
            </button>
            {notice && <p className="form-notice" role="alert">{notice}</p>}
          </form>

          <button
            className="recovery-toggle"
            disabled={!authEnabled || isSigningIn}
            onClick={() => {
              setShowRecoveryForm((current) => !current);
              setRecoveryNotice('');
            }}
            type="button"
          >
            Forgot an administrator password?
          </button>
          {showRecoveryForm && (
            <form className="recovery-form" onSubmit={(event) => void requestPasswordRecovery(event)}>
              <p className="access-note">
                Email recovery is available only for administrator accounts with a verified email address.
                Students and parents should contact the school to request a temporary password.
              </p>
              <label className="field-label" htmlFor="recovery-email">Administrator email</label>
              <input
                autoComplete="email"
                className="text-field"
                disabled={isRequestingRecovery}
                id="recovery-email"
                maxLength={254}
                onChange={(event) => setRecoveryEmail(event.target.value)}
                required
                type="email"
                value={recoveryEmail}
              />
              <button className="sign-in-button" disabled={isRequestingRecovery} type="submit">
                <span>{isRequestingRecovery ? 'Requesting instructions…' : 'Send recovery instructions'}</span>
              </button>
              {recoveryNotice && <p className="form-notice" role="status">{recoveryNotice}</p>}
            </form>
          )}

          <div className="divider"><span>PORTAL ACCESS</span></div>
          <p className="access-note">
            Each account has its own private password. Parents use a separate parent
            account and can access only children linked to them by the school.
          </p>
          <p className="setup-note" role="status">
            {!isSupabaseConfigured && 'The school database is not connected. '}
            {authEnabled
              ? 'Sign-in is enabled for this environment. Do not use real student records until database/RLS testing and independent security review are complete.'
              : 'Secure sign-in is not enabled. Do not enter real credentials or student information here.'}
          </p>
        </div>
      </section>

      <footer className="page-footer">
        <span>© {new Date().getFullYear()} Wisdom Source School</span>
        <span className="footer-separator" aria-hidden="true">·</span>
        <span>Private school portal</span>
      </footer>
    </main>
  );
}
