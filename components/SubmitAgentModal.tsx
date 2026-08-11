import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  FileCode,
  Github,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import TagManager from '@/components/TagManager'
import {
  AgentDraft,
  CatalogEntry,
  DESCRIPTION_MAX_LENGTH,
  DraftIssue,
  DraftTool,
  EMPTY_DRAFT,
  MEMORY_POLICIES,
  PROVIDER_TYPES,
  REASONING_LEVELS,
  REASONING_STRATEGIES,
  STATE_STORAGES,
  ToolCatalog,
  buildGithubBlankFileUrl,
  buildGithubNewFileUrl,
  buildTemplateYaml,
  isUrlWithinLimit,
  slugifyName,
  templatePath,
  validateDraft,
} from '@/lib/submit-agent'

const DRAFT_STORAGE_KEY = 'submit-agent-draft'

interface SubmitAgentModalProps {
  isOpen: boolean
  onClose: () => void
  categories: string[]
  frameworks: string[]
  tags: string[]
  agentNames: string[]
  existingSlugs: string[]
  catalog: ToolCatalog
}

function catalogToDraftTool(entry: CatalogEntry): DraftTool {
  const type = (PROVIDER_TYPES as readonly string[]).includes(entry.provider.type)
    ? (entry.provider.type as DraftTool['provider']['type'])
    : 'Community'

  return {
    name: entry.name,
    description: entry.description,
    provider: { name: entry.provider.name, type, url: entry.provider.url || '' },
  }
}

function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium mb-1.5">
        {label}
        {hint && <span className="ml-2 text-xs font-normal text-muted-foreground">{hint}</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}

const inputClass =
  'w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary'

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border pb-6 mb-6 last:border-0 last:mb-0 last:pb-0">
      <h3 className="text-base font-semibold mb-1">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mb-4">{description}</p>}
      <div className={description ? '' : 'mt-4'}>{children}</div>
    </section>
  )
}

/** Repeatable single-line list (prompt examples, hints). */
function StringList({
  values,
  onChange,
  placeholder,
  addLabel,
}: {
  values: string[]
  onChange: (values: string[]) => void
  placeholder: string
  addLabel: string
}) {
  return (
    <div className="space-y-2">
      {values.map((value, index) => (
        <div key={index} className="flex gap-2">
          <input
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={e => onChange(values.map((v, i) => (i === index ? e.target.value : v)))}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => onChange(values.filter((_, i) => i !== index))}
            disabled={values.length === 1}
            className="p-2 text-muted-foreground hover:text-red-500 disabled:opacity-30 disabled:hover:text-muted-foreground transition-colors"
            title="Remove"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, ''])}
        className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        {addLabel}
      </button>
    </div>
  )
}

/** Catalog picker plus a custom entry form, shared by tools and MCP servers. */
function ToolPicker({
  label,
  entries,
  selected,
  onChange,
}: {
  label: string
  entries: CatalogEntry[]
  selected: DraftTool[]
  onChange: (tools: DraftTool[]) => void
}) {
  const [query, setQuery] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [custom, setCustom] = useState<DraftTool>({
    name: '',
    description: '',
    provider: { name: '', type: 'Community', url: '' },
  })

  const selectedNames = useMemo(() => new Set(selected.map(t => t.name.toLowerCase())), [selected])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return entries.slice(0, 40)
    return entries
      .filter(e => e.name.toLowerCase().includes(needle) || e.provider.name.toLowerCase().includes(needle))
      .slice(0, 40)
  }, [entries, query])

  const toggle = (entry: CatalogEntry) => {
    if (selectedNames.has(entry.name.toLowerCase())) {
      onChange(selected.filter(t => t.name.toLowerCase() !== entry.name.toLowerCase()))
    } else {
      onChange([...selected, catalogToDraftTool(entry)])
    }
  }

  const addCustom = () => {
    if (!custom.name.trim() || !custom.description.trim() || !custom.provider.name.trim()) return
    if (selectedNames.has(custom.name.trim().toLowerCase())) return
    onChange([...selected, custom])
    setCustom({ name: '', description: '', provider: { name: '', type: 'Community', url: '' } })
    setShowCustom(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium">
          {label}
          {selected.length > 0 && <span className="ml-2 text-xs text-muted-foreground">{selected.length} selected</span>}
        </h4>
        <button
          type="button"
          onClick={() => setShowCustom(v => !v)}
          className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Custom
        </button>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(tool => (
            <span
              key={tool.name}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-primary/10 text-primary rounded-md border border-primary/20"
            >
              {tool.name}
              <button
                type="button"
                onClick={() => onChange(selected.filter(t => t.name !== tool.name))}
                className="hover:bg-primary/20 rounded p-0.5"
                title={`Remove ${tool.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {showCustom && (
        <div className="p-3 mb-2 bg-muted/50 border border-border rounded-md space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={custom.name}
              onChange={e => setCustom({ ...custom, name: e.target.value })}
              placeholder="tool_name"
              className={inputClass}
            />
            <input
              type="text"
              value={custom.provider.name}
              onChange={e => setCustom({ ...custom, provider: { ...custom.provider, name: e.target.value } })}
              placeholder="Provider name"
              className={inputClass}
            />
          </div>
          <input
            type="text"
            value={custom.description}
            onChange={e => setCustom({ ...custom, description: e.target.value })}
            placeholder="What it does"
            className={inputClass}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={custom.provider.type}
              onChange={e =>
                setCustom({
                  ...custom,
                  provider: { ...custom.provider, type: e.target.value as DraftTool['provider']['type'] },
                })
              }
              className={inputClass}
            >
              {PROVIDER_TYPES.map(type => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              type="url"
              value={custom.provider.url}
              onChange={e => setCustom({ ...custom, provider: { ...custom.provider, url: e.target.value } })}
              placeholder="https://github.com/..."
              className={inputClass}
            />
          </div>
          <button
            type="button"
            onClick={addCustom}
            className="w-full px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            Add
          </button>
        </div>
      )}

      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}...`}
          className={cn(inputClass, 'pl-8')}
        />
      </div>

      <div className="max-h-52 overflow-y-auto border border-border rounded-md divide-y divide-border">
        {visible.map(entry => {
          const isSelected = selectedNames.has(entry.name.toLowerCase())
          return (
            <button
              key={entry.name}
              type="button"
              onClick={() => toggle(entry)}
              className={cn(
                'w-full flex items-start gap-2 p-2 text-left hover:bg-muted transition-colors',
                isSelected && 'bg-primary/5'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center',
                  isSelected ? 'bg-primary border-primary' : 'border-border'
                )}
              >
                {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate">{entry.name}</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {entry.provider.name} · used by {entry.usageCount}
                </span>
              </span>
            </button>
          )
        })}
        {visible.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground text-center">
            Nothing matches — add it with “Custom”.
          </p>
        )}
      </div>
    </div>
  )
}

export default function SubmitAgentModal({
  isOpen,
  onClose,
  categories,
  frameworks,
  tags,
  agentNames,
  existingSlugs,
  catalog,
}: SubmitAgentModalProps) {
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT)
  const [view, setView] = useState<'form' | 'yaml'>('form')
  const [showErrors, setShowErrors] = useState(false)
  const [copied, setCopied] = useState(false)
  const [tooLong, setTooLong] = useState(false)
  const [newCategory, setNewCategory] = useState(false)
  const [customFramework, setCustomFramework] = useState('')

  // A half-filled template is a lot of typing to lose to a stray Escape or a
  // reloaded tab, so the draft outlives both.
  useEffect(() => {
    if (!isOpen) return
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (saved) setDraft({ ...EMPTY_DRAFT, ...JSON.parse(saved) })
    } catch {
      // A corrupt draft is not worth blocking the form over.
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft))
      } catch {
        // Private mode or a full quota — the form still works.
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [draft, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  const update = useCallback(<K extends keyof AgentDraft>(key: K, value: AgentDraft[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }))
  }, [])

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const yamlText = useMemo(() => buildTemplateYaml(draft, today), [draft, today])
  const issues = useMemo(() => validateDraft(draft, existingSlugs), [draft, existingSlugs])
  const issueFor = (field: DraftIssue['field']) =>
    showErrors ? issues.find(i => i.field === field)?.message : undefined

  const path = draft.category && draft.name ? templatePath(draft) : ''

  const handleSubmit = () => {
    setShowErrors(true)
    if (issues.length > 0) {
      document.getElementById('submit-agent-body')?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    const url = buildGithubNewFileUrl(path, yamlText)
    if (!isUrlWithinLimit(url)) {
      setTooLong(true)
      setView('yaml')
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(yamlText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const handleDownload = () => {
    const blob = new Blob([yamlText], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${slugifyName(draft.name) || 'agent'}.yaml`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    setDraft(EMPTY_DRAFT)
    setShowErrors(false)
    setTooLong(false)
    setNewCategory(false)
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY)
    } catch {
      // Nothing to clean up.
    }
  }

  const toggleFramework = (framework: string) => {
    update(
      'frameworks',
      draft.frameworks.includes(framework)
        ? draft.frameworks.filter(f => f !== framework)
        : [...draft.frameworks, framework]
    )
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-5xl max-h-[92vh] bg-card border border-border rounded-lg shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-2xl font-bold mb-1">Add Your Agent</h2>
            <p className="text-sm text-muted-foreground">
              Fill this in and we hand GitHub a ready-made pull request — fork, branch and file included.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-muted rounded-md p-0.5">
              {(['form', 'yaml'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setView(tab)}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium rounded transition-colors',
                    view === tab ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tab === 'form' ? 'Form' : 'YAML'}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div id="submit-agent-body" className="flex-1 overflow-y-auto p-6">
          {showErrors && issues.length > 0 && (
            <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-md">
              <p className="flex items-center gap-2 text-sm font-medium text-red-500 mb-1">
                <AlertCircle className="w-4 h-4" />
                {issues.length} thing{issues.length > 1 ? 's' : ''} to fix before this can be submitted
              </p>
              <ul className="text-xs text-red-500/90 list-disc list-inside space-y-0.5">
                {issues.map((issue, index) => (
                  <li key={index}>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}

          {tooLong && (
            <div className="mb-6 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-sm">
              <p className="font-medium text-amber-600 dark:text-amber-500 mb-1">
                This template is too large to hand over through a link.
              </p>
              <p className="text-muted-foreground">
                Copy the YAML below (or download it), then open{' '}
                <a
                  href={buildGithubBlankFileUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  a blank file on GitHub
                </a>
                , name it <code className="text-xs">{path}</code> and paste it in. The rest of the flow is the same.
              </p>
            </div>
          )}

          {view === 'yaml' ? (
            <pre className="p-4 bg-muted rounded-md text-xs font-mono overflow-x-auto whitespace-pre">
              {yamlText}
            </pre>
          ) : (
            <>
              <Section
                title="Identity"
                description="The card people see in the library. Category comes from the folder, so it never appears in the YAML itself."
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field
                    label="Agent name"
                    hint={path ? path : 'becomes the file name'}
                    error={issueFor('name')}
                  >
                    <input
                      type="text"
                      value={draft.name}
                      onChange={e => update('name', e.target.value)}
                      placeholder="Web Search Agent"
                      className={inputClass}
                    />
                  </Field>

                  <Field label="Category" hint="the folder it lands in" error={issueFor('category')}>
                    {newCategory ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={draft.category}
                          onChange={e => update('category', e.target.value)}
                          placeholder="New category name"
                          className={inputClass}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setNewCategory(false)
                            update('category', '')
                          }}
                          className="p-2 text-muted-foreground hover:text-foreground"
                          title="Pick an existing category instead"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <select
                        value={draft.category}
                        onChange={e => {
                          if (e.target.value === '__new__') {
                            setNewCategory(true)
                            update('category', '')
                          } else {
                            update('category', e.target.value)
                          }
                        }}
                        className={inputClass}
                      >
                        <option value="">Select a category…</option>
                        {categories.map(category => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                        <option value="__new__">+ New category…</option>
                      </select>
                    )}
                  </Field>

                  <Field
                    label="Description"
                    hint={`${draft.description.trim().length}/${DESCRIPTION_MAX_LENGTH}`}
                    error={issueFor('description')}
                    className="md:col-span-2"
                  >
                    <textarea
                      value={draft.description}
                      onChange={e => update('description', e.target.value)}
                      rows={2}
                      placeholder="Searches the web, cross-checks sources and returns cited summaries."
                      className={cn(
                        inputClass,
                        'resize-y',
                        draft.description.trim().length > DESCRIPTION_MAX_LENGTH && 'border-red-500'
                      )}
                    />
                  </Field>

                  <Field label="Purpose" hint="one line" error={issueFor('purpose')}>
                    <input
                      type="text"
                      value={draft.purpose}
                      onChange={e => update('purpose', e.target.value)}
                      placeholder="Find and verify information on the web"
                      className={inputClass}
                    />
                  </Field>

                  <Field label="GitHub username" error={issueFor('author')}>
                    <input
                      type="text"
                      value={draft.author}
                      onChange={e => update('author', e.target.value)}
                      placeholder="your-username"
                      className={inputClass}
                    />
                  </Field>

                  <Field label="License">
                    <input
                      type="text"
                      value={draft.license}
                      onChange={e => update('license', e.target.value)}
                      className={inputClass}
                    />
                  </Field>

                  <Field label="Tags" hint="how people find it" error={issueFor('tags')}>
                    <TagManager
                      selectedTags={draft.tags}
                      availableTags={tags}
                      onTagsChange={value => update('tags', value)}
                      placeholder="Search or add a tag..."
                    />
                  </Field>
                </div>
              </Section>

              <Section title="Prompt" description="The instructions that make the agent behave the way you want.">
                <Field label="System prompt" error={issueFor('systemPrompt')}>
                  <textarea
                    value={draft.systemPrompt}
                    onChange={e => update('systemPrompt', e.target.value)}
                    rows={12}
                    placeholder={'You are an expert research agent.\n\nCORE RESPONSIBILITIES:\n- ...'}
                    className={cn(inputClass, 'font-mono text-xs resize-y')}
                  />
                </Field>

                <div className="mt-4">
                  <Field label="Example prompts" hint="what a user would type">
                    <StringList
                      values={draft.promptExamples}
                      onChange={value => update('promptExamples', value)}
                      placeholder="Find the latest research on..."
                      addLabel="Add example"
                    />
                  </Field>
                </div>
              </Section>

              <Section
                title="Tools & MCP servers"
                description="Pick from what the library already references, or add your own."
              >
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <ToolPicker
                    label="Tools"
                    entries={catalog.tools}
                    selected={draft.tools}
                    onChange={value => update('tools', value)}
                  />
                  <ToolPicker
                    label="MCP servers"
                    entries={catalog.mcpServers}
                    selected={draft.mcpServers}
                    onChange={value => update('mcpServers', value)}
                  />
                </div>
                {(issueFor('tools') || issueFor('mcpServers')) && (
                  <p className="mt-2 text-xs text-red-500">{issueFor('tools') || issueFor('mcpServers')}</p>
                )}
              </Section>

              <Section title="Settings">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Field label="Reasoning level">
                    <select
                      value={draft.reasoningLevel}
                      onChange={e => update('reasoningLevel', e.target.value)}
                      className={inputClass}
                    >
                      {REASONING_LEVELS.map(level => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Reasoning strategy">
                    <select
                      value={draft.reasoningStrategy}
                      onChange={e => update('reasoningStrategy', e.target.value)}
                      className={inputClass}
                    >
                      {REASONING_STRATEGIES.map(strategy => (
                        <option key={strategy} value={strategy}>
                          {strategy}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Memory policy">
                    <select
                      value={draft.memoryPolicy}
                      onChange={e => update('memoryPolicy', e.target.value)}
                      className={inputClass}
                    >
                      {MEMORY_POLICIES.map(policy => (
                        <option key={policy} value={policy}>
                          {policy}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="State storage">
                    <select
                      value={draft.stateStorage}
                      onChange={e => update('stateStorage', e.target.value)}
                      className={inputClass}
                    >
                      {STATE_STORAGES.map(storage => (
                        <option key={storage} value={storage}>
                          {storage}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </Section>

              <Section title="Hints & metadata">
                <Field label="Hints" hint="pro tips shown with the template">
                  <StringList
                    values={draft.hints}
                    onChange={value => update('hints', value)}
                    placeholder="Always verify sources before acting on them"
                    addLabel="Add hint"
                  />
                </Field>

                <div className="mt-4">
                  <Field label="Compatible frameworks" error={issueFor('frameworks')}>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {Array.from(new Set([...frameworks, ...draft.frameworks])).map(framework => (
                        <button
                          key={framework}
                          type="button"
                          onClick={() => toggleFramework(framework)}
                          className={cn(
                            'px-3 py-1.5 text-sm rounded-full border transition-colors',
                            draft.frameworks.includes(framework)
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-card border-border hover:bg-muted'
                          )}
                        >
                          {framework}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customFramework}
                        onChange={e => setCustomFramework(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && customFramework.trim()) {
                            e.preventDefault()
                            toggleFramework(customFramework.trim())
                            setCustomFramework('')
                          }
                        }}
                        placeholder="Another framework, then Enter"
                        className={inputClass}
                      />
                    </div>
                  </Field>
                </div>

                <div className="mt-4">
                  <Field label="Related agents" hint="optional">
                    <div className="flex flex-wrap gap-1.5">
                      {agentNames.map(name => (
                        <button
                          key={name}
                          type="button"
                          onClick={() =>
                            update(
                              'relatedAgents',
                              draft.relatedAgents.includes(name)
                                ? draft.relatedAgents.filter(a => a !== name)
                                : [...draft.relatedAgents, name]
                            )
                          }
                          className={cn(
                            'px-2.5 py-1 text-xs rounded-full border transition-colors',
                            draft.relatedAgents.includes(name)
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-card border-border hover:bg-muted'
                          )}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>
              </Section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-t border-border bg-card">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {issues.length === 0 ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                Passes the same checks as CI
              </>
            ) : (
              <>
                <FileCode className="w-3.5 h-3.5" />
                {issues.length} field{issues.length > 1 ? 's' : ''} left
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-md hover:bg-muted transition-colors"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-md hover:bg-muted transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy YAML'}
            </button>
            <button
              onClick={handleSubmit}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              <Github className="w-4 h-4" />
              Open pull request
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
