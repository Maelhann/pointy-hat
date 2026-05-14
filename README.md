# Pointy Hat

Declarative, agent-agnostic AI workflow automation. Define multi-step **Spells** in YAML with built-in quality gates, bundled reference data, and one-command execution across any LLM provider.

```
pointyhat spell cast code-review --input-file main.py
```

Pointy Hat turns "I have AI tools" into "I get things done" — structured, repeatable, quality-checked outcomes without prompt engineering.

---

## Why Spells?

The AI tool ecosystem has plumbing (MCP servers that provide filesystem access, web search, database queries) but no product layer. Users write prompts from scratch, orchestrate multi-step workflows by hand, and hope the output is good enough. Every time.

**Spells close that gap.** A Spell is a declarative, shareable, multi-step AI workflow. It declares what inputs it needs, what tools it uses, what steps to follow, what quality bar to meet, and what outputs to produce. You cast it, the AI executes it, and quality gates verify the result.

| | MCP Servers | Prompt Libraries | **Spells** |
|---|---|---|---|
| Unit of sharing | Tool (capability) | Single prompt | **Multi-step workflow** |
| Quality assurance | None | None | **Wards (quality gates)** |
| Bundled context | None | None | **Catalysts (reference data)** |
| Agent integration | Direct tool install | Copy-paste | **Native MCP serving** |
| Composability | None | None | **Step DAGs with dependencies** |

---

## Installation

### Pre-built binaries (recommended)

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/Maelhann/pointy-hat/main/scripts/install.sh | bash
```

Binaries are published as GitHub Release assets for:
- macOS (Apple Silicon arm64, Intel x64)
- Linux (arm64, x64)
- Windows (x64)

No runtime dependencies. No Node.js required. Single binary, ~30-50MB.

### From source

```bash
git clone https://github.com/Maelhann/pointy-hat.git
cd pointy-hat
npm install
npm run dev -- --help
```

Requires Node.js 20+ and npm 10+. For building binaries: [Bun](https://bun.sh).

---

## Quick Start

### 1. Configure an LLM provider

Pointy Hat calls LLMs directly using your API key. No agent platform required.

```bash
pointyhat provider setup
# Interactive: pick provider, enter API key, choose model
```

Or configure directly:

```bash
pointyhat config set provider.anthropic.api_key sk-ant-api03-...
pointyhat config set provider.default anthropic
```

Supported providers: **Anthropic** (Claude), **OpenAI** (GPT-4), **Google** (Gemini), **Ollama** (local models).

### 2. Create a spell

```bash
pointyhat spell create my-review --template code-review
```

This scaffolds `my-review.spell.yaml` from a built-in template.

### 3. Cast it

```bash
pointyhat spell cast my-review --input-file src/main.py
```

Pointy Hat analyzes coverage (do you have the required inputs and tools?), executes each step via your LLM, evaluates quality gates, and writes outputs.

### 4. Or let your agent cast it

```bash
pointyhat serve
```

This starts Pointy Hat as an MCP server. Connect it to Claude Code, Cursor, or any MCP-compatible agent. The agent discovers spells, casts them using its own intelligence, and calls back to Pointy Hat for quality evaluation.

---

## The Spell Format

A Spell is a YAML file that declares everything an AI needs to produce a quality outcome:

```yaml
spell:
  name: code-review
  version: 1.0.0
  description: Thorough code review with security analysis
  author: your-name
  tags: [code, review, quality]

  # What the spell needs from the user
  inputs:
    required:
      - id: source-code
        description: The code to review
        formats: [py, ts, js, go, rs]

  # Bundled reference data that ships with the spell
  catalysts:
    - id: review-template
      description: Structured review format
      uri: catalyst://code-review/template.md
      type: template

  # MCP tools the spell uses
  requires:
    tools:
      - uri: mcp://filesystem/read_file
        reason: Read source files for analysis

  # Step-by-step execution with dependency ordering
  steps:
    - id: analyze
      instruction: >
        Read the source code and identify bugs, security vulnerabilities,
        performance issues, and style inconsistencies.
      inputs_needed: [source-code]
      tools_needed: [read_file]

    - id: review
      instruction: >
        Write a detailed review using the template. Be specific — cite
        line numbers, explain why each issue matters, suggest fixes.
      depends_on: [analyze]
      catalysts_needed: [review-template]
      quality_gate:
        criteria: Review must cite specific lines and provide actionable suggestions
        min_score: 0.8
        retry_on_failure: true

  # What the spell produces
  outputs:
    - id: review
      type: document
      format: [md]
```

### Key Concepts

| Concept | What It Is |
|---------|-----------|
| **Spell** | A declarative, multi-step AI workflow defined in YAML |
| **Inputs** | What the spell needs from the user (files, data, parameters) |
| **Catalysts** | Bundled reference material that ships with the spell (templates, style guides, datasets) |
| **Steps** | Ordered instructions with dependency graphs, each a directive for the AI |
| **Wards** | Quality gates that evaluate output against criteria and retry on failure |
| **Outputs** | What the spell produces, with format and quality specifications |
| **Casting** | Executing a spell — running all steps with ward checks |
| **Spellbook** | Your local installed collection of spells |
| **Grimoire** | The curated spell registry at pointyhat.org |

---

## Authoring Spells

### Spell Structure Reference

```yaml
spell:
  # --- Identity ---
  name: kebab-case-name           # Required. Lowercase with hyphens
  version: "1.0.0"                # Required. Semver
  description: What this spell does  # Required. One line
  author: your-username           # Required
  license: MIT                    # Optional
  tags: [tag1, tag2]              # For discovery

  card: |                         # Optional. Markdown for Grimoire listing
    ## My Spell
    Does amazing things.

  # --- Inputs ---
  inputs:
    required:
      - id: input-name            # Unique ID referenced by steps
        description: What this input is
        formats: [csv, json, txt]  # Accepted file formats
    optional:
      - id: extra-context
        description: Additional context if available
        formats: [md, txt]

  # --- Catalysts (bundled reference data) ---
  catalysts:
    - id: style-guide
      description: Coding standards to follow
      uri: catalyst://spell-name/style-guide.md   # Resolves from registry
      type: reference              # reference | template | data

  # --- Tool Requirements ---
  requires:
    tools:
      - uri: mcp://server-name/tool_name   # MCP tool URI
        reason: Why this tool is needed
        optional: true             # Won't block casting if missing

  # --- Steps (the incantation) ---
  steps:
    - id: step-one
      instruction: |
        What the AI should do in this step.
        Be specific. Reference inputs and catalysts by name.
      inputs_needed: [input-name]
      catalysts_needed: [style-guide]
      tools_needed: [tool_name]
      timeout: 120                 # Seconds

    - id: step-two
      instruction: |
        Build on step-one's output.
      depends_on: [step-one]       # Runs after step-one completes
      quality_gate:                # Ward — quality check
        criteria: |
          Must include specific examples and
          actionable recommendations.
        min_score: 0.8             # 0.0–1.0 threshold
        retry_on_failure: true
        max_retries: 2

    - id: optional-step
      instruction: Runs only if its inputs are available.
      depends_on: [step-one]
      inputs_needed: [extra-context]
      optional: true               # Skipped if inputs missing

  # --- Outputs ---
  outputs:
    - id: report
      type: document               # document | data | code | image
      format: [md, pdf]
      quality_check:
        criteria: Verify completeness and accuracy
        min_score: 0.8
        retry_on_failure: true
        max_retries: 2

  # --- Effects (postconditions) ---
  effects:
    - id: data-archived
      type: archival
      description: Raw data archived after processing
      verification: Archive record exists

  # --- Metadata ---
  metadata:
    min_pointyhat_version: "0.1.0"
    estimated_duration: 3-5 minutes
    category: finance
```

### Writing Good Steps

Steps are the core of a spell. Each step is a natural-language instruction that an AI follows.

**Be specific.** Don't say "analyze the data." Say "Extract revenue, expenses, and margins from the CSV. Calculate quarter-over-quarter changes. Use the GAAP methods catalyst for revenue recognition."

**Reference inputs and catalysts by ID.** The casting engine injects their content into the step context automatically.

**Declare dependencies.** If step B needs step A's output, add `depends_on: [step-a]`. The engine topologically sorts steps and passes prior outputs as context.

**Add quality gates where it matters.** Not every step needs a ward. Put them on steps that produce the final deliverable — the report, the analysis, the code.

### Templates

Four built-in templates to start from:

```bash
pointyhat spell create my-spell --template blank
pointyhat spell create my-review --template code-review
pointyhat spell create my-analysis --template data-analysis
pointyhat spell create my-report --template report-generation
```

### Validation

Validate syntax and semantics before publishing:

```bash
pointyhat spell validate my-spell.spell.yaml
pointyhat spell validate my-spell.spell.yaml --strict  # Warnings become errors
```

The validator checks:
- YAML syntax and Zod schema compliance
- Duplicate step/output/effect IDs
- Missing dependency references (step depends on non-existent step)
- Circular dependencies in the step graph
- Input/catalyst/tool references that don't resolve

### Security Scanning

Scan for vulnerabilities before publishing:

```bash
pointyhat quality scan my-spell.spell.yaml
```

Detects: hardcoded secrets (API keys, tokens), instruction injection patterns, data exfiltration URLs, risky shell commands.

---

## Casting Spells

### Standalone Mode (CLI)

The CLI calls your configured LLM provider directly:

```bash
# Basic cast
pointyhat spell cast quarterly-report --input-file data.csv

# Provide multiple inputs
pointyhat spell cast quarterly-report \
  --input financial-data=data.csv \
  --input company-info="Acme Corp, Q3 2025"

# Dry run — coverage analysis only, no execution
pointyhat spell cast quarterly-report --input-file data.csv --dry-run

# Run a single step
pointyhat spell cast quarterly-report --step analyze-data --input-file data.csv

# Skip quality gates
pointyhat spell cast quarterly-report --input-file data.csv --skip-wards

# Use a specific provider/model
pointyhat spell cast quarterly-report --input-file data.csv --provider openai --model gpt-4o

# Write outputs to a directory
pointyhat spell cast quarterly-report --input-file data.csv --output-dir ./reports
```

**What happens during a cast:**

1. **Coverage analysis** — Checks that all required inputs and tools are available. Reports a coverage score and warns about missing items.
2. **MCP server startup** — Starts any required MCP servers as subprocesses (stdio transport).
3. **Step execution** — Topologically sorts steps by dependencies. For each step, builds a prompt with the instruction, prior step outputs, catalyst content, and input data. Calls the LLM with attached MCP tools. The LLM executes a tool-use loop until the step completes.
4. **Ward evaluation** — After each step with a quality gate, sends the output + criteria to the LLM for scoring. If below threshold, retries with feedback.
5. **Output collection** — Writes final outputs to disk.

### Native Agent Mode (MCP Server)

For Claude Code, Cursor, or any MCP-compatible agent:

```bash
pointyhat serve
```

This starts Pointy Hat as an MCP server over stdio. The agent connects and gets:

| MCP Primitive | What Pointy Hat Exposes |
|---|---|
| **Tools** | `search_spells`, `get_spell`, `check_coverage`, `evaluate_ward` |
| **Prompts** | `cast_spell` — generates step-by-step instructions |
| **Resources** | `spell://name/version` — full spell definitions |

The agent's own LLM does the work. Pointy Hat provides the structure and quality evaluation. No API key needed — the agent IS the LLM.

**Example flow in Claude Code:**

```
User: "Cast the quarterly-report spell on my Q3 data"

Agent:
  1. search_spells("quarterly report") → finds it
  2. get_spell("quarterly-report")     → full definition
  3. check_coverage(spell, context)    → confirms inputs available
  4. cast_spell("quarterly-report")    → structured instructions
  5. Executes Step 1: analyze-data     → uses its own tools
  6. evaluate_ward("analyze-data", output, criteria) → score: 0.9, passed
  7. Executes Step 2: generate-report
  8. evaluate_ward("generate-report", output, criteria) → score: 0.85, passed
  9. Returns verified report
```

### Flat Prompt Export

For platforms with no orchestration support, degrade to a single prompt:

```bash
pointyhat spell export my-spell --format prompt
```

Concatenates all steps into one prompt. Loses quality gates and dependency guarantees, but preserves the content.

---

## Catalysts: Portable Knowledge

Catalysts are bundled reference data that ship with a Spell — templates, style guides, example datasets, formatting rules. They solve a real problem: AI workflows that depend on specific context can't just be shared as prompts. The prompt says "follow the template" but the template isn't there.

```yaml
catalysts:
  - id: style-guide
    description: Company coding standards
    uri: catalyst://code-review/style-guide.md
    type: reference     # Docs, standards, methods
  - id: report-template
    description: Review output format
    uri: catalyst://code-review/template.md
    type: template      # Formatting, structure
  - id: tax-rates
    description: Corporate tax rate tables
    uri: catalyst://quarterly-report/tax-rates-2025.json
    type: data          # Datasets, lookup tables
```

Catalysts travel with the spell through the registry, are cached locally, and are injected into step context during casting. When you publish a spell, its catalyst files are bundled and uploaded alongside the YAML.

---

## Wards: The Trust Layer

Wards are quality gates attached to individual steps. They're what make Spells trustworthy enough to run unattended.

```yaml
quality_gate:
  criteria: >
    Review must cite specific line numbers,
    explain impact of each issue,
    and suggest concrete fixes.
  min_score: 0.8
  retry_on_failure: true
  max_retries: 2
```

After a step completes, the casting engine sends the output + criteria to the LLM and asks: "Score this from 0.0 to 1.0. Explain deficiencies." If below threshold, the step retries with the feedback. This is how you get from "the AI tried" to "the AI delivered."

---

## Spellbook & Registry

### Managing Your Spellbook

```bash
# Add spells from the Grimoire
pointyhat spellbook add code-review quarterly-report

# List installed spells
pointyhat spellbook list

# Remove a spell
pointyhat spellbook remove code-review

# Sync spellbook after git pull (team workflow)
pointyhat spellbook sync
```

### Discovering Spells

```bash
# Search the Grimoire
pointyhat search "code review" --type spell
pointyhat spell search "data analysis" --category finance

# View details
pointyhat spell info quarterly-report

# Trending spells
pointyhat trending --type spell
```

### Publishing Spells

```bash
# Authenticate
pointyhat auth login

# Validate and scan
pointyhat spell validate my-spell.spell.yaml --strict
pointyhat quality scan my-spell.spell.yaml

# Publish
pointyhat publish my-spell.spell.yaml --bump minor

# Dry run first
pointyhat publish my-spell.spell.yaml --dry-run
```

Publishing validates the spell, runs a security scan, bundles catalysts with integrity hashes, and uploads to the Grimoire.

---

## MCP Integration

Pointy Hat also manages MCP server installation across agent platforms:

```bash
# Install an MCP server to your agent platform
pointyhat install @mcp/filesystem --platform cursor
pointyhat install @mcp/github --all  # All detected platforms

# List installed MCPs
pointyhat list

# Update
pointyhat update @mcp/filesystem

# Test an MCP server
pointyhat quality test @mcp/filesystem
```

### Supported Platforms

| Platform | Config Location | Auto-detected |
|----------|----------------|---------------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | Yes |
| Claude Code | `~/.claude.json` | Yes |
| Cursor | `~/.cursor/mcp.json` | Yes |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | Yes |
| VS Code + Continue | `.continue/mcpServers/*.yaml` | Yes |
| VS Code Copilot | `.vscode/mcp.json` | Yes |

---

## Configuration

### User config (`~/.pointyhat/config.yaml`)

```yaml
provider:
  default: anthropic
  anthropic:
    api_key: "${env:ANTHROPIC_API_KEY}"  # Reference env vars
    model: claude-sonnet-4-5
  openai:
    api_key: "${env:OPENAI_API_KEY}"
    model: gpt-4o
  google:
    api_key: "${env:GOOGLE_AI_API_KEY}"
    model: gemini-2.0-flash
  ollama:
    base_url: "http://localhost:11434"
    model: llama3.1

registry:
  url: https://api.pointyhat.org

defaults:
  platform: auto
  output_format: human
```

### Project config (`pointyhat.yaml`)

```yaml
platforms:
  - claude-code
  - cursor

mcps:
  "@mcp/filesystem":
    version: "^1.0.0"
  "@mcp/github":
    version: "^1.2.0"
    env:
      GITHUB_TOKEN: "${env:GITHUB_TOKEN}"

spells:
  code-review:
    version: "^1.0.0"
  quarterly-report:
    version: "2.1.0"
```

### CLI config commands

```bash
pointyhat config set <key> <value>
pointyhat config get <key>
pointyhat config list
pointyhat config delete <key>
pointyhat config reset
```

---

## Command Reference

### Core

| Command | Description |
|---------|-------------|
| `pointyhat init` | Initialize project config with platform detection |
| `pointyhat config` | Manage user and project configuration |
| `pointyhat provider setup` | Interactive LLM provider configuration |
| `pointyhat doctor` | Diagnose environment (provider, platforms, registry) |
| `pointyhat auth login` | Authenticate with the Grimoire |
| `pointyhat serve` | Start Pointy Hat as an MCP server |

### Spells

| Command | Description |
|---------|-------------|
| `pointyhat spell create [name]` | Scaffold a new spell from template |
| `pointyhat spell validate [path]` | Validate spell syntax and semantics |
| `pointyhat spell cast <spell>` | Execute a spell |
| `pointyhat spell export <spell>` | Export spell to YAML, JSON, or flat prompt |
| `pointyhat spell list` | List local and remote spells |
| `pointyhat spell search <query>` | Search the Grimoire |
| `pointyhat spell info <name>` | View detailed spell information |

### Spellbook

| Command | Description |
|---------|-------------|
| `pointyhat spellbook add <spell...>` | Add spells to your spellbook |
| `pointyhat spellbook remove <spell...>` | Remove spells |
| `pointyhat spellbook list` | List installed spells |
| `pointyhat spellbook sync` | Sync spellbook from lockfile |

### MCP Management

| Command | Description |
|---------|-------------|
| `pointyhat install <pkg...>` | Install MCP servers |
| `pointyhat uninstall <pkg...>` | Remove MCP servers |
| `pointyhat update [pkg...]` | Update to latest versions |
| `pointyhat list` | List installed MCPs |

### Discovery

| Command | Description |
|---------|-------------|
| `pointyhat search <query>` | Search the registry |
| `pointyhat info <name>` | View package details |
| `pointyhat trending` | Show trending packages |
| `pointyhat categories` | List categories |

### Quality

| Command | Description |
|---------|-------------|
| `pointyhat quality scan [path]` | Security scan for vulnerabilities |
| `pointyhat quality test <package>` | Automated MCP server testing |
| `pointyhat quality rate <package>` | Rate a package |
| `pointyhat quality verify <package>` | Check verification status |

### Publishing

| Command | Description |
|---------|-------------|
| `pointyhat publish [path]` | Publish spell to the Grimoire |
| `pointyhat unpublish <name>` | Remove from registry |
| `pointyhat version [level]` | Bump spell version |

---

## Architecture

```
src/
  index.ts                 # CLI entry point (Commander.js)
  commands/                # One file per command/group
    spell/                 # spell create, cast, validate, export, list, search, info
    spellbook/             # spellbook add, remove, list, sync
    quality/               # quality scan, test, rate, verify
    install.ts, serve.ts, config.ts, auth.ts, doctor.ts, ...
  core/
    spell-parser.ts        # YAML parsing + Zod validation + topological sort
    spell-executor.ts      # Two-phase casting engine (coverage + execution)
    coverage-analyzer.ts   # Pre-cast coverage analysis with semantic matching
    mcp-server.ts          # Pointy Hat as MCP server (native agent mode)
    mcp-subprocess.ts      # MCP server subprocess management (JSON-RPC/stdio)
    registry-client.ts     # HTTP client to api.pointyhat.org
    catalyst-resolver.ts   # Fetch and cache catalyst files
    artifact-resolver.ts   # Parse template files with inline sections
    security-scanner.ts    # Vulnerability scanning
    spellbook-manager.ts   # Local spell collection management
    config-manager.ts      # User + project config
    lockfile.ts            # Deterministic installs (pointyhat.lock)
    platform-detector.ts   # Detect installed agent platforms
    platform-writer.ts     # Write MCP configs per platform
    llm-client.ts          # Multi-provider LLM abstraction
    auth-manager.ts        # OAuth authentication
    cache.ts               # In-memory + disk cache
    error-handler.ts       # Structured errors with suggestions
  providers/
    anthropic.ts           # Claude (Sonnet, Opus, Haiku)
    openai.ts              # GPT-4o, o1, etc.
    google.ts              # Gemini
    ollama.ts              # Local models
  types/
    spell.ts               # Spell YAML Zod schemas
    config.ts, registry.ts, coverage.ts, quality.ts, ...
  ui/
    spinner.ts, table.ts, prompt.ts, colors.ts, progress.ts
  utils/
    fs.ts, yaml.ts, hash.ts, semver.ts, network.ts
tests/
  unit/                    # ~18 test suites
  fixtures/                # Sample spells, configs, templates
```

### How Casting Works

```
pointyhat spell cast quarterly-report --input-file data.csv
  │
  ├─ 1. Parse spell YAML → validate with Zod schema
  ├─ 2. Coverage analysis → match inputs + tools → score
  │     Can we cast? Required items present?
  │
  ├─ 3. Start MCP servers as subprocesses (stdio/JSON-RPC)
  │
  ├─ 4. Topological sort steps by depends_on
  │
  ├─ 5. For each step:
  │     ├─ Build prompt: instruction + prior outputs + catalysts + inputs
  │     ├─ Call LLM with MCP tools attached
  │     ├─ Tool-use loop: LLM calls tools → execute via subprocess → return results
  │     ├─ Until LLM signals completion
  │     │
  │     └─ If quality_gate defined:
  │           ├─ Send output + criteria to LLM → get score
  │           ├─ Score >= threshold? → pass, move on
  │           └─ Score < threshold? → retry with feedback (up to max_retries)
  │
  ├─ 6. Collect outputs → write to --output-dir
  └─ 7. Shut down MCP subprocesses
```

---

## Development

### Prerequisites

- Node.js 20+
- npm 10+
- [Bun](https://bun.sh) (for building binaries)

### Setup

```bash
git clone https://github.com/Maelhann/pointy-hat.git
cd pointy-hat
npm install
```

### Commands

```bash
# Run in development
npm run dev -- spell cast my-spell.spell.yaml

# Run tests
npm test

# Watch mode
npm run test:watch

# Type check
npm run lint

# Build binaries (requires Bun)
npm run build

# Build for a specific target
bun run build.ts --target=bun-darwin-arm64
```

### Build Targets

| Target | Output |
|--------|--------|
| `bun-darwin-arm64` | `dist/pointyhat-darwin-arm64` |
| `bun-darwin-x64` | `dist/pointyhat-darwin-x64` |
| `bun-linux-x64` | `dist/pointyhat-linux-x64` |
| `bun-linux-arm64` | `dist/pointyhat-linux-arm64` |
| `bun-windows-x64` | `dist/pointyhat-win-x64.exe` |

### Testing

Tests use Vitest. Fixtures are in `tests/fixtures/`.

```bash
# Run all tests
npm test

# Run a specific test file
npx vitest run tests/unit/spell-parser.test.ts

# Watch mode
npm run test:watch
```

### Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Write tests for new functionality
4. Ensure all tests pass: `npm test`
5. Ensure type checking passes: `npm run lint`
6. Submit a pull request

#### Spell Contribution Guidelines

We welcome community spells! To contribute a spell:

1. Create it with `pointyhat spell create`
2. Write clear, specific step instructions
3. Add quality gates on steps that produce final deliverables
4. Include catalysts for any reference material the spell needs
5. Validate: `pointyhat spell validate --strict`
6. Security scan: `pointyhat quality scan`
7. Test by casting it yourself with different inputs

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
