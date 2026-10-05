import React from 'react';
import logoIcon from '../../assets/logo-icon.png';

export const PwaInstallModal = ({
  showInstallGuide,
  setShowInstallGuide,
  deferredPrompt,
  handleInstallApp,
  browserType,
  setBrowserType
}) => {
  if (!showInstallGuide) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs"
        onClick={() => setShowInstallGuide(false)}
      />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 text-white shadow-2xl z-10 space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src={logoIcon} 
              alt="C-Point" 
              className="w-10 h-10 rounded-md object-contain bg-slate-800 p-1.5 shadow-2xs shrink-0 border border-white/5" 
            />
            <div>
              <h4 className="text-sm sm:text-base font-bold tracking-tight text-white">Install C-Point HRIS</h4>
              <p className="text-[11px] text-slate-400 font-medium">Add to your device for instant offline &amp; biometric access</p>
            </div>
          </div>
          <button
            onClick={() => setShowInstallGuide(false)}
            className="w-8 h-8 rounded-md bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-colors duration-100 cursor-pointer"
            aria-label="Close modal"
          >
            <i className="ti ti-x text-base" />
          </button>
        </div>

        {/* Direct Native Install Prompt (If available) */}
        {deferredPrompt && (
          <button
            onClick={handleInstallApp}
            className="w-full h-10 bg-accent hover:bg-accent text-white font-semibold text-xs sm:text-sm rounded-md shadow-2xs transition-colors duration-100 flex items-center justify-center gap-2 cursor-pointer"
          >
            <i className="ti ti-download text-base" /> Install app
          </button>
        )}

        {/* Browser Selector Tabs */}
        <div className="flex items-center gap-1 bg-slate-950/60 p-1 rounded-md border border-slate-800">
          <button
            onClick={() => setBrowserType('samsung')}
            className={`flex-1 h-7 px-2 rounded-md text-[10px] sm:text-xs font-semibold cursor-pointer transition-colors duration-100 ${
              browserType === 'samsung' ? 'bg-accent text-white shadow-2xs' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Samsung
          </button>
          <button
            onClick={() => setBrowserType('chrome_android')}
            className={`flex-1 h-7 px-2 rounded-md text-[10px] sm:text-xs font-semibold cursor-pointer transition-colors duration-100 ${
              browserType === 'chrome_android' ? 'bg-accent text-white shadow-2xs' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Android
          </button>
          <button
            onClick={() => setBrowserType('ios')}
            className={`flex-1 h-7 px-2 rounded-md text-[10px] sm:text-xs font-semibold cursor-pointer transition-colors duration-100 ${
              browserType === 'ios' ? 'bg-accent text-white shadow-2xs' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            iPhone &amp; iPad
          </button>
          <button
            onClick={() => setBrowserType('desktop')}
            className={`flex-1 h-7 px-2 rounded-md text-[10px] sm:text-xs font-semibold cursor-pointer transition-colors duration-100 ${
              browserType === 'desktop' ? 'bg-accent text-white shadow-2xs' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Desktop
          </button>
        </div>

        {/* Step Instructions by Browser */}
        <div className="space-y-3 bg-slate-950/40 p-4 rounded-md border border-slate-800 text-xs text-slate-300">
          {browserType === 'samsung' && (
            <>
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800 text-accent-on-dark font-bold">
                <i className="ti ti-brand-android text-base" /> Samsung Internet Browser Steps:
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark flex items-center justify-center font-bold text-xs shrink-0">1</div>
                <p>Tap the <span className="font-bold text-white inline-flex items-center gap-1"><i className="ti ti-menu-2 inline text-sm text-accent-on-dark" /> Menu</span> button at the bottom right corner.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark flex items-center justify-center font-bold text-xs shrink-0">2</div>
                <p>Tap <span className="font-bold text-white inline-flex items-center gap-1"><i className="ti ti-plus inline text-sm text-accent-on-dark" /> Add to Home screen</span> (or Install app).</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark flex items-center justify-center font-bold text-xs shrink-0">3</div>
                <p>Select <span className="font-bold text-white">Home screen</span> and tap <span className="font-bold text-white">Add</span>.</p>
              </div>
            </>
          )}

          {browserType === 'chrome_android' && (
            <>
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800 text-accent-on-dark font-bold">
                <i className="ti ti-brand-chrome text-base" /> Google Chrome Android Steps:
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark flex items-center justify-center font-bold text-xs shrink-0">1</div>
                <p>Tap the <span className="font-bold text-white"><i className="ti ti-dots-vertical inline text-sm text-accent-on-dark" /> Three Dots (⋮)</span> at the top right.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark flex items-center justify-center font-bold text-xs shrink-0">2</div>
                <p>Tap <span className="font-bold text-white"><i className="ti ti-download inline text-sm text-accent-on-dark" /> Install app</span> or <span className="font-bold text-white">Add to Home screen</span>.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark flex items-center justify-center font-bold text-xs shrink-0">3</div>
                <p>Confirm by tapping <span className="font-bold text-white">Install</span>.</p>
              </div>
            </>
          )}

          {browserType === 'ios' && (
            <>
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800 text-accent-on-dark font-bold">
                <i className="ti ti-brand-apple text-base" /> Safari on iPhone / iPad Steps:
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark flex items-center justify-center font-bold text-xs shrink-0">1</div>
                <p>Tap the <span className="font-bold text-white"><i className="ti ti-share inline text-sm text-accent-on-dark" /> Share</span> button at the bottom of Safari.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark flex items-center justify-center font-bold text-xs shrink-0">2</div>
                <p>Scroll down and tap <span className="font-bold text-white"><i className="ti ti-plus inline text-sm text-accent-on-dark" /> Add to Home Screen</span>.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark flex items-center justify-center font-bold text-xs shrink-0">3</div>
                <p>Tap <span className="font-bold text-white">Add</span> in the top right corner.</p>
              </div>
            </>
          )}

          {browserType === 'desktop' && (
            <>
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800 text-accent-on-dark font-bold">
                <i className="ti ti-device-desktop text-base" /> Desktop (Chrome / Edge) Steps:
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark flex items-center justify-center font-bold text-xs shrink-0">1</div>
                <p>Look in the browser address bar on the right.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark flex items-center justify-center font-bold text-xs shrink-0">2</div>
                <p>Click the <span className="font-bold text-white"><i className="ti ti-download inline text-sm text-accent-on-dark" /> Install C-Point HRIS</span> icon.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-md bg-accent/20 text-accent-on-dark flex items-center justify-center font-bold text-xs shrink-0">3</div>
                <p>Click <span className="font-bold text-white">Install</span> to open in its own window.</p>
              </div>
            </>
          )}
        </div>

        {/* Close Action */}
        <button
          onClick={() => setShowInstallGuide(false)}
          className="w-full h-10 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs rounded-md transition-colors duration-100 cursor-pointer shadow-2xs"
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default React.memo(PwaInstallModal);
