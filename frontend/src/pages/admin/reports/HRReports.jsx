import React, { useState } from 'react';
import api from '../../../utils/api';

export default function HRReports() {
  const [activeTab, setActiveTab] = useState('DTR');
  const [startDate, setStartDate] = useState(new Date().toISOString().substring(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().substring(0, 10));
  const [department, setDepartment] = useState('All');
  const [year, setYear] = useState('2026');
  const [month, setMonth] = useState('8');
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchDTRReport = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/reports/dtr?start_date=${startDate}&end_date=${endDate}&department=${department}`);
      setReportData(res.data.data);
    } catch (err) {
      alert(`Report error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchDOLESummary = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/reports/dole-statutory?year=${year}&month=${month}`);
      setReportData(res.data);
    } catch (err) {
      alert(`Report error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!reportData) return;
    let csvContent = 'data:text/csv;charset=utf-8,';

    if (activeTab === 'DTR' && Array.isArray(reportData)) {
      csvContent += 'Date,Employee ID,Name,Department,Time In,Time Out,Status\n';
      reportData.forEach(r => {
        csvContent += `${r.date},${r.employees?.company_id},"${r.employees?.first_name} ${r.employees?.last_name}",${r.employees?.department},${r.time_in || 'N/A'},${r.time_out || 'N/A'},${r.status}\n`;
      });
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${activeTab}_Report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 bg-slate-900 text-slate-100 min-h-screen">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">1-Click Audit-Compliant HR Reports</h1>
        <p className="text-slate-400 text-sm">Generate compliance reports for DOLE statutory remittances, DTR timecards, and leave utilization.</p>
      </div>

      <div className="flex space-x-2 border-b border-slate-800 pb-4 mb-6">
        {['DTR', 'DOLE Statutory Remittance', 'Leave Utilization'].map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setReportData(null); }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === tab ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Controls Bar */}
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-wrap items-center gap-4 mb-6">
        {activeTab === 'DTR' && (
          <>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-slate-900 border border-slate-700 text-sm rounded-lg px-3 py-1.5 text-white" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">End Date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-slate-900 border border-slate-700 text-sm rounded-lg px-3 py-1.5 text-white" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Department</label>
              <select value={department} onChange={e => setDepartment(e.target.value)} className="bg-slate-900 border border-slate-700 text-sm rounded-lg px-3 py-1.5 text-white">
                <option value="All">All Departments</option>
                <option value="IT">IT</option>
                <option value="HR">HR</option>
                <option value="Finance">Finance</option>
              </select>
            </div>
            <button onClick={fetchDTRReport} className="mt-5 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg font-medium">Generate DTR</button>
          </>
        )}

        {activeTab === 'DOLE Statutory Remittance' && (
          <>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Year</label>
              <input type="number" value={year} onChange={e => setYear(e.target.value)} className="bg-slate-900 border border-slate-700 text-sm rounded-lg px-3 py-1.5 text-white" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Month</label>
              <select value={month} onChange={e => setMonth(e.target.value)} className="bg-slate-900 border border-slate-700 text-sm rounded-lg px-3 py-1.5 text-white">
                {Array.from({ length: 12 }, (_, i) => <option key={i+1} value={i+1}>Month {i+1}</option>)}
              </select>
            </div>
            <button onClick={fetchDOLESummary} className="mt-5 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg font-medium">Generate Summary</button>
          </>
        )}

        {reportData && (
          <button onClick={exportCSV} className="mt-5 ml-auto bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-4 py-2 rounded-lg font-medium">
            Export CSV
          </button>
        )}
      </div>

      {/* Report Display */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Querying database engine...</div>
      ) : activeTab === 'DTR' && Array.isArray(reportData) ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/60 text-slate-400 uppercase text-xs">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Employee</th>
                <th className="p-3">Department</th>
                <th className="p-3">Time In</th>
                <th className="p-3">Time Out</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {reportData.map((row) => (
                <tr key={row.id}>
                  <td className="p-3">{row.date}</td>
                  <td className="p-3">{row.employees?.first_name} {row.employees?.last_name}</td>
                  <td className="p-3">{row.employees?.department}</td>
                  <td className="p-3 font-mono">{row.time_in || '--:--'}</td>
                  <td className="p-3 font-mono">{row.time_out || '--:--'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${row.status === 'Present' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : activeTab === 'DOLE Statutory Remittance' && reportData?.summary ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
            <span className="text-xs text-slate-400">Total SSS Employee Contribution</span>
            <p className="text-xl font-bold text-blue-400 mt-1">PHP {reportData.summary.total_sss.toLocaleString()}</p>
          </div>
          <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
            <span className="text-xs text-slate-400">Total PhilHealth Contribution</span>
            <p className="text-xl font-bold text-emerald-400 mt-1">PHP {reportData.summary.total_philhealth.toLocaleString()}</p>
          </div>
          <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
            <span className="text-xs text-slate-400">Total Pag-IBIG Remittance</span>
            <p className="text-xl font-bold text-amber-400 mt-1">PHP {reportData.summary.total_pagibig.toLocaleString()}</p>
          </div>
          <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
            <span className="text-xs text-slate-400">Withholding Tax Remittance</span>
            <p className="text-xl font-bold text-purple-400 mt-1">PHP {reportData.summary.total_tax.toLocaleString()}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}