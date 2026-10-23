"""Remove the converter operator's name without changing document contents."""
import copy
import io
import re
import zipfile

PUBLIC_CONVERTER = '복지나침반 작성용 변환'
META = re.compile(r'(<opf:meta\b(?=[^>]*\bname\s*=\s*"lastsaveby")[^>]*>)(.*?)(</opf:meta>)', re.I | re.S)


def sanitize_conversion(data, private_strings=()):
    with zipfile.ZipFile(io.BytesIO(data)) as source:
        infos = source.infolist()
        assert infos and infos[0].filename == 'mimetype', 'Unexpected HWPX package order'
        files = {info.filename: source.read(info.filename) for info in infos}
    assert files['mimetype'].strip() == b'application/hwp+zip'
    name = 'Contents/content.hpf'
    before = files[name].decode('utf-8')
    after, replacements = META.subn(lambda match: match[1] + PUBLIC_CONVERTER + match[3], before)
    if not replacements:
        raise ValueError('Expected Hancom lastsaveby metadata was not found')
    files[name] = after.encode('utf-8')
    for filename, contents in files.items():
        if not filename.endswith(('.xml', '.hpf', '.rdf', '.txt')):
            continue
        for private in private_strings:
            if private and (private.encode('utf-8') in contents or private.encode('utf-16-le') in contents):
                raise ValueError('Private converter information remains outside replaceable metadata')
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as target:
        for original in infos:
            info = copy.copy(original)
            info.date_time = (1980, 1, 1, 0, 0, 0)
            if info.filename in ('mimetype', 'version.xml'):
                info.compress_type = zipfile.ZIP_STORED
            target.writestr(info, files[info.filename])
    return output.getvalue()
