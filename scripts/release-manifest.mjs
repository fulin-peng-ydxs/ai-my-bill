import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const [sourceCommit, jarPath, webRoot, outputPath] = process.argv.slice(2)
if (!sourceCommit || !jarPath || !webRoot || !outputPath) {
  throw new Error('usage: release-manifest.mjs <commit> <jar> <web-root> <output>')
}

const digest = (content) => createHash('sha256').update(content).digest('hex')
const files = []
function visit(directory) {
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name)
    if (statSync(path).isDirectory()) visit(path)
    else files.push(path)
  }
}
visit(resolve(webRoot))

const webRows = files.map((path) => `${digest(readFileSync(path))}  ${relative(resolve(webRoot), path)}`)
const manifest = [
  `source_commit=${sourceCommit}`,
  `server_jar=${relative(process.cwd(), resolve(jarPath))}`,
  `server_jar_sha256=${digest(readFileSync(jarPath))}`,
  `web_dist_sha256=${digest(`${webRows.join('\n')}\n`)}`,
  'web_files:',
  ...webRows,
  '',
].join('\n')
writeFileSync(outputPath, manifest)
process.stdout.write(manifest)
