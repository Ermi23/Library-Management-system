import type { Prisma } from '@prisma/client';

type Db = Prisma.TransactionClient;

/** Reserves `count` consecutive numbers from a named counter (atomic increment). */
export async function reserveNumbers(db: Db, name: string, start: number, count = 1): Promise<number[]> {
  const row = await db.counter.upsert({
    where: { name },
    create: { name, value: start + count - 1 },
    update: { value: { increment: count } },
  });
  const firstNumber = row.value - count + 1;
  return Array.from({ length: count }, (_, i) => firstNumber + i);
}

/** Item barcodes like "B0000042"; skips any that were entered manually and already exist. */
export async function generateItemBarcodes(db: Db, prefix: string, count: number): Promise<string[]> {
  const result: string[] = [];
  while (result.length < count) {
    const numbers = await reserveNumbers(db, 'item_barcode', 1, count - result.length);
    const candidates = numbers.map((n) => `${prefix}${String(n).padStart(7, '0')}`);
    const taken = await db.item.findMany({ where: { barcode: { in: candidates } }, select: { barcode: true } });
    const takenSet = new Set(taken.map((t) => t.barcode));
    result.push(...candidates.filter((c) => !takenSet.has(c)));
  }
  return result;
}

/** Ten-digit library card numbers. */
export async function generateCardNumber(db: Db): Promise<string> {
  for (;;) {
    const [n] = await reserveNumbers(db, 'card_number', 1_000_000_100);
    const candidate = String(n);
    const exists = await db.user.findUnique({ where: { cardNumber: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
}

export async function generateOrderNumber(db: Db): Promise<string> {
  const year = new Date().getFullYear();
  const [n] = await reserveNumbers(db, `po_${year}`, 1);
  return `PO-${year}-${String(n).padStart(4, '0')}`;
}
