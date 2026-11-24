"""Run: python server.py. Original diary: / ; Python PDS app: /pds."""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import sqlite3
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

from pds import Diary, ROOT, ValidationError, number
from pds_views import dashboard, e, layout, task_page

STATIC = {'/': ('index.html', 'text/html; charset=utf-8'),
          '/index.html': ('index.html', 'text/html; charset=utf-8'),
          '/style.css': ('style.css', 'text/css; charset=utf-8'),
          '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
          '/holidays.js': ('holidays.js', 'text/javascript; charset=utf-8'),
          '/diary-navigation.css': ('diary-navigation.css', 'text/css; charset=utf-8'),
          '/cover.css': ('cover.css', 'text/css; charset=utf-8'),
          '/diary-auth.css': ('diary-auth.css', 'text/css; charset=utf-8'),
          '/diary-auth.js': ('diary-auth.js', 'text/javascript; charset=utf-8'),
          '/cover.js': ('cover.js', 'text/javascript; charset=utf-8'),
          '/assets/login-rabbit.svg': ('assets/login-rabbit.svg', 'image/svg+xml'),
          '/assets/rabbit-flowers.svg': ('assets/rabbit-flowers.svg', 'image/svg+xml'),
          '/pds/index.html': ('pds/index.html', 'text/html; charset=utf-8'),
          '/pds-model.js': ('pds-model.js', 'text/javascript; charset=utf-8'),
          '/pds-storage.js': ('pds-storage.js', 'text/javascript; charset=utf-8'),
          '/pds-web.js': ('pds-web.js', 'text/javascript; charset=utf-8'),
          '/pds.css': ('pds.css', 'text/css; charset=utf-8'),
          '/contracts/pds-schema-v2.json': ('contracts/pds-schema-v2.json','application/json; charset=utf-8')}


def single_fields(encoded):
    values = parse_qs(encoded, keep_blank_values=True, max_num_fields=40)
    if any(len(value) != 1 for value in values.values()):
        raise ValidationError('같은 입력 항목이 중복되었습니다.')
    return {key: value[0] for key, value in values.items()}


def create_server(address=('127.0.0.1', 5175), database=None):
    diary = Diary(database or os.environ.get('PDS_DB', str(ROOT / 'data' / 'diary.sqlite3')))

    class Handler(BaseHTTPRequestHandler):
        def csrf_token(self):
            cookie = SimpleCookie()
            try:
                cookie.load(self.headers.get('Cookie', ''))
            except Exception:
                return ''
            value = cookie['pds_csrf'].value if 'pds_csrf' in cookie else ''
            return value if re.fullmatch(r'[0-9a-f]{64}', value) else ''

        def send(self, status, content=b'', content_type='text/html; charset=utf-8', token=None, headers=None):
            if isinstance(content, str):
                content = content.encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'same-origin')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
            if token:
                # CSRF token is public form metadata, not an authentication credential.
                self.send_header('Set-Cookie', f'pds_csrf={token}; Path=/pds; HttpOnly; SameSite=Lax')
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(content)

        def error(self, status, message):
            self.send(status, layout('기록을 확인해주세요', f'<section class="pds-card"><p>{e(message)}</p><p>입력 값이나 서버 연결을 확인하고 다시 시도해주세요.</p><a class="pds-button" href="/pds">계획 목록으로 돌아가기</a></section>'))

        def do_GET(self):
            try:
                path = urlsplit(self.path).path
                if path in STATIC:
                    name, mime = STATIC[path]
                    return self.send(200, (ROOT/name).read_bytes(), mime)
                if path == '/favicon.ico':
                    return self.send(204)
                if path == '/pds/export':
                    data = json.dumps(diary.export(), ensure_ascii=False, indent=2)
                    return self.send(200, data, 'application/json; charset=utf-8', headers={'Content-Disposition':'attachment; filename="yeobaek-pds.json"'})
                token = self.csrf_token() or secrets.token_hex(32)
                query = single_fields(urlsplit(self.path).query)
                if path in ('/pds', '/pds/'):
                    return self.send(200, dashboard(diary,query,token), token=token)
                if path == '/pds/task':
                    return self.send(200, task_page(diary,number(query,'id',1),token), token=token)
                self.error(404,'해당 화면을 찾을 수 없습니다. 파이썬 과제 화면은 /pds 입니다.')
            except (ValidationError, ValueError) as exc:
                self.error(422, str(exc))
            except (sqlite3.Error, OSError):
                self.error(503,'서버 DB 또는 파일에 연결하지 못했습니다. 서버 실행 상태와 저장 경로를 확인해주세요.')

        def do_POST(self):
            try:
                origin = self.headers.get('Origin')
                if origin and urlsplit(origin).netloc != self.headers.get('Host'):
                    return self.error(403,'다른 사이트에서 보낸 저장 요청은 허용하지 않습니다.')
                if self.headers.get_content_type() != 'application/x-www-form-urlencoded':
                    return self.error(415,'입력 폼 형식으로 요청해주세요.')
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                except ValueError:
                    return self.error(400,'요청 길이를 확인할 수 없습니다.')
                if not 0 < length <= 65536:
                    return self.error(413,'입력 내용이 너무 큽니다.')
                data = single_fields(self.rfile.read(length).decode('utf-8'))
                token = self.csrf_token()
                if not token or not secrets.compare_digest(token, data.get('csrf','')):
                    return self.error(403,'입력 화면이 만료되었거나 저장 요청을 확인할 수 없습니다. 화면을 다시 열어주세요.')
                path = urlsplit(self.path).path
                if path == '/pds/plan':
                    destination = '/pds?' + urlencode({'plan':diary.save_plan(data)})
                elif path == '/pds/task':
                    destination = '/pds/task?' + urlencode({'id':diary.save_task(data)})
                elif path == '/pds/complete':
                    diary.complete(number(data,'task_id',1), bool(number(data,'completed',0,1)))
                    destination = '/pds?' + urlencode({'plan':number(data,'plan_id',1)}) + '#evidence'
                elif path == '/pds/execution':
                    execution_id = diary.save_execution(data)
                    destination = '/pds/task?' + urlencode({'id':number(data,'task_id',1)}) + f'#execution-{execution_id}'
                elif path == '/pds/review':
                    diary.save_review(data)
                    destination = '/pds?' + urlencode({'plan':number(data,'plan_id',1)})
                elif path == '/pds/next-plan':
                    destination = '/pds?' + urlencode({'plan':diary.next_plan(data)})
                elif path == '/pds/delete':
                    if data.get('confirm') != 'yes':
                        raise ValidationError('삭제 확인란을 체크해주세요.')
                    kind = data.get('kind')
                    diary.delete(kind,number(data,'id',1))
                    destination = '/pds' if kind == 'plan' else '/pds?' + urlencode({'plan':number(data,'plan_id',1)})
                    if kind == 'execution':
                        destination = '/pds/task?' + urlencode({'id':number(data,'task_id',1)})
                else:
                    return self.error(404,'저장 경로를 찾을 수 없습니다.')
                self.send(303, headers={'Location':destination})
            except (ValidationError, ValueError, UnicodeError) as exc:
                self.error(422, str(exc))
            except sqlite3.Error:
                self.error(503,'DB에 저장하지 못했습니다. 입력 내용을 보관하고 다시 시도해주세요.')

    server = ThreadingHTTPServer(address, Handler)
    server.diary = diary
    return server


def main():
    parser = argparse.ArgumentParser(description='여백 Python Plan–Do–See server')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=int(os.environ.get('PORT', '5175')))
    parser.add_argument('--db', default=None)
    args = parser.parse_args()
    server = create_server((args.host,args.port),args.db)
    print(f'Paper diary: http://{args.host}:{server.server_port}/', flush=True)
    print(f'Python PDS:  http://{args.host}:{server.server_port}/pds', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
