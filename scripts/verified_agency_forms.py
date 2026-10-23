"""Exact, curated agency attachments. This does not widen Law.go.kr policies."""
import hashlib
import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit, unquote

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = json.loads((ROOT/'src/lib/data/verifiedAgencyForms.json').read_text(encoding='utf-8'))['forms']
AGENCY_ID = re.compile(r'agency-\d{5}-[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}')
SECRET = re.compile(r'^oc$|api[-_]?key|service[-_]?key|token|secret|password|auth|session|login|email|phone|resident|jumin', re.I)
LAW_FIELDS = ('lawId', 'lawTitle', 'lawEvidenceUrl', 'lawEffectiveDate', 'lawCurrentCheckedAt')
BASIS_FIELDS = ('kind', 'title', 'evidenceUrl', 'checkedAt', 'evidenceNote', 'pageSHA256')
VISUAL_FIELDS = ('kind', 'checkedAt', 'sha256', 'width', 'height', 'frames', 'blankApplicantForm', 'noFilledPersonalData', 'evidenceNote')
PDF_REVIEW_FIELDS = ('kind', 'checkedAt', 'sha256', 'pageCount', 'pagesRead', 'blankApplicantForm', 'noFilledPersonalData', 'evidenceNote')
IMAGE_SECTIONS = ['frame-1']
LAW_DATE_EVIDENCE = ('lawId', 'promulgationDate', 'promulgationNumber', 'bodySHA256', 'addendumText', 'effectiveDate')
NATIONAL_INTAKE_FIELDS = frozenset({'kind','programmeId','sigungu','municipality','municipalPageUrl','downloadUrl',
    'sourceSHA256','municipalPageSHA256','httpStatus','checkedAt','stage','sameServiceEvidence','populationEvidence','scopeRestriction'})
ADDENDUM = re.compile(r'부\s*칙\s*[(<]\s*([^)>]{4,160}?)\s*[)>]')
KOREAN_DAY = re.compile(r'(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일')
DOTTED_DAY = re.compile(r'(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.')
ENFORCEMENT = re.compile(r'이\s*조례는[^.]{0,120}?시행한다')


def review_fields(review):
    """Which exact keys this one review kind publishes."""
    return PDF_REVIEW_FIELDS if review.get('kind') == 'whole-original-pdf' else VISUAL_FIELDS


def safe_path(value):
    for _ in range(8):
        if re.search(r'%(?![a-fA-F0-9]{2})', value):return False
        decoded = unquote(value)
        if decoded == value:
            return not re.search(r'[\\\x00-\x1f]|(?:^|/)\.{1,2}(?:/|$)', decoded)
        value = decoded
    return False


def safe_parameter(name, value):
    for _ in range(8):
        decoded = unquote(name)
        if decoded == name:
            return not SECRET.search(name) and (not re.fullmatch(r'(?:menu)?key', name, re.I) or value.isdecimal())
        name = decoded
    return False


def safe_url(value):
    """Public wire-encoded HTTPS URL; public attachment IDs are not API keys."""
    try:
        if not isinstance(value, str) or not value.isascii() or re.search(r'\s|[\\#\x00-\x1f]', value):return False
        p = urlsplit(value)
        if (p.scheme != 'https' or not p.hostname or p.username or p.password or p.fragment
                or p.port is not None or '.' not in p.hostname or not safe_path(p.path)
                or re.fullmatch(r'[\d.]+', p.hostname) or ':' in p.hostname
                or re.search(r'\.(local|localhost|internal|lan|test|invalid)$', p.hostname)):return False
        return all(safe_parameter(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True))
    except (TypeError, ValueError):return False


def valid_day(value):
    try:return isinstance(value, str) and date.fromisoformat(value).isoformat() == value
    except ValueError:return False


def official_program_basis(entry):
    """A curated attachment authorised by the benefit's own official application instructions.

    The reviewed source page states how the attachment is used; this asserts
    nothing about whether an ordinance exists. Law fields stay empty strings
    instead of guessing identifiers, so guidance is never published as a law.
    The basis is bound to the same reviewed page and day as the attachment.
    """
    if 'authorityBasis' not in entry:return None
    basis = entry['authorityBasis']
    if (not isinstance(basis, dict) or set(basis) != set(BASIS_FIELDS) or basis['kind'] != 'official-program'
            or not isinstance(basis['title'], str) or not basis['title'].strip()
            or basis['evidenceUrl'] != entry.get('sourcePageUrl') or basis['checkedAt'] != entry.get('checkedAt')
            or not isinstance(basis['evidenceNote'], str) or len(basis['evidenceNote'].strip()) < 30
            or not re.fullmatch(r'[a-f0-9]{64}', str(basis['pageSHA256']))
            or any(entry.get(k) != '' for k in LAW_FIELDS)
            or entry.get('annexId', '') != '' or entry.get('annexNumber', '') != ''):
        raise ValueError('invalid_official_program_authority_basis')
    return basis


def whole_pdf_review(entry, review):
    """A scanned PDF original has no text layer, so a person's own reading of every rendered page is the evidence.

    It records that each page of these exact bytes was rendered, looked at and
    found to be a blank applicant form. The PDF reader only counts and extracts;
    it never decides this. Bound to the registered SHA, day and page count, and
    pagesRead must name every page in order, so a part-read document, changed
    bytes or another PDF cannot inherit the review. Only pdf may carry it, and a
    PDF that does have body text still has to prove itself by that text.
    """
    pages = review.get('pageCount')
    return (isinstance(review, dict) and set(review) == set(PDF_REVIEW_FIELDS)
            and entry.get('format') == 'pdf' and review['kind'] == 'whole-original-pdf'
            and review['checkedAt'] == entry.get('checkedAt') and review['sha256'] == entry.get('sha256')
            and type(pages) is int and pages > 0
            and review['pagesRead'] == [f'page-{i}' for i in range(1, pages+1)]
            and review['blankApplicantForm'] is True and review['noFilledPersonalData'] is True
            and isinstance(review['evidenceNote'], str) and len(review['evidenceNote'].strip()) >= 30
            and entry.get('textScope') == 'all_body_sections_or_pages'
            and entry.get('sectionsRead') == review['pagesRead'])


def whole_image_review(entry):
    """A scanned original has no body text, so a person's own reading of the whole image is the evidence.

    It records that every frame of these exact bytes was looked at and found to
    be a blank applicant form. The reader only decodes the image; it never
    decides this. Bound to the registered SHA, day and pixel size, so changed
    bytes or another image cannot inherit the review. Only jpg or png may carry
    it — a format whose body text is readable must prove itself by that text.
    A pdf original carries the page-based review above instead; neither an
    image nor a pdf can claim the other's kind.
    """
    image = entry.get('format') in ('jpg', 'png')
    if 'visualReview' not in entry:
        if image:raise ValueError('image_original_lacks_whole_image_review')
        return None
    review = entry['visualReview']
    if isinstance(review, dict) and review.get('kind') == 'whole-original-pdf':
        if not whole_pdf_review(entry, review):raise ValueError('invalid_whole_pdf_review')
        return review
    if (not image or not isinstance(review, dict) or set(review) != set(VISUAL_FIELDS)
            or review['kind'] != 'whole-original-image' or review['checkedAt'] != entry.get('checkedAt')
            or review['sha256'] != entry.get('sha256')
            or any(type(review[k]) is not int or review[k] <= 0 for k in ('width', 'height'))
            or review['width'] * review['height'] > 50_000_000
            or type(review['frames']) is not int or review['frames'] != 1
            or review['blankApplicantForm'] is not True or review['noFilledPersonalData'] is not True
            or not isinstance(review['evidenceNote'], str) or len(review['evidenceNote'].strip()) < 30
            or entry.get('textScope') != 'all_original_image_frames' or entry.get('sectionsRead') != IMAGE_SECTIONS):
        raise ValueError('invalid_whole_image_review')
    return review


def ordinance_authority(entry, law):
    """The existing basis: this municipality's own ordinance page on Law.go.kr."""
    return (law.hostname in ('law.go.kr', 'www.law.go.kr')
            and law.path in ('/ordinInfoP.do', '/LSW/ordinInfoP.do')
            and [v for k, v in parse_qsl(law.query) if k == 'ordinSeq'] == [entry.get('lawId')]
            and str(entry.get('lawId', '')).isdigit()
            and all(valid_day(entry.get(k)) for k in ('lawEffectiveDate', 'lawCurrentCheckedAt'))
            and entry['lawCurrentCheckedAt'] == entry['checkedAt'] and entry['lawEffectiveDate'] <= entry['checkedAt'])


def iso_day(value):
    """'YYYYMMDD' 와 'YYYY-MM-DD' 만 ISO 로 읽는다. 그 밖에는 None."""
    text = str(value or '').strip()
    if re.fullmatch(r'\d{8}', text):text = f'{text[:4]}-{text[4:6]}-{text[6:]}'
    return text if valid_day(text) else None


def korean_day(text):
    """'YYYY년 M월 D일' 하나를 ISO 로. 없으면 None."""
    found = KOREAN_DAY.search(text or '')
    return f'{int(found[1]):04d}-{int(found[2]):02d}-{int(found[3]):02d}' if found else None


def addendum_head_day(text):
    """부칙 머리말의 공포일. 법령포털은 '2024. 12. 20.' 과 'YYYY년 M월 D일' 을 함께 쓴다."""
    found = DOTTED_DAY.search(text or '') or KOREAN_DAY.search(text or '')
    if not found:return None
    value = f'{int(found[1]):04d}-{int(found[2]):02d}-{int(found[3]):02d}'
    return value if valid_day(value) else None


def validate_current_law_date(entry, law_record, body, explicit_evidence=None):
    """선언한 시행일이 실제 현행 부칙과 맞는지 본문으로 확인한다.

    API 메타의 시행일과 선언이 같으면 기존 경로 그대로 그 날짜를 돌려주고 아무것도 더 묻지
    않는다. 다를 때만, 같은 법규ID·공포일·공포번호·본문 SHA 에 결속된 증거를 요구하고 본문
    에서 그 공포 정보를 머리말에 가진 부칙 하나를 직접 찾아 시행일을 읽어 대조한다. 플래그나
    날짜 문자열만으로는 통과하지 않으며, 부칙을 특정하지 못하거나 시행일이 여럿·불명확하면
    추측하지 않고 실패한다. 반환값은 검증된 ISO 시행일이다.
    """
    law_id = str(entry.get('lawId') or '')
    if not law_id.isdigit() or str(law_record.get('lawId') or '') != law_id:raise ValueError('law_record_mismatch')
    declared = entry.get('lawEffectiveDate')
    if not valid_day(declared):raise ValueError('invalid_declared_effective_date')
    meta = iso_day(law_record.get('effectiveDate'))
    if meta is None:raise ValueError('invalid_law_record_effective_date')
    if meta == declared and explicit_evidence is None:return declared
    if not isinstance(explicit_evidence, dict):raise ValueError('law_date_meta_mismatch')
    if set(explicit_evidence) != set(LAW_DATE_EVIDENCE):raise ValueError('law_date_evidence_fields')
    promulgated, number = iso_day(law_record.get('promulgationDate')), str(law_record.get('promulgationNumber') or '')
    if promulgated is None or not number.isdigit():raise ValueError('law_record_promulgation_missing')
    if (str(explicit_evidence['lawId']) != law_id or iso_day(explicit_evidence['promulgationDate']) != promulgated
            or str(explicit_evidence['promulgationNumber']) != number
            or explicit_evidence['effectiveDate'] != declared):raise ValueError('law_date_evidence_binding')
    raw = bytes(body) if isinstance(body, (bytes, bytearray)) else str(body).encode('utf-8')
    if hashlib.sha256(raw).hexdigest() != str(explicit_evidence['bodySHA256']):raise ValueError('law_body_changed')
    text = raw.decode('utf-8')
    marks = list(ADDENDUM.finditer(text))
    blocks = [text[mark.end():(marks[i+1].start() if i+1 < len(marks) else len(text))]
              for i, mark in enumerate(marks)
              if addendum_head_day(mark[1]) == promulgated and f'제{number}호' in re.sub(r'\s+', '', mark[1])]
    if len(blocks) != 1:raise ValueError('current_addendum_not_identified')
    block = blocks[0]
    sentences = ENFORCEMENT.findall(block)
    if len(sentences) != 1 or len(re.findall(r'부터\s*시행', block)) != 1 or '다만' in block:
        raise ValueError('ambiguous_enforcement_date')
    enforced = korean_day(sentences[0])
    if enforced is None:raise ValueError('no_explicit_enforcement_date')
    if enforced != declared:raise ValueError('enforcement_date_conflict')
    quoted = re.sub(r'\s+', ' ', str(explicit_evidence['addendumText'])).strip()
    if len(quoted) < 10 or korean_day(quoted) != declared or quoted not in re.sub(r'\s+', ' ', block):
        raise ValueError('addendum_quote_mismatch')
    return declared


def national_intake_reference(entry):
    """A reviewed municipal intake is bound to this exact registry source and page."""
    ref = entry.get('nationalMunicipalIntakeReference')
    if ref is None:return None
    basis = entry.get('authorityBasis') or {}
    city = str(ref.get('municipality', '')) if isinstance(ref, dict) else ''
    code = str(ref.get('sigungu', '')) if isinstance(ref, dict) else ''
    if (not isinstance(ref, dict) or set(ref) != NATIONAL_INTAKE_FIELDS
            or ref.get('kind') != 'municipal-intake' or ref.get('stage') != 'initial-application'
            or not re.fullmatch(r'\d{5}', code) or code.endswith('000') or code != entry.get('regionCode')
            or len(city.strip()) < 2 or city not in str(entry.get('regionLabel', ''))
            or entry.get('sourceKind') != 'agency' or entry.get('use') != 'conditional'
            or city not in str(entry.get('condition', ''))
            or ref.get('sourceSHA256') != entry.get('sha256')
            or not re.fullmatch(r'[a-f0-9]{64}', str(ref.get('sourceSHA256', '')))
            or ref.get('municipalPageUrl') != entry.get('sourcePageUrl') or ref.get('downloadUrl') != entry.get('sourceUrl')
            or basis.get('kind') != 'official-program' or basis.get('evidenceUrl') != ref.get('municipalPageUrl')
            or not re.fullmatch(r'[a-f0-9]{64}', str(ref.get('municipalPageSHA256', '')))
            or ref['municipalPageSHA256'] != basis.get('pageSHA256')
            or ref.get('httpStatus') != 200 or not valid_day(ref.get('checkedAt')) or ref['checkedAt'] != entry.get('checkedAt')
            or any(not safe_url(ref.get(k)) or not re.fullmatch(r'gov\.kr|.+\.(?:go|gov)\.kr', urlsplit(ref[k]).hostname or '') for k in ('municipalPageUrl','downloadUrl'))
            or any(not isinstance(ref.get(k), str) or len(ref[k].strip()) < 30 or city not in ref[k]
                   for k in ('sameServiceEvidence','populationEvidence','scopeRestriction'))
            or not re.search(r'전용|한정|선택', ref['scopeRestriction'])
            or [p.get('id') for p in entry.get('programs', [])] != [ref.get('programmeId')]):
        raise ValueError('invalid_national_municipal_intake_reference')
    return ref


def validate_national_intake(entry, program, record):
    """The programme and imported record must reproduce the reviewed registry route."""
    ref = national_intake_reference(entry)
    matched = next((p for p in entry['programs'] if p['id'] == program.get('id')), None)
    sources = [program.get('url')] + [s.get('url') for s in program.get('sources', []) if isinstance(s, dict)]
    if (not ref or record.get('nationalMunicipalIntakeReference') != ref
            or program.get('scope') != 'national' or program.get('region') is not None
            or ref['programmeId'] != program.get('id') or not matched or matched['url'] not in sources
            or record.get('formId') != entry.get('id') or record.get('scopeBasis') != 'national-municipal-intake-reference'
            or record.get('programEvidenceUrl') != matched['url'] or record.get('evidenceUrl') != entry['sourcePageUrl']
            or record.get('checkedAt') != entry['checkedAt'] or record.get('use') != entry['use']
            or record.get('condition', '') != entry.get('condition', '') or record.get('sha256') != entry['sha256']
            or record.get('verificationStatus') != 'verified' or record.get('officialAttachmentMatched') is not True
            or record.get('renamedLawReference') or record.get('municipalApplicationReference')
            or (record.get('displayTitle') is not None and record['displayTitle'] != entry['title'])):
        raise ValueError('agency_national_intake_binding_mismatch')


def registry_entry(form_id):
    entry = REGISTRY.get(form_id)
    if not isinstance(entry, dict) or not AGENCY_ID.fullmatch(str(form_id)):
        raise ValueError('unregistered_agency_form')
    basis = official_program_basis(entry)
    visual = whole_image_review(entry)
    urls = [entry.get(k) for k in ('sourcePageUrl', 'sourceUrl', 'finalUrl', 'authorityEvidenceUrl')]
    if not basis:urls.append(entry.get('lawEvidenceUrl'))
    law = urlsplit(str(entry.get('lawEvidenceUrl', '')))
    identity = entry.get('attachmentIdentifier') or {}
    programs = entry.get('programs') or []
    parts = entry.get('selectedParts') or []
    authority = urlsplit(str(entry.get('authorityEvidenceUrl', '')))
    government_authority = bool(re.fullmatch(r'(?:gov\.kr|.+\.(?:go|gov)\.kr)', authority.hostname or ''))
    # A delegated/private download host needs a separately reviewed public
    # authority's page. No domain name alone registers an attachment.
    query_identity = (set(identity) == {'queryParam', 'value'} and isinstance(identity['queryParam'], str)
                      and bool(identity['queryParam']) and not SECRET.search(identity['queryParam'])
                      and identity['value'] == entry.get('attachmentId')
                      and [v for k, v in parse_qsl(urlsplit(entry['sourceUrl']).query) if k == identity['queryParam']] == [entry['attachmentId']])
    path_identity = (set(identity) == {'path'} and isinstance(identity['path'], str) and identity['path'].startswith('/')
                     and identity['path'] == urlsplit(entry['sourceUrl']).path and safe_path(identity['path']))
    if (entry.get('id') != form_id or entry.get('sourceKind') != 'agency'
            or form_id.split('-')[1] != entry.get('regionCode') or not all(safe_url(u) for u in urls)
            or entry.get('authorityKind') not in ('government', 'public_institution', 'delegated')
            or entry.get('authorityEvidenceKind') not in ('government', 'public_institution')
            or (entry['authorityEvidenceKind'] == 'government' and not government_authority)
            or (entry['authorityKind'] == 'delegated' and authority.hostname == urlsplit(entry['sourceUrl']).hostname)
            or len(entry.get('authorityEvidenceNote', '')) < 30
            or not valid_day(entry.get('checkedAt'))
            or (not basis and not ordinance_authority(entry, law))
            or (entry.get('publishedAt') is not None and (not valid_day(entry['publishedAt']) or entry['publishedAt'] > entry['checkedAt']))
            or not re.fullmatch(r'[a-f0-9]{64}', str(entry.get('sha256', '')))
            or type(entry.get('bytes')) is not int or entry['bytes'] <= 0
            or entry.get('format') not in ('hwp', 'hwpx', 'pdf', 'jpg', 'png')
            or not entry.get('attachmentId') or not (query_identity or path_identity)
            or not programs or any(not p.get('id') or not safe_url(p.get('url')) for p in programs)
            or len({p['id'] for p in programs}) != len(programs)
            or entry.get('role') not in ('application', 'consent', 'delegation', 'supporting')
            or entry.get('use') not in ('main', 'additional', 'conditional')
            or (entry['role'] == 'delegation' and entry['use'] != 'conditional')
            or (entry['use'] == 'conditional' and not entry.get('condition'))
            or entry.get('textScope') != ('all_original_image_frames' if (visual or {}).get('kind') == 'whole-original-image' else 'all_body_sections_or_pages')
            or not entry.get('sectionsRead') or len(set(entry['sectionsRead'])) != len(entry['sectionsRead'])
            or not parts or not entry.get('applicant')
            or any(not all(isinstance(p.get(k), str) and p[k].strip() for k in ('number', 'title', 'author'))
                   or p.get('use') not in ('main', 'additional', 'conditional') for p in parts)):
        raise ValueError('invalid_agency_registry_entry')
    national_intake_reference(entry)
    return entry


def validate_form(form):
    e = registry_entry(form.get('id'))
    expected = {k: e[k] for k in ('id', 'title', 'role', 'regionCode', 'regionLabel', 'sourceKind', 'sourceUrl', 'lawId', 'lawTitle')}
    expected.update(annexId='', annexNumber='', lawUrl=e['lawEvidenceUrl'], fetchedAt=e['checkedAt'],
                    dateKind='published' if e.get('publishedAt') else 'checked', effectiveDate=e.get('publishedAt') or e['checkedAt'])
    if any(form.get(k) != v for k, v in expected.items()) or form.get('agency') != agency_metadata(e) or form.get('officialPdfUrl'):
        raise ValueError('agency_source_identity_mismatch')
    return e


def agency_metadata(e):
    data = {k: e[k] for k in ('agencyName', 'sourcePageUrl', 'finalUrl', 'attachmentId', 'sha256', 'bytes', 'format', 'checkedAt', 'authorityEvidenceUrl')}
    # Only a registered programme basis is published, and only as its own field.
    if e.get('authorityBasis') is not None:data['authorityBasis'] = {k: e['authorityBasis'][k] for k in BASIS_FIELDS}
    # Only a scanned original publishes a whole-original review, and only its
    # own keys for the kind it actually is.
    if e.get('visualReview') is not None:data['visualReview'] = {k: e['visualReview'][k] for k in review_fields(e['visualReview'])}
    return data


def validate_program(e, program, record):
    if e.get('nationalMunicipalIntakeReference') is not None or record.get('nationalMunicipalIntakeReference') is not None or record.get('scopeBasis') == 'national-municipal-intake-reference':
        return validate_national_intake(e, program, record)
    matched = next((p for p in e['programs'] if p['id'] == program.get('id')), None)
    region = program.get('region') or {}
    code = region.get('sigungu') if program.get('scope') == 'sigungu' else region.get('sido') if program.get('scope') == 'sido' else None
    sources = [program.get('url')] + [s.get('url') for s in program.get('sources', []) if isinstance(s, dict)]
    if (not matched or code != e['regionCode'] or matched['url'] not in sources
            or record.get('programEvidenceUrl') != matched['url'] or record.get('evidenceUrl') != e['sourcePageUrl']
            or record.get('checkedAt') != e['checkedAt'] or record.get('use') != e['use']
            or record.get('condition', '') != e.get('condition', '') or record.get('scopeBasis')
            or record.get('renamedLawReference') or record.get('municipalApplicationReference')
            or (record.get('displayTitle') is not None and record['displayTitle'] != e['title'])):
        raise ValueError('agency_program_binding_mismatch')


def verify_original(form_id, data, info):
    e = registry_entry(form_id)
    visual = e.get('visualReview')
    if (len(data) != e['bytes'] or hashlib.sha256(data).hexdigest() != e['sha256']
            or info.get('format') != e['format'] or info.get('textScope') != e['textScope']
            or info.get('sectionsRead') != e['sectionsRead']):
        raise ValueError('agency_original_bytes_or_full_body_mismatch')
    # Empty extracted text is accepted only for a reviewed whole-original scan,
    # and then the actual frames/pixel size or the actual pages must be the
    # reviewed ones. A PDF that does carry text keeps the ordinary body gate.
    if not visual:
        if not info.get('text', '').strip():raise ValueError('agency_original_bytes_or_full_body_mismatch')
    elif visual['kind'] == 'whole-original-pdf':
        if (info.get('format') != 'pdf' or info.get('text') != '' or info.get('textLength') != 0
                or len(info.get('sectionsRead') or []) != visual['pageCount']
                or info.get('sectionsRead') != visual['pagesRead']):
            raise ValueError('agency_pdf_original_differs_from_whole_pdf_review')
    elif (info.get('text') != '' or info.get('textLength') != 0 or info.get('imageFrames') != visual['frames']
            or info.get('imageWidth') != visual['width'] or info.get('imageHeight') != visual['height']):
        raise ValueError('agency_image_original_differs_from_whole_image_review')
    return e


def prepare_review(record, inspect_document):
    e = registry_entry(record.get('formId'))
    expected = {k: e[k] for k in ('sourceKind', 'sourcePageUrl', 'sourceUrl', 'finalUrl', 'attachmentId', 'agencyName',
        'authorityEvidenceUrl', 'lawId', 'lawTitle', 'lawEvidenceUrl', 'lawEffectiveDate', 'lawCurrentCheckedAt',
        'regionCode', 'regionLabel', 'sha256', 'bytes', 'checkedAt', 'textScope', 'sectionsRead', 'applicant', 'role', 'use')}
    expected.update(formTitle=e['title'], originalFormat=e['format'], publishedAt=e.get('publishedAt'),
        dateKind='published' if e.get('publishedAt') else 'checked', effectiveDate=e.get('publishedAt') or e['checkedAt'],
        selectedParts=e['selectedParts'], reviewedParts=e['selectedParts'], annexId='', annexNumber='',
        roleEvidenceUrl=e['sourceUrl'], roleCheckedAt=e['checkedAt'], authorityBasis=e.get('authorityBasis'),
        visualReview=e.get('visualReview'))
    expected['nationalMunicipalIntakeReference'] = e.get('nationalMunicipalIntakeReference')
    if (any(record.get(k) != v for k, v in expected.items())
            or record.get('verificationStatus') != 'verified' or record.get('officialAttachmentMatched') is not True
            or record.get('fullBodyReviewed') is not True or len(str(record.get('roleBasis', ''))) < 30
            or len(str(record.get('evidenceNote', ''))) < 30 or record.get('condition', '') != e.get('condition', '')
            or not isinstance(record.get('programIds'), list) or not record['programIds']
            or not set(record['programIds']).issubset({p['id'] for p in e['programs']})
            or len(record['programIds']) != len(set(record['programIds'])) or record.get('flSeq') not in (None, '')
            or record.get('officialPdfUrl') or record.get('archiveMember')):
        raise ValueError('agency_review_lacks_exact_full_body_evidence')
    raw_path = record.get('originalPath')
    if not isinstance(raw_path, str) or not raw_path or Path(raw_path).is_absolute() or '..' in Path(raw_path).parts:
        raise ValueError('agency_original_path_escape')
    local = (ROOT/raw_path).resolve()
    if not local.is_relative_to(ROOT.resolve()) or local.suffix != '.'+e['format'] or not local.is_file():
        raise ValueError('agency_original_path_escape_or_missing')
    data = local.read_bytes()
    verify_original(e['id'], data, inspect_document(data))
    return e, {k: record[k] for k in ('role', 'roleBasis', 'roleEvidenceUrl', 'roleCheckedAt', 'sha256',
        'fullBodyReviewed', 'sectionsRead', 'reviewedParts', 'selectedParts', 'applicant')}
