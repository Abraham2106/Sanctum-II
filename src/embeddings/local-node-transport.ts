import http from "node:http";

export interface LoopbackHttpRequest {
  method: "GET" | "POST";
  path: string;
  port: number;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface LoopbackHttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export type LoopbackHttpTransport = (request: LoopbackHttpRequest) => Promise<LoopbackHttpResponse>;

export class LoopbackHttpError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "LoopbackHttpError";
    this.code = code;
  }
}

/** DEC-0023: 127.0.0.1 numeric port only; reject redirects; abort destroys socket. */
export function createLoopbackNodeTransport(): LoopbackHttpTransport {
  return (request) =>
    new Promise<LoopbackHttpResponse>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: request.port,
          method: request.method,
          path: request.path,
          headers: request.headers,
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
            res.resume();
            reject(new LoopbackHttpError("REDIRECT_REJECTED"));
            return;
          }
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => {
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf-8"),
            });
          });
        },
      );

      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        req.destroy();
        reject(err);
      };

      const timer = setTimeout(() => {
        fail(new LoopbackHttpError("REQUEST_TIMEOUT"));
      }, request.timeoutMs);

      req.on("error", (err) => {
        clearTimeout(timer);
        fail(err instanceof Error ? err : new Error(String(err)));
      });

      if (request.signal) {
        if (request.signal.aborted) {
          clearTimeout(timer);
          fail(new LoopbackHttpError("ABORTED"));
          return;
        }
        const onAbort = () => {
          clearTimeout(timer);
          fail(new LoopbackHttpError("ABORTED"));
        };
        request.signal.addEventListener("abort", onAbort, { once: true });
        req.on("close", () => request.signal?.removeEventListener("abort", onAbort));
      }

      req.on("finish", () => clearTimeout(timer));
      req.on("response", () => clearTimeout(timer));

      if (request.body !== undefined) {
        req.write(request.body);
      }
      req.end();
    });
}
