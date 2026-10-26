"""Scoped native client permissions, called only by the signed toolchain updater.

No model/provider selection or DPF authority lives here. Existing restrictions,
managed settings and real refusals remain authoritative. Reports contain counts,
posture and paths, never raw user rules, CLI output or credentials.
"""
from __future__ import annotations

import ast
from copy import deepcopy
from dataclasses import dataclass
from datetime import date, datetime, time
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid
try:
    import tomllib
except ImportError:
    import tomli as tomllib

MARKER = '# DPF routine permissions v1; server authority and managed restrictions still apply.\n'

class PermissionPlanError(ValueError):
    pass


def _safe(path: Path) -> None:
    for part in [path, *path.parents]:
        if part.is_symlink() or getattr(part, 'is_junction', lambda: False)():
            raise PermissionPlanError(f'Linked configuration path refused: {path}')
    if path.exists() and (not path.is_file() or path.stat().st_nlink != 1):
        raise PermissionPlanError(f'Configuration must be a regular unlinked file: {path}')


def _bytes(path: Path) -> bytes | None:
    _safe(path)
    return path.read_bytes() if path.exists() else None


def _load(path: Path, kind: str) -> tuple[dict, bytes | None]:
    raw = _bytes(path)
    try:
        value = (json.loads(raw.decode('utf-8-sig')) if kind == 'json' else tomllib.loads(raw.decode('utf-8-sig'))) if raw is not None else {}
        if not isinstance(value, dict):
            raise ValueError()
        return value, raw
    except (ValueError, UnicodeError):
        raise PermissionPlanError(f'Malformed or unsupported {kind} configuration: {path}') from None


def read_toml(path: Path) -> dict:
    return _load(path, 'toml')[0]


def _value(value) -> str:
    if isinstance(value, str): return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool): return 'true' if value else 'false'
    if isinstance(value, int): return str(value)
    if isinstance(value, float) and math.isfinite(value): return repr(value)
    if isinstance(value, (datetime, date, time)): return value.isoformat()
    if isinstance(value, list): return '[' + ', '.join(_value(x) for x in value) + ']'
    if isinstance(value, dict): return '{' + ', '.join(json.dumps(k) + ' = ' + _value(v) for k,v in value.items()) + '}'
    raise PermissionPlanError('Unsupported TOML value; existing configuration was not changed.')


def dump_toml(data: dict) -> str:
    lines = []
    def table(value, path):
        if path: lines.extend(['', '[' + '.'.join(json.dumps(x) for x in path) + ']'])
        for k,v in value.items():
            if not isinstance(k,str): raise PermissionPlanError('Unsupported TOML key.')
            if not isinstance(v,dict): lines.append(json.dumps(k) + ' = ' + _value(v))
        for k,v in value.items():
            if isinstance(v,dict): table(v,[*path,k])
    table(data,[])
    text = '\n'.join(lines).lstrip('\n') + '\n'
    if tomllib.loads(text) != data: raise PermissionPlanError('TOML semantic round-trip failed.')
    return text


def _mapping(data: dict, key: str) -> dict:
    value=data.get(key,{})
    if not isinstance(value,dict): raise PermissionPlanError(f'Expected configuration table: {key}')
    return value


def _table(data: dict, key: str) -> dict:
    value = data.setdefault(key,{})
    if not isinstance(value,dict): raise PermissionPlanError(f'Expected configuration table: {key}')
    return value


def _label(value, allowed: tuple[str,...]) -> str:
    # Do not echo arbitrary malformed/native settings into diagnostic output.
    if isinstance(value,str) and value in allowed: return value
    return 'preserved-explicit-setting'


def _merge_rules(data: dict, key: str, rules: list[str]) -> None:
    existing = data.setdefault(key,[])
    if not isinstance(existing,list) or any(not isinstance(x,str) for x in existing):
        raise PermissionPlanError('Unsupported native permission rule list.')
    existing.extend(x for x in rules if x not in existing)


@dataclass(frozen=True)
class PlannedFile:
    path: Path
    before: bytes | None
    after: bytes
    client: str
    @property
    def changed(self): return self.before != self.after


@dataclass(frozen=True)
class PermissionPlan:
    root: Path
    home: Path
    files: tuple[PlannedFile,...]
    clients: tuple[dict,...]


def plan_permissions(project_root: Path, home: Path, skill_pack: Path, *, clients=('codex','claude-code','grok')) -> PermissionPlan:
    root = project_root.expanduser().absolute()
    if root.is_symlink() or getattr(root,'is_junction',lambda:False)():
        raise PermissionPlanError('Linked project root refused.')
    root,home = root.resolve(),home.resolve()
    if (root == home or root == Path(root.anchor) or not root.is_dir()
        or not (root/'.git').exists() or not (root/'AGENTS.md').is_file() or not (root/'packages/dpf-skill-pack').is_dir()):
        raise PermissionPlanError('Name one existing DPF source project, not a home, drive or runtime directory.')
    try:
        policy=json.loads((skill_pack/'contracts/client-permission-baseline.json').read_text(encoding='utf-8-sig'))
        if policy['schemaVersion'] != 1: raise ValueError()
        prefixes=policy['commandPrefixes']
        if not isinstance(prefixes,list) or any(not isinstance(p,list) or not p or any(not isinstance(x,str) or not x for x in p) for p in prefixes): raise ValueError()
    except (OSError,ValueError,KeyError,TypeError): raise PermissionPlanError('Invalid delivered routine permission policy.') from None
    files=[]
    def document(path, client, kind, change):
        selected=client in clients
        old,raw=_load(path,kind) if selected else ({},None)
        new=deepcopy(old)
        change(new)
        text=json.dumps(new,indent=2,ensure_ascii=False)+'\n' if kind=='json' else dump_toml(new)
        if selected: files.append(PlannedFile(path,raw,raw if old==new and raw is not None else text.encode('utf-8'),client))
        return new

    # Only this named project's trust is created. An explicit untrusted decision
    # is retained. Project rules cannot widen an already-running managed session.
    trust=document(home/'.codex/config.toml','codex','toml',lambda c:_table(_table(c,'projects'),str(root)).setdefault('trust_level','trusted'))
    def codex(c):
        if not any('profile' in config for config in (c,trust)):
            c.setdefault('approval_policy',trust.get('approval_policy','on-request'))
            c.setdefault('approvals_reviewer',trust.get('approvals_reviewer','auto_review'))
        # Named permission profiles and legacy sandbox keys do not compose.
        # Preserve an explicit named/config profile rather than silently replace it.
        if not any(key in config for config in (c,trust) for key in ('default_permissions','profile')):
            inherited_sandbox=trust.get('sandbox_mode')
            c.setdefault('sandbox_mode',inherited_sandbox if inherited_sandbox in ('read-only','workspace-write') else 'workspace-write')
            inherited_network=_mapping(trust,'sandbox_workspace_write').get('network_access',True)
            _table(c,'sandbox_workspace_write').setdefault('network_access',inherited_network)
        direct=_mapping(trust,'mcp_servers').get('dpf')
        # A project server entry replaces the transport rather than deep-merging
        # it. Never synthesize a partial server or copy user auth into the repo.
        if isinstance(_mapping(c,'mcp_servers').get('dpf'),dict):
            c['mcp_servers']['dpf'].setdefault('default_tools_approval_mode',(direct or {}).get('default_tools_approval_mode','auto'))
        for name,plugin in _mapping(trust,'plugins').items():
            if name.startswith('dpf-platform@') and isinstance(plugin,dict):
                inherited=_mapping(_mapping(plugin,'mcp_servers'),'dpf')
                target=_table(_table(_table(_table(c,'plugins'),name),'mcp_servers'),'dpf')
                target.setdefault('default_tools_approval_mode',inherited.get('default_tools_approval_mode','auto'))
    codex_config=document(root/'.codex/config.toml','codex','toml',codex)
    path=root/'.codex/rules/dpf-routine.rules'
    raw=_bytes(path) if 'codex' in clients else None
    rules=MARKER+''.join('prefix_rule(pattern='+json.dumps(p)+', decision="allow")\n' for p in prefixes if p!=['node','scripts/'])
    if raw is not None:
        try:
            existing=raw.decode('utf-8-sig')
            if not existing.startswith(MARKER): raise ValueError()
            # Validate the supported literal prefix-rule subset without executing
            # user code. Preserve every existing deny/prompt rule and comment.
            parsed=ast.parse(existing)
            for statement in parsed.body:
                call=statement.value if isinstance(statement,ast.Expr) else None
                if not isinstance(call,ast.Call) or not isinstance(call.func,ast.Name) or call.func.id!='prefix_rule' or call.args: raise ValueError()
                fields={arg.arg:ast.literal_eval(arg.value) for arg in call.keywords}
                if set(fields)-{'pattern','decision','justification'} or fields.get('decision') not in ('allow','prompt','forbidden'): raise ValueError()
                if not isinstance(fields.get('pattern'),list) or any(not isinstance(x,str) for x in fields['pattern']): raise ValueError()
            additions=[line for line in rules.splitlines()[1:] if line not in existing.splitlines()]
            rules=existing.rstrip('\n')+'\n'+''.join(line+'\n' for line in additions)
        except (ValueError,UnicodeError,SyntaxError):
            raise PermissionPlanError('Existing dpf-routine.rules is unowned or unsupported; reconcile it without overwriting restrictions.') from None
    if 'codex' in clients: files.append(PlannedFile(path,raw,rules.encode('utf-8'),'codex'))
    shell_rules=['Bash('+' '.join(p)+'*)' if p==['node','scripts/'] else 'Bash('+' '.join(p)+' *)' for p in prefixes]
    claude_user,_=_load(home/'.claude/settings.json','json') if 'claude-code' in clients else ({},None)
    inherited_mode=_mapping(claude_user,'permissions').get('defaultMode')
    def claude(c):
        perms=_table(c,'permissions')
        perms.setdefault('defaultMode',inherited_mode or 'acceptEdits')
        if not isinstance(perms['defaultMode'],str): raise PermissionPlanError('Unsupported Claude permission mode.')
        for key in ('deny','ask'):
            if key in perms and (not isinstance(perms[key],list) or any(not isinstance(x,str) for x in perms[key])):
                raise PermissionPlanError('Unsupported Claude restriction list.')
        _merge_rules(perms,'allow',policy['claudeTools']+shell_rules+['mcp__'+s+'__*' for s in policy['claudeMcpServers']])
    cc=document(root/'.claude/settings.local.json','claude-code','json',claude)
    def grok(c):
        _merge_rules(_table(c,'permission'),'allow',policy['grokTools']+shell_rules+['MCPTool('+s+'__*)' for s in policy['grokMcpServers']])
    gc=document(root/'.grok/config.toml','grok','toml',grok)
    def grok_user(c):
        ui=_table(c,'ui')
        if not any(k in ui for k in ('permission_mode','approval_mode','yolo')): ui['permission_mode']='auto'
        _table(c,'sandbox').setdefault('profile','off' if sys.platform=='win32' else 'workspace')
    gu=document(home/'.grok/config.toml','grok','toml',grok_user)
    client_rows=(
        {'client':'codex','posture':_label(codex_config.get('sandbox_mode',codex_config.get('default_permissions',trust.get('default_permissions','existing-config-profile'))),('read-only','workspace-write','danger-full-access',':read-only',':workspace',':danger-full-access','existing-config-profile')),'approvalPolicy':_label(codex_config.get('approval_policy','selected-config-profile'),('never','on-request','untrusted','on-failure','selected-config-profile')),
         'reviewer':_label(codex_config.get('approvals_reviewer','selected-config-profile'),('user','auto_review','selected-config-profile')),'trust':_label(trust['projects'][str(root)].get('trust_level'),('trusted','untrusted')),
         'ruleCount':rules.count('prefix_rule('),'managedConstraints':'Host and managed requirements retain precedence; session policy is not established by these files.'},
        {'client':'claude-code','posture':_label(cc['permissions']['defaultMode'],('default','acceptEdits','plan','bypassPermissions','auto','dontAsk','delegate')),'ruleCount':len(cc['permissions']['allow']),
         'denyCount':len(cc['permissions'].get('deny',[])),'askCount':len(cc['permissions'].get('ask',[])),
         'trust':'existing-client-decision','managedConstraints':'Existing deny/ask, managed settings and hooks remain effective.'},
        {'client':'grok','posture':_label(gu['ui'].get('permission_mode','preserved-legacy'),('auto','ask','always-approve','preserved-legacy')),
         'sandbox':_label(gu['sandbox']['profile'],('off','workspace','read-only','strict','devbox')),'sandboxSupported':sys.platform!='win32',
         'ruleCount':len(gc['permission']['allow']),'trust':'pending-native-inspection',
         'managedConstraints':'Native inspection is required; managed rules, hooks and folder trust remain effective.'})
    return PermissionPlan(root,home,tuple(files),tuple(row for row in client_rows if row['client'] in clients))


def _atomic(path: Path, value: bytes) -> None:
    _safe(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    _safe(path)
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        with open(temporary,'xb') as out: out.write(value)
        os.chmod(temporary,0o600)
        _safe(path)
        os.replace(temporary,path)
    finally:
        if temporary.exists(): temporary.unlink()


def _grok_trust(root: Path, home: Path, dry_run: bool) -> dict:
    root,home=root.resolve(),home.resolve()
    binary=shutil.which('grok')
    if not binary or Path(binary).suffix.lower() in ('.cmd','.bat'):
        return {'trust':'native-inspection-unavailable','nativeInspection':False,'verification':'unrun'}
    # Never run a model turn. First inspect to preserve an explicit untrusted
    # decision. Native --trust is used only for a previously undecided project.
    try:
        def inspect(trust=False):
            result=subprocess.run([binary,*(['--trust'] if trust else []),'inspect','--json'],cwd=root,
                env={**os.environ,'GROK_HOME':str(home/'.grok')},capture_output=True,text=True,timeout=30)
            if result.returncode: raise ValueError()
            value=json.loads(result.stdout)
            if (not isinstance(value,dict) or not isinstance(value.get('projectTrusted'),bool)
                or not isinstance(value.get('projectRoot'),str) or Path(value['projectRoot']).resolve()!=root
                or not isinstance(value.get('permissions'),dict)):
                raise ValueError()
            return value
        before=inspect()
        folders=read_toml(home/'.grok/trusted_folders.toml')
        # The native store is read only to detect a prior explicit decision.
        decisions=_mapping(folders,'folders')
        decision=next((v for k,v in decisions.items() if root.is_relative_to(Path(k).resolve()) and isinstance(v,dict) and v.get('trusted') is False),None)
        if isinstance(decision,dict) and decision.get('trusted') is False and not before.get('projectTrusted',False):
            return {'trust':'existing-untrusted','nativeInspection':True,'constraint':'Explicit folder-trust decision retained.'}
        after=before if dry_run or before.get('projectTrusted',False) else inspect(True)
        return {'trust':'trusted' if after.get('projectTrusted',False) else 'unresolved','nativeInspection':True,
                'managedSettingsActive':after['permissions'].get('managedSettingsActive')}
    except (OSError,ValueError,subprocess.SubprocessError):
        return {'trust':'native-inspection-failed','action':'failed'}


def apply_permissions(plan: PermissionPlan, dry_run: bool, *, native: bool=False) -> list[dict]:
    for item in plan.files:
        if _bytes(item.path) != item.before:
            raise PermissionPlanError(f'Concurrent configuration edit; replan before applying: {item.path}')
    result=[{**client,'scope':'permissions:'+str(plan.root),'sessionVerified':False,
             'action':'planned' if dry_run else 'unchanged','restartRequired':False,'paths':[], 'backups':[]}
            for client in plan.clients]
    for item in plan.files:
        row=next(x for x in result if x['client']==item.client)
        row['paths'].append(str(item.path))
        if dry_run or not item.changed: continue
        if _bytes(item.path) != item.before: raise PermissionPlanError('Concurrent configuration edit; replan before applying.')
        if item.before is not None:
            backup=item.path.with_name(item.path.name+'.dpf-permissions-'+uuid.uuid4().hex+'.bak')
            _atomic(backup,item.before)
            row['backups'].append(str(backup))
        _atomic(item.path,item.after)
        row.update(action='updated',restartRequired=True)
    if native and any(x['client']=='grok' for x in result):
        grok=next(x for x in result if x['client']=='grok')
        grok.update(_grok_trust(plan.root,plan.home,dry_run))
    return result
