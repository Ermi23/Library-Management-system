import { Link, Route, Routes } from 'react-router';
import { RequireRole } from '@/auth/RequireRole';
import { StaffLayout } from '@/components/StaffLayout';
import { AuditPage } from '@/pages/admin/AuditPage';
import { BranchesPage } from '@/pages/admin/BranchesPage';
import { NoticesPage } from '@/pages/admin/NoticesPage';
import { ReportsPage } from '@/pages/admin/ReportsPage';
import { SettingsPage } from '@/pages/admin/SettingsPage';
import { UsersPage } from '@/pages/admin/UsersPage';
import { BiblioDetailPage } from '@/pages/catalog/BiblioDetailPage';
import { BiblioEditorPage } from '@/pages/catalog/BiblioEditorPage';
import { CatalogPage } from '@/pages/catalog/CatalogPage';
import { ImportExportPage } from '@/pages/catalog/ImportExportPage';
import { ItemDetailPage } from '@/pages/catalog/ItemDetailPage';
import { LabelsPage } from '@/pages/catalog/LabelsPage';
import { CirculationPage } from '@/pages/circulation/CirculationPage';
import { FinesPage } from '@/pages/circulation/FinesPage';
import { HoldsPage } from '@/pages/circulation/HoldsPage';
import { LoansPage } from '@/pages/circulation/LoansPage';
import { TransfersPage } from '@/pages/circulation/TransfersPage';
import { AcquisitionsPage, OrderDetailPage } from '@/pages/collection/AcquisitionsPage';
import { InventoryPage, InventorySessionPage } from '@/pages/collection/InventoryPage';
import { SerialsPage, SubscriptionPage } from '@/pages/collection/SerialsPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { AccountPage } from '@/pages/opac/AccountPage';
import { OpacHomePage } from '@/pages/opac/OpacHomePage';
import { OpacLayout } from '@/pages/opac/OpacLayout';
import { OpacRecordPage } from '@/pages/opac/OpacRecordPage';
import { OpacSearchPage } from '@/pages/opac/OpacSearchPage';
import { PatronDetailPage } from '@/pages/patrons/PatronDetailPage';
import { PatronsPage } from '@/pages/patrons/PatronsPage';

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="text-sm text-slate-500">The page may have moved, or the link is wrong.</p>
      <Link to="/" className="text-brand-600 hover:underline">Go to the catalog</Link>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<OpacLayout />}>
        <Route index element={<OpacHomePage />} />
        <Route path="search" element={<OpacSearchPage />} />
        <Route path="record/:id" element={<OpacRecordPage />} />
        <Route
          path="account"
          element={
            <RequireRole roles={['PATRON', 'LIBRARIAN', 'ADMIN']}>
              <AccountPage />
            </RequireRole>
          }
        />
      </Route>

      <Route
        path="/staff"
        element={
          <RequireRole roles={['ADMIN', 'LIBRARIAN']}>
            <StaffLayout />
          </RequireRole>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="circulation" element={<CirculationPage />} />
        <Route path="circulation/loans" element={<LoansPage />} />
        <Route path="holds" element={<HoldsPage />} />
        <Route path="transfers" element={<TransfersPage />} />
        <Route path="fines" element={<FinesPage />} />

        <Route path="catalog" element={<CatalogPage />} />
        <Route path="catalog/new" element={<BiblioEditorPage />} />
        <Route path="catalog/:id" element={<BiblioDetailPage />} />
        <Route path="catalog/:id/edit" element={<BiblioEditorPage />} />
        <Route path="items/:id" element={<ItemDetailPage />} />
        <Route path="labels" element={<LabelsPage />} />
        <Route path="import" element={<ImportExportPage />} />

        <Route path="patrons" element={<PatronsPage />} />
        <Route path="patrons/:id" element={<PatronDetailPage />} />

        <Route path="inventory" element={<InventoryPage />} />
        <Route path="inventory/:id" element={<InventorySessionPage />} />
        <Route path="acquisitions" element={<AcquisitionsPage />} />
        <Route path="acquisitions/orders/:id" element={<OrderDetailPage />} />
        <Route path="serials" element={<SerialsPage />} />
        <Route path="serials/:id" element={<SubscriptionPage />} />

        <Route path="reports" element={<ReportsPage />} />
        <Route path="notices" element={<NoticesPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="branches" element={<BranchesPage />} />
        <Route
          path="settings"
          element={
            <RequireRole roles={['ADMIN']}>
              <SettingsPage />
            </RequireRole>
          }
        />
        <Route
          path="audit"
          element={
            <RequireRole roles={['ADMIN']}>
              <AuditPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
