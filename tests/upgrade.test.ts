import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { upgradeProject } from '../src/cli.js'

// Real create-loopengine template files are TS/JSON, but the merge logic
// (git merge-file --diff3) is text-agnostic — plain numbered lines make
// it obvious, in each assertion below, exactly which line came from
// which of the three versions.
function makeTemplateDir(httpLine3: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'create-loopengine-tpl-'))
  mkdirSync(join(dir, 'adapters'), { recursive: true })
  writeFileSync(join(dir, 'adapters', 'http.ts'), `line1\nline2\n${httpLine3}\nline4\nline5\n`)
  writeFileSync(join(dir, 'adapters', 'cli.ts'), 'cli unchanged\n')
  writeFileSync(join(dir, 'agent-registry.ts'), 'registry unchanged\n')
  writeFileSync(join(dir, 'tsconfig.json'), '{"unchanged": true}\n')
  writeFileSync(join(dir, '_gitignore'), 'node_modules\n')
  return dir
}

function makeProjectDir(fromVersion: string | undefined, httpContent: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'create-loopengine-project-'))
  mkdirSync(join(dir, 'adapters'), { recursive: true })
  writeFileSync(join(dir, 'adapters', 'http.ts'), httpContent)
  writeFileSync(join(dir, 'adapters', 'cli.ts'), 'cli unchanged\n')
  writeFileSync(join(dir, 'agent-registry.ts'), 'registry unchanged\n')
  writeFileSync(join(dir, 'tsconfig.json'), '{"unchanged": true}\n')
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n')
  if (fromVersion) {
    writeFileSync(join(dir, '.create-loopengine.json'), JSON.stringify({ version: fromVersion }))
  }
  return dir
}

describe('upgradeProject', () => {
  it('applies a clean template change verbatim when the project never touched that file', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3-updated')
    const projectDir = makeProjectDir('1.0.0', 'line1\nline2\nline3\nline4\nline5\n')

    const result = upgradeProject({ projectDir, currentTemplateDir, resolveBaseTemplateDir: () => baseTemplateDir })

    expect(result.files.find((f) => f.file === 'adapters/http.ts')).toEqual({ file: 'adapters/http.ts', status: 'updated' })
    expect(readFileSync(join(projectDir, 'adapters', 'http.ts'), 'utf8')).toBe('line1\nline2\nline3-updated\nline4\nline5\n')
  })

  it('merges cleanly, preserving a local edit in a region the template never touched', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3-updated')
    // Local edit on line1, template's own change is on line3 — no overlap.
    const projectDir = makeProjectDir('1.0.0', 'line1-mine\nline2\nline3\nline4\nline5\n')

    const result = upgradeProject({ projectDir, currentTemplateDir, resolveBaseTemplateDir: () => baseTemplateDir })

    expect(result.files.find((f) => f.file === 'adapters/http.ts')?.status).toBe('updated')
    const merged = readFileSync(join(projectDir, 'adapters', 'http.ts'), 'utf8')
    expect(merged).toContain('line1-mine')
    expect(merged).toContain('line3-updated')
  })

  it('produces real conflict markers when a local edit and the template both change the same line', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3-updated')
    const projectDir = makeProjectDir('1.0.0', 'line1\nline2\nline3-mine\nline4\nline5\n')

    const result = upgradeProject({ projectDir, currentTemplateDir, resolveBaseTemplateDir: () => baseTemplateDir })

    expect(result.files.find((f) => f.file === 'adapters/http.ts')?.status).toBe('conflict')
    const merged = readFileSync(join(projectDir, 'adapters', 'http.ts'), 'utf8')
    expect(merged).toContain('<<<<<<< mine')
    expect(merged).toContain('line3-mine')
    expect(merged).toContain('line3-updated')
    expect(merged).toContain('>>>>>>> latest')
  })

  it('leaves a file untouched (not even rewritten) when the template never changed it between versions', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3') // identical to base
    const projectDir = makeProjectDir('1.0.0', 'line1\nline2\nline3\nline4\nline5\n')

    const result = upgradeProject({ projectDir, currentTemplateDir, resolveBaseTemplateDir: () => baseTemplateDir })

    expect(result.files.find((f) => f.file === 'adapters/http.ts')?.status).toBe('unchanged')
    // agent-registry.ts/tsconfig.json/.gitignore never differ between the
    // two fixture templates either — same "unchanged" status across the board.
    expect(result.files.every((f) => f.status === 'unchanged')).toBe(true)
  })

  it('refuses without a recorded or explicit version', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3-updated')
    const projectDir = makeProjectDir(undefined, 'line1\nline2\nline3\nline4\nline5\n')

    expect(() => upgradeProject({ projectDir, currentTemplateDir, resolveBaseTemplateDir: () => baseTemplateDir })).toThrow(
      /No \.create-loopengine\.json/,
    )
  })

  it('accepts an explicit --from version when .create-loopengine.json is missing', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3-updated')
    const projectDir = makeProjectDir(undefined, 'line1\nline2\nline3\nline4\nline5\n')

    const result = upgradeProject({ projectDir, currentTemplateDir, from: '1.0.0', resolveBaseTemplateDir: () => baseTemplateDir })

    expect(result.fromVersion).toBe('1.0.0')
  })

  it('rewrites .create-loopengine.json to this CLI\'s own current version afterward', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3-updated')
    const projectDir = makeProjectDir('1.0.0', 'line1\nline2\nline3\nline4\nline5\n')

    const result = upgradeProject({ projectDir, currentTemplateDir, resolveBaseTemplateDir: () => baseTemplateDir })

    const provenance = JSON.parse(readFileSync(join(projectDir, '.create-loopengine.json'), 'utf8'))
    expect(provenance.version).toBe(result.toVersion)
    expect(result.toVersion).not.toBe('1.0.0')
  })

  it('merges .gitignore against the template\'s own _gitignore (the scaffold-time rename)', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3')
    writeFileSync(join(currentTemplateDir, '_gitignore'), 'node_modules\ndist\n')
    const projectDir = makeProjectDir('1.0.0', 'line1\nline2\nline3\nline4\nline5\n')

    const result = upgradeProject({ projectDir, currentTemplateDir, resolveBaseTemplateDir: () => baseTemplateDir })

    expect(result.files.find((f) => f.file === '.gitignore')?.status).toBe('updated')
    expect(readFileSync(join(projectDir, '.gitignore'), 'utf8')).toBe('node_modules\ndist\n')
    expect(existsSync(join(projectDir, '_gitignore'))).toBe(false)
  })

  it('skips a file missing from the project entirely, without throwing', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3-updated')
    const projectDir = makeProjectDir('1.0.0', 'line1\nline2\nline3\nline4\nline5\n')
    // Simulate a project that deleted agent-registry.ts entirely.
    rmSync(join(projectDir, 'agent-registry.ts'))

    const result = upgradeProject({ projectDir, currentTemplateDir, resolveBaseTemplateDir: () => baseTemplateDir })

    expect(result.files.find((f) => f.file === 'agent-registry.ts')?.status).toBe('skipped')
  })
})

describe('upgradeProject dependency bumps', () => {
  it('bumps loopengine/actauth/skillgarden ranges to ^<latest> when present, leaves other deps and package.json untouched otherwise, and runs npm install', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3')
    const projectDir = makeProjectDir('1.0.0', 'line1\nline2\nline3\nline4\nline5\n')
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({ dependencies: { loopengine: '^0.1.6', actauth: '^0.0.12', 'some-other-package': '^1.0.0' } }),
    )
    const installCalls: string[] = []

    const result = upgradeProject({
      projectDir,
      currentTemplateDir,
      resolveBaseTemplateDir: () => baseTemplateDir,
      resolveLatestVersion: (pkg) => (pkg === 'loopengine' ? '0.1.7' : '0.0.13'),
      runNpmInstall: (dir) => installCalls.push(dir),
    })

    expect(result.dependencies).toEqual([
      { name: 'loopengine', from: '^0.1.6', to: '^0.1.7' },
      { name: 'actauth', from: '^0.0.12', to: '^0.0.13' },
    ])
    expect(result.npmInstall).toEqual({ ok: true })
    expect(installCalls).toEqual([projectDir])
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
    expect(pkg.dependencies).toEqual({ loopengine: '^0.1.7', actauth: '^0.0.13', 'some-other-package': '^1.0.0' })
  })

  it('never adds a dependency the project did not already have', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3')
    const projectDir = makeProjectDir('1.0.0', 'line1\nline2\nline3\nline4\nline5\n')
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: { loopengine: '^0.1.6' } }))

    const result = upgradeProject({
      projectDir,
      currentTemplateDir,
      resolveBaseTemplateDir: () => baseTemplateDir,
      resolveLatestVersion: () => '0.1.7',
      runNpmInstall: () => {},
    })

    expect(result.dependencies).toEqual([{ name: 'loopengine', from: '^0.1.6', to: '^0.1.7' }])
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
    expect(pkg.dependencies).toEqual({ loopengine: '^0.1.7' })
    expect('actauth' in pkg.dependencies).toBe(false)
  })

  it('does not run npm install when nothing needed bumping', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3')
    const projectDir = makeProjectDir('1.0.0', 'line1\nline2\nline3\nline4\nline5\n')
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: { loopengine: '^0.1.7' } }))
    let installCalled = false

    const result = upgradeProject({
      projectDir,
      currentTemplateDir,
      resolveBaseTemplateDir: () => baseTemplateDir,
      resolveLatestVersion: () => '0.1.7', // already current
      runNpmInstall: () => {
        installCalled = true
      },
    })

    expect(result.dependencies).toEqual([])
    expect(result.npmInstall).toBeUndefined()
    expect(installCalled).toBe(false)
  })

  it('reports a failed npm install without throwing — the file merge and package.json bump already succeeded', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3')
    const projectDir = makeProjectDir('1.0.0', 'line1\nline2\nline3\nline4\nline5\n')
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: { loopengine: '^0.1.6' } }))

    const result = upgradeProject({
      projectDir,
      currentTemplateDir,
      resolveBaseTemplateDir: () => baseTemplateDir,
      resolveLatestVersion: () => '0.1.7',
      runNpmInstall: () => {
        throw new Error('offline')
      },
    })

    expect(result.npmInstall).toEqual({ ok: false, error: 'offline' })
    // The bump itself still landed on disk despite the install failing.
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
    expect(pkg.dependencies.loopengine).toBe('^0.1.7')
  })

  it('is a no-op, with no npm install, for a project with no package.json at all', () => {
    const baseTemplateDir = makeTemplateDir('line3')
    const currentTemplateDir = makeTemplateDir('line3')
    const projectDir = makeProjectDir('1.0.0', 'line1\nline2\nline3\nline4\nline5\n')
    let installCalled = false

    const result = upgradeProject({
      projectDir,
      currentTemplateDir,
      resolveBaseTemplateDir: () => baseTemplateDir,
      resolveLatestVersion: () => '0.1.7',
      runNpmInstall: () => {
        installCalled = true
      },
    })

    expect(result.dependencies).toEqual([])
    expect(installCalled).toBe(false)
  })
})
