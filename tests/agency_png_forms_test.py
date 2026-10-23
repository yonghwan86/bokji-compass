"""A reviewed whole-image agency original is accepted only for these exact PNG bytes."""
import copy
import hashlib
import importlib.util
import io
import unittest
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest.mock import Mock, patch

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMAGE = ROOT/'tests/fixtures/forms/yeongjong-official-viewer-page-1119.png'
JPEG = ROOT/'tests/fixtures/forms/bucheon-school-uniform-application.jpg'
SHA = '3994b3fd39fdfaf23da605b89d04ddb5a596d43100dcec492a17adf5751984e8'
JPEG_SHA = '8ae64f84823eadcfd2cbe87a917625d34e97fcbc64170a4e2cc987ee3417f395'
HWP_ID = 'agency-44250-36032'
JPEG_ID = 'agency-41190-school-uniform-jpg'
PNG_SIG = b'\x89PNG\r\n\x1a\n'


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/file)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


prepare = module('agency_png_prepare', 'prepare-portal-reviews.py')
download = module('agency_png_download', 'download-law-form-files.py')
FID = 'agency-28155-gazette155-annex1-image'
BYTES = IMAGE.read_bytes()
JPEG_BYTES = JPEG.read_bytes()

ENTRY = {
    'id': FID,
    'title': '의료급여 부분틀니 지대치 지원신청서',
    'sourceKind': 'agency',
    'role': 'application',
    'use': 'main',
    'condition': '영종구에 2년 이상 주민등록상 주소를 두고 거주하는65세 이상 의료급여수급자로서 부분틀니 사전등록·지대치 시술을 마친 사람이 시술 완료일부터30일 이내에 관할 동 행정복지센터에 신청하는 서식입니다.',
    'regionCode': '28155',
    'regionLabel': '인천광역시 영종구',
    'agencyName': '인천광역시 영종구',
    'authorityKind': 'government',
    'authorityEvidenceKind': 'government',
    'authorityEvidenceUrl': 'https://www.yeongjong.go.kr/main/pst/view.do?pst_id=mn_gubo&pst_sn=331961',
    'authorityEvidenceNote': '영종구청 구보 게시331961의 첨부345501 공식 미리보기가 이 Synap 문서로 연결되고, 공개 XML의 pdf id1119/path_html은 이 다운로드 PNG의 literal 경로를 직접 지정한다.',
    'sourcePageUrl': 'https://www.yeongjong.go.kr/synap/2026_07/93a39a35_2c4d_410f_9699_dda7609d9c81.pdf.xml',
    'sourceUrl': 'https://www.yeongjong.go.kr/synap/2026_07/93a39a35_2c4d_410f_9699_dda7609d9c81.pdf.files/1119.png',
    'finalUrl': 'https://www.yeongjong.go.kr/synap/2026_07/93a39a35_2c4d_410f_9699_dda7609d9c81.pdf.files/1119.png',
    'attachmentId': '1119.png',
    'attachmentIdentifier': {'path': '/synap/2026_07/93a39a35_2c4d_410f_9699_dda7609d9c81.pdf.files/1119.png'},
    'checkedAt': '2026-10-23',
    'publishedAt': None,
    'sha256': SHA,
    'bytes': 104896,
    'format': 'png',
    'lawId': '2144121',
    'lawTitle': '인천광역시 영종구 저소득 노인 부분틀니 지원에 관한 조례',
    'lawEvidenceUrl': 'https://www.law.go.kr/ordinInfoP.do?ordinSeq=2144121',
    'lawEffectiveDate': '2026-07-01',
    'lawCurrentCheckedAt': '2026-10-23',
    'sectionsRead': ['frame-1'],
    'textScope': 'all_original_image_frames',
    'selectedParts': [{'number': '별지 제1호서식', 'title': '의료급여 부분틀니 지대치 지원신청서', 'use': 'main', 'author': '해당 지대치 시술자 본인'}],
    'applicant': '해당 지대치 시술자 본인',
    'programs': [{'id': 'g28155.bokjiro-WLF00002277', 'url': 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00002277&wlfareInfoReldBztpCd=02'}],
    'visualReview': {
        'kind': 'whole-original-image',
        'checkedAt': '2026-10-23',
        'sha256': SHA,
        'width': 793,
        'height': 1121,
        'frames': 1,
        'blankApplicantForm': True,
        'noFilledPersonalData': True,
        'evidenceNote': '공식서버에서 직접 받은 PNG1프레임 전체를 실제 시각판독했다. 영종구청장·현행6조1항·신청금액/계좌·두 서명란·제출증빙과 행정정보동의가 모두 표시되고 주민의 기입 개인정보나 잘린 서식 부분이 없다.',
    },
}

ROW = {
    'formId': FID,
    'sourceKind': 'agency',
    'formTitle': ENTRY['title'],
    'sourcePageUrl': ENTRY['sourcePageUrl'],
    'sourceUrl': ENTRY['sourceUrl'],
    'finalUrl': ENTRY['finalUrl'],
    'attachmentId': ENTRY['attachmentId'],
    'agencyName': ENTRY['agencyName'],
    'authorityEvidenceUrl': ENTRY['authorityEvidenceUrl'],
    'programIds': ['g28155.bokjiro-WLF00002277'],
    'regionCode': ENTRY['regionCode'],
    'regionLabel': ENTRY['regionLabel'],
    'lawId': ENTRY['lawId'],
    'lawTitle': ENTRY['lawTitle'],
    'lawEvidenceUrl': ENTRY['lawEvidenceUrl'],
    'lawEffectiveDate': ENTRY['lawEffectiveDate'],
    'lawCurrentCheckedAt': ENTRY['lawCurrentCheckedAt'],
    'annexId': '',
    'annexNumber': '',
    'dateKind': 'checked',
    'effectiveDate': '2026-10-23',
    'publishedAt': None,
    'checkedAt': '2026-10-23',
    'sha256': SHA,
    'bytes': 104896,
    'originalFormat': 'png',
    'originalPath': 'tests/fixtures/forms/yeongjong-official-viewer-page-1119.png',
    'textScope': 'all_original_image_frames',
    'sectionsRead': ['frame-1'],
    'selectedParts': copy.deepcopy(ENTRY['selectedParts']),
    'reviewedParts': copy.deepcopy(ENTRY['selectedParts']),
    'applicant': ENTRY['applicant'],
    'role': 'application',
    'use': 'main',
    'condition': ENTRY['condition'],
    'evidenceNote': ENTRY['authorityEvidenceNote'],
    'roleBasis': ENTRY['visualReview']['evidenceNote'],
    'roleEvidenceUrl': ENTRY['sourceUrl'],
    'roleCheckedAt': '2026-10-23',
    'fullBodyReviewed': True,
    'verificationStatus': 'verified',
    'officialAttachmentMatched': True,
    'visualReview': copy.deepcopy(ENTRY['visualReview']),
    'authorityBasis': None,
    'nationalMunicipalIntakeReference': None,
}


def png_bytes(width, height, frames=1):
    """Synthetic PNG for negative cases only. Never used as the official original."""
    buf = io.BytesIO()
    first = Image.new('RGBA', (width, height), (255, 255, 255, 255))
    extra = [Image.new('RGBA', (width, height), (0, 0, 0, 255)) for _ in range(frames - 1)]
    if extra:
        first.save(buf, format='PNG', save_all=True, append_images=extra, duration=100, loop=0)
    else:
        first.save(buf, format='PNG')
    return buf.getvalue()


@contextmanager
def registered(entry):
    stored = copy.deepcopy(entry)
    seen = []
    for reg in (prepare.agency.REGISTRY, download.agency.REGISTRY):
        if all(reg is not item for item in seen):seen.append(reg)
    with ExitStack() as stack:
        for reg in seen:stack.enter_context(patch.dict(reg, {FID: stored}))
        yield stored


def review(row):
    return prepare.agency.prepare_review(row, download.inspect_document)


class AgencyPngFormsTest(unittest.TestCase):
    def tearDown(self):
        self.assertEqual(IMAGE.stat().st_size, 104896)
        self.assertEqual(hashlib.sha256(IMAGE.read_bytes()).hexdigest(), SHA)
        self.assertEqual(IMAGE.read_bytes()[:8], PNG_SIG)
        self.assertEqual(JPEG.stat().st_size, 101647)
        self.assertEqual(hashlib.sha256(JPEG.read_bytes()).hexdigest(), JPEG_SHA)

    def test_actual_official_png_is_accepted_with_empty_text_and_decoded_pixels(self):
        self.assertEqual(len(BYTES), 104896)
        self.assertEqual(hashlib.sha256(BYTES).hexdigest(), SHA)
        self.assertEqual(BYTES[:8], PNG_SIG)
        info = download.inspect_document(BYTES)
        self.assertEqual(info, {'format': 'png', 'sectionsRead': ['frame-1'], 'text': '', 'textLength': 0,
            'textScope': 'all_original_image_frames', 'imageWidth': 793, 'imageHeight': 1121, 'imageFrames': 1})
        self.assertEqual(hashlib.sha256(BYTES).hexdigest(), SHA)
        was = FID in prepare.agency.REGISTRY
        with registered(ENTRY):
            got, meta = review(copy.deepcopy(ROW))
        self.assertEqual(got['id'], FID)
        self.assertEqual(got['format'], 'png')
        self.assertEqual(got['sha256'], SHA)
        self.assertEqual((got['visualReview']['width'], got['visualReview']['height'], got['visualReview']['frames']), (793, 1121, 1))
        self.assertIs(got['visualReview']['blankApplicantForm'], True)
        self.assertIs(got['visualReview']['noFilledPersonalData'], True)
        self.assertEqual(meta['sectionsRead'], ['frame-1'])
        self.assertEqual(meta['sha256'], SHA)
        self.assertTrue(meta['fullBodyReviewed'])
        self.assertEqual(FID in prepare.agency.REGISTRY, was)
        if not was:
            with self.assertRaisesRegex(ValueError, 'unregistered_agency_form'):review(copy.deepcopy(ROW))

    def test_existing_jpeg_and_hwp_gates_are_unchanged(self):
        jpeg_info = download.inspect_document(JPEG_BYTES)
        self.assertEqual(jpeg_info['format'], 'jpg')
        self.assertEqual((jpeg_info['imageWidth'], jpeg_info['imageHeight'], jpeg_info['imageFrames']), (589, 835, 1))
        jpeg_entry = prepare.agency.REGISTRY[JPEG_ID]
        self.assertEqual(jpeg_entry['format'], 'jpg')
        self.assertEqual(jpeg_entry['visualReview']['kind'], 'whole-original-image')
        self.assertEqual(prepare.agency.registry_entry(JPEG_ID)['format'], 'jpg')
        hwp = copy.deepcopy(prepare.agency.REGISTRY[HWP_ID])
        self.assertEqual(hwp['format'], 'hwp')
        self.assertNotIn('visualReview', hwp)
        self.assertEqual(prepare.agency.registry_entry(HWP_ID)['format'], 'hwp')

    def test_wrong_format_extension_or_signature_is_rejected(self):
        self.assertEqual(download.inspect_document(JPEG_BYTES)['format'], 'jpg')
        with self.assertRaisesRegex(ValueError, 'not_a_document'):
            download.inspect_document(BYTES[1:])
        with self.assertRaisesRegex(ValueError, 'not_a_document'):
            download.inspect_document(b'\x00' + BYTES[1:])
        # JPEG/PDF magic on PNG body follows those existing inspect paths; it is not accepted as png.
        with self.assertRaises(Exception):
            download.inspect_document(b'\xff\xd8\xff' + BYTES[3:])
        with self.assertRaises(Exception):
            download.inspect_document(b'%PDF-' + BYTES[5:])
        gif_buf = io.BytesIO(); Image.new('P', (1, 1)).save(gif_buf, format='GIF')
        gif_info = download.inspect_document(gif_buf.getvalue())
        self.assertEqual(gif_info['format'], 'gif')
        self.assertEqual(gif_info['textScope'], 'image_requires_visual_review')
        jpg_as_png = copy.deepcopy(ENTRY); jpg_as_png['format'] = 'jpg'
        jpg_as_png['visualReview'] = copy.deepcopy(ENTRY['visualReview'])
        row = copy.deepcopy(ROW); row['originalFormat'] = 'jpg'; row['visualReview'] = copy.deepcopy(jpg_as_png['visualReview'])
        with registered(jpg_as_png), self.assertRaisesRegex(ValueError, 'agency_original_path_escape_or_missing'):
            review(row)
        row['originalPath'] = 'tests/fixtures/forms/bucheon-school-uniform-application.jpg'
        with registered(jpg_as_png), self.assertRaisesRegex(ValueError, 'agency_original_bytes_or_full_body_mismatch'):
            review(row)
        png_named_jpg = copy.deepcopy(ROW)
        png_named_jpg['originalPath'] = 'tests/fixtures/forms/bucheon-school-uniform-application.jpg'
        with registered(ENTRY), self.assertRaisesRegex(ValueError, 'agency_original_path_escape_or_missing'):
            review(png_named_jpg)
        real = prepare.agency.Path.read_bytes
        def jpeg_bytes(path):
            return JPEG_BYTES if path.name == IMAGE.name else real(path)
        with registered(ENTRY), patch.object(prepare.agency.Path, 'read_bytes', jpeg_bytes):
            with self.assertRaisesRegex(ValueError, 'agency_original_bytes_or_full_body_mismatch'):
                review(copy.deepcopy(ROW))
        def truncated(path):
            data = real(path)
            return data[:16] if path.name == IMAGE.name else data
        with registered(ENTRY), patch.object(prepare.agency.Path, 'read_bytes', truncated):
            with self.assertRaises((ValueError, OSError)):
                review(copy.deepcopy(ROW))

    def test_wrong_sha_dimensions_or_frames_fail_against_the_actual_png(self):
        for key, value in (('width', 792), ('height', 1120), ('frames', 2)):
            entry = copy.deepcopy(ENTRY); entry['visualReview'][key] = value
            row = copy.deepcopy(ROW); row['visualReview'] = copy.deepcopy(entry['visualReview'])
            pattern = 'invalid_whole_image_review' if key == 'frames' else 'agency_image_original_differs_from_whole_image_review'
            with self.subTest(key=key), registered(entry), self.assertRaisesRegex(ValueError, pattern):
                review(row)
        other = png_bytes(793, 1121)
        self.assertNotEqual(hashlib.sha256(other).hexdigest(), SHA)
        other_info = download.inspect_document(other)
        self.assertEqual(other_info['format'], 'png')
        self.assertEqual((other_info['imageWidth'], other_info['imageHeight'], other_info['imageFrames']), (793, 1121, 1))
        real = prepare.agency.Path.read_bytes
        def swapped(path):
            return other if path.name == IMAGE.name else real(path)
        with registered(ENTRY), patch.object(prepare.agency.Path, 'read_bytes', swapped):
            with self.assertRaisesRegex(ValueError, 'agency_original_bytes_or_full_body_mismatch'):
                review(copy.deepcopy(ROW))
        animated = png_bytes(8, 8, frames=2)
        with Image.open(io.BytesIO(animated)) as doc:
            if getattr(doc, 'n_frames', 1) != 1:
                with self.assertRaisesRegex(ValueError, 'invalid_png'):
                    download.inspect_document(animated)
        tiny = png_bytes(16, 16)
        tiny_info = download.inspect_document(tiny)
        self.assertEqual((tiny_info['imageWidth'], tiny_info['imageHeight']), (16, 16))
        entry = copy.deepcopy(ENTRY)
        entry['visualReview']['width'] = 16
        entry['visualReview']['height'] = 16
        row = copy.deepcopy(ROW); row['visualReview'] = copy.deepcopy(entry['visualReview'])
        with registered(entry), self.assertRaisesRegex(ValueError, 'agency_image_original_differs_from_whole_image_review'):
            review(row)

    def test_unreviewed_partial_source_or_blank_pii_bypass_is_rejected(self):
        missing = copy.deepcopy(ENTRY); del missing['visualReview']
        explicit_null = copy.deepcopy(ENTRY); explicit_null['visualReview'] = None
        cases = [('missing', missing, 'image_original_lacks_whole_image_review'),
                 ('null', explicit_null, 'invalid_whole_image_review')]
        for name, entry, pattern in cases:
            with self.subTest(name=name), registered(entry), self.assertRaisesRegex(ValueError, pattern):
                review(copy.deepcopy(ROW))
        for change in ({'blankApplicantForm': False}, {'noFilledPersonalData': False},
                       {'checkedAt': '2026-10-22'}, {'sha256': 'ab'*32},
                       {'kind': 'preview'}, {'evidenceNote': '원본을 봤다'}):
            entry = copy.deepcopy(ENTRY); entry['visualReview'].update(change)
            with self.subTest(change=sorted(change)), registered(entry), self.assertRaisesRegex(ValueError, 'invalid_whole_image_review'):
                review(copy.deepcopy(ROW))
        extra = copy.deepcopy(ENTRY); extra['visualReview']['viewer'] = 'person'
        with registered(extra), self.assertRaisesRegex(ValueError, 'invalid_whole_image_review'):
            review(copy.deepcopy(ROW))
        for key, value in (('textScope', 'all_body_sections_or_pages'), ('sectionsRead', ['frame-2']),
                           ('sectionsRead', ['frame-1', 'frame-2'])):
            entry = copy.deepcopy(ENTRY); entry[key] = value
            with self.subTest(key=key, value=value), registered(entry), self.assertRaisesRegex(ValueError, 'invalid_whole_image_review'):
                review(copy.deepcopy(ROW))
        pdf_claim = copy.deepcopy(ENTRY)
        pdf_claim['visualReview'] = {
            'kind': 'whole-original-pdf', 'checkedAt': '2026-10-23', 'sha256': SHA,
            'pageCount': 1, 'pagesRead': ['page-1'], 'blankApplicantForm': True,
            'noFilledPersonalData': True, 'evidenceNote': ENTRY['visualReview']['evidenceNote'],
        }
        with registered(pdf_claim), self.assertRaisesRegex(ValueError, 'invalid_whole_pdf_review'):
            review(copy.deepcopy(ROW))
        partial = copy.deepcopy(ENTRY); partial['sha256'] = '0'*64; partial['visualReview']['sha256'] = '0'*64
        row = copy.deepcopy(ROW); row['sha256'] = '0'*64; row['visualReview'] = copy.deepcopy(partial['visualReview'])
        with registered(partial):
            self.assertEqual(prepare.agency.registry_entry(FID)['sha256'], '0'*64)
            with self.assertRaisesRegex(ValueError, 'agency_original_bytes_or_full_body_mismatch'):review(row)
        identity = copy.deepcopy(ENTRY)
        identity['attachmentIdentifier'] = {'path': '/synap/2026_07/other.pdf.files/1119.png'}
        with patch.dict(prepare.agency.REGISTRY, {FID: identity}):
            with self.assertRaisesRegex(ValueError, 'invalid_agency_registry_entry'):
                prepare.agency.registry_entry(FID)
        unknown = copy.deepcopy(ENTRY); unknown['format'] = 'webp'
        with patch.dict(prepare.agency.REGISTRY, {FID: unknown}):
            with self.assertRaisesRegex(ValueError, 'invalid_whole_image_review'):
                prepare.agency.registry_entry(FID)
        unknown_plain = copy.deepcopy(ENTRY); unknown_plain['format'] = 'webp'; del unknown_plain['visualReview']
        with patch.dict(prepare.agency.REGISTRY, {FID: unknown_plain}):
            with self.assertRaisesRegex(ValueError, 'invalid_agency_registry_entry'):
                prepare.agency.registry_entry(FID)
        with registered(ENTRY):
            for key, value in (('visualReview', None), ('sectionsRead', ['frame-2']), ('textScope', 'all_body_sections_or_pages')):
                row = copy.deepcopy(ROW)
                if key == 'visualReview':del row['visualReview']
                else:row[key] = value
                with self.subTest(row=key), self.assertRaisesRegex(ValueError, 'agency_review_lacks_exact_full_body_evidence'):
                    review(row)
            row = copy.deepcopy(ROW); row['visualReview']['blankApplicantForm'] = False
            with self.assertRaisesRegex(ValueError, 'agency_review_lacks_exact_full_body_evidence'):review(row)
            row = copy.deepcopy(ROW); row['visualReview']['noFilledPersonalData'] = False
            with self.assertRaisesRegex(ValueError, 'agency_review_lacks_exact_full_body_evidence'):review(row)

    def test_hwp_cannot_carry_a_png_visual_claim_and_unknown_id_is_refused(self):
        base = copy.deepcopy(prepare.agency.REGISTRY[HWP_ID])
        self.assertEqual(base.get('format'), 'hwp')
        self.assertNotIn('visualReview', base)
        for claim in (copy.deepcopy(ENTRY['visualReview']), None):
            entry = copy.deepcopy(base); entry['visualReview'] = claim
            row = copy.deepcopy(ROW); row['formId'] = HWP_ID
            with self.subTest(claim=claim is None), patch.dict(prepare.agency.REGISTRY, {HWP_ID: entry}):
                with self.assertRaisesRegex(ValueError, 'invalid_whole_image_review'):review(row)
        self.assertNotIn('visualReview', prepare.agency.REGISTRY[HWP_ID])
        row = copy.deepcopy(ROW); row['formId'] = 'agency-28155-not-registered'
        with self.assertRaisesRegex(ValueError, 'unregistered_agency_form'):review(row)

    def response(self, url, status=200, location=None, data=BYTES):
        response = Mock(); response.url = url; response.status_code = status
        response.headers = {'Location': location} if location else {}
        response.iter_content.return_value = [data]
        response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
        return response

    def test_get_agency_returns_the_actual_png_bytes_only_from_the_fixed_source(self):
        source = ENTRY['sourceUrl']
        foreign = 'https://evil.example/1119.png'
        with registered(ENTRY):
            with patch.object(download.requests, 'get', return_value=self.response(source)) as get:
                self.assertEqual(download.Download(0, 1).get_agency(FID), BYTES)
                self.assertEqual(get.call_count, 1)
                self.assertEqual(get.call_args.args[0], source)
                self.assertFalse(get.call_args.kwargs['allow_redirects'])
            with patch.object(download.requests, 'get', return_value=self.response(source, 302, foreign)) as get:
                with self.assertRaisesRegex(ValueError, 'unregistered_agency_redirect'):
                    download.Download(0, 1).get_agency(FID)
                self.assertEqual(get.call_count, 1)
                self.assertEqual(get.call_args.args[0], source)
            with patch.object(download.requests, 'get', return_value=self.response(source, data=BYTES+b'changed')):
                with self.assertRaises(ValueError):download.Download(0, 1).get_agency(FID)
            crop = png_bytes(893, 1262)
            with patch.object(download.requests, 'get', return_value=self.response(source, data=crop)):
                with self.assertRaises(ValueError):download.Download(0, 1).get_agency(FID)
        with patch.object(download.requests, 'get') as get, self.assertRaisesRegex(ValueError, 'unregistered_agency_form'):
            download.Download(0, 1).get_agency('agency-28155-not-registered')
        get.assert_not_called()


if __name__ == '__main__':unittest.main()
