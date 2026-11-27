import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { generated } from './ios-cache.mjs'
import { caseMeasurements, suiteMeasurement, swiftCaseInput } from './ios-execution-inputs.mjs'
import { isolatedInteraction, scopedSource, interactionCase } from './ios-scenario-dependencies.mjs'
import { selection } from './ios-debug.mjs'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const swift = 'app/ios/App/UITests/DictionaryTouchTests.swift'
const require = createRequire(new URL('../../app/package.json', import.meta.url))

/** App/UI can retain their fixed issuer only while the capacity adapter is a pure
 * early delegation for these schemes. Unknown shared routing must not reuse old proof.
 */
export function assertCapacityDelegation(root) {
  const adapter=path.join(root,'scripts/lib/ios-capacity-registration.mjs')
  const ts=require('typescript')
  const fail=()=>{throw new Error('容量登记适配的模块、导出或透传边界变化，拒绝复用旧执行证明。')}
  const parse=file=>{
    if (fs.realpathSync(file)!==file || !fs.lstatSync(file).isFile() || fs.statSync(file).size>1024*1024) fail()
    const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
    if (source.parseDiagnostics.length) fail()
    return source
  }
  const moduleBindings=source=>{
    const imports=[],locals=new Map(),exports=new Map()
    const publish=(name,binding)=>{if(exports.has(name))fail();exports.set(name,binding)}
    for(const node of source.statements) {
      if(ts.isImportDeclaration(node)) {
        const clause=node.importClause
        if(!ts.isStringLiteral(node.moduleSpecifier)||!clause||clause.isTypeOnly||node.attributes)fail()
        const from=node.moduleSpecifier.text,named=[]
        if(clause.name) {
          if(locals.has(clause.name.text))fail()
          locals.set(clause.name.text,{from,name:'default'})
        }
        if(clause.namedBindings) {
          if(!ts.isNamedImports(clause.namedBindings))fail()
          for(const item of clause.namedBindings.elements) {
            if(item.isTypeOnly)fail()
            const name=(item.propertyName??item.name).text,local=item.name.text
            if(locals.has(local))fail()
            locals.set(local,{from,name});named.push([name,local])
          }
        }
        imports.push([from,clause.name?.text??null,named.sort((a,b)=>a[1].localeCompare(b[1]))])
      } else if(ts.isExportDeclaration(node)) {
        if(node.isTypeOnly||!node.exportClause||!ts.isNamedExports(node.exportClause)||node.attributes)fail()
        for(const item of node.exportClause.elements) {
          if(item.isTypeOnly)fail()
          const name=(item.propertyName??item.name).text
          publish(item.name.text,node.moduleSpecifier?{from:node.moduleSpecifier.text,name}:{local:name})
        }
      } else if(ts.isFunctionDeclaration(node)&&node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)) {
        if(!node.name||node.modifiers.some(m=>m.kind!==ts.SyntaxKind.ExportKeyword))fail()
        publish(node.name.text,{local:node.name.text})
      }
    }
    return{imports,locals,exports}
  }
  let stat
  try{stat=fs.lstatSync(adapter)}catch(error){if(error.code!=='ENOENT')throw error}
  if(!stat) {
    // Legacy is a positive routing fact, not an absent-file exemption. The public
    // entry must still route both APIs directly to the original issuer.
    const entry=path.join(root,'scripts/lib/ios-local-partials.mjs'),source=parse(entry),bindings=moduleBindings(source)
    for(const name of ['partialMeasurement','registerPartial']) {
      let binding=bindings.exports.get(name)
      if(binding?.local)binding=bindings.locals.get(binding.local)
      if(binding?.from!=='./ios-local-measurement.mjs'||binding.name!==name)fail()
    }
    // Also reject a surviving direct/transitive adapter reference in the legacy
    // consumer graph. Unknown computed imports cannot prove an adapter-free tree.
    const visited=new Set()
    const visit=file=>{
      if(file===adapter)fail()
      if(visited.has(file))return
      if(visited.size>=128)fail()
      visited.add(file)
      let present
      try{present=fs.lstatSync(file)}catch(error){if(error.code!=='ENOENT')throw error}
      if(!present)fail() // an incomplete graph cannot prove an adapter-free legacy structure
      const tree=file===entry?source:parse(file)
      const follow=specifier=>{
        if(specifier.startsWith('node:'))return
        if(!specifier.startsWith('.'))fail()
        const target=path.resolve(path.dirname(file),decodeURIComponent(specifier.split(/[?#]/)[0]))
        if(!target.startsWith(root+path.sep))fail()
        visit(target)
      }
      const walk=node=>{
        if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier) {
          if(!ts.isStringLiteral(node.moduleSpecifier))fail()
          follow(node.moduleSpecifier.text)
        }
        if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword) {
          if(node.arguments.length!==1||!ts.isStringLiteral(node.arguments[0]))fail()
          follow(node.arguments[0].text)
        }
        ts.forEachChild(node,walk)
      }
      walk(tree)
    }
    visit(entry)
    return
  }
  const source=parse(adapter),bindings=moduleBindings(source)
  const expectedImports=[['node:fs','fs',[]],['node:path','path',[]],
    ['./ios-local-measurement.mjs',null,[['partialMeasurement','originalMeasurement'],['registerPartial','originalRegister']]],
    ['./ios-evidence-inputs.mjs',null,[['measurementHost','measurementHost']]],['./ios-debug.mjs',null,[['selection','selection']]],
    ['./ios-verification.mjs',null,[['readState','readState'],['writeJson','writeJson'],['evidenceRoot','evidenceRoot'],['inputHash','inputHash']]]]
    .map(([from,name,named])=>[from,name,named.sort((a,b)=>a[1].localeCompare(b[1]))])
  if(JSON.stringify(bindings.imports)!==JSON.stringify(expectedImports))fail()
  const functions=source.statements.filter(ts.isFunctionDeclaration)
  const contracts=[['partialMeasurement',['root','selected','environment','session','invocation'],
    "if(selected.scheme!=='Capacity')return originalMeasurement(root,selected,environment,session,invocation)"],
    ['registerPartial',['root','run','measurement'],"if(measurement?.kind!=='capacity')return originalRegister(root,run,measurement)"],
    ['assertCapacityMeasurement',['value']]]
  if(functions.length!==contracts.length||new Set(functions.map(fn=>fn.name?.text)).size!==contracts.length||
      bindings.exports.size!==contracts.length||source.statements.some(node=>
        !ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node)&&!ts.isFunctionDeclaration(node)&&!ts.isEmptyStatement(node)))fail()
  const unparen=node=>{while(ts.isParenthesizedExpression(node))node=node.expression;return node}
  const expression=node=>{
    node=unparen(node)
    if(ts.isIdentifier(node))return['id',node.text]
    if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return['string',node.text]
    if(ts.isBinaryExpression(node))return['binary',node.operatorToken.kind,expression(node.left),expression(node.right)]
    if(ts.isPropertyAccessExpression(node))return['property',!!node.questionDotToken,expression(node.expression),node.name.text]
    if(ts.isCallExpression(node)&&!node.typeArguments?.length)return['call',!!node.questionDotToken,expression(node.expression),node.arguments.map(expression)]
    fail()
  }
  const guard=node=>{
    if(!node||!ts.isIfStatement(node)||node.elseStatement)fail()
    let returned=node.thenStatement
    if(ts.isBlock(returned)) {
      const statements=returned.statements.filter(s=>!ts.isEmptyStatement(s))
      if(statements.length!==1)fail()
      returned=statements[0]
    }
    if(!ts.isReturnStatement(returned)||!returned.expression)fail()
    return[expression(node.expression),expression(returned.expression)]
  }
  const shadowsDelegate=(fn,params,callee)=>{
    const names=node=>ts.isIdentifier(node)?[node.text]:
      ts.isObjectBindingPattern(node)||ts.isArrayBindingPattern(node)?node.elements.flatMap(item=>
        ts.isBindingElement(item)?names(item.name):[]):[]
    let shadowed=false
    const protectedNames=new Set([...params,callee])
    const visit=node=>{
      // Static blocks have their own var environment. The enclosing class name
      // is still checked below, so a real outer TDZ/shadowing is not exempted.
      if(ts.isClassStaticBlockDeclaration(node))return
      if(ts.isFunctionLike(node)) {
        if(ts.isFunctionDeclaration(node)&&node.parent===fn.body&&protectedNames.has(node.name?.text))shadowed=true
        return // nested function locals do not belong to the delegate's scope
      }
      if(ts.isVariableDeclaration(node)&&ts.isVariableDeclarationList(node.parent)) {
        const blockScoped=!!(node.parent.flags&ts.NodeFlags.BlockScoped)
        if(names(node.name).some(name=>blockScoped
          ? ts.isVariableStatement(node.parent.parent)&&node.parent.parent.parent===fn.body&&protectedNames.has(name)
          : name===callee))shadowed=true
      }
      if(ts.isClassDeclaration(node)&&node.parent===fn.body&&protectedNames.has(node.name?.text))shadowed=true
      ts.forEachChild(node,visit)
    }
    ts.forEachChild(fn.body,visit)
    return shadowed
  }
  for(const[name,params,first]of contracts) {
    const fn=functions.find(fn=>fn.name?.text===name),binding=bindings.exports.get(name)
    if(!fn||binding?.local!==name||fn.asteriskToken||fn.type||fn.typeParameters?.length||!fn.body||
        fn.modifiers?.some(m=>m.kind!==ts.SyntaxKind.ExportKeyword)||fn.parameters.length!==params.length||
        fn.parameters.some((p,i)=>!ts.isIdentifier(p.name)||p.name.text!==params[i]||p.initializer||p.type||p.questionToken||p.dotDotDotToken||p.modifiers?.length))fail()
    if(first) {
      const expected=ts.createSourceFile('guard.mjs',first,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
      if(shadowsDelegate(fn,params,name==='partialMeasurement'?'originalMeasurement':'originalRegister'))fail()
      if(JSON.stringify(guard(fn.body.statements.find(s=>!ts.isEmptyStatement(s))))!==JSON.stringify(guard(expected.statements[0])))fail()
    }
  }
}

/** Reconstruct the two reviewed v1 encodings from CURRENT inputs, never from a report's
 * claimed sources. The reconstructed scoped encoding must equal the production hasher.
 * Unknown producer revisions/policies cannot gain aliases. No reports or pins are rewritten.
 */
function legacyExecutions(root, kind) {
  const file = path.join(root, 'config/ios-measurement-v1.json')
  if (!fs.existsSync(file) || !isolatedInteraction(root)) return undefined
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'))
  const ts = require('typescript'), source = policy.sources['scripts/lib/ios-measurement-scope.mjs'].content
  const parsed = ts.createSourceFile('legacy.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const common = parsed.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
    .find(node => node.name.getText(parsed) === 'common')?.initializer
  if (!common || !ts.isArrayLiteralExpression(common) || common.elements.some(node => !ts.isStringLiteral(node)))
    throw new Error('旧执行依赖清单不可解析，不能推断跨摘要等价。')
  const roots = [...common.elements.map(node => node.text), ...(kind === 'environment' ? ['scripts/lib/ios-boot-proof.mjs']
    : kind === 'ui' ? ['app/src','app/index.html','app/public','app/test-support','app/ios/App','scripts/fixtures',
      'scripts/normalize-capacitor-spm.mjs','scripts/verify-ios-resources.mjs','scripts/ios-storage-policy.mjs']
      : ['app/src','app/public','app/index.html','app/ios/App','app/native-tests','app/test-support','app/vitest.config.ts',
        'scripts/fixtures','scripts/lib/ios-ci-run.mjs','scripts/verify-ios-resources.mjs','scripts/normalize-capacitor-spm.mjs','scripts/ios-storage-policy.mjs'])]
  const scoped = [], coarse = []
  const visit = relative => {
    if (generated(relative) || relative.split('/').includes('__pycache__') || (kind !== 'environment' && /\.spec\.ts$/.test(relative)) ||
        (kind === 'native' && relative.startsWith('app/ios/App/UITests/')) ||
        (kind === 'ui' && (relative === swift || relative.startsWith('app/ios/App/CapacityTests/') ||
          relative.startsWith('app/ios/App/NativeTests/') && !relative.endsWith('/OwnedSimulatorTestContext.swift')))) return
    const absolute = path.join(root, relative)
    let stat
    try { stat = fs.lstatSync(absolute) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      coarse.push([relative,'missing']); scoped.push([relative,'missing']); return
    }
    if (stat.isSymbolicLink()) throw new Error('等价执行输入不能经符号链接。')
    if (stat.isDirectory()) { fs.readdirSync(absolute).sort().forEach(name => visit(relative+'/'+name)); return }
    if (!stat.isFile()) throw new Error('等价执行输入必须为普通文件。')
    const raw = policy.sources[relative] ? Buffer.from(policy.sources[relative].content) : fs.readFileSync(absolute)
    coarse.push([relative,stat.mode & 0o111,raw.toString('base64')])
    if (relative !== 'scripts/fixtures/ios_interaction.py')
      scoped.push([relative,stat.mode & 0o111,scopedSource(relative,raw,false).toString('base64')])
  }
  ;[...new Set(roots)].sort().forEach(visit)
  return { scoped:hash(scoped), coarse:hash(coarse) }
}

/** One bounded comparison snapshot per consumer operation, including both successes and
 * failure/cancellation/incomplete routing. Identities, baselines and timestamps stay original.
 */
export function equivalentCaseInputs(root, ids) {
  assertCapacityDelegation(root)
  const current = caseMeasurements(root, ids), output = Object.fromEntries(ids.map(id => [id,[current[id]]]))
  for (const kind of ['ui','native']) {
    const targets = ids.filter(id => (id.startsWith('NativeTests/') ? 'native' : 'ui') === kind && !interactionCase(id))
    if (!targets.length) continue
    const execution = legacyExecutions(root, kind)
    if (!execution) continue
    const text = kind === 'ui' ? fs.readFileSync(path.join(root,swift),'utf8') : undefined
    for (const id of targets) {
      const encode = value => kind === 'native' ? hash([1,id,value]) : hash([1,value,id,swiftCaseInput(text,id.split('/').at(-1))])
      if (encode(execution.scoped) === current[id]) output[id] = [...new Set([current[id],encode(execution.coarse)])]
    }
  }
  return output
}

export function equivalentSuiteInputs(root, suite) {
  assertCapacityDelegation(root)
  const current = suiteMeasurement(root,suite)
  if (suite.kind === 'ui') {
    const ids = selection(suite.case ? '--case' : '--scenario',suite.case ?? suite.scenario,[]).cases
    const aliases = equivalentCaseInputs(root,ids)
    return [...new Set([current,hash([1,suite.case ?? suite.scenario,Object.fromEntries(ids.map(id=>[id,aliases[id].at(-1)]))])])]
  }
  if (suite.kind !== 'environment' && !(suite.kind === 'full' && suite.mode === 'ios-smoke')) return [current]
  const execution = legacyExecutions(root,suite.kind === 'environment' ? 'environment' : 'native')
  return execution?.scoped === current ? [...new Set([current,execution.coarse])] : [current]
}
