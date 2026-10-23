"""전국 사업의 한 도시가 따로 배포하는 선택 접수 서식만, 실물 출처에 묶였을 때 허용한다."""
import copy
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/file)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


prepare = module('intake_test_prepare', 'prepare-portal-reviews.py')
PAGE = 'https://www.seosan.go.kr/health/contents.do?key=2393'
FILE = 'https://www.seosan.go.kr/DATA/download/health/cts2393_file01.hwp'
SHA = '369b21f72eae53a8d7bee4c7292e915d488cd76733e3fe9cc30778081cc21d39'
PROGRAM_URL = 'https://www.gov.kr/portal/rcvfvrSvc/dtlEx/PTR000050390'
PROGRAM = {'id': 'n.gov24-PTR000050390', 'name': '산모·신생아 건강관리 지원', 'scope': 'national',
           'region': None, 'url': PROGRAM_URL, 'sources': [{'url': PROGRAM_URL}]}
FORM = {'id': 'agency-44210-health-cts2393-initial-voucher', 'sourceKind': 'agency',
        'regionCode': '44210', 'regionLabel': '충청남도 서산시'}
ENTRY = copy.deepcopy(prepare.agency.REGISTRY[FORM['id']])
REF = copy.deepcopy(ENTRY['nationalMunicipalIntakeReference'])
RECORD = {'formId': FORM['id'], 'use': 'conditional', 'checkedAt': '2026-10-23', 'sha256': SHA,
          'evidenceUrl': PAGE, 'programEvidenceUrl': PROGRAM_URL, 'verificationStatus': 'verified',
          'officialAttachmentMatched': True, 'scopeBasis': 'national-municipal-intake-reference',
          'nationalMunicipalIntakeReference': REF,
          'condition': '서산시에 주민등록을 둔 산모가 서산시보건소에서 이용권을 최초 신청할 때 쓰는 선택 서식입니다.'}

RECORD['condition'] = ENTRY['condition']
FORM = {k: ENTRY[k] for k in ('id','title','role','regionCode','regionLabel','sourceKind','sourceUrl','lawId','lawTitle')}
FORM.update(annexId='',annexNumber='',lawUrl=ENTRY['lawEvidenceUrl'],fetchedAt=ENTRY['checkedAt'],
            dateKind='published' if ENTRY.get('publishedAt') else 'checked',
            effectiveDate=ENTRY.get('publishedAt') or ENTRY['checkedAt'],agency=prepare.agency.agency_metadata(ENTRY))


def run(record=None, program=None, form=None, entry=None):
    return prepare.national_municipal_intake(record or copy.deepcopy(RECORD), program or PROGRAM,
                                             form or FORM, entry or ENTRY)


def with_ref(**changes):
    record = copy.deepcopy(RECORD)
    record['nationalMunicipalIntakeReference'] = dict(REF, **changes)
    return record


class ExactSeosanRouteIsAccepted(unittest.TestCase):
    def test_the_reviewed_seosan_intake_passes(self):
        run()

    def test_scope_basis_is_reported_for_an_agency_form(self):
        self.assertEqual(prepare.scope_basis(copy.deepcopy(RECORD), PROGRAM, FORM), 'national-municipal-intake-reference')


class ProgrammeAndRegionBinding(unittest.TestCase):
    def test_another_programme_id_is_rejected(self):
        with self.assertRaises(ValueError):run(with_ref(programmeId='n.gov24-OTHER'))

    def test_a_programme_with_a_region_is_rejected(self):
        with self.assertRaises(ValueError):run(program=dict(PROGRAM, region={'sido': '44000'}))

    def test_empty_or_false_region_values_are_not_a_national_region(self):
        for value in ({}, [], False, '', 0):
            with self.assertRaises(ValueError):run(program=dict(PROGRAM, region=value))

    def test_a_sido_or_sigungu_programme_cannot_use_this_route(self):
        for scope in ('sido', 'sigungu'):
            with self.assertRaises(ValueError):run(program=dict(PROGRAM, scope=scope))

    def test_a_city_that_is_not_the_form_region_is_rejected(self):
        with self.assertRaises(ValueError):run(with_ref(sigungu='44200'))

    def test_a_city_name_missing_from_the_region_label_is_rejected(self):
        with self.assertRaises(ValueError):run(with_ref(municipality='당진시'))

    def test_a_registry_entry_for_another_city_is_rejected(self):
        with self.assertRaises(ValueError):run(entry=dict(ENTRY, regionCode='44200'))


class SourceBinding(unittest.TestCase):
    def test_the_page_digest_must_match_the_registered_authority_proof(self):
        entry = copy.deepcopy(ENTRY)
        entry['nationalMunicipalIntakeReference']['municipalPageSHA256'] = '2'*64
        record = copy.deepcopy(RECORD)
        record['nationalMunicipalIntakeReference'] = entry['nationalMunicipalIntakeReference']
        with self.assertRaises(ValueError):run(record, entry=entry)

    def test_a_record_cannot_replace_the_reviewed_condition(self):
        record = copy.deepcopy(RECORD); record['condition'] = '서산시 이외의 주민도 이 원본을 제출합니다.'
        with self.assertRaises(ValueError):run(record)

    def test_unreviewed_population_wording_cannot_replace_the_registered_proof(self):
        with self.assertRaises(ValueError):
            run(with_ref(populationEvidence='서산시 안내는 국가 대상과 다른 집단의 서류를 설명하는 긴 문장이며 원래 검토와 다릅니다.'))

    def test_a_different_source_digest_is_rejected(self):
        with self.assertRaises(ValueError):run(with_ref(sourceSHA256='0'*64))

    def test_a_digest_that_disagrees_with_the_registry_is_rejected(self):
        with self.assertRaises(ValueError):run(entry=dict(ENTRY, sha256='1'*64))

    def test_a_page_that_is_not_the_registered_source_page_is_rejected(self):
        with self.assertRaises(ValueError):run(with_ref(municipalPageUrl='https://www.seosan.go.kr/health/contents.do?key=2394'))

    def test_a_download_that_is_not_the_registered_file_is_rejected(self):
        with self.assertRaises(ValueError):run(with_ref(downloadUrl='https://www.seosan.go.kr/DATA/download/health/cts2394_file01.hwp'))

    def test_a_non_government_source_is_rejected(self):
        with self.assertRaises(ValueError):
            run(with_ref(municipalPageUrl='https://seosan.example.com/health'),
                entry=dict(ENTRY, sourcePageUrl='https://seosan.example.com/health'))

    def test_a_programme_evidence_url_outside_the_programme_sources_is_rejected(self):
        record = copy.deepcopy(RECORD); record['programEvidenceUrl'] = 'https://www.gov.kr/portal/rcvfvrSvc/dtlEx/OTHER'
        with self.assertRaises(ValueError):run(record)


class StageAndPopulationProof(unittest.TestCase):
    def test_a_refund_stage_cannot_use_this_route(self):
        with self.assertRaises(ValueError):run(with_ref(stage='refund'))

    def test_refund_wording_in_the_evidence_is_rejected(self):
        with self.assertRaises(ValueError):
            run(with_ref(sameServiceEvidence='서산시 안내는 본인부담금 환급 신청을 이 서식으로 받는다고 적고 있다. 최초 신청과 다른 단계다.'))

    def test_short_or_city_less_evidence_is_rejected(self):
        for field in ('sameServiceEvidence', 'populationEvidence', 'scopeRestriction'):
            with self.assertRaises(ValueError):run(with_ref(**{field: '짧다'}))
            with self.assertRaises(ValueError):run(with_ref(**{field: '이 안내는 같은 서비스의 최초 신청을 같은 서식으로 받는다고 적고 있다.'}))

    def test_a_scope_restriction_without_a_limiting_word_is_rejected(self):
        with self.assertRaises(ValueError):
            run(with_ref(scopeRestriction='서산시 주민에게 이 서식을 제공하며 다른 지역에도 같이 쓸 수 있도록 안내한다고 적었다.'))


class RecordShape(unittest.TestCase):
    def test_an_unknown_reference_field_is_rejected(self):
        with self.assertRaises(ValueError):run(with_ref(coordinatorApproved=True))

    def test_a_missing_reference_field_is_rejected(self):
        record = copy.deepcopy(RECORD)
        record['nationalMunicipalIntakeReference'] = {k: v for k, v in REF.items() if k != 'populationEvidence'}
        with self.assertRaises(ValueError):run(record)

    def test_a_main_use_cannot_claim_this_optional_route(self):
        with self.assertRaises(ValueError):run(dict(copy.deepcopy(RECORD), use='main'))

    def test_a_condition_without_the_city_is_rejected(self):
        with self.assertRaises(ValueError):run(dict(copy.deepcopy(RECORD), condition='산모가 보건소에서 신청할 때 씁니다.'))

    def test_an_unverified_record_is_rejected(self):
        with self.assertRaises(ValueError):run(dict(copy.deepcopy(RECORD), verificationStatus='review'))

    def test_a_mismatched_checked_day_is_rejected(self):
        with self.assertRaises(ValueError):run(with_ref(checkedAt='2026-10-22'))

    def test_a_non_agency_form_cannot_use_this_route(self):
        with self.assertRaises(ValueError):run(form=dict(FORM, sourceKind='ordin'))


class ExistingRoutesUnchanged(unittest.TestCase):
    def test_actual_import_preserves_the_reference_on_the_published_link(self):
        review = ROOT/'pipeline/forms/reviews/municipal-reviewed-round8020.json'
        output = prepare.build({PROGRAM['id']: PROGRAM}, [review])
        self.assertEqual(len(output['rows']), 1)
        self.assertEqual(output['rows'][0]['nationalMunicipalIntakeReference'], REF)
        self.assertEqual(output['rows'][0]['scopeBasis'], 'national-municipal-intake-reference')

    def test_an_agency_record_without_the_reference_keeps_the_old_contract(self):
        record = {k: v for k, v in RECORD.items() if k not in ('scopeBasis', 'nationalMunicipalIntakeReference')}
        with self.assertRaises(ValueError):prepare.scope_basis(record, PROGRAM, FORM)

    def test_the_new_basis_is_registered_once(self):
        self.assertIn('national-municipal-intake-reference', prepare.SCOPE_BASES)
        self.assertIn('municipal-application-reference', prepare.SCOPE_BASES)


if __name__ == '__main__':
    unittest.main()
