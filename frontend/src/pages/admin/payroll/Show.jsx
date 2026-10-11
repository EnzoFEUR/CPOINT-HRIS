import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supabase } from '../../../supabaseClient';
import { fetchWithAuth } from '../../../utils/api';
import SilPaymentCard from '../../../components/SilPaymentCard';
import OfficialPayslipDocument from '../../../components/OfficialPayslipDocument';

const isValidUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

export default function PayrollShow() {
    const { id } = useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const isIdValid = Boolean(id && id !== 'undefined' && isValidUUID(id));

    const { data: payroll = null, isLoading, error: queryError } = useQuery({
        queryKey: ['payroll', id],
        queryFn: async () => {
            const res = await fetchWithAuth(`/api/payroll/${id}`);
            const result = await res.json();
            if (!res.ok || result.error) {
                throw new Error(result.message || result.error || 'Failed to load payslip.');
            }
            return result.data || result;
        },
        enabled: isIdValid,
        staleTime: 10_000,
        gcTime: 300_000,
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
    });

    // Real-time synchronization: live updates if payslip is modified or deleted
    useEffect(() => {
        if (!isIdValid || !id) return;

        const channel = supabase
            .channel(`payslip-live-${id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payrolls', filter: `id=eq.${id}` }, (payload) => {
                if (payload.eventType === 'DELETE') {
                    toast.error('This payslip was deleted by an administrator.');
                    navigate('/admin/payroll');
                } else {
                    queryClient.invalidateQueries({ queryKey: ['payroll', id], refetchType: 'active' });
                }
            })
            .on('broadcast', { event: 'PAYROLL_DELETED' }, (msg) => {
                if (msg.payload?.id === id) {
                    toast.error('This payslip was deleted by an administrator.');
                    navigate('/admin/payroll');
                }
            })
            .on('broadcast', { event: 'PAYROLL_BULK_DELETED' }, (msg) => {
                if (Array.isArray(msg.payload?.ids) && msg.payload.ids.includes(id)) {
                    toast.error('This payslip was deleted by an administrator.');
                    navigate('/admin/payroll');
                }
            })
            .on('broadcast', { event: 'PAYROLL_UPDATED' }, (msg) => {
                if (msg.payload?.id === id) {
                    queryClient.invalidateQueries({ queryKey: ['payroll', id], refetchType: 'active' });
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [id, isIdValid, queryClient, navigate]);

    const errorMessage = !isIdValid ? 'Invalid or missing Payroll record ID.' : (queryError?.message || null);

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');

    const confirmDelete = async () => {
        if (deleteConfirmText !== 'DELETE') {
            toast.error("Please type DELETE to confirm.");
            return;
        }

        try {
            const user = JSON.parse(localStorage.getItem('user'));
            const res = await fetchWithAuth(`/api/payroll/${id}`, {
                method: 'DELETE',
                body: JSON.stringify({ admin_id: user?.id })
            });
            const resultData = await res.json();
            if (res.ok && resultData.success) {
                queryClient.invalidateQueries({ queryKey: ['adminPayrolls'] });
                queryClient.removeQueries({ queryKey: ['payroll', id] });
                toast.success('Payroll record deleted successfully.');
                navigate('/admin/payroll');
            } else {
                toast.error('Error deleting payroll: ' + (resultData.error || resultData.message));
            }
        } catch (err) {
            console.error('Failed to delete payroll:', err);
            toast.error('Network error deleting payroll');
        }
    };

    const handleDelete = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        setIsDeleteModalOpen(true);
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-accent rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-xs">Loading Payslip Document...</p>
            </div>
        );
    }

    if (errorMessage || !payroll) {
        return (
            <div className="max-w-md mx-auto my-20 p-8 bg-white rounded-lg border border-slate-200 shadow-2xs text-center">
                <div className="w-14 h-14 bg-danger-subtle text-danger-ink rounded-lg flex items-center justify-center mx-auto mb-4 border border-danger/20">
                    <i className="ti ti-file-alert text-2xl" />
                </div>
                <h3 className="text-lg font-bold text-slate-800 tracking-tight">Record Unavailable</h3>
                <p className="text-xs text-slate-500 mt-2 mb-6">{errorMessage || 'The requested payslip could not be found or has been removed.'}</p>
                <Link to="/admin/payroll" className="inline-flex items-center gap-2 h-9 px-4 bg-slate-900 text-white rounded-md text-xs font-semibold hover:bg-slate-800 transition-colors duration-100 shadow-2xs">
                    <i className="ti ti-arrow-left" /> Back to Payroll
                </Link>
            </div>
        );
    }

    return (
        <div className="payslip-outer-wrapper max-w-4xl mx-auto py-4 sm:py-8 px-3 sm:px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))] print:p-0 print:m-0 print:max-w-none">
            {/* Payment Settlement Alert if pending SIL payout */}
            <div className="print:hidden">
                <SilPaymentCard variant="confirm" payroll={payroll} />
            </div>

            {/* Official Enterprise Payslip Document */}
            <OfficialPayslipDocument
                payroll={payroll}
                variant="admin"
                onBack={() => navigate('/admin/payroll')}
                onDelete={handleDelete}
            />

            {/* Delete Confirmation Modal */}
            {isDeleteModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 print:hidden">
                    <div
                        className="absolute inset-0 bg-slate-950/70"
                        onClick={() => setIsDeleteModalOpen(false)}
                    />
                    <div className="relative bg-white rounded-lg w-full max-w-md overflow-hidden shadow-xl p-6 text-center border border-slate-200">
                        <div className="w-12 h-12 bg-danger-subtle text-danger-ink rounded-md flex items-center justify-center mx-auto mb-4 border border-danger/20">
                            <i className="ti ti-alert-triangle text-2xl" />
                        </div>

                        <h2 className="text-lg font-bold text-slate-900 tracking-tight mb-1">Delete Payroll Record?</h2>
                        <p className="text-xs text-slate-500 mb-5 leading-relaxed">
                            This will permanently remove this payslip from compliance logs. This action cannot be undone.
                        </p>

                        <div className="bg-slate-50 rounded-md p-3.5 mb-5 border border-slate-200 text-left">
                            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                                Type <span className="text-danger-ink font-mono select-all">DELETE</span> to confirm
                            </label>
                            <input
                                type="text"
                                value={deleteConfirmText}
                                onChange={(e) => setDeleteConfirmText(e.target.value)}
                                placeholder="DELETE"
                                autoCapitalize="characters"
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md outline-none focus:border-danger font-mono font-bold text-slate-800 text-sm text-center"
                            />
                        </div>

                        <div className="flex gap-2.5">
                            <button
                                onClick={() => setIsDeleteModalOpen(false)}
                                className="flex-1 h-9 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-md transition-colors duration-100 cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDelete}
                                disabled={deleteConfirmText !== 'DELETE'}
                                className="flex-1 h-9 bg-danger hover:bg-danger-ink disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs rounded-md shadow-2xs transition-colors duration-100 cursor-pointer"
                            >
                                Delete Record
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
