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
            
            <div className="bg-white p-8 sm:p-10 rounded-2xl shadow-xl text-center max-w-sm w-full border border-slate-200">
                <div className="mb-6 pb-4 border-b border-slate-100">
                    <h1 className="text-xl font-black text-slate-900 uppercase tracking-wider">C-Point Official ID</h1>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Staff Identification Pass</p>
                </div>

                <div className="flex justify-center mb-6">
                    <div className="p-4 bg-white border-2 border-slate-200 rounded-2xl shadow-sm">
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
                    <p className="text-indigo-600 font-black uppercase text-xs tracking-widest mt-1">{employee.job_title ?? 'STAFF'}</p>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-0.5">{employee.department ? `${employee.department} Dept.` : 'Operations'}</p>
                </div>

                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 mb-6">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Company ID</p>
                    <p className="font-mono text-xl font-black text-slate-900">{employee.company_id || (employee.id ? String(employee.id) : 'CP-EMPLOYEE')}</p>
                </div>

                <div className="no-print space-y-2.5">
                    <button onClick={handlePrint} className="w-full py-3.5 bg-slate-900 hover:bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-slate-900/20 transition text-sm">
                        Print ID Card
                    </button>
                    
                    <button onClick={handleClose} className="w-full py-3 bg-slate-100 text-slate-500 font-bold rounded-xl hover:bg-slate-200 transition text-xs">
                        Close Window
                    </button>
                </div>
            </div>
        </div>
    );
}
