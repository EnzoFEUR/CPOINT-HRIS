import React from 'react';
import QRCode from '../../../components/QRCode';

export default function QrPrint({ employee = {} }) {
    const handlePrint = () => {
        window.print();
    };

    const handleClose = () => {
        window.close();
    };

    return (
        <div className="bg-gray-100 flex items-center justify-center min-h-screen">
            <style>{`
                @media print {
                    .no-print { display: none; }
                    body { background: white; }
                }
            `}</style>
            
            <div className="bg-white p-6 sm:p-8 rounded-lg shadow-xl text-center max-w-sm w-full border border-slate-200">
                <div className="mb-6 pb-4 border-b border-slate-100">
                    <h1 className="text-xl font-black text-slate-900 uppercase tracking-wider">C-Point Official ID</h1>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Staff Identification Pass</p>
                </div>

                <div className="flex justify-center mb-6">
                    <div className="p-3 bg-white border border-slate-200 rounded-md shadow-2xs">
                        <QRCode 
                            value={employee.company_id || (employee.id ? String(employee.id) : 'CP-EMPLOYEE')} 
                            size={240} 
                            level="H"
                            margin={2}
                            fgColor="#0f172a"
                            bgColor="#ffffff"
                        />
                    </div>
                </div>

                <div className="mb-6">
                    <h2 className="text-2xl font-black text-slate-900 leading-tight">{employee.name}</h2>
                    <p className="text-accent font-black uppercase text-xs tracking-widest mt-1">{employee.job_title ?? 'STAFF'}</p>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-0.5">{employee.department ? `${employee.department} Dept.` : 'Operations'}</p>
                </div>

                <div className="bg-slate-50 p-3 rounded-md border border-slate-200 mb-6">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Company ID</p>
                    <p className="font-mono text-xl font-black text-slate-900">{employee.company_id || (employee.id ? String(employee.id) : 'CP-EMPLOYEE')}</p>
                </div>

                <div className="no-print space-y-2">
                    <button onClick={handlePrint} className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md shadow-2xs transition-colors duration-100 text-xs cursor-pointer flex items-center justify-center gap-1.5">
                        <i className="ti ti-printer text-sm" /> Print ID Card
                    </button>
                    
                    <button onClick={handleClose} className="w-full h-9 bg-slate-100 text-slate-600 font-semibold rounded-md hover:bg-slate-200 transition-colors duration-100 text-xs cursor-pointer shadow-2xs">
                        Close Window
                    </button>
                </div>
            </div>
        </div>
    );
}
