import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';

const API_BASE_URL = 'http://localhost:5000';
const CATEGORIES = ['All', 'Contract', 'Government ID', 'Clearance', 'Certificate', 'Performance', 'Other'];

const getToken = () => {
  const directToken = localStorage.getItem('token');
  if (directToken) return directToken;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('sb-') || key.includes('auth-token'))) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key));
        if (parsed?.access_token) return parsed.access_token;
      } catch (_) {}
    }
  }
  return null;
};

export const Document = ({ user }) => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const outletContext = useOutletContext();
  const storedUser = React.useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);

  const currentUser = user || outletContext?.user || outletContext || storedUser;
  const employeeId = currentUser?.id || currentUser?.employee_id;

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [sortOrder, setSortOrder] = useState('newest');
  const [isDragging, setIsDragging] = useState(false);

  const fetchDocuments = useCallback(async () => {
    if (!employeeId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const token = getToken();
      if (!token) {
        console.warn('No authentication token found.');
        setLoading(false);
        return;
      }

      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-user-id': currentUser?.id || '',
        'x-user-role': currentUser?.role || 'employee'
      };

      // Query dedicated employee documents route first
      let res = await fetch(`${API_BASE_URL}/api/employee-documents?employee_id=${employeeId}`, { headers });

      // Fallback to employee profile endpoint if needed
      if (!res.ok && res.status !== 403 && res.status !== 401) {
        res = await fetch(`${API_BASE_URL}/api/employees/${employeeId}`, { headers });
      }

      if (res.status === 403 || res.status === 401) {
        throw new Error('Session expired or unauthorized. Please log out and sign in again.');
      }

      if (!res.ok) throw new Error('Failed to load documents');
      const data = await res.json();

      if (data.success) {
        setDocuments(data.documents || data.employee?.documents || []);
      }
    } catch (err) {
      console.error('Error fetching employee documents:', err);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId, currentUser?.id, currentUser?.role]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || !employeeId) return;

    const token = getToken();
    if (!token) {
      alert('Authentication token missing. Please log in again.');
      return;
    }

    setUploading(true);

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('employee_id', employeeId);
        formData.append('title', file.name);
        formData.append('category', activeCategory === 'All' ? 'Other' : activeCategory);

        const res = await fetch(`${API_BASE_URL}/api/employee-documents`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'x-user-id': currentUser?.id || '',
            'x-user-role': currentUser?.role || 'employee'
          },
          body: formData
        });

        const resData = await res.json();
        if (!res.ok || !resData.success) {
          throw new Error(resData.message || resData.error || 'Failed to upload document');
        }
      }

      await fetchDocuments();
    } catch (err) {
      console.error('Upload Error:', err);
      alert(err.message || 'Something went wrong while uploading.');
    } finally {
      setUploading(false);
    }
  };

  const handleOpenDocument = async (docId) => {
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE_URL}/api/employee-documents/${docId}/url`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (data.success && data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      } else {
        alert(data.message || 'Unable to open file.');
      }
    } catch (err) {
      console.error('Error fetching file URL:', err);
    }
  };

  const filteredDocuments = documents
    .filter((doc) => (activeCategory === 'All' ? true : doc.category === activeCategory))
    .filter((doc) => {
      const docName = doc.title || doc.file_name || '';
      return docName.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => {
      const dateA = new Date(a.created_at || a.uploaded_at || 0);
      const dateB = new Date(b.created_at || b.uploaded_at || 0);
      return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
    });

  const employeeLabel = [
    currentUser?.first_name
      ? `${currentUser.first_name} ${currentUser.last_name || ''}`.trim()
      : currentUser?.name,
    currentUser?.department
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="max-w-6xl mx-auto px-6 py-8"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        uploadFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          uploadFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/employee/profile')}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <i className="ti ti-arrow-left text-base"></i>
          BACK TO PROFILE
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <i className={`ti ${uploading ? 'ti-loader animate-spin' : 'ti-upload'} text-base`}></i>
          {uploading ? 'UPLOADING...' : 'UPLOAD DOCUMENT'}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 mb-6 flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
          <i className="ti ti-folder text-2xl"></i>
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">Documents</h2>
          <p className="text-sm text-slate-400 mt-0.5">{employeeLabel || 'Employee Documents'}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="relative flex-1 max-w-md">
          <i className="ti ti-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-base"></i>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
          <span className="text-sm font-semibold text-slate-400 whitespace-nowrap">
            {filteredDocuments.length} {filteredDocuments.length === 1 ? 'FILE' : 'FILES'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              activeCategory === cat
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="border-2 border-dashed border-slate-200 rounded-2xl py-24 text-center text-sm text-slate-400">
          Loading documents...
        </div>
      ) : filteredDocuments.length === 0 ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className={`w-full border-2 border-dashed rounded-2xl py-24 flex flex-col items-center justify-center gap-3 transition-colors ${
            isDragging ? 'border-blue-400 bg-blue-50/40' : 'border-slate-200 bg-white hover:bg-slate-50/60'
          }`}
        >
          <i className="ti ti-file-x text-4xl text-slate-300"></i>
          <p className="text-sm font-bold tracking-widest text-slate-500 uppercase">No Documents Yet</p>
          <p className="text-sm text-slate-400">Click here, or drag & drop a file anywhere on this page.</p>
        </button>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDocuments.map((doc) => (
            <div
              key={doc.id}
              onClick={() => handleOpenDocument(doc.id)}
              className="border border-slate-200 bg-white rounded-2xl p-5 flex items-start gap-3 hover:shadow-md cursor-pointer transition-shadow"
            >
              <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                <i className="ti ti-file-text text-xl"></i>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900 truncate">{doc.title || doc.file_name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{doc.category || 'General'}</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Document;