"""Local HTTP integration tests. All records use a disposable temporary DB."""
import http.client
import json
import re
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.parse import urlencode

from server import create_server


class HTTPTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.server=create_server(('127.0.0.1',0),Path(self.temp.name)/'http.sqlite3')
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.port=self.server.server_port
        self.cookie=''
        self.token=''

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self,path,fields=None,extra=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.port,timeout=5)
        headers={'Cookie':self.cookie}
        body=None
        if fields is not None:
            body=urlencode({'csrf':self.token,**fields})
            headers['Content-Type']='application/x-www-form-urlencoded'
        headers.update(extra or {})
        conn.request('POST' if fields is not None else 'GET',path,body,headers)
        response=conn.getresponse()
        status=response.status
        returned=dict(response.getheaders())
        payload=response.read().decode('utf-8')
        if returned.get('Set-Cookie'):
            self.cookie=returned['Set-Cookie'].split(';',1)[0]
            self.token=self.cookie.split('=',1)[1]
        conn.close()
        return status,returned,payload

    def test_end_to_end_crud_and_export(self):
        status,_,html=self.request('/pds')
        self.assertEqual(status,200)
        self.assertIn('첫 계획을 기다리고 있어요',html)
        status,headers,_=self.request('/pds/plan',{'title':'HTTP real-flow test','start_date':'2026-11-01','end_date':'2026-11-30','priority':'1','success_criteria':'Test success','estimated_minutes':'60'})
        self.assertEqual(status,303)
        dashboard=headers['Location']
        status,_,html=self.request(dashboard)
        self.assertEqual(status,200)
        self.assertIn('HTTP real-flow test',html)
        status,headers,_=self.request('/pds/task',{'plan_id':'1','title':'HTTP task','due_date':'2026-11-18','priority':'2','tags':'test','estimated_minutes':'30'})
        self.assertEqual(status,303)
        status,_,html=self.request(headers['Location'])
        key=re.search(r'name="idempotency_key" value="([^"]+)"',html)[1]
        fields={'task_id':'1','started_at':'2026-11-18T09:00','ended_at':'2026-11-18T09:20','blocked_reason':'<script>alert(1)</script>','idempotency_key':key}
        self.assertEqual(self.request('/pds/execution',fields)[0],303)
        self.assertEqual(self.request('/pds/execution',fields)[0],303)
        for _ in range(2):
            self.assertEqual(self.request('/pds/complete',{'task_id':'1','plan_id':'1','completed':'1'})[0],303)
        status,_,html=self.request('/pds/task?id=1')
        self.assertEqual(status,200)
        self.assertNotIn('<script>alert(1)</script>',html)
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;',html)
        self.assertIn('20분',html)
        status,headers,payload=self.request('/pds/export')
        self.assertEqual(status,200)
        self.assertIn('attachment',headers['Content-Disposition'])
        exported=json.loads(payload)
        self.assertEqual(len(exported['tables']['executions']),1)
        self.assertEqual(len(exported['tables']['completion_records']),1)
        self.assertEqual(exported['tables']['tasks'][0]['completed'],1)
        self.assertEqual(self.request('/pds?plan=1&metric=actual')[0],200)

    def test_csrf_validation_private_files_and_original(self):
        self.request('/pds')
        for path in ['/data/diary.sqlite3','/.git/config','/server.py','/../schema.sql','/test_pds.py']:
            self.assertEqual(self.request(path)[0],404)
        self.assertEqual(self.request('/pds/plan',{'csrf':'wrong'})[0],403)
        self.assertEqual(self.request('/pds/plan',{},extra={'Origin':'https://example.invalid'})[0],403)
        self.assertEqual(self.request('/pds/plan',{'title':'incomplete'})[0],422)
        status,headers,html=self.request('/')
        self.assertEqual(status,200)
        self.assertEqual(html,(Path(__file__).parent/'index.html').read_bytes().decode('utf-8'))
        self.assertIn("script-src 'self'",headers['Content-Security-Policy'])
        self.assertEqual(self.request('/contracts/pds-schema-v2.json')[0],200)


if __name__=='__main__':
    unittest.main()
