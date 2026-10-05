#!/usr/bin/env python3
"""Build our Poppler/Splash bridge, with a project-local Emscripten SDK.

The downloaded sources and toolchain live in .build, never in a system prefix.
Run `npm run engine:build`. Subsequent builds reuse compiled dependencies.
"""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / '.build'
PREFIX = BUILD / 'prefix'
OUT = ROOT / 'public' / 'engine'
SDK_VERSION = '4.0.23'
POPPLER_VERSION = '26.10.0'
JOBS = min(os.cpu_count() or 2, 6)
ENV = os.environ.copy()


def run(args, cwd=None):
    print('+', ' '.join(str(arg) for arg in args), flush=True)
    subprocess.run([str(arg) for arg in args], cwd=cwd or ROOT, env=ENV, check=True)


def source(name, url):
    dest = BUILD / 'sources' / name
    if dest.is_dir():
        return dest
    archive = BUILD / 'downloads' / (name + '.tar.gz')
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        print('Downloading', name, flush=True)
        request = urllib.request.Request(url, headers={'User-Agent': 'Folio-build/0.1'})
        with urllib.request.urlopen(request, timeout=120) as response:
            with archive.with_suffix('.partial').open('wb') as output:
                shutil.copyfileobj(response, output)
        archive.with_suffix('.partial').replace(archive)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    locked = json.loads((ROOT / 'engine' / 'sources.lock.json').read_text())
    if locked.get(name) != digest:
        raise RuntimeError('Source archive does not match its pinned SHA-256: ' + name)
    records = BUILD / 'source-hashes.json'
    hashes = json.loads(records.read_text()) if records.exists() else {}
    hashes[name] = {'url': url, 'sha256': digest}
    records.write_text(json.dumps(hashes, indent=2) + '\n')
    staging = BUILD / 'sources' / (name + '-unpack')
    staging.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as tar:
        tar.extractall(staging, filter='data')
    directories = list(staging.iterdir())
    if len(directories) != 1 or not directories[0].is_dir():
        raise RuntimeError('Expected a single source directory: ' + name)
    directories[0].rename(dest)
    staging.rmdir()
    return dest


def cmake_build(name, src, options):
    directory = BUILD / name
    run([EMCMAKE, 'cmake', '-S', src, '-B', directory,
         '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF',
         '-DCMAKE_INSTALL_PREFIX=' + str(PREFIX),
         '-DCMAKE_C_FLAGS=-O3 -fexceptions', '-DCMAKE_CXX_FLAGS=-O3 -fexceptions',
         *options])
    run(['cmake', '--build', directory, '--parallel', JOBS])
    run(['cmake', '--install', directory])


BUILD.mkdir(exist_ok=True)
PREFIX.mkdir(exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
sdk = source('emsdk-' + SDK_VERSION,
             'https://codeload.github.com/emscripten-core/emsdk/tar.gz/refs/tags/' + SDK_VERSION)
if not (sdk / 'upstream' / 'bin' / 'clang').exists():
    run(['python3', sdk / 'emsdk.py', 'install', SDK_VERSION], sdk)
run(['python3', sdk / 'emsdk.py', 'activate', SDK_VERSION], sdk)
ENV['EM_CONFIG'] = str(sdk / '.emscripten')
ENV['EMSDK'] = str(sdk)
ENV['PATH'] = str(sdk / 'upstream' / 'emscripten') + os.pathsep + ENV['PATH']
EMXX = sdk / 'upstream' / 'emscripten' / 'em++'
EMCC = sdk / 'upstream' / 'emscripten' / 'emcc'
EMAR = sdk / 'upstream' / 'emscripten' / 'emar'
EMCMAKE = sdk / 'upstream' / 'emscripten' / 'emcmake'
PORTS = ['-sUSE_FREETYPE=1', '-sUSE_ZLIB=1', '-sUSE_LIBJPEG=1']
# Materialize Emscripten's dependency headers and static libraries before CMake.
run([EMCC, '-x', 'c', os.devnull, '-c', '-o', BUILD / 'ports.o', *PORTS])
sysroot = sdk / 'upstream' / 'emscripten' / 'cache' / 'sysroot'
lib = sysroot / 'lib' / 'wasm32-emscripten'

openjpeg = source('openjpeg-2.5.4', 'https://codeload.github.com/uclouvain/openjpeg/tar.gz/refs/tags/v2.5.4')
if not (PREFIX / 'lib' / 'libopenjp2.a').exists():
    cmake_build('openjpeg-build', openjpeg,
                ['-DBUILD_CODEC=OFF', '-DBUILD_TESTING=OFF', '-DBUILD_DOC=OFF'])

lcms = source('lcms-2.17', 'https://codeload.github.com/mm2/Little-CMS/tar.gz/refs/tags/lcms2.17')
if not (PREFIX / 'lib' / 'liblcms2.a').exists():
    objects = BUILD / 'lcms-build'
    objects.mkdir(exist_ok=True)
    def compile_lcms(src):
        obj = objects / (src.stem + '.o')
        run([EMCC, '-O3', '-fexceptions', '-I' + str(lcms / 'include'), '-c', src, '-o', obj])
        return obj
    with concurrent.futures.ThreadPoolExecutor(max_workers=JOBS) as pool:
        compiled = list(pool.map(compile_lcms, sorted((lcms / 'src').glob('*.c'))))
    (PREFIX / 'lib').mkdir(exist_ok=True)
    (PREFIX / 'include').mkdir(exist_ok=True)
    run([EMAR, 'rcs', PREFIX / 'lib' / 'liblcms2.a', *compiled])
    for header in (lcms / 'include').glob('*.h'):
        shutil.copy2(header, PREFIX / 'include' / header.name)

poppler = source('poppler-' + POPPLER_VERSION,
                 'https://poppler.freedesktop.org/poppler-' + POPPLER_VERSION + '.tar.xz')
# Poppler 26.10's inline by-value unique_ptr<Array> constructor instantiates
# deletion of an incomplete type with libc++. Match its adjacent Dict overload.
if 'Object(std::unique_ptr<Array> arrayA)' in (poppler / 'poppler' / 'Object.h').read_text():
    run(['patch', '-p1', '-i', ROOT / 'engine' / 'patches' / 'poppler-libcxx.patch'], poppler)
directory = BUILD / 'poppler-build'
disabled = ['BOOST', 'UTILS', 'CPP', 'GLIB', 'GOBJECT_INTROSPECTION', 'QT5', 'QT6',
            'LIBCURL', 'LIBTIFF', 'NSS3', 'GPGME', 'HARFBUZZ', 'BROTLI']
run([EMCMAKE, 'cmake', '-S', poppler, '-B', directory,
     '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF',
     '-DBUILD_MANUAL_TESTS=OFF', '-DBUILD_CPP_TESTS=OFF', '-DBUILD_GTK_TESTS=OFF',
     '-DBUILD_QT5_TESTS=OFF', '-DBUILD_QT6_TESTS=OFF', '-DFONT_CONFIGURATION=generic',
     '-DCMAKE_C_FLAGS=-O3 -fexceptions ' + ' '.join(PORTS),
     '-DCMAKE_CXX_FLAGS=-O3 -fexceptions ' + ' '.join(PORTS),
     '-DCMAKE_PREFIX_PATH=' + str(PREFIX),
     '-DOpenJPEG_DIR=' + str(PREFIX / 'lib' / 'cmake' / 'openjpeg-2.5'),
     '-DFREETYPE_INCLUDE_DIR_freetype2=' + str(sysroot / 'include' / 'freetype2'),
     '-DFREETYPE_INCLUDE_DIR_ft2build=' + str(sysroot / 'include' / 'freetype2'),
     '-DFREETYPE_LIBRARY_RELEASE=' + str(lib / 'libfreetype.a'),
     '-DZLIB_INCLUDE_DIR=' + str(sysroot / 'include'),
     '-DZLIB_LIBRARY_RELEASE=' + str(lib / 'libz.a'),
     '-DJPEG_INCLUDE_DIR=' + str(sysroot / 'include'),
     '-DJPEG_LIBRARY_RELEASE=' + str(lib / 'libjpeg.a'),
     '-DLCMS2_INCLUDE_DIR=' + str(PREFIX / 'include'),
     '-DLCMS2_LIBRARIES=' + str(PREFIX / 'lib' / 'liblcms2.a'),
     '-DCMAKE_DISABLE_FIND_PACKAGE_PNG=TRUE', '-DCMAKE_DISABLE_FIND_PACKAGE_Cairo=TRUE',
     '-DRUN_GPERF_IF_PRESENT=OFF',
     *['-DENABLE_' + name + '=OFF' for name in disabled]])
run(['cmake', '--build', directory, '--parallel', JOBS])

# CMaps and permissively licensed fallback fonts are loaded lazily from our package.
data = source('poppler-data-0.4.12', 'https://poppler.freedesktop.org/poppler-data-0.4.12.tar.gz')
assets = ROOT / 'public' / 'engine' / 'data'
if not assets.exists():
    assets.mkdir()
    for name in ['cidToUnicode', 'cMap', 'nameToUnicode', 'unicodeMap']:
        shutil.copytree(data / name, assets / name)

fonts = source('urw-fonts-20200910', 'https://codeload.github.com/ArtifexSoftware/urw-base35-fonts/tar.gz/refs/tags/20200910')
font_names = ['NimbusMonoPS-Regular', 'NimbusMonoPS-Bold', 'NimbusMonoPS-BoldItalic', 'NimbusMonoPS-Italic',
              'NimbusSans-Regular', 'NimbusSans-Bold', 'NimbusSans-BoldItalic', 'NimbusSans-Italic',
              'StandardSymbolsPS', 'NimbusRoman-Bold', 'NimbusRoman-BoldItalic', 'NimbusRoman-Italic',
              'NimbusRoman-Regular', 'D050000L']
(OUT / 'fonts').mkdir(exist_ok=True)
for font in font_names:
    shutil.copy2(fonts / 'fonts' / (font + '.otf'), OUT / 'fonts' / (font + '.otf'))
asset_list = [{'path': 'data/' + str(file.relative_to(assets)),
               'virtual': '/poppler-data/' + str(file.relative_to(assets))}
              for file in sorted(assets.rglob('*')) if file.is_file()]
asset_list += [{'path': 'fonts/' + font + '.otf', 'virtual': '/fonts/' + font + '.otf'} for font in font_names]
(OUT / 'assets.json').write_text(json.dumps(asset_list, indent=2) + '\n')

exports = ['_folio_open', '_folio_close', '_folio_info', '_folio_page_info',
           '_folio_render', '_folio_pixels', '_folio_pixel_length', '_folio_text',
           '_folio_links', '_folio_outline', '_folio_error', '_malloc', '_free']
run([EMXX, ROOT / 'engine' / 'bridge.cpp', directory / 'libpoppler.a',
     PREFIX / 'lib' / 'libopenjp2.a', PREFIX / 'lib' / 'liblcms2.a',
     '-I' + str(poppler), '-I' + str(poppler / 'poppler'),
     '-I' + str(directory), '-I' + str(directory / 'poppler'),
     '-I' + str(PREFIX / 'include'), '-std=c++23', '-O3', '-flto', '-fexceptions',
     *PORTS, '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web,worker,node',
     '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=2147483648', '-sINITIAL_MEMORY=33554432',
     '-sFILESYSTEM=1', '-sDYNAMIC_EXECUTION=0',
     '-sEXPORTED_FUNCTIONS=' + json.dumps(exports),
     '-sEXPORTED_RUNTIME_METHODS=' + json.dumps(['UTF8ToString', 'stringToUTF8', 'lengthBytesUTF8', 'FS', 'HEAPU8']),
     '-o', OUT / 'poppler.js'])
notices = ROOT / 'public' / 'licenses'
notices.mkdir(exist_ok=True)
for src, name in [(poppler / 'COPYING', 'Poppler-GPL.txt'), (openjpeg / 'LICENSE', 'OpenJPEG.txt'),
                  (lcms / 'LICENSE', 'Little-CMS.txt'), (data / 'COPYING', 'Poppler-data.txt')]:
    if src.exists():
        shutil.copy2(src, notices / name)
for notice in ['COPYING', 'LICENSE', 'LICENSE.ufl']:
    if (fonts / notice).exists():
        shutil.copy2(fonts / notice, notices / ('URW-' + notice + '.txt'))
for notice in ['COPYING.adobe', 'COPYING.gpl2']:
    shutil.copy2(data / notice, notices / ('Poppler-data-' + notice + '.txt'))
ports = sdk / 'upstream' / 'emscripten' / 'cache' / 'ports'
for src, name in [(ports / 'freetype' / 'freetype-VER-2-13-3' / 'docs' / 'FTL.TXT', 'FreeType.txt'),
                  (ports / 'libjpeg' / 'jpeg-9f' / 'README', 'IJG-JPEG.txt'),
                  (ports / 'zlib' / 'zlib-1.3.1' / 'LICENSE', 'zlib.txt')]:
    shutil.copy2(src, notices / name)
shutil.copy2(poppler / 'COPYING', ROOT / 'LICENSE')
metadata = {'poppler': POPPLER_VERSION, 'emscripten': SDK_VERSION,
            'backend': 'Splash', 'codecs': ['JPEG', 'JPEG2000', 'JBIG2', 'CCITT', 'Flate'],
            'colorManagement': 'Little CMS 2.17', 'patches': ['engine/patches/poppler-libcxx.patch'],
            'sources': json.loads((BUILD / 'source-hashes.json').read_text())}
(OUT / 'build.json').write_text(json.dumps(metadata, indent=2) + '\n')
print('Poppler engine built:', OUT / 'poppler.wasm', flush=True)
