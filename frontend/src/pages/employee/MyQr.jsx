import React, { useState } from 'react';
import QRCode from '../../components/QRCode';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

const MyQr = () => {
    const [user] = useState(() => JSON.parse(localStorage.getItem('user')) || { first_name: 'Employee', last_name: '', id: '0' });

    return (
        <div className="max-w-md mx-auto pb-24 lg:pb-6 px-4 sm:px-6 font-sans">
            <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="bg-white p-5 sm:p-8 rounded-2xl shadow-xs sm:shadow-sm border border-slate-100 text-center"
            >
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-50 text-blue-600 mb-3">
                    <i className="ti ti-qrcode text-2xl" />
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-slate-800 tracking-tight mb-1">My Digital Pass</h2>
                <p className="text-slate-500 text-xs sm:text-sm mb-6">Hold near the terminal scanner to log your attendance.</p>

                <div className="flex justify-center mb-6">
                    <div className="p-4 sm:p-5 bg-slate-50 border border-slate-200 rounded-2xl shadow-inner">
                        <QRCode 
                            value={user.company_id || String(user.id)} 
                            size={200} 
                            level="H"
                            fgColor="#0f172a"
                        />
                    </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-left w-full">
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">Personnel Information</p>
                    <p className="text-base font-bold text-slate-800 truncate">{user.name || `${user.first_name || ''} ${user.last_name || ''}`}</p>
                    <p className="text-xs text-slate-500 font-medium truncate">{user.job_title || 'Staff'} &bull; {user.department || 'General'}</p>
                    <p className="text-[10px] font-mono font-bold text-slate-400 mt-1">ID: #{user.company_id || user.id}</p>
                </div>

                <div className="mt-6">
                    <Link to="/employee/dashboard" className="inline-flex items-center gap-1.5 text-slate-500 hover:text-blue-600 font-bold text-xs sm:text-sm tap-active transition-colors">
                        <i className="ti ti-arrow-left" /> Back to Portal
                    </Link>
                </div>
            </motion.div>
        </div>
    );
};

export default MyQr;
