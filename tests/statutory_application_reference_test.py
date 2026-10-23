"""법이 지정한 전국 공통 신청서를 그 사업 하나에만, 등록된 체인에 묶였을 때 연다."""
import copy
import unittest.mock
import hashlib
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/file)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


prepare = module('statutory_test_prepare', 'prepare-portal-reviews.py')
REGISTRY = json.loads((ROOT/'src/lib/data/verifiedStatutoryApplications.json').read_text(encoding='utf-8'))['applications']
ENTRY = REGISTRY['ulju-maternal-voucher-initial']
ORIGINAL = ROOT/'public/forms/files/rule-3211501-f922a89ff89c.hwpx'
PROGRAM_URL = ENTRY['programmeUrl']
PROGRAM = {'id': ENTRY['programmeId'], 'name': '산모·신생아 건강관리사 지원', 'scope': 'sigungu',
           'laws': [ENTRY['citedLawTitle'], '모자보건법'],
           'region': {'sido': '31000', 'sigungu': '31710', 'label': '울산광역시 울주군'},
           'url': PROGRAM_URL, 'sources': [{'url': PROGRAM_URL}]}
FORM = {'id': 'rule-3211501', 'lawId': ENTRY['lawId'], 'lawTitle': ENTRY['referencedLawTitle'],
        'effectiveDate': ENTRY['sourceEffectiveDate'],
        'annexNumber': ENTRY['annexNumber'], 'regionCode': 'national', 'regionLabel': '전국 공통',
        'sourceUrl': ENTRY['sourceUrl'], 'sourceKind': 'rule'}
REF = {'kind': 'statutory-chain', 'referenceId': ENTRY['referenceId'],
       'referencedLawTitle': ENTRY['referencedLawTitle'], 'annexNumber': ENTRY['annexNumber'],
       'sourceSHA256': ENTRY['sourceSHA256'],
       'basis': '정부24 사업이 인용한 이용권법 제9조에서 시행규칙 제3조제1항을 거쳐 공통고시 제5조가 이 별지를 직접 특정한다.'}
RECORD = {'formId': 'rule-3211501', 'use': ENTRY['use'], 'checkedAt': ENTRY['checkedAt'],
          'sha256': ENTRY['sourceSHA256'], 'bytes': ENTRY['sourceBytes'], 'originalFormat': ENTRY['sourceFormat'],
          'evidenceUrl': PROGRAM_URL, 'programEvidenceUrl': PROGRAM_URL,
          'condition': ENTRY['condition']}


def run(record=None, program=None, form=None, ref=None):
    record = record or copy.deepcopy(RECORD)
    return prepare.statutory_application(record, program or PROGRAM, form or FORM, ref or copy.deepcopy(REF))


class PublishedOriginalIsTheRegisteredOne(unittest.TestCase):
    """SHA 는 실제 공개 바이트에서 다시 계산해 대조한다."""

    def test_the_registered_digest_matches_the_published_bytes(self):
        data = ORIGINAL.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(), ENTRY['sourceSHA256'])
        self.assertEqual(len(data), ENTRY['sourceBytes'])

    def test_the_registry_keeps_the_unresolved_local_form_apart(self):
        self.assertEqual(ENTRY['unresolvedLocalForm'], 'ordin-22083017')
        self.assertEqual(ENTRY['stage'], 'initial-application')


class ExactUljuChainIsAccepted(unittest.TestCase):
    def test_the_reviewed_chain_passes(self):
        run()

    def test_scope_basis_reports_the_existing_official_kind(self):
        record = dict(copy.deepcopy(RECORD), scopeBasis='official-application-reference', scopeReference=copy.deepcopy(REF),
                      verificationStatus='verified', officialAttachmentMatched=True)
        self.assertEqual(prepare.scope_basis(record, PROGRAM, FORM), 'official-application-reference')

    def test_the_chain_is_the_current_three_identities(self):
        self.assertEqual([step['lawId'] for step in ENTRY['chain']], ['257855', '269841', '2100000278060'])
        self.assertEqual([step['article'] for step in ENTRY['chain']], ['제9조', '제3조', '제5조'])


class ProgrammeAndRegionBinding(unittest.TestCase):
    def test_another_programme_is_rejected(self):
        with self.assertRaises(ValueError):run(program=dict(PROGRAM, id='g31710.gov24-OTHER'))

    def test_another_city_is_rejected(self):
        with self.assertRaises(ValueError):
            run(program=dict(PROGRAM, region={'sido': '31000', 'sigungu': '31200', 'label': '울산광역시 남구'}))

    def test_a_national_or_sido_programme_cannot_use_this_route(self):
        for scope in ('national', 'sido'):
            with self.assertRaises(ValueError):run(program=dict(PROGRAM, scope=scope))

    def test_a_condition_without_the_city_is_rejected(self):
        with self.assertRaises(ValueError):run(dict(copy.deepcopy(RECORD), condition='산모 바우처 초기 신청에 씁니다.'))


class FormAndSourceBinding(unittest.TestCase):
    def test_another_form_id_is_rejected(self):
        with self.assertRaises(ValueError):run(dict(copy.deepcopy(RECORD), formId='rule-3211497'))

    def test_another_annex_number_is_rejected(self):
        with self.assertRaises(ValueError):run(form=dict(FORM, annexNumber='000103'), ref=dict(REF, annexNumber='000103'))

    def test_a_local_form_cannot_claim_the_national_route(self):
        with self.assertRaises(ValueError):run(form=dict(FORM, regionCode='31710'))

    def test_another_cited_act_title_is_rejected(self):
        with self.assertRaises(ValueError):
            run(form=dict(FORM, lawTitle='사회보장급여의 이용·제공 및 수급권자 발굴에 관한 법률'))

    def test_another_source_url_is_rejected(self):
        with self.assertRaises(ValueError):run(form=dict(FORM, sourceUrl='https://www.law.go.kr/LSW/flDownload.do?flSeq=1&bylClsCd=200203'))

    def test_a_changed_digest_is_rejected(self):
        with self.assertRaises(ValueError):run(ref=dict(REF, sourceSHA256='0'*64))

    def test_a_record_digest_that_disagrees_is_rejected(self):
        with self.assertRaises(ValueError):run(dict(copy.deepcopy(RECORD), sha256='1'*64))

    def test_missing_bytes_metadata_is_rejected(self):
        record = {k: v for k, v in copy.deepcopy(RECORD).items() if k != 'bytes'}
        with self.assertRaises(ValueError):run(record)


class ActualProgrammeLawAndPurpose(unittest.TestCase):
    def test_the_actual_cited_act_cannot_be_removed(self):
        for laws in ([], ['모자보건법']):
            with self.subTest(laws=laws), self.assertRaises(ValueError):run(program=dict(PROGRAM,laws=laws))
        program={k:v for k,v in PROGRAM.items() if k!='laws'}
        with self.assertRaises(ValueError):run(program=program)

    def test_city_name_alone_cannot_approve_another_purpose(self):
        for condition in ('울주군', '울주군 본인부담금 현금 환급과 임산부 가사돌봄서비스의 변경 신청에 사용하는 서식입니다.'):
            with self.subTest(condition=condition), self.assertRaises(ValueError):run(dict(RECORD,condition=condition))

    def test_the_source_effective_day_cannot_drift_to_the_printed_revision_day(self):
        with self.assertRaises(ValueError):run(form=dict(FORM,effectiveDate='2026-07-01'))

    def test_chain_identity_date_and_proof_are_required_for_each_step(self):
        for index in range(3):
            for key,value in [('currentState','prior'),('checkedAt','2026-10-22'),('effectiveDate','2027-01-01'),
                              ('evidenceSHA256','missing'),('currentIdentityEvidenceSHA256','missing'),('url',ENTRY['chain'][index]['url'].replace(ENTRY['chain'][index]['lawId'],'1'))]:
                broken=copy.deepcopy(ENTRY);broken['chain'][index][key]=value
                with self.subTest(index=index,key=key), unittest.mock.patch.dict(prepare.STATUTORY_APPLICATIONS,{ENTRY['referenceId']:broken}), self.assertRaises(ValueError):run()
        broken=copy.deepcopy(ENTRY);broken['chain'][0]['url']=broken['chain'][0]['url'].replace('joNo=0009','joNo=0008')
        with unittest.mock.patch.dict(prepare.STATUTORY_APPLICATIONS,{ENTRY['referenceId']:broken}), self.assertRaises(ValueError):run()
        for suffix in ('&joNo=', '&joNo=0009', '&lsiSeq=', '&lsiSeq=257855'):
            broken=copy.deepcopy(ENTRY);broken['chain'][0]['url']+=suffix
            with self.subTest(suffix=suffix), unittest.mock.patch.dict(prepare.STATUTORY_APPLICATIONS,{ENTRY['referenceId']:broken}), self.assertRaises(ValueError):run()


class ChainAndApprovalShape(unittest.TestCase):
    def test_an_unknown_reference_id_is_rejected(self):
        with self.assertRaises(ValueError):run(ref=dict(REF, referenceId='goyang-maternal'))

    def test_an_opaque_approval_field_cannot_be_added(self):
        with self.assertRaises(ValueError):run(ref=dict(REF, coordinatorApproved=True))

    def test_a_missing_reference_field_is_rejected(self):
        with self.assertRaises(ValueError):run(ref={k: v for k, v in REF.items() if k != 'sourceSHA256'})

    def test_a_mismatched_checked_day_is_rejected(self):
        with self.assertRaises(ValueError):run(dict(copy.deepcopy(RECORD), checkedAt='2026-10-22'))

    def test_evidence_must_be_the_programme_page(self):
        with self.assertRaises(ValueError):
            run(dict(copy.deepcopy(RECORD), evidenceUrl='https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000278060'))

    def test_a_forged_chain_step_is_rejected(self):
        broken = copy.deepcopy(ENTRY); broken['chain'][1]['article'] = '제3조의조'
        with self.assertRaises(ValueError):
            with unittest.mock.patch.dict(prepare.STATUTORY_APPLICATIONS, {ENTRY['referenceId']: broken}):run()

    def test_a_chain_that_drops_a_step_is_rejected(self):
        broken = copy.deepcopy(ENTRY); broken['chain'] = broken['chain'][:2]
        with self.assertRaises(ValueError):
            with unittest.mock.patch.dict(prepare.STATUTORY_APPLICATIONS, {ENTRY['referenceId']: broken}):run()

    def test_a_notice_step_that_is_not_the_form_law_is_rejected(self):
        broken = copy.deepcopy(ENTRY); broken['chain'][2]['lawId'] = '2100000278061'
        with self.assertRaises(ValueError):
            with unittest.mock.patch.dict(prepare.STATUTORY_APPLICATIONS, {ENTRY['referenceId']: broken}):run()

    def test_a_non_official_chain_url_is_rejected(self):
        broken = copy.deepcopy(ENTRY); broken['chain'][0]['url'] = 'https://example.com/act'
        with self.assertRaises(ValueError):
            with unittest.mock.patch.dict(prepare.STATUTORY_APPLICATIONS, {ENTRY['referenceId']: broken}):run()


class OldReferenceKindsUnchanged(unittest.TestCase):
    def test_the_two_existing_kinds_are_still_separate(self):
        self.assertIn('official-application-reference', prepare.SCOPE_BASES)
        self.assertEqual(prepare.STATUTORY_STEPS, ('law', 'regulation', 'notice'))

    def test_a_record_without_the_new_kind_does_not_reach_the_registry(self):
        record = dict(copy.deepcopy(RECORD), scopeBasis='official-application-reference',
                      verificationStatus='verified', officialAttachmentMatched=True,
                      scopeReference={'kind': 'program-documents', 'referencedLawTitle': FORM['lawTitle'],
                                      'annexNumber': FORM['annexNumber'],
                                      'basis': '사업 안내가 이 서식을 구비서류로 직접 적고 있어 확인했습니다.'})
        # program-documents 는 기존 규칙 그대로 사업 페이지 증거를 요구한다.
        self.assertEqual(prepare.scope_basis(record, PROGRAM, FORM), 'official-application-reference')


if __name__ == '__main__':
    import unittest.mock  # noqa: F401
    unittest.main()
