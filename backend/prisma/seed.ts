// Seeds reference data and demo accounts; safe to run more than once (Docker runs it on every start).
// Demo catalog/circulation data is only added to an empty catalog, and can be turned off with SEED_DEMO=false.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';
import { normalizeIsbn } from '../src/lib/isbn.js';
import { buildCallNumber } from '../src/lib/callNumber.js';
import { buildSearchFields } from '../src/lib/text.js';
import { addDays, addMonths, endOfDay } from '../src/lib/dates.js';
import { generateItemBarcodes, reserveNumbers } from '../src/lib/counters.js';

const prisma = new PrismaClient();

async function seedReferenceData() {
  const password = process.env.SEED_PASSWORD || 'Library@123';
  const passwordHash = await bcrypt.hash(password, 10);

  const mainBranch = await prisma.branch.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: { code: 'MAIN', name: 'Main Library', address: '1 Library Road', phone: '+1 555 0100' },
  });
  await prisma.branch.upsert({
    where: { code: 'EAST' },
    update: {},
    create: { code: 'EAST', name: 'East Branch', address: '25 East Avenue', phone: '+1 555 0125' },
  });

  const itemTypes = [
    { code: 'BOOK', name: 'Book', notForLoan: false },
    { code: 'REF', name: 'Reference (library use only)', notForLoan: true },
    { code: 'DVD', name: 'DVD', notForLoan: false },
    { code: 'MAG', name: 'Magazine', notForLoan: false },
  ];
  for (const t of itemTypes) {
    await prisma.itemType.upsert({ where: { code: t.code }, update: {}, create: t });
  }

  const categories = [
    { code: 'ADULT', name: 'Adult', enrolmentPeriodMonths: 12 },
    { code: 'STUDENT', name: 'Student', enrolmentPeriodMonths: 12 },
    { code: 'CHILD', name: 'Child', enrolmentPeriodMonths: 12 },
    { code: 'STAFF', name: 'Staff', enrolmentPeriodMonths: 60 },
  ];
  for (const c of categories) {
    await prisma.patronCategory.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  // Library-wide default loan policy, plus shorter loans for DVDs and magazines.
  const rules = [
    { itemCode: null, loanPeriodDays: 14, maxLoans: 5, maxRenewals: 2, finePerDay: '0.50', maxFine: '10.00' },
    { itemCode: 'DVD', loanPeriodDays: 7, maxLoans: 3, maxRenewals: 1, finePerDay: '1.00', maxFine: '10.00' },
    { itemCode: 'MAG', loanPeriodDays: 7, maxLoans: 5, maxRenewals: 1, finePerDay: '0.25', maxFine: '5.00' },
  ];
  for (const r of rules) {
    const itemTypeId = r.itemCode ? (await prisma.itemType.findUniqueOrThrow({ where: { code: r.itemCode } })).id : null;
    const exists = await prisma.circulationRule.findFirst({ where: { branchId: null, patronCategoryId: null, itemTypeId } });
    if (!exists) {
      await prisma.circulationRule.create({
        data: {
          itemTypeId,
          loanPeriodDays: r.loanPeriodDays,
          maxLoans: r.maxLoans,
          maxRenewals: r.maxRenewals,
          maxHolds: 5,
          holdPickupDays: 7,
          finePerDay: r.finePerDay,
          maxFine: r.maxFine,
        },
      });
    }
  }

  await prisma.setting.upsert({
    where: { key: 'library' },
    update: {},
    create: { key: 'library', value: { libraryName: 'City Library', currency: 'USD' } },
  });

  const adult = await prisma.patronCategory.findUniqueOrThrow({ where: { code: 'ADULT' } });
  const users = [
    { email: 'admin@library.local', firstName: 'System', lastName: 'Admin', role: Role.ADMIN },
    { email: 'librarian@library.local', firstName: 'Lena', lastName: 'Librarian', role: Role.LIBRARIAN },
    {
      email: 'patron@library.local',
      firstName: 'Pat',
      lastName: 'Reader',
      role: Role.PATRON,
      cardNumber: '1000000001',
      patronCategoryId: adult.id,
      expiresAt: addMonths(new Date(), 12),
    },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash, homeBranchId: mainBranch.id },
    });
  }

  console.log('Reference data ready. Demo accounts (password: %s):', password);
  for (const u of users) console.log(`  ${u.role.padEnd(9)} ${u.email}`);
}

const DEMO_TITLES = [
  { title: 'The pragmatic programmer', subtitle: 'your journey to mastery', authors: ['Thomas, David', 'Hunt, Andrew'], isbn: '9780135957059', publisher: 'Addison-Wesley', publicationPlace: 'Boston', publicationYear: 2019, edition: '20th anniversary edition', physicalDescription: 'xxii, 321 pages', ddc: '005.1', subjects: ['Computer programming', 'Software engineering'], copies: 3 },
  { title: 'Clean code', subtitle: 'a handbook of agile software craftsmanship', authors: ['Martin, Robert C.'], isbn: '9780132350884', publisher: 'Prentice Hall', publicationPlace: 'Upper Saddle River, NJ', publicationYear: 2009, physicalDescription: 'xxix, 431 pages', ddc: '005.1', subjects: ['Agile software development', 'Computer software -- Reliability'], copies: 2 },
  { title: 'Introduction to algorithms', authors: ['Cormen, Thomas H.', 'Leiserson, Charles E.', 'Rivest, Ronald L.', 'Stein, Clifford'], isbn: '9780262033848', publisher: 'MIT Press', publicationPlace: 'Cambridge, Mass.', publicationYear: 2009, edition: '3rd ed.', physicalDescription: 'xix, 1292 pages', ddc: '005.1', subjects: ['Computer programming', 'Computer algorithms'], copies: 2 },
  { title: 'Sapiens', subtitle: 'a brief history of humankind', authors: ['Harari, Yuval Noah'], isbn: '9780062316097', publisher: 'Harper', publicationPlace: 'New York', publicationYear: 2015, physicalDescription: '443 pages', ddc: '909', subjects: ['Civilization -- History', 'Human beings -- History'], copies: 3 },
  { title: 'A brief history of time', authors: ['Hawking, Stephen'], isbn: '9780553380163', publisher: 'Bantam Books', publicationPlace: 'New York', publicationYear: 1998, edition: '10th anniversary ed.', physicalDescription: 'x, 212 pages', ddc: '523.1', subjects: ['Cosmology', 'Black holes (Astronomy)'], copies: 2 },
  { title: 'To kill a mockingbird', authors: ['Lee, Harper'], isbn: '9780061120084', publisher: 'Harper Perennial Modern Classics', publicationPlace: 'New York', publicationYear: 2006, physicalDescription: '323 pages', ddc: '813.54', subjects: ['Race relations -- Fiction', 'Alabama -- Fiction'], copies: 3 },
  { title: 'Nineteen eighty-four', authors: ['Orwell, George'], isbn: '9780451524935', publisher: 'Signet Classics', publicationPlace: 'New York', publicationYear: 1961, physicalDescription: '328 pages', ddc: '823.912', subjects: ['Totalitarianism -- Fiction', 'Dystopias'], copies: 2 },
  { title: 'Things fall apart', authors: ['Achebe, Chinua'], isbn: '9780385474542', publisher: 'Anchor Books', publicationPlace: 'New York', publicationYear: 1994, physicalDescription: '209 pages', ddc: '823.914', subjects: ['Igbo (African people) -- Fiction', 'Nigeria -- Fiction'], copies: 2 },
  { title: 'On the origin of species', authors: ['Darwin, Charles'], isbn: '9780451529060', publisher: 'Signet Classics', publicationPlace: 'New York', publicationYear: 2003, physicalDescription: '511 pages', ddc: '576.82', subjects: ['Evolution (Biology)', 'Natural selection'], copies: 1 },
  { title: 'The art of war', authors: ['Sunzi'], isbn: '9781590302255', publisher: 'Shambhala', publicationPlace: 'Boston', publicationYear: 2005, physicalDescription: '115 pages', ddc: '355.02', subjects: ['Military art and science -- Early works to 1800'], copies: 1 },
  { title: 'Pride and prejudice', authors: ['Austen, Jane'], isbn: '9780141439518', publisher: 'Penguin Books', publicationPlace: 'London', publicationYear: 2003, physicalDescription: '435 pages', ddc: '823.7', subjects: ['Courtship -- Fiction', 'England -- Fiction'], copies: 2 },
  { title: 'Oxford dictionary of English', authors: ['Stevenson, Angus'], isbn: '9780199571123', publisher: 'Oxford University Press', publicationPlace: 'Oxford', publicationYear: 2010, edition: '3rd ed.', physicalDescription: 'xxi, 2069 pages', ddc: '423', subjects: ['English language -- Dictionaries'], copies: 1, itemType: 'REF' },
];

async function seedDemoData() {
  if (process.env.SEED_DEMO === 'false') return;
  if ((await prisma.biblio.count()) > 0) return;

  const [main, east] = await Promise.all([
    prisma.branch.findUniqueOrThrow({ where: { code: 'MAIN' } }),
    prisma.branch.findUniqueOrThrow({ where: { code: 'EAST' } }),
  ]);
  const types = Object.fromEntries((await prisma.itemType.findMany()).map((t) => [t.code, t]));
  const categories = Object.fromEntries((await prisma.patronCategory.findMany()).map((c) => [c.code, c]));
  const staff = await prisma.user.findUniqueOrThrow({ where: { email: 'librarian@library.local' } });
  const passwordHash = await bcrypt.hash(process.env.SEED_PASSWORD || 'Library@123', 10);

  const now = new Date();
  const biblioIds: string[] = [];
  const firstItems: string[] = [];
  for (const [index, t] of DEMO_TITLES.entries()) {
    const isbn = normalizeIsbn(t.isbn);
    const data = {
      title: t.title,
      subtitle: t.subtitle ?? null,
      authors: t.authors,
      isbn13: isbn?.isbn13 ?? null,
      isbn10: isbn?.isbn10 ?? null,
      publisher: t.publisher,
      publicationPlace: t.publicationPlace,
      publicationYear: t.publicationYear,
      edition: t.edition ?? null,
      physicalDescription: t.physicalDescription,
      language: 'eng',
      ddc: t.ddc,
      subjects: t.subjects,
      coverUrl: isbn ? `https://covers.openlibrary.org/b/isbn/${isbn.isbn13}-M.jpg` : null,
    };
    const biblio = await prisma.biblio.create({
      data: { ...data, ...buildSearchFields(data), createdAt: addDays(now, -60 + index) },
    });
    biblioIds.push(biblio.id);
    const barcodes = await generateItemBarcodes(prisma, 'B', t.copies);
    for (const [i, barcode] of barcodes.entries()) {
      const branch = i % 2 === 0 ? main : east;
      const item = await prisma.item.create({
        data: {
          barcode,
          biblioId: biblio.id,
          itemTypeId: types[t.itemType ?? 'BOOK'].id,
          homeBranchId: branch.id,
          currentBranchId: branch.id,
          callNumber: buildCallNumber(biblio),
          shelfLocation: t.itemType === 'REF' ? 'Reference' : Number(t.ddc) >= 800 && Number(t.ddc) < 900 ? 'Fiction' : 'Non-fiction',
          copyNumber: i + 1,
          price: '24.99',
          acquiredAt: addDays(now, -60 + index),
        },
      });
      if (i === 0) firstItems.push(item.id);
    }
  }

  // A few more patrons.
  const people = [
    ['Amina', 'Bekele', 'STUDENT'],
    ['Daniel', 'Okafor', 'ADULT'],
    ['Sara', 'Haile', 'STUDENT'],
    ['Mateo', 'Garcia', 'ADULT'],
    ['Lily', 'Chen', 'CHILD'],
  ] as const;
  const patronIds: string[] = [];
  for (const [first, last, cat] of people) {
    const [card] = await reserveNumbers(prisma, 'card_number', 1_000_000_100);
    const p = await prisma.user.create({
      data: {
        firstName: first,
        lastName: last,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
        cardNumber: String(card),
        role: 'PATRON',
        patronCategoryId: categories[cat].id,
        homeBranchId: main.id,
        expiresAt: addMonths(now, 12),
        passwordHash,
      },
    });
    patronIds.push(p.id);
  }
  const pat = await prisma.user.findUniqueOrThrow({ where: { email: 'patron@library.local' } });

  // Loans: Pat has one current and one overdue item; others have some history.
  async function lend(itemId: string, patronId: string, daysAgo: number, returnedDaysAgo?: number) {
    const checkedOutAt = addDays(now, -daysAgo);
    const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    await prisma.loan.create({
      data: {
        itemId,
        patronId,
        branchId: item.currentBranchId,
        issuedById: staff.id,
        checkedOutAt,
        dueAt: endOfDay(addDays(checkedOutAt, 14)),
        returnedAt: returnedDaysAgo !== undefined ? addDays(now, -returnedDaysAgo) : null,
        returnBranchId: returnedDaysAgo !== undefined ? item.currentBranchId : null,
      },
    });
    if (returnedDaysAgo === undefined) await prisma.item.update({ where: { id: itemId }, data: { status: 'ON_LOAN' } });
  }
  await lend(firstItems[0], pat.id, 5);
  await lend(firstItems[5], pat.id, 20);
  await lend(firstItems[3], patronIds[0], 3);
  for (const [i, itemId] of firstItems.slice(0, 10).entries()) {
    if ([0, 3, 5].includes(i)) continue;
    await lend(itemId, patronIds[i % patronIds.length], 40 - i, 30 - i);
  }

  // A hold on a title with a copy on the shelf, so it appears in "Holds to pull".
  await prisma.hold.create({ data: { biblioId: biblioIds[6], patronId: patronIds[1], pickupBranchId: main.id } });

  // Acquisitions and serials.
  const vendor = await prisma.vendor.create({
    data: { name: 'Global Book Distributors', contactName: 'Order desk', email: 'orders@example.com', phone: '+1 555 0199', discountPercent: '10' },
  });
  await prisma.fund.create({ data: { code: 'BOOKS-' + now.getFullYear(), name: 'General book fund', fiscalYear: now.getFullYear(), allocated: '5000' } });
  const magData = { title: 'National geographic', authors: [], subjects: ['Geography -- Periodicals'], issn: '0027-9358', publisher: 'National Geographic Society', ddc: '910.5', language: 'eng' };
  const magazine = await prisma.biblio.create({ data: { ...magData, ...buildSearchFields(magData) } });
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const sub = await prisma.subscription.create({
    data: { biblioId: magazine.id, vendorId: vendor.id, branchId: main.id, itemTypeId: types.MAG.id, frequency: 'MONTHLY', startDate: start, labelPattern: 'Vol. 250, No. {n} ({date})', nextNumber: 7 },
  });
  for (let n = 0; n < 6; n++) {
    const expectedOn = new Date(start.getFullYear(), start.getMonth() + n, 1);
    await prisma.serialIssue.create({
      data: {
        subscriptionId: sub.id,
        number: n + 1,
        label: `Vol. 250, No. ${n + 1} (${expectedOn.toLocaleString('en', { month: 'short', year: 'numeric' })})`,
        expectedOn,
      },
    });
  }

  console.log(`Demo data: ${DEMO_TITLES.length + 1} titles, ${people.length + 1} patrons, loans, a hold, a vendor, a fund and a subscription.`);
}

async function main() {
  await seedReferenceData();
  await seedDemoData();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
