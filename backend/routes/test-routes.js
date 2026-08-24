// backend/test-routes.js
import axios from 'axios';

const API_BASE = 'http://localhost:5000/api';
const AUTH_HEADER = { headers: { Authorization: 'Bearer YOUR_AUTH_TOKEN' } };
const MOCK_EMP_ID = '11111111-1111-1111-1111-111111111111';

async function runTestSuite() {
  console.log('🚀 Starting Backend Route Integration Tests...\n');

  try {
    // 1. Test Document Metadata Creation
    console.log('[1/5] Testing POST /api/documents/record...');
    const docRes = await axios.post(`${API_BASE}/documents/record`, {
      employee_id: MOCK_EMP_ID,
      category: 'Medical Record',
      sub_category: 'Fit-to-Work',
      file_name: 'medical_fit.pdf',
      file_path: `201_vault/${MOCK_EMP_ID}/medical_fit.pdf`,
      file_size: 102400,
      file_type: 'application/pdf'
    }, AUTH_HEADER);
    const docId = docRes.data.document.id;
    console.log('✅ Document Record Created ID:', docId);

    // 2. Test Document Verification Status Update
    console.log('[2/5] Testing PATCH /api/documents/:id/verify...');
    const verifyRes = await axios.patch(`${API_BASE}/documents/${docId}/verify`, {
      status: 'Verified'
    }, AUTH_HEADER);
    console.log('✅ Document Status Updated:', verifyRes.data.document.status);

    // 3. Test COE Document Requisition
    console.log('[3/5] Testing POST /api/document-requests...');
    const reqRes = await axios.post(`${API_BASE}/document-requests`, {
      document_type: 'COE',
      purpose: 'Housing Loan Application'
    }, AUTH_HEADER);
    const requestId = reqRes.data.request.id;
    console.log('✅ COE Request Created ID:', requestId);

    // 4. Test Automated PDF Generation Workflow
    console.log('[4/5] Testing PATCH /api/document-requests/:id/process (PDF Generation)...');
    const processRes = await axios.patch(`${API_BASE}/document-requests/${requestId}/process`, {
      status: 'Ready for Download',
      remarks: 'Automated test approval'
    }, AUTH_HEADER);
    console.log('✅ Generated COE Path:', processRes.data.request.generated_file_path);

    // 5. Test HR DOLE Statutory Remittances Summary
    console.log('[5/5] Testing GET /api/reports/dole-statutory...');
    const reportRes = await axios.get(`${API_BASE}/reports/dole-statutory?year=2026&month=8`, AUTH_HEADER);
    console.log('✅ Report Summary Fetched:', reportRes.data.summary);

    console.log('\n🎉 ALL BACKEND API TESTS PASSED SUCCESSFULLY!');
  } catch (error) {
    console.error('❌ Test Failed:', error.response?.data || error.message);
  }
}

runTestSuite();