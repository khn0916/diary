"""Plan–Do–See server. Standard-library Python + SQLite, no login or demo records."""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SEOUL = timezone(timedelta(hours=9), 'Asia/Seoul')


class ValidationError(ValueError):
    pass


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def seoul_today():
    return datetime.now(SEOUL).date().isoformat()


def text(data, key, limit=2000, required=True):
    value = str(data.get(key, '')).strip()
    if (required and not value) or len(value) > limit:
        raise ValidationError(f'{key}: 필수 항목과 최대 {limit}자를 확인해주세요.')
    return value


def number(data, key, minimum=0, maximum=1000000):
    try:
        value = int(data.get(key, ''))
    except (TypeError, ValueError):
        raise ValidationError(f'{key}: 정수를 입력해주세요.') from None
    if not minimum <= value <= maximum:
        raise ValidationError(f'{key}: {minimum}~{maximum} 사이로 입력해주세요.')
    return value


def day(data, key):
    value = text(data, key, 10)
    try:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError
    except ValueError:
        raise ValidationError(f'{key}: YYYY-MM-DD 날짜를 입력해주세요.') from None
    return value


def period(data, first='start_date', last='end_date'):
    start, end = day(data, first), day(data, last)
    if start > end:
        raise ValidationError('종료일은 시작일 이후여야 합니다.')
    return start, end


def local_time(value):
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo or parsed.second or parsed.microsecond:
            raise ValueError
        return parsed.replace(tzinfo=SEOUL).astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        raise ValidationError('시작·종료 시각을 서울 시간 기준 분 단위로 입력해주세요.') from None


class Diary:
    def __init__(self, database):
        self.database = str(database)
        Path(database).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript((ROOT / 'schema.sql').read_text(encoding='utf-8'))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def plan(db, plan_id):
        row = db.execute('SELECT * FROM plans WHERE id=? AND deleted_at IS NULL', (plan_id,)).fetchone()
        if not row:
            raise ValidationError('계획을 찾을 수 없습니다. 목록을 새로고침해주세요.')
        return dict(row)

    @staticmethod
    def task(db, task_id):
        row = db.execute('''SELECT t.* FROM tasks t JOIN plans p ON p.id=t.plan_id
                            WHERE t.id=? AND t.deleted_at IS NULL AND p.deleted_at IS NULL''', (task_id,)).fetchone()
        if not row:
            raise ValidationError('할 일을 찾을 수 없습니다. 목록을 새로고침해주세요.')
        return dict(row)

    def plans(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute('SELECT * FROM plans WHERE deleted_at IS NULL ORDER BY start_date DESC,id DESC')]

    @staticmethod
    def version(db, plan_id):
        snapshot = Diary.plan(db, plan_id)
        version = db.execute('SELECT COALESCE(MAX(version),0)+1 FROM plan_versions WHERE plan_id=?', (plan_id,)).fetchone()[0]
        db.execute('INSERT INTO plan_versions(plan_id,version,snapshot_json,created_at) VALUES(?,?,?,?)',
                   (plan_id, version, json.dumps(snapshot, ensure_ascii=False), now()))

    def save_plan(self, data):
        start, end = period(data)
        values = (text(data, 'title', 200), start, end, number(data, 'priority', 1, 3),
                  text(data, 'success_criteria'), number(data, 'estimated_minutes'), now())
        with self.connect() as db:
            if data.get('id'):
                plan_id = number(data, 'id', 1)
                self.plan(db, plan_id)
                db.execute('''UPDATE plans SET title=?,start_date=?,end_date=?,priority=?,success_criteria=?,
                              estimated_minutes=?,updated_at=? WHERE id=?''', (*values, plan_id))
            else:
                plan_id = db.execute('''INSERT INTO plans(title,start_date,end_date,priority,success_criteria,
                                     estimated_minutes,updated_at,created_at) VALUES(?,?,?,?,?,?,?,?)''', (*values, now())).lastrowid
            self.version(db, plan_id)
            return plan_id

    def save_task(self, data):
        plan_id = number(data, 'plan_id', 1)
        values = (text(data, 'title', 200), day(data, 'due_date'), number(data, 'priority', 1, 3),
                  text(data, 'tags', 300, False), number(data, 'estimated_minutes'), now())
        with self.connect() as db:
            self.plan(db, plan_id)
            if data.get('id'):
                task_id = number(data, 'id', 1)
                task = self.task(db, task_id)
                if task['plan_id'] != plan_id:
                    raise ValidationError('할 일의 계획 연결은 변경할 수 없습니다.')
                db.execute('UPDATE tasks SET title=?,due_date=?,priority=?,tags=?,estimated_minutes=?,updated_at=? WHERE id=?', (*values, task_id))
            else:
                task_id = db.execute('INSERT INTO tasks(title,due_date,priority,tags,estimated_minutes,updated_at,plan_id,created_at) VALUES(?,?,?,?,?,?,?,?)', (*values, plan_id, now())).lastrowid
            return task_id

    def complete(self, task_id, completed):
        with self.connect() as db:
            self.task(db, task_id)
            # Desired state rather than toggle: repeated requests remain idempotent.
            if completed:
                db.execute('INSERT INTO completion_records(task_id,completed_at) VALUES(?,?) ON CONFLICT(task_id) DO NOTHING', (task_id, now()))
            else:
                db.execute('DELETE FROM completion_records WHERE task_id=?', (task_id,))
            db.execute('UPDATE tasks SET completed=?,updated_at=? WHERE id=?', (int(completed), now(), task_id))

    def save_execution(self, data):
        task_id = number(data, 'task_id', 1)
        start = local_time(text(data, 'started_at', 30))
        end = local_time(text(data, 'ended_at', 30))
        if end < start:
            raise ValidationError('종료 시각은 시작 시각 이후여야 합니다.')
        minutes = int((end-start).total_seconds() // 60)
        if minutes > 1000000:
            raise ValidationError('실행 시간이 너무 깁니다. 시각을 확인해주세요.')
        reason = text(data, 'blocked_reason', 2000, False)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self.task(db, task_id)
            if data.get('id'):
                execution_id = number(data, 'id', 1)
                row = db.execute('SELECT * FROM executions WHERE id=? AND task_id=? AND deleted_at IS NULL', (execution_id, task_id)).fetchone()
                if not row:
                    raise ValidationError('실행 기록을 찾을 수 없습니다.')
                db.execute('UPDATE executions SET started_at=?,ended_at=?,actual_minutes=?,blocked_reason=?,updated_at=? WHERE id=?',
                           (start.isoformat(), end.isoformat(), minutes, reason, now(), execution_id))
                return execution_id
            key = text(data, 'idempotency_key', 80)
            try:
                uuid.UUID(key)
            except ValueError:
                raise ValidationError('저장 요청을 확인할 수 없습니다. 입력 화면을 다시 열어주세요.') from None
            existing = db.execute('SELECT id,task_id FROM executions WHERE idempotency_key=?', (key,)).fetchone()
            if existing:
                if existing['task_id'] != task_id:
                    raise ValidationError('다른 할 일에서 사용한 저장 요청입니다.')
                return existing['id']
            return db.execute('''INSERT INTO executions(task_id,started_at,ended_at,actual_minutes,blocked_reason,
                              idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)''',
                              (task_id, start.isoformat(), end.isoformat(), minutes, reason, key, now(), now())).lastrowid

    def tasks(self, plan_id, start='', end=''):
        with self.connect() as db:
            self.plan(db, plan_id)
            rows = db.execute('''SELECT t.*,COALESCE((SELECT SUM(e.actual_minutes) FROM executions e
                   WHERE e.task_id=t.id AND e.deleted_at IS NULL),0) AS actual_minutes,
                   EXISTS(SELECT 1 FROM executions e WHERE e.task_id=t.id AND e.deleted_at IS NULL
                          AND trim(e.blocked_reason)<>'') AS blocked
                   FROM tasks t WHERE t.plan_id=? AND t.deleted_at IS NULL
                   AND (?='' OR t.due_date>=?) AND (?='' OR t.due_date<=?) ORDER BY t.id''',
                              (plan_id, start, start, end, end)).fetchall()
            return [dict(r) for r in rows]

    def summary(self, plan_id, start='', end='', today=None):
        tasks = self.tasks(plan_id, start, end)
        today = today or seoul_today()
        groups = {
            'planned': tasks,
            'completed': [t for t in tasks if t['completed']],
            'delayed': [t for t in tasks if not t['completed'] and t['due_date'] < today],
            'blocked': [t for t in tasks if t['blocked']],
        }
        values = {key: len(value) for key, value in groups.items()}
        values['estimated'] = sum(t['estimated_minutes'] for t in tasks)
        values['actual'] = sum(t['actual_minutes'] for t in tasks)
        values['difference'] = values['actual']-values['estimated']
        return values, groups

    def save_review(self, data):
        plan_id = number(data, 'plan_id', 1)
        start, end = period(data, 'from_date', 'to_date')
        values = (start, end, text(data, 'reflection'), text(data, 'improvement'), now())
        with self.connect() as db:
            self.plan(db, plan_id)
            if data.get('id'):
                review_id = number(data, 'id', 1)
                row = db.execute('SELECT * FROM reviews WHERE id=? AND plan_id=? AND deleted_at IS NULL', (review_id, plan_id)).fetchone()
                if not row:
                    raise ValidationError('회고를 찾을 수 없습니다.')
                db.execute('UPDATE reviews SET from_date=?,to_date=?,reflection=?,improvement=?,updated_at=? WHERE id=?', (*values, review_id))
                return review_id
            return db.execute('INSERT INTO reviews(from_date,to_date,reflection,improvement,updated_at,plan_id,created_at) VALUES(?,?,?,?,?,?,?)', (*values, plan_id, now())).lastrowid

    def next_plan(self, data):
        review_id = number(data, 'review_id', 1)
        start, end = period(data)
        title = text(data, 'title', 200)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            review = db.execute('SELECT * FROM reviews WHERE id=? AND deleted_at IS NULL', (review_id,)).fetchone()
            if not review:
                raise ValidationError('회고를 찾을 수 없습니다.')
            previous = self.plan(db, review['plan_id'])
            existing = db.execute('SELECT id FROM plans WHERE source_review_id=?', (review_id,)).fetchone()
            if existing:
                return existing['id']
            plan_id = db.execute('''INSERT INTO plans(title,start_date,end_date,priority,success_criteria,estimated_minutes,
                                source_review_id,improvement,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)''',
                                (title, start, end, previous['priority'], previous['success_criteria'], previous['estimated_minutes'],
                                 review_id, review['improvement'], now(), now())).lastrowid
            self.version(db, plan_id)
            return plan_id

    def delete(self, kind, record_id):
        tables = {'plan': 'plans', 'task': 'tasks', 'execution': 'executions', 'review': 'reviews'}
        if kind not in tables:
            raise ValidationError('삭제할 기록 종류를 확인해주세요.')
        with self.connect() as db:
            table = tables[kind]
            row = db.execute(f'SELECT * FROM {table} WHERE id=? AND deleted_at IS NULL', (record_id,)).fetchone()
            if not row:
                raise ValidationError('이미 삭제되었거나 없는 기록입니다.')
            if kind != 'plan':
                self.plan(db, row['plan_id'] if kind in ('task', 'review') else self.task(db, row['task_id'])['plan_id'])
            db.execute(f'UPDATE {table} SET deleted_at=?,updated_at=? WHERE id=?', (now(), now(), record_id))

    def details(self, plan_id):
        with self.connect() as db:
            plan = self.plan(db, plan_id)
            versions = [dict(r) for r in db.execute('SELECT * FROM plan_versions WHERE plan_id=? ORDER BY version', (plan_id,))]
            reviews = [dict(r) for r in db.execute('SELECT r.*,p.id AS next_plan_id FROM reviews r LEFT JOIN plans p ON p.source_review_id=r.id WHERE r.plan_id=? AND r.deleted_at IS NULL ORDER BY r.id DESC', (plan_id,))]
            return plan, versions, reviews

    def task_details(self, task_id):
        with self.connect() as db:
            task = self.task(db, task_id)
            executions = [dict(r) for r in db.execute('SELECT * FROM executions WHERE task_id=? AND deleted_at IS NULL ORDER BY started_at DESC,id DESC', (task_id,))]
            return task, executions

    def export(self):
        with self.connect() as db:
            # Reading all tables in one transaction gives a consistent snapshot.
            db.execute('BEGIN')
            tables = ['plans', 'plan_versions', 'tasks', 'completion_records', 'executions', 'reviews']
            return {'schema_version': 2, 'exported_at': now(), 'timezone': 'Asia/Seoul', 'duration_unit': 'minute',
                    'tables': {name: [dict(r) for r in db.execute(f'SELECT * FROM {name} ORDER BY 1')] for name in tables}}
