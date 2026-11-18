"""Server-rendered forms. User content is always escaped, never interpreted as HTML."""
import json
import uuid
from datetime import datetime, timedelta
from html import escape
from urllib.parse import urlencode

from pds import SEOUL, seoul_today

NOTICE = '지금은 로그인이 없어 링크를 아는 사람은 누구나 볼 수 있습니다. 남이 봐도 괜찮은 내용만 넣으세요'
PRIORITIES = {1: '높음', 2: '보통', 3: '낮음'}
METRICS = {'planned': '계획 수', 'completed': '완료 수', 'delayed': '지연 수', 'blocked': '막힘 수',
           'estimated': '예상 시간', 'actual': '실제 시간', 'difference': '실제 − 예상'}
SORTS = {'due': '마감일 빠른 순 · 같은 날짜는 ID 순', 'priority': '우선순위 높은 순 · 마감일 · ID 순',
         'created': '등록 최신 순 · ID 역순', 'estimate': '예상 시간 짧은 순 · ID 순'}


def e(value):
    return escape(str(value), quote=True)


def link(path, **query):
    return e(path + ('?' + urlencode(query) if query else ''))


def hidden(name, value):
    return f'<input type="hidden" name="{e(name)}" value="{e(value)}">'


def field(label, name, value='', kind='text', required=True, extra=''):
    attrs = ' required' if required else ''
    if kind == 'textarea':
        control = f'<textarea name="{e(name)}" maxlength="2000"{attrs}>{e(value)}</textarea>'
    else:
        control = f'<input type="{e(kind)}" name="{e(name)}" value="{e(value)}"{attrs} {extra}>'
    return f'<label class="pds-field"><span>{e(label)}</span>{control}</label>'


def options(name, items, selected, label):
    return f'<label class="pds-field"><span>{e(label)}</span><select name="{e(name)}">' + ''.join(
        f'<option value="{e(key)}" {"selected" if str(key)==str(selected) else ""}>{e(value)}</option>' for key, value in items.items()) + '</select></label>'


def form(action, token, content, button='저장하기', context=''):
    return f'<form method="post" action="{e(action)}" class="pds-form">{hidden("csrf",token)}{context}{content}<button class="pds-button">{e(button)}</button></form>'


def delete_form(kind, record_id, token, plan_id, task_id=''):
    content = hidden('kind', kind)+hidden('id', record_id)+hidden('plan_id', plan_id)+hidden('task_id', task_id)
    # A checkbox avoids an accidental destructive submit; records remain soft deleted in DB.
    content += '<label class="delete-confirm"><input type="checkbox" name="confirm" value="yes" required> 삭제 확인</label>'
    return form('/pds/delete', token, content, '삭제', '')


def layout(title, content, status=200):
    return f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)} · 여백 Plan–Do–See</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pds.css"></head>
<body><div class="workspace pds-workspace"><header class="toolbar"><a class="brand" href="/">▤ 여백 <span class="brand-caption">나의 작은 다이어리</span></a>
<nav class="pds-nav"><a href="/">종이 다이어리</a><a href="/pds">계획 · 실행 · 회고</a><a href="/pds/export">전체 기록 내보내기 ↓</a></nav></header>
<p class="public-notice" role="note">{NOTICE}</p><main class="pds-paper"><header class="pds-heading"><span class="eyebrow">PLAN · DO · SEE</span><h1>{e(title)}</h1><p>계획을 세우고, 하루를 실행하고, 다음 페이지에 배움을 남겨요.</p></header>
{content}</main><footer class="pds-footer">서울 시간 · 시간 단위: 분 · 서버 SQLite 저장 · 원래 종이 다이어리는 그대로 유지됩니다.</footer></div></body></html>'''


def plan_fields(plan=None):
    p = plan or {}
    return (field('계획 이름', 'title', p.get('title', ''), extra='maxlength="200"')+
            '<div class="pds-row">'+field('시작일', 'start_date', p.get('start_date', seoul_today()), 'date')+
            field('종료일', 'end_date', p.get('end_date', seoul_today()), 'date')+'</div><div class="pds-row">'+
            options('priority', PRIORITIES, p.get('priority', 2), '우선순위')+
            field('계획 전체 예상 시간 (분)', 'estimated_minutes', p.get('estimated_minutes', 0), 'number', extra='min="0" max="1000000"')+'</div>'+
            field('성공 기준', 'success_criteria', p.get('success_criteria', ''), 'textarea'))


def task_fields(plan_id, task=None):
    t = task or {}
    return (hidden('plan_id', plan_id)+hidden('id', t.get('id', ''))+
            field('할 일', 'title', t.get('title', ''), extra='maxlength="200"')+
            '<div class="pds-row">'+field('마감일', 'due_date', t.get('due_date', seoul_today()), 'date')+
            options('priority', PRIORITIES, t.get('priority', 2), '우선순위')+'</div><div class="pds-row">'+
            field('태그 (쉼표로 구분)', 'tags', t.get('tags', ''), required=False, extra='maxlength="300"')+
            field('예상 시간 (분)', 'estimated_minutes', t.get('estimated_minutes', 0), 'number', extra='min="0" max="1000000"')+'</div>')


def dashboard(diary, query, token):
    plans = diary.plans()
    plan_id = query.get('plan', '')
    if not plan_id and plans:
        plan_id = str(plans[0]['id'])
    new_plan = '<details class="pds-card" '+('open' if not plans else '')+'><summary>새 계획 등록</summary>'+form('/pds/plan', token, plan_fields(), '계획 등록하기')+'</details>'
    if not plan_id:
        return layout('나의 계획 노트', '<div class="empty-state"><span>❧</span><h2>첫 계획을 기다리고 있어요.</h2><p>예시 기록은 넣지 않았습니다. 공개해도 괜찮은 실제 계획을 등록해주세요.</p></div>'+new_plan)
    plan, versions, reviews = diary.details(int(plan_id))
    plan_id = plan['id']
    start, end = query.get('from', ''), query.get('to', '')
    from pds import day, ValidationError
    if start:
        day({'from': start}, 'from')
    if end:
        day({'to': end}, 'to')
    if start and end and start > end:
        raise ValidationError('조회 종료일은 시작일 이후여야 합니다.')
    values, groups = diary.summary(plan_id, start, end)
    filters = ('<form method="get" action="/pds" class="pds-filters">'+
               options('plan', {p['id']: p['title'] for p in plans}, plan_id, '계획 선택')+
               field('집계 시작 (할 일 마감일)', 'from', start, 'date', False)+field('집계 종료', 'to', end, 'date', False)+
               '<button class="pds-button">기간 적용</button></form>')
    improvement = f'<p class="improvement">이전 회고 #{e(plan["source_review_id"])}에서 가져온 개선점: {e(plan["improvement"])}</p>' if plan['source_review_id'] else ''
    overview = f'<section class="pds-card"><span class="eyebrow">PLAN #{plan_id}</span><h2>{e(plan["title"])}</h2><p>{e(plan["start_date"])} ~ {e(plan["end_date"])} · 우선순위 {PRIORITIES[plan["priority"]]} · 계획 예상 {plan["estimated_minutes"]}분</p><p class="preserve-lines">성공 기준: {e(plan["success_criteria"])}</p>{improvement}<p class="subtle">아래 예상 시간 집계는 개별 할 일의 예상 시간 합계입니다.</p></section>'
    cards = '<section class="metric-grid" aria-label="회고 집계">'+''.join(
        f'<a class="metric" href="{link("/pds",plan=plan_id,**{"from":start,"to":end,"metric":key})}#evidence"><span>{label}</span><strong>{values[key]}<small>{"분" if key in ("estimated","actual","difference") else "건"}</small></strong><span>근거 기록 보기 ↗</span></a>' for key, label in METRICS.items())+'</section>'
    metric = query.get('metric', '')
    tasks = groups.get(metric, groups['planned'])
    search, state, tag = query.get('q', '').strip(), query.get('state', ''), query.get('tag', '').strip()
    sort = query.get('sort', 'due')
    if sort not in SORTS:
        sort = 'due'
    # Evidence links retain their exact aggregate cohort; extra search filters are explicit.
    if search:
        tasks = [t for t in tasks if search.casefold() in (t['title']+' '+t['tags']).casefold()]
    if tag:
        tasks = [t for t in tasks if tag.casefold() in [x.strip().casefold() for x in t['tags'].split(',')]]
    if state:
        tasks = [t for t in tasks if (state == 'done' and t['completed']) or (state == 'open' and not t['completed'])]
    keys = {'due': lambda t: (t['due_date'], t['id']), 'priority': lambda t: (t['priority'],t['due_date'],t['id']),
            'created': lambda t: -t['id'], 'estimate': lambda t: (t['estimated_minutes'],t['id'])}
    tasks = sorted(tasks, key=keys[sort])
    controls = '<form method="get" action="/pds#evidence" class="pds-filters">'+''.join(hidden(k,v) for k,v in {'plan':plan_id,'from':start,'to':end,'metric':metric}.items())
    controls += field('제목·태그 검색', 'q', search, required=False)+options('state', {'':'전체 상태','open':'미완료','done':'완료'},state,'상태')+field('태그 일치', 'tag', tag, required=False)+options('sort',SORTS,sort,'정렬 기준')+'<button class="pds-button">조회</button></form>'
    rows = ''
    for t in tasks:
        status = '완료' if t['completed'] else ('지연' if t['due_date'] < seoul_today() else '진행 중')
        completion = form('/pds/complete',token,hidden('task_id',t['id'])+hidden('completed',0 if t['completed'] else 1)+hidden('plan_id',plan_id),'완료 취소' if t['completed'] else '완료 처리')
        rows += f'<tr><td><a href="{link("/pds/task",id=t["id"])}"><b>#{t["id"]} {e(t["title"])}</b></a><span class="table-note">{e(t["tags"])}</span></td><td>{e(t["due_date"])}</td><td>{PRIORITIES[t["priority"]]}</td><td>{status}{" · 막힘" if t["blocked"] else ""}</td><td>{t["estimated_minutes"]} / {t["actual_minutes"]}분</td><td>{completion}</td></tr>'
    table = f'<section class="pds-card" id="evidence"><h2>{e(METRICS.get(metric,"할 일"))} · 근거 기록</h2><p class="subtle">집계 대상은 선택 계획의 삭제되지 않은 할 일이며, 기간은 마감일 기준입니다. 실제 시간은 대상 할 일의 모든 유효 실행 기록 합계입니다. 제목을 누르면 연결된 실행 기록이 보입니다.</p>{controls}<p class="sort-label">정렬: {e(SORTS[sort])} · 검색 결과 {len(tasks)}건</p><div class="table-scroll"><table><thead><tr><th>할 일 / 태그</th><th>마감일</th><th>우선순위</th><th>상태</th><th>예상 / 실제</th><th>처리</th></tr></thead><tbody>{rows or "<tr><td colspan=\"6\">해당하는 기록이 없습니다.</td></tr>"}</tbody></table></div></section>'
    history = ''
    for version in versions:
        snapshot = json.loads(version['snapshot_json'])
        history += f'<article class="history-item"><h3>버전 {version["version"]}{" · 최초 계획" if version["version"]==1 else ""}</h3><p>{e(snapshot["title"])}</p><p>{e(snapshot["start_date"])} ~ {e(snapshot["end_date"])} · 우선순위 {PRIORITIES[snapshot["priority"]]} · {snapshot["estimated_minutes"]}분</p><p class="preserve-lines">{e(snapshot["success_criteria"])}</p><small>{e(version["created_at"])}</small></article>'
    edits = '<div class="pds-two"><details class="pds-card"><summary>계획 수정 · 최초 계획과 이력 보존</summary>'+form('/pds/plan',token,hidden('id',plan_id)+plan_fields(plan),'계획 수정 및 이력 저장')+'<h3>수정 이력</h3>'+history+delete_form('plan',plan_id,token,plan_id)+'</details><details class="pds-card"><summary>이 계획에 할 일 추가</summary>'+form('/pds/task',token,task_fields(plan_id),'할 일 추가')+'</details></div>'
    review_cards = ''
    for r in reviews:
        review_cards += f'<article class="history-item"><h3>회고 #{r["id"]} · {e(r["from_date"])} ~ {e(r["to_date"])}</h3><p class="preserve-lines">{e(r["reflection"])}</p><p class="improvement">다음에 바꿀 한 가지: {e(r["improvement"])}</p>'
        review_cards += f'<p><a href="{link("/pds",plan=plan_id,**{"from":r["from_date"],"to":r["to_date"]})}#evidence">이 회고 기간의 집계와 근거 확인 ↗</a></p>'
        if r['next_plan_id']:
            review_cards += f'<a class="pds-button" href="{link("/pds",plan=r["next_plan_id"])}">반영된 다음 계획 #{r["next_plan_id"]} 열기</a>'
        else:
            next_start = (datetime.fromisoformat(r['to_date'])+timedelta(days=1)).date().isoformat()
            content = hidden('review_id',r['id'])+field('다음 계획 이름','title',f'{plan["title"]} · 다음 계획',extra='maxlength="200"')+'<div class="pds-row">'+field('다음 계획 시작','start_date',next_start,'date')+field('종료','end_date',next_start,'date')+'</div><p class="subtle">위 개선점을 다음 계획에 연결해 보존합니다. 성공 기준과 예상 시간은 생성 후 수정할 수 있습니다.</p>'
            review_cards += '<details><summary>개선점을 다음 계획에 반영하기</summary>'+form('/pds/next-plan',token,content,'개선점으로 다음 계획 만들기')+'</details>'
        review_edit = hidden('id',r['id'])+hidden('plan_id',plan_id)+'<div class="pds-row">'+field('회고 시작','from_date',r['from_date'],'date')+field('회고 종료','to_date',r['to_date'],'date')+'</div>'+field('회고','reflection',r['reflection'],'textarea')+field('개선점 한 줄','improvement',r['improvement'],'textarea')
        review_cards += '<details><summary>회고 수정</summary>'+form('/pds/review',token,review_edit,'회고 수정')+'</details>'+delete_form('review',r['id'],token,plan_id)+'</article>'
    review_fields = hidden('plan_id',plan_id)+'<div class="pds-row">'+field('회고 시작','from_date',start or plan['start_date'],'date')+field('회고 종료','to_date',end or plan['end_date'],'date')+'</div>'+field('예상과 실제의 차이에서 배운 점','reflection',kind='textarea')+field('다음 계획에 반영할 개선점 한 줄','improvement',kind='textarea')
    see = '<section class="pds-card"><span class="eyebrow">SEE → NEXT PLAN</span><h2>다음 페이지를 위한 회고</h2><p class="subtle">회고 기간과 위 집계 기간을 맞춰 확인한 뒤 기록해주세요. 회고를 저장하면 개선점을 다음 계획에 연결할 수 있습니다.</p>'+form('/pds/review',token,review_fields,'회고 저장')+review_cards+'</section>'
    return layout('계획 · 실행 · 회고',filters+overview+cards+edits+table+see+new_plan)


def display_time(value, local_input=False):
    dt = datetime.fromisoformat(value).astimezone(SEOUL)
    return dt.strftime('%Y-%m-%dT%H:%M' if local_input else '%Y-%m-%d %H:%M')


def execution_fields(task_id, record=None):
    r = record or {}
    return (hidden('task_id',task_id)+hidden('id',r.get('id',''))+hidden('idempotency_key',str(uuid.uuid4()))+
            '<div class="pds-row">'+field('시작 시각 (서울)','started_at',display_time(r['started_at'],True) if r else '', 'datetime-local')+
            field('종료 시각 (서울)','ended_at',display_time(r['ended_at'],True) if r else '', 'datetime-local')+'</div>'+
            field('막힘 사유 (없으면 비워두세요)','blocked_reason',r.get('blocked_reason',''),'textarea',False)+
            '<p class="subtle">실제 소요 시간은 시작·종료 시각의 차이를 분으로 계산합니다. 원래 예상 시간은 변경하지 않습니다.</p>')


def task_page(diary, task_id, token):
    task, executions = diary.task_details(task_id)
    plan_id = task['plan_id']
    records = ''
    for r in executions:
        records += f'<article class="history-item" id="execution-{r["id"]}"><h3>실행 #{r["id"]} · {r["actual_minutes"]}분</h3><p>{e(display_time(r["started_at"]))} → {e(display_time(r["ended_at"]))} (서울)</p><p class="preserve-lines">막힘 사유: {e(r["blocked_reason"] or "없음")}</p><details><summary>실행 기록 수정</summary>'+form('/pds/execution',token,execution_fields(task_id,r),'실행 수정')+'</details>'+delete_form('execution',r['id'],token,plan_id,task_id)+'</article>'
    body = f'<a href="{link("/pds",plan=plan_id)}#evidence">← 계획 #{plan_id}의 근거 기록으로</a><section class="pds-card"><h2>할 일 #{task_id} · {e(task["title"])}</h2><p>예상 {task["estimated_minutes"]}분 · 실제 합계 {sum(r["actual_minutes"] for r in executions)}분 · 연결 계획 #{plan_id}</p>'+form('/pds/task',token,task_fields(plan_id,task),'할 일 수정')+delete_form('task',task_id,token,plan_id)+'</section><div class="pds-two"><section class="pds-card"><h2>실제 실행 기록하기</h2>'+form('/pds/execution',token,execution_fields(task_id),'실행 기록 저장')+'</section><section class="pds-card"><h2>연결된 실행 기록</h2>'+(records or '<p class="subtle">아직 실행 기록이 없습니다.</p>')+'</section></div>'
    return layout('실행 노트',body)
