Usage: generate an index of a website folder

1. Run the generator (Node.js required):

```bash
node scripts/generate_site_index.js websites/snack
```

If no folder is provided it defaults to `websites/snack`.

Outputs written into the target folder:

- `files.json` — JSON manifest of files and directories (relative paths)
- `_index.html` — simple browseable HTML index linking to files

You can open `_index.html` in a browser or serve the folder with a static server.
