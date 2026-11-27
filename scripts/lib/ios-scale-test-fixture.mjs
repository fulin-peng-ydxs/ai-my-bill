import fs from 'node:fs'
import { selection,sourceHash } from './ios-debug.mjs'
import { readScaleCold,scaleMemoryReport } from './ios-scale-run.mjs'
import { capacityReport } from './ios-capacity.mjs'
import { capacityEvidenceFixture } from '../fixtures/capacity-report.mjs'

/** Synthetic protocol data shared by tool regressions; never an actual capacity observation. */
export function scaleProtocolFixture(root,toolchain,file,deviceId) {
  const selected=selection('--scenario','scale-10000',[])
  const original=capacityEvidenceFixture()
  const receipt={...original.receipt,mode:'simulator',count:10000,...(deviceId?{deviceId}:{}),sourceHash:sourceHash(root,toolchain)}
  const common={runId:receipt.runId,sourceHash:receipt.sourceHash,artifactHash:receipt.artifactHash,count:10000}
  const fixture={...common,datasetId:'dataset',fixturePath:'fixture.sqlite'}
  const native={...original.observation,...common,mode:'simulator'}
  const pages={...common,datasetId:'dataset',scope:'page-e2e',correctness:true,crashed:false,
    samples:Object.fromEntries(Object.entries(original.capture.samples).filter(([key])=>!['coldStart','backup','restore'].includes(key))),
    spans:Object.fromEntries(Object.entries(original.capture.spans).filter(([key])=>!['coldStart','backup','restore'].includes(key)).map(([key,spans])=>[key,spans.map(x=>({start:x.start+1200,end:x.end+1200}))]))}
  const coldEvents=Array.from({length:5},(_,sampleIndex)=>({...common,datasetId:'dataset',sampleIndex,deviceId:receipt.deviceId,mode:'simulator',clockDefinition:'automation-upper-bound',samples:[1],spans:[{start:3010+sampleIndex*20,end:3011+sampleIndex*20}]}))
  const passed=ids=>ids.map(id=>`Test Case '-[${id.split('/')[0]}.${id.split('/')[1]} ${id.split('/')[2]}]' passed`).join('\n')
  const success='\n** TEST EXECUTE SUCCEEDED **\n'
  const log=(label,event,ids)=>label+' '+JSON.stringify(event)+'\n'+passed(ids)+success
  const logs={ 'capacity-prepare.log':log('IOS_CAPACITY_FIXTURE',fixture,[selected.cases[0]]),
    'capacity-native.log':log('IOS_CAPACITY_OBSERVATION',native,[selected.cases[1]]),
    'capacity-pages.log':log('IOS_CAPACITY_PAGES',pages,[selected.cases[2]]),
    'capacity-cold.log':coldEvents.map(x=>'IOS_CAPACITY_COLD_SAMPLE '+JSON.stringify(x)).join('\n')+'\n'+passed(selected.cases.slice(3))+success }
  fs.writeFileSync(file,logs['capacity-cold.log'])
  const report={...capacityReport(receipt,native),phase:'all',receipt,fixtureReceipt:fixture,pages,cold:readScaleCold(file),memory:scaleMemoryReport({...receipt,datasetId:fixture.datasetId},[1150,1600,3100].map(at=>({at,appPid:1,webPid:2,appBytes:21,webBytes:31})),[],1100,3250)}
  const result={scope:'partial',status:'passed',requested:{kind:'scenario',name:'scale-10000'},executedCases:selected.cases,
    completedAt:3300,environment:toolchain,sourceHash:receipt.sourceHash,simulatorId:receipt.deviceId,coverage:selected.cases.map(x=>'case/'+x),
    timings:[[selected.cases.slice(0,1),1000,1100],[selected.cases.slice(1,2),1100,1200],[selected.cases.slice(2,3),1200,3000],[selected.cases.slice(3),3000,3200]].map(([ids,startedAt,finishedAt])=>({status:'passed',startedAt,finishedAt,coverage:ids.map(id=>'case/'+id)}))}
  logs['capacity-report.json']=JSON.stringify(report)
  return {selected,receipt,fixture,native,pages,coldEvents,report,result,logs}
}
