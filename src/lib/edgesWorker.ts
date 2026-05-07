/* -------------------------------------------------------------------------- */
/* Web Worker entry for edge-map computation.                                 */
/*                                                                            */
/* Loaded via Vite's `?worker` query (see App.tsx). The image's pixel       */
/* buffer is transferred (zero-copy) into the worker, processed there,     */
/* and the resulting magnitude buffer is transferred back to the main      */
/* thread the same way. Net memory cost ≈ one byte per image pixel for    */
/* the duration of the call — held briefly while compute runs.            */
/* -------------------------------------------------------------------------- */

import { computeEdgeMap, type EdgeMap } from './edges';

interface RequestPayload {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface SuccessReply {
  ok: true;
  map: EdgeMap;
}

interface ErrorReply {
  ok: false;
  error: string;
}

const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<RequestPayload>) => {
  try {
    const { width, height, data } = e.data;
    // Reconstruct ImageData from the transferred buffer. The buffer is now
    // exclusively owned by this worker until we transfer it back below.
    const imageData = new ImageData(data, width, height);
    const map = computeEdgeMap(imageData);
    const reply: SuccessReply = { ok: true, map };
    // Transfer the magnitudes buffer back; main thread becomes its new owner.
    ctx.postMessage(reply, [map.magnitudes.buffer]);
  } catch (err) {
    const reply: ErrorReply = { ok: false, error: err instanceof Error ? err.message : String(err) };
    ctx.postMessage(reply);
  }
};

export type { RequestPayload, SuccessReply, ErrorReply };
