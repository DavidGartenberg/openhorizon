# Local diagnostic: lossless packet re-containerization, no source modification.
# RFC7845 OggOpus + RFC6716 TOC; pre-skip intentionally zero pending audition.
from pathlib import Path
import zipfile,struct,json,hashlib,ctypes as C,wave,math
root=Path('/Users/davidgartenberg/X-Plane 12')
source=root/'Resources/default scenery/1200 atc data/voices/default controller/Matthew.zip'
out=Path('server/cache/speech/xplane-probe');out.mkdir(parents=True,exist_ok=True)
def packets(data):
 assert data[:8]==b'CHROPUS!'
 samples=struct.unpack_from('<I',data,8)[0];pos=12;result=[]
 while pos<len(data):
  size=struct.unpack_from('>I',data,pos)[0];pos+=4
  assert 0<size<65535 and pos+size<=len(data)
  result.append(data[pos:pos+size]);pos+=size
 return samples,result
def samples48(p):
 config=p[0]>>3;code=p[0]&3
 ms=(2.5*(1<<(config%4))) if config>=16 else (10*(1<<(config%2))) if config>=12 else [10,20,40,60][config%4]
 frames=1 if code==0 else 2 if code<3 else p[1]&63
 assert not p[0]&4 and 0<ms*frames<=120
 return round(ms*frames*48)
def crc(data):
 value=0
 for byte in data:
  value^=byte<<24
  for _ in range(8):value=((value<<1)^0x04c11db7 if value&0x80000000 else value<<1)&0xffffffff
 return value
def page(packet,seq,granule,flags=0):
 lacing=bytes([255]*(len(packet)//255)+[len(packet)%255]);assert len(lacing)<256
 b=bytearray(b'OggS'+bytes([0,flags])+struct.pack('<QIII',granule,0x4f484154,seq,0)+bytes([len(lacing)])+lacing+packet)
 struct.pack_into('<I',b,22,crc(b));return b
with zipfile.ZipFile(source) as archive:
 names=[n for n in archive.namelist() if n.endswith('.opus')];bad=[]
 for name in names:
  count,pkts=packets(archive.read(name));frames=sum(samples48(p) for p in pkts)
  if count*3!=frames:bad.append([name,count,frames])
 print('Header-vs-TOC audit',json.dumps({'clips':len(names),'mismatches':bad[:10],'mismatchCount':len(bad)}),flush=True)
 name='0_final.opus';data=archive.read(name);count,pkts=packets(data)
 header=b'OpusHead'+struct.pack('<BBHIhB',1,1,0,16000,0,0)
 vendor=b'OpenHorizon local original-audio probe';tags=b'OpusTags'+struct.pack('<I',len(vendor))+vendor+struct.pack('<I',0)
 stream=page(header,0,0,2)+page(tags,1,0);granule=0
 for i,p in enumerate(pkts):
  granule+=samples48(p);stream+=page(p,i+2,granule,4 if i==len(pkts)-1 else 0)
 ogg=out/'atc-matthew-zero.ogg';ogg.write_bytes(stream)
 print('Repacked',str(ogg),len(pkts),granule/48000,'seconds',flush=True)
