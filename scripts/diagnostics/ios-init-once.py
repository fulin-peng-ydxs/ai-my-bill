"""一次性原生 A/B 取证；无安装、构建、重试或业务数据。"""
import ctypes
import importlib.util
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import signal
import subprocess
import sys
import time
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.local/ios/tmp/ai-agent/ios-once-diagnostic'
OUT.mkdir(parents=True, exist_ok=False)
END = time.monotonic() + 360
spec = importlib.util.spec_from_file_location('host', ROOT/'scripts/lib/ios-host-diagnostics.py')
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
read = host.observer()
lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
lib.proc_pidinfo.restype = ctypes.c_int

class Task(ctypes.Structure):
    _fields_ = [(n, ctypes.c_uint64) for n in ['virtual','resident','user','system','threads_user','threads_system']] + [(n, ctypes.c_int32) for n in ['policy','faults','pageins','cow_faults','sent','received','mach_calls','unix_calls','switches','threads','running','priority']]

class Thread(ctypes.Structure):
    _fields_ = [(n, ctypes.c_uint64) for n in ['user','system']] + [(n, ctypes.c_int32) for n in ['cpu','policy','run_state','flags','sleep','curpri','priority','maxpriority']] + [('name', ctypes.c_char*64)]

assert ctypes.sizeof(Task) == 96 and ctypes.sizeof(Thread) == 112
report = {'status':'running','source':os.getenv('GITHUB_SHA'),'run':os.getenv('GITHUB_RUN_ID'),'startedAt':time.time(),'cpuCount':os.cpu_count(),'platform':platform.platform(),'steps':[],'devices':[]}
metrics = (OUT/'metrics.jsonl').open('x', buffering=1)
monitors = []
current = None

def save():
    (OUT/'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))

def emit(value):
    metrics.write(json.dumps({'at':time.time(),'load':os.getloadavg(),**value})+'\n')

def target(pid):
    info = read(pid)
    result = {'process':info}
    if info.get('uid') != os.getuid() or info.get('pid') != pid:
        return result
    task = Task()
    n = lib.proc_pidinfo(pid,4,0,ctypes.byref(task),ctypes.sizeof(task))
    result['task'] = {k:getattr(task,k) for k,_ in task._fields_} if n==ctypes.sizeof(task) else {'unavailable':ctypes.get_errno(),'bytes':n}
    ids = (ctypes.c_uint64*64)()
    n = lib.proc_pidinfo(pid,6,0,ids,ctypes.sizeof(ids))
    threads = []
    for tid in ids[:max(0,min(64,n//8))]:
        t = Thread()
        n2 = lib.proc_pidinfo(pid,5,tid,ctypes.byref(t),ctypes.sizeof(t))
        if n2==ctypes.sizeof(t):
            threads.append({k:(getattr(t,k).decode(errors='replace') if k=='name' else getattr(t,k)) for k,_ in t._fields_})
    result['threads'] = threads
    return result

def terminate(p):
    if p.poll() is not None:
        return
    try:
        p.terminate()
        p.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            p.kill()
            p.wait(timeout=2)
        except (OSError,subprocess.TimeoutExpired) as error:
            emit({'cleanupIncomplete':p.pid,'error':str(error)})
    except OSError as error:
        emit({'cleanupIncomplete':p.pid,'error':str(error)})

def cancelled(sig,_):
    report['cancelled']=sig
    raise RuntimeError('diagnostic cancelled')

signal.signal(signal.SIGTERM,cancelled)
signal.signal(signal.SIGINT,cancelled)

def command(name,args,budget):
    global current
    start = time.monotonic()
    left = min(budget,END-start)
    if left<=0: raise RuntimeError('diagnostic total budget expired')
    step = {'name':name,'program':args[0],'args':args[1:],'budgetSeconds':left,'startedAt':time.time(),'status':'running'}
    report['steps'].append(step);save()
    log = OUT/(name+'.log')
    try:
        with log.open('x') as output:
            current = subprocess.Popen(args,stdout=output,stderr=subprocess.STDOUT,start_new_session=True,stdin=subprocess.DEVNULL)
            step['pid']=current.pid;save()
            next_sample=0
            while current.poll() is None:
                now=time.monotonic()
                if now-start>=left:
                    step['status']='timed-out';save()
                    raise TimeoutError(name+' exceeded its budget')
                if now>=next_sample:
                    emit({'stage':name,**target(current.pid)})
                    next_sample=now+5
                time.sleep(.25)
            step['exit']=current.returncode
            if current.returncode: raise RuntimeError(name+' exit='+str(current.returncode))
            step['status']='passed'
    except BaseException as error:
        if step['status']=='running':step['status']='failed'
        step['error']=str(error)
        raise
    finally:
        if current:terminate(current)
        current=None
        step['seconds']=time.monotonic()-start;step['completedAt']=time.time();save()
    return log.read_text()

TOOL='/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl'
RUNTIME='com.apple.CoreSimulator.SimRuntime.iOS-27-0'
TYPE='com.apple.CoreSimulator.SimDeviceType.iPhone-14-Pro-Max'

def create(label):
    name='mybill-once-'+label+'-'+str(uuid.uuid4())
    uid=command(label+'-create',[TOOL,'create',name,TYPE,RUNTIME],30).strip()
    if not re.fullmatch(r'[A-Fa-f0-9-]{36}',uid):raise RuntimeError('create returned invalid UUID')
    entry={'label':label,'uuid':uid,'name':name,'state':'created'}
    report['devices'].append(entry);save()
    identity(entry)
    return entry

def identity(entry):
    file=Path.home()/'Library/Developer/CoreSimulator/Devices'/entry['uuid']/'device.plist'
    value=plistlib.loads(file.read_bytes())
    if value.get('UDID')!=entry['uuid'] or value.get('name')!=entry['name'] or value.get('deviceType')!=TYPE or value.get('runtime')!=RUNTIME:
        raise RuntimeError('owned-device identity mismatch; refusing destructive command')
    return value

try:
    save()
    emit({'hostStart':read.summary()})
    for name,args in [('vm-stat',['/usr/bin/vm_stat','2']),('io-stat',['/usr/sbin/iostat','-w','2'])]:
        file=(OUT/(name+'.log')).open('x')
        p=subprocess.Popen(args,stdout=file,stderr=subprocess.STDOUT,start_new_session=True,stdin=subprocess.DEVNULL)
        monitors.append((p,file))
    command('xcode-version',['xcodebuild','-version'],20)
    command('sdk-version',['xcrun','--sdk','iphoneos','--show-sdk-version'],20)
    command('first-launch',['xcodebuild','-checkFirstLaunchStatus'],20)
    command('component-version',['/usr/libexec/PlistBuddy','-c','Print :CFBundleVersion','/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/Info.plist'],20)
    stat=Path(TOOL).stat()
    if stat.st_uid!=0 or stat.st_mode&0o022:raise RuntimeError('native simctl ownership invalid')
    runtimes=json.loads(command('runtimes',[TOOL,'list','runtimes','--json'],30))
    if not any(r['identifier']==RUNTIME and r.get('isAvailable') for r in runtimes['runtimes']):raise RuntimeError('required runtime unavailable')
    before=json.loads(command('devices-before',[TOOL,'list','devices','--json'],30))
    original={d['udid'] for group in before['devices'].values() for d in group}
    quiet=create('shutdown-control')
    report['controlInitialState']=identity(quiet).get('state');save()
    if report['controlInitialState']!=1:raise RuntimeError('control is not Shutdown')
    command('shutdown-control-delete',[TOOL,'delete',quiet['uuid']],120)
    quiet['state']='deleted';save()
    hot=create('booted-test')
    text=command('booted-test-boot',[TOOL,'bootstatus',hot['uuid'],'-b'],120)
    if text.count('Monitoring boot status for ')!=1 or '('+hot['uuid']+')' not in text or not re.search(r'Status=4294967295, isTerminal=YES.*?Finished\s*$',text,re.S):
        raise RuntimeError('boot terminal proof missing')
    hot['state']='booted';save()
    identity(hot)
    command('booted-test-delete',[TOOL,'delete',hot['uuid']],120)
    hot['state']='deleted';save()
    after=json.loads(command('devices-after',[TOOL,'list','devices','--json'],30))
    remaining={d['udid'] for group in after['devices'].values() for d in group}
    if not original.issubset(remaining) or any(d['uuid'] in remaining for d in report['devices']):raise RuntimeError('final device isolation check failed')
    report['otherDevicesPreserved']=len(original)
    report['status']='diagnostic-completed'
except BaseException as error:
    report['status']='diagnostic-incomplete';report['error']=str(error)
finally:
    if current:terminate(current)
    for p,file in monitors:terminate(p);file.close()
    report['completedAt']=time.time();save();metrics.close()
    print(json.dumps(report,ensure_ascii=False),flush=True)
sys.exit(0 if report['status']=='diagnostic-completed' else 1)
