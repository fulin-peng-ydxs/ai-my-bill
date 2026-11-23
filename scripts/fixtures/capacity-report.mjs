import { scaleAppId,scaleMetrics } from '../lib/ios-capacity.mjs'
export function capacityEvidenceFixture() {
  const receipt = { runId:'00000000-0000-4000-8000-000000000001',sourceHash:'a'.repeat(64),artifactHash:'b'.repeat(64),
    commit:'c'.repeat(40),mode:'device',appId:scaleAppId,configuration:'Release',debugger:false,workingTree:false,
    deviceModel:'iPhone 14 Pro Max',iosVersion:'27.0.1',deviceId:'00008120-0000000000000000',teamId:'EXAMPLE123',
    xcodeVersion:'27.0',sqliteVersion:'3',pluginVersion:'8.1.1',appVersion:'1.0',buildVersion:'1' }
  const samples = Object.fromEntries(scaleMetrics.filter(x => !['coldStart','filter','backup','restore'].includes(x)).map(key => ['sqlite.'+key,Array(30).fill(1)]))
  samples['files.backup'] = Array(5).fill(1); samples['files.restore'] = Array(5).fill(1)
  const observation = { ...receipt,count:10000,fixture:{ version:1 },measurementScope:'native-services-not-page-e2e',samples }
  const capture = { ...receipt,count:10000,fixtureVersion:1,scope:'page-e2e',evidenceHash:'d'.repeat(64),
    samples:Object.fromEntries(scaleMetrics.map(x => [x,Array(['coldStart','backup','restore'].includes(x) ? 5 : 30).fill(1)])),
    correctness:true,crashed:false,unboundedGrowth:false,memory:{ ...receipt,count:10000,windowStart:0,windowEnd:1000,evidenceHash:'e'.repeat(64),
      samples:[0,500,1000].map(at => ({ at,appPid:10,webPid:11,appBytes:20,webBytes:30 })) } }
  let clock = 0
  capture.spans = Object.fromEntries(Object.entries(capture.samples).map(([key,values]) => [key,values.map(value => {
    const start = clock; clock += value; return { start,end:clock }
  })]))
  return { receipt,observation,capture }
}
