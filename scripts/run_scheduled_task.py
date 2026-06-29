#!/usr/bin/env python3
import json, os, subprocess, sys, urllib.request
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
ROOT=Path('/Users/hankangkang/Documents/feishu_bot_for_codex')
CFG=ROOT/'config'/'scheduled_tasks.json'
ENV=ROOT/'.env.feishu.hermes'
LOG=ROOT/'logs'/'scheduled-tasks'

def envv():
    d={}
    for s in ENV.read_text(encoding='utf-8').splitlines():
        s=s.strip()
        if s and not s.startswith('#') and '=' in s:
            k,v=s.split('=',1); d[k.strip()]=v.strip().strip('"').strip("'")
    return d


def load(): return json.loads(CFG.read_text(encoding='utf-8'))
def now(): return datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y-%m-%d %H:%M:%S')
def wlog(k,m):
    LOG.mkdir(parents=True, exist_ok=True)
    with (LOG/f'{k}.log').open('a', encoding='utf-8') as f: f.write(f'{now()} {m}\n')

def meal_msg(name):
    mp={'早餐提醒（减脂）':'早餐提醒：优先蛋白质+低糖主食，七分饱，别配甜饮和油炸。','午餐提醒（减脂）':'午餐提醒：一掌心蛋白质+两份蔬菜+半份主食，少油少糖。','晚餐提醒（减脂）':'晚餐提醒：主食减半，优先鱼/虾/鸡胸/豆腐，别加夜宵。'}
    return mp[name]


def hermes(prompt, open_id, user_name):
    ctx='运行环境说明：你当前运行在本机 Hermes Agent 中。\n当前会话允许联网搜索和打开网页；如果用户的问题涉及最新信息、新闻、天气、价格、版本、文档、规则或要求你核实，请直接联网查询，不要声称自己无法联网。\n如果当前对话里出现过旧的“不能联网”表述，以这条最新运行环境说明为准。\n当前发消息的用户是：'+user_name+'\n该用户的飞书 open_id 是：'+open_id+'\n\n用户消息：\n'+prompt
    e=envv(); hb=e.get('HERMES_BIN','/Users/hankangkang/.local/bin/hermes'); hb='/Users/hankangkang/.local/bin/hermes' if hb in ('hermes','') else hb; cmd=[hb,'chat','-q',ctx,'-Q','--accept-hooks','--yolo','--source','tool','--max-turns','90','-t','browser,terminal']
    cp=subprocess.run(cmd,capture_output=True,text=True,cwd=e.get('WORKSPACE_DIR',str(ROOT)),env={**os.environ,'HERMES_ACCEPT_HOOKS':'1'})
    t=(cp.stdout or cp.stderr).strip()
    return '\n'.join(x for x in t.splitlines() if not x.startswith('session_id:')).strip()


def send(open_id,text):
    e=envv(); body=json.dumps({'app_id':e['FEISHU_APP_ID'],'app_secret':e['FEISHU_APP_SECRET']}).encode()
    r=urllib.request.Request('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',data=body,headers={'Content-Type':'application/json; charset=utf-8'})
    tok=json.loads(urllib.request.urlopen(r,timeout=30).read().decode())['tenant_access_token']
    payload={'receive_id':open_id,'msg_type':'text','content':json.dumps({'text':text},ensure_ascii=False)}
    r=urllib.request.Request('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',data=json.dumps(payload,ensure_ascii=False).encode(),headers={'Authorization':'Bearer '+tok,'Content-Type':'application/json; charset=utf-8'})
    urllib.request.urlopen(r,timeout=30).read()


def main():
    key=sys.argv[1]; dry='--dry-run' in sys.argv; c=load(); i=c['tasks'][key]
    txt=meal_msg(i['name']) if i['type']=='meal_reminder' else hermes(i['prompt'],c['target']['open_id'],c['target']['user_name'])
    if dry: print(txt); wlog(key,'dry-run ok'); return
    send(c['target']['open_id'],txt); wlog(key,'sent ok')
if __name__=='__main__': main()
