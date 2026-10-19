import argparse, ctypes as C, json, signal
from pathlib import Path
signal.alarm(20)
parser=argparse.ArgumentParser(description='Offline original FMOD event proof; no live sound integration.')
parser.add_argument('--case',choices=['b738','as21-clean','as21-airbrakes','c172-cruise'],default='b738')
options=parser.parse_args()
case=options.case
is_glider=case.startswith('as21')
aircraft='Schleicher ASK 21' if is_glider else 'Cessna 172 SP' if case=='c172-cruise' else 'Boeing 737-800'
guid='{3b679540-5d21-4d59-9646-45e7cf16e98c}' if is_glider else '{a5b8d7bc-8098-4d46-828d-71991b0de687}' if case=='c172-cruise' else '{0e9a6d1d-5fab-4f71-95c8-cd8abdb8f653}'
output_name='b738-authored-event' if case=='b738' else case+'-authored-event' 
root=Path('/Users/davidgartenberg/X-Plane 12')
core=C.CDLL(str(root/'X-Plane.app/Contents/Frameworks/libfmod.dylib'),mode=C.RTLD_GLOBAL)
studio=C.CDLL(str(root/'X-Plane.app/Contents/Frameworks/libfmodstudio.dylib'))
P=C.c_void_p; I=C.c_int; U=C.c_uint
class Guid(C.Structure):
 _fields_=[('data1',U),('data2',C.c_ushort),('data3',C.c_ushort),('data4',C.c_ubyte*8)]
class ParamId(C.Structure):
 _fields_=[('data1',U),('data2',U)]
class Param(C.Structure):
 _fields_=[('name',C.c_char_p),('id',ParamId),('minimum',C.c_float),('maximum',C.c_float),('defaultvalue',C.c_float),('type',I),('flags',U),('guid',Guid)]
specs={'System_Create':[C.POINTER(P),U], 'System_GetCoreSystem':[P,C.POINTER(P)],'System_Initialize':[P,I,U,U,P], 'System_LoadBankFile':[P,C.c_char_p,U,C.POINTER(P)],'System_GetEvent':[P,C.c_char_p,C.POINTER(P)],'EventDescription_GetParameterDescriptionCount':[P,C.POINTER(I)],'EventDescription_GetParameterDescriptionByIndex':[P,I,C.POINTER(Param)],'Bank_GetEventCount':[P,C.POINTER(I)],'EventDescription_CreateInstance':[P,C.POINTER(P)],'EventDescription_LoadSampleData':[P],'System_FlushSampleLoading':[P],'EventInstance_SetParameterByName':[P,C.c_char_p,C.c_float,I],'EventInstance_Set3DAttributes':[P,P],'EventInstance_Start':[P],'System_Update':[P],'System_Release':[P]}
for name,args in specs.items():
 fn=getattr(studio,'FMOD_Studio_'+name);fn.argtypes=args;fn.restype=I
core.FMOD_System_SetOutput.argtypes=[P,I];core.FMOD_System_SetOutput.restype=I

def call(name,*args):
 r=getattr(studio,'FMOD_Studio_'+name)(*args)
 if r: raise RuntimeError(f'{name}: {r}')
s=P();c=P();b=P();report={}
call('System_Create',C.byref(s),0x20200)
try:
 call('System_GetCoreSystem',s,C.byref(c))
 assert core.FMOD_System_SetOutput(c,5)==0
 out=(Path('server/cache/speech/xplane-probe')/(output_name+'.wav')).resolve()
 destination=C.create_string_buffer(str(out).encode())
 core.FMOD_System_SetSoftwareFormat.argtypes=[P,I,I,I];core.FMOD_System_SetSoftwareFormat.restype=I
 core.FMOD_System_SetDSPBufferSize.argtypes=[P,U,I];core.FMOD_System_SetDSPBufferSize.restype=I
 assert core.FMOD_System_SetSoftwareFormat(c,48000,3,0)==0
 assert core.FMOD_System_SetDSPBufferSize(c,512,4)==0
 call('System_Initialize',s,64,4,1,C.cast(destination,P))
 bank=root/'Aircraft/Laminar Research'/aircraft/'fmod/Master Bank.bank'
 call('System_LoadBankFile',s,str(bank).encode(),0,C.byref(b))
 count=I();call('Bank_GetEventCount',b,C.byref(count));report['events']=count.value
 event=P();call('System_GetEvent',s,guid.encode(),C.byref(event))
 call('EventDescription_GetParameterDescriptionCount',event,C.byref(count));report['parameterCount']=count.value
 report['parameters']=[]
 for i in range(count.value):
  d=Param();call('EventDescription_GetParameterDescriptionByIndex',event,i,C.byref(d))
  report['parameters'].append({'name':d.name.decode(),'min':d.minimum,'max':d.maximum,'default':d.defaultvalue,'type':d.type,'flags':d.flags})
 call('EventDescription_LoadSampleData',event);call('System_FlushSampleLoading',s)
 instance=P();call('EventDescription_CreateInstance',event,C.byref(instance))
 class Vector(C.Structure):
  _fields_=[('x',C.c_float),('y',C.c_float),('z',C.c_float)]
 class Attributes(C.Structure):
  _fields_=[('position',Vector),('velocity',Vector),('forward',Vector),('up',Vector)]
 attributes=Attributes(Vector(0 if is_glider else 10,0,0),Vector(0,0,0),Vector(0,0,1),Vector(0,1,0))
 call('EventInstance_Set3DAttributes',instance,C.byref(attributes))
 values={'sim.flightmodel2.engines.N1_percent[#]':75,'sim.flightmodel2.engines.N2_percent[#]':85,'sim.flightmodel2.engines.jetwash_mtr_sec[#]':100,'sim.flightmodel2.engines.engine_is_burning_fuel[#]':1,'laminar.B738.sound.thrust_delta[#]':0,'sim.cockpit2.gauges.indicators.altitude_ft_pilot':0,'sim.cockpit2.gauges.indicators.radio_altimeter_height_ft_pilot':0,'sim.operation.sound.inside_any':0}
 if is_glider:
  values={'sim.flightmodel.position.indicated_airspeed':60,'sim.flightmodel2.misc.AoA_angle_degrees':3,'sim.flightmodel2.controls.speedbrake_ratio':1 if case=='as21-airbrakes' else 0,'sim.flightmodel2.misc.has_crashed':0,'sim.operation.sound.inside_any':1,'sim.flightmodel2.misc.custom_slider_ratio[0]':0}
 elif case=='c172-cruise':
  values={'sim.flightmodel2.engines.engine_rotation_speed_rad_sec[#]':2400*2*3.141592653589793/60,'sim.flightmodel2.engines.engine_is_burning_fuel[#]':1,'sim.flightmodel2.misc.door_open_ratio[0]':0,'sim.flightmodel2.misc.door_open_ratio[1]':0,'sim.operation.sound.inside_ratio[0]':0,'xpevent_rel_pitch':0,'xpevent_rel_heading':90}
 report['aircraft']=aircraft;report['event']=guid;report['case']=case
 for name,value in values.items(): call('EventInstance_SetParameterByName',instance,name.encode(),value,1)
 call('EventInstance_Start',instance)
 for tick in range(750): call('System_Update',s)
 report['result']='authored event rendered offline; not in flight';report['output']=str(out);report['values']=values
except Exception as e:
 report['error']=str(e)
finally:
 if s.value: call('System_Release',s)
print(json.dumps(report))
