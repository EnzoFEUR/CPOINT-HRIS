import { compressDocumentImage } from './documentImage.js';

self.onmessage = async ({ data }) => {
    self.postMessage(await compressDocumentImage(data.file, data.maxDimension, data.quality));
};
