#!/usr/bin/env python3
"""Package the loadable extension and its corresponding engine/app sources."""
from pathlib import Path
import json
import tarfile
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text())['version']
out = root / 'releases'
out.mkdir(exist_ok=True)
dist = root / 'dist'
if not (dist / 'engine' / 'poppler.wasm').exists():
    raise RuntimeError('Run npm run engine:build and npm run build first.')

with zipfile.ZipFile(out / ('folio-' + version + '.zip'), 'w', zipfile.ZIP_DEFLATED) as package:
    for file in sorted(dist.rglob('*')):
        if file.is_file():
            package.write(file, file.relative_to(dist))

build = root / '.build'
ports = build / 'sources' / 'emsdk-4.0.23' / 'upstream' / 'emscripten' / 'cache' / 'ports'
dependencies = {name: build / 'sources' / name for name in ['poppler-26.10.0', 'openjpeg-2.5.4', 'lcms-2.17', 'poppler-data-0.4.12', 'urw-fonts-20200910']}
dependencies.update({
    'freetype-2.13.3': ports / 'freetype' / 'freetype-VER-2-13-3',
    'jpeg-9f': ports / 'libjpeg' / 'jpeg-9f', 'zlib-1.3.1': ports / 'zlib' / 'zlib-1.3.1',
})
for name, path in dependencies.items():
    if not path.exists():
        raise RuntimeError('Corresponding source missing: ' + name + '. Rebuild the engine first.')
prefix = 'folio-' + version + '-source'
with tarfile.open(out / (prefix + '.tar.gz'), 'w:gz') as source:
    for path in root.iterdir():
        if path.name in ['.build', 'node_modules', 'dist', 'artifacts', 'test-results', 'playwright-report', 'releases', '.git']:
            continue
        source.add(path, arcname=prefix + '/' + path.name)
    for name, path in dependencies.items():
        source.add(path, arcname=prefix + '/vendor/' + name)
print('Extension and corresponding source archives:', out)
