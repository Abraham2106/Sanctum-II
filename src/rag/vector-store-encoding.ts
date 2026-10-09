import type { Chunk } from "./vector-store";

export function float32ArrayToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToFloat32Array(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export function chunkToSetLine(chunk: Chunk): string {
  const b64 = float32ArrayToBase64(new Float32Array(chunk.embedding));
  return JSON.stringify({
    t: "set",
    id: chunk.id,
    p: chunk.note_path,
    txt: chunk.chunk_text,
    v: b64,
  }) + "\n";
}
