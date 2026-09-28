# -*- coding: utf-8 -*-
"""仅供隔离恢复脚本调用；兼容目标宿主 Python 2.7/3，不输出会话凭据。"""
from __future__ import print_function
import hashlib
import json
import subprocess
import sys
import time
import uuid

app, proxy, config = sys.argv[1:]
assert config.startswith('/var/backups/my-bill/.recovery-drill.') and config.endswith('/proxy/Caddyfile')


def request(path, cookies=None, body=None, csrf=None):
    # 凭据经标准输入传给 curl，避免进入宿主进程参数和日志。
    options = ['silent', 'show-error', 'max-time = 10', 'include',
               'url = "http://drill-proxy:8080%s"' % path]
    if cookies:
        options.append('header = %s' % json.dumps('Cookie: ' + '; '.join(k + '=' + v for k, v in cookies.items())))
    if csrf:
        options.append('header = %s' % json.dumps('X-XSRF-TOKEN: ' + csrf))
    if body is not None:
        options.extend(['header = "Content-Type: application/json"', 'data = ' + json.dumps(json.dumps(body))])
    process = subprocess.Popen(['docker', 'exec', '-i', app, 'curl', '--config', '-'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    result, error = process.communicate(('\n'.join(options) + '\n').encode('utf-8'))
    assert process.returncode == 0, 'isolated HTTP transport failed'
    header, data = result.decode('utf-8').split('\r\n\r\n', 1)
    code = int(header.splitlines()[0].split()[1])
    if cookies is not None:
        for line in header.splitlines():
            if line.lower().startswith('set-cookie:'):
                key, value = line.split(':', 1)[1].strip().split(';', 1)[0].split('=', 1)
                cookies[key] = value
    return code, data


def switch(upstream):
    with open(config, 'w') as output:
        output.write(':8080 {\n reverse_proxy %s\n}\n' % upstream)
    subprocess.check_call(['docker', 'exec', proxy, 'caddy', 'reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)


# 等代理就绪后证明入口仍处于失败状态，再由运维步骤切换至恢复服务。
for attempt in range(20):
    try:
        assert request('/api/v1/health')[0] == 502
        break
    except AssertionError:
        if attempt == 19:
            raise
        time.sleep(1)
switch('restored-app:8080')
assert request('/api/v1/health')[0] == 200
for i in (1, 2):
    cookies = {}
    request('/api/v1/health', cookies)
    code, data = request('/api/v1/auth/login', cookies, {'username': 'recovery-fixture-%s' % i, 'password': 'RecoveryFixtureOnly-2026!'}, cookies.get('XSRF-TOKEN'))
    assert code == 200, 'restored login failed'
    code, data = request('/api/v1/reports/summary?scope=ALL&range=TODAY', cookies)
    report = json.loads(data)
    assert code == 200 and report['grossExpense'] == '246800.00' and report['matchingItemCount'] == 10000, 'restored report mismatch'
    code, data = request('/api/v1/ledger-entries?range=TODAY', cookies)
    ledger = json.loads(data)
    assert code == 200 and len(ledger['items']) > 0 and ledger['hasMore'], 'restored ledger pagination failed'
    own = str(uuid.UUID(hashlib.md5(('recovery-export-%s' % i).encode('ascii')).hexdigest()))
    other = str(uuid.UUID(hashlib.md5(('recovery-export-%s' % (3-i)).encode('ascii')).hexdigest()))
    code, data = request('/api/v1/exports/%s/download' % own, cookies)
    assert code == 200 and data == 'tenant,amount\n%s,246800.00\n' % i, 'restored export bytes differ'
    assert request('/api/v1/exports/%s/download' % other, cookies)[0] == 404, 'cross-tenant export visible'
    # 有效会话跨代理回退/再次切换保持可用；不修改生产代理。
    if i == 1:
        switch('127.0.0.1:1')
        assert request('/api/v1/health')[0] == 502
        switch('restored-app:8080')
        assert request('/api/v1/auth/session', cookies)[0] == 200
    assert request('/api/v1/auth/logout', cookies, {}, cookies.get('XSRF-TOKEN'))[0] == 204
    assert request('/api/v1/reports/summary', cookies)[0] == 401
deleted_cookies = {}
request('/api/v1/health', deleted_cookies)
assert request('/api/v1/auth/login', deleted_cookies, {'username': 'recovery-fixture-3', 'password': 'RecoveryFixtureOnly-2026!'}, deleted_cookies.get('XSRF-TOKEN'))[0] == 401
print('PASS: isolated entry switch/rollback, two-user login/report/ledger/export, cross-tenant denial, logout and deleted-user denial')
