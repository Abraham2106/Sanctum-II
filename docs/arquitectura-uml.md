# Sanctum II — Documentación UML de Arquitectura

> **Plugin de Obsidian** — AI Agent Mesh con RAG, Knowledge Graph, y Orquestación de Cadenas  
> **Versión:** 0.1.0 | **Lenguaje:** TypeScript | **Build:** esbuild → CJS

---

## Índice

1. [Diagrama de Paquetes (Package Diagram)](#1-diagrama-de-paquetes-package-diagram)
2. [Diagrama de Clases (Class Diagram)](#2-diagrama-de-clases-class-diagram)
3. [Diagrama de Componentes (Component Diagram)](#3-diagrama-de-componentes-component-diagram)
4. [Diagrama de Secuencia — Flujo de Chat](#4-diagrama-de-secuencia--flujo-de-chat)
5. [Diagrama de Secuencia — Mesh con Crítico](#5-diagrama-de-secuencia--mesh-con-crítico)
6. [Diagrama de Secuencia — Ejecución de Cadenas](#6-diagrama-de-secuencia--ejecución-de-cadenas)
7. [Diagrama de Estados — Ciclo Mesh](#7-diagrama-de-estados--ciclo-mesh)
8. [Diagrama Entidad-Relación (ER)](#8-diagrama-entidad-relación-er)
9. [Diagrama de Despliegue (Deployment)](#9-diagrama-de-despliegue-deployment)

---

## 1. Diagrama de Paquetes (Package Diagram)

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '14px' }}}%%
graph TB
    subgraph Core["🧩 Core"]
        main["main.ts<br/>SanctumPlugin"]
        constants["constants.ts<br/>Settings / VIEW_TYPE"]
        env["env-loader.ts<br/>.env parsing"]
        commands["commands.ts<br/>Palette Commands"]
        noteWriter["note-writer.ts<br/>NoteWriter"]
        tests["tests.ts<br/>RAG / Chat tests"]
        utils["utils.ts<br/>globMatch, slugify"]
    end

    subgraph LLM_IA["🤖 LLM & IA"]
        opencode["opencode-client.ts<br/>OpenCodeClient<br/>OpenAI-compatible"]
        gemini["gemini-balancer.ts<br/>GeminiBalancer<br/>Embeddings + Key Rotation"]
    end

    subgraph Data["💾 Persistencia"]
        vectorStore["vector-store.ts<br/>VectorStore<br/>JSONL + Base64"]
        kgStore["kg-store.ts<br/>KgEdgeStore<br/>JSONL edges"]
        projectStore["projects/store.ts<br/>ProjectStore<br/>MD + JSON + JSONL"]
        chainStore["chains/store.ts<br/>ChainStore<br/>JSON files"]
    end

    subgraph Orchestration["🎯 Orquestación"]
        agentTurn["agent-turn.ts<br/>executeTurn()<br/>RAG → KG → Prompt → LLM"]
        conversation["conversation.ts<br/>classifyIntent<br/>buildPayload"]
        mesh["mesh.ts<br/>runMeshWithCritic()<br/>Forager → R ↔ C"]
        noteGen["note-generator.ts<br/>executeWriteIntent"]
    end

    subgraph Knowledge["🧠 Knowledge Graph"]
        kg["kg.ts<br/>computeEdges<br/>expandFromSeeds"]
        kgLayout["layout.ts<br/>forceLayout<br/>convolutionalLayout"]
        nativeLinks["native-links.ts<br/>wikilink edges"]
    end

    subgraph Projects["📁 Proyectos"]
        pTypes["projects/types.ts<br/>Project, Thread, Memory"]
        pContext["projects/context.ts<br/>buildProjectContext"]
        pIndexer["projects/indexer.ts<br/>indexProject"]
    end

    subgraph Rag["🔍 RAG"]
        ragIndexer["rag/indexer.ts<br/>indexResearchFolder"]
    end

    subgraph Agents["👤 Agentes"]
        agentTypes["agents/types.ts<br/>AgentDefinition"]
        agentLoader["agents/agent-loader.ts<br/>parseAgentMd"]
        fallback["agents/fallback.ts<br/>fallbackAgent"]
    end

    subgraph Skills["⚡ Skills"]
        skillTypes["skills/types.ts<br/>Skill"]
        skillLoader["skills/loader.ts<br/>listSkills / loadSkill"]
    end

    subgraph Tools["🔧 Tools"]
        tavily["tavily.ts<br/>searchTavily"]
    end

    subgraph Observability["📊 Observabilidad"]
        tracer["tracer.ts<br/>Tracer<br/>Trace JSON"]
    end

    subgraph UI["🖥️ UI (Obsidian Views)"]
        chatView["chat-view.ts<br/>SanctumChatView"]
        chatLeft["chat-left.ts<br/>ChatLeftPanel"]
        chatRight["chat-right.ts<br/>ChatRightPanel"]
        chatMessages["chat-messages.ts<br/>ChatMessages"]
        chatComposer["chat-composer.ts<br/>ChatComposer"]
        chatAuto["chat-autocomplete.ts<br/>ChatAutocomplete"]
        kgView["kg-view.ts<br/>KgView"]
        projectsView["projects-view.ts<br/>ProjectsView"]
        chainView["chain-view.ts<br/>ChainView"]
        settingsTab["settings-tab.ts<br/>SanctumSettingTab"]
        agentModal["agent-generator-modal.ts<br/>AgentGeneratorModal"]
    end

    subgraph Services["⚙️ DI Container"]
        appServices["app/services.ts<br/>AppServices"]
        chatOrch["app/chat-orchestrator.ts<br/>ChatOrchestrator"]
    end

    main --> constants
    main --> utils
    main --> Core
    main --> Services
    main --> UI
    Services --> Data
    Services --> LLM_IA
    Services --> Observability
    Services --> Projects
    Services --> Skills
    Services --> Agents
    chatOrch --> Orchestration
    chatOrch --> Services
    Orchestration --> LLM_IA
    Orchestration --> Data
    Orchestration --> Knowledge
    Orchestration --> Tools
    Orchestration --> Rag
    Orchestration --> Projects
    Orchestration --> Skills
    Orchestration --> Observability
    Knowledge --> Data
    Knowledge --> Rag
    UI --> Orchestration
    UI --> Services
    UI --> Knowledge
    UI --> Projects
    UI --> Agents
    UI --> Skills
```

---

## 2. Diagrama de Clases (Class Diagram)

### 2.1 Clases Principales del Plugin

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '13px' }}}%%
classDiagram
    class Plugin {
        <<Obsidian SDK>>
    }

    class ItemView {
        <<Obsidian SDK>>
    }

    class SanctumPlugin {
        +settings: SanctumSettings
        +geminiBalancer: GeminiBalancer
        +opencodeClient: OpenCodeClient
        +vectorStore: VectorStore
        +noteWriter: NoteWriter
        +tracer: Tracer
        +kgEdgeStore: KgEdgeStore
        +projectStore: ProjectStore
        +chainStore: ChainStore
        +services: AppServices
        +chatOrch: ChatOrchestrator
        -vectorStores: Map~string, VectorStore~
        -activeProject: Project | null
        -activeProjectContext: ProjectContext | null
        -activeThreadId: string
        -skillContext: Skill | null
        +onload(): Promise~void~
        +loadSettings(): Promise~void~
        +saveSettings(): Promise~void~
        +sendChatMessage(msg: string): Promise~string~
        +runMesh(prompt: string): Promise~MeshResultFull~
        +setActiveProject(id: string): Promise~void~
        +indexResearch(folder?: string): Promise~void~
        +loadThreadMessages(id: string): Promise~any[]~
        +saveThreadMessages(id: string, msgs: any[]): Promise~void~
        +getSkills(): Promise~Skill[]~
        +setSkillContext(id: string | null): Promise~void~
    }

    Plugin <|-- SanctumPlugin

    class AppServices {
        +adapter: VaultAdapter
        +opencodeClient: OpenCodeClient
        +geminiBalancer: GeminiBalancer
        +tracer: Tracer
        +vectorStore: VectorStore
        +vectorStores: Map~string, VectorStore~
        +projectStore: ProjectStore
        +kgEdgeStore: KgEdgeStore
        +chainStore: ChainStore
        +noteWriter: NoteWriter
        +settings: SanctumSettings
        +agent: AgentDefinition | null
        +activeFolder: string | null
        +activeProject: Project | null
        +activeProjectContext: ProjectContext | null
        +activeThreadId: string
        +skillContext: Skill | null
        +getSkills(): Promise~Skill[]~
        +setSkillContext(id: string | null): Promise~void~
        +kgOptions: KgOptions
        +pathFilter: string[] | undefined
    }

    SanctumPlugin *-- AppServices
    SanctumPlugin --> ChatOrchestrator

    class ChatOrchestrator {
        -svc: AppServices
        +handleMessage(msg, conv?, sum?): Promise~ChatResponse~
        -handleAgentMessage(msg, mention, conv?, sum?): Promise~ChatResponse~
        -buildTurnDeps(input: string): TurnDeps
        -persistThreadData(msg, result): Promise~void~
        -executeWriteIntent(msg: string): string | null
        -fallbackAgent(): AgentDefinition
    }

    ChatOrchestrator --> AppServices

    class SanctumChatView {
        +getViewType(): string
        +getDisplayText(): string
        +getIcon(): string
        +setThreadId(id: string): void
        +postMessage(msg: string): Promise~void~
        +reloadForProject(threadId: string): Promise~void~
    }

    ItemView <|-- SanctumChatView
    SanctumChatView --> ChatOrchestrator
```

### 2.2 Servicios de Datos y LLM

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '13px' }}}%%
classDiagram
    class VectorStore {
        +storePath: string
        +allChunks: Chunk[]
        +count: number
        +load(adapter: VaultAdapter): Promise~void~
        +save(adapter: VaultAdapter): Promise~void~
        +add(chunk: Chunk): void
        +clear(): void
        +search(embedding: number[], k: number): ScoredChunk[]
        +filterByPaths(results, patterns): ScoredChunk[]
        +getStorePath(): string
    }

    class Chunk {
        +id: string
        +note_path: string
        +chunk_text: string
        +embedding: number[]
        +chunk_index: number
        +total_chunks: number
    }

    VectorStore *-- Chunk

    class GeminiBalancer {
        +modelNames: string[]
        +hasKeys: boolean
        +embed(text: string): Promise~number[]~
        -embedWithKey(key: string, model: string, text: string): Promise~number[]~
    }

    class OpenCodeClient {
        +configured: boolean
        +chat(systemPrompt, userPrompt, rag?): Promise~LLMResponse~
        +chat(messages: ConversationMessage[]): Promise~LLMResponse~
    }

    class NoteWriter {
        +create(path: string, content: string): Promise~WriteResult~
        +update(path: string, content: string): Promise~WriteResult~
        +append(path: string, content: string): Promise~WriteResult~
        +replace(path: string, oldStr: string, newStr: string): Promise~WriteResult~
    }

    class KgEdgeStore {
        +edges: KgEdge[]
        +count: number
        +load(adapter: VaultAdapter): Promise~void~
        +save(adapter: VaultAdapter): Promise~void~
        +add(edge: KgEdge): void
        +setEdges(notePath: string, edges: KgEdge[]): void
        +getEdgesFor(notePath: string): KgEdge[]
        +delAllEdgesForNote(notePath: string): void
    }

    class ProjectStore {
        -adapter: VaultAdapter
        +loadProject(id: string): Promise~Project~
        +saveProject(project: Project): Promise~void~
        +projectExists(id: string): Promise~boolean~
        +createProject(id: string, name: string): Promise~Project~
        +listProjects(): Promise~Project[]~
        +loadThreadData(pid: string, tid: string): Promise~ThreadData~
        +saveThreadData(pid: string, thread, messages): Promise~void~
        +loadMemory(pid: string): Promise~MemoryEntry[]~
        +appendMemory(pid: string, entry: MemoryEntry): Promise~void~
    }

    class ChainStore {
        -adapter: VaultAdapter
        +load(id: string): Promise~Chain~
        +save(chain: Chain): Promise~void~
        +list(): Promise~string[]~
        +delete(id: string): Promise~void~
    }

    class Tracer {
        +start(agentId: string, mode: string, input: string): string
        +finish(output: string, meta?: object): void
        +abort(error: string): void
        +addChunk(chunk: TraceChunk): void
    }
```

### 2.3 Orquestación — Interfaces y Funciones

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '13px' }}}%%
classDiagram
    class TurnDeps {
        +agent: AgentDefinition
        +opencodeClient: OpenCodeClient
        +geminiBalancer: GeminiBalancer
        +vectorStore: VectorStore
        +tracer: Tracer
        +tavilyApiKey?: string
        +tavilyQuery?: string
        +kgOptions?: KgOptions
        +edgeStore?: KgEdgeStore
        +projectContext?: ProjectContext
        +skillContext?: Skill
        +conversationMessages?: ConversationMessage[]
        +conversationSummary?: string
    }

    class TurnResult {
        +content: string
        +usage: { prompt: number, completion: number }
        +ragContext: string
        +conversationSummary?: string
    }

    class MeshOptions {
        +userPrompt: string
        +vaultAdapter: VaultAdapter
        +geminiBalancer: GeminiBalancer
        +vectorStore: VectorStore
        +opencodeClient: OpenCodeClient
        +tracer: Tracer
        +pathFilter?: string[]
        +tavilyApiKey?: string
        +kgOptions?: KgOptions
        +edgeStore?: KgEdgeStore
        +projectContext?: ProjectContext
        +skillContext?: Skill
    }

    class MeshResultFull {
        +foragerOutput: string
        +researcherOutput: string
        +criticScore?: number
        +criticVerdict: "accept" | "escalated"
        +attempts: number
        +loopState: LoopState
        +createdNotePath?: string
    }

    class LoopState {
        +original_prompt: string
        +current_step: "forager" | "research" | "critic_review" | "done" | "escalated"
        +attempt: number
        +max_attempts: number
        +history: HistoryEntry[]
        +attempts: AttemptRecord[]
        +best_attempt: number
    }

    class CriticEvaluation {
        +criteria: CriteriaScore[]
        +total_score: number
        +threshold: number
        +verdict: "accept" | "reject"
        +feedback_for_regeneration: string[]
    }

    MeshResultFull --> LoopState
    LoopState --> AttemptRecord
    MeshOptions --> TurnDeps
```

### 2.4 Modelos de Datos

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '13px' }}}%%
classDiagram
    class AgentDefinition {
        +id: string
        +name: string
        +avatar: string
        +model: string
        +description: string
        +triggers: string[]
        +tools: string[]
        +permissions: AgentPermissions
        +system_prompt: string
    }

    class AgentPermissions {
        +read_paths: string[]
        +write_paths: string[]
    }

    AgentDefinition *-- AgentPermissions

    class Skill {
        +id: string
        +name: string
        +description: string
        +tools: string[]
        +instructions: string
    }

    class Project {
        +id: string
        +name: string
        +icon: string
        +description: string
        +model: string
        +read_paths: string[]
        +write_paths: string[]
        +rag: ProjectRag
        +files: ProjectFile[]
        +kg_enabled: boolean
        +indexed: boolean
    }

    class ProjectRag {
        +embed_model: string
        +dims: number
        +chunk_words: number
        +top_k: number
        +min_similarity: number
    }

    Project *-- ProjectRag

    class Chain {
        +id: string
        +name: string
        +invocation: string
        +description: string
        +projectId: string
        +nodes: ChainNode[]
        +edges: ChainEdge[]
        +defaultForProject: boolean
    }

    class ChainNode {
        +id: string
        +agentId: string
        +x: number
        +y: number
        +label?: string
    }

    class ChainEdge {
        +id: string
        +from: string
        +to: string
    }

    Chain *-- ChainNode
    Chain *-- ChainEdge

    class Thread {
        +thread_id: string
        +project_id: string
        +title: string
        +created_at: number
        +updated_at: number
        +starred: boolean
    }

    class ThreadData {
        +thread: Thread
        +messages: ChatMessage[]
        +summary?: string
        +pendingAction?: PendingAction
    }

    Thread --> ThreadData

    class MemoryEntry {
        +timestamp: number
        +text: string
        +source: string
    }

    class KgEdge {
        +from: string
        +to: string
        +type: "explicit" | "semantic" | "reinforced"
        +weight: number
        +relation?: string
    }

    class KgOptions {
        +enabled: boolean
        +minSimilarity: number
        +hops: number
        +maxNeighborsPerHop: number
        +useExplicit: boolean
        +reinforceBoost: boolean
    }

    class SanctumSettings {
        +opencodeApiKey: string
        +opencodeBaseUrl: string
        +geminiApiKeys: string
        +tavilyApiKey: string
        +activeProjectId: string
        +projectsEnabled: boolean
        +projectReindexOnOpen: boolean
        +kgEnabled: boolean
        +kgMinSimilarity: number
        +kgHops: number
        +kgUseExplicit: boolean
        +kgReinforceBoost: boolean
        +defaultModel: string
        +maxTokens: number
        +temperature: number
    }
```

---

## 3. Diagrama de Componentes (Component Diagram)

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '14px' }}}%%
graph TB
    subgraph Obsidian["🖥️ Obsidian Desktop"]
        subgraph Plugin["SanctumPlugin (main.ts)"]
            direction TB
            Settings["⚙️ Settings<br/>(SanctumSettingTab)"]
            Commands["⌨️ Commands<br/>(Palette)"]
            Ribbon["🎀 Ribbon Icons"]
        end

        subgraph Views["📋 ItemViews"]
            ChatView["💬 Chat View<br/>3-column layout"]
            ProjectsV["📁 Projects View<br/>Hub + Threads"]
            KgV["🕸️ KG View<br/>SVG Graph"]
            ChainV["⛓️ Chain View<br/>SVG Canvas"]
        end

        subgraph Vault["📂 Obsidian Vault"]
            Markdown["📝 Markdown Notes"]
            Links["🔗 Wikilinks"]
            Metadata["🏷️ MetadataCache"]
        end
    end

    subgraph Services["⚙️ AppServices (DI Container)"]
        direction TB
        ChatOrch["ChatOrchestrator<br/>(pipeline)"]
        Mesh["Mesh Orchestrator<br/>(Forager→R↔C)"]
        ChainExec["Chain Executor<br/>(topological sort)"]
    end

    subgraph DataLayer["💾 Data Layer"]
        direction LR
        VS["VectorStore<br/>(JSONL)"]
        KGS["KgEdgeStore<br/>(JSONL)"]
        PS["ProjectStore<br/>(MD+JSON)"]
        CS["ChainStore<br/>(JSON)"]
        TR["Tracer<br/>(JSON traces)"]
        NW["NoteWriter<br/>(FS ops)"]
    end

    subgraph AI["🤖 AI Services"]
        direction LR
        OC["OpenCodeClient<br/>(Chat API)"]
        GB["GeminiBalancer<br/>(Embeddings)"]
        TV["Tavily Search<br/>(Web)"]
    end

    subgraph Pipeline["🔄 Processing Pipeline"]
        direction TB
        RAG["RAG Query<br/>(embed → search)"]
        KG["KG Expansion<br/>(expandFromSeeds)"]
        Prompt["Prompt Render<br/>(template + context)"]
        Agent["Agent Loader<br/>(parseAgentMd)"]
    end

    subgraph External["🌐 External APIs"]
        OpenCode["OpenCode API<br/>(deepseek-v4-flash)"]
        Gemini["Google Gemini<br/>(text-embedding-004)"]
        TavilyAPI["Tavily Search API"]
    end

    Plugin --> Views
    Plugin --> Services
    Views --> Vault
    Services --> DataLayer
    Services --> AI
    Services --> Pipeline
    AI --> External
    Pipeline --> DataLayer
    Pipeline --> AI
```

---

## 4. Diagrama de Secuencia — Flujo de Chat

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '13px' }}}%%
sequenceDiagram
    actor User
    participant CV as ChatView
    participant SP as SanctumPlugin
    participant CO as ChatOrchestrator
    participant AL as AgentLoader
    participant ET as executeTurn
    participant GB as GeminiBalancer
    participant VS as VectorStore
    participant KGE as KgEdgeStore
    participant TV as Tavily
    participant OC as OpenCodeClient
    participant TR as Tracer

    User->>CV: Escribe mensaje
    CV->>SP: sendChatMessage(msg, conv, summary)
    
    alt @agent-generator
        SP->>SP: Abre AgentGeneratorModal
    else Mensaje normal
        SP->>CO: handleMessage(msg, conv, summary)
        
        alt Write Intent detectado
            CO-->>SP: content (confirmación)
        else @chain mencionado
            CO->>CO: chainStore.load(name)
            CO->>CO: topologicalOrder(nodes, edges)
            loop Por cada nodo en orden topológico
                CO->>CO: getAgent(agentId)
                CO->>ET: executeTurn(deps, enrichedInput)
                ET-->>CO: TurnResult
            end
            CO-->>SP: ChainResult
        else @agent mencionado (ej: @web-search)
            CO->>AL: loadAgentFromVault("agent.md")
            AL-->>CO: AgentDefinition
            
            opt Forager Pipeline (web-search / researcher)
                CO->>AL: loadAgentFromVault("forager.md")
                CO->>ET: executeTurn(foragerDeps, msg)
                ET-->>CO: refined query
            end
            
            CO->>ET: executeTurn(deps, actualMessage)
            
            ET->>TR: trace.start(agentId, mode, input)
            ET->>GB: embed(userInput)
            GB-->>ET: embedding vector
            ET->>VS: search(embedding, topK)
            VS-->>ET: ScoredChunk[]
            
            opt KG Expansion habilitado
                ET->>KGE: expandFromSeeds(seedNotes, embedding, opts)
                KGE-->>ET: KgExpansionResult
            end
            
            opt Web Search (agent tiene tool web_search)
                ET->>TV: searchTavily(query)
                TV-->>ET: TavilyResult
            end
            
            ET->>ET: renderSystemPrompt(agent, ragContext, input)
            ET->>ET: injectProjectPrefix / skill instructions
            ET->>OC: chat(systemPrompt, userPrompt, rag)
            OC-->>ET: LLMResponse
            ET->>TR: trace.finish(output, meta)
            ET-->>CO: TurnResult
            
            CO->>CO: persistThreadData(msg, result)
            CO-->>SP: ChatResponse
        end
    end
    
    SP-->>CV: respuesta del agente
    CV-->>User: Muestra mensaje renderizado
```

---

## 5. Diagrama de Secuencia — Mesh con Crítico

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '13px' }}}%%
sequenceDiagram
    actor User
    participant SP as SanctumPlugin
    participant Mesh as runMeshWithCritic
    participant AL as AgentLoader
    participant ET as executeTurn
    participant CR as Critic (parseCriticJSON)
    participant OR as Orchestrator
    participant NW as NoteWriter

    User->>SP: Modo Mesh activado
    SP->>Mesh: runMeshWithCritic(opts)

    Mesh->>AL: loadAgentFromVault("forager.md")
    Mesh->>AL: loadAgentFromVault("researcher.md")
    Mesh->>AL: loadAgentFromVault("critic.md")
    Mesh->>AL: loadAgentFromVault("orchestrator.md")

    Note over Mesh: Step 1 — Forager
    Mesh->>ET: executeTurn(forager, userPrompt)
    ET-->>Mesh: foragerResult (contexto refinado)

    Note over Mesh: Step 2 — Researcher ↔ Critic Loop

    loop attempt ≤ max_attempts (3)
        Mesh->>Mesh: buildResearcherInput(foragerOutput + critic feedback)
        Mesh->>ET: executeTurn(researcher, enrichedInput)
        ET-->>Mesh: researcherResult

        Mesh->>Mesh: buildCriticInput(originalPrompt, researcherOutput)
        Mesh->>ET: executeTurn(critic, criticInput, skipRag=true)
        ET-->>Mesh: criticRawOutput
        Mesh->>CR: parseCriticJSON(raw)
        CR-->>Mesh: CriticEvaluation

        Mesh->>OR: resolveOrchestratorDecision(state, evaluation)
        OR-->>Mesh: action: "accept" | "escalate" | "regenerate"

        alt action = "accept"
            Mesh-->>SP: MeshResultFull (criticVerdict: accept)
            
            opt Write Intent detectado
                SP->>NW: create(noteName, researcherOutput)
                NW-->>SP: WriteResult
                SP->>Mesh: createdNotePath asignado
            end
            
        else action = "escalate"
            Mesh-->>SP: MeshResultFull (criticVerdict: escalated)
            
        else action = "regenerate"
            Note over Mesh: attempt += 1, volver al loop
        end
    end

    Note over Mesh: Safety net: max_attempts → pickBestAttempt → accept
    Mesh-->>SP: MeshResultFull

    SP-->>User: Muestra resultado final
```

---

## 6. Diagrama de Secuencia — Ejecución de Cadenas

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '13px' }}}%%
sequenceDiagram
    actor User
    participant CO as ChatOrchestrator
    participant CS as ChainStore
    participant EC as executeChain
    participant AL as AgentLoader
    participant ET as executeTurn

    User->>CO: "@nombre-cadena haz un análisis"

    CO->>CS: load("nombre-cadena")
    CS-->>CO: Chain (nodes + edges)

    CO->>EC: executeChain(chain, baseDeps, getAgent, userInput)
    EC->>EC: topologicalOrder(nodes, edges)
    Note over EC: Orden topológico calculado

    loop Por cada nodeId en orden
        EC->>EC: Busca ChainNode por id
        EC->>AL: getAgent(node.agentId)
        AL-->>EC: AgentDefinition

        EC->>EC: Construye enrichedInput con scratchpad
        Note over EC: Concatena outputs de nodos anteriores

        EC->>ET: executeTurn({...baseDeps, agent}, enrichedInput)
        ET-->>EC: TurnResult

        EC->>EC: Guarda resultado en scratchpad[nodeId]
    end

    EC->>EC: finalOutput = último resultado
    EC-->>CO: { order, results, finalOutput }

    CO-->>User: Resultado de la cadena completa
```

---

## 7. Diagrama de Estados — Ciclo Mesh

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '14px' }}}%%
stateDiagram-v2
    [*] --> Forager : Usuario activa Mesh

    state Forager {
        [*] --> EjecutandoForager
        EjecutandoForager --> Completo : executeTurn(forager)
    }

    Forager --> Researcher : Forager completo
    
    state Researcher {
        [*] --> ConstruyendoInput
        ConstruyendoInput --> Ejecutando : buildResearcherInput()
        Ejecutando --> OutputGenerado : executeTurn(researcher)
    }

    Researcher --> CriticReview : Output del Researcher

    state CriticReview {
        [*] --> Evaluando : buildCriticInput()
        Evaluando --> ParseandoJSON : executeTurn(critic, skipRag=true)
        ParseandoJSON --> EvaluacionCompleta : parseCriticJSON()
    }

    CriticReview --> OrchestratorDecision : Evaluación completa

    state OrchestratorDecision {
        [*] --> EvaluandoEstado : buildOrchestratorInput()
        EvaluandoEstado --> Decidiendo : LLM call / thresholds
        
        state Decidiendo {
            [*] --> Accept : score ≥ 80 OR max_attempts
            [*] --> Escalate : score ≤ 40
            [*] --> Regenerate : 40 < score < 80 AND attempt < max
            
            Regenerate --> Researcher : attempt += 1
        }
    }

    OrchestratorDecision --> Done : action = "accept"
    OrchestratorDecision --> Escalated : action = "escalate"

    state Done {
        [*] --> VerificandoWriteIntent
        VerificandoWriteIntent --> CreandoNota : write intent detectado
        VerificandoWriteIntent --> Finalizando : sin write intent
        CreandoNota --> Finalizando
        Finalizando --> [*]
    }

    state Escalated {
        [*] --> Notificando
        Notificando --> [*]
    }
```

---

## 8. Diagrama Entidad-Relación (ER)

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '14px' }}}%%
erDiagram
    Project ||--o{ ProjectFile : "contiene"
    Project ||--o{ MemoryEntry : "acumula"
    Project ||--o{ Thread : "tiene"
    Project ||--o{ Chain : "asociado"
    Project {
        string id PK
        string name
        string icon
        string description
        string model
        stringArray read_paths
        stringArray write_paths
        json rag
        boolean kg_enabled
        boolean indexed
    }

    ProjectRag {
        string embed_model
        int dims
        int chunk_words
        int top_k
        float min_similarity
    }

    Thread ||--o{ ChatMessage : "contiene"
    Thread {
        string thread_id PK
        string project_id FK
        string title
        timestamp created_at
        timestamp updated_at
        boolean starred
    }

    ThreadData {
        json thread
        jsonArray messages
        string summary
        json pendingAction
    }

    Chain ||--o{ ChainNode : "compuesto por"
    Chain ||--o{ ChainEdge : "conectado por"
    Chain {
        string id PK
        string name
        string invocation
        string description
        string projectId FK
        boolean defaultForProject
    }

    ChainNode {
        string id PK
        string agentId FK
        int x
        int y
        string label
    }

    ChainEdge {
        string id PK
        string from FK
        string to FK
    }

    AgentDefinition ||--o{ ChainNode : "referenciado por"
    AgentDefinition {
        string id PK
        string name
        string avatar
        string model
        string description
        stringArray tools
        stringArray triggers
        json permissions
        text system_prompt
    }

    Skill {
        string id PK
        string name
        string description
        stringArray tools
        text instructions
    }

    Chunk {
        string id PK
        string note_path FK
        text chunk_text
        floatArray embedding
        int chunk_index
        int total_chunks
    }

    KgEdge {
        string from FK
        string to FK
        string type
        float weight
        string relation
    }

    MemoryEntry {
        timestamp timestamp
        text text
        string source
    }

    ProjectFile {
        string path
        string name
        int size
    }

    Project |o--|| ProjectRag : "configura"
    Project ||--o{ Chunk : "indexado como"
    Chunk ||--o{ KgEdge : "genera"
```

---

## 9. Diagrama de Despliegue (Deployment)

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'fontSize': '14px' }}}%%
graph TB
    subgraph DevMachine["💻 Entorno de Desarrollo"]
        Source["📁 src/<br/>TypeScript Source"]
        Esbuild["⚡ esbuild<br/>config.mjs"]
        Vitest["🧪 Vitest<br/>unit tests"]
        PS1["📜 deploy.ps1"]
    end

    subgraph ObsidianApp["🖥️ Obsidian Desktop App"]
        subgraph PluginDir[".obsidian/plugins/sanctum-ii/"]
            MainJS["main.js<br/>(CJS bundle)"]
            StylesCSS["styles.css<br/>(~1196 lines)"]
            ManifestJSON["manifest.json"]
        end

        subgraph VaultDir["📂 Vault Root"]
            Agents["sanctum-agents/<br/>*.md (YAML frontmatter)"]
            Skills["sanctum-skills/<br/>*.md"]
            Chains["sanctum-chains/<br/>*.json"]
            Projects["sanctum-projects/<br/>*.md"]
            Memory["sanctum-memory/<br/>{projectId}/*.jsonl"]
            ThreadsLogs["sanctum-logs/threads/<br/>{projectId}/*.json"]
            TracesLogs["sanctum-logs/traces/<br/>*.json"]
            IndexLogs["sanctum-logs/index/<br/>{projectId}/vector-store.jsonl"]
            EnvFile[".env<br/>(API keys)"]
        end
    end

    subgraph ExternalAPIs["🌐 APIs Externas"]
        OpenCodeAPI["OpenCode API<br/>OpenAI-compatible<br/>(deepseek-v4-flash)"]
        GeminiAPI["Google Gemini API<br/>text-embedding-004<br/>(768 dims)"]
        TavilyAPI["Tavily Search API<br/>(web search)"]
    end

    Source --> Esbuild
    Esbuild --> MainJS
    Source --> Vitest
    PS1 --> PluginDir
    PS1 --> VaultDir

    MainJS --> Agents
    MainJS --> Skills
    MainJS --> Chains
    MainJS --> Projects
    MainJS --> Memory
    MainJS --> ThreadsLogs
    MainJS --> TracesLogs
    MainJS --> IndexLogs
    MainJS --> EnvFile

    MainJS -.->|requestUrl| OpenCodeAPI
    MainJS -.->|requestUrl| GeminiAPI
    MainJS -.->|requestUrl| TavilyAPI

    StylesCSS --> PluginDir
    ManifestJSON --> PluginDir
```

---

## 10. Resumen de Patrones Arquitectónicos

| Patrón | Implementación |
|---|---|
| **Dependency Injection** | `AppServices` actúa como contenedor DI central. `SanctumPlugin` inyecta todas las dependencias en `Object.assign()`. |
| **Plugin como Facade** | `SanctumPlugin` expone todos los servicios y delega en `ChatOrchestrator` y `runMeshWithCritic()`. |
| **Pipeline** | `executeTurn()` implementa RAG → KG → Web → Prompt → LLM como pipeline secuencial. |
| **Observer (Eventos)** | `app.vault.on("modify")` y `app.vault.on("delete")` para actualización reactiva del KG. |
| **Strategy** | Modos de layout del KG: `forceLayout` vs `convolutionalLayout`. |
| **Append-Only Log** | `VectorStore` y `KgEdgeStore` usan JSONL con append incremental. |
| **Template Method** | `renderSystemPrompt()` sustituye `{{rag_context}}`, `{{user_prompt}}`, `{{web_context}}`. |
| **Topological Sort** | `executeChain()` ordena nodos DAG antes de ejecución secuencial con scratchpad. |
| **Multi-Agent Mesh** | Forager → Researcher ↔ Critic con Orchestrator como router de decisiones. |
| **Permission Model** | Filtro de paths en dos capas: `project.read_paths` ∩ `agent.permissions.read_paths`. |

---

*Documento generado automáticamente desde el código fuente de Sanctum II. Todos los diagramas usan sintaxis Mermaid.*
