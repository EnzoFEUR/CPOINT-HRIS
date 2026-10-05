import React, { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getUser } from '../../routes/guards';
import OtpVerificationModal from '../OtpVerificationModal';

export default function EmployeeModuleGate({ children }) {
    const navigate = useNavigate();
    const location = useLocation();
    const user = getUser();

    const userIdentifier = user?.id || user?.email || 'admin';
    const unlockKey = `cpoint_employee_module_unlocked_${userIdentifier}`;

    const [isUnlocked, setIsUnlocked] = useState(() => {
        try {
            return sessionStorage.getItem(unlockKey) === 'true';
        } catch {
            return false;
        }
    });

    const isUnlockedRef = useRef(isUnlocked);
    isUnlockedRef.current = isUnlocked;

    // Do not auto-pop the modal upon arrival; user opens it via button
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Keep unlock status in sync across navigations and session events
    useEffect(() => {
        try {
            const unlocked = sessionStorage.getItem(unlockKey) === 'true';
            isUnlockedRef.current = unlocked;
            setIsUnlocked(unlocked);
            if (unlocked) {
                setIsModalOpen(false);
            }
        } catch {
            isUnlockedRef.current = false;
            setIsUnlocked(false);
        }
    }, [location.pathname, unlockKey]);

    const handleVerificationSuccess = (data) => {
        try {
            sessionStorage.setItem(unlockKey, 'true');
        } catch {}
        isUnlockedRef.current = true;
        setIsUnlocked(true);
        setIsModalOpen(false);
        toast.success('Employee module access verified');

        // Maintain or ensure route remains on employee module - never dashboard
        const currentPath = location.pathname;
        if (currentPath === '/' || (!currentPath.startsWith('/admin/employees') && !currentPath.startsWith('/admin/archive'))) {
            navigate('/admin/employees', { replace: true });
        }
    };

    const handleModalClose = () => {
        // Close modal and return user smoothly to the security gate screen
        setIsModalOpen(false);
    };

    // If unlocked, render employee routes immediately with zero delay
    if (isUnlocked) {
        return children ? <>{children}</> : <Outlet />;
    }

    // High-security gatekeeper placeholder when locked
    return (
        <div className="min-h-[calc(100vh-140px)] flex items-center justify-center p-4 font-sans animate-in fade-in duration-200">
            <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8 text-center space-y-6">
                <div className="h-14 w-14 mx-auto bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center border border-blue-200 shadow-2xs">
                    <i className="ti ti-shield-lock text-2xl" />
                </div>

                <div className="space-y-1.5">
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                        Employee Module Security Gate
                    </h2>
                    <p className="text-xs text-slate-500 font-medium leading-relaxed">
                        Access to employee personnel records, directories, compensation, and biometric identifiers is strictly protected. Two-factor authentication (2FA) is required to unlock this module for your current session.
                    </p>
                </div>

                <div className="space-y-2.5 pt-2 border-t border-slate-100">
                    <button
                        type="button"
                        onClick={() => setIsModalOpen(true)}
                        className="w-full h-11 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-md text-xs font-semibold shadow-2xs flex items-center justify-center gap-2 transition-colors duration-100 cursor-pointer"
                    >
                        <i className="ti ti-shield-lock text-base" />
                        <span>Verify Identity (2FA)</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => navigate('/', { replace: true })}
                        className="w-full h-9 bg-white hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold border border-slate-200 flex items-center justify-center gap-1.5 transition-colors duration-100 cursor-pointer shadow-2xs"
                    >
                        <i className="ti ti-arrow-left text-xs" />
                        <span>Return to Dashboard</span>
                    </button>
                </div>
            </div>

            <OtpVerificationModal
                isOpen={isModalOpen}
                onClose={handleModalClose}
                onSuccess={handleVerificationSuccess}
                email={user?.email}
                title="Employee Module Security Gate"
                subtitle="Authenticate with 2FA to access employee personnel records"
                description="Step-up authentication required for workforce records."
            />
        </div>
    );
}
