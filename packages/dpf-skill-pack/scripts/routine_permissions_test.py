"""Routine permission convergence uses fixture homes only; no real client or model calls."""
from __future__ import annotations
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parent))
import routine_permissions as permissions

PACK = Path(__file__).resolve().parents[1]

class RoutinePermissionsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / 'home'
        self.root = self.home / 'source'
        self.root.mkdir(parents=True)
        (self.root / '.git').mkdir()
        (self.root / 'AGENTS.md').write_text('# DPF source\n', encoding='utf-8')
        (self.root / 'packages/dpf-skill-pack').mkdir(parents=True)
    def plan(self):
        return permissions.plan_permissions(self.root, self.home, PACK)
    def test_dry_run_changes_nothing_and_has_three_client_scopes(self):
        plan = self.plan()
        result = permissions.apply_permissions(plan, dry_run=True)
        self.assertEqual({'codex','claude-code','grok'}, {x['client'] for x in result})
        self.assertFalse((self.root / '.codex').exists())
        self.assertTrue(all(row['sessionVerified'] is False for row in result))
    def test_apply_then_replan_is_noop_and_never_sets_model(self):
        permissions.apply_permissions(self.plan(), dry_run=False)
        plan = self.plan()
        self.assertFalse(any(x.changed for x in plan.files))
        codex = permissions.read_toml(self.root / '.codex/config.toml')
        self.assertEqual('workspace-write', codex['sandbox_mode'])
        self.assertEqual('auto_review', codex['approvals_reviewer'])
        self.assertNotIn('model', codex)
        self.assertNotIn('model', permissions.read_toml(self.root / '.grok/config.toml'))
        rules=(self.root / '.codex/rules/dpf-routine.rules').read_text(encoding='utf-8')
        self.assertIn('git', rules)
        self.assertNotIn('["powershell"]', rules)
        self.assertNotIn('["bash"]', rules)
    def test_preserves_explicit_modes_denies_models_and_unknown_tables(self):
        (self.root / '.claude').mkdir()
        claude={'model':'chosen', 'hooks':{'Stop':[]},'permissions':{'defaultMode':'plan','deny':['Bash(rm *)'],'ask':['Bash(git push *)'],'allow':['Read']}}
        (self.root / '.claude/settings.local.json').write_text(json.dumps(claude), encoding='utf-8')
        (self.root / '.codex').mkdir()
        (self.root / '.codex/config.toml').write_text('model="chosen"\nsandbox_mode="read-only"\n[unrelated]\nitems=[{name="x", active=true}]\n', encoding='utf-8')
        (self.home / '.grok').mkdir()
        (self.home / '.grok/config.toml').write_text('[ui]\npermission_mode="always-approve"\n[models]\ndefault="chosen"\n', encoding='utf-8')
        permissions.apply_permissions(self.plan(), dry_run=False)
        new=json.loads((self.root / '.claude/settings.local.json').read_text(encoding='utf-8'))
        self.assertEqual(claude['permissions']['deny'],new['permissions']['deny'])
        self.assertEqual(claude['permissions']['ask'],new['permissions']['ask'])
        self.assertEqual('plan',new['permissions']['defaultMode'])
        self.assertEqual('chosen',new['model'])
        self.assertEqual(claude['hooks'],new['hooks'])
        codex=permissions.read_toml(self.root / '.codex/config.toml')
        self.assertEqual('read-only',codex['sandbox_mode'])
        self.assertEqual([{'name':'x','active':True}],codex['unrelated']['items'])
        self.assertEqual('always-approve',permissions.read_toml(self.home / '.grok/config.toml')['ui']['permission_mode'])
    def test_explicit_untrusted_project_is_preserved(self):
        (self.home / '.codex').mkdir()
        original={'projects':{str(self.root.resolve()):{'trust_level':'untrusted'}}}
        (self.home / '.codex/config.toml').write_text(permissions.dump_toml(original),encoding='utf-8')
        permissions.apply_permissions(self.plan(),dry_run=False)
        self.assertEqual(original,permissions.read_toml(self.home / '.codex/config.toml'))
    def test_malformed_configuration_refuses_before_any_write(self):
        (self.root / '.grok').mkdir()
        (self.root / '.grok/config.toml').write_text('[broken',encoding='utf-8')
        with self.assertRaises(permissions.PermissionPlanError): self.plan()
        self.assertFalse((self.root / '.codex').exists())
    def test_concurrent_edit_refuses_before_any_write(self):
        plan=self.plan()
        (self.root / '.claude').mkdir()
        (self.root / '.claude/settings.local.json').write_text('{}',encoding='utf-8')
        with self.assertRaises(permissions.PermissionPlanError): permissions.apply_permissions(plan,dry_run=False)
        self.assertFalse((self.root / '.codex').exists())
    def test_unrelated_home_and_drive_root_are_rejected(self):
        for root in [self.home, Path(self.root.anchor),self.home/'other']:
            with self.subTest(root=root),self.assertRaises(permissions.PermissionPlanError):
                permissions.plan_permissions(root,self.home,PACK)
    def test_backups_keep_original_bytes_and_no_raw_rules_in_report(self):
        (self.root / '.claude').mkdir()
        path=self.root / '.claude/settings.local.json'
        raw=b'{"permissions":{"allow":["Bash(secret-history)"]}}'
        path.write_bytes(raw)
        result=permissions.apply_permissions(self.plan(),dry_run=False)
        backup=next(self.root.glob('.claude/settings.local.json.dpf-permissions-*.bak'))
        self.assertEqual(raw,backup.read_bytes())
        self.assertNotIn('secret-history',json.dumps(result))
    def test_toml_roundtrip_preserves_native_values(self):
        data={'title':'a\\b\nquoted"', 'values':[1,True,{'name':'x'}], 'a.b':{'key.with.dot':'ok'}}
        self.assertEqual(data,permissions.tomllib.loads(permissions.dump_toml(data)))
    def test_existing_owned_rule_file_is_not_overwritten(self):
        (self.root / '.codex/rules').mkdir(parents=True)
        path=self.root / '.codex/rules/dpf-routine.rules'
        path.write_text('prefix_rule(pattern=["git"],decision="forbidden")\n',encoding='utf-8')
        with self.assertRaises(permissions.PermissionPlanError): self.plan()
        self.assertIn('forbidden',path.read_text(encoding='utf-8'))

    def test_global_restrictive_choices_and_native_mcp_policy_are_preserved(self):
        (self.home/'.codex').mkdir()
        (self.home/'.codex/config.toml').write_text(permissions.dump_toml({
            'sandbox_mode':'read-only','approval_policy':'on-request','approvals_reviewer':'user',
            'sandbox_workspace_write':{'network_access':False},
            'mcp_servers':{'dpf':{'url':'https://localhost/api/mcp/v1','default_tools_approval_mode':'prompt','disabled_tools':['admin_write']}},
            'plugins':{'dpf-platform@personal':{'enabled':True}}}),encoding='utf-8')
        (self.home/'.claude').mkdir()
        (self.home/'.claude/settings.json').write_text(json.dumps({'permissions':{'defaultMode':'plan','allow':['Bash(history-secret)']}}),encoding='utf-8')
        rows=permissions.apply_permissions(self.plan(),dry_run=False)
        codex=permissions.read_toml(self.root/'.codex/config.toml')
        self.assertEqual('read-only',codex['sandbox_mode'])
        self.assertFalse(codex['sandbox_workspace_write']['network_access'])
        self.assertNotIn('mcp_servers',codex)
        self.assertEqual('prompt',permissions.read_toml(self.home/'.codex/config.toml')['mcp_servers']['dpf']['default_tools_approval_mode'])
        self.assertEqual('auto',codex['plugins']['dpf-platform@personal']['mcp_servers']['dpf']['default_tools_approval_mode'])
        local=json.loads((self.root/'.claude/settings.local.json').read_text(encoding='utf-8'))
        self.assertEqual('plan',local['permissions']['defaultMode'])
        self.assertNotIn('history-secret',json.dumps(local))
        self.assertNotIn('history-secret',json.dumps(rows))
    def test_native_grok_trust_is_bounded_and_never_starts_a_model(self):
        calls=[]
        def run(command,**kwargs):
            calls.append(command)
            return SimpleNamespace(returncode=0,stdout=json.dumps({'projectRoot':str(self.root),'projectTrusted':'--trust' in command,'permissions':{'managedSettingsActive':True}}))
        with patch.object(permissions.shutil,'which',return_value='grok.exe'),patch.object(permissions.subprocess,'run',side_effect=run):
            result=permissions._grok_trust(self.root,self.home,False)
        self.assertEqual('trusted',result['trust'])
        self.assertTrue(result['managedSettingsActive'])
        self.assertEqual([['grok.exe','inspect','--json'],['grok.exe','--trust','inspect','--json']],calls)
    def test_native_dry_run_and_explicit_untrusted_do_not_change_trust(self):
        (self.home/'.grok').mkdir()
        (self.home/'.grok/trusted_folders.toml').write_text(permissions.dump_toml({'folders':{str(self.root):{'trusted':False}}}),encoding='utf-8')
        with patch.object(permissions.shutil,'which',return_value='grok.exe'),patch.object(permissions.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps({'projectRoot':str(self.root),'projectTrusted':False,'permissions':{}}))) as run:
            self.assertEqual('existing-untrusted',permissions._grok_trust(self.root,self.home,False)['trust'])
            permissions._grok_trust(self.root,self.home,True)
            self.assertTrue(all('--trust' not in call.args[0] for call in run.call_args_list))
    def test_hardlinked_configuration_target_is_refused(self):
        import os
        path=self.home/'settings-original.json'
        path.write_text('{}',encoding='utf-8')
        (self.root/'.claude').mkdir()
        os.link(path,self.root/'.claude/settings.local.json')
        with self.assertRaises(permissions.PermissionPlanError): self.plan()

    def test_selected_client_does_not_read_or_write_other_clients(self):
        (self.root/'.grok').mkdir()
        (self.root/'.grok/config.toml').write_text('[malformed',encoding='utf-8')
        plan=permissions.plan_permissions(self.root,self.home,PACK,clients=('claude-code',))
        rows=permissions.apply_permissions(plan,dry_run=False,native=True)
        self.assertEqual(['claude-code'],[x['client'] for x in rows])
        self.assertFalse((self.home/'.codex').exists())
        self.assertFalse((self.root/'.codex').exists())
    def test_permissions_only_updater_cannot_refresh_plugins_or_credentials(self):
        import update_agent_toolchain as updater
        import toolchain_convergence
        import contextlib,io
        report=self.home/'report.json'
        with patch.object(updater,'home_dir',return_value=self.home),patch.object(updater,'copy_skill_pack',side_effect=AssertionError('broad copy')),patch.object(updater,'ensure_codex_config',side_effect=AssertionError('connector write')),patch.object(permissions,'_grok_trust',return_value={'trust':'trusted','nativeInspection':True}),patch.object(toolchain_convergence,'cli_versions',return_value={'codex':'test','claude-code':'test','grok':'test'}),contextlib.redirect_stdout(io.StringIO()):
            code=updater.main(['--skill-pack-path',str(PACK),'--permissions-only','--project-root',str(self.root),'--report-json',str(report)])
        self.assertEqual(0,code)
        result=json.loads(report.read_text(encoding='utf-8'))
        self.assertEqual(3,len(result['clients']))
        self.assertEqual({'permissions:'+str(self.root.resolve())},{x['scope'] for x in result['clients']})
        self.assertTrue(all(x['sessionVerified'] is False for x in result['clients']))
        self.assertFalse((self.home/'.agents/plugins').exists())
    def test_failed_native_inspection_is_reported_separately(self):
        with patch.object(permissions,'_grok_trust',return_value={'trust':'native-inspection-failed','action':'failed'}):
            rows=permissions.apply_permissions(self.plan(),dry_run=False,native=True)
        self.assertEqual('failed',next(x for x in rows if x['client']=='grok')['action'])
        self.assertTrue((self.root/'.codex/config.toml').exists())
        self.assertFalse(any(x['sessionVerified'] for x in rows))

    def test_named_codex_permissions_are_not_shadowed_by_legacy_sandbox_defaults(self):
        (self.home/'.codex').mkdir()
        path=self.home/'.codex/config.toml'
        path.write_text('default_permissions = ":read-only"\n',encoding='utf-8')
        permissions.apply_permissions(self.plan(),dry_run=False)
        local=permissions.read_toml(self.root/'.codex/config.toml')
        self.assertNotIn('sandbox_mode',local)
        self.assertNotIn('sandbox_workspace_write',local)
        self.assertEqual(':read-only',permissions.read_toml(path)['default_permissions'])

    def test_owned_rules_keep_added_deny_and_rerun_is_noop(self):
        permissions.apply_permissions(self.plan(),dry_run=False)
        path=self.root/'.codex/rules/dpf-routine.rules'
        with path.open('a',encoding='utf-8') as out: out.write('prefix_rule(pattern=["git","push"],decision="forbidden")\n')
        permissions.apply_permissions(self.plan(),dry_run=False)
        self.assertIn('decision="forbidden"',path.read_text(encoding='utf-8'))
        self.assertFalse(any(x.changed for x in self.plan().files))
    def test_empty_json_and_malformed_owned_rule_refuse(self):
        (self.root/'.claude').mkdir()
        path=self.root/'.claude/settings.local.json';path.write_bytes(b'')
        with self.assertRaises(permissions.PermissionPlanError): self.plan()
        path.write_bytes(b'{}')
        (self.root/'.codex/rules').mkdir(parents=True)
        (self.root/'.codex/rules/dpf-routine.rules').write_text(permissions.MARKER+'prefix_rule(\n',encoding='utf-8')
        with self.assertRaises(permissions.PermissionPlanError): self.plan()

    def test_malformed_or_foreign_native_inspection_returns_failed_row(self):
        for value in [None,[],{'projectRoot':str(self.root),'projectTrusted':False,'permissions':None}, {'projectRoot':str(self.home),'projectTrusted':True,'permissions':{}}]:
            with self.subTest(value=value),patch.object(permissions.shutil,'which',return_value='grok.exe'),patch.object(permissions.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps(value))):
                rows=permissions.apply_permissions(self.plan(),dry_run=False,native=True)
                self.assertEqual('failed',next(x for x in rows if x['client']=='grok')['action'])
    def test_unsupported_native_configuration_shape_refuses_before_writes(self):
        (self.root/'.claude').mkdir()
        (self.root/'.claude/settings.local.json').write_text('{"permissions":{"deny":null}}',encoding='utf-8')
        with self.assertRaises(permissions.PermissionPlanError): self.plan()
        self.assertFalse((self.root/'.codex').exists())

    def test_selected_codex_config_profile_keeps_approval_and_reviewer_policy(self):
        (self.home/'.codex').mkdir()
        (self.home/'.codex/config.toml').write_text('profile="careful"\n',encoding='utf-8')
        (self.home/'.codex/careful.config.toml').write_text('approvals_reviewer="user"\nsandbox_mode="read-only"\n[approval_policy.granular]\nsandbox_approval=false\n',encoding='utf-8')
        rows=permissions.apply_permissions(self.plan(),dry_run=False)
        local=permissions.read_toml(self.root/'.codex/config.toml')
        for key in ('approval_policy','approvals_reviewer','sandbox_mode','sandbox_workspace_write'):
            self.assertNotIn(key,local)
        self.assertEqual('selected-config-profile',next(x for x in rows if x['client']=='codex')['reviewer'])

if __name__=='__main__': unittest.main()
