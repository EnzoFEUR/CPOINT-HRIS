import React, { useState, useEffect } from 'react';
import { QRCodeSVG as QRCode } from 'qrcode.react';
import { Link } from 'react-router-dom';

const MyQr = () => {
    const [user, setUser] = useState(null);

    useEffect(() => {
        fetch('http://localhost:5000/api/employees')
            .then(res => res.json())
            .then(data => {
                if(data.success && data.data.length > 0) {
                    setUser(data.data[0]);
                }
            })
            .catch(err => console.error(err));
    }, []);

    if (!user) {
        return <div className="p-8 text-center text-slate-500 font-bold">Loading QR Code...</div>;
    }

    return (
        <div className="max-w-xl mx-auto py-10">
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 text-center">
                
                <h2 className="text-2xl font-bold text-slate-800 mb-2">My Attendance QR</h2>
                <p className="text-slate-500 text-sm mb-8">Show this to the admin or scanner to log in.</p>

                <div className="flex justify-center mb-8">
                    <div className="p-4 bg-white border-2 border-slate-900 rounded-xl">
                        <QRCode 
                            value={user.company_id || String(user.id)} 
                            size={280} 
                            level="H"
                            fgColor="#0f172a"
                        />
                    </div>
                </div>

                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 inline-block text-left w-full">
                    <p className="text-xs font-bold text-blue-500 uppercase">Employee Details</p>
                    <p className="text-lg font-bold text-slate-800">{user.first_name} {user.last_name}</p>
                    <p className="text-sm text-slate-600">{user.email}</p>
                    <p className="text-xs text-slate-400 mt-1">ID: #{user.id}</p>
                </div>

                <div className="mt-8">
                    <Link to="/dashboard" className="text-slate-400 hover:text-slate-600 font-bold text-sm">
                        &larr; Back to Dashboard
                    </Link>
                </div>

            </div>
        </div>
    );
};

export default MyQr;
