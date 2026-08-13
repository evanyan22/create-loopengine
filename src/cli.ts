#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Template ships in `template/` next to `dist/`, not inside it — it's a
// real, buildable project (its own package.json/tsconfig), not TypeScript
// source belonging to this CLI.
const DEFAULT_TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'template')

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

  const pkgPath = join(destination, 'package.json')
  const pkg = readFileSync(pkgPath, 'utf8').replace('__PROJECT_NAME__', name)
  writeFileSync(pkgPath, pkg)

  const readmePath = join(destination, 'README.md')
  const readme = readFileSync(readmePath, 'utf8').replace('__PROJECT_NAME__', name)
  writeFileSync(readmePath, readme)

  return destination
}

function parseArgs(argv: string[]): { name: string } {
  return { name: argv[0] ?? 'my-agents' }
}

export function main(argv: string[] = process.argv.slice(2)): void {
  try {
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
