import { readFile } from 'node:fs/promises'

const [lockPath, mavenListPath, mavenPluginListPath, mavenPomPath] = process.argv.slice(2)
if (!lockPath || !mavenListPath || !mavenPluginListPath || !mavenPomPath) {
  throw new Error('usage: node scripts/check-osv.mjs <package-lock> <maven-dependency-list> <maven-plugin-list> <maven-pom>')
}

const lock = JSON.parse(await readFile(lockPath, 'utf8'))
const queries = []
const labels = []
const seen = new Set()

function add(ecosystem, name, version) {
  const key = `${ecosystem}:${name}:${version}`
  if (!name || !version || seen.has(key)) return
  seen.add(key)
  queries.push({ package: { ecosystem, name }, version })
  labels.push(key)
}

for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  if (!path || !metadata.version) continue
  const marker = 'node_modules/'
  const markerIndex = path.lastIndexOf(marker)
  if (markerIndex < 0) continue
  const name = path.slice(markerIndex + marker.length)
  add('npm', name, metadata.version)
}

const mavenCoordinates = await readFile(mavenListPath, 'utf8')
for (const line of mavenCoordinates.split(/\r?\n/u)) {
  const parts = line.trim().split(':')
  const scope = parts.at(-1)
  if (![5, 6].includes(parts.length) || !['compile', 'runtime', 'provided', 'test'].includes(scope)) continue
  const version = parts.length === 5 ? parts[3] : parts[4]
  add('Maven', `${parts[0]}:${parts[1]}`, version)
}

const mavenPluginCoordinates = await readFile(mavenPluginListPath, 'utf8')
const activeBuildPlugins = new Set([
  'org.apache.maven.plugins:maven-resources-plugin',
  'org.apache.maven.plugins:maven-compiler-plugin',
  'org.apache.maven.plugins:maven-surefire-plugin',
  'org.apache.maven.plugins:maven-jar-plugin',
  'org.apache.maven.plugins:maven-enforcer-plugin',
  'org.springframework.boot:spring-boot-maven-plugin',
])
// dependency:resolve-plugins reports upstream transitives before the plugin-level
// dependency mediation declared in server/pom.xml. Reflect those explicit pins
// here so OSV sees the classpath Maven actually uses; the subsequent Maven build
// remains the compatibility check for every replacement.
const pluginDependencyOverrides = new Map([
  ['org.apache.maven.plugins:maven-resources-plugin', new Map([
    ['org.codehaus.plexus:plexus-utils', '3.6.1'],
  ])],
  ['org.apache.maven.plugins:maven-jar-plugin', new Map([
    ['org.codehaus.plexus:plexus-utils', '4.0.3'],
    ['io.airlift:aircompressor', '2.0.3'],
  ])],
  ['org.springframework.boot:spring-boot-maven-plugin', new Map([
    ['com.fasterxml.jackson.core:jackson-databind', '2.21.5'],
    ['org.apache.commons:commons-lang3', '3.20.0'],
    ['org.apache.httpcomponents.client5:httpclient5', '5.6.3'],
    ['org.apache.httpcomponents.core5:httpcore5', '5.4.3'],
    ['org.apache.httpcomponents.core5:httpcore5-h2', '5.4.3'],
    ['org.codehaus.plexus:plexus-utils', '3.6.1'],
  ])],
])
const mavenPom = await readFile(mavenPomPath, 'utf8')
for (const overrides of pluginDependencyOverrides.values()) {
  for (const [name, version] of overrides) {
    const artifactId = name.split(':')[1]
    const declaration = new RegExp(`<artifactId>${artifactId}</artifactId>\\s*<version>${version.replaceAll('.', '[.]')}</version>`, 'u')
    if (!declaration.test(mavenPom)) {
      throw new Error(`plugin dependency override is not declared in ${mavenPomPath}: ${name}:${version}`)
    }
  }
}
let includePluginSection = false
let currentPlugin = ''
for (const line of mavenPluginCoordinates.split(/\r?\n/u)) {
  const parts = line.trim().split(':')
  if (line.startsWith('   ') && !line.startsWith('      ') && parts.length === 4) {
    currentPlugin = `${parts[0]}:${parts[1]}`
    includePluginSection = activeBuildPlugins.has(currentPlugin)
  }
  if (!includePluginSection) continue
  if (![4, 5].includes(parts.length)) continue
  const name = `${parts[0]}:${parts[1]}`
  const reportedVersion = parts.length === 4 ? parts[3] : parts[4]
  const version = pluginDependencyOverrides.get(currentPlugin)?.get(name) ?? reportedVersion
  add('Maven', name, version)
}

const vulnerabilities = []
for (let offset = 0; offset < queries.length; offset += 500) {
  const batch = queries.slice(offset, offset + 500)
  const response = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ queries: batch }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`OSV query failed: HTTP ${response.status}`)
  const payload = await response.json()
  payload.results.forEach((result, index) => {
    for (const vulnerability of result.vulns ?? []) {
      if (!vulnerability.withdrawn) {
        vulnerabilities.push({ dependency: labels[offset + index], id: vulnerability.id })
      }
    }
  })
}

if (vulnerabilities.length > 0) {
  console.error('OSV 在依赖中发现已知漏洞：')
  vulnerabilities.forEach(({ dependency, id }) => console.error(`${dependency} ${id}`))
  process.exitCode = 1
} else {
  console.log(`OSV dependency scan passed (${queries.length} dependencies).`)
}
