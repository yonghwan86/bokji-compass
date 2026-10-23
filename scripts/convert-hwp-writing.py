"""Convert approved public HWP originals with a private, owned Hancom instance."""
import argparse, hashlib, json, os, time, winreg, zipfile
from datetime import date
from pathlib import Path
import fitz, psutil, win32com.client, win32process
from hwp_writing_package import sanitize_conversion
from hwp_writing_render import export_pdf

ap=argparse.ArgumentParser(description='Convert approved HWP files with Hancom; publish only identical text and rendered pages.')
ap.add_argument('--security-module-path', required=True, type=Path, help='Official FilePathCheckerModuleExample.dll with the pinned SHA-256')
ap.add_argument('--ids', default='')
ap.add_argument('--all',action='store_true')
ap.add_argument('--limit',type=int,default=0)
args=ap.parse_args()
ROOT=Path.cwd().resolve();OUT=ROOT/'logs/hwp-writing';QA=OUT/'conversion'
PUBLIC=ROOT/'public/forms/writing/v1';ASSETS=PUBLIC/'converted'
for folder in (QA,ASSETS):folder.mkdir(parents=True,exist_ok=True)
def sha(data):return hashlib.sha256(data).hexdigest()
def save(path,value):
 temporary=path.with_name(path.name+'.part')
 temporary.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf-8')
 for attempt in range(6):
  try:
   temporary.replace(path);break
  except PermissionError:
   if attempt==5:raise
   time.sleep(.05*(attempt+1))
catalog=json.loads((ROOT/'public/forms/v1/catalog.json').read_text('utf-8-sig'))['forms']
requested=[x for x in args.ids.split(',') if x]
ids=requested or sorted(k for k,f in catalog.items() if f.get('file',{}).get('format')=='hwp')
assert requested or args.all,'Explicit IDs or --all required'
if args.limit:ids=ids[:args.limit]
for fid in ids:assert fid in catalog and catalog[fid].get('file',{}).get('format')=='hwp',fid
indexPath=PUBLIC/'conversions.json'
index=json.loads(indexPath.read_text('utf-8-sig')) if indexPath.exists() else {'schema':1,'forms':{}}
pending=[]
for fid in ids:
 f=catalog[fid]['file'];entry=index['forms'].get(fid)
 if entry and entry.get('metadataSanitized') is True and entry['source']['sha256']==f['sha256']:
  asset=ROOT/'public'/entry['asset']['path'].lstrip('/')
  if asset.exists() and sha(asset.read_bytes())==entry['asset']['sha256']:continue
 pending.append(fid)
print(json.dumps({'requested':len(ids),'pending':len(pending),'alreadyVerified':len(ids)-len(pending)}),flush=True)
if not pending:raise SystemExit(0)
DLL=args.security_module_path.resolve(strict=True)
assert sha(DLL.read_bytes())=='9ac5b97c47ac8aed1e8bca27a3eef39411361d8f68c262509f0c40a8f9d21bb6'
before={p.info['pid'] for p in psutil.process_iter(['pid','name']) if (p.info['name'] or '').lower()=='hwp.exe'}
key=winreg.CreateKey(winreg.HKEY_CURRENT_USER,r'Software\HNC\HwpAutomation\Modules');name='CodexWelfareConvert'+str(os.getpid())
try:previous=winreg.QueryValueEx(key,name)
except FileNotFoundError:previous=None
winreg.SetValueEx(key,name,0,winreg.REG_SZ,str(DLL))
hwp=None;owned=False;results=[]
def pixels(path):
 with fitz.open(path) as pdf:
  rows=[]
  for page in pdf:
   pix=page.get_pixmap(matrix=fitz.Matrix(.8,.8),colorspace=fitz.csRGB,alpha=False)
   rows.append({'width':pix.width,'height':pix.height,'sha256':sha(pix.samples)})
  return rows
try:
 hwp=win32com.client.DispatchEx('HWPFrame.HwpObject.2');window=hwp.XHwpWindows.Item(0)
 _,pid=win32process.GetWindowThreadProcessId(int(window.WindowHandle))
 assert pid not in before and psutil.Process(pid).name().lower()=='hwp.exe'
 owned=True;window.Visible=False
 assert hwp.RegisterModule('FilePathCheckDLL',name)
 hwp.SetMessageBoxMode(0x00020000)
 save(OUT/'conversion-process.json',{'pythonPid':os.getpid(),'hancomPid':pid,'hancomCreatedAt':psutil.Process(pid).create_time(),'startedAt':time.time(),'owned':True})
 for number,fid in enumerate(pending,1):
  file=catalog[fid]['file'];source=(ROOT/'public'/file['hwp'].lstrip('/')).resolve()
  assert source.is_relative_to(ROOT/'public/forms/files') and sha(source.read_bytes())==file['sha256'] and source.stat().st_size==file['bytes']
  folder=QA/fid;folder.mkdir(exist_ok=True);result={'formId':fid,'sourceSHA256':file['sha256'],'startedAt':time.time(),'state':'opening'}
  save(OUT/'conversion-current.json',result)
  try:
   assert hwp.Open(str(source),'HWP','lock:false;versionwarning:false;'),'HWP open failed'
   originalPages=int(hwp.PageCount);originalText=hwp.GetTextFile('TEXT','')
   originalPdf=folder/'source.pdf';converted=folder/'converted.hwpx';convertedPdf=folder/'converted.pdf'
   result['state']='rendering-original';save(OUT/'conversion-current.json',result)
   # Preserve the source's saved print options in the conversion, then override
   # only the in-memory QA render so every logical page is compared separately.
   assert hwp.SaveAs(str(converted),'HWPX',''),'Actual HWPX conversion failed'
   export_pdf(hwp,originalPdf)
   hwp.Clear(1)
   result['state']='opening-converted';save(OUT/'conversion-current.json',result)
   assert hwp.Open(str(converted),'HWPX','lock:false;versionwarning:false;'),'Converted HWPX open failed'
   convertedPages=int(hwp.PageCount);convertedText=hwp.GetTextFile('TEXT','')
   export_pdf(hwp,convertedPdf)
   hwp.Clear(1)
   result.update(originalPages=originalPages,convertedPages=convertedPages,sourceTextSHA256=sha(originalText.encode('utf-8')),convertedTextSHA256=sha(convertedText.encode('utf-8')))
   (folder/'source-text.txt').write_text(originalText,'utf-8');(folder/'converted-text.txt').write_text(convertedText,'utf-8')
   result['originalPagePixels']=pixels(originalPdf);result['convertedPagePixels']=pixels(convertedPdf)
   assert originalPages==convertedPages>0,'Page count changed'
   assert originalText==convertedText,'Original document text changed'
   assert result['originalPagePixels']==result['convertedPagePixels'],'Rendered page pixels differ; requires visual review'
   physicalPages=len(result['originalPagePixels'])
   assert physicalPages==originalPages,'PDF export omitted or combined document pages'
   with zipfile.ZipFile(converted) as z:
    assert z.read('mimetype').strip()==b'application/hwp+zip'
    assert any(n.startswith('Contents/section') and n.endswith('.xml') for n in z.namelist())
    for item in z.namelist():
     if not item.endswith(('.xml','.hpf','.rdf','.txt')):continue
     body=z.read(item)
     for needle in (str(ROOT),str(OUT),str(Path.home())):
      assert needle.encode('utf-8') not in body and needle.encode('utf-16-le') not in body,'Local path leaked into converted package'
   assert sha(source.read_bytes())==file['sha256'],'Original HWP changed'
   data=sanitize_conversion(converted.read_bytes(), (Path.home().name,str(ROOT),str(Path.home())))
   relative=f'/forms/writing/v1/converted/{fid}-{file["sha256"][:12]}-{sha(data)[:12]}.hwpx';target=ROOT/'public'/relative.lstrip('/')
   if target.exists():assert target.read_bytes()==data,'Do not replace an existing conversion without a new identity'
   else:target.write_bytes(data)
   entry={'source':{'path':file['hwp'],'bytes':file['bytes'],'sha256':file['sha256'],'format':'hwp'},'asset':{'path':relative,'bytes':len(data),'sha256':sha(data)},'pageCount':physicalPages,'hancomPageCount':originalPages,'checkedAt':date.today().isoformat(),'sourceTextSha256':result['sourceTextSHA256'],'verification':'hancom-roundtrip-text-and-every-page-pixel-identical','metadataSanitized':True}
   index['forms'][fid]=entry;save(indexPath,index);result['state']='verified';result['asset']=entry['asset']
  except Exception as error:
   result.update(state='held',reason=str(error)[:300])
   try:hwp.Clear(1)
   except Exception:pass
  result['finishedAt']=time.time();save(folder/'result.json',result);results.append(result)
  print(json.dumps({'number':number,'total':len(pending),'formId':fid,'state':result['state'],'reason':result.get('reason'),'pages':result.get('originalPages'),'seconds':round(result['finishedAt']-result['startedAt'],2)},ensure_ascii=False),flush=True)
finally:
 if hwp is not None and owned:
  try:hwp.Clear(1)
  finally:hwp.Quit()
 if previous is None:
  try:winreg.DeleteValue(key,name)
  except FileNotFoundError:pass
 else:winreg.SetValueEx(key,name,0,previous[1],previous[0])
 key.Close();save(OUT/'conversion-last-batch.json',{'results':results,'verifiedPublicConversions':len(index['forms'])})
