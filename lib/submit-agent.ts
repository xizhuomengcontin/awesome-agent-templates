// Everything the "Add Your Agent" form needs to turn a filled-in draft into a
// pull request: YAML serialization, the same checks scripts/validate-templates.js
// runs in CI, and the GitHub prefill URL that opens the PR.
//
// Kept free of React and of `@/` imports so it can be exercised directly by
// scripts/test-submit-agent.js without a bundler.

export const SUBMIT_REPO = 'samitugal/awesome-agent-templates'
export const SUBMIT_BRANCH = 'master'

// GitHub serves the prefilled editor over GET, so the whole draft rides in the
// query string. Long system prompts blow past what the request line allows, and
// the failure mode is an opaque 414 — the form falls back to copy/download
// before we get there.
export const GITHUB_URL_LIMIT = 7000

export const REASONING_LEVELS = ['none', 'optional', 'recommended', 'mandatory'] as const
export const REASONING_STRATEGIES = ['react', 'chain-of-thought', 'tree-of-thought', 'reflection'] as const
export const MEMORY_POLICIES = ['none', 'short-term', 'long-term'] as const
export const STATE_STORAGES = ['in-memory', 'local', 'remote'] as const
export const PROVIDER_TYPES = ['Official', 'Community', 'Custom'] as const

export const DESCRIPTION_MAX_LENGTH = 150

export interface DraftProvider {
  name: string
  type: (typeof PROVIDER_TYPES)[number]
  url: string
}

export interface DraftTool {
  name: string
  description: string
  provider: DraftProvider
}

export interface AgentDraft {
  name: string
  description: string
  purpose: string
  author: string
  category: string
  tags: string[]
  license: string
  systemPrompt: string
  promptExamples: string[]
  tools: DraftTool[]
  mcpServers: DraftTool[]
  reasoningLevel: string
  reasoningStrategy: string
  memoryPolicy: string
  stateStorage: string
  hints: string[]
  relatedAgents: string[]
  frameworks: string[]
}

export const EMPTY_DRAFT: AgentDraft = {
  name: '',
  description: '',
  purpose: '',
  author: '',
  category: '',
  tags: [],
  license: 'MIT',
  systemPrompt: '',
  promptExamples: [''],
  tools: [],
  mcpServers: [],
  reasoningLevel: 'recommended',
  reasoningStrategy: 'chain-of-thought',
  memoryPolicy: 'short-term',
  stateStorage: 'in-memory',
  hints: [''],
  relatedAgents: [],
  frameworks: [],
}

// Mirrors slugify() in lib/utils.ts. The two must agree: the site resolves an
// agent page by slugify(identity.name) and then fetches the YAML at
// /templates/<category>/<slug>.yaml, so a file named anything else 404s.
export function slugifyName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function templatePath(draft: AgentDraft): string {
  return `templates/${draft.category.trim()}/${slugifyName(draft.name)}.yaml`
}

function quote(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return `"${collapsed.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function inlineList(values: string[]): string {
  const cleaned = values.map(v => v.trim()).filter(Boolean)
  if (cleaned.length === 0) return '[]'
  return `[${cleaned.map(quote).join(', ')}]`
}

function blockList(values: string[], indent: string): string[] {
  return values
    .map(v => v.trim())
    .filter(Boolean)
    .map(v => `${indent}- ${quote(v)}`)
}

function leadingSpaces(line: string): number {
  return line.length - line.replace(/^ +/, '').length
}

/**
 * Renders the prompt as a block scalar, which keeps it readable and verbatim in
 * the diff.
 *
 * Two details the naive version gets wrong. Pasted prompts usually carry the
 * indentation of wherever they were copied from, so the common prefix is
 * stripped. And YAML takes the block's indentation from its *first* non-empty
 * line: if that line is deeper than a later one, the later line silently
 * terminates the scalar and the file no longer parses. When that happens the
 * header gets an explicit indentation indicator (`|2` — spaces relative to the
 * parent key) so the first line stops being load-bearing.
 */
function blockScalar(text: string, indent: string, parentIndent: string): { header: string; lines: string[] } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/^\s*\n/, '').trimEnd()
  const rawLines = normalized.split('\n').map(line => line.trimEnd())
  const contentLines = rawLines.filter(line => line.trim() !== '')

  const commonIndent = contentLines.length
    ? Math.min(...contentLines.map(leadingSpaces))
    : 0
  const dedented = rawLines.map(line => (line.trim() === '' ? '' : line.slice(commonIndent)))

  const firstContent = dedented.find(line => line.trim() !== '') ?? ''
  const indicator = leadingSpaces(firstContent) > 0 ? String(indent.length - parentIndent.length) : ''

  return {
    header: `|${indicator}`,
    lines: dedented.map(line => (line === '' ? '' : `${indent}${line}`)),
  }
}

function toolBlock(tool: DraftTool, indent: string): string[] {
  const lines = [
    `${indent}- name: ${quote(tool.name)}`,
    `${indent}  description: ${quote(tool.description)}`,
    `${indent}  provider:`,
    `${indent}    name: ${quote(tool.provider.name)}`,
    `${indent}    type: ${quote(tool.provider.type)}`,
  ]
  if (tool.provider.url.trim()) {
    lines.push(`${indent}    url: ${quote(tool.provider.url)}`)
  }
  return lines
}

/**
 * Serializes a draft in the same hand-written shape as the templates already in
 * the repo, so a reviewer reads a diff that matches its neighbours.
 *
 * `today` is injected rather than read from the clock so the output is
 * reproducible in tests.
 */
export function buildTemplateYaml(draft: AgentDraft, today: string): string {
  const lines: string[] = []

  lines.push('identity:')
  lines.push(`  name: ${quote(draft.name)}`)
  lines.push(`  description: ${quote(draft.description)}`)
  lines.push(`  purpose: ${quote(draft.purpose)}`)
  lines.push(`  author: ${quote(draft.author)}`)
  lines.push(`  tags: ${inlineList(draft.tags)}`)
  lines.push(`  license: ${quote(draft.license)}`)
  // No `category` on purpose — it is assigned from the folder name.
  lines.push('')

  lines.push('prompt:')
  const prompt = blockScalar(draft.systemPrompt, '    ', '  ')
  lines.push(`  system_prompt: ${prompt.header}`)
  lines.push(...prompt.lines)
  const examples = blockList(draft.promptExamples, '    ')
  if (examples.length > 0) {
    lines.push('  user_prompt_examples:')
    lines.push(...examples)
  }
  lines.push('')

  const tools = draft.tools.filter(t => t.name.trim())
  const mcpServers = draft.mcpServers.filter(t => t.name.trim())
  if (tools.length > 0 || mcpServers.length > 0) {
    lines.push('tools:')
    if (tools.length > 0) {
      lines.push('  recommended_tools:')
      tools.forEach(tool => lines.push(...toolBlock(tool, '    ')))
    }
    if (mcpServers.length > 0) {
      lines.push('  recommended_mcp_servers:')
      mcpServers.forEach(server => lines.push(...toolBlock(server, '    ')))
    }
    lines.push('')
  }

  lines.push('settings:')
  lines.push(`  reasoning_level: ${quote(draft.reasoningLevel)}`)
  lines.push(`  reasoning_strategy: ${quote(draft.reasoningStrategy)}`)
  lines.push(`  memory_policy: ${quote(draft.memoryPolicy)}`)
  lines.push(`  state_storage: ${quote(draft.stateStorage)}`)
  lines.push('')

  const hints = blockList(draft.hints, '  ')
  if (hints.length > 0) {
    lines.push('hints:')
    lines.push(...hints)
    lines.push('')
  }

  lines.push('metadata:')
  lines.push('  template_version: "1.0.0"')
  lines.push(`  last_updated: ${quote(today)}`)
  lines.push('  schema_compatibility: "v1.0"')
  lines.push(`  related_agents: ${inlineList(draft.relatedAgents)}`)
  lines.push(`  compatible_frameworks: ${inlineList(draft.frameworks)}`)
  lines.push(`  author: ${quote(`https://github.com/${draft.author.trim().replace(/^@/, '')}`)}`)

  return lines.join('\n') + '\n'
}

export interface DraftIssue {
  field: keyof AgentDraft | 'category'
  message: string
}

/**
 * The same rules scripts/validate-templates.js enforces in CI, applied while
 * the contributor is still typing. Anything that would fail the merge check is
 * an error here, so a submitted PR is green on arrival.
 */
export function validateDraft(draft: AgentDraft, existingSlugs: string[] = []): DraftIssue[] {
  const issues: DraftIssue[] = []
  const required: Array<[keyof AgentDraft, string]> = [
    ['name', 'Name is required'],
    ['description', 'Description is required'],
    ['purpose', 'Purpose is required'],
    ['author', 'GitHub username is required'],
    ['license', 'License is required'],
    ['systemPrompt', 'System prompt is required'],
  ]

  required.forEach(([field, message]) => {
    if (!String(draft[field] ?? '').trim()) issues.push({ field, message })
  })

  if (!draft.category.trim()) {
    issues.push({ field: 'category', message: 'Pick a category — it becomes the folder name' })
  } else if (/[\\/]/.test(draft.category)) {
    issues.push({ field: 'category', message: 'Category cannot contain slashes' })
  }

  if (draft.name.trim() && !slugifyName(draft.name)) {
    issues.push({ field: 'name', message: 'Name needs at least one letter or number' })
  }

  if (draft.name.trim() && existingSlugs.includes(slugifyName(draft.name))) {
    issues.push({ field: 'name', message: 'An agent with this name already exists' })
  }

  if (draft.description.trim().length > DESCRIPTION_MAX_LENGTH) {
    issues.push({
      field: 'description',
      message: `Description is ${draft.description.trim().length} characters — the limit is ${DESCRIPTION_MAX_LENGTH}`,
    })
  }

  if (draft.tags.filter(t => t.trim()).length === 0) {
    issues.push({ field: 'tags', message: 'Add at least one tag so the agent is searchable' })
  }

  if (draft.frameworks.filter(f => f.trim()).length === 0) {
    issues.push({ field: 'frameworks', message: 'List at least one compatible framework' })
  }

  const enums: Array<[keyof AgentDraft, readonly string[]]> = [
    ['reasoningLevel', REASONING_LEVELS],
    ['reasoningStrategy', REASONING_STRATEGIES],
    ['memoryPolicy', MEMORY_POLICIES],
    ['stateStorage', STATE_STORAGES],
  ]
  enums.forEach(([field, allowed]) => {
    if (!allowed.includes(String(draft[field]))) {
      issues.push({ field, message: `Must be one of: ${allowed.join(', ')}` })
    }
  })

  const incompleteTool = draft.tools.find(t => t.name.trim() && (!t.description.trim() || !t.provider.name.trim()))
  if (incompleteTool) {
    issues.push({ field: 'tools', message: `"${incompleteTool.name}" needs a description and a provider` })
  }

  const incompleteServer = draft.mcpServers.find(
    t => t.name.trim() && (!t.description.trim() || !t.provider.name.trim())
  )
  if (incompleteServer) {
    issues.push({ field: 'mcpServers', message: `"${incompleteServer.name}" needs a description and a provider` })
  }

  return issues
}

/**
 * GitHub's prefilled new-file editor. For a visitor without write access this
 * lands on "you're editing in a project you don't have write access to" — it
 * forks, commits to a branch and opens the PR form, all on GitHub's side, so
 * the site needs no token and no backend.
 */
export function buildGithubNewFileUrl(path: string, content: string): string {
  const params = new URLSearchParams({ filename: path, value: content })
  return `https://github.com/${SUBMIT_REPO}/new/${SUBMIT_BRANCH}?${params.toString()}`
}

export function buildGithubBlankFileUrl(): string {
  return `https://github.com/${SUBMIT_REPO}/new/${SUBMIT_BRANCH}`
}

export function isUrlWithinLimit(url: string): boolean {
  return url.length <= GITHUB_URL_LIMIT
}

export interface CatalogEntry {
  name: string
  description: string
  provider: { name: string; type: string; url?: string }
  usageCount: number
}

export interface ToolCatalog {
  tools: CatalogEntry[]
  mcpServers: CatalogEntry[]
}

// Structural shape of the tool entries carried by a template, kept local so
// this module stays free of imports.
interface CatalogItem {
  name: string
  description?: string
  provider?: { name: string; type: string; url?: string }
}

interface CatalogSource {
  tools?: {
    recommended_tools?: CatalogItem[]
    recommended_mcp_servers?: CatalogItem[]
  }
}

/**
 * Every tool and MCP server the library already references, deduplicated by
 * name and ranked by how many templates use it, so the form can offer them as a
 * picklist instead of asking each contributor to retype a provider URL.
 *
 * Derived from the templates the page already holds rather than shipped as its
 * own prop — the same data twice would have cost ~30 kB of page payload.
 */
export function buildToolCatalog(agents: CatalogSource[]): ToolCatalog {
  const collect = (pick: (agent: CatalogSource) => CatalogItem[] | undefined): CatalogEntry[] => {
    const byName = new Map<string, CatalogEntry>()

    for (const agent of agents) {
      for (const item of pick(agent) || []) {
        if (!item?.name || !item.provider?.name) continue

        const key = String(item.name).toLowerCase()
        const existing = byName.get(key)
        if (existing) {
          existing.usageCount += 1
          continue
        }

        byName.set(key, {
          name: item.name,
          description: item.description || '',
          provider: { name: item.provider.name, type: item.provider.type, url: item.provider.url },
          usageCount: 1,
        })
      }
    }

    return Array.from(byName.values()).sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name))
  }

  return {
    tools: collect(agent => agent.tools?.recommended_tools),
    mcpServers: collect(agent => agent.tools?.recommended_mcp_servers),
  }
}
