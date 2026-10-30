// Geometry binding does not depend on whether both eyelids are readable.
export function readBoundFace(result, faceBox, width, height) {
  if (result?.faces?.length !== 1 || ![width, height].every(value => Number.isFinite(value) && value > 0)) return null;
  const face = result.faces[0], box = face?.box;
  if (![box, faceBox].every(b => b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0)) return null;
  const detected = { x: box.x * width, y: box.y * height, width: box.width * width, height: box.height * height };
  const overlapWidth = Math.max(0, Math.min(detected.x + detected.width, faceBox.x + faceBox.width) - Math.max(detected.x, faceBox.x));
  const overlapHeight = Math.max(0, Math.min(detected.y + detected.height, faceBox.y + faceBox.height) - Math.max(detected.y, faceBox.y));
  const overlap = overlapWidth * overlapHeight / Math.min(detected.width * detected.height, faceBox.width * faceBox.height);
  const centered = Math.abs(detected.x + detected.width / 2 - faceBox.x - faceBox.width / 2) <= faceBox.width * .4
    && Math.abs(detected.y + detected.height / 2 - faceBox.y - faceBox.height / 2) <= faceBox.height * .4;
  return overlap >= .7 && centered ? face : null;
}

export function readBlinkEyes(result, faceBox, width, height) {
  const face = readBoundFace(result, faceBox, width, height);
  if (!face || ![face.left, face.right].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
  const left = 1 - face.left, right = 1 - face.right;
  return { left, right, mean: (left + right) / 2, source: 'expression' };
}
export function summarizeBlinkResult(result, processingMs) {
  return {
    processingMs,
    faces: result.faceLandmarks.map((landmarks, index) => {
      const xs = landmarks.map(point => point.x), ys = landmarks.map(point => point.y);
      const categories = result.faceBlendshapes[index]?.categories || [];
      const transform = result.facialTransformationMatrixes?.[index];
      const packed = new Float32Array(landmarks.length * 2);
      landmarks.forEach((point, i) => { packed[i * 2] = point.x; packed[i * 2 + 1] = point.y; });
      return {
        box: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
        left: categories.find(category => category.categoryName === 'eyeBlinkLeft')?.score,
        right: categories.find(category => category.categoryName === 'eyeBlinkRight')?.score,
        landmarks: packed,
        matrix: transform?.rows === 4 && transform?.columns === 4 && transform.data?.length === 16
          ? new Float32Array(transform.data) : null,
      };
    }),
  };
}
