"""Current hook inventory regression coverage; no model calls or trust writes."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import codex_hook_trust as trust

class CurrentHookTrustTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.hooks = self.home / 'hooks.json'
        self.roster = {'hooks': {'PreToolUse': [{'hooks': [
            {'command': 'node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs"'},
            {'command': 'node "${CLAUDE_PLUGIN_ROOT}/hooks/second.mjs"'}]}],
            'SessionStart': [{'hooks': [{'command': 'node "${CLAUDE_PLUGIN_ROOT}/hooks/start.mjs"'}]}],
            'WorktreeCreate': [{'hooks': [{'command': 'other-client-only'}]}]}}
        self.hooks.write_text(json.dumps(self.roster))
        self.rows = [{'key': key, 'enabled': True, 'trustStatus': 'trusted', 'pluginId': trust.PLUGIN_ID,
                      'sourcePath': str(self.hooks), 'source': 'plugin'}
                     for key in trust.expected_keys(self.hooks, True, set())]
        self.payload = {'data': [{'cwd': str(self.home), 'hooks': self.rows, 'errors': [], 'warnings': []}]}

    def audit(self, payload=None):
        with patch.object(trust, 'read_inventory', return_value=self.payload if payload is None else payload):
            return trust.audit('codex', self.home, self.hooks, True, set(), self.home)

    def test_all_current_handlers_are_required(self):
        result = self.audit()
        self.assertTrue(result['healthy'])
        self.assertEqual(result['checked'], 3)
        self.assertEqual(result['pending'], [])

    def test_partial_changed_missing_disabled_duplicate_or_wrong_source_fail(self):
        for change in ('untrusted', 'changed', 'disabled', 'missing', 'duplicate', 'other-cache', 'other-plugin'):
            with self.subTest(change=change):
                payload = copy.deepcopy(self.payload)
                rows = payload['data'][0]['hooks']; key = rows[0]['key']
                if change in ('untrusted','changed'): rows[0]['trustStatus'] = change
                elif change == 'disabled': rows[0]['enabled'] = False
                elif change == 'missing': rows.pop(0)
                elif change == 'duplicate': rows.append(copy.deepcopy(rows[0]))
                elif change == 'other-cache': rows[0]['sourcePath'] = str(self.home / 'old-cache/hooks.json')
                else: rows[0]['pluginId'] = 'foreign@personal'
                result = self.audit(payload)
                self.assertFalse(result['healthy']); self.assertIn(key, result['pending'])

    def test_unavailable_malformed_empty_wrong_cwd_never_pass(self):
        for payload in ({}, {'data': []}, {'data': [None]}, {'data': [{'cwd': str(self.home / 'other')}]},
                        {'data': [{'cwd': str(self.home), 'hooks': [], 'errors': ['failed']}]},
                        {'data': [{'cwd': str(self.home), 'hooks': [], 'warnings': ['partial']}]},
                        {'data': [{'cwd': str(self.home), 'hooks': [None]}]}):
            with self.subTest(payload=payload): self.assertFalse(self.audit(payload)['healthy'])
        with patch.object(trust, 'read_inventory', side_effect=trust.InventoryUnavailable('unavailable')):
            self.assertFalse(trust.audit('codex',self.home,self.hooks,True,set(),self.home)['healthy'])

    def test_delivered_roster_detects_a_truncated_cache(self):
        delivered = self.home / 'delivered.json'; delivered.write_text(self.hooks.read_text())
        self.hooks.write_text(json.dumps({'hooks': {'PreToolUse': self.roster['hooks']['PreToolUse']}}))
        payload = copy.deepcopy(self.payload)
        payload['data'][0]['hooks'] = [row for row in self.rows if ':session_start:' not in row['key']]
        with patch.object(trust,'read_inventory',return_value=payload):
            result=trust.audit('codex',self.home,self.hooks,True,set(),self.home,delivered)
        self.assertFalse(result['healthy']); self.assertEqual(len(result['pending']),1)

    def test_user_fallback_excludes_foreign_hooks_and_keeps_bytes(self):
        self.hooks.write_text(json.dumps({'hooks':{'PreToolUse':[{'hooks':[
            {'command':'node "/pack/hooks/guard.mjs"'},{'command':'foreign-tool'}]}]}}))
        key=str(self.hooks)+':pre_tool_use:0:0'
        payload={'data':[{'cwd':str(self.home),'hooks':[{'key':key,'enabled':True,'trustStatus':'trusted',
                 'sourcePath':str(self.hooks),'source':'user'}],'errors':[],'warnings':[]}]}
        before=self.hooks.read_bytes()
        with patch.object(trust,'read_inventory',return_value=payload):
            for _ in range(2):
                self.assertTrue(trust.audit('codex',self.home,self.hooks,False,{'guard.mjs'},self.home)['healthy'])
        self.assertEqual(before,self.hooks.read_bytes())

class InventoryProtocolTest(unittest.TestCase):
    def run_server(self,code,timeout=3):
        real_popen=subprocess.Popen
        with tempfile.TemporaryDirectory() as tmp,patch.object(trust.subprocess,'Popen',side_effect=lambda args,**kw:
                real_popen([sys.executable,'-u','-c',code],**kw)):
            return trust.read_inventory('codex',Path(tmp),Path(tmp),timeout)
    def test_metadata_only_protocol_uses_selected_home(self):
        code="""import json,os,sys
for line in sys.stdin:
 value=json.loads(line); method=value['method']
 assert method in ('initialize','initialized','hooks/list')
 if method=='initialize':
  assert value['params']['capabilities']['experimentalApi'] is True
  print(json.dumps({'id':1,'result':{}}),flush=True)
 if method=='hooks/list':
  print(json.dumps({'id':2,'result':{'data':[],'home':os.environ['CODEX_HOME']}}),flush=True)
"""
        result=self.run_server(code)
        self.assertEqual(result['data'],[]); self.assertTrue(result['home'].endswith('.codex'))
    def test_protocol_errors_exits_and_timeouts_are_unverified(self):
        for code in ('raise SystemExit(0)','import time; time.sleep(10)',
                     "import json,sys; v=json.loads(sys.stdin.readline()); print(json.dumps({'id':1,'error':{'message':'private-secret'}}),flush=True); sys.stdin.read()"):
            with self.subTest(code=code),self.assertRaises(trust.InventoryUnavailable): self.run_server(code,timeout=.1)

if __name__=='__main__': unittest.main()
