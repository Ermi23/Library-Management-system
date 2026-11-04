import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { usePublicSettings, useTitle } from '@/lib/hooks';
import { Barcode } from '@/components/Barcode';
import { Button, Card, Checkbox, ErrorMessage, LoadingBlock, PageHeader } from '@/components/ui';

interface LabelItem {
  id: string;
  barcode: string;
  callNumber: string | null;
  enumeration: string | null;
  copyNumber: number | null;
  biblio: { title: string; authors: string[] };
  homeBranch: { name: string; code: string };
}

/** Spine labels (call number split over lines, as shelved) and barcode labels, laid out for printing. */
export function LabelsPage() {
  useTitle('Print labels');
  const [params] = useSearchParams();
  const settings = usePublicSettings();
  const [spine, setSpine] = useState(true);
  const [barcode, setBarcode] = useState(true);
  const items = useQuery({
    queryKey: ['labels', params.toString()],
    queryFn: () => api<LabelItem[]>('/catalog/labels', { query: { ids: params.get('ids'), biblioId: params.get('biblioId') } }),
  });

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Print labels"
          description="Use label sheets or plain paper. Set the printer margins to none for best results."
          actions={<Button onClick={() => window.print()}><Printer className="size-4" /> Print</Button>}
        />
        <Card className="mb-6 flex flex-wrap gap-6 p-4">
          <Checkbox label="Spine labels" checked={spine} onChange={setSpine} />
          <Checkbox label="Barcode labels" checked={barcode} onChange={setBarcode} />
        </Card>
      </div>
      {items.isLoading ? (
        <LoadingBlock />
      ) : items.error ? (
        <ErrorMessage error={items.error} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
          {items.data?.map((i) => (
            <div key={i.id} className="flex break-inside-avoid gap-2 rounded border border-dashed border-slate-300 bg-white p-2 print:border-slate-400">
              {spine && (
                <div className="flex w-20 shrink-0 flex-col items-center justify-center border-r border-dashed border-slate-300 pr-2 text-center font-mono text-sm font-bold leading-tight">
                  {(i.callNumber ?? '').split(' ').map((part, idx) => <div key={idx}>{part}</div>)}
                  {i.enumeration && <div className="text-xs font-normal">{i.enumeration}</div>}
                  {i.copyNumber && <div className="text-[10px] font-normal">c.{i.copyNumber}</div>}
                </div>
              )}
              {barcode && (
                <div className="flex min-w-0 flex-1 flex-col items-center justify-center text-center">
                  <div className="w-full truncate text-[10px] font-semibold">{settings.data?.libraryName} · {i.homeBranch.code}</div>
                  <Barcode value={i.barcode} height={34} width={1.3} fontSize={11} />
                  <div className="w-full truncate text-[10px] text-slate-600">{i.biblio.title}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
