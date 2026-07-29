import React from 'react';
import QRCode from 'react-qr-code';

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
            
            <div className="bg-white p-8 rounded-xl shadow-xl text-center max-w-sm w-full border border-gray-200">
                <div className="mb-6">
                    <h1 className="text-xl font-bold text-slate-800 uppercase tracking-widest">Company ID</h1>
                    <p className="text-xs text-slate-400">Official Staff Identification</p>
                </div>

                <div className="flex justify-center mb-6">
                    <div className="p-2 border-4 border-slate-900 rounded-xl">
                        <QRCode 
                            value={employee.company_id || String(employee.id)} 
                            size={250} 
                            level="H"
                            fgColor="#0f172a"
                        />
                    </div>
                </div>

                <div className="mb-6">
                    <h2 className="text-2xl font-black text-slate-800 leading-tight">{employee.name}</h2>
                    <p className="text-blue-600 font-bold uppercase text-sm mt-1">{employee.job_title ?? 'Staff'}</p>
                    <p className="text-slate-400 text-xs mt-1">{employee.department ? `${employee.department} Dept.` : ''}</p>
                </div>

                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 mb-8">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Employee ID</p>
                    <p className="font-mono text-xl font-black text-slate-700">#{employee.id}</p>
                </div>

                <div className="no-print space-y-3">
                    <button onClick={handlePrint} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-600/30 transition">
                        Print ID Card
                    </button>
                    
                    <button onClick={handleClose} className="w-full py-3 bg-slate-100 text-slate-500 font-bold rounded-xl hover:bg-slate-200 transition">
                        Close Window
                    </button>
                </div>
            </div>
        </div>
    );
}
