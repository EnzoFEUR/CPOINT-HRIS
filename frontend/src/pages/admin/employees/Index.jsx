import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fetchWithAuth } from '../../../utils/api';

function EmployeeAvatar({ employee, isFactory }) {
    const [imageError, setImageError] = useState(false);

    const companyId = employee.company_id || employee.id;
    const imageUrl = companyId && employee.id
        ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${companyId}/${employee.id}.jpg`
        : null;

    const initials = `${employee.first_name?.[0] || ''}${employee.last_name?.[0] || ''}`.toUpperCase() || 'E';

    if (!imageError && imageUrl) {
        return (
            <img
                src={imageUrl}
                onError={() => setImageError(true)}
                alt={`${employee.first_name || ''} ${employee.last_name || ''}`}
                className="w-11 h-11 rounded-xl object-cover border border-slate-200 shrink-0 bg-slate-100"
            />
        );
    }

    return (
        <div className={`w-11 h-11 rounded-xl font-black text-sm flex items-center justify-center border uppercase shrink-0 ${isFactory
            ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-indigo-50 text-indigo-600 border-indigo-100'
            }`}>
            {initials}
        </div>
    );
}

export default function Index() {
    const [employees, setEmployees] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDept, setSelectedDept] = useState('All');

    useEffect(() => {
        fetchEmployees();
    }, []);

    const fetchEmployees = async () => {
        try {
            const res = await fetchWithAuth(`/api/employees?t=${Date.now()}`);
            const data = await res.json();
            if (data.success) {
                setEmployees(data.data || []);
            } else {
                toast.error(data.error || 'Failed to load employee list');
            }
        } catch (err) {
            toast.error('Network error loading directory');
        } finally {
            setIsLoading(false);
        }
    };

    const filteredEmployees = employees.filter(emp => {
        const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim().toLowerCase();
        const email = (emp.email || '').toLowerCase();
        const role = (emp.role || emp.job_title || '').toLowerCase();

        // Exclude Terminal Guard and System Administrator accounts
        const isExcluded =
            fullName.includes('terminal guard') ||
            fullName.includes('system admin') ||
            email === 'guard@c-point.com' ||
            email === 'admin@c-point.com' ||
            role.includes('super admin');

        if (isExcluded) return false;

        const matchesSearch = `${fullName} ${emp.job_title || ''} ${emp.email || ''}`
            .toLowerCase()
            .includes(searchQuery.toLowerCase());
        const matchesDept = selectedDept === 'All' || emp.department === selectedDept;

        return matchesSearch && matchesDept;
    });

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
                <p className="text-slate-500 font-bold tracking-widest uppercase text-sm">Loading Directory...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6 pb-24 lg:pb-8 px-4 sm:px-6 font-sans">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight">Employee Directory</h1>
                    <p className="text-slate-500 text-xs sm:text-sm font-medium mt-0.5">Manage staff across Factory piece-rate and Monthly departments</p>
                </div>
                <Link to="/admin/employees/create" className="w-full sm:w-auto px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md flex items-center justify-center gap-2">
                    <i className="ti ti-user-plus text-lg" /> Add Employee
                </Link>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-100 flex flex-col md:flex-row gap-3">
                <input
                    type="text"
                    placeholder="Search by name, title, or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700"
                />
                <select
                    value={selectedDept}
                    onChange={(e) => setSelectedDept(e.target.value)}
                    className="w-full md:w-56 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700"
                >
                    <option value="All">All Departments</option>
                    <option value="Factory">Factory (Piece Rate)</option>
                    <option value="Retail">Retail Store</option>
                    <option value="Security">Security</option>
                    <option value="HR/Admin">HR / Admin</option>
                    <option value="IT">IT</option>
                    <option value="Logistics">Logistics</option>
                </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredEmployees.map((employee) => {
                    const isFactory = employee.department?.toLowerCase().includes('factory');
                    const rate = isFactory
                        ? Number(employee.piece_rate ?? employee.rate_per_piece ?? employee.salary ?? 0)
                        : Number(employee.monthly_salary ?? employee.salary ?? 0);

                    return (
                        <div key={employee.id} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-xs flex flex-col justify-between space-y-4">
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <EmployeeAvatar employee={employee} isFactory={isFactory} />
                                    <div className="min-w-0">
                                        <h3 className="font-extrabold text-slate-800 text-base truncate">
                                            {employee.first_name} {employee.last_name}
                                        </h3>
                                        <p className="text-xs font-medium text-slate-400 truncate">{employee.job_title || 'No Position'}</p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between pt-1">
                                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-extrabold uppercase border flex items-center gap-1 ${isFactory
                                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                                        : 'bg-slate-100 text-slate-600 border-slate-200'
                                        }`}>
                                        {isFactory && <i className="ti ti-building-factory-2 text-amber-600" />}
                                        {employee.department || 'General'}
                                    </span>

                                    <span className={`px-2.5 py-0.5 text-[11px] font-black uppercase rounded border ${isFactory ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                        }`}>
                                        ₱{rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {isFactory ? '/ pc' : '/ mo'}
                                    </span>
                                </div>
                            </div>

                            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                                <span className="text-slate-400 font-medium truncate max-w-[150px]">{employee.email}</span>
                                <Link
                                    to={`/admin/employees/${employee.id}`}
                                    className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-extrabold rounded-xl transition-colors flex items-center gap-1.5"
                                >
                                    <span>View</span>
                                    <i className="ti ti-chevron-right text-xs" />
                                </Link>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}