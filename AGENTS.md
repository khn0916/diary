# Diary project

- Work in this directory for the diary project.
- GitHub repository: https://github.com/khn0916/diary.git (origin), default branch: main.
- Keep diary changes in this repository; do not include sibling assignment directories.
- Synchronize completed, verified diary changes with this GitHub repository as requested by the user.
- Website hosting and deployment require a separate user request. Do not configure or trigger deployment during ordinary development or repository synchronization.
- Preserve the warm beige paper diary design, equal calendar cells, center fold, and draggable page corners.
- Verify JavaScript changes with `node --check app.js` and page-turn changes with `node verify-turn.cjs`.
- Python PDS runs with `python server.py`; `/` is the unchanged paper diary and `/pds` is the separate assignment application.
- Run `python -m unittest -v test_pds.py test_http.py` for PDS changes. Tests use disposable databases; never invent the user's actual records.
- Keep SQLite databases and exports out of Git. Python hosting is separate from GitHub Pages and requires a separate deployment request.
