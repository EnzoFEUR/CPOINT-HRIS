import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchWithAuth } from '../../../utils/api';

function EmployeeAvatar({ employee, isFactory }) {
    const [imageError, setImageError] = useState(false);

    const companyId = employee.company_id || employee.id;
    const imageUrl = companyId && employee.id
        ? `https://lzqshktnrvtlattdiwxf.supabase.co/storage/v1/object/public/public-bucket/face-baselines/${companyId}/${employee.id}.jpg`
        : null;

    const initials = `${employee.first_name?.[0] || ''}${employee.last_name?.[0] || ''}`.toUpperCase() || 'CP';

    if (!imageError && imageUrl) {
        return (
            <motion.img
                whileHover={{ scale: 1.08 }}
                src={imageUrl}
                onError={() => setImageError(true)}
                alt={`${employee.first_name || ''} ${employee.last_name || ''}`}
                className="w-12 h-12 rounded-2xl object-cover border-2 border-slate-100 shrink-0 bg-slate-100 shadow-xs"
            />
        );
    }

    return (
        <motion.div
            whileHover={{ scale: 1.08 }}
            className={`w-12 h-12 rounded-2xl font-black text-sm flex items-center justify-center border uppercase shrink-0 shadow-xs ${isFactory
                ? 'bg-amber-50 text-amber-700 border-amber-200/80'
                : 'bg-indigo-50 text-indigo-600 border-indigo-200/80'
            }`}
        >
            {initials}
        </motion.div>
    );
}

const containerVariants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.05,
            delayChildren: 0.1
        }
    }
};

const itemVariants = {
    hidden: { opacity: 0, y: 15, scale: 0.98 },
    show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.25, ease: 'easeOut' } },
    exit: { opacity: 0, scale: 0.95, transition: { duration: 0.15 } }
};

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
        const companyId = (emp.company_id || '').toLowerCase();

        // Universal safeguard against technical system accounts
        const isExcluded =
            fullName.includes('terminal guard') ||
            fullName.includes('system admin') ||
            email === 'guard@c-point.com' ||
            email === 'admin@c-point.com' ||
            role.includes('admin') ||
            role.includes('security');

        if (isExcluded) return false;

        const matchesSearch = `${fullName} ${emp.job_title || ''} ${emp.email || ''} ${companyId}`
            .toLowerCase()
            .includes(searchQuery.toLowerCase());
        const matchesDept = selectedDept === 'All' || emp.department === selectedDept;

        return matchesSearch && matchesDept;
    });

    // Compute Stat Metrics
    const totalCount = filteredEmployees.length;
    const factoryCount = filteredEmployees.filter(e => (e.department || '').toLowerCase().includes('factory')).length;
    const monthlyCount = totalCount - factoryCount;
    const biometricsCount = filteredEmployees.filter(e => e.has_registered_biometrics).length;
    const biometricsPercent = totalCount > 0 ? Math.round((biometricsCount / totalCount) * 100) : 0;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[65vh] space-y-4 font-sans">
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center animate-pulse">
                    <i className="ti ti-users text-3xl text-indigo-600" />
                </div>
                <p className="text-slate-400 font-black tracking-widest uppercase text-xs">Loading Personnel Directory...</p>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="max-w-7xl mx-auto space-y-6 pb-24 lg:pb-8 px-4 sm:px-6 font-sans"
        >
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight">Personnel Directory</h1>
                    <p className="text-slate-400 text-xs sm:text-sm font-medium mt-0.5">
                        Manage active workforce profiles, biometric enrollment, and DOLE wage classifications
                    </p>
                </div>
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <Link
                        to="/admin/employees/create"
                        className="w-full sm:w-auto px-5 py-3 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-black text-xs uppercase tracking-widest rounded-2xl transition-all shadow-md shadow-indigo-500/20 flex items-center justify-center gap-2 cursor-pointer"
                    >
                        <i className="ti ti-user-plus text-base" />
                        <span>Add New Employee</span>
                    </Link>
                </motion.div>
            </div>

            {/* Top 4-Card Bento Stat Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <motion.div
                    whileHover={{ y: -3 }}
                    className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs"
                >
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Personnel</p>
                    <h3 className="text-3xl font-black text-slate-800 mt-1">{totalCount}</h3>
                    <span className="text-xs font-bold text-indigo-600 mt-2 block">Active Records</span>
                </motion.div>

                <motion.div
                    whileHover={{ y: -3 }}
                    className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs"
                >
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Monthly Salaried</p>
                    <h3 className="text-3xl font-black text-slate-800 mt-1">{monthlyCount}</h3>
                    <span className="text-xs font-bold text-blue-500 mt-2 block">IT, Retail & Admin</span>
                </motion.div>

                <motion.div
                    whileHover={{ y: -3 }}
                    className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs"
                >
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Factory Piece-Rate</p>
                    <h3 className="text-3xl font-black text-slate-800 mt-1">{factoryCount}</h3>
                    <span className="text-xs font-bold text-amber-500 mt-2 block">Production Staff</span>
                </motion.div>

                <motion.div
                    whileHover={{ y: -3 }}
                    className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs"
                >
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Biometrics Enrolled</p>
                    <h3 className="text-3xl font-black text-slate-800 mt-1">{biometricsPercent}%</h3>
                    <span className="text-xs font-bold text-emerald-500 mt-2 block">{biometricsCount} of {totalCount} Enrolled</span>
                </motion.div>
            </div>

            {/* Filter and Search Bar */}
            <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-xs flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                    <i className="ti ti-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-base" />
                    <input
                        type="text"
                        placeholder="Search by name, company ID, position, or email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-2xl text-sm font-bold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-400"
                    />
                </div>
                <div className="relative">
                    <select
                        value={selectedDept}
                        onChange={(e) => setSelectedDept(e.target.value)}
                        className="w-full md:w-56 px-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-2xl text-sm font-bold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all cursor-pointer"
                    >
                        <option value="All">All Departments</option>
                        <option value="Factory">Factory (Piece Rate)</option>
                        <option value="Retail">Retail Store</option>
                        <option value="IT">Information Technology</option>
                        <option value="Logistics">Logistics & Supply</option>
                        <option value="HR/Admin">HR & Administration</option>
                    </select>
                </div>
            </div>

            {/* Animated Employee Cards Grid */}
            {filteredEmployees.length > 0 ? (
                <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="show"
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
                >
                    <AnimatePresence>
                        {filteredEmployees.map((employee) => {
                            const isFactory = employee.department?.toLowerCase().includes('factory');
                            const rate = isFactory
                                ? Number(employee.piece_rate ?? employee.rate_per_piece ?? employee.salary ?? 0)
                                : Number(employee.monthly_salary ?? employee.salary ?? 0);

                            return (
                                <motion.div
                                    key={employee.id}
                                    layout
                                    variants={itemVariants}
                                    whileHover={{ y: -4, transition: { duration: 0.2 } }}
                                    className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between space-y-4 group"
                                >
                                    <div className="space-y-3.5">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3.5 min-w-0">
                                                <EmployeeAvatar employee={employee} isFactory={isFactory} />
                                                <div className="min-w-0">
                                                    <h3 className="font-black text-slate-800 text-base truncate group-hover:text-indigo-600 transition-colors">
                                                        {employee.first_name} {employee.last_name}
                                                    </h3>
                                                    <p className="text-xs font-semibold text-slate-400 truncate">
                                                        {employee.job_title || 'Staff Specialist'}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Company ID & Department Badges */}
                                        <div className="flex items-center justify-between pt-1">
                                            <span className="px-2.5 py-1 bg-slate-100 border border-slate-200/80 rounded-xl text-[10px] font-mono font-bold text-slate-600">
                                                {employee.company_id || 'ID Pending'}
                                            </span>

                                            <span className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase border flex items-center gap-1 ${isFactory
                                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                                : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                            }`}>
                                                {isFactory && <i className="ti ti-building-factory-2" />}
                                                {employee.department || 'General'}
                                            </span>
                                        </div>

                                        {/* Rate Pill */}
                                        <div className="p-3 bg-slate-50/80 rounded-2xl border border-slate-100 flex items-center justify-between text-xs">
                                            <span className="text-[11px] font-bold text-slate-400 uppercase">Rate Basis</span>
                                            <span className={`font-mono font-black ${isFactory ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                ₱{rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {isFactory ? '/ piece' : '/ mo'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Action Links */}
                                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                                        <span className="text-slate-400 font-medium truncate max-w-[140px] text-[11px]">
                                            {employee.email || 'No email registered'}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <Link
                                                to={`/admin/employees/${employee.id}`}
                                                className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 active:scale-95 text-indigo-600 font-extrabold rounded-xl transition-all flex items-center gap-1 cursor-pointer"
                                            >
                                                <span>Profile</span>
                                                <i className="ti ti-chevron-right text-xs" />
                                            </Link>
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </motion.div>
            ) : (
                <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white rounded-3xl p-12 text-center border border-slate-100 shadow-xs space-y-3"
                >
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 mx-auto flex items-center justify-center">
                        <i className="ti ti-search text-2xl" />
                    </div>
                    <h3 className="text-base font-black text-slate-800">No personnel match your search</h3>
                    <p className="text-xs text-slate-400 font-medium">Try clearing the search query or changing the department filter.</p>
                </motion.div>
            )}
        </motion.div>
    );
}
