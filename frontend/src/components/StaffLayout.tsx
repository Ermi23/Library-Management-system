import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  BookCopy,
  BookOpen,
  Bookmark,
  Building2,
  ClipboardList,
  FileUp,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Newspaper,
  Receipt,
  ScrollText,
  Settings,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { BRANCH_STORAGE_KEY } from '@/lib/api';
import { useBranches, usePublicSettings } from '@/lib/hooks';
import type { Role } from '@/lib/types';
import { cn } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
  end?: boolean;
}

const NAV: { heading?: string; items: NavItem[] }[] = [
  { items: [{ to: '/staff', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    heading: 'Circulation',
    items: [
      { to: '/staff/circulation', label: 'Check out / in', icon: ArrowLeftRight, end: true },
      { to: '/staff/circulation/loans', label: 'Loans & overdues', icon: BookCopy },
      { to: '/staff/holds', label: 'Holds', icon: Bookmark },
      { to: '/staff/transfers', label: 'Transfers', icon: Truck },
      { to: '/staff/fines', label: 'Fines & payments', icon: Receipt },
    ],
  },
  {
    heading: 'Catalog',
    items: [
      { to: '/staff/catalog', label: 'Catalog', icon: BookOpen },
      { to: '/staff/import', label: 'Import / export MARC', icon: FileUp },
    ],
  },
  { heading: 'People', items: [{ to: '/staff/patrons', label: 'Patrons', icon: Users }] },
  {
    heading: 'Collection',
    items: [
      { to: '/staff/inventory', label: 'Inventory', icon: ClipboardList },
      { to: '/staff/acquisitions', label: 'Acquisitions', icon: ShoppingCart },
      { to: '/staff/serials', label: 'Serials', icon: Newspaper },
    ],
  },
  {
    heading: 'Insights',
    items: [
      { to: '/staff/reports', label: 'Reports', icon: BarChart3 },
      { to: '/staff/notices', label: 'Notices', icon: Bell },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { to: '/staff/users', label: 'Staff & users', icon: UserCog },
      { to: '/staff/branches', label: 'Branches', icon: Building2 },
      { to: '/staff/settings', label: 'Settings', icon: Settings, roles: ['ADMIN'] },
      { to: '/staff/audit', label: 'Audit log', icon: ScrollText, roles: ['ADMIN'] },
    ],
  },
];

function readBranch(): string {
  try {
    return localStorage.getItem(BRANCH_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function StaffLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const branches = useBranches();
  const settings = usePublicSettings();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [branchId, setBranchId] = useState(readBranch);

  // Default the working branch to the user's home branch (or the first branch).
  useEffect(() => {
    if (branchId || !branches.data?.length) return;
    const initial = user?.homeBranch?.id ?? branches.data.find((b) => b.isActive)?.id ?? '';
    if (initial) changeBranch(initial, false);
  }, [branches.data, user]);

  function changeBranch(id: string, refresh = true) {
    try {
      localStorage.setItem(BRANCH_STORAGE_KEY, id);
    } catch {
      // Storage unavailable: the backend falls back to the user's home branch.
    }
    setBranchId(id);
    if (refresh) queryClient.invalidateQueries();
  }

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const sidebar = (
    <nav className="flex h-full flex-col bg-brand-900 text-slate-200">
      <div className="flex items-center gap-2 px-5 py-4">
        <BookOpen className="size-6 text-brand-100" />
        <span className="truncate text-base font-semibold text-white">{settings.data?.libraryName ?? 'Library'}</span>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {NAV.map((group, gi) => {
          const items = group.items.filter((i) => !i.roles || (user && i.roles.includes(user.role)));
          if (!items.length) return null;
          return (
            <div key={gi}>
              {group.heading && <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-brand-100/60">{group.heading}</div>}
              <div className="space-y-0.5">
                {items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                        isActive ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white',
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/10 p-3">
        <NavLink to="/" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white">
          <Globe className="size-4" />
          Public catalog (OPAC)
        </NavLink>
      </div>
    </nav>
  );

  return (
    <div className="flex h-screen">
      <aside className="hidden w-60 shrink-0 lg:block print:hidden">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 print:hidden">
          <button className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <label className="flex items-center gap-2 text-sm">
            <Building2 className="hidden size-4 text-slate-400 sm:block" />
            <span className="hidden text-slate-500 sm:inline">Working at</span>
            <select
              value={branchId}
              onChange={(e) => changeBranch(e.target.value)}
              className="rounded-md border border-slate-300 bg-white py-1 pl-2 pr-7 text-sm font-medium text-slate-800 focus:border-brand-500 focus:outline-none"
              aria-label="Working branch"
            >
              {branches.data?.filter((b) => b.isActive).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right text-sm leading-tight sm:block">
              <div className="font-medium text-slate-900">
                {user?.firstName} {user?.lastName}
              </div>
              <div className="text-xs text-slate-500">{user?.role === 'ADMIN' ? 'Administrator' : 'Librarian'}</div>
            </div>
            <button onClick={handleLogout} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700" title="Sign out" aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 print:overflow-visible print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
