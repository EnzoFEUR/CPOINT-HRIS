import { nets } from 'face-api.js';

const sources = [...new Set([
  import.meta.env?.VITE_MODEL_URL,
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/',
  'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/',
  '/models',
].filter(Boolean))];
const pending = new Map();

function loadModel(name) {
  const net = nets[name];
  if (net.isLoaded) return Promise.resolve();
  if (pending.has(name)) return pending.get(name);
  const loading = (async () => {
    let lastError;
    for (const source of sources) {
      try { await net.loadFromUri(source); return; }
      catch (error) { lastError = error; }
    }
    throw lastError;
  })().finally(() => pending.delete(name));
  pending.set(name, loading);
  return loading;
}

export function loadFaceModels() {
  return Promise.all(['tinyFaceDetector', 'faceLandmark68Net', 'faceRecognitionNet'].map(loadModel));
}

export function loadBaselineFallbackModel() {
  return loadModel('ssdMobilenetv1');
}
