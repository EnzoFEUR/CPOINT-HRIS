import React from 'react';

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
      <div
        className="absolute inset-0 bg-slate-950/70"
        onClick={() => setShowInstallGuide(false)}
      />
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 text-white shadow-2xl z-10 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-600 flex items-center justify-center font-black text-base text-white shadow-lg shadow-blue-500/30 shrink-0">
              CP
            </div>
            <div>
              <h4 className="text-sm sm:text-base font-black tracking-tight">Install C-Point HRIS</h4>
              <p className="text-[10px] text-blue-300 font-bold uppercase tracking-wider">Fast Fullscreen App</p>
            </div>
          </div>
          <button
            onClick={() => setShowInstallGuide(false)}
            className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-slate-400 hover:text-white tap-active cursor-pointer"
            aria-label="Close modal"
          >
            <i className="ti ti-x text-base" />
          </button>
        </div>

        {/* Direct Native Install Prompt (If available) */}
        {deferredPrompt && (
          <button
            onClick={handleInstallApp}
            className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs sm:text-sm rounded-2xl shadow-lg shadow-blue-600/30 tap-active flex items-center justify-center gap-2 cursor-pointer"
          >
            <i className="ti ti-download text-base" /> 1-Tap Quick Install
          </button>
        )}

        {/* Browser Selector Tabs */}
        <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/5">
          <button
            onClick={() => setBrowserType('samsung')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] sm:text-xs font-bold cursor-pointer ${
              browserType === 'samsung' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Samsung
          </button>
          <button
            onClick={() => setBrowserType('chrome_android')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] sm:text-xs font-bold cursor-pointer ${
              browserType === 'chrome_android' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Chrome
          </button>
          <button
            onClick={() => setBrowserType('ios')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] sm:text-xs font-bold cursor-pointer ${
              browserType === 'ios' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            iPhone / iPad
          </button>
          <button
            onClick={() => setBrowserType('desktop')}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[10px] sm:text-xs font-bold cursor-pointer ${
              browserType === 'desktop' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            PC / Mac
          </button>
        </div>

        {/* Step Instructions by Browser */}
        <div className="space-y-2.5 bg-white/5 p-4 rounded-2xl border border-white/5 text-xs text-slate-300">
          {browserType === 'samsung' && (
            <>
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10 text-blue-400 font-bold">
                <i className="ti ti-brand-android text-base" /> Samsung Internet Browser Steps:
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">1</div>
                <p>Tap the <span className="font-bold text-white inline-flex items-center gap-1"><i className="ti ti-menu-2 inline text-sm text-blue-400" /> Menu</span> button at the bottom right corner.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">2</div>
                <p>Tap <span className="font-bold text-white inline-flex items-center gap-1"><i className="ti ti-plus inline text-sm text-emerald-400" /> Add to Home screen</span> (or Install app).</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">3</div>
                <p>Select <span className="font-bold text-white">Home screen</span> and tap <span className="font-bold text-white">Add</span>.</p>
              </div>
            </>
          )}

          {browserType === 'chrome_android' && (
            <>
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10 text-blue-400 font-bold">
                <i className="ti ti-brand-chrome text-base" /> Google Chrome Android Steps:
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">1</div>
                <p>Tap the <span className="font-bold text-white"><i className="ti ti-dots-vertical inline text-sm text-blue-400" /> Three Dots (⋮)</span> at the top right.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">2</div>
                <p>Tap <span className="font-bold text-white"><i className="ti ti-download inline text-sm text-emerald-400" /> Install app</span> or <span className="font-bold text-white">Add to Home screen</span>.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">3</div>
                <p>Confirm by tapping <span className="font-bold text-white">Install</span>.</p>
              </div>
            </>
          )}

          {browserType === 'ios' && (
            <>
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10 text-blue-400 font-bold">
                <i className="ti ti-brand-apple text-base" /> Safari on iPhone / iPad Steps:
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">1</div>
                <p>Tap the <span className="font-bold text-white"><i className="ti ti-share inline text-sm text-blue-400" /> Share</span> button at the bottom of Safari.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">2</div>
                <p>Scroll down and tap <span className="font-bold text-white"><i className="ti ti-plus inline text-sm text-emerald-400" /> Add to Home Screen</span>.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">3</div>
                <p>Tap <span className="font-bold text-white">Add</span> in the top right corner.</p>
              </div>
            </>
          )}

          {browserType === 'desktop' && (
            <>
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/10 text-blue-400 font-bold">
                <i className="ti ti-device-desktop text-base" /> Desktop (Chrome / Edge) Steps:
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">1</div>
                <p>Look in the browser address bar on the right.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">2</div>
                <p>Click the <span className="font-bold text-white"><i className="ti ti-download inline text-sm text-blue-400" /> Install C-Point HRIS</span> icon.</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">3</div>
                <p>Click <span className="font-bold text-white">Install</span> to launch standalone window.</p>
              </div>
            </>
          )}
        </div>

        <button
          onClick={() => setShowInstallGuide(false)}
          className="w-full py-3 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl tap-active transition-all cursor-pointer"
        >
          Close Guide
        </button>
      </div>
    </div>
  );
};

export default React.memo(PwaInstallModal);
