import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { scaffold } from '../src/cli.js'

const cliSourcePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts')

function makeTemplate(): string {
  const templateDir = mkdtempSync(join(tmpdir(), 'create-loopengine-template-'))
  mkdirSync(join(templateDir, 'agents'), { recursive: true })
  writeFileSync(join(templateDir, 'package.json'), JSON.stringify({ name: '__PROJECT_NAME__', private: true }))
  writeFileSync(join(templateDir, 'README.md'), '# __PROJECT_NAME__\n')
  writeFileSync(join(templateDir, 'agents', 'example-agent.ts'), 'export const config = {}\n')
  // Ships as `_gitignore`, not `.gitignore` — npm strips a real .gitignore
  // (even nested ones) when publishing, so scaffold() renames it back after
  // copying. The fixture mirrors the real template/_gitignore for that reason.
  writeFileSync(join(templateDir, '_gitignore'), 'node_modules\ndist\n')
  return templateDir
}

describe('scaffold', () => {
  it('copies the template into <destination>/ and substitutes the project name', () => {
    const templateDir = makeTemplate()
    const parent = mkdtempSync(join(tmpdir(), 'create-loopengine-dest-'))
    const destination = join(parent, 'my-agents')

    const result = scaffold({ name: 'my-agents', destinationDir: destination, templateDir })

    expect(result).toBe(destination)
    expect(existsSync(join(destination, 'agents', 'example-agent.ts'))).toBe(true)
    expect(JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8')).name).toBe('my-agents')
    expect(readFileSync(join(destination, 'README.md'), 'utf8')).toContain('# my-agents')
  })

  it('renames the template\'s _gitignore to .gitignore in the scaffolded project', () => {
    const templateDir = makeTemplate()
    const parent = mkdtempSync(join(tmpdir(), 'create-loopengine-dest-'))
    const destination = join(parent, 'my-agents')

    scaffold({ name: 'my-agents', destinationDir: destination, templateDir })

    expect(existsSync(join(destination, '_gitignore'))).toBe(false)
    expect(readFileSync(join(destination, '.gitignore'), 'utf8')).toContain('node_modules')
  })

  it('refuses to overwrite an existing destination', () => {
    const templateDir = makeTemplate()
    const parent = mkdtempSync(join(tmpdir(), 'create-loopengine-dest-'))
    const destination = join(parent, 'my-agents')
    mkdirSync(destination)

    expect(() => scaffold({ name: 'my-agents', destinationDir: destination, templateDir })).toThrow(/already exists/)
  })
})

describe('main() invoked through a symlink', () => {
  // A package-manager shim (npx, node_modules/.bin) invokes the CLI through
  // a symlink, not the real file. See skillgarden's identical bug/fix —
  // isMain() must realpath argv[1] before comparing, or main() silently
  // never runs. Regression test written up front here since that bug is
  // now a known failure mode for this exact CLI shape.
  it('still runs main() and scaffolds a project', () => {
    const binDir = mkdtempSync(join(tmpdir(), 'create-loopengine-bin-'))
    const shimPath = join(binDir, 'create-loopengine')
    symlinkSync(cliSourcePath, shimPath)

    const parent = mkdtempSync(join(tmpdir(), 'create-loopengine-dest-'))
    const destination = join(parent, 'my-agents')

    // No CLI flag overrides the template dir, so this exercises the real
    // bundled template (template/ at the repo root) rather than a fixture.
    const output = execFileSync('npx', ['tsx', shimPath, 'my-agents'], {
      encoding: 'utf8',
      cwd: parent,
    })

    expect(output).toContain('Created')
    expect(existsSync(join(destination, 'agent-registry.ts'))).toBe(true)
  })
})
