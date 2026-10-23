import importlib.util
import io
from pathlib import Path
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/hwp_writing_package.py'
spec = importlib.util.spec_from_file_location('hwp_writing_package', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def package(body=b'<section>fixed legal text</section>', metadata=True):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('mimetype', b'application/hwp+zip', compress_type=zipfile.ZIP_STORED)
        archive.writestr('Contents/section0.xml', body)
        archive.writestr('Contents/header.xml', b'<styles>original</styles>')
        archive.writestr('Contents/content.hpf',
            b'<opf:meta name="creator">Original issuer</opf:meta>' +
            (b'<opf:meta name="lastsaveby" content="text">PRIVATE_OPERATOR</opf:meta>' if metadata else b''))
    return output.getvalue()


class ConversionMetadataTest(unittest.TestCase):
    def test_only_converter_identity_changes_and_original_bytes_are_untouched(self):
        original = package()
        result = module.sanitize_conversion(original, ('PRIVATE_OPERATOR',))
        with zipfile.ZipFile(io.BytesIO(original)) as before, zipfile.ZipFile(io.BytesIO(result)) as after:
            self.assertEqual(before.namelist(), after.namelist())
            for name in before.namelist():
                if name != 'Contents/content.hpf':
                    self.assertEqual(before.read(name), after.read(name))
            self.assertIn(b'Original issuer', after.read('Contents/content.hpf'))
            self.assertNotIn(b'PRIVATE_OPERATOR', after.read('Contents/content.hpf'))
            self.assertEqual(after.infolist()[0].compress_type, zipfile.ZIP_STORED)
        self.assertEqual(package(), original)
        self.assertEqual(module.sanitize_conversion(result, ('PRIVATE_OPERATOR',)), result)

    def test_private_text_in_document_is_held_rather_than_silently_rewritten(self):
        with self.assertRaisesRegex(ValueError, 'remains outside'):
            module.sanitize_conversion(package(b'<section>PRIVATE_OPERATOR</section>'), ('PRIVATE_OPERATOR',))

    def test_unknown_metadata_layout_is_not_assumed_safe(self):
        with self.assertRaisesRegex(ValueError, 'not found'):
            module.sanitize_conversion(package(metadata=False), ('PRIVATE_OPERATOR',))


if __name__ == '__main__':
    unittest.main()
