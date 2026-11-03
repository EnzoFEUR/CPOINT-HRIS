import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SIL_WAGE_DOCUMENT_TYPE } from '../../../shared/documentTypes.mjs';
import { getManilaWorkDate, isSilWageDocumentId } from '../../../shared/leavePolicy.js';
import { getUser } from '../routes/guards';
import { fetchWithAuth } from '../utils/api';
import { readLeaveCreditResponse } from '../utils/useEmployeeLeaveCredits';
import { openEmployeeDocument, reviewDocumentStatus, uploadEmployeeDocument } from '../utils/documentApi';

export default function SilWageDocumentField({ employeeId, asOf, sourceId, onChange, inputClass }) {
    const actorId = getUser()?.id;
    const fieldId = useId();
    const queryClient = useQueryClient();
    const [file, setFile] = useState(null);
    const [confirmed, setConfirmed] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState('');
    const uploaded = useRef(null);
    const mounted = useRef(false);
    const change = useRef(onChange);
    useEffect(() => { change.current = onChange; }, [onChange]);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const queryKey = ['silWageSources', actorId, employeeId, asOf];
    const query = useQuery({
        queryKey, enabled: Boolean(actorId && employeeId), staleTime: 15000, retry: false,
        queryFn: async ({ signal }) => {
            const params = new URLSearchParams({ employee_id: employeeId, as_of: asOf });
            const data = await readLeaveCreditResponse(await fetchWithAuth(`/api/leave-credits/wage-sources?${params}`, { signal }));
            if (data?.employee_id !== employeeId || data.as_of !== asOf || !Array.isArray(data.documents) || data.documents.length > 50
                || data.documents.some(document => !isSilWageDocumentId(document.id) || !Number.isFinite(Date.parse(document.reviewed_at)))) throw new Error('Wage source lookup returned incomplete records. Refresh before reviewing.');
            return data;
        },
    });
    const documents = query.data?.documents || [];
    const selected = documents.find(document => document.id === sourceId);
    useEffect(() => {
        if (uploading || !query.isSuccess || query.isFetching) return;
        if (sourceId && !query.data.documents.some(document => document.id === sourceId)) change.current('');
        else if (!sourceId && query.data.documents.length === 1) change.current(query.data.documents[0].id);
    }, [query.data, query.isSuccess, query.isFetching, sourceId, uploading]);

    const upload = async () => {
        if (!file || !confirmed || uploading) return;
        setUploading(true); setError(''); change.current('');
        try {
            const document = uploaded.current || await uploadEmployeeDocument({ employeeId, file, title: `${SIL_WAGE_DOCUMENT_TYPE} ${asOf}`,
                category: 'Contract', documentType: SIL_WAGE_DOCUMENT_TYPE });
            uploaded.current = document;
            if (!mounted.current) return;
            await reviewDocumentStatus({ documentId: document.id, status: 'approved' });
            await queryClient.invalidateQueries({ queryKey });
            const refreshed = await query.refetch();
            if (!mounted.current) return;
            if (refreshed.isError || !refreshed.data?.documents.some(candidate => candidate.id === String(document.id))) {
                throw new Error('Evidence was uploaded. Refresh wage sources to verify its availability.');
            }
            change.current(String(document.id));
            setFile(null); setConfirmed(false); setAdding(false); uploaded.current = null;
        } catch (failure) {
            if (mounted.current) setError(failure.message || 'Unable to save wage evidence.');
        } finally { if (mounted.current) setUploading(false); }
    };

    return <div className="space-y-2 rounded-md border border-line bg-surface-muted/50 p-2.5">
        <div className="flex items-center justify-between gap-2">
            <label htmlFor={fieldId} className="text-[11px] font-semibold text-ink">Verified wage source</label>
            <button type="button" disabled={query.isFetching || uploading} onClick={() => query.refetch()} className="text-[11px] font-semibold text-ink-muted disabled:opacity-50">Refresh sources</button>
        </div>
        <select id={fieldId} aria-label="Verified wage source" disabled={query.isFetching || uploading} value={selected?.id || ''}
            onChange={event => { setError(''); change.current(event.target.value); }} className={inputClass}>
            <option value="">{query.isPending ? 'Finding approved wage records…' : 'Select a verified wage document'}</option>
            {documents.map(document => <option key={document.id} value={document.id}>{document.title || `Wage document #${document.id}`}</option>)}
        </select>
        {selected && <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted">
            <span>Approved {getManilaWorkDate(selected.reviewed_at)}{selected.expiry_date ? ` · Valid through ${selected.expiry_date}` : ''}</span>
            <button type="button" onClick={() => openEmployeeDocument(selected.id).catch(failure => { if (mounted.current) setError(failure.message); })}
                className="rounded-md border border-line bg-surface px-2 py-1 font-semibold text-ink">Open wage document</button>
        </div>}
        {query.isError && <p role="alert" className="text-xs text-rose-700">{query.error.message}</p>}
        {!query.isPending && !query.isError && !documents.length && <p role="status" className="text-xs text-amber-900">No approved wage evidence yet. Attach a reviewed wage determination before approval.</p>}
        {documents.length > 0 && !adding && <button type="button" onClick={() => setAdding(true)} className="text-[11px] font-semibold text-ink-muted">Attach updated wage evidence</button>}
        {(!documents.length || adding) && <div className="space-y-2 border-t border-line pt-2">
            <label htmlFor={`${fieldId}-file`} className="block text-[11px] font-medium text-ink-muted">Reviewed wage document · PDF, PNG or JPEG · Up to 10 MB</label>
            <input id={`${fieldId}-file`} type="file" accept=".pdf,.png,.jpg,.jpeg" disabled={uploading}
                onChange={event => {
                    const next = event.target.files?.[0]; uploaded.current = null; setConfirmed(false); setError(''); change.current(sourceId || '');
                    if (next && (!/\.(pdf|png|jpe?g)$/i.test(next.name) || !next.size || next.size > 10 * 1024 * 1024)) {
                        setFile(null); setError('Choose a nonempty PDF, PNG or JPEG file no larger than 10 MB.'); event.target.value = ''; return;
                    }
                    setFile(next || null);
                }} className="block w-full min-w-0 text-xs text-ink-muted file:mr-2 file:rounded file:border file:border-line file:bg-surface file:px-2 file:py-1.5" />
            <label className="flex items-start gap-2 text-[11px] text-ink-muted">
                <input type="checkbox" disabled={uploading || !file} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5" />
                <span>I reviewed this file and confirmed the wage basis and intended employee.</span>
            </label>
            <button type="button" disabled={!file || !confirmed || uploading} onClick={upload} className="w-full rounded-md bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                {uploading ? 'Saving verified evidence…' : 'Upload and verify evidence'}
            </button>
        </div>}
        {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </div>;
}
