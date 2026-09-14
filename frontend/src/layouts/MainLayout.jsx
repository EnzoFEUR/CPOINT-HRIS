import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import Sidebar from './Sidebar';
import Header from './Header';
import MobileNav from './MobileNav';
import PwaInstallModal from '../components/pwa/PwaInstallModal';
import { getUser } from '../routes/guards';

export const MainLayout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Current user from storage
  const [user] = useState(() => getUser() || { name: 'Admin User', role: 'admin' });

  // PWA Install State & Platform Detection
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [browserType, setBrowserType] = useState('desktop');

  useEffect(() => {
    // Check if app is already running in standalone mode (PWA installed)
    const isStandaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://');
    setIsStandalone(Boolean(isStandaloneMode));

    // Detect browser / OS platform
    const ua = window.navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) {
      setBrowserType('ios');
    } else if (/samsungbrowser/.test(ua)) {
      setBrowserType('samsung');
    } else if (/android/.test(ua) && /chrome/.test(ua)) {
      setBrowserType('chrome_android');
    } else {
      setBrowserType('desktop');
    }

    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      setShowInstallGuide(false);
      toast.success('C-Point HRIS installed to your Home Screen!');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Scroll to top and close navigation on route transition
  useEffect(() => {
    setSidebarOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname]);

  const handleInstallApp = useCallback(async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          setDeferredPrompt(null);
          setIsStandalone(true);
          setShowInstallGuide(false);
          return;
        }
      } catch (err) {
        console.warn('[PWA] Native prompt error:', err);
      }
    }
    // Fallback: If native prompt wasn't triggered, show tailored browser guide
    setShowInstallGuide(true);
  }, [deferredPrompt]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('user');
    window.location.href = '/login';
  }, []);

  return (
    <div className="font-sans antialiased bg-slate-50 text-slate-800 selection:bg-blue-500 selection:text-white relative overflow-x-hidden min-h-screen">
      {/* Desktop Sidebar */}
      <Sidebar user={user} handleLogout={handleLogout} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-screen w-full lg:pl-[320px]">
        <div className="flex flex-col flex-1 w-full max-w-7xl mx-auto">
          {/* Header */}
          <Header user={user} setSidebarOpen={setSidebarOpen} />

          {/* Page Content */}
          <main className="flex-1 p-3.5 sm:p-6 lg:p-8 mt-1 sm:mt-2 w-full relative pb-28 lg:pb-8">
            <Suspense
              fallback={
                <div className="flex items-center justify-center min-h-[50vh] w-full">
                  <div className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
                </div>
              }
            >
              {children || <Outlet />}
            </Suspense>
          </main>

          {/* Mobile Bottom Dock & Sheet Drawer */}
          <MobileNav
            user={user}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            isStandalone={isStandalone}
            handleInstallApp={handleInstallApp}
            handleLogout={handleLogout}
          />

          {/* Universal PWA Guide Modal */}
          <PwaInstallModal
            showInstallGuide={showInstallGuide}
            setShowInstallGuide={setShowInstallGuide}
            deferredPrompt={deferredPrompt}
            handleInstallApp={handleInstallApp}
            browserType={browserType}
            setBrowserType={setBrowserType}
          />
        </div>
      </div>
    </div>
  );
};

export default MainLayout;
