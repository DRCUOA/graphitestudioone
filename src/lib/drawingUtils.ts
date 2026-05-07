import { PencilGrade, AssistantSettings } from '../types';

export const PENCIL_GRADES: PencilGrade[] = [
  '9B', '8B', '7B', '6B', '5B', '4B', '3B', '2B', 'B', 'HB', 'F', 'H', '2H', '3H', '4H', '5H', '6H', '7H', '8H', '9H'
];

export const getLuminanceRange = (grade: PencilGrade): [number, number] => {
  const index = PENCIL_GRADES.indexOf(grade);
  const binSize = 255 / PENCIL_GRADES.length;
  const start = index * binSize;
  const end = (index + 1) * binSize;
  return [start, end];
};

export const applyAssistantFilters = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings: AssistantSettings
) => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const { grayscale, posterize, posterizeLevels, highlightGrades, contrast, brightness, edges, invert, notan, notanThreshold } = settings;

  // Pre-compute the union of luminance bins for the selected grades.
  // Multiple grades may form non-contiguous bands (e.g. user picks 9B
  // for deep shadows and HB for mid-tones), so we keep them as a list
  // of [min, max] pairs and test each pixel against every range.
  // Empty list = highlighting disabled, which keeps the inner loop
  // branch-free for the common no-highlight case.
  const highlightRanges: Array<[number, number]> = (highlightGrades && highlightGrades.length > 0)
    ? highlightGrades.map((g) => getLuminanceRange(g))
    : [];
  const hasHighlight = highlightRanges.length > 0;

  // Initial pass for Brightness, Contrast, Grayscale, Invert, Notan
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    r = Math.min(255, Math.max(0, r + brightness));
    g = Math.min(255, Math.max(0, g + brightness));
    b = Math.min(255, Math.max(0, b + brightness));

    r = factor * (r - 128) + 128;
    g = factor * (g - 128) + 128;
    b = factor * (b - 128) + 128;

    let avg = 0.299 * r + 0.587 * g + 0.114 * b;

    if (notan) {
      avg = avg > notanThreshold ? 255 : 0;
    }

    if (grayscale || posterize || hasHighlight || edges || notan) {
      r = g = b = avg;
    }

    if (invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  // Edge detection pass (Sobel)
  if (edges) {
    const output = new Uint8ClampedArray(data);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        
        // Horizontal Sobel
        const h = (
          -1 * data[((y - 1) * width + (x - 1)) * 4] +
          1 * data[((y - 1) * width + (x + 1)) * 4] +
          -2 * data[(y * width + (x - 1)) * 4] +
          2 * data[(y * width + (x + 1)) * 4] +
          -1 * data[((y + 1) * width + (x - 1)) * 4] +
          1 * data[((y + 1) * width + (x + 1)) * 4]
        );

        // Vertical Sobel
        const v = (
          -1 * data[((y - 1) * width + (x - 1)) * 4] +
          -2 * data[((y - 1) * width + x) * 4] +
          -1 * data[((y - 1) * width + (x + 1)) * 4] +
          1 * data[((y + 1) * width + (x - 1)) * 4] +
          2 * data[((y + 1) * width + x) * 4] +
          1 * data[((y + 1) * width + (x + 1)) * 4]
        );

        const mag = Math.sqrt(h * h + v * v);
        output[i] = output[i + 1] = output[i + 2] = mag > 50 ? 255 : 0;
      }
    }
    data.set(output);
  }

  // Final pass for Posterize and Highlight
  for (let i = 0; i < data.length; i += 4) {
    let avg = data[i];

    if (posterize && !edges) {
      const step = 255 / (posterizeLevels - 1);
      avg = Math.round(avg / step) * step;
    }

    if (hasHighlight && !edges) {
      // Pixel lights up cyan if its luminance falls inside ANY selected
      // pencil-grade band — that's how cumulative selection lets the
      // artist see the combined coverage of their chosen pencil set.
      let inBand = false;
      for (let r = 0; r < highlightRanges.length; r++) {
        const range = highlightRanges[r];
        if (avg >= range[0] && avg <= range[1]) {
          inBand = true;
          break;
        }
      }
      if (inBand) {
        data[i] = 0;
        data[i + 1] = 255;
        data[i + 2] = 255;
      } else {
        data[i] = data[i + 1] = data[i + 2] = avg * 0.2;
      }
    } else {
      data[i] = data[i + 1] = data[i + 2] = avg;
    }
  }

  ctx.putImageData(imageData, 0, 0);
};
