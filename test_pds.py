import json
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pds import Diary, ValidationError
from pds_views import NOTICE, dashboard, task_page
from write_contract import build_contract


class PDSTest(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.path=Path(self.directory.name)/'diary.sqlite3'
        self.diary=Diary(self.path)
        self.plan_data={'title':'검증용 <script>alert(1)</script>','start_date':'2026-11-01','end_date':'2026-11-30','priority':'2','success_criteria':'최초 기준','estimated_minutes':'120'}
        self.plan=self.diary.save_plan(self.plan_data)

    def tearDown(self):
        self.directory.cleanup()

    def task(self,**overrides):
        data={'plan_id':self.plan,'title':'Task','due_date':'2026-11-17','priority':'2','tags':'study, python','estimated_minutes':'30'}
        data.update(overrides)
        return self.diary.save_task(data)

    def execution_data(self,task,**overrides):
        data={'task_id':task,'started_at':'2026-11-18T09:00','ended_at':'2026-11-18T09:45','blocked_reason':'','idempotency_key':str(uuid.uuid4())}
        data.update(overrides)
        return data

    def test_history_and_reload(self):
        self.diary.save_plan({**self.plan_data,'id':self.plan,'title':'Revised','estimated_minutes':'180'})
        plan,versions,_=Diary(self.path).details(self.plan)
        self.assertEqual(plan['title'],'Revised')
        self.assertEqual(len(versions),2)
        self.assertEqual(json.loads(versions[0]['snapshot_json'])['title'],self.plan_data['title'])
        self.assertEqual(json.loads(versions[0]['snapshot_json'])['estimated_minutes'],120)
        self.assertEqual(plan['id'],self.plan)

    def test_concurrent_completion_and_undo(self):
        task=self.task()
        with ThreadPoolExecutor(max_workers=5) as pool:
            list(pool.map(lambda _:self.diary.complete(task,True),range(10)))
        with self.diary.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM completion_records').fetchone()[0],1)
        values,_=self.diary.summary(self.plan,today='2026-11-18')
        self.assertEqual((values['planned'],values['completed'],values['delayed']),(1,1,0))
        self.diary.complete(task,False)
        self.assertEqual(self.diary.summary(self.plan,today='2026-11-18')[0]['delayed'],1)
        self.diary.complete(task,True)
        self.assertEqual(self.diary.summary(self.plan)[0]['completed'],1)

    def test_execution_idempotency_and_plan_independence(self):
        task=self.task()
        data=self.execution_data(task,blocked_reason='<script>blocked()</script>')
        with ThreadPoolExecutor(max_workers=4) as pool:
            ids=list(pool.map(lambda _:self.diary.save_execution(data),range(8)))
        self.assertEqual(len(set(ids)),1)
        row,executions=self.diary.task_details(task)
        self.assertEqual(row['estimated_minutes'],30)
        self.assertEqual(len(executions),1)
        self.assertEqual(executions[0]['actual_minutes'],45)
        self.assertEqual(executions[0]['started_at'],'2026-11-18T00:00:00+00:00')
        self.assertEqual(self.diary.details(self.plan)[0]['estimated_minutes'],120)

    def test_aggregate_cohorts_and_soft_deletion(self):
        first=self.task()
        second=self.task(title='Future',due_date='2026-11-19',estimated_minutes='20')
        third=self.task(title='Deleted',estimated_minutes='900')
        self.diary.complete(first,True)
        self.diary.save_execution(self.execution_data(first,blocked_reason='blocked'))
        self.diary.save_execution(self.execution_data(first,ended_at='2026-11-18T09:15',blocked_reason='blocked again'))
        self.diary.delete('task',third)
        values,groups=self.diary.summary(self.plan,today='2026-11-18')
        self.assertEqual(values,{'planned':2,'completed':1,'delayed':0,'blocked':1,'estimated':50,'actual':60,'difference':10})
        self.assertEqual([t['id'] for t in groups['blocked']],[first])
        self.assertEqual(self.diary.summary(self.plan,'2026-11-19','2026-11-19')[0]['actual'],0)
        self.assertTrue(all(v==0 for v in self.diary.summary(self.plan,'2026-12-01','2026-12-31')[0].values()))
        log=self.diary.task_details(first)[1][0]
        self.diary.delete('execution',log['id'])
        self.assertEqual(self.diary.summary(self.plan)[0]['actual'],45)
        self.assertEqual(self.diary.task_details(second)[0]['id'],second)

    def test_validation(self):
        for data in [dict(self.plan_data,end_date='2026-10-01'),dict(self.plan_data,priority='4'),dict(self.plan_data,estimated_minutes='-1')]:
            with self.assertRaises(ValidationError):self.diary.save_plan(data)
        task=self.task()
        for fields in [{'ended_at':'2026-11-18T08:00'},{'started_at':'2026-11-18T09:00:30'},{'started_at':'2026-11-18T09:00+09:00'}]:
            with self.assertRaises(ValidationError):self.diary.save_execution(self.execution_data(task,**fields))

    def test_review_to_next_plan_and_export(self):
        task=self.task()
        execution=self.diary.save_execution(self.execution_data(task))
        review=self.diary.save_review({'plan_id':self.plan,'from_date':'2026-11-01','to_date':'2026-11-30','reflection':'Learning','improvement':'Start 15 minutes earlier'})
        data={'review_id':review,'title':'Next','start_date':'2026-12-01','end_date':'2026-12-31'}
        with ThreadPoolExecutor(max_workers=3) as pool:
            ids=list(pool.map(lambda _:self.diary.next_plan(data),range(6)))
        self.assertEqual(len(set(ids)),1)
        following=self.diary.details(ids[0])[0]
        self.assertEqual(following['source_review_id'],review)
        self.assertEqual(following['improvement'],'Start 15 minutes earlier')
        exported=Diary(self.path).export()
        self.assertEqual(exported['duration_unit'],'minute')
        self.assertEqual(exported['tables']['executions'][0]['id'],execution)
        self.assertEqual(exported['tables']['executions'][0]['task_id'],task)
        self.assertEqual(exported['tables']['tasks'][0]['plan_id'],self.plan)

    def test_views_escape_and_sort_evidence(self):
        self.task(title='<img src=x onerror=alert(1)>',priority=3)
        self.task(title='High priority',priority=1)
        html=dashboard(self.diary,{'plan':str(self.plan),'sort':'priority'},'testtoken')
        self.assertIn(NOTICE,html)
        self.assertNotIn('<script>alert(1)</script>',html)
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;',html)
        self.assertNotIn('<img src=x',html)
        self.assertIn('&lt;img src=x onerror=alert(1)&gt;',html)
        self.assertLess(html.index('High priority'),html.index('&lt;img src=x'))
        self.assertEqual(html.count('class="metric"'),7)
        self.assertIn('metric=actual',html)
        self.assertIn('우선순위 높은 순',html)

    def test_task_and_execution_edit_delete(self):
        task=self.task()
        self.diary.save_task({'id':task,'plan_id':self.plan,'title':'Changed','due_date':'2026-11-20','priority':1,'tags':'new','estimated_minutes':15})
        record=self.diary.save_execution(self.execution_data(task))
        self.diary.save_execution(self.execution_data(task,id=record,ended_at='2026-11-18T09:20',blocked_reason='Waiting'))
        data,logs=self.diary.task_details(task)
        self.assertEqual((data['title'],data['estimated_minutes'],logs[0]['actual_minutes']),('Changed',15,20))
        self.assertIn('Waiting',task_page(self.diary,task,'token'))
        self.diary.delete('plan',self.plan)
        with self.assertRaises(ValidationError):self.diary.task_details(task)
        self.assertEqual(self.diary.plans(),[])

    def test_contract_matches_schema(self):
        checked_in=json.loads((Path(__file__).parent/'contracts'/'pds-schema-v2.json').read_text(encoding='utf-8'))
        self.assertEqual(checked_in,build_contract())


if __name__ == '__main__':
    unittest.main()
