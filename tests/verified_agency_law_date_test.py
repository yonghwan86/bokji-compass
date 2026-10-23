"""부칙 시행일이 API 메타와 다를 때만, 실물 증거에 결속된 경우에 한해 검증한다."""
import copy
import hashlib
import importlib.util
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/file)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


gate = module('agency_law_date_gate', 'verified_agency_forms.py')
FIXTURE = json.loads((ROOT/'tests/fixtures/forms/jeungpyeong-law-date.json').read_text(encoding='utf-8'))
LAW = FIXTURE['lawRecord']
BODY = FIXTURE['bodyText']
ENTRY = {'lawId': '1995491', 'lawEffectiveDate': FIXTURE['actualEffectiveDate']}
EVIDENCE = {'lawId': '1995491', 'promulgationDate': '20241220', 'promulgationNumber': '1192',
            'bodySHA256': FIXTURE['bodySHA256'], 'addendumText': FIXTURE['addendumQuote'],
            'effectiveDate': FIXTURE['actualEffectiveDate']}


def rehash(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


class JeungpyeongFixture(unittest.TestCase):
    """fixture 가 실제 법령포털 본문에서 변하지 않았는지부터 본다."""

    def test_recorded_digest_still_matches_the_stored_body(self):
        self.assertEqual(rehash(BODY), FIXTURE['bodySHA256'])

    def test_fixture_is_the_real_divergent_case(self):
        self.assertEqual(LAW['effectiveDate'], '20241220')
        self.assertEqual(FIXTURE['actualEffectiveDate'], '2025-01-01')
        self.assertIn('2025년 1월 1일부터 시행한다', re.sub(r'\s+', ' ', BODY))
        self.assertIn('제1192호', re.sub(r'\s+', '', BODY))


class MetaAgreementPathUnchanged(unittest.TestCase):
    """메타와 선언이 같으면 증거를 묻지 않고 그대로 돌려준다."""

    def test_matching_meta_needs_no_evidence(self):
        entry = {'lawId': '1995491', 'lawEffectiveDate': '2024-12-20'}
        self.assertEqual(gate.validate_current_law_date(entry, LAW, BODY), '2024-12-20')

    def test_matching_meta_ignores_a_body_that_was_never_read(self):
        entry = {'lawId': '1995491', 'lawEffectiveDate': '2024-12-20'}
        self.assertEqual(gate.validate_current_law_date(entry, LAW, '', None), '2024-12-20')


class DivergentDateNeedsBoundEvidence(unittest.TestCase):
    """실제 증평 사례만 통과하고, 결속이 약하면 전부 막는다."""

    def test_matching_meta_cannot_override_explicit_current_addendum_evidence(self):
        with self.assertRaisesRegex(ValueError, 'law_date_evidence_binding'):
            gate.validate_current_law_date(dict(ENTRY, lawEffectiveDate='2024-12-20'), LAW, BODY, EVIDENCE)

    def test_jeungpyeong_addendum_date_is_accepted(self):
        self.assertEqual(gate.validate_current_law_date(ENTRY, LAW, BODY, EVIDENCE), '2025-01-01')

    def test_bytes_body_is_accepted_the_same_way(self):
        self.assertEqual(gate.validate_current_law_date(ENTRY, LAW, BODY.encode('utf-8'), EVIDENCE), '2025-01-01')

    def test_divergence_without_evidence_is_rejected(self):
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(ENTRY, LAW, BODY)
        self.assertEqual(str(caught.exception), 'law_date_meta_mismatch')

    def test_an_opaque_approval_flag_cannot_be_added(self):
        for evidence in (dict(EVIDENCE, coordinatorApproved=True), {k: v for k, v in EVIDENCE.items() if k != 'addendumText'}):
            with self.assertRaises(ValueError) as caught:
                gate.validate_current_law_date(ENTRY, LAW, BODY, evidence)
            self.assertEqual(str(caught.exception), 'law_date_evidence_fields')

    def test_a_date_string_alone_does_not_pass(self):
        """선언만 바꾸고 본문이 그 날짜를 말하지 않으면 거부한다."""
        entry = {'lawId': '1995491', 'lawEffectiveDate': '2026-03-03'}
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(entry, LAW, BODY, dict(EVIDENCE, effectiveDate='2026-03-03'))
        self.assertEqual(str(caught.exception), 'enforcement_date_conflict')

    def test_evidence_date_must_agree_with_the_declared_date(self):
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(ENTRY, LAW, BODY, dict(EVIDENCE, effectiveDate='2024-12-20'))
        self.assertEqual(str(caught.exception), 'law_date_evidence_binding')


class WrongLawOrChangedBody(unittest.TestCase):
    def test_another_law_record_is_rejected(self):
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(ENTRY, dict(LAW, lawId='2140274'), BODY, EVIDENCE)
        self.assertEqual(str(caught.exception), 'law_record_mismatch')

    def test_evidence_pointing_at_another_law_is_rejected(self):
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(ENTRY, LAW, BODY, dict(EVIDENCE, lawId='2140274'))
        self.assertEqual(str(caught.exception), 'law_date_evidence_binding')

    def test_evidence_with_another_promulgation_number_is_rejected(self):
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(ENTRY, LAW, BODY, dict(EVIDENCE, promulgationNumber='1191'))
        self.assertEqual(str(caught.exception), 'law_date_evidence_binding')

    def test_a_changed_body_is_rejected(self):
        edited = BODY.replace('2025년 1월 1일', '2026년 1월 1일')
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(ENTRY, LAW, edited, EVIDENCE)
        self.assertEqual(str(caught.exception), 'law_body_changed')

    def test_a_quote_that_is_not_in_the_body_is_rejected(self):
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(ENTRY, LAW, BODY, dict(EVIDENCE, addendumText='이 조례는 2025년 1월 1일부터 적용한다.'))
        self.assertEqual(str(caught.exception), 'addendum_quote_mismatch')


class AddendumSelection(unittest.TestCase):
    """현행 공포 정보를 머리말에 가진 부칙만 고른다."""

    def test_an_older_addendum_cannot_stand_in(self):
        older = BODY.replace('(2024. 12. 20. 조례 제1192호 전부개정)', '(2019. 3. 8. 조례 제1035호 일부개정)')
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(ENTRY, LAW, older, dict(EVIDENCE, bodySHA256=rehash(older)))
        self.assertEqual(str(caught.exception), 'current_addendum_not_identified')

    def test_an_extra_old_addendum_is_ignored_and_the_current_one_still_wins(self):
        extra = BODY.replace('부\xa0\xa0\xa0\xa0\xa0\xa0칙',
                             '부\xa0\xa0\xa0\xa0\xa0\xa0칙\n(2019. 3. 8. 조례 제1035호 일부개정)\n이 조례는 공포한 날부터 시행한다.\n부\xa0\xa0\xa0\xa0\xa0\xa0칙', 1)
        self.assertEqual(gate.validate_current_law_date(ENTRY, LAW, extra, dict(EVIDENCE, bodySHA256=rehash(extra))), '2025-01-01')

    def test_two_addenda_sharing_the_same_promulgation_are_ambiguous(self):
        twice = BODY.replace('별지 서식',
                             '부\xa0\xa0\xa0\xa0\xa0\xa0칙\n(2024. 12. 20. 조례 제1192호 전부개정)\n이 조례는 2025년 7월 1일부터 시행한다.\n별지 서식', 1)
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(ENTRY, LAW, twice, dict(EVIDENCE, bodySHA256=rehash(twice)))
        self.assertEqual(str(caught.exception), 'current_addendum_not_identified')


class UnclearEnforcement(unittest.TestCase):
    """날짜가 없거나 여러 개면 추측하지 않는다."""

    def test_promulgation_day_wording_has_no_explicit_date(self):
        vague = BODY.replace('이 조례는 2025년 1월 1일부터 시행한다.', '이 조례는 공포한 날부터 시행한다.')
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(ENTRY, LAW, vague, dict(EVIDENCE, bodySHA256=rehash(vague),
                                                                   addendumText='이 조례는 공포한 날부터 시행한다.'))
        self.assertEqual(str(caught.exception), 'no_explicit_enforcement_date')

    def test_a_split_enforcement_clause_is_rejected(self):
        split = BODY.replace('이 조례는 2025년 1월 1일부터 시행한다.',
                             '이 조례는 2025년 1월 1일부터 시행한다. 다만, 제5조는 2025년 7월 1일부터 시행한다.')
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(ENTRY, LAW, split, dict(EVIDENCE, bodySHA256=rehash(split)))
        self.assertEqual(str(caught.exception), 'ambiguous_enforcement_date')

    def test_a_second_enforcement_sentence_is_rejected(self):
        extra = BODY.replace('이 조례는 2025년 1월 1일부터 시행한다.',
                             '이 조례는 2025년 1월 1일부터 시행한다. 별지 서식은 2025년 7월 1일부터 시행한다.')
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(ENTRY, LAW, extra, dict(EVIDENCE, bodySHA256=rehash(extra)))
        self.assertEqual(str(caught.exception), 'ambiguous_enforcement_date')


class MalformedInput(unittest.TestCase):
    def test_a_declared_date_must_be_iso(self):
        for value in ('20250101', '', None, '2025-13-01'):
            with self.assertRaises(ValueError) as caught:
                gate.validate_current_law_date({'lawId': '1995491', 'lawEffectiveDate': value}, LAW, BODY, EVIDENCE)
            self.assertEqual(str(caught.exception), 'invalid_declared_effective_date')

    def test_a_law_record_without_promulgation_cannot_be_used(self):
        stripped = {k: v for k, v in LAW.items() if k != 'promulgationNumber'}
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date(ENTRY, stripped, BODY, EVIDENCE)
        self.assertEqual(str(caught.exception), 'law_record_promulgation_missing')

    def test_a_non_numeric_law_id_is_rejected(self):
        with self.assertRaises(ValueError) as caught:
            gate.validate_current_law_date({'lawId': 'ordin-19766693', 'lawEffectiveDate': '2025-01-01'}, LAW, BODY, EVIDENCE)
        self.assertEqual(str(caught.exception), 'law_record_mismatch')


class ExistingRegistryUnaffected(unittest.TestCase):
    """새 함수가 기존 agency 계약을 건드리지 않았는지 확인한다."""

    def test_registry_entry_and_metadata_still_work(self):
        entry = gate.registry_entry('agency-44250-36032')
        self.assertEqual(entry['regionCode'], '44250')
        self.assertEqual(copy.deepcopy(gate.agency_metadata(entry))['attachmentId'], entry['attachmentId'])

    def test_ordinance_authority_still_requires_its_own_fields(self):
        self.assertTrue(callable(gate.ordinance_authority))
        self.assertNotIn('validate_current_law_date', gate.LAW_FIELDS)


if __name__ == '__main__':
    unittest.main()
