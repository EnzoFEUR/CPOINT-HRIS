import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import PageHeader from '../../../components/ui/PageHeader';
import { fetchWithAuth } from '../../../utils/api';
import { formatPhPhone, validatePhPhone, cleanPhPhone } from '../../../utils/phoneUtils';

const ADMIN_DEPARTMENTS = [
    'Information Technology',
    'Human Resources',
    'Operations Management',
    'Executive & Governance',
    'Internal Audit'
];

const ADMIN_ROLES = [
    'System Administrator',
    'HR Director',
    'IT Security Administrator',
    'HR Operations Lead',
    'Chief Operating Officer'
];

export default function ProvisionAdmin() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form inputs
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [department, setDepartment] = useState('Information Technology');
    const [jobTitle, setJobTitle] = useState('System Administrator');
    const [governanceConfirmed, setGovernanceConfirmed] = useState(false);

    // Success modal state
    const [createdAdmin, setCreatedAdmin] = useState(null);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [copiedField, setCopiedField] = useState(null);

    const phoneValidation = validatePhPhone(phone);

    const handleCopy = async (text, fieldName) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(fieldName);
            toast.success(`${fieldName} copied to clipboard.`);
            setTimeout(() => setCopiedField(null), 2500);
        } catch {
            toast.error('Failed to copy to clipboard.');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!firstName.trim() || !lastName.trim()) {
            toast.error('First and last names are required.');
            return;
        }

        if (!email.trim() || !email.includes('@')) {
            toast.error('A valid corporate email address is required.');
            return;
        }

        if (phone && !phoneValidation.isValid) {
            toast.error('Please enter a valid Philippine mobile number (e.g. 917 123 4567).');
            return;
        }

        if (!governanceConfirmed) {
            toast.error('Please acknowledge the privileged access governance policy.');
            return;
        }

        setIsSubmitting(true);

        try {
            const payload = {
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                email: email.trim().toLowerCase(),
                phone: phone ? cleanPhPhone(phone) : null,
                department,
                job_title: jobTitle,
                governance_confirmed: true
            };

            const res = await fetchWithAuth('/api/employees/provision-admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Failed to provision administrative account.');
            }

            // Invalidate queries so admin lists reflect the new record
            queryClient.invalidateQueries({ queryKey: ['employees'] });
            queryClient.invalidateQueries({ queryKey: ['adminEmployeesListForDocs'] });

            setCreatedAdmin(data.data);
            setShowSuccessModal(true);
            toast.success('Administrator provisioned successfully.');
        } catch (error) {
            console.error('Admin provisioning error:', error);
            toast.error(error.message || 'Error provisioning administrator account.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const resetForm = () => {
        setFirstName('');
        setLastName('');
        setEmail('');
        setPhone('');
        setDepartment('Information Technology');
        setJobTitle('System Administrator');
        setGovernanceConfirmed(false);
        setCreatedAdmin(null);
        setShowSuccessModal(false);
    };

    return (
        <div className="max-w-4xl mx-auto pb-24 px-3 sm:px-6 lg:px-8 font-sans">
            <PageHeader
                breadcrumbs={['Admin', 'Employees', 'Provision Administrator']}
                actions={
                    <div className="flex items-center gap-2">
                        <Link
                            to="/admin/employees"
                            className="h-9 px-3.5 bg-white hover:bg-slate-50 text-slate-700 rounded-md font-medium text-xs border border-slate-200 transition-colors shadow-2xs flex items-center gap-1.5"
                        >
                            <i className="ti ti-arrow-left text-sm" />
                            <span>Back to Directory</span>
                        </Link>
                    </div>
                }
            />

            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="bg-white rounded-lg border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-6">
                    <div>
                        <h3 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
                            <span className="w-6 h-6 bg-slate-100 text-slate-700 rounded flex items-center justify-center border border-slate-200 text-xs">
                                <i className="ti ti-user-check" />
                            </span>
                            Administrator Identity
                        </h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                First Name <span className="text-rose-500">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                placeholder="e.g. Maria Clara"
                                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors shadow-2xs"
                            />
                        </div>

                        <div>
                            <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                Last Name <span className="text-rose-500">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                placeholder="e.g. Santos"
                                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors shadow-2xs"
                            />
                        </div>

                        <div>
                            <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                Corporate Email <span className="text-rose-500">*</span>
                            </label>
                            <div className="relative">
                                <i className="ti ti-mail absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none" />
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="maria.santos@c-point.com"
                                    className="w-full h-9 pl-9 pr-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors shadow-2xs"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                Contact Number (+63 Mobile)
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-slate-400 pointer-events-none">+63</span>
                                <input
                                    type="tel"
                                    value={phone}
                                    maxLength={12}
                                    onChange={(e) => setPhone(formatPhPhone(e.target.value))}
                                    placeholder="917 123 4567"
                                    className={`w-full h-9 pl-12 pr-3 bg-white border rounded-md focus:outline-none text-xs text-slate-800 transition-colors font-mono shadow-2xs ${
                                        phone && phoneValidation.isValid
                                            ? 'border-line focus:border-line'
                                            : phone && !phoneValidation.isValid
                                            ? 'border-warning/30 focus:border-warning'
                                            : 'border-slate-200 focus:border-accent'
                                    }`}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-lg border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-6">
                    <div>
                        <h3 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
                            <span className="w-6 h-6 bg-slate-100 text-slate-700 rounded flex items-center justify-center border border-slate-200 text-xs">
                                <i className="ti ti-briefcase" />
                            </span>
                            Administrative Assignment & Governance
                        </h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                Executive Department <span className="text-rose-500">*</span>
                            </label>
                            <select
                                value={department}
                                onChange={(e) => setDepartment(e.target.value)}
                                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors shadow-2xs cursor-pointer"
                            >
                                {ADMIN_DEPARTMENTS.map(dept => (
                                    <option key={dept} value={dept}>{dept}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                                Official Administrative Title <span className="text-rose-500">*</span>
                            </label>
                            <select
                                value={jobTitle}
                                onChange={(e) => setJobTitle(e.target.value)}
                                className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md focus:outline-none focus:border-accent text-xs text-slate-800 transition-colors shadow-2xs cursor-pointer"
                            >
                                {ADMIN_ROLES.map(role => (
                                    <option key={role} value={role}>{role}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Permissions Preview Grid */}
                    <div className="pt-2">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2.5">
                            Provisioned Privilege Scope
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-xs space-y-1">
                                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                                    <i className="ti ti-users text-accent text-sm" />
                                    Workforce Roster
                                </div>
                                <p className="text-[11px] text-slate-500">Full CRUD access to employee records and biometric passes.</p>
                            </div>

                            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-xs space-y-1">
                                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                                    <i className="ti ti-calculator text-accent text-sm" />
                                    Payroll Ledger
                                </div>
                                <p className="text-[11px] text-slate-500">Statutory calculation, deduction override, and pay slip release.</p>
                            </div>

                            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-xs space-y-1">
                                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                                    <i className="ti ti-folders text-accent text-sm" />
                                    Document Vault
                                </div>
                                <p className="text-[11px] text-slate-500">Direct 201 compliance review, approvals, and personal uploads.</p>
                            </div>

                            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-xs space-y-1">
                                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                                    <i className="ti ti-history text-accent text-sm" />
                                    Security Audit Trail
                                </div>
                                <p className="text-[11px] text-slate-500">Forensic access to system logs, logins, and administrative actions.</p>
                            </div>
                        </div>
                    </div>

                    {/* Mandatory Governance Checkbox */}
                    <div className="pt-3 border-t border-slate-100">
                        <label className="flex items-start gap-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={governanceConfirmed}
                                onChange={(e) => setGovernanceConfirmed(e.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent cursor-pointer"
                            />
                            <div className="text-xs text-slate-700 leading-relaxed select-none">
                                <span className="font-bold text-slate-900">Governance Compliance Acknowledgment: </span>
                                I certify that this administrative account is authorized under enterprise security governance and that the individual will complete multi-factor authentication upon initial access.
                            </div>
                        </label>
                    </div>
                </div>

                {/* Form Actions */}
                <div className="flex items-center justify-end gap-3 pt-2">
                    <Link
                        to="/admin/employees"
                        className="h-10 px-5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium text-xs rounded-md shadow-2xs transition-colors flex items-center"
                    >
                        Cancel
                    </Link>
                    <button
                        type="submit"
                        disabled={isSubmitting || !governanceConfirmed}
                        className="h-10 px-6 bg-accent hover:bg-accent-hover text-white font-semibold text-xs rounded-md shadow-2xs transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? (
                            <>
                                <i className="ti ti-loader-2 animate-spin text-sm" />
                                <span>Provisioning Administrator...</span>
                            </>
                        ) : (
                            <>
                                <i className="ti ti-shield-plus text-sm" />
                                <span>Provision Administrator Account</span>
                            </>
                        )}
                    </button>
                </div>
            </form>

            {/* Success Modal */}
            {showSuccessModal && createdAdmin && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-950/70" />
                    <div className="relative bg-white rounded-lg p-6 shadow-xl w-full max-w-md border border-slate-200 z-10 space-y-5">
                        <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                            <div className="w-10 h-10 rounded-full bg-accent-subtle text-accent flex items-center justify-center border border-accent/20">
                                <i className="ti ti-circle-check text-xl" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-slate-900">Administrator Provisioned</h3>
                                <p className="text-xs text-slate-500 font-medium">Temporary administrative credentials generated</p>
                            </div>
                        </div>

                        <div className="p-3.5 bg-slate-50 rounded-md border border-slate-200 space-y-3">
                            <div>
                                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Company ID</span>
                                <div className="flex items-center justify-between font-mono font-bold text-xs text-slate-800">
                                    <span>{createdAdmin.company_id}</span>
                                    <button
                                        type="button"
                                        onClick={() => handleCopy(createdAdmin.company_id, 'Company ID')}
                                        className="text-slate-400 hover:text-accent p-1"
                                    >
                                        <i className={`ti ${copiedField === 'Company ID' ? 'ti-check text-accent' : 'ti-copy'} text-sm`} />
                                    </button>
                                </div>
                            </div>

                            <div>
                                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Authorized Email</span>
                                <div className="flex items-center justify-between font-medium text-xs text-slate-800">
                                    <span className="truncate">{createdAdmin.email}</span>
                                    <button
                                        type="button"
                                        onClick={() => handleCopy(createdAdmin.email, 'Email')}
                                        className="text-slate-400 hover:text-accent p-1"
                                    >
                                        <i className={`ti ${copiedField === 'Email' ? 'ti-check text-accent' : 'ti-copy'} text-sm`} />
                                    </button>
                                </div>
                            </div>

                            <div>
                                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Temporary Password</span>
                                <div className="flex items-center justify-between font-mono font-bold text-xs bg-white px-2.5 py-1.5 rounded border border-slate-200 text-slate-900">
                                    <span>{createdAdmin.temporary_password}</span>
                                    <button
                                        type="button"
                                        onClick={() => handleCopy(createdAdmin.temporary_password, 'Temporary Password')}
                                        className="text-slate-400 hover:text-accent p-1"
                                    >
                                        <i className={`ti ${copiedField === 'Temporary Password' ? 'ti-check text-accent' : 'ti-copy'} text-sm`} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="p-3 bg-amber-50 rounded-md border border-amber-200 text-xs text-amber-900 leading-relaxed flex items-start gap-2">
                            <i className="ti ti-alert-triangle text-amber-600 text-sm shrink-0 mt-0.5" />
                            <span>
                                Securely transmit these credentials to the administrator. The user will be required to establish a permanent password and enroll in 2FA upon first sign-in.
                            </span>
                        </div>

                        <div className="flex items-center justify-end gap-2.5 pt-2">
                            <button
                                type="button"
                                onClick={resetForm}
                                className="h-9 px-4 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium text-xs rounded-md shadow-2xs transition-colors"
                            >
                                Provision Another
                            </button>
                            <button
                                type="button"
                                onClick={() => navigate('/admin/employees')}
                                className="h-9 px-4 bg-accent hover:bg-accent-hover text-white font-semibold text-xs rounded-md shadow-2xs transition-colors"
                            >
                                Done & Return
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
