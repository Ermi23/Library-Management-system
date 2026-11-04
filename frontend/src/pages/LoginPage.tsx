import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { BookOpen } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { usePublicSettings, useTitle } from '@/lib/hooks';
import { Button, ErrorMessage, Field, Input } from '@/components/ui';
import { isStaff, type User } from '@/lib/types';

function homeFor(user: User) {
  return isStaff(user.role) ? '/staff' : '/account';
}

export function LoginPage() {
  useTitle('Sign in');
  const { user, login } = useAuth();
  const settings = usePublicSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={homeFor(user)} replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const signedIn = await login(identifier, password);
      // Patrons cannot use staff pages, so ignore a "from" that points there.
      const target = from && (isStaff(signedIn.role) || !from.startsWith('/staff')) ? from : homeFor(signedIn);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-900 to-brand-700 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-brand-50">
            <BookOpen className="size-6 text-brand-600" />
          </div>
          <h1 className="text-xl font-semibold text-slate-900">{settings.data?.libraryName ?? 'Library'}</h1>
          <p className="mt-1 text-sm text-slate-500">Members and staff sign in here.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email or library card number">
            <Input autoFocus autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <ErrorMessage error={error} />
          <Button type="submit" className="w-full" loading={submitting}>
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link to="/" className="text-brand-600 hover:underline">
            Browse the catalog without signing in
          </Link>
        </p>
      </div>
    </div>
  );
}
