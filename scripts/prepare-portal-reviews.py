"""Import source-audited portal associations; this is not an automatic approval step.

Reads the base audits and any later numbered rounds of the same shape
(`national-reviewed.json`, `municipal-reviewed.json`, `national-reviewed-round2.json`, ...)
in a fixed order, oldest round first. Review reports and other files that sit in
the same folder stay out.

Audited rows may carry two kinds of explicit metadata. `scopeBasis` says a form
from another jurisdiction still applies to the program; it is checked against the
program region and the law the program cites instead of being taken on trust, and
nothing here invents one the audit did not claim. `role` with `roleBasis`,
`roleEvidenceUrl` and `roleCheckedAt` may name a supporting form whose title
cannot identify it. Deleted or agency-only forms remain excluded. A small list
of separately inspected combined/unnamed attachments can expose the exact
applicant-written parts only with full-body evidence, an original hash and usage
conditions. An indirect national form reference must identify the cited local
delegation or the exact program page, national law and annex number.
"""
import importlib.util,json,re,sqlite3,sys
from urllib.parse import urlsplit,parse_qsl,parse_qs
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('portal_match',ROOT/'pipeline/forms/portal_match.py')
matcher=importlib.util.module_from_spec(spec);spec.loader.exec_module(matcher)
agency_spec=importlib.util.spec_from_file_location('reviewed_agency',ROOT/'scripts/verified_agency_forms.py')
agency=importlib.util.module_from_spec(agency_spec);agency_spec.loader.exec_module(agency)
REVIEW_FILE=re.compile(r'(national|municipal)-reviewed(?:-round(\d+))?\.json')
BASE_FILES=('national-reviewed.json','municipal-reviewed.json')
ALLOWED_ROLES=frozenset({'application','consent','delegation','supporting'})
# 역할 자체가 신청인이 쓰는 서식이 아님을 뜻하는 값. 검토 메타데이터로도 올리지 않는다.
BLOCKED_ROLES=frozenset({'administrative','deleted','reference'})
# 제목만으로 역할을 가릴 수 없어 원문을 따로 확인한 서식. 아래 role 메타데이터 규칙보다
# 먼저 검토된 행이라 id로 남긴다. 새 서식은 메타데이터를 갖춰야 한다.
AUDITED_SUPPORTING_FORMS=frozenset({'rule-3211497'})
# Explicitly inspected full-body exceptions, never general title-based promotion.
AUDITED_APPLICATION_EXCEPTIONS={'ordin-20002811':'1408662','ordin-20761903':'2063661','ordin-19399661':'1898059',
                                'ordin-17191599':'1650349','ordin-21753097':'2121739','ordin-21753099':'2121739',
                                'ordin-21341739':'1667571','ordin-14476309':'1762395','ordin-16549509':'1880261',
                                'ordin-17269521':'1699351','ordin-22525343':'1410694',
                                'ordin-22717307':'2171299','ordin-22750737':'2171301',
                                'ordin-15375681':'1793155','ordin-16095227':'1782391','ordin-18313473':'1657259',
                                'ordin-19657853':'2025289','ordin-19761355':'2032635','ordin-22140033':'2152191',
                                'ordin-14971213':'1704867','ordin-17311341':'1721145','ordin-18776253':'1985771',
                                'ordin-18978935':'2000657','ordin-19639951':'1982003','ordin-20588823':'1549715',
                                'ordin-20666309':'1909501','ordin-21335081':'1812545','ordin-22289045':'2157159',
                                'ordin-22518043':'2126525','ordin-20860689':'2067953',
                                'ordin-10415813':'962315','ordin-11531359':'1513689','ordin-15475401':'1574609',
                                'ordin-16102521':'1842719','ordin-17402139':'1921987','ordin-18978933':'2000657',
                                'ordin-19227331':'1484407','ordin-19639905':'1399895','ordin-19974453':'1557185',
                                'ordin-20017213':'1842883','ordin-20080511':'1762943','ordin-21060997':'2085069',
                                'ordin-21297129':'2005839','ordin-21724859':'2119899','ordin-22073507':'1574429',
                                'ordin-22264889':'2155733','ordin-22289051':'2157159','ordin-22518041':'2126525',
                                'ordin-21069107':'2086293','ordin-22289049':'2157159','ordin-7130000':'1835761',
                                'ordin-21438973':'2089655'}
AUDITED_CONSENT_EXCEPTIONS={'ordin-19307191':'1872429','ordin-19876833':'1246766','ordin-21403833':'2107187'}
OVERRIDE_FILE=ROOT/'pipeline/forms/reviews/full-body-role-overrides.json'
# New full-body reviews are data, not an ever-growing list of IDs in code.
# Each override is bound to the exact original SHA and still passes the gates below.
FULL_BODY_ROLE_OVERRIDES=json.loads(OVERRIDE_FILE.read_text(encoding='utf-8-sig')).get('forms',{}) if OVERRIDE_FILE.exists() else {}
VERIFIED_LAW_HISTORIES=json.loads((ROOT/'src/lib/data/verifiedLawHistories.json').read_text(encoding='utf-8-sig'))['histories']
SCOPE_BASES=frozenset({'provincial-law-reference','national-law-reference','official-application-reference','municipal-application-reference','national-municipal-intake-reference'})
def read(file):return json.loads(file.read_text(encoding='utf-8-sig'))
def day(value):
    value=str(value)
    return f'{value[:4]}-{value[4:6]}-{value[6:8]}' if re.fullmatch(r'\d{8}',value) else value
def review_files(directory):
    """검토 원문 파일 목록. 기본 파일에 회차 파일을 더하고 같은 순서로만 읽는다."""
    found=[]
    for path in sorted(directory.glob('*.json')):
        match=REVIEW_FILE.fullmatch(path.name)
        if not match or not path.is_file():continue
        # 기본 파일을 0회차로 두어 회차 파일이 항상 뒤에 온다. round10은 round2 뒤다.
        found.append((int(match.group(2)) if match.group(2) else 0,BASE_FILES.index(match.group(1)+'-reviewed.json'),path.name,path))
    missing=[name for name in BASE_FILES if name not in {item[2] for item in found}]
    if missing:raise FileNotFoundError('Missing audited review file: '+', '.join(missing))
    return [item[3] for item in sorted(found)]
def official_url(value):
    """근거는 법령정보센터 https 주소만 받는다."""
    try:
        url=urlsplit(str(value or ''))
        return (url.scheme=='https' and url.hostname in {'www.law.go.kr','law.go.kr'}
            and not url.username and not url.password
            and not any(re.search(r'^oc$|key|token|secret|password|auth|login|email|phone|resident',name,re.I) for name,_ in parse_qsl(url.query)))
    except ValueError:return False
def provincial_law_title(title,code):
    title=matcher.normalize_law(title)
    aliases={'51000':('강원도','강원특별자치도'),'52000':('전라북도','전북특별자치도'),'50000':('제주도','제주특별자치도')}
    old,new=aliases.get(code,('',''))
    return new+title[len(old):] if old and title.startswith(old) else title
def cites_form_law(program,form):
    """사업이 이 서식의 법령을 실제로 인용하는지. 공개 단계의 검사와 같은 기준이다."""
    region=program.get('region') or {}
    province=form.get('regionCode') if form.get('regionCode')==region.get('sido') else None
    target=provincial_law_title(form.get('lawTitle'),province)
    if not target:return False
    family=set(matcher.law_variants(target))
    laws=program.get('laws') or []
    if isinstance(laws,str):laws=[laws]
    if not isinstance(laws,list):return False
    for entry in laws:
        for part in matcher.split_law_citations(entry):
            cited=provincial_law_title(part,province)
            if cited and (cited==target or target in matcher.law_variants(cited) or cited in family):return True
            region=program.get('region') or {}
            if form.get('regionCode')==region.get('sido') and form.get('regionLabel'):
                qualified=matcher.normalize_law(form['regionLabel']+part)
                if qualified and (qualified==target or target in matcher.law_variants(qualified)):return True
    return False
HISTORY_FIELDS=('kind','programId','formLawId','stableLawId','priorLawId','transitionLawId',
    'citedLawTitle','priorRuleTitle','currentRuleTitle','provinceCode','municipalityCode',
    'historyEvidenceUrl','transitionEvidenceUrl','currentEvidenceUrl','checkedAt',
    'purposeArticleLink','transitionBasis','scopeRestriction')

def renamed_law_reference(record,program,form):
    """An individually reviewed law history is bound to one benefit and province."""
    ref=record.get('renamedLawReference')
    if not isinstance(ref,dict):return False
    history=VERIFIED_LAW_HISTORIES.get(form.get('lawId'))
    if (not history or any(ref.get(key)!=history.get(key) for key in
        ('stableLawId','priorLawId','transitionLawId','priorRuleTitle','currentRuleTitle','provinceCode'))):return False
    region=program.get('region') or {}
    same_province=(program.get('scope')=='sigungu' and form.get('regionCode')==region.get('sido'))
    ids=[ref.get(k) for k in ('priorLawId','transitionLawId','formLawId')]
    def valid_url(value,lid):
        if not official_url(value):return False
        url=urlsplit(value)
        ids=[v for k,v in parse_qsl(url.query) if k=='ordinSeq']
        return url.path in ('/ordinInfoP.do','/LSW/ordinInfoP.do') and ids==[lid]
    if (not same_province or record.get('scopeBasis')!='provincial-law-reference' or record.get('municipalApplicationReference') is not None
        or form.get('sourceKind')!='ordin' or ref.get('kind')!='exact-stable-ordinance-history'
        or ref.get('programId')!=program.get('id') or ref.get('formLawId')!=form.get('lawId')
        or ref.get('provinceCode')!=region.get('sido') or ref.get('municipalityCode')!=region.get('sigungu')
        or not re.fullmatch(r'\d{5}',str(ref.get('municipalityCode','')))
        or ref['municipalityCode'][:2]+'000'!=ref.get('provinceCode')
        or not all(isinstance(v,str) and v.isdigit() for v in ids) or len(set(ids))!=3
        or not re.fullmatch(r'\d+',str(ref.get('stableLawId','')))
        or ref.get('checkedAt')!=record.get('checkedAt') or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',str(ref.get('checkedAt','')))
        or record.get('verificationStatus')!='verified' or record.get('officialAttachmentMatched') is not True
        or not re.fullmatch(r'[a-f0-9]{64}',str(record.get('sha256','')))
        or matcher.normalize_law(ref.get('currentRuleTitle'))!=matcher.normalize_law(form['lawTitle'])
        or not all(len(str(ref.get(k,'')).strip())>=30 for k in ('purposeArticleLink','transitionBasis','scopeRestriction'))
        or not all(valid_url(ref.get(k),lid) for k,lid in zip(('historyEvidenceUrl','transitionEvidenceUrl','currentEvidenceUrl'),ids))
        or not valid_url(record.get('evidenceUrl'),form['lawId'])
        or not cites_form_law(program,{**form,'lawTitle':ref.get('citedLawTitle')})
        or not cites_form_law({'laws':[ref.get('citedLawTitle')],'region':region},{**form,'lawTitle':ref.get('priorRuleTitle')})):
        return False
    return True

def role_metadata(record):
    """원문으로 역할을 확인했다는 메타데이터. 근거·출처·확인일이 모두 있어야 인정한다."""
    role=str(record.get('role') or '').strip()
    if role!='supporting':return None
    basis=str(record.get('roleBasis') or '').strip();url=str(record.get('roleEvidenceUrl') or '').strip()
    checked=day(str(record.get('roleCheckedAt') or '').strip())
    if len(basis)<10 or not official_url(url) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',checked):return None
    return {'role':role,'roleBasis':basis,'roleEvidenceUrl':url,'roleCheckedAt':checked}
def application_part_title(value):
    title=str(value or '').strip()
    # The actual dormitory form is titled 입사원서. Registers and pledges
    # containing those characters must not gain an application role from it.
    return bool(re.search(r'신청|청구|신고|등록',title) or re.fullmatch(r'입사\s*원서',title))

def resolve_role(record):
    """서식 역할과 검토 메타데이터. 제목 분류를 먼저 쓰고, 가릴 수 없을 때만 메타데이터를 본다."""
    form_id=record['formId'];declared=str(record.get('role') or '').strip()
    if record.get('sourceKind')=='agency' or str(form_id).startswith('agency-'):
        body_spec=importlib.util.spec_from_file_location('agency_body_reader',ROOT/'scripts/download-law-form-files.py')
        body=importlib.util.module_from_spec(body_spec);body_spec.loader.exec_module(body)
        entry,metadata=agency.prepare_review(record,body.inspect_document)
        return entry['role'],metadata
    if declared in BLOCKED_ROLES:raise ValueError('Audited row marks a non-applicant form role: '+form_id)
    role=matcher.classify_role(record['formTitle'],'서식')
    exception_laws=AUDITED_APPLICATION_EXCEPTIONS if declared=='application' else AUDITED_CONSENT_EXCEPTIONS if declared=='consent' else {}
    explicit=FULL_BODY_ROLE_OVERRIDES.get(form_id)
    if explicit and declared in ('application','consent','delegation','supporting'):
        if explicit.get('role')!=declared or explicit.get('lawId')!=record.get('lawId') or explicit.get('sha256')!=record.get('sha256'):
            raise ValueError('Full-body role override does not match the reviewed original: '+form_id)
        exception_laws={**exception_laws,form_id:explicit['lawId']}
    if form_id in exception_laws:
        parts=record.get('reviewedParts')
        evidence=record.get('roleEvidenceUrl')
        valid_part=lambda p: isinstance(p,dict) and ((declared=='application' and (p.get('use')=='main' or (p.get('use')=='conditional' and record.get('condition'))) and application_part_title(p.get('title')))
            or (declared=='consent' and p.get('use') in ('additional','conditional') and '동의' in str(p.get('title') or ''))
            or (declared=='delegation' and p.get('use')=='conditional' and record.get('use')=='conditional'
                and record.get('condition') and '위임' in str(p.get('title') or ''))
            or (declared=='supporting' and p.get('use') in ('additional','conditional')
                and record.get('use') in ('additional','conditional')
                and (record.get('use')!='conditional' or record.get('condition')) and p.get('title')))
        if (record.get('lawId')!=exception_laws[form_id]
            or record.get('sourceKind')!='ordin' or record.get('annexId')!=form_id.split('-')[1]
            or record.get('verificationStatus')!='verified' or record.get('officialAttachmentMatched') is not True
            or not re.fullmatch(r'[a-f0-9]{64}',str(record.get('sha256') or ''))
            or not official_url(evidence) or len(str(record.get('roleBasis') or ''))<30
            or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',day(record.get('roleCheckedAt')))
            or not isinstance(parts,list) or not parts
            or not any(valid_part(p) for p in parts)
            or not all(isinstance(p,dict) and all(p.get(k) for k in ('number','title','use','author')) for p in parts)
            or (len(parts)>1 and not record.get('condition')) or role=='deleted'):
            raise ValueError('Audited application exception lacks full-body evidence: '+form_id)
        return declared,{key:record[key] for key in ('role','roleBasis','roleEvidenceUrl','roleCheckedAt','sha256','reviewedParts')}
    if re.match(r'^\s*\[?\s*별표(?:\s|\d|\]|$)',record['formTitle']):
        raise ValueError('Reference annex cannot be imported as an applicant form: '+form_id)
    if role in BLOCKED_ROLES-{'reference'}:
        raise ValueError('Agency-issued or deleted form cannot be imported: '+form_id)
    if role in ALLOWED_ROLES:
        if declared and declared!=role:raise ValueError('Audited role contradicts the form title: '+form_id)
        return role,None
    if form_id in AUDITED_SUPPORTING_FORMS:return 'supporting',None
    metadata=role_metadata(record)
    if metadata:return metadata['role'],metadata
    raise ValueError('Audited form role still needs review; an unidentified supporting form needs roleBasis, roleEvidenceUrl and roleCheckedAt: '+form_id)
def national_municipal_intake(record,program,form,entry):
    if form.get('sourceKind')!='agency' or form.get('regionCode')!=entry.get('regionCode'):
        raise ValueError('National municipal intake source differs from its registry')
    return agency.validate_national_intake(entry,program,record)


STATUTORY_APPLICATIONS=json.loads((ROOT/'src/lib/data/verifiedStatutoryApplications.json').read_text(encoding='utf-8-sig'))['applications']
STATUTORY_REF_FIELDS=frozenset({'kind','referenceId','referencedLawTitle','annexNumber','sourceSHA256','basis'})
STATUTORY_STEPS=('law','regulation','notice')


def statutory_application(record,program,form,ref):
    """법이 그 급여의 신청서로 전국 공통 서식 하나를 지정한 경로.

    사업마다 따로 검토해 등록한 verifiedStatutoryApplications 항목에만 열린다. 링크는 그
    등록을 그대로 되비추며 사업ID·지역·서식·별지번호·원본SHA·현행 3단계 조문이 모두 맞아야
    한다. 법령 제목 별칭이나 승인 플래그로는 통과하지 않고 초기 신청 단계만 받는다.
    """
    entry=STATUTORY_APPLICATIONS.get(str(ref.get('referenceId') or ''))
    region=program.get('region') if isinstance(program.get('region'),dict) else {}
    sources=[program.get('url')]+[s.get('url') for s in program.get('sources',[]) if isinstance(s,dict)]
    government=lambda url: bool(url) and urlsplit(str(url)).scheme=='https' and bool(re.fullmatch(r'gov\.kr|.+\.(?:go|gov)\.kr',urlsplit(str(url)).hostname or ''))
    # 접수기관 누리집은 광역시 산하처럼 go.kr 이 아닐 수 있다. 안전한 공개 주소만 요구한다.
    public_https=lambda url: bool(url) and urlsplit(str(url)).scheme=='https' and '.' in (urlsplit(str(url)).hostname or '') and not urlsplit(str(url)).username
    city=str((entry or {}).get('municipality',''))
    chain=(entry or {}).get('chain')
    cited=(entry or {}).get('citedLawTitle')
    cites=bool(cited) and any(matcher.normalize_law(title)==matcher.normalize_law(cited) for title in (program.get('laws') or []) if isinstance(title,str))
    if (not entry or set(ref)!=STATUTORY_REF_FIELDS or entry.get('referenceId')!=ref.get('referenceId')
            or entry.get('programmeId')!=program.get('id') or program.get('scope')!='sigungu'
            or region.get('sigungu')!=entry.get('sigungu') or region.get('sido')!=entry.get('sido')
            or entry.get('formId')!=record['formId'] or form.get('regionCode')!='national'
            or entry.get('lawId')!=form.get('lawId') or entry.get('annexNumber')!=form['annexNumber']
            or matcher.normalize_law(entry.get('referencedLawTitle'))!=matcher.normalize_law(form['lawTitle'])
            or entry.get('sourceUrl')!=form.get('sourceUrl')
            or entry.get('stage')!='initial-application' or entry.get('use')!=record.get('use')
            or entry.get('checkedAt')!=record.get('checkedAt')
            or not re.fullmatch(r'[a-f0-9]{64}',str(entry.get('sourceSHA256','')))
            or ref.get('sourceSHA256')!=entry['sourceSHA256'] or str(record.get('sha256'))!=entry['sourceSHA256']
            or record.get('bytes')!=entry.get('sourceBytes') or record.get('originalFormat')!=entry.get('sourceFormat')
            or len(city)<2 or city not in str(record.get('condition',''))
            or city not in str(entry.get('scopeRestriction',''))
            or not cites or record.get('condition')!=entry.get('condition')
            or len(str(entry.get('condition','')).strip())<30
            or str(form.get('effectiveDate','')).replace('-','')!=str(entry.get('sourceEffectiveDate','')).replace('-','')
            or any(len(str(entry.get(k,'')).strip())<30 for k in ('scopeRestriction','sourceDateCaveat'))
            or not isinstance(chain,list) or len(chain)!=len(STATUTORY_STEPS)
            or any(not isinstance(row,dict) or row.get('step')!=step or not str(row.get('lawId','')).isdigit()
                   or not str(row.get('title','')).strip()
                   or not re.fullmatch(r'제\d+조(?:의\d+)?(?:제\d+항)?',str(row.get('article','')))
                   or len(str(row.get('claim','')).strip())<20 or not official_url(row.get('url'))
                   or row.get('currentState')!='source_current' or row.get('checkedAt')!=entry.get('checkedAt')
                   or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',str(row.get('effectiveDate','')))
                   or str(row.get('effectiveDate'))>str(entry.get('checkedAt'))
                   or not re.fullmatch(r'[a-f0-9]{64}',str(row.get('evidenceSHA256','')))
                   or not re.fullmatch(r'[a-f0-9]{64}',str(row.get('currentIdentityEvidenceSHA256','')))
                   or parse_qs(urlsplit(row.get('url','')).query,keep_blank_values=True).get('admRulSeq' if step=='notice' else 'lsiSeq')!=[row.get('lawId')]
                   or (step!='notice' and parse_qs(urlsplit(row.get('url','')).query,keep_blank_values=True).get('joNo')!=[re.search(r'^제(\d+)조',row['article']).group(1).zfill(4)])
                   for step,row in zip(STATUTORY_STEPS,chain))
            or matcher.normalize_law(chain[0].get('title'))!=matcher.normalize_law(cited)
            or chain[2].get('lawId')!=entry.get('lawId')
            or not public_https((entry.get('receivingAgency') or {}).get('url'))
            or len(str((entry.get('receivingAgency') or {}).get('claim','')).strip())<30
            or (entry.get('receivingAgency') or {}).get('checkedAt')!=entry.get('checkedAt')
            or (entry.get('receivingAgency') or {}).get('httpStatus')!=200
            or not re.fullmatch(r'[a-f0-9]{64}',str((entry.get('receivingAgency') or {}).get('evidenceSHA256','')))
            or not re.fullmatch(r'[a-f0-9]{64}',str(entry.get('programmeEvidenceSHA256','')))
            or not government(entry.get('programmeUrl'))
            or record.get('evidenceUrl')!=entry.get('programmeUrl')
            or record.get('programEvidenceUrl')!=entry.get('programmeUrl')
            or entry.get('programmeUrl') not in sources):
        raise ValueError('Statutory application reference lacks exact registered chain evidence: '+record['formId'])


def scope_basis(record,program,form):
    """다른 관할 서식이 이 사업에 적용된다는 근거. 검토가 적은 값만 확인하고 없으면 만들지 않는다."""
    if form.get('sourceKind')=='agency':
        entry=agency.validate_form(form)
        if record.get('nationalMunicipalIntakeReference') is not None or str(record.get('scopeBasis') or '')=='national-municipal-intake-reference':
            national_municipal_intake(record,program,form,entry)
            return 'national-municipal-intake-reference'
        agency.validate_program(entry,program,record)
        return None
    region=program.get('region') if isinstance(program.get('region'),dict) else {}
    same_province=program.get('scope')=='sigungu' and form['regionCode']==region.get('sido')
    national_reference=form['regionCode']=='national' and form.get('sourceKind') in {'law','rule'} and program.get('scope') in {'sido','sigungu'}
    declared=str(record.get('scopeBasis') or '').strip()
    if record.get('renamedLawReference') is not None:
        if not renamed_law_reference(record,program,form):
            raise ValueError('Renamed law reference lacks exact program and official history evidence: '+record['formId'])
        return 'provincial-law-reference'
    municipal=record.get('municipalApplicationReference')
    if municipal or declared=='municipal-application-reference':
        ref=municipal if isinstance(municipal,dict) else {}
        city=str(ref.get('municipality',''));code=str(ref.get('sigungu',''))
        sources=[program.get('url')]+[s.get('url') for s in program.get('sources',[]) if isinstance(s,dict)]
        government=lambda url: bool(url) and urlsplit(url).scheme=='https' and bool(re.fullmatch(r'gov\.kr|.+\.(?:go|gov)\.kr',urlsplit(url).hostname or ''))
        if (declared not in ('','municipal-application-reference') or program.get('scope')!='sido'
            or form.get('sourceKind')!='ordin' or ref.get('sido')!=region.get('sido') or code!=form['regionCode']
            or not re.fullmatch(r'\d{5}',code) or code[:2]+'000'!=ref.get('sido') or code==ref.get('sido')
            or len(city)<2 or city not in form['regionLabel']
            or record.get('use')!='conditional' or city not in str(record.get('condition',''))
            or ref.get('httpStatus')!=200 or ref.get('programSpecific') is not True or ref.get('checkedAt')!=record.get('checkedAt')
            or len(str(ref.get('reference','')))<30 or city not in str(ref.get('reference',''))
            or len(str(ref.get('formEvidence','')))<30 or city not in str(ref.get('formEvidence',''))
            or city not in str(ref.get('scopeRestriction','')) or not re.search(r'전용|한정',str(ref.get('scopeRestriction','')))
            or matcher.normalize_law(ref.get('municipalArticle'))!=matcher.normalize_law(form['lawTitle'])
            or not re.search(r'제\d+조',str(ref.get('municipalArticle','')))
            or record.get('programEvidenceUrl') not in sources or not government(record.get('programEvidenceUrl'))
            or not government(ref.get('programEvidenceUrl'))
            or record.get('verificationStatus')!='verified' or record.get('officialAttachmentMatched') is not True
            or not re.fullmatch(r'[a-f0-9]{64}',str(record.get('sha256','')))):
            raise ValueError('Municipal application route lacks exact conditional source evidence: '+record['formId'])
        return 'municipal-application-reference'
    if not declared:
        # 세종·제주처럼 시·구 사업이 인용한 도 조례 서식만 적는다. 전국 서식의 적용 범위는
        # 검토가 밝힌 경우에만 쓰고 여기서 넓히지 않는다.
        return 'provincial-law-reference' if same_province and cites_form_law(program,form) else None
    if declared not in SCOPE_BASES:raise ValueError('Unknown audited scope basis: '+declared+' ('+record['formId']+')')
    if (declared=='provincial-law-reference' and program.get('scope')=='sido' and form['regionCode']==region.get('sido')
        and cites_form_law(program,form)):
        return None  # This particular benefit already has the form's own jurisdiction.
    if declared=='official-application-reference':
        ref=record.get('scopeReference') or {}
        if (not national_reference or record.get('verificationStatus')!='verified'
            or record.get('officialAttachmentMatched') is not True
            or not re.fullmatch(r'[a-f0-9]{64}',str(record.get('sha256') or ''))
            or matcher.normalize_law(ref.get('referencedLawTitle'))!=matcher.normalize_law(form['lawTitle'])
            or ref.get('annexNumber')!=form['annexNumber'] or len(str(ref.get('basis') or ''))<30):
            raise ValueError('Official application reference lacks exact source evidence: '+record['formId'])
        url=record.get('evidenceUrl')
        if ref.get('kind')=='statutory-chain':
            statutory_application(record,program,form,ref)
            return 'official-application-reference'
        if ref.get('kind')=='cited-local-law':
            valid=(official_url(url) and dict(parse_qsl(urlsplit(url).query)).get('ordinSeq')==ref.get('sourceLawId')
                   and bool(re.fullmatch(r'제\d+조(?:의\d+)?(?:제\d+항)?',str(ref.get('article') or '')))
                   and cites_form_law(program,{'lawTitle':ref.get('sourceLawTitle')}))
        elif ref.get('kind')=='program-documents':
            sources=[program.get('url')]+[s.get('url') for s in program.get('sources',[]) if isinstance(s,dict)]
            host=urlsplit(str(url or '')).hostname or ''
            valid=url in sources and (host=='gov.kr' or host.endswith(('.go.kr','.gov.kr')))
        else:valid=False
        if not valid:raise ValueError('Official application reference does not belong to this program: '+record['formId'])
        return declared
    supported=same_province if declared=='provincial-law-reference' else national_reference
    if not supported or not cites_form_law(program,form):
        raise ValueError('Audited scope basis does not match the program region and cited law: '+record['formId'])
    return declared
def build(programs,files):
    """검토 원문을 공개 전 연결 자료로 옮긴다. 검토가 없는 연결은 만들지 않는다."""
    rows=[];forms={};notes={};excluded=[];audited_roles={}
    for file in files:
        data=read(file)
        for record in data['rows'] if isinstance(data,dict) else data:
            form_id=record['formId']
            if form_id=='law-17831969':
                excluded.append({'formId':form_id,'reason':'Agency-issued designation certificate, not an applicant-written form.'})
                for program_id in record['programIds']:
                    notes[program_id]='시장·군수·구청장이 지정한 대리인이 신청하는 경우에는 기관에서 발급하는 대리인 지정서가 필요할 수 있습니다. 모든 가족 대리인에게 적용되는 서류는 아닙니다.'
                continue
            role,metadata=resolve_role(record)
            use=record.get('use')
            if use not in ('main','additional','conditional'):raise ValueError('Unknown reviewed document use: '+form_id)
            if (role=='delegation' or use=='conditional') and (use!='conditional' or not str(record.get('condition','')).strip()):
                raise ValueError('Conditional form needs an explicit condition: '+form_id)
            if metadata:audited_roles[form_id]=metadata
            kind=record['sourceKind'];law_id=record['lawId']
            law_url=('https://www.law.go.kr/ordinInfoP.do?ordinSeq=' if kind=='ordin' else 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=' if kind=='law' else 'https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=')+law_id
            forms[form_id]={'id':form_id,'title':record['formTitle'],'role':role,'lawTitle':record['lawTitle'],'lawId':law_id,'annexId':record['annexId'],'annexNumber':record['annexNumber'],
                'regionCode':record.get('regionCode','national'),'regionLabel':record.get('regionLabel','전국 공통'),'effectiveDate':day(record['effectiveDate']),
                'sourceUrl':record['sourceUrl'],'lawUrl':law_url,'fetchedAt':record['checkedAt'],'sourceKind':kind,'dateKind':record['dateKind'],
                **({'officialPdfUrl':record['officialPdfUrl']} if record.get('officialPdfUrl') else {})}
            if kind=='agency':
                entry=agency.registry_entry(form_id)
                forms[form_id]['lawUrl']=entry['lawEvidenceUrl']
                forms[form_id]['agency']=agency.agency_metadata(entry)
                agency.validate_form(forms[form_id])
            if record.get('displayTitle'):
                if not metadata:raise ValueError('Display title needs audited full-body role evidence: '+form_id)
                # A combined original may expose different parts for each benefit.
                # Keep that selected title on its association, not the shared form.
            for program_id in record['programIds']:
                program=programs.get(program_id)
                if not program:raise ValueError('Unknown audited program: '+program_id)
                link={key:record[key] for key in ['formId','use','condition','evidenceUrl','evidenceNote','checkedAt','displayTitle','programEvidenceUrl','municipalApplicationReference','nationalMunicipalIntakeReference'] if key in record}
                link['programIds']=[program_id]
                basis=scope_basis(record,program,forms[form_id])
                if basis:link['scopeBasis']=basis
                if basis=='official-application-reference':link['scopeReference']=record['scopeReference']
                if record.get('renamedLawReference') is not None:
                    link['renamedLawReference']={key:record['renamedLawReference'][key] for key in HISTORY_FIELDS}
                if form_id=='law-17831955':link['condition']=record['condition']+' 의료인이 작성하는 서식으로, 본인이 임의 작성하지 않습니다.'
                rows.append(link)
    keys=[(row['programIds'][0],row['formId']) for row in rows]
    if len(set(keys))!=len(keys):raise ValueError('Duplicate source-reviewed association')
    output={'schema':1,'rows':rows,'forms':forms,'programNotes':notes,'excluded':excluded}
    if audited_roles:output['auditedRoles']=audited_roles
    return output
def main():
    programs={}
    for file in sorted((ROOT/'public/bundles/v1/details').glob('*.json')):programs.update(read(file))
    files=review_files(ROOT/'pipeline/forms/reviews')
    output=build(programs,files)
    (ROOT/'pipeline/forms/portal-reviewed-links.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'links':len(output['rows']),'forms':len(output['forms']),'programs':len({row['programIds'][0] for row in output['rows']}),
        'excludedAgencyForms':len(output['excluded']),'auditedRoleForms':len(output.get('auditedRoles',{})),'reviewFiles':[file.name for file in files]}))
if __name__=='__main__':main()
