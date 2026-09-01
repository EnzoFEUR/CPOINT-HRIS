import React from 'react';
import PageHeader from '../components/ui/PageHeader';
import MetricCard from '../components/ui/MetricCard';
import Badge from '../components/ui/Badge';

export default function AdminDashboard() {
  const totalStaff = 142;
  const factoryStaffCount = 95;
  const retailStaffCount = 47;
  const onLeaveCount = 14;
  const newHiresCount = 5;

  const leaveRequests = [
    { user: { name: 'Sarah Smith', id: '1004' }, start_date: '2026-06-10', end_date: '2026-06-15', type: 'Vacation', status: 'Pending' }
  ];

  return (
    <div className="max-w-7xl mx-auto pb-24 lg:pb-8 px-4 sm:px-6 lg:px-8 font-sans">
      <PageHeader
        breadcrumbs={['Admin', 'Overview', 'Workforce Metrics']}
        title="Admin Control Center"
        description="Comprehensive facility headcount, active shift distribution, and operational metrics."
      />

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <MetricCard
          label="Total Headcount"
          value={totalStaff}
          subtitle="All active facility personnel"
          icon={<i className="ti ti-users text-base text-blue-600" />}
        />
        <MetricCard
          label="Factory Staff"
          value={factoryStaffCount}
          subtitle="Production & logistics"
          icon={<i className="ti ti-building-factory-2 text-base text-indigo-600" />}
        />
        <MetricCard
          label="Retail Staff"
          value={retailStaffCount}
          subtitle="Store & cashier units"
          icon={<i className="ti ti-shopping-bag text-base text-amber-600" />}
        />
        <MetricCard
          label="On Leave Today"
          value={onLeaveCount}
          subtitle="Authorized PTO & sick days"
          icon={<i className="ti ti-plane-departure text-base text-purple-600" />}
        />
        <MetricCard
          label="New Hires"
          value={newHiresCount}
          change="+3.6%"
          trend="up"
          subtitle="Current payroll period"
          icon={<i className="ti ti-user-plus text-base text-emerald-600" />}
        />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Leave requests */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-xs border border-slate-200 flex flex-col overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Pending Leave Approvals</h3>
              <p className="text-xs text-slate-500">Requires management sign-off</p>
            </div>
            <a href="/admin/leaves" className="text-xs font-semibold text-blue-600 hover:text-blue-700">
              View All Approvals &rarr;
            </a>
          </div>
          
          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leaveRequests.map((request, i) => (
                  <tr key={i} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-bold text-xs">
                          {request.user.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900 text-xs">{request.user.name}</p>
                          <p className="text-[11px] text-slate-400 font-mono">#{request.user.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-mono tabular-nums">
                      {request.start_date} - {request.end_date}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded border border-slate-200 text-slate-700 bg-slate-50 font-medium">
                        {request.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge variant="late">
                        {request.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Operational Schedule Overview */}
        <div className="lg:col-span-1 bg-white p-4 sm:p-5 rounded-xl shadow-xs border border-slate-200">
          <div className="border-b border-slate-200 pb-3 mb-4">
            <h3 className="text-sm font-semibold text-slate-900">Shift Coverage Summary</h3>
            <p className="text-xs text-slate-500">Real-time facility allocations</p>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="h-2 w-2 rounded-full bg-amber-500" />
                <span className="text-xs font-medium text-slate-700">Morning Shift (06:00 - 14:00)</span>
              </div>
              <span className="font-mono text-xs font-bold text-slate-900">62 Staff</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-xs font-medium text-slate-700">Mid Shift (14:00 - 22:00)</span>
              </div>
              <span className="font-mono text-xs font-bold text-slate-900">48 Staff</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="h-2 w-2 rounded-full bg-indigo-500" />
                <span className="text-xs font-medium text-slate-700">Night Shift (22:00 - 06:00)</span>
              </div>
              <span className="font-mono text-xs font-bold text-slate-900">32 Staff</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
