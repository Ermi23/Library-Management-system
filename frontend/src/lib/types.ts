export type Role = 'ADMIN' | 'LIBRARIAN' | 'PATRON';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
export type ItemStatus =
  | 'AVAILABLE'
  | 'ON_LOAN'
  | 'ON_HOLD_SHELF'
  | 'IN_TRANSIT'
  | 'IN_PROCESSING'
  | 'LOST'
  | 'DAMAGED'
  | 'MISSING'
  | 'WITHDRAWN';
export type HoldStatus = 'PENDING' | 'IN_TRANSIT' | 'READY' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED';
export type FineStatus = 'OUTSTANDING' | 'PAID' | 'WAIVED';

export interface BranchRef {
  id: string;
  code?: string;
  name: string;
}

export interface Branch extends BranchRef {
  code: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: string;
  _count?: { homeItems: number; users: number };
}

export interface PatronCategory {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  enrolmentPeriodMonths?: number;
  _count?: { users: number };
}

export interface ItemType {
  id: string;
  code: string;
  name: string;
  notForLoan: boolean;
  _count?: { items: number };
}

export interface User {
  id: string;
  email: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  address: string | null;
  role: Role;
  status: UserStatus;
  cardNumber: string | null;
  dateOfBirth: string | null;
  expiresAt: string | null;
  notes: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  homeBranch: BranchRef | null;
  patronCategory: PatronCategory | null;
  _count?: { loans: number };
}

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface Availability {
  total: number;
  available: number;
  onLoan: number;
  branches: { id: string; name: string; available: number; total: number }[];
  callNumber: string | null;
  itemTypes: string[];
}

export interface BiblioSummary {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  isbn13: string | null;
  publisher: string | null;
  publicationYear: number | null;
  edition: string | null;
  ddc: string | null;
  series: string | null;
  language: string | null;
  coverUrl: string | null;
  subjects: string[];
  activeHolds: number;
  availability: Availability;
}

export interface BiblioFields {
  title: string;
  subtitle: string | null;
  authors: string[];
  isbn13: string | null;
  isbn10: string | null;
  issn: string | null;
  publisher: string | null;
  publicationPlace: string | null;
  publicationYear: number | null;
  edition: string | null;
  physicalDescription: string | null;
  language: string | null;
  ddc: string | null;
  subjects: string[];
  series: string | null;
  summary: string | null;
  notes: string | null;
  coverUrl: string | null;
}

export interface PatronRef {
  id: string;
  firstName: string;
  lastName: string;
  cardNumber: string | null;
}

export interface Item {
  id: string;
  barcode: string;
  biblioId: string;
  callNumber: string | null;
  shelfLocation: string | null;
  enumeration: string | null;
  copyNumber: number | null;
  status: ItemStatus;
  price: string | null;
  acquiredAt: string | null;
  lastSeenAt: string | null;
  notes: string | null;
  itemType: ItemType;
  homeBranch: BranchRef;
  currentBranch: BranchRef;
  createdAt: string;
}

export interface Loan {
  id: string;
  checkedOutAt: string;
  dueAt: string;
  returnedAt: string | null;
  renewals: number;
  overdue?: boolean;
  accruedFine?: number;
  item: { id: string; barcode: string; callNumber: string | null; biblio: { id: string; title: string; authors?: string[] } };
  patron?: PatronRef & { email?: string | null; phone?: string | null };
  branch?: BranchRef;
}

export interface Hold {
  id: string;
  status: HoldStatus;
  placedAt: string;
  readyAt: string | null;
  expiresAt: string | null;
  notes: string | null;
  biblio: { id: string; title: string; authors?: string[] };
  patron?: PatronRef & { phone?: string | null; email?: string | null };
  pickupBranch: BranchRef;
  item: { id: string; barcode: string; callNumber?: string | null } | null;
  expired?: boolean;
  position?: number | null;
}

export interface Fine {
  id: string;
  type: 'OVERDUE' | 'LOST' | 'DAMAGE' | 'MANUAL';
  status: FineStatus;
  amount: string;
  outstanding: string;
  description: string | null;
  createdAt: string;
  patron?: PatronRef;
  loan?: { id: string; item: { barcode: string; biblio: { title: string } } } | null;
}

export interface Block {
  code: string;
  message: string;
}

export interface PatronSummary {
  patron: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    cardNumber: string | null;
    role: Role;
    status: UserStatus;
    expiresAt: string | null;
    notes: string | null;
    patronCategory: { id: string; name: string } | null;
    homeBranch: { id: string; name: string } | null;
    address?: string | null;
    dateOfBirth?: string | null;
    createdAt?: string;
    lastLoginAt?: string | null;
  };
  loans: Loan[];
  holds: Hold[];
  outstanding: number;
  blocks: Block[];
  currency: string;
  totalLoans?: number;
}

export interface PublicSettings {
  libraryName: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  allowOpacHolds: boolean;
  allowPatronRenewal: boolean;
}

export const isStaff = (role?: Role) => role === 'ADMIN' || role === 'LIBRARIAN';
