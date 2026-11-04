import { useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router';
import { BookOpen, LayoutDashboard, LogIn, LogOut, Search, UserRound } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { usePublicSettings } from '@/lib/hooks';
import { isStaff } from '@/lib/types';
import { Button, cn } from '@/components/ui';

/** Public catalog shell: header with search, account link and footer with library contact details. */
export function OpacLayout() {
  const { user, logout } = useAuth();
  const settings = usePublicSettings();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');

  function search(e: FormEvent) {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <BookOpen className="size-6 text-brand-600" />
            <span>{settings.data?.libraryName ?? 'Library catalog'}</span>
          </Link>
          <form onSubmit={search} className="order-last flex w-full gap-2 sm:order-none sm:ml-6 sm:w-auto sm:flex-1">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                className="h-9 w-full rounded-lg border border-slate-300 bg-slate-50 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                placeholder="Search the catalog"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search the catalog"
              />
            </div>
          </form>
          <nav className="ml-auto flex items-center gap-1 text-sm">
            {user && isStaff(user.role) && (
              <Link to="/staff"><Button variant="ghost" size="sm"><LayoutDashboard className="size-4" /> Staff</Button></Link>
            )}
            {user ? (
              <>
                <NavLink to="/account" className={({ isActive }) => cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100')}>
                  <UserRound className="size-4" /> {user.firstName}
                </NavLink>
                <Button variant="ghost" size="sm" onClick={() => logout().then(() => navigate('/'))} aria-label="Sign out"><LogOut className="size-4" /></Button>
              </>
            ) : (
              <Link to="/login"><Button variant="secondary" size="sm"><LogIn className="size-4" /> Sign in</Button></Link>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-4 text-xs text-slate-500">
          <span>{settings.data?.libraryName}</span>
          <span>{[settings.data?.address, settings.data?.phone, settings.data?.email].filter(Boolean).join(' · ')}</span>
        </div>
      </footer>
    </div>
  );
}
