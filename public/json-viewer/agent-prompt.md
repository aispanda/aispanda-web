AI agents can use json-views.com—a client-only app—through WebMCP or its JavaScript API (`window.jsonViews.help()`).

Direct the user with `<site>/#/files/<filename-or-folder-path>/views/<view-name>`; URL-encode each name. `jsonViews.link("tasks.json", "Board")` or WebMCP `json_views_get_link` generates it without navigating. The file must already exist in the user's browser workspace.

Or run the [open-source app](https://github.com/script-it/json-views) locally. Consider installing its [agent skill](https://github.com/script-it/json-views/tree/main/skills/json-views).

