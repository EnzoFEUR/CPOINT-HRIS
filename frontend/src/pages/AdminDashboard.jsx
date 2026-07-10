import React, { useState } from 'react';

export default function AdminDashboard() {
  const [currentDate, setCurrentDate] = useState(new Date());
  
  const totalStaff = 142;
  const factoryStaffCount = 95;
  const retailStaffCount = 47;
  const onLeaveCount = 14;
  const newHiresCount = 5;

  const leaveRequests = [
    { user: { name: 'Sarah Smith', id: '1004' }, start_date: '2026-06-10', end_date: '2026-06-15', type: 'Vacation', status: 'Pending' }
  ];

  const getStatusStyle = (status) => {
    switch (status) {
      case 'Approved': return 'bg-green-50 text-green-700 border-green-100';
      case 'Pending': return 'bg-amber-50 text-amber-700 border-amber-100';
      case 'Rejected': return 'bg-red-50 text-red-700 border-red-100';
      default: return 'bg-slate-50 text-slate-600';
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* 2. STATS BENTO GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* A. PRIMARY METRIC: Total Staff */}
        <div className="lg:col-span-1 bg-slate-900 rounded-[2rem] p-8 text-white group cursor-pointer relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl -mr-6 -mt-6"></div>
          
          <div className="relative z-10 h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-400 mb-2">
                <i className="ti ti-chart-pie text-blue-400"></i>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-300">Total Staff</p>
              </div>
              <p className="text-6xl font-semibold tracking-tight text-white/95">{totalStaff}</p>
            </div>
            
            <div className="mt-8 inline-flex items-center justify-between w-full rounded-2xl bg-white/5 px-5 py-3 text-sm font-medium text-slate-200 backdrop-blur-xl border border-white/10 group-hover:bg-white/10 transition duration-300">
              <span>Factory & Retail</span> 
              <div className="h-7 w-7 rounded-full bg-white/10 flex items-center justify-center border border-white/5">
                <i className="ti ti-chevron-right text-xs">&gt;</i>
              </div>
            </div>
          </div>
        </div>

        {/* B. MINI STATS GRID */}
        <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white/80 backdrop-blur-md p-6 rounded-[2rem] shadow-sm border border-slate-100 hover:border-indigo-100 flex flex-col justify-between hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-500 group relative overflow-hidden cursor-pointer">
            <div className="relative z-10 flex justify-between items-start">
              <div className="h-12 w-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                <i className="ti ti-building-factory-2 text-2xl"></i>
              </div>
              <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-lg group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors duration-500">Production</span>
            </div>
            <div className="relative z-10 mt-4">
              <p className="text-3xl font-bold text-slate-800">{factoryStaffCount}</p>
              <p className="text-sm text-slate-400 font-medium">Factory Staff</p>
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur-md p-6 rounded-[2rem] shadow-sm border border-slate-100 hover:border-orange-100 flex flex-col justify-between hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-500 group relative overflow-hidden cursor-pointer">
            <div className="relative z-10 flex justify-between items-start">
              <div className="h-12 w-12 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                <i className="ti ti-shopping-bag text-2xl"></i>
              </div>
              <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-lg group-hover:bg-orange-50 group-hover:text-orange-600 transition-colors duration-500">Store</span>
            </div>
            <div className="relative z-10 mt-4">
              <p className="text-3xl font-bold text-slate-800">{retailStaffCount}</p>
              <p className="text-sm text-slate-400 font-medium">Retail Staff</p>
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur-md p-6 rounded-[2rem] shadow-sm border border-slate-100 hover:border-pink-100 flex flex-col justify-between hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-500 group relative overflow-hidden cursor-pointer">
            <div className="relative z-10 flex justify-between items-start">
              <div className="h-12 w-12 bg-pink-50 text-pink-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                <i className="ti ti-plane-departure text-2xl"></i>
              </div>
              <span className="text-xs font-bold bg-pink-100 text-pink-600 px-2 py-1 rounded-lg group-hover:bg-pink-200 transition-colors duration-500">Today</span>
            </div>
            <div className="relative z-10 mt-4">
              <p className="text-3xl font-bold text-slate-800">{onLeaveCount}</p>
              <p className="text-sm text-slate-400 font-medium">On Leave</p>
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur-md p-6 rounded-[2rem] shadow-sm border border-slate-100 hover:border-emerald-100 flex flex-col justify-between hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-500 group relative overflow-hidden cursor-pointer">
            <div className="relative z-10 flex justify-between items-start">
              <div className="h-12 w-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                <i className="ti ti-user-plus text-2xl"></i>
              </div>
              <span className="text-xs font-bold bg-emerald-100 text-emerald-600 px-2 py-1 rounded-lg group-hover:bg-emerald-200 transition-colors duration-500">+{newHiresCount}</span>
            </div>
            <div className="relative z-10 mt-4">
              <p className="text-3xl font-bold text-slate-800">{newHiresCount}</p>
              <p className="text-sm text-slate-400 font-medium">New Hires</p>
            </div>
          </div>
        </div>
      </div>

      {/* 3. MAIN CONTENT SPLIT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
        {/* LEFT: REQUESTS TABLE */}
        <div className="lg:col-span-2 bg-white/80 backdrop-blur-md rounded-[2rem] shadow-sm border border-slate-100 flex flex-col overflow-hidden">
          <div className="p-8 border-b border-slate-50 flex justify-between items-center">
            <div>
              <h3 className="text-xl font-bold text-slate-800">Leave Requests</h3>
              <p className="text-sm text-slate-400">Manage pending approvals</p>
            </div>
            <button className="text-sm font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-xl transition-colors">
              View All
            </button>
          </div>
          
          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50/50 text-slate-400 text-xs uppercase font-bold tracking-wider">
                <tr>
                  <th className="px-8 py-4">Employee</th>
                  <th className="px-8 py-4">Duration</th>
                  <th className="px-8 py-4">Type</th>
                  <th className="px-8 py-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {leaveRequests.map((request, i) => (
                  <tr key={i} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-8 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm">
                          {request.user.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-slate-700 text-sm group-hover:text-blue-600 transition-colors">{request.user.name}</p>
                          <p className="text-xs text-slate-400">#{request.user.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-4 text-sm font-medium text-slate-600">
                      {request.start_date} - {request.end_date}
                    </td>
                    <td className="px-8 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                        {request.type}
                      </span>
                    </td>
                    <td className="px-8 py-4 text-right">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-bold border ${getStatusStyle(request.status)}`}>
                        {request.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: CALENDAR WIDGET */}
        <div className="lg:col-span-1 bg-white/80 backdrop-blur-md p-8 rounded-[2rem] shadow-sm border border-slate-100 h-fit">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h3 className="text-lg font-bold text-slate-800">Schedule</h3>
              <p className="text-xs text-slate-400">Interviews & Events</p>
            </div>
          </div>
          <div className="text-center py-8 text-slate-400 italic text-sm">
            Interactive Calendar Component Goes Here
          </div>
        </div>
      </div>
    </div>
  );
}
