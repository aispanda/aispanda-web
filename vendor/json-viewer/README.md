# Standalone JSON viewer

The static files in `public/json-viewer` are built from [script-it/json-views](https://github.com/script-it/json-views) at commit `34b06662d328b15a863d060cf1580e62dc4380e7`, MIT licensed. The MIT license and upstream third-party notices are in the public viewer directory. `aispanda.patch` records the small title, attribution and subpath changes. The upstream web app owns the interactive controls; its browser workspace is independent of GitHub.

To rebuild, check out the pinned upstream commit in a separate directory, apply `aispanda.patch`, run `npm ci`, then build the core, React and web workspaces in that order. Copy `apps/web/dist` to `public/json-viewer` and include the upstream MIT license as `LICENSE.txt`. Verify the site build, subpath assets, upload and download, table, record, board and source views before changing the committed build.
