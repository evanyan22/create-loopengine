#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Template ships in `template/` next to `dist/`, not inside it — it's a
// real, buildable project (its own package.json/tsconfig), not TypeScript
// source belonging to this CLI.
const DEFAULT_TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'template')

// This CLI's own version — embedded in a scaffolded project's own
// .create-loopengine.json (see scaffold() below) as the future upgrade
// command's merge base, and used again here as the "to" version once
// upgradeProject() actually runs. Read at runtime rather than baked in
// at build time so a locally-linked/packed build always reports its own
// real package.json, not a stale constant.
function ownVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
  return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version
}

export interface ScaffoldOptions {
  name: string
  /** Defaults to `./<name>`. */
  destinationDir?: string
  templateDir?: string
}

export function scaffold(options: ScaffoldOptions): string {
  const { name } = options
  const templateDir = options.templateDir ?? DEFAULT_TEMPLATE_DIR
  const destination = options.destinationDir ?? name

  if (existsSync(destination)) {
    throw new Error(`${destination} already exists — remove it or choose a different name.`)
  }

  mkdirSync(destination, { recursive: true })
  cpSync(templateDir, destination, { recursive: true })

  // npm strips any .gitignore (even nested ones) when publishing a package,
  // so the template ships it as `_gitignore` and this renames it back —
  // same workaround create-vite/create-react-app use for the same reason.
  renameSync(join(destination, '_gitignore'), join(destination, '.gitignore'))

  const pkgPath = join(destination, 'package.json')
  const pkg = readFileSync(pkgPath, 'utf8').replace('__PROJECT_NAME__', name)
  writeFileSync(pkgPath, pkg)

  const readmePath = join(destination, 'README.md')
  const readme = readFileSync(readmePath, 'utf8').replace('__PROJECT_NAME__', name)
  writeFileSync(readmePath, readme)

  // Records which create-loopengine version this project's copied,
  // hand-editable files (adapters/http.ts, agent-registry.ts, ...) last
  // matched — the merge base `upgrade` needs to pull in template changes
  // later without clobbering whatever's been hand-edited since. Tracked
  // like package.json/lockfiles (committed, not gitignored): it's project
  // metadata, not a build artifact.
  writeFileSync(join(destination, '.create-loopengine.json'), JSON.stringify({ version: ownVersion() }, null, 2) + '\n')

  return destination
}

// ---- upgrade: pulls template improvements into an already-scaffolded
// project's own copied files (adapters/http.ts, adapters/cli.ts,
// agent-registry.ts, tsconfig.json, .gitignore) via a real three-way
// merge — the same technique `git merge`/`rebase` use, applied here
// because those files are meant to be hand-edited after scaffolding, not
// re-imported from a package the way core library code is. See
// scaffold()'s own .create-loopengine.json write above for the "base"
// version this merge starts from. ----

// templatePath is where the file lives inside a template/ directory
// (base or current); projectPath is where the *scaffolded* copy lives —
// only differs for _gitignore, which scaffold() renames to .gitignore
// (see its own comment for why the template can't ship it under that
// name directly). Deliberately narrow: agents/example-agent/** stops
// being "template" the instant someone builds a real agent on top of it,
// and package.json's own dependency versions are a separate, simpler
// `npm install loopengine@latest` left to the operator rather than
// merged here.
const UPGRADE_CANDIDATE_FILES: { templatePath: string; projectPath: string }[] = [
  { templatePath: 'adapters/http.ts', projectPath: 'adapters/http.ts' },
  { templatePath: 'adapters/cli.ts', projectPath: 'adapters/cli.ts' },
  { templatePath: 'agent-registry.ts', projectPath: 'agent-registry.ts' },
  { templatePath: 'tsconfig.json', projectPath: 'tsconfig.json' },
  { templatePath: '_gitignore', projectPath: '.gitignore' },
]

export type UpgradeFileStatus = 'updated' | 'unchanged' | 'conflict' | 'skipped'

export interface UpgradeFileResult {
  file: string
  status: UpgradeFileStatus
}

export interface UpgradeDependencyResult {
  name: string
  from: string
  to: string
}

export interface UpgradeResult {
  fromVersion: string
  toVersion: string
  files: UpgradeFileResult[]
  /** Which of loopengine/actauth/skillgarden actually had their
   * package.json range bumped — only ones already present as a
   * dependency, never newly added (see bumpDependencies's own doc
   * comment). Empty if the project has no package.json, or every present
   * one was already at the latest range. */
  dependencies: UpgradeDependencyResult[]
  /** Only attempted when `dependencies` is non-empty — running `npm
   * install` for a project with nothing to bump would be pointless. */
  npmInstall?: { ok: true } | { ok: false; error: string }
}

export interface UpgradeOptions {
  /** Defaults to process.cwd(). */
  projectDir?: string
  /** Overrides the version recorded in .create-loopengine.json — required
   * if that file is missing (a project scaffolded before this command
   * existed) or was removed. */
  from?: string
  /** Test-only override for the "current" template — defaults to this
   * CLI's own bundled template/, same as ScaffoldOptions.templateDir. */
  currentTemplateDir?: string
  /** Resolves the historical template directory for a given
   * create-loopengine version — defaults to fetchPublishedTemplateDir
   * (a real `npm pack`). Test-only seam to avoid hitting the real
   * registry for a fixture "old" template. */
  resolveBaseTemplateDir?: (version: string) => string
  /** Resolves a package's current latest version — defaults to a real
   * `npm view <pkg> version`. Test-only seam to avoid hitting the real
   * registry. */
  resolveLatestVersion?: (pkg: string) => string
  /** Runs `npm install` in projectDir — defaults to a real one. Test-only
   * seam to avoid actually installing anything during tests. */
  runNpmInstall?: (projectDir: string) => void
}

// npm keeps every published tarball forever, so the historical template
// for *any* previously-released version is always fetchable this way —
// no separate snapshot storage, no git-tag dependency. `npm pack`
// extracts to a `package/` directory inside whatever `--pack-destination`
// it's given, same as every other real-package verification already done
// this way elsewhere in this project's own test suite.
function fetchPublishedTemplateDir(version: string): string {
  const workDir = mkdtempSync(join(tmpdir(), 'create-loopengine-upgrade-base-'))
  execFileSync('npm', ['pack', `create-loopengine@${version}`, '--pack-destination', workDir], { stdio: 'pipe' })
  const tarball = readdirSync(workDir).find((f) => f.endsWith('.tgz'))
  if (!tarball) {
    throw new Error(`Could not fetch create-loopengine@${version} from npm — check the version exists and you have network access.`)
  }
  // Absolute path, not the bare filename readdirSync returns — tar
  // resolves a relative first argument against the calling process's own
  // cwd (wherever `create-loopengine upgrade` was actually run from), not
  // workDir, even with -C set (-C only affects where extraction lands).
  // Confirmed live: this failed with a wrong-directory ENOENT.
  execFileSync('tar', ['-xzf', join(workDir, tarball), '-C', workDir], { stdio: 'pipe' })
  return join(workDir, 'package', 'template')
}

// git merge-file's own exit code *is* its conflict count (0 = clean),
// not a pass/fail signal — execFileSync throws on any non-zero exit, so
// a real conflict has to be told apart from git genuinely failing to
// run (not installed, path error: no `status`, an `ENOENT`-shaped error
// instead) by checking for a numeric `status` on the caught error.
// Operates on `minePath` in place (git merge-file's own contract) — always
// called with a disposable temp copy, never the real project file
// directly, so the caller decides whether/how to apply the result.
function threeWayMerge(minePath: string, basePath: string, theirsPath: string): { merged: string; conflicted: boolean } {
  let conflicted = false
  try {
    execFileSync('git', ['merge-file', '--diff3', '-L', 'mine', '-L', 'base', '-L', 'latest', minePath, basePath, theirsPath], {
      stdio: 'pipe',
    })
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
      conflicted = true
    } else {
      throw new Error(`git merge-file failed — is git installed and on PATH? (${err instanceof Error ? err.message : String(err)})`)
    }
  }
  return { merged: readFileSync(minePath, 'utf8'), conflicted }
}

function upgradeFile(
  candidate: { templatePath: string; projectPath: string },
  baseTemplateDir: string,
  currentTemplateDir: string,
  projectDir: string,
): UpgradeFileResult {
  const projectFilePath = join(projectDir, candidate.projectPath)
  const baseFilePath = join(baseTemplateDir, candidate.templatePath)
  const theirsFilePath = join(currentTemplateDir, candidate.templatePath)

  if (!existsSync(projectFilePath) || !existsSync(baseFilePath) || !existsSync(theirsFilePath)) {
    return { file: candidate.projectPath, status: 'skipped' }
  }

  const base = readFileSync(baseFilePath, 'utf8')
  const theirs = readFileSync(theirsFilePath, 'utf8')
  if (base === theirs) {
    // The template never touched this file between the recorded version
    // and now — nothing to merge, and importantly nothing to overwrite,
    // so a hand-edit here is never even diffed against, let alone at risk.
    return { file: candidate.projectPath, status: 'unchanged' }
  }

  const mine = readFileSync(projectFilePath, 'utf8')
  const scratchDir = mkdtempSync(join(tmpdir(), 'create-loopengine-merge-'))
  const mineTmp = join(scratchDir, 'mine')
  const baseTmp = join(scratchDir, 'base')
  const theirsTmp = join(scratchDir, 'theirs')
  writeFileSync(mineTmp, mine)
  writeFileSync(baseTmp, base)
  writeFileSync(theirsTmp, theirs)

  const { merged, conflicted } = threeWayMerge(mineTmp, baseTmp, theirsTmp)
  rmSync(scratchDir, { recursive: true, force: true })

  writeFileSync(projectFilePath, merged)
  return { file: candidate.projectPath, status: conflicted ? 'conflict' : 'updated' }
}

export function upgradeProject(options: UpgradeOptions = {}): UpgradeResult {
  const projectDir = options.projectDir ?? process.cwd()
  const currentTemplateDir = options.currentTemplateDir ?? DEFAULT_TEMPLATE_DIR
  const toVersion = ownVersion()

  const provenancePath = join(projectDir, '.create-loopengine.json')
  let fromVersion = options.from
  if (!fromVersion) {
    if (!existsSync(provenancePath)) {
      throw new Error(
        `No .create-loopengine.json in ${projectDir} — this project was scaffolded before \`upgrade\` existed, or the file was removed. Pass --from <version> to specify which create-loopengine version it was originally scaffolded from.`,
      )
    }
    const provenance = JSON.parse(readFileSync(provenancePath, 'utf8')) as { version?: string }
    if (!provenance.version) {
      throw new Error(`${provenancePath} is missing its "version" field — pass --from <version> instead.`)
    }
    fromVersion = provenance.version
  }

  const resolveBase = options.resolveBaseTemplateDir ?? fetchPublishedTemplateDir
  const baseTemplateDir = resolveBase(fromVersion)

  const files = UPGRADE_CANDIDATE_FILES.map((candidate) => upgradeFile(candidate, baseTemplateDir, currentTemplateDir, projectDir))

  const resolveLatestVersion = options.resolveLatestVersion ?? resolveLatestVersionFromNpm
  const dependencies = bumpDependencies(projectDir, resolveLatestVersion)

  let npmInstall: UpgradeResult['npmInstall']
  if (dependencies.length > 0) {
    const install = options.runNpmInstall ?? runRealNpmInstall
    try {
      install(projectDir)
      npmInstall = { ok: true }
    } catch (err) {
      // Non-fatal — the file merge and the package.json bump already
      // succeeded and are on disk either way; a failed install (offline,
      // a registry hiccup) just means the operator runs `npm install`
      // themselves, the same single command this was trying to save them
      // from typing, not a reason to unwind everything already done.
      npmInstall = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  writeFileSync(provenancePath, JSON.stringify({ version: toVersion }, null, 2) + '\n')

  return { fromVersion, toVersion, files, dependencies, npmInstall }
}

function resolveLatestVersionFromNpm(pkg: string): string {
  return execFileSync('npm', ['view', pkg, 'version'], { stdio: 'pipe' }).toString().trim()
}

function runRealNpmInstall(projectDir: string): void {
  execFileSync('npm', ['install'], { cwd: projectDir, stdio: 'pipe' })
}

// Only loopengine/actauth/skillgarden — the three packages a scaffolded
// project's own adapters/http.ts can import directly (see this repo's own
// README on why: template code that imports a package must declare it as
// its own direct dependency, not rely on loopengine's transitive one) —
// and only ones already present in the project's own package.json.
// Deliberately never *adds* a dependency a project doesn't already have:
// this command upgrades what's there, it doesn't decide what a project
// should depend on.
const UPGRADABLE_DEPENDENCIES = ['loopengine', 'actauth', 'skillgarden'] as const

/** Bumps package.json's dependency ranges for whichever of
 * loopengine/actauth/skillgarden are already present, to `^<latest>` —
 * run automatically as part of `upgrade` (not left as a manual follow-up
 * step) because a project whose merged template code now calls a newer
 * export, but whose installed package is still old, fails silently: no
 * conflict marker, no build error, just a feature that's quietly not
 * there yet (confirmed live — this exact gap is what prompted adding this
 * function in the first place, see this repo's own git history). Returns
 * [] untouched if the project has no package.json at all, same
 * "can't merge what isn't there" reasoning upgradeFile's own missing-file
 * check uses. */
function bumpDependencies(projectDir: string, resolveLatestVersion: (pkg: string) => string): UpgradeDependencyResult[] {
  const pkgPath = join(projectDir, 'package.json')
  if (!existsSync(pkgPath)) return []

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string> }
  const deps = pkg.dependencies
  if (!deps) return []

  const changes: UpgradeDependencyResult[] = []
  for (const name of UPGRADABLE_DEPENDENCIES) {
    const currentRange = deps[name]
    if (currentRange === undefined) continue
    const latest = resolveLatestVersion(name)
    const newRange = `^${latest}`
    if (currentRange === newRange) continue
    deps[name] = newRange
    changes.push({ name, from: currentRange, to: newRange })
  }

  if (changes.length > 0) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  return changes
}

function parseUpgradeArgs(argv: string[]): { from?: string } {
  let from: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') from = argv[++i]
  }
  return { from }
}

function printUpgradeSummary(result: UpgradeResult): void {
  console.log(`Upgrading create-loopengine@${result.fromVersion} -> @${result.toVersion}`)
  console.log()
  for (const f of result.files) {
    const label = f.status === 'updated' ? 'updated  ' : f.status === 'conflict' ? 'conflict ' : f.status === 'unchanged' ? 'unchanged' : 'skipped  '
    console.log(`  ${label}  ${f.file}`)
  }
  console.log()
  const conflicted = result.files.filter((f) => f.status === 'conflict')
  if (conflicted.length > 0) {
    console.log(`${conflicted.length} file(s) have <<<<<<< conflict markers to resolve by hand before this will build.`)
  } else {
    console.log('No conflicts.')
  }

  if (result.dependencies.length > 0) {
    console.log()
    for (const dep of result.dependencies) console.log(`  ${dep.name}: ${dep.from} -> ${dep.to}`)
    if (result.npmInstall?.ok) {
      console.log('npm install completed.')
    } else if (result.npmInstall) {
      console.log(`npm install failed (${result.npmInstall.error}) — run it yourself to finish picking up the new versions.`)
    }
  }
}

function parseArgs(argv: string[]): { name: string } {
  return { name: argv[0] ?? 'my-agents' }
}

export function main(argv: string[] = process.argv.slice(2)): void {
  try {
    if (argv[0] === 'upgrade') {
      const { from } = parseUpgradeArgs(argv.slice(1))
      printUpgradeSummary(upgradeProject({ from }))
      return
    }
    const { name } = parseArgs(argv)
    const destination = scaffold({ name })
    console.log(`Created ${destination}/`)
    console.log()
    console.log(`  cd ${destination}`)
    console.log('  npm install')
    console.log('  cp .env.example .env   # fill in ANTHROPIC_API_KEY')
    console.log('  npm run dev')
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}

// A package-manager shim (npx, node_modules/.bin) invokes this file through
// a symlink, not its real path — process.argv[1] is the symlink's path,
// while Node resolves import.meta.url to the real path when loading an ES
// module. Comparing the raw argv[1] against the resolved module URL fails
// in exactly that case and main() silently never runs — realpath argv[1]
// first so both sides are resolved. (Same bug, same fix, as skillgarden's
// CLI — see its git history for the live symlink repro.)
function isMain(): boolean {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}
if (isMain()) main()
