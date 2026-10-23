"""Download actual Law.go.kr originals; candidates stay private until reviewed.

Setup: python -m pip install -r scripts/requirements-forms.txt
Publish workflow (run from the repository): prepare-portal-reviews.py, this
script --scope approved, build-form-census.py, then npm run forms:build.
--scope municipal-candidates saves originals to the owner's archive only;
it does not approve associations or copy unreviewed candidates to public/.

HWP paragraph controls follow Hancom's HWP 5.0 specification, table 6.
https://cdn.hancom.com/link/docs/한글문서파일형식_5.0_revision1.2.pdf
"""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import io
import json
import re
import struct
import threading
import time
import zipfile
import zlib
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit, urljoin
import xml.etree.ElementTree as ET

import olefile
import requests
from pypdf import PdfReader
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
agency_spec=importlib.util.spec_from_file_location('download_agency',ROOT/'scripts/verified_agency_forms.py')
agency=importlib.util.module_from_spec(agency_spec);agency_spec.loader.exec_module(agency)
LOG=ROOT/'logs/law-downloads'
MANIFEST=ROOT/'pipeline/forms/download-manifest.json'
MAX_BYTES=30*1024*1024
OLE=bytes.fromhex('d0cf11e0a1b11ae1')

def read(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def now():return datetime.now(timezone.utc).isoformat()
def digest(data):return hashlib.sha256(data).hexdigest()
def write_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix(path.suffix+f'.{time.time_ns()}.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=1)+'\n',encoding='utf-8')
    for attempt in range(20):
        try:temp.replace(path);return
        except PermissionError:
            if attempt==19:raise
            time.sleep(.05)

def official_download(url):
    try:
        p=urlsplit(url);items=parse_qsl(p.query);q=dict(items)
        return (p.scheme=='https' and p.hostname in ('www.law.go.kr','law.go.kr')
                and not p.username and not p.password and p.port in (None,443)
                # Current ordinance API responses also use the root endpoint.
                and p.path in ('/flDownload.do','/LSW/flDownload.do','/LSW/flDownloadPdf.do')
                and len([v for k,v in items if k=='flSeq'])==1
                and str(q.get('flSeq','')).isdigit()
                and not any(re.search(r'^oc$|key|token|auth|secret|password',k,re.I) for k in q))
    except (ValueError,TypeError):return False

def paragraph_text(payload):
    parts=[];i=0
    # Inline/extended controls occupy 8 WCHARs, not one character.
    while i+2<=len(payload):
        code=struct.unpack_from('<H',payload,i)[0]
        if code<32:
            if code in (9,10,13,30,31):parts.append(' ')
            i+=16 if 1<=code<=23 and code not in (10,13) else 2
        else:
            start=i;i+=2
            while i+2<=len(payload) and struct.unpack_from('<H',payload,i)[0]>=32:i+=2
            parts.append(payload[start:i].decode('utf-16-le',errors='replace'))
    return ''.join(parts).strip()

def inspect_document(data,format_hint=None):
    """Read every body section; never mistake Preview text or an HTML error for a form."""
    sections=[];texts=[];scope='all_body_sections_or_pages'
    if data.startswith(b'HWP Document File V3.00 ') and len(data)>128:
        # HWP30 rendering/reading is performed separately and bound to the
        # original SHA in the explicit review. Do not fabricate extracted text.
        return {'format':'hwp','sectionsRead':['HWP3'],'text':'','textLength':0,'textScope':'legacy_hwp_requires_external_review'}
    if data.startswith(OLE):
        with olefile.OleFileIO(io.BytesIO(data)) as doc:
            header=doc.openstream('FileHeader').read()
            if not header.startswith(b'HWP Document File') or len(header)<40:raise ValueError('not_hwp')
            flags=struct.unpack_from('<I',header,36)[0]
            if flags&6:raise ValueError('protected_hwp')
            for name in sorted(doc.listdir()):
                if len(name)!=2 or name[0]!='BodyText' or not re.fullmatch(r'Section\d+',name[1]):continue
                content=doc.openstream(name).read()
                if flags&1:content=zlib.decompress(content,-15)
                if len(content)>MAX_BYTES:raise ValueError('section_too_large')
                sections.append('/'.join(name));i=0
                while i+4<=len(content):
                    control=struct.unpack_from('<I',content,i)[0];i+=4
                    size=control>>20
                    if size==0xfff:
                        if i+4>len(content):raise ValueError('truncated_record')
                        size=struct.unpack_from('<I',content,i)[0];i+=4
                    if i+size>len(content):raise ValueError('truncated_record')
                    if control&0x3ff==67:texts.append(paragraph_text(content[i:i+size]))
                    i+=size
        fmt='hwp'
    elif data.startswith(b'PK'):
        with zipfile.ZipFile(io.BytesIO(data)) as doc:
            if sum(i.file_size for i in doc.infolist())>100*1024*1024:raise ValueError('expanded_file_too_large')
            if doc.testzip():raise ValueError('broken_zip_crc')
            if doc.read('mimetype').strip() not in (b'application/hwp+zip',b'application/vnd.hancom.hwpx'):raise ValueError('not_hwpx')
            for name in sorted(doc.namelist()):
                if re.fullmatch(r'Contents/section\d+\.xml',name):
                    xml=ET.fromstring(doc.read(name));sections.append(name)
                    texts.extend(''.join(node.itertext()) for node in xml.iter() if node.tag.rsplit('}',1)[-1]=='t')
        fmt='hwpx'
    elif data.startswith(b'%PDF-'):
        doc=PdfReader(io.BytesIO(data),strict=True)
        if not doc.pages:raise ValueError('empty_pdf')
        for i,page in enumerate(doc.pages):sections.append(f'page-{i+1}');texts.append(page.extract_text() or '')
        fmt='pdf'
    elif data.startswith(b'\xff\xd8\xff'):
        # A scanned original has no body text to extract. Reading every frame
        # here is mechanical only: it proves the bytes are one decodable JPEG
        # image, never that the form is blank. That judgement stays with the
        # registered whole-image review.
        with Image.open(io.BytesIO(data)) as doc:
            if doc.format!='JPEG' or getattr(doc,'n_frames',1)!=1:raise ValueError('invalid_jpeg')
            if doc.width<1 or doc.height<1 or doc.width*doc.height>50_000_000:raise ValueError('invalid_jpeg')
            doc.load()
            return {'format':'jpg','sectionsRead':['frame-1'],'text':'','textLength':0,
                    'textScope':'all_original_image_frames','imageWidth':doc.width,'imageHeight':doc.height,'imageFrames':1}
    elif data.startswith(b'\x89PNG\r\n\x1a\n'):
        # A scanned original has no body text to extract. Reading the one frame
        # here is mechanical only: it proves the bytes are one decodable PNG
        # image, never that the form is blank. That judgement stays with the
        # registered whole-image review. Bytes are kept as the official PNG;
        # they are not re-encoded to JPEG or PDF.
        with Image.open(io.BytesIO(data)) as doc:
            if doc.format!='PNG' or getattr(doc,'n_frames',1)!=1:raise ValueError('invalid_png')
            if doc.width<1 or doc.height<1 or doc.width*doc.height>50_000_000:raise ValueError('invalid_png')
            doc.load()
            return {'format':'png','sectionsRead':['frame-1'],'text':'','textLength':0,
                    'textScope':'all_original_image_frames','imageWidth':doc.width,'imageHeight':doc.height,'imageFrames':1}
    elif data.startswith((b'GIF87a',b'GIF89a')):
        with Image.open(io.BytesIO(data)) as doc:
            if doc.format!='GIF' or doc.width*doc.height>50_000_000 or doc.n_frames>100:raise ValueError('invalid_gif')
            for i in range(doc.n_frames):doc.seek(i);doc.load();sections.append(f'frame-{i+1}')
        fmt='gif';scope='image_requires_visual_review'
    elif format_hint=='txt':
        try:text=data.decode('utf-8-sig')
        except UnicodeDecodeError:text=data.decode('cp949')
        if len(text.strip())<10 or re.search(r'[\x00-\x08\x0e-\x1f]|<!doctype|<html|<script',text,re.I):raise ValueError('not_plain_text_form')
        sections=['text'];texts=[text];fmt='txt';scope='plain_text'
    else:raise ValueError('not_a_document')
    if not sections:raise ValueError('missing_body_sections')
    text='\n'.join(t for t in texts if t.strip())
    return {'format':fmt,'sectionsRead':sections,'text':text,'textLength':len(text),'textScope':scope}

class Download:
    def __init__(self,interval,timeout):self.interval=interval;self.timeout=timeout;self.lock=threading.Lock();self.next=0
    def get(self,url):
        if not official_download(url):raise ValueError('not_public_law_download')
        for attempt in range(3):
            with self.lock:
                time.sleep(max(0,self.next-time.monotonic()));self.next=time.monotonic()+self.interval
            try:
                with requests.get(url,headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.law.go.kr/'},
                                  timeout=self.timeout,stream=True,allow_redirects=False) as response:
                    if response.status_code in (429,503):
                        retry=response.headers.get('Retry-After','2')
                        wait=min(60,int(retry)) if retry.isdecimal() else 2
                        with self.lock:self.next=max(self.next,time.monotonic()+wait)
                        continue
                    if response.status_code!=200:raise ValueError('http_'+str(response.status_code))
                    chunks=[];size=0
                    for chunk in response.iter_content(65536):
                        size+=len(chunk)
                        if size>MAX_BYTES:raise ValueError('file_too_large')
                        chunks.append(chunk)
                    return b''.join(chunks)
            except (requests.Timeout,requests.ConnectionError):
                if attempt==2:raise
        raise ValueError('rate_limited')

    def get_agency(self,form_id):
        """Only the registered source and its one registered final redirect."""
        entry=agency.registry_entry(form_id);url=entry['sourceUrl']
        for hop in range(2):
            with self.lock:
                time.sleep(max(0,self.next-time.monotonic()));self.next=time.monotonic()+self.interval
            with requests.get(url,headers={'User-Agent':'Mozilla/5.0','Referer':entry['sourcePageUrl']},
                              timeout=self.timeout,stream=True,allow_redirects=False) as response:
                if response.url!=url:raise ValueError('agency_wire_url_mismatch')
                if response.status_code in (301,302,303,307,308):
                    target=urljoin(url,response.headers.get('Location',''))
                    if hop or target!=entry['finalUrl'] or target==url or not agency.safe_url(target):
                        raise ValueError('unregistered_agency_redirect')
                    url=target;continue
                if response.status_code!=200:raise ValueError('agency_http_'+str(response.status_code))
                if response.url!=entry['finalUrl']:raise ValueError('agency_final_url_mismatch')
                chunks=[];size=0
                for chunk in response.iter_content(65536):
                    size+=len(chunk)
                    if size>MAX_BYTES:raise ValueError('file_too_large')
                    chunks.append(chunk)
                data=b''.join(chunks)
                agency.verify_original(form_id,data,inspect_document(data))
                return data
        raise ValueError('unregistered_agency_redirect')

def expected_hashes():
    out={}
    for path in (ROOT/'pipeline/forms/reviews').glob('*-reviewed*.json'):
        if not re.fullmatch(r'(national|municipal)-reviewed(?:-round\d+)?\.json',path.name):continue
        d=read(path)
        for row in d['rows'] if isinstance(d,dict) else d:
            if row.get('sha256'):out[row['formId']]=row['sha256']
    for row in read(ROOT/'pipeline/forms/source-manifest.json')['forms']:out.setdefault(row['id'],row['sha256'])
    return out

def reviewed_archive_members():
    selected={}
    for path in (ROOT/'pipeline/forms/reviews').glob('*-reviewed*.json'):
        if not re.fullmatch(r'(national|municipal)-reviewed(?:-round\d+)?\.json',path.name):continue
        content=read(path)
        for row in content['rows'] if isinstance(content,dict) else content:
            member=row.get('archiveMember')
            if not member:continue
            if (row.get('verificationStatus')!='verified' or row.get('officialAttachmentMatched') is not True
                or not isinstance(member,dict) or not member.get('name')
                or not re.fullmatch(r'[a-f0-9]{64}',str(member.get('containerSha256') or ''))
                or member.get('sha256')!=row.get('sha256')):raise ValueError('invalid_reviewed_archive_member')
            if row['formId'] in selected and selected[row['formId']]!=member:raise ValueError('conflicting_reviewed_archive_members')
            selected[row['formId']]=member
    return selected

def reviewed_original_evidence():
    """Non-HWP originals need explicit source-bound reading evidence."""
    evidence={}
    for path in (ROOT/'pipeline/forms/reviews').glob('*-reviewed*.json'):
        if not re.fullmatch(r'(national|municipal)-reviewed(?:-round\d+)?\.json',path.name):continue
        content=read(path)
        for row in content['rows'] if isinstance(content,dict) else content:
            fmt=row.get('originalFormat')
            if fmt not in ('hwp3','pdf','txt','gif'):continue
            sha=row.get('sha256')
            if row.get('verificationStatus')!='verified' or row.get('officialAttachmentMatched') is not True or not re.fullmatch(r'[a-f0-9]{64}',str(sha)):raise ValueError('unverified_nonstandard_original')
            if fmt=='hwp3':
                external=row.get('externalBodyEvidence') or {}
                if external.get('reader')!='Hancom.HWP30' or external.get('sourceSha256')!=sha or not isinstance(external.get('pageCount'),int) or external['pageCount']<1:raise ValueError('missing_hwp3_body_evidence')
            if fmt=='gif':
                visual=row.get('visualReview') or {}
                if visual.get('sourceSha256')!=sha or not visual.get('framesRead') or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',str(visual.get('checkedAt'))):raise ValueError('missing_gif_visual_evidence')
            evidence[row['formId']]=row
    return evidence

def extract_reviewed_member(container,selection):
    """Return unchanged member bytes only for an explicitly inspected ZIP/hash."""
    if digest(container)!=selection['containerSha256']:raise ValueError('reviewed_archive_hash_changed')
    with zipfile.ZipFile(io.BytesIO(container)) as archive:
        if sum(i.file_size for i in archive.infolist())>100*1024*1024 or archive.testzip():raise ValueError('invalid_source_archive')
        matches=[]
        for info in archive.infolist():
            name=info.filename if info.flag_bits&0x800 else info.filename.encode('cp437').decode('cp949')
            if name==selection['name']:matches.append(info)
        if len(matches)!=1:raise ValueError('reviewed_archive_member_missing_or_ambiguous')
        data=archive.read(matches[0])
    if digest(data)!=selection['sha256']:raise ValueError('reviewed_archive_member_hash_changed')
    if inspect_document(data)['format'] not in ('hwp','hwpx'):raise ValueError('reviewed_member_not_hangul')
    return data

def approved_catalog():
    catalog=read(ROOT/'public/forms/v1/catalog.json')['forms']
    ids={link['formId'] for p in (ROOT/'public/forms/v1/programs').glob('*.json') for row in read(p)['programs'] for link in row['links']}
    # New approvals can be imported before rebuilding the public catalogue.
    reviewed=read(ROOT/'pipeline/forms/portal-reviewed-links.json')
    catalog.update(reviewed['forms']);ids.update(row['formId'] for row in reviewed['rows'])
    return {i:catalog[i] for i in ids}

def cached_original(form,archive):
    fid=form['id'];record_path=LOG/(fid+'.json')
    registered=agency.validate_form(form) if form.get('sourceKind')=='agency' or fid.startswith('agency-') else None
    if record_path.exists():
        record=read(record_path)
        path=Path(record.get('localPath',''))
        if record.get('state')=='stored' and record.get('sourceUrl')==form['sourceUrl'] and path.is_file():
            data=path.read_bytes()
            if registered:
                if not path.resolve().is_relative_to(Path(archive).resolve()) or record.get('finalUrl')!=registered['finalUrl']:
                    raise ValueError('agency_cached_path_or_identity_mismatch')
                agency.verify_original(fid,data,inspect_document(data))
            if digest(data)==record.get('sha256'):return data,record
    # A filename alone does not prove which official attachment supplied it.
    # Fresh checkouts can reuse committed originals only through their manifest.
    if MANIFEST.exists():
        entry=read(MANIFEST).get('forms',{}).get(fid,{})
        if entry.get('sourceUrl')==form['sourceUrl'] and entry.get('format') in ('hwp','hwpx','pdf','txt','gif','jpg','png'):
            expected_path=f"originals/{fid}.{entry['format']}"
            path=ROOT/'pipeline/forms'/expected_path
            if entry.get('path')==expected_path and path.is_file():
                data=path.read_bytes()
                if registered:
                    if not path.resolve().is_relative_to((ROOT/'pipeline/forms').resolve()) or entry.get('finalUrl')!=registered['finalUrl']:
                        raise ValueError('agency_cached_path_or_identity_mismatch')
                    agency.verify_original(fid,data,inspect_document(data))
                if len(data)==entry.get('bytes') and digest(data)==entry.get('sha256'):return data,None
    return None,None

def save_original(archive,fid,fmt,data):
    """Preserve a previous original if the portal changes the bytes for one ID."""
    target=archive/(fid+'.'+fmt)
    if target.exists() and digest(target.read_bytes())!=digest(data):
        target=archive/(fid+'-'+digest(data)[:12]+'.'+fmt)
    if not target.exists():target.write_bytes(data)
    if target.read_bytes()!=data:raise ValueError('archive_original_hash_changed')
    return target

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scope',choices=('approved','municipal-candidates','explicit'),default='approved')
    parser.add_argument('--forms-file',type=Path,help='Official metadata for explicitly identified missing annexes')
    parser.add_argument('--archive-dir',type=Path,default=Path.home()/'goyang-welfare-forms/law-portal-attachments')
    parser.add_argument('--workers',type=int,default=6)
    parser.add_argument('--interval',type=float,default=.35)
    parser.add_argument('--timeout',type=int,default=30)
    args=parser.parse_args();args.archive_dir.mkdir(parents=True,exist_ok=True);LOG.mkdir(parents=True,exist_ok=True)
    approved=approved_catalog();expected=expected_hashes();members=reviewed_archive_members();body_evidence=reviewed_original_evidence();forms=approved
    if args.scope=='municipal-candidates':
        portal=read(ROOT/'pipeline/forms/portal-forms.json')['forms']
        ids={c['formId'] for p in read(ROOT/'pipeline/forms/portal-matches.json')['programs'].values() for c in p['candidates']}
        forms={i:portal[i] for i in ids if portal[i]['sourceKind']=='ordin'}
    elif args.scope=='explicit':
        if not args.forms_file:parser.error('explicit scope requires --forms-file')
        supplied=read(args.forms_file)['forms']
        forms={f['id']:f for f in supplied} if isinstance(supplied,list) else supplied
    priority_path=LOG/'priority.json';priority=read(priority_path).get('formIds',[]) if priority_path.exists() else []
    order={fid:i for i,fid in enumerate(priority)}
    tasks=sorted(forms.values(),key=lambda f:(0 if f['id'] in approved else 1,order.get(f['id'],len(order)),f['id']))
    downloader=Download(args.interval,args.timeout);manifest=read(MANIFEST) if MANIFEST.exists() else {'schema':1,'forms':{}}
    results=[]
    def worker(form):
        fid=form['id']
        try:
            registered=agency.validate_form(form) if form.get('sourceKind')=='agency' or fid.startswith('agency-') else None
            if not registered and (not re.fullmatch(r'(ordin|law|rule)-\d+',fid) or not official_download(form['sourceUrl'])):raise ValueError('invalid_form_identity')
            source_archive=None;archive_entry=None
            if fid in members and fid in approved:
                selection=members[fid];container_path=args.archive_dir/(fid+'.zip')
                committed=ROOT/'pipeline/forms/source-archives'/(fid+'.zip')
                container=container_path.read_bytes() if container_path.exists() else committed.read_bytes() if committed.exists() else downloader.get(form['sourceUrl'])
                data=extract_reviewed_member(container,selection)
                container_path=save_original(args.archive_dir,fid,'zip',container)
                committed.parent.mkdir(parents=True,exist_ok=True)
                if not committed.exists():committed.write_bytes(container)
                if digest(committed.read_bytes())!=selection['containerSha256']:raise ValueError('committed_source_archive_changed')
                source_archive={'localPath':str(container_path),'member':selection['name'],'sha256':digest(container),'bytes':len(container)}
                archive_entry={'path':f'source-archives/{fid}.zip','member':selection['name'],'sha256':digest(container),'bytes':len(container)}
                previous=read(LOG/(fid+'.json')) if (LOG/(fid+'.json')).exists() else None;reused=True
            else:
                data,previous=cached_original(form,args.archive_dir)
                reused=data is not None
                if data is None:data=downloader.get_agency(fid) if registered else downloader.get(form['sourceUrl'])
            sha=digest(data)
            if fid in approved and fid in expected and sha!=expected[fid]:raise ValueError('reviewed_original_hash_changed')
            hint=(previous or {}).get('format') or manifest.get('forms',{}).get(fid,{}).get('format') or body_evidence.get(fid,{}).get('originalFormat')
            info=inspect_document(data,hint)
            if registered:agency.verify_original(fid,data,info)
            target=save_original(args.archive_dir,fid,info['format'],data)
            record={'formId':fid,'state':'stored','sourceUrl':form['sourceUrl'],'lawId':form['lawId'],'lawTitle':form['lawTitle'],
                    'title':form['title'],'regionCode':form['regionCode'],'sha256':sha,'bytes':len(data),'localPath':str(target),
                    'downloadedAt':previous.get('downloadedAt') if previous else now(),'reused':reused,**info}
            if registered:record.update(sourceKind='agency',finalUrl=registered['finalUrl'],sourcePageUrl=registered['sourcePageUrl'],attachmentId=registered['attachmentId'])
            if source_archive:record['sourceArchive']=source_archive
            write_json(LOG/(fid+'.json'),record)
            entry=None
            if fid in approved:
                # An image original is publishable only as a registered agency
                # attachment, whose own whole-image review already bound it.
                if info['format'] not in ('hwp','hwpx','pdf','txt','gif') and not (registered and info['format'] in ('jpg','png')):raise ValueError('unsupported_approved_original')
                if info['format'] in ('txt','gif') or info['textScope']=='legacy_hwp_requires_external_review':
                    evidence=body_evidence.get(fid,{})
                    expected_format='hwp3' if info['textScope']=='legacy_hwp_requires_external_review' else info['format']
                    if evidence.get('sha256')!=sha or evidence.get('originalFormat')!=expected_format:raise ValueError('missing_source_bound_body_review')
                    if evidence.get('externalBodyEvidence'):record['externalBodyEvidence']=evidence['externalBodyEvidence']
                    if evidence.get('visualReview'):record['visualReview']=evidence['visualReview']
                    write_json(LOG/(fid+'.json'),record)
                relative=f"originals/{fid}.{info['format']}";destination=ROOT/'pipeline/forms'/relative
                destination.parent.mkdir(parents=True,exist_ok=True)
                if not destination.exists():destination.write_bytes(data)
                if digest(destination.read_bytes())!=sha:raise ValueError('stored_original_hash_changed')
                entry={k:record[k] for k in ('format','bytes','sha256','sourceUrl','downloadedAt')};entry['path']=relative
                if registered:entry['finalUrl']=registered['finalUrl']
                if archive_entry:entry['archive']=archive_entry
                pdf_url=form.get('officialPdfUrl')
                pdf_path=ROOT/'pipeline/forms/previews'/(fid+'.pdf')
                if pdf_url and info['format']!='pdf':
                    try:
                        previous_pdf=manifest.get('forms',{}).get(fid,{}).get('pdf',{})
                        cached_pdf=pdf_path.read_bytes() if pdf_path.exists() else None
                        trusted_cache=(cached_pdf is not None and previous_pdf.get('sourceUrl')==pdf_url
                            and previous_pdf.get('sha256')==digest(cached_pdf) and previous_pdf.get('bytes')==len(cached_pdf))
                        pdf=cached_pdf if trusted_cache else downloader.get(pdf_url)
                        if inspect_document(pdf)['format']!='pdf':raise ValueError('not_pdf')
                        pdf_path.parent.mkdir(parents=True,exist_ok=True)
                        if cached_pdf is not None and cached_pdf!=pdf:save_original(args.archive_dir,fid,'pdf',cached_pdf)
                        if cached_pdf!=pdf:pdf_path.write_bytes(pdf)
                        entry['pdf']={'path':f'previews/{fid}.pdf','bytes':len(pdf),'sha256':digest(pdf),'sourceUrl':pdf_url}
                    except Exception as error:record['pdfError']=type(error).__name__;write_json(LOG/(fid+'.json'),record)
            return {'id':fid,'state':'stored','format':info['format'],'bytes':len(data),'reused':reused},entry
        except Exception as error:
            reason=str(error) if isinstance(error,ValueError) else type(error).__name__
            result={'id':fid,'state':'failed','reason':reason}
            write_json(LOG/(fid+'.error.json'),result);return result,None
    print(json.dumps({'event':'start','scope':args.scope,'forms':len(tasks)}),flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures=[pool.submit(worker,f) for f in tasks]
        for future in concurrent.futures.as_completed(futures):
            result,entry=future.result();results.append(result)
            if entry:manifest['forms'][result['id']]=entry
            if len(results)%20==0 or len(results)==len(tasks):
                if args.scope=='approved':write_json(MANIFEST,manifest)
                progress={'scope':args.scope,'total':len(tasks),'completed':len(results),'stored':sum(r['state']=='stored' for r in results),
                          'failed':sum(r['state']=='failed' for r in results),'updatedAt':now()}
                write_json(LOG/(args.scope+'-progress.json'),progress);print(json.dumps(progress),flush=True)
    write_json(LOG/(args.scope+'-results.json'),results)
    if args.scope=='approved':write_json(MANIFEST,manifest)
    return 1 if any(r['state']=='failed' for r in results) else 0

if __name__=='__main__':raise SystemExit(main())
