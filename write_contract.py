"""Regenerate the checked-in database contract from the real schema."""
import json
import sqlite3
from pathlib import Path

from pds import ROOT


def build_contract():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    db.executescript((ROOT/'schema.sql').read_text(encoding='utf-8'))
    tables = {}
    for name in ['plans','plan_versions','tasks','completion_records','executions','reviews']:
        tables[name] = {
            'columns': [dict(row) for row in db.execute(f'PRAGMA table_info({name})')],
            'foreign_keys': [dict(row) for row in db.execute(f'PRAGMA foreign_key_list({name})')],
            'ddl': db.execute('SELECT sql FROM sqlite_master WHERE type=? AND name=?',('table',name)).fetchone()[0],
            'indexes': [dict(row) for row in db.execute(f'PRAGMA index_list({name})')],
        }
    db.close()
    return {
        'schema_version':2,
        'engine':'SQLite',
        'source':'schema.sql',
        'login':False,
        'visibility':'All visitors can view, create, modify, delete and export the shared PDS data. No access control.',
        'scope':'PDS records only; the original paper diary remains unchanged and stores its own notes in browser localStorage.',
        'date_rules':{
            'timezone':'Asia/Seoul (UTC+09:00)',
            'calendar_dates':'YYYY-MM-DD, inclusive start/end; no UTC conversion for dates.',
            'timestamps':'ISO 8601 UTC with explicit +00:00; input and display use Seoul time.',
            'execution_precision':'Whole minutes; reject seconds, fractional seconds and timezone offsets in local input.',
            'delayed':'Incomplete, not deleted, due_date < current calendar date in Seoul. Completed tasks are excluded.',
            'period_scope':'Selected plan, non-deleted tasks with due_date in the inclusive filter period. Blank bounds are unbounded.',
            'actual_scope':'Sum all non-deleted executions linked to the selected task cohort, regardless of execution date.',
        },
        'units':{'estimated_minutes':'integer minute >= 0','actual_minutes':'integer minute = (ended_at-started_at)/60','priority':{'1':'high','2':'normal','3':'low'}},
        'aggregations':{
            'planned':'Count of non-deleted tasks in cohort, not count of plan rows.',
            'completed':'Count of cohort tasks with completed=1.',
            'delayed':'Count of incomplete cohort tasks overdue in Seoul.',
            'blocked':'Count of distinct cohort tasks with at least one non-deleted execution having a non-blank blocked_reason.',
            'estimated':'Sum tasks.estimated_minutes in cohort, empty=0.',
            'actual':'Sum executions.actual_minutes for non-deleted executions in cohort, empty=0.',
            'difference':'actual-estimated, empty=0.',
            'evidence':'Every metric links to the exact cohort or corresponding subset; each task links to all its execution records.',
            'sorting':'Server side. due=(due_date,id); priority=(priority,due_date,id); created=(-id); estimate=(estimated_minutes,id).',
        },
        'integrity':{
            'plan_history':'Stable plan ID; append a full immutable snapshot at creation and after each edit. Version 1 preserves original.',
            'task_completion':'Set desired completed state, never toggle blindly; completion_records.task_id is unique. Undo removes current completion record.',
            'execution_idempotency':'executions.idempotency_key unique; serialized write transaction returns original ID on duplicate request.',
            'next_plan':'plans.source_review_id unique; copy improvement into next plan and link to original review; repeated request returns original plan.',
            'deletion':'Soft delete plan/task/execution/review, exclude deleted data from UI and aggregates; export retains audit rows.',
            'review':'Reflection + improvement + inclusive date bounds + plan reference. Metrics are recomputed from current records, not frozen historical totals.',
            'estimated_values':'Execution records never overwrite a task or plan estimate.',
        },
        'tables':tables,
    }


if __name__ == '__main__':
    target=ROOT/'contracts'/'pds-schema-v2.json'
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(build_contract(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(target)
