# Diary project

- Work in this directory for the diary project.
- GitHub repository: https://github.com/khn0916/diary.git (origin), default branch: main.
- Keep diary changes in this repository; do not include sibling assignment directories.
- Synchronize completed, verified diary changes with this GitHub repository as requested by the user.
- Website hosting and deployment require a separate user request. Do not configure or trigger deployment during ordinary development or repository synchronization.
- Preserve the warm beige paper diary design, equal calendar cells, center fold, and draggable page corners.
- Verify JavaScript changes with `node --check app.js` and page-turn changes with `node verify-turn.cjs`.
- Default PDS is now static `pds/index.html` on GitHub Pages, using IndexedDB and JavaScript. The paper diary keeps its design and features with an added navigation link.
- Verify static changes with `node test-browser-model.cjs`, `node --check pds-model.js`, `node --check pds-storage.js`, and `node --check pds-web.js`.
- Python PDS is retained as an optional implementation: run `python server.py`; `/pds` serves the Python screen, `/pds/index.html` serves the static version.
- Run `python -m unittest -v test_pds.py test_http.py` for PDS changes. Tests use disposable databases; never invent the user's actual records.
- Keep SQLite databases and exports out of Git. Python hosting is separate from GitHub Pages and requires a separate deployment request.
- Clearly distinguish browser persistence from the assignment's server DB requirement. Do not claim all assignment criteria are met by IndexedDB alone.
