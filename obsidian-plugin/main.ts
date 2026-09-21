/**
 * Vault Market for Obsidian.
 *
 * A vault you bought is installed into a folder of your own vault and updated in place. No zip,
 * no re-download, and — the part that matters — an update never overwrites a note you edited.
 *
 * How the merge works. At install the plugin records, per file, the hash of the body as the
 * seller shipped it: the *base*. On an update there are three hashes per path:
 *
 *   base    what the seller shipped last time      (settings, per install)
 *   local   what is in your vault right now        (hashed off disk)
 *   remote  what the seller ships today            (GET /sync/vaults/:id/manifest)
 *
 *   remote == base                  the seller did not touch it        -> nothing happens
 *   local  == base, remote differs  you never touched it               -> overwritten, safely
 *   local  == remote                you already have their version     -> nothing happens
 *   both differ                     you and the seller both edited it  -> conflict: their version
 *                                                                        is written beside yours
 *                                                                        as "<name> (v2 from
 *                                                                        seller).md" and yours is
 *                                                                        left exactly as it is
 *   in base, gone from remote       the seller deleted it              -> deleted if you never
 *                                                                        edited it, otherwise kept
 *
 * Bodies are fetched only for the paths that actually changed, so updating a 400-note vault
 * costs one manifest and a handful of notes.
 */
import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, SuggestModal, normalizePath, requestUrl } from 'obsidian';

/* ---------- settings ---------- */

interface Install {
  vaultId: string;
  title: string;
  folder: string;
  version: string;
  /** path -> hash of the body as the seller shipped it. The base of every later merge. */
  files: Record<string, string>;
  syncedAt: string;
}

interface Settings {
  apiUrl: string;
  token: string;
  installs: Record<string, Install>;
}

const DEFAULT_SETTINGS: Settings = {
  apiUrl: 'http://localhost:4000',
  token: '',
  installs: {},
};

/* ---------- the API ---------- */

interface RemoteVault {
  id: string;
  title: string;
  tagline: string;
  version: string;
  noteCount: number;
  entryNote: string | null;
  updatedAt: string;
}

interface Manifest {
  vaultId: string;
  title: string;
  version: string;
  entryNote: string | null;
  updatedAt: string;
  files: { path: string; hash: string; sizeBytes: number }[];
}

/* ---------- the merge ---------- */

type Verdict =
  | 'create' // new file from the seller
  | 'update' // changed upstream, untouched here
  | 'conflict' // changed in both places; theirs lands beside yours
  | 'delete' // dropped upstream, untouched here
  | 'kept' // dropped upstream but you had edited it
  | 'missing' // changed upstream but you had deleted it here
  | 'unchanged';

interface Step {
  path: string;
  verdict: Verdict;
}

const NEEDS_BODY: Verdict[] = ['create', 'update', 'conflict'];

/** sha-256 hex of a string: the same hash the server stores for the bytes it holds. */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** "Templates/Daily.md" -> "Templates/Daily (v2 from seller).md" */
function sidecarPath(path: string, version: string): string {
  const dot = path.lastIndexOf('.');
  const cut = dot > path.lastIndexOf('/') ? dot : path.length;
  return `${path.slice(0, cut)} (v${version} from seller)${path.slice(cut)}`;
}

function summarise(steps: Step[]): string {
  const n = (v: Verdict) => steps.filter((s) => s.verdict === v).length;
  const bits = [
    n('create') && `${n('create')} new`,
    n('update') && `${n('update')} updated`,
    n('conflict') && `${n('conflict')} conflict${n('conflict') > 1 ? 's' : ''}`,
    n('delete') && `${n('delete')} removed`,
    n('kept') && `${n('kept')} kept`,
    n('missing') && `${n('missing')} skipped`,
  ].filter(Boolean);
  return bits.length ? bits.join(', ') : 'already up to date';
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ---------- the plugin ---------- */

export default class VaultMarketPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.addRibbonIcon('download', 'Vault Market: install or update a vault', () => void this.pickAndSync());
    this.addCommand({ id: 'install-or-update', name: 'Install or update a vault', callback: () => void this.pickAndSync() });
    this.addCommand({ id: 'update-all', name: 'Update every installed vault', callback: () => void this.updateAll() });
    this.addSettingTab(new VaultMarketSettingTab(this.app, this));
  }

  save(): Promise<void> {
    return this.saveData(this.settings);
  }

  /* ----- API ----- */

  private async call<T>(path: string, body?: unknown): Promise<T> {
    if (!this.settings.token) throw new Error('No token yet. Paste one from the Connect page into the plugin settings.');
    const res = await requestUrl({
      url: `${this.settings.apiUrl.replace(/\/+$/, '')}${path}`,
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${this.settings.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      throw: false,
    });
    if (res.status >= 400) throw new Error(res.json?.error ?? `Vault Market returned ${res.status}`);
    return res.json as T;
  }

  listOwned(): Promise<RemoteVault[]> {
    return this.call<RemoteVault[]>('/sync/vaults');
  }

  /* ----- commands ----- */

  private async pickAndSync(): Promise<void> {
    try {
      const vaults = await this.listOwned();
      if (!vaults.length) {
        new Notice('No vaults to install yet. Buy or grab a free one on Vault Market.');
        return;
      }
      new VaultPicker(this.app, vaults, this.settings.installs, (vault) => void this.startSync(vault)).open();
    } catch (e) {
      new Notice(`Vault Market: ${message(e)}`, 8000);
    }
  }

  private async startSync(vault: RemoteVault): Promise<void> {
    const install = this.settings.installs[vault.id];
    if (install) return this.sync(vault, install.folder);
    const suggestion = vault.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'Vault';
    new FolderPrompt(this.app, vault.title, suggestion, (folder) => void this.sync(vault, folder)).open();
  }

  private async updateAll(): Promise<void> {
    const installs = Object.values(this.settings.installs);
    if (!installs.length) {
      new Notice('Nothing installed yet.');
      return;
    }
    try {
      const owned = new Map((await this.listOwned()).map((v) => [v.id, v]));
      for (const install of installs) {
        const vault = owned.get(install.vaultId);
        if (vault) await this.sync(vault, install.folder, true);
      }
      new Notice('Vault Market: every installed vault checked.');
    } catch (e) {
      new Notice(`Vault Market: ${message(e)}`, 8000);
    }
  }

  /* ----- install and update ----- */

  async sync(vault: RemoteVault, folder: string, quiet = false): Promise<void> {
    const notice = new Notice(`Vault Market: checking ${vault.title}…`, 0);
    try {
      const manifest = await this.call<Manifest>(`/sync/vaults/${vault.id}/manifest`);
      const steps = await this.plan(manifest, folder);
      const changed = steps.filter((s) => s.verdict !== 'unchanged');
      if (!changed.length) {
        notice.hide();
        if (!quiet) new Notice(`${vault.title} is already up to date.`);
        return;
      }
      notice.setMessage(`Vault Market: writing ${changed.length} file${changed.length > 1 ? 's' : ''}…`);
      await this.apply(manifest, folder, steps);
      this.settings.installs[vault.id] = {
        vaultId: vault.id,
        title: manifest.title,
        folder,
        version: manifest.version,
        // The new base: what the seller ships today, whatever happened to your copy of it.
        files: Object.fromEntries(manifest.files.map((f) => [f.path, f.hash])),
        syncedAt: new Date().toISOString(),
      };
      await this.save();
      notice.hide();
      new ReportModal(this.app, manifest, folder, changed).open();
    } catch (e) {
      notice.hide();
      new Notice(`Vault Market: ${message(e)}`, 8000);
    }
  }

  /** Decides what happens to every path, without writing anything. See the header comment. */
  private async plan(manifest: Manifest, folder: string): Promise<Step[]> {
    const base = this.settings.installs[manifest.vaultId]?.files ?? {};
    const steps: Step[] = [];

    for (const file of manifest.files) {
      const local = await this.hashLocal(folder, file.path);
      const baseHash = base[file.path];
      let verdict: Verdict;
      if (local === file.hash) verdict = 'unchanged';
      else if (baseHash === undefined) verdict = local === null ? 'create' : 'conflict';
      else if (baseHash === file.hash) verdict = 'unchanged'; // the seller left it alone, so yours stands
      else if (local === null) verdict = 'missing';
      else if (local === baseHash) verdict = 'update';
      else verdict = 'conflict';
      steps.push({ path: file.path, verdict });
    }

    const remote = new Set(manifest.files.map((f) => f.path));
    for (const [path, baseHash] of Object.entries(base)) {
      if (remote.has(path)) continue;
      const local = await this.hashLocal(folder, path);
      if (local === null) continue;
      steps.push({ path, verdict: local === baseHash ? 'delete' : 'kept' });
    }
    return steps;
  }

  private async apply(manifest: Manifest, folder: string, steps: Step[]): Promise<void> {
    const wanted = steps.filter((s) => NEEDS_BODY.includes(s.verdict)).map((s) => s.path);
    const bodies = new Map<string, string>();
    for (let i = 0; i < wanted.length; i += 200) {
      const batch = wanted.slice(i, i + 200);
      const res = await this.call<{ files: { path: string; content: string }[] }>(`/sync/vaults/${manifest.vaultId}/files`, { paths: batch });
      for (const f of res.files) bodies.set(f.path, f.content);
    }

    const adapter = this.app.vault.adapter;
    for (const step of steps) {
      const target = this.target(folder, step.path);
      if (step.verdict === 'delete') {
        await adapter.remove(target).catch(() => undefined);
        continue;
      }
      if (!NEEDS_BODY.includes(step.verdict)) continue;
      const body = bodies.get(step.path);
      if (body === undefined) continue; // the seller dropped it between the manifest and the fetch
      const write = step.verdict === 'conflict' ? this.target(folder, sidecarPath(step.path, manifest.version)) : target;
      await this.ensureFolder(write.slice(0, write.lastIndexOf('/')));
      await adapter.write(write, body);
    }
  }

  /* ----- disk ----- */

  target(folder: string, path: string): string {
    return normalizePath(folder ? `${folder}/${path}` : path);
  }

  private async hashLocal(folder: string, path: string): Promise<string | null> {
    const target = this.target(folder, path);
    if (!(await this.app.vault.adapter.exists(target))) return null;
    return sha256(await this.app.vault.adapter.read(target));
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!folder) return;
    let walked = '';
    for (const part of folder.split('/').filter(Boolean)) {
      walked = walked ? `${walked}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(walked))) await this.app.vault.adapter.mkdir(walked);
    }
  }
}

/* ---------- modals ---------- */

class VaultPicker extends SuggestModal<RemoteVault> {
  constructor(
    app: App,
    private vaults: RemoteVault[],
    private installs: Record<string, Install>,
    private onPick: (vault: RemoteVault) => void
  ) {
    super(app);
    this.setPlaceholder('Which vault?');
  }

  getSuggestions(query: string): RemoteVault[] {
    const q = query.toLowerCase();
    return this.vaults.filter((v) => v.title.toLowerCase().includes(q) || v.tagline.toLowerCase().includes(q));
  }

  renderSuggestion(vault: RemoteVault, el: HTMLElement): void {
    const install = this.installs[vault.id];
    el.createEl('div', { text: vault.title });
    el.createEl('small', {
      text: !install
        ? `${vault.noteCount} notes · v${vault.version}`
        : install.version === vault.version
          ? `installed in ${install.folder || 'vault root'} · v${install.version}`
          : `installed in ${install.folder || 'vault root'} · v${install.version} -> v${vault.version}`,
    });
  }

  onChooseSuggestion(vault: RemoteVault): void {
    this.onPick(vault);
  }
}

class FolderPrompt extends Modal {
  private folder: string;

  constructor(
    app: App,
    private vaultTitle: string,
    suggestion: string,
    private onConfirm: (folder: string) => void
  ) {
    super(app);
    this.folder = suggestion;
  }

  onOpen(): void {
    this.titleEl.setText(`Install ${this.vaultTitle}`);
    this.contentEl.createEl('p', {
      text: 'The vault is written into this folder, and later updates go to the same place. Pick one you will not move.',
    });
    new Setting(this.contentEl).setName('Folder').addText((t) =>
      t.setValue(this.folder).onChange((v) => {
        this.folder = v;
      })
    );
    new Setting(this.contentEl).addButton((b) =>
      b
        .setButtonText('Install')
        .setCta()
        .onClick(() => {
          this.close();
          this.onConfirm(normalizePath(this.folder.trim()));
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class ReportModal extends Modal {
  constructor(
    app: App,
    private manifest: Manifest,
    private folder: string,
    private steps: Step[]
  ) {
    super(app);
  }

  onOpen(): void {
    const heading: Record<Verdict, string> = {
      create: 'Added',
      update: 'Updated',
      conflict: 'You and the seller both edited these. Their version is beside yours; nothing of yours was touched.',
      delete: 'Removed by the seller',
      kept: 'The seller removed these, but you had edited them, so they stayed',
      missing: 'Changed by the seller, but you had deleted them here',
      unchanged: '',
    };
    this.titleEl.setText(`${this.manifest.title} · v${this.manifest.version}`);
    this.contentEl.createEl('p', { text: `${summarise(this.steps)} in ${this.folder || 'the vault root'}.` });
    for (const verdict of ['conflict', 'create', 'update', 'delete', 'kept', 'missing'] as Verdict[]) {
      const paths = this.steps.filter((s) => s.verdict === verdict).map((s) => s.path);
      if (!paths.length) continue;
      this.contentEl.createEl('h4', { text: heading[verdict] });
      const list = this.contentEl.createEl('ul');
      for (const path of paths.slice(0, 50)) {
        list.createEl('li', { text: verdict === 'conflict' ? sidecarPath(path, this.manifest.version) : path });
      }
      if (paths.length > 50) list.createEl('li', { text: `… and ${paths.length - 50} more` });
    }
    if (this.manifest.entryNote) this.contentEl.createEl('p', { text: `Start here: ${this.manifest.entryNote}` });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/* ---------- settings ---------- */

class VaultMarketSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: VaultMarketPlugin
  ) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName('API URL')
      .setDesc('Shown on the Connect page of the site.')
      .addText((t) =>
        t.setValue(this.plugin.settings.apiUrl).onChange(async (v) => {
          this.plugin.settings.apiUrl = v.trim();
          await this.plugin.save();
        })
      );

    new Setting(this.containerEl)
      .setName('Access token')
      .setDesc('Generate one on the Connect page. It is read-only over the vaults you own.')
      .addText((t) => {
        t.inputEl.type = 'password';
        t.setPlaceholder('paste your token')
          .setValue(this.plugin.settings.token)
          .onChange(async (v) => {
            this.plugin.settings.token = v.trim();
            await this.plugin.save();
          });
      });

    const installs = Object.values(this.plugin.settings.installs);
    if (!installs.length) return;

    new Setting(this.containerEl).setName('Installed vaults').setHeading();
    for (const install of installs) {
      new Setting(this.containerEl)
        .setName(install.title)
        .setDesc(`${install.folder || 'vault root'} · v${install.version} · ${Object.keys(install.files).length} files`)
        .addButton((b) =>
          b.setButtonText('Forget').onClick(async () => {
            // Leaves every file where it is. Only the merge base goes, so a later install starts fresh.
            delete this.plugin.settings.installs[install.vaultId];
            await this.plugin.save();
            this.display();
          })
        );
    }
  }
}
