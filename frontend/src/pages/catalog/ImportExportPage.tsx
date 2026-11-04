import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Upload } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useTitle } from '@/lib/hooks';
import { useToast } from '@/components/toast';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ErrorMessage, Stat, Table, TBody, Td, Th, THead } from '@/components/ui';
import { PageHeader } from '@/components/ui';

interface ImportResult {
  total: number;
  created: number;
  duplicates: number;
  errors: number;
  results: { index: number; title: string; isbn: string | null; status: 'created' | 'duplicate' | 'error' | 'preview'; message?: string; biblioId?: string; items?: number }[];
}

const STATUS_TONE = { created: 'green', duplicate: 'amber', error: 'red', preview: 'blue' } as const;

export function ImportExportPage() {
  useTitle('Import / export MARC');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [skipDuplicates, setSkip] = useState(true);
  const [createItems, setCreateItems] = useState(true);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [previewed, setPreviewed] = useState(false);

  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(dryRun ? 'preview' : 'import');
    setError(null);
    try {
      const r = await api<ImportResult>('/catalog/import', {
        method: 'POST',
        body: file,
        raw: true,
        query: { dryRun, skipDuplicates, createItems },
      });
      setResult(r);
      setPreviewed(dryRun);
      if (!dryRun) {
        toast.success(`Imported ${r.created} record${r.created === 1 ? '' : 's'}.`);
        queryClient.invalidateQueries({ queryKey: ['catalog'] });
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Import and export MARC" description="Exchange bibliographic records with other library systems (Koha, Evergreen, OCLC, the Library of Congress)." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Import records" description="MARC 21 in ISO 2709 (.mrc) or MARCXML (.xml), UTF-8" />
          <div className="space-y-4 p-4">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-6 py-8 text-center hover:border-brand-400 hover:bg-brand-50/40">
              <FileUp className="size-8 text-slate-400" />
              <span className="text-sm font-medium text-slate-700">{file ? file.name : 'Choose a MARC file'}</span>
              <span className="text-xs text-slate-500">{file ? `${(file.size / 1024).toFixed(1)} KB` : '.mrc, .marc or .xml'}</span>
              <input
                type="file"
                accept=".mrc,.marc,.xml,.dat"
                className="sr-only"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setResult(null);
                  setPreviewed(false);
                }}
              />
            </label>
            <div className="space-y-2">
              <Checkbox label="Skip records whose ISBN is already in the catalog" checked={skipDuplicates} onChange={setSkip} />
              <Checkbox label="Create copies from holdings (field 952: barcode, branch code, call number, item type)" checked={createItems} onChange={setCreateItems} />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={!file} loading={busy === 'preview'} onClick={() => run(true)}>Preview</Button>
              <Button disabled={!file} loading={busy === 'import'} onClick={() => run(false)}><Upload className="size-4" /> Import</Button>
            </div>
            <ErrorMessage error={error} />
          </div>

          {result && (
            <div className="border-t border-slate-200">
              <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
                <Stat label="Records in file" value={result.total} />
                <Stat label={previewed ? 'Will be created' : 'Created'} value={previewed ? result.results.filter((r) => r.status === 'preview').length : result.created} tone="green" />
                <Stat label="Duplicates skipped" value={result.duplicates} tone={result.duplicates ? 'amber' : undefined} />
                <Stat label="Errors" value={result.errors} tone={result.errors ? 'red' : undefined} />
              </div>
              {previewed && <div className="px-4 pb-3"><Alert tone="blue">This is a preview: nothing has been saved. Click Import to add the records.</Alert></div>}
              <Table>
                <THead><Th>#</Th><Th>Title</Th><Th>ISBN</Th><Th>Result</Th><Th>Copies</Th></THead>
                <TBody>
                  {result.results.map((r) => (
                    <tr key={r.index}>
                      <Td className="text-slate-500">{r.index + 1}</Td>
                      <Td>{r.biblioId && r.status !== 'preview' ? <Link to={`/staff/catalog/${r.biblioId}`} className="text-brand-700 hover:underline">{r.title}</Link> : r.title}</Td>
                      <Td className="font-mono text-xs">{r.isbn ?? '—'}</Td>
                      <Td>
                        <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                        {r.message && <div className="mt-1 text-xs text-slate-500">{r.message}</div>}
                      </Td>
                      <Td>{r.items ?? '—'}</Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </Card>

        <Card className="self-start">
          <CardHeader title="Export the catalog" description="All titles with their copies (952)" />
          <div className="space-y-2 p-4">
            <Button variant="secondary" className="w-full" onClick={() => download('/catalog/export', { format: 'mrc' }).catch(toast.error)}><Download className="size-4" /> MARC 21 (.mrc)</Button>
            <Button variant="secondary" className="w-full" onClick={() => download('/catalog/export', { format: 'xml' }).catch(toast.error)}><Download className="size-4" /> MARCXML (.xml)</Button>
            <p className="pt-2 text-xs text-slate-500">Use exports for backups, union catalogs, or migrating to another system.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
