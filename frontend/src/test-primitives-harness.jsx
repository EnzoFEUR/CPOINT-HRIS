import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import {
  MobileShell,
  Navbar,
  Tabbar,
  StickyActionBar,
  BottomSheet
} from './components/mobile';
import '../src/index.css';

const SEVEN_TAB_ITEMS = [
  { key: 'home', label: 'Home', to: '/home', onClick: () => {} },
  { key: 'attendance', label: 'Attendance', to: '/attendance', onClick: () => {} },
  { key: 'leaves', label: 'Leaves', to: '/leaves', onClick: () => {} },
  { key: 'documents', label: 'Docs', to: '/documents', onClick: () => {} },
  { key: 'profile', label: 'Profile', to: '/profile', onClick: () => {} },
  { key: 'notifications', label: 'Alerts', to: '/alerts', onClick: () => {} },
  { key: 'settings', label: 'Settings', to: '/settings', onClick: () => {} },
];

function TestHarness() {
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  return (
    <div id="test-app-container">
      <main id="main-content" className="p-4 space-y-4">
        <h1 className="text-xl font-bold">Mobile Primitives Real Browser Harness</h1>
        <button
          id="bg-btn"
          type="button"
          className="px-3 py-1.5 bg-slate-200 rounded text-xs"
        >
          Background Action
        </button>

        <div>
          <button
            id="open-sheet-btn"
            type="button"
            onClick={() => setIsSheetOpen(true)}
            className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg text-sm"
          >
            Open Test BottomSheet
          </button>
        </div>

        <div id="tabbar-test-section" className="mt-8 border-t pt-4">
          <h2 className="text-sm font-semibold mb-2">Tabbar (Mounted with 7 items)</h2>
          <div id="tabbar-container">
            <Tabbar tabs={SEVEN_TAB_ITEMS} />
          </div>
        </div>
      </main>

      <BottomSheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        title="Interactive Test Sheet"
        subtitle="Verifying focus trap and dismissal in Playwright"
        footer={
          <button
            id="sheet-submit-btn"
            type="button"
            onClick={() => setIsSheetOpen(false)}
            className="w-full py-2 bg-indigo-600 text-white font-bold rounded-lg text-sm"
          >
            Sheet Submit
          </button>
        }
      >
        <div className="space-y-3 py-2">
          <div>
            <label className="block text-xs font-semibold mb-1">Input One</label>
            <input
              id="sheet-input-1"
              type="text"
              placeholder="First Input Field"
              className="w-full border rounded p-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Input Two</label>
            <input
              id="sheet-input-2"
              type="text"
              placeholder="Second Input Field"
              className="w-full border rounded p-2 text-sm"
            />
          </div>
          <button
            id="sheet-inner-btn"
            type="button"
            className="px-3 py-1 bg-slate-100 border rounded text-xs font-medium"
          >
            Inner Button
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <BrowserRouter>
      <TestHarness />
    </BrowserRouter>
  );
}
