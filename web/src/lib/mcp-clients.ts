/**
 * How to point each MCP client at /mcp, as data the Connect page renders.
 *
 * The server speaks Streamable HTTP and authenticates with a static `Authorization: Bearer`
 * header. Most clients take that header directly; the one thing that differs is the key names
 * (`url` / `httpUrl` / `serverUrl`, `type: "http"` / `"remote"` / `"streamableHttp"`, and a
 * `servers` or `mcpServers` root). Clients that only accept OAuth for remote servers (Claude
 * Desktop's Connectors screen, JetBrains AI Assistant) get the mcp-remote stdio bridge instead;
 * the hosted web apps can run neither and are listed as unsupported rather than left out.
 *
 * Verified against each client's own docs in September 2026. When a client changes its format,
 * change it here.
 */

export type McpGroup = 'Anthropic' | 'OpenAI' | 'Editors' | 'Terminal agents' | 'Desktop apps' | 'Anything else';

export const MCP_GROUPS: McpGroup[] = ['Anthropic', 'OpenAI', 'Editors', 'Terminal agents', 'Desktop apps', 'Anything else'];

export type McpTarget = { url: string; token: string };

export type McpClient = {
  id: string;
  label: string;
  group: McpGroup;
  /** One line on where to go in the client, when there is a UI route worth naming. */
  steps?: string;
  /** Official one-liner, when the client ships an `mcp add` command. */
  cli?: (t: McpTarget) => string;
  /** Where the config snippet goes, most common first. */
  files?: string[];
  config?: (t: McpTarget) => string;
  /** One-click install. Carries the token, so the page offers it only once a real one exists. */
  install?: (t: McpTarget) => { href: string; label: string };
  note?: string;
  /** Can't reach a header-authenticated server at all; `note` says why and what to use instead. */
  unsupported?: boolean;
};

const NAME = 'vault-market';

const json = (o: unknown) => JSON.stringify(o, null, 2);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const header = (token: string) => `--header "Authorization: Bearer ${token}"`;
const b64 = (o: unknown) => encodeURIComponent(btoa(JSON.stringify(o)));

/**
 * Stdio bridge for clients that cannot send a header to a remote server. The header is passed
 * through an env var with no space after the colon, as mcp-remote's README asks: some clients
 * and Windows split arguments on spaces.
 */
const bridge = ({ url, token }: McpTarget) => ({
  command: 'npx',
  args: ['-y', 'mcp-remote', url, '--transport', 'http-only', '--header', 'Authorization:${AUTH_HEADER}'],
  env: { AUTH_HEADER: `Bearer ${token}` },
});

export const MCP_CLIENTS: McpClient[] = [
  /* ---------- Anthropic ---------- */
  {
    id: 'claude-code',
    label: 'Claude Code',
    group: 'Anthropic',
    cli: ({ url, token }) => `claude mcp add --transport http ${NAME} ${url} ${header(token)} --scope user`,
    files: ['~/.claude.json (user)', '.mcp.json (project, shared with your repo)'],
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { type: 'http', url, headers: auth(token) } } }),
    note: 'Run the command once and every project on this machine can use it. Check it with /mcp inside a session.',
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    group: 'Anthropic',
    steps: 'Settings → Developer → Edit Config, paste this in, then restart Claude.',
    files: ['macOS: ~/Library/Application Support/Claude/claude_desktop_config.json', 'Windows: %APPDATA%\\Claude\\claude_desktop_config.json'],
    config: (t) => json({ mcpServers: { [NAME]: bridge(t) } }),
    note: 'The config file only runs local servers, and the Connectors screen only does OAuth, so this runs the small mcp-remote bridge through npx. It needs Node.js 18 or newer.',
  },
  {
    id: 'web-apps',
    label: 'claude.ai & ChatGPT (web)',
    group: 'Anthropic',
    unsupported: true,
    note: 'Custom connectors in claude.ai and ChatGPT developer mode sign in with OAuth only; neither can send a personal token. Use Claude Desktop, Claude Code or Codex for now.',
  },

  /* ---------- OpenAI ---------- */
  {
    id: 'codex',
    label: 'Codex',
    group: 'OpenAI',
    steps: 'One file serves the Codex CLI, the IDE extension and the desktop app (Settings → MCP servers there shows it too).',
    files: ['~/.codex/config.toml', '.codex/config.toml (trusted projects)'],
    config: ({ url, token }) => `[mcp_servers.${NAME}]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${token}" }`,
    cli: ({ url }) => `codex mcp add ${NAME} --url ${url} --bearer-token-env-var VAULT_MARKET_TOKEN`,
    note: 'The command keeps the token out of the file: it reads VAULT_MARKET_TOKEN from your environment, so set that in your shell profile first.',
  },

  /* ---------- Editors ---------- */
  {
    id: 'cursor',
    label: 'Cursor',
    group: 'Editors',
    install: ({ url, token }) => ({
      href: `cursor://anysphere.cursor-deeplink/mcp/install?name=${NAME}&config=${b64({ url, headers: auth(token) })}`,
      label: 'Add to Cursor',
    }),
    files: ['~/.cursor/mcp.json (global)', '.cursor/mcp.json (project)'],
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { url, headers: auth(token) } } }),
  },
  {
    id: 'vscode',
    label: 'VS Code (Copilot)',
    group: 'Editors',
    install: ({ url, token }) => ({
      href: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: NAME, type: 'http', url, headers: auth(token) }))}`,
      label: 'Add to VS Code',
    }),
    steps: 'Or run “MCP: Open User Configuration” and paste this. VS Code asks for the token on first start and keeps it in its secret store.',
    files: ['User mcp.json (via the command above)', '.vscode/mcp.json (workspace)'],
    config: ({ url }) =>
      json({
        inputs: [{ type: 'promptString', id: 'vault-market-token', description: 'Vault Market token', password: true }],
        servers: { [NAME]: { type: 'http', url, headers: { Authorization: 'Bearer ${input:vault-market-token}' } } },
      }),
  },
  {
    id: 'devin',
    label: 'Windsurf / Devin Desktop',
    group: 'Editors',
    files: ['macOS/Linux: ~/.config/devin/mcp_config.json', 'Windows: %APPDATA%\\devin\\mcp_config.json', 'Older Windsurf installs: ~/.codeium/windsurf/mcp_config.json'],
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { serverUrl: url, headers: auth(token) } } }),
    note: 'Refresh the server list in the Cascade panel after saving.',
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    group: 'Editors',
    files: ['~/.gemini/config/mcp_config.json (global)', '.agents/mcp_config.json (workspace)'],
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { serverUrl: url, headers: auth(token) } } }),
    note: 'The key must be serverUrl, not url.',
  },
  {
    id: 'kiro',
    label: 'Kiro',
    group: 'Editors',
    install: ({ url, token }) => ({
      href: `https://kiro.dev/launch/mcp/add?name=${NAME}&config=${encodeURIComponent(JSON.stringify({ url, headers: auth(token) }))}`,
      label: 'Add to Kiro',
    }),
    files: ['~/.kiro/settings/mcp.json (user)', '.kiro/settings/mcp.json (workspace)'],
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { url, headers: auth(token) } } }),
  },
  {
    id: 'zed',
    label: 'Zed',
    group: 'Editors',
    steps: 'Run “zed: open settings file” and merge this in.',
    files: ['Zed settings.json', '.zed/settings.json (project)'],
    config: ({ url, token }) => json({ context_servers: { [NAME]: { url, headers: auth(token) } } }),
  },
  {
    id: 'cline',
    label: 'Cline',
    group: 'Editors',
    steps: 'In the Cline panel: MCP Servers → Configure → Configure MCP Servers.',
    files: ['cline_mcp_settings.json (extension)', '~/.cline/mcp.json (CLI)'],
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { type: 'streamableHttp', url, headers: auth(token), disabled: false } } }),
  },
  {
    id: 'roo',
    label: 'Roo Code',
    group: 'Editors',
    files: ['mcp_settings.json (global, from the MCP panel)', '.roo/mcp.json (project)'],
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { type: 'streamable-http', url, headers: auth(token) } } }),
  },
  {
    id: 'kilo',
    label: 'Kilo Code',
    group: 'Editors',
    files: ['~/.config/kilo/kilo.jsonc (global)', 'kilo.jsonc (project)'],
    config: ({ url, token }) => json({ mcp: { [NAME]: { type: 'remote', url, headers: auth(token), enabled: true } } }),
  },
  {
    id: 'junie',
    label: 'Junie',
    group: 'Editors',
    files: ['~/.junie/mcp/mcp.json (user)', '.junie/mcp/mcp.json (project)'],
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { url, headers: auth(token) } } }),
  },
  {
    id: 'jetbrains-ai',
    label: 'JetBrains AI Assistant',
    group: 'Editors',
    steps: 'Settings → Tools → AI Assistant → Model Context Protocol → Add, then paste this.',
    config: (t) => json({ mcpServers: { [NAME]: bridge(t) } }),
    note: 'AI Assistant does not document custom headers for remote servers, so this goes through the mcp-remote bridge (needs Node.js 18+).',
  },

  /* ---------- Terminal agents ---------- */
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    group: 'Terminal agents',
    cli: ({ url, token }) => `gemini mcp add --transport http ${header(token)} --scope user ${NAME} ${url}`,
    files: ['~/.gemini/settings.json (user)', '.gemini/settings.json (project)'],
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { httpUrl: url, headers: auth(token) } } }),
    note: 'httpUrl, not url: in Gemini CLI plain url means the older SSE transport.',
  },
  {
    id: 'copilot-cli',
    label: 'GitHub Copilot CLI',
    group: 'Terminal agents',
    cli: ({ url, token }) => `copilot mcp add --transport http ${header(token)} ${NAME} ${url}`,
    files: ['~/.copilot/mcp-config.json'],
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { type: 'http', url, headers: auth(token), tools: ['*'] } } }),
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    group: 'Terminal agents',
    files: ['~/.config/opencode/opencode.json (global)', 'opencode.json (project)'],
    config: ({ url, token }) => json({ mcp: { [NAME]: { type: 'remote', url, enabled: true, headers: auth(token), oauth: false } } }),
    note: 'oauth: false stops OpenCode from trying to sign in when the header is already there.',
  },
  {
    id: 'amp',
    label: 'Amp',
    group: 'Terminal agents',
    files: ['~/.config/amp/settings.json (user)', '.amp/settings.json (workspace)'],
    config: ({ url, token }) => json({ 'amp.mcpServers': { [NAME]: { url, headers: auth(token) } } }),
  },
  {
    id: 'qwen-code',
    label: 'Qwen Code',
    group: 'Terminal agents',
    cli: ({ url, token }) => `qwen mcp add --scope user --transport http ${NAME} ${url} ${header(token)}`,
    files: ['~/.qwen/settings.json (user)', '.qwen/settings.json (project)'],
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { httpUrl: url, headers: auth(token) } } }),
  },
  {
    id: 'droid',
    label: 'Factory Droid',
    group: 'Terminal agents',
    cli: ({ url, token }) => `droid mcp add ${NAME} ${url} --type http ${header(token)}`,
    files: ['~/.factory/mcp.json (user)', '.factory/mcp.json (project)'],
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { type: 'http', url, headers: auth(token) } } }),
  },
  {
    id: 'auggie',
    label: 'Augment (Auggie)',
    group: 'Terminal agents',
    cli: ({ url, token }) => `auggie mcp add ${NAME} --transport http --url ${url} --header "Authorization:Bearer ${token}"`,
    files: ['~/.augment/settings.json'],
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { type: 'http', url, headers: auth(token) } } }),
  },
  {
    id: 'warp',
    label: 'Warp',
    group: 'Terminal agents',
    steps: 'Settings → Agents → MCP servers → Add, or save it to a file.',
    files: ['~/.warp/.mcp.json (global)', '.warp/.mcp.json (project)'],
    config: ({ url, token }) => json({ [NAME]: { url, headers: auth(token) } }),
    note: 'Warp also picks up servers you have already added to Claude Code or Codex.',
  },

  /* ---------- Desktop apps ---------- */
  {
    id: 'lm-studio',
    label: 'LM Studio',
    group: 'Desktop apps',
    install: ({ url, token }) => ({
      href: `lmstudio://add_mcp?name=${NAME}&config=${b64({ url, headers: auth(token) })}`,
      label: 'Add to LM Studio',
    }),
    steps: 'Or Program → Install → Edit mcp.json, and paste this.',
    config: ({ url, token }) => json({ mcpServers: { [NAME]: { url, headers: auth(token) } } }),
  },

  /* ---------- Anything else ---------- */
  {
    id: 'other',
    label: 'Another client',
    group: 'Anything else',
    steps: 'Any client that speaks Streamable HTTP and lets you set a header works with the endpoint and header below. If it only runs local (stdio) servers, use the bridge snippet instead.',
    config: ({ url, token }) => `URL:    ${url}\nHeader: Authorization: Bearer ${token}\n\n// stdio-only clients:\n${json({ mcpServers: { [NAME]: bridge({ url, token }) } })}`,
  },
];
