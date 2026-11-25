import fs from 'node:fs'
import path from 'node:path'

const framework = '/Library/Developer/PrivateFrameworks/CoreSimulator.framework'
const installed = framework + '/Versions/A/Resources/bin/simctl'
const plist = framework + '/Versions/A/Resources/Info.plist'
const fallback = { program:'xcrun', prefix:['simctl'], mode:'sdk-wrapper' }
const magic = new Set(['cafebabe','bebafeca','cafebabf','cffaedfe','feedfacf','cefaedfe','feedface'])

function versionParts(value) {
  if (!/^\d+(?:\.\d+)*$/.test(value)) throw new Error('CoreSimulator 组件版本无效。')
  const parts=value.split('.').map(Number)
  if(parts.some(n=>!Number.isSafeInteger(n)))throw new Error('CoreSimulator 组件版本无效。')
  return parts
}
function atLeast(current, expected) {
  const a=versionParts(current), b=versionParts(expected)
  for(let i=0;i<Math.max(a.length,b.length);i++) {
    const delta=(a[i]??0)-(b[i]??0)
    if(delta)return delta>0
  }
  return true
}

/** 冷启动前解析一次官方入口；不修改 SDK，不运行会安装组件/接受许可的包装路径。 */
export async function resolveSimctl(command, { files=fs }={}) {
  const entry=(await command('xcrun',['--find','simctl'])).text.trim()
  if(!path.isAbsolute(entry) || !files.existsSync(entry))return {...fallback}
  const trusted = file => {
    const stat=files.statSync(file)
    return stat.isFile() && stat.uid===0 && !(stat.mode&0o022) && Boolean(stat.mode&0o111)
  }
  if(!trusted(entry))return {...fallback}
  const readPrefix=file=>{
    const fd=files.openSync(file,'r'),buffer=Buffer.alloc(16384)
    try {return buffer.subarray(0,files.readSync(fd,buffer,0,buffer.length,0))}
    finally {files.closeSync(fd)}
  }
  const source=readPrefix(entry)
  if(magic.has(source.subarray(0,4).toString('hex')))
    return {program:entry,prefix:[],mode:'sdk-binary'}
  const wrapper=source.toString('utf8')
  const expected=wrapper.match(/^EXPECTED_VERSION="([\d.]+)"$/m)?.[1]
  if(!expected || !wrapper.includes('exec "'+installed+'" "${@}"'))return {...fallback}
  // 只绕过已识别的官方版本检查 Shell：先复现其最低组件要求，未知包装器保持原语义。
  const current=(await command('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',plist])).text.trim()
  if(!atLeast(current,expected))throw new Error('CoreSimulator 组件低于所选 SDK 要求；请先在 Xcode 完成组件准备。')
  await command('xcodebuild',['-checkFirstLaunchStatus'])
  if(!files.existsSync(installed) || !trusted(installed) ||
    !files.realpathSync(installed).startsWith(framework+'/Versions/') ||
    !magic.has(readPrefix(installed).subarray(0,4).toString('hex')))
    throw new Error('已安装 CoreSimulator 原生工具的来源或格式无效。')
  return {program:installed,prefix:[],mode:'installed-binary',componentVersion:current}
}
