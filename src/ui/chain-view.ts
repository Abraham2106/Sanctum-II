import { ItemView, WorkspaceLeaf, Notice, setIcon, Modal } from "obsidian";
import { InputModal } from "./input-modal";
import type { Chain, ChainNode, ChainEdge } from "../chains/types";
import { ChainStore } from "../chains/store";
import { topologicalOrder } from "../chains/executor";
import { loadAgentFromVault } from "../agents/agent-loader";
import type { TurnDeps } from "../orchestrator/agent-turn";
import type { VaultAdapter } from "../core/vault-adapter";
import { AGENT_TYPES, genId, getAgentById } from "./chain-types";
import type { ExecutionResult } from "./chain-types";

export const VIEW_TYPE_CHAINS = "sanctum-chains";

export class ChainView extends ItemView {
  // Data
  private nodes: ChainNode[] = [];
  private edges: ChainEdge[] = [];
  private nodeEls = new Map<string, HTMLElement>();
  private results = new Map<string, ExecutionResult>();
  private currentChainId: string | null = null;

  // Interaction
  private dragging: { nodeId: string; ox: number; oy: number } | null = null;
  private linking: { fromId: string; path: SVGPathElement } | null = null;
  private panning: { sx: number; sy: number } | null = null;
  private scale = 1; private tx = 0; private ty = 0;

  // DOM
  private vpEl!: HTMLElement; private svgEl!: SVGSVGElement;
  private nodesLayer!: HTMLElement; private canvasWrap!: HTMLElement;
  private emptyEl!: HTMLElement; private chainNameEl!: HTMLInputElement;

  private store: ChainStore;
  private vaultAdapter: VaultAdapter;
  private getTurnDeps: () => TurnDeps;

  constructor(leaf: WorkspaceLeaf, deps: { chainStore: ChainStore; vaultAdapter: VaultAdapter; getTurnDeps: () => TurnDeps }) {
    super(leaf);
    this.store = deps.chainStore; this.vaultAdapter = deps.vaultAdapter; this.getTurnDeps = deps.getTurnDeps;
  }
  getViewType(): string { return VIEW_TYPE_CHAINS; }
  getDisplayText(): string { return "Orquestador"; }
  getIcon(): string { return "git-branch"; }

  async onOpen(): Promise<void> {
    const c = this.containerEl.children[1] as HTMLElement;
    c.empty(); c.addClass("sanctum-root"); c.addClass("sanctum-chain-view"); c.style.height = "100%"; c.style.display = "flex"; c.style.flexDirection = "column"; c.style.background = "var(--canvas)";

    // ── Top bar with brand ──
    const tb = c.createDiv({ cls: "och-topbar" });
    const brandTile = tb.createSpan({ cls: "och-brand-tile" });
    setIcon(brandTile, "git-branch");
    const nameWrap = tb.createDiv({ attr: { style: "flex:1;min-width:0" } });
    this.chainNameEl = nameWrap.createEl("input", { cls: "och-topbar-input" });
    this.chainNameEl.value = "Mesh sin nombre";
    nameWrap.createDiv({ text: "Orquestador de agentes", attr: { style: "font-size:10px;color:var(--text-3)" } });

    const mkBtn = (lucide: string, label: string, fn: () => void, extraCls?: string) => {
      const cls = "s-action-btn";
      const b = tb.createEl("button", { cls: extraCls ? `${cls} ${extraCls}` : cls });
      if (lucide) { const ic = b.createSpan({ attr: { style: "display:flex;font-size:14px" } }); setIcon(ic, lucide); }
      if (label) b.createSpan({ text: " " + label });
      const accessibleLabel = label || (lucide === "trash-2" ? "Limpiar canvas" : lucide === "save" ? "Guardar mesh" : lucide);
      b.title = accessibleLabel;
      b.setAttribute("aria-label", accessibleLabel);
      b.onclick = fn;
    };
    mkBtn("folder-open", "Abrir", () => this.showChainMenu());
    mkBtn("shuffle", "Auto", () => this.autoArrange());
    mkBtn("trash-2", "", () => this.clear());
    mkBtn("save", "", () => this.saveChain());
    mkBtn("play", "Ejecutar", () => this.runChain(), "primary");

    // ── Body ──
    const body = c.createDiv({ attr: { style: "flex:1;display:flex;overflow:hidden" } });

    // Palette sidebar
    const side = body.createDiv({ cls: "och-palette" });
    side.createDiv({ cls: "och-palette-label", text: "AGENTES" });
    for (const a of AGENT_TYPES) {
      const it = side.createDiv({ cls: "s-rail-item" });
      const avatar = it.createSpan({ attr: { style: `width:30px;height:30px;border-radius:8px;background:${a.color}33;display:flex;align-items:center;justify-content:center;flex-shrink:0` } });
      avatar.style.color = a.color;
      setIcon(avatar, a.lucide);
      const m = it.createDiv({ cls: "s-rail-info" }); m.createDiv({ text: a.name, attr: { style: "font-weight:600;font-size:11px" } }); m.createDiv({ text: `@${a.id}`, attr: { style: "font-size:9px;color:var(--text-3)" } });
      it.draggable = true;
      it.ondragstart = (e) => e.dataTransfer!.setData("agentId", a.id);
      it.onclick = () => { const r = this.canvasWrap.getBoundingClientRect(); this.addNode(a.id, (r.width/2-this.tx)/this.scale+(Math.random()*80-40), (r.height/2-this.ty)/this.scale+(Math.random()*80-40)); };
    }

    // ── Help section ──
    const help = side.createEl("details", { cls: "och-help" });
    help.createEl("summary", { text: "Cómo encadenar" });
    const helpBox = help.createDiv({ cls: "och-help-text" });
    const addHelpLine = (text: string) => { const d = helpBox.createDiv(); d.innerHTML = text; };
    addHelpLine('• Arrastra desde el punto <b>derecho</b> ● de una burbuja hacia otra para conectarlas.');
    addHelpLine('• Arrastra la burbuja para moverla.');
    addHelpLine('• Pasa el cursor y toca <b>✕</b> para eliminar.');
    addHelpLine('• Haz clic en una conexión para borrarla.');

    // Canvas (full width, no inspector panel)
    this.canvasWrap = body.createDiv({ attr: { style: "flex:1;position:relative;overflow:hidden;background:radial-gradient(circle at 1px 1px, rgba(255,255,255,.05)1px,transparent 0);background-size:22px 22px;background-color:var(--canvas)" } });
    this.canvasWrap.ondragover = (e) => e.preventDefault();
    this.canvasWrap.ondrop = (e) => { e.preventDefault(); const id=e.dataTransfer!.getData("agentId"); if(!id) return; const r=this.canvasWrap.getBoundingClientRect(); this.addNode(id, (e.clientX-r.left-this.tx)/this.scale, (e.clientY-r.top-this.ty)/this.scale); };

    this.vpEl = this.canvasWrap.createDiv({ attr: { style: "position:absolute;inset:0;transform-origin:0 0" } });
    this.applyVp();

    this.svgEl = document.createElementNS("http://www.w3.org/2000/svg","svg"); this.svgEl.setAttribute("width","100%"); this.svgEl.setAttribute("height","100%");
    this.svgEl.style.position="absolute"; this.svgEl.style.inset="0"; this.svgEl.style.pointerEvents="none"; this.svgEl.style.zIndex="1";
    this.svgEl.innerHTML=`<defs><marker id="ar" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6Z" fill="#8b7cf6"/></marker></defs>`;
    this.vpEl.appendChild(this.svgEl);
    this.nodesLayer = this.canvasWrap.createDiv(); this.nodesLayer.style.position="absolute"; this.nodesLayer.style.inset="0"; this.nodesLayer.style.zIndex="2";
    this.vpEl.appendChild(this.nodesLayer);
    this.emptyEl = this.canvasWrap.createDiv({ attr: { style: "position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;color:var(--text-3);z-index:0" } });
    const emptyInner = this.emptyEl.createDiv({ attr: { style: "text-align:center;pointer-events:auto" } });
    const emptyIcon = emptyInner.createDiv({ attr: { style: "font-size:48px;opacity:.4;margin-bottom:8px;color:var(--brand)" } });
    setIcon(emptyIcon, "git-branch");
    emptyInner.createDiv({ text: "Tu Mesh está vacío", attr: { style: "font-size:16px;font-weight:600;color:var(--text-2);margin-bottom:6px" } });
    emptyInner.createDiv({ text: "Arrastra un agente desde la izquierda o haz clic para empezar", attr: { style: "font-size:12px;color:var(--text-3);margin-bottom:16px" } });
    const addFirstBtn = emptyInner.createEl("button", { text: "+ Agregar primer agente", attr: { style: "padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--raised);color:var(--text-2);cursor:pointer;font-size:12px" } });
    addFirstBtn.onclick = () => {
      const r = this.canvasWrap.getBoundingClientRect();
      this.addNode("forager", r.width/2, r.height/2);
    };

    // Zoom controls — grouped
    const zoomGroup = this.canvasWrap.createDiv({ attr: { style: "position:absolute;bottom:16px;right:16px;z-index:10;display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--surface)" } });
    const mkZoom = (label: string, fn: () => void) => {
      const b = zoomGroup.createEl("button", { attr: { style: "width:34px;height:34px;border:none;background:transparent;color:var(--text-3);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:background .12s;border-right:1px solid var(--border)" } });
      b.innerHTML = label;
      b.onmouseenter = () => b.style.background = "var(--hover)";
      b.onmouseleave = () => b.style.background = "transparent";
      b.onclick = fn;
      if (label === "⌖") b.style.borderRight = "none";
    };
    mkZoom("+", () => this.zoom(1.3, this.canvasWrap.clientWidth/2, this.canvasWrap.clientHeight/2));
    mkZoom("−", () => this.zoom(1/1.3, this.canvasWrap.clientWidth/2, this.canvasWrap.clientHeight/2));
    mkZoom("⌖", () => { this.scale=1; this.tx=0; this.ty=0; this.applyVp(); });
    this.canvasWrap.onwheel = (e) => { e.preventDefault(); const r=this.canvasWrap.getBoundingClientRect(); this.zoom(e.deltaY>0?1/1.15:1.15, e.clientX-r.left, e.clientY-r.top); };
    this.canvasWrap.onpointerdown = (e) => { if((e.target as HTMLElement).closest("[data-node-id]")||(e.target as HTMLElement).closest(".och-port-out")) return; this.panning={sx:e.clientX-this.tx,sy:e.clientY-this.ty}; };
    this.canvasWrap.onpointermove = (e) => { if(!this.panning) return; this.tx=e.clientX-this.panning.sx; this.ty=e.clientY-this.panning.sy; this.applyVp(); };
    this.canvasWrap.onpointerup = () => { this.panning=null; };

    // Edge drawing
    this.canvasWrap.addEventListener("pointermove", (e) => { if(!this.linking) return; const r=this.canvasWrap.getBoundingClientRect(); const s=this.portPos(this.linking.fromId,"out"); if(!s) return; this.linking.path.setAttribute("d",this.bezier(s.x,s.y,(e.clientX-r.left-this.tx)/this.scale,(e.clientY-r.top-this.ty)/this.scale)); });
    this.canvasWrap.addEventListener("pointerup", (e) => { if(!this.linking) return; const t=document.elementFromPoint(e.clientX,e.clientY)?.closest("[data-node-id]") as HTMLElement|null; const toId = t?.dataset?.nodeId; if(t&&toId&&this.linking&&toId!==this.linking.fromId&&!this.edges.some(ed=>ed.from===this.linking!.fromId&&ed.to===toId)) this.addEdge(this.linking!.fromId,toId); this.linking!.path.remove(); this.linking=null; });

    this.loadChainList();
  }

  // ── Nodes ──

  private addNode(agentId: string, x: number, y: number): string {
    const a = getAgentById(agentId); if (!a) return "";
    const id = genId("n"); this.nodes.push({ id, agentId, x, y });
    const el = this.nodesLayer.createDiv({ attr: { "data-node-id": id } });
    el.addClass("och-node");
    el.style.setProperty("--nodeColor", a.color); el.style.position="absolute"; el.style.left=x+"px"; el.style.top=y+"px"; el.style.transform="translate(-50%,-50%)"; el.style.zIndex="3"; el.style.width="200px";
    el.innerHTML=`<div class="och-badge" style="position:absolute;top:-10px;left:-10px;min-width:20px;height:20px;border-radius:10px;background:${a.color};color:#fff;display:none;align-items:center;justify-content:center;font-size:11px;font-weight:800">-</div>
      <div class="och-result" style="display:none;position:absolute;bottom:-6px;right:-6px;width:14px;height:14px;border-radius:50%;align-items:center;justify-content:center;font-size:8px;color:#fff"></div>
      <div class="och-bubble"><div class="och-del" role="button" tabindex="0" aria-label="Eliminar agente">×</div>
        <div style="display:flex;align-items:center;gap:8px"><span class="och-node-icon" style="font-size:16px"></span><div><div style="font-size:12px;font-weight:700">${a.name}</div><div style="font-size:10px;color:var(--text-3)">@${a.id}</div></div></div>
        <div style="font-size:10px;color:var(--text-3);margin-top:4px">${a.desc}</div></div>
      <div class="och-port-in" aria-hidden="true"></div>
      <div class="och-port-out" role="button" tabindex="0" aria-label="Conectar agente ${a.name}"></div>`;
    this.nodeEls.set(id, el);
    const iconSpan = el.querySelector(".och-node-icon") as HTMLElement;
    if (iconSpan) setIcon(iconSpan, a.lucide);
    const del = el.querySelector(".och-del") as HTMLElement;
    del.onclick=(ev)=>{ev.stopPropagation();this.removeNode(id)};
    del.onkeydown=(ev)=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();del.click()}};
    const outputPort = el.querySelector(".och-port-out") as HTMLElement;
    outputPort.onpointerdown=(ev)=>{ev.stopPropagation();ev.preventDefault();this.startLink(ev,id)};
    outputPort.onkeydown=(ev)=>{
      if(ev.key!=="Enter"&&ev.key!==" ")return;
      ev.preventDefault(); ev.stopPropagation();
      if(this.linking){
        const from=this.linking.fromId; this.linking.path.remove(); this.linking=null;
        if(from!==id&&!this.edges.some(edge=>edge.from===from&&edge.to===id)) this.addEdge(from,id);
      } else {
        this.startLink(ev,id);
        new Notice("Seleccioná otro agente y presioná Enter para conectarlo");
      }
    };
    this.makeDraggable(el, id);
    this.updateEmpty(); this.autoSave();
    return id;
  }

  private removeNode(id: string): void {
    this.nodeEls.get(id)?.remove(); this.nodeEls.delete(id);
    this.nodes=this.nodes.filter(n=>n.id!==id); this.edges=this.edges.filter(e=>e.from!==id&&e.to!==id);
    this.results.delete(id); this.renderEdges(); this.updateEmpty(); this.autoSave();
  }

  private makeDraggable(el: HTMLElement, nodeId: string): void {
    const bub = el.querySelector(".och-bubble") as HTMLElement;
    bub.onpointerdown=(e)=>{if((e.target as HTMLElement).classList.contains("och-del"))return; const r=this.canvasWrap.getBoundingClientRect(); const n=this.nodes.find(x=>x.id===nodeId); if(!n)return; this.dragging={nodeId,ox:(e.clientX-r.left-this.tx)/this.scale-n.x,oy:(e.clientY-r.top-this.ty)/this.scale-n.y}; bub.setPointerCapture(e.pointerId); e.stopPropagation();};
    bub.onpointermove=(e)=>{if(!this.dragging||this.dragging.nodeId!==nodeId)return; const r=this.canvasWrap.getBoundingClientRect(); const n=this.nodes.find(x=>x.id===nodeId); if(!n)return; n.x=(e.clientX-r.left-this.tx)/this.scale-this.dragging.ox; n.y=(e.clientY-r.top-this.ty)/this.scale-this.dragging.oy; el.style.left=n.x+"px"; el.style.top=n.y+"px"; this.renderEdges();};
    bub.onpointerup=()=>{this.dragging=null;this.autoSave()}; bub.onpointercancel=()=>{this.dragging=null};
  }

  // ── Edges ──

  private portPos(id:string,which:"in"|"out") { const n=this.nodes.find(x=>x.id===id); if(!n) return null; const w=200; return which==="out"?{x:n.x+w/2,y:n.y}:{x:n.x-w/2,y:n.y}; }
  private bezier(x1:number,y1:number,x2:number,y2:number) { const dx=Math.max(40,Math.abs(x2-x1)*0.5); return `M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`; }
  private addEdge(from:string,to:string) { this.edges.push({id:genId("e"),from,to}); this.renderEdges(); this.autoSave(); }
  private startLink(_e:Event,fromId:string) { const p=document.createElementNS("http://www.w3.org/2000/svg","path"); p.setAttribute("stroke","var(--brand)"); p.setAttribute("stroke-width","2.5"); p.setAttribute("stroke-dasharray","5 6"); p.setAttribute("fill","none"); this.svgEl.appendChild(p); this.linking={fromId,path:p}; }

  private renderEdges(): void {
    this.svgEl.querySelectorAll(".och-edge-group").forEach(g=>g.remove());
    for(const e of this.edges) {
      const a=this.portPos(e.from,"out"),b=this.portPos(e.to,"in"); if(!a||!b) continue;
      const d=this.bezier(a.x,a.y,b.x,b.y);
      const g=document.createElementNS("http://www.w3.org/2000/svg","g"); g.setAttribute("class","och-edge-group");
      const h=document.createElementNS("http://www.w3.org/2000/svg","path"); h.setAttribute("d",d); h.setAttribute("stroke","transparent"); h.setAttribute("stroke-width","16"); h.setAttribute("fill","none"); h.style.pointerEvents="stroke"; h.style.cursor="pointer"; h.onclick=()=>{this.edges=this.edges.filter(ed=>ed.id!==e.id);this.renderEdges();this.autoSave();};
      const p=document.createElementNS("http://www.w3.org/2000/svg","path"); p.setAttribute("d",d); p.setAttribute("class","och-edge-path"); p.setAttribute("stroke","var(--brand)"); p.setAttribute("stroke-width","2.5"); p.setAttribute("stroke-dasharray","5 7"); p.setAttribute("fill","none"); p.setAttribute("marker-end","url(#ar)");
      g.appendChild(p); g.appendChild(h); this.svgEl.appendChild(g);
    }
  }

  // ── Execution ──

  private async runChain(): Promise<void> {
    if(!this.nodes.length){new Notice("Agregá agentes primero");return}
    const order=topologicalOrder(this.nodes,this.edges);
    const modal=new InputModal(this.app,"Ejecutar cadena","Prompt de entrada","Investigá sobre QML");
    const input=await modal.ask(); if(!input)return;
    this.results.clear();
    new Notice(`Ejecutando ${order.length} paso(s)…`,0);

    // Show order badges
    order.forEach((nid,i)=>{const e=this.nodeEls.get(nid);if(!e)return;const b=e.querySelector(".och-badge")as HTMLElement;if(b){b.textContent=String(i+1);b.style.display="flex"}});

    const baseDeps = this.getTurnDeps();
    let scratchpad = "";
    let hasError = false;

    // Track which nodes are critics and their regeneration attempts
    const criticAttempts = new Map<string, number>();
    const MAX_ATTEMPTS = 3;

    // ── Execute nodes with critic loop ──
    for (let i = 0; i < order.length; i++) {
      const nid = order[i], node = this.nodes.find(x => x.id === nid);
      if (!node) continue;

      // Determine predecessors for critic loop
      const predecessors = this.edges.filter(e => e.to === nid).map(e => e.from);
      const isCritic = node.agentId === "critic";

      // ── Regeneration loop (for critic) ──
      if (isCritic && predecessors.length > 0) {
        let accepted = false;
        let attempt = 0;
        const predId = predecessors[0]; // Main predecessor (e.g. Researcher)

        while (!accepted && attempt < MAX_ATTEMPTS) {
          attempt++;

          // Execute critic
          const critRes = await this.executeNode(nid, node, input, scratchpad, baseDeps, attempt, MAX_ATTEMPTS);
          if (!critRes) { hasError = true; break; }

          // Parse critic JSON
          let verdict = "accept"; let score = 80;
          try {
            const start = critRes.indexOf('{'), end = critRes.lastIndexOf('}');
            if (start >= 0 && end >= 0) {
              const json = JSON.parse(critRes.substring(start, end + 1));
              const ev = json.evaluation || json;
              verdict = ev.verdict || "accept";
              score = ev.total_score ?? 80;
            }
          } catch {}

          criticAttempts.set(nid, attempt);
          this.results.set(nid, { nodeId: nid, agentId: node.agentId, output: critRes, status: "ok" });
          scratchpad += `\n\n=== Critic intento ${attempt}/${MAX_ATTEMPTS}: Score ${score}/100 (${verdict}) ===\n${critRes.slice(0, 1500)}`;

          // Update badge
          const el = this.nodeEls.get(nid);
          if (el) {
            const badge = el.querySelector(".och-badge") as HTMLElement;
            if (badge) { badge.textContent = `R${attempt}`; badge.style.background = verdict === "accept" ? "var(--green)" : "var(--orange)"; }
          }

          if (score >= 80 || verdict === "accept") {
            accepted = true;
          } else if (attempt < MAX_ATTEMPTS) {
            // Regenerate predecessor with feedback
            const predNode = this.nodes.find(x => x.id === predId);
            if (predNode) {
              const feedback = this.extractFeedback(critRes);
              scratchpad += `\n-- Feedback del Critic: ${feedback.slice(0, 200)}`;
              const predRes = await this.executeNode(predId, predNode, input, scratchpad, baseDeps, attempt, MAX_ATTEMPTS);
              if (predRes) {
                this.results.set(predId, { nodeId: predId, agentId: predNode.agentId, output: predRes, status: "ok" });
                scratchpad += `\n\n=== Regenerado (intento ${attempt}) ===\n${predRes.slice(0, 3000)}`;
                // Re-sync scratchpad into the enriched input for the next critic
                const predBadge = this.nodeEls.get(predId)?.querySelector(".och-badge") as HTMLElement;
                if (predBadge) predBadge.textContent = `R${attempt}`;
              }
            }
          }
        }
        if (!accepted) hasError = true;
        continue;
      }

      // ── Normal node execution ──
      const result = await this.executeNode(nid, node, input, scratchpad, baseDeps, 1, MAX_ATTEMPTS);
      if (result) {
        this.results.set(nid, { nodeId: nid, agentId: node.agentId, output: result, status: "ok" });
        scratchpad += `\n\n=== Paso ${i+1}: ${node.agentId} ===\n${result.slice(0, 3000)}`;
      } else {
        hasError = true; break;
      }
    }

    // Show final result in a modal
    const lastId = order[order.length - 1];
    const lastResult = this.results.get(lastId);
    let displayOutput = lastResult?.output || "";
    let criticScore = "";
    const lastNode = this.nodes.find(n => n.id === lastId);
    if (lastNode?.agentId === "critic" && lastResult?.output?.startsWith("{")) {
      for (let i = order.length - 2; i >= 0; i--) {
        const prevRes = this.results.get(order[i]);
        if (prevRes && prevRes.output) { displayOutput = prevRes.output; break; }
      }
      try {
        const json = JSON.parse(lastResult.output.substring(lastResult.output.indexOf('{'), lastResult.output.lastIndexOf('}') + 1));
        const ev = json.evaluation || json;
        const total = ev.total_score ?? "?";
        const verdict = ev.verdict === "accept" ? "Aceptado" : "Revisión requerida";
        const feedback = ev.feedback_for_regeneration?.slice(0, 3) || [];
        const att = criticAttempts.get(lastId) || 1;
        criticScore = `${verdict} · Score del Critic: ${total}/100 (${ev.verdict || "?"}) — Intento ${att}/${MAX_ATTEMPTS}`;
        if (feedback.length) criticScore += "\nFeedback: " + feedback.join("; ");
      } catch {}
    }

    if (lastResult) {
      new ResultModal(this.app, displayOutput, order.length, hasError, criticScore).open();
    } else {
      new Notice("La cadena no produjo ningún resultado.", 5000);
    }
    new Notice(`Cadena completada (${order.length} pasos)${hasError ? " — con errores" : ""}`);
  }

  /** Execute a single node and return its output. Handles loading, animation, and errors. */
  private async executeNode(
    nid: string, node: ChainNode, input: string, scratchpad: string,
    baseDeps: TurnDeps, attempt: number, maxAttempts: number,
  ): Promise<string | null> {
    const el = this.nodeEls.get(nid);
    let workAnim: Animation | null = null;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (el) {
      const b = el.querySelector(".och-bubble") as HTMLElement;
      b.style.borderColor = "var(--brand)"; b.style.borderWidth = "3px";
      b.style.boxShadow = "0 0 20px rgba(124,108,240,0.5)";
      if (!reduceMotion) workAnim = b.animate([
        { boxShadow: "0 0 10px rgba(124,108,240,0.4)", borderColor: "#8e7be6" },
        { boxShadow: "0 0 30px rgba(124,108,240,0.8)", borderColor: "#5e9fe8" },
        { boxShadow: "0 0 10px rgba(124,108,240,0.4)", borderColor: "#8e7be6" },
      ], { duration: 1200, iterations: Infinity, easing: "ease-in-out" });
      const dot = el.querySelector(".och-result") as HTMLElement;
      if (dot) { dot.style.display = "flex"; dot.style.background = "var(--brand)"; dot.textContent = "…"; if (!reduceMotion) dot.animate([{ opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }], { duration: 800, iterations: Infinity }); }
    }

    try {
      const agent = await loadAgentFromVault(this.vaultAdapter, `${node.agentId}.md`);
      let enriched = input;
      if (scratchpad) enriched = `Prompt original del usuario:\n${input}\n\n--- Outputs anteriores de la cadena ---\n${scratchpad}\n\n---\nResponde a la pregunta del usuario usando el contexto de los pasos anteriores.`;
      const { executeTurn } = await import("../orchestrator/agent-turn");
      const result = await executeTurn({ ...baseDeps, agent }, enriched, false, []);

      if (el) {
        if (workAnim) workAnim.cancel();
        const b = el.querySelector(".och-bubble") as HTMLElement;
        b.style.borderColor = "var(--green)"; b.style.borderWidth = "2px";
        b.style.boxShadow = "0 0 16px rgba(114,188,143,0.4)";
        if (!reduceMotion) b.animate([{boxShadow:"0 0 0 0 rgba(114,188,143,0.6)"},{boxShadow:"0 0 12px 0 rgba(114,188,143,0)"}],{duration:700});
        const d = el.querySelector(".och-result") as HTMLElement;
        if (d) { d.style.display = "flex"; d.style.background = "var(--green)"; d.textContent = "✓"; d.getAnimations().forEach(a => a.cancel()); }
      }
      return result.content;
    } catch (err: any) {
      if (el) {
        if (workAnim) workAnim.cancel();
        const b = el.querySelector(".och-bubble") as HTMLElement;
        b.style.borderColor = "var(--red)"; b.style.borderWidth = "2px";
        b.style.boxShadow = "0 0 16px rgba(233,115,102,0.4)";
        if (!reduceMotion) b.animate([{boxShadow:"0 0 0 0 rgba(233,115,102,0.6)"},{boxShadow:"0 0 12px 0 rgba(233,115,102,0)"}],{duration:400});
        const d = el.querySelector(".och-result") as HTMLElement;
        if (d) { d.style.display = "flex"; d.style.background = "var(--red)"; d.textContent = "✗"; d.getAnimations().forEach(a => a.cancel()); }
      }
      return null;
    }
  }

  /** Extract feedback text from a Critic JSON output. */
  private extractFeedback(output: string): string {
    try {
      const s = output.indexOf('{'), e = output.lastIndexOf('}');
      if (s >= 0 && e >= 0) {
        const json = JSON.parse(output.substring(s, e + 1));
        const fb = json.evaluation?.feedback_for_regeneration || json.feedback_for_regeneration || [];
        return Array.isArray(fb) ? fb.join("; ") : String(fb);
      }
    } catch {}
    return output.slice(0, 500);
  }

  // ── Chain I/O ──

  private autoSave(): void {
    if(!this.currentChainId) return;
    const chain:Chain={id:this.currentChainId,name:this.chainNameEl.value,invocation:`@${this.currentChainId}`,description:`${this.nodes.length} agentes,${this.edges.length} conexiones`,projectId:"global",nodes:[...this.nodes],edges:[...this.edges],defaultForProject:false};
    this.store.save(chain).catch(() => new Notice("Error al guardar. ¿Existe sanctum-chains/?", 5000));
  }

  private async saveChain(): Promise<void> {
    if(!this.nodes.length){new Notice("Agregá agentes primero");return}
    const name=this.chainNameEl.value.trim()||`Cadena ${Date.now()}`;
    if(!this.currentChainId) this.currentChainId=`cadena-${Date.now()}`;
    const chain:Chain={id:this.currentChainId,name,invocation:`@${this.currentChainId}`,description:`${this.nodes.length} agentes,${this.edges.length} conexiones`,projectId:"global",nodes:[...this.nodes],edges:[...this.edges],defaultForProject:false};
    await this.store.save(chain); new Notice(`💾 Cadena "${name}" guardada`);
  }

  private async loadChainList(): Promise<void> { const ids=await this.store.list(); if(ids.length===0) this.loadDemo(); }

  private showChainMenu(): void {
    const menu=document.body.createDiv({cls:"s-thread-menu"}); menu.style.position="fixed"; menu.style.zIndex="10000";
    this.store.list().then(ids=>{
      if(ids.length===0) menu.createDiv({text:"No hay cadenas guardadas",attr:{style:"font-size:11px;color:var(--text-3);padding:6px 10px"}});
      for(const id of ids){const row=menu.createDiv({cls:"s-thread-menu-item"}); this.store.load(id).then(c=>{if(!c)return; row.createSpan({text:`${c.name} (${c.nodes?.length||0} pasos)`,attr:{style:"flex:1"}}); row.onclick=()=>{this.loadChain(c!);menu.remove()};})}
    });
    const{right:r,bottom:b}=this.chainNameEl.getBoundingClientRect(); menu.style.top=b+4+"px"; menu.style.right=window.innerWidth-r+"px";
    setTimeout(()=>document.addEventListener("click",()=>menu.remove(),{once:true}),0);
  }

  private loadChain(chain:Chain):void{
    this.clear(); this.currentChainId=chain.id; this.chainNameEl.value=chain.name;
    const map=new Map<string,string>();
    for(const n of chain.nodes) map.set(n.id,this.addNode(n.agentId,n.x,n.y));
    setTimeout(()=>{for(const e of chain.edges){const f=map.get(e.from),t=map.get(e.to); if(f&&t) this.addEdge(f,t)}},50);
    new Notice(`Cadena "${chain.name}" cargada`);
  }

  // ── Zoom / UI ──

  private applyVp():void{this.vpEl.style.transform=`translate(${this.tx}px,${this.ty}px) scale(${this.scale})`}
  private zoom(f:number,cx:number,cy:number):void{const ns=this.scale*f;if(ns<0.2||ns>5)return;this.tx=cx-(cx-this.tx)*f;this.ty=cy-(cy-this.ty)*f;this.scale=ns;this.applyVp()}
  private updateEmpty():void{this.emptyEl.style.display=this.nodes.length?"none":"grid"}

  private autoArrange():void{
    const order=topologicalOrder(this.nodes,this.edges); const r=this.canvasWrap.getBoundingClientRect();
    const startX=170,gap=210,y=r.height/2; const placed=new Set(order);
    order.forEach((id,i)=>{const n=this.nodes.find(x=>x.id===id);if(!n)return;n.x=startX+i*gap;n.y=y+(i%2?40:-40);const e=this.nodeEls.get(id);if(e){e.style.left=n.x+"px";e.style.top=n.y+"px"}});
    let k=order.length; this.nodes.filter(n=>!placed.has(n.id)).forEach(n=>{n.x=startX+(k++)*gap;n.y=y-120;const e=this.nodeEls.get(n.id);if(e){e.style.left=n.x+"px";e.style.top=n.y+"px"}}); this.renderEdges();
  }

  private clear():void{this.nodeEls.forEach(e=>e.remove());this.nodeEls.clear();this.nodes=[];this.edges=[];this.results.clear();this.renderEdges();this.updateEmpty()}

  private loadDemo():void{
    const r=this.canvasWrap.getBoundingClientRect(); if(r.width<100){setTimeout(()=>this.loadDemo(),200);return}
    const a=this.addNode("forager",r.width*0.22,r.height/2-30),b=this.addNode("researcher",r.width*0.48,r.height/2+20),c=this.addNode("critic",r.width*0.74,r.height/2-30);
    setTimeout(()=>{if(this.nodes.length>=3){this.addEdge(a,b);this.addEdge(b,c)}},50);
  }
}

// ═══════════════════════════════════════════════════
//  RESULT MODAL — shows final chain output
// ═══════════════════════════════════════════════════

class ResultModal extends Modal {
  constructor(app: any, private output: string, private steps: number, private hasError: boolean, private criticScore?: string) { super(app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.maxWidth = "700px";
    contentEl.style.maxHeight = "80vh";
    contentEl.style.overflowY = "auto";

    contentEl.createDiv({ text: `Resultado final (${this.steps} pasos)${this.hasError ? " — con errores" : ""}`, attr: { style: "font-weight:700;font-size:16px;color:var(--brand);margin-bottom:8px;padding-bottom:8px;border-bottom:2px solid var(--brand)" } });

    // Critic score header
    if (this.criticScore) {
      const critDiv = contentEl.createDiv({ attr: { style: "padding:8px 10px;border-radius:6px;margin-bottom:12px;font-size:12px;white-space:pre-wrap;background:var(--orange-soft);color:var(--orange);border:1px solid var(--orange)" } });
      critDiv.setText(this.criticScore);
    }

    const body = contentEl.createDiv({ attr: { style: "font-size:13px;color:var(--text-2);line-height:1.6;white-space:pre-wrap;word-break:break-word" } });
    body.setText(this.output);

    // Copy button
    const btnRow = contentEl.createDiv({ attr: { style: "margin-top:16px;display:flex;justify-content:flex-end" } });
    const copyBtn = btnRow.createEl("button", { text: "📋 Copiar", attr: { style: "padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--raised);color:var(--text-2);cursor:pointer;font-size:12px" } });
    copyBtn.onclick = () => { navigator.clipboard.writeText(this.output); new Notice("📋 Copiado al portapapeles"); };
    const closeBtn = btnRow.createEl("button", { text: "Cerrar", attr: { style: "padding:6px 14px;border-radius:6px;border:none;background:var(--brand);color:#fff;cursor:pointer;font-size:12px;margin-left:8px" } });
    closeBtn.onclick = () => this.close();
  }
  onClose(): void { this.contentEl.empty(); }
}



