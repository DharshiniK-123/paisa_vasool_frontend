import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppDispatch } from '../../../hooks/redux';
import {
  uploadStarted,
  extractionDone,
  uploadFailed,
  saveDone,
} from '../slices/UploadProgressSlice';
import { documentService } from '../services/documentService';
import { extractErrorMessage } from '../../../utils/errorUtils';
import type { DocumentType, InvoiceRecord, PaymentRecord } from '../types/Document';

// ─── Icons ────────────────────────────────────────────────────────────────────
const IconUpload = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);
const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconClose = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IconSpark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function Spinner({ size = 16, color = 'var(--color-accent)' }: { size?: number; color?: string }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      border: `2px solid ${color}22`, borderTopColor: color,
      animation: 'spin 0.65s linear infinite', flexShrink: 0,
    }} />
  );
}

function formatBytes(b: number) {
  return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

const EXT_COLOR: Record<string, string> = {
  pdf: '#f87171', xlsx: '#34d399', xls: '#34d399', csv: '#fbbf24',
  png: '#a78bfa', jpg: '#a78bfa', jpeg: '#a78bfa', webp: '#a78bfa',
};

// ─── Step indicator ───────────────────────────────────────────────────────────
function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const accent = 'var(--color-accent)';
  const steps = ['Upload', 'Review & Edit', 'Saved'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: '1.5rem' }}>
      {steps.map((label, i) => {
        const num = i + 1;
        const done = current > num;
        const active = current === num;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: done ? accent : active ? `${accent}18` : 'var(--color-surface-2)',
                border: done ? 'none' : active ? `2px solid ${accent}` : '1px solid var(--color-border)',
                color: done ? '#000' : active ? accent : 'var(--color-muted)',
                fontSize: '0.68rem', fontWeight: 700,
              }}>
                {done ? <IconCheck /> : num}
              </div>
              <span style={{ fontSize: '0.6rem', color: active ? accent : done ? 'var(--color-text)' : 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ width: 52, height: 1, background: current > num ? accent : 'var(--color-border)', margin: '0 0.4rem', marginBottom: '1.1rem' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
type FileStatus = 'idle' | 'uploading' | 'polling' | 'extracted' | 'saving' | 'saved' | 'failed';

interface FileEntry {
  id: string;
  file: File;
  status: FileStatus;
  jobId: string | null;
  documentId: number | null;
  detectedType: DocumentType | null;
  previewRows: (InvoiceRecord | PaymentRecord)[];
  savedCount: number | null;
  error: string | null;
}

function makeEntry(file: File): FileEntry {
  return {
    id: crypto.randomUUID(), file, status: 'idle',
    jobId: null, documentId: null, detectedType: null,
    previewRows: [], savedCount: null, error: null,
  };
}

// ─── File review card ─────────────────────────────────────────────────────────
function FileReviewCard({ entry, onUpdateRows, onSave, onRemove }: {
  entry: FileEntry;
  onUpdateRows: (id: string, rows: (InvoiceRecord | PaymentRecord)[]) => void;
  onSave: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const accent      = 'var(--color-accent)';
  const ext         = entry.file.name.split('.').pop()?.toLowerCase() ?? '';
  const extColor    = EXT_COLOR[ext] ?? 'var(--color-muted)';
  const isProcessing = entry.status === 'uploading' || entry.status === 'polling';
  const isReady      = entry.status === 'extracted';
  const isSaving     = entry.status === 'saving';
  const isSaved      = entry.status === 'saved';
  const isFailed     = entry.status === 'failed';

  const columns = entry.previewRows.length > 0
    ? Object.keys(entry.previewRows[0]).filter(k => !['id', 'document_id', '_sa_instance_state'].includes(k))
    : [];

  const handleCell = (ri: number, col: string, val: string) =>
    onUpdateRows(entry.id, entry.previewRows.map((r, i) => i === ri ? { ...r, [col]: val } : r));

  const typeBadgeColor = entry.detectedType === 'INVOICE' ? '#2563eb' : entry.detectedType === 'PAYMENT' ? '#60a5fa' : 'var(--color-muted)';

  return (
    <div style={{
      background: 'var(--color-surface-2)',
      border: `1px solid ${isFailed ? 'rgba(248,113,113,0.35)' : isSaved ? `${accent}44` : 'var(--color-border)'}`,
      borderRadius: 12, overflow: 'hidden', transition: 'border-color 0.2s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, flexShrink: 0, background: `${extColor}18`, border: `1px solid ${extColor}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: extColor, fontSize: '0.58rem', fontWeight: 800, textTransform: 'uppercase' }}>
          {ext}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.file.name}</p>
          <p style={{ fontSize: '0.62rem', color: 'var(--color-muted)', marginTop: '0.1rem' }}>{formatBytes(entry.file.size)}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Auto-detected type badge */}
          {entry.detectedType && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '0.15rem 0.5rem', borderRadius: 99, background: `${typeBadgeColor}18`, color: typeBadgeColor, border: `1px solid ${typeBadgeColor}33` }}>
              {entry.detectedType}
            </span>
          )}
          {isProcessing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.68rem', color: accent }}>
              <Spinner size={13} color={accent} />
              {entry.status === 'uploading' ? 'Uploading…' : 'Classifying & Extracting…'}
            </div>
          )}
          {isReady && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', color: accent, fontWeight: 600, background: `${accent}14`, padding: '0.2rem 0.5rem', borderRadius: 6 }}>
              <IconCheck /> Ready to review
            </div>
          )}
          {isSaved && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.68rem', color: accent, fontWeight: 600 }}>
              <IconCheck /> {entry.savedCount} saved
            </div>
          )}
          {isFailed && <span style={{ fontSize: '0.65rem', color: '#f87171', fontWeight: 600 }}>Failed</span>}
          {!isSaved && (
            <button onClick={e => { e.stopPropagation(); onRemove(entry.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', display: 'flex', padding: '0.2rem', borderRadius: 4 }}>
              <IconClose />
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {isFailed && entry.error && (
        <div style={{ padding: '0.625rem 1rem', background: 'rgba(248,113,113,0.06)', borderBottom: '1px solid rgba(248,113,113,0.2)', fontSize: '0.72rem', color: '#f87171', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
          <span style={{ flexShrink: 0 }}>⚠</span><span>{entry.error}</span>
        </div>
      )}

      {/* Preview table */}
      {(isReady || isSaving || isSaved) && entry.previewRows.length > 0 && (
        <div style={{ overflowX: 'auto', maxHeight: 200, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
            <thead>
              <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0 }}>
                {columns.map(col => (
                  <th key={col} style={{ padding: '0.45rem 0.75rem', textAlign: 'left', fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                    {col.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entry.previewRows.map((row, ri) => (
                <tr key={ri} style={{ borderBottom: ri < entry.previewRows.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                  {columns.map(col => (
                    <td key={col} style={{ padding: '0.25rem 0.5rem' }}>
                      <input
                        value={(row as Record<string, unknown>)[col] != null ? String((row as Record<string, unknown>)[col]) : ''}
                        onChange={e => handleCell(ri, col, e.target.value)}
                        disabled={isSaved}
                        style={{ width: '100%', minWidth: 70, padding: '0.28rem 0.45rem', background: 'transparent', border: '1px solid transparent', borderRadius: 4, color: 'var(--color-text)', fontSize: '0.72rem', outline: 'none', cursor: isSaved ? 'default' : 'text' }}
                        onFocus={e => { if (!isSaved) e.target.style.borderColor = accent; }}
                        onBlur={e => { e.target.style.borderColor = 'transparent'; }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Save button */}
      {isReady && entry.detectedType && (
        <div style={{ padding: '0.75rem 1rem', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--color-border)' }}>
          <button
            onClick={e => { e.stopPropagation(); onSave(entry.id); }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1.125rem', borderRadius: 9, border: 'none', cursor: 'pointer', background: 'var(--color-accent)', color: '#000', fontWeight: 700, fontSize: '0.75rem', fontFamily: "'DM Sans', sans-serif" }}
          >
            <IconCheck /> Save {entry.previewRows.length} {entry.detectedType === 'INVOICE' ? 'Invoice' : 'Payment'}{entry.previewRows.length !== 1 ? 's' : ''}
          </button>
        </div>
      )}

      {isSaving && (
        <div style={{ padding: '0.75rem 1rem', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: accent }}>
            <Spinner size={13} color={accent} /> Saving…
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────
export default function UploadModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const dispatch = useAppDispatch();
  const [dragging, setDragging] = useState(false);
  const [entries, setEntries]   = useState<FileEntry[]>([]);
  const [step, setStep]         = useState<1 | 2 | 3>(1);
  const inputRef                = useRef<HTMLInputElement>(null);
  const entriesRef              = useRef<FileEntry[]>([]);

  useEffect(() => { entriesRef.current = entries; }, [entries]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const patchEntry = (id: string, patch: Partial<FileEntry>) =>
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));

  const ALLOWED_EXTENSIONS = new Set(['pdf', 'csv', 'xlsx', 'xls', 'png', 'jpeg', 'jpg', 'webp']);
  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const addFiles = (files: FileList | File[]) => {
    const valid: File[] = [];
    const invalidType: string[] = [];
    const invalidSize: string[] = [];

    Array.from(files).forEach(file => {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (!ALLOWED_EXTENSIONS.has(ext)) invalidType.push(file.name);
      else if (file.size > MAX_FILE_SIZE) invalidSize.push(`${file.name} (${formatBytes(file.size)})`);
      else valid.push(file);
    });

    if (invalidType.length) alert(`Unsupported file type(s):\n${invalidType.join('\n')}\n\nAllowed: PDF, CSV, XLSX, PNG, JPG, WEBP`);
    if (invalidSize.length) alert(`File(s) exceed 10MB limit:\n${invalidSize.join('\n')}`);

    if (valid.length) {
      setEntries(prev => [...prev, ...valid.map(makeEntry)]);
      setStep(2);
    }
  };

  const removeEntry = (id: string) => {
    setEntries(prev => {
      const next = prev.filter(e => e.id !== id);
      if (next.length === 0) setStep(1);
      return next;
    });
  };

  const updateRows = (id: string, rows: (InvoiceRecord | PaymentRecord)[]) =>
    patchEntry(id, { previewRows: rows });

  const uploadAndPoll = useCallback(async (entry: FileEntry) => {
    const { id, file } = entry;
    patchEntry(id, { status: 'uploading', error: null });

    let uploadRes;
    try {
      uploadRes = await documentService.upload(file);
    } catch (err) {
      const msg = extractErrorMessage(err);
      patchEntry(id, { status: 'failed', error: msg });
      dispatch(uploadFailed(msg));
      return;
    }

    dispatch(uploadStarted({
      jobId: uploadRes.job_id,
      documentId: uploadRes.document_id,
      fileName: file.name,
      documentType: 'UNKNOWN' as DocumentType,
    }));

    patchEntry(id, { jobId: uploadRes.job_id, documentId: uploadRes.document_id, status: 'polling' });

    try {
      const result = await documentService.pollJobUntilDone(uploadRes.job_id);
      // document_type is returned by the backend after auto-classification
      const detectedType = (result.document_type ?? null) as DocumentType | null;
      patchEntry(id, { status: 'extracted', detectedType, previewRows: result.preview_data ?? [] });
      dispatch(extractionDone(result.preview_data ?? []));
    } catch (err) {
      const msg = extractErrorMessage(err) ?? 'Extraction failed';
      patchEntry(id, { status: 'failed', error: msg });
      dispatch(uploadFailed(msg));
    }
  }, [dispatch]);

  const handleUploadAll = () => {
    entriesRef.current.filter(e => e.status === 'idle').forEach(entry => uploadAndPoll(entry));
  };

  const handleSave = async (id: string) => {
    const entry = entriesRef.current.find(e => e.id === id);
    if (!entry || !entry.documentId || !entry.detectedType) return;

    patchEntry(id, { status: 'saving', error: null });

    try {
      // Use the backend-classified type — no user input needed
      const result = await documentService.saveRecords(entry.documentId, entry.detectedType, entry.previewRows);
      dispatch(saveDone(result.records_saved));

      setEntries(prev => {
        const updated = prev.map(e =>
          e.id === id ? { ...e, status: 'saved' as FileStatus, savedCount: result.records_saved } : e,
        );
        const nonIdle  = updated.filter(e => e.status !== 'idle');
        const terminal = nonIdle.filter(e => e.status === 'saved' || e.status === 'failed');
        if (nonIdle.length > 0 && terminal.length === nonIdle.length) {
          setStep(3);
          onSuccess();
        }
        return updated;
      });
    } catch (err) {
      const msg = extractErrorMessage(err) ?? 'Save failed';
      patchEntry(id, { status: 'failed', error: msg });
      dispatch(uploadFailed(msg));
    }
  };

  const anyProcessing = entries.some(e => e.status === 'uploading' || e.status === 'polling' || e.status === 'saving');
  const anyIdle       = entries.some(e => e.status === 'idle');
  const totalSaved    = entries.reduce((s, e) => s + (e.savedCount ?? 0), 0);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(10,15,30,0.55)', backdropFilter: 'blur(4px)', zIndex: 100, animation: 'fadeIn 0.2s ease both' }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '100%', maxWidth: 620,
        maxHeight: '90vh', overflowY: 'auto',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 18,
        boxShadow: '0 24px 80px rgba(10,15,40,0.35)',
        zIndex: 101,
        display: 'flex', flexDirection: 'column',
        animation: 'modalPop 0.28s var(--ease-out-expo) both',
      }}>
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-surface-2)', borderRadius: '18px 18px 0 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--color-accent-soft)', border: '1px solid rgba(37,99,235,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-accent)' }}>
              <IconUpload />
            </div>
            <div>
              <p style={{ fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--color-muted)', marginBottom: '0.1rem' }}>
                Auto-classified · Invoice or Payment
              </p>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text)', fontFamily: "'DM Sans', sans-serif", letterSpacing: '-0.01em' }}>
                Upload Document
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.45rem', cursor: 'pointer', color: 'var(--color-muted)', display: 'flex', alignItems: 'center', transition: 'all 0.15s' }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--color-border-hover)'; el.style.color = 'var(--color-text)'; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'var(--color-border)'; el.style.color = 'var(--color-muted)'; }}
          >
            <IconClose />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <StepIndicator current={step} />

          {step !== 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
                onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
                style={{
                  border: `2px dashed ${dragging ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  borderRadius: 12,
                  padding: entries.length ? '1rem 1.5rem' : '2.5rem 1.5rem',
                  textAlign: 'center', cursor: 'pointer',
                  background: dragging ? 'var(--color-accent-soft)' : 'var(--color-surface-2)',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ color: dragging ? 'var(--color-accent)' : 'var(--color-muted)', display: 'flex', justifyContent: 'center', marginBottom: '0.6rem' }}>
                  <IconUpload />
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--color-text)', marginBottom: '0.25rem' }}>
                  Drag & drop or <span style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}>browse</span>
                </p>
                <p style={{ fontSize: '0.65rem', color: 'var(--color-muted)' }}>
                  PDF, XLSX, XLS, PNG, JPEG, JPG, WEBP or CSV · Max 10 MB · Multiple files
                </p>
                <p style={{ fontSize: '0.62rem', color: 'var(--color-muted)', marginTop: '0.35rem', fontStyle: 'italic' }}>
                  ✦ Document type is detected automatically — no selection needed
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.xlsx,.xls,.csv,.png,.jpeg,.jpg,.webp"
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }}
                />
              </div>

              {/* File cards */}
              {entries.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {entries.map(entry => (
                    <FileReviewCard key={entry.id} entry={entry} onUpdateRows={updateRows} onSave={handleSave} onRemove={removeEntry} />
                  ))}
                </div>
              )}

              {/* Action bar */}
              {entries.length > 0 && (
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.25rem' }}>
                  <button onClick={onClose} className="btn-secondary" style={{ padding: '0.55rem 1rem', fontSize: '0.78rem' }}>
                    Cancel
                  </button>
                  {anyIdle && (
                    <button
                      onClick={handleUploadAll}
                      disabled={anyProcessing}
                      className="btn-primary"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1.25rem', fontSize: '0.78rem', opacity: anyProcessing ? 0.5 : 1 }}
                    >
                      {anyProcessing
                        ? <><Spinner size={13} color="#000" /> Processing…</>
                        : <><IconSpark /> Upload & Extract {entries.filter(e => e.status === 'idle').length} File{entries.filter(e => e.status === 'idle').length !== 1 ? 's' : ''}</>
                      }
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3 — success */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem', padding: '1.5rem 0', textAlign: 'center' }}>
              <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--color-accent-soft)', border: '2px solid rgba(37,99,235,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-accent)' }}>
                <IconCheck />
              </div>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text)', marginBottom: '0.35rem', fontFamily: "'DM Sans', sans-serif" }}>
                  {totalSaved} record{totalSaved !== 1 ? 's' : ''} saved!
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                  {entries.length} file{entries.length !== 1 ? 's' : ''} processed · table refreshed
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={() => { setEntries([]); setStep(1); }} className="btn-secondary" style={{ fontSize: '0.78rem', padding: '0.55rem 1.25rem' }}>
                  Upload More
                </button>
                <button
                  onClick={onClose}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1.25rem', borderRadius: 9, border: 'none', cursor: 'pointer', background: 'var(--color-accent)', color: '#000', fontWeight: 700, fontSize: '0.75rem', fontFamily: "'DM Sans', sans-serif" }}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin     { to { transform: rotate(360deg); } }
        @keyframes fadeIn   { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalPop { from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
      `}</style>
    </>
  );
}