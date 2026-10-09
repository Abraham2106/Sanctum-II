import { setIcon } from "obsidian";
import type { MeshResultFull } from "../orchestrator/mesh";
import { meshCountsAsAccepted, meshStatusHeadline } from "./mesh-status-label";
import type { ChatMessage } from "./chat-types";

export function appendMeshResultToThread(
  threadEl: HTMLElement,
  result: MeshResultFull,
  messenger: {
    messages: ChatMessage[];
    addMsg: (role: "user" | "agent", content: string, label?: string, meta?: Partial<ChatMessage>) => ChatMessage;
  },
): void {
  const label = `search Forager → Researcher ×${result.attempts} → Critic`;
  const status = result.meshStatus;

  if (status === "escalated") {
    const wrap = threadEl.createDiv({ cls: "s-msg-agent" });
    const meta = wrap.createDiv({ cls: "s-msg-meta" });
    const avatar = meta.createDiv({ cls: "s-msg-avatar" });
    setIcon(avatar, "alert-triangle");
    meta.createDiv({ cls: "s-msg-name", text: label });
    meta.createDiv({ cls: "s-msg-time", text: `Score: ${result.criticScore ?? "?"}/100 · ${meshStatusHeadline(status)}` });

    const band = wrap.createDiv({ cls: "s-escalation" });
    band.createDiv({
      text: `El Critic rechazó los ${result.loopState.max_attempts} intentos del Researcher.`,
      attr: { style: "font-weight:600;margin-bottom:6px" },
    });
    const feedback = result.loopState.history.filter((h) => h.agent === "critic").pop()?.feedback || [];
    if (feedback.length) {
      const ul = band.createEl("ul", { attr: { style: "margin:6px 0 0;padding-left:16px;font-size:12.5px" } });
      feedback.forEach((f: string) => ul.createEl("li", { text: f }));
    }
    messenger.messages.push({
      role: "agent",
      content: `[escalated] ${result.researcherOutput}`,
      label,
      timestamp: Date.now(),
    });
    return;
  }

  if (meshCountsAsAccepted(status)) {
    let acceptMsg = `${result.researcherOutput}\n\n---\n**Evaluación del Critic:** Aceptado con ${result.criticScore}/100.`;
    if (result.createdNotePath) {
      const noteName = result.createdNotePath.replace(/\.md$/i, "");
      acceptMsg += `\n\nNota guardada en: [[${noteName}]]`;
    }
    messenger.addMsg("agent", acceptMsg, label, {
      meshMeta: { attempts: result.attempts, score: result.criticScore, verdict: "accept" },
    });
    const msgEl = threadEl.lastElementChild;
    if (msgEl && result.loopState?.attempts?.length) {
      const progWrap = msgEl.createDiv({ cls: "s-msg-prog" });
      const prog = progWrap.createDiv({ cls: "s-mini-prog" });
      for (const a of result.loopState.attempts) {
        const dot = prog.createDiv({
          cls: `s-mini-prog-dot${a.total_score >= 80 ? " ok" : a.total_score >= 50 ? " mid" : " low"}`,
        });
        dot.style.width = `${Math.max(10, (a.total_score / 100) * 24)}px`;
        dot.title = `Intento ${a.attempt}: ${a.total_score}/100`;
      }
    }
    return;
  }

  const headline = meshStatusHeadline(status);
  let body = result.researcherOutput || result.meshCore?.error || "El mesh no produjo salida.";
  if (status === "needs_review") {
    body = `${result.researcherOutput}\n\n---\n**Estado:** ${headline} (score ${result.criticScore ?? "?"} /100). Revisá el trace antes de dar por cerrado.`;
  } else if (status === "failed" || status === "cancelled" || status === "timed_out") {
    body = `**${headline}**${result.meshCore?.error ? `\n${result.meshCore.error}` : ""}\n\n${result.researcherOutput || ""}`.trim();
  }
  messenger.addMsg("agent", body, `${label} · ${headline}`, {
    meshMeta: { attempts: result.attempts, score: result.criticScore, verdict: status },
  });
}
