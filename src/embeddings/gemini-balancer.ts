import { requestUrl } from "obsidian";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const PRIORITY_MODELS = [
  "gemini-embedding-2",
  "gemini-embedding-001",
];

const OUTPUT_DIMS = 768;

const QUOTA_COOLDOWN_MS = 60_000;

export class GeminiBalancer {
  private keys: string[];
  private currentKeyIndex: number = 0;
  private currentModelIndex: number = 0;
  private cooldownUntil = 0;
  private lastExhaustionMessage = "";

  constructor(keysCommaSeparated: string) {
    this.keys = keysCommaSeparated
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  }

  get hasKeys(): boolean {
    return this.keys.length > 0;
  }

  get keyCount(): number {
    return this.keys.length;
  }

  /** False when keys are missing or all keys recently hit quota/rate limits. */
  get canEmbed(): boolean {
    return this.hasKeys && Date.now() >= this.cooldownUntil;
  }

  get cooldownRemainingMs(): number {
    return Math.max(0, this.cooldownUntil - Date.now());
  }

  async embed(text: string): Promise<number[]> {
    if (!this.hasKeys) {
      throw new Error("No se configuraron GEMINI_API_KEYS");
    }
    if (!this.canEmbed) {
      const secs = Math.ceil(this.cooldownRemainingMs / 1000);
      throw new Error(this.lastExhaustionMessage || `Gemini en cooldown por cuota (~${secs}s)`);
    }

    let sawQuota = false;
    for (let modelAttempt = 0; modelAttempt < PRIORITY_MODELS.length; modelAttempt++) {
      const modelIdx = (this.currentModelIndex + modelAttempt) % PRIORITY_MODELS.length;
      const model = PRIORITY_MODELS[modelIdx];

      for (let keyAttempt = 0; keyAttempt < this.keys.length; keyAttempt++) {
        const keyIdx = this.currentKeyIndex;
        const key = this.keys[keyIdx];

        try {
          const result = await this.callEmbed(key, model, text);
          this.currentKeyIndex = (keyIdx + 1) % this.keys.length;
          if (modelAttempt > 0) {
            this.currentModelIndex = modelIdx;
          }
          this.cooldownUntil = 0;
          this.lastExhaustionMessage = "";
          return result;
        } catch (err: any) {
          this.currentKeyIndex = (keyIdx + 1) % this.keys.length;

          if (this.isQuotaError(err)) {
            sawQuota = true;
            if (this.keys.length > 1) continue;
          }

          if (this.isModelError(err)) {
            break;
          }

          if (keyAttempt === this.keys.length - 1 && modelAttempt === PRIORITY_MODELS.length - 1) {
            if (sawQuota) this.tripCircuit(err);
            throw err;
          }
        }
      }
    }

    const exhausted = new Error("Todas las claves y modelos de Gemini se agotaron");
    if (sawQuota) this.tripCircuit(exhausted);
    throw exhausted;
  }

  private tripCircuit(err: unknown): void {
    this.cooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
    this.lastExhaustionMessage = err instanceof Error ? err.message : String(err);
  }

  private async callEmbed(key: string, model: string, text: string): Promise<number[]> {
    const url = `${GEMINI_BASE}/${model}:embedContent`;

    const response = await requestUrl({
      url,
      method: "POST",
      contentType: "application/json; charset=utf-8",
      headers: { "x-goog-api-key": key },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        outputDimensionality: OUTPUT_DIMS,
      }),
    });

    const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
    const rawText = decoder ? decoder.decode(response.arrayBuffer) : response.text;

    if (response.status !== 200) {
      const err = new Error(`Gemini API error [${response.status}] con modelo "${model}" — ${rawText}`);
      (err as any).status = response.status;
      (err as any).responseBody = rawText;
      throw err;
    }

    const data = JSON.parse(rawText);
    if (!data.embedding?.values) {
      throw new Error(`Respuesta inesperada de Gemini API: ${response.text.slice(0, 200)}`);
    }

    return data.embedding.values;
  }

  private isQuotaError(err: any): boolean {
    return err?.status === 429 || err?.status === 403;
  }

  private isModelError(err: any): boolean {
    if (err?.status === 404) return true;
    if (err?.responseBody?.includes("not found") || err?.responseBody?.includes("not supported")) return true;
    return false;
  }
}
